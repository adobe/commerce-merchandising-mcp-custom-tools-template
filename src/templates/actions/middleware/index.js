/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

/**
 * Minimal middleware chain for Adobe I/O Runtime actions.
 *
 * A middleware is `(params, ctx) => undefined | response`:
 *   - returning `undefined` continues to the next middleware (and finally the handler)
 *   - returning a response object short-circuits the chain
 *
 * `ctx` is a shared per-request object. It always carries a `logger`, and
 * middlewares may attach anything else the handler needs downstream
 * (e.g. `ctx.auth` set by the IMS auth middleware). Headers set on
 * `ctx.responseHeaders` (e.g. by the CORS middleware) are added to every response,
 * including early responses and errors; headers set explicitly by a response win.
 */

const Logger = require('@adobe/aio-lib-core-logging')
const { errorResponse } = require('../utils')

/**
 * Adds `extraHeaders` to an action response, without overriding headers it already sets.
 * Supports both `{ statusCode, headers, body }` and `{ error: { statusCode, headers, body } }`.
 *
 * @param {object} response the action response.
 * @param {object} [extraHeaders] headers to add.
 *
 * @returns {object} the response.
 * @private
 */
function withHeaders (response, extraHeaders) {
  if (!extraHeaders || !response || typeof response !== 'object') {
    return response
  }
  const target = response.error && typeof response.error === 'object' ? response.error : response
  target.headers = { ...extraHeaders, ...(target.headers || {}) }
  return response
}

/**
 * Wraps an action handler with a list of middlewares.
 *
 * @param {Function} handler the action handler, `(params, ctx) => response`.
 * @param {Array<Function>} [middlewares] middlewares executed in order before the handler.
 *
 * @returns {Function} the wrapped action main function.
 */
function withMiddleware (handler, middlewares = []) {
  return async function main (params = {}) {
    const logger = Logger('main', { level: params.LOG_LEVEL || 'info' })
    const ctx = { logger }

    try {
      for (const middleware of middlewares) {
        const earlyResponse = await middleware(params, ctx)
        if (earlyResponse !== undefined && earlyResponse !== null) {
          return withHeaders(earlyResponse, ctx.responseHeaders)
        }
      }
      return withHeaders(await handler(params, ctx), ctx.responseHeaders)
    } catch (e) {
      logger.error(e)
      return withHeaders(errorResponse(500, 'server error', logger), ctx.responseHeaders)
    }
  }
}

module.exports = { withMiddleware }
