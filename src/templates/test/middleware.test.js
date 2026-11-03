/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

jest.mock('@adobe/aio-lib-core-logging', () => jest.fn())

const Logger = require('@adobe/aio-lib-core-logging')
const mockLoggerInstance = { info: jest.fn(), debug: jest.fn(), error: jest.fn() }
Logger.mockReturnValue(mockLoggerInstance)

const { withMiddleware } = require('<%= actionsRelPath %>/middleware')

beforeEach(() => {
  Logger.mockClear()
  mockLoggerInstance.info.mockReset()
  mockLoggerInstance.debug.mockReset()
  mockLoggerInstance.error.mockReset()
})

describe('withMiddleware', () => {
  test('calls the handler when no middleware is given', async () => {
    const handler = jest.fn().mockResolvedValue({ statusCode: 200 })
    const main = withMiddleware(handler)
    await expect(main({ a: 1 })).resolves.toEqual({ statusCode: 200 })
    expect(handler).toHaveBeenCalledWith({ a: 1 }, expect.objectContaining({ logger: mockLoggerInstance }))
  })

  test('uses LOG_LEVEL param for the logger', async () => {
    const main = withMiddleware(async () => ({ statusCode: 200 }))
    await main({ LOG_LEVEL: 'fakeLevel' })
    expect(Logger).toHaveBeenCalledWith(expect.any(String), { level: 'fakeLevel' })
  })

  test('runs middlewares in order before the handler', async () => {
    const calls = []
    const first = jest.fn(async () => { calls.push('first') })
    const second = jest.fn(async () => { calls.push('second') })
    const handler = jest.fn(async () => { calls.push('handler'); return { statusCode: 200 } })

    await withMiddleware(handler, [first, second])({})
    expect(calls).toEqual(['first', 'second', 'handler'])
  })

  test('short-circuits when a middleware returns a response', async () => {
    const early = jest.fn(async () => ({ statusCode: 401 }))
    const never = jest.fn()
    const handler = jest.fn()

    await expect(withMiddleware(handler, [early, never])({})).resolves.toEqual({ statusCode: 401 })
    expect(never).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  test('continues when a middleware returns undefined or null', async () => {
    const handler = jest.fn(async () => ({ statusCode: 200 }))
    await expect(withMiddleware(handler, [async () => undefined, async () => null])({}))
      .resolves.toEqual({ statusCode: 200 })
    expect(handler).toHaveBeenCalled()
  })

  test('propagates the shared ctx from middleware to handler', async () => {
    const setAuth = async (params, ctx) => { ctx.auth = { clientId: 'client-a' } }
    const handler = jest.fn(async (params, ctx) => ({ statusCode: 200, body: ctx.auth.clientId }))
    await expect(withMiddleware(handler, [setAuth])({}))
      .resolves.toEqual({ statusCode: 200, body: 'client-a' })
  })

  test('returns a 500 and logs when a middleware throws', async () => {
    const fakeError = new Error('fake')
    const handler = jest.fn()
    const response = await withMiddleware(handler, [async () => { throw fakeError }])({})
    expect(response).toEqual({ error: { statusCode: 500, body: { error: 'server error' } } })
    expect(mockLoggerInstance.error).toHaveBeenCalledWith(fakeError)
    expect(handler).not.toHaveBeenCalled()
  })

  test('returns a 500 and logs when the handler throws', async () => {
    const fakeError = new Error('fake')
    const response = await withMiddleware(async () => { throw fakeError })({})
    expect(response).toEqual({ error: { statusCode: 500, body: { error: 'server error' } } })
    expect(mockLoggerInstance.error).toHaveBeenCalledWith(fakeError)
  })

  test('works when called without params', async () => {
    const handler = jest.fn(async () => ({ statusCode: 200 }))
    await expect(withMiddleware(handler)()).resolves.toEqual({ statusCode: 200 })
  })
})

describe('withMiddleware response headers', () => {
  const setHeaders = (params, ctx) => { ctx.responseHeaders = { 'X-Extra': '1', 'X-Both': 'ctx' } }

  test('adds ctx.responseHeaders to handler responses without overriding explicit headers', async () => {
    const main = withMiddleware(() => ({ statusCode: 200, headers: { 'X-Both': 'handler' }, body: '' }), [setHeaders])
    await expect(main({})).resolves.toEqual({ statusCode: 200, headers: { 'X-Extra': '1', 'X-Both': 'handler' }, body: '' })
  })

  test('adds ctx.responseHeaders to early error responses', async () => {
    const reject = () => ({ error: { statusCode: 401, body: { error: 'no' } } })
    const main = withMiddleware(jest.fn(), [setHeaders, reject])
    const response = await main({})
    expect(response.error.headers).toEqual({ 'X-Extra': '1', 'X-Both': 'ctx' })
  })

  test('adds ctx.responseHeaders to 500 responses', async () => {
    const main = withMiddleware(() => { throw new Error('boom') }, [setHeaders])
    const response = await main({})
    expect(response.error.statusCode).toEqual(500)
    expect(response.error.headers['X-Extra']).toEqual('1')
  })
})

describe('cors', () => {
  const { cors, DEFAULT_CORS_HEADERS } = require('<%= actionsRelPath %>/middleware/cors')

  test('answers preflight requests with 204', () => {
    const ctx = {}
    expect(cors()({ __ow_method: 'options' }, ctx)).toEqual({ statusCode: 204, body: '' })
    expect(ctx.responseHeaders).toEqual(DEFAULT_CORS_HEADERS)
  })

  test('sets CORS headers and continues for other methods', () => {
    const ctx = {}
    expect(cors({ 'Access-Control-Allow-Origin': 'https://example.com' })({ __ow_method: 'post' }, ctx)).toBeUndefined()
    expect(ctx.responseHeaders).toEqual({ 'Access-Control-Allow-Origin': 'https://example.com' })
  })

  test('continues when the request method is missing', () => {
    const ctx = { responseHeaders: { 'X-Existing': '1' } }
    expect(cors()({}, ctx)).toBeUndefined()
    expect(ctx.responseHeaders).toEqual({ 'X-Existing': '1', ...DEFAULT_CORS_HEADERS })
  })
})
