import { describe, it, expect } from 'vitest';
import { splitTerms, hasTerm, toggleTerm, tagTerm, hasFilter } from '../src/ui/query.js';

describe('search terms', () => {
  it('splits on spaces outside quotes', () => {
    expect(splitTerms('acme  tag:"Tax 2025" -has:tags content:"order 4711"')).toEqual(['acme', 'tag:"Tax 2025"', '-has:tags', 'content:"order 4711"']);
    expect(splitTerms('')).toEqual([]);
    expect(splitTerms('tag:"open')).toEqual(['tag:"open']);
  });

  it('adds a term at the end, or takes it out, ignoring case', () => {
    expect(toggleTerm('acme', 'tag:"Car"')).toBe('acme tag:"Car"');
    expect(toggleTerm('acme TAG:"car" x', 'tag:"Car"')).toBe('acme x');
    expect(toggleTerm('', '-has:tags')).toBe('-has:tags');
    expect(hasTerm('acme tag:"Car"', 'tag:"car"')).toBe(true);
    expect(hasTerm('acme tag:"Cars"', 'tag:"Car"')).toBe(false);
  });

  it('quotes tag names and drops double quotes', () => {
    expect(tagTerm('Tax 2025')).toBe('tag:"Tax 2025"');
    expect(tagTerm('say "hi"')).toBe('tag:"say hi"');
  });

  it('knows whether a search uses a filter', () => {
    expect(hasFilter('acme invoice')).toBe(false);
    expect(hasFilter('acme -tag:archived')).toBe(true);
    expect(hasFilter('date:>=2026')).toBe(true);
  });
});
