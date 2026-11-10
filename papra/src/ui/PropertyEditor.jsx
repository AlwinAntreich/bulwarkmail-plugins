import { useEffect, useState } from 'react';
import { Checkbox, Chip, Field, Input, LinkButton, Row, Select, Stack, Text } from '@plugin-host/ui';

/** Pills to switch on and off: `items` [{ id, name }], `value` the ids (or objects with ids) switched on. */
export function TogglePills({ items, value = [], onChange, label, idOf = (x) => x }) {
  const on = new Set(value.map(idOf));
  return (
    <div role="group" aria-label={label}>
      <Row gap={2}>
        {items.map((item) => (
          <Chip key={item.id} label={on.has(item.id) ? `✓ ${item.name}` : item.name}
            onClick={() => onChange(on.has(item.id) ? value.filter((v) => idOf(v) !== item.id) : [...value, item.chosen ?? item.id])} />
        ))}
      </Row>
    </div>
  );
}

/** Pick documents of the organisation by searching Papra, for a linked-document property. */
function DocumentPicker({ client, organizationId, value, onChange, t }) {
  const [text, setText] = useState('');
  const [hits, setHits] = useState([]);
  useEffect(() => {
    if (!text.trim()) { setHits([]); return undefined; }
    let cancelled = false;
    const timer = setTimeout(() => {
      client.searchDocuments(organizationId, { text: text.trim() }, 0, 5)
        .then((found) => { if (!cancelled) setHits(found.documents); }, () => { if (!cancelled) setHits([]); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [client, organizationId, text]);
  const chosen = new Set(value.map((d) => d.id));
  return (
    <Stack gap={2}>
      {value.length > 0 && (
        <Row gap={2}>
          {value.map((d) => <Chip key={d.id} label={d.name} onRemove={() => onChange(value.filter((x) => x.id !== d.id))} removeLabel={t('prop.unlink', { name: d.name })} />)}
        </Row>
      )}
      <Input type="search" value={text} placeholder={t('prop.find_document')} aria-label={t('prop.find_document')} onChange={(e) => setText(e.target.value)} />
      {hits.filter((d) => !chosen.has(d.id)).map((d) => (
        <div key={d.id}><LinkButton onClick={() => { onChange([...value, { id: d.id, name: d.name }]); setText(''); }}>{d.name}</LinkButton></div>
      ))}
    </Stack>
  );
}

/**
 * The control for one property's value, by its type (see properties.js for
 * the value forms). `users` are the Papra users the plugin knows, for a
 * Papra user property.
 */
export function PropertyEditor({ def, value, onChange, users = [], client, organizationId, t }) {
  const label = def.name;
  switch (def.type) {
    case 'text':
      return <Field label={label}><Input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} /></Field>;
    case 'number':
      return <Field label={label}><Input type="number" step="any" value={value ?? ''} onChange={(e) => onChange(e.target.value)} /></Field>;
    case 'date':
      return <Field label={label}><Input type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} /></Field>;
    case 'boolean':
      return <Checkbox checked={value === true} onChange={(checked) => onChange(!!checked)} label={label} />;
    case 'select':
      return (
        <Field label={label}>
          <Select block value={value ?? ''} onChange={(v) => onChange(v || undefined)}
            options={[{ value: '', label: t('prop.not_set') }, ...def.options.map((o) => ({ value: o.id, label: o.name }))]} />
        </Field>
      );
    case 'multi_select':
      return (
        <Stack gap={1}>
          <Text>{label}</Text>
          <TogglePills items={def.options} value={value ?? []} onChange={onChange} label={label} />
        </Stack>
      );
    case 'user_relation':
      return (
        <Stack gap={1}>
          <Text>{label}</Text>
          {users.length > 0
            ? <TogglePills items={users.map((u) => ({ ...u, chosen: u }))} value={value ?? []} onChange={onChange} label={label} idOf={(u) => u.id} />
            : null}
          <Text tone="muted">{t('prop.users_hint')}</Text>
        </Stack>
      );
    case 'document_relation':
      return (
        <Stack gap={1}>
          <Text>{label}</Text>
          <DocumentPicker client={client} organizationId={organizationId} value={value ?? []} onChange={onChange} t={t} />
        </Stack>
      );
    default:
      return null;
  }
}
