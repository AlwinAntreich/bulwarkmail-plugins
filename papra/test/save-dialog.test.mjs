// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { fakeApi, proxyResponse } from '../../test-utils/fake-api.mjs';
import { SaveDialog } from '../src/ui/SaveDialog.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'manifest.json'), 'utf8'));
const SERVER = 'https://papra.example.com';
const ORGS = { organizations: [{ id: 'org_t', name: 'Team' }, { id: 'org_a', name: 'Alice' }] };
const TAGS = {
  org_a: { tags: [{ id: 'a1', name: 'Bulwark' }, { id: 'a2', name: 'Invoice' }, { id: 'a3', name: 'Contract' }] },
  org_t: { tags: [{ id: 't1', name: 'Invoice' }] },
};

function makeApi() {
  return fakeApi({
    translations: manifest.locales,
    handlers: {
      'proxy.fetch': (_c, url) => {
        const path = new URL(url).pathname;
        if (path === '/api/organizations') return proxyResponse(JSON.stringify(ORGS));
        const m = /^\/api\/organizations\/([^/]+)\/tags$/.exec(path);
        if (m) return proxyResponse(JSON.stringify(TAGS[m[1]]));
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

describe('SaveDialog', () => {
  it('starts with the user\'s default organisation, the admin\'s tags ticked and fixed', async () => {
    const { onResult } = await open();
    expect(screen.getByText('invoice.pdf (2.0 KB)')).toBeTruthy();
    expect(screen.getByRole('combobox').value).toBe('org_a');
    const bulwark = screen.getByRole('checkbox', { name: 'Bulwark' });
    expect(bulwark.getAttribute('aria-checked')).toBe('true');
    expect(bulwark.disabled).toBe(true);
    await press(screen.getByRole('checkbox', { name: 'Invoice' }));
    await press(save());
    expect(onResult).toHaveBeenCalledWith({ organizationId: 'org_a', organizationName: 'Alice', tagIds: ['a1', 'a2'], missingDefaults: [] });
  });

  it('switches organisation and says which default tag it lacks', async () => {
    const { onResult } = await open();
    await act(async () => { fireEvent.change(screen.getByRole('combobox'), { target: { value: 'org_t' } }); });
    expect(screen.getByText('Not added, Team has no such tag: Bulwark')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Bulwark' })).toBeNull();
    await press(save());
    expect(onResult).toHaveBeenCalledWith({ organizationId: 'org_t', organizationName: 'Team', tagIds: [], missingDefaults: ['Bulwark'] });
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
    expect(screen.queryByRole('option', { name: 'Choose an organisation' })).toBeNull();
  });

  it('preselects nothing when the default organisation is gone', async () => {
    await open({ organizationId: 'org_gone' });
    expect(screen.getByRole('combobox').value).toBe('');
  });

  it('offers no tags with a key that can\'t tag, and says so', async () => {
    const { api, onResult } = await open({ canTag: false });
    expect(screen.getByText(/Your API key can't add tags/)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(api.calls('proxy.fetch').map((c) => new URL(c.args[1]).pathname)).toEqual(['/api/organizations']);
    await press(save());
    expect(onResult).toHaveBeenCalledWith({ organizationId: 'org_a', organizationName: 'Alice', tagIds: [], missingDefaults: [] });
  });

  it('hands back null on Cancel', async () => {
    const { onResult } = await open();
    await press(screen.getByRole('button', { name: 'Cancel' }));
    expect(onResult).toHaveBeenCalledWith(null);
  });
});
