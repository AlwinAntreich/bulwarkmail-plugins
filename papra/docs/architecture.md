# How the Papra plugin is built

What exists today and how the parts fit together. The plan, the scope and
the decisions with their reasons are in [PLAN.md](PLAN.md); this file
describes the implementation and changes with it.

## Status

| Part | State |
|---|---|
| Manifest, build, setup notes | done (step 2) |
| Papra in `test-env/` | done (step 3) |
| Papra client, connection check | done (step 4) |
| Save to Papra | done (step 5) |
| From Papra | done (step 6) |
| Settings section | done (step 7) |

## Files

| File | What it is |
|---|---|
| `manifest.json` | id, permissions, the admin's settings (`configSchema`) and the user credential |
| `package.json`, `package-lock.json` | the build (esbuild into `dist/index.js`) and the test script; esbuild is the only package |
| `src/index.js` | the entry point: starts the background, routes `onAction`, renders the dialog slot |
| `src/lib/background.js` | the menu entries and the save and attach flows |
| `src/lib/save.js` | read an attachment, upload it, tag it |
| `src/lib/attach.js` | download documents and add them to the composer |
| `src/lib/tags.js` | the admin's default tags: parse the list, match it against an organisation's tags |
| `src/ui/SaveDialog.jsx` | the "Save to Papra" dialog: tabs, tag pills, property chips |
| `src/ui/PropertyEditor.jsx` | the field for each property type, and pills to switch on and off |
| `src/ui/DefaultProperties.jsx` | the default properties in Settings > Papra |
| `src/lib/properties.js` | property definitions, values, defaults |
| `src/lib/prefs.js` | the user's preferences, kept with the mail account or in the browser |
| `src/ui/PickDialog.jsx` | the "Attach from Papra" dialog |
| `src/ui/Settings.jsx` | Settings > Papra: connection and default organisation |
| `src/ui/organizations.js` | which organisation a dialog starts with |
| `src/ui/host.js` | the `api` for UI code (background or slot frame) |
| `src/lib/client.js` | the Papra API client on top of `api.proxy.fetch` |
| `src/lib/connection.js` | the admin's server, the user's key, the server check and the key's permissions |
| `src/lib/errors.js` | Papra and proxy failures as message keys (`error.*`) |
| `src/lib/multipart.js` | the upload body (copied from `paperless/`) |
| `test/*.test.mjs` | unit tests; `save-dialog.test.mjs` renders the dialog in jsdom; `locales.test.mjs` checks every key the code uses has an English and German string |
| `e2e/papra.spec.mjs`, `e2e/send_mail.py` | end-to-end tests against `test-env/` and a webmail |
| `README.md` | setup for admins and users |
| `CHANGELOG.md` | written by `npm run changelog` at release time |
| `docs/` | the plan and this file |
| `media/` | icon, banner and the screenshots the manifest lists (taken from `test-env/`) |

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

- A tag becomes the search term `tag:"name"`, always quoted (names with
  spaces need it; Papra matches case-insensitively). A `"` in a tag name
  can't be escaped and is dropped.
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

## Save to Papra

```
attachment menu ── onAction (background.js)
  │ resolveConnection; disconnected → ui.confirm → connect()   (connection.js)
  │ checkKey → canTag; a lost required permission → error
  ├─► ui.openDialog plugin-dialog view "save"                 (SaveDialog.jsx, slot frame)
  │     organisations, the user's default preselected (or none); with canTag the
  │     organisation's tags, the admin's default tags ticked and fixed,
  │     missing ones named; onResult { organizationId, tagIds, missingDefaults }
  ├─► saveAttachment                                          (save.js)
  │     email.getAttachment (≤ 25 MB) → client.upload → client.tagDocument per tag
  │     from 1 MB a spinner toast (toast.progress) until it ends
  └─► one toast: saved / saved without some tags / tagging failed / already in Papra
```

- **The result links the document.** After a save the message is a
  notification (`api.notifications.show`, `ui:notifications`) with the
  action **Open in Papra** → `<server>/organizations/:org/documents/:doc`,
  the document's page in Papra's web app (its client route). Bulwark shows
  it as a system notification when the user allowed them, else in the app,
  and lists it in the notification panel. Without the permission, or when
  the host refuses the notification, a plain toast.
- **One toast per action.** Bulwark drops a plugin's toasts past 5 in 10
  seconds, the result included. So a save reports in a single toast (a
  warning when tags are missing), and the spinner toast only shows from
  1 MB, where it is worth its place in that budget.

- **Which organisation a dialog starts with** (`organizations.js`): the
  default the user chose in Settings (`api.storage`,
  `defaultOrganizationId`) while it still exists, else the only
  organisation there is, else none. With none, Save waits until the user
  picks, and From Papra searches only once one is chosen. A choice in a
  dialog never changes the default.
- Tags are added after the upload, one request each. A failed tag stops the
  rest and leaves the document in Papra; the user is told why it has fewer
  tags. With `canTag: false` no tag request is made at all.
- The admin's `defaultTags` (comma-separated names) are matched against the
  target organisation's tags case-insensitively (`tags.js`).
- Strings: `locales` in `manifest.json`, English and German. Messages say
  what failed and what to do (ask the admin, connect, give the key a
  permission).

## Properties (Save to Papra)

`properties.js` holds the rules, `SaveDialog.jsx` and `PropertyEditor.jsx`
the controls, `DefaultProperties.jsx` the defaults in Settings.

- **Definitions** come from `GET /api/organizations/:org/custom-properties`
  (`custom-properties:read`), in Papra's order. All of Papra's types:
  text, number, date, yes/no, choice, multiple choice, Papra user, linked
  document. Values go with `PUT …/documents/:doc/custom-properties/:def`
  (`documents:update` and `custom-properties:read`), one per property
  after the tags; a refused one doesn't stop the others. Value forms
  (checked against Papra 26.7.1): text and date strings, numbers, booleans,
  an option id, and arrays of option, user or document ids.
- **Defaults** are `[{ name, value }]` in the preferences
  (`defaultProperties`, see "Preferences across devices"), by property name and, for choices, option name,
  so they apply in every organisation with a property of that name.
  `applyDefaults` turns them into dialog values; a property or option the
  organisation lacks goes into `missingProperties`, shown in the dialog
  and the toast. A linked document can't be a default; a Papra user
  default is "me".
- **Dates** are chosen from day, month and year lists (`DateField.jsx`),
  with Today and Clear. A native date field doesn't work in the plugin's
  sandboxed frame: Chrome refuses to open its picker from a cross-origin
  frame (`showPicker()`), and users found the field couldn't be changed in
  Chrome or Firefox.
- **Defaults of deleted properties go.** Settings, once every organisation
  answered, removes defaults whose property no organisation has any more
  (`stillOffered`) and says so; when one organisation can't be asked,
  nothing is removed. A save that left a default out checks the same
  (`pruneDefaults`) and names what it removed in its message.
- **Me:** Papra doesn't tell an API key whose it is, and doesn't let it list
  members. The creator of the user's first upload (`createdBy`) is kept as
  `papraUser`; other users come from Papra user values on the latest 100
  documents (`usersIn`).
- **The dialog:** with `canSetProperties` two tabs, "Where and tags" and
  "Properties (n)". Properties is a row per property to set: its name
  (`Field` label) and its field (`PropertyEditor` with `bare`), edited in
  place, "Your default" while the value is the default, Remove to take it
  off. The defaults start as rows; "Add property" is a list of the others
  and adds a row with the field ready. A review line under both tabs, dates
  formatted for the user's language (`describe`). Tags are pills: the
  admin's defaults fixed, the five most-used (`TOP_TAGS`), "+ n more".

## Preferences across devices

`prefs.js` keeps the default organisation, the default properties and the
user's own Papra account (`papraUser`, for "me") in `api.accountData`:
Stalwart's metadata on the user's Inbox, the same in every browser
(Stalwart 1.0 and later; `get` needs `email:read`, `set` `email:write`;
at most 4 KB, 30 reads and 20 changes a minute).

- `readPrefs` reads the account's copy and keeps a copy in `api.storage`.
  The first time the account has none but the browser does, the browser's
  move to the account.
- `updatePrefs` reads the account's copy again right before writing and
  merges the change into it, so a change made on another device meanwhile
  is kept. A refused write (rate limit, size) leaves the change in the
  browser and Settings says so.
- Without server support (`supported: false`) everything stays in
  `api.storage`; Settings says the defaults apply in this browser only.
- Settings saves a typed default after a pause of 0.8 s or when the field
  is left, a choice at once, to stay within the 20 changes a minute.
- Checked in the test environment: with Bulwark's settings sync on,
  `api.storage` doesn't follow the user to another browser. The test
  Stalwart (0.16) keeps no plugin metadata, so the account path is covered
  by unit tests (`prefs.test.mjs`) only.

## From Papra

```
composer Attach menu ── onAction (background.js), context { composerId }
  │ ensureConnection, checkKey → canReadTags
  ├─► ui.openDialog plugin-dialog view "pick"                 (PickDialog.jsx)
  │     organisation (default or none); search box (300 ms pause) passed to
  │     Papra unchanged as searchQuery; quick filter chips and search tips
  │     toggle a term in it (query.js); 25 per page, "Show more";
  │     rows show date, size, tags; over 25 MB disabled
  │     onResult { organizationId, documents: [{ id, name, mimeType, size }] }
  ├─► attachDocuments                                         (attach.js)
  │     per document: client.download → jmap.uploadBlob → composer.attach
  │     stops at the first problem; the error carries what was attached
  └─► one toast: attached one / attached n / attached n, then stopped: why
```

- **The search box is Papra's search language.** The plugin sends what
  the user typed; Papra does all filtering (`tag:`, `name:`, `content:`,
  `date:`, `created:`, `has:`, `AND`/`OR`/`NOT`, brackets; all checked
  through the API). Papra reports no errors for a query it can't read (an
  unknown filter finds nothing, a stray bracket is ignored) and can't say
  how it read one, so the plugin doesn't parse queries; when a search with
  a filter finds nothing, it says to check the filters.
- **Quick filters:** the organisation's six most-used tags (by Papra's
  `documentsCount`; needs `tags:read`), "Added this year" (`created:>=YYYY`:
  many documents have no document date, so `date:` would miss them) and
  "Untagged" (`-has:tags`). A chip adds its term, ticked, or removes it.
  **Search tips** (collapsed) list common forms; a click adds one; the last
  line opens Papra's guide.
- Switching organisation clears what was picked: documents belong to one
  organisation.
- Picked documents are listed as removable chips above the results, so a
  new search that hides them doesn't hide what "Attach 2" will attach.
- A result's tags are shown as text in the row: the kit's `ListRow` takes a
  text subtitle, so a tag in it can't be a button. The quick filters do that.
- The proxy buffers answers up to 25 MB, so larger documents are shown but
  can't be picked.

## Settings > Papra

`Settings.jsx` in the `settings-section` slot:

- Connection: not set up (ask the admin) / not connected (Connect, which
  runs `connect()`; a key for another server is reported as removed) /
  connected to the host with the key's name, with a note when it can't tag
  or lacks a required permission, and Disconnect (`api.proxy.disconnect`).
- Default organisation: a list of the key's organisations plus "None:
  choose each time"; saved in `api.storage`. A default that no longer
  exists shows as none.

## Permissions

| Permission | Since | Why |
|---|---|---|
| `http:proxy` | step 2 | requests to Papra through Bulwark's proxy with the user's key |
| `email:read` | step 5 | the `attachment-menu` entry |
| `email:blob-read` | step 5 | `api.email.getAttachment` |
| `ui:observe` | step 5 | the `plugin-dialog` slot (always granted, not shown to users) |
| `ui:composer-toolbar` | step 6 | the `composer-attach-menu` entry |
| `email:blob-write` | step 6 | `api.jmap.uploadBlob` and `api.composer.attach` |
| `ui:settings-section` | step 7 | the `settings-section` slot |

## Build and tests

- `npm run build` in `papra/` bundles `src/index.js` into `dist/index.js`
  with React and `@plugin-host` left to the host, as the extension
  directory builds it. `node scripts/build.mjs papra` at the root writes
  `papra.zip`; only `npm run release` commits it.
- The test Papra runs in `test-env/` (`http://localhost:18012`, see
  `test-env/README.md`); its API keys are in `test-env/.secrets/papra.json`.
- Unit tests in `test/*.test.mjs` (Vitest, `fakeApi`) mock the proxy. The
  server check's tests fail when the origin comparison is removed (checked).
  End-to-end tests: `npm run test:e2e` (or `npx playwright test -c
  e2e/playwright.config.mjs papra/`) with `BULWARK_ADMIN_PASSWORD`, a webmail
  whose `PLUGIN_PROXY_PRIVATE_ORIGINS` lists `http://localhost:18012`,
  plugins turned on in its admin policy, and `test-env/` seeded.
- A webmail for testing runs in this setup as a container (see PLAN.md,
  "Test environment"); the client was checked through its real plugin
  proxy against the test Papra.
