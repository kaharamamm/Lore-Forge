/** Small colour helpers shared by the cover art, the PDF and the colour picker. Colours are #rrggbb or #rrggbbaa. */

export interface Rgba { r: number; g: number; b: number; a: number }

export const HEX_COLOUR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function parseHex(hex: string): Rgba | null {
  if (!HEX_COLOUR.test(hex)) return null;
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return { r: n(1), g: n(3), b: n(5), a: hex.length === 9 ? Math.round((n(7) / 255) * 100) / 100 : 1 };
}

const two = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
/** #rrggbb, or #rrggbbaa when not fully opaque. */
export function toHex({ r, g, b, a }: Rgba): string {
  return `#${two(r)}${two(g)}${two(b)}${a < 1 ? two(a * 255) : ''}`;
}

/** The colour without its alpha, and the alpha (0-1): for PDF fills, which take opacity separately. */
export function splitAlpha(hex: string): [string, number] {
  const c = parseHex(hex) ?? { r: 0, g: 0, b: 0, a: 1 };
  return [toHex({ ...c, a: 1 }), c.a];
}

export function hslHex(h: number, s: number, l: number, a = 1): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return toHex({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a });
}

/** Mix two colours; t = 0 gives `a`, t = 1 gives `b`. Alpha comes from `a`. */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a), y = parseHex(b);
  if (!x || !y) return a;
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t, a: x.a });
}

export function withAlpha(hex: string, a: number): string {
  const c = parseHex(hex);
  return c ? toHex({ ...c, a }) : hex;
}

/** Hue, saturation and value, each 0-1, for the colour picker's ring and square. */
export function rgbToHsv({ r, g, b }: Rgba): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h / 6, s: max ? d / max : 0, v: max };
}

export function hsvToRgb(h: number, s: number, v: number, a = 1): Rgba {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return { r: Math.round(f(5)), g: Math.round(f(3)), b: Math.round(f(1)), a };
}

/** WCAG relative luminance (0 black - 1 white), ignoring alpha. */
export function luminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0;
  const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}
