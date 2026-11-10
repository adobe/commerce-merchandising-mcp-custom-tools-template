/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

/**
 * IMS token validation middleware.
 *
 * Every request must carry an `Authorization: Bearer <IMS token>` header. The token is
 * validated against production IMS.
 *
 * Restricting which IMS client may call the action is optional: when `IMS_CLIENT_ALLOWLIST`
 * resolves to an empty list the client id check is disabled and any client presenting a valid
 * IMS token is accepted. Set it to a comma separated list of IMS client ids for production.
 *
 * On success `ctx.auth = { token, clientId, scopes }` (from the token's claims). Organization,
 * user and scope checks are left to the tools that need them.
 *
 * Responses on failure:
 *   401 - missing / malformed / invalid or expired token
 *   403 - valid token, but the IMS client is not on the allow list (only when the list is set)
 *   503 - IMS could not be reached
 */

const { Ims, ValidationCache, getTokenData } = require('@adobe/aio-lib-ims')
const { getBearerToken, errorResponse } = require('../utils')

// Empty = client id check disabled. To restrict, list IMS client ids (the API key IMS puts in the
// token's `client_id` claim), e.g. ['my-integration-client-id'].
const DEFAULT_ALLOW_LIST = []
// Storefront MCP calls custom tools with production IMS tokens only.
const IMS_ENV = 'prod'

const CACHE_MAX_AGE_MS = 5 * 60 * 1000
const VALID_CACHE_ENTRIES = 10000
const INVALID_CACHE_ENTRIES = 20000

// The IMS client is cached per container so warm invocations reuse the validation cache.
let imsClient

/**
 * Returns the memoized production Ims instance (with validation cache).
 *
 * @returns {object} the Ims instance.
 * @private
 */
function getIms () {
  if (!imsClient) {
    const cache = new ValidationCache(CACHE_MAX_AGE_MS, VALID_CACHE_ENTRIES, INVALID_CACHE_ENTRIES)
    imsClient = new Ims(IMS_ENV, cache)
  }
  return imsClient
}

/**
 * Parses a comma separated allow list.
 *
 * @param {string|Array<string>} value the raw allow list.
 *
 * @returns {Array<string>|undefined} the parsed allow list, or undefined when empty.
 * @private
 */
function parseAllowList (value) {
  if (Array.isArray(value)) {
    value = value.join(',')
  }
  if (typeof value !== 'string') {
    return undefined
  }
  const entries = value.split(',').map(e => e.trim()).filter(e => e.length > 0)
  return entries.length > 0 ? entries : undefined
}

/**
 * Decodes the token claims, without throwing on malformed tokens.
 *
 * @param {string} token the IMS access token.
 *
 * @returns {object} the claims, or an empty object if they could not be read.
 * @private
 */
function safeTokenData (token) {
  try {
    return getTokenData(token) || {}
  } catch (e) {
    return {}
  }
}

/**
 * Returns true when the token claims say it has expired. Validation results are cached, so this
 * stops a token that expires within the cache window from being accepted.
 *
 * @param {object} claims the token claims.
 *
 * @returns {boolean} whether the token is expired.
 * @private
 */
function isExpired (claims) {
  const createdAt = Number(claims.created_at)
  const expiresIn = Number(claims.expires_in)
  return Number.isFinite(createdAt) && Number.isFinite(expiresIn) && createdAt + expiresIn <= Date.now()
}

/**
 * Parses the comma separated `scope` claim of an IMS access token.
 *
 * @param {object} claims the token claims.
 *
 * @returns {Array<string>} the scopes.
 * @private
 */
function parseScopes (claims) {
  return typeof claims.scope === 'string' ? claims.scope.split(',').map(s => s.trim()).filter(Boolean) : []
}

/**
 * Creates the IMS auth middleware.
 *
 * @param {object} [options] middleware options.
 * @param {Array<string>} [options.allowList] default allow list, overridden by the
 *        `IMS_CLIENT_ALLOWLIST` action input.
 *
 * @returns {Function} the middleware function.
 */
function imsAuth (options = {}) {
  const defaultAllowList = options.allowList || DEFAULT_ALLOW_LIST

  return async function imsAuthMiddleware (params, ctx) {
    const logger = ctx.logger
    const token = getBearerToken(params)

    if (!token) {
      return errorResponse(401, 'unauthorized: missing Authorization Bearer token', logger)
    }

    const allowList = parseAllowList(params.IMS_CLIENT_ALLOWLIST) || defaultAllowList

    let validation
    try {
      // An undefined allow list makes validateTokenAllowList skip the client id check while still
      // validating the token. We avoid ims.validateToken() because it passes an unbound
      // this._validateToken to the validation cache and throws when a cache is configured.
      validation = await getIms().validateTokenAllowList(token, allowList.length > 0 ? allowList : undefined)
    } catch (e) {
      logger.error(e)
      return errorResponse(503, 'token validation is temporarily unavailable', logger)
    }

    if (!validation || !validation.valid) {
      const reason = (validation && validation.reason) || 'token is not valid'
      // aio-lib-ims reports allow list rejections with this reason; everything else is a bad token.
      const notAllowed = reason.includes('IMS client is not authorized to call this endpoint')
      // logged at info so the IMS reason (e.g. 'bad_signature' for a token issued by stage IMS)
      // is visible in activation logs.
      logger.info(`IMS rejected the token: ${reason}`)
      if (notAllowed) {
        return errorResponse(403, 'forbidden: IMS client is not allowed to call this endpoint', logger)
      }
      return errorResponse(401, 'unauthorized: invalid or expired token', logger)
    }

    const claims = safeTokenData(token)
    if (isExpired(claims)) {
      logger.info('IMS rejected the token: token expired')
      return errorResponse(401, 'unauthorized: invalid or expired token', logger)
    }

    ctx.auth = { token, clientId: claims.client_id, scopes: parseScopes(claims) }
  }
}

module.exports = {
  imsAuth,
  DEFAULT_ALLOW_LIST,
  IMS_ENV
}
