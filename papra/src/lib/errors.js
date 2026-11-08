// Turns what went wrong talking to Papra into a message key the user can
// read: a refused key, a missing permission, a file too large, a rate limit,
// a timeout. Never a stack trace or an HTTP dump.

export class PapraError extends Error {
  /**
   * @param {string} key  i18n key, e.g. 'error.key'
   * @param {Record<string, string|number>} [vars]
   * @param {number} [status] HTTP status, when there was one
   */
  constructor(key, vars = {}, status = 0) {
    super(key);
    this.name = 'PapraError';
    this.key = key;
    this.vars = vars;
    this.status = status;
  }
}

function oneLine(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 197)}...` : flat;
}

function parse(body) {
  if (body && typeof body === 'object') return body;
  if (typeof body !== 'string' || !/^\s*[{[]/.test(body)) return null;
  try { return JSON.parse(body); } catch { return null; }
}

/** Papra's error answer `{ error: { message, code } }` as `{ message, code }`; empty strings when it isn't one. */
export function papraError(body) {
  const err = parse(body)?.error;
  if (!err || typeof err !== 'object') return { message: '', code: '' };
  return {
    message: typeof err.message === 'string' ? oneLine(err.message) : '',
    code: typeof err.code === 'string' ? err.code : '',
  };
}

function retryAfter(headers) {
  const seconds = Number(headers?.['retry-after']);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0;
}

/** A PapraError for a proxy result that was not ok. */
export function errorFromResponse(res) {
  if (res.proxyError) {
    switch (res.proxyError) {
      case 'no_credential': return new PapraError('error.not_connected', {}, res.status);
      case 'rate_limited': return new PapraError('error.rate_limit', { seconds: retryAfter(res.headers) || 60 }, 429);
      case 'timeout': return new PapraError('error.timeout', {}, 504);
      case 'unreachable': return new PapraError('error.unreachable', {}, 502);
      case 'blocked_address': return new PapraError('error.blocked', {}, 403);
      case 'too_large': return new PapraError('error.too_large', {}, 413);
      case 'wrong_origin': return new PapraError('error.wrong_server', {}, 403);
      default: return new PapraError('error.proxy', { detail: papraError(res.body).message || res.proxyError }, res.status);
    }
  }
  const { status } = res;
  const { message, code } = papraError(res.body);
  // Papra answers 401 both for a wrong key and for a key without the
  // permission a route needs; GET /api/api-keys/current tells them apart.
  if (status === 401) return new PapraError('error.key', {}, status);
  if (status === 403) return new PapraError('error.forbidden', {}, status);
  if (status === 404) return new PapraError('error.not_found', {}, status);
  if (status === 409 && code === 'document.already_exists') return new PapraError('error.duplicate', {}, status);
  if (status === 413) return new PapraError('error.too_large', {}, status);
  if (status === 429) return new PapraError('error.rate_limit', { seconds: retryAfter(res.headers) || 60 }, status);
  if (status === 502 || status === 503 || status === 504) return new PapraError('error.unavailable', {}, status);
  if (status >= 500) return new PapraError('error.server', {}, status);
  if (status >= 400) return new PapraError('error.rejected', { detail: message || `HTTP ${status}` }, status);
  return new PapraError('error.unexpected', { detail: `HTTP ${status}` }, status);
}

/** Any thrown value as a PapraError (host API failures, timeouts, bugs). */
export function toPapraError(err) {
  if (err instanceof PapraError) return err;
  const message = err && typeof err.message === 'string' ? err.message : String(err);
  if (/timed out|timeout/i.test(message)) return new PapraError('error.timeout');
  if (/cancel|abort/i.test(message)) return new PapraError('error.cancelled');
  if (/larger than/i.test(message)) return new PapraError('error.too_large');
  if (/permission|not allowed|not granted/i.test(message)) return new PapraError('error.permission');
  if (/network|failed to fetch/i.test(message)) return new PapraError('error.unreachable');
  // First line only: a stack trace is no use to the user.
  return new PapraError('error.unexpected', { detail: oneLine(message.split(/\r?\n/)[0]) });
}

/** The message for an error, in the user's language. */
export function errorText(t, err) {
  const e = toPapraError(err);
  return t(e.key, e.vars);
}
