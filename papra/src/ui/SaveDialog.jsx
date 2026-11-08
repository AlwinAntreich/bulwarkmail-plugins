import { useEffect, useMemo, useState } from 'react';
import { Alert, Checkbox, DialogButtons, Field, LinkButton, Select, Spinner, Stack, Text } from '@plugin-host/ui';
import { getApi, formatSize } from './host.js';
import { clientFor } from '../lib/connection.js';
import { errorText } from '../lib/errors.js';
import { matchTags } from '../lib/tags.js';

/**
 * The "Save to Papra" dialog: which organisation, and which tags on top of
 * the admin's default tags. Hands the choice back with onResult; the
 * background reads the attachment and uploads it.
 */
export function SaveDialog({ api = getApi(), attachment = {}, connection, canTag = false, defaultTags = [], organizationId = null, onResult }) {
  const t = (key, vars) => api.i18n.t(key, vars);
  const client = useMemo(() => clientFor(api, connection), [api, connection]);
  const [organizations, setOrganizations] = useState(null);
  const [selected, setSelected] = useState(null);
  const [tags, setTags] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    client.organizations().then((list) => {
      if (cancelled) return;
      setOrganizations(list);
      setSelected((prev) => prev || (list.some((o) => o.id === organizationId) ? organizationId : list[0]?.id || null));
    }, (err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
  }, [client, organizationId, attempt]);

  useEffect(() => {
    if (!selected || !canTag) return undefined;
    let cancelled = false;
    setTags(null);
    setPicked(new Set());
    client.tags(selected).then((list) => { if (!cancelled) setTags(list); }, (err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
  }, [client, selected, canTag, attempt]);

  const defaults = useMemo(() => matchTags(defaultTags, tags || []), [defaultTags, tags]);
  const defaultIds = new Set(defaults.tags.map((tag) => tag.id));
  const organization = organizations?.find((o) => o.id === selected);
  const ready = !!organization && (!canTag || !!tags);

  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submit = () => {
    if (!ready) return;
    onResult?.({
      organizationId: organization.id,
      organizationName: organization.name,
      tagIds: canTag ? [...defaultIds, ...[...picked].filter((id) => !defaultIds.has(id))] : [],
      missingDefaults: canTag ? defaults.missing : [],
    });
  };

  const buttons = [
    { id: 'cancel', label: t('common.cancel'), variant: 'secondary' },
    { id: 'save', label: t('save.button'), variant: 'primary', disabled: !ready },
  ];
  const onButton = (id) => (id === 'save' ? submit() : onResult?.(null));

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
      {organizations && organizations.length > 0 && (
        <Field label={t('field.organization')}>
          <Select block value={selected || ''} onChange={(value) => setSelected(value)}
            options={organizations.map((o) => ({ value: o.id, label: o.name }))} />
        </Field>
      )}
      {organization && !canTag && <Alert tone="info" icon="info-circle">{t('save.cannot_tag')}</Alert>}
      {organization && canTag && !tags && !error && <Spinner size="sm" label={t('common.loading')} />}
      {organization && canTag && tags && (
        <div role="group" aria-label={t('field.tags')}>
          <Stack gap={2}>
            <Text>{t('field.tags')}</Text>
            {tags.length === 0 && <Text tone="muted">{t('save.no_tags')}</Text>}
            {tags.map((tag) => (defaultIds.has(tag.id)
              ? <Checkbox key={tag.id} checked disabled label={tag.name} hint={t('save.default_tag')} onChange={() => {}} />
              : <Checkbox key={tag.id} checked={picked.has(tag.id)} label={tag.name} onChange={() => toggle(tag.id)} />))}
            {defaults.missing.length > 0 && (
              <Text tone="muted">{t('save.missing_defaults', { tags: defaults.missing.join(', '), organization: organization.name })}</Text>
            )}
          </Stack>
        </div>
      )}
      <DialogButtons buttons={buttons} onClick={onButton} />
    </Stack>
  );
}
