import { describe, it, expect } from 'vitest';
import { fakeApi, proxyResponse } from '../../test-utils/fake-api.mjs';
import { connect, resolveConnection, clientFor, keyAbilities, checkKey } from '../src/lib/connection.js';

const SERVER = 'https://papra.example.com';
const FULL = ['organizations:read', 'documents:read', 'documents:create', 'documents:update', 'tags:read'];
const keyAnswer = (permissions) => proxyResponse(JSON.stringify({ apiKey: { id: 'ak_1', name: 'bulwark', permissions } }));
const refused = { status: 401, ok: false, headers: {}, body: '{"error":{"message":"Unauthorized","code":"auth.unauthorized"}}' };

/** A fake api with the admin's server and the user's accounts; connect() connects to `connectOrigin`. */
function setup({ serverUrl = SERVER, accounts = [], connectOrigin, fetch } = {}) {
  let current = accounts;
  return fakeApi({
    handlers: {
      'config.get': () => ({ serverUrl }),
      'proxy.accounts': () => current,
      'proxy.connect': () => {
        if (!connectOrigin) return { connected: false };
        current = [{ credentialId: 'papra', scope: 'user', origin: connectOrigin, connected: true }];
        return { connected: true, origin: connectOrigin };
      },
      'proxy.disconnect': () => { current = []; },
      'proxy.fetch': fetch ?? (() => keyAnswer(FULL)),
    },
  });
}

describe('resolveConnection', () => {
  it('is not configured until the admin sets the server', async () => {
    expect(await resolveConnection(setup({ serverUrl: '' }))).toEqual({ state: 'not_configured' });
    expect(await resolveConnection(setup({ serverUrl: 'not a url ::' }))).toEqual({ state: 'not_configured' });
  });

  it('is disconnected while the user has no key connected', async () => {
    const api = setup({ accounts: [{ credentialId: 'papra', origin: SERVER, connected: false }] });
    expect(await resolveConnection(api)).toEqual({ state: 'disconnected', server: SERVER });
  });

  it('is connected when the key belongs to the admin\'s server', async () => {
    const api = setup({ serverUrl: 'papra.example.com/', accounts: [{ credentialId: 'papra', origin: SERVER, connected: true }] });
    expect(await resolveConnection(api)).toEqual({ state: 'connected', server: SERVER });
  });

  it('never uses a key connected to another server, and drops it', async () => {
    const api = setup({ accounts: [{ credentialId: 'papra', origin: 'https://evil.example.net', connected: true }] });
    expect(await resolveConnection(api)).toEqual({ state: 'disconnected', server: SERVER, wrongServer: 'https://evil.example.net' });
    expect(api.calls('proxy.disconnect')).toHaveLength(1);
    expect(api.calls('proxy.fetch')).toHaveLength(0);
  });

  it('compares origins, not spellings: another port is another server', async () => {
    const api = setup({ accounts: [{ credentialId: 'papra', origin: 'https://papra.example.com:8443', connected: true }] });
    expect((await resolveConnection(api)).state).toBe('disconnected');
  });
});

describe('clientFor', () => {
  it('sends every request to the admin\'s server with the papra credential', async () => {
    const api = setup({ fetch: () => proxyResponse('{"organizations":[]}') });
    await clientFor(api, { state: 'connected', server: SERVER }).organizations();
    expect(api.calls('proxy.fetch')[0].args.slice(0, 2)).toEqual(['papra', `${SERVER}/api/organizations`]);
  });

  it('refuses without a connection', () => {
    const api = setup();
    expect(() => clientFor(api, { state: 'disconnected', server: SERVER })).toThrow('error.not_connected');
    expect(() => clientFor(api, { state: 'not_configured' })).toThrow('error.not_configured');
  });
});

describe('keyAbilities', () => {
  it('lists the required permissions a key lacks and whether it may tag', () => {
    expect(keyAbilities(FULL)).toEqual({ missing: [], canTag: true, canReadTags: true });
    expect(keyAbilities(['organizations:read', 'documents:read', 'documents:create'])).toEqual({ missing: [], canTag: false, canReadTags: false });
    expect(keyAbilities(['documents:read', 'tags:read'])).toEqual({ missing: ['organizations:read', 'documents:create'], canTag: false, canReadTags: true });
  });

  it('checks the connected key through /api/api-keys/current', async () => {
    const api = setup({ fetch: () => keyAnswer(['organizations:read', 'documents:read', 'documents:create']) });
    expect(await checkKey(api, { state: 'connected', server: SERVER })).toEqual({ missing: [], canTag: false, canReadTags: false });
    expect(api.calls('proxy.fetch')[0].args[1]).toBe(`${SERVER}/api/api-keys/current`);
  });
});

describe('connect', () => {
  it('suggests the admin\'s server in the dialog and keeps a key with the needed permissions', async () => {
    const api = setup({ connectOrigin: SERVER });
    const result = await connect(api);
    expect(result).toMatchObject({ connected: true, canTag: true, connection: { state: 'connected', server: SERVER } });
    expect(api.calls('proxy.connect')[0].args).toEqual(['papra', { mode: 'password', server: SERVER }]);
    expect(api.calls('proxy.disconnect')).toHaveLength(0);
  });

  it('drops a key the user connected to another server', async () => {
    const api = setup({ connectOrigin: 'https://evil.example.net' });
    const result = await connect(api);
    expect(result.connected).toBe(false);
    expect(result.error.key).toBe('error.wrong_server_connect');
    expect(result.error.vars).toEqual({ server: 'papra.example.com' });
    expect(api.calls('proxy.disconnect')).toHaveLength(1);
    expect(api.calls('proxy.fetch')).toHaveLength(0);
  });

  it('drops a key Papra refuses', async () => {
    const api = setup({ connectOrigin: SERVER, fetch: () => refused });
    const result = await connect(api);
    expect(result.error.key).toBe('error.key');
    expect(api.calls('proxy.disconnect')).toHaveLength(1);
  });

  it('drops a key without the required permissions and names them', async () => {
    const api = setup({ connectOrigin: SERVER, fetch: () => keyAnswer(['documents:read']) });
    const result = await connect(api);
    expect(result.error.key).toBe('error.key_permissions');
    expect(result.error.vars).toEqual({ missing: 'organizations:read, documents:create' });
    expect(api.calls('proxy.disconnect')).toHaveLength(1);
  });

  it('keeps a key that can\'t tag, and says so', async () => {
    const api = setup({ connectOrigin: SERVER, fetch: () => keyAnswer(['organizations:read', 'documents:read', 'documents:create']) });
    expect(await connect(api)).toMatchObject({ connected: true, canTag: false });
  });

  it('keeps the key when Papra can\'t be reached, and says why', async () => {
    const api = setup({ connectOrigin: SERVER, fetch: () => ({ status: 502, ok: false, headers: {}, body: '', proxyError: 'unreachable' }) });
    const result = await connect(api);
    expect(result.error.key).toBe('error.unreachable');
    expect(api.calls('proxy.disconnect')).toHaveLength(0);
  });

  it('does nothing when the user cancels the dialog', async () => {
    const api = setup();
    expect(await connect(api)).toEqual({ connected: false });
    expect(api.calls('proxy.fetch')).toHaveLength(0);
  });

  it('opens no dialog before the admin sets the server', async () => {
    const api = setup({ serverUrl: '' });
    expect((await connect(api)).error.key).toBe('error.not_configured');
    expect(api.calls('proxy.connect')).toHaveLength(0);
  });
});
