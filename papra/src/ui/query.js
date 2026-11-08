// Terms in a Papra search, for the quick filters and tips that add or
// remove one. The search text itself goes to Papra unchanged.

/** `acme tag:"Tax 2025" -has:tags` → ['acme', 'tag:"Tax 2025"', '-has:tags']: split on spaces outside quotes. */
export function splitTerms(text) {
  return String(text || '').match(/(?:[^\s"]+|"[^"]*"?)+/g) || [];
}

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/** Whether the search has this term (Papra compares tag names without case). */
export function hasTerm(text, term) {
  return splitTerms(text).some((t) => same(t, term));
}

/** The search with the term added at the end, or taken out when it is there. */
export function toggleTerm(text, term) {
  const terms = splitTerms(text);
  const next = terms.some((t) => same(t, term)) ? terms.filter((t) => !same(t, term)) : [...terms, term];
  return next.join(' ');
}

/** A tag as a search term: always quoted, so names with spaces work; a `"` can't be escaped in Papra's syntax and is dropped. */
export function tagTerm(name) {
  return `tag:"${String(name).replace(/"/g, '')}"`;
}

/** Whether the search uses a filter (`tag:`, `date:`, `has:`, ...), for the hint when nothing is found. */
export function hasFilter(text) {
  return splitTerms(text).some((t) => /^-?[a-z]+:/i.test(t));
}
