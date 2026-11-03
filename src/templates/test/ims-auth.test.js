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

const NOT_ALLOWED_REASON = 'Token is not valid, reason: IMS client is not authorized to call this endpoint. ' +
  'Please use a JWT from an IMS client on the allow list.'

const logger = { info: jest.fn(), debug: jest.fn(), error: jest.fn() }
const ctx = () => ({ logger })
const paramsWithToken = (token = 'fake-token', extra = {}) => ({
  __ow_headers: { authorization: `Bearer ${token}` },
  ...extra
})

let imsAuth, DEFAULT_ALLOW_LIST, DEFAULT_IMS_ENV

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockGetTokenData.mockReturnValue({ client_id: 'example-client-id' });
  ({ imsAuth, DEFAULT_ALLOW_LIST, DEFAULT_IMS_ENV } = require('<%= actionsRelPath %>/middleware/ims-auth'))
})

describe('imsAuth defaults', () => {
  test('the client id check is disabled by default', () => {
    expect(DEFAULT_ALLOW_LIST).toEqual([])
  })
  test('default IMS env is prod', () => {
    expect(DEFAULT_IMS_ENV).toEqual('prod')
  })
})

describe('imsAuth with the client id check disabled', () => {
  test('validates the token with an undefined allow list', async () => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: true })
    const context = ctx()
    const response = await imsAuth()(paramsWithToken('good-token'), context)
    expect(response).toBeUndefined()
    expect(mockValidateTokenAllowList).toHaveBeenCalledWith('good-token', undefined)
    expect(context.auth).toEqual({ token: 'good-token', clientId: 'example-client-id', scopes: [] })
  })

  test('accepts a token from any IMS client', async () => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: true })
    mockGetTokenData.mockReturnValue({ client_id: 'some-other-client' })
    const context = ctx()
    expect(await imsAuth()(paramsWithToken(), context)).toBeUndefined()
    expect(context.auth.clientId).toEqual('some-other-client')
  })

  test('still rejects an invalid token with 401', async () => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: false, reason: 'bad_signature' })
    const response = await imsAuth()(paramsWithToken(), ctx())
    expect(response.error.statusCode).toEqual(401)
  })

  test('an empty IMS_CLIENT_ALLOWLIST input keeps the check disabled', async () => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: true })
    await imsAuth()(paramsWithToken('fake-token', { IMS_CLIENT_ALLOWLIST: '  ' }), ctx())
    expect(mockValidateTokenAllowList).toHaveBeenCalledWith('fake-token', undefined)
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
    const response = await imsAuth({ allowList: ['client-a'] })(paramsWithToken(), ctx())
    expect(response).toEqual({
      error: { statusCode: 401, body: { error: 'unauthorized: invalid or expired token' } }
    })
  })

  test('returns 401 when validation returns nothing', async () => {
    mockValidateTokenAllowList.mockResolvedValue(undefined)
    const response = await imsAuth({ allowList: ['client-a'] })(paramsWithToken(), ctx())
    expect(response.error.statusCode).toEqual(401)
  })

  test('returns 403 when the IMS client is not on the allow list', async () => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: false, reason: NOT_ALLOWED_REASON })
    const response = await imsAuth({ allowList: ['client-a'] })(paramsWithToken(), ctx())
    expect(response).toEqual({
      error: { statusCode: 403, body: { error: 'forbidden: IMS client is not allowed to call this endpoint' } }
    })
  })

  test('returns 503 and logs when IMS cannot be reached', async () => {
    const fakeError = new Error('network down')
    mockValidateTokenAllowList.mockRejectedValue(fakeError)
    const response = await imsAuth({ allowList: ['client-a'] })(paramsWithToken(), ctx())
    expect(response).toEqual({
      error: { statusCode: 503, body: { error: 'token validation is temporarily unavailable' } }
    })
    expect(logger.error).toHaveBeenCalledWith(fakeError)
  })
})

describe('imsAuth with an allow list', () => {
  beforeEach(() => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: true })
  })

  test('continues the chain and sets ctx.auth', async () => {
    const context = ctx()
    const response = await imsAuth({ allowList: ['client-a'] })(paramsWithToken('good-token'), context)
    expect(response).toBeUndefined()
    expect(context.auth).toEqual({ token: 'good-token', clientId: 'example-client-id', scopes: [] })
  })

  test('uses the prod env by default', async () => {
    await imsAuth({ allowList: ['client-a'] })(paramsWithToken(), ctx())
    expect(mockImsConstructor).toHaveBeenCalledWith('prod', expect.any(Object))
  })

  test('IMS_CLIENT_ALLOWLIST input enables and sets the allow list', async () => {
    await imsAuth()(paramsWithToken('fake-token', { IMS_CLIENT_ALLOWLIST: ' client-a , client-b ,, ' }), ctx())
    expect(mockValidateTokenAllowList).toHaveBeenCalledWith('fake-token', ['client-a', 'client-b'])
  })

  test('an array IMS_CLIENT_ALLOWLIST input is supported', async () => {
    await imsAuth()(paramsWithToken('fake-token', { IMS_CLIENT_ALLOWLIST: ['client-a', 'client-b'] }), ctx())
    expect(mockValidateTokenAllowList).toHaveBeenCalledWith('fake-token', ['client-a', 'client-b'])
  })

  test('options override the built-in defaults', async () => {
    await imsAuth({ allowList: ['client-c'], env: 'stage' })(paramsWithToken(), ctx())
    expect(mockValidateTokenAllowList).toHaveBeenCalledWith('fake-token', ['client-c'])
    expect(mockImsConstructor).toHaveBeenCalledWith('stage', expect.any(Object))
  })

  test('IMS_ENV input overrides the env', async () => {
    await imsAuth()(paramsWithToken('fake-token', { IMS_ENV: 'stage' }), ctx())
    expect(mockImsConstructor).toHaveBeenCalledWith('stage', expect.any(Object))
  })

  test('creates the Ims instance and validation cache only once per env', async () => {
    const middleware = imsAuth({ allowList: ['client-a'] })
    await middleware(paramsWithToken(), ctx())
    await middleware(paramsWithToken(), ctx())
    expect(mockImsConstructor).toHaveBeenCalledTimes(1)
    expect(mockValidationCacheConstructor).toHaveBeenCalledTimes(1)
    expect(mockValidationCacheConstructor).toHaveBeenCalledWith(5 * 60 * 1000, 10000, 20000)
  })

  test('does not fail when the client id cannot be decoded', async () => {
    mockGetTokenData.mockImplementation(() => { throw new Error('not a jwt') })
    const context = ctx()
    const response = await imsAuth({ allowList: ['client-a'] })(paramsWithToken('opaque'), context)
    expect(response).toBeUndefined()
    expect(context.auth).toEqual({ token: 'opaque', clientId: undefined, scopes: [] })
  })
})

describe('imsAuth token claims', () => {
  test('exposes the scope claim as scopes', async () => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: true })
    mockGetTokenData.mockReturnValue({ client_id: 'example-client-id', scope: 'openid, AdobeID,,read_organizations' })
    const context = ctx()
    expect(await imsAuth()(paramsWithToken(), context)).toBeUndefined()
    expect(context.auth.scopes).toEqual(['openid', 'AdobeID', 'read_organizations'])
  })

  test('rejects a token that expired after it was validated (cached validation)', async () => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: true })
    mockGetTokenData.mockReturnValue({ client_id: 'example-client-id', created_at: String(Date.now() - 60000), expires_in: '30000' })
    const context = ctx()
    const response = await imsAuth()(paramsWithToken(), context)
    expect(response.error).toEqual({ statusCode: 401, body: { error: 'unauthorized: invalid or expired token' } })
    expect(context.auth).toBeUndefined()
  })

  test('accepts a token that has not expired yet', async () => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: true })
    mockGetTokenData.mockReturnValue({ client_id: 'example-client-id', created_at: String(Date.now()), expires_in: '86400000' })
    const context = ctx()
    expect(await imsAuth()(paramsWithToken(), context)).toBeUndefined()
    expect(context.auth.clientId).toEqual('example-client-id')
  })

  test('tolerates a token decoded to null', async () => {
    mockValidateTokenAllowList.mockResolvedValue({ valid: true })
    mockGetTokenData.mockReturnValue(null)
    const context = ctx()
    expect(await imsAuth()(paramsWithToken(), context)).toBeUndefined()
    expect(context.auth).toEqual({ token: 'fake-token', clientId: undefined, scopes: [] })
  })
})
