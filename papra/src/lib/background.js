// The background side: "Save to Papra" in each attachment's menu, "From
// Papra" in the composer's Attach menu, and the flows behind them. index.js
// wires it to the host.

import { checkKey, clientFor, connect, resolveConnection } from './connection.js';
import { PapraError, errorText, toPapraError } from './errors.js';
import { attachDocuments } from './attach.js';
import { attachmentOf, saveAttachment } from './save.js';
import { parseTagList } from './tags.js';

export const ACTION_SAVE = 'save-attachment';
export const ACTION_ATTACH = 'from-papra';
/**
 * The organisation the user chose as their default on the settings page.
 * The dialogs preselect only this; the plugin never sets it by itself, so a
 * save to a shared organisation doesn't make the next one go there too.
 */
export const DEFAULT_ORGANIZATION_KEY = 'defaultOrganizationId';
/**
 * Below this a save is quick, and a spinner toast would only use up the
 * host's toast budget (5 per plugin in 10 seconds; past that they are
 * dropped, the result too).
 */
export const PROGRESS_FROM_BYTES = 1024 * 1024;

const hostOf = (url) => {
  try { return new URL(url).host; } catch { return String(url || ''); }
};

export function createBackground(api) {
  const t = (key, vars) => api.i18n.t(key, vars);
  const toastError = (err) => api.toast.error(errorText(t, err));

  /** A connected state and what the key may do, asking the user to connect when needed; null when they don't. */
  async function ensureConnection() {
    let connection = await resolveConnection(api);
    if (connection.state === 'not_configured') throw new PapraError('error.not_configured');
    if (connection.state === 'disconnected') {
      const host = hostOf(connection.server);
      const message = connection.wrongServer
        ? t('connect.wrong_server', { server: hostOf(connection.wrongServer), host })
        : t('connect.needed', { host });
      const go = await api.ui.confirm({ title: t('connect.title'), message, confirmLabel: t('connect.button'), cancelLabel: t('common.cancel') });
      if (!go) return null;
      const result = await connect(api);
      if (!result.connected) {
        if (result.error) throw result.error;
        return null;
      }
      return { connection: result.connection, canTag: result.canTag, canReadTags: result.canReadTags };
    }
    const { missing, canTag, canReadTags } = await checkKey(api, connection);
    if (missing.length) throw new PapraError('error.key_permissions', { missing: missing.join(', ') });
    return { connection, canTag, canReadTags };
  }

  /** A toast with a spinner while a save runs (large attachments take a while); null when the host has none to give. */
  async function showProgress(text) {
    try {
      const id = await api.toast.progress(text);
      return typeof id === 'string' ? id : null;
    } catch {
      return null;
    }
  }

  function hideProgress(id) {
    if (id) Promise.resolve().then(() => api.toast.dismiss(id)).catch(() => {});
  }

  async function saveFlow(context) {
    const attachment = attachmentOf(context);
    if (!attachment) return null;
    try {
      const ready = await ensureConnection();
      if (!ready) return null;
      const { connection, canTag } = ready;
      const config = await Promise.resolve(api.config.get()).catch(() => ({}));
      const choice = await api.ui.openDialog({
        title: t('dialog.title'),
        slot: 'plugin-dialog',
        width: 520,
        extraProps: {
          view: 'save',
          attachment: { name: attachment.name, size: attachment.size },
          connection,
          canTag,
          defaultTags: parseTagList(config?.defaultTags),
          organizationId: await api.storage.get(DEFAULT_ORGANIZATION_KEY).catch(() => null),
        },
      });
      if (!choice?.organizationId) return null;
      const progress = attachment.size >= PROGRESS_FROM_BYTES ? await showProgress(t('save.saving', { name: attachment.name })) : null;
      let result;
      try {
        result = await saveAttachment({
          api, client: clientFor(api, connection), attachment, organizationId: choice.organizationId, tagIds: canTag ? choice.tagIds || [] : [],
        });
      } finally {
        hideProgress(progress);
      }
      report(attachment, choice, result);
      return result;
    } catch (err) {
      const e = toPapraError(err);
      if (e.key === 'error.duplicate') api.toast.info(t('done.duplicate', { name: attachment.name }));
      else toastError(e);
      return null;
    }
  }

  /** One toast per save, so a warning isn't dropped by the host's toast budget. */
  function report(attachment, choice, { tagError }) {
    const vars = { name: attachment.name, organization: choice.organizationName || '' };
    if (tagError) api.toast.warning(t('done.saved_tag_failed', { ...vars, error: errorText(t, tagError) }));
    else if (choice.missingDefaults?.length) api.toast.warning(t('done.saved_missing_tags', { ...vars, tags: choice.missingDefaults.join(', ') }));
    else api.toast.success(t('done.saved', vars));
  }

  async function attachFlow(context) {
    const composerId = context?.composerId;
    if (!composerId) return null;
    let progress = null;
    try {
      const ready = await ensureConnection();
      if (!ready) return null;
      const { connection, canReadTags } = ready;
      const choice = await api.ui.openDialog({
        title: t('pick.title'),
        slot: 'plugin-dialog',
        width: 640,
        extraProps: {
          view: 'pick',
          connection,
          canReadTags,
          organizationId: await api.storage.get(DEFAULT_ORGANIZATION_KEY).catch(() => null),
        },
      });
      const documents = Array.isArray(choice?.documents) ? choice.documents : [];
      if (!choice?.organizationId || !documents.length) return null;
      const total = documents.reduce((n, d) => n + (Number(d.size) || 0), 0);
      if (total >= PROGRESS_FROM_BYTES) progress = await showProgress(t('pick.attaching', { count: documents.length }));
      const attached = await attachDocuments({ api, client: clientFor(api, connection), organizationId: choice.organizationId, documents, composerId });
      hideProgress(progress);
      api.toast.success(attached.length === 1 ? t('pick.attached_one', { name: attached[0] }) : t('pick.attached', { count: attached.length }));
      return attached;
    } catch (err) {
      hideProgress(progress);
      const e = toPapraError(err);
      const done = Array.isArray(err?.attached) ? err.attached.length : 0;
      api.toast.error(done ? t('pick.partly', { count: done, error: errorText(t, e) }) : errorText(t, e));
      return null;
    }
  }

  /** onAction: start the flow and return at once (the host times hooks out). */
  function onAction({ actionId, context } = {}) {
    if (actionId === ACTION_SAVE) return saveFlow(context);
    if (actionId === ACTION_ATTACH) return attachFlow(context);
    return null;
  }

  /** The menu entries, in the current language. */
  async function registerUi() {
    const entries = [
      ['attachment-menu', [{ id: ACTION_SAVE, label: t('action.save'), icon: 'archive' }]],
      ['composer-attach-menu', [{ id: ACTION_ATTACH, label: t('action.attach'), icon: 'archive' }]],
    ];
    await Promise.all(entries.map(([surface, actions]) => Promise.resolve()
      .then(() => api.ui.setActions(surface, actions))
      .catch((err) => api.log?.warn?.(`setting up ${surface} failed`, err?.message))));
  }

  return { onAction, registerUi, saveFlow, attachFlow };
}
