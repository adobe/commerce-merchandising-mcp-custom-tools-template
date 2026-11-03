# <%= projectName %>

Remote **Model Context Protocol (MCP) server** running as an Adobe I/O Runtime web action, built on
the official [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) and
modelled on
[`generator-app-remote-mcp-server-generic`](https://github.com/adobe/generator-app-remote-mcp-server-generic)
template, with IMS token validation through a middleware chain and per-tool `authenticated` flags.

## Setup

- Use Node.js 22 or later.
- Run `npm install`, copy `.env.example` to `.env`, then configure Runtime with `aio app use`.
- The generated defaults are IMS **<%= imsEnv %>** and client allowlist
  **<%= allowlist.length ? allowlist.join(', ') : 'empty (any valid IMS token)' %>**.

## Local Dev

- `aio app run` to start your local Dev server
- App will run on `localhost:9080` by default

By default the UI will be served locally but actions will be deployed and served from Adobe I/O Runtime. To run your actions locally use the `aio app dev` option.

For more information on the difference between `aio app run` and `aio app dev`, see [here](https://developer.adobe.com/app-builder/docs/guides/development/#aio-app-dev-vs-aio-app-run)

## Test & Coverage

- Run `npm test` for action and middleware unit tests. Coverage of `actions/` is collected
  automatically and written to `coverage/` (text summary and `lcov` report).
- Run `npm run lint` for lint checks.
- Set `MCP_ACTION_URL` to the deployed web action URL and run `npm run e2e` for smoke tests
  (coverage is not collected for e2e runs).

## Deploy & Cleanup

- `aio app deploy` to build and deploy all actions on Runtime and static files to CDN
- `aio app undeploy` to undeploy the app

## MCP server

The `mcp-tool` action (`actions/mcp-tool/`) uses `McpServer` with the
`WebStandardStreamableHTTPServerTransport` (Streamable HTTP). It is **stateless**: a new server and
transport are created for each request, and responses are always JSON (no SSE stream, no sessions).

| File | Responsibility |
| --- | --- |
| `index.js` | HTTP routing, I/O Runtime ⇄ Web `Request`/`Response` conversion, middleware chain |
| `server.js` | `createMcpServer()`, which registers tools, resources and prompts |
| `tools.js` | Tool definitions (`defineTool()`) and `registerTools()` |
<% if (examples) { -%>
| `resources.js` | Example resource `docs://custom-tools` |
| `prompts.js` | Example prompt `time-in` |
<% } -%>

| HTTP method | Behaviour | Auth |
| --- | --- | --- |
| `POST` | MCP JSON-RPC message or batch, handled by the SDK | IMS token required |
| `GET` | Health check (`{ "status": "healthy", ... }`); with `Accept: text/event-stream`, returns `405` (no SSE stream) | none |
| `OPTIONS` | CORS preflight (`204`) | none |
| `DELETE` | `200` (no session to terminate) | IMS token required |

The action is deployed with `raw-http: true`, so the request body reaches the transport untouched.

### Client configuration

URL: `https://<namespace>.adobeioruntime.net/api/v1/web/<%= runtimePackageName %>/mcp-tool`

Cursor:

```json
{
  "mcpServers": {
    "<%= runtimePackageName %>": {
      "url": "https://<namespace>.adobeioruntime.net/api/v1/web/<%= runtimePackageName %>/mcp-tool",
      "type": "streamable-http",
      "headers": { "Authorization": "Bearer <IMS access token>" }
    }
  }
}
```

Claude Desktop (through `mcp-remote`):

```json
{
  "mcpServers": {
    "<%= runtimePackageName %>": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<namespace>.adobeioruntime.net/api/v1/web/<%= runtimePackageName %>/mcp-tool",
        "--header",
        "Authorization:${IMS_TOKEN}"
      ],
      "env": { "IMS_TOKEN": "Bearer <IMS access token>" }
    }
  }
}
```

## Authentication

The `mcp-tool` action is a public web action that performs its own IMS token validation through a
middleware chain (`actions/middleware/`). Every MCP request (`POST`), including `initialize`,
`ping`, `tools/list`, `tools/call` and notifications, must send:

```
Authorization: Bearer <IMS access token>
```

The `GET` health check and `OPTIONS` preflight are answered before authentication.

The token is validated against IMS with
[`@adobe/aio-lib-ims`](https://github.com/adobe/aio-lib-ims) using
`validateTokenAllowList(token, allowList)`, so the token must also be issued to an IMS client on the
allow list when one is configured.

Restricting the caller to specific IMS clients is optional. The generator configured the default
allowlist in `actions/mcp-tool/index.js` as `<%= JSON.stringify(allowlist) %>`. A nonempty
`IMS_CLIENT_ALLOWLIST` input overrides it with comma-separated IMS **client ids**, not integration
labels. An empty input retains the generated default; edit `allowList` to `[]` to remove that default.

Validation results are cached in memory (`ValidationCache`, 5 minute TTL) to reduce IMS round-trips,
so a revoked token may remain accepted until the cache entry expires. Tokens whose `created_at` +
`expires_in` claims show they have expired are always rejected, even when a cached validation exists.

### What the token check does and does not scope

| Checked | How |
| --- | --- |
| Token is a genuine, unexpired IMS access token for the configured IMS environment | IMS `validate_token` + `created_at`/`expires_in` claims |
| Token was issued to one of your IMS clients (only when the allowlist is set) | `client_id` claim against `IMS_CLIENT_ALLOWLIST` |

| **Not** checked | Recommendation |
| --- | --- |
| Which IMS client issued the token, when the allowlist is empty | **Set `IMS_CLIENT_ALLOWLIST` for production.** With an empty allowlist, a token from *any* IMS client is accepted, i.e. anyone with an Adobe account can call every tool, including `authenticated: false` tools and tools that use the action's own credentials. |
| IMS organization, user or group | Enforce in the tool (e.g. call IMS or your backend with `auth.token`) before returning org data. |
| OAuth scopes | `auth.scopes` holds the token's `scope` claim; check the scopes a tool needs in its handler. |

Tools that forward `auth.token` to Adobe APIs are still authorized by those APIs as the caller.
Never log or return the token.

### Responses

| Status | Meaning |
| --- | --- |
| `401` | Missing or malformed `Authorization: Bearer` header, or an invalid/expired token |
| `403` | Valid token, but the issuing IMS client is not on the allow list (only when `IMS_CLIENT_ALLOWLIST` is set) |
| `503` | IMS could not be reached to validate the token |
| `500` | Unexpected server error |

All responses, including errors, carry CORS headers.

### Middleware layout

The `mcp-tool` chain is `[cors(), publicRoutes(), imsAuth()]`.

| File | Responsibility |
| --- | --- |
| `actions/middleware/index.js` | `withMiddleware(handler, middlewares)`: runs middlewares in order, short-circuits on the first returned response, shares a per-request `ctx`, adds `ctx.responseHeaders` to every response, and converts unexpected throws into a `500` |
| `actions/middleware/cors.js` | `cors(headers)`: answers `OPTIONS` preflight and sets CORS headers |
| `actions/middleware/ims-auth.js` | `imsAuth(options)`: token extraction, IMS validation, optional allow list enforcement, expired-token rejection, sets `ctx.auth = { token, clientId, scopes }` |

To protect another action, wrap its handler the same way:

```js
const { withMiddleware } = require('../middleware')
const { cors } = require('../middleware/cors')
const { imsAuth } = require('../middleware/ims-auth')

async function handler (params, ctx) { /* ... */ }

exports.main = withMiddleware(handler, [cors(), imsAuth()])
```

## Custom tools

Tools are defined in `actions/mcp-tool/tools.js` with `defineTool()` and registered on the SDK
server with `server.registerTool()`:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | Tool name used by `tools/call` |
| `title`, `description` | string | no | Shown to the model/client |
| `inputSchema` | zod raw shape | no, default `{}` | Arguments; validated by the SDK and published as JSON Schema |
| `annotations` | object | no | Standard MCP tool annotations (e.g. `readOnlyHint`) |
| `authenticated` | boolean | no, default `false` | Marks the tool as requiring the caller's identity/auth context |
| `handler` | function | yes | `({ args, auth, logger }) => CallToolResult` |

### The `authenticated` flag

- `authenticated` is an additive field on the tool definition, next to `inputSchema`. In `tools/list`
  it is published as **`_meta.authenticated`**. `_meta` is the field MCP reserves for custom data, so
  the request/response format is unchanged and SDK clients (e.g. `client.listTools()`) keep the value.
  An unknown top-level field would be stripped by SDK clients.
- Tools that omit it are treated as **unauthenticated** (`false`): no auth context or header is
  forwarded to them. Any value other than a boolean is rejected when the definition is loaded.
- `_meta.authenticated` is **always** present in `tools/list` (`true` or `false`), so `mcp-registry`
  can persist it during onboarding and the MCP server can forward the auth header only to tools
  that need it.
- Inside this action, the caller's auth (`{ token, clientId, scopes }`, from the `imsAuth`
  middleware, passed to the SDK as `authInfo`) is handed to the handler as `auth` **only** for tools
  with `authenticated: true`.

Example tools (both declare the flag explicitly):

| Tool | `authenticated` | Description |
| --- | --- | --- |
| `currentDate` | `false` | Current date/time, optionally for an IANA timezone |
<% if (examples) { -%>
| `whoAmI` | `true` | Returns the caller's IMS client id, user id, token type and expiry (never the token itself) |
<% } -%>

Adding an authenticated tool:

```js
const myTool = defineTool({
  name: 'myTool',
  description: 'Calls a downstream API on behalf of the caller.',
  inputSchema: { sku: z.string().describe('Product SKU') },
  authenticated: true,
  handler: async ({ args, auth }) => {
    // auth.token is the caller's IMS access token
    return { content: [{ type: 'text', text: `ok ${args.sku}` }] }
  }
})
```

Then add it to the `TOOLS` array. `tools/list` returns:

```json
{
  "name": "myTool",
  "description": "...",
  "inputSchema": { "type": "object", "properties": { "sku": { "type": "string", "description": "Product SKU" } }, "required": ["sku"] },
  "_meta": { "authenticated": true }
}
```

## Resources and prompts

<% if (examples) { -%>
- `actions/mcp-tool/resources.js`: register resources with `server.registerResource()` (example:
  `docs://custom-tools`, a markdown guide to custom tools).
- `actions/mcp-tool/prompts.js`: register prompts with `server.registerPrompt()` and a zod `argsSchema`
  (example: `time-in`, which asks for the time in a city using `currentDate`).
<% } else { -%>
Examples were disabled. To add resources or prompts, create a module and register it in `server.js`
with `server.registerResource()` or `server.registerPrompt()`.
<% } -%>

## Config

### `.env`

You can generate this file using the command `aio app use`. 

```bash
# This file must **not** be committed to source control

## please provide your Adobe I/O Runtime credentials
# AIO_RUNTIME_AUTH=
# AIO_RUNTIME_NAMESPACE=

## IMS token validation (mcp-tool action)
# Comma separated list of IMS client ids allowed to call the action.
# Empty retains the allowList default in actions/mcp-tool/index.js.
# An empty default accepts any valid IMS token.
IMS_CLIENT_ALLOWLIST=<%= allowlist.join(',') %>
# IMS environment used to validate tokens: prod or stage
IMS_ENV=<%= imsEnv %>
```

Both variables are wired into the action `inputs` in `app.config.yaml`. If they are absent, the
action falls back to the defaults above.

`IMS_ENV` **must match the environment that issued the token**. Validating a production token
against stage IMS makes IMS answer `HTTP 200 {"valid": false, "reason": "bad_signature"}`, which the
middleware reports as a `401`. The IMS reason is logged at `info` level, so
`aio rt activation logs <id>` will show the underlying cause.

### `app.config.yaml`

- Main configuration file that defines an application's implementation. 
- More information on this file, application configuration, and extension configuration 
  can be found [here](https://developer.adobe.com/app-builder/docs/guides/configuration/#appconfigyaml)

#### Action Dependencies

- You have two options to resolve your actions' dependencies:

  1. **Packaged action file**: Add your action's dependencies to the root
   `package.json` and install them using `npm install`. Then set the `function`
   field in `app.config.yaml` to point to the **entry file** of your action
   folder. We will use `webpack` to package your code and dependencies into a
   single minified js file. The action will then be deployed as a single file.
   Use this method if you want to reduce the size of your actions.

  2. **Zipped action folder**: In the folder containing the action code add a
     `package.json` with the action's dependencies. Then set the `function`
     field in `app.config.yaml` to point to the **folder** of that action. We will
     install the required dependencies within that directory and zip the folder
     before deploying it as a zipped action. Use this method if you want to keep
     your action's dependencies separated.

## Debugging in VS Code

While running your local server (`aio app dev`), both UI and actions can be debugged. To do so follow the instructions [here](https://developer.adobe.com/app-builder/docs/guides/development/#debugging)
