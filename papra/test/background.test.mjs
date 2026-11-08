import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fakeApi, proxyResponse } from '../../test-utils/fake-api.mjs';
import { createBackground, ACTION_SAVE, ORGANIZATION_KEY } from '../src/lib/background.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const SERVER = 'https://papra.example.com';
const FULL = ['organizations:read', 'documents:read', 'documents:create', 'documents:update', 'tags:read'];
const NO_TAGS = ['organizations:read', 'documents:read', 'documents:create'];
const pdf = { name: 'invoice.pdf', type: 'application/pdf', size: 8, data: new TextEncoder().encode('%PDF-1.4').buffer };
const click = { actionId: ACTION_SAVE, context: { emailId: 'm1', blobId: 'b1', name: 'invoice.pdf', type: 'application/pdf', size: 8 } };
const choice = { organizationId: 'org_a', organizationName: 'Alice', tagIds: ['t1', 't2'], missingDefaults: [] };

/** The plugin's api with the admin's config, the user's key and a Papra behind the proxy. */
function setup({
  config = { serverUrl: SERVER, defaultTags: 'Bulwark, Email' }, connected = true, permissions = FULL,
  dialog = () => choice, confirm = () => true, upload = () => proxyResponse('{"document":{"id":"doc_1","name":"invoice.pdf"}}'),
} = {}) {
  let accounts = connected ? [{ credentialId: 'papra', origin: SERVER, connected: true }] : [];
  return fakeApi({
    translations: manifest.locales,
    handlers: {
      'config.get': () => config,
      'proxy.accounts': () => accounts,
      'proxy.connect': () => { accounts = [{ credentialId: 'papra', origin: SERVER, connected: true }]; return { connected: true, origin: SERVER }; },
      'proxy.disconnect': () => { accounts = []; },
      'proxy.fetch': (_c, url, init) => {
        const path = new URL(url).pathname;
        if (path === '/api/api-keys/current') return proxyResponse(JSON.stringify({ apiKey: { id: 'ak', name: 'k', permissions } }));
        if (path === '/api/organizations/org_a/documents' && init.method === 'POST') return upload();
        if (path.endsWith('/tags') && init.method === 'POST') return { status: 204, ok: true, headers: {}, body: '' };
        return { status: 404, ok: false, headers: {}, body: '' };
      },
      'ui.openDialog': dialog,
      'ui.confirm': confirm,
      'email.getAttachment': () => pdf,
    },
  });
}

const fetched = (api) => api.calls('proxy.fetch').map((c) => `${c.args[2].method} ${new URL(c.args[1]).pathname}`);
const toasts = (api, kind) => api.calls(`toast.${kind}`).map((c) => c.args[0]);

describe('the attachment menu', () => {
  it('offers "Save to Papra", in the user\'s language', async () => {
    const api = setup();
    await createBackground(api).registerUi();
    expect(api.calls('ui.setActions')[0].args).toEqual(['attachment-menu', [{ id: 'save-attachment', label: 'Save to Papra', icon: 'archive' }]]);
    api.setLocale('de');
    await createBackground(api).registerUi();
    expect(api.calls('ui.setActions')[1].args[1][0].label).toBe('In Papra speichern');
  });
});

describe('saving an attachment', () => {
  it('asks where, uploads, tags and remembers the organisation', async () => {
    const api = setup();
    await api.storage.set(ORGANIZATION_KEY, 'org_b');
    await createBackground(api).onAction(click);
    const props = api.calls('ui.openDialog')[0].args[0].extraProps;
    expect(props).toMatchObject({
      view: 'save', attachment: { name: 'invoice.pdf', size: 8 }, canTag: true, defaultTags: ['Bulwark', 'Email'], organizationId: 'org_b',
      connection: { state: 'connected', server: SERVER },
    });
    expect(fetched(api)).toEqual([
      'GET /api/api-keys/current',
      'POST /api/organizations/org_a/documents',
      'POST /api/organizations/org_a/documents/doc_1/tags',
      'POST /api/organizations/org_a/documents/doc_1/tags',
    ]);
    expect(toasts(api, 'success')).toEqual(['Saved invoice.pdf to Alice in Papra.']);
    expect(await api.storage.get(ORGANIZATION_KEY)).toBe('org_a');
  });

  it('tags nothing with a key that can\'t tag', async () => {
    const api = setup({ permissions: NO_TAGS });
    await createBackground(api).onAction(click);
    expect(api.calls('ui.openDialog')[0].args[0].extraProps.canTag).toBe(false);
    expect(fetched(api).filter((r) => r.endsWith('/tags'))).toEqual([]);
    expect(toasts(api, 'success')).toHaveLength(1);
  });

  it('says which default tags the organisation lacks', async () => {
    const api = setup({ dialog: () => ({ ...choice, tagIds: ['t1'], missingDefaults: ['Email'] }) });
    await createBackground(api).onAction(click);
    expect(toasts(api, 'warning')).toEqual(['invoice.pdf has no tag Email: Alice has no such tag.']);
  });

  it('says so when Papra already has the file', async () => {
    const api = setup({ upload: () => ({ status: 409, ok: false, headers: {}, body: '{"error":{"message":"exists","code":"document.already_exists"}}' }) });
    await createBackground(api).onAction(click);
    expect(toasts(api, 'info')).toEqual(['Papra already has invoice.pdf.']);
    expect(toasts(api, 'error')).toEqual([]);
  });

  it('does nothing when the user cancels the dialog', async () => {
    const api = setup({ dialog: () => null });
    await createBackground(api).onAction(click);
    expect(api.calls('email.getAttachment')).toHaveLength(0);
    expect(fetched(api)).toEqual(['GET /api/api-keys/current']);
  });

  it('tells the user to ask the admin while no server is set', async () => {
    const api = setup({ config: { serverUrl: '' } });
    await createBackground(api).onAction(click);
    expect(toasts(api, 'error')).toEqual(['Papra isn\'t set up yet. Ask your administrator to set the Papra server URL.']);
    expect(api.calls('ui.openDialog')).toHaveLength(0);
  });

  it('offers to connect first, and saves after connecting', async () => {
    const api = setup({ connected: false });
    await createBackground(api).onAction(click);
    expect(api.calls('ui.confirm')[0].args[0].message).toBe('Connect your Papra API key to save documents to papra.example.com.');
    expect(api.calls('proxy.connect')).toHaveLength(1);
    expect(toasts(api, 'success')).toHaveLength(1);
  });

  it('stops when the user doesn\'t want to connect', async () => {
    const api = setup({ connected: false, confirm: () => false });
    await createBackground(api).onAction(click);
    expect(api.calls('proxy.connect')).toHaveLength(0);
    expect(api.calls('ui.openDialog')).toHaveLength(0);
  });

  it('refuses a connected key that has lost a required permission', async () => {
    const api = setup({ permissions: ['documents:read'] });
    await createBackground(api).onAction(click);
    expect(toasts(api, 'error')).toEqual(['The API key lacks these permissions: organizations:read, documents:create. Create a key with them in Papra.']);
    expect(api.calls('ui.openDialog')).toHaveLength(0);
  });

  it('ignores other actions and clicks without an attachment', async () => {
    const api = setup();
    const bg = createBackground(api);
    expect(bg.onAction({ actionId: 'other' })).toBeNull();
    expect(await bg.onAction({ actionId: ACTION_SAVE, context: { emailId: 'm1' } })).toBeNull();
    expect(api.calls('proxy.fetch')).toHaveLength(0);
  });
});
