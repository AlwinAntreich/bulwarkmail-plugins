# How the Papra plugin is built

What exists today and how the parts fit together. The plan, the scope and
the decisions with their reasons are in [PLAN.md](PLAN.md); this file
describes the implementation and changes with it.

## Status

| Part | State |
|---|---|
| Manifest, build, setup notes | done (step 2) |
| Papra in `test-env/` | done (step 3); not yet tried through a webmail's plugin proxy |
| Papra client, connection check | planned (step 4) |
| Save to Papra | planned (step 5) |
| From Papra | planned (step 6) |
| Settings section | planned (step 7) |

## Files

| File | What it is |
|---|---|
| `manifest.json` | id, permissions, the admin's settings (`configSchema`) and the user credential |
| `package.json`, `package-lock.json` | the build (esbuild into `dist/index.js`) and the test script; esbuild is the only package |
| `src/index.js` | the entry point; `activate` does nothing yet |
| `README.md` | setup for admins and users |
| `CHANGELOG.md` | written by `npm run changelog` at release time |
| `docs/` | the plan and this file |

## Server and API key

```
admin dashboard                      user
  serverUrl ──────────┐                API key (Bulwark's connect dialog)
  (configSchema)      │                    │
                      ▼                    ▼
plugin ── api.config.get() ──► base URL   credential "papra" (user scope,
   │                                       bearer, stored on Bulwark's server)
   └── api.proxy.fetch("papra", <serverUrl>/api/...) ──► Bulwark proxy
                                           adds "Authorization: Bearer <key>"
                                           only if the URL's origin is the
                                           credential's origin ──► Papra
```

- **The server** is the admin's `serverUrl`, a required `configSchema`
  field. The plugin reads it with `api.config.get()`, which needs no
  permission. Without it the plugin will show "not set up".
- **The API key** is the user-scope credential `papra`, sent as a bearer
  token. The key stays on Bulwark's server; the plugin never sees it, and it
  is never in settings, `api.storage` or logs.
- **No fixed `origin`** in the credential: that would tie the plugin to one
  server. Bulwark has no way yet to take a user credential's origin from the
  admin's setting, so the plugin keeps users on the admin's server itself
  (step 4): it connects with the admin's URL suggested, only requests that
  URL, and treats a credential for another origin as not connected. This
  catches mistakes; it is not a security boundary. PLAN.md says why and
  what Bulwark change would make it one.

## Permissions

| Permission | Since | Why |
|---|---|---|
| `http:proxy` | step 2 | requests to Papra through Bulwark's proxy with the user's key |

Each step adds the permissions its code uses. The ones the plan expects:
`email:read` and `email:blob-read` (Save to Papra), `ui:composer-toolbar`
and `email:blob-write` (From Papra), `ui:observe` (dialogs),
`ui:settings-section` (settings).

## Build and tests

- `npm run build` in `papra/` bundles `src/index.js` into `dist/index.js`
  with React and `@plugin-host` left to the host, as the extension
  directory builds it. `node scripts/build.mjs papra` at the root writes
  `papra.zip`; only `npm run release` commits it.
- The test Papra runs in `test-env/` (`http://localhost:18012`, see
  `test-env/README.md`); its API keys are in `test-env/.secrets/papra.json`.
- Unit tests go to `test/*.test.mjs` (Vitest, `fakeApi`), end-to-end tests
  to `e2e/*.spec.mjs`. There are none yet; the hooks pass with
  `--passWithNoTests`.
