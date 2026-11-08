// Saving one attachment to Papra: read it from the mail server, upload it to
// the chosen organisation, then add the tags (Papra's upload takes none).

import { PapraError, toPapraError } from './errors.js';

/** api.email.getAttachment reads at most this much. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** The attachment from an attachment-menu click, or null when the click carries none. */
export function attachmentOf(context) {
  const c = context || {};
  if (!c.emailId || !c.blobId) return null;
  return {
    emailId: String(c.emailId),
    blobId: String(c.blobId),
    name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : 'attachment',
    type: typeof c.type === 'string' && c.type ? c.type : 'application/octet-stream',
    size: Number.isFinite(c.size) ? c.size : 0,
  };
}

/**
 * Read, upload and tag. Tagging failures don't undo the upload: the document
 * is in Papra, and `tagError` says why it has fewer tags.
 * @returns {Promise<{ document: object, tagged: string[], tagError: PapraError|null }>}
 */
export async function saveAttachment({ api, client, attachment, organizationId, tagIds = [] }) {
  if (attachment.size > MAX_ATTACHMENT_BYTES) throw new PapraError('error.mail_too_large');
  let file;
  try {
    file = await api.email.getAttachment(attachment.emailId, attachment.blobId);
  } catch (err) {
    throw toPapraError(err);
  }
  const document = await client.upload(organizationId, {
    data: file.data,
    name: file.name || attachment.name,
    type: file.type || attachment.type,
  });
  const tagged = [];
  let tagError = null;
  for (const tagId of tagIds) {
    try {
      await client.tagDocument(organizationId, document.id, tagId);
      tagged.push(tagId);
    } catch (err) {
      // The same reason (a lost permission, Papra gone) holds for the rest.
      tagError = toPapraError(err);
      break;
    }
  }
  return { document, tagged, tagError };
}
