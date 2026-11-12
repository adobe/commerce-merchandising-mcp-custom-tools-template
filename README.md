# Commerce Merchandising MCP Custom Tools Template

An Adobe App Builder / Yeoman generator for an **IMS-authenticated Model Context Protocol server**
on Adobe I/O Runtime. The generated action uses the official MCP SDK, stateless Streamable HTTP
with JSON responses, and per-tool authentication metadata.

This repository is the **generator**, not a directly deployable App Builder application.

## Generate an app

Requires Node.js 22 or later and the [Adobe I/O CLI](https://developer.adobe.com/app-builder/docs/guides/getting_started/).
Once this package is published:

```sh
mkdir my-commerce-tools
cd my-commerce-tools
aio app init --template @adobe/generator-app-commerce-merchandising-mcp-custom-tools
npm install
cp .env.example .env
aio app use
npm test
aio app build
aio app deploy
```

Explicit `--template` installation does not require registry discovery. To appear in the interactive
template catalog, submit the published package separately to the
[App Builder Template Registry](https://github.com/adobe/aio-template-submission).

For standalone generation without `aio app init`, install the package and Yeoman, then run:

```sh
npm install -g yo @adobe/generator-app-commerce-merchandising-mcp-custom-tools
yo @adobe/app-commerce-merchandising-mcp-custom-tools --skip-prompt \
  --project-name my-commerce-tools
```

Before publication, contributors can use `npm link` from this repository and run that same Yeoman command.

## Generator options

Interactive prompts use these same defaults. `--skip-prompt` uses supplied CLI options without prompting.

| Prompt | CLI option | Default |
| --- | --- | --- |
| Project / MCP server name | `--project-name` | `commerce-merchandising-mcp` |
| Include the `whoAmI` example tool | `--examples` / `--no-examples` | `true` |

Project names must be 1-64 lowercase letters, digits or hyphens, starting with a letter or digit.
`currentDate` is always included. Tokens are always validated against production IMS.

When composed into an existing App Builder project, the generator merges dependencies and adds
`mcp-tool` to its first runtime package, preserving other actions and configuration. Its `test` and
`e2e` scripts replace existing ones, since they depend on the jest configuration it writes. An existing
`mcp-tool` action is rejected rather than replaced. App Builder's `action-folder`, `config-path`
and `full-key-to-manifest` options are supported.

## Generated application

```text
actions/mcp-tool/       MCP HTTP action, tool definitions, server
actions/middleware/     CORS, IMS authentication, middleware chain
actions/utils.js       Shared action utilities
test/                  Action and middleware unit tests
e2e/                   Deployed-endpoint smoke tests
app.config.yaml        Runtime web action configuration (nodejs:22, raw-http)
.env.example           Environment variable names and selected IMS defaults; no credentials
README.md              Deployment, runtime-bound token and custom-tool guide
```

Run `npm test` and `npm run lint` inside the generated app. For deployed smoke tests, set
`MCP_ACTION_URL` to the action URL and run `npm run e2e`. Runtime credentials belong only in
untracked `.env` / `.aio` configuration.

### Authentication contract

Every `POST` (including initialization and listing tools) requires `Authorization: Bearer <IMS token>`.
`GET` health checks and `OPTIONS` preflights are public. Token validation uses `@adobe/aio-lib-ims`;
tokens must be issued by production IMS (any IMS client is accepted) and must be bound to the
action's runtime: one `aud` claim value must be an `https` I/O Runtime URL of the action's namespace
(`__OW_NAMESPACE`), otherwise `401`. Storefront MCP requests its token with `resource=<runtime URL>`,
which IMS returns as `aud`, so a token sent to one runtime cannot be replayed against another
(other callers must do the same).
Validation is cached for up to five minutes; expired tokens are always rejected. Organization, user and scope checks are left to
individual tools (`auth.scopes` carries the token's `scope` claim).

Tools declare `authenticated: true | false`, defaulting to `false`. The SDK publishes this as
**`_meta.authenticated`**, always present in `tools/list`. Only tools with `authenticated: true`
receive `auth` in their handler: `{ token, clientId, scopes, shopperToken }`. `token` is the
validated IMS token of the caller (Storefront MCP). `shopperToken` is the shopper's bearer token,
which Storefront MCP forwards in `X-Tool-Authorization` only to authenticated tools. It is passed
through **unvalidated**; the backend that receives it must verify it.
`authenticated: false` does **not** make the HTTP endpoint public.

Add tools to the `TOOLS` array in `actions/mcp-tool/tools.js` using `defineTool()` with a Zod
`inputSchema` and a `handler({ args, auth, logger })`. The generated README contains a complete example.

### Runtime-bound tokens (customer guide)

Any IMS client can call a deployed action with a token bound to its Runtime URL; a user token from
`aio login`, Cursor or Claude Desktop has no matching `aud` and is rejected. Storefront MCP requests its IMS token with
`resource=<registered runtime URL>`, IMS returns that URL as the token's `aud`, and the action
compares the URL's namespace with `__OW_NAMESPACE`.

Customers do not configure anything: `__OW_NAMESPACE` is set by Adobe I/O Runtime. They must:

1. Generate (or upgrade to) the app with this generator version and redeploy with `aio app deploy`.
2. Register the action's Runtime URL exactly as `aio app get-url` prints it,
   `https://<namespace>.adobeioruntime.net/api/v1/web/<runtime-package>/mcp-tool` or
   `https://runtime.adobe.io/api/v1/web/<namespace>/<runtime-package>/mcp-tool`, where `<namespace>` is
   the namespace the action is deployed to. Custom domains or gateways in front of the action are not
   supported.

The generated README ("Runtime-bound tokens: what you need to do") lists the error responses and fixes.

## Development

```sh
npm ci
npm test            # lint + generator tests with coverage + template validation
npm run lint:fix    # auto-fix lint findings
npm run audit       # production dependency audit gate
npm pack --dry-run
```

- **Lint**: ESLint (`eslint:recommended`, `no-eval`/`no-implied-eval`/`no-new-func`, jest rules for
  tests) over the generator, tests, scripts and the non-EJS template files. Generated apps ship their
  own `.eslintrc.js` (unless the app already has an ESLint config) and are linted by the generator tests.
- **Coverage**: `jest.config.js` enforces 100% statements, branches, functions and lines for the
  generator (`src/index.js`) and `scripts/`. The generator tests also generate a full and a minimal
  app and run their test suites with coverage thresholds (99% statements/lines, 95% branches/functions
  over `actions/**`). Reports are written to `coverage/` (`text` + `lcov`).
- **CI**: [`node.js.yml`](.github/workflows/node.js.yml) runs `npm test` on Node 20/22/24 on Linux and
  Windows through Adobe's reusable workflow and uploads coverage to Codecov (`CODECOV_TOKEN`).
  [`security.yml`](.github/workflows/security.yml) runs the audit gate and checks the published file list
  on every PR, on `main` and weekly; [`codeql.yml`](.github/workflows/codeql.yml) runs CodeQL; Dependabot
  updates npm dependencies (generator and generated-app templates) and GitHub Actions. Actions are pinned
  by commit SHA. Generated apps are tested with this repository's `node_modules`, so a generator test
  fails unless the installed `devDependencies` satisfy the ranges in `src/templates/package.json`; bump
  both together.

CI runs without IMS or Runtime credentials.

### Dependency audit

The CommonJS App Builder generator ecosystem (`yeoman-generator@5`, required by
`@adobe/generator-app-common-lib@3`) brings transitive npm audit advisories. They only run on the
developer machine while the project is generated and are never deployed. `npm run audit`
([`scripts/audit-gate.js`](scripts/audit-gate.js)) fails on any production advisory unless it is listed in
[`audit-allowlist.json`](audit-allowlist.json) **and** every dependency path to the vulnerable package goes
through an accepted chain, so new advisories or new paths fail CI. See [SECURITY.md](SECURITY.md). The
generated Runtime app has a separate, smaller dependency set and does not include Yeoman or the template
validator.

## Publishing

Releases follow the Adobe App Builder template flow used by
[`generator-app-remote-mcp-server-generic`](https://github.com/adobe/generator-app-remote-mcp-server-generic):
[`on-push-publish-to-npm.yml`](.github/workflows/on-push-publish-to-npm.yml) publishes to npm when a commit
whose message starts with `Release ` changes `package.json` on `main`.

```sh
git checkout -b release-0.1.1
npm version patch --no-git-tag-version
npm test
npm pack --dry-run
git commit -am "Release 0.1.1"
# open a pull request and merge it to main without changing the commit message
```

The reusable publish workflow runs `npm install` and `npm test`, then publishes with the
`ADOBE_BOT_NPM_TOKEN` secret. It only publishes from repositories owned by the **`adobe`** GitHub
organization, so the repository must be transferred/mirrored there (with the secret configured) before
the first release. For the first `0.1.0` release, skip `npm version` and use the commit message `Release 0.1.0`.

Review the tarball listing before releasing: only `src/`, `install.yml`, `package.json`, README and
LICENSE are shipped (enforced in CI by `security.yml`). Template action tests under `src/templates/test/`
are intentional; contributor tests, workflows, credentials and build output must not be included.
`prepublishOnly` also runs the complete test command.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Licensed under [Apache-2.0](LICENSE).
