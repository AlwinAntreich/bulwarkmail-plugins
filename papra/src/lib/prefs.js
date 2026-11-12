// The user's Papra preferences: the default organisation, the default
// properties and the user's own Papra account (for "me"). Kept with the
// mail account where the server allows it (api.accountData: Stalwart's
// mailbox metadata, so every browser and device sees the same), otherwise in
// this browser (api.storage). The browser copy is also a cache, and what a
// first sync moves to the account.

/** Preference fields: the api.storage key of each. */
export const PREF_KEYS = ['defaultOrganizationId', 'defaultProperties', 'papraUser'];

/** A stored value as preferences, without unknown or malformed fields. */
export function normalizePrefs(value) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    defaultOrganizationId: typeof v.defaultOrganizationId === 'string' && v.defaultOrganizationId ? v.defaultOrganizationId : null,
    defaultProperties: Array.isArray(v.defaultProperties)
      ? v.defaultProperties.filter((p) => p && typeof p.name === 'string' && p.name).map((p) => ({ name: p.name, value: p.value }))
      : [],
    papraUser: v.papraUser && typeof v.papraUser.id === 'string' ? { id: v.papraUser.id } : null,
  };
}

const isEmpty = (p) => !p.defaultOrganizationId && p.defaultProperties.length === 0 && !p.papraUser;

/** What goes to api.accountData: only fields that are set, to keep within its 4 KB. */
function compact(prefs) {
  const out = {};
  if (prefs.defaultOrganizationId) out.defaultOrganizationId = prefs.defaultOrganizationId;
  if (prefs.defaultProperties.length) out.defaultProperties = prefs.defaultProperties;
  if (prefs.papraUser) out.papraUser = prefs.papraUser;
  return out;
}

async function readLocal(api) {
  const entries = await Promise.all(PREF_KEYS.map(async (k) => [k, await api.storage.get(k).catch(() => null)]));
  return normalizePrefs(Object.fromEntries(entries));
}

async function writeLocal(api, prefs) {
  await Promise.all(PREF_KEYS.map((k) => {
    const v = prefs[k];
    const unset = v === null || (Array.isArray(v) && v.length === 0);
    return (unset ? api.storage.remove(k) : api.storage.set(k, v)).catch(() => {});
  }));
}

/** The account's copy, or null where the server keeps none (or can't be asked). */
async function readAccount(api) {
  try {
    const data = await api.accountData.get();
    return data?.supported ? { value: data.value } : null;
  } catch {
    return null;
  }
}

/**
 * The preferences, and whether they follow the user across devices. The
 * first time the account keeps none but this browser does, they are moved
 * to the account.
 * @returns {Promise<{ prefs: object, synced: boolean }>}
 */
export async function readPrefs(api) {
  const local = await readLocal(api);
  const account = await readAccount(api);
  if (!account) return { prefs: local, synced: false };
  const remote = normalizePrefs(account.value);
  if (account.value == null && !isEmpty(local)) {
    try {
      await api.accountData.set(undefined, compact(local));
      return { prefs: local, synced: true };
    } catch {
      return { prefs: local, synced: false };
    }
  }
  await writeLocal(api, remote);
  return { prefs: remote, synced: true };
}

/**
 * Change some preferences. Reads the account's copy again right before
 * writing, so a change made on another device meanwhile isn't lost; keeps
 * the browser copy in step. Throws when the account refuses the value (too
 * large, too many changes), after saving it in this browser.
 * @returns {Promise<{ prefs: object, synced: boolean }>}
 */
export async function updatePrefs(api, patch) {
  const account = await readAccount(api);
  const base = account && account.value != null ? normalizePrefs(account.value) : await readLocal(api);
  const next = normalizePrefs({ ...base, ...patch });
  await writeLocal(api, next);
  if (!account) return { prefs: next, synced: false };
  await api.accountData.set(undefined, compact(next));
  return { prefs: next, synced: true };
}

/** The defaults whose property some organisation still has (by name), and the names of the others. */
export function stillOffered(defaults, propertyNames) {
  const known = new Set([...propertyNames].map((n) => String(n).toLowerCase()));
  const keep = defaults.filter((d) => known.has(d.name.toLowerCase()));
  return { keep, removed: defaults.filter((d) => !keep.includes(d)).map((d) => d.name) };
}

/**
 * Remove the default properties none of the user's organisations has any
 * more (deleted in Papra). Asks every organisation; when one can't be asked,
 * nothing is removed, as its properties are unknown.
 * @returns {Promise<string[]>} the names removed
 */
export async function pruneDefaults(api, client) {
  const organizations = await client.organizations();
  const lists = await Promise.all(organizations.map((o) => client.propertyDefinitions(o.id)));
  const { prefs } = await readPrefs(api);
  const { keep, removed } = stillOffered(prefs.defaultProperties, lists.flat().map((d) => d.name));
  if (removed.length) await updatePrefs(api, { defaultProperties: keep });
  return removed;
}
