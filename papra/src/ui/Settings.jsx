import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Field, Loading, Section, Select, Stack, Text } from '@plugin-host/ui';
import { getApi } from './host.js';
import { CREDENTIAL, clientFor, connect, keyAbilities, resolveConnection } from '../lib/connection.js';
import { errorText } from '../lib/errors.js';
import { readPrefs, updatePrefs } from '../lib/prefs.js';
import { DefaultProperties } from './DefaultProperties.jsx';

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
  const [synced, setSynced] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setKey(null);
    setOrganizations(null);
    const next = await resolveConnection(api);
    setConnection(next);
    const { prefs, synced: inAccount } = await readPrefs(api);
    setDefaultId(prefs.defaultOrganizationId || '');
    setSynced(inAccount);
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
      setDefaultId(value || '');
      setSynced((await updatePrefs(api, { defaultOrganizationId: value || null })).synced);
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
              {key && <Text>{t('settings.connected', { host, name: key.name })}</Text>}
              {!key && !error && <Text tone="muted">{t('common.loading')}</Text>}
              {!key && error && <Text>{t('settings.check_failed', { host })}</Text>}
              {key && key.missing.length > 0 && <Alert tone="warning" icon="alert-triangle">{t('settings.missing', { missing: key.missing.join(', ') })}</Alert>}
              {key && key.missing.length === 0 && !key.canTag && <Text tone="muted">{t('settings.cannot_tag')}</Text>}
              {key && key.missing.length === 0 && !key.canSetProperties && <Text tone="muted">{t('settings.cannot_set_properties')}</Text>}
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
      {connection.state === 'connected' && organizations && organizations.length > 0 && (
        <Text tone="muted">{synced ? t('settings.prefs_synced') : t('settings.prefs_local')}</Text>
      )}
      {connection.state === 'connected' && key?.canSetProperties && organizations && organizations.length > 0 && (
        <Section title={t('settings.default_properties')} description={t('settings.default_properties_hint')}>
          <DefaultProperties api={api} client={clientFor(api, connection)} organizations={organizations} t={t} />
        </Section>
      )}
    </Stack>
  );
}
