/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

/**
 * MCP server for Adobe I/O Runtime, built on the official MCP TypeScript SDK
 * (`McpServer` + `WebStandardStreamableHTTPServerTransport`, Streamable HTTP transport).
 *
 * Stateless: a fresh server and transport are created per request, responses are plain JSON
 * (no SSE stream, no sessions).
 *
 *   OPTIONS -> CORS preflight (no auth)
 *   GET     -> health check (no auth); `Accept: text/event-stream` -> 405 (no SSE stream)
 *   POST    -> MCP JSON-RPC message(s), handled by the SDK (IMS auth required)
 *   DELETE  -> 200 (no session to terminate)
 *
 * Tools, resources and prompts live in ./tools.js, ./resources.js and ./prompts.js.
 * Tools may set `authenticated: true|false` (default `false`); the flag is published by
 * `tools/list` as `_meta.authenticated` and only authenticated tools receive the caller's auth
 * context. Examples: `currentDate` (unauthenticated) and `whoAmI` (authenticated).
 *
 * Auth: handled by the `imsAuth` middleware (see actions/middleware/ims-auth.js). Every POST must
 * send `Authorization: ****** token>` (and, when `IMS_CLIENT_ALLOWLIST` is set, the issuing
 * IMS client must be on it), otherwise the request is rejected before it reaches the SDK.
 */

const { WebStandardStreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js')
const { withMiddleware } = require('../middleware')
const { cors } = require('../middleware/cors')
const { imsAuth } = require('../middleware/ims-auth')
const { createMcpServer, SERVER_INFO } = require('./server')

function httpJson (statusCode, obj, headers = {}) {
  return { statusCode, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(obj) }
}

function jsonrpcError (code, message) {
  return { jsonrpc: '2.0', id: null, error: { code, message } }
}

function lowercaseHeaders (headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
}

/**
 * Serializes a client-controlled value for a single log line: JSON encoding escapes newlines and
 * control characters (no log forging) and the result is truncated.
 *
 * @private
 */
function logValue (value, maxLength = 100) {
  const text = JSON.stringify(value) ?? String(value)
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

/**
 * Reads the JSON-RPC payload from the action params. Supports raw HTTP actions (`__ow_body`,
 * plain or base64 encoded) and non-raw web actions, where a JSON body is merged into params.
 *
 * @param {object} params action params.
 *
 * @returns {*} the parsed payload, or undefined when there is none.
 * @throws {SyntaxError} when the body is not valid JSON.
 * @private
 */
function parseBody (params) {
  if (params.__ow_body !== undefined && params.__ow_body !== '') {
    if (typeof params.__ow_body !== 'string') {
      return params.__ow_body
    }
    try {
      return JSON.parse(params.__ow_body)
    } catch (e) {
      // raw HTTP actions base64 encode some bodies
      return JSON.parse(Buffer.from(params.__ow_body, 'base64').toString('utf8'))
    }
  }
  if (params.jsonrpc) {
    return { jsonrpc: params.jsonrpc, id: params.id, method: params.method, params: params.params }
  }
  return undefined
}

/**
 * Builds the Web Standard Request expected by the SDK transport.
 *
 * @private
 */
function toWebRequest (params, body) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(lowercaseHeaders(params.__ow_headers))) {
    if (typeof value === 'string') {
      headers.set(key, value)
    }
  }
  // the transport requires both; responses are always JSON (enableJsonResponse)
  headers.set('content-type', 'application/json')
  headers.set('accept', 'application/json, text/event-stream')
  return new Request(`https://runtime.adobe.io${params.__ow_path || '/mcp-tool'}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
}

/**
 * Converts a Web Standard Response into an I/O Runtime web action response.
 *
 * @private
 */
async function toRuntimeResponse (response) {
  const headers = {}
  response.headers.forEach((value, key) => { headers[key] = value })
  return { statusCode: response.status, headers, body: await response.text() }
}

/**
 * Public routes, served before authentication.
 *
 * @private
 */
function publicRoutes () {
  return function publicRoutesMiddleware (params) {
    if ((params.__ow_method || '').toLowerCase() !== 'get') {
      return undefined
    }
    const accept = lowercaseHeaders(params.__ow_headers).accept || ''
    if (accept.includes('text/event-stream')) {
      return httpJson(405, jsonrpcError(-32000, 'SSE stream not supported (stateless server); use POST'), { Allow: 'POST' })
    }
    return httpJson(200, {
      status: 'healthy',
      server: SERVER_INFO.name,
      version: SERVER_INFO.version,
      transport: 'streamable-http'
    })
  }
}

// action handler, executed after the middleware chain
async function handler (params, ctx) {
  const logger = ctx.logger
  const method = (params.__ow_method || 'post').toLowerCase()

  if (method === 'delete') {
    return { statusCode: 200, body: '' }
  }
  if (method !== 'post') {
    return httpJson(405, jsonrpcError(-32000, `Method ${method.toUpperCase()} not allowed`), { Allow: 'GET, POST, OPTIONS, DELETE' })
  }

  let body
  try {
    body = parseBody(params)
  } catch (e) {
    return httpJson(400, jsonrpcError(-32700, 'Parse error'))
  }
  if (body === null || typeof body !== 'object') {
    return httpJson(400, jsonrpcError(-32600, 'Invalid Request: missing JSON-RPC body'))
  }
  logger.info(`MCP request: ${Array.isArray(body) ? `batch of ${body.length}` : `method=${logValue(body.method)} id=${logValue(body.id)}`}`)

  const server = createMcpServer({ logger })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  })
  try {
    await server.connect(transport)
    const authInfo = ctx.auth ? { token: ctx.auth.token, clientId: ctx.auth.clientId, scopes: ctx.auth.scopes || [] } : undefined
    const response = await transport.handleRequest(toWebRequest(params, body), { parsedBody: body, authInfo })
    return await toRuntimeResponse(response)
  } finally {
    await server.close().catch(e => logger.error(e))
  }
}

exports.main = withMiddleware(handler, [
  cors(),
  publicRoutes(),
  imsAuth({ env: '<%= imsEnv %>', allowList: <%- JSON.stringify(allowlist) %> })
])
