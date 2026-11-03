/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

/**
 * Resources exposed by the MCP server: read-only content (docs, reference data, config) that
 * clients can load into the model context.
 */

const CUSTOM_TOOLS_GUIDE = `# Custom tools

Tools are declared in \`actions/mcp-tool/tools.js\` with \`defineTool()\`.

Set \`authenticated: true\` on a tool that needs the caller's identity. The flag is published in
\`tools/list\` as \`_meta.authenticated\` and defaults to \`false\` when omitted. Only authenticated tools
receive the caller's auth context (\`auth.token\`, \`auth.clientId\`) in their handler.
`

/**
 * Registers resources on an MCP SDK server.
 *
 * @param {object} server the `McpServer` instance.
 */
function registerResources (server) {
  server.registerResource(
    'custom-tools-guide',
    'docs://custom-tools',
    {
      title: 'Custom tools guide',
      description: 'How to declare custom tools, including the authenticated flag',
      mimeType: 'text/markdown'
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: CUSTOM_TOOLS_GUIDE }]
    })
  )
}

module.exports = { registerResources }
