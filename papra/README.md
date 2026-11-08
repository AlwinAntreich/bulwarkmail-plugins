# Papra

Connects Bulwark to [Papra](https://papra.app), a document archive with
OCR and full-text search:

- **Save to Papra:** save an attachment as a document in one of your Papra
  organisations.
- **From Papra:** search Papra from the composer and attach a document to
  the message.

Work in progress: this version sets up the connection only. The plan and
the decisions are in [docs/PLAN.md](docs/PLAN.md).

## Setup for the admin

1. Install the plugin and set **Papra server URL** on its page in the admin
   dashboard. Users can only connect to this server.
2. If Papra is on a private network, Bulwark's plugin proxy has to be
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

The key may cover all your organisations or only some. Connect it in
Bulwark when the plugin asks for it. The key stays on the Bulwark server;
the plugin never sees it.

## Permissions

| Permission | Why |
|---|---|
| `http:proxy` | talk to Papra with your API key |
