// Attaching Papra documents to the message being written: download each
// one through the proxy, upload it to the mail server, hand it to the
// composer.

import { PapraError, toPapraError } from './errors.js';

/** The proxy buffers answers up to this size; a larger document can't be downloaded this way. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * Attach the documents in order. Stops at the first problem and throws it,
 * with `attached` (the names attached so far) on the error.
 * @returns {Promise<string[]>} the names attached
 */
export async function attachDocuments({ api, client, organizationId, documents, composerId }) {
  const attached = [];
  const fail = (err) => {
    const e = toPapraError(err);
    e.attached = attached;
    return e;
  };
  for (const doc of documents) {
    if (doc.size > MAX_DOCUMENT_BYTES) throw fail(new PapraError('error.document_too_large', { name: doc.name }));
    let file;
    let blob;
    try {
      file = await client.download(organizationId, doc);
      blob = await api.jmap.uploadBlob(new Uint8Array(file.data), file.name, file.type);
    } catch (err) {
      throw fail(err);
    }
    let ok;
    try {
      ok = await api.composer.attach(composerId, { blobId: blob.blobId, name: file.name, type: blob.type || file.type, size: blob.size ?? file.data.byteLength });
    } catch (err) {
      throw fail(err);
    }
    if (ok === false) throw fail(new PapraError('error.attach_refused', { name: file.name }));
    attached.push(file.name);
  }
  return attached;
}
