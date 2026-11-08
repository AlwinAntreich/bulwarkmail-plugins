// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeApi, proxyResponse } from '../../test-utils/fake-api.mjs';
import { PickDialog } from '../src/ui/PickDialog.jsx';
import { MAX_DOCUMENT_BYTES } from '../src/lib/attach.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'manifest.json'), 'utf8'));
const SERVER = 'https://papra.example.com';
const ORGS = { organizations: [{ id: 'org_t', name: 'Team' }, { id: 'org_a', name: 'Alice' }] };
const TAGS = { tags: [{ id: 'a1', name: 'Invoice' }, { id: 'a2', name: 'Tax 2025' }] };
const doc = (id, name, extra = {}) => ({ id, name, mimeType: 'application/pdf', originalSize: 2048, createdAt: '2026-10-01T10:00:00Z', tags: [], ...extra });
const ALICE = [doc('d1', 'acme-invoice.pdf', { tags: [{ id: 'a1', name: 'Invoice' }] }), doc('d2', 'contract.pdf'), doc('d3', 'scan.tiff', { originalSize: MAX_DOCUMENT_BYTES + 1 })];

/** A Papra behind the proxy; searches are recorded as their query strings. */
function makeApi({ count } = {}) {
  const searches = [];
  const api = fakeApi({
    translations: manifest.locales,
    handlers: {
      'proxy.fetch': (_c, url) => {
        const u = new URL(url);
        if (u.pathname === '/api/organizations') return proxyResponse(JSON.stringify(ORGS));
        if (/\/tags$/.test(u.pathname)) return proxyResponse(JSON.stringify(TAGS));
        if (/\/documents$/.test(u.pathname)) {
          searches.push(Object.fromEntries(u.searchParams));
          const q = u.searchParams.get('searchQuery');
          const docs = u.pathname.includes('org_a') ? ALICE.filter((d) => !q || d.name.includes(q.split(' ')[0]) || q.startsWith('tag:')) : [];
          return proxyResponse(JSON.stringify({ documents: docs, documentsCount: count ?? docs.length }));
        }
        return { status: 404, ok: false, headers: {}, body: '' };
      },
    },
  });
  return { api, searches };
}

async function open(props = {}, apiOptions) {
  const { api, searches } = makeApi(apiOptions);
  const onResult = vi.fn();
  await act(async () => {
    render(React.createElement(PickDialog, { api, connection: { state: 'connected', server: SERVER }, canReadTags: true, organizationId: 'org_a', onResult, ...props }));
  });
  await screen.findByText('acme-invoice.pdf');
  return { api, searches, onResult };
}

const press = async (el) => { await act(async () => { fireEvent.click(el); }); };
const row = (name) => screen.getByText(name).closest('[role="listitem"]');

describe('PickDialog', () => {
  it('lists the default organisation\'s documents with their tags', async () => {
    const { searches } = await open();
    expect(searches[0]).toEqual({ searchQuery: '', pageIndex: '0', pageSize: '25' });
    expect(screen.getByText('3 documents')).toBeTruthy();
    expect(row('acme-invoice.pdf').textContent).toContain('Invoice');
    expect(row('scan.tiff').textContent).toContain('Larger than 25 MB');
    expect(row('scan.tiff').getAttribute('aria-disabled')).toBe('true');
  });

  it('hands back the picked documents', async () => {
    const { onResult } = await open();
    await press(row('acme-invoice.pdf'));
    await press(row('contract.pdf'));
    await press(screen.getByRole('button', { name: 'Attach 2' }));
    expect(onResult).toHaveBeenCalledWith({
      organizationId: 'org_a',
      documents: [
        { id: 'd1', name: 'acme-invoice.pdf', mimeType: 'application/pdf', size: 2048 },
        { id: 'd2', name: 'contract.pdf', mimeType: 'application/pdf', size: 2048 },
      ],
    });
  });

  it('waits for the user to pick an organisation when there is no default', async () => {
    const { api, searches } = makeApi();
    await act(async () => {
      render(React.createElement(PickDialog, { api, connection: { state: 'connected', server: SERVER }, canReadTags: true, organizationId: null, onResult: vi.fn() }));
    });
    await screen.findByRole('option', { name: 'Choose an organisation' });
    expect(searches).toEqual([]);
    expect(screen.queryByRole('searchbox')).toBeNull();
    await act(async () => { fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'org_a' } }); });
    await screen.findByText('acme-invoice.pdf');
  });

  it('searches as the user types, after a pause', async () => {
    const { searches } = await open();
    await act(async () => { fireEvent.change(screen.getByRole('searchbox', { name: 'Search documents' }), { target: { value: 'contract' } }); });
    await waitFor(() => expect(searches.at(-1)?.searchQuery).toBe('contract'));
    await waitFor(() => expect(screen.queryByText('acme-invoice.pdf')).toBeNull());
  });

  it('filters by tag with Papra\'s tag: syntax, and drops the filter again', async () => {
    const { searches } = await open();
    const filter = screen.getAllByRole('combobox').at(-1);
    await act(async () => { fireEvent.change(filter, { target: { value: 'Tax 2025' } }); });
    await waitFor(() => expect(searches.at(-1).searchQuery).toBe('tag:"Tax 2025"'));
    await press(screen.getByRole('button', { name: 'Remove filter Tax 2025' }));
    await waitFor(() => expect(searches.at(-1).searchQuery).toBe(''));
  });

  it('loads more when there are more results', async () => {
    const { searches } = await open({}, { count: 30 });
    await press(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(searches.at(-1).pageIndex).toBe('1'));
  });

  it('starts over when the user switches organisation', async () => {
    await open();
    await press(row('contract.pdf'));
    await act(async () => { fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'org_t' } }); });
    await screen.findByText('No documents found.');
    expect(screen.getByRole('button', { name: 'Attach' }).disabled).toBe(true);
  });

  it('offers no tag filter when the key can\'t read tags', async () => {
    const { api } = await open({ canReadTags: false });
    expect(screen.queryByText('Filter by tag')).toBeNull();
    expect(api.calls('proxy.fetch').some((c) => c.args[1].endsWith('/tags'))).toBe(false);
  });
});
