/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

const mockValidateTokenAllowList = jest.fn()
const mockGetTokenData = jest.fn()
const mockImsConstructor = jest.fn()
const mockValidationCacheConstructor = jest.fn()

jest.mock('@adobe/aio-lib-ims', () => ({
  Ims: jest.fn().mockImplementation((...args) => {
    mockImsConstructor(...args)
    return { validateTokenAllowList: mockValidateTokenAllowList }
  }),
  ValidationCache: jest.fn().mockImplementation((...args) => {
    mockValidationCacheConstructor(...args)
    return {}
  }),
  getTokenData: (...args) => mockGetTokenData(...args)
}))

const logger = { info: jest.fn(), debug: jest.fn(), error: jest.fn() }
const ctx = () => ({ logger })
const paramsWithToken = (token = 'fake-token', extra = {}) => ({
  __ow_headers: { authorization: `Bearer ${token}` },
  ...extra
})

const CLIENT = 'commerce-catalog-storefront-mcp-service'
const NAMESPACE = 'my-ns'
const AUD = `https://${NAMESPACE}.adobeioruntime.net/api/v1/web/pkg/mcp-tool`
const claims = (extra = {}) => ({ client_id: CLIENT, aud: AUD, ...extra })
const ORIGINAL_NAMESPACE = process.env.__OW_NAMESPACE

let imsAuth

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  process.env.__OW_NAMESPACE = NAMESPACE
  mockGetTokenData.mockReturnValue(claims());
  ({ imsAuth } = require('<%= actionsRelPath %>/middleware/ims-auth'))
})

afterAll(() => {
  if (ORIGINAL_NAMESPACE === undefined) {
    delete process.env.__OW_NAMESPACE
  } else {
    process.env.__OW_NAMESPACE = ORIGINAL_NAMESPACE
  }
})

describe('imsAuth token validation', () => {
  test('validates the token with an undefined allow list', async () => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: true })
    const context = ctx()
    const response = await imsAuth()(paramsWithToken('good-token'), context)
    expect(response).toBeUndefined()
    expect(mockValidateTokenAllowList).toHaveBeenCalledWith('good-token', undefined)
    expect(context.auth).toEqual({ token: 'good-token', clientId: CLIENT, scopes: [], audience: AUD })
  })

  test('rejects a token from another IMS client with 403, even when bound to this runtime', async () => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: true })
    mockGetTokenData.mockReturnValue(claims({ client_id: 'some-other-client' }))
    const context = ctx()
    const response = await imsAuth()(paramsWithToken(), context)
    expect(response).toEqual({
      error: { statusCode: 403, body: { error: 'forbidden: token was issued to a client that is not allowed' } }
    })
    expect(context.auth).toBeUndefined()
  })

  test('an IMS_CLIENT_ALLOWLIST input cannot allow another client', async () => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: true })
    mockGetTokenData.mockReturnValue(claims({ client_id: 'client-a' }))
    const response = await imsAuth()(paramsWithToken('fake-token', { IMS_CLIENT_ALLOWLIST: 'client-a' }), ctx())
    expect(response.error.statusCode).toEqual(403)
  })

  test('still rejects an invalid token with 401', async () => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: false, reason: 'bad_signature' })
    const response = await imsAuth()(paramsWithToken(), ctx())
    expect(response.error.statusCode).toEqual(401)
  })
})

describe('imsAuth rejections', () => {
  test('returns 401 when the Authorization header is missing', async () => {
    const response = await imsAuth()({}, ctx())
    expect(response).toEqual({
      error: { statusCode: 401, body: { error: 'unauthorized: missing Authorization Bearer token' } }
    })
    expect(mockValidateTokenAllowList).not.toHaveBeenCalled()
  })

  test('returns 401 when the Authorization header is not a Bearer token', async () => {
    const response = await imsAuth()({ __ow_headers: { authorization: 'Basic abc' } }, ctx())
    expect(response.error.statusCode).toEqual(401)
    expect(mockValidateTokenAllowList).not.toHaveBeenCalled()
  })

  test('returns 401 when the token is invalid', async () => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: false, reason: 'Token is expired' })
    const response = await imsAuth()(paramsWithToken(), ctx())
    expect(response).toEqual({
      error: { statusCode: 401, body: { error: 'unauthorized: invalid or expired token' } }
    })
  })

  test('returns 401 when validation returns nothing', async () => {
    mockValidateTokenAllowList.mockResolvedValue(undefined)
    const response = await imsAuth()(paramsWithToken(), ctx())
    expect(response.error.statusCode).toEqual(401)
  })

  test('returns 503 and logs when IMS cannot be reached', async () => {
    const fakeError = new Error('network down')
    mockValidateTokenAllowList.mockRejectedValue(fakeError)
    const response = await imsAuth()(paramsWithToken(), ctx())
    expect(response).toEqual({
      error: { statusCode: 503, body: { error: 'token validation is temporarily unavailable' } }
    })
    expect(logger.error).toHaveBeenCalledWith(fakeError)
  })
})

describe('imsAuth with a valid token', () => {
  beforeEach(() => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: true })
  })

  test('continues the chain and sets ctx.auth', async () => {
    const context = ctx()
    const response = await imsAuth()(paramsWithToken('good-token'), context)
    expect(response).toBeUndefined()
    expect(context.auth).toEqual({ token: 'good-token', clientId: CLIENT, scopes: [], audience: AUD })
  })

  test('validates against prod IMS', async () => {
    await imsAuth()(paramsWithToken(), ctx())
    expect(mockImsConstructor).toHaveBeenCalledWith('prod', expect.any(Object))
  })

  test('creates the Ims instance and validation cache only once', async () => {
    const middleware = imsAuth()
    await middleware(paramsWithToken(), ctx())
    await middleware(paramsWithToken(), ctx())
    expect(mockImsConstructor).toHaveBeenCalledTimes(1)
    expect(mockValidationCacheConstructor).toHaveBeenCalledTimes(1)
    expect(mockValidationCacheConstructor).toHaveBeenCalledWith(5 * 60 * 1000, 10000, 20000)
  })

  test('rejects with 403 when the client id cannot be decoded', async () => {
    mockGetTokenData.mockImplementation(() => { throw new Error('not a jwt') })
    const context = ctx()
    const response = await imsAuth()(paramsWithToken('opaque'), context)
    expect(response.error.statusCode).toEqual(403)
    expect(context.auth).toBeUndefined()
  })
})

describe('imsAuth token claims', () => {
  test('exposes the scope claim as scopes', async () => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: true })
    mockGetTokenData.mockReturnValue(claims({ scope: 'openid, AdobeID,,read_organizations' }))
    const context = ctx()
    expect(await imsAuth()(paramsWithToken(), context)).toBeUndefined()
    expect(context.auth.scopes).toEqual(['openid', 'AdobeID', 'read_organizations'])
  })

  test('rejects a token that expired after it was validated (cached validation)', async () => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: true })
    mockGetTokenData.mockReturnValue(claims({ created_at: String(Date.now() - 60000), expires_in: '30000' }))
    const context = ctx()
    const response = await imsAuth()(paramsWithToken(), context)
    expect(response.error).toEqual({ statusCode: 401, body: { error: 'unauthorized: invalid or expired token' } })
    expect(context.auth).toBeUndefined()
  })

  test('accepts a token that has not expired yet', async () => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: true })
    mockGetTokenData.mockReturnValue(claims({ created_at: String(Date.now()), expires_in: '86400000' }))
    const context = ctx()
    expect(await imsAuth()(paramsWithToken(), context)).toBeUndefined()
    expect(context.auth.clientId).toEqual(CLIENT)
  })

  test('rejects a token decoded to null with 403', async () => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: true })
    mockGetTokenData.mockReturnValue(null)
    const response = await imsAuth()(paramsWithToken(), ctx())
    expect(response.error.statusCode).toEqual(403)
  })
})

describe('imsAuth audience binding', () => {
  beforeEach(() => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: true })
  })

  const accepts = async (aud) => {
    mockGetTokenData.mockReturnValue(claims({ aud }))
    const context = ctx()
    const response = await imsAuth()(paramsWithToken(), context)
    return { response, context }
  }

  test.each([
    `https://${NAMESPACE}.adobeioruntime.net/api/v1/web/pkg/mcp-tool`,
    `https://MY-NS.adobeioruntime.net/api/v1/web/pkg/mcp-tool/extra`,
    `https://runtime.adobe.io/api/v1/web/${NAMESPACE}/pkg/mcp-tool`,
    `https://adobeioruntime.net/api/v1/web/${NAMESPACE}/pkg/mcp-tool`
  ])('accepts an audience of this runtime: %s', async (aud) => {
    const { response, context } = await accepts(aud)
    expect(response).toBeUndefined()
    expect(context.auth.audience).toEqual(aud)
  })

  test('accepts an array aud when one value matches', async () => {
    const aud = ['https://other.example.com', `https://runtime.adobe.io/api/v1/web/${NAMESPACE}/pkg/mcp-tool`]
    const { response, context } = await accepts(aud)
    expect(response).toBeUndefined()
    expect(context.auth.audience).toEqual(aud[1])
  })

  test.each([
    ['missing', undefined],
    ['another namespace (host)', 'https://other-ns.adobeioruntime.net/api/v1/web/pkg/mcp-tool'],
    ['another namespace (path)', 'https://runtime.adobe.io/api/v1/web/other-ns/pkg/mcp-tool'],
    ['a nested subdomain', `https://x.${NAMESPACE}.adobeioruntime.net/api/v1/web/pkg/mcp-tool`],
    ['a path host without the web path', `https://runtime.adobe.io/${NAMESPACE}/pkg/mcp-tool`],
    ['plain http', `http://${NAMESPACE}.adobeioruntime.net/api/v1/web/pkg/mcp-tool`],
    ['userinfo', `https://u:p@${NAMESPACE}.adobeioruntime.net/api/v1/web/pkg/mcp-tool`],
    ['a non-default port', `https://${NAMESPACE}.adobeioruntime.net:8443/api/v1/web/pkg/mcp-tool`],
    ['another host', `https://${NAMESPACE}.example.com/api/v1/web/${NAMESPACE}/pkg`],
    ['the bare namespace', NAMESPACE],
    ['a non-string', 42],
    ['an array without a match', ['https://other-ns.adobeioruntime.net/x']]
  ])('rejects an audience that is %s with 401', async (_, aud) => {
    const { response, context } = await accepts(aud)
    expect(response).toEqual({
      error: { statusCode: 401, body: { error: 'unauthorized: token audience does not match this runtime' } }
    })
    expect(context.auth).toBeUndefined()
  })

  test('returns 500 when __OW_NAMESPACE is not set', async () => {
    delete process.env.__OW_NAMESPACE
    const response = await imsAuth()(paramsWithToken(), ctx())
    expect(response).toEqual({
      error: { statusCode: 500, body: { error: 'server misconfiguration: runtime namespace is not available' } }
    })
  })
})
