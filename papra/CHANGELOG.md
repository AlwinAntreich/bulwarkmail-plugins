# Changelog

## Unreleased

## 0.1.2 (2026-11-08)

### Changed
- From Papra: the search box takes Papra's search language as is (tag:, name:, content:, date:, created:, has:, AND, OR, NOT, brackets). The Filter by tag list is gone; quick filters under the search add the organisation's most-used tags, Added this year or Untagged with a click, and Search tips list common forms with a link to Papra's guide.

### Fixed
- After saving, the message lists the tags the document got; a default tag the organisation doesn't have is named separately instead of reading as "saved without tags".
- Settings > Papra no longer says "Connected" when Papra can't be reached, and that error says what the admin should check on the Bulwark server.

## 0.1.1 (2026-11-08)

First version.

### Added
- Save to Papra: save an attachment to a Papra organisation from its menu, with tags. The admin can set default tags (Default tags); the plugin creates no tags and skips one an organisation doesn't have.
- From Papra: in the composer's Attach menu, search Papra by words and tags and attach documents to the message.
- Settings > Papra: connect or disconnect the API key, see what it may do, choose a default organisation.
- Each user connects their own Papra API key, only to the server the admin sets (Papra server URL). If Papra is on a private network, list its origin in PLUGIN_PROXY_PRIVATE_ORIGINS.
