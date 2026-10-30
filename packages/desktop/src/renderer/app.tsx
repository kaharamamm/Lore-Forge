import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  check, DEFAULT_STATUS, ENTRY_TYPES, entryPath, LIFECYCLE, familyTree, INTENDED_FILE, parseWorld, relationWeb, serializeEntry, serializeIntended, timelineModel, TYPE_ICON, TYPE_SINGULAR, WorldIndex,
  type Entry, type EntryType, type FactRef, type IconName, type Warning, type World,
} from '@lore-forge/core';
import type { PdfKind, PublishOptions } from '../shared/api.ts';
import { EntryEditor } from './components/editor.tsx';
import { RelationsView, type RelationMode } from './components/relations.tsx';
import { Sidebar } from './components/sidebar.tsx';
import { StartScreen } from './components/start.tsx';
import { TimelineView } from './components/timeline.tsx';
import { PreviewDialog, previewDoc, sheetsOf } from './components/preview.tsx';
import { ToastStack, useToasts } from './components/toasts.tsx';
import { involves, WarningsPanel, type WarningActions } from './components/warnings.tsx';
import { Icon } from './components/icon.tsx';
import { CommandPalette, type PaletteItem } from './components/palette.tsx';
import { AboutDialog } from './components/about.tsx';
import { transition } from './motion.ts';
import { WorldHome } from './components/home.tsx';
import { forgetImages, WorldDir } from './components/cover.tsx';

type View = 'home' | 'editor' | 'timeline' | 'relations';
type SaveState = { kind: 'saved' } | { kind: 'saving' } | { kind: 'failed'; message: string };

const ID_PREFIX: Record<EntryType, string> = { character: 'char', place: 'place', faction: 'fac', item: 'item', event: 'evt', note: 'note' };
const SAVE_DELAY_MS = 400;

function newId(type: EntryType, name: string, taken: Set<string>): string {
  const base = `${ID_PREFIX[type]}-${name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'entry'}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

const SMOKE = new URLSearchParams(location.search).has('smoke');
const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));
/** Smoke only: wait until a check holds (a View Transition defers its update to the next rendered frame). */
const until = async (ok: () => boolean, ms = 3000) => { for (let t = 0; t < ms && !ok(); t += 50) await tick(50); return ok(); };
const count = (sel: string) => document.querySelectorAll(sel).length;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);

/** Smoke only: colour emoji in the app's own text (they show as empty boxes where no emoji font is installed). */
const emojiIn = (el: Element | null) => [...(el as HTMLElement | null)?.innerText.matchAll(/\p{Extended_Pictographic}/gu) ?? []].map((m) => m[0]);

/** Smoke only: every pane spans from below the top bar to the bottom of the window, and the page itself never scrolls. */
function paneFit(): string[] {
  const bad: string[] = [];
  const h = window.innerHeight;
  const doc = document.scrollingElement!;
  if (doc.scrollHeight > h + 1) bad.push(`page scrolls (${doc.scrollHeight} > ${h})`);
  const top = $('.topbar')!.getBoundingClientRect().bottom;
  for (const sel of ['.sidebar', '.main', '.warnings-panel']) {
    const r = $(sel)?.getBoundingClientRect();
    if (!r) bad.push(`${sel} missing`);
    else if (Math.abs(r.bottom - h) > 1 || Math.abs(r.top - top) > 1) bad.push(`${sel} spans ${Math.round(r.top)}-${Math.round(r.bottom)}, window ${Math.round(top)}-${h}`);
  }
  return bad;
}

/** What the headless smoke test checks: the same builders the views and the preview use. */
function smokeSummary(w: World): Record<string, unknown> {
  const warnings = check(w);
  const docs = Object.fromEntries((['codex', 'book'] as const).map((k) => {
    const d = previewDoc(w, k, {});
    return [k, { blocks: d.blocks.length, sheets: sheetsOf(d.blocks).length, images: d.blocks.filter((b) => b.kind === 'image').length }];
  }));
  const trimmed = previewDoc(w, 'codex', { types: ['character'], warnings: false });
  const single = previewDoc(w, 'book', { grouping: 'single' });
  const firstChar = w.entries.find((e) => e.type === 'character');
  const tree = familyTree(w, firstChar?.id);
  const webs = w.entries.filter((e) => e.type === 'character').map((e) => relationWeb(w, e.id)!).sort((a, b) => b.nodes.length - a.nodes.length);
  const tl = timelineModel(w, warnings);
  const ix = new WorldIndex(w);
  return {
    world: w.manifest.name,
    entries: w.entries.length,
    warnings: warnings.length,
    preview: { ...docs, codexCharactersOnly: trimmed.blocks.length, bookSingleChapter: single.blocks.filter((b) => b.kind === 'heading' && b.level === 1 && b.toc).length },
    tree: { people: tree.nodes.length, generations: tree.generations, edges: tree.edges.length, dead: tree.nodes.filter((n) => n.ended).length },
    web: webs[0] ? { focus: webs[0].nodes.find((n) => n.focus)!.entry.name, nodes: webs[0].nodes.length, edges: webs[0].edges.length } : null,
    timeline: tl ? { eras: tl.eras.length, lanes: tl.groups.reduce((n, g) => n + g.lanes.length, 0), flagged: tl.groups.reduce((n, g) => n + g.lanes.filter((l) => l.warnings.length).length, 0) } : null,
    mentions: w.entries.reduce((n, e) => n + ix.mentions.find(e.body, { exclude: e.id }).length, 0),
  };
}

function blankEntry(type: EntryType, id: string, name: string): Entry {
  return { id, type, name, ...(LIFECYCLE[type] ? { status: DEFAULT_STATUS } : {}), body: '' } as Entry;
}

/** Where the user is: the place mouse back/forward and Alt+Left/Right return to. */
interface Place {
  view: View;
  id: string | null;
  preview: PdfKind | null;
  relMode: RelationMode | null;
}

const samePlace = (a: Place, b: Place) => a.view === b.view && a.id === b.id && a.preview === b.preview && a.relMode === b.relMode;

/**
 * A back/forward stack of places. Every change of place is pushed (dropping any forward places);
 * going back or forward restores a place without pushing it again.
 * A restore renders later (it runs inside a View Transition), so until the target place shows up,
 * the places rendered on the way are not new history: two quick Backs must not cut off Forward.
 */
function useHistory(here: Place, restore: (p: Place) => void): { go: (step: -1 | 1) => void; reset: () => void } {
  const h = useRef({ stack: [] as Place[], i: -1, target: null as Place | null });
  useLayoutEffect(() => {
    const s = h.current;
    if (s.target) {
      if (samePlace(s.target, here)) s.target = null;
      return;
    }
    if (s.stack[s.i] && samePlace(s.stack[s.i]!, here)) return;
    s.stack = [...s.stack.slice(0, s.i + 1), here].slice(-200);
    s.i = s.stack.length - 1;
  }, [here.view, here.id, here.preview, here.relMode]);
  const go = (step: -1 | 1) => {
    const s = h.current;
    const place = s.stack[s.i + step];
    if (!place) return;
    s.i += step;
    s.target = samePlace(place, here) ? null : place;
    restore(place);
  };
  return { go, reset: () => { h.current = { stack: [], i: -1, target: null }; } };
}

export function App() {
  const [dir, setDir] = useState<string | null>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>('home');
  const dirRef = useRef<string | null>(null);
  const [query, setQuery] = useState('');
  const [save, setSave] = useState<SaveState>({ kind: 'saved' });
  const [preview, setPreview] = useState<PdfKind | null>(null);
  const [relMode, setRelMode] = useState<RelationMode | null>(null);
  const [palette, setPalette] = useState(false);
  const [about, setAbout] = useState(false);
  const [creating, setCreating] = useState<EntryType | null>(null);
  const history = useHistory({ view, id: selectedId, preview, relMode }, (loc) => transition(() => {
    setView(loc.view);
    setSelectedId(loc.id);
    setPreview(loc.preview);
    setRelMode(loc.relMode);
  }));
  const toasts = useToasts();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<string, () => Promise<void>>());

  const open = useCallback(async (d: string) => {
    try {
      const w = parseWorld(await window.lore.readWorld(d));
      if (dirRef.current !== d) {
        // Another world: fresh history, and start on its home page.
        history.reset();
        setView('home');
        dirRef.current = d;
      }
      forgetImages();
      setDir(d);
      setWorld(w);
      setLoadError(null);
      setSelectedId((cur) => (cur && w.entries.some((e) => e.id === cur) ? cur : (w.entries[0]?.id ?? null)));
      document.title = `${w.manifest.name} · Lore-Forge`;
      return w;
    } catch (e) {
      setLoadError(`Could not open ${d}: ${(e as Error).message}`);
      return null;
    }
  }, []);

  useEffect(() => {
    void window.lore.initialWorld().then(async (d) => {
      if (!d) return;
      const w = await open(d);
      if (!w || !SMOKE) return;
      // Smoke only: drive each view once and count what actually rendered.
      const summary = smokeSummary(w);
      const dom: Record<string, number> = {};
      const fails: string[] = [];
      const expect = (ok: boolean, what: string) => { if (!ok) fails.push(what); };
      const mouse = (button: number) => { for (const type of ['mousedown', 'mouseup']) window.dispatchEvent(new MouseEvent(type, { button, bubbles: true })); };
      try {
        // A world opens on its home page: cover, counts and a card with a portrait for every entry.
        expect(await until(() => !!$('.home')), 'world opens on its home page');
        dom['homeTiles'] = count('.home .entry-tile');
        expect(dom['homeTiles'] === w.entries.length, `home shows every entry (${dom['homeTiles']} of ${w.entries.length})`);
        expect(count('.home-cover .cover-art') === 1 && count('.home .entry-tile .portrait') === w.entries.length, 'home cover and portraits');
        dom['sidebarPortraits'] = count('.sidebar .entry-link .portrait');
        expect(dom['sidebarPortraits'] === w.entries.length, 'a portrait beside every entry in the sidebar');
        dom['portraitImages'] = (await until(() => count('.portrait img') > 0)) ? count('.portrait img') : 0;
        expect(dom['portraitImages'] > 0, 'entries with reference images show them as portraits');
        expect(emojiIn($('.home')).length === 0, 'no emoji on the home page');
        expect(paneFit().length === 0, `home layout: ${paneFit().join('; ')}`);
        const leyla = w.entries.find((e) => e.id === 'char-leyla') ?? w.entries.find((e) => e.type === 'character');
        if (leyla) {
          setSelectedId(leyla.id);
          setView('editor');
          await tick();
          dom['editorMentions'] = count('.prose-mirror mark.mention');
          dom['statusPills'] = count('.lifecycle [role=radio]');
          expect(count('.lifecycle [role=radio] svg.icon') === dom['statusPills'], 'status pills have icons');
          await document.fonts.load('700 16px Cinzel', 'Şafak İlsa');
          dom['cinzel'] = document.fonts.check('700 16px Cinzel', 'Şafak') && getComputedStyle($('#entry-title')!).fontFamily.includes('Cinzel') ? 1 : 0;
          expect(dom['cinzel'] === 1, 'Cinzel headings load');
          expect(emojiIn($('.lifecycle')).length + emojiIn($('.editor-head')).length === 0, 'no emoji in the editor');
          dom['relationSelects'] = count('[data-field^="relations"] select');
          // Status: exactly one is always selected; clicking the selected one keeps it.
          expect(count('.lifecycle [aria-checked="true"]') === 1, 'one status selected');
          $('.lifecycle [aria-checked="true"]')?.click();
          await tick();
          expect(count('.lifecycle [aria-checked="true"]') === 1, 'status cannot be cleared');
          dom['raceField'] = count('[data-field="race"] input');
          expect(dom['raceField'] === 1, 'race field');
          // Panes fill the window at a few sizes.
          for (const [width, height] of [[1360, 860], [820, 520], [1100, 700]] as const) {
            await window.lore.smokeResize(width, height);
            for (let i = 0; i < 40 && (window.innerWidth !== width || window.innerHeight !== height); i++) await tick(50);
            await tick(100);
            const bad = paneFit();
            if (window.innerWidth !== width || window.innerHeight !== height) bad.push(`window is ${window.innerWidth}x${window.innerHeight}`);
            expect(bad.length === 0, `layout at ${width}x${height}: ${bad.join('; ')}`);
            dom[`fit${width}x${height}`] = bad.length === 0 ? 1 : 0;
          }
          // Back/forward: entry A -> entry B -> timeline, then mouse 4 / Alt+Left back and mouse 5 forward.
          const other = w.entries.find((e) => e.type === 'place') ?? w.entries.find((e) => e.id !== leyla.id)!;
          setSelectedId(other.id);
          await tick();
          setView('timeline');
          await tick();
          const current = (id: string) => () => !!$(`[data-entry-id="${CSS.escape(id)}"][aria-current="page"]`) && !!$('.editor');
          mouse(3);
          expect(await until(current(other.id)), 'mouse back returns to the previous entry');
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }));
          expect(await until(current(leyla.id)), 'Alt+Left returns to the first entry');
          await tick(150);
          mouse(4);
          expect(await until(current(other.id)), 'mouse forward');
          await tick(150);
          mouse(4);
          expect(await until(() => !!$('.timeline, .tl-scroll')), 'forward to the timeline');
          // Two quick Backs (before the first one has rendered) land two places back and keep Forward.
          mouse(3);
          await tick(130);
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }));
          expect(await until(current(leyla.id)), 'two quick Backs');
          await tick(150);
          mouse(4);
          expect(await until(current(other.id)), 'Forward still works after two quick Backs');
          dom['history'] = 1;
          setSelectedId(leyla.id);
          setView('editor');
          await tick();
          setView('relations');
          await tick();
          dom['treeNodes'] = count('.family-tree .node');
          document.querySelector<HTMLButtonElement>('.relations .segmented button:nth-child(2)')?.click();
          await tick();
          const webSummary = summary['web'] as { nodes: number; edges: number } | null;
          if (webSummary) {
            // React Flow measures the cards first, then draws the edges.
            expect(await until(() => count('.relation-web .web-edge') === webSummary.edges && count('.relation-web .node') === webSummary.nodes), 'relationship web draws every card and edge');
            expect(count('.relation-web .node .portrait') === webSummary.nodes && !!$('.relation-web .react-flow__minimap') && !!$('.relation-web .react-flow__controls'), 'web has portrait cards, a minimap and zoom controls');
            const viewport = () => $('.relation-web .react-flow__viewport')?.style.transform ?? '';
            const before = viewport();
            $<HTMLButtonElement>('.relation-web .react-flow__controls-zoomin')?.click();
            expect(await until(() => viewport() !== before), 'web zooms in');
          }
          dom['webNodes'] = count('.relation-web .node');
          dom['webEdges'] = count('.relation-web .web-edge');
        }
        // Command palette: Ctrl+K, type a name, Enter opens it; a name that matches nothing offers to create it; About shows the credits.
        const key = (target: EventTarget, k: string, init: KeyboardEventInit = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
        const typeInto = (el: HTMLInputElement, text: string) => { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); };
        const target = [...w.entries].reverse().find((e) => w.entries.filter((o) => o.name.startsWith(e.name)).length === 1)!;
        key(window, 'k', { ctrlKey: true });
        await tick();
        const pal = $<HTMLInputElement>('.palette input')!;
        expect(!!pal && document.activeElement === pal, 'Ctrl+K opens the palette with focus in it');
        dom['paletteItems'] = count('.palette-item');
        expect(dom['paletteItems']! >= w.entries.length + 10, 'palette lists commands and every entry');
        typeInto(pal, target.name);
        await tick();
        key(pal, 'Enter');
        expect(await until(() => !$('.palette') && !!$(`[data-entry-id="${CSS.escape(target.id)}"][aria-current="page"]`)), `palette Enter opens ${target.name}`);
        key(window, 'k', { ctrlKey: true });
        await tick();
        typeInto($<HTMLInputElement>('.palette input')!, 'Qzxv Wraith');
        await tick();
        dom['paletteCreate'] = count('.palette-item');
        expect(dom['paletteCreate'] === 6 && ($('.palette-item')?.textContent ?? '').includes('Qzxv Wraith'), 'unmatched text offers to create an entry of each type');
        typeInto($<HTMLInputElement>('.palette input')!, 'about');
        await tick();
        key($('.palette input')!, 'Enter');
        await tick();
        dom['credits'] = count('.about .credit');
        expect(!!$('.about') && ($('.about')!.textContent ?? '').includes('CC BY 3.0') && ($('.about')!.textContent ?? '').includes('Open Font License'), 'About lists the icon and font licences');
        key(window, 'Escape');
        await tick();
        expect(!$('.about') && !$('.palette'), 'Escape closes About');
        // Motion: a tab click goes through a View Transition of the main pane and still lands on the view.
        dom['viewTransitions'] = typeof document.startViewTransition === 'function' && getComputedStyle($('.main')!).viewTransitionName === 'main-pane' ? 1 : 0;
        expect(dom['viewTransitions'] === 1, 'View Transitions available for the main pane');
        $<HTMLButtonElement>('.tabs button:nth-child(3)')!.click();
        await until(() => !!$('.tl-scroll'));
        await tick(300);
        expect(!!$('.tl-scroll') && $('.tabs button:nth-child(3)')?.getAttribute('aria-pressed') === 'true', 'Timeline tab opens the timeline');
        dom['timelineMarks'] = count('.tl-mark');
        dom['timelineBands'] = count('.tl-band');
        dom['timelineWarnings'] = count('.tl-warn');
        expect(emojiIn($('.topbar')).length === 0 && emojiIn($('.sidebar')).length === 0 && emojiIn($('.warnings-panel')).length === 0, `emoji in the app chrome: ${emojiIn(document.body)}`);
        dom['icons'] = count('svg.icon');
        for (const k of ['codex', 'book'] as const) {
          setPreview(k);
          await tick(150);
          dom[`${k}Sheets`] = count('.preview .sheet');
          dom[`${k}Headings`] = count('.preview .doc-h');
          dom[`${k}Icons`] = count('.preview .doc-h svg.icon');
          expect(emojiIn($('.preview-options')).length === 0 && emojiIn($('.preview-head')).length === 0, `${k} preview: emoji in UI text ${emojiIn($('.preview'))}`);
          expect(($('#preview-title')?.textContent ?? '').includes(k === 'codex' ? 'World Codex' : 'Story Book'), `${k} preview title`);
          setPreview(null);
          await tick();
        }
        setView('editor');
        await tick();
        // Close the world: the start screen shows worlds as book covers.
        $<HTMLButtonElement>('.top-actions button:nth-of-type(2)')!.click();
        expect(await until(() => count('.shelf .world-card .cover-art') > 0 && !!$('.shelf .world-count')), 'start screen shows world covers');
        dom['shelf'] = count('.shelf .world-card');
        expect(emojiIn($('.start')).length === 0, 'no emoji on the start screen');
        const scroller = $('.start')!;
        expect(scroller.getBoundingClientRect().height === window.innerHeight && getComputedStyle(scroller).overflowY === 'auto', 'start screen fills the window and scrolls on its own');
      } catch (e) {
        fails.push(String((e as Error).stack ?? e));
      }
      // A console error fails the smoke run in the main process.
      if (fails.length) console.error(`smoke checks failed: ${fails.join(' | ')}`);
      window.lore.smokeReport({ ...summary, dom });
    });
  }, [open]);

  const warnings = useMemo(() => (world ? check(world) : []), [world]);

  /** Debounced write; the latest content for a path wins. */
  const schedule = useCallback((key: string, write: () => Promise<void>) => {
    setSave({ kind: 'saving' });
    pending.current.set(key, write);
    clearTimeout(timers.current.get(key));
    timers.current.set(key, setTimeout(() => void flush(key), SAVE_DELAY_MS));
  }, []);

  const flush = async (key?: string): Promise<void> => {
    const keys = key ? [key] : [...pending.current.keys()];
    try {
      for (const k of keys) {
        clearTimeout(timers.current.get(k));
        const w = pending.current.get(k);
        pending.current.delete(k);
        if (w) await w();
      }
      if (pending.current.size === 0) setSave({ kind: 'saved' });
    } catch (e) {
      setSave({ kind: 'failed', message: (e as Error).message });
    }
  };

  const updateEntry = (entry: Entry): void => {
    if (!world || !dir) return;
    const path = world.files[entry.id] ?? entryPath(entry);
    setWorld({ ...world, entries: world.entries.map((e) => (e.id === entry.id ? entry : e)), files: { ...world.files, [entry.id]: path } });
    schedule(entry.id, () => window.lore.writeFile(dir, path, serializeEntry(entry)));
  };

  const createEntry = (type: EntryType, name: string): void => {
    if (!world || !dir) return;
    const entry = blankEntry(type, newId(type, name, new Set(world.entries.map((e) => e.id))), name);
    const path = entryPath(entry);
    setWorld({ ...world, entries: [...world.entries, entry], files: { ...world.files, [entry.id]: path } });
    setSelectedId(entry.id);
    setView('editor');
    schedule(entry.id, () => window.lore.writeFile(dir, path, serializeEntry(entry)));
  };

  const deleteEntry = async (entry: Entry): Promise<void> => {
    if (!world || !dir || !confirm(`Delete "${entry.name}"? Its file ${world.files[entry.id]} will be removed.`)) return;
    clearTimeout(timers.current.get(entry.id));
    pending.current.delete(entry.id);
    const path = world.files[entry.id];
    const files = { ...world.files };
    delete files[entry.id];
    setWorld({ ...world, entries: world.entries.filter((e) => e.id !== entry.id), files });
    setSelectedId(null);
    if (path) await window.lore.deleteFile(dir, path);
  };

  const setIntended = (intended: World['intended']): void => {
    if (!world || !dir) return;
    setWorld({ ...world, intended });
    schedule(INTENDED_FILE, () => window.lore.writeFile(dir, INTENDED_FILE, serializeIntended(intended)));
  };

  const jump = (fact: FactRef): void => {
    if (!world?.entries.some((e) => e.id === fact.entryId)) return;
    setSelectedId(fact.entryId);
    setView('editor');
    // After render, scroll to the field and focus its first input.
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(fact.field)}"]`) ?? document.querySelector<HTMLElement>(`[data-field="${CSS.escape(fact.field.replace(/\[\d+\]$/, ''))}"]`);
      if (!el) return document.getElementById('entry-title')?.focus();
      el.scrollIntoView({ block: 'center' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1600);
      el.querySelector<HTMLElement>('input, textarea, select')?.focus({ preventScroll: true });
    }, 30);
  };

  const actions: WarningActions = {
    onJump: jump,
    onMark: (w: Warning, note: string) => world && setIntended([...world.intended.filter((m) => m.warningId !== w.id), { warningId: w.id, ...(note ? { note } : {}), markedAt: new Date().toISOString().slice(0, 10) }]),
    onUnmark: (w: Warning) => world && setIntended(world.intended.filter((m) => m.warningId !== w.id)),
  };

  /** One step back or forward. Windows can report a mouse button both as a DOM event and an app command; count it once. */
  const lastNav = useRef({ at: 0, d: '' });
  const navigate = (d: 'back' | 'forward'): void => {
    const now = performance.now();
    if (lastNav.current.d === d && now - lastNav.current.at < 120) return;
    lastNav.current = { at: now, d };
    history.go(d === 'back' ? -1 : 1);
  };
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (world) setPalette((p) => !p);
      } else if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        document.getElementById('search')?.focus();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void flush().then(() => toasts.push({ tone: 'ok', text: 'All changes saved' }));
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        transition(() => setView('home'));
      } else if (mod && ['1', '2', '3'].includes(e.key)) {
        e.preventDefault();
        const next = (['editor', 'timeline', 'relations'] as const)[Number(e.key) - 1]!;
        transition(() => setView(next));
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        document.getElementById('warnings-title')?.focus();
      } else if (e.altKey && !mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        navigate(e.key === 'ArrowLeft' ? 'back' : 'forward');
      } else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const ids = [...document.querySelectorAll<HTMLElement>('[data-entry-id]')].map((b) => b.dataset['entryId']!);
        const i = selectedId ? ids.indexOf(selectedId) : -1;
        const next = ids[Math.min(Math.max(i + (e.key === 'ArrowDown' ? 1 : -1), 0), ids.length - 1)];
        if (next) {
          e.preventDefault();
          setSelectedId(next);
          document.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(next)}"]`)?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Mouse back/forward buttons (button 3 and 4 in the DOM).
  useEffect(() => {
    const onMouse = (e: MouseEvent): void => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      if (e.type === 'mouseup') navigate(e.button === 3 ? 'back' : 'forward');
    };
    window.addEventListener('mousedown', onMouse);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('mousedown', onMouse);
      window.removeEventListener('mouseup', onMouse);
    };
  });
  useEffect(() => window.lore.onNavigate((d) => navigateRef.current(d)), []);

  // Write anything pending before the window closes.
  useEffect(() => {
    const onUnload = () => void flush();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  });

  if (!world || !dir) return <StartScreen onOpen={(d) => void open(d)} error={loadError} />;

  const savePdf = async (kind: PdfKind, options: PublishOptions) => {
    const label = kind === 'codex' ? 'World Codex' : 'Story Book';
    try {
      await flush();
      const r = await window.lore.exportPdf(dir, kind, options);
      if (!r) return;
      setPreview(null);
      toasts.push({ tone: 'ok', text: `${label} saved: ${r.pages} pages (plus a .md copy)`, action: { label: 'Show in folder', run: () => void window.lore.showInFolder(r.pdf) } });
    } catch (e) {
      toasts.push({ tone: 'error', text: `${label} failed: ${(e as Error).message}` });
    }
  };
  const openEntry = (id: string) => transition(() => { setSelectedId(id); setView('editor'); });
  const goView = (v: View, mode?: RelationMode) => transition(() => { if (mode) setRelMode(mode); setView(v); });

  const selected = world.entries.find((e) => e.id === selectedId);
  const closeWorld = () => void flush().then(() => { setWorld(null); setDir(null); dirRef.current = null; document.title = 'Lore-Forge'; });
  const goHome = (to: 'timeline' | 'tree' | 'web' | 'codex' | 'book') => (to === 'codex' || to === 'book' ? setPreview(to) : to === 'timeline' ? goView('timeline') : goView('relations', to));
  const commands: PaletteItem[] = [
    { id: 'go-home', group: 'Go to', label: 'World home', hint: 'Ctrl+H', icon: 'house', run: () => goView('home') },
    { id: 'go-editor', group: 'Go to', label: 'Editor', icon: 'quill-ink', run: () => goView('editor') },
    { id: 'go-timeline', group: 'Go to', label: 'Timeline', icon: 'hourglass', run: () => goView('timeline') },
    { id: 'go-tree', group: 'Go to', label: 'Family tree', hint: 'Relationships', icon: 'family-tree', run: () => goView('relations', 'tree') },
    { id: 'go-web', group: 'Go to', label: 'Relationship web', hint: 'Relationships', icon: 'spider-web', run: () => goView('relations', 'web') },
    { id: 'go-back', group: 'Go to', label: 'Back', hint: 'Alt+Left, mouse 4', icon: 'fast-backward-button', run: () => navigate('back') },
    { id: 'go-forward', group: 'Go to', label: 'Forward', hint: 'Alt+Right, mouse 5', icon: 'fast-forward-button', run: () => navigate('forward') },
    { id: 'go-filter', group: 'Go to', label: 'Filter entries', hint: 'Ctrl+F', icon: 'magnifying-glass', run: () => setTimeout(() => document.getElementById('search')?.focus(), 0) },
    { id: 'go-warnings', group: 'Go to', label: 'Warnings', hint: 'Ctrl+Shift+W', icon: 'hazard-sign', run: () => setTimeout(() => document.getElementById('warnings-title')?.focus(), 0) },
    ...ENTRY_TYPES.map((t): PaletteItem => ({ id: `new-${t}`, group: 'Create', label: `New ${TYPE_SINGULAR[t].toLowerCase()}…`, icon: TYPE_ICON[t], tone: `t-${t}`, run: () => setCreating(t) })),
    { id: 'pub-codex', group: 'Publish', label: 'World Codex', hint: 'preview, then save as PDF', icon: 'book-cover', run: () => setPreview('codex') },
    { id: 'pub-book', group: 'Publish', label: 'Story Book', hint: 'preview, then save as PDF', icon: 'open-book', run: () => setPreview('book') },
    { id: 'w-save', group: 'World', label: 'Save all', hint: 'Ctrl+S', icon: 'check-mark', run: () => void flush().then(() => toasts.push({ tone: 'ok', text: 'All changes saved' })) },
    { id: 'w-reload', group: 'World', label: 'Reload from disk', icon: 'cycle', run: () => void flush().then(() => open(dir)) },
    { id: 'w-close', group: 'World', label: 'Close world', icon: 'exit-door', run: closeWorld },
    { id: 'w-about', group: 'World', label: 'About and credits', icon: 'laurels', run: () => setAbout(true) },
  ];
  const entryItems = [...world.entries].sort((a, b) => a.name.localeCompare(b.name)).map((e): PaletteItem => ({
    id: `e-${e.id}`, group: 'Entries', label: e.name, icon: TYPE_ICON[e.type], tone: `t-${e.type}`,
    hint: [TYPE_SINGULAR[e.type], e.type === 'character' ? e.race : undefined, ...(e.aliases ?? [])].filter(Boolean).join(' · '),
    run: () => openEntry(e.id),
  }));
  const createNamed = (name: string): PaletteItem[] => ENTRY_TYPES.map((t) => ({
    id: `create-${t}`, group: 'Create', label: `New ${TYPE_SINGULAR[t].toLowerCase()} “${name}”`, icon: TYPE_ICON[t], tone: `t-${t}`, run: () => createEntry(t, name),
  }));
  const tabs: [View, IconName, string][] = [['home', 'house', 'Home'], ['editor', 'quill-ink', 'Editor'], ['timeline', 'hourglass', 'Timeline'], ['relations', 'spider-web', 'Relationships']];
  return (
    <WorldDir.Provider value={dir}>
    <div class="app">
      <header class="topbar">
        <div class="world-title">
          <h1>{world.manifest.name}</h1>
          <span class="muted path" title={dir}>{dir}</span>
        </div>
        <button type="button" class="palette-open" onClick={() => setPalette(true)} title="Jump to an entry or run a command"><Icon name="magnifying-glass" /> <span>Search or run…</span> <kbd>Ctrl+K</kbd></button>
        <nav class="tabs" aria-label="Views">
          {tabs.map(([v, icon, label], i) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => goView(v)} title={i ? `Ctrl+${i}` : 'Ctrl+H'}><Icon name={icon} /> {label}</button>
          ))}
        </nav>
        <div class="publish-actions">
          <button type="button" class="publish" onClick={() => setPreview('codex')} title="Preview every entry with facts, visual description, reference images and art briefs; then save as PDF"><Icon name="book-cover" /> World Codex</button>
          <button type="button" class="publish" onClick={() => setPreview('book')} title="Preview your events and notes in story order as a book; then save as PDF"><Icon name="open-book" /> Story Book</button>
        </div>
        <div class="top-actions">
          <span class={`save save-${save.kind}`} role="status">
            {save.kind === 'saved' ? <><Icon name="check-mark" /> Saved</> : save.kind === 'saving' ? '… Saving' : <><Icon name="cancel" /> Save failed: {save.message}</>}
          </span>
          <button type="button" class="ghost small" onClick={() => void flush().then(() => open(dir))} title="Reload all files from disk">Reload</button>
          <button type="button" class="ghost small" onClick={closeWorld}>Close world</button>
          <button type="button" class="ghost small icon-only" onClick={() => setAbout(true)} aria-label="About and credits" title="About and credits"><Icon name="laurels" /></button>
        </div>
      </header>
      <Sidebar entries={world.entries} warnings={warnings} selectedId={selectedId} query={query} onQuery={setQuery} onSelect={(id) => transition(() => { setSelectedId(id); if (view === 'timeline' || view === 'home') setView('editor'); })} onCreate={createEntry} creating={creating} onCreating={setCreating} />
      <main class="main" id="main">
        {view === 'editor' &&
          (selected ? (
            <EntryEditor key={selected.id} dir={dir} world={world} entry={selected} warnings={warnings.filter((w) => involves(w, selected.id))} actions={actions} onChange={updateEntry} onDelete={() => void deleteEntry(selected)} onOpen={openEntry} />
          ) : (
            <div class="empty-state">
              <Icon class="empty-icon" name={world.entries.length ? 'pointing' : 'world'} />
              <p>{world.entries.length ? 'Pick an entry on the left to edit it.' : 'This world is empty. Start with a character, a place or an event: use “+ New” on the left.'}</p>
            </div>
          ))}
        {view === 'home' && <WorldHome dir={dir} world={world} warnings={warnings} onOpen={openEntry} onGo={goHome} />}
        {view === 'timeline' && <TimelineView world={world} warnings={warnings} selectedId={selectedId} onOpen={openEntry} />}
        {view === 'relations' && <RelationsView world={world} entry={selected} mode={relMode} onMode={setRelMode} onOpen={(id) => setSelectedId(id)} />}
      </main>
      <WarningsPanel warnings={warnings} selectedId={selectedId} actions={actions} />
      {preview && <PreviewDialog dir={dir} world={world} kind={preview} onClose={() => setPreview(null)} onSave={savePdf} />}
      {palette && <CommandPalette items={[...commands, ...entryItems]} extra={createNamed} onClose={() => setPalette(false)} />}
      {about && <AboutDialog onClose={() => setAbout(false)} />}
      <ToastStack toasts={toasts.toasts} dismiss={toasts.dismiss} />
    </div>
    </WorldDir.Provider>
  );
}
