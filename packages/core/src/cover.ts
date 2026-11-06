import type { CoverPosition, Entry, World, WorldCoverSettings, WorldManifest } from './types.ts';
import { ICONS, type IconName } from './icons.ts';
import { hslHex, luminance, mix, withAlpha, HEX_COLOUR } from './color.ts';

/** FNV-1a: the same name always gets the same colours and emblem. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193) >>> 0;
  return h;
}

const PREFERRED = ['front', 'three-quarter', 'concept', 'establishing', 'emblem', 'scene', 'illustration', 'exterior', 'banner', 'mood', 'a-pose'];
/** The image that best shows an entry at a glance, if it has any. */
export function portraitFile(entry: Entry): string | undefined {
  if (entry.picture?.image) return entry.picture.image;
  if (entry.picture?.icon) return undefined; // an icon picked on Home wins over reference images
  const imgs = entry.images ?? [];
  return (PREFERRED.map((v) => imgs.find((i) => i.view === v)).find(Boolean) ?? imgs[0])?.file;
}

/** A world's picture when none is chosen: a place, then an event, then anything with an image. */
export function coverImageFile(entries: Entry[]): string | undefined {
  for (const t of ['place', 'event', 'item', 'character'] as const) {
    const e = entries.find((x) => x.type === t && portraitFile(x));
    if (e) return portraitFile(e);
  }
  return undefined;
}

/** Emblems a generated cover picks from by the world's id. The cover editor offers these first. */
export const COVER_EMBLEMS: IconName[] = ['world', 'castle', 'dragon-head', 'crystal-ball', 'compass', 'treasure-map', 'sands-of-time', 'crown', 'scroll-unfurled', 'village'];

export const TITLE_STYLES = ['display', 'serif', 'sans'] as const;
export type TitleStyle = (typeof TITLE_STYLES)[number];
export const TITLE_STYLE_LABELS: Record<TitleStyle, string> = { display: 'Cinzel capitals', serif: 'Book serif', sans: 'Plain' };

/** Everything needed to draw a world's cover, resolved from world.json "cover" and the defaults. Shelf, Home, preview and PDF all draw this. */
export interface CoverArt {
  /** Gradient from top to bottom, #rrggbb or #rrggbbaa. */
  top: string;
  bottom: string;
  /** The soft light behind the emblem. */
  glow: string;
  icon: IconName | null;
  iconColor: string;
  /** Picture file relative to the world folder. */
  image?: string;
  /** 0.55 for a picture borrowed from an entry, so the frame and title stay readable; stronger for a chosen cover picture. */
  imageOpacity: number;
  titleStyle: TitleStyle;
  titleColor: string;
  /** Deterministic stars on a 240 x 320 canvas: [x, y, r]. */
  stars: [number, number, number][];
  /** Spine colour on the shelf, and the lettering that reads on it. */
  spine: string;
  spineInk: string;
  /** Front cover title and emblem; the spine always has both. */
  showTitle: boolean;
  showEmblem: boolean;
  /** Title font family from world.json, when one is chosen. */
  font?: string;
  /** Chosen places on the front cover (0 to 100 of the room inside the frame); without them, the default places. */
  titlePos?: CoverPosition;
  emblemPos?: CoverPosition;
}

/**
 * The room on the 240 x 320 cover canvas that the title and emblem may use: inside the thin gold frame (16 units
 * in) with a safe margin of 6 more, so nothing ever touches the frame.
 */
export const COVER_SAFE = { left: 22, top: 22, right: 218, bottom: 298 } as const;
/** The emblem's size on the cover canvas, and its default top-left corner (centred, near the top). */
export const COVER_EMBLEM = { size: 72, x: 84, y: 70 } as const;

const clamp01 = (v: number) => Math.min(100, Math.max(0, Math.round(v * 10) / 10));
/** A cover position from world.json, clamped to 0..100 (one decimal); anything that is not two numbers is ignored. */
export function coverPosition(p: unknown): CoverPosition | undefined {
  if (!p || typeof p !== 'object') return undefined;
  const { x, y } = p as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x: clamp01(x), y: clamp01(y) };
}

/**
 * Where an element of size w x h goes on a cover of size W x H (any units: the 240 x 320 canvas, PDF points),
 * as its top-left corner. The safe room scales with the cover width (the frame is drawn that way), and an element
 * bigger than the room is centred in it. The result never leaves the room.
 */
export function placeOnCover(pos: CoverPosition, w: number, h: number, W: number, H: number): { x: number; y: number } {
  const k = W / 240;
  const left = COVER_SAFE.left * k, top = COVER_SAFE.top * k;
  const roomW = W - 2 * left, roomH = H - 2 * top;
  const p = coverPosition(pos) ?? { x: 50, y: 50 };
  const along = (room: number, size: number, v: number) => (size >= room ? (room - size) / 2 : ((room - size) * v) / 100);
  return { x: left + along(roomW, w, p.x), y: top + along(roomH, h, p.y) };
}

/**
 * Cover settings as written to world.json: non-empty strings, the false switches (true is the default) and the
 * two positions, clamped into the frame. Everything else (empty values, true, broken positions) is dropped.
 */
export function cleanCoverSettings(cover: WorldCoverSettings): WorldCoverSettings {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cover)) {
    if (k === 'titlePos' || k === 'emblemPos') {
      const p = coverPosition(v);
      if (p) out[k] = p;
    } else if ((typeof v === 'string' && v !== '') || v === false) out[k] = v;
  }
  return out as WorldCoverSettings;
}

/** The emblem's box on the 240 x 320 cover canvas: its chosen place, else the default. */
export function emblemBox(art: Pick<CoverArt, 'emblemPos'>): { x: number; y: number; size: number } {
  const { size } = COVER_EMBLEM;
  if (!art.emblemPos) return { x: COVER_EMBLEM.x, y: COVER_EMBLEM.y, size };
  return { ...placeOnCover(art.emblemPos, size, size, 240, 320), size };
}

function starsFor(seed: number, n: number): [number, number, number][] {
  let s = seed || 1;
  const next = () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) >>> 0), s / 2 ** 32);
  return Array.from({ length: n }, () => [next() * 240, next() * 200, 0.4 + next() * 1.2]);
}

const colour = (v: string | undefined): string | undefined => (v && HEX_COLOUR.test(v) ? v : undefined);
const hueOf = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
};

/** Spine lettering that reads on any spine (4:1 at worst, at the mid-tone switch): gold on dark, parchment on mid tones, ink on light ones. */
export function spineInkFor(spine: string): string {
  const l = luminance(spine);
  return l <= 0.079 ? '#e0bd6a' : l <= 0.18 ? '#fbf3df' : '#1b1408';
}

/**
 * Resolve a cover: chosen colours, emblem, picture and title style from world.json, the rest generated from `seed`
 * (the world id). `fallbackImage` is the entry picture used when no cover picture is chosen; "none" turns pictures off.
 * `edge` is the colour of the picture's left edge (the app samples it), used for the spine unless a spine colour is set.
 */
export function coverArt(seed: string, c: WorldCoverSettings = {}, fallbackImage?: string, edge?: string): CoverArt {
  const h = hash(seed);
  const color = colour(c.color);
  const hue = color ? hueOf(color) : h % 360;
  const top = color ?? hslHex(hue, 45, 22);
  const bottom = colour(c.color2) ?? (color ? mix(color, '#000000', 0.62) : hslHex((hue + 40 + ((h >>> 9) % 80)) % 360, 50, 9));
  const icon = c.icon === 'none' ? null : c.icon && c.icon in ICONS ? (c.icon as IconName) : COVER_EMBLEMS[h % COVER_EMBLEMS.length]!;
  const chosen = c.image && c.image !== 'none' ? c.image : undefined;
  const image = chosen ?? (c.image === 'none' ? undefined : fallbackImage);
  const sampled = image && colour(edge) ? withAlpha(edge!, 1) : undefined;
  const spine = colour(c.spineColor) ? withAlpha(c.spineColor!, 1) : sampled ?? mix(withAlpha(top, 1), '#000000', 0.35);
  const font = c.font?.trim();
  const titlePos = coverPosition(c.titlePos), emblemPos = coverPosition(c.emblemPos);
  return {
    top,
    bottom,
    glow: withAlpha(hslHex(hue, 70, 60), 0.35),
    icon,
    iconColor: colour(c.iconColor) ?? '#e0bd6a',
    ...(image ? { image } : {}),
    imageOpacity: chosen ? 0.9 : 0.55,
    titleStyle: TITLE_STYLES.includes(c.titleStyle as TitleStyle) ? (c.titleStyle as TitleStyle) : 'display',
    titleColor: colour(c.titleColor) ?? '#fbf3df',
    stars: starsFor(h, 28),
    spine,
    spineInk: colour(c.spineInk) ?? spineInkFor(spine),
    showTitle: c.showTitle !== false,
    showEmblem: c.showEmblem !== false,
    ...(font ? { font } : {}),
    ...(titlePos ? { titlePos } : {}),
    ...(emblemPos ? { emblemPos } : {}),
  };
}

/** What a world's generated cover comes from: cover.seed (kept by Duplicate), else the world id. */
export function coverSeed(manifest: Pick<WorldManifest, 'id' | 'cover'>): string {
  return manifest.cover?.seed?.trim() || manifest.id;
}

/** A world's cover art from its world.json and entries. */
export function worldCoverArt(world: Pick<World, 'manifest' | 'entries'>): CoverArt {
  return coverArt(coverSeed(world.manifest), world.manifest.cover, coverImageFile(world.entries));
}
