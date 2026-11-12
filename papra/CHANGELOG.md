# Changelog

## Unreleased

### Added
- After saving, the message has Open in Papra, which opens the new document in Papra to change it there. The message is a notification, so the plugin asks for the permission ui:notifications.

### Fixed
- Date properties can be set: the date field showed no picker and couldn't be changed in Chrome or Firefox; it is now day, month and year lists with Today.
- Default properties whose property was deleted in Papra, and that no organisation has any more, are removed from the defaults, and the user is told.

### Changed
- Save to Papra's Properties tab shows each property as a row with its field, changed in place; Add property is a list that adds a row. Dates show in your language.
- Save to Papra says when the API key can't set properties and what to do, instead of leaving them out without a word; Settings > Papra says how to connect a key that can.

## 0.1.3 (2026-11-10)

### Added
- Save to Papra sets Papra properties: a Properties tab shows what will be set as "name: value", a click changes or removes one for this document, and Add property offers the organisation's other properties with a field for each type (text, number, date, yes/no, choice, multiple choice, Papra user, linked document). The API key needs custom-properties:read; without it the window has no properties.
- Settings > Papra: default properties by name, such as Owner or Category, filled in wherever an organisation has that property. A property or option an organisation lacks is left out and named after saving; the plugin creates nothing in Papra.

### Changed
- Save to Papra has two tabs, Where and tags and Properties, with a line saying what Papra will get. Tags are pills: the admin's defaults fixed, the organisation's five most-used, and "+ n more" for the rest.
- The default organisation and default properties are kept with the mail account, so they follow the user to other browsers and devices (Stalwart 1.0 and later; older servers keep them in the browser, and Settings says which). This needs the new permission email:write; the plugin changes no messages with it.

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
