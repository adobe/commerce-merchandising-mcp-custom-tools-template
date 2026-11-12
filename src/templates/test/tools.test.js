/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

const { defineTool, registerTools, findTool, textResult, TOOLS } = require('<%= actionsRelPath %>/mcp-tool/tools')

const handler = () => ({ content: [] })

describe('defineTool', () => {
  test('defaults authenticated to false when omitted', () => {
    expect(defineTool({ name: 'a', handler }).authenticated).toBe(false)
  })

  test('keeps an explicit authenticated flag', () => {
    expect(defineTool({ name: 'a', handler, authenticated: true }).authenticated).toBe(true)
    expect(defineTool({ name: 'a', handler, authenticated: false }).authenticated).toBe(false)
  })

  test('defaults inputSchema to an empty shape', () => {
    expect(defineTool({ name: 'a', handler }).inputSchema).toEqual({})
  })

  test('rejects a non boolean authenticated flag', () => {
    expect(() => defineTool({ name: 'a', handler, authenticated: 'yes' })).toThrow('"authenticated" must be a boolean')
  })

  test('requires a name and a handler', () => {
    expect(() => defineTool({ handler })).toThrow('non-empty "name"')
    expect(() => defineTool({ name: 'a' })).toThrow('"handler" function')
  })
})

describe('registerTools', () => {
  test('publishes the authenticated flag in _meta, defaulting to false', () => {
    const server = { registerTool: jest.fn() }
    registerTools(server, { tools: [defineTool({ name: 'open', handler }), defineTool({ name: 'secured', handler, authenticated: true })] })
    expect(server.registerTool.mock.calls.map(([name, config]) => [name, config._meta])).toEqual([
      ['open', { authenticated: false }],
      ['secured', { authenticated: true }]
    ])
  })

  test('only authenticated tools receive authInfo', async () => {
    const server = { registerTool: jest.fn() }
    const openHandler = jest.fn(handler)
    const securedHandler = jest.fn(handler)
    registerTools(server, { tools: [defineTool({ name: 'open', handler: openHandler }), defineTool({ name: 'secured', handler: securedHandler, authenticated: true })] })
    const authInfo = { token: 't', clientId: 'c', scopes: [], extra: { shopperToken: 's' } }
    await server.registerTool.mock.calls[0][2]({ x: 1 }, { authInfo })
    await server.registerTool.mock.calls[1][2]({}, { authInfo })
    expect(openHandler).toHaveBeenCalledWith({ args: { x: 1 }, logger: undefined })
    expect(securedHandler).toHaveBeenCalledWith({ args: {}, logger: undefined, auth: { token: 't', clientId: 'c', scopes: [], shopperToken: 's' } })
  })

  test('authenticated tools get no auth when the request has no authInfo', async () => {
    const server = { registerTool: jest.fn() }
    const securedHandler = jest.fn(handler)
    registerTools(server, { tools: [defineTool({ name: 'secured', handler: securedHandler, authenticated: true })] })
    await server.registerTool.mock.calls[0][2]({}, {})
    expect(securedHandler).toHaveBeenCalledWith({ args: {}, logger: undefined })
  })
})

describe('example tools', () => {
  test('every example tool declares the authenticated flag explicitly', () => {
    TOOLS.forEach(t => expect(typeof t.authenticated).toBe('boolean'))
    expect(TOOLS.map(t => [t.name, t.authenticated])).toEqual([['currentDate', false]<% if (examples) { %>, ['whoAmI', true]<% } %>])
  })
})

describe('helpers', () => {
  test('findTool returns a tool definition by name', () => {
    expect(findTool('currentDate')).toBe(TOOLS[0])
    expect(findTool('nope')).toBeUndefined()
  })

  test('textResult builds a text result, optionally flagged as an error', () => {
    expect(textResult('ok')).toEqual({ content: [{ type: 'text', text: 'ok' }] })
    expect(textResult('failed', true)).toEqual({ content: [{ type: 'text', text: 'failed' }], isError: true })
  })
})

describe('createMcpServer', () => {
  test('can be created without options', () => {
    const { createMcpServer } = require('<%= actionsRelPath %>/mcp-tool/server')
    expect(typeof createMcpServer().connect).toBe('function')
  })
})
