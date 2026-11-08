# Papra

Connects Bulwark to [Papra](https://papra.app), a document archive with
OCR and full-text search:

- **Save to Papra:** save an attachment as a document in one of your Papra
  organisations, with tags.
- **From Papra:** search Papra from the composer and attach a document to
  the message (coming next).

Work in progress: Save to Papra works; From Papra and a settings page are
next. The plan and the decisions are in [docs/PLAN.md](docs/PLAN.md), how it
is built in [docs/architecture.md](docs/architecture.md).

## Setup for the admin

1. Install the plugin and set **Papra server URL** on its page in the admin
   dashboard. Users can only connect to this server.
2. Optionally set **Default tags**, for example `Bulwark`: every document
   saved from Bulwark gets them. Create these tags in each Papra
   organisation; the plugin creates no tags, and skips one an organisation
   doesn't have (the user is told).
3. If Papra is on a private network, Bulwark's plugin proxy has to be
   allowed to reach it. Add its origin to Bulwark's environment:

   ```
   PLUGIN_PROXY_PRIVATE_ORIGINS=https://papra.example.com
   ```

## Setup for users

Create an API key in Papra with these permissions:

| Permission | For |
|---|---|
| `organizations:read` | listing your organisations |
| `documents:read` | searching and attaching documents |
| `documents:create` | saving attachments |
| `tags:read`, `documents:update` | tagging saved documents (optional) |

Without the last two, documents are saved without tags. `documents:update`
also lets the key change the name, date and notes of documents, which you
can do in Papra yourself anyway. A Papra key always covers all your
organisations, private and shared.

The first time you use the plugin it asks you to connect the key; Bulwark
shows a form with the server already filled in. Leave the server as it is:
a key connected to another server isn't used. The key stays on the Bulwark
server; the plugin never sees it.

## Using it

Open an attachment's menu in a message and choose **Save to Papra**. Pick
the organisation (the last one you used is preselected) and any tags; the
admin's default tags are already ticked. Bulwark reads attachments up to
25 MB. If Papra already has the file, you are told so.

## Permissions

| Permission | Why |
|---|---|
| `http:proxy` | talk to Papra with your API key |
| `email:read` | the "Save to Papra" entry in each attachment's menu |
| `email:blob-read` | read the attachment you save |
| `ui:observe` | the dialog where you choose the organisation and tags |
