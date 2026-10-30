import { memo } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { COVER_EMBLEMS, coverArt, coverImageFile, ENTRY_TYPES, hash, parseWorld, TYPE_ICON, TYPE_LABELS, worldCoverArt, type World, type WorldCoverSettings } from '@lore-forge/core';
import { Icon } from './icon.tsx';
import { titleFont, useEdgeColour, useImage, WorldCover } from './cover.tsx';
import { ColorField } from './color.tsx';
import { IconPicker } from './icon-picker.tsx';
import { EMBLEM_CHOICES } from './cover-editor.tsx';
import { CoverSwitches, RecentPictures } from './cover-options.tsx';
import { Aura } from './aura.tsx';
import { ConfirmDialog, trapTab } from './confirm.tsx';
import { AboutDialog } from './about.tsx';

/** Shelf key of the blank "New book". */
const NEW = '\u0000new';

type Peek = World | null | undefined;

/**
 * Each book is read once per visit to the library, a few at a time, so a shelf of hundreds of books does not send
 * hundreds of reads at once. The shelf, the search and the books share the same reads.
 */
const peeks = new Map<string, Promise<World | null>>();
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
  if (!peeks.has(dir)) peeks.set(dir, readPeek(dir));
  return peeks.get(dir)!;
};

function usePeek(dir: string): Peek {
  const [world, setWorld] = useState<Peek>(undefined);
  useEffect(() => {
    let live = true;
    setWorld(undefined);
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
  return { '--h': `${h}rem`, '--w': `${(h * 3) / 4}rem`, '--d': `${(2.3 + Math.min(0.6, entries * 0.03)).toFixed(2)}rem` };
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

const placeClass = (p: BookPlace) => `${p.state === 'out' ? ' is-out' : p.state === 'closing' ? ' is-closing' : ''}${p.side === 'left' ? ' opens-left' : ''}`;
const placeStyle = (p: BookPlace) => ({ '--push': `${p.push}px` });

/**
 * One world as a book on the shelf: the spine with the title at rest; out (pointer or keyboard focus on it), the
 * front cover with the world's cover art and entry counts. Click or Enter opens it. The delete button is not inside
 * the open button: it sits in a second, empty box with the same transforms (book-lid), on the cover's top-right
 * corner.
 */
interface BookProps { dir: string; deletable: boolean; place: BookPlace; hover: ShelfHover; onOpen: (dir: string) => void; onDelete: (dir: string, name: string, world: World | null | undefined) => void }

/** Only a change of place re-renders a book (the handlers only read the shelf's refs), so a hover redraws two or three books, not the whole shelf. */
const samePlace = (a: BookProps, b: BookProps) => a.dir === b.dir && a.deletable === b.deletable && a.place.state === b.place.state && a.place.side === b.place.side && a.place.push === b.place.push;

const Book = memo(function Book({ dir, deletable, place, hover, onOpen, onDelete }: BookProps) {
  const world = usePeek(dir);
  const li = useRef<HTMLLIElement>(null);
  const near = useNear(li);
  const name = world?.manifest.name ?? folderName(dir);
  const counts = world ? ENTRY_TYPES.map((t) => [t, world.entries.filter((e) => e.type === t).length] as const).filter(([, n]) => n) : [];
  const base = world ? worldCoverArt(world) : coverArt(name);
  const image = useImage(dir, world && near ? base.image : undefined);
  // The spine takes the colour of the picture's left edge, unless one is chosen.
  const edge = useEdgeColour(image);
  const art = world && edge ? coverArt(world.manifest.id, world.manifest.cover, coverImageFile(world.entries), edge) : base;
  const font = titleFont(art);
  const id = `wc-${encodeURIComponent(dir)}`;
  const style = { ...bookSize(world?.manifest.id ?? name, world?.entries.length ?? 0), '--spine': art.spine, '--spine-ink': art.spineInk, ...placeStyle(place) };
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
      {deletable && world !== undefined && (
        <span class="book-lid">
          <span class="book-pull">
            <span class="book-body">
              <span class="book-face lid-face">
                <button type="button" class="book-delete" onClick={() => onDelete(dir, name, world)} aria-label={`Delete ${name}`} title="Move this world to the trash"><Icon name="trash-can" /></button>
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
const CLOSING_MS = 520;
/** Space between an open cover and the books it pushed aside. */
const COVER_GAP = 12;

/** hinge: where the out book's hinge is, in shelf pixels; the shelf looks along it (styles.css). */
interface ShelfState { out: string | null; side: 'right' | 'left'; push: Record<string, number>; hinge: number | null; hingeY: number | null; closing: string | null }
const IDLE: ShelfState = { out: null, side: 'right', push: {}, hinge: null, hingeY: null, closing: null };

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
  if (fitsRight || !fitsLeft) return { side: 'right', hinge: left, hingeY, push: Object.fromEntries(right.map((b) => [keyOf(b), Math.round(pushRight)])) };
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
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const commit = (next: ShelfState) => { cur.current = next; setSt(next); };
  const clearIntent = () => { if (intent.current) clearTimeout(intent.current.timer); intent.current = null; };
  const goingBack = (key: string | null) => {
    clearTimeout(closeTimer.current);
    if (key) closeTimer.current = setTimeout(() => cur.current.closing === key && commit({ ...cur.current, closing: null }), CLOSING_MS);
    return key;
  };
  const take = (key: string, li: HTMLElement) => {
    clearIntent();
    const was = cur.current.out;
    if (was === key) return;
    commit({ out: key, ...layoutOut(li), closing: goingBack(was) ?? (cur.current.closing === key ? null : cur.current.closing) });
  };
  const putBack = (key: string) => {
    if (intent.current?.key === key) clearIntent();
    if (cur.current.out !== key) return;
    commit({ ...IDLE, hingeY: cur.current.hingeY, closing: goingBack(key) });
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
  useEffect(() => () => { clearIntent(); clearTimeout(closeTimer.current); }, []);
  const hover = (key: string): ShelfHover => ({
    onPointerEnter: (e) => {
      const li = e.currentTarget as HTMLElement;
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
    state: st.out === key ? 'out' : st.closing === key ? 'closing' : 'rest',
    side: st.out === key ? st.side : 'right',
    push: st.push[key] ?? 0,
  });
  return { hover, place, away, track, hinge: st.out ? st.hinge : null, hingeY: st.hingeY, reset: () => { clearIntent(); commit(IDLE); } };
}

const SWATCHES = ['#7a2e2e', '#8a5a1c', '#2f5d3a', '#1f4f6b', '#3b3478', '#5c2a5e', '#2b2f3a', '#6b4a2b', '#14161b', '#3a2a1e'];

/** Modal shell shared by the library dialogs: Escape and a click outside close it; Tab stays inside. */
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: preact.ComponentChildren }) {
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={box} class="about library-dialog" role="dialog" aria-modal="true" aria-labelledby="library-dialog-title" onKeyDown={(e) => trapTab(box.current, e)}>
        <h2 id="library-dialog-title">{title}</h2>
        {children}
      </section>
    </div>
  );
}

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
            <span class="spine-sample create-spine" style={{ background: art.spine, color: art.spineInk }}><span>{(name || 'Untitled world').slice(0, 14)}</span></span>
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
function DeleteBook({ dir, name, world, onClose, onConfirm }: { dir: string; name: string; world: World | null | undefined; onClose: () => void; onConfirm: () => Promise<void> }) {
  const art = world ? worldCoverArt(world) : coverArt(name);
  const image = useImage(dir, world ? art.image : undefined);
  const counts = world ? ENTRY_TYPES.map((t) => [t, world.entries.filter((e) => e.type === t).length] as const).filter(([, n]) => n) : [];
  return (
    <ConfirmDialog
      title={`Delete “${name}”?`}
      confirmLabel="Move to trash"
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
      <p>Moves the folder to the system trash, with its entries, story and images. You can restore it from there.</p>
    </ConfirmDialog>
  );
}

function LibrarySettings({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<{ worldsDir: string; defaultWorldsDir: string } | null>(null);
  useEffect(() => void window.lore.settings().then(setS), []);
  const save = async (worldsDir: string) => {
    await window.lore.saveSettings({ worldsDir });
    setS(await window.lore.settings());
  };
  return (
    <Dialog title="Library settings" onClose={onClose}>
      {s && (
        <div class="field">
          <span class="field-label">New worlds go to</span>
          <div class="location-line">
            <span class="location-path" title={s.worldsDir}>{s.worldsDir}</span>
            <button type="button" class="ghost small" onClick={() => void window.lore.chooseFolder('Default folder for new worlds', s.worldsDir).then((d) => { if (d) void save(d); })}><Icon name="open-folder" /> Change…</button>
            {s.worldsDir !== s.defaultWorldsDir && <button type="button" class="ghost small" onClick={() => void save('')}>Use the app's worlds folder</button>}
          </div>
        </div>
      )}
      <div class="dialog-actions"><button type="button" class="primary" onClick={onClose}>Done</button></div>
    </Dialog>
  );
}

/** The landing page: a library where every world is a book on the shelf, plus a blank book to start a new one. */
export function StartScreen({ onOpen, error }: { onOpen: (dir: string) => void; error: string | null }) {
  const [shelf, setShelf] = useState<string[]>([]);
  const [bundled, setBundled] = useState<string | null>(null);
  const [worldsDir, setWorldsDir] = useState('');
  const [dialog, setDialog] = useState<{ kind: 'create' } | { kind: 'settings' } | { kind: 'about' } | { kind: 'delete'; dir: string; name: string; world: World | null | undefined } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Books moved to the trash this session never come back from a refresh that raced the move.
  const trashed = useRef(new Set<string>());
  const [info, setInfo] = useState<Record<string, BookInfo>>({});
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const refresh = async () => {
    const [list, b, s] = await Promise.all([window.lore.listWorlds(), window.lore.bundledWorld(), window.lore.settings()]);
    // Books may have changed while the library was away (edited covers, worlds made elsewhere): read them again.
    peeks.clear();
    const live = list.filter((d) => !trashed.current.has(d));
    setShelf(live);
    setBundled(b);
    setWorldsDir(s.worldsDir);
    for (const d of live) void peek(d).then((w) => setInfo((m) => ({ ...m, [d]: bookInfo(d, w) })));
  };
  useEffect(() => {
    void refresh();
    // Coming back to the app shows worlds added or removed meanwhile.
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  const trash = async (dir: string) => {
    await window.lore.trashWorld(dir);
    trashed.current.add(dir);
    setShelf((list) => list.filter((d) => d !== dir));
    setDialog(null);
    await refresh();
  };
  const shelfBox = useRef<HTMLUListElement>(null);
  const books = useShelf();
  const found = useMemo(() => searchShelf(shelf, info, query), [shelf, info, query]);
  const searching = query.trim() !== '';
  const setSearch = (q: string) => { books.reset(); setQuery(q); };
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
          <p class="muted">Write the worlds, lore and characters of your games. Each book on the shelf is one world.</p>
        </div>
        <div class="library-search" role="search">
          <Icon name="magnifying-glass" class="search-mark" />
          <input ref={search} type="search" value={query} placeholder="Search books..." aria-label="Search books" aria-keyshortcuts="Control+F /" aria-controls="library-shelf"
            onInput={(e) => setSearch(e.currentTarget.value)} onKeyDown={onSearchKey} />
          {query && <button type="button" class="ghost icon-only search-clear" onClick={() => { setSearch(''); search.current?.focus(); }} aria-label="Clear search" title="Clear search (Esc)"><Icon name="cancel" /></button>}
        </div>
        <div class="start-actions">
          <button type="button" class="ghost" onClick={() => void openFolder()}><Icon name="open-folder" /> Open a world folder…</button>
          <button type="button" class="ghost icon-only start-about" onClick={() => setDialog({ kind: 'about' })} aria-label="About and credits" title="About Lore-Forge, credits and licences"><Icon name="laurels" /></button>
          <button type="button" class="ghost icon-only" onClick={() => setDialog({ kind: 'settings' })} aria-label="Library settings" title="Library settings"><Icon name="cog" /></button>
        </div>
      </header>
      {(error || problem) && <p class="error-line" role="alert"><Icon name="cancel" /> {error ?? problem}</p>}
      <section class="bookcase" aria-labelledby="shelf-title">
        <div class="shelf-head">
          <h2 id="shelf-title">Your worlds</h2>
          <span class="muted shelf-count" aria-live="polite">{searching ? `${found.length} of ${shelf.length} ${shelf.length === 1 ? 'book' : 'books'}` : `${shelf.length} ${shelf.length === 1 ? 'book' : 'books'}`}</span>
        </div>
        <p class="muted shelf-hint">{searching && found.length === 1 ? 'One book matches. Press Enter to open it.' : 'Point at a book to take it off the shelf. Click or press Enter to open it.'}</p>
        {searching && found.length === 0 && (
          <div class="shelf-empty" role="status">
            <Icon name="book-cover" class="shelf-empty-mark" />
            <p>No book on the shelf matches “{query.trim()}”.</p>
            <p class="muted">Try another word from its title, author or description.</p>
            <button type="button" class="ghost small" onClick={() => { setSearch(''); search.current?.focus(); }}><Icon name="cancel" /> Clear search</button>
          </div>
        )}
        <ul class="shelf" id="library-shelf" ref={shelfBox} hidden={searching && found.length === 0} style={{ '--hx': books.hinge === null ? '50%' : `${books.hinge}px`, ...(books.hingeY === null ? {} : { '--hy': `${books.hingeY}px` }) }}>
          {found.map((d) => <Book key={d} dir={d} deletable={d !== bundled} place={books.place(d)} hover={books.hover(d)} onOpen={onOpen} onDelete={(dir, name, world) => setDialog({ kind: 'delete', dir, name, world })} />)}
          {!searching && <li class={`world-card shelf-book new-book${placeClass(books.place(NEW))}`} data-key={NEW} style={{ '--h': '13.6rem', '--w': '10.2rem', '--d': '2.8rem', ...placeStyle(books.place(NEW)) }} {...books.hover(NEW)}>
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
        </ul>
      </section>
      {dialog?.kind === 'create' && <CreateBook worldsDir={worldsDir} onClose={() => setDialog(null)} onCreated={(dir) => { setDialog(null); onOpen(dir); }} />}
      {dialog?.kind === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'settings' && <LibrarySettings onClose={() => { setDialog(null); void refresh(); }} />}
      {dialog?.kind === 'delete' && (
        <DeleteBook dir={dialog.dir} name={dialog.name} world={dialog.world} onClose={() => setDialog(null)} onConfirm={() => trash(dialog.dir)} />
      )}
    </main>
  );
}
