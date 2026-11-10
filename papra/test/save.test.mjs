import { describe, it, expect } from 'vitest';
import { fakeApi } from '../../test-utils/fake-api.mjs';
import { attachmentOf, saveAttachment, MAX_ATTACHMENT_BYTES } from '../src/lib/save.js';
import { PapraError } from '../src/lib/errors.js';

const pdf = { name: 'invoice.pdf', type: 'application/pdf', size: 8, data: new TextEncoder().encode('%PDF-1.4').buffer };
const attachment = { emailId: 'm1', blobId: 'b1', name: 'invoice.pdf', type: 'application/pdf', size: 8 };

function fakeClient({ upload, tag, property } = {}) {
  const calls = [];
  return {
    calls,
    setProperty: async (org, doc, id, value) => { calls.push(['property', org, doc, id, value]); if (property) property(id); },
    upload: async (org, file) => { calls.push(['upload', org, file.name, file.type]); return upload ? upload() : { id: 'doc_1', name: file.name }; },
    tagDocument: async (org, doc, tagId) => { calls.push(['tag', org, doc, tagId]); if (tag) tag(tagId); },
  };
}

describe('attachmentOf', () => {
  it('reads an attachment-menu click', () => {
    expect(attachmentOf({ emailId: 'm1', blobId: 'b1', name: ' a.pdf ', type: 'application/pdf', size: 3 }))
      .toEqual({ emailId: 'm1', blobId: 'b1', name: 'a.pdf', type: 'application/pdf', size: 3 });
    expect(attachmentOf({ emailId: 'm1', blobId: 'b1' })).toMatchObject({ name: 'attachment', type: 'application/octet-stream', size: 0 });
    expect(attachmentOf({ emailId: 'm1' })).toBeNull();
    expect(attachmentOf(undefined)).toBeNull();
  });
});

describe('saveAttachment', () => {
  it('reads the attachment, uploads it to the organisation and adds each tag', async () => {
    const api = fakeApi({ handlers: { 'email.getAttachment': () => pdf } });
    const client = fakeClient();
    const result = await saveAttachment({ api, client, attachment, organizationId: 'org_a', tagIds: ['t1', 't2'] });
    expect(result).toEqual({ document: { id: 'doc_1', name: 'invoice.pdf' }, tagged: ['t1', 't2'], tagError: null, propertiesSet: [], propertyErrors: [] });
    expect(api.calls('email.getAttachment')[0].args).toEqual(['m1', 'b1']);
    expect(client.calls).toEqual([['upload', 'org_a', 'invoice.pdf', 'application/pdf'], ['tag', 'org_a', 'doc_1', 't1'], ['tag', 'org_a', 'doc_1', 't2']]);
  });

  it('sets each property after the tags, and tries the rest when Papra refuses one', async () => {
    const api = fakeApi({ handlers: { 'email.getAttachment': () => pdf } });
    const client = fakeClient({ property: (id) => { if (id === 'p2') throw new PapraError('error.rejected', { detail: 'invalid' }, 400); } });
    const properties = [{ id: 'p1', name: 'Owner', value: 'Agata' }, { id: 'p2', name: 'Amount', value: 1 }, { id: 'p3', name: 'Paid', value: false }];
    const result = await saveAttachment({ api, client, attachment, organizationId: 'org_a', tagIds: ['t1'], properties });
    expect(client.calls.filter((c) => c[0] !== 'upload')).toEqual([
      ['tag', 'org_a', 'doc_1', 't1'],
      ['property', 'org_a', 'doc_1', 'p1', 'Agata'],
      ['property', 'org_a', 'doc_1', 'p2', 1],
      ['property', 'org_a', 'doc_1', 'p3', false],
    ]);
    expect(result.propertiesSet).toEqual(['Owner', 'Paid']);
    expect(result.propertyErrors.map((e) => [e.name, e.error.key])).toEqual([['Amount', 'error.rejected']]);
  });

  it('keeps the upload when tagging fails, and stops tagging', async () => {
    const api = fakeApi({ handlers: { 'email.getAttachment': () => pdf } });
    const client = fakeClient({ tag: () => { throw new PapraError('error.key', {}, 401); } });
    const result = await saveAttachment({ api, client, attachment, organizationId: 'org_a', tagIds: ['t1', 't2'] });
    expect(result.document.id).toBe('doc_1');
    expect(result.tagged).toEqual([]);
    expect(result.tagError.key).toBe('error.key');
    expect(client.calls.filter((c) => c[0] === 'tag')).toHaveLength(1);
  });

  it('refuses an attachment over 25 MB before reading it', async () => {
    const api = fakeApi({ handlers: { 'email.getAttachment': () => pdf } });
    await expect(saveAttachment({ api, client: fakeClient(), attachment: { ...attachment, size: MAX_ATTACHMENT_BYTES + 1 }, organizationId: 'org_a' }))
      .rejects.toMatchObject({ key: 'error.mail_too_large' });
    expect(api.calls('email.getAttachment')).toHaveLength(0);
  });

  it('turns a failed read into a PapraError and uploads nothing', async () => {
    const api = fakeApi({ handlers: { 'email.getAttachment': () => { throw new Error('Attachment is larger than 25 MB'); } } });
    const client = fakeClient();
    await expect(saveAttachment({ api, client, attachment, organizationId: 'org_a' })).rejects.toMatchObject({ key: 'error.too_large' });
    expect(client.calls).toHaveLength(0);
  });

  it('lets an upload error through (a duplicate, a refused key)', async () => {
    const api = fakeApi({ handlers: { 'email.getAttachment': () => pdf } });
    const client = fakeClient({ upload: () => { throw new PapraError('error.duplicate', {}, 409); } });
    await expect(saveAttachment({ api, client, attachment, organizationId: 'org_a', tagIds: ['t1'] })).rejects.toMatchObject({ key: 'error.duplicate' });
    expect(client.calls.filter((c) => c[0] === 'tag')).toHaveLength(0);
  });
});
