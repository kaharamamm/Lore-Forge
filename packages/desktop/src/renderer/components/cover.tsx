import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import { raceIcon, TYPE_ICON, type Entry, type IconName } from '@lore-forge/core';
import { Icon, SvgIcon } from './icon.tsx';

/** The open world's folder, for components deep in the tree that load its images (portraits in hover cards). */
export const WorldDir = createContext<string | null>(null);

/** FNV-1a: the same name always gets the same colours and emblem. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193) >>> 0;
  return h;
}

/** One image read per file per session: sidebar, cards and hover cards share it. */
const images = new Map<string, Promise<string | null>>();
function useImage(dir: string | null, file: string | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!dir || !file) return;
    const key = `${dir}\n${file}`;
    if (!images.has(key)) images.set(key, window.lore.readImage(dir, file));
    let live = true;
    void images.get(key)!.then((s) => live && setSrc(s));
    return () => void (live = false);
  }, [dir, file]);
  return src;
}
/** Forget cached images (after Reload, files may have changed on disk). */
export const forgetImages = () => images.clear();

const PREFERRED = ['front', 'three-quarter', 'concept', 'establishing', 'emblem', 'scene', 'illustration', 'exterior', 'banner', 'mood', 'a-pose'];
/** The image that best shows an entry at a glance, if it has any. */
export function portraitFile(entry: Entry): string | undefined {
  const imgs = entry.images ?? [];
  return (PREFERRED.map((v) => imgs.find((i) => i.view === v)).find(Boolean) ?? imgs[0])?.file;
}

export function entryEmblem(entry: Entry, raceName?: string): IconName {
  return entry.type === 'character' && raceName ? raceIcon(raceName) : TYPE_ICON[entry.type];
}

/**
 * An entry's picture: its best reference image, or a generated placeholder
 * (a disc in its type colour, shaded by its name, with its race or type emblem).
 */
export function Portrait({ entry, raceName, size = 'sm' }: { entry: Entry; raceName?: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const dir = useContext(WorldDir);
  const src = useImage(dir, portraitFile(entry));
  const turn = hash(entry.id) % 360;
  return (
    <span class={`portrait portrait-${size} t-${entry.type}${src ? ' has-image' : ''}`} style={{ '--turn': `${turn}deg` }} aria-hidden="true">
      {src ? <img src={src} alt="" /> : <Icon name={entryEmblem(entry, raceName)} />}
    </span>
  );
}

const EMBLEMS: IconName[] = ['world', 'castle', 'dragon-head', 'crystal-ball', 'compass', 'treasure-map', 'sands-of-time', 'crown', 'scroll-unfurled', 'village'];

/** Deterministic stars for a cover: same world, same sky. */
function stars(seed: number, n: number): [number, number, number][] {
  let s = seed || 1;
  const next = () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) >>> 0), s / 2 ** 32);
  return Array.from({ length: n }, () => [next() * 240, next() * 200, 0.4 + next() * 1.2]);
}

/**
 * A generated book cover for a world: a night gradient picked by the world's name, stars, a gold frame and an emblem.
 * A real image (the world's first place or event picture) shows through when there is one.
 */
export function WorldCover({ seed, image }: { seed: string; image?: string | null }) {
  const h = hash(seed);
  const hue = h % 360;
  const hue2 = (hue + 40 + (h >>> 9) % 80) % 360;
  const id = `cv${h.toString(36)}`;
  return (
    <svg class="cover-art" viewBox="0 0 240 320" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stop-color={`hsl(${hue} 45% 22%)`} />
          <stop offset="1" stop-color={`hsl(${hue2} 50% 9%)`} />
        </linearGradient>
        <radialGradient id={`${id}r`} cx="0.5" cy="0.42" r="0.6">
          <stop offset="0" stop-color={`hsl(${hue} 70% 60% / 0.35)`} />
          <stop offset="1" stop-color="transparent" />
        </radialGradient>
      </defs>
      <rect width="240" height="320" fill={`url(#${id}g)`} />
      {image && <image href={image} width="240" height="320" preserveAspectRatio="xMidYMid slice" opacity="0.55" />}
      <rect width="240" height="320" fill={`url(#${id}r)`} />
      {stars(h, 28).map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#fff" opacity={0.25 + (i % 4) * 0.12} />)}
      <rect class="cover-frame" x="10" y="10" width="220" height="300" rx="6" />
      <rect class="cover-frame thin" x="16" y="16" width="208" height="288" rx="4" />
      <g class="cover-emblem"><SvgIcon name={EMBLEMS[h % EMBLEMS.length]!} x={84} y={70} size={72} /></g>
    </svg>
  );
}

/** The world's best picture for its cover: a place, then an event, then anything with an image. */
export function coverImageFile(entries: Entry[]): string | undefined {
  for (const t of ['place', 'event', 'item', 'character'] as const) {
    const e = entries.find((x) => x.type === t && portraitFile(x));
    if (e) return portraitFile(e);
  }
  return undefined;
}

export function useCoverImage(dir: string | null, entries: Entry[] | undefined): string | null {
  return useImage(dir, entries ? coverImageFile(entries) : undefined);
}
