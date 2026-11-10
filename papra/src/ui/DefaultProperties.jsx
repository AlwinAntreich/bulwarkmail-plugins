import { useEffect, useMemo, useState } from 'react';
import { Checkbox, Field, Input, LinkButton, Row, Select, Stack, Text } from '@plugin-host/ui';
import { DEFAULT_TYPES, ME } from '../lib/properties.js';
import { DEFAULT_PROPERTIES_KEY } from '../lib/background.js';
import { TogglePills } from './PropertyEditor.jsx';

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

/** The value control for a default, by type; choices by option name, a Papra user only as "me". */
function DefaultValue({ def, value, onChange, t }) {
  const label = t('settings.default_value', { name: def.name });
  switch (def.type) {
    case 'number': return <Input type="number" step="any" aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'date': return <Input type="date" aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'boolean': return <Checkbox checked={value === true} onChange={(c) => onChange(!!c)} label={t('prop.yes')} />;
    case 'select':
      return <Select block aria-label={label} value={value ?? ''} onChange={(v) => onChange(v)} options={[{ value: '', label: t('prop.not_set') }, ...def.options.map((n) => ({ value: n, label: n }))]} />;
    case 'multi_select':
      return <TogglePills items={def.options.map((n) => ({ id: n, name: n }))} value={Array.isArray(value) ? value : []} onChange={onChange} label={label} />;
    case 'user_relation': return <Text>{t('settings.default_me')}</Text>;
    default: return <Input type="text" aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
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

  useEffect(() => {
    let cancelled = false;
    api.storage.get(DEFAULT_PROPERTIES_KEY).catch(() => null).then((v) => { if (!cancelled) setDefaults(Array.isArray(v) ? v : []); });
    Promise.all(organizations.map((o) => client.propertyDefinitions(o.id).catch(() => [])))
      .then((all) => { if (!cancelled) setLists(all); });
    return () => { cancelled = true; };
  }, [api, client, organizations]);

  const definitions = useMemo(() => mergeDefinitions(lists || []), [lists]);
  const store = async (next) => {
    setDefaults(next);
    await api.storage.set(DEFAULT_PROPERTIES_KEY, next).catch(() => {});
  };
  if (!defaults || !lists) return null;
  const defOf = (name) => definitions.find((d) => d.name.toLowerCase() === name.toLowerCase());
  const unused = definitions.filter((d) => !defaults.some((x) => x.name.toLowerCase() === d.name.toLowerCase()));

  return (
    <Stack gap={3}>
      {defaults.length === 0 && <Text tone="muted">{t('settings.no_default_properties')}</Text>}
      {defaults.map((entry, i) => {
        const def = defOf(entry.name);
        return (
          <div key={entry.name} role="group" aria-label={entry.name}>
            <Field label={entry.name} hint={def ? undefined : t('settings.property_gone', { name: entry.name })}>
              <Stack gap={1}>
                {def && <DefaultValue def={def} value={entry.value} t={t}
                  onChange={(value) => store(defaults.map((x, j) => (j === i ? { ...x, value } : x)))} />}
                <div><LinkButton onClick={() => store(defaults.filter((_, j) => j !== i))}>{t('settings.remove_default', { name: entry.name })}</LinkButton></div>
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
                <LinkButton onClick={() => { setAdding(false); void store([...defaults, { name: d.name, value: startValue(d) }]); }}>{d.name}</LinkButton>
                <Text tone="muted">{t(`prop.type_${d.type}`)}</Text>
              </Row>
            ))}
          </Stack>
        </div>
      )}
      {definitions.length === 0 && <Text tone="muted">{t('settings.no_properties')}</Text>}
    </Stack>
  );
}
