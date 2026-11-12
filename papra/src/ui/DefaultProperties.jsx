import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Checkbox, Field, Input, LinkButton, Row, Stack, Text } from '@plugin-host/ui';
import { errorText } from '../lib/errors.js';

/** How long after the last change the defaults are saved. */
export const SAVE_DELAY_MS = 800;
import { DEFAULT_TYPES, ME } from '../lib/properties.js';
import { readPrefs, stillOffered, updatePrefs } from '../lib/prefs.js';
import { ChoicePills, TogglePills } from './PropertyEditor.jsx';
import { DateField } from './DateField.jsx';

/**
 * Property definitions of all the user's organisations, merged by name:
 * defaults are kept by property name and apply wherever a property of that
 * name exists. Options are merged by name too.
 */
export function mergeDefinitions(lists) {
  const byName = new Map();
  for (const defs of lists) {
    for (const d of defs) {
      if (!DEFAULT_TYPES.includes(d.type)) continue;
      const key = d.name.toLowerCase();
      const known = byName.get(key);
      if (!known) { byName.set(key, { name: d.name, type: d.type, options: d.options.map((o) => o.name) }); continue; }
      for (const o of d.options) if (!known.options.some((n) => n.toLowerCase() === o.name.toLowerCase())) known.options.push(o.name);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The value control for a default, by type; choices by option name, a Papra
 * user only as "me". Typing waits for a pause (or leaving the field) before
 * saving; a choice saves at once (`onChange(value, true)`).
 */
function DefaultValue({ def, value, onChange, onDone, t, locale }) {
  const label = t('settings.default_value', { name: def.name });
  const now = (v) => onChange(v, true);
  switch (def.type) {
    case 'number': return <Input type="number" step="any" aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)} onBlur={onDone} />;
    case 'date': return <DateField label={label} value={value ?? ''} onChange={now} t={t} locale={locale} />;
    case 'boolean': return <Checkbox checked={value === true} onChange={(c) => now(!!c)} label={t('prop.yes')} />;
    case 'select':
      return <ChoicePills items={def.options.map((n) => ({ id: n, name: n }))} value={value || undefined} onChange={(v) => now(v ?? '')} label={label} />;
    case 'multi_select':
      return <TogglePills items={def.options.map((n) => ({ id: n, name: n }))} value={Array.isArray(value) ? value : []} onChange={now} label={label} />;
    case 'user_relation': return <Text>{t('settings.default_me')}</Text>;
    default: return <Input type="text" aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)} onBlur={onDone} />;
  }
}

const startValue = (def) => (def.type === 'boolean' ? true : def.type === 'multi_select' ? [] : def.type === 'user_relation' ? ME : '');

/**
 * "Default properties" in Settings > Papra: property name and value pairs,
 * kept in api.storage. The dialogs fill them in wherever an organisation has
 * a property of that name; one it lacks is left out with a notice.
 */
export function DefaultProperties({ api, client, organizations, t }) {
  const [defaults, setDefaults] = useState(null);
  const [lists, setLists] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);
  const [removed, setRemoved] = useState([]);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readPrefs(api).then(({ prefs }) => { if (!cancelled) setDefaults(prefs.defaultProperties); }, () => { if (!cancelled) setDefaults([]); });
    Promise.allSettled(organizations.map((o) => client.propertyDefinitions(o.id)))
      .then((all) => {
        if (cancelled) return;
        setLists(all.map((r) => (r.status === 'fulfilled' ? r.value : [])));
        setComplete(all.every((r) => r.status === 'fulfilled'));
      });
    return () => { cancelled = true; };
  }, [api, client, organizations]);

  const definitions = useMemo(() => mergeDefinitions(lists || []), [lists]);
  // Saved a moment after the last change, not per keystroke: the mail
  // account takes at most 20 changes a minute.
  const timer = useRef(null);
  const pending = useRef(null);
  const flush = () => {
    clearTimeout(timer.current);
    timer.current = null;
    if (!pending.current) return;
    const value = pending.current;
    pending.current = null;
    updatePrefs(api, { defaultProperties: value }).then(() => setError(null), (err) => setError(err));
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const store = (next, { now = false } = {}) => {
    setDefaults(next);
    pending.current = next;
    clearTimeout(timer.current);
    if (now) flush(); else timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };
  // Defaults for properties no organisation has any more (deleted in Papra)
  // go, once every organisation answered.
  useEffect(() => {
    if (!defaults || !lists || !complete) return;
    const result = stillOffered(defaults, lists.flat().map((d) => d.name));
    if (!result.removed.length) return;
    setRemoved(result.removed);
    store(result.keep, { now: true });
  }, [defaults, lists, complete]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!defaults || !lists) return null;
  const defOf = (name) => definitions.find((d) => d.name.toLowerCase() === name.toLowerCase());
  const unused = definitions.filter((d) => !defaults.some((x) => x.name.toLowerCase() === d.name.toLowerCase()));

  return (
    <Stack gap={3}>
      {removed.length > 0 && <Text tone="muted">{t('settings.defaults_removed', { properties: removed.join(', ') })}</Text>}
      {defaults.length === 0 && <Text tone="muted">{t('settings.no_default_properties')}</Text>}
      {defaults.map((entry, i) => {
        const def = defOf(entry.name);
        return (
          <div key={entry.name} role="group" aria-label={entry.name}>
            <Field label={entry.name} hint={def ? undefined : t('settings.property_gone', { name: entry.name })}>
              <Stack gap={1}>
                {def && <DefaultValue def={def} value={entry.value} t={t} locale={api.i18n.locale} onDone={flush}
                  onChange={(value, now) => store(defaults.map((x, j) => (j === i ? { ...x, value } : x)), { now })} />}
                <div><LinkButton onClick={() => store(defaults.filter((_, j) => j !== i), { now: true })}>{t('settings.remove_default', { name: entry.name })}</LinkButton></div>
              </Stack>
            </Field>
          </div>
        );
      })}
      {unused.length > 0 && !adding && <div><LinkButton icon="plus" onClick={() => setAdding(true)}>{t('settings.add_default')}</LinkButton></div>}
      {adding && (
        <div role="group" aria-label={t('settings.add_default')}>
          <Stack gap={1}>
            {unused.map((d) => (
              <Row key={d.name} gap={2}>
                <LinkButton onClick={() => { setAdding(false); store([...defaults, { name: d.name, value: startValue(d) }], { now: true }); }}>{d.name}</LinkButton>
                <Text tone="muted">{t(`prop.type_${d.type}`)}</Text>
              </Row>
            ))}
          </Stack>
        </div>
      )}
      {definitions.length === 0 && <Text tone="muted">{t('settings.no_properties')}</Text>}
      {error && <Alert tone="danger" icon="alert-circle">{t('settings.prefs_failed', { error: errorText(t, error) })}</Alert>}
    </Stack>
  );
}
