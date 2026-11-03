/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

/**
 * CORS middleware: answers preflight (OPTIONS) requests and attaches CORS headers to every
 * response through `ctx.responseHeaders` (merged by `withMiddleware`). It must run before the
 * auth middleware, since browsers send preflight requests without credentials.
 */

const DEFAULT_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, mcp-session-id, mcp-protocol-version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Content-Type, mcp-session-id, mcp-protocol-version',
  'Access-Control-Max-Age': '86400'
}

/**
 * Creates the CORS middleware.
 *
 * @param {object} [headers] CORS headers, defaults to `DEFAULT_CORS_HEADERS`.
 *
 * @returns {Function} the middleware function.
 */
function cors (headers = DEFAULT_CORS_HEADERS) {
  return function corsMiddleware (params, ctx) {
    ctx.responseHeaders = { ...(ctx.responseHeaders || {}), ...headers }
    if ((params.__ow_method || '').toLowerCase() === 'options') {
      return { statusCode: 204, body: '' }
    }
  }
}

module.exports = { cors, DEFAULT_CORS_HEADERS }
