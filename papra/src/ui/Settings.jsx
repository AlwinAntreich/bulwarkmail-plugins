import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Field, Loading, Section, Select, Stack, Text } from '@plugin-host/ui';
import { getApi } from './host.js';
import { CREDENTIAL, clientFor, connect, keyAbilities, resolveConnection } from '../lib/connection.js';
import { errorText } from '../lib/errors.js';
import { DEFAULT_ORGANIZATION_KEY } from '../lib/background.js';

const hostOf = (url) => {
  try { return new URL(url).host; } catch { return String(url || ''); }
};

/**
 * The plugin's section in Settings: the connection to the admin's Papra
 * (connect, disconnect, what the key may do) and the user's default
 * organisation, which the dialogs preselect.
 */
export function Settings({ api = getApi() }) {
  const t = (key, vars) => api.i18n.t(key, vars);
  const [connection, setConnection] = useState(null);
  const [key, setKey] = useState(null);
  const [organizations, setOrganizations] = useState(null);
  const [defaultId, setDefaultId] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setKey(null);
    setOrganizations(null);
    const next = await resolveConnection(api);
    setConnection(next);
    setDefaultId((await api.storage.get(DEFAULT_ORGANIZATION_KEY).catch(() => null)) || '');
    if (next.state !== 'connected') return;
    try {
      const client = clientFor(api, next);
      const current = await client.currentKey();
      setKey({ name: current.name, ...keyAbilities(current.permissions) });
      setOrganizations(await client.organizations());
    } catch (err) {
      setError(err);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const onConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await connect(api);
      if (result.error) setError(result.error);
      if (result.connected) await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    setBusy(true);
    try {
      await api.proxy.disconnect(CREDENTIAL);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const onDefault = async (value) => {
    setError(null);
    try {
      if (value) await api.storage.set(DEFAULT_ORGANIZATION_KEY, value);
      else await api.storage.remove(DEFAULT_ORGANIZATION_KEY);
      setDefaultId(value || '');
    } catch (err) {
      setError(err);
    }
  };

  if (!connection) return <Loading label={t('common.loading')} />;
  const host = hostOf(connection.server);
  // A default that is gone (organisation deleted, other key) shows as none.
  const shownDefault = organizations?.some((o) => o.id === defaultId) ? defaultId : '';

  return (
    <Stack gap={4}>
      <Section title={t('settings.connection')}>
        <Stack gap={3}>
          {connection.state === 'not_configured' && <Alert tone="info" icon="info-circle">{t('settings.not_configured')}</Alert>}
          {connection.state === 'disconnected' && (
            <>
              {connection.wrongServer && (
                <Alert tone="warning" icon="alert-triangle">{t('settings.wrong_server', { server: hostOf(connection.wrongServer), host })}</Alert>
              )}
              <Text>{t('settings.disconnected', { host })}</Text>
              <div><Button busy={busy} onClick={onConnect}>{t('connect.title')}</Button></div>
            </>
          )}
          {connection.state === 'connected' && (
            <>
              <Text>{t('settings.connected', { host, name: key?.name || '…' })}</Text>
              {key && key.missing.length > 0 && <Alert tone="warning" icon="alert-triangle">{t('settings.missing', { missing: key.missing.join(', ') })}</Alert>}
              {key && key.missing.length === 0 && !key.canTag && <Text tone="muted">{t('settings.cannot_tag')}</Text>}
              <div><Button variant="secondary" busy={busy} onClick={onDisconnect}>{t('settings.disconnect')}</Button></div>
            </>
          )}
          {error && <Alert tone="danger" icon="alert-circle">{errorText(t, error)}</Alert>}
        </Stack>
      </Section>
      {connection.state === 'connected' && organizations && organizations.length > 0 && (
        <Section title={t('settings.default_organization')}>
          <Field label={t('field.organization')} hint={t('settings.default_organization_hint')}>
            <Select block value={shownDefault} onChange={onDefault}
              options={[{ value: '', label: t('settings.no_default') }, ...organizations.map((o) => ({ value: o.id, label: o.name }))]} />
          </Field>
        </Section>
      )}
    </Stack>
  );
}
