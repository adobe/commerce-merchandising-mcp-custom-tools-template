# Security Policy

## Reporting a vulnerability

Please **do not** report security vulnerabilities through public GitHub issues, discussions or pull
requests. Report them privately to the Adobe Product Security Incident Response Team (PSIRT) at
[psirt@adobe.com](mailto:psirt@adobe.com) (see [Adobe's vulnerability reporting
guidelines](https://helpx.adobe.com/security/alertus.html)). Include the affected version, a description
of the issue, reproduction steps and its impact. Never include real access tokens or credentials.

## Supported versions

Only the latest published version of `@adobe/generator-app-commerce-merchandising-mcp-custom-tools`
receives security fixes. Applications that were already generated do not update automatically: compare
them with a newly generated app (or apply the fix from the release notes) and redeploy.

## Security model of the generated application

- Every MCP `POST` request requires an IMS bearer token, validated with `@adobe/aio-lib-ims` against the
  configured IMS environment. `GET` health checks and `OPTIONS` preflights are unauthenticated.
- `IMS_CLIENT_ALLOWLIST` restricts the IMS client that issued the token. **An empty allowlist accepts a
  valid token from any IMS client**, so anyone with an Adobe account can call the server; set it for
  production deployments.
- The middleware does not check IMS organization, user or OAuth scopes. Tools receive the token's
  `scope` claim as `auth.scopes` and must enforce their own scope/organization requirements.
- Successful validations are cached in the action container for up to five minutes, so a revoked token
  may be accepted until the cache entry expires. Tokens whose claims show they have expired are always
  rejected.
- Only tools declared with `authenticated: true` receive the caller's token in their handler. Do not log
  it, return it, or forward it to services that do not need it.
- CORS allows any origin (`*`); browsers still have to present a valid bearer token for `POST` requests.
- Client-controlled values (JSON-RPC `method`/`id`) are escaped and truncated before logging; malformed
  or non-object request bodies are rejected with JSON-RPC errors.
- Secrets belong in untracked `.env` / `.aio` files or action inputs, never in source control.

## Dependency audit

`npm run audit` ([`scripts/audit-gate.js`](scripts/audit-gate.js)) runs `npm audit --omit=dev` in CI on
every pull request, on `main` and weekly. It fails on any advisory that is not listed in
[`audit-allowlist.json`](audit-allowlist.json), and on listed advisories that become reachable through a
dependency path other than the accepted ones.

Accepted advisories, all in the **generator**, which only runs on the developer machine during
`aio app init` / `yo` and is never deployed to Adobe I/O Runtime:

| Package(s) | Severity | Reached through | Why accepted |
| --- | --- | --- | --- |
| `tar`, `pacote`, `sigstore`, `yeoman-environment`, `@tootallnate/once`, `glob`, `minimatch`, `@octokit/*` | up to critical | `yeoman-generator@5` (`pacote`, `yeoman-environment`, `github-username`, `shelljs`, `mem-fs-editor`) | `yeoman-generator@5` is required by `@adobe/generator-app-common-lib@3`, used by App Builder templates; fixes require the `yeoman-generator@7` / ESM migration. The generator writes files with `mem-fs-editor` and never installs, downloads or extracts packages through `pacote` / `yeoman-environment`. |
| `deepmerge` | low | `@adobe/aio-lib-core-config` | No fixed version available; merges trusted local aio configuration. |

The generated application's production dependencies (`@adobe/aio-lib-ims`, `@adobe/aio-lib-core-logging`,
`@modelcontextprotocol/sdk`, `zod`) are reviewed separately; at the time of writing their only advisory
is the same low-severity `deepmerge` finding via `@adobe/aio-lib-ims`. Run `npm audit --omit=dev` in your
generated app before each deployment.
