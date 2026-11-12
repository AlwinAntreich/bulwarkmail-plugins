// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeApi, proxyResponse } from '../../test-utils/fake-api.mjs';
import { SaveDialog } from '../src/ui/SaveDialog.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'manifest.json'), 'utf8'));
const SERVER = 'https://papra.example.com';
const ORGS = { organizations: [{ id: 'org_t', name: 'Team' }, { id: 'org_a', name: 'Alice' }] };
const tag = (id, name, documentsCount) => ({ id, name, documentsCount });
const TAGS = {
  org_a: { tags: [tag('a1', 'Bulwark', 2), tag('a2', 'Invoice', 48), tag('a3', 'Contract', 3), tag('a4', 'Car', 17), tag('a5', 'Insurance', 12), tag('a6', 'Tax 2025', 9), tag('a7', 'Bank', 7), tag('a8', 'Travel', 1)] },
  org_t: { tags: [tag('t1', 'Invoice', 4)] },
};
const def = (id, name, type, options = []) => ({ id, name, key: name.toLowerCase(), type, displayOrder: 0, options: options.map((o, i) => ({ id: `${id}_o${i}`, name: o })) });
const DEFS = {
  org_a: { propertyDefinitions: [def('p1', 'Owner', 'text'), def('p2', 'Category', 'select', ['Private', 'Business']), def('p3', 'Amount', 'number'), def('p4', 'Paid', 'boolean'), def('p5', 'Responsible', 'user_relation'), def('p6', 'Related', 'document_relation'), def('p7', 'Due', 'date')] },
  org_t: { propertyDefinitions: [def('q1', 'Owner', 'text')] },
};
const DOCS = { documents: [{ id: 'd1', name: 'contract.pdf', customProperties: [{ type: 'user_relation', value: [{ userId: 'u_karin', name: 'Karin' }] }] }], documentsCount: 1 };

function makeApi() {
  return fakeApi({
    translations: manifest.locales,
    handlers: {
      'proxy.fetch': (_c, url) => {
        const u = new URL(url);
        if (u.pathname === '/api/organizations') return proxyResponse(JSON.stringify(ORGS));
        let m = /^\/api\/organizations\/([^/]+)\/tags$/.exec(u.pathname);
        if (m) return proxyResponse(JSON.stringify(TAGS[m[1]]));
        m = /^\/api\/organizations\/([^/]+)\/custom-properties$/.exec(u.pathname);
        if (m) return proxyResponse(JSON.stringify(DEFS[m[1]]));
        if (/\/documents$/.test(u.pathname)) return proxyResponse(JSON.stringify(DOCS));
        return { status: 404, ok: false, headers: {}, body: '' };
      },
    },
  });
}

async function open(props = {}) {
  const api = makeApi();
  const onResult = vi.fn();
  await act(async () => {
    render(React.createElement(SaveDialog, {
      api, attachment: { name: 'invoice.pdf', size: 2048 }, connection: { state: 'connected', server: SERVER },
      canTag: true, defaultTags: ['Bulwark'], organizationId: 'org_a', onResult, ...props,
    }));
  });
  return { api, onResult };
}

const save = () => screen.getByRole('button', { name: 'Save' });
const press = async (el) => { await act(async () => { fireEvent.click(el); }); };
const pills = () => [...screen.getByRole('group', { name: 'Tags' }).querySelectorAll('button, span[title]')].map((b) => b.textContent);
const result = (onResult) => onResult.mock.calls.at(-1)[0];

describe('SaveDialog: where and tags', () => {
  it('shows the admin\'s tags fixed, then the five most-used tags, the rest behind "more"', async () => {
    const { onResult } = await open();
    expect(screen.getByText('invoice.pdf (2.0 KB)')).toBeTruthy();
    expect(screen.getByRole('combobox').value).toBe('org_a');
    expect(pills()).toEqual(['✓ Bulwark', 'Invoice48', 'Car17', 'Insurance12', 'Tax 20259', 'Bank7', '+ 2 more']);
    await press(screen.getByRole('button', { name: 'Car17' }));
    await press(screen.getByRole('button', { name: '+ 2 more' }));
    expect(pills()).toContain('Travel1');
    await press(screen.getByRole('button', { name: 'Travel1' }));
    expect(screen.getByText('Alice · tags: Bulwark, Car, Travel')).toBeTruthy();
    await press(save());
    expect(result(onResult)).toMatchObject({ organizationId: 'org_a', organizationName: 'Alice', tagIds: ['a1', 'a4', 'a8'], tagNames: ['Bulwark', 'Car', 'Travel'], missingDefaults: [], properties: [] });
  });

  it('switches organisation and says which default tag it lacks', async () => {
    const { onResult } = await open();
    await act(async () => { fireEvent.change(screen.getByRole('combobox'), { target: { value: 'org_t' } }); });
    expect(screen.getByText('Not added, Team has no such tag: Bulwark')).toBeTruthy();
    await press(save());
    expect(result(onResult)).toMatchObject({ organizationId: 'org_t', tagIds: [], missingDefaults: ['Bulwark'] });
  });

  it('preselects nothing without a default, and saves only after the user picks', async () => {
    const { onResult } = await open({ organizationId: null });
    expect(screen.getByRole('combobox').value).toBe('');
    expect(screen.getByRole('option', { name: 'Choose an organisation' })).toBeTruthy();
    expect(save().disabled).toBe(true);
    await press(save());
    expect(onResult).not.toHaveBeenCalled();
    await act(async () => { fireEvent.change(screen.getByRole('combobox'), { target: { value: 'org_t' } }); });
    expect(save().disabled).toBe(false);
  });

  it('preselects nothing when the default organisation is gone', async () => {
    await open({ organizationId: 'org_gone' });
    expect(screen.getByRole('combobox').value).toBe('');
  });

  it('offers no tags with a key that can\'t tag, and says so', async () => {
    const { api, onResult } = await open({ canTag: false });
    expect(screen.getByText(/Your API key can't add tags/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Tags' })).toBeNull();
    expect(api.calls('proxy.fetch').map((c) => new URL(c.args[1]).pathname)).toEqual(['/api/organizations']);
    await press(save());
    expect(result(onResult)).toMatchObject({ tagIds: [], properties: [] });
  });

  it('shows no properties tab without the property permission, and says why', async () => {
    await open();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByText(/^Your API key can't set properties, so none are offered\. Create a key with custom-properties:read/)).toBeTruthy();
  });

  it('hands back null on Cancel', async () => {
    const { onResult } = await open();
    await press(screen.getByRole('button', { name: 'Cancel' }));
    expect(onResult).toHaveBeenCalledWith(null);
  });
});

describe('SaveDialog: properties', () => {
  const withProps = (extra = {}) => open({
    canSetProperties: true, me: { id: 'u_me' },
    defaultProperties: [{ name: 'Owner', value: 'Alwin Antreich' }, { name: 'Category', value: 'Private' }, { name: 'Project', value: 'X' }],
    ...extra,
  });
  const tab = async (name) => press(screen.getByRole('tab', { name: new RegExp(`^${name}`) }));
  const add = async (name) => press(screen.getByRole('button', { name: `+ ${name}` }));

  it('starts with the user\'s defaults as rows, edited in place, and names the ones the organisation lacks', async () => {
    const { onResult } = await withProps();
    expect(screen.getByRole('tab', { name: 'Properties 2' })).toBeTruthy();
    await tab('Properties');
    expect(screen.getByRole('textbox', { name: 'Owner' }).value).toBe('Alwin Antreich');
    expect(screen.getByRole('combobox', { name: 'Category' }).value).toBe('p2_o0');
    expect(screen.getAllByText('Your default')).toHaveLength(2);
    expect(screen.getByText('Default properties left out, Alice doesn’t have them: Project')).toBeTruthy();
    expect(screen.getByText('Alice · tags: Bulwark · Category: Private · Owner: Alwin Antreich')).toBeTruthy();
    await press(save());
    expect(result(onResult)).toMatchObject({
      properties: [
        { id: 'p2', name: 'Category', value: 'p2_o0', text: 'Private' },
        { id: 'p1', name: 'Owner', value: 'Alwin Antreich', text: 'Alwin Antreich' },
      ],
      missingProperties: ['Project'],
    });
  });

  it('changes a default for this save in its row, and takes one off with ×', async () => {
    const { onResult } = await withProps();
    await tab('Properties');
    await act(async () => { fireEvent.change(screen.getByRole('textbox', { name: 'Owner' }), { target: { value: 'Agata' } }); });
    expect(screen.getAllByText('Your default')).toHaveLength(1);
    await press(screen.getByRole('button', { name: 'Take Category off this document' }));
    expect(screen.queryByRole('combobox', { name: 'Category' })).toBeNull();
    await press(save());
    expect(result(onResult).properties).toEqual([{ id: 'p1', name: 'Owner', value: 'Agata', text: 'Agata' }]);
  });

  it('adds a row from the property pills, with a field for its type ready', async () => {
    const { onResult } = await withProps();
    await tab('Properties');
    const pills = screen.getByRole('group', { name: 'Add property' });
    expect([...pills.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['+ Amount', '+ Due', '+ Paid', '+ Related', '+ Responsible']);
    await add('Amount');
    await act(async () => { fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '129.90' } }); });
    await add('Responsible');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Karin' })).toBeTruthy());
    await press(screen.getByRole('button', { name: 'Me' }));
    await add('Related');
    await act(async () => { fireEvent.change(screen.getByLabelText('Find a document in Papra'), { target: { value: 'contract' } }); });
    await press(await screen.findByRole('button', { name: 'contract.pdf' }));
    await add('Paid');
    expect(screen.getByRole('checkbox', { name: 'yes' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('group', { name: 'Add property' }).textContent).toBe('Add property+ Due');
    await press(save());
    expect(result(onResult).properties).toEqual([
      { id: 'p3', name: 'Amount', value: 129.9, text: '129.90' },
      { id: 'p2', name: 'Category', value: 'p2_o0', text: 'Private' },
      { id: 'p1', name: 'Owner', value: 'Alwin Antreich', text: 'Alwin Antreich' },
      { id: 'p4', name: 'Paid', value: true, text: 'yes' },
      { id: 'p6', name: 'Related', value: ['d1'], text: 'contract.pdf' },
      { id: 'p5', name: 'Responsible', value: ['u_me'], text: 'Me' },
    ]);
  });

  it('takes a date from day, month and year lists, shown in the user\'s language', async () => {
    const { onResult } = await withProps();
    await tab('Properties');
    await add('Due');
    for (const [list, value] of [['Due: day', '1'], ['Due: month', '12'], ['Due: year', '2026']]) {
      await act(async () => { fireEvent.change(screen.getByLabelText(list), { target: { value } }); });
    }
    expect(screen.getByText(/· Due: Dec 1, 2026/)).toBeTruthy();
    await press(save());
    expect(result(onResult).properties).toContainEqual({ id: 'p7', name: 'Due', value: '2026-12-01', text: 'Dec 1, 2026' });
  });

  it('starts over with the defaults when the user switches organisation', async () => {
    const { onResult } = await withProps();
    await act(async () => { fireEvent.change(screen.getByRole('combobox'), { target: { value: 'org_t' } }); });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Properties 1' })).toBeTruthy());
    await press(save());
    expect(result(onResult)).toMatchObject({
      properties: [{ id: 'q1', name: 'Owner', value: 'Alwin Antreich' }],
      missingProperties: ['Category', 'Project'],
    });
  });
});
