/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

jest.mock('@adobe/aio-lib-core-logging', () => jest.fn())

// the IMS auth middleware is covered by test/ims-auth.test.js; here it is controlled
// so we can exercise both the authorized and the rejected paths of the action.
const mockAuthMiddleware = jest.fn()
jest.mock('<%= actionsRelPath %>/middleware/ims-auth', () => ({
  imsAuth: () => (params, ctx) => mockAuthMiddleware(params, ctx)
}))

const Logger = require('@adobe/aio-lib-core-logging')
const mockLoggerInstance = { info: jest.fn(), debug: jest.fn(), error: jest.fn() }
Logger.mockReturnValue(mockLoggerInstance)

const action = require('<%= actionsRelPath %>/mcp-tool/index.js')
<% if (examples) { -%>
const tools = require('<%= actionsRelPath %>/mcp-tool/tools')
<% } -%>

const FAKE_AUTH = { token: 'fake-token', clientId: 'example-client-id' }
const authHeaders = { authorization: 'Bearer fake-token' }
const rpc = (msg, extra = {}) => ({
  __ow_method: 'post',
  __ow_headers: authHeaders,
  __ow_body: JSON.stringify(msg),
  ...extra
})
const call = (id, name, args) => rpc({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
const bodyOf = (response) => JSON.parse(response.body)

beforeEach(() => {
  Logger.mockClear()
  mockLoggerInstance.info.mockReset()
  mockLoggerInstance.debug.mockReset()
  mockLoggerInstance.error.mockReset()
  mockAuthMiddleware.mockReset()
  // authorized by default
  mockAuthMiddleware.mockImplementation((params, ctx) => { ctx.auth = { ...FAKE_AUTH } })
})

describe('mcp-tool auth', () => {
  test('main should be defined', () => {
    expect(action.main).toBeInstanceOf(Function)
  })

  test('should set logger to use LOG_LEVEL param', async () => {
    await action.main(rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { LOG_LEVEL: 'fakeLevel' }))
    expect(Logger).toHaveBeenCalledWith(expect.any(String), { level: 'fakeLevel' })
  })

  test('the auth middleware runs on every POST', async () => {
    await action.main(rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }))
    expect(mockAuthMiddleware).toHaveBeenCalledTimes(1)
  })

  test('an unauthorized request is rejected before reaching the SDK, with CORS headers', async () => {
    const unauthorized = { error: { statusCode: 401, body: { error: 'unauthorized' } } }
    mockAuthMiddleware.mockReturnValue(unauthorized)
    const response = await action.main({ __ow_method: 'post', __ow_body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
    expect(response.error.statusCode).toEqual(401)
    expect(response.error.headers['Access-Control-Allow-Origin']).toEqual('*')
  })

  test('a forbidden client is rejected', async () => {
    mockAuthMiddleware.mockReturnValue({ error: { statusCode: 403, body: { error: 'forbidden' } } })
    const response = await action.main(call(1, 'currentDate'))
    expect(response.error.statusCode).toEqual(403)
  })

  test('notifications are validated too', async () => {
    mockAuthMiddleware.mockReturnValue({ error: { statusCode: 401, body: { error: 'unauthorized' } } })
    const response = await action.main({ __ow_method: 'post', __ow_body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
    expect(response.error.statusCode).toEqual(401)
  })

  test('OPTIONS and GET do not require auth', async () => {
    await action.main({ __ow_method: 'options' })
    await action.main({ __ow_method: 'get' })
    expect(mockAuthMiddleware).not.toHaveBeenCalled()
  })
})

describe('mcp-tool http routing', () => {
  test('OPTIONS answers the CORS preflight', async () => {
    const response = await action.main({ __ow_method: 'options' })
    expect(response.statusCode).toEqual(204)
    expect(response.headers['Access-Control-Allow-Headers']).toContain('Authorization')
  })

  test('GET returns a health check', async () => {
    const response = await action.main({ __ow_method: 'get' })
    expect(response.statusCode).toEqual(200)
    expect(bodyOf(response)).toEqual({ status: 'healthy', server: '<%= projectName %>', version: '0.1.0', transport: 'streamable-http' })
  })

  test('GET for an SSE stream is not supported', async () => {
    const response = await action.main({ __ow_method: 'get', __ow_headers: { Accept: 'text/event-stream' } })
    expect(response.statusCode).toEqual(405)
    expect(response.headers.Allow).toEqual('POST')
  })

  test('DELETE returns 200', async () => {
    const response = await action.main({ __ow_method: 'delete', __ow_headers: authHeaders })
    expect(response.statusCode).toEqual(200)
  })

  test('other methods return 405', async () => {
    const response = await action.main({ __ow_method: 'put', __ow_headers: authHeaders })
    expect(response.statusCode).toEqual(405)
  })

  test('a malformed body returns a parse error', async () => {
    const response = await action.main({ __ow_method: 'post', __ow_headers: authHeaders, __ow_body: 'not json' })
    expect(response.statusCode).toEqual(400)
    expect(bodyOf(response).error.code).toEqual(-32700)
  })

  test('a missing body returns an invalid request error', async () => {
    const response = await action.main({ __ow_method: 'post', __ow_headers: authHeaders })
    expect(bodyOf(response).error.code).toEqual(-32600)
  })

  test.each(['null', '42', '"ping"'])('a non-object JSON body (%s) returns an invalid request error', async (rawBody) => {
    const response = await action.main({ __ow_method: 'post', __ow_headers: authHeaders, __ow_body: rawBody })
    expect(response.statusCode).toEqual(400)
    expect(bodyOf(response).error.code).toEqual(-32600)
  })

  test('an already parsed body object is accepted', async () => {
    const response = await action.main({ __ow_method: 'post', __ow_headers: authHeaders, __ow_body: { jsonrpc: '2.0', id: 7, method: 'ping' } })
    expect(bodyOf(response)).toEqual({ jsonrpc: '2.0', id: 7, result: {} })
  })

  test('client-controlled values are escaped and truncated in logs', async () => {
    await action.main(rpc({ jsonrpc: '2.0', id: 'x'.repeat(500), method: 'ping\nINFO forged entry' }))
    const line = mockLoggerInstance.info.mock.calls.map(([message]) => message).find(message => message.startsWith('MCP request:'))
    expect(line).not.toContain('\n')
    expect(line).toContain('method="ping\\nINFO forged entry"')
    expect(line.length).toBeLessThan(250)
  })

  test('a request without __ow_method is handled as POST', async () => {
    const params = rpc({ jsonrpc: '2.0', id: 10, method: 'ping' })
    delete params.__ow_method
    const response = await action.main(params)
    expect(mockAuthMiddleware).toHaveBeenCalled()
    expect(bodyOf(response)).toEqual({ jsonrpc: '2.0', id: 10, result: {} })
  })

  test('a batch body is logged by size and handled by the SDK', async () => {
    const response = await action.main(rpc([{ jsonrpc: '2.0', id: 11, method: 'ping' }, { jsonrpc: '2.0', id: 12, method: 'ping' }]))
    expect(mockLoggerInstance.info).toHaveBeenCalledWith('MCP request: batch of 2')
    expect(response.statusCode).toBeGreaterThanOrEqual(200)
  })

  test('non string request headers are not forwarded to the SDK', async () => {
    const response = await action.main(rpc({ jsonrpc: '2.0', id: 13, method: 'ping' }, {
      __ow_headers: { ...authHeaders, 'X-Multi': ['a', 'b'] }
    }))
    expect(bodyOf(response)).toEqual({ jsonrpc: '2.0', id: 13, result: {} })
  })

  test('requests are handled when the auth middleware sets no auth context', async () => {
    mockAuthMiddleware.mockImplementation(() => undefined)
    const response = await action.main(rpc({ jsonrpc: '2.0', id: 14, method: 'ping' }))
    expect(bodyOf(response)).toEqual({ jsonrpc: '2.0', id: 14, result: {} })
  })

  test('a base64 encoded body is decoded', async () => {
    const response = await action.main({
      __ow_method: 'post',
      __ow_headers: authHeaders,
      __ow_body: Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'ping' })).toString('base64')
    })
    expect(bodyOf(response)).toEqual({ jsonrpc: '2.0', id: 8, result: {} })
  })

  test('a JSON body merged into params (non raw web action) is supported', async () => {
    const response = await action.main({ __ow_method: 'post', __ow_headers: authHeaders, jsonrpc: '2.0', id: 9, method: 'ping' })
    expect(bodyOf(response)).toEqual({ jsonrpc: '2.0', id: 9, result: {} })
  })

  test('SDK responses carry CORS headers', async () => {
    const response = await action.main(rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }))
    expect(response.headers['Access-Control-Allow-Origin']).toEqual('*')
    expect(response.headers['content-type']).toContain('application/json')
  })
})

describe('mcp-tool protocol (MCP SDK)', () => {
  test('initialize returns the server info and capabilities', async () => {
    const response = await action.main(rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
    }))
    expect(response.statusCode).toEqual(200)
    const { result } = bodyOf(response)
    expect(result.serverInfo).toEqual({ name: '<%= projectName %>', version: '0.1.0' })
    expect(result.protocolVersion).toEqual('2025-06-18')
    expect(Object.keys(result.capabilities)).toEqual(expect.arrayContaining(['tools']))
  })

  test('ping returns an empty result', async () => {
    const response = await action.main(rpc({ jsonrpc: '2.0', id: 2, method: 'ping' }))
    expect(bodyOf(response)).toEqual({ jsonrpc: '2.0', id: 2, result: {} })
  })

  test('an authorized notification is acknowledged with 202', async () => {
    const response = await action.main(rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }))
    expect(response.statusCode).toEqual(202)
  })

  test('tools/list returns the example tools', async () => {
    const response = await action.main(rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }))
    expect(bodyOf(response).result.tools.map(t => t.name)).toEqual(['currentDate'<% if (examples) { %>, 'whoAmI'<% } %>])
  })

  test('tools/list includes _meta.authenticated for flagged and unflagged tools', async () => {
    const response = await action.main(rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }))
    const listed = bodyOf(response).result.tools
    expect(listed.find(t => t.name === 'currentDate')._meta).toEqual({ authenticated: false })
<% if (examples) { -%>
    expect(listed.find(t => t.name === 'whoAmI')._meta).toEqual({ authenticated: true })
<% } -%>
  })

  test('tools/list publishes the zod input schema as JSON Schema', async () => {
    const response = await action.main(rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }))
    const currentDate = bodyOf(response).result.tools.find(t => t.name === 'currentDate')
    expect(currentDate.inputSchema.type).toEqual('object')
    expect(currentDate.inputSchema.properties.timezone.type).toEqual('string')
  })

  test('tools/call runs currentDate', async () => {
    const { result } = bodyOf(await action.main(call(4, 'currentDate')))
    expect(result.content[0].type).toEqual('text')
    expect(result.content[0].text).toContain('UTC')
  })

  test('tools/call honours the timezone argument', async () => {
    const { result } = bodyOf(await action.main(call(5, 'currentDate', { timezone: 'Europe/Bucharest' })))
    expect(result.content[0].text).toContain('Europe/Bucharest')
  })

  test('tools/call falls back to UTC for an unknown timezone', async () => {
    const { result } = bodyOf(await action.main(call(5, 'currentDate', { timezone: 'Mars/Olympus_Mons' })))
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('UTC; unknown timezone "Mars/Olympus_Mons"')
  })

  test('tools/call with an invalid argument type is rejected by the SDK', async () => {
    const { result } = bodyOf(await action.main(call(5, 'currentDate', { timezone: 42 })))
    expect(result.isError).toBe(true)
  })

  test('tools/call with an unknown tool returns an error', async () => {
    const body = bodyOf(await action.main(call(6, 'nope')))
    const failed = body.error !== undefined || (body.result && body.result.isError === true)
    expect(failed).toBe(true)
  })

  test('an unknown method returns -32601', async () => {
    const response = await action.main(rpc({ jsonrpc: '2.0', id: 7, method: 'unknown/method' }))
    expect(bodyOf(response).error.code).toEqual(-32601)
  })
})

<% if (examples) { -%>
describe('mcp-tool authenticated tools', () => {
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const fakeJwt = (claims) => `${b64url({ alg: 'RS256' })}.${b64url(claims)}.sig`

  test('whoAmI returns the caller identity from the forwarded auth context', async () => {
    const token = fakeJwt({ client_id: 'my-client', user_id: 'user@AdobeID', type: 'access_token', created_at: '1700000000000', expires_in: '86400000' })
    mockAuthMiddleware.mockImplementation((params, ctx) => { ctx.auth = { token, clientId: 'my-client' } })
    const { result } = bodyOf(await action.main(call(9, 'whoAmI')))
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0].text)).toEqual({
      clientId: 'my-client',
      userId: 'user@AdobeID',
      tokenType: 'access_token',
      expiresAt: new Date(1700000000000 + 86400000).toISOString()
    })
    expect(result.content[0].text).not.toContain(token)
  })

  test('whoAmI reports an error when no auth context is available', async () => {
    mockAuthMiddleware.mockImplementation(() => undefined)
    const { result } = bodyOf(await action.main(call(10, 'whoAmI')))
    expect(result.isError).toBe(true)
  })

  test('whoAmI reports an error for an unreadable token', async () => {
    const { result } = bodyOf(await action.main(call(11, 'whoAmI')))
    expect(result.isError).toBe(true)
  })

  test('auth context is only passed to authenticated tools', async () => {
    const dateSpy = jest.spyOn(tools.findTool('currentDate'), 'handler')
    const whoSpy = jest.spyOn(tools.findTool('whoAmI'), 'handler')
    await action.main(call(12, 'currentDate'))
    await action.main(call(13, 'whoAmI'))
    expect(dateSpy.mock.calls[0][0]).not.toHaveProperty('auth')
    expect(whoSpy.mock.calls[0][0].auth).toEqual(expect.objectContaining({ ...FAKE_AUTH, scopes: [] }))
    mockAuthMiddleware.mockImplementation((params, ctx) => { ctx.auth = { ...FAKE_AUTH, scopes: ['openid'] } })
    await action.main(call(13, 'whoAmI'))
    expect(whoSpy.mock.calls[1][0].auth.scopes).toEqual(['openid'])
    dateSpy.mockRestore()
    whoSpy.mockRestore()
  })

  test('a throwing tool handler returns an error result', async () => {
    const spy = jest.spyOn(tools.findTool('currentDate'), 'handler').mockImplementation(() => { throw new Error('boom') })
    const { result } = bodyOf(await action.main(call(14, 'currentDate')))
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('boom')
    spy.mockRestore()
  })
})
<% } -%>
