// The api object for UI code. In the background instance activate() sets it;
// in a slot iframe it is the host module `@plugin-host`.

let current = null;

export function setApi(api) {
  current = api;
}

export function getApi() {
  if (current) return current;
  // eslint-disable-next-line no-undef -- provided by the sandbox (CommonJS bundle)
  current = require('@plugin-host');
  return current;
}

export function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
