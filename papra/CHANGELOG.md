# Changelog

## Unreleased

## 0.1.1 (2026-11-08)

First version.

### Added
- Save to Papra: save an attachment to a Papra organisation from its menu, with tags. The admin can set default tags (Default tags); the plugin creates no tags and skips one an organisation doesn't have.
- From Papra: in the composer's Attach menu, search Papra by words and tags and attach documents to the message.
- Settings > Papra: connect or disconnect the API key, see what it may do, choose a default organisation.
- Each user connects their own Papra API key, only to the server the admin sets (Papra server URL). If Papra is on a private network, list its origin in PLUGIN_PROXY_PRIVATE_ORIGINS.
