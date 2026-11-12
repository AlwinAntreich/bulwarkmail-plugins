import { useEffect, useMemo, useState } from 'react';
import { Alert, Chip, DialogButtons, Field, LinkButton, Row, Select, Spinner, Stack, Tabs, Text } from '@plugin-host/ui';
import { getApi, formatSize } from './host.js';
import { clientFor } from '../lib/connection.js';
import { errorText } from '../lib/errors.js';
import { matchTags } from '../lib/tags.js';
import { apiValue, applyDefaults, describe, isSet, usersIn } from '../lib/properties.js';
import { organizationOptions, preselect } from './organizations.js';
import { PropertyEditor } from './PropertyEditor.jsx';

/** Tag pills shown before "+ n more": the organisation's most-used tags. */
export const TOP_TAGS = 5;

/**
 * The "Save to Papra" dialog. "Where and tags": the organisation, the
 * admin's default tags (fixed) and the organisation's tags as pills, the
 * most used first. "Properties" (with custom-properties:read): a row per
 * property to set, its name and its field, edited in place; the user's
 * defaults start as rows, × takes one off, "Add property" adds a row. A
 * review line under both says what Papra will get. Hands the choice back
 * with onResult; the background reads the attachment and saves it.
 */
export function SaveDialog({
  api = getApi(), attachment = {}, connection, canTag = false, defaultTags = [], organizationId = null,
  canSetProperties = false, defaultProperties = [], me = null, onResult,
}) {
  const t = (key, vars) => api.i18n.t(key, vars);
  const client = useMemo(() => clientFor(api, connection), [api, connection]);
  const [organizations, setOrganizations] = useState(null);
  const [selected, setSelected] = useState(null);
  const [tags, setTags] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [allTags, setAllTags] = useState(false);
  const [definitions, setDefinitions] = useState(null);
  const [values, setValues] = useState({});
  const [missingProperties, setMissingProperties] = useState([]);
  const [users, setUsers] = useState([]);
  // The properties shown as rows, in Papra's order; the defaults to start with.
  const [shown, setShown] = useState(() => new Set());
  const [fromDefaults, setFromDefaults] = useState({});
  const [tab, setTab] = useState('where');
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const meUser = me?.id ? { id: me.id, name: t('prop.me') } : null;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    client.organizations().then((list) => {
      if (cancelled) return;
      setOrganizations(list);
      setSelected((prev) => prev || preselect(list, organizationId));
    }, (err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
  }, [client, organizationId, attempt]);

  useEffect(() => {
    if (!selected || !canTag) return undefined;
    let cancelled = false;
    setTags(null);
    setPicked(new Set());
    setAllTags(false);
    client.tags(selected).then((list) => { if (!cancelled) setTags(list); }, (err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
  }, [client, selected, canTag, attempt]);

  // The organisation's properties, with the user's defaults filled in.
  useEffect(() => {
    if (!selected || !canSetProperties) return undefined;
    let cancelled = false;
    setDefinitions(null);
    client.propertyDefinitions(selected).then((defs) => {
      if (cancelled) return;
      const applied = applyDefaults(defaultProperties, defs, meUser);
      setDefinitions(defs);
      setValues(applied.values);
      setFromDefaults(applied.values);
      setShown(new Set(Object.keys(applied.values)));
      setMissingProperties(applied.missing);
    }, (err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
  }, [client, selected, canSetProperties, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Papra users for a Papra user property: the user, and those named on the latest documents.
  const needsUsers = !!definitions?.some((d) => d.type === 'user_relation');
  useEffect(() => {
    if (!selected || !needsUsers) return undefined;
    let cancelled = false;
    client.searchDocuments(selected, {}, 0, 100).then((found) => {
      if (cancelled) return;
      const seen = usersIn(found.documents).filter((u) => u.id !== meUser?.id);
      setUsers(meUser ? [meUser, ...seen] : seen);
    }, () => { if (!cancelled) setUsers(meUser ? [meUser] : []); });
    return () => { cancelled = true; };
  }, [client, selected, needsUsers]); // eslint-disable-line react-hooks/exhaustive-deps

  const defaults = useMemo(() => matchTags(defaultTags, tags || []), [defaultTags, tags]);
  const defaultIds = new Set(defaults.tags.map((tag) => tag.id));
  const organization = organizations?.find((o) => o.id === selected);
  const ready = !!organization && (!canTag || !!tags) && (!canSetProperties || !!definitions);

  const toggleTag = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const byUse = [...(tags || [])].filter((tag) => !defaultIds.has(tag.id)).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const shownTags = allTags ? byUse : byUse.filter((tag, i) => i < TOP_TAGS || picked.has(tag.id));
  const hiddenTags = byUse.length - shownTags.length;

  const rows = (definitions || []).filter((d) => shown.has(d.id));
  const setDefs = rows.filter((d) => isSet(d, values[d.id]));
  const addable = (definitions || []).filter((d) => !shown.has(d.id));
  const setValue = (id, value) => setValues((prev) => ({ ...prev, [id]: value }));
  const addRow = (id) => {
    const def = definitions.find((d) => d.id === id);
    if (!def) return;
    setShown((prev) => new Set([...prev, id]));
    // A yes/no starts at yes: adding it means setting it.
    if (def.type === 'boolean') setValue(id, true);
  };
  const removeRow = (id) => {
    setShown((prev) => { const next = new Set(prev); next.delete(id); return next; });
    setValues((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };
  const locale = api.i18n.locale;
  const isDefault = (d) => d.id in fromDefaults && JSON.stringify(fromDefaults[d.id]) === JSON.stringify(values[d.id]);
  const tagIds = canTag ? [...defaultIds, ...[...picked].filter((id) => !defaultIds.has(id))] : [];
  const tagName = (id) => tags?.find((tag) => tag.id === id)?.name || '';

  const review = organization ? [
    organization.name,
    tagIds.length ? t('done.tags', { tags: tagIds.map(tagName).join(', ') }) : '',
    ...setDefs.map((d) => `${d.name}: ${describe(d, values[d.id], t, locale)}`),
  ].filter(Boolean).join(' · ') : '';

  const submit = () => {
    if (!ready) return;
    onResult?.({
      organizationId: organization.id,
      organizationName: organization.name,
      tagIds,
      tagNames: tagIds.map(tagName),
      missingDefaults: canTag ? defaults.missing : [],
      properties: canSetProperties
        ? setDefs.map((d) => ({ id: d.id, name: d.name, value: apiValue(d, values[d.id]), text: describe(d, values[d.id], t, locale) })).filter((p) => p.value !== undefined)
        : [],
      missingProperties: canSetProperties ? missingProperties : [],
    });
  };

  const buttons = [
    { id: 'cancel', label: t('common.cancel'), variant: 'secondary' },
    { id: 'save', label: t('save.button'), variant: 'primary', disabled: !ready },
  ];
  const onButton = (id) => (id === 'save' ? submit() : onResult?.(null));

  const whereTab = (
    <Stack gap={4}>
      {organizations && organizations.length > 0 && (
        <Field label={t('field.organization')}>
          <Select block value={selected || ''} onChange={(value) => setSelected(value || null)}
            options={organizationOptions(organizations, selected, t)} />
        </Field>
      )}
      {organization && !canTag && <Alert tone="info" icon="info-circle">{t('save.cannot_tag')}</Alert>}
      {organization && !canSetProperties && <Alert tone="info" icon="info-circle">{t('save.cannot_set_properties')}</Alert>}
      {organization && canTag && !tags && !error && <Spinner size="sm" label={t('common.loading')} />}
      {organization && canTag && tags && (
        <div role="group" aria-label={t('field.tags')}>
          <Stack gap={2}>
            <Text>{t('field.tags')}</Text>
            {tags.length === 0 && <Text tone="muted">{t('save.no_tags')}</Text>}
            <Row gap={2}>
              {defaults.tags.map((tag) => <Chip key={tag.id} label={`✓ ${tag.name}`} title={t('save.default_tag')} />)}
              {shownTags.map((tag) => (
                <Chip key={tag.id} label={picked.has(tag.id) ? `✓ ${tag.name}` : tag.name} detail={tag.count ? String(tag.count) : undefined}
                  onClick={() => toggleTag(tag.id)} />
              ))}
              {hiddenTags > 0 && <Chip label={t('save.more_tags', { count: hiddenTags })} onClick={() => setAllTags(true)} />}
            </Row>
            {defaults.missing.length > 0 && (
              <Text tone="muted">{t('save.missing_defaults', { tags: defaults.missing.join(', '), organization: organization.name })}</Text>
            )}
          </Stack>
        </div>
      )}
    </Stack>
  );

  const propsTab = (
    <Stack gap={3}>
      {!definitions && !error && <Spinner size="sm" label={t('common.loading')} />}
      {definitions && definitions.length === 0 && <Text tone="muted">{t('save.no_properties', { organization: organization?.name || '' })}</Text>}
      {rows.map((d) => (
        <div key={d.id} role="group" aria-label={d.name}>
          <Stack gap={1}>
            <Field label={d.name}>
              <PropertyEditor bare def={d} value={values[d.id]} onChange={(v) => setValue(d.id, v)}
                users={users} client={client} organizationId={selected} t={t} locale={locale} />
            </Field>
            <Row gap={3}>
              {isDefault(d) && <Text tone="muted">{t('save.from_default')}</Text>}
              <LinkButton aria-label={t('save.remove_property', { name: d.name })} onClick={() => removeRow(d.id)}>{t('save.remove')}</LinkButton>
            </Row>
          </Stack>
        </div>
      ))}
      {definitions && addable.length > 0 && (
        <div role="group" aria-label={t('save.add_property')}>
          <Stack gap={2}>
            <Text>{t('save.add_property')}</Text>
            <Row gap={2}>
              {addable.map((d) => (
                <Chip key={d.id} label={`+ ${d.name}`} title={t(`prop.type_${d.type}`)} onClick={() => addRow(d.id)} />
              ))}
            </Row>
          </Stack>
        </div>
      )}
      {missingProperties.length > 0 && organization && (
        <Text tone="muted">{t('save.missing_properties', { properties: missingProperties.join(', '), organization: organization.name })}</Text>
      )}
    </Stack>
  );

  return (
    <Stack gap={4}>
      <Text tone="muted">{t('save.file', { name: attachment.name || '', size: formatSize(attachment.size) })}</Text>
      {error && (
        <Alert tone="danger" icon="alert-circle" action={<LinkButton onClick={() => setAttempt((n) => n + 1)}>{t('common.retry')}</LinkButton>}>
          {errorText(t, error)}
        </Alert>
      )}
      {!organizations && !error && <Spinner size="sm" label={t('common.loading')} />}
      {organizations && organizations.length === 0 && <Alert tone="warning" icon="alert-triangle">{t('save.no_organizations')}</Alert>}
      {canSetProperties && organization ? (
        <>
          <Tabs label={t('dialog.title')} value={tab} onChange={setTab}
            tabs={[{ id: 'where', label: t('save.tab_where') }, { id: 'props', label: t('save.tab_properties'), count: setDefs.length }]} />
          {tab === 'where' ? whereTab : propsTab}
        </>
      ) : whereTab}
      {review && (canSetProperties || tagIds.length > 0) && <Text tone="muted">{review}</Text>}
      <DialogButtons buttons={buttons} onClick={onButton} />
    </Stack>
  );
}
