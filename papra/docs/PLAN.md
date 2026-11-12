# Handoff: Bulwark plugin for Papra

## Goal

A Bulwark webmail plugin that connects Bulwark to Papra (document management with OCR and full-text search):

1. **Save to Papra:** save an email attachment as a document in a Papra organisation.
2. **Attach from Papra:** in the composer, search Papra (full text) and attach a document to the message.

Papra becomes the single home for documents (scans and native files), and Bulwark reaches it without switching apps.

## Repository and licence

- Fork `https://github.com/bulwarkmail/plugins` to `https://github.com/AlwinAntreich/plugins`.
- Work on a feature branch; the plugin lives in a new top-level folder `papra/`.
- Licence: AGPL-3.0, same as the plugins repository (Papra is AGPL-3.0-or-later as well).
- Upstreaming to `bulwarkmail/plugins` is possible later. **Before any upstream pull request, check the upstream contribution and AI policy** and follow it (disclosure, authorship, review requirements). Do not open the upstream PR without the owner's go-ahead.

## Target environment

| Component | Version | Notes |
|---|---|---|
| Bulwark | latest release | at `https://drive.antreich.com`; OAuth via Stalwart |
| Papra | latest release | at `https://papra.antreich.com`; **not deployed yet** |
| Stalwart | latest 1.x | OIDC provider for all apps |

All services are reachable only over the owner's VPN, so Papra's address is private. Bulwark's plugin proxy only reaches public addresses by default; the deployment needs `PLUGIN_PROXY_PRIVATE_ORIGINS=https://papra.antreich.com` in Bulwark's environment. Document this in the plugin README.

## Decisions already made

- **Reference implementation:** the existing `paperless/` plugin in the same repository (Paperless-ngx: send attachments, find documents, attach them). Mirror its structure, UI patterns and test approach.
- **Credentials are per user, not admin.** Unlike `paperless`, use a **user-scope credential** with bearer injection. Each user connects their own Papra API key in the dialog Bulwark draws. The key stays on Bulwark's server; the plugin never sees it.
  ```json
  "credentials": {
    "papra": { "label": "Papra", "scope": "user", "inject": { "type": "bearer" } }
  }
  ```
- **The admin sets the Papra server; users only bring their API key** (decided 2026-11-08). No user may connect the plugin to another Papra instance: that would let them send mail attachments anywhere. If that is ever needed, it is a later change.
  - The server is the admin config field `serverUrl` (`configSchema`), read with `api.config.get()` (no permission needed). Without it the plugin shows "not set up" and does nothing.
  - Bulwark can't tie a user-scope credential to an admin config field today: `originKey` exists for admin scope only, and a user-scope credential has a fixed `origin` in the manifest or the one the user enters (`lib/plugin-secrets/credentials.ts`). So the plugin checks it: it passes the admin's server to `api.proxy.connect`, sends requests only to that server, and treats a credential for any other origin as not connected (and disconnects it). The proxy only adds the key on requests to the credential's own origin, so the plugin never talks to another server.
  - **This check is not a security boundary.** It stops mistakes (a mistyped or phished address) and keeps documents in the admin's Papra. It does not stop a user who wants another server: the host still stores a credential for any https origin the user enters, and `/api/plugin-proxy` accepts same-origin calls from the signed-in host page, so the user can send requests through Bulwark's server to their own origin from the browser console. Mail they can read they can download anyway; what they gain is Bulwark's server as a relay. Only the host can close that: a fixed `origin` in the manifest (ties the plugin to one server), or the upstream change below.
  - **Upstream change postponed** (decided 2026-11-08): a pull request to Bulwark that lets a user-scope credential take its origin from `originKey` would move the check into the host, where it is enforced. Recorded here; not pursued now. Until then the plugin-side check stays, and the manifest keeps no fixed `origin` (that would tie the plugin to one server).
- **One organisation at a time** (decided 2026-11-08). The user sets a default organisation in the plugin's settings and switches on demand in the "Save to Papra" and "From Papra" dialogs. No search across all organisations: Papra searches one organisation per request.
- **Default tags set by the admin** (decided 2026-11-08), for example a tag that marks where the document came from. Documents saved from Bulwark get these tags. The admin field arrives with "Save to Papra", not before.
  - A default tag that doesn't exist in the target organisation is skipped, and the user is told which one (decided 2026-11-08). The plugin creates no tags, so the users' keys need no `tags:create`.
- **Tags shown and chosen in Bulwark** (decided 2026-11-08). "From Papra" shows each result's tags (Papra's search returns them). "Save to Papra" lets the user add tags from the target organisation on top of the admin's default tags.
- **Who tags what** (decided 2026-11-08):
  - Content-based tagging belongs in Papra's own tagging rules (they match on the document's name or extracted text). The plugin doesn't duplicate it.
  - The plugin tags only what Papra can't see: where the document came from (the admin's default tags) and the user's own choice when saving.
  - **The plugin never creates tags.** Tags are each organisation's vocabulary; a mail client creating them would spread duplicates and typos, and every key would need `tags:create`. The plugin picks from existing tags (`tags:read`); the admin creates the default tags in each organisation in Papra.
  - **Filtering in "From Papra"** uses Papra's search language: clicking a result's tag adds `tag:<name>` to the search, and a tag picker next to the search box lists the organisation's tags. Papra does the filtering.
  - **Key permissions for tagging:** the README asks for `tags:read` and `documents:update`. A key without them still saves, untagged, with a notice. Papra checks every request against the user's own membership, so `documents:update` gives the key nothing the user can't already do in Papra; the risk is only a key leaking from Bulwark's server.
- **Tests never run against the production Bulwark** (`https://drive.antreich.com`, decided 2026-11-08). End-to-end tests need a webmail started for testing, with `PLUGIN_PROXY_PRIVATE_ORIGINS` listing the test Papra; the production instance can't reach `test-env/` anyway.
- **Test environment** (step 3, 2026-11-08): Papra 26.7.1 on `http://localhost:18012`, seeded by `test-env/seed/seed_papra.py` (alice, organisations Alice and Team, tags with Bulwark only in Alice, five documents, a full key and one without tag permissions). See `test-env/README.md`.
- **A webmail for testing** (step 4, 2026-11-08). The production image `ghcr.io/bulwarkmail/webmail:1.21.0` runs here with Podman (`--network host`, port 3100, `JMAP_SERVER_URL=http://localhost:18025`, `PLUGIN_PROXY_PRIVATE_ORIGINS=http://localhost:18012`), next to the test Stalwart built from `test-env/stalwart/`. Plugins have to be turned on in the admin policy (`features.pluginsEnabled`).
  - Its Content Security Policy only allows `https:` connections outside development, so the browser can't reach the test Stalwart over http and signing in fails. Checks through it run with Playwright's `bypassCSP`; they are scripts, not committed tests.
  - The repository's end-to-end tests need a webmail started with `npm run dev` from the webmail's source (development CSP), or Stalwart behind https. Installing the webmail's packages here (`npm ci` in a clone of `bulwarkmail/webmail`) was refused by this session's permission check; the owner decides. Don't leave a clone at `../jmap-webmail-plugins` that doesn't match the webmail version the repository expects: `slot-showcase`'s tests and `docs:check` compare against it when it's there, and fail against 1.21.0.
  - What the checks showed: the client works through the real proxy (key permissions, organisations, tags, search with `tag:`, download, upload of a file name with quotes, tagging, 409 for a duplicate, 401 for a missing permission and for a wrong key). And the host stores the user's key for any https origin and relays requests there, while refusing to use it on the admin's server (`wrong_origin`): the server check is needed, and it can't stop the relay.
- **Decisions taken in step 5** (2026-11-08):
  - ~~The organisation the user saved to last is the default next time.~~ Replaced in step 7, see below: one save to a shared organisation made the next, maybe private, attachment go there with one click.
  - Organisation and tags are picked with the kit's documented `Select` and `Checkbox`, not `Combobox`: `Combobox` isn't in the kit's documented list, and an organisation has few tags.
  - The admin's default tags are shown ticked and fixed in the dialog; the user can't untick them.
  - Only `attachment-menu`, no `reader-actions` "save the whole message": saving messages (`.eml`) is not in version 1.
  - ~~No "Open in Papra" link after saving.~~ Added in 0.1.4: the message after saving links the new document (`/organizations/:org/documents/:doc`, checked in Papra's client routes and in the test environment), so it can be changed in Papra right away. A link needs a notification (`ui:notifications`); a toast can't carry one.
  - The end-to-end tests delete what they saved with alice's Papra session (the seeded keys have no `documents:delete`).
  - After review (screenshots in light, dark and at phone width): a spinner toast for saves from 1 MB, and one toast per save. Bulwark drops a plugin's toasts past 5 in 10 seconds, the result included; with a spinner on every save and a second toast for missing tags, the end-to-end test saw the warning dropped after a few saves. The file name in the dialog wraps instead of being cut off at phone width.
- **The user chooses the default organisation** (decided 2026-11-08, replacing "last used"). Settings > Papra holds the default; the plugin never sets it. The dialogs preselect it, or the only organisation there is, or nothing: then Save waits for a choice, and From Papra searches only once one is picked. Switching in a dialog is for that one action. Both dialogs follow the same rule.
- **From Papra uses Papra's search language** (decided 2026-11-08, after testing 0.1.1). The owner already searches with Papra's advanced syntax; the "Filter by tag" list was redundant. The search box goes to Papra unchanged, with an example as placeholder; quick filters (the six most-used tags, Added this year with `created:` because many documents have no document date, Untagged) and collapsed search tips add or remove terms; a link opens Papra's guide. Chosen from three ideas (also: tokens with suggestions as you type, which needs the plugin to parse Papra's language; suggestions from the draft, which needs `compose:read`). Papra's API supports every form in its guide, but reports no errors and doesn't say how it read a query, so the plugin doesn't parse queries.
- **Properties when saving** (decided 2026-11-10, after using 0.1.2). All of an organisation's properties, every type Papra has, with the user's defaults filled in; the same rule as for tags: matched by name, the plugin creates nothing, a missing one is left out and named. The window combines two of three proposed versions: tabs "Where and tags" and "Properties", and on Properties only what will be set, as "name: value" chips, with "Add property" for the rest. Owner is an ordinary property with a default the user types (the uploader is not always the owner: a birth certificate uploaded for Agata is hers); Papra records the uploader itself. The key needs `custom-properties:read`.
  - Papra doesn't let an API key list an organisation's members or say whose key it is, so a Papra user property offers "me" (learned from the creator of the user's first upload) and the users already set on the latest documents. A Papra change would be needed for the full member list.
- **Defaults follow the user across devices** (decided 2026-11-10). `api.storage` is the browser's `localStorage`; with Bulwark's settings sync on, a default organisation set in one browser was not there in another. The default organisation, default properties and the user's Papra account now live in `api.accountData` (Stalwart's metadata on the user's Inbox, Stalwart 1.0 and later), with `api.storage` as cache and fallback. Needs the permission `email:write`; the plugin changes no messages with it.
- **Dates from lists, deleted properties dropped from the defaults** (decided 2026-11-12, after testing 0.1.3). A date field showed no picker and couldn't be changed in Chrome or Firefox inside the plugin's sandboxed frame; dates are now day, month and year lists. Defaults whose property no organisation has any more are removed automatically, but only when every organisation could be asked, so a property that is merely out of reach (an organisation that didn't answer) is kept.
- **Decisions taken in step 7** (2026-11-08):
  - The settings page shows the key's name and what it may do, read from `/api/api-keys/current`, so a user sees why documents are saved untagged.
  - The default organisation is kept in `api.storage`, not `settingsSchema`: a `select` there needs fixed options, and organisations come from the user's key.
  - Picked documents in From Papra are listed above the results (fix from the step 6 review).
- **Decisions taken in step 6** (2026-11-08):
  - Several documents can be attached at once (ticked in the list), not only one: attaching a few invoices together is common, and the list already has check boxes.
  - ~~The tag filter is a "Filter by tag" list plus removable chips.~~ Replaced after testing, see "From Papra uses Papra's search language".
  - The filter shows when the key has `tags:read`; attaching needs nothing beyond the required permissions.
  - Results show the document date when Papra has one, else when it was added; Papra sorts newest first.
- **Decisions taken while scaffolding** (step 2, 2026-11-08):
  - Version `0.1.0` until the first release; `npm run release` sets the versions from then on. Author "Alwin Antreich".
  - Permissions are added by the step whose code uses them, each with its reason in the commit. The scaffold asks only for `http:proxy`. `admin:config` is not needed: `api.config.get()` reads the admin's settings without a permission.
  - `package.json` is written fresh (build and test scripts, esbuild only), with the build flags Bulwark's checks and the extension directory expect (same as `paperless/`).
  - `papra.zip` is not committed in feature work; `npm run release` builds it.
  - `publish.json` lists `papra` under `skip` until the first release.
  - The fork-only files (`AGENTS.md`, `CONTRIBUTING.md`, `.claude/`, the root `.pre-commit-config.yaml` and `.githooks/`) are separate commits, left out of any upstream branch.
  - The pre-commit Papra test hook runs `npm test -- --passWithNoTests papra/`, like Bulwark's publish workflow, so it passes while papra has no tests yet.
- **Multiple organisations:** a Papra user can belong to several organisations, private or shared. The plugin lists the organisations the key can access, lets the user set a default in the plugin's settings (non-secret), and allows choosing per action.
- **No secrets in user settings or `api.storage`** (both are unencrypted in the browser). Only the credential holds the key.
- **No changes to Papra.** Use its public API only. If something is missing, note it as a separate proposal for the Papra project; do not patch Papra in this repository.

## Verified facts (from source and docs, verify again before relying on them)

### Bulwark plugin API

Read `WRITING_PLUGINS.md` in the repository first; it is the authoritative reference.

| Need | API / slot | Permission |
|---|---|---|
| "Save to Papra" in each attachment's menu | `api.ui.setActions('attachment-menu', …)`, click context `{ emailId, blobId, name, type, size }` | `email:read` |
| Read attachment bytes | `api.email.getAttachment(emailId, blobId)` returns `{ name, type, size, data: ArrayBuffer }`, max 25 MB | `email:blob-read` |
| "From Papra" in the composer's Attach menu | `api.ui.setActions('composer-attach-menu', …)`, click context `{ composerId }` | `ui:composer-toolbar` |
| Add a file to the draft | `api.jmap.uploadBlob(bytes, name, type)`, then `api.composer.attach(composerId, { blobId, name, type, size })` | `email:blob-write` |
| Dialogs (organisation, search) | `api.ui.openDialog({ slot: 'plugin-dialog', … })` | `ui:observe` |
| Requests to Papra with the user's key | `api.proxy.fetch`, `api.proxy.connect`, `api.proxy.accounts`; buffered answers up to 25 MB, bodies up to 100 MB | `http:proxy` |
| The admin's server and default tags | `api.config.get()` | none |
| User settings (default organisation) | `api.plugin.settings` (`settingsSchema`) | none |
| Settings UI (connection) | slot `settings-section` | `ui:settings-section` |
| Composer API, UI kit | | `minAppVersion` 1.15.0 or later |

### Papra API

- Authentication: `Authorization: Bearer <api key>`.
- API keys look like `ppapi_` plus 64 letters and digits. **Every key covers all of the user's organisations:** limiting a key to some is commented out in `api-keys/api-keys.routes.ts`, and new keys get `allOrganizations: true` (checked against Papra 26.7.1 in `test-env/`).
- `GET /api/api-keys/current` returns the key's id, name and permissions, and needs no permission. The plugin can check a key when it is connected and know whether it may tag.
- A wrong key and a key that lacks the permission for a request both get **401** `auth.unauthorized`; the status doesn't tell them apart, `/api/api-keys/current` does.
- Tagging a document answers 204 with no body.
- Uploading a file Papra already has (same content) answers 409 `document.already_exists`; the upload limit answers 413 `document.size_too_large`.
- Search syntax checked in `test-env/`: `tag:"Tax 2025"` needs the quotes, tag names match case-insensitively, `tag:a tag:b` means both, `tag:a OR tag:b` either, and pages count from `pageIndex=0`.
- Routes and the key permission each needs (checked on `main`, 2026-11-08, in `apps/papra-server/src/modules/`):
  - `GET /api/organizations` → `{ organizations }`, the user's organisations (`organizations:read`; `organizations/organizations.api.routes.ts`)
  - `GET /api/organizations/:organizationId/documents` with query `searchQuery`, `pageIndex`, `pageSize` (at most 100), `sortField`, `sortOrder` → `{ documents, documentsCount }`: list and full-text search (`documents:read`)
  - `POST /api/organizations/:organizationId/documents`: upload, multipart field `file`, limited by the organisation's plan (`documents:create`)
  - `GET /api/organizations/:organizationId/documents/:documentId`: metadata (`documents:read`)
  - `GET /api/organizations/:organizationId/documents/:documentId/file`: the file, as `application/octet-stream` (`documents:read`)
  - `GET /api/organizations/:organizationId/tags`: the organisation's tags (`tags:read`; `tags/tags.api.routes.ts`)
  - `POST /api/organizations/:organizationId/documents/:documentId/tags` with a tag id: tag a document (`documents:update` and `tags:read`)
  - `POST /api/organizations/:organizationId/tags`: create a tag (`tags:create`)
- Tags belong to one organisation; the upload takes no tags, so tagging is a second request after it.
- Search language (Papra's advanced search guide): `tag:invoice`, `has:tags`, `has:date`, combined with words and dates, passed in `searchQuery`.
- Tagging rules (`tagging-rules/tagging-rules.constants.ts`) match on the fields `name` and `content` with `equal`, `not_equal`, `contains`, `not_contains`, `starts_with`, `ends_with`, all or any conditions.
- Papra extracts text (with Tesseract OCR for images and scanned PDF pages) from PDF, images, DOC, ODT/ODS/ODP, PPTX, XLSX, RTF and plain text.

## Scope

### Version 1

- Credential connect flow (host dialog) and a clear "not connected" state.
- Organisation list, default organisation in settings, per-action override.
- Default tags from the admin on every document saved from Bulwark, and tags the user picks when saving.
- Tags shown in the "From Papra" results.
- "Save to Papra" on attachments, with success and error notifications, and the 25 MB limit handled gracefully.
- "Attach from Papra" in the composer: search field, result list (name, date, organisation), attach on select.
- English and German strings, following the repository's i18n approach.

### Not in version 1

- Saving whole messages (`.eml`) to Papra.
- Changing the tags of documents already in Papra, document metadata editing, sharing links.
- Anything requiring Papra changes.
- Papra in Bulwark's Files view (postponed, 2026-11-08: get comfortable with the current plugin first). "Save to Papra" in a file's menu (`file-actions`, `ui:files`) and saving a Papra document into Files both need Bulwark changes, proposed upstream when the time comes:
  - reading a file's bytes: an `api.files.getFile(fileId)` → `{ name, type, size, data }` under `files:read`, like `api.email.getAttachment`. Today `api.files` only returns extracted text (`getText`) and pictures (`getImage`), and `api.jmap.fetchBlob` is for the privileged tier only;
  - writing a binary file: `api.files.create` only takes Markdown and plain text up to 512 KB.
  - Not chosen: downloading through Stalwart's WebDAV with a second user credential (each user's Stalwart password or app password, a WebDAV address from the admin, path mapping), as the Nextcloud plugin does over WebDAV.

## Engineering standards

Follow the repository's conventions exactly; when in doubt, copy what `paperless/` does.

- **Layout:** `papra/manifest.json`, `papra/src/`, `papra/test/*.test.mjs` (Vitest), `papra/e2e/*.spec.mjs` (Playwright), `papra/README.md`, `papra/CHANGELOG.md`, `papra/media/` (icon, banner, screenshots), built `papra/papra.zip`.
- **Commands** (repository root):
  - `npm run build` and `npm run build:check`
  - `npm run check`
  - `npm test`
  - `npm run test:e2e`
  - `npm run docs` and `npm run docs:check` (regenerates the reference tables in `WRITING_PLUGINS.md`; needs the webmail checkout in `BULWARK_WEBMAIL`)
- **Permissions:** request only what is used. The plugin table in the root README is written by hand; add the row at the first release.
- **Tests:** unit tests for the Papra client (request building, error mapping, organisation handling) with mocked proxy responses; e2e tests against a Papra service in `test-env/`.
- **Test environment:** add a Papra service to `test-env/` alongside the existing services (Stalwart, Paperless-ngx, …), seeded with a test user, two organisations and an API key.
- **Commits:** small and focused, in the style of the repository's history. Keep the CHANGELOG current.
- **KISS/YAGNI:** no features beyond version 1 without asking. If a step needs more than the plan says, stop and ask.

## Work plan

Status: steps 1 to 9 are done (branches `papra/scaffold`, `papra/test-env`, `papra/client`, `papra/save`, `papra/attach`, `papra/settings`, `papra/release-prep`), except what the definition of done says below; how the plugin is built so far is in [architecture.md](architecture.md).

1. Fork, clone, branch. Read `WRITING_PLUGINS.md`, `README.md` and the `paperless/` plugin end to end.
2. Scaffold `papra/` from `plugin-template/`; add the manifest with the user-scope credential and minimal permissions.
3. Add Papra to `test-env/` and confirm it starts and is reachable by the plugin proxy. Done, except the proxy: Papra starts, the seed runs twice cleanly, and the seeded keys list organisations, search (`tag:invoice`, words), list tags and download files; a key without the tag permissions gets 401 on tags. Reaching it through Bulwark's plugin proxy needs a webmail with `PLUGIN_PROXY_PRIVATE_ORIGINS`; that check comes with the first end-to-end test.
4. Papra client module with unit tests: list organisations, search, upload, download. Done, with the connection check (server lock, key permissions) and its tests; checked through a test webmail's plugin proxy against the test Papra.
5. "Save to Papra" on attachments, with tests. Done: unit tests, a jsdom test of the dialog, and end-to-end tests that pass against the test webmail (run with `bypassCSP`, see "A webmail for testing").
6. "Attach from Papra" in the composer, with tests. Done: unit tests, a jsdom test of the dialog, an end-to-end test against the test webmail; screenshots in light, dark and at phone width reviewed.
7. Settings section: connection state, default organisation. Done, with unit tests, a jsdom test and an end-to-end test; screenshots reviewed.
8. i18n (en, de), README (setup incl. `PLUGIN_PROXY_PRIVATE_ORIGINS` and Papra API key creation), CHANGELOG, media, built ZIP. Done, except the ZIP: `papra.zip` is built and committed by `npm run release`, like every plugin's. The CHANGELOG's Unreleased section holds the notes for the first version.
9. Run all repository checks; fix everything they report. Done (2026-11-08): `npm run check` ok; `npm test` 2496 passed; `npm run build:isolated` builds papra (45.6 KB); the end-to-end tests (4) pass against the test webmail. Two checks report what this work didn't cause and didn't fix:
   - `npm run build:check`: `papra.zip` is missing until the release builds it; `smime.zip` is stale on `main` already.
   - `npm run docs:check` against the webmail's current `main`: `WRITING_PLUGINS.md` is 13 lines behind the webmail's catalogue. The Papra branches don't touch it; refreshing it is a change of its own.

## Definition of done

- All repository checks pass: build, `check`, unit tests, e2e tests, `docs:check`.
- The plugin installs in a current Bulwark, connects with a user's Papra key, saves an attachment to a chosen organisation, and attaches a searched document to a draft.
- README explains installation, the required Bulwark environment variable, and the Papra key permissions.
- No secret ever stored in plugin settings, storage or logs.

## Before the first release

- **Not in the extension directory yet** (decided 2026-11-08): the owner uses and polishes the plugin first; `publish.json` keeps it under `skip`. Publishing later: move it to `publish`, and a directory admin adds the trusted publisher (see the root README, "Releasing"). Until then it is installed by hand (README, "Install without the extension directory").
- **The first release is 0.1.1** (2026-11-08): `npm run release` only takes a version newer than the manifest's, and the manifest has said 0.1.0 since the scaffold. The upstream plugins started the same way (category-tabs was added at 1.1.0 and first released as 1.1.1).
- Merged into the fork's `main` (2026-11-08). `npm run release` refuses `papra` while it is under `skip`, and wouldn't build its first ZIP, so 0.1.1 is released by hand (CONTRIBUTING.md, "Releasing"): branch `papra/release-0.1.1`, then the owner merges it and tags `papra@0.1.1` on `main`.
- Try it once in a production-like Bulwark (https Stalwart, no `bypassCSP`), with the real Papra at `https://papra.antreich.com` and `PLUGIN_PROXY_PRIVATE_ORIGINS` set: the test webmail here runs with the browser's CSP switched off.

## Open questions for the owner

- Upstream: after checking the AI policy, open a pull request or keep it in the fork?
