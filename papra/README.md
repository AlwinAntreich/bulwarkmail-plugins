# Papra

Connects Bulwark to [Papra](https://papra.app), a document archive with
OCR and full-text search:

- **Save to Papra:** save an attachment as a document in one of your Papra
  organisations, with tags.
- **From Papra:** search Papra from the composer, filter by tag and attach
  documents to the message.

![Save to Papra](media/screenshots/1-save.webp)

The plan and the decisions are in [docs/PLAN.md](docs/PLAN.md), how it is built in
[docs/architecture.md](docs/architecture.md).

## Install without the extension directory

The plugin isn't in Bulwark's extension directory yet. Install its ZIP by
hand; you need Bulwark 1.15.0 or later and its admin password.

1. **Get the ZIP.** Each release commits it as `papra/papra.zip`, tagged
   `papra@<version>` in this repository: download it from that tag. Or
   build it from a checkout, with Node 24:

   ```
   npm ci
   node scripts/build.mjs papra        # writes papra/papra.zip
   ```

2. **Turn on plugins** in Bulwark's admin dashboard, if they are off.
3. **Upload the ZIP** in the admin dashboard under Plugins, and turn it on:
   for everyone, or for each user to turn on in Settings > Plugins. An
   admin-installed plugin asks users for no consent.
4. **Set it up** as below: the Papra server URL, optionally default tags,
   and `PLUGIN_PROXY_PRIVATE_ORIGINS` when Papra is on a private network.
   Restart Bulwark after changing its environment.
5. **Update** by uploading the ZIP of the newer version the same way. The
   admin's settings, the users' connected keys and their default
   organisations stay. Removing the plugin drops the admin's settings.

Users can also upload the ZIP themselves in Settings > Plugins when the
admin allows it; Bulwark then asks them to confirm the permissions, and
may wait for the admin's approval. A user upload still needs the admin's
Papra server URL.

For development, start Bulwark from its source with `PLUGIN_DEV_DIR`
pointing at a checkout of this repository: it builds the plugin from
`papra/src` on each page load (see [WRITING_PLUGINS.md](../WRITING_PLUGINS.md#quick-start)).

## Setup for the admin

1. Install the plugin and set **Papra server URL** on its page in the admin
   dashboard. Users can only connect to this server.
2. Optionally set **Default tags**, for example `Bulwark`: every document
   saved from Bulwark gets them. Create these tags in each Papra
   organisation; the plugin creates no tags, and skips one an organisation
   doesn't have (the user is told).
3. Only if Papra's address resolves to a private one from the Bulwark
   server (a LAN or VPN address such as `10.x`, `192.168.x`, or
   `localhost`): Bulwark's plugin proxy refuses private addresses unless
   the admin lists the origin. Add it to Bulwark's environment and restart
   Bulwark:

   ```
   PLUGIN_PROXY_PRIVATE_ORIGINS=https://papra.example.com
   ```

   This is a Bulwark setting, not a Papra one: a comma-separated list for
   all plugins, compared by exact origin (scheme, host and port). Any
   plugin whose user connects an account to that origin may then reach it,
   so list only what you mean to. Check what the name resolves to on the
   Bulwark server, for example with `getent hosts papra.example.com`; a
   public address needs no entry.

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

Connect the key in Settings > Papra, or when the plugin first asks for it;
Bulwark shows a form with the server already filled in. Leave the server as it is:
a key connected to another server isn't used. The key stays on the Bulwark
server; the plugin never sees it.

## Using it

In Settings > Papra you can choose a default organisation; the dialogs
preselect it. Without one, you pick the organisation each time, so nothing
lands in a shared organisation by accident. The same page shows what your
key may do and disconnects it.

Open an attachment's menu in a message and choose **Save to Papra**. Pick
the organisation and any tags; the admin's default tags are already
ticked. Bulwark reads attachments up to
25 MB. If Papra already has the file, you are told so.

Writing a message, open **Attach** and choose **From Papra**. Search by
words in a document's name or text, narrow the list with **Filter by tag**
(several tags must all match), tick the documents and press **Attach**. Picked documents stay listed
above the results while you search on.

![Attach from Papra, dark theme](media/screenshots/2-attach-dark.webp)
![Settings > Papra](media/screenshots/3-settings.webp)
Each result shows its tags. Documents over 25 MB can't be attached this
way.

## Permissions

| Permission | Why |
|---|---|
| `http:proxy` | talk to Papra with your API key |
| `email:read` | the "Save to Papra" entry in each attachment's menu |
| `email:blob-read` | read the attachment you save |
| `ui:composer-toolbar` | the "From Papra" entry in the composer's Attach menu |
| `email:blob-write` | add the documents you pick to the message |
| `ui:observe` | the dialogs where you choose the organisation, tags and documents |
| `ui:settings-section` | the Papra page in Settings: connection and default organisation |
