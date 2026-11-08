import { describe, it, expect } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { attachDocuments, MAX_DOCUMENT_BYTES } from '../src/lib/attach.js';
import { PapraError } from '../src/lib/errors.js';

const docs = [
  { id: 'd1', name: 'a.pdf', mimeType: 'application/pdf', size: 3 },
  { id: 'd2', name: 'b.png', mimeType: 'image/png', size: 4 },
];

function setup({ attach = () => true, download } = {}) {
  const api = fakeApi({
    handlers: {
      'jmap.uploadBlob': (bytes, name, type) => ({ blobId: `blob-${name}`, size: bytes.byteLength, type }),
      'composer.attach': attach,
    },
  });
  const client = {
    downloads: [],
    async download(org, doc) {
      this.downloads.push([org, doc.id]);
      if (download) return download(doc);
      return { data: new Uint8Array(doc.size).buffer, name: doc.name, type: doc.mimeType };
    },
  };
  return { api, client };
}

describe('attachDocuments', () => {
  it('downloads each document, uploads it to the mail server and hands it to the composer', async () => {
    const { api, client } = setup();
    expect(await attachDocuments({ api, client, organizationId: 'org_a', documents: docs, composerId: 'c1' })).toEqual(['a.pdf', 'b.png']);
    expect(client.downloads).toEqual([['org_a', 'd1'], ['org_a', 'd2']]);
    expect(api.calls('jmap.uploadBlob').map((c) => [c.args[1], c.args[2], c.args[0].byteLength])).toEqual([['a.pdf', 'application/pdf', 3], ['b.png', 'image/png', 4]]);
    expect(api.calls('composer.attach').map((c) => c.args)).toEqual([
      ['c1', { blobId: 'blob-a.pdf', name: 'a.pdf', type: 'application/pdf', size: 3 }],
      ['c1', { blobId: 'blob-b.png', name: 'b.png', type: 'image/png', size: 4 }],
    ]);
  });

  it('stops when the composer refuses a file, and says what was attached before', async () => {
    const { api, client } = setup({ attach: (_c, file) => file.name !== 'b.png' });
    const err = await attachDocuments({ api, client, organizationId: 'org_a', documents: docs, composerId: 'c1' }).catch((e) => e);
    expect([err.key, err.vars, err.attached]).toEqual(['error.attach_refused', { name: 'b.png' }, ['a.pdf']]);
  });

  it('refuses a document over 25 MB without downloading it', async () => {
    const { api, client } = setup();
    const big = { id: 'd3', name: 'scan.tiff', mimeType: 'image/tiff', size: MAX_DOCUMENT_BYTES + 1 };
    const err = await attachDocuments({ api, client, organizationId: 'org_a', documents: [big], composerId: 'c1' }).catch((e) => e);
    expect([err.key, err.attached]).toEqual(['error.document_too_large', []]);
    expect(client.downloads).toEqual([]);
  });

  it('passes a download error on as a PapraError', async () => {
    const { api, client } = setup({ download: () => { throw new PapraError('error.unreachable'); } });
    await expect(attachDocuments({ api, client, organizationId: 'org_a', documents: docs, composerId: 'c1' })).rejects.toMatchObject({ key: 'error.unreachable', attached: [] });
    expect(api.calls('composer.attach')).toHaveLength(0);
  });
});
