import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { bundledFont, type BundledFont } from '@lore-forge/core';

const req = (): NodeRequire => (typeof require === 'function' ? require : createRequire(import.meta.url));

/** The Liberation TTFs that ship in packages/pdf/fonts (they are not on @fontsource). */
export function liberationDir(): string {
  return join(dirname(req().resolve('@lore-forge/pdf/package.json')), 'fonts');
}

/**
 * File name of a bundled font's face: the @fontsource latin .woff, or the Liberation TTF. Not the .woff2 the app
 * uses on screen: pdfkit embeds WOFF2 faces with empty glyphs, so the cover title would print as nothing.
 */
export function bundledFontFile(font: BundledFont, bold: boolean): string {
  const weight = bold && font.weights.includes(700) ? 700 : font.weights[0]!;
  if (font.source === 'liberation') return `${font.family.replace(/\s+/g, '')}-${weight === 700 ? 'Bold' : 'Regular'}.ttf`;
  return `${font.source}-latin-${weight}-normal.woff`;
}

/**
 * Where a bundled font's face is: in `dir` when given (the desktop app copies them all into one folder), else in its
 * @fontsource package or packages/pdf/fonts.
 */
export function bundledFontPath(font: BundledFont, bold: boolean, dir?: string): string | undefined {
  const file = bundledFontFile(font, bold);
  try {
    const full = dir ? join(dir, file) : font.source === 'liberation' ? join(liberationDir(), file) : req().resolve(`@fontsource/${font.source}/files/${file}`);
    return existsSync(full) ? full : undefined;
  } catch {
    return undefined;
  }
}

export interface SystemFont {
  family: string;
  file: string;
  bold: boolean;
  italic: boolean;
}

const run = (cmd: string, args: string[]): Promise<string> =>
  new Promise((ok) => execFile(cmd, args, { timeout: 20000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, out) => ok(err ? '' : String(out))));

/** fontconfig (Linux, and macOS with it installed): one line per face. */
async function fromFcList(): Promise<SystemFont[]> {
  const out = await run('fc-list', ['--format', '%{family[0]}\t%{style[0]}\t%{file}\n']);
  return out.split('\n').flatMap((line) => {
    const [family, style = '', file] = line.split('\t');
    return family && file ? [{ family: family.trim(), file, bold: /bold|black|heavy/i.test(style), italic: /italic|oblique/i.test(style) }] : [];
  });
}

/** Windows: the installed fonts in the registry, for the machine and for the user. */
async function fromRegistry(): Promise<SystemFont[]> {
  const winFonts = join(process.env['WINDIR'] ?? 'C:\\Windows', 'Fonts');
  const keys = ['HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'];
  const outs = await Promise.all(keys.map((k) => run('reg', ['query', k])));
  return outs.join('\n').split(/\r?\n/).flatMap((line) => {
    const m = /^\s+(.+?)\s+REG_SZ\s+(.+?)\s*$/.exec(line);
    if (!m) return [];
    const name = m[1]!.replace(/\s*\((TrueType|OpenType)\)$/i, '');
    const file = /^[a-z]:\\/i.test(m[2]!) ? m[2]! : join(winFonts, m[2]!);
    // "Arial Bold Italic & Something" -> the first family, without its style words.
    const first = name.split(' & ')[0]!;
    return [{ family: first.replace(/\s+(Bold|Italic|Regular|Oblique|Light|Medium|Semibold|Black)\b/gi, '').trim(), file, bold: /bold|black/i.test(first), italic: /italic|oblique/i.test(first) }];
  });
}

/** macOS without fontconfig: system_profiler lists every typeface with its file. */
async function fromSystemProfiler(): Promise<SystemFont[]> {
  try {
    const data = JSON.parse(await run('system_profiler', ['SPFontsDataType', '-json'])) as { SPFontsDataType?: { path?: string; typefaces?: { family?: string; style?: string }[] }[] };
    return (data.SPFontsDataType ?? []).flatMap((f) => (f.path ? (f.typefaces ?? []).flatMap((t) => (t.family ? [{ family: t.family, file: f.path!, bold: /bold|black|heavy/i.test(t.style ?? ''), italic: /italic|oblique/i.test(t.style ?? '') }] : [])) : []));
  } catch {
    return [];
  }
}

let cached: Promise<SystemFont[]> | undefined;
/** Fonts installed on this computer (read once per run): fontconfig, else the Windows registry, else system_profiler. */
export function systemFonts(): Promise<SystemFont[]> {
  cached ??= (async () => {
    if (process.env['LORE_FORGE_NO_SYSTEM_FONTS']) return [];
    if (process.platform === 'win32') return fromRegistry();
    const fc = await fromFcList();
    return fc.length || process.platform !== 'darwin' ? fc : fromSystemProfiler();
  })();
  return cached;
}

/** System font families, sorted and without duplicates. */
export async function systemFontFamilies(): Promise<string[]> {
  return [...new Set((await systemFonts()).map((f) => f.family))].sort((a, b) => a.localeCompare(b));
}

/**
 * pdfkit embeds TrueType, OpenType and WOFF files (collections need a face name, so they are skipped). WOFF2 is left
 * out: pdfkit embeds it with empty glyphs, and DejaVu with a note is better than an invisible title.
 */
const EMBEDDABLE = ['.ttf', '.otf', '.woff'];

/** The file of a system font's upright face, bold when asked and there is one. */
export async function systemFontFile(family: string, bold: boolean): Promise<string | undefined> {
  const want = family.trim().toLowerCase();
  const faces = (await systemFonts()).filter((f) => f.family.toLowerCase() === want && !f.italic && EMBEDDABLE.includes(extname(f.file).toLowerCase()) && existsSync(f.file));
  return (faces.find((f) => f.bold === bold) ?? faces[0])?.file;
}

export interface CoverFont {
  /** Font file to embed, when one was found. */
  file?: string;
  /** Why the title uses DejaVu instead of the chosen font. */
  note?: string;
}

/** The cover title font for a PDF: a bundled font, else a system TrueType/OpenType font, else DejaVu with a note. */
export async function coverFont(family: string | undefined, bold: boolean, dir?: string): Promise<CoverFont> {
  if (!family?.trim()) return {};
  const b = bundledFont(family);
  const file = b ? bundledFontPath(b, bold, dir) : await systemFontFile(family, bold);
  if (file) return { file };
  return { note: `The cover font “${family.trim()}” is not installed as a TrueType or OpenType file on this computer, so the PDF cover title uses DejaVu.` };
}
