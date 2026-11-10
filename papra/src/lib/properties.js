// Papra's custom properties: the definitions an organisation has, the values
// the dialog works with, and what goes to Papra's API. The plugin creates no
// properties or options; a default the organisation lacks is left out.
//
// Values in the dialog, by type:
//   text, number       string as typed
//   date               'YYYY-MM-DD'
//   boolean            true | false
//   select             option id
//   multi_select       [option id]
//   user_relation      [{ id, name }]
//   document_relation  [{ id, name }]

export const TYPES = ['text', 'number', 'date', 'boolean', 'select', 'multi_select', 'user_relation', 'document_relation'];

/** Types a default in Settings can have. A linked document makes no sense as a default. */
export const DEFAULT_TYPES = ['text', 'number', 'date', 'boolean', 'select', 'multi_select', 'user_relation'];

/** The user's own Papra account in a default for a Papra user property. */
export const ME = 'me';

const str = (v) => (typeof v === 'string' ? v : '');

/** Papra's property definitions, reduced to what the plugin uses, in Papra's order. Unknown types are dropped. */
export function definitionsOf(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((d) => d && TYPES.includes(d.type) && d.id)
    .map((d) => ({
      id: String(d.id),
      name: str(d.name),
      key: str(d.key),
      type: d.type,
      order: Number.isFinite(d.displayOrder) ? d.displayOrder : 0,
      options: (Array.isArray(d.options) ? d.options : []).map((o) => ({ id: String(o.id), name: str(o.name) })),
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

const empty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Whether a dialog value will set the property. A switch that is off still sets "no". */
export function isSet(def, value) {
  if (def.type === 'boolean') return typeof value === 'boolean';
  if (def.type === 'number') return !empty(value) && Number.isFinite(Number(String(value).replace(',', '.')));
  if (def.type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(str(value));
  return !empty(typeof value === 'string' ? value.trim() : value);
}

/** The value as Papra's API takes it, or undefined when it sets nothing (checked against Papra 26.7.1). */
export function apiValue(def, value) {
  if (!isSet(def, value)) return undefined;
  switch (def.type) {
    case 'text': return String(value).trim();
    case 'number': return Number(String(value).replace(',', '.'));
    case 'date': return value;
    case 'boolean': return value;
    case 'select': return def.options.some((o) => o.id === value) ? value : undefined;
    case 'multi_select': {
      const ids = value.filter((id) => def.options.some((o) => o.id === id));
      return ids.length ? ids : undefined;
    }
    case 'user_relation':
    case 'document_relation': return value.map((x) => x.id);
    default: return undefined;
  }
}

/** A dialog value in words, for chips, the review line and the toast. */
export function describe(def, value, t) {
  if (!isSet(def, value)) return '';
  const option = (id) => def.options.find((o) => o.id === id)?.name || '';
  switch (def.type) {
    case 'boolean': return value ? t('prop.yes') : t('prop.no');
    case 'select': return option(value);
    case 'multi_select': return value.map(option).filter(Boolean).join(', ');
    case 'user_relation':
    case 'document_relation': return value.map((x) => x.name).filter(Boolean).join(', ');
    default: return String(value).trim();
  }
}

/**
 * The user's defaults (by property name, choices by option name) as dialog
 * values for one organisation's definitions. A property the organisation
 * doesn't define, or a choice it doesn't offer, goes into `missing`.
 * `me` is the user's Papra account ({ id, name }) when the plugin knows it.
 * @param {Array<{ name: string, value: unknown }>} defaults
 * @returns {{ values: Record<string, unknown>, missing: string[] }}
 */
export function applyDefaults(defaults, definitions, me = null) {
  const values = {};
  const missing = [];
  for (const { name, value } of defaults || []) {
    const def = definitions.find((d) => d.name.toLowerCase() === String(name).toLowerCase());
    if (!def || !DEFAULT_TYPES.includes(def.type)) { missing.push(name); continue; }
    const byName = (n) => def.options.find((o) => o.name.toLowerCase() === String(n).toLowerCase())?.id;
    let v;
    if (def.type === 'select') v = byName(value);
    else if (def.type === 'multi_select') {
      const names = Array.isArray(value) ? value : [];
      const ids = names.map(byName);
      if (ids.some((id) => !id)) { missing.push(`${def.name}: ${names.filter((n, i) => !ids[i]).join(', ')}`); }
      v = ids.filter(Boolean);
    } else if (def.type === 'user_relation') v = value === ME && me ? [me] : undefined;
    else v = value;
    if (def.type === 'select' && !v) { missing.push(`${def.name}: ${value}`); continue; }
    if (def.type === 'user_relation' && !v) continue; // "me" is known after the first upload
    if (isSet(def, v)) values[def.id] = v;
  }
  return { values, missing };
}

/** Papra users named in documents' Papra user properties, for the Papra user field; Papra lists members only to signed-in users, not to keys. */
export function usersIn(documents) {
  const byId = new Map();
  for (const d of documents || []) {
    for (const p of Array.isArray(d?.customProperties) ? d.customProperties : []) {
      if (p?.type !== 'user_relation' || !Array.isArray(p.value)) continue;
      for (const u of p.value) if (u?.userId && !byId.has(u.userId)) byId.set(u.userId, { id: String(u.userId), name: str(u.name) || str(u.email) });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
