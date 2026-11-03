/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { registerTools } = require('./tools')
<% if (examples) { -%>
const { registerResources } = require('./resources')
const { registerPrompts } = require('./prompts')
<% } -%>

const SERVER_INFO = { name: '<%= projectName %>', version: '0.1.0' }

/**
 * Creates an MCP server with all tools, resources and prompts registered.
 * A fresh instance is created per request (stateless serverless pattern).
 *
 * @param {object} [options] options.
 * @param {object} [options.logger] the action logger.
 *
 * @returns {object} the `McpServer` instance.
 */
function createMcpServer ({ logger } = {}) {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {}<% if (examples) { %>, resources: {}, prompts: {}<% } %> }
  })
  registerTools(server, { logger })
<% if (examples) { -%>
  registerResources(server)
  registerPrompts(server)
<% } -%>
  return server
}

module.exports = { createMcpServer, SERVER_INFO }
