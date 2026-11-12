import { describe, it, expect } from 'vitest';
import { definitionsOf, isSet, apiValue, describe as describeValue, applyDefaults, usersIn, ME } from '../src/lib/properties.js';

const t = (key) => ({ 'prop.yes': 'yes', 'prop.no': 'no' })[key] || key;
const defs = definitionsOf([
  { id: 'p1', name: 'Owner', type: 'text', displayOrder: 0 },
  { id: 'p2', name: 'Category', type: 'select', displayOrder: 0, options: [{ id: 'o1', name: 'Private' }, { id: 'o2', name: 'Business' }] },
  { id: 'p3', name: 'Amount', type: 'number', displayOrder: 1 },
  { id: 'p4', name: 'Due', type: 'date', displayOrder: 1 },
  { id: 'p5', name: 'Paid', type: 'boolean', displayOrder: 1 },
  { id: 'p6', name: 'Topics', type: 'multi_select', displayOrder: 1, options: [{ id: 'm1', name: 'Car' }, { id: 'm2', name: 'House' }] },
  { id: 'p7', name: 'Responsible', type: 'user_relation', displayOrder: 1 },
  { id: 'p8', name: 'Related', type: 'document_relation', displayOrder: 1 },
  { id: 'p9', name: 'Odd', type: 'future_type' },
]);
const d = (name) => defs.find((x) => x.name === name);

describe('definitionsOf', () => {
  it('keeps the known types in Papra\'s order, then by name', () => {
    expect(defs.map((x) => x.name)).toEqual(['Category', 'Owner', 'Amount', 'Due', 'Paid', 'Related', 'Responsible', 'Topics']);
    expect(d('Category').options).toEqual([{ id: 'o1', name: 'Private' }, { id: 'o2', name: 'Business' }]);
  });
});

describe('values', () => {
  it('turns dialog values into what Papra takes, or nothing', () => {
    expect(apiValue(d('Owner'), '  Agata ')).toBe('Agata');
    expect(apiValue(d('Owner'), '   ')).toBeUndefined();
    expect(apiValue(d('Amount'), '84,50')).toBe(84.5);
    expect(apiValue(d('Amount'), 'abc')).toBeUndefined();
    expect(apiValue(d('Due'), '2026-12-01')).toBe('2026-12-01');
    expect(apiValue(d('Due'), '12/01/2026')).toBeUndefined();
    expect(apiValue(d('Paid'), false)).toBe(false);
    expect(apiValue(d('Paid'), undefined)).toBeUndefined();
    expect(apiValue(d('Category'), 'o2')).toBe('o2');
    expect(apiValue(d('Category'), 'gone')).toBeUndefined();
    expect(apiValue(d('Topics'), ['m1', 'gone'])).toEqual(['m1']);
    expect(apiValue(d('Responsible'), [{ id: 'u1', name: 'Me' }])).toEqual(['u1']);
    expect(apiValue(d('Related'), [{ id: 'doc_1', name: 'a.pdf' }])).toEqual(['doc_1']);
    expect(isSet(d('Topics'), [])).toBe(false);
  });

  it('says a value in words', () => {
    expect(describeValue(d('Category'), 'o1', t)).toBe('Private');
    expect(describeValue(d('Topics'), ['m1', 'm2'], t)).toBe('Car, House');
    expect(describeValue(d('Paid'), false, t)).toBe('no');
    expect(describeValue(d('Responsible'), [{ id: 'u1', name: 'Me' }], t)).toBe('Me');
    expect(describeValue(d('Owner'), '', t)).toBe('');
    expect(describeValue(d('Due'), '2026-12-01', t, 'en-US')).toBe('Dec 1, 2026');
    expect(describeValue(d('Due'), '2026-12-01', t, 'de')).toBe('1. Dez. 2026');
  });
});

describe('applyDefaults', () => {
  it('matches defaults by property and option name, and names what the organisation lacks', () => {
    const { values, missing } = applyDefaults([
      { name: 'owner', value: 'Alwin Antreich' },
      { name: 'Category', value: 'private' },
      { name: 'Topics', value: ['Car', 'Garden'] },
      { name: 'Paid', value: false },
      { name: 'Responsible', value: ME },
      { name: 'Project', value: 'X' },
      { name: 'Category', value: 'Unknown' },
    ], defs, { id: 'u_me', name: 'Me' });
    expect(values).toEqual({ p1: 'Alwin Antreich', p2: 'o1', p6: ['m1'], p5: false, p7: [{ id: 'u_me', name: 'Me' }] });
    expect(missing).toEqual(['Topics: Garden', 'Project', 'Category: Unknown']);
  });

  it('leaves "me" out until the plugin knows the user\'s Papra account, without a notice', () => {
    expect(applyDefaults([{ name: 'Responsible', value: ME }], defs, null)).toEqual({ values: {}, missing: [] });
  });

  it('takes no default for a linked document', () => {
    expect(applyDefaults([{ name: 'Related', value: 'x' }], defs).missing).toEqual(['Related']);
  });
});

describe('usersIn', () => {
  it('collects the Papra users named on documents, once each', () => {
    const docs = [
      { customProperties: [{ type: 'user_relation', value: [{ userId: 'u2', name: 'Karin' }, { userId: 'u1', name: 'Agata' }] }] },
      { customProperties: [{ type: 'user_relation', value: [{ userId: 'u2', name: 'Karin' }] }, { type: 'text', value: 'x' }] },
      {},
    ];
    expect(usersIn(docs)).toEqual([{ id: 'u1', name: 'Agata' }, { id: 'u2', name: 'Karin' }]);
  });
});
