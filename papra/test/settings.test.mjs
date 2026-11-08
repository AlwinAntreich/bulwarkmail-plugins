// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { fakeApi, proxyResponse } from '../../test-utils/fake-api.mjs';
import { Settings } from '../src/ui/Settings.jsx';
import { DEFAULT_ORGANIZATION_KEY } from '../src/lib/background.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'manifest.json'), 'utf8'));
const SERVER = 'https://papra.example.com';
const FULL = ['organizations:read', 'documents:read', 'documents:create', 'documents:update', 'tags:read'];

function makeApi({ serverUrl = SERVER, accounts = [{ credentialId: 'papra', origin: SERVER, connected: true }], permissions = FULL } = {}) {
  let current = accounts;
  return fakeApi({
    translations: manifest.locales,
    handlers: {
      'config.get': () => ({ serverUrl }),
      'proxy.accounts': () => current,
      'proxy.disconnect': () => { current = []; },
      'proxy.connect': () => { current = [{ credentialId: 'papra', origin: SERVER, connected: true }]; return { connected: true, origin: SERVER }; },
      'proxy.fetch': (_c, url) => {
        const p = new URL(url).pathname;
        if (p === '/api/api-keys/current') return proxyResponse(JSON.stringify({ apiKey: { id: 'ak', name: 'bulwark laptop', permissions } }));
        if (p === '/api/organizations') return proxyResponse(JSON.stringify({ organizations: [{ id: 'org_t', name: 'Team' }, { id: 'org_a', name: 'Alice' }] }));
        return { status: 404, ok: false, headers: {}, body: '' };
      },
    },
  });
}

async function show(api) {
  await act(async () => { render(React.createElement(Settings, { api })); });
}

const press = async (el) => { await act(async () => { fireEvent.click(el); }); };

describe('Settings', () => {
  it('shows the connection and lets the user choose a default organisation, or none', async () => {
    const api = makeApi();
    await show(api);
    await screen.findByText('Connected to papra.example.com with the key “bulwark laptop”.');
    const select = screen.getByRole('combobox');
    expect(select.value).toBe('');
    expect([...select.options].map((o) => o.textContent)).toEqual(['None: choose each time', 'Alice', 'Team']);
    await act(async () => { fireEvent.change(select, { target: { value: 'org_t' } }); });
    expect(await api.storage.get(DEFAULT_ORGANIZATION_KEY)).toBe('org_t');
    await act(async () => { fireEvent.change(select, { target: { value: '' } }); });
    expect(await api.storage.get(DEFAULT_ORGANIZATION_KEY)).toBeNull();
  });

  it('says when the key can\'t tag', async () => {
    await show(makeApi({ permissions: ['organizations:read', 'documents:read', 'documents:create'] }));
    await screen.findByText(/This key can't add tags/);
  });

  it('disconnects, and connects again', async () => {
    const api = makeApi();
    await show(api);
    await press(await screen.findByRole('button', { name: 'Disconnect' }));
    await screen.findByText('Not connected. Connect your Papra API key for papra.example.com.');
    expect(screen.queryByRole('combobox')).toBeNull();
    await press(screen.getByRole('button', { name: 'Connect Papra' }));
    await screen.findByText('Connected to papra.example.com with the key “bulwark laptop”.');
    expect(api.calls('proxy.connect')[0].args).toEqual(['papra', { mode: 'password', server: SERVER }]);
  });

  it('says a key for another server was removed', async () => {
    const api = makeApi({ accounts: [{ credentialId: 'papra', origin: 'https://evil.example.net', connected: true }] });
    await show(api);
    await screen.findByText('Your key was connected to evil.example.net and has been removed: only papra.example.com can be used.');
    expect(api.calls('proxy.disconnect')).toHaveLength(1);
  });

  it('doesn\'t claim a working connection when Papra can\'t be reached', async () => {
    await show(fakeApiUnreachable());
    await screen.findByText('A key is connected for papra.example.com, but Papra couldn’t be asked about it:');
    expect(screen.getByText(/^Bulwark can't reach Papra: the Bulwark server couldn't connect/)).toBeTruthy();
    expect(screen.queryByText(/Connected to/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('tells the user to ask the admin while no server is set', async () => {
    await show(makeApi({ serverUrl: '' }));
    await screen.findByText('Papra isn\'t set up yet. Ask your administrator to set the Papra server URL.');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

function fakeApiUnreachable() {
  return fakeApi({
    translations: manifest.locales,
    handlers: {
      'config.get': () => ({ serverUrl: SERVER }),
      'proxy.accounts': () => [{ credentialId: 'papra', origin: SERVER, connected: true }],
      'proxy.fetch': () => ({ status: 502, ok: false, headers: {}, body: '', proxyError: 'unreachable' }),
    },
  });
}
