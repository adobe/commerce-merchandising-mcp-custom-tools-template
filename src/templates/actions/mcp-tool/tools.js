/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

/**
 * Custom tools exposed by the MCP server.
 *
 * Each tool is declared with `defineTool()` and registered on the MCP SDK server by
 * `registerTools()`. A definition has:
 *
 *   - `name` (string, required)
 *   - `title`, `description` (string, optional)
 *   - `inputSchema` (zod raw shape, optional, default `{}`): validated by the SDK and published as
 *     JSON Schema in `tools/list`
 *   - `annotations` (optional): standard MCP tool annotations
 *   - `authenticated` (boolean, optional, default `false`): marks the tool as requiring the caller's
 *     identity/auth context. It is published in `tools/list` as `_meta.authenticated` (the field MCP
 *     reserves for custom data, which SDK clients preserve), so the MCP registry can persist it during
 *     onboarding and the MCP server can forward the auth header only to tools that need it. Only
 *     authenticated tools receive `auth` in their handler.
 *   - `handler` (function, required): `({ args, auth, logger }) => CallToolResult`
 */

const { z } = require('zod')
<% if (examples) { -%>
const { getTokenData } = require('@adobe/aio-lib-ims')
<% } -%>

/**
 * Validates a tool definition and applies defaults.
 *
 * @param {object} tool the tool definition.
 *
 * @returns {object} the normalized tool definition (`authenticated` defaults to `false`).
 */
function defineTool (tool) {
  if (!tool || typeof tool.name !== 'string' || tool.name.length === 0) {
    throw new Error('tool definition requires a non-empty "name"')
  }
  if (typeof tool.handler !== 'function') {
    throw new Error(`tool "${tool.name}" requires a "handler" function`)
  }
  if (tool.authenticated !== undefined && typeof tool.authenticated !== 'boolean') {
    throw new Error(`tool "${tool.name}": "authenticated" must be a boolean`)
  }
  return { inputSchema: {}, ...tool, authenticated: tool.authenticated === true }
}

/**
 * Builds a text `CallToolResult`.
 *
 * @param {string} text the result text.
 * @param {boolean} [isError] marks the result as a tool error.
 *
 * @returns {object} the `CallToolResult`.
 */
function textResult (text, isError = false) {
  const result = { content: [{ type: 'text', text }] }
  if (isError) {
    result.isError = true
  }
  return result
}

const currentDate = defineTool({
  name: 'currentDate',
  title: 'Current date',
  description: 'Returns the current date and time from the runtime clock. Optionally formatted for a given IANA timezone.',
  inputSchema: {
    timezone: z.string().optional().describe('Optional IANA timezone, e.g. "Europe/Bucharest" or "America/Los_Angeles". Defaults to UTC.')
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  authenticated: false,
  handler: ({ args }) => {
    const now = new Date()
    const tz = args && args.timezone
    if (!tz) {
      return textResult(`${now.toISOString()} (UTC)`)
    }
    try {
      const formatted = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, dateStyle: 'full', timeStyle: 'long'
      }).format(now)
      return textResult(`${formatted} (${tz})`)
    } catch (e) {
      return textResult(`${now.toISOString()} (UTC; unknown timezone "${tz}")`)
    }
  }
})

<% if (examples) { -%>
const whoAmI = defineTool({
  name: 'whoAmI',
  title: 'Who am I',
  description: 'Returns the IMS identity (client id, user id, token type and expiry) of the caller. Requires authentication.',
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: false },
  authenticated: true,
  handler: ({ auth }) => {
    if (!auth || !auth.token) {
      return textResult('This tool requires an authenticated caller.', true)
    }
    let claims
    try {
      claims = getTokenData(auth.token)
    } catch (e) {
      return textResult('Unable to read the caller identity from the access token.', true)
    }
    const createdAt = Number(claims.created_at)
    const expiresIn = Number(claims.expires_in)
    const identity = {
      clientId: claims.client_id || auth.clientId,
      userId: claims.user_id,
      tokenType: claims.type,
      expiresAt: createdAt && expiresIn ? new Date(createdAt + expiresIn).toISOString() : undefined
    }
    // never echo the token itself back to the client
    return textResult(JSON.stringify(identity))
  }
})

<% } -%>
const TOOLS = [currentDate<% if (examples) { %>, whoAmI<% } %>]

/**
 * @param {string} name the tool name.
 *
 * @returns {object|undefined} the normalized tool definition.
 */
function findTool (name) {
  return TOOLS.find(t => t.name === name)
}

/**
 * Registers tools on an MCP SDK server.
 *
 * @param {object} server the `McpServer` instance.
 * @param {object} [options] options.
 * @param {object} [options.logger] the action logger, passed to tool handlers.
 * @param {Array<object>} [options.tools] the tool definitions, defaults to the example tools.
 */
function registerTools (server, { logger, tools = TOOLS } = {}) {
  for (const tool of tools) {
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      _meta: { authenticated: tool.authenticated }
    }, async (args, extra) => {
      const toolCtx = { args, logger }
      // auth context is only handed to tools that declare `authenticated: true`
      if (tool.authenticated) {
        toolCtx.auth = extra && extra.authInfo
      }
      return tool.handler(toolCtx)
    })
  }
}

module.exports = {
  defineTool,
  registerTools,
  findTool,
  textResult,
  TOOLS
}
