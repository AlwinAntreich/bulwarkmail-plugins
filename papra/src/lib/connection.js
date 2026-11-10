// Which Papra to talk to, and whether the user's API key may.
//
// The admin sets the server (`serverUrl`); each user connects their own key
// to it in Bulwark's connect dialog. Bulwark can't tie a user credential to
// the admin's setting, so the user could type another server there. This
// module only ever uses the admin's server and treats a key connected to any
// other origin as not connected. That catches mistakes; it is not a security
// boundary (see docs/PLAN.md).

import { createClient, normalizeBase } from './client.js';
import { PapraError, toPapraError } from './errors.js';

export const CREDENTIAL = 'papra';

/** What the plugin can't work without. */
export const REQUIRED_PERMISSIONS = ['organizations:read', 'documents:read', 'documents:create'];
/** What tagging needs on top; without it documents are saved untagged. */
export const TAGGING_PERMISSIONS = ['tags:read', 'documents:update'];
/** What setting properties needs on top; without it the dialog shows none. */
export const PROPERTY_PERMISSIONS = ['custom-properties:read', 'documents:update'];

/** Drop the user's key; a failure here changes nothing for the caller. */
const disconnect = (api) => Promise.resolve().then(() => api.proxy.disconnect(CREDENTIAL)).catch(() => {});

const originOf = (url) => {
  try { return new URL(url).origin; } catch { return ''; }
};

/** The admin's Papra server (a non-secret config field), or ''. */
export async function adminServer(api) {
  try {
    const config = await api.config.get();
    return normalizeBase(config?.serverUrl);
  } catch {
    return '';
  }
}

/**
 * @returns {Promise<{ state: 'not_configured' }
 *   | { state: 'disconnected', server: string, wrongServer?: string }
 *   | { state: 'connected', server: string }>}
 */
export async function resolveConnection(api) {
  const server = await adminServer(api);
  if (!server) return { state: 'not_configured' };
  let accounts = [];
  try {
    accounts = (await api.proxy.accounts()) || [];
  } catch {
    accounts = [];
  }
  const mine = accounts.find((a) => a?.credentialId === CREDENTIAL && a.connected);
  if (!mine) return { state: 'disconnected', server };
  if (originOf(mine.origin) !== originOf(server)) {
    // A key for another server is never used; drop it so the user connects again.
    await disconnect(api);
    return { state: 'disconnected', server, wrongServer: mine.origin };
  }
  return { state: 'connected', server };
}

/** A client for a connected state, or a PapraError to show. */
export function clientFor(api, connection) {
  if (connection?.state === 'not_configured') throw new PapraError('error.not_configured');
  if (connection?.state !== 'connected') throw new PapraError('error.not_connected');
  return createClient({ proxyFetch: (...a) => api.proxy.fetch(...a), credentialId: CREDENTIAL, base: connection.server });
}

/** What a key's permissions allow: the required ones it lacks, whether it may tag, and whether it may list tags (to filter by them). */
export function keyAbilities(permissions = []) {
  const has = new Set(permissions);
  return {
    missing: REQUIRED_PERMISSIONS.filter((p) => !has.has(p)),
    canTag: TAGGING_PERMISSIONS.every((p) => has.has(p)),
    canReadTags: has.has('tags:read'),
    canSetProperties: PROPERTY_PERMISSIONS.every((p) => has.has(p)),
  };
}

/** Check the connected key: `{ missing, canTag, canReadTags }`, or a PapraError for a refused key. */
export async function checkKey(api, connection) {
  const key = await clientFor(api, connection).currentKey();
  return keyAbilities(key.permissions);
}

/**
 * Open Bulwark's dialog to connect the user's key to the admin's server, then
 * check it. A key for another server, a refused key and a key without the
 * required permissions are disconnected again, so the next try starts clean.
 * @returns {Promise<{ connected: true, connection: object, canTag: boolean, canReadTags: boolean }
 *   | { connected: false, error?: PapraError }>}
 */
export async function connect(api) {
  const server = await adminServer(api);
  if (!server) return { connected: false, error: new PapraError('error.not_configured') };
  const result = await api.proxy.connect(CREDENTIAL, { mode: 'password', server });
  if (!result?.connected) return { connected: false };
  const drop = () => disconnect(api);
  if (result.origin && originOf(result.origin) !== originOf(server)) {
    await drop();
    return { connected: false, error: new PapraError('error.wrong_server_connect', { server: new URL(server).host }) };
  }
  const connection = await resolveConnection(api);
  if (connection.state !== 'connected') return { connected: false };
  let abilities;
  try {
    abilities = await checkKey(api, connection);
  } catch (err) {
    const e = toPapraError(err);
    if (e.key === 'error.key') await drop();
    return { connected: false, error: e };
  }
  if (abilities.missing.length) {
    await drop();
    return { connected: false, error: new PapraError('error.key_permissions', { missing: abilities.missing.join(', ') }) };
  }
  return { connected: true, connection, canTag: abilities.canTag, canReadTags: abilities.canReadTags, canSetProperties: abilities.canSetProperties };
}
