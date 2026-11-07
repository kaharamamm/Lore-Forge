import { memo } from 'preact/compat';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { COVER_EMBLEMS, coverArt, coverImageFile, coverSeed, ENTRY_TYPES, hash, parseWorld, TYPE_ICON, TYPE_LABELS, worldCoverArt, type World, type WorldCoverSettings, type WorldFile } from '@lore-forge/core';
import { Icon } from './icon.tsx';
import { hasImage, shareImage, titleFont, useEdgeColour, useImage, WorldCover } from './cover.tsx';
import { ColorField } from './color.tsx';
import { IconPicker } from './icon-picker.tsx';
import { EMBLEM_CHOICES } from './cover-editor.tsx';
import { CoverSwitches, RecentPictures } from './cover-options.tsx';
import { Aura } from './aura.tsx';
import { ConfirmDialog } from './confirm.tsx';
import { Dialog } from './dialog.tsx';
import { ConnectAi } from './connect-ai.tsx';
import { AboutDialog } from './about.tsx';
import { fitText } from '../fit.ts';
import { moveBook, removeKind, type RemoveKind } from '../../shared/library.ts';

/** Shelf key of the blank "New book". */
/** Changes when the window size changes the book scale, so titles are fitted again. */
function useBookScale(): number {
  const [w, setW] = useState(() => Math.round(window.innerWidth / 64));
  useEffect(() => {
    const on = () => setW(Math.round(window.innerWidth / 64));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

const NEW = '\u0000new';

type Peek = World | null | undefined;

/**
 * Each book is read once per visit to the library, a few at a time, so a shelf of hundreds of books does not send
 * hundreds of reads at once. The shelf, the search and the books share the same reads.
 */
const peeks = new Map<string, Promise<World | null>>();
/**
 * The last read of each book, kept across refreshes and visits: a book is drawn from it on its first frame (no
 * stand-in cover in made-up colours while it is read again), then from the fresh read.
 */
const peeked = new Map<string, World | null>();
/** A world just made (a Duplicate): its files came back with it, so its book needs no read and no stand-in. */
function primePeek(dir: string, files: WorldFile[]): World {
  const w = parseWorld(files);
  peeked.set(dir, w);
  peeks.set(dir, Promise.resolve(w));
  return w;
}
const PEEK_AT_ONCE = 6;
let reading = 0;
const waiting: (() => void)[] = [];
async function readPeek(dir: string): Promise<World | null> {
  if (reading >= PEEK_AT_ONCE) await new Promise<void>((go) => waiting.push(go));
  reading++;
  try {
    const files = await window.lore.peekWorld(dir);
    return files ? parseWorld(files) : null;
  } catch {
    return null;
  } finally {
    reading--;
    waiting.shift()?.();
  }
}
const peek = (dir: string): Promise<World | null> => {
  if (!peeks.has(dir)) peeks.set(dir, readPeek(dir).then((w) => { peeked.set(dir, w); return w; }));
  return peeks.get(dir)!;
};

function usePeek(dir: string): Peek {
  const [world, setWorld] = useState<Peek>(() => peeked.get(dir));
  useEffect(() => {
    let live = true;
    setWorld(peeked.get(dir));
    void peek(dir).then((w) => live && setWorld(w));
    return () => void (live = false);
  }, [dir]);
  return world;
}

/** One observer for the whole shelf: a book loads its cover picture only once it is near the visible part of the library. */
const nearSeen = new WeakMap<Element, () => void>();
const nearObservers = new WeakMap<Element, IntersectionObserver>();
function useNear(el: { current: Element | null }): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = el.current;
    const root = node?.closest('.start');
    if (!node || !root || near) return;
    // The library scrolls inside .start, so that is the root: its margin reaches books just below the fold.
    if (!nearObservers.has(root)) {
      const io = new IntersectionObserver((seen) => {
        for (const s of seen) if (s.isIntersecting) { nearSeen.get(s.target)?.(); io.unobserve(s.target); }
      }, { root, rootMargin: '400px 0px' });
      nearObservers.set(root, io);
    }
    const io = nearObservers.get(root)!;
    nearSeen.set(node, () => setNear(true));
    io.observe(node);
    return () => { io.unobserve(node); nearSeen.delete(node); };
  }, [near]);
  return near;
}

/**
 * Search folding: case, accents and the Turkish dotted and dotless i are ignored, so "sehir" finds "Şehir",
 * "istanbul" finds "İSTANBUL" and "ilik" finds "Ilık".
 */
export const fold = (s: string): string =>
  s.replace(/[İIı]/g, 'i').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/ß/g, 'ss').replace(/[æ]/g, 'ae').replace(/[œ]/g, 'oe').replace(/[ø]/g, 'o').replace(/[ł]/g, 'l').replace(/[đ]/g, 'd');

interface BookInfo { name: string; byline: string; about: string }
const bookInfo = (dir: string, w: World | null | undefined): BookInfo => ({
  name: fold(w?.manifest.name ?? folderName(dir)),
  byline: fold([w?.manifest.book?.title, w?.manifest.book?.author].filter(Boolean).join(' ')),
  about: fold(w?.manifest.description ?? ''),
});

/** The books matching a search, best first: a match in the title, then in the subtitle or author, then in the description. */
export function searchShelf(dirs: string[], info: Record<string, BookInfo>, query: string): string[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return dirs;
  const rank = (i: BookInfo): number => {
    if (words.every((w) => i.name.includes(w))) return 0;
    if (words.every((w) => i.byline.includes(w) || i.name.includes(w))) return 1;
    if (words.every((w) => i.about.includes(w) || i.byline.includes(w) || i.name.includes(w))) return 2;
    return 3;
  };
  return dirs.map((d, k) => ({ d, k, r: rank(info[d] ?? bookInfo(d, undefined)) })).filter((x) => x.r < 3).sort((a, b) => a.r - b.r || a.k - b.k).map((x) => x.d);
}

const folderName = (dir: string) => dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;

/** Book size on the shelf from its id: heights vary a little like real books; more entries make a thicker spine, within a modest range. */
function bookSize(seed: string, entries: number): Record<string, string> {
  const h = 12.6 + (hash(seed) % 9) * 0.25;
  // --bk scales every book with the window (styles.css): a little smaller on small screens, larger on 2K, never huge.
  const rem = (n: number) => `calc(var(--bk, 1) * ${n.toFixed(2)}rem)`;
  return { '--h': rem(h), '--w': rem((h * 3) / 4), '--d': rem(2.3 + Math.min(0.6, entries * 0.03)) };
}

/** Fit the spine and cover titles of one book (see fit.ts): one spine line if it can, else two; up to three on the cover. */
function fitTitles(li: HTMLElement): void {
  const spine = li.querySelector<HTMLElement>('.spine-title');
  if (spine) {
    spine.classList.remove('is-wrapped');
    if (!fitText(spine, { min: 0.78, lines: 1, vertical: true })) {
      spine.classList.add('is-wrapped');
      if (!fitText(spine, { min: 0.66, lines: 2, vertical: true })) {
        // Last resort: one line at the smallest size, ending in an ellipsis.
        spine.classList.remove('is-wrapped');
        fitText(spine, { min: 0.66, lines: 1, vertical: true });
      }
    }
  }
  const cover = li.querySelector<HTMLElement>('.book-cover .cover-title');
  if (cover) fitText(cover, { min: 0.6, lines: 3 });
}

/** Pointer and focus handlers of one book; the shelf decides which book is out (see useShelf). */
interface ShelfHover {
  onPointerEnter: (e: PointerEvent) => void;
  onPointerLeave: () => void;
  onFocusCapture: (e: FocusEvent) => void;
  onBlurCapture: (e: FocusEvent) => void;
}

/** Where one book is: on the shelf, out showing its cover, or going back (still drawn over its neighbours). */
interface BookPlace {
  state: 'rest' | 'out' | 'closing';
  /** The cover opens to the right of the spine, or (only at the right end of a row with no room) to the left. */
  side: 'right' | 'left';
  /** Sideways nudge (px) that keeps this book clear of the cover of the book that is out. */
  push: number;
}

const REST: BookPlace = { state: 'rest', side: 'right', push: 0 };

/**
 * A book as a CSS 3D box (see styles.css, "One book"): spine, front cover, back cover, page block and top, each
 * face sized to the book's height, cover width and thickness and moved to its side of the box. At rest the spine
 * faces the viewer. Out, the book comes a little towards the viewer and turns a quarter on the spine's left edge,
 * like a door on its hinge: the spine stays where it was and the front cover opens to its right.
 */
function BookBox({ spine, cover }: { spine: preact.ComponentChildren; cover: preact.ComponentChildren }) {
  return (
    <span class="book-pull">
      <span class="book-body">
        {spine}
        {cover}
        <span class="book-face book-back" aria-hidden="true" />
        <span class="book-face book-pages" aria-hidden="true" />
        <span class="book-face book-top" aria-hidden="true" />
      </span>
    </span>
  );
}

/** is-pushed: moved aside for an open cover. Moving aside is quick; coming back waits for the cover to close (styles.css). */
const placeClass = (p: BookPlace) => `${p.state === 'out' ? ' is-out' : p.state === 'closing' ? ' is-closing' : ''}${p.side === 'left' ? ' opens-left' : ''}${p.push ? ' is-pushed' : ''}`;
const placeStyle = (p: BookPlace) => ({ '--push': `${p.push}px` });

/**
 * One world as a book on the shelf: the spine with the title at rest; out (pointer or keyboard focus on it), the
 * front cover with the world's cover art and entry counts. Click or Enter opens it. The delete button is not inside
 * the open button: it sits in a second, empty box with the same transforms (book-lid), on the cover's top-right
 * corner.
 */
interface BookProps { dir: string; remove: RemoveKind; place: BookPlace; hover: ShelfHover; onOpen: (dir: string) => void; onDelete: (dir: string, name: string, world: World | null | undefined) => void; onDuplicate: (dir: string, name: string) => void }

/** Only a change of place re-renders a book (the handlers only read the shelf's refs), so a hover redraws two or three books, not the whole shelf. */
const samePlace = (a: BookProps, b: BookProps) => a.dir === b.dir && a.remove === b.remove && a.place.state === b.place.state && a.place.side === b.place.side && a.place.push === b.place.push;

const Book = memo(function Book({ dir, remove, place, hover, onOpen, onDelete, onDuplicate }: BookProps) {
  const world = usePeek(dir);
  const li = useRef<HTMLLIElement>(null);
  const near = useNear(li);
  const name = world?.manifest.name ?? folderName(dir);
  const counts = world ? ENTRY_TYPES.map((t) => [t, world.entries.filter((e) => e.type === t).length] as const).filter(([, n]) => n) : [];
  const base = world ? worldCoverArt(world) : coverArt(name);
  // A picture already read (the original's, for a Duplicate) shows at once; others wait until the book is near.
  const image = useImage(dir, world && (near || hasImage(dir, base.image)) ? base.image : undefined);
  // The spine takes the colour of the picture's left edge, unless one is chosen.
  const edge = useEdgeColour(image);
  const art = world && edge ? coverArt(coverSeed(world.manifest), world.manifest.cover, coverImageFile(world.entries), edge) : base;
  const font = titleFont(art);
  const id = `wc-${encodeURIComponent(dir)}`;
  const style = { ...bookSize(world ? coverSeed(world.manifest) : name, world?.entries.length ?? 0), '--spine': art.spine, '--spine-ink': art.spineInk, ...placeStyle(place) };
  const scale = useBookScale();
  useLayoutEffect(() => {
    if (!li.current) return;
    fitTitles(li.current);
    // Cover fonts may still be loading: fit again once they are in.
    void document.fonts.ready.then(() => li.current && fitTitles(li.current));
  }, [name, font?.fontFamily, art.titleStyle, art.showTitle, scale, world === undefined]);
  return (
    <li ref={li} class={`world-card shelf-book${placeClass(place)}`} data-key={dir} data-name={name} data-near={near ? '' : undefined} style={style} {...hover}>
      <button type="button" class="world-book" onClick={() => onOpen(dir)} disabled={world === null} aria-label={`Open ${name}`} aria-describedby={id}>
        <BookBox
          spine={<span class="book-face book-spine"><span class={`spine-title title-${art.titleStyle}${font ? ' has-font' : ''}`} style={font}>{name}</span>{art.icon && <Icon name={art.icon} class="spine-mark" />}</span>}
          cover={
            <span class="book-face book-cover world-cover">
              <WorldCover art={art} image={image} title={name} />
              <span class="world-meta" id={id}>
                {world === undefined && <span>Reading…</span>}
                {world === null && <span><Icon name="hazard-sign" /> This book cannot be opened</span>}
                {world && (
                  <>
                    <span class="world-count">{world.entries.length} {world.entries.length === 1 ? 'entry' : 'entries'}</span>
                    <span class="world-types">{counts.map(([t, n]) => <span key={t} class={`t-${t}`} title={TYPE_LABELS[t]}><Icon name={TYPE_ICON[t]} label={TYPE_LABELS[t]} /> {n}</span>)}</span>
                  </>
                )}
              </span>
            </span>
          }
        />
      </button>
      {world !== undefined && (
        <span class="book-lid">
          <span class="book-pull">
            <span class="book-body">
              <span class="book-face lid-face">
                <span class="book-buttons">
                  {world && <button type="button" class="book-button book-duplicate" onClick={() => onDuplicate(dir, name)} aria-label={`Duplicate ${name}`} title="Make an editable copy of this world"><Icon name="files" /></button>}
                  {remove === 'hide'
                    ? <button type="button" class="book-button book-delete is-remove" onClick={() => onDelete(dir, name, world)} aria-label={`Remove ${name} from the library`} title="Remove the sample world from the library (Library settings can show it again)"><Icon name="trash-can" /></button>
                    : <button type="button" class="book-button book-delete" onClick={() => onDelete(dir, name, world)} aria-label={`Delete ${name}`} title="Move this world to the trash"><Icon name="trash-can" /></button>}
                </span>
              </span>
            </span>
          </span>
        </span>
      )}
    </li>
  );
}, samePlace);

/** Pointer rests this long on a book before it comes out, so sweeping across the shelf does not pull out every book. */
const INTENT_MS = 100;
/** How long a book going back stays drawn over its neighbours (the longest put-back transition). */
const CLOSING_MS = 560;
/** Space between an open cover and the books it pushed aside. */
const COVER_GAP = 12;

/**
 * hinge: where the hinge of the last book taken out is, in shelf pixels; the shelf looks along it (styles.css). It
 * stays after the book goes back, so the closing cover tucks in behind its spine instead of swinging out over the
 * next book; books at rest are flat spines, so where the shelf looks from does not matter to them. closing: the
 * books still turning back, each for CLOSING_MS (a quick sweep can leave more than one turning at once).
 */
interface ShelfState { out: string | null; side: 'right' | 'left'; push: Record<string, number>; hinge: number | null; hingeY: number | null; closing: string[] }
const IDLE: ShelfState = { out: null, side: 'right', push: {}, hinge: null, hingeY: null, closing: [] };

/**
 * Where everything goes while `li` is out. Only its row moves: the books on the side the cover opens to slide
 * aside just enough to clear the cover. The cover opens to the right unless the row has no room there.
 * Positions are the books' layout boxes (offsetLeft), which nudges and turns never change.
 */
function layoutOut(li: HTMLElement): Pick<ShelfState, 'side' | 'push' | 'hinge' | 'hingeY'> {
  const shelf = li.parentElement!;
  const row = [...shelf.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.offsetTop === li.offsetTop);
  const k = row.indexOf(li);
  const perspective = parseFloat(getComputedStyle(shelf).perspective) || 1760;
  const d = li.offsetWidth;
  const coverEl = li.querySelector<HTMLElement>('.book-cover');
  const zc = d + 0.6 * parseFloat(getComputedStyle(document.documentElement).fontSize);
  // The cover is nearer the viewer than the shelf, so it looks a little wider than it is.
  const cover = ((coverEl?.offsetWidth ?? 0) * perspective) / (perspective - zc);
  const left = li.offsetLeft;
  const lo = 4;
  const hi = shelf.clientWidth - 4;
  const keyOf = (el: HTMLElement) => el.dataset['key']!;
  // The shelf looks at the row the book is on, so a book on the tenth row opens just like one on the first.
  const hingeY = Math.round(li.offsetTop + li.offsetHeight * 0.25);
  const right = row.slice(k + 1);
  const before = row.slice(0, k);
  const pushRight = right[0] ? Math.max(0, left + cover + COVER_GAP - right[0].offsetLeft) : 0;
  const rowEnd = right.length ? right[right.length - 1]!.offsetLeft + right[right.length - 1]!.offsetWidth : left + d;
  const fitsRight = left + cover <= hi && rowEnd + pushRight <= hi;
  const pushLeft = before.length ? Math.max(0, before[before.length - 1]!.offsetLeft + before[before.length - 1]!.offsetWidth + COVER_GAP - (left + d - cover)) : 0;
  const fitsLeft = left + d - cover >= lo && (before[0]?.offsetLeft ?? left) - pushLeft >= lo;
  if (!fitsRight && !fitsLeft) {
    // No room on either side alone (a full row): the book and the ones before it step left, the rest right.
    const shift = Math.max(0, Math.min(Math.max(left + cover, rowEnd + pushRight) - hi, (before[0]?.offsetLeft ?? left) - lo));
    return { side: 'right', hinge: left - shift, hingeY, push: Object.fromEntries([...before.map((b) => [keyOf(b), -Math.round(shift)]), [keyOf(li), -Math.round(shift)], ...right.map((b) => [keyOf(b), Math.round(pushRight - shift)])]) };
  }
  if (fitsRight) return { side: 'right', hinge: left, hingeY, push: Object.fromEntries(right.map((b) => [keyOf(b), Math.round(pushRight)])) };
  return { side: 'left', hinge: left + d, hingeY, push: Object.fromEntries(before.map((b) => [keyOf(b), -Math.round(pushLeft)])) };
}

/**
 * The shelf's hover logic, one small state machine: at most one book is out. Pointing at a book arms a short
 * hover-intent timer; only if the pointer is still there does the book come out (and the previous one goes back).
 * Leaving the book that is out puts it back at once. Focus takes a book out without waiting. Every move is a CSS
 * transition between two classes, so an interrupted move turns around from wherever it is: nothing restarts and
 * nothing can be left half open.
 */
function useShelf() {
  const [st, setSt] = useState<ShelfState>(IDLE);
  const cur = useRef(st);
  const intent = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  // One timer per book turning back: taking out another book must not cancel it, or the book stays drawn over its
  // neighbours (is-closing) after it is back.
  const closeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const commit = (next: ShelfState) => { cur.current = next; setSt(next); };
  // While a book is dragged nothing comes out (the dragged book keeps the pointer, so it would see it enter again).
  const paused = useRef(false);
  const clearIntent = () => { if (intent.current) clearTimeout(intent.current.timer); intent.current = null; };
  const clearClosing = () => { for (const t of closeTimers.current.values()) clearTimeout(t); closeTimers.current.clear(); };
  /** The closing list with `key` added (its timer restarted); the timer later drops it from whatever the list is then. */
  const goingBack = (key: string): string[] => {
    clearTimeout(closeTimers.current.get(key));
    closeTimers.current.set(key, setTimeout(() => {
      closeTimers.current.delete(key);
      if (cur.current.closing.includes(key)) commit({ ...cur.current, closing: cur.current.closing.filter((k) => k !== key) });
    }, CLOSING_MS));
    return [...cur.current.closing.filter((k) => k !== key), key];
  };
  const take = (key: string, li: HTMLElement) => {
    clearIntent();
    if (paused.current) return;
    const was = cur.current.out;
    if (was === key) return;
    commit({ out: key, ...layoutOut(li), closing: (was ? goingBack(was) : cur.current.closing).filter((k) => k !== key) });
  };
  const putBack = (key: string) => {
    if (intent.current?.key === key) clearIntent();
    if (cur.current.out !== key) return;
    commit({ ...IDLE, hinge: cur.current.hinge, hingeY: cur.current.hingeY, closing: goingBack(key) });
  };
  const focused = () => !!document.activeElement?.closest('.shelf-book.is-out');
  const away = () => {
    clearIntent();
    if (cur.current.out && !focused()) putBack(cur.current.out);
  };
  /**
   * Safety net for missed pointerleave events (a book turning or sliding away under a still pointer, a pointer that
   * jumps across books in one frame): any pointer move that is not over the book that is out, or the book waiting on
   * its hover intent, puts that book back or drops the intent.
   */
  const track = (e: PointerEvent) => {
    const key = (e.target instanceof Element ? e.target.closest<HTMLElement>('.shelf-book') : null)?.dataset['key'] ?? null;
    if (intent.current && intent.current.key !== key) clearIntent();
    if (cur.current.out && cur.current.out !== key && !focused()) putBack(cur.current.out);
  };
  useEffect(() => () => { clearIntent(); clearClosing(); }, []);
  const hover = (key: string): ShelfHover => ({
    onPointerEnter: (e) => {
      const li = e.currentTarget as HTMLElement;
      if (paused.current) return;
      if (cur.current.out === key) return clearIntent();
      if (intent.current?.key === key) return;
      clearIntent();
      intent.current = { key, timer: setTimeout(() => take(key, li), INTENT_MS) };
    },
    onPointerLeave: () => putBack(key),
    onFocusCapture: (e) => take(key, e.currentTarget as HTMLElement),
    onBlurCapture: (e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) putBack(key); },
  });
  const place = (key: string): BookPlace => ({
    state: st.out === key ? 'out' : st.closing.includes(key) ? 'closing' : 'rest',
    side: st.out === key ? st.side : 'right',
    push: st.push[key] ?? 0,
  });
  return { hover, place, away, track, hinge: st.hinge, hingeY: st.hingeY, reset: () => { clearIntent(); clearClosing(); commit(IDLE); }, pause: (on: boolean) => { paused.current = on; if (on) { clearIntent(); clearClosing(); commit(IDLE); } } };
}

/** Moving less than this (px) with the button down is still a click, not a drag. */
const DRAG_START = 6;
/** Near the top or bottom edge of the library (px), a drag scrolls it. */
const DRAG_EDGE = 80;
/** How long books take to slide aside, and the lifted book to settle into its place (ms). */
const SLIDE_MS = 240;
const SETTLE_MS = 200;
/** How long a copy just made glows on the shelf (ms). */
const FRESH_MS = 2600;
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A book being rearranged: it shows as a faded placeholder at `at` (its index in the shelf without it). */
interface Drag { key: string; from: number; at: number }

/** The books of the shelf in their order, without the New book. */
const shelfBooks = (ul: HTMLElement) => [...ul.querySelectorAll<HTMLElement>(':scope > .shelf-book:not(.new-book)')];
const rowsOf = (books: HTMLElement[]) => {
  const rows = new Map<number, HTMLElement[]>();
  for (const b of books) rows.set(b.offsetTop, [...(rows.get(b.offsetTop) ?? []), b]);
  return [...rows.values()];
};

/**
 * Where the dragged book `key` would land for a pointer at x, y: on the row under the pointer (or the nearest one),
 * before the first book whose middle is right of it. The placeholder (the dragged book itself, at `at`) is part of
 * the layout, so a pointer over it keeps it where it is. Layout boxes (offsetLeft) are used, not the sliding ones.
 */
function dropAt(ul: HTMLElement, key: string, x: number, y: number, at: number): number {
  const list = shelfBooks(ul);
  const box = ul.getBoundingClientRect();
  const lx = x - box.left, ly = y - box.top;
  let best: HTMLElement[] = [], dist = Infinity;
  for (const row of rowsOf(list)) {
    const top = row[0]!.offsetTop, bottom = top + row[0]!.offsetHeight;
    const d = ly < top ? top - ly : ly > bottom ? ly - bottom : 0;
    if (d < dist) { dist = d; best = row; }
  }
  if (!best.length) return at;
  const others = list.filter((b) => b.dataset['key'] !== key);
  const hit = best.find((b) => lx < b.offsetLeft + b.offsetWidth / 2);
  if (hit) return hit.dataset['key'] === key ? at : others.indexOf(hit);
  const last = best[best.length - 1]!;
  return last.dataset['key'] === key ? at : others.indexOf(last) + 1;
}

/**
 * Where a book's spine is at rest, in the viewport: the book's own slot, at the bottom. Not the spine's box: a book
 * out on hover has its spine turned edge-on (a box a pixel or two wide), which is the moment a drag usually starts.
 */
function restSpine(li: HTMLElement): { left: number; top: number; w: number; h: number } {
  const spine = li.querySelector<HTMLElement>('.book-spine');
  const r = li.getBoundingClientRect();
  const w = li.offsetWidth, h = spine?.offsetHeight || li.offsetHeight;
  return { left: r.left, top: r.bottom - h, w, h };
}

/** Removes every lifted copy (one left by an interrupted drag included). */
const dropLifts = () => { for (const el of document.querySelectorAll('.shelf-lift')) el.remove(); };

/**
 * A lifted copy of a book's spine that follows the pointer, outside the shelf (so nothing on the shelf moves it).
 * The shelf's spine rules are scoped to .shelf-book, so the copy takes the spine's computed look (colours, gold
 * bands, layout, clipping) and its size at rest, as inline styles; opaque, whatever the book was doing.
 */
function makeLift(li: HTMLElement): { el: HTMLElement; w: number; h: number } | null {
  const spine = li.querySelector<HTMLElement>('.book-spine');
  if (!spine) return null;
  dropLifts();
  const { w, h } = restSpine(li);
  const cs = getComputedStyle(spine);
  const el = spine.cloneNode(true) as HTMLElement;
  el.className = 'shelf-lift';
  el.setAttribute('aria-hidden', 'true');
  el.removeAttribute('id');
  for (const k of ['background-image', 'background-color', 'border-radius', 'display', 'flex-direction', 'align-items', 'justify-content', 'padding', 'gap', 'font-size', 'overflow'] as const) el.style.setProperty(k, cs.getPropertyValue(k));
  el.style.setProperty('--spine-ink', getComputedStyle(li).getPropertyValue('--spine-ink'));
  // The spine's gold bands, plus the shadow of a book held above the shelf.
  el.style.boxShadow = `${cs.boxShadow === 'none' ? '' : `${cs.boxShadow}, `}0 22px 34px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(224 189 106 / 0.45)`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  document.body.append(el);
  return { el, w, h };
}

/**
 * Drag and drop on the shelf, with the pointer: press a book and move a few pixels to pick it up (a plain click
 * still opens it). A lifted copy follows the pointer while the book itself waits, faded, in the gap where it would
 * land; the other books slide aside, on any row. Near the top or bottom of the library the view scrolls. On drop the
 * copy settles into the gap; Escape, or losing the window, sends it back. The press that ends a drag opens nothing.
 * `onShift` runs just before the books change places, so the shelf can slide them (see useSlide).
 */
function useShelfDrag(ul: { current: HTMLUListElement | null }, hooks: { enabled: () => boolean; onStart: () => void; onEnd: () => void; onMove: (key: string, to: number) => void; onShift: () => void }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const press = useRef<{ key: string; id: number; x: number; y: number; li: HTMLElement; dx: number; dy: number } | null>(null);
  const live = useRef<Drag | null>(null);
  const lift = useRef<{ el: HTMLElement; w: number; h: number } | null>(null);
  const settle = useRef<(() => void) | null>(null);
  const at = useRef({ x: 0, y: 0 });
  const frame = useRef(0);
  const swallow = useRef(false);
  // The handlers are set up once; they call the latest callbacks.
  const cb = useRef(hooks);
  cb.current = hooks;
  const show = (d: Drag | null) => { live.current = d; setDrag(d); };
  const follow = () => {
    const l = lift.current, p = press.current;
    if (l && p) l.el.style.transform = `translate(${at.current.x - p.dx}px, ${at.current.y - p.dy}px) rotate(-4deg) scale(1.06)`;
  };
  const update = () => {
    const d = live.current;
    if (!d || !ul.current) return;
    follow();
    const next = dropAt(ul.current, d.key, at.current.x, at.current.y, d.at);
    if (next === d.at) return;
    cb.current.onShift();
    show({ ...d, at: next });
  };
  const scroll = () => {
    const d = live.current, box = ul.current?.closest<HTMLElement>('.start');
    if (!d || !box) return;
    const r = box.getBoundingClientRect();
    const top = at.current.y - r.top, bottom = r.bottom - at.current.y;
    const step = top < DRAG_EDGE ? -Math.ceil(((DRAG_EDGE - top) / DRAG_EDGE) * 24) : bottom < DRAG_EDGE ? Math.ceil(((DRAG_EDGE - bottom) / DRAG_EDGE) * 24) : 0;
    if (step) {
      const was = box.scrollTop;
      box.scrollTop += step;
      if (box.scrollTop !== was) update();
    }
    frame.current = requestAnimationFrame(scroll);
  };
  const end = (commit: boolean) => {
    const d = live.current, p = press.current;
    press.current = null;
    if (!d || !p) return;
    cancelAnimationFrame(frame.current);
    live.current = null;
    // The click that follows this pointerup must not open the book.
    swallow.current = true;
    setTimeout(() => { swallow.current = false; }, 0);
    if (commit && d.at !== d.from) {
      cb.current.onMove(d.key, d.at);
      setDrag(null);
    } else {
      // Back where it was: the books slide back too.
      cb.current.onShift();
      setDrag(null);
    }
    // The lifted copy flies into the book's place, then the book shows again.
    const l = lift.current;
    lift.current = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      settle.current = null;
      l?.el.remove();
      dropLifts();
      p.li.removeAttribute('data-dragged');
      cb.current.onEnd();
    };
    settle.current = finish;
    if (!l || calm()) return finish();
    requestAnimationFrame(() => {
      if (done) return;
      for (const a of p.li.getAnimations()) a.cancel();
      const r = restSpine(p.li);
      const a = l.el.animate([{ transform: l.el.style.transform }, { transform: `translate(${r.left}px, ${r.top}px)` }], { duration: SETTLE_MS, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'forwards' });
      a.onfinish = finish;
      a.oncancel = finish;
      setTimeout(finish, SETTLE_MS + 300);
    });
  };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId !== p.id) return;
      at.current = { x: e.clientX, y: e.clientY };
      if (!live.current) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_START) return;
        if (!(e.buttons & 1)) { press.current = null; return; }
        cb.current.onStart();
        const from = ul.current ? shelfBooks(ul.current).findIndex((b) => b.dataset['key'] === p.key) : -1;
        lift.current = makeLift(p.li);
        p.li.setAttribute('data-dragged', '');
        show({ key: p.key, from, at: from });
        frame.current = requestAnimationFrame(scroll);
      }
      update();
    };
    const up = (e: PointerEvent) => { if (press.current && e.pointerId === press.current.id) { if (live.current) end(true); else press.current = null; } };
    const cancel = () => end(false);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && live.current) { e.preventDefault(); e.stopPropagation(); end(false); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true);
    return () => {
      cancelAnimationFrame(frame.current);
      settle.current?.();
      lift.current?.el.remove();
      dropLifts();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key, true);
    };
  }, []);
  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0 || !cb.current.enabled() || !(e.target instanceof Element) || e.target.closest('.book-button')) return;
      const li = e.target.closest<HTMLElement>('.shelf-book');
      if (!li || li.classList.contains('new-book') || !li.dataset['key']) return;
      // A book still settling from the last drop lands at once.
      settle.current?.();
      // The copy is held where it was grabbed: across the middle of the spine, at the pointer's height on it.
      const r = restSpine(li);
      press.current = { key: li.dataset['key'], id: e.pointerId, x: e.clientX, y: e.clientY, li, dx: r.w / 2, dy: Math.min(r.h - 6, Math.max(6, e.clientY - r.top)) };
    },
    onClickCapture: (e: MouseEvent) => { if (swallow.current) { e.preventDefault(); e.stopPropagation(); } },
    // Pictures and text are not dragged out of the shelf by the browser.
    onDragStart: (e: DragEvent) => e.preventDefault(),
  };
  return { drag, handlers };
}

/**
 * Books changing places slide there (FLIP): `before()` notes where every book is, just before a change; after the
 * shelf has re-rendered, each book that moved starts from where it was and slides to its new place, across rows
 * too. Off with reduced motion.
 */
function useSlide(ul: { current: HTMLUListElement | null }) {
  const from = useRef<Map<string, DOMRect> | null>(null);
  const running = useRef(new WeakMap<Element, Animation>());
  useLayoutEffect(() => {
    const was = from.current;
    from.current = null;
    if (!was || !ul.current) return;
    for (const b of shelfBooks(ul.current)) {
      const old = was.get(b.dataset['key']!);
      if (!old) continue;
      running.current.get(b)?.cancel();
      const now = b.getBoundingClientRect();
      const dx = old.left - now.left, dy = old.top - now.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      running.current.set(b, b.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], { duration: SLIDE_MS, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' }));
    }
  });
  return () => {
    if (!ul.current || calm()) return;
    from.current = new Map(shelfBooks(ul.current).map((b) => [b.dataset['key']!, b.getBoundingClientRect()]));
  };
}

const SWATCHES = ['#7a2e2e', '#8a5a1c', '#2f5d3a', '#1f4f6b', '#3b3478', '#5c2a5e', '#2b2f3a', '#6b4a2b', '#14161b', '#3a2a1e'];

/** A new book's first look: a random colour and emblem, until the user picks or shuffles. */
const randomCover = (): WorldCoverSettings => ({ color: SWATCHES[Math.floor(Math.random() * SWATCHES.length)]!, icon: COVER_EMBLEMS[Math.floor(Math.random() * COVER_EMBLEMS.length)]! });

function CreateBook({ worldsDir, onClose, onCreated }: { worldsDir: string; onClose: () => void; onCreated: (dir: string) => void }) {
  const [name, setName] = useState('');
  const [cover, setCover] = useState<WorldCoverSettings>(randomCover);
  const [image, setImage] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [parent, setParent] = useState(worldsDir);
  const [problem, setProblem] = useState<string | null>(null);
  const [uploads, setUploads] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const set = (patch: Partial<WorldCoverSettings>) => setCover((c) => Object.fromEntries(Object.entries({ ...c, ...patch }).filter(([, v]) => v !== undefined)) as WorldCoverSettings);
  const use = async (p: string) => {
    setImage(p);
    setPreview(await window.lore.readPickedImage(p));
  };
  const pick = async () => {
    const p = await window.lore.pickImageFile();
    if (!p) return;
    await use(p);
    setUploads((n) => n + 1);
  };
  const edge = useEdgeColour(preview);
  const art = coverArt(name || 'new', { ...cover, ...(preview ? { image: 'picked' } : {}) }, undefined, edge);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const { color, ...rest } = cover;
      const dir = await window.lore.createWorld({ name: name.trim(), parent, ...(color ? { color } : {}), ...(image ? { image } : {}), cover: rest });
      if (dir) onCreated(dir);
    } catch (err) {
      setProblem((err as Error).message.replace(/^Error invoking remote method '\w+': (Error: )?/, ''));
    }
  };
  return (
    <Dialog title="New book" onClose={onClose}>
      <form class="create-book" onSubmit={(e) => void submit(e)}>
        <div class="create-side">
          <div class="create-preview" aria-hidden="true">
            <span class="world-cover">
              <WorldCover art={art} image={preview} title={name || 'Untitled world'} />
            </span>
            <span class="spine-sample create-spine" style={{ background: art.spine, color: art.spineInk }}><span>{name || 'Untitled world'}</span></span>
          </div>
          <CoverSwitches art={art} set={set} />
        </div>
        <div class="create-fields">
          <label class="field">
            <span class="field-label">Name</span>
            <input ref={input} id="new-world-name" type="text" value={name} placeholder="e.g. The Shifting Sands" onInput={(e) => setName(e.currentTarget.value)} />
          </label>
          <div class="field create-look">
            <div class="create-look-row">
              <ColorField label="Cover colour" value={cover.color ?? art.top} swatches={SWATCHES} onChange={(c) => set({ color: c })} class="create-colour" />
              <button type="button" class="ghost small shuffle-cover" onClick={() => setCover((c) => ({ ...c, ...randomCover() }))} title="A random colour and emblem"><Icon name="perspective-dice-six-faces-random" /> Shuffle</button>
            </div>
          </div>
          <div class="field create-emblem">
            <span class="field-label">Emblem</span>
            <IconPicker label="Emblem" choices={EMBLEM_CHOICES} value={art.icon} none="No emblem" onPick={(n) => set({ icon: n ?? 'none' })} />
          </div>
          <div class="field">
            <span class="field-label">Cover picture (optional)</span>
            <div class="row-actions">
              <button type="button" class="ghost small" onClick={() => void pick()}><Icon name="photo-camera" /> {image ? 'Change picture…' : 'Choose picture…'}</button>
              {image && <button type="button" class="ghost small" onClick={() => { setImage(null); setPreview(null); }}>No picture</button>}
            </div>
            <RecentPictures dir={null} current={image ?? undefined} refresh={uploads} onPick={(p) => void use(p.path)} />
          </div>
          <div class="field">
            <span class="field-label">Location</span>
            <div class="location-line">
              <span class="location-path" title={parent}>{parent}</span>
              <button type="button" class="ghost small" onClick={() => void window.lore.chooseFolder('Where to keep this world', parent).then((d) => d && setParent(d))}><Icon name="open-folder" /> Change…</button>
            </div>
          </div>
          {problem && <p class="error-line" role="alert"><Icon name="cancel" /> {problem}</p>}
          <div class="dialog-actions">
            <button type="button" class="ghost" onClick={onClose}>Cancel</button>
            <button type="submit" class="primary" disabled={!name.trim()}><Icon name="sprout" /> Create book</button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

/** Delete a world: its cover on the shelf, its name and what is in it, then the trash. */
function DeleteBook({ dir, name, world, kind, onClose, onConfirm }: { dir: string; name: string; world: World | null | undefined; kind: RemoveKind; onClose: () => void; onConfirm: () => Promise<void> }) {
  const art = world ? worldCoverArt(world) : coverArt(name);
  const image = useImage(dir, world ? art.image : undefined);
  const counts = world ? ENTRY_TYPES.map((t) => [t, world.entries.filter((e) => e.type === t).length] as const).filter(([, n]) => n) : [];
  return (
    <ConfirmDialog
      title={kind === 'hide' ? `Remove “${name}” from the library?` : `Delete “${name}”?`}
      confirmLabel={kind === 'hide' ? 'Remove from library' : 'Move to trash'}
      cancelLabel="Keep it"
      onClose={onClose}
      onConfirm={onConfirm}
      subject={
        <div class="confirm-world">
          <span class="world-cover confirm-cover" aria-hidden="true"><WorldCover art={art} image={image} /></span>
          <div>
            <strong class="confirm-name">{name}</strong>
            <span class="muted">{world ? `${world.entries.length} ${world.entries.length === 1 ? 'entry' : 'entries'}${world.story?.length ? `, ${world.story.length} ${world.story.length === 1 ? 'chapter' : 'chapters'}` : ''}` : 'This book cannot be read'}</span>
            {counts.length > 0 && <span class="world-types">{counts.map(([t, n]) => <span key={t} class={`t-${t}`} title={TYPE_LABELS[t]}><Icon name={TYPE_ICON[t]} label={TYPE_LABELS[t]} /> {n}</span>)}</span>}
          </div>
        </div>
      }
    >
      {kind === 'hide'
        ? <p>The sample world comes with Lore-Forge, so nothing is deleted: it only leaves your shelf. Turn on Show sample world in Library settings to bring it back.</p>
        : <p>Moves the folder to the system trash, with its entries, story and images. You can restore it from there.</p>}
    </ConfirmDialog>
  );
}

/**
 * Duplicate a world: a full copy (entries, story, images, 3D models, cover) under a new name in the worlds folder,
 * which then opens. Works for the read-only sample too: that is how it becomes editable.
 */
export function DuplicateBook({ dir, name, onClose, onDone }: { dir: string; name: string; onClose: () => void; onDone: (copy: string) => void }) {
  const [value, setValue] = useState(`${name} (copy)`);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [where, setWhere] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.select();
    void window.lore.settings().then((s) => setWhere(s.worldsDir));
  }, []);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      const copy = await window.lore.duplicateWorld(dir, value.trim());
      // The copy is drawn from its own world.json (its cover and seed) and its original's picture from the start.
      const w = primePeek(copy.dir, copy.files);
      shareImage(dir, copy.dir, worldCoverArt(w).image);
      onDone(copy.dir);
    } catch (err) {
      setProblem((err as Error).message.replace(/^Error invoking remote method '\w+': (Error: )?/, ''));
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Duplicate “${name}”`} onClose={onClose}>
      <form class="duplicate-book" onSubmit={(e) => void submit(e)}>
        <label class="field">
          <span class="field-label">Name of the copy</span>
          <input ref={input} id="duplicate-name" type="text" value={value} onInput={(e) => setValue(e.currentTarget.value)} />
        </label>
        <p class="muted">A full copy with its entries, story, images, 3D models and cover{where ? <> goes to <span class="location-path" title={where}>{where}</span></> : ''}. The original stays as it is.</p>
        {problem && <p class="error-line" role="alert"><Icon name="cancel" /> {problem}</p>}
        <div class="dialog-actions">
          <button type="button" class="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" class="primary" disabled={!value.trim() || busy}><Icon name="files" /> {busy ? 'Copying…' : 'Duplicate'}</button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Library settings: where new worlds go (a folder field with Browse…) and whether the sample world is on the shelf.
 * Changes are a draft until Save; Cancel, Escape or a click outside leave everything as it was.
 */
function LibrarySettings({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<{ worldsDir: string; defaultWorldsDir: string; hideSample: boolean } | null>(null);
  const [dir, setDir] = useState('');
  const [showSample, setShowSample] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => void window.lore.settings().then((x) => {
    setS({ worldsDir: x.worldsDir, defaultWorldsDir: x.defaultWorldsDir, hideSample: !!x.hideSample });
    setDir(x.worldsDir);
    setShowSample(!x.hideSample);
  }), []);
  const dirty = !!s && (dir !== s.worldsDir || showSample === s.hideSample);
  const save = async () => {
    if (!s) return;
    setBusy(true);
    if (dirty) {
      await window.lore.saveSettings({ worldsDir: dir === s.defaultWorldsDir ? '' : dir, hideSample: !showSample });
      onSaved();
    }
    onClose();
  };
  return (
    <Dialog title="Library settings" onClose={onClose} class="library-settings"
      footer={<>
        <span class={`settings-status${dirty ? ' is-dirty' : ''}`} role="status">{dirty ? 'Unsaved changes' : ''}</span>
        <button type="button" class="ghost settings-cancel" onClick={onClose}>Cancel</button>
        <button type="button" class="primary settings-save" disabled={!s || busy} onClick={() => void save()}><Icon name="check-mark" /> Save</button>
      </>}>
      {s && (
        <>
          <section class="settings-section" aria-labelledby="settings-where">
            <h3 id="settings-where" class="settings-heading">Where new worlds go</h3>
            <div class="settings-row">
              <label class="settings-label" for="worlds-dir">Folder</label>
              <div class="folder-picker">
                <input id="worlds-dir" class="folder-input" type="text" readOnly value={dir} title={dir} aria-describedby="worlds-dir-help" />
                <button type="button" class="ghost folder-browse" onClick={() => void window.lore.chooseFolder('Default folder for new worlds', dir).then((d) => { if (d) setDir(d); })}><Icon name="open-folder" /> Browse…</button>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-label" aria-hidden="true" />
              <p id="worlds-dir-help" class="muted settings-help">
                New books and copies go here.{' '}
                {dir !== s.defaultWorldsDir
                  ? <button type="button" class="link-button folder-default" onClick={() => setDir(s.defaultWorldsDir)}>Use the app's worlds folder</button>
                  : 'This is the app\'s own worlds folder.'}
              </p>
            </div>
          </section>
          <section class="settings-section" aria-labelledby="settings-sample">
            <h3 id="settings-sample" class="settings-heading">Sample world</h3>
            <div class="settings-row">
              <span class="settings-label">Camelamamm</span>
              <label class="check"><input type="checkbox" class="show-sample" checked={showSample} onChange={(e) => setShowSample(e.currentTarget.checked)} /> Show sample world on the shelf</label>
            </div>
            <div class="settings-row">
              <span class="settings-label" aria-hidden="true" />
              <p class="muted settings-help">The sample comes with Lore-Forge and the tour uses it. Hiding it deletes nothing.</p>
            </div>
          </section>
        </>
      )}
    </Dialog>
  );
}

/** The landing page: a library where every world is a book on the shelf, plus a blank book to start a new one. */
export function StartScreen({ onOpen, error, onTour, highlight = null }: { onOpen: (dir: string) => void; error: string | null; onTour: () => void; highlight?: string | null }) {
  const [shelf, setShelf] = useState<string[]>([]);
  const [sample, setSample] = useState<string | null>(null);
  const [worldsDir, setWorldsDir] = useState('');
  const [dialog, setDialog] = useState<{ kind: 'create' } | { kind: 'settings' } | { kind: 'about' } | { kind: 'ai' } | { kind: 'delete'; dir: string; name: string; world: World | null | undefined } | { kind: 'duplicate'; dir: string; name: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Books moved to the trash this session never come back from a refresh that raced the move.
  const trashed = useRef(new Set<string>());
  const [info, setInfo] = useState<Record<string, BookInfo>>({});
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const refresh = async () => {
    const [list, b, s] = await Promise.all([window.lore.listWorlds(), window.lore.sampleWorld(), window.lore.settings()]);
    // Books may have changed while the library was away (edited covers, worlds made elsewhere): read them again.
    peeks.clear();
    const live = list.filter((d) => !trashed.current.has(d));
    setShelf(live);
    setSample(b);
    setWorldsDir(s.worldsDir);
    for (const d of live) void peek(d).then((w) => setInfo((m) => ({ ...m, [d]: bookInfo(d, w) })));
  };
  useEffect(() => {
    void refresh();
    // Coming back to the app shows worlds added or removed meanwhile.
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    // Books made or changed outside the app (an AI assistant through `lore mcp`) show up at once.
    const stop = window.lore.onLibraryChanged(() => void refresh());
    return () => {
      window.removeEventListener('focus', onFocus);
      stop();
    };
  }, []);
  const trash = async (dir: string) => {
    // The app's own sample only leaves the shelf (Library settings shows it again); other folders go to the trash.
    if (removeKind(dir, sample) === 'hide') await window.lore.saveSettings({ hideSample: true });
    else {
      await window.lore.trashWorld(dir);
      trashed.current.add(dir);
    }
    setShelf((list) => list.filter((d) => d !== dir));
    setDialog(null);
    await refresh();
  };
  const shelfBox = useRef<HTMLUListElement>(null);
  const books = useShelf();
  const found = useMemo(() => searchShelf(shelf, info, query), [shelf, info, query]);
  const searching = query.trim() !== '';
  const setSearch = (q: string) => { books.reset(); setQuery(q); };
  // Rearranging the shelf: drag a book, or Alt+Arrow keys on the focused one. Off while a search filters the shelf
  // (the full order would be ambiguous); the order is saved in settings.json and new worlds go at its end.
  const [moved, setMoved] = useState('');
  const refocus = useRef<string | null>(null);
  const slide = useSlide(shelfBox);
  const moveTo = (key: string, to: number) => {
    const next = moveBook(shelf, key, to);
    slide();
    setShelf(next);
    void window.lore.saveSettings({ shelfOrder: next });
    const name = info[key]?.name ?? folderName(key);
    setMoved(`Moved ${name} to place ${next.indexOf(key) + 1} of ${next.length}.`);
  };
  const reorder = useShelfDrag(shelfBox, {
    enabled: () => !searching,
    onStart: () => { books.pause(true); (document.activeElement as HTMLElement | null)?.blur(); },
    onEnd: () => books.pause(false),
    onMove: moveTo,
    onShift: slide,
  });
  // While a book is dragged, it waits at the place it would land.
  const shown = reorder.drag ? moveBook(found, reorder.drag.key, reorder.drag.at) : found;
  // A Duplicate stays in the library (it does not open): the copy, next to its original, glows once, is scrolled
  // into view and said aloud. It is shown once it is on the shelf (after the refresh). Nothing stays lit after: the
  // glow ends on animationend (or a timeout, for reduced motion), and the dialog going away leaves no book out or
  // focused (a focused book comes out and shows a focus ring; Enter in the name box counts as keyboard use).
  const [fresh, setFresh] = useState<string | null>(highlight);
  const lit = useRef<string | null>(null);
  useEffect(() => {
    if (!fresh || lit.current === fresh || !shelfBox.current) return;
    const li = shelfBooks(shelfBox.current).find((b) => b.dataset['key'] === fresh);
    if (!li) return;
    lit.current = fresh;
    const settleFocus = () => {
      if (document.activeElement instanceof HTMLElement && shelfBox.current?.contains(document.activeElement)) document.activeElement.blur();
      books.reset();
    };
    settleFocus();
    li.setAttribute('data-fresh', '');
    li.scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' });
    setMoved(`Made a copy, ${li.dataset['name'] ?? folderName(fresh)}, next to the original.`);
    const spine = li.querySelector('.book-spine');
    let timer = 0;
    const clear = () => {
      clearTimeout(timer);
      spine?.removeEventListener('animationend', onEnd);
      li.removeAttribute('data-fresh');
      settleFocus();
      if (lit.current === fresh) lit.current = null;
      setFresh((f) => (f === fresh ? null : f));
    };
    const onEnd = (e: Event) => { if ((e as AnimationEvent).animationName === 'fresh-glow') clear(); };
    spine?.addEventListener('animationend', onEnd);
    timer = window.setTimeout(clear, FRESH_MS);
  });
  useLayoutEffect(() => {
    const key = refocus.current;
    if (!key || !shelfBox.current) return;
    refocus.current = null;
    const li = shelfBooks(shelfBox.current).find((b) => b.dataset['key'] === key);
    li?.querySelector<HTMLElement>('.world-book')?.focus();
    li?.scrollIntoView({ block: 'nearest' });
  }, [shelf]);
  const onShelfKey = (e: KeyboardEvent) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    const li = e.target instanceof Element ? e.target.closest<HTMLElement>('.shelf-book') : null;
    if (!li || li.classList.contains('new-book') || !shelfBox.current) return;
    e.preventDefault();
    e.stopPropagation();
    if (searching) { setMoved('Clear the search to rearrange the shelf.'); return; }
    const list = shelfBooks(shelfBox.current);
    const i = list.indexOf(li);
    let to = i;
    if (e.key === 'ArrowLeft') to = i - 1;
    else if (e.key === 'ArrowRight') to = i + 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = list.length - 1;
    else {
      // Up and down: the same place on the row above or below.
      const rows = rowsOf(list);
      const r = rows.findIndex((row) => row.includes(li));
      const other = rows[r + (e.key === 'ArrowUp' ? -1 : 1)];
      if (!other) return;
      const near = other.reduce((a, b) => (Math.abs(b.offsetLeft - li.offsetLeft) < Math.abs(a.offsetLeft - li.offsetLeft) ? b : a));
      to = list.indexOf(near);
    }
    to = Math.max(0, Math.min(to, list.length - 1));
    if (to === i) return;
    refocus.current = li.dataset['key']!;
    moveTo(li.dataset['key']!, to);
  };
  useEffect(() => {
    // Ctrl+F or / goes to the search box (not while typing elsewhere or with a dialog open).
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.modal-backdrop, .confirm-backdrop')) return;
      const typing = e.target instanceof HTMLElement && !!e.target.closest('input, textarea, select, [contenteditable="true"]');
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') || (e.key === '/' && !typing)) {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const onSearchKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); setSearch(''); }
    else if (e.key === 'Enter' && searching && found.length === 1) { e.preventDefault(); onOpen(found[0]!); }
  };
  useEffect(() => {
    // Leaving the window (or switching away) puts the book back, unless it has keyboard focus.
    window.addEventListener('blur', books.away);
    document.documentElement.addEventListener('pointerleave', books.away);
    document.addEventListener('pointermove', books.track, { passive: true });
    return () => { window.removeEventListener('blur', books.away); document.documentElement.removeEventListener('pointerleave', books.away); document.removeEventListener('pointermove', books.track); };
  }, []);
  const openFolder = async () => {
    try {
      setProblem(null);
      const dir = await window.lore.pickWorld();
      if (dir) onOpen(dir);
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  return (
    <main class="start library">
      <Aura scene />
      <header class="start-hero">
        <img class="start-mark" src="./icon.svg" alt="" />
        <div class="start-hero-text">
          <h1>Lore-Forge</h1>
        </div>
        <div class="library-search" role="search">
          <Icon name="magnifying-glass" class="search-mark" />
          <input ref={search} type="search" value={query} placeholder="Search books..." aria-label="Search books" aria-keyshortcuts="Control+F /" aria-controls="library-shelf"
            onInput={(e) => setSearch(e.currentTarget.value)} onKeyDown={onSearchKey} />
          {query && <button type="button" class="ghost icon-only search-clear" onClick={() => { setSearch(''); search.current?.focus(); }} aria-label="Clear search" title="Clear search (Esc)"><Icon name="cancel" /></button>}
        </div>
        <div class="start-actions">
          <button type="button" class="ghost" onClick={() => void openFolder()}><Icon name="open-folder" /> Open a world folder…</button>
          <button type="button" class="ghost start-tour" onClick={onTour} title="A short guided tour of Lore-Forge, using the sample world"><Icon name="direction-signs" /> Take the tour</button>
          <button type="button" class="ghost start-ai has-label" onClick={() => setDialog({ kind: 'ai' })} aria-label="Connect AI" title="Let Claude, Codex or another AI app write worlds and stories in Lore-Forge, with pictures"><Icon name="magic-lamp" /><span class="btn-label">Connect AI</span></button>
          <button type="button" class="ghost start-about has-label" onClick={() => setDialog({ kind: 'about' })} aria-label="About and credits" title="About Lore-Forge, credits and licences"><Icon name="laurels" /><span class="btn-label">About</span></button>
          <button type="button" class="ghost start-settings has-label" onClick={() => setDialog({ kind: 'settings' })} aria-label="Library settings" title="Library settings"><Icon name="cog" /><span class="btn-label">Settings</span></button>
        </div>
      </header>
      {(error || problem) && <p class="error-line" role="alert"><Icon name="cancel" /> {error ?? problem}</p>}
      <section class="bookcase" aria-labelledby="shelf-title" aria-describedby="shelf-hint">
        <div class="shelf-head">
          <h2 id="shelf-title">Your worlds</h2>
          <span class="muted shelf-count" aria-live="polite">{searching ? `${found.length} of ${shelf.length} ${shelf.length === 1 ? 'book' : 'books'}` : `${shelf.length} ${shelf.length === 1 ? 'book' : 'books'}`}</span>
        </div>
        {/* No visible hint: the books say what they do when pointed at. Screen readers still hear how to use the shelf,
            and when a search leaves one book, that Enter opens it. */}
        <p class="sr-only shelf-hint" id="shelf-hint" role="status">{searching && found.length === 1 ? 'One book matches. Press Enter to open it.' : 'Each book is one world. Click a book or press Enter on it to open it. Drag a book, or press Alt with an arrow key, Home or End, to move it on the shelf.'}</p>
        {searching && found.length === 0 && (
          <div class="shelf-empty" role="status">
            <Icon name="book-cover" class="shelf-empty-mark" />
            <p>No book on the shelf matches “{query.trim()}”.</p>
            <p class="muted">Try another word from its title, author or description.</p>
            <button type="button" class="ghost small" onClick={() => { setSearch(''); search.current?.focus(); }}><Icon name="cancel" /> Clear search</button>
          </div>
        )}
        <ul class={`shelf${reorder.drag ? ' is-dragging' : ''}`} id="library-shelf" ref={shelfBox} {...reorder.handlers} onKeyDown={onShelfKey} hidden={searching && found.length === 0} style={{ '--hx': books.hinge === null ? '50%' : `${books.hinge}px`, ...(books.hingeY === null ? {} : { '--hy': `${books.hingeY}px` }) }}>
          {/* The New book always comes first, and stays there. */}
          {!searching && <li class={`world-card shelf-book new-book${placeClass(books.place(NEW))}`} data-key={NEW} style={{ '--h': 'calc(var(--bk, 1) * 13.6rem)', '--w': 'calc(var(--bk, 1) * 10.2rem)', '--d': 'calc(var(--bk, 1) * 2.8rem)', ...placeStyle(books.place(NEW)) }} {...books.hover(NEW)}>
            <button type="button" class="world-book" onClick={() => setDialog({ kind: 'create' })} aria-label="New book: start a new world">
              <BookBox
                spine={<span class="book-face book-spine"><span class="spine-title title-display">New book</span><Icon name="quill-ink" class="spine-mark" /></span>}
                cover={
                  <span class="book-face book-cover world-cover blank-cover">
                    <Icon name="quill-ink" class="blank-mark" />
                    <span class="cover-title title-display">New book</span>
                    <span class="world-meta"><span>Start a new world</span></span>
                  </span>
                }
              />
            </button>
          </li>}
          {shown.map((d) => <Book key={d} dir={d} remove={removeKind(d, sample)} place={books.place(d)} hover={books.hover(d)} onOpen={onOpen} onDelete={(dir, name, world) => setDialog({ kind: 'delete', dir, name, world })} onDuplicate={(dir, name) => setDialog({ kind: 'duplicate', dir, name })} />)}
        </ul>
        <p class="sr-only shelf-moved" role="status">{moved}</p>
      </section>
      {dialog?.kind === 'create' && <CreateBook worldsDir={worldsDir} onClose={() => setDialog(null)} onCreated={(dir) => { setDialog(null); onOpen(dir); }} />}
      {dialog?.kind === 'about' && <AboutDialog onClose={() => setDialog(null)} onTour={() => { setDialog(null); onTour(); }} />}
      {dialog?.kind === 'duplicate' && <DuplicateBook dir={dialog.dir} name={dialog.name} onClose={() => setDialog(null)} onDone={(copy) => { setDialog(null); void refresh().then(() => setFresh(copy)); }} />}
      {dialog?.kind === 'ai' && <ConnectAi onClose={() => setDialog(null)} />}
      {dialog?.kind === 'settings' && <LibrarySettings onClose={() => setDialog(null)} onSaved={() => void refresh()} />}
      {dialog?.kind === 'delete' && (
        <DeleteBook dir={dialog.dir} name={dialog.name} world={dialog.world} kind={removeKind(dialog.dir, sample)} onClose={() => setDialog(null)} onConfirm={() => trash(dialog.dir)} />
      )}
    </main>
  );
}
