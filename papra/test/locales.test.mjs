import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { locales } = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sources(p) : /\.(js|jsx)$/.test(e.name) ? [fs.readFileSync(p, 'utf8')] : [];
  });
}

// Keys in t('...') calls and in the message keys errors are made of.
const used = new Set(sources(path.join(root, 'src')).flatMap((text) => [
  ...[...text.matchAll(/\bt\(\s*'([a-z_]+\.[a-z_.]+)'/g)].map((m) => m[1]),
  ...[...text.matchAll(/'(error\.[a-z_]+)'/g)].map((m) => m[1]),
]));

describe('locales', () => {
  it('has English and German with the same keys and placeholders', () => {
    expect(Object.keys(locales).sort()).toEqual(['de', 'en']);
    expect(Object.keys(locales.de).sort()).toEqual(Object.keys(locales.en).sort());
    for (const [key, text] of Object.entries(locales.en)) {
      const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(vars(locales.de[key]), key).toEqual(vars(text));
    }
  });

  it('has a string for every key the code uses', () => {
    expect(used.size).toBeGreaterThan(10);
    expect([...used].filter((key) => !(key in locales.en))).toEqual([]);
  });
});
