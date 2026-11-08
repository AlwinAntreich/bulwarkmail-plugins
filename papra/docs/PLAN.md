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
  - Later, upstream: a pull request to Bulwark that lets a user-scope credential take its origin from `originKey` would move the check into the host, where it is enforced.
- **One organisation at a time** (decided 2026-11-08). The user sets a default organisation in the plugin's settings and switches on demand in the "Save to Papra" and "From Papra" dialogs. No search across all organisations: Papra searches one organisation per request.
- **Default tags set by the admin** (decided 2026-11-08), for example a tag that marks where the document came from. Documents saved from Bulwark get these tags. Details are in "Open questions for the owner"; the admin field arrives with "Save to Papra", not before.
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
- API keys look like `ppapi_` plus 64 letters and digits. Keys can be limited to selected organisations or cover all (`allOrganizations`).
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
- Papra extracts text (with Tesseract OCR for images and scanned PDF pages) from PDF, images, DOC, ODT/ODS/ODP, PPTX, XLSX, RTF and plain text.

## Scope

### Version 1

- Credential connect flow (host dialog) and a clear "not connected" state.
- Organisation list, default organisation in settings, per-action override.
- Default tags from the admin on every document saved from Bulwark.
- "Save to Papra" on attachments, with success and error notifications, and the 25 MB limit handled gracefully.
- "Attach from Papra" in the composer: search field, result list (name, date, organisation), attach on select.
- English and German strings, following the repository's i18n approach.

### Not in version 1

- Saving whole messages (`.eml`) to Papra.
- Choosing tags per document, document metadata editing, sharing links.
- Anything requiring Papra changes.

## Engineering standards

Follow the repository's conventions exactly; when in doubt, copy what `paperless/` does.

- **Layout:** `papra/manifest.json`, `papra/src/`, `papra/test/*.test.mjs` (Vitest), `papra/e2e/*.spec.mjs` (Playwright), `papra/README.md`, `papra/CHANGELOG.md`, `papra/media/` (icon, banner, screenshots), built `papra/papra.zip`.
- **Commands** (repository root):
  - `npm run build` and `npm run build:check`
  - `npm run check`
  - `npm test`
  - `npm run test:e2e`
  - `npm run docs` and `npm run docs:check` (regenerates the reference tables, including the plugin table in the root README)
- **Permissions:** request only what is used. List them in the root README table (generated).
- **Tests:** unit tests for the Papra client (request building, error mapping, organisation handling) with mocked proxy responses; e2e tests against a Papra service in `test-env/`.
- **Test environment:** add a Papra service to `test-env/` alongside the existing services (Stalwart, Paperless-ngx, …), seeded with a test user, two organisations and an API key.
- **Commits:** small and focused, in the style of the repository's history. Keep the CHANGELOG current.
- **KISS/YAGNI:** no features beyond version 1 without asking. If a step needs more than the plan says, stop and ask.

## Work plan

1. Fork, clone, branch. Read `WRITING_PLUGINS.md`, `README.md` and the `paperless/` plugin end to end.
2. Scaffold `papra/` from `plugin-template/`; add the manifest with the user-scope credential and minimal permissions.
3. Add Papra to `test-env/` and confirm it starts and is reachable by the plugin proxy.
4. Papra client module with unit tests: list organisations, search, upload, download.
5. "Save to Papra" on attachments, with tests.
6. "Attach from Papra" in the composer, with tests.
7. Settings section: connection state, default organisation.
8. i18n (en, de), README (setup incl. `PLUGIN_PROXY_PRIVATE_ORIGINS` and Papra API key creation), CHANGELOG, media, built ZIP.
9. Run all repository checks; fix everything they report.

## Definition of done

- All repository checks pass: build, `check`, unit tests, e2e tests, `docs:check`.
- The plugin installs in a current Bulwark, connects with a user's Papra key, saves an attachment to a chosen organisation, and attaches a searched document to a draft.
- README explains installation, the required Bulwark environment variable, and the Papra key permissions.
- No secret ever stored in plugin settings, storage or logs.

## Open questions for the owner

- Default tags, a tag that doesn't exist in the target organisation: skip it and tell the user which one (recommended: the users' keys then need no `tags:create`), or create it?
- Default tags need `tags:read` and `documents:update` on each user's key, and `documents:update` lets the key change any document in its organisations. Accept that, or tag only when the key allows it and otherwise save untagged with a notice (recommended: the README asks for both permissions, and a key without them still saves, with a notice)?
- Server lock: until Bulwark supports `originKey` for user credentials, accept the plugin-side check, or pin `origin` in the manifest for your own deployment (recommended: accept the check now, propose the Bulwark change upstream)?
- Upstream: after checking the AI policy, open a pull request or keep it in the fork?
