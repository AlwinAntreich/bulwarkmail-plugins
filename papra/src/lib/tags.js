// The admin's default tags: names in the plugin config, matched against the
// tags of the organisation a document goes to. The plugin never creates tags.

/** "Bulwark, invoice ,,Bulwark" → ["Bulwark", "invoice"]: trimmed, without empties and repeats (case-insensitive). */
export function parseTagList(value) {
  const seen = new Set();
  const out = [];
  for (const raw of String(value ?? '').split(',')) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * The organisation's tags for these names (Papra compares tag names
 * case-insensitively), and the names it doesn't have.
 * @returns {{ tags: Array<{ id: string, name: string }>, missing: string[] }}
 */
export function matchTags(names, organizationTags) {
  const byName = new Map((organizationTags || []).map((t) => [t.name.toLowerCase(), t]));
  const tags = [];
  const missing = [];
  for (const name of names || []) {
    const tag = byName.get(name.toLowerCase());
    if (tag) tags.push(tag); else missing.push(name);
  }
  return { tags, missing };
}
