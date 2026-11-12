import { useEffect, useState } from 'react';
import { Field, LinkButton, Row, Select, Stack } from '@plugin-host/ui';

/** Years offered: from 1950 to ten years ahead (documents and due dates). */
export function years(now = new Date()) {
  const last = now.getFullYear() + 10;
  return Array.from({ length: last - 1950 + 1 }, (_, i) => last - i);
}

const pad = (n) => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(Date.UTC(y || 2000, m || 1, 0)).getUTCDate();

/** 'YYYY-MM-DD' as { y, m, d } (numbers, 0 when unset). */
export function parts(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : { y: 0, m: 0, d: 0 };
}

/** { y, m, d } as 'YYYY-MM-DD' once all three are set; a day past the month's end becomes its last day. */
export function join({ y, m, d }) {
  if (!y || !m || !d) return '';
  return `${y}-${pad(m)}-${pad(Math.min(d, daysIn(y, m)))}`;
}

/**
 * A date as day, month and year lists. A native date field neither opens its
 * picker nor takes typing reliably inside the plugin's sandboxed frame
 * (Chrome refuses showPicker from a cross-origin frame), so lists it is.
 * `value` is 'YYYY-MM-DD' or ''; onChange gets the same, '' until all three
 * are chosen. `label` names the field.
 */
export function DateField({ label, value, onChange, t, locale }) {
  // A partly chosen date stays in the lists; the value is set once complete.
  const [chosen, setChosen] = useState(() => parts(value));
  useEffect(() => { if (value) setChosen(parts(value)); }, [value]);
  const { y, m, d } = chosen;
  const update = (next) => { setChosen(next); onChange(join(next)); };
  const set = (patch) => update({ ...chosen, ...patch });
  const months = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: new Intl.DateTimeFormat(locale || undefined, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, i, 1))),
  }));
  const today = new Date();
  return (
    <Field label={label}>
      <Stack gap={1}>
        <Row gap={2}>
          <Select aria-label={t('date.day', { name: label })} value={d ? String(d) : ''} onChange={(v) => set({ d: Number(v) })}
            options={[{ value: '', label: t('date.day_none') }, ...Array.from({ length: daysIn(y, m) }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))]} />
          <Select aria-label={t('date.month', { name: label })} value={m ? String(m) : ''} onChange={(v) => set({ m: Number(v) })}
            options={[{ value: '', label: t('date.month_none') }, ...months]} />
          <Select aria-label={t('date.year', { name: label })} value={y ? String(y) : ''} onChange={(v) => set({ y: Number(v) })}
            options={[{ value: '', label: t('date.year_none') }, ...years().map((n) => ({ value: String(n), label: String(n) }))]} />
        </Row>
        <Row gap={3}>
          <LinkButton onClick={() => update({ y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() })}>{t('date.today')}</LinkButton>
          {(y || m || d) ? <LinkButton onClick={() => update({ y: 0, m: 0, d: 0 })}>{t('date.clear')}</LinkButton> : null}
        </Row>
      </Stack>
    </Field>
  );
}
