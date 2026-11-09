import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import { coverArt, coverImageFile, coverSeed, emblemBox, entryIcon, hash, ICONS, portraitFile, type CoverArt, type Entry, type IconName, type World, type WorldCoverSettings } from '@lore-forge/core';
import { Icon, SvgIcon } from './icon.tsx';

export { hash, portraitFile, coverImageFile };

/** The open world's folder, for components deep in the tree that load its images (portraits in hover cards). */
export const WorldDir = createContext<string | null>(null);

/** One image read per file per session: sidebar, cards and hover cards share it. */
const images = new Map<string, Promise<string | null>>();
/** The images already read, so a book drawn again (or a copy of one) has its picture from its first frame. */
const imagesRead = new Map<string, string | null>();
const imageKey = (dir: string, file: string) => `${dir}\n${file}`;
/** Whether this picture is already read (then a book shows it at once, without waiting to be near the view). */
export const hasImage = (dir: string, file: string | undefined) => !!file && imagesRead.has(imageKey(dir, file));
/** A Duplicate has the same picture as its original: it takes the original's read, so it never shows without it. */
export function shareImage(from: string, to: string, file: string | undefined) {
  if (!file) return;
  const a = imageKey(from, file), b = imageKey(to, file);
  if (images.has(a)) images.set(b, images.get(a)!);
  if (imagesRead.has(a)) imagesRead.set(b, imagesRead.get(a)!);
}
/**
 * The picture as a short blob: URL instead of the data: URL it arrives as. A data URL is the whole file in
 * base64 (hundreds of KB), and every style or src that holds one makes the browser parse it again: with a
 * picture on each timeline card that was most of the time it took to open the timeline.
 */
async function objectUrl(data: string | null): Promise<string | null> {
  if (!data?.startsWith('data:')) return data;
  // The same picture (a world and its copy) gets the same link, so what is worked out per link (the spine's
  // edge colour) carries over, as it did with the data URL.
  let url = objectUrls.get(data);
  if (!url) objectUrls.set(data, (url = fetch(data).then((r) => r.blob()).then((b) => URL.createObjectURL(b), () => data)));
  return url;
}
const objectUrls = new Map<string, Promise<string>>();

export function useImage(dir: string | null, file: string | undefined): string | null {
  const known = () => (dir && file ? imagesRead.get(imageKey(dir, file)) ?? null : null);
  const [src, setSrc] = useState<string | null>(known);
  useEffect(() => {
    setSrc(known());
    if (!dir || !file) return;
    const key = imageKey(dir, file);
    if (!images.has(key)) images.set(key, window.lore.readImage(dir, file).then(objectUrl));
    let live = true;
    void images.get(key)!.then((s) => { imagesRead.set(key, s); if (live) setSrc(s); });
    return () => void (live = false);
  }, [dir, file]);
  return src;
}
/** Like useImage, but undefined while the picture is still being read, so a missing one can be told apart. */
export function useImageState(dir: string | null, file: string | undefined): string | null | undefined {
  const known = () => (dir && file && imagesRead.has(imageKey(dir, file)) ? imagesRead.get(imageKey(dir, file))! : undefined);
  const [src, setSrc] = useState<string | null | undefined>(known);
  useEffect(() => {
    setSrc(known());
    if (!dir || !file) return;
    const key = imageKey(dir, file);
    if (!images.has(key)) images.set(key, window.lore.readImage(dir, file).then(objectUrl));
    let live = true;
    void images.get(key)!.then((s) => { imagesRead.set(key, s); if (live) setSrc(s); });
    return () => void (live = false);
  }, [dir, file]);
  return dir && file ? src : null;
}
/** Forget cached images (after Reload, files may have changed on disk). */
export const forgetImages = () => { images.clear(); imagesRead.clear(); };
/** Forget only these files (paths inside the world), which changed on disk: the other pictures stay as they are. */
export const forgetImageFiles = (dir: string, files: readonly string[]) => {
  for (const f of files) {
    images.delete(imageKey(dir, f));
    imagesRead.delete(imageKey(dir, f));
  }
};

/** The entry's card icon: the one picked for it on the Home page, else the default from core (gender, race, keywords). */
export function entryEmblem(entry: Entry, raceName?: string): IconName {
  const chosen = entry.picture?.icon;
  return chosen && chosen in ICONS ? (chosen as IconName) : entryIcon(entry, raceName?.split(',')[0]?.trim() || undefined);
}

/** Reference images smaller than this are sketches or placeholders: blown up on a card they look pixelated, so the icon disc shows instead. */
const MIN_PORTRAIT_PX = 128;

/**
 * An entry's picture: its best reference image, or a generated placeholder
 * (a disc in its type colour, shaded by its name, with its race or type emblem).
 * A picture chosen on Home always shows; a reference image only when it is big enough to look sharp.
 */
export function Portrait({ entry, raceName, size = 'sm' }: { entry: Entry; raceName?: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const dir = useContext(WorldDir);
  const file = portraitFile(entry);
  const src = useImage(dir, file);
  const [tiny, setTiny] = useState<string | null>(null);
  const turn = hash(entry.id) % 360;
  const pic = entry.picture ?? {};
  const show = src && tiny !== src;
  const style: Record<string, string> = { '--turn': `${turn}deg`, ...(pic.color ? { '--pic-bg': pic.color } : {}), ...(pic.accent ? { '--pic-fg': pic.accent } : {}) };
  const onLoad = (e: Event) => {
    const img = e.currentTarget as HTMLImageElement;
    if (!pic.image && Math.min(img.naturalWidth, img.naturalHeight) < MIN_PORTRAIT_PX) setTiny(img.src);
  };
  return (
    <span class={`portrait portrait-${size} t-${entry.type}${show ? ' has-image' : ''}${pic.color ? ' has-colour' : ''}${pic.accent ? ' has-accent' : ''}`} style={style} aria-hidden="true">
      {show ? <img src={src} alt="" onLoad={onLoad} /> : <Icon name={entryEmblem(entry, raceName)} />}
    </span>
  );
}

/**
 * A world's book cover: the gradient, picture, stars, gold frame and emblem from its CoverArt (see core/cover.ts),
 * with the title on top when given. The PDF draws the same art.
 */
export function WorldCover({ art, image, title }: { art: CoverArt; image?: string | null; title?: string }) {
  const font = titleFont(art);
  const emblem = emblemBox(art);
  const id = `cv${hash(`${art.top}${art.bottom}${art.glow}${art.stars[0]?.join() ?? ''}`).toString(36)}`;
  return (
    <>
      <svg class="cover-art" viewBox="0 0 240 320" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}g`} x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0" stop-color={art.top} />
            <stop offset="1" stop-color={art.bottom} />
          </linearGradient>
          <radialGradient id={`${id}r`} cx="0.5" cy="0.42" r="0.6">
            <stop offset="0" stop-color={art.glow} />
            <stop offset="1" stop-color="transparent" />
          </radialGradient>
        </defs>
        <rect width="240" height="320" fill={`url(#${id}g)`} />
        {image && <image href={image} width="240" height="320" preserveAspectRatio="xMidYMid slice" opacity={art.imageOpacity} />}
        <rect width="240" height="320" fill={`url(#${id}r)`} />
        {art.stars.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#fff" opacity={0.25 + (i % 4) * 0.12} />)}
        <rect class="cover-frame" x="10" y="10" width="220" height="300" rx="6" />
        <rect class="cover-frame thin" x="16" y="16" width="208" height="288" rx="4" />
        {art.icon && art.showEmblem && <g class="cover-emblem" style={{ color: art.iconColor }}><SvgIcon name={art.icon} x={emblem.x} y={emblem.y} size={emblem.size} /></g>}
      </svg>
      {title !== undefined && art.showTitle && <span class={`cover-title title-${art.titleStyle}${font ? ' has-font' : ''}${art.titlePos ? ' is-placed' : ''}`} style={{ color: art.titleColor, ...font, ...titlePlace(art) }}>{title}</span>}
    </>
  );
}

/** A chosen title place as CSS variables (0 to 100 of the room inside the frame; styles.css .is-placed). */
export const titlePlace = (art: CoverArt): Record<string, string> | undefined => (art.titlePos ? { '--tx': String(art.titlePos.x), '--ty': String(art.titlePos.y) } : undefined);

/** The lettering each title style falls back to when the chosen font is missing. */
const STYLE_STACK: Record<CoverArt['titleStyle'], string> = { display: 'var(--display)', serif: "'DejaVu Serif', Georgia, serif", sans: "system-ui, 'DejaVu Sans', sans-serif" };
/** The chosen cover font as a CSS variable (with the title style's lettering behind it), for the cover, spine and preview titles. */
export function titleFont(art: CoverArt): Record<string, string> | undefined {
  return art.font ? { '--cover-font': `"${art.font.replace(/["\\]/g, '')}", ${STYLE_STACK[art.titleStyle]}` } : undefined;
}

/** Left-edge colour per picture, read once per session. */
const edges = new Map<string, Promise<string | undefined>>();
/** Edge colours already worked out, for a spine right from its first frame. */
const edgesRead = new Map<string, string | undefined>();
function readEdge(src: string): Promise<string | undefined> {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      try {
        const h = 32, c = document.createElement('canvas');
        c.width = 4;
        c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true })!;
        // The leftmost 4% of the picture, squeezed into a 4 x 32 strip, then averaged.
        g.drawImage(img, 0, 0, Math.max(1, img.naturalWidth * 0.04), img.naturalHeight, 0, 0, 4, h);
        const d = g.getImageData(0, 0, 4, h).data;
        let r = 0, gr = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3]! > 0) { r += d[i]!; gr += d[i + 1]!; b += d[i + 2]!; n++; }
        const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
        ok(n ? `#${hex(r)}${hex(gr)}${hex(b)}` : undefined);
      } catch {
        ok(undefined);
      }
    };
    img.onerror = () => ok(undefined);
    img.src = src;
  });
}
/** The colour down the left edge of a picture, for the book's spine. */
export function useEdgeColour(src: string | null | undefined): string | undefined {
  const [edge, setEdge] = useState<string | undefined>(() => (src ? edgesRead.get(src) : undefined));
  useEffect(() => {
    setEdge(src ? edgesRead.get(src) : undefined);
    if (!src) return;
    if (!edges.has(src)) edges.set(src, readEdge(src));
    let live = true;
    void edges.get(src)!.then((e) => { edgesRead.set(src, e); if (live) setEdge(e); });
    return () => void (live = false);
  }, [src]);
  return edge;
}

/** A world's cover as set in world.json "cover" (or `cover` while it is being edited), else the generated defaults. */
export function WorldBookCover({ dir, world, fallbackName, title, cover }: { dir: string | null; world: World | null | undefined; fallbackName?: string; title?: string; cover?: WorldCoverSettings }) {
  const art = world ? coverArt(coverSeed({ id: world.manifest.id, cover: cover ?? world.manifest.cover }), cover ?? world.manifest.cover, coverImageFile(world.entries)) : coverArt(fallbackName ?? '');
  const image = useImage(dir, art.image);
  return <WorldCover art={art} image={image} {...(title !== undefined ? { title } : {})} />;
}
