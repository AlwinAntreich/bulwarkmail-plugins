import { describe, it, expect } from 'vitest';
import { preselect, organizationOptions } from '../src/ui/organizations.js';

const orgs = [{ id: 'a', name: 'Alice' }, { id: 't', name: 'Team' }];

describe('preselect', () => {
  it('takes the user\'s default while it exists, else the only organisation, else none', () => {
    expect(preselect(orgs, 't')).toBe('t');
    expect(preselect(orgs, 'gone')).toBeNull();
    expect(preselect(orgs, null)).toBeNull();
    expect(preselect([orgs[1]], null)).toBe('t');
    expect(preselect([], 'a')).toBeNull();
  });
});

describe('organizationOptions', () => {
  const t = (key) => key;
  it('puts a "choose" entry first while nothing is selected', () => {
    expect(organizationOptions(orgs, null, t)).toEqual([{ value: '', label: 'field.organization_choose' }, { value: 'a', label: 'Alice' }, { value: 't', label: 'Team' }]);
    expect(organizationOptions(orgs, 'a', t)).toEqual([{ value: 'a', label: 'Alice' }, { value: 't', label: 'Team' }]);
  });
});
