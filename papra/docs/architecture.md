# How the Papra plugin is built

What exists today and how the parts fit together. The plan, the scope and
the decisions with their reasons are in [PLAN.md](PLAN.md); this file
describes the implementation and changes with it.

## Status

| Part | State |
|---|---|
| Manifest, build, setup notes | done (step 2) |
| Papra in `test-env/` | done (step 3) |
| Papra client, connection check | done (step 4); no UI uses them yet |
| Save to Papra | planned (step 5) |
| From Papra | planned (step 6) |
| Settings section | planned (step 7) |

## Files

| File | What it is |
|---|---|
| `manifest.json` | id, permissions, the admin's settings (`configSchema`) and the user credential |
| `package.json`, `package-lock.json` | the build (esbuild into `dist/index.js`) and the test script; esbuild is the only package |
| `src/index.js` | the entry point; `activate` does nothing yet |
| `src/lib/client.js` | the Papra API client on top of `api.proxy.fetch` |
| `src/lib/connection.js` | the admin's server, the user's key, the server check and the key's permissions |
| `src/lib/errors.js` | Papra and proxy failures as message keys (`error.*`) |
| `src/lib/multipart.js` | the upload body (copied from `paperless/`) |
| `test/*.test.mjs` | unit tests for the three modules above |
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
  admin's setting, so the plugin keeps users on the admin's server itself:
  it connects with the admin's URL suggested, only requests that URL, and
  treats a credential for another origin as not connected and drops it
  (`connection.js`). This catches mistakes; it is not a security boundary.
  PLAN.md says why and what Bulwark change would make it one.

## Connection states

`resolveConnection(api)` in `connection.js`:

| State | When | What the UI will offer |
|---|---|---|
| `not_configured` | the admin set no `serverUrl` | nothing; "ask your administrator" |
| `disconnected` | no key, or a key for another origin (`wrongServer`, then dropped) | "Connect Papra" |
| `connected` | a key for the admin's server | the features; `clientFor()` gives the client |

`connect(api)` opens Bulwark's dialog with the admin's server suggested, then
checks the key with `GET /api/api-keys/current` (needs no permission):

- connected to another origin: dropped, `error.wrong_server_connect`
- refused by Papra (401): dropped, `error.key`
- lacks `organizations:read`, `documents:read` or `documents:create`:
  dropped, `error.key_permissions` naming the missing ones
- lacks `tags:read` or `documents:update`: kept, `canTag: false`; documents
  are saved untagged with a notice
- Papra unreachable: kept, the error says why

## Papra client

`client.js`, one method per route the plugin uses:

| Method | Route | Key permission |
|---|---|---|
| `currentKey()` | `GET /api/api-keys/current` | none |
| `organizations()` | `GET /api/organizations` | `organizations:read` |
| `tags(org)` | `GET /api/organizations/:org/tags` | `tags:read` |
| `searchDocuments(org, { text, tags }, pageIndex, pageSize)` | `GET /api/organizations/:org/documents?searchQuery=…` | `documents:read` |
| `upload(org, file)` | `POST /api/organizations/:org/documents`, multipart field `file` | `documents:create` |
| `tagDocument(org, doc, tag)` | `POST /api/organizations/:org/documents/:doc/tags` | `documents:update`, `tags:read` |
| `download(org, doc)` | `GET /api/organizations/:org/documents/:doc/file` | `documents:read` |

- Tag filters go into Papra's search text as `tag:"name"`, always quoted
  (names with spaces need it; Papra matches case-insensitively). Several tag
  filters must all match. A `"` in a tag name can't be escaped and is
  dropped.
- Papra serves every file as `application/octet-stream`; `download` takes
  the type from the document's search result and the name from
  `Content-Disposition`.
- Answers are read as text and parsed in the client, so an HTML error page
  becomes `error.not_papra` instead of a JSON exception.
- Errors (`errors.js`): 401 is `error.key` (wrong key or missing
  permission), 409 `document.already_exists` is `error.duplicate`, 413 is
  `error.too_large`, and the proxy's refusals (`no_credential`,
  `wrong_origin`, `rate_limited`, `unreachable`, ...) have their own keys.
  The strings for these keys come with the first UI (step 5).

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
- Unit tests in `test/*.test.mjs` (Vitest, `fakeApi`) mock the proxy. The
  server check's tests fail when the origin comparison is removed (checked).
  End-to-end tests go to `e2e/*.spec.mjs`; there are none yet.
- A webmail for testing runs in this setup as a container (see PLAN.md,
  "Test environment"); the client was checked through its real plugin
  proxy against the test Papra.
