/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

/**
 * Prompts exposed by the MCP server: reusable, parameterized message templates.
 */

const { z } = require('zod')

/**
 * Registers prompts on an MCP SDK server.
 *
 * @param {object} server the `McpServer` instance.
 */
function registerPrompts (server) {
  server.registerPrompt(
    'time-in',
    {
      title: 'Time in a city',
      description: 'Asks for the current time in a city using the currentDate tool',
      argsSchema: {
        city: z.string().describe('City name, e.g. "Bucharest"')
      }
    },
    ({ city }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `What time is it now in ${city}? Use the currentDate tool with the IANA timezone of ${city}.`
        }
      }]
    })
  )
}

module.exports = { registerPrompts }
