import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fakeApi, proxyResponse } from '../../test-utils/fake-api.mjs';
import { createBackground, ACTION_SAVE, ACTION_ATTACH, DEFAULT_ORGANIZATION_KEY, PROGRESS_FROM_BYTES } from '../src/lib/background.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const SERVER = 'https://papra.example.com';
const FULL = ['organizations:read', 'documents:read', 'documents:create', 'documents:update', 'tags:read'];
const NO_TAGS = ['organizations:read', 'documents:read', 'documents:create'];
const pdf = { name: 'invoice.pdf', type: 'application/pdf', size: 8, data: new TextEncoder().encode('%PDF-1.4').buffer };
const click = { actionId: ACTION_SAVE, context: { emailId: 'm1', blobId: 'b1', name: 'invoice.pdf', type: 'application/pdf', size: 8 } };
const choice = { organizationId: 'org_a', organizationName: 'Alice', tagIds: ['t1', 't2'], tagNames: ['Bulwark', 'Invoice'], missingDefaults: [] };

/** The plugin's api with the admin's config, the user's key and a Papra behind the proxy. */
function setup({
  config = { serverUrl: SERVER, defaultTags: 'Bulwark, Email' }, connected = true, permissions = FULL,
  dialog = () => choice, confirm = () => true, upload = () => proxyResponse('{"document":{"id":"doc_1","name":"invoice.pdf"}}'),
  tag = () => ({ status: 204, ok: true, headers: {}, body: '' }), attachResult = true,
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
        if (path.endsWith('/tags') && init.method === 'POST') return tag();
        if (/\/documents\/[^/]+\/file$/.test(path)) return { status: 200, ok: true, headers: {}, body: new Uint8Array(5).buffer };
        return { status: 404, ok: false, headers: {}, body: '' };
      },
      'ui.openDialog': dialog,
      'ui.confirm': confirm,
      'email.getAttachment': () => pdf,
      'toast.progress': () => 'progress-1',
      'jmap.uploadBlob': (bytes, name, type) => ({ blobId: `blob-${name}`, size: bytes.byteLength, type }),
      'composer.attach': (...args) => (typeof attachResult === 'function' ? attachResult(...args) : attachResult),
    },
  });
}

const fetched = (api) => api.calls('proxy.fetch').map((c) => `${c.args[2].method} ${new URL(c.args[1]).pathname}`);
const toasts = (api, kind) => api.calls(`toast.${kind}`).map((c) => c.args[0]);

describe('the menu entries', () => {
  it('offers "Save to Papra" and "From Papra", in the user\'s language', async () => {
    const api = setup();
    await createBackground(api).registerUi();
    expect(api.calls('ui.setActions').map((c) => c.args)).toEqual([
      ['attachment-menu', [{ id: 'save-attachment', label: 'Save to Papra', icon: 'archive' }]],
      ['composer-attach-menu', [{ id: 'from-papra', label: 'From Papra', icon: 'archive' }]],
    ]);
    api.setLocale('de');
    await createBackground(api).registerUi();
    expect(api.calls('ui.setActions').slice(2).map((c) => c.args[1][0].label)).toEqual(['In Papra speichern', 'Aus Papra']);
  });
});

describe('saving an attachment', () => {
  it('asks where (the user\'s default preselected), uploads and tags, and leaves the default alone', async () => {
    const api = setup();
    await api.storage.set(DEFAULT_ORGANIZATION_KEY, 'org_b');
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
    expect(toasts(api, 'success')).toEqual(['Saved invoice.pdf to Alice in Papra (tags: Bulwark, Invoice).']);
    expect(await api.storage.get(DEFAULT_ORGANIZATION_KEY)).toBe('org_b');
  });

  it('shows a progress toast while saving a large file, and takes it away also when saving fails', async () => {
    const large = { ...click, context: { ...click.context, size: PROGRESS_FROM_BYTES } };
    const small = setup();
    await createBackground(small).onAction(click);
    expect(toasts(small, 'progress')).toEqual([]);
    const api = setup();
    await createBackground(api).onAction(large);
    expect(toasts(api, 'progress')).toEqual(['Saving invoice.pdf to Papra…']);
    expect(api.calls('toast.dismiss').map((c) => c.args[0])).toEqual(['progress-1']);
    const failing = setup({ upload: () => ({ status: 500, ok: false, headers: {}, body: '' }) });
    await createBackground(failing).onAction(large);
    await Promise.resolve();
    expect(failing.calls('toast.dismiss')).toHaveLength(1);
    expect(toasts(failing, 'error')).toEqual(['Papra had an internal error.']);
  });

  it('tags nothing with a key that can\'t tag', async () => {
    const api = setup({ permissions: NO_TAGS });
    await createBackground(api).onAction(click);
    expect(api.calls('ui.openDialog')[0].args[0].extraProps.canTag).toBe(false);
    expect(fetched(api).filter((r) => r.endsWith('/tags'))).toEqual([]);
    expect(toasts(api, 'success')).toHaveLength(1);
  });

  it('names the tags the document got, and the default tags the organisation lacks', async () => {
    // Regression: the toast read "without the tag email" although the picked tag Car was added.
    const api = setup({ dialog: () => ({ ...choice, tagIds: ['t9'], tagNames: ['Car'], missingDefaults: ['email'] }) });
    await createBackground(api).onAction(click);
    expect(toasts(api, 'warning')).toEqual(['Saved invoice.pdf to Alice in Papra (tags: Car). Default tags left out, Alice doesn’t have them: email']);
    expect(toasts(api, 'success')).toEqual([]);
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
    expect(api.calls('ui.confirm')[0].args[0].message).toBe('Connect your Papra API key to use Papra on papra.example.com.');
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

  it('says in its one toast that tagging failed after the upload', async () => {
    const api = setup({ tag: () => ({ status: 500, ok: false, headers: {}, body: '' }) });
    await createBackground(api).onAction(click);
    expect(toasts(api, 'warning')).toEqual(['Saved invoice.pdf to Alice in Papra. Adding its tags failed: Papra had an internal error.']);
    expect(toasts(api, 'success')).toEqual([]);
  });

  it('ignores other actions and clicks without an attachment', async () => {
    const api = setup();
    const bg = createBackground(api);
    expect(bg.onAction({ actionId: 'other' })).toBeNull();
    expect(await bg.onAction({ actionId: ACTION_SAVE, context: { emailId: 'm1' } })).toBeNull();
    expect(api.calls('proxy.fetch')).toHaveLength(0);
  });
});

describe('attaching from Papra', () => {
  const pickClick = { actionId: ACTION_ATTACH, context: { composerId: 'c1' } };
  const picked = (documents) => () => ({ organizationId: 'org_a', documents });
  const pdfDoc = { id: 'd1', name: 'a.pdf', mimeType: 'application/pdf', size: 5 };

  it('opens the picker in the user\'s default organisation and attaches what was picked', async () => {
    const api = setup({ dialog: picked([pdfDoc]) });
    await api.storage.set(DEFAULT_ORGANIZATION_KEY, 'org_b');
    await createBackground(api).onAction(pickClick);
    expect(api.calls('ui.openDialog')[0].args[0]).toMatchObject({
      title: 'Attach from Papra', extraProps: { view: 'pick', canReadTags: true, organizationId: 'org_b', connection: { state: 'connected', server: SERVER } },
    });
    expect(fetched(api)).toEqual(['GET /api/api-keys/current', 'GET /api/organizations/org_a/documents/d1/file']);
    expect(api.calls('composer.attach')[0].args).toEqual(['c1', { blobId: 'blob-a.pdf', name: 'a.pdf', type: 'application/pdf', size: 5 }]);
    expect(toasts(api, 'success')).toEqual(['Attached a.pdf from Papra.']);
    expect(await api.storage.get(DEFAULT_ORGANIZATION_KEY)).toBe('org_b');
  });

  it('counts several documents in its toast', async () => {
    const api = setup({ dialog: picked([pdfDoc, { ...pdfDoc, id: 'd2', name: 'b.pdf' }]) });
    await createBackground(api).onAction(pickClick);
    expect(toasts(api, 'success')).toEqual(['Attached 2 documents from Papra.']);
  });

  it('says how many were attached before the composer refused one', async () => {
    const api = setup({ dialog: picked([pdfDoc, { ...pdfDoc, id: 'd2', name: 'b.pdf' }]), attachResult: (_c, file) => file.name !== 'b.pdf' });
    await createBackground(api).onAction(pickClick);
    expect(toasts(api, 'error')).toEqual(['Attached 1, then stopped: The message can\'t take b.pdf; it may be too large for your mail server.']);
  });

  it('attaches nothing when the user cancels', async () => {
    const api = setup({ dialog: () => null });
    await createBackground(api).onAction(pickClick);
    expect(api.calls('composer.attach')).toHaveLength(0);
  });

  it('needs a composer', async () => {
    const api = setup();
    expect(await createBackground(api).onAction({ actionId: ACTION_ATTACH, context: {} })).toBeNull();
    expect(api.calls('ui.openDialog')).toHaveLength(0);
  });
});

