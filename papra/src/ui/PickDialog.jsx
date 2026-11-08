import { useEffect, useMemo, useState } from 'react';
import { Alert, Chip, DialogButtons, Field, Input, LinkButton, List, ListRow, Row, Select, Spinner, Stack, Text } from '@plugin-host/ui';
import { getApi, formatSize } from './host.js';
import { clientFor } from '../lib/connection.js';
import { errorText } from '../lib/errors.js';
import { MAX_DOCUMENT_BYTES } from '../lib/attach.js';
import { organizationOptions, preselect } from './organizations.js';
import { hasFilter, hasTerm, tagTerm, toggleTerm } from './query.js';

export const SEARCH_DELAY_MS = 300;
export const QUICK_TAGS = 6;
export const SEARCH_GUIDE_URL = 'https://docs.papra.app/guides/advanced-search/';
const PAGE = 25;

/** Common forms of Papra's search language, shown under "Search tips"; a click adds the term to the search. */
export function searchTips(year) {
  return [
    ['tag:invoice', 'pick.tip_tag'],
    ['name:offer', 'pick.tip_name'],
    ['content:"order 4711"', 'pick.tip_content'],
    [`date:>=${year}-01`, 'pick.tip_date'],
    [`created:<${year}`, 'pick.tip_created'],
    ['-tag:archived', 'pick.tip_not'],
    ['(tag:invoice OR tag:receipt)', 'pick.tip_or'],
    ['-has:tags', 'pick.tip_untagged'],
  ];
}

/**
 * The "Attach from Papra" dialog: one organisation at a time, searched with
 * Papra's own search language, which the search box passes on unchanged.
 * Quick filters (the most-used tags, this year, untagged) and search tips
 * add or remove terms in it. Each result shows its tags. Hands the picked
 * documents back with onResult; the background attaches them.
 */
export function PickDialog({ api = getApi(), connection, canReadTags = false, organizationId = null, onResult }) {
  const t = (key, vars) => api.i18n.t(key, vars);
  const client = useMemo(() => clientFor(api, connection), [api, connection]);
  const [organizations, setOrganizations] = useState(null);
  const [selected, setSelected] = useState(null);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [orgTags, setOrgTags] = useState([]);
  const [tipsOpen, setTipsOpen] = useState(false);
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
    setPicked(new Map());
    setOrgTags([]);
    if (!selected || !canReadTags) return undefined;
    let cancelled = false;
    client.tags(selected).then((list) => { if (!cancelled) setOrgTags(list); }, () => { /* the tag chips are a help; search still works */ });
    return () => { cancelled = true; };
  }, [client, selected, canReadTags]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  // Search from the first page whenever what is searched for changes.
  useEffect(() => { setPage(0); }, [selected, query]);

  useEffect(() => {
    if (!selected) return undefined;
    let cancelled = false;
    setError(null);
    if (page === 0) setResults(null);
    client.searchDocuments(selected, { text: query }, page, PAGE).then((found) => {
      if (cancelled) return;
      setResults((prev) => (page === 0 || !prev ? found : { count: found.count, documents: [...prev.documents, ...found.documents] }));
    }, (err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
  }, [client, selected, query, page, attempt]);

  const toggle = (doc) => setPicked((prev) => {
    const next = new Map(prev);
    if (next.has(doc.id)) next.delete(doc.id); else next.set(doc.id, doc);
    return next;
  });
  // Quick filters and tips change the text at once; no need to wait for the pause.
  const toggleQuery = (term) => {
    const next = toggleTerm(text, term);
    setText(next);
    setQuery(next.trim());
  };

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

  const year = new Date().getFullYear();
  const quick = [
    ...[...orgTags].filter((tag) => tag.count > 0).sort((a, b) => b.count - a.count).slice(0, QUICK_TAGS)
      .map((tag) => ({ key: tag.id, label: tag.name, detail: String(tag.count), term: tagTerm(tag.name) })),
    // Added this year: many documents have no document date, so date: would miss them.
    { key: 'year', label: t('pick.added_this_year'), term: `created:>=${year}` },
    { key: 'untagged', label: t('pick.untagged'), term: '-has:tags' },
  ];

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
          <Field label={t('pick.search')}>
            <Input type="search" value={text} placeholder={t('pick.search_placeholder', { year })} autoComplete="off" spellCheck={false}
              onChange={(e) => setText(e.target.value)} />
          </Field>
          <div role="group" aria-label={t('pick.quick')}>
            <Row gap={2}>
              {quick.map((q) => {
                const on = hasTerm(text, q.term);
                return (
                  <Chip key={q.key} label={on ? `✓ ${q.label}` : q.label} detail={q.detail}
                    title={on ? t('pick.quick_remove', { term: q.term }) : t('pick.quick_add', { term: q.term })}
                    onClick={() => toggleQuery(q.term)} />
                );
              })}
            </Row>
          </div>
          <div>
            <LinkButton icon={tipsOpen ? 'chevron-down' : 'chevron-right'} onClick={() => setTipsOpen((v) => !v)}>
              {tipsOpen ? t('pick.tips_hide') : t('pick.tips')}
            </LinkButton>
          </div>
          {tipsOpen && (
            <div role="group" aria-label={t('pick.tips')}>
              <Stack gap={1}>
                {searchTips(year).map(([term, key]) => (
                  <Row key={term} gap={2}>
                    <LinkButton onClick={() => toggleQuery(term)}>{term}</LinkButton>
                    <Text tone="muted">{t(key)}</Text>
                  </Row>
                ))}
                <div>
                  <LinkButton icon="external-link" onClick={() => { void api.ui.openExternalUrl(SEARCH_GUIDE_URL); }}>{t('pick.tips_more')}</LinkButton>
                </div>
              </Stack>
            </div>
          )}
          {picked.size > 0 && (
            <div role="group" aria-label={t('pick.picked')}>
              <Stack gap={2}>
                <Text tone="muted">{t('pick.picked')}</Text>
                <Row gap={2}>
                  {[...picked.values()].map((doc) => (
                    <Chip key={doc.id} label={doc.name} onRemove={() => toggle(doc)} removeLabel={t('pick.unpick', { name: doc.name })} />
                  ))}
                </Row>
              </Stack>
            </div>
          )}
          {!results && !error && <Spinner size="sm" label={t('common.loading')} />}
          {results && results.documents.length === 0 && <Text tone="muted">{hasFilter(query) ? t('pick.none_filters') : t('pick.none')}</Text>}
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
