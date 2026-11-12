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
 * validated against production IMS (always; not configurable) and must be issued to the Storefront
 * MCP IMS client (`commerce-catalog-storefront-mcp-service`). The token must also be bound to
 * this runtime: one `aud` claim value must be an `https` I/O Runtime URL of this action's namespace
 * (`__OW_NAMESPACE`), i.e. `https://<namespace>.adobeioruntime.net/...` or
 * `https://runtime.adobe.io/api/v1/web/<namespace>/...` (also `adobeioruntime.net`). Callers request
 * their token with `resource=<runtime URL>`, which IMS returns as `aud`, so a token sent to one
 * runtime cannot be replayed against another. The namespace always comes from the runtime environment.
 *
 * On success `ctx.auth = { token, clientId, scopes, audience }` (from the token's claims).
 * Organization, user and scope checks are left to the tools that need them.
 *
 * Responses on failure:
 *   401 - missing / malformed / invalid or expired token, or an audience that is not this runtime
 *   403 - the token was issued to an IMS client other than Storefront MCP
 *   500 - the runtime namespace (`__OW_NAMESPACE`) is not available
 *   503 - IMS could not be reached
 */

const { Ims, ValidationCache, getTokenData } = require('@adobe/aio-lib-ims')
const { getBearerToken, errorResponse } = require('../utils')

// The only IMS client allowed to call the action: Storefront MCP (MCP server and MCP registry).
// Any IMS client can request a token for any audience, so this check keeps other clients out.
const ALLOWED_CLIENT_ID = 'commerce-catalog-storefront-mcp-service'

const RUNTIME_HOST_SUFFIX = '.adobeioruntime.net'
const RUNTIME_PATH_HOSTS = ['runtime.adobe.io', 'adobeioruntime.net']
const RUNTIME_WEB_PATH = '/api/v1/web/'

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
    // Storefront MCP calls custom tools with production IMS tokens only.
    imsClient = new Ims('prod', cache)
  }
  return imsClient
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
 * Returns the I/O Runtime namespace an audience URL addresses, or undefined when the value is not
 * an `https` URL of a Runtime web endpoint (other hosts, userinfo or a non-default port).
 *
 * @param {string} audience one `aud` claim value.
 *
 * @returns {string|undefined} the lowercased namespace.
 * @private
 */
function audienceNamespace (audience) {
  let url
  try {
    url = new URL(audience)
  } catch (e) {
    return undefined
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    return undefined
  }
  const host = url.hostname
  let namespace
  if (RUNTIME_PATH_HOSTS.includes(host)) {
    namespace = url.pathname.startsWith(RUNTIME_WEB_PATH) ? url.pathname.slice(RUNTIME_WEB_PATH.length).split('/')[0] : ''
  } else if (host.endsWith(RUNTIME_HOST_SUFFIX)) {
    namespace = host.slice(0, -RUNTIME_HOST_SUFFIX.length)
    namespace = namespace.includes('.') ? '' : namespace
  }
  return namespace ? namespace.toLowerCase() : undefined
}

/**
 * Returns the first `aud` claim value (string or array) that addresses the given runtime namespace.
 *
 * @param {object} claims the token claims.
 * @param {string} namespace the runtime namespace of this action.
 *
 * @returns {string|undefined} the matching audience.
 * @private
 */
function matchAudience (claims, namespace) {
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  const expected = namespace.toLowerCase()
  return audiences.find(aud => typeof aud === 'string' && audienceNamespace(aud) === expected)
}

/**
 * Creates the IMS auth middleware.
 *
 * @returns {Function} the middleware function.
 */
function imsAuth () {
  return async function imsAuthMiddleware (params, ctx) {
    const logger = ctx.logger
    const token = getBearerToken(params)

    if (!token) {
      return errorResponse(401, 'unauthorized: missing Authorization Bearer token', logger)
    }

    let validation
    try {
      // An undefined allow list makes validateTokenAllowList skip its client id check (checked below
      // from the claims, to return 403 rather than 401). We avoid ims.validateToken() because it passes an unbound
      // this._validateToken to the validation cache and throws when a cache is configured.
      validation = await getIms().validateTokenAllowList(token, undefined)
    } catch (e) {
      logger.error(e)
      return errorResponse(503, 'token validation is temporarily unavailable', logger)
    }

    if (!validation || !validation.valid) {
      const reason = (validation && validation.reason) || 'token is not valid'
      // logged at info so the IMS reason (e.g. 'bad_signature' for a token issued by stage IMS)
      // is visible in activation logs.
      logger.info(`IMS rejected the token: ${reason}`)
      return errorResponse(401, 'unauthorized: invalid or expired token', logger)
    }

    const claims = safeTokenData(token)
    if (isExpired(claims)) {
      logger.info('IMS rejected the token: token expired')
      return errorResponse(401, 'unauthorized: invalid or expired token', logger)
    }

    if (claims.client_id !== ALLOWED_CLIENT_ID) {
      logger.info(`IMS token rejected: client ${claims.client_id} is not allowed`)
      return errorResponse(403, 'forbidden: token was issued to a client that is not allowed', logger)
    }

    const namespace = process.env.__OW_NAMESPACE
    if (!namespace) {
      logger.error('__OW_NAMESPACE is not set; cannot check the token audience')
      return errorResponse(500, 'server misconfiguration: runtime namespace is not available', logger)
    }
    const audience = matchAudience(claims, namespace)
    if (!audience) {
      logger.info(`IMS token rejected: no aud claim addresses runtime namespace ${namespace}`)
      return errorResponse(401, 'unauthorized: token audience does not match this runtime', logger)
    }

    ctx.auth = { token, clientId: claims.client_id, scopes: parseScopes(claims), audience }
  }
}

module.exports = {
  imsAuth
}
