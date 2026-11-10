import { describe, it, expect } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { readPrefs, updatePrefs, normalizePrefs } from '../src/lib/prefs.js';

/** A fake api whose mail account keeps plugin data (`supported`), starting with `value`. */
function setup({ supported = true, value = null, setFails = false } = {}) {
  const account = { value };
  const api = fakeApi({
    handlers: {
      'accountData.get': () => ({ supported, value: supported ? account.value : null }),
      'accountData.set': (accountId, v) => {
        if (!supported) throw new Error('accountData.set: this server keeps no shared data for plugins');
        if (setFails) throw new Error('accountData.set: too many changes, try again in a minute');
        expect(accountId).toBeUndefined(); // the user's own account
        account.value = structuredClone(v);
      },
    },
  });
  return { api, account };
}

const owner = [{ name: 'Owner', value: 'Alwin Antreich' }];

describe('readPrefs', () => {
  it('reads the account\'s copy and keeps it in this browser too', async () => {
    const { api } = setup({ value: { defaultOrganizationId: 'org_a', defaultProperties: owner } });
    expect(await readPrefs(api)).toEqual({ synced: true, prefs: { defaultOrganizationId: 'org_a', defaultProperties: owner, papraUser: null } });
    expect(await api.storage.get('defaultOrganizationId')).toBe('org_a');
  });

  it('moves this browser\'s preferences to the account the first time', async () => {
    const { api, account } = setup();
    await api.storage.set('defaultOrganizationId', 'org_t');
    await api.storage.set('papraUser', { id: 'usr_me' });
    expect(await readPrefs(api)).toMatchObject({ synced: true, prefs: { defaultOrganizationId: 'org_t', papraUser: { id: 'usr_me' } } });
    expect(account.value).toEqual({ defaultOrganizationId: 'org_t', papraUser: { id: 'usr_me' } });
  });

  it('uses this browser\'s copy where the server keeps no plugin data', async () => {
    const { api } = setup({ supported: false });
    await api.storage.set('defaultProperties', owner);
    expect(await readPrefs(api)).toEqual({ synced: false, prefs: { defaultOrganizationId: null, defaultProperties: owner, papraUser: null } });
  });

  it('uses this browser\'s copy when the account can\'t be read', async () => {
    const api = fakeApi({ handlers: { 'accountData.get': () => { throw new Error('accountData.get: too many reads'); } } });
    await api.storage.set('defaultOrganizationId', 'org_a');
    expect(await readPrefs(api)).toMatchObject({ synced: false, prefs: { defaultOrganizationId: 'org_a' } });
  });
});

describe('updatePrefs', () => {
  it('reads the account again before writing, so another device\'s change is kept', async () => {
    const { api, account } = setup({ value: { defaultOrganizationId: 'org_a' } });
    // Meanwhile, on the phone:
    account.value = { defaultOrganizationId: 'org_a', defaultProperties: owner };
    await updatePrefs(api, { defaultOrganizationId: 'org_t' });
    expect(account.value).toEqual({ defaultOrganizationId: 'org_t', defaultProperties: owner });
    expect(await api.storage.get('defaultOrganizationId')).toBe('org_t');
  });

  it('removes a preference that is cleared, from the account and this browser', async () => {
    const { api, account } = setup({ value: { defaultOrganizationId: 'org_a', defaultProperties: owner } });
    await api.storage.set('defaultOrganizationId', 'org_a');
    await updatePrefs(api, { defaultOrganizationId: null });
    expect(account.value).toEqual({ defaultProperties: owner });
    expect(await api.storage.get('defaultOrganizationId')).toBeNull();
  });

  it('keeps the change in this browser when the account refuses it, and says so', async () => {
    const { api } = setup({ value: {}, setFails: true });
    await expect(updatePrefs(api, { defaultOrganizationId: 'org_t' })).rejects.toThrow('too many changes');
    expect(await api.storage.get('defaultOrganizationId')).toBe('org_t');
  });

  it('only writes this browser where the server keeps no plugin data', async () => {
    const { api } = setup({ supported: false });
    expect(await updatePrefs(api, { defaultProperties: owner })).toMatchObject({ synced: false });
    expect(await api.storage.get('defaultProperties')).toEqual(owner);
    expect(api.calls('accountData.set')).toHaveLength(0);
  });
});

describe('normalizePrefs', () => {
  it('drops what isn\'t a preference', () => {
    expect(normalizePrefs({ defaultOrganizationId: 7, defaultProperties: [{ name: '' }, { name: 'Owner', value: 'x', extra: 1 }, null], papraUser: { id: 3 }, other: true }))
      .toEqual({ defaultOrganizationId: null, defaultProperties: [{ name: 'Owner', value: 'x' }], papraUser: null });
    expect(normalizePrefs(null)).toEqual({ defaultOrganizationId: null, defaultProperties: [], papraUser: null });
  });
});
