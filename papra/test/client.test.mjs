import { describe, it, expect } from 'vitest';
import { createClient, normalizeBase, searchQuery, documentOf, filenameFromDisposition, MAX_PAGE_SIZE } from '../src/lib/client.js';

const BASE = 'https://papra.example.com';
const ok = (body, headers = {}) => ({ status: 200, ok: true, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

/** A client whose proxy answers with `answer(url, init)` and records each call. */
function client(answer) {
  const calls = [];
  const c = createClient({
    credentialId: 'papra',
    base: BASE,
    proxyFetch: async (credentialId, url, init) => { calls.push({ credentialId, url, init }); return answer(url, init); },
  });
  return { c, calls };
}

describe('normalizeBase', () => {
  it('keeps the origin and a path, drops trailing slashes and /api', () => {
    expect(normalizeBase('https://papra.example.com/')).toBe(BASE);
    expect(normalizeBase('papra.example.com')).toBe(BASE);
    expect(normalizeBase('http://localhost:18012/api/')).toBe('http://localhost:18012');
    expect(normalizeBase('https://example.com/papra/')).toBe('https://example.com/papra');
  });

  it('is empty for what isn\'t an http(s) URL', () => {
    expect(normalizeBase('')).toBe('');
    expect(normalizeBase(undefined)).toBe('');
    expect(normalizeBase('ftp://papra.example.com')).toBe('');
  });
});

describe('searchQuery', () => {
  it('adds each tag as a quoted tag: filter after the words', () => {
    expect(searchQuery('acme invoice', ['Invoice', 'Tax 2025'])).toBe('acme invoice tag:"Invoice" tag:"Tax 2025"');
    expect(searchQuery('', ['Invoice'])).toBe('tag:"Invoice"');
    expect(searchQuery('  ', [])).toBe('');
  });

  it('drops double quotes from tag names, which Papra can\'t escape', () => {
    expect(searchQuery('', ['say "hi"', ' ', '""'])).toBe('tag:"say hi"');
  });
});

describe('documentOf', () => {
  it('keeps what the plugin shows and uses', () => {
    expect(documentOf({
      id: 'doc_1', name: 'acme.pdf', mimeType: 'application/pdf', originalSize: 646, createdAt: '2026-11-08T11:52:23.000Z',
      documentDate: null, tags: [{ id: 'tag_1', name: 'Invoice', color: '#E11D48', normalizedName: 'invoice' }], content: 'long text',
    })).toEqual({
      id: 'doc_1', name: 'acme.pdf', mimeType: 'application/pdf', size: 646, createdAt: '2026-11-08T11:52:23.000Z',
      documentDate: '', tags: [{ id: 'tag_1', name: 'Invoice', color: '#E11D48' }], createdBy: '', customProperties: [],
    });
  });

  it('fills gaps instead of failing', () => {
    expect(documentOf({ id: 'doc_2', originalName: 'scan.png' })).toMatchObject({ name: 'scan.png', mimeType: 'application/octet-stream', size: 0, tags: [] });
  });
});

describe('requests', () => {
  it('lists organisations by name', async () => {
    const { c, calls } = client(() => ok({ organizations: [{ id: 'org_b', name: 'Team' }, { id: 'org_a', name: 'Alice' }] }));
    expect(await c.organizations()).toEqual([{ id: 'org_a', name: 'Alice' }, { id: 'org_b', name: 'Team' }]);
    expect(calls[0]).toMatchObject({ credentialId: 'papra', url: `${BASE}/api/organizations`, init: { method: 'GET', responseType: 'text' } });
  });

  it('lists an organisation\'s tags by name', async () => {
    const { c, calls } = client(() => ok({ tags: [{ id: 't2', name: 'Invoice', color: '#E11D48' }, { id: 't1', name: 'Bulwark', color: '#7C3AED' }] }));
    expect((await c.tags('org_a')).map((t) => t.name)).toEqual(['Bulwark', 'Invoice']);
    expect(calls[0].url).toBe(`${BASE}/api/organizations/org_a/tags`);
  });

  it('searches with Papra\'s query syntax, page index from 0, at most 100 per page', async () => {
    const { c, calls } = client(() => ok({ documents: [{ id: 'doc_1', name: 'acme.pdf', tags: [] }], documentsCount: 7 }));
    const result = await c.searchDocuments('org_a', { text: 'acme', tags: ['Invoice'] }, 2, 500);
    expect(result).toMatchObject({ count: 7, documents: [{ id: 'doc_1', name: 'acme.pdf' }] });
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/api/organizations/org_a/documents');
    expect(Object.fromEntries(url.searchParams)).toEqual({ searchQuery: 'acme tag:"Invoice"', pageIndex: '2', pageSize: String(MAX_PAGE_SIZE) });
  });

  it('uploads one file in the multipart field "file"', async () => {
    const { c, calls } = client(() => ok({ document: { id: 'doc_9', name: 'invoice.pdf', mimeType: 'application/pdf' } }));
    const doc = await c.upload('org_a', { data: new TextEncoder().encode('%PDF-1.4'), name: 'invoice.pdf', type: 'application/pdf' });
    expect(doc).toMatchObject({ id: 'doc_9', name: 'invoice.pdf' });
    const { init } = calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/);
    const text = new TextDecoder().decode(init.body);
    expect(text).toContain('Content-Disposition: form-data; name="file"; filename="invoice.pdf"');
    expect(text).toContain('Content-Type: application/pdf');
    expect(text).toContain('%PDF-1.4');
  });

  it('tags a document; Papra answers 204 without a body', async () => {
    const { c, calls } = client(() => ({ status: 204, ok: true, headers: {}, body: '' }));
    await c.tagDocument('org_a', 'doc_9', 'tag_1');
    expect(calls[0]).toMatchObject({ url: `${BASE}/api/organizations/org_a/documents/doc_9/tags`, init: { method: 'POST', body: '{"tagId":"tag_1"}' } });
  });

  it('downloads a file with its name, and the type from the document', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const { c, calls } = client(() => ({
      status: 200, ok: true, body: bytes,
      headers: { 'content-type': 'application/octet-stream', 'content-disposition': "attachment; filename*=UTF-8''Rechnung%20M%C3%A4rz.pdf" },
    }));
    expect(await c.download('org_a', { id: 'doc_1', name: 'x.pdf', mimeType: 'application/pdf' }))
      .toEqual({ data: bytes, type: 'application/pdf', name: 'Rechnung März.pdf' });
    expect(calls[0]).toMatchObject({ url: `${BASE}/api/organizations/org_a/documents/doc_1/file`, init: { responseType: 'arraybuffer' } });
  });

  it('encodes ids in paths', async () => {
    const { c, calls } = client(() => ok({ tags: [] }));
    await c.tags('../admin');
    expect(calls[0].url).toBe(`${BASE}/api/organizations/..%2Fadmin/tags`);
  });

  it('turns an answer that isn\'t Papra\'s JSON into error.not_papra', async () => {
    const { c } = client(() => ok('<html>login</html>'));
    await expect(c.organizations()).rejects.toMatchObject({ key: 'error.not_papra' });
  });

  it('turns a refused request into a PapraError', async () => {
    const { c } = client(() => ({ status: 401, ok: false, headers: {}, body: '{"error":{"message":"Unauthorized","code":"auth.unauthorized"}}' }));
    await expect(c.currentKey()).rejects.toMatchObject({ key: 'error.key', status: 401 });
  });

  it('reads the key\'s permissions', async () => {
    const { c } = client(() => ok({ apiKey: { id: 'ak_1', name: 'bulwark', permissions: ['documents:read', 7] } }));
    expect(await c.currentKey()).toEqual({ id: 'ak_1', name: 'bulwark', permissions: ['documents:read'] });
  });

  it('needs a server', () => {
    expect(() => createClient({ proxyFetch: () => {}, credentialId: 'papra', base: '' })).toThrow('error.not_configured');
  });
});

describe('filenameFromDisposition', () => {
  it('prefers filename* and falls back to filename', () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''a%20b.pdf")).toBe('a b.pdf');
    expect(filenameFromDisposition('attachment; filename="a \\"b\\".pdf"')).toBe('a "b".pdf');
    expect(filenameFromDisposition(undefined)).toBe('');
  });
});
