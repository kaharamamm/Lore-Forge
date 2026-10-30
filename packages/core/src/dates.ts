import type { Calendar, DateText, Month } from './types.ts';

export type Precision = 'year' | 'month' | 'day';

export interface ParsedDate {
  /** Year as written, inside its era. */
  year: number;
  month?: number;
  day?: number;
  era: string;
  approx: boolean;
  precision: Precision;
  /** Earliest and latest absolute day this date can mean (inclusive). */
  lo: number;
  hi: number;
}

export type DateResult =
  | { kind: 'date'; date: ParsedDate }
  | { kind: 'unknown' }
  | { kind: 'invalid'; reason: string };

const DEFAULT_MONTHS: Month[] = Array.from({ length: 12 }, (_, i) => ({ name: `Month ${i + 1}`, days: 30 }));
const DATE_RE = /^(~)?\s*(-?\d+)(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?:\s+([A-Za-z][\w]*))?$/;

export function monthsOf(calendar: Calendar): Month[] {
  return calendar.months && calendar.months.length > 0 ? calendar.months : DEFAULT_MONTHS;
}

function daysPerYear(months: Month[]): number {
  return months.reduce((sum, m) => sum + m.days, 0);
}

export function parseDate(text: DateText | undefined, calendar: Calendar): DateResult {
  const raw = (text ?? '').trim();
  if (raw === '' || raw === '?' || raw.toLowerCase() === 'unknown') return { kind: 'unknown' };
  const m = DATE_RE.exec(raw);
  if (!m) return { kind: 'invalid', reason: `"${raw}" is not a date. Use YEAR, YEAR-MM, YEAR-MM-DD, an optional era code, ~ for approximate, or "unknown".` };
  const [, tilde, y, mo, d, eraCode] = m;
  const era = calendar.eras.find((e) => e.id.toLowerCase() === (eraCode ?? calendar.defaultEra).toLowerCase());
  if (!era) return { kind: 'invalid', reason: `"${raw}" uses an unknown era "${eraCode}". Known eras: ${calendar.eras.map((e) => e.id).join(', ')}.` };
  const months = monthsOf(calendar);
  const year = Number(y);
  const month = mo === undefined ? undefined : Number(mo);
  const day = d === undefined ? undefined : Number(d);
  if (month !== undefined && (month < 1 || month > months.length)) {
    return { kind: 'invalid', reason: `"${raw}" has month ${month}, but the calendar has ${months.length} months.` };
  }
  if (month !== undefined && day !== undefined) {
    const max = months[month - 1]!.days;
    if (day < 1 || day > max) return { kind: 'invalid', reason: `"${raw}" has day ${day}, but ${months[month - 1]!.name} has ${max} days.` };
  }
  const perYear = daysPerYear(months);
  const absYear = era.start + year - 1;
  const yearStart = absYear * perYear;
  let lo = yearStart;
  let hi = yearStart + perYear - 1;
  if (month !== undefined) {
    const offset = months.slice(0, month - 1).reduce((s, x) => s + x.days, 0);
    lo = yearStart + offset;
    hi = lo + months[month - 1]!.days - 1;
    if (day !== undefined) {
      lo = lo + day - 1;
      hi = lo;
    }
  }
  const approx = tilde === '~';
  if (approx) {
    const margin = (calendar.approxYears ?? 5) * perYear;
    lo -= margin;
    hi += margin;
  }
  const precision: Precision = day !== undefined ? 'day' : month !== undefined ? 'month' : 'year';
  return { kind: 'date', date: { year, month, day, era: era.id, approx, precision, lo, hi } };
}

/** The date for comparisons, or undefined if missing, unknown or invalid (invalid dates are reported by the invalid-date rule). */
export function dateOf(text: DateText | undefined, calendar: Calendar): ParsedDate | undefined {
  const r = parseDate(text, calendar);
  return r.kind === 'date' ? r.date : undefined;
}

/** True only when `a` is certainly before `b`, whatever the approximation. */
export function definitelyBefore(a: ParsedDate, b: ParsedDate): boolean {
  return a.hi < b.lo;
}

/** Plain-words rendering such as "1800", "c. 1800", "1920-03-12" or "312 OK". */
export function formatDate(d: ParsedDate, calendar: Calendar): string {
  let s = String(d.year);
  if (d.month !== undefined) s += `-${String(d.month).padStart(2, '0')}`;
  if (d.day !== undefined) s += `-${String(d.day).padStart(2, '0')}`;
  if (d.era !== calendar.defaultEra) s += ` ${d.era}`;
  return d.approx ? `c. ${s}` : s;
}

/** "in 1800" or "on 1920-03-12". */
export function atDate(d: ParsedDate, calendar: Calendar): string {
  return `${d.precision === 'day' && !d.approx ? 'on' : 'in'} ${formatDate(d, calendar)}`;
}

/** Describe a parsed date for UI hints, e.g. "Year 1800 of After the Sundering (approximate)". */
export function describeDate(text: DateText | undefined, calendar: Calendar): string {
  const r = parseDate(text, calendar);
  if (r.kind === 'unknown') return 'Unknown date';
  if (r.kind === 'invalid') return r.reason;
  const d = r.date;
  const era = calendar.eras.find((e) => e.id === d.era);
  const months = monthsOf(calendar);
  const parts: string[] = [];
  if (d.day !== undefined) parts.push(`Day ${d.day}`);
  if (d.month !== undefined) parts.push(months[d.month - 1]!.name);
  parts.push(`Year ${d.year} of ${era?.name ?? d.era}`);
  return parts.join(', ') + (d.approx ? ' (approximate)' : '');
}
