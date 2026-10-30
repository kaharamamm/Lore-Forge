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
  /** Day and month known, year not (DD.MM). Valid, but never compared or placed on the timeline. */
  | { kind: 'yearless'; day: number; month: number; approx: boolean }
  | { kind: 'unknown' }
  | { kind: 'invalid'; reason: string };

const DEFAULT_MONTHS: Month[] = Array.from({ length: 12 }, (_, i) => ({ name: `Month ${i + 1}`, days: 30 }));
/** `[~] body [ERA]`; the body is ISO-like (YEAR, YEAR-MM, YEAR-MM-DD) or dotted (YYYY, MM.YYYY, DD.MM.YYYY, DD.MM). */
const DATE_RE = /^(~)?\s*([-\d.]+?)(?:\s+([A-Za-z]\w*))?$/;
const ISO_RE = /^(-?\d+)(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/;
const DOT3_RE = /^(\d{1,2})\.(\d{1,2})\.(-?\d+)$/;
const DOT2_RE = /^(\d{1,2})\.(-?\d+)\.?$/;

export const DATE_FORMATS_HINT = 'YYYY, MM.YYYY, DD.MM.YYYY or DD.MM (year unknown); ~ for approximate, an optional era code, or "unknown"';

export function monthsOf(calendar: Calendar): Month[] {
  return calendar.months && calendar.months.length > 0 ? calendar.months : DEFAULT_MONTHS;
}

function daysPerYear(months: Month[]): number {
  return months.reduce((sum, m) => sum + m.days, 0);
}

/** Year, month and day as written, or undefined if the body has no known shape. `year` is undefined for DD.MM. */
function splitBody(body: string, hasEra: boolean): { year?: number; month?: number; day?: number } | undefined {
  let m = ISO_RE.exec(body);
  if (m) return { year: Number(m[1]), ...(m[2] !== undefined ? { month: Number(m[2]) } : {}), ...(m[3] !== undefined ? { day: Number(m[3]) } : {}) };
  m = DOT3_RE.exec(body);
  if (m) return { day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) };
  m = DOT2_RE.exec(body);
  if (m) {
    // "03.1920" is month.year; "12.03" is day.month. A year needs 3+ digits (write 0050 for year 50), a minus sign, or an era code.
    const second = m[2]!;
    const isYear = !body.endsWith('.') && (hasEra || second.startsWith('-') || second.length >= 3);
    return isYear ? { month: Number(m[1]), year: Number(second) } : { day: Number(m[1]), month: Number(second) };
  }
  return undefined;
}

export function parseDate(text: DateText | undefined, calendar: Calendar): DateResult {
  const raw = (text ?? '').trim();
  if (raw === '' || raw === '?' || raw.toLowerCase() === 'unknown') return { kind: 'unknown' };
  const m = DATE_RE.exec(raw);
  const parts = m ? splitBody(m[2]!, m[3] !== undefined) : undefined;
  if (!m || !parts) return { kind: 'invalid', reason: `"${raw}" is not a date. Use ${DATE_FORMATS_HINT}.` };
  const [, tilde, , eraCode] = m;
  const approx = tilde === '~';
  const months = monthsOf(calendar);
  const { year, month, day } = parts;
  if (month !== undefined && (month < 1 || month > months.length)) {
    return { kind: 'invalid', reason: `"${raw}" has month ${month}, but the calendar has ${months.length} months.` };
  }
  if (month !== undefined && day !== undefined) {
    const max = months[month - 1]!.days;
    if (day < 1 || day > max) return { kind: 'invalid', reason: `"${raw}" has day ${day}, but ${months[month - 1]!.name} has ${max} days.` };
  }
  if (year === undefined) return { kind: 'yearless', day: day!, month: month!, approx };
  const era = calendar.eras.find((e) => e.id.toLowerCase() === (eraCode ?? calendar.defaultEra).toLowerCase());
  if (!era) return { kind: 'invalid', reason: `"${raw}" uses an unknown era "${eraCode}". Known eras: ${calendar.eras.map((e) => e.id).join(', ')}.` };
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
  if (approx) {
    const margin = (calendar.approxYears ?? 5) * perYear;
    lo -= margin;
    hi += margin;
  }
  const precision: Precision = day !== undefined ? 'day' : month !== undefined ? 'month' : 'year';
  return { kind: 'date', date: { year, ...(month !== undefined ? { month } : {}), ...(day !== undefined ? { day } : {}), era: era.id, approx, precision, lo, hi } };
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

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Plain rendering in the dotted form: "1800", "c. 1800", "03.1920", "12.03.1920" or "312 OK". */
export function formatDate(d: ParsedDate, calendar: Calendar): string {
  let s = String(d.year);
  if (d.month !== undefined) s = `${pad2(d.month)}.${s}`;
  if (d.day !== undefined) s = `${pad2(d.day)}.${s}`;
  if (d.era !== calendar.defaultEra) s += ` ${d.era}`;
  return d.approx ? `c. ${s}` : s;
}

/** "12.03" for a day and month without a year. */
export function formatYearless(r: { day: number; month: number; approx: boolean }): string {
  const s = `${pad2(r.day)}.${pad2(r.month)}`;
  return r.approx ? `c. ${s}` : s;
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
  const months = monthsOf(calendar);
  if (r.kind === 'yearless') return `Day ${r.day}, ${months[r.month - 1]!.name}, year unknown${r.approx ? ' (approximate)' : ''}`;
  const d = r.date;
  const era = calendar.eras.find((e) => e.id === d.era);
  const parts: string[] = [];
  if (d.day !== undefined) parts.push(`Day ${d.day}`);
  if (d.month !== undefined) parts.push(months[d.month - 1]!.name);
  parts.push(`Year ${d.year} of ${era?.name ?? d.era}`);
  return parts.join(', ') + (d.approx ? ' (approximate)' : '');
}
