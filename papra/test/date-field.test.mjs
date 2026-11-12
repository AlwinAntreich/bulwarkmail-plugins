// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DateField, join, parts, years } from '../src/ui/DateField.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

const t = (key, vars) => ({ 'date.day': `${vars?.name}: day`, 'date.month': `${vars?.name}: month`, 'date.year': `${vars?.name}: year`, 'date.today': 'Today', 'date.clear': 'Clear' })[key] || key;

function show(value = '') {
  const onChange = vi.fn();
  render(React.createElement(DateField, { label: 'Due', value, onChange, t, locale: 'en' }));
  return onChange;
}
const pick = async (name, value) => { await act(async () => { fireEvent.change(screen.getByLabelText(name), { target: { value } }); }); };

describe('DateField', () => {
  it('sets the date once day, month and year are chosen', async () => {
    const onChange = show();
    await pick('Due: day', '1');
    await pick('Due: month', '12');
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['', '']);
    await pick('Due: year', '2026');
    expect(onChange).toHaveBeenLastCalledWith('2026-12-01');
    expect(screen.getByLabelText('Due: month').selectedOptions[0].textContent).toBe('December');
  });

  it('shows a set value, and offers Today and Clear', async () => {
    const onChange = show('2026-02-14');
    expect([screen.getByLabelText('Due: day').value, screen.getByLabelText('Due: month').value, screen.getByLabelText('Due: year').value]).toEqual(['14', '2', '2026']);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear' })); });
    expect(onChange).toHaveBeenLastCalledWith('');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Today' })); });
    expect(onChange.mock.calls.at(-1)[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('date parts', () => {
  it('joins and splits dates, keeping a day within its month', () => {
    expect(join({ y: 2026, m: 2, d: 31 })).toBe('2026-02-28');
    expect(join({ y: 2028, m: 2, d: 30 })).toBe('2028-02-29');
    expect(join({ y: 2026, m: 0, d: 3 })).toBe('');
    expect(parts('2026-12-01')).toEqual({ y: 2026, m: 12, d: 1 });
    expect(parts('nope')).toEqual({ y: 0, m: 0, d: 0 });
    const list = years(new Date('2026-06-01'));
    expect([list[0], list.at(-1)]).toEqual([2036, 1950]);
  });
});
