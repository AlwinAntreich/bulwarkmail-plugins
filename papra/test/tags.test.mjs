import { describe, it, expect } from 'vitest';
import { parseTagList, matchTags } from '../src/lib/tags.js';

describe('parseTagList', () => {
  it('splits on commas, trims and drops empties and repeats', () => {
    expect(parseTagList(' Bulwark, invoice ,,bulwark, Tax 2025 ')).toEqual(['Bulwark', 'invoice', 'Tax 2025']);
    expect(parseTagList('')).toEqual([]);
    expect(parseTagList(undefined)).toEqual([]);
  });
});

describe('matchTags', () => {
  const tags = [{ id: 't1', name: 'Bulwark' }, { id: 't2', name: 'Invoice' }];
  it('finds tags by name, case-insensitively, and lists the missing ones', () => {
    expect(matchTags(['bulwark', 'Email', 'INVOICE'], tags)).toEqual({ tags: [tags[0], tags[1]], missing: ['Email'] });
    expect(matchTags([], tags)).toEqual({ tags: [], missing: [] });
    expect(matchTags(['Bulwark'], [])).toEqual({ tags: [], missing: ['Bulwark'] });
  });
});
