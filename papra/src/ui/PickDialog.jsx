import { useEffect, useMemo, useState } from 'react';
import { Alert, Chip, DialogButtons, Field, LinkButton, List, ListRow, SearchInput, Select, Spinner, Stack, Text } from '@plugin-host/ui';
import { getApi, formatSize } from './host.js';
import { clientFor } from '../lib/connection.js';
import { errorText } from '../lib/errors.js';
import { MAX_DOCUMENT_BYTES } from '../lib/attach.js';
import { organizationOptions, preselect } from './organizations.js';

export const SEARCH_DELAY_MS = 300;
const PAGE = 25;

/**
 * The "Attach from Papra" dialog: one organisation at a time, full-text
 * search, tag filters (Papra's `tag:` search), each result with its tags.
 * Hands the picked documents back with onResult; the background attaches them.
 */
export function PickDialog({ api = getApi(), connection, canReadTags = false, organizationId = null, onResult }) {
  const t = (key, vars) => api.i18n.t(key, vars);
  const client = useMemo(() => clientFor(api, connection), [api, connection]);
  const [organizations, setOrganizations] = useState(null);
  const [selected, setSelected] = useState(null);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [tagFilters, setTagFilters] = useState([]);
  const [orgTags, setOrgTags] = useState([]);
  const [results, setResults] = useState(null);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState(() => new Map());
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

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

  // A new organisation starts from scratch: its own tags, nothing picked.
  useEffect(() => {
    setTagFilters([]);
    setPicked(new Map());
    setOrgTags([]);
    if (!selected || !canReadTags) return undefined;
    let cancelled = false;
    client.tags(selected).then((list) => { if (!cancelled) setOrgTags(list); }, () => { /* filtering by tag is a help; search still works */ });
    return () => { cancelled = true; };
  }, [client, selected, canReadTags]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  // Search from the first page whenever what is searched for changes.
  useEffect(() => { setPage(0); }, [selected, query, tagFilters]);

  useEffect(() => {
    if (!selected) return undefined;
    let cancelled = false;
    setError(null);
    if (page === 0) setResults(null);
    client.searchDocuments(selected, { text: query, tags: tagFilters }, page, PAGE).then((found) => {
      if (cancelled) return;
      setResults((prev) => (page === 0 || !prev ? found : { count: found.count, documents: [...prev.documents, ...found.documents] }));
    }, (err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
  }, [client, selected, query, tagFilters, page, attempt]);

  const toggle = (doc) => setPicked((prev) => {
    const next = new Map(prev);
    if (next.has(doc.id)) next.delete(doc.id); else next.set(doc.id, doc);
    return next;
  });
  const addTag = (name) => { if (name && !tagFilters.includes(name)) setTagFilters([...tagFilters, name]); };
  const removeTag = (name) => setTagFilters(tagFilters.filter((n) => n !== name));

  const date = (doc) => {
    const value = doc.documentDate || doc.createdAt;
    return value ? api.i18n.formatDate(value, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  };
  const tooLarge = (doc) => doc.size > MAX_DOCUMENT_BYTES;

  const submit = () => {
    if (!picked.size || !selected) return;
    onResult?.({
      organizationId: selected,
      documents: [...picked.values()].map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size })),
    });
  };
  const buttons = [
    { id: 'cancel', label: t('common.cancel'), variant: 'secondary' },
    { id: 'attach', label: picked.size > 1 ? t('pick.button_count', { count: picked.size }) : t('pick.button'), variant: 'primary', disabled: !picked.size },
  ];

  const unusedTags = orgTags.filter((tag) => !tagFilters.includes(tag.name));

  return (
    <Stack gap={4}>
      {error && (
        <Alert tone="danger" icon="alert-circle" action={<LinkButton onClick={() => setAttempt((n) => n + 1)}>{t('common.retry')}</LinkButton>}>
          {errorText(t, error)}
        </Alert>
      )}
      {!organizations && !error && <Spinner size="sm" label={t('common.loading')} />}
      {organizations && organizations.length === 0 && <Alert tone="warning" icon="alert-triangle">{t('save.no_organizations')}</Alert>}
      {organizations && organizations.length > 1 && (
        <Field label={t('field.organization')}>
          <Select block value={selected || ''} onChange={(value) => setSelected(value || null)}
            options={organizationOptions(organizations, selected, t)} />
        </Field>
      )}
      {selected && (
        <>
          <SearchInput value={text} onChange={setText} label={t('pick.search')} placeholder={t('pick.search_placeholder')} />
          {canReadTags && unusedTags.length > 0 && (
            <Field label={t('pick.tag_filter')}>
              <Select block value="" onChange={addTag}
                options={[{ value: '', label: t('pick.tag_any') }, ...unusedTags.map((tag) => ({ value: tag.name, label: tag.name }))]} />
            </Field>
          )}
          {tagFilters.length > 0 && (
            <div role="group" aria-label={t('pick.tag_filter')}>
              {tagFilters.map((name) => (
                <Chip key={name} label={name} onRemove={() => removeTag(name)} removeLabel={t('pick.remove_tag', { tag: name })} />
              ))}
            </div>
          )}
          {picked.size > 0 && (
            <div role="group" aria-label={t('pick.picked')}>
              <Text tone="muted">{t('pick.picked')}</Text>
              {[...picked.values()].map((doc) => (
                <Chip key={doc.id} label={doc.name} onRemove={() => toggle(doc)} removeLabel={t('pick.unpick', { name: doc.name })} />
              ))}
            </div>
          )}
          {!results && !error && <Spinner size="sm" label={t('common.loading')} />}
          {results && results.documents.length === 0 && <Text tone="muted">{t('pick.none')}</Text>}
          {results && results.documents.length > 0 && (
            <>
              <Text tone="muted">{results.count === 1 ? t('pick.count_one') : t('pick.count', { count: results.count })}</Text>
              <List label={t('pick.results')}>
                {results.documents.map((doc) => (
                  <ListRow
                    key={doc.id}
                    icon={doc.name}
                    title={doc.name}
                    subtitle={[...doc.tags.map((tag) => tag.name), tooLarge(doc) ? t('pick.too_large') : ''].filter(Boolean).join(' · ')}
                    meta={[date(doc), formatSize(doc.size)].filter(Boolean)}
                    checked={picked.has(doc.id)}
                    onCheck={() => toggle(doc)}
                    onClick={() => toggle(doc)}
                    disabled={tooLarge(doc)}
                  />
                ))}
              </List>
              {results.documents.length < results.count && <LinkButton onClick={() => setPage((p) => p + 1)}>{t('pick.more')}</LinkButton>}
            </>
          )}
        </>
      )}
      <DialogButtons buttons={buttons} onClick={(id) => (id === 'attach' ? submit() : onResult?.(null))} />
    </Stack>
  );
}
