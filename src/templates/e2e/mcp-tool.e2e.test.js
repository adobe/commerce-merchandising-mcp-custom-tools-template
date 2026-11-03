/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

const actionUrl = process.env.MCP_ACTION_URL
if (!actionUrl) {
  throw new Error('Set MCP_ACTION_URL to the deployed mcp-tool web action URL before running e2e tests.')
}

test('health check is public', async () => {
  const response = await fetch(actionUrl)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ status: 'healthy' })
})

test('POST without an IMS token is rejected', async () => {
  const response = await fetch(actionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  })
  expect(response.status).toBe(401)
})
