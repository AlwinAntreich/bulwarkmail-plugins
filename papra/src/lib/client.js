// A small Papra client on top of api.proxy.fetch. The API key never reaches
// the plugin: Bulwark's proxy adds `Authorization: Bearer ...` on the server,
// and only for the server the key was connected to.

import { PapraError, errorFromResponse } from './errors.js';
import { buildMultipart } from './multipart.js';

export const PAGE_SIZE = 25;
/** Papra's largest page. */
export const MAX_PAGE_SIZE = 100;

/** "https://papra.example.com/" → "https://papra.example.com", or '' when not an http(s) URL. */
export function normalizeBase(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  let text = value.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    const path = url.pathname.replace(/\/+$/, '').replace(/\/api$/, '');
    return `${url.origin}${path}`;
  } catch {
    return '';
  }
}

/**
 * Papra's search text for words and tags: `invoice acme tag:"Tax 2025"`.
 * Tag filters are always quoted (Papra matches them case-insensitively); a
 * double quote can't be escaped in Papra's syntax, so it is dropped.
 */
export function searchQuery(text = '', tags = []) {
  const parts = [];
  const words = String(text || '').trim();
  if (words) parts.push(words);
  for (const tag of tags) {
    const name = String(tag ?? '').replace(/"/g, '').trim();
    if (name) parts.push(`tag:"${name}"`);
  }
  return parts.join(' ');
}

const tagOf = (t) => ({ id: String(t?.id ?? ''), name: String(t?.name ?? ''), color: typeof t?.color === 'string' ? t.color : '' });

/** A document from Papra's API, reduced to what the plugin shows and uses. */
export function documentOf(d) {
  return {
    id: String(d?.id ?? ''),
    name: String(d?.name ?? d?.originalName ?? ''),
    mimeType: typeof d?.mimeType === 'string' && d.mimeType ? d.mimeType : 'application/octet-stream',
    size: Number.isFinite(d?.originalSize) ? d.originalSize : 0,
    createdAt: typeof d?.createdAt === 'string' ? d.createdAt : '',
    documentDate: typeof d?.documentDate === 'string' ? d.documentDate : '',
    tags: Array.isArray(d?.tags) ? d.tags.map(tagOf) : [],
  };
}

/** The file name in a Content-Disposition header, preferring RFC 5987 filename*. */
export function filenameFromDisposition(header) {
  if (typeof header !== 'string') return '';
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) {
    try { return decodeURIComponent(star[2].trim()); } catch { /* fall through */ }
  }
  const plain = /filename\s*=\s*"((?:[^"\\]|\\.)*)"|filename\s*=\s*([^;]+)/i.exec(header);
  if (plain) return (plain[1] ?? plain[2] ?? '').replace(/\\(.)/g, '$1').trim();
  return '';
}

const enc = encodeURIComponent;

export function createClient({ proxyFetch, credentialId, base }) {
  if (!base) throw new PapraError('error.not_configured');

  async function request(path, { method = 'GET', headers = {}, body, responseType = 'text', signal, onProgress } = {}) {
    const init = { method, headers: { Accept: 'application/json', ...headers }, responseType };
    if (body !== undefined) init.body = body;
    if (signal) init.signal = signal;
    if (onProgress) init.onProgress = onProgress;
    const res = await proxyFetch(credentialId, `${base}${path}`, init);
    if (!res || !res.ok) throw errorFromResponse(res || { status: 0, headers: {} });
    return res;
  }

  // Asked for as text and parsed here: an error page in HTML would make the
  // host's JSON parsing throw before the status is seen.
  async function json(path, opts) {
    const res = await request(path, opts);
    const text = typeof res.body === 'string' ? res.body : '';
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new PapraError('error.not_papra', {}, res.status);
    }
  }

  const sendJson = (method, path, data) => json(path, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });

  return {
    base,
    credentialId,

    /** The connected key's name and permissions; needs no permission, so it also checks the key. */
    async currentKey() {
      const key = (await json('/api/api-keys/current'))?.apiKey;
      if (!key || typeof key !== 'object') throw new PapraError('error.not_papra');
      return {
        id: String(key.id ?? ''),
        name: String(key.name ?? ''),
        permissions: Array.isArray(key.permissions) ? key.permissions.filter((p) => typeof p === 'string') : [],
      };
    },

    /** The user's organisations, by name. Needs organizations:read. */
    async organizations() {
      const rows = (await json('/api/organizations'))?.organizations;
      return (Array.isArray(rows) ? rows : [])
        .map((o) => ({ id: String(o?.id ?? ''), name: String(o?.name ?? '') }))
        .filter((o) => o.id)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    /** An organisation's tags, by name. Needs tags:read. */
    async tags(organizationId) {
      const rows = (await json(`/api/organizations/${enc(organizationId)}/tags`))?.tags;
      return (Array.isArray(rows) ? rows : []).map(tagOf).filter((t) => t.id).sort((a, b) => a.name.localeCompare(b.name));
    },

    /**
     * Full-text search in one organisation, newest first. `pageIndex` counts from 0.
     * Needs documents:read.
     */
    async searchDocuments(organizationId, { text = '', tags = [] } = {}, pageIndex = 0, pageSize = PAGE_SIZE) {
      const q = new URLSearchParams({
        searchQuery: searchQuery(text, tags),
        pageIndex: String(Math.max(0, Math.floor(pageIndex) || 0)),
        pageSize: String(Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || PAGE_SIZE))),
      });
      const data = await json(`/api/organizations/${enc(organizationId)}/documents?${q}`);
      const rows = Array.isArray(data?.documents) ? data.documents : [];
      return { count: Number.isFinite(data?.documentsCount) ? data.documentsCount : rows.length, documents: rows.map(documentOf) };
    },

    /**
     * Upload a file as a new document. Needs documents:create.
     * @param {{ data: Uint8Array|ArrayBuffer, name: string, type?: string }} file
     */
    async upload(organizationId, file, { signal, onProgress } = {}) {
      const { body, contentType } = buildMultipart([['file', { filename: file.name, type: file.type, data: file.data }]]);
      const data = await json(`/api/organizations/${enc(organizationId)}/documents`, {
        method: 'POST', headers: { 'Content-Type': contentType }, body, signal, onProgress,
      });
      if (!data?.document?.id) throw new PapraError('error.not_papra');
      return documentOf(data.document);
    },

    /** Add a tag to a document. Needs documents:update and tags:read. */
    async tagDocument(organizationId, documentId, tagId) {
      await sendJson('POST', `/api/organizations/${enc(organizationId)}/documents/${enc(documentId)}/tags`, { tagId });
    },

    /**
     * A document's file. Papra serves every file as application/octet-stream,
     * so the type comes from the document (its search result). Needs documents:read.
     */
    async download(organizationId, doc) {
      const res = await request(`/api/organizations/${enc(organizationId)}/documents/${enc(doc.id)}/file`, { responseType: 'arraybuffer' });
      const name = filenameFromDisposition(res.headers?.['content-disposition']) || doc.name || 'document';
      return { data: res.body, type: doc.mimeType || 'application/octet-stream', name };
    },
  };
}
