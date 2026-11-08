import { describe, it, expect } from 'vitest';
import { PapraError, errorFromResponse, toPapraError, errorText, papraError } from '../src/lib/errors.js';

const res = (status, body = '', extra = {}) => ({ status, ok: false, headers: {}, body, ...extra });
const papra = (message, code) => JSON.stringify({ error: { message, code } });

describe('errorFromResponse', () => {
  it('maps what the proxy refused', () => {
    expect(errorFromResponse(res(404, '', { proxyError: 'no_credential' })).key).toBe('error.not_connected');
    expect(errorFromResponse(res(403, '', { proxyError: 'wrong_origin' })).key).toBe('error.wrong_server');
    expect(errorFromResponse(res(502, '', { proxyError: 'unreachable' })).key).toBe('error.unreachable');
    expect(errorFromResponse(res(403, '', { proxyError: 'blocked_address' })).key).toBe('error.blocked');
    const limited = errorFromResponse(res(429, '', { proxyError: 'rate_limited', headers: { 'retry-after': '12' } }));
    expect([limited.key, limited.vars]).toEqual(['error.rate_limit', { seconds: 12 }]);
    expect(errorFromResponse(res(400, '', { proxyError: 'bad_url' })).vars).toEqual({ detail: 'bad_url' });
  });

  it('maps Papra\'s answers', () => {
    expect(errorFromResponse(res(401, papra('Unauthorized', 'auth.unauthorized'))).key).toBe('error.key');
    expect(errorFromResponse(res(404, papra('Document not found', 'document.not_found'))).key).toBe('error.not_found');
    expect(errorFromResponse(res(409, papra('Document already exists', 'document.already_exists'))).key).toBe('error.duplicate');
    expect(errorFromResponse(res(413, papra('Document size too large', 'document.size_too_large'))).key).toBe('error.too_large');
    expect(errorFromResponse(res(503)).key).toBe('error.unavailable');
    expect(errorFromResponse(res(500, '<html>oops</html>')).key).toBe('error.server');
  });

  it('passes Papra\'s message on for other rejections', () => {
    const e = errorFromResponse(res(400, papra('Invalid file   fieldname', 'document.invalid_file_fieldname')));
    expect([e.key, e.vars, e.status]).toEqual(['error.rejected', { detail: 'Invalid file fieldname' }, 400]);
    expect(errorFromResponse(res(400, 'nope')).vars).toEqual({ detail: 'HTTP 400' });
  });
});

describe('papraError', () => {
  it('reads { error: { message, code } } and nothing else', () => {
    expect(papraError(papra('Nope', 'x.y'))).toEqual({ message: 'Nope', code: 'x.y' });
    expect(papraError({ error: { message: 'Obj' } })).toEqual({ message: 'Obj', code: '' });
    expect(papraError('<html>')).toEqual({ message: '', code: '' });
    expect(papraError('{broken')).toEqual({ message: '', code: '' });
  });
});

describe('toPapraError', () => {
  it('keeps a PapraError and classifies the rest', () => {
    const e = new PapraError('error.key');
    expect(toPapraError(e)).toBe(e);
    expect(toPapraError(new Error('Request timed out')).key).toBe('error.timeout');
    expect(toPapraError(new Error('Plugin "papra" lacks permission "email:read"')).key).toBe('error.permission');
    expect(toPapraError(new Error('boom\n    at stack')).vars).toEqual({ detail: 'boom' });
  });

  it('gives the message in the user\'s language', () => {
    const t = (key, vars) => `${key}:${JSON.stringify(vars)}`;
    expect(errorText(t, new PapraError('error.rate_limit', { seconds: 5 }))).toBe('error.rate_limit:{"seconds":5}');
  });
});
