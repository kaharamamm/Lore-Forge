/** Numbers in English words, for reading aloud: counts, years, ordinals and decimals. */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: [number, string][] = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  return n % 10 ? `${t}-${ONES[n % 10]}` : t;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (!h) return belowHundred(rest);
  return rest ? `${ONES[h]} hundred ${belowHundred(rest)}` : `${ONES[h]} hundred`;
}

/** A whole number: "one thousand two hundred five". */
export function cardinal(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (n < 0) return `minus ${cardinal(-n)}`;
  n = Math.floor(n);
  if (n < 1000) return belowThousand(n);
  if (n >= 1e15) return [...String(n)].map((d) => ONES[Number(d)]).join(' ');
  const parts: string[] = [];
  for (const [size, name] of SCALES) {
    if (n >= size) {
      parts.push(`${belowThousand(Math.floor(n / size))} ${name}`);
      n %= size;
    }
  }
  if (n) parts.push(belowThousand(n));
  return parts.join(' ');
}

/** A year as people say it: 1998 "nineteen ninety-eight", 1905 "nineteen oh five", 1900 "nineteen hundred", 2005 "two thousand five". */
export function year(n: number): string {
  if (n < 1000 || n > 9999 || (n >= 2000 && n < 2010) || n % 1000 === 0) return cardinal(n);
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  if (!lo) return `${belowHundred(hi)} hundred`;
  return `${belowHundred(hi)} ${lo < 10 ? `oh ${ONES[lo]}` : belowHundred(lo)}`;
}

const ORDINAL_WORDS: Record<string, string> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };

/** An ordinal: 21 "twenty-first", 3 "third". */
export function ordinal(n: number): string {
  const words = cardinal(n);
  return words.replace(/([a-z]+)$/, (last: string) => ORDINAL_WORDS[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`));
}

/** Digits read one by one, for decimals: "1 4" -> "one four". */
export const digits = (s: string): string => [...s].filter((c) => /\d/.test(c)).map((d) => ONES[Number(d)]).join(' ');

/**
 * The numbers in a text as words: ordinals (1st, 22nd), money ($5), percentages, decimals (3.14), dotted dates
 * (12.03.512), thousands with commas (1,500), and four-digit numbers from 1100 to 2099 as years.
 */
export function numbersToWords(text: string): string {
  return text
    .replace(/(\d+)\.(\d+)\.(\d+)/g, (_m, a: string, b: string, c: string) => `${cardinal(Number(a))}, ${cardinal(Number(b))}, ${cardinal(Number(c))}`)
    .replace(/\$(\d[\d,]*)(?:\.(\d\d))?/g, (_m, a: string, c?: string) => {
      const n = Number(a.replace(/,/g, ''));
      return `${cardinal(n)} ${n === 1 ? 'dollar' : 'dollars'}${c && Number(c) ? ` and ${cardinal(Number(c))} cents` : ''}`;
    })
    .replace(/(\d[\d,]*)(st|nd|rd|th)\b/gi, (_m, a: string) => ordinal(Number(a.replace(/,/g, ''))))
    .replace(/(\d[\d,]*)\.(\d+)/g, (_m, a: string, b: string) => `${cardinal(Number(a.replace(/,/g, '')))} point ${digits(b)}`)
    .replace(/(\d+)\s*%/g, (_m, a: string) => `${cardinal(Number(a))} percent`)
    .replace(/\d{1,3}(?:,\d{3})+/g, (m) => cardinal(Number(m.replace(/,/g, ''))))
    .replace(/\d+/g, (m) => {
      const n = Number(m);
      return m.length === 4 && n >= 1100 && n <= 2099 ? year(n) : m.length > 15 ? digits(m) : cardinal(n);
    });
}
