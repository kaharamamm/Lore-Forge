import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  analyzeStory, applyFields, builtinRules, chapterPath, check, checkWorld, DEFAULT_STATUS, entryPath, LIFECYCLE, familyTree, INTENDED_FILE, isStoryFact, newEntryId, normalizeName, parseWorld,
  proposalEntry, relationWeb, searchEntries, eraUsage, serializeChapter, serializeEntry, serializeIntended, serializeStoryIgnored, sortChapters, sortWarnings, STORY_IGNORED_FILE, storyFact, timelineModel, TYPE_SINGULAR, WorldIndex,
  type BookSettings, type Calendar, type Entry, type EntryType, type FactRef, type IconName, type Proposal, type ProposalFields, type StoryAnalysis, type StoryChapter, type StoryIgnore, type Warning, type World, type WorldCoverSettings,
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
import { Aura } from './components/aura.tsx';
import { ErasLink, WorldSettings } from './components/world-settings.tsx';
import { transition } from './motion.ts';
import { WorldHome } from './components/home.tsx';
import { forgetImages, Portrait, WorldBookCover, WorldDir } from './components/cover.tsx';
import { ConfirmDialog } from './components/confirm.tsx';
import { PaneResizer, SaveIndicator, sidebarMax, useSidebarWidth, type SaveState } from './components/chrome.tsx';
import { ChapterList, StoryView, type StoryActions } from './components/story.tsx';

type View = 'home' | 'editor' | 'timeline' | 'relations' | 'story';

const SAVE_DELAY_MS = 400;
/** Story analysis waits this long after the last keystroke in a chapter. */
const STORY_DELAY_MS = 300;

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

/**
 * Proposals and story warnings for the world. Typing in a chapter re-runs the analysis once the author
 * pauses; any other change (an entry added from a proposal, an ignore) shows up at once.
 */
function useStoryAnalysis(world: World | null): StoryAnalysis | null {
  const [w, setW] = useState(world);
  const story = useRef(world?.story);
  useEffect(() => {
    const typing = !!w && !!world && world.story !== story.current;
    story.current = world?.story;
    if (!typing) return setW(world);
    const t = setTimeout(() => setW(world), STORY_DELAY_MS);
    return () => clearTimeout(t);
  }, [world]);
  return useMemo(() => (w?.story?.length ? analyzeStory(w) : null), [w]);
}

function blankEntry(type: EntryType, id: string, name: string): Entry {
  return { id, type, name, ...(LIFECYCLE[type] ? { status: DEFAULT_STATUS } : {}), body: '' } as Entry;
}

/** Where the user is: the place mouse back/forward and Alt+Left/Right return to. */
interface Place {
  /** The open world's folder; null is the library. */
  dir: string | null;
  view: View;
  id: string | null;
  preview: PdfKind | null;
  relMode: RelationMode | null;
  chapter: string | null;
}

const samePlace = (a: Place, b: Place) => a.dir === b.dir && (a.dir === null || (a.view === b.view && a.id === b.id && a.preview === b.preview && a.relMode === b.relMode && a.chapter === b.chapter));

/**
 * A back/forward stack of places: the library, and views and entries of any world opened from it. Every change
 * of place is pushed (dropping any forward places); going back or forward restores a place without pushing it
 * again (opening its world first, or closing the world for the library).
 * A restore renders later (it runs inside a View Transition), so until the target place shows up,
 * the places rendered on the way are not new history: two quick Backs must not cut off Forward.
 */
function useHistory(here: Place, restore: (p: Place) => void): { go: (step: -1 | 1) => void; cancel: () => void; canBack: boolean; canForward: boolean } {
  const h = useRef({ stack: [] as Place[], i: -1, target: null as Place | null });
  const [, setVersion] = useState(0);
  useLayoutEffect(() => {
    const s = h.current;
    if (s.target) {
      if (samePlace(s.target, here)) s.target = null;
      return;
    }
    if (s.stack[s.i] && samePlace(s.stack[s.i]!, here)) return;
    s.stack = [...s.stack.slice(0, s.i + 1), here].slice(-200);
    s.i = s.stack.length - 1;
    setVersion((v) => v + 1);
  }, [here.dir, here.view, here.id, here.preview, here.relMode, here.chapter]);
  const go = (step: -1 | 1) => {
    const s = h.current;
    const place = s.stack[s.i + step];
    if (!place) return;
    s.i += step;
    s.target = samePlace(place, here) ? null : place;
    setVersion((v) => v + 1);
    restore(place);
  };
  const s = h.current;
  // A place that could not be restored (its world failed to open): stop waiting for it.
  return { go, cancel: () => { s.target = null; }, canBack: s.i > 0, canForward: s.i < s.stack.length - 1 };
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
  const [sidebarW, setSidebarW] = useSidebarWidth();
  const [preview, setPreview] = useState<PdfKind | null>(null);
  const [relMode, setRelMode] = useState<RelationMode | null>(null);
  const [settings, setSettings] = useState(false);
  const [creating, setCreating] = useState<EntryType | null>(null);
  const [chapterFile, setChapterFile] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ start: number; end: number; n: number } | undefined>(undefined);
  const history = useHistory({ dir: world ? dir : null, view, id: selectedId, preview, relMode, chapter: chapterFile }, (loc) => {
    const apply = () => transition(() => {
      setView(loc.view);
      setChapterFile(loc.chapter);
      setReveal(undefined);
      setSelectedId(loc.id);
      setPreview(loc.preview);
      setRelMode(loc.relMode);
    });
    if (loc.dir === dirRef.current) return apply();
    if (!loc.dir) return void closeWorld().then(apply);
    void open(loc.dir).then((w) => (w ? apply() : history.cancel()));
  });
  const toasts = useToasts();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<string, () => Promise<void>>());

  const open = useCallback(async (d: string) => {
    try {
      const w = parseWorld(await window.lore.readWorld(d));
      if (dirRef.current !== d) {
        // Another world starts on its home page (history keeps the way back to the library).
        setView('home');
        setPreview(null);
        dirRef.current = d;
      }
      forgetImages();
      setDir(d);
      setWorld(w);
      setLoadError(null);
      setSelectedId((cur) => (cur && w.entries.some((e) => e.id === cur) ? cur : (w.entries[0]?.id ?? null)));
      setChapterFile((cur) => (cur && w.story?.some((c) => c.file === cur) ? cur : (w.story?.[0]?.file ?? null)));
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
      // Every popup fits the window at every size: its box inside the window, its main control visible and the
      // topmost thing at its centre (clickable) without scrolling anything. The window goes back to its size after.
      const fitted = new Set<string>();
      const popupFit = async (what: string, boxSel: string, mainSel: string) => {
        if (fitted.has(what)) return;
        fitted.add(what);
        const was = [innerWidth, innerHeight] as const;
        // A hidden window runs no rendering steps, so it would get no resize events: show it while measuring.
        const hidden = document.visibilityState === 'hidden';
        if (hidden) await window.lore.smokeShow(true);
        const bad: string[] = [];
        const inView = (r: DOMRect) => r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
        const px = (r: DOMRect) => `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
        for (const [width, height] of [[1024, 640], [1280, 720], [1920, 1080], [2560, 1440]] as const) {
          await window.lore.smokeResize(width, height);
          await until(() => innerWidth === width && innerHeight === height, 2000);
          // Under xvfb the resize event can fire before the new size is in place, and no frame follows it: send the
          // event a real window sends once it has its size, so the popups place themselves for it.
          window.dispatchEvent(new Event('resize'));
          await tick(250);
          for (const an of document.getAnimations()) if (an.effect instanceof KeyframeEffect && an.effect.target instanceof Element && an.effect.target.closest(boxSel) && Number.isFinite(an.effect.getComputedTiming().endTime)) an.finish();
          const box = $(boxSel);
          const main = $(mainSel);
          if (!box || !main) { bad.push(`${width}x${height}: ${box ? mainSel : boxSel} is gone`); continue; }
          const r = box.getBoundingClientRect();
          const m = main.getBoundingClientRect();
          const hit = document.elementFromPoint(m.left + m.width / 2, m.top + m.height / 2);
          if (!inView(r)) bad.push(`${width}x${height}: the popup (${px(r)}) is not inside the window`);
          if (!inView(m) || m.width < 4 || m.height < 4 || !hit || !(main.contains(hit) || hit.contains(main))) bad.push(`${width}x${height}: ${mainSel} (${px(m)}) is not visible and clickable (${hit?.className || hit?.tagName})`);
          if ((document.scrollingElement?.scrollTop ?? 0) !== 0) bad.push(`${width}x${height}: the page scrolled`);
        }
        await window.lore.smokeResize(was[0], was[1]);
        await until(() => innerWidth === was[0] && innerHeight === was[1], 2000);
        window.dispatchEvent(new Event('resize'));
        await tick(200);
        if (hidden) await window.lore.smokeShow(false);
        dom['popupsFitted'] = fitted.size;
        expect(bad.length === 0, `${what} fits at 1024x640, 1280x720, 1920x1080 and 2560x1440: ${bad.join('; ')}`);
      };
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
          dom['relationSelects'] = count('[data-field^="relations"] button.select[role=combobox]');
          expect(count('select') === 0 && count('.select .select-chevron') >= dom['relationSelects']!, 'dropdowns are the custom Select, with a chevron');
          // Status: exactly one is always selected; clicking the selected one keeps it.
          expect(count('.lifecycle [aria-checked="true"]') === 1, 'one status selected');
          $('.lifecycle [aria-checked="true"]')?.click();
          await tick();
          expect(count('.lifecycle [aria-checked="true"]') === 1, 'status cannot be cleared');
          dom['raceField'] = count('[data-field="race"] input');
          expect(dom['raceField'] === 1, 'race field');
          // Panes fill the window at a few sizes.
          for (const [width, height] of [[1920, 1080], [1280, 720], [2560, 1440]] as const) {
            await window.lore.smokeResize(width, height);
            for (let i = 0; i < 40 && (window.innerWidth !== width || window.innerHeight !== height); i++) await tick(50);
            await tick(100);
            const bad = paneFit();
            if (window.innerWidth !== width || window.innerHeight !== height) bad.push(`window is ${window.innerWidth}x${window.innerHeight}`);
            expect(bad.length === 0, `layout at ${width}x${height}: ${bad.join('; ')}`);
            dom[`fit${width}x${height}`] = bad.length === 0 ? 1 : 0;
            // The writing pane stays the widest one; the sidebar is roomy but never crowds it.
            const side = $('.sidebar')!.getBoundingClientRect().width, mid = $('.main')!.getBoundingClientRect().width;
            expect(side >= 220 && side <= 460 && mid > side * 1.5, `pane widths at ${width}x${height}: sidebar ${Math.round(side)}, main ${Math.round(mid)}`);
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
          expect(count('.family-tree .node .portrait') === dom['treeNodes'], 'family tree cards have portraits');
          const treeT = () => $('.family-tree > g')?.getAttribute('transform') ?? '';
          const fitT = treeT();
          $<HTMLButtonElement>('.zoom-frame .zoom-in')?.click();
          expect(await until(() => treeT() !== fitT), 'family tree zooms in');
          $<HTMLButtonElement>('.zoom-frame .zoom-fit')?.click();
          expect(await until(() => treeT() === fitT), 'family tree Fit restores the view');
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
        // No command palette: Ctrl+K does nothing, and every action it had is a visible control.
        const key = (target: EventTarget, k: string, init: KeyboardEventInit = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
        const typeInto = (el: HTMLInputElement, text: string) => { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); };
        // Custom dropdowns (components/select.tsx): click the combobox, then the option in the popover on <body>.
        const choose = async (button: HTMLElement, value: string) => {
          button.click();
          const opt = await until(() => !!document.querySelector(`.select-popover .select-option[data-value="${CSS.escape(value)}"]`));
          document.querySelector<HTMLElement>(`.select-popover .select-option[data-value="${CSS.escape(value)}"]`)?.click();
          return opt && (await until(() => button.dataset['value'] === value && !$('.select-popover')));
        };
        key(window, 'k', { ctrlKey: true });
        await tick();
        const allTitles = [...document.querySelectorAll<HTMLElement>('[title]')].map((el) => el.title).join(' ');
        expect(!$('.palette') && !$('[aria-label="Command palette"]') && !/Ctrl\+K/.test(`${document.body.textContent} ${allTitles}`), 'Ctrl+K opens nothing and nothing mentions it');
        expect($<HTMLInputElement>('#search')?.placeholder === 'Search...', 'the sidebar search says "Search..."');
        {
          const tabLabels = [...document.querySelectorAll<HTMLElement>('.topbar .tabs button')].map((b) => b.textContent?.trim());
          const top = (t: string) => [...document.querySelectorAll<HTMLButtonElement>('.topbar button')].some((b) => (b.textContent ?? '').includes(t) || b.getAttribute('aria-label') === t);
          const gear = $<HTMLButtonElement>('.topbar .top-actions > .top-settings');
          const back = $<HTMLButtonElement>('.topbar .world-title > .nav-back'), unit = $<HTMLButtonElement>('.topbar .world-title .world-home-btn');
          expect(JSON.stringify(tabLabels) === JSON.stringify(['Home', 'Editor', 'Timeline', 'Relationships', 'Story']) && !!gear?.querySelector('svg') && gear.getAttribute('aria-label') === 'World settings' && !gear.textContent?.trim(),
            `the view tabs, and World settings as a gear in the top-right actions: ${JSON.stringify(tabLabels)}`);
          expect(!$('.topbar .view-nav') && count('.topbar [aria-label="World settings"]') === 1 && !top('About and credits'), 'one World settings button in the top bar, no laurel About button');
          expect(!!back && !!unit && back.getBoundingClientRect().right <= unit.getBoundingClientRect().left + 1 && back.getBoundingClientRect().left < 40 && !!unit.querySelector('.mini-cover') && unit.querySelector('.world-name')?.textContent === w.manifest.name,
            'Back sits at the far top-left, then the mini cover and the title as one button');
          expect(top('World Codex') && top('Story Book'), 'exports are in the top bar');
          {
            // The cover + title unit opens world home; Alt+Left returns to where we were. The Back button itself always
            // goes to the library (checked with the library below).
            const pressed = () => $('.topbar .tabs button[aria-pressed="true"]')?.textContent?.trim();
            const was = pressed();
            unit!.click();
            expect(await until(() => !!$('.home-hero') && unit!.getAttribute('aria-current') === 'page'), 'the top-left cover and title open world home');
            expect(!back!.disabled && back!.getAttribute('aria-label') === 'Back to the library', 'the Back button is the way back to the library');
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }));
            expect(await until(() => !$('.home-hero') && pressed() === was), `Alt+Left returns to ${was}`);
            const cover = unit!.querySelector<HTMLElement>('.mini-cover')!;
            expect(getComputedStyle(cover).transformOrigin.startsWith('0px') && !!unit!.querySelector('.mini-page'), 'the mini cover is hinged on its left edge over a page');
          }
          gear!.click();
          expect(await until(() => !!$('.world-settings')), 'the top-bar World settings button opens World settings');
          await popupFit('World settings (eras)', '.world-settings', '.ws-save');
          key(window, 'Escape');
          expect(await until(() => !$('.world-settings')), 'Escape closes World settings');
        }
        const target = [...w.entries].reverse().find((e) => w.entries.filter((o) => o.name.startsWith(e.name)).length === 1)!;
        typeInto($<HTMLInputElement>('#search')!, target.name);
        await until(() => !!$(`.search-results [data-entry-id="${CSS.escape(target.id)}"]`));
        $<HTMLElement>(`.search-results [data-entry-id="${CSS.escape(target.id)}"]`)!.click();
        expect(await until(() => !!$(`[data-entry-id="${CSS.escape(target.id)}"][aria-current="page"]`)), `the sidebar search opens ${target.name}`);
        typeInto($<HTMLInputElement>('#search')!, '');
        [...document.querySelectorAll<HTMLButtonElement>('.topbar .tabs button')].find((b) => b.textContent?.trim() === 'Editor')!.click();
        expect(await until(() => !!$(`.editor`) && $('.editor h2, .editor input')?.closest('.editor') !== null), 'the Editor tab shows the selected entry');
        $<HTMLButtonElement>('.topbar .top-settings')!.click();
        {
          // World settings: the default era comes first, before the list of eras; About lives in the library only.
          expect(await until(() => !!$('.world-settings')), 'the top-bar gear opens World settings');
          const body = $('.world-settings .dialog-body')!;
          expect(!$('.world-settings .ws-about') && body.firstElementChild?.classList.contains('ws-default-row') === true && !!body.querySelector('.ws-default-row #ws-default'),
            'World settings starts with the default era and has no About button');
          key(window, 'Escape');
          expect(await until(() => !$('.world-settings')), 'Escape closes World settings');
        }
        {
          // The editor fills the centre pane (no max width).
          await until(() => !!$('.editor'));
          const main = $('.main')!;
          const pad = parseFloat(getComputedStyle(main).paddingLeft) + parseFloat(getComputedStyle(main).paddingRight);
          const ew = $('.editor')?.getBoundingClientRect().width ?? 0;
          expect(ew >= main.clientWidth - pad - 2, `the editor fills the centre pane (${Math.round(ew)} of ${Math.round(main.clientWidth - pad)}px)`);
        }
        // Motion: a tab click goes through a View Transition of the main pane and still lands on the view.
        {
          // The ambient aura sits behind every world view, pauses while the window is hidden and stops under reduced motion.
          const aura = $('.app > .aura.is-calm');
          expect(!!aura && count('.app > .aura .mote') > 0 && getComputedStyle(aura).position === 'fixed' && Number(getComputedStyle(aura).zIndex) < 0 && getComputedStyle(aura).pointerEvents === 'none', 'the calm aura is behind the world views');
          const mote = $('.app > .aura .mote')!;
          expect(document.documentElement.classList.contains('is-hidden') === document.hidden && (getComputedStyle(mote).animationPlayState === 'paused') === document.hidden, `motes pause while the window is hidden (hidden: ${document.hidden})`);
          const css = [...document.styleSheets].flatMap((sh) => [...sh.cssRules]).filter((r) => r instanceof CSSMediaRule && r.conditionText.includes('prefers-reduced-motion')).map((r) => r.cssText).join(' ');
          expect(/\.mote\s*\{\s*display: none/.test(css), 'no motes under reduced motion');
        }
        dom['viewTransitions'] = typeof document.startViewTransition === 'function' && getComputedStyle($('.main')!).viewTransitionName === 'main-pane' ? 1 : 0;
        expect(dom['viewTransitions'] === 1, 'View Transitions available for the main pane');
        $<HTMLButtonElement>('.tabs button:nth-child(3)')!.click();
        await until(() => !!$('.tl-scroll'));
        await tick(300);
        expect(!!$('.tl-scroll') && $('.tabs button:nth-child(3)')?.getAttribute('aria-pressed') === 'true', 'Timeline tab opens the timeline');
        dom['timelineMarks'] = count('.tl-mark');
        // Timeline zoom (d3-zoom): Ctrl+wheel zooms, a drag pans along time, Fit brings it back.
        {
          const scale = () => $('.tl-scale')?.textContent ?? '';
          const firstLeft = () => $('.tl-mark')?.style.left ?? '';
          const tl = $('.tl-scroll')!;
          const r = tl.getBoundingClientRect();
          const before = scale();
          tl.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, ctrlKey: true, clientX: r.left + r.width * 0.7, clientY: r.top + 80, bubbles: true, cancelable: true, view: window }));
          expect(await until(() => scale() !== before), 'Ctrl+wheel zooms the timeline');
          const left = firstLeft();
          const track = $('.tl-lane .tl-track')!.getBoundingClientRect();
          const at = { clientX: track.left + 40, clientY: track.top + 10, bubbles: true, view: window };
          $('.tl-lane .tl-track')!.dispatchEvent(new MouseEvent('mousedown', { ...at, button: 0 }));
          window.dispatchEvent(new MouseEvent('mousemove', { ...at, clientX: at.clientX + 120 }));
          window.dispatchEvent(new MouseEvent('mouseup', { ...at, clientX: at.clientX + 120 }));
          expect(await until(() => firstLeft() !== left), 'dragging pans the timeline');
          $<HTMLButtonElement>('.tl-fit')!.click();
          expect(await until(() => scale() === before), 'timeline Fit restores the scale');
          expect(count('.tl-mark') === dom['timelineMarks'], 'every lane still drawn after zooming');
        }
        {
          // The timeline fills the pane down to the bottom, at each window size.
          for (const [width, height] of [[1280, 720], [2560, 1440], [1920, 1080]] as const) {
            await window.lore.smokeResize(width, height);
            for (let i = 0; i < 40 && (window.innerWidth !== width || window.innerHeight !== height); i++) await tick(50);
            await tick(150);
            const gap = $('.main')!.getBoundingClientRect().bottom - $('.tl-scroll')!.getBoundingClientRect().bottom;
            expect(gap >= 0 && gap <= 32, `timeline at ${width}x${height} reaches the bottom of the pane (gap ${Math.round(gap)}px)`);
          }
        }
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
          expect(count('.preview .sheet-cover.has-art .world-cover .cover-art') === 1, `${k} preview starts with the world's cover art`);
          expect(!!$('.preview .preview-body > .aura.is-calm.is-local .mote'), `${k} preview has the calm aura behind the pages`);
          await popupFit('export preview', '.preview', '.preview-actions .primary, .preview .primary');
          expect(emojiIn($('.preview-options')).length === 0 && emojiIn($('.preview-head')).length === 0, `${k} preview: emoji in UI text ${emojiIn($('.preview'))}`);
          expect(($('#preview-title')?.textContent ?? '').includes(k === 'codex' ? 'World Codex' : 'Story Book'), `${k} preview title`);
          if (k === 'book') {
            // Print book: trim-shaped pages, the cover art then front matter, chapter openers with a drop cap.
            const bookOnDisk = async (ok: (ws: World) => boolean) => { for (let i = 0; i < 60; i++) { if (ok(parseWorld(await window.lore.readWorld(dirRef.current!)))) return true; await tick(50); } return false; };
            expect(count('.preview .sheet.is-print.trim-6x9') > 1 && !!$('.preview .sheet-cover.is-print.trim-6x9'), 'the book preview uses 6x9 print pages, cover included');
            expect(['title', 'copyright'].every((r) => count(`.preview .doc-front-${r}`) === 1) && count('.preview .doc-front-half-title') === 0, 'title and copyright pages, no half-title');
            // The cover keeps its page shape (it used to shrink to a strip) and carries the book title.
            const cv = $('.preview .sheet-cover.has-art')!.getBoundingClientRect();
            expect(cv.height > cv.width * 1.3 && !!$('.preview .sheet-cover-text .sheet-title'), `the cover sheet keeps its page shape and shows the title (${Math.round(cv.width)}x${Math.round(cv.height)})`);
            expect(count('.preview .doc-opener') > 0 && count('.preview .doc-dropcap') > 0, 'chapter openers with a drop cap');
            expect(!!$('.preview .save-docx'), 'Save Word button');
            const ded = $<HTMLInputElement>('.preview textarea[name="book-dedication"]')!;
            typeInto(ded, 'For the caravans.');
            ded.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); // Preact listens for onBlur as focusout
            expect(await until(() => ($('.preview .doc-front-dedication')?.textContent ?? '') === 'For the caravans.'), 'the dedication page appears');
            expect(await bookOnDisk((ws) => ws.manifest.book?.dedication === 'For the caravans.'), `the dedication is saved in world.json`);
            const trimSel = $<HTMLButtonElement>('.preview .trim-select')!;
            // Keyboard: Down opens the list, End and Up move, Escape closes it without choosing.
            trimSel.focus();
            key(trimSel, 'ArrowDown');
            expect(await until(() => trimSel.getAttribute('aria-expanded') === 'true' && !!$('.select-popover .select-option.is-active')), 'Down opens a dropdown with the current option active');
            const pop = $('.select-popover')!.getBoundingClientRect();
            expect(pop.top >= 0 && pop.bottom <= innerHeight && pop.left >= 0 && pop.right <= innerWidth && Number(getComputedStyle($('.select-popover')!).zIndex) > 50, `the dropdown list sits in the window above the dialog (${Math.round(pop.top)}..${Math.round(pop.bottom)} of ${innerHeight})`);
            dom['trimOptions'] = count('.select-popover .select-option');
            key(trimSel, 'End');
            await tick();
            expect($('.select-popover .select-option.is-active') === [...document.querySelectorAll('.select-popover .select-option')].pop(), 'End moves to the last option');
            key(trimSel, 'Escape');
            expect(await until(() => !$('.select-popover')) && trimSel.getAttribute('aria-expanded') === 'false', 'Escape closes the dropdown');
            expect(!!$('.preview'), 'the preview stays open after Escape in a dropdown');
            expect(await choose(trimSel, 'a5'), 'clicking an option chooses it');
            expect(await until(() => count('.preview .sheet.trim-a5') > 0), 'A5 trim reshapes the pages');
            expect(await bookOnDisk((ws) => ws.manifest.book?.trim === 'a5' && ws.manifest.book?.author === w.manifest.book?.author), 'the trim is saved and the other book settings kept');
            dom['bookFrontPages'] = count('.preview .doc-front');
          }
          setPreview(null);
          await tick();
        }
        // Story: Ctrl+4 opens the manuscript; it fills the main pane and scrolls inside it.
        await window.lore.smokeResize(1920, 1080);
        await tick(150);
        key(window, '4', { ctrlKey: true });
        expect(await until(() => !!$('#story-text')), 'Ctrl+4 opens the story');
        expect($('.tabs button:nth-child(5)')?.getAttribute('aria-pressed') === 'true', 'Story tab is selected');
        dom['chapters'] = count('.story-chapters .chapter-link');
        expect(dom['chapters'] === (w.story?.length ?? 0) && dom['chapters'] > 0, 'chapter list shows the sample chapter');
        expect(paneFit().length === 0, `story layout: ${paneFit().join('; ')}`);
        const storyBox = () => ({ area: $('#story-text')!.getBoundingClientRect(), main: $('.main')!.getBoundingClientRect() });
        expect(storyBox().area.height > storyBox().main.height * 0.7 && getComputedStyle($('#story-text')!).overflowY === 'auto', 'the story editor fills the pane and scrolls on its own');
        dom['storyMentions'] = count('.story .prose-mirror mark.mention');
        expect(dom['storyMentions'] > 0, 'names in the story are linked');
        dom['storyProposals'] = (await until(() => count('.proposal') > 0)) ? count('.proposal') : 0;
        expect(dom['storyProposals'] > 0, 'the sample chapter has proposals');
        expect(count('.exists-link') > 0 && ($('.exists-link')?.textContent ?? '').startsWith('Already exists: '), 'existing entries are shown as already existing');
        expect(count('.story .prose-mirror .warn-line') > 0, 'story warnings are underlined in the sample chapter');
        expect(emojiIn($('.story')).length === 0 && emojiIn($('.story-chapters')).length === 0, `emoji in the story view: ${emojiIn($('.story'))}`);
        // A new chapter: type a sentence and a contradicting one.
        $<HTMLButtonElement>('.story-chapters .pane-head button')!.click();
        expect(await until(() => count('.story-chapters .chapter-link') === dom['chapters']! + 1 && ($<HTMLTextAreaElement>('#story-text')?.value ?? 'x') === ''), 'New chapter adds an empty chapter');
        const area = $<HTMLTextAreaElement>('#story-text')!;
        const text = 'King Camel was born in 1998. Later, King Camel fought at the Battle of the Dunes in 1990.';
        area.value = text;
        area.dispatchEvent(new Event('input', { bubbles: true }));
        const camel = () => $('.proposal[data-key="create:character:camel"]');
        expect(await until(() => !!camel()), 'typing "King Camel was born in 1998." proposes a character');
        expect((camel()?.textContent ?? '').includes('1998') && (camel()?.textContent ?? '').includes('King'), 'the proposal has the birth year and title');
        dom['storyWarningMarks'] = (await until(() => count('.story .prose-mirror .warn-line') > 0)) ? count('.story .prose-mirror .warn-line') : 0;
        expect(dom['storyWarningMarks'] > 0, 'the contradicting sentence is underlined');
        const storyWarning = () => [...document.querySelectorAll<HTMLElement>('.warnings-panel .warning')].find((li) => li.textContent?.includes('Camel can') && li.textContent.includes('1990'));
        expect(await until(() => !!storyWarning()), 'the warnings panel lists the story warning');
        // Ignore persists to story-ignored.json.
        const dunes = $('.proposal[data-key="create:place:dunes"]');
        expect(!!dunes, 'the battle place is proposed');
        [...(dunes?.querySelectorAll<HTMLButtonElement>('.proposal-actions button') ?? [])].find((b) => b.textContent?.includes('Ignore'))?.click();
        expect(await until(() => !$('.proposal[data-key="create:place:dunes"]')), 'Ignore hides the proposal');
        key(window, 's', { ctrlKey: true });
        expect(await until(() => $('.save')?.classList.contains('save-saved') ?? false), 'saved');
        const reread = parseWorld(await window.lore.readWorld(dirRef.current!));
        expect(!!reread.storyIgnored?.some((i) => i.key === 'create:place:dunes'), 'Ignore is saved in story-ignored.json');
        expect(!!reread.story?.some((c) => c.body.trim() === text), 'the chapter autosaves to story/');
        expect(!reread.entries.some((e) => e.name === 'Camel'), 'nothing is created before a click');
        // Add creates the entry; afterwards the name shows as already existing.
        [...(camel()?.querySelectorAll<HTMLButtonElement>('.proposal-actions button') ?? [])].find((b) => b.textContent?.includes('Add'))?.click();
        expect(await until(() => !camel() && [...document.querySelectorAll('.exists-link')].some((b) => b.textContent === 'Already exists: Camel (character)')), 'Add creates Camel, which then shows as "Already exists: Camel (character)"');
        key(window, 's', { ctrlKey: true });
        await until(() => $('.save')?.classList.contains('save-saved') ?? false);
        const added = parseWorld(await window.lore.readWorld(dirRef.current!)).entries.find((e) => e.name === 'Camel');
        expect(added?.type === 'character' && (added as { born?: string }).born === '1998' && added.details?.['title'] === 'King', 'Add writes Camel (born 1998, title King) to disk');
        dom['storyAdded'] = added ? 1 : 0;
        // Jump: Go to the warning's sentence selects it in the editor.
        await until(() => !!storyWarning());
        [...(storyWarning()?.querySelectorAll<HTMLButtonElement>('button.link') ?? [])].find((b) => b.textContent?.startsWith('Go to Story/'))?.click();
        const sentence = text.indexOf('Later');
        expect(await until(() => document.activeElement?.id === 'story-text' && ($<HTMLTextAreaElement>('#story-text')?.selectionStart ?? -1) === sentence), 'Go to selects the sentence in the story');
        // Add to world from picked text: a selection chip with the guessed type, the right-click menu, Ctrl+Shift+A.
        {
          const pickText = `${text} Ostra rode to Zarnak, past the Dunes.`;
          const ta = () => $<HTMLTextAreaElement>('#story-text')!;
          ta().value = pickText;
          ta().dispatchEvent(new Event('input', { bubbles: true }));
          await until(() => ta().value === pickText);
          const select = async (word: string, how: 'mouse' | 'menu' | 'quick') => {
            const at = pickText.lastIndexOf(word);
            const r = ta().getBoundingClientRect();
            ta().focus();
            if (how === 'menu') {
              ta().setSelectionRange(at + 1, at + 1);
              ta().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 40 }));
            } else {
              ta().setSelectionRange(at, at + word.length);
              if (how === 'mouse') ta().dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: r.left + 60, clientY: r.top + 30 }));
              else key(ta(), 'A', { ctrlKey: true, shiftKey: true });
            }
            await tick(60);
          };
          await select('Zarnak', 'mouse');
          expect(await until(() => /Add “Zarnak” as Place/.test($('.pick-menu .pick-add')?.textContent ?? '')), `selecting a name offers to add it with the type guessed: ${$('.pick-menu')?.textContent}`);
          const menuBox = $('.pick-menu')!.getBoundingClientRect();
          expect(menuBox.right <= innerWidth && menuBox.bottom <= innerHeight && menuBox.left >= 0 && menuBox.top >= 0, 'the chip stays inside the window');
          await popupFit('story add chip', '.pick-menu', '.pick-menu .pick-add, .pick-menu .pick-open');
          $<HTMLButtonElement>('.pick-menu .pick-more')!.click();
          const items = () => [...document.querySelectorAll<HTMLElement>('.pick-menu [role="menuitem"]')].map((b) => (b.textContent ?? '').trim());
          expect(await until(() => !!$('.pick-menu.is-full') && document.activeElement?.getAttribute('role') === 'menuitem'), 'More opens the menu with the first item focused');
          await popupFit('story add menu', '.pick-menu.is-full', '.pick-menu .pick-search');
          const want = ['Character', 'Place', 'Item', 'Faction', 'Event', 'Note'].map((t) => `Add as ${t}`);
          expect(want.every((w) => items().some((i) => i.startsWith(w))) && items().some((i) => i === 'Link to existing…') && items().some((i) => i === 'Search the world for “Zarnak”'), `the menu has every type, Link to existing and Search: ${items().join(' | ')}`);
          expect(!!$('.pick-menu .pick-item.is-guess[data-type="place"]'), 'the guess is marked in the menu');
          const first = document.activeElement;
          key(document.activeElement!, 'ArrowDown');
          expect(document.activeElement !== first && document.activeElement?.getAttribute('role') === 'menuitem', 'arrow keys move through the menu');
          key(window, 'Escape');
          expect(await until(() => !$('.pick-menu')), 'Esc closes the menu');
          // Right-click on a word picks it; an existing entry offers Open.
          await select('Camel', 'menu');
          expect(await until(() => !!$('.pick-menu.is-full') && /Open (King )?Camel/.test($('.pick-menu .pick-open')?.textContent ?? '')), `right-click on an existing name shows the menu with Open: ${items().join(' | ')}`);
          await popupFit('context menu', '.pick-menu.is-full', '.pick-menu .pick-open');
          key(window, 'Escape');
          await until(() => !$('.pick-menu'));
          // The chip's Add opens a proposal form with the type picked; adding it writes the entry.
          await select('Zarnak', 'mouse');
          await until(() => !!$('.pick-menu .pick-add'));
          $<HTMLButtonElement>('.pick-menu .pick-add')!.click();
          expect(await until(() => !!$('.proposal.is-picked form') && !$('.pick-menu')), 'Add shows the proposal with its form open');
          expect(($('.proposal.is-picked .select')?.textContent ?? '').includes('Place') && $<HTMLInputElement>('.proposal.is-picked input')?.value === 'Zarnak', 'the proposal has the guessed type and the name');
          $<HTMLFormElement>('.proposal.is-picked form')!.requestSubmit();
          expect(await until(() => !$('.proposal.is-picked')), 'adding closes the picked proposal');
          // Ctrl+Shift+A adds the selection straight away.
          await select('Ostra', 'quick');
          key(window, 's', { ctrlKey: true });
          await until(() => $('.save')?.classList.contains('save-saved') ?? false);
          const picked = parseWorld(await window.lore.readWorld(dirRef.current!)).entries;
          expect(picked.some((e) => e.name === 'Zarnak' && e.type === 'place') && picked.some((e) => e.name === 'Ostra' && e.type === 'character'), 'the chip adds Zarnak (place) and Ctrl+Shift+A adds Ostra (character)');
          // Link to existing opens the merge form; Search jumps to the search results.
          await select('Dunes', 'mouse');
          await until(() => !!$('.pick-menu .pick-more'));
          $<HTMLButtonElement>('.pick-menu .pick-more')!.click();
          await until(() => !!$('.pick-menu .pick-link'));
          $<HTMLButtonElement>('.pick-menu .pick-link')!.click();
          expect(await until(() => !!$('.proposal.is-picked form') && /Merge “(The )?Dunes” into/.test($('.proposal.is-picked')?.textContent ?? '')), 'Link to existing opens the merge form');
          [...document.querySelectorAll<HTMLButtonElement>('.proposal.is-picked button')].find((b) => b.textContent === 'Cancel')!.click();
          expect(await until(() => !$('.proposal.is-picked')), 'Cancel drops the picked proposal');
          await select('Dunes', 'menu');
          await until(() => !!$('.pick-menu .pick-search'));
          $<HTMLButtonElement>('.pick-menu .pick-search')!.click();
          expect(await until(() => !!$('.search-results') && $<HTMLInputElement>('.sidebar input[type="search"], .sidebar .search input')?.value === 'Dunes'), 'Search the world fills the search box');
          setQuery('');
          setView('story');
          await until(() => !!$('#story-text'));
          await tick(100);
        }
        // Narrow window: the proposals stack below the editor and every pane still fits.
        await window.lore.smokeResize(1024, 640);
        for (let i = 0; i < 40 && window.innerWidth !== 1024; i++) await tick(50);
        await tick(150);
        expect(paneFit().length === 0 && $('.proposals')!.getBoundingClientRect().top > $('#story-text')!.getBoundingClientRect().top, `narrow story layout: ${paneFit().join('; ')}`);
        await window.lore.smokeResize(1920, 1080);
        await tick(150);
        setView('editor');
        await tick();
        const hero = leyla!;
        const relCount = (ws: World) => ws.entries.reduce((n, e) => n + (e.relations?.length ?? 0), 0);
        const fromDisk = async () => parseWorld(await window.lore.readWorld(dirRef.current!));
        // Top bar: no search box, folder path, Reload or Close; the world cover leads back to the library.
        const topText = $('.topbar')!.textContent ?? '';
        expect(!$('.world-path') && !/Reload|Close world/.test(topText) && !!$('.world-home-btn .mini-cover'), 'top bar has only Back, the cover and title, tabs, exports, save state and settings');
        // "Saved" fades out instead of staying on screen.
        expect(await until(() => !$('.save.is-shown'), 4000), 'the saved notice fades out');
        // Sidebar: the separator resizes it by keyboard, clamps at the minimum and remembers the width.
        const sep = $('.pane-resizer')!;
        const before = $('.sidebar')!.getBoundingClientRect().width;
        key(sep, 'ArrowRight');
        expect(await until(() => Math.round($('.sidebar')!.getBoundingClientRect().width) === Math.min(Math.round(before) + 16, sidebarMax())), `ArrowRight widens the sidebar (${Math.round(before)} -> ${Math.round($('.sidebar')!.getBoundingClientRect().width)})`);
        for (let i = 0; i < 20; i++) { key(sep, 'ArrowLeft'); await tick(20); }
        expect(await until(() => Math.round($('.sidebar')!.getBoundingClientRect().width) === 220 && localStorage.getItem('lore-forge.sidebarWidth') === '220'), 'the sidebar stops at its minimum and the width is remembered');
        sep.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await tick();
        // Warnings: one section per severity, each with a count and a toggle that is remembered.
        const sections = [...document.querySelectorAll<HTMLElement>('.warning-section')];
        dom['warningSections'] = sections.length;
        expect(sections.length > 0 && sections.every((x) => /\(\d+\)/.test(x.querySelector('.section-toggle')?.textContent ?? '')), 'warning sections show a count');
        const toggle = sections[0]!.querySelector<HTMLButtonElement>('.section-toggle')!;
        const wasOpen = toggle.getAttribute('aria-expanded') === 'true';
        toggle.click();
        expect(await until(() => toggle.getAttribute('aria-expanded') === String(!wasOpen)), 'a warning section collapses');
        toggle.click();
        await tick();
        // Editor: sections, chips for races, no Tags field; a detail field writes a top-level key.
        setSelectedId(hero.id);
        expect(await until(() => count('.editor-section') >= 3), 'the editor is split into sections');
        expect(!$('[data-field="tags"]'), 'no Tags field in the editor');
        const raceInput = () => $<HTMLInputElement>('[data-field="race"] input')!;
        const chips = () => count('[data-field="race"] .chip');
        const chips0 = chips();
        typeInto(raceInput(), 'Sky folk');
        await tick();
        key(raceInput(), 'Enter');
        expect(await until(() => chips() === chips0 + 1), 'Enter adds a race chip');
        $<HTMLButtonElement>('[data-field="race"] .chip:last-of-type .chip-remove')?.click();
        expect(await until(() => chips() === chips0), 'x removes the race chip');
        const job = $<HTMLInputElement>('[data-field="occupation"] input')!;
        typeInto(job, 'Caravan scout');
        key(window, 's', { ctrlKey: true });
        const onDisk = async (ok: (ws: World) => boolean) => { for (let i = 0; i < 60; i++) { if (ok(await fromDisk())) return true; await tick(50); } return false; };
        expect(await onDisk((ws) => ws.entries.find((e) => e.id === hero.id)?.details?.['occupation'] === 'Caravan scout'), 'the occupation is saved to the entry file');
        // Home: the paint button edits an entry's picture; Reset removes it again.
        setView('home');
        expect(await until(() => count('.tile-paint') > 0), 'home tiles have a picture button');
        const tile = $('.tile-cell')!;
        const tileId = tile.dataset['tileId'] ?? '';
        tile.querySelector<HTMLButtonElement>('.tile-paint')!.click();
        expect(await until(() => !!$('.picture-editor')), 'the picture editor opens');
        await popupFit('picture and icon picker', '.picture-editor', '.picture-editor .dialog-actions .primary');
        {
          // The icon grid has a search box: it filters by name and keyword, shows a count and an empty state.
          const q = $<HTMLInputElement>('.picture-editor .icon-search input')!;
          const all = document.querySelectorAll('.picture-editor .icon-choice').length;
          expect(!!q && q.placeholder === 'Search icons...', 'the icon picker has a search box');
          typeInto(q, 'sword');
          expect(await until(() => { const n = document.querySelectorAll('.picture-editor .icon-choice').length; return n > 0 && n < all; }), 'typing filters the icons');
          expect(/ of /.test($('.picture-editor .icon-count')?.textContent ?? ''), `the icon count shows the matches (${$('.picture-editor .icon-count')?.textContent})`);
          expect([...document.querySelectorAll('.picture-editor .icon-choice')].every((b) => /sword/.test(b.getAttribute('data-icon') ?? '')), 'every match is a sword');
          key(q, 'ArrowDown');
          expect(await until(() => document.activeElement?.classList.contains('icon-choice') ?? false), 'Down moves into the icon grid');
          key(document.activeElement!, 'ArrowUp');
          expect(await until(() => document.activeElement === q), 'Up from the first row returns to the search box');
          typeInto(q, 'zzqqxx');
          expect(await until(() => !!$('.picture-editor .icon-empty') && !$('.picture-editor .icon-choice')), 'no match shows the empty state');
          key(q, 'Escape');
          expect(await until(() => q.value === '' && document.querySelectorAll('.picture-editor .icon-choice').length === all && !!$('.picture-editor')), 'Escape clears the icon search and keeps the dialog open');
        }
        const choice = [...document.querySelectorAll<HTMLButtonElement>('.picture-editor .icon-choice')].find((b) => b.getAttribute('aria-pressed') !== 'true')!;
        const icon = choice.getAttribute('aria-label')!.replace(/ /g, '-');
        choice.click();
        await until(() => choice.getAttribute('aria-pressed') === 'true');
        // Colours come from the donut picker: open it, pick a theme swatch, then type a hex value with alpha.
        $<HTMLButtonElement>('.picture-editor .color-button')!.click();
        expect(await until(() => !!$('.color-popover .cp-square-knob') && !!$('.color-popover .cp-hue input') && !!$('.color-popover .cp-alpha input')), 'the colour picker opens with a colour square, a hue slider and an opacity slider');
        await popupFit('colour picker', '.color-popover', '.color-popover .cp-hex input');
        expect(!$('.cp-ring') && !$('.cp-wheel'), 'no hue ring');
        {
          // The picker is a popover on <body>: above the dialog and inside the window.
          const pop = $('.color-popover')!;
          const r = pop.getBoundingClientRect();
          expect(pop.parentElement === document.body && Number(getComputedStyle(pop).zIndex) > 50 && r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1, `the colour picker floats above everything, inside the window (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})`);
        }
        $<HTMLButtonElement>('.color-popover .swatch')!.click();
        await tick();
        const hexIn = $<HTMLInputElement>('.color-popover input[aria-label="Hex colour"]')!;
        typeInto(hexIn, '#336699cc');
        await tick();
        expect($<HTMLInputElement>('.color-popover input[aria-label="R (0 to 255)"]')?.value === '51' && $<HTMLInputElement>('.color-popover input[aria-label="Opacity percent"]')?.value === '80', 'a hex value fills the RGB and opacity fields');
        const hex0 = $<HTMLInputElement>('.color-popover input[aria-label="Hex colour"]')!.value;
        typeInto($<HTMLInputElement>('.color-popover .cp-hue input')!, '120');
        await tick();
        expect($<HTMLInputElement>('.color-popover input[aria-label="Hex colour"]')!.value !== hex0 && $<HTMLInputElement>('.color-popover .cp-hue input')!.value === '120', 'the hue slider turns the colour');
        key($('.color-popover')!, 'Escape');
        expect(await until(() => !$('.color-popover') && !!$('.picture-editor')), 'Escape closes only the colour picker');
        $<HTMLButtonElement>('.picture-editor .color-button')!.click();
        expect(await until(() => !!$('.color-popover')), 'the colour picker opens again');
        expect(![...document.querySelectorAll('.color-popover button')].some((b) => b.textContent?.trim() === 'Done'), 'the colour picker has no Done button');
        $('.picture-editor h2, .picture-editor')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        expect(await until(() => !$('.color-popover') && !!$('.picture-editor')), 'a click outside closes the colour picker');
        key(window, 's', { ctrlKey: true });
        expect(await onDisk((ws) => { const p = ws.entries.find((e) => e.id === tileId)?.picture; return p?.icon === icon && !!p.color; }), `picking an icon and colour writes picture to ${tileId}: ${JSON.stringify((await fromDisk()).entries.find((e) => e.id === tileId)?.picture)} want ${icon}`);
        [...document.querySelectorAll<HTMLButtonElement>('.picture-editor button')].find((b) => b.textContent?.includes('Reset'))!.click();
        await tick();
        [...document.querySelectorAll<HTMLButtonElement>('.picture-editor button')].find((b) => b.textContent === 'Done')!.click();
        expect(await until(() => !$('.picture-editor')), 'Done closes the picture editor');
        // Relationship web: drop an entry in, connect it, undo, connect again, then delete via the link list.
        setSelectedId(hero.id);
        setView('relations');
        setRelMode('web');
        expect(await until(() => !!$('.relations .graph-card')), 'relationship web opens');
        const nodes = () => count('.relations .react-flow__node');
        await until(() => nodes() > 0);
        const n0 = nodes();
        const stranger = (await fromDisk()).entries.find((e) => e.type === 'item' && !document.querySelector(`.react-flow__node[data-id="${CSS.escape(e.id)}"]`));
        if (stranger) {
          const dt = new DataTransfer();
          dt.setData('application/x-lore-entry', stranger.id);
          $('.relations .graph-card')!.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
          $('.relations .graph-card')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
          expect(await until(() => nodes() === n0 + 1), 'dropping an entry adds it to the web');
        }
        const r0 = relCount(await fromDisk());
        const connectOnce = async () => {
          const sel = $<HTMLButtonElement>('#connect-target')!;
          sel.click();
          await until(() => count('.select-popover .select-option') > 0);
          await popupFit('dropdown list', '.select-popover', '.select-popover .select-option');
          const first = $<HTMLElement>('.select-popover .select-option')!.dataset['value']!;
          sel.click();
          await until(() => !$('.select-popover'));
          expect(await choose(sel, first), 'the connect dropdown picks an entry');
          $<HTMLFormElement>('.connect-form')!.requestSubmit();
          expect(await until(() => !!$('.link-dialog #link-type')), 'Connect opens the relationship dialog');
          await popupFit('relationship dialog', '.link-dialog', '.link-dialog .link-save');
          $<HTMLButtonElement>('.link-dialog .link-save')!.click();
          await until(() => !$('.link-dialog'));
        };
        const relsOnDisk = (n: number) => onDisk((ws) => relCount(ws) === n);
        await connectOnce();
        expect(await relsOnDisk(r0 + 1), 'Connect writes the relationship to the entry file');
        key(document.body, 'z', { ctrlKey: true });
        expect(await relsOnDisk(r0), 'Ctrl+Z undoes the new link on disk');
        await connectOnce();
        expect(await relsOnDisk(r0 + 1), 'connected again');
        const edits = [...document.querySelectorAll<HTMLButtonElement>('.rel-edit')];
        dom['relEditButtons'] = edits.length;
        // The newest link is on the holder's list; delete through its dialog.
        const fresh = await fromDisk();
        const newest = fresh.entries.flatMap((e) => (e.relations ?? []).map((r) => ({ e, r }))).find(({ e, r }) => !w.entries.find((o) => o.id === e.id)?.relations?.some((x) => x.type === r.type && x.to === r.to));
        const otherName = fresh.entries.find((e) => e.id === (newest?.e.id === hero.id ? newest?.r.to : newest?.e.id))?.name ?? '';
        edits.find((b) => (b.getAttribute('aria-label') ?? '').includes(otherName))?.click();
        expect(await until(() => !!$('.link-dialog .link-delete')), 'the link list opens the edit dialog');
        $<HTMLButtonElement>('.link-dialog .link-delete')!.click();
        expect(await relsOnDisk(r0), 'Delete link removes it from the entry file');
        const hide = $<HTMLButtonElement>('.relations .node-hide-btn');
        if (hide) {
          const before = nodes();
          hide.click();
          expect(await until(() => nodes() === before - 1 && /view only/.test($('.graph-notice')?.textContent ?? '')), 'removing a card hides it from the view only, and says so');
        }
        // Family tree: links can be clicked to edit.
        setRelMode('tree');
        expect(await until(() => count('.relations .edge-hit') > 0), 'family tree lines are clickable');
        setView('editor');
        await tick();
        // Search: names first, then basic facts, summary, appearance and details, then the body, with the match marked.
        {
          const q = 'SAND';
          await flush();
          const want = searchEntries(await fromDisk(), q);
          setQuery(q);
          expect(await until(() => count('.search-results .entry-link') === want.length), `searching "${q}" lists ${want.length} entries`);
          const got = [...document.querySelectorAll<HTMLElement>('.search-results .entry-link')].map((b) => b.dataset['entryId']);
          expect(want.length > 2 && JSON.stringify(got) === JSON.stringify(want.map((h) => h.entry.id)), `results in tier order: ${want.map((h) => `${h.entry.name} (${h.field})`).join(', ')}`);
          expect(want[0]!.tier === 0 && want.some((h) => h.tier === 4) && !$('.search-results .entry-link')!.querySelector('.search-snippet'), 'a name match comes first; body text is searched too');
          const marks = [...document.querySelectorAll('.search-results mark.search-hit')];
          expect(marks.length === want.filter((h) => h.field !== 'Name').length && marks.every((m) => (m.textContent ?? '').toLowerCase() === 'sand'), `content matches show a snippet with the match marked (${marks.length})`);
          dom['searchHits'] = want.length;
          setQuery('');
          expect(await until(() => !$('.search-results') && count('.type-group') > 0), 'clearing the search shows the type groups again');
        }
        // World settings: the calendar's eras and months, from world home (the top bar is checked above).
        {
          setView('home');
          expect(await until(() => !!$('.home-settings')), 'world home has a World settings button');
          $<HTMLButtonElement>('.home-settings')!.click();
          expect(await until(() => !!$('.world-settings')), 'World settings opens from world home');
          const eras = () => [...document.querySelectorAll<HTMLElement>('.world-settings .ws-era:not(.ws-head)')];
          expect(eras().length === w.manifest.calendar.eras.length && count('.world-settings .ws-month') === (w.manifest.calendar.months ?? []).length, `it lists ${w.manifest.calendar.eras.length} eras and ${(w.manifest.calendar.months ?? []).length} months`);
          const firstEra = [...w.manifest.calendar.eras].sort((a, b) => a.start - b.start)[0]!;
          const next = [...w.manifest.calendar.eras].sort((a, b) => a.start - b.start)[1];
          const row = eras().find((r) => r.querySelector<HTMLInputElement>('.ws-code')!.value === firstEra.id)!;
          const save = () => $<HTMLButtonElement>('.world-settings .ws-save')!;
          if (next) {
            typeInto(row.querySelector<HTMLInputElement>('.ws-end')!, String(next.start + 5));
            expect(await until(() => /may not overlap/.test($('.ws-problems')?.textContent ?? '') && save().disabled), 'overlapping eras are refused');
            typeInto(row.querySelector<HTMLInputElement>('.ws-end')!, String(next.start - 1));
            expect(await until(() => !$('.ws-problems li') && !save().disabled), 'an era that ends before the next starts is fine');
          }
          typeInto(row.querySelector<HTMLInputElement>('.ws-code')!, `${firstEra.id}X`);
          const used = eraUsage(w).get(firstEra.id) ?? 0;
          if (used) expect(await until(() => /Keep its abbreviation/.test($('.ws-problems')?.textContent ?? '') && save().disabled), 'an era used by dates keeps its abbreviation');
          typeInto(row.querySelector<HTMLInputElement>('.ws-code')!, firstEra.id);
          [...row.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Add colour')?.click();
          expect(await until(() => !!row.querySelector('.color-button')), 'an era can get a colour');
          await tick();
          save().click();
          expect(await until(() => !$('.world-settings')), 'Save calendar closes World settings');
          const disk = (await fromDisk()).manifest.calendar;
          const saved = disk.eras.find((e) => e.id === firstEra.id);
          expect(!!saved?.color && (next ? saved.end === next.start - 1 : true) && JSON.stringify(disk.months) === JSON.stringify(w.manifest.calendar.months) && disk.approxYears === w.manifest.calendar.approxYears && disk.defaultEra === w.manifest.calendar.defaultEra,
            `the calendar is saved to world.json, other keys kept: ${JSON.stringify(disk.eras)}`);
          expect(!!$('.home-reload'), 'Reload from disk is on world home');
          dom['erasLinks'] = count('.eras-link');
          const link = $<HTMLButtonElement>('.eras-link');
          if (link) {
            link.click();
            expect(await until(() => !!$('.world-settings')), 'the "Known eras" hint opens World settings');
            $<HTMLButtonElement>('.world-settings .ws-cancel')!.click();
            expect(await until(() => !$('.world-settings')), 'Cancel closes World settings');
          }
          setView('editor');
          await tick();
        }
        // Back to the library through the top-left Back button (world home also has a Library link); history covers the
        // library too.
        const homeWorld = dirRef.current;
        $<HTMLButtonElement>('.world-home-btn')!.click();
        expect(await until(() => !!$('.home-library')), 'world home has a Library link');
        $<HTMLButtonElement>('.topbar .nav-back')!.click();
        expect(await until(() => count('.shelf .world-card .book-spine') > 1 && !!$('.shelf .world-count')), 'the library shows worlds as books');
        mouse(3);
        expect(await until(() => dirRef.current === homeWorld && !!$('.home-hero'), 5000), 'mouse back from the library reopens the world on its home page');
        await tick(150);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
        expect(await until(() => !!$('.shelf .world-count') && !dirRef.current, 5000), 'Alt+Right goes forward to the library again');
        dom['shelf'] = count('.shelf .world-card:not(.new-book)');
        // The library scene: colour clouds, light shafts with dust, runes, candles with embers, mist, bokeh; transform/opacity
        // only, parallax, still under reduced motion.
        {
          const anim = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].map((el) => getComputedStyle(el).animationName);
          expect(!!$('.start > .aura .light-shaft') && count('.light-shaft') >= 2 && count('.light-shaft .dust') > 5 && count('.scene .rune') > 5 && count('.scene .candle') === 2
            && count('.scene .ember') > 5 && count('.scene .bokeh') > 3 && count('.scene .nebula') > 0 && count('.scene .mist') > 0 && !!$('.scene .vignette'),
            'the library has light shafts with dust, runes, candles with embers, colour clouds, mist and bokeh under a vignette');
          expect(['.light-shaft', '.dust', '.rune', '.candle', '.ember', '.bokeh', '.nebula', '.mist'].every((sel) => anim(sel).every((n) => n && n !== 'none'))
            && getComputedStyle($('.ember')!, '::before').animationName === 'ember-sway', 'the scene animates');
          const sceneFrames = ['shaft-sway', 'dust-float', 'rune-drift', 'candle-flicker', 'candle-breathe', 'nebula-drift', 'ember-rise', 'ember-sway', 'mist-drift', 'bokeh-drift', 'mote-drift'];
          const frames = [...document.styleSheets].flatMap((sh) => [...sh.cssRules]).filter((r): r is CSSKeyframesRule => r instanceof CSSKeyframesRule && sceneFrames.includes(r.name));
          const props = new Set(frames.flatMap((f) => [...f.cssRules].flatMap((k) => [...(k as CSSKeyframeRule).style])));
          expect(frames.length === sceneFrames.length && [...props].every((p) => p === 'transform' || p === 'opacity'), `scene keyframes only use transform and opacity: ${[...props].join(', ')}`);
          const scene = $<HTMLElement>('.scene')!;
          window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }));
          await tick(80);
          expect(Math.abs(parseFloat(scene.style.getPropertyValue('--px')) + 0.5) < 0.05 && getComputedStyle($('.scene-layer.depth-2')!).transform !== 'none', `the scene layers follow the mouse (--px ${scene.style.getPropertyValue('--px')}, ${getComputedStyle($('.scene-layer.depth-2')!).transform}, reduced ${matchMedia('(prefers-reduced-motion: reduce)').matches}, hidden ${document.hidden})`);
          expect(getComputedStyle($('.rune')!).animationPlayState === (document.hidden ? 'paused' : 'running'), 'the scene pauses while the window is hidden');
          const still = [...document.styleSheets].flatMap((sh) => [...sh.cssRules]).filter((r) => r instanceof CSSMediaRule && r.conditionText.includes('prefers-reduced-motion')).map((r) => r.cssText).join(' ');
          expect(/\.light-shaft, \.candle \{ animation: [^;}]*\bnone\b/.test(still) && /\.dust \{ display: none/.test(still) && /\.ember \{ display: none/.test(still) && /\.rune \{ animation: [^;}]*\bnone\b/.test(still)
            && /\.nebula, \.mist, \.bokeh \{ animation: [^;}]*\bnone\b/.test(still) && /\.scene-layer[^{]*\{ transform: none/.test(still), `the scene is still under reduced motion: ${still.slice(still.indexOf('.light-shaft'), still.indexOf('.light-shaft') + 400)}`);
        }
        const startText = $('.start')!.textContent ?? '';
        expect(!/example/i.test(startText) && !startText.includes(dirRef.current ?? '\u0000'), 'no paths and no "example" label in the library');
        expect(emojiIn($('.start')).length === 0, 'no emoji on the start screen');
        const scroller = $('.start')!;
        expect(scroller.getBoundingClientRect().height === window.innerHeight && getComputedStyle(scroller).overflowY === 'auto', 'start screen fills the window and scrolls on its own');
        // The library fits at each size: no sideways scrolling, every book inside the bookcase, on a shelf row.
        for (const [width, height] of [[1280, 720], [2560, 1440], [1920, 1080]] as const) {
          await window.lore.smokeResize(width, height);
          for (let i = 0; i < 40 && (window.innerWidth !== width || window.innerHeight !== height); i++) await tick(50);
          await tick(150);
          const caseBox = $('.library .shelf')!.getBoundingClientRect();
          const out = [...document.querySelectorAll<HTMLElement>('.shelf .world-card')].filter((b) => { const r = b.getBoundingClientRect(); return r.left < caseBox.left - 1 || r.right > caseBox.right + 1; });
          expect(scroller.scrollWidth <= scroller.clientWidth && out.length === 0, `library at ${width}x${height}: ${out.length} books outside the shelf, scrollWidth ${scroller.scrollWidth}/${scroller.clientWidth}`);
          dom[`library${width}x${height}`] = new Set([...document.querySelectorAll<HTMLElement>('.shelf .world-card')].map((b) => Math.round(b.getBoundingClientRect().top))).size;
        }
        // New book: name and colour, created in the worlds folder, opened, then moved to the trash.
        $<HTMLButtonElement>('.new-book .world-book')!.click();
        expect(await until(() => !!$('#new-world-name')), 'New book opens the create dialog');
        await popupFit('New book', '.library-dialog', '.create-book button[type="submit"]');
        typeInto($<HTMLInputElement>('#new-world-name')!, 'Smoke Book');
        {
          // Emblem picker, a square colour field and Shuffle; random only as the first look.
          const look = () => `${($('.create-book .create-colour .color-hex')?.textContent ?? '')}|${$('.create-book .icon-choice[aria-pressed="true"]')?.getAttribute('title') ?? ''}`;
          expect(!!$('.create-book .icon-picker .icon-choice[aria-pressed="true"]') && !!$('.create-book .create-colour .color-button .cp-preview') && !$('.create-book .swatches'), `the new book dialog has an emblem picker and a colour field: ${look()}`);
          const first = look();
          let changed = false;
          for (let i = 0; i < 6 && !changed; i++) { $<HTMLButtonElement>('.create-book .shuffle-cover')!.click(); await tick(); changed = look() !== first; }
          expect(changed, `Shuffle changes the colour or emblem (${first} -> ${look()})`);
          [...document.querySelectorAll<HTMLButtonElement>('.create-book .icon-choice')].find((b) => b.title === 'castle')?.click();
          $<HTMLButtonElement>('.create-book .create-colour .color-button')!.click();
          await until(() => !!$('.color-popover'));
          typeInto($<HTMLInputElement>('.color-popover input[aria-label="Hex colour"]')!, '#2f5d3a');
          key($('.color-popover')!, 'Escape');
          await tick();
          const emblemBox = $<HTMLInputElement>('.create-book .show-emblem')!;
          expect(emblemBox.checked && $<HTMLInputElement>('.create-book .show-title')!.checked && !!$('.create-preview .cover-emblem'), 'Show title and Show emblem start on');
          emblemBox.click();
          await tick();
          expect(!$('.create-preview .cover-emblem') && !!$('.create-preview .cover-title'), 'Show emblem off hides the emblem on the preview, the title stays');
          // Both off, no picture: a plain cover; the name stays on the spine.
          const titleBox = $<HTMLInputElement>('.create-book .show-title')!;
          titleBox.click();
          await tick();
          expect(!$('.create-preview .cover-emblem') && !$('.create-preview .cover-title') && !$('.create-preview .cover-art image') && $('.create-preview .create-spine')?.textContent === 'Smoke Book',
            'with both switches off and no picture the new cover is plain, and the spine keeps the name');
          expect(!!$('.create-side .cover-switches legend') && $('.create-side .cover-switches legend')!.textContent === 'On the cover' && /with or without a picture/.test($('.create-side .cover-switches')!.textContent ?? ''), 'the switches sit beside the preview under "On the cover"');
          titleBox.click();
          await tick();
          expect(!!$('.create-preview .cover-title'), 'Show title on brings the title back');
          expect(await until(() => document.querySelectorAll('.create-book .recent-picture.is-upload img').length > 0), 'recent uploads show as thumbnails under the picture button');
          for (const [width, height] of [[1280, 720], [1920, 1080]] as const) {
            await window.lore.smokeResize(width, height);
            await until(() => window.innerWidth === width && window.innerHeight === height, 2000);
            await tick(100);
            const box = $('.library-dialog')!.getBoundingClientRect();
            expect(box.top >= 0 && box.bottom <= window.innerHeight + 1 && box.right <= window.innerWidth + 1, `the new book dialog fits ${width}x${height} (${Math.round(box.top)}-${Math.round(box.bottom)})`);
            const sw = $('.create-side .cover-switches')!.getBoundingClientRect();
            expect(sw.bottom <= box.bottom + 1 && sw.top >= box.top, `the cover switches are in view without scrolling at ${width}x${height}`);
          }
        }
        $<HTMLFormElement>('.create-book')!.requestSubmit();
        expect(await until(() => $('.world-title h1')?.textContent === 'Smoke Book', 5000), 'creating a book opens it');
        const made = dirRef.current!;
        const settings = await window.lore.settings();
        expect(made.startsWith(settings.worldsDir), `the new book is in the worlds folder (${settings.worldsDir})`);
        {
          const c = (await fromDisk()).manifest.cover;
          expect(c?.color === '#2f5d3a' && c?.icon === 'castle' && c?.showEmblem === false && !('showTitle' in (c ?? {})), `the new book's colour, emblem and switches are saved: ${JSON.stringify(c)}`);
        }
        // Cover editor: click the cover on world home, change emblem, lettering and title colour, save.
        setView('home');
        expect(await until(() => !!$('.home-cover .world-cover .cover-art')), 'world home shows the book cover');
        $<HTMLButtonElement>('.home-cover')!.click();
        expect(await until(() => !!$('.cover-editor .cover-editor-preview .cover-art')), 'clicking the cover opens the cover editor');
        await popupFit('Book cover editor', '.cover-editor', '.cover-save');
        const emblem = [...document.querySelectorAll<HTMLButtonElement>('.cover-editor .cover-emblems .icon-choice')].find((b) => b.getAttribute('aria-pressed') !== 'true' && b.title !== 'No emblem')!;
        const emblemName = emblem.title.replace(/ /g, '-');
        emblem.click();
        {
          const titleGroup = [...document.querySelectorAll<HTMLElement>('.cover-editor fieldset')].find((f) => f.querySelector('legend')?.textContent === 'Title')!;
          expect(!$('.cover-editor .title-styles') && titleGroup.children[1]?.classList.contains('font-field') === true, 'the three lettering buttons are gone and Title font comes first in the Title group');
          await tick();
          expect($('.cover-editor .cover-status')?.textContent === 'Unsaved changes' && !$<HTMLButtonElement>('.cover-editor .cover-save')!.disabled, 'a change marks the cover as unsaved and enables Save');
          const actions = $('.cover-editor .cover-editor-actions')!.getBoundingClientRect();
          const body = $('.cover-editor .cover-editor-body')!;
          expect(actions.bottom <= window.innerHeight + 1 && actions.top >= 0 && !body.contains($('.cover-editor .cover-editor-actions')) && !body.contains($('#cover-editor-title'))
            && getComputedStyle(body).overflowY === 'auto' && getComputedStyle($('.cover-editor')!).overflowY === 'hidden',
            `Save and Cancel stay in view, and only the body between the title and the buttons scrolls (${Math.round(actions.top)}-${Math.round(actions.bottom)} of ${window.innerHeight})`);
        }
        const titleField = [...document.querySelectorAll<HTMLElement>('.cover-editor .color-field')].find((f) => f.textContent?.includes('Title colour'))!;
        titleField.querySelector<HTMLButtonElement>('.color-button')!.click();
        await until(() => !!$('.color-popover'));
        typeInto($<HTMLInputElement>('.color-popover input[aria-label="Hex colour"]')!, '#ffcc00');
        await tick();
        expect(($('.cover-editor-preview .cover-title') as HTMLElement).style.color !== '', 'the preview follows the title colour');
        {
          key($('.color-popover')!, 'Escape');
          await tick();
          expect(!!$('.cover-editor'), 'Escape in a colour popover leaves the cover editor open');
          // The emblem switch was off from New book; turn it back on here.
          const emblemBox = $<HTMLInputElement>('.cover-editor .show-emblem')!;
          expect(!emblemBox.checked && !$('.cover-editor-preview .cover-emblem'), 'the cover editor shows the saved emblem switch (off)');
          emblemBox.click();
          await tick();
          expect(!!$('.cover-editor-preview .cover-emblem'), 'Show emblem on brings the emblem back');
          const titleBox = $<HTMLInputElement>('.cover-editor .show-title')!;
          titleBox.click();
          await tick();
          expect(!$('.cover-editor-preview .cover-title'), 'Show title off hides the title on the cover');
          titleBox.click();
          await tick();
          expect(!!$('.cover-editor-preview .cover-title'), 'Show title on brings it back');
          // Recent pictures: the earlier upload; the spine takes the colour of its left edge.
          const spineBefore = $<HTMLElement>('.cover-editor .spine-sample')!.style.background;
          expect(await until(() => !!$('.cover-editor .recent-picture.is-upload')), 'the cover editor lists recent uploads');
          $<HTMLButtonElement>('.cover-editor .recent-picture.is-upload')!.click();
          expect(await until(() => !!$('.cover-editor-preview .cover-art image') && $<HTMLElement>('.cover-editor .spine-sample')!.style.background !== spineBefore), `a recent upload becomes the cover picture and the spine follows its left edge (${spineBefore} -> ${$<HTMLElement>('.cover-editor .spine-sample')!.style.background})`);
          expect(/left edge/.test($('.cover-editor .spine-fields + .font-note')?.textContent ?? ''), 'the spine note says it follows the picture');
          // Title font: searchable, grouped, each name in its own font, keyboard to pick.
          $<HTMLButtonElement>('.cover-editor .font-button')!.click();
          expect(await until(() => document.activeElement === $('.font-popover .font-search')), 'the font picker opens with its search box focused');
          await popupFit('font picker', '.font-popover', '.font-popover .font-search');
          await until(() => !!$('.font-popover .font-option.is-system') || /No system fonts/.test($('.font-popover')!.textContent ?? ''), 5000);
          const groups = [...document.querySelectorAll('.font-popover .font-group')].map((g) => g.textContent);
          const bundled = [...document.querySelectorAll<HTMLElement>('.font-popover .font-option.is-bundled')];
          expect(groups.includes('Bundled') && groups.includes('System') && bundled.length === 16, `fonts are grouped Bundled and System: ${groups.join(', ')}; ${bundled.length} bundled`);
          expect(bundled.every((o) => o.querySelector<HTMLElement>('.font-name')!.style.fontFamily.includes(o.dataset['family']!)), 'each font name is shown in its own font');
          const search = $<HTMLInputElement>('.font-popover .font-search')!;
          {
            // The list scrolls with a real mouse wheel; the search box stays put and the panel stays inside the window.
            const listEl = $<HTMLElement>('.font-popover .font-options')!;
            const pop = $('.font-popover')!.getBoundingClientRect();
            expect(pop.top >= 0 && pop.bottom <= window.innerHeight + 1 && getComputedStyle(listEl).overflowY === 'auto' && listEl.scrollHeight > listEl.clientHeight,
              `the font list fits the window and has more to scroll (${Math.round(pop.top)}-${Math.round(pop.bottom)}, ${listEl.clientHeight}/${listEl.scrollHeight})`);
            await window.lore.smokeShow(true);
            await until(() => !document.hidden, 3000);
            await tick(200);
            const lr = listEl.getBoundingClientRect();
            // Pinned: the search box keeps its place inside the panel while the list scrolls.
            const pinned = () => search.getBoundingClientRect().top - $('.font-popover')!.getBoundingClientRect().top;
            const searchTop = pinned();
            await window.lore.smokeMouse([{ type: 'move', x: lr.left + lr.width / 2, y: lr.top + lr.height / 2 }, { type: 'wheel', x: lr.left + lr.width / 2, y: lr.top + lr.height / 2, deltaY: 240 }]);
            expect(await until(() => listEl.scrollTop > 0, 3000), `wheeling the font list scrolls it (scrollTop ${listEl.scrollTop})`);
            await tick(200);
            const scrolled = listEl.scrollTop;
            expect(scrolled > 0 && Math.abs(pinned() - searchTop) < 1, `the list keeps its place after scrolling and the search stays pinned (${scrolled}, ${Math.round(searchTop)} -> ${Math.round(pinned())})`);
            await window.lore.smokeShow(false);
            key(search, 'End', { ctrlKey: true });
            await tick();
            const last = $<HTMLElement>('.font-popover .font-option[aria-selected="true"]')!.getBoundingClientRect();
            const box = listEl.getBoundingClientRect();
            expect(last.bottom <= box.bottom + 1 && last.top >= box.top - 1, 'Ctrl+End keeps the active font in view');
            key(search, 'Home', { ctrlKey: true });
            await tick();
          }
          typeInto(search, 'ANTIQ');
          await tick();
          const found = [...document.querySelectorAll<HTMLElement>('.font-popover .font-option')].map((o) => o.dataset['family']);
          expect(found[0] === 'Uncial Antiqua' && !found.includes('Almendra') && !found.includes(''), `searching narrows the list: ${found.join(', ')}`);
          typeInto(search, '');
          await tick();
          key(search, 'ArrowDown');
          key(search, 'ArrowDown');
          await tick();
          const active = $<HTMLElement>('.font-popover .font-option[aria-selected="true"]');
          expect(active?.dataset['family'] === 'Caladea' && search.getAttribute('aria-activedescendant') === active.id, `arrow keys move through the list (${active?.dataset['family']})`);
          typeInto(search, 'uncial');
          await tick();
          key(search, 'Enter');
          expect(await until(() => !$('.font-popover') && $('.cover-editor .font-button .font-name')?.textContent === 'Uncial Antiqua'), 'Enter picks the font');
          const titleStyle = $<HTMLElement>('.cover-editor-preview .cover-title.has-font');
          expect(!!titleStyle && titleStyle.style.getPropertyValue('--cover-font').includes('Uncial Antiqua') && getComputedStyle(titleStyle).fontFamily.includes('Uncial Antiqua'), 'the preview title uses the chosen font');
          expect((await document.fonts.load('16px "Uncial Antiqua"', 'ABC')).length > 0 && (await document.fonts.load('700 16px "Liberation Serif"', 'ABC')).length > 0, 'bundled cover fonts load (woff2 and the Liberation TTFs)');
          // Spine colour override.
          const spineField = [...document.querySelectorAll<HTMLElement>('.cover-editor .color-field')].find((f) => f.textContent?.includes('Spine colour'))!;
          spineField.querySelector<HTMLButtonElement>('.color-button')!.click();
          await until(() => !!$('.color-popover'));
          typeInto($<HTMLInputElement>('.color-popover input[aria-label="Hex colour"]')!, '#123456');
          key($('.color-popover')!, 'Escape');
          await tick();
          expect(!!$('.cover-editor .spine-auto'), 'a chosen spine colour can go back to automatic');
        }
        {
          // Unsaved changes: Escape and a click outside ask first; Keep editing keeps the draft.
          const onDiskBefore = JSON.stringify((await fromDisk()).manifest.cover);
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          expect(await until(() => $('.confirm-dialog #confirm-title')?.textContent === 'Discard cover changes?' && !!$('.cover-editor')), 'Escape with unsaved changes asks before closing');
          key($('.confirm-dialog')!, 'Escape');
          expect(await until(() => !$('.confirm-dialog') && !!$('.cover-editor') && $('.cover-editor .font-button .font-name')?.textContent === 'Uncial Antiqua'), 'Keep editing keeps the editor and the draft');
          $('.cover-editor-backdrop')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          expect(await until(() => !!$('.confirm-dialog')), 'a click outside with unsaved changes asks too');
          await popupFit('unsaved changes confirm', '.confirm-dialog', '.confirm-go');
          $<HTMLButtonElement>('.confirm-dialog .confirm-cancel')!.click();
          await until(() => !$('.confirm-dialog'));
          expect(JSON.stringify((await fromDisk()).manifest.cover) === onDiskBefore, 'nothing is written before Save');
        }
        $<HTMLButtonElement>('.cover-editor .cover-save')!.click();
        expect(await until(() => !$('.cover-editor')), 'Save cover closes the editor');
        expect(await until(() => [...document.querySelectorAll('.toast-text')].some((t) => t.textContent === 'Cover saved')), 'a toast confirms the cover is saved');
        expect(await onDisk((ws) => ws.manifest.cover?.icon === emblemName && !ws.manifest.cover?.titleStyle && ws.manifest.cover?.titleColor === '#ffcc00'), `the cover is saved to world.json: ${JSON.stringify((await fromDisk()).manifest.cover)}`);
        {
          // Reopened: the saved cover, nothing to save; Cancel drops a change; Escape with no changes just closes.
          $<HTMLButtonElement>('.home-cover')!.click();
          expect(await until(() => !!$('.cover-editor') && $('.cover-editor .font-button .font-name')?.textContent === 'Uncial Antiqua' && $('.cover-editor .cover-status')?.textContent === 'No changes' && $<HTMLButtonElement>('.cover-editor .cover-save')!.disabled),
            'the reopened editor shows the saved cover with nothing to save');
          const saved = JSON.stringify((await fromDisk()).manifest.cover);
          [...document.querySelectorAll<HTMLButtonElement>('.cover-editor .cover-emblems .icon-choice')].find((b) => b.getAttribute('aria-pressed') !== 'true' && b.title !== 'No emblem')!.click();
          await tick();
          expect($('.cover-editor .cover-status')?.textContent === 'Unsaved changes', 'a new change is a draft');
          $<HTMLButtonElement>('.cover-editor .cover-cancel')!.click();
          expect(await until(() => !$('.cover-editor') && !$('.confirm-dialog')), 'Cancel closes at once');
          await tick(200);
          expect(JSON.stringify((await fromDisk()).manifest.cover) === saved && !!$(`.home-cover .cover-emblem`), 'Cancel reverts: world.json and Home keep the saved cover');
          $<HTMLButtonElement>('.home-cover')!.click();
          await until(() => !!$('.cover-editor'));
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          expect(await until(() => !$('.cover-editor') && !$('.confirm-dialog')), 'Escape with no changes closes without asking');
        }
        {
          const c = (await fromDisk()).manifest.cover ?? {};
          expect(c.font === 'Uncial Antiqua' && c.spineColor === '#123456' && !('showEmblem' in c) && !('showTitle' in c) && /^images\/cover-\w+\.png$/.test(c.image ?? ''), `font, spine colour, switches and the recent upload are saved: ${JSON.stringify(c)}`);
          // No picture only hides it: the copied file stays and is offered again as a world picture.
          const pictures = await window.lore.coverImages(made);
          expect(pictures.some((p) => p.kind === 'world' && p.path === c.image), 'the saved cover picture is listed among the world pictures');
        }
        expect(await until(() => !!$('.home-cover .cover-title.has-font')), 'world home shows the new cover');
        expect(!!$('.home-cover .cover-page') && getComputedStyle($('.home-cover .world-cover')!).transformOrigin.startsWith('0px'), 'the home cover is hinged on its left edge over a page');
        $<HTMLButtonElement>('.home-library')!.click();
        const book = () => $('.shelf .world-card[data-name="Smoke Book"]');
        expect(await until(() => !!book()?.querySelector('.book-lid .book-delete')), 'the new book is on the shelf with a delete button on its cover');
        expect(!!book()!.querySelector('.world-book .book-spine .spine-title') && !!book()!.querySelector('.book-cover .cover-title.has-font'), 'shelf books show their spine, with the saved cover behind it');
        expect(book()!.style.getPropertyValue('--spine') === '#123456' && !!book()!.querySelector('.spine-title.has-font'), `the shelf spine uses the chosen spine colour and font (${book()!.style.getPropertyValue('--spine')})`);
        {
          // Every book carries its cover art; the shelf starts with the first book, not a gap.
          const cards = [...document.querySelectorAll<HTMLElement>('.shelf .world-card:not(.new-book)')];
          expect(cards.every((c) => !!c.querySelector('.book-cover .cover-art')), 'every book on the shelf has its cover');
          const shelfBox = $('.library .shelf')!.getBoundingClientRect();
          const first = $('.shelf .world-card')!.getBoundingClientRect();
          expect(first.left - shelfBox.left <= 24, `the first book starts at the shelf edge (${Math.round(first.left - shelfBox.left)}px)`);
          // Pointing at a book pulls it out with its cover; pointing at another puts the first back; leaving puts it back.
          const [a, b] = cards;
          if (a && b) {
            const cover = (c: HTMLElement) => c.querySelector<HTMLElement>('.book-cover')!;
            const face = (c: HTMLElement, f: string) => c.querySelector<HTMLElement>(`.world-book .book-${f}`)!;
            // Where a face looks: its own transform times every 3D ancestor's up to the open button, applied to the
            // face's normal (0, 0, 1) as a direction (w = 0, so translations and transform origins drop out).
            const normal = (el: HTMLElement) => {
              const m3 = (x: Element) => { const t = getComputedStyle(x).transform; return t === 'none' ? new DOMMatrix() : new DOMMatrix(t); };
              let m = m3(el);
              for (let p = el.parentElement; p && !p.classList.contains('world-book'); p = p.parentElement) m = m3(p).multiply(m);
              const n = m.transformPoint(new DOMPoint(0, 0, 1, 0));
              return [n.x, n.y, n.z].map((v) => Math.round(v * 100) / 100);
            };
            const faces = ['spine', 'cover', 'back', 'pages', 'top'] as const;
            const looks = (c: HTMLElement) => Object.fromEntries(faces.map((f) => [f, normal(face(c, f))]));
            const settle = async (c: HTMLElement) => { await tick(50); for (const an of c.getAnimations({ subtree: true })) an.finish(); await tick(); };
            const near = (v: number[], w: number[]) => v.every((x, i) => Math.abs(x - w[i]!) < 0.02);
            const shelfEl = $('.library .shelf')!;
            expect(getComputedStyle(shelfEl).perspective !== 'none' && getComputedStyle(a).transformStyle === 'preserve-3d' && getComputedStyle(a.querySelector('.book-body')!).transformStyle === 'preserve-3d'
              && faces.every((f) => getComputedStyle(face(a, f)).backfaceVisibility === 'hidden'), 'books are CSS 3D boxes under the shelf perspective, faces backface-hidden');
            const thick = a.getBoundingClientRect().width;
            const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
            const thicks = cards.map((c) => c.offsetWidth / rem);
            expect(thicks.every((t) => t >= 2.25 && t <= 2.95), `book thickness stays in a modest range: ${thicks.map((t) => t.toFixed(2)).join(', ')} rem`);
            const coverW = cover(a).offsetWidth;
            const rest = looks(a);
            const spineRest = face(a, 'spine').getBoundingClientRect();
            expect(near(rest['spine']!, [0, 0, 1]) && near(rest['cover']!, [1, 0, 0]) && near(rest['back']!, [-1, 0, 0]) && near(rest['pages']!, [0, 0, -1]) && near(rest['top']!, [0, -1, 0])
              && Math.abs(spineRest.width - thick) < 2, `at rest the spine faces the viewer (${Math.round(spineRest.width)}px wide, the book is ${Math.round(thick)}px thick): ${JSON.stringify(rest)}`);
            // In perspective the other faces of a book at rest would poke out beside its spine, so they are not drawn.
            const sides = (c: HTMLElement) => faces.filter((f) => f !== 'spine').map((f) => getComputedStyle(face(c, f)).opacity);
            const onlySpine = (c: HTMLElement) => sides(c).every((o) => o === '0') && getComputedStyle(face(c, 'spine')).opacity === '1';
            expect(cards.every(onlySpine), `a book at rest shows only its spine (${sides(a).join(', ')})`);
            const spines = () => cards.map((c) => face(c, 'spine').getBoundingClientRect());
            const restAt = spines().map((r) => Math.round(r.left));
            const atRest = () => spines().every((r, i) => Math.abs(r.left - restAt[i]!) < 1.5);
            const settleAll = async () => { await tick(50); for (const an of shelfEl.getAnimations({ subtree: true })) an.finish(); await tick(); };
            a.dispatchEvent(new PointerEvent('pointerenter'));
            await tick(30);
            expect(!a.classList.contains('is-out'), 'a book waits a moment (hover intent) before it comes out');
            expect(await until(() => a.classList.contains('is-out') && count('.shelf .is-out') === 1), 'pointing at a book pulls it out');
            // The hidden smoke window paints no frames, so jump the slide and the turn to their end before measuring.
            await settleAll();
            const outLooks = looks(a);
            const r = cover(a).getBoundingClientRect();
            const spineOut = face(a, 'spine').getBoundingClientRect();
            expect(near(outLooks['cover']!, [0, 0, 1]) && near(outLooks['spine']!, [-1, 0, 0]) && near(outLooks['back']!, [0, 0, -1]) && near(outLooks['pages']!, [1, 0, 0]),
              `out, the book has turned so the front cover faces the viewer: ${JSON.stringify(outLooks)}`);
            expect(getComputedStyle(cover(a)).opacity === '1' && cards.filter((c) => c !== a).every(onlySpine), 'out, the cover shows; the books around it still show only their spines');
            expect(r.width > coverW * 0.95 && r.width < coverW * 1.25 && r.height > 60 && spineOut.width < thick * 0.6,
              `the pulled-out book shows its whole cover (${Math.round(r.width)}x${Math.round(r.height)}, cover ${coverW}px) and the spine is edge-on (${Math.round(spineOut.width)}px)`);
            expect(!a.classList.contains('opens-left') && Math.abs(spineOut.left - spineRest.left) <= 3 && Math.abs(r.left - spineRest.left) <= 3,
              `the spine's left edge is the hinge: the book stays put and the cover opens to the right (spine ${Math.round(spineOut.left - spineRest.left)}px, cover ${Math.round(r.left - spineRest.left)}px from rest)`);
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.35);
            expect(!!hit && !!hit.closest('.book-cover, .lid-face') && a.contains(hit), `the cover is in front of everything at its centre (${hit?.className})`);
            const shelfBox = shelfEl.getBoundingClientRect();
            const overlap = cards.filter((c) => c !== a).map((c) => face(c, 'spine').getBoundingClientRect())
              .filter((o) => o.bottom > r.top + 1 && o.top < r.bottom - 1 && o.right > r.left + 1 && o.left < r.right - 1);
            const inside = (o: DOMRect) => o.left >= shelfBox.left - 2 && o.right <= shelfBox.right + 2;
            expect(inside(r) && overlap.length === 0 && spines().every(inside) && getComputedStyle(shelfEl).overflow === 'visible' && getComputedStyle($('.bookcase')!).overflow === 'visible',
              `the neighbours move aside: none overlaps the open cover (${overlap.length}) and every book stays inside the unclipped shelf`);
            expect(cards.slice(1).some((c, i) => Math.abs(face(c, 'spine').getBoundingClientRect().left - restAt[i + 1]!) > 4), 'the books to the right are pushed aside');
            expect(getComputedStyle(a.querySelector('.book-delete')!).pointerEvents === 'auto', 'the delete button is live on the pulled-out cover');
            b.dispatchEvent(new PointerEvent('pointerenter'));
            expect(await until(() => b.classList.contains('is-out') && !a.classList.contains('is-out') && count('.shelf .is-out') === 1), 'pointing at another book puts the first one back');
            b.dispatchEvent(new PointerEvent('pointerleave'));
            expect(await until(() => count('.shelf .is-out') === 0), 'leaving the shelf puts the book back');
            await settleAll();
            const back = looks(a);
            expect(near(back['spine']!, [0, 0, 1]) && near(back['cover']!, [1, 0, 0]) && Math.abs(face(a, 'spine').getBoundingClientRect().width - thick) < 2, `a book put back shows its spine again: ${JSON.stringify(back)}`);
            expect(cards.every(onlySpine), `a book put back shows only its spine again, no cover sticking out (${sides(a).join(', ')})`);
            expect(atRest(), 'the pushed books slide back to their places');
            // A book put back just before the next one comes out still finishes going back: it must not stay drawn over
            // its neighbours (is-closing) while the next one is out.
            a.dispatchEvent(new PointerEvent('pointerenter'));
            expect(await until(() => a.classList.contains('is-out')), 'pointing at the first book again pulls it out');
            a.dispatchEvent(new PointerEvent('pointerleave'));
            b.dispatchEvent(new PointerEvent('pointerenter'));
            expect(await until(() => b.classList.contains('is-out')), 'pointing at the next book right after pulls that one out');
            await tick(700);
            expect(b.classList.contains('is-out') && count('.shelf .is-closing') === 0, `the book put back before it is no longer drawn over its neighbours (${count('.shelf .is-closing')} closing)`);
            b.dispatchEvent(new PointerEvent('pointerleave'));
            expect(await until(() => count('.shelf .is-out') === 0), 'leaving puts that book back too');
            await tick(700);
            await settleAll();
            // Spam: quick enters and leaves across three books end in one consistent state.
            const c3 = cards[2] ?? b;
            const trio = [a, b, c3];
            for (let i = 0; i < 24; i++) {
              const el = trio[i % 3]!;
              el.dispatchEvent(new PointerEvent('pointerenter'));
              await tick(i % 4 === 0 ? 130 : 15 + (i * 7) % 40);
              el.dispatchEvent(new PointerEvent('pointerleave'));
            }
            c3.dispatchEvent(new PointerEvent('pointerenter'));
            expect(await until(() => c3.classList.contains('is-out') && count('.shelf .is-out') === 1), 'after spamming, only the last book pointed at is out');
            await tick(700);
            expect(count('.shelf .is-out') === 1 && count('.shelf .is-closing') === 0, `after spamming nothing is left half closed (${count('.shelf .is-closing')} closing)`);
            c3.dispatchEvent(new PointerEvent('pointerleave'));
            await tick(700);
            await settleAll();
            expect(count('.shelf .is-out, .shelf .is-closing') === 0 && atRest() && looks(c3)['spine']!.join() === '0,0,1'
              && cards.every((c) => (c.style.getPropertyValue('--push') || '0px') === '0px'), 'after leaving every book is back at rest with no push');
            {
              // Real pointer, real time: the window is shown so transitions run, and the mouse really moves. Whenever
              // the pointer leaves (during the hover intent, mid-turn, fully out, or across books), every book ends
              // exactly at rest: same computed transforms as before, no counts showing, nothing still moving.
              await window.lore.smokeShow(true);
              await until(() => !document.hidden, 3000);
              await tick(300);
              const parts = (c: HTMLElement) => [c, c.querySelector('.world-book .book-pull')!, ...faces.map((f) => face(c, f)), ...c.querySelectorAll('.book-lid .lid-face')];
              const snap = () => cards.map((c) => parts(c).map((el) => getComputedStyle(el).transform).join(' | '));
              const spot = () => { const r = $('.start-hero h1')!.getBoundingClientRect(); return { type: 'move' as const, x: r.left + 10, y: r.top + r.height / 2 }; };
              await window.lore.smokeMouse([spot()]);
              await until(() => count('.shelf .is-out, .shelf .is-closing') === 0, 3000);
              await tick(700);
              const restSnap = snap();
              const at = (c: HTMLElement) => { const r = face(c, 'spine').getBoundingClientRect(); return { type: 'move' as const, x: r.left + r.width / 2, y: r.top + r.height * 0.6 }; };
              const quiet = async () => {
                await until(() => count('.shelf .is-out, .shelf .is-closing') === 0, 3000);
                await until(() => shelfEl.getAnimations({ subtree: true }).every((an) => an.playState !== 'running'), 3000);
                await tick(80);
              };
              const checkRest = async (when: string) => {
                await quiet();
                const now = snap();
                const moved = cards.filter((_, i) => now[i] !== restSnap[i]).map((c) => c.dataset['name']);
                const metas = cards.filter((c) => getComputedStyle(c.querySelector('.world-meta')!).opacity !== '0').map((c) => c.dataset['name']);
                const running = shelfEl.getAnimations({ subtree: true }).filter((an) => an.playState === 'running').length;
                expect(moved.length === 0 && metas.length === 0 && running === 0 && count('.shelf .is-out, .shelf .is-closing') === 0 && atRest(),
                  `leaving ${when} returns every book to rest (moved: ${moved.join(', ') || 'none'}; counts showing: ${metas.join(', ') || 'none'}; ${running} still moving)`);
              };
              await window.lore.smokeMouse([at(a)]);
              await tick(40);
              expect(!a.classList.contains('is-out'), 'a real pointer also waits for the hover intent');
              await window.lore.smokeMouse([spot()]);
              await checkRest('during the hover intent');
              await window.lore.smokeMouse([at(a)]);
              await tick(280);
              expect(a.classList.contains('is-out'), 'a real pointer pulls the book out');
              await window.lore.smokeMouse([spot()]);
              await checkRest('mid-turn');
              await window.lore.smokeMouse([at(a)]);
              await until(() => a.classList.contains('is-out'));
              await tick(900);
              expect(getComputedStyle(a.querySelector('.world-meta')!).opacity === '1', 'the counts show on a book that is fully out');
              // Going back, the books that moved aside wait for the cover: on every frame while the cover still
              // shows, the next spine stays to the right of it, so the two are never drawn over each other.
              const clearOf = (book: HTMLElement, next: HTMLElement, ms: number) => new Promise<number>((done) => {
                const c = cover(book);
                const s = face(next, 'spine');
                const t0 = performance.now();
                let worst = Infinity;
                const frame = () => {
                  if (Number(getComputedStyle(c).opacity) > 0.05) worst = Math.min(worst, s.getBoundingClientRect().left - c.getBoundingClientRect().right);
                  if (performance.now() - t0 < ms) requestAnimationFrame(frame);
                  else done(Math.round(worst));
                };
                requestAnimationFrame(frame);
              });
              const clash = clearOf(a, b, 900);
              await window.lore.smokeMouse([spot()]);
              const closest = await clash;
              expect(closest >= 0, `going back, the next book stays clear of the closing cover (closest ${closest}px)`);
              await checkRest('fully out');
              await window.lore.smokeMouse([at(a)]);
              await tick(25);
              await window.lore.smokeMouse([at(b)]);
              await tick(25);
              await window.lore.smokeMouse([at(c3)]);
              await tick(25);
              await window.lore.smokeMouse([spot()]);
              await checkRest('after a fast sweep across three books');
              await window.lore.smokeMouse([spot()]);
              await checkRest('after a slow sweep across three books, each caught mid-turn');
              await window.lore.smokeMouse([at(c3)]);
              await until(() => c3.classList.contains('is-out'));
              await tick(800);
              await window.lore.smokeMouse([at(a)]);
              expect(await until(() => a.classList.contains('is-out') && !c3.classList.contains('is-out')), 'moving straight onto another book swaps them');
              await tick(800);
              await window.lore.smokeMouse([spot()]);
              await checkRest('after moving from one open book to another');
              await window.lore.smokeShow(false);
            }
            // Near the right edge a book opens to the left instead (the last book on a full row).
            const rows = new Map<number, HTMLElement[]>();
            for (const c of [...document.querySelectorAll<HTMLElement>('.shelf .shelf-book')]) rows.set(c.offsetTop, [...(rows.get(c.offsetTop) ?? []), c]);
            const lastRow = [...rows.values()].find((row) => row.length > 1 && shelfEl.clientWidth - (row[row.length - 1]!.offsetLeft + row[row.length - 1]!.offsetWidth) < coverW);
            if (lastRow) {
              const z = lastRow[lastRow.length - 1]!;
              z.dispatchEvent(new PointerEvent('pointerenter'));
              expect(await until(() => z.classList.contains('is-out')), 'the book at the right edge comes out');
              await settleAll();
              const zr = (z.querySelector<HTMLElement>('.book-cover') ?? z.querySelector<HTMLElement>('.lid-face'))!.getBoundingClientRect();
              expect(z.classList.contains('opens-left') && zr.right <= shelfBox.right + 2 && zr.left >= shelfBox.left - 2, `a book at the right edge opens to the left, inside the shelf (${Math.round(shelfBox.right - zr.right)}px)`);
              z.dispatchEvent(new PointerEvent('pointerleave'));
              await until(() => count('.shelf .is-out') === 0);
              await tick(600);
              await settleAll();
            }
            // Reduced motion: no turn, the spine crossfades to a flat cover.
            const css = [...document.styleSheets].flatMap((sh) => [...sh.cssRules]).filter((x) => x instanceof CSSMediaRule && x.conditionText.includes('prefers-reduced-motion')).map((x) => x.cssText).join(' ');
            expect(/\.shelf-book\.is-out \.book-spine \{ opacity: 0; \}/.test(css) && /\.shelf-book\.is-out \.book-body \{ --turn: 0deg; \}/.test(css) && /\.shelf-book\.is-out \.book-pull, \.shelf-book\.is-out\.opens-left \.book-pull \{ transform: none; \}/.test(css), 'reduced motion crossfades instead of turning');
            // Keyboard focus (the unfocused smoke window gets no real focus events, so send them as Tab would).
            const aBtn = a.querySelector<HTMLButtonElement>('.world-book')!;
            const bBtn = b.querySelector<HTMLButtonElement>('.world-book')!;
            aBtn.dispatchEvent(new FocusEvent('focus'));
            expect(await until(() => a.classList.contains('is-out')), 'focus pulls a book out too');
            aBtn.dispatchEvent(new FocusEvent('blur', { relatedTarget: bBtn }));
            bBtn.dispatchEvent(new FocusEvent('focus', { relatedTarget: aBtn }));
            expect(await until(() => b.classList.contains('is-out') && count('.shelf .is-out') === 1), 'moving focus moves the pulled-out book');
            bBtn.dispatchEvent(new FocusEvent('blur'));
            expect(await until(() => count('.shelf .is-out') === 0), 'no book stays out after focus leaves');
          }
          book()!.dispatchEvent(new PointerEvent('pointerenter'));
          await until(() => book()!.classList.contains('is-out'));
        }
        expect(!book()!.querySelector('.world-book button'), 'no button inside the open-book button');
        book()!.querySelector<HTMLButtonElement>('.book-delete')!.click();
        expect(await until(() => !!$('.confirm-dialog') && document.activeElement?.classList.contains('confirm-cancel') === true && document.activeElement.textContent?.trim() === 'Keep it'), 'delete asks first in a themed dialog, with Keep it focused');
        await popupFit('delete confirm', '.confirm-dialog', '.confirm-go');
        {
          const dlg = $('.confirm-dialog')!;
          expect(!!dlg.querySelector('.confirm-mark svg') && !!dlg.querySelector('.confirm-cover') && dlg.querySelector('.confirm-name')?.textContent?.includes('Smoke Book') === true
            && /system trash/.test(dlg.textContent ?? '') && /restore it from there/.test(dlg.textContent ?? '') && getComputedStyle(dlg).animationName !== 'none',
            'the delete dialog shows a danger mark, the cover, the name, the trash note and animates in');
          key(dlg, 'Tab', { shiftKey: true });
          expect(document.activeElement?.classList.contains('confirm-go') === true, `Shift+Tab from Keep it wraps to Move to trash (focus trap); focus on ${document.activeElement?.className} ${document.activeElement?.textContent?.trim().slice(0, 30)}`);
          key(dlg, 'Escape');
          expect(await until(() => !$('.confirm-dialog') && !!book()), 'Escape keeps the book');
          book()!.dispatchEvent(new PointerEvent('pointerenter'));
          await until(() => book()!.classList.contains('is-out'));
          book()!.querySelector<HTMLButtonElement>('.book-delete')!.click();
          expect(await until(() => !!$('.confirm-backdrop')), 'delete asks again');
          $('.confirm-backdrop')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          expect(await until(() => !$('.confirm-dialog') && !!book()), 'a click on the backdrop keeps the book');
          book()!.dispatchEvent(new PointerEvent('pointerenter'));
          await until(() => book()!.classList.contains('is-out'));
          book()!.querySelector<HTMLButtonElement>('.book-delete')!.click();
          await until(() => !!$('.confirm-go'));
        }
        $<HTMLButtonElement>('.confirm-dialog .confirm-go')!.click();
        expect(await until(() => !book(), 5000), `Move to trash removes the book: ${$('.confirm-dialog .error-line')?.textContent ?? ''}`);
        expect((await window.lore.peekWorld(made)) === null, 'the folder is gone from the worlds folder');
        await tick(300);
        expect(!book() && !$('.confirm-dialog'), 'the shelf stays refreshed after the trash');
        expect(!(await window.lore.listWorlds()).includes(made), 'the trashed world is not listed any more');
        expect(!(await window.lore.recentWorlds()).includes(made), 'the trashed world is dropped from recent worlds');
        {
          // The library's own dialogs fit too.
          $<HTMLButtonElement>('.start-actions button[aria-label="Library settings"]')!.click();
          expect(await until(() => !!$('.library-dialog')), 'Library settings opens');
          await popupFit('Library settings', '.library-dialog', '.library-dialog .dialog-actions .primary');
          $<HTMLButtonElement>('.library-dialog .dialog-actions .primary')!.click();
          await until(() => !$('.library-dialog'));
          $<HTMLButtonElement>('.start-about')!.click();
          expect(await until(() => !!$('.about')), 'About opens from the library');
          await popupFit('library About', '.about', '.about-head button');
          dom['credits'] = count('.about .credit');
          expect(($('.about')!.textContent ?? '').includes('CC BY 3.0') && ($('.about')!.textContent ?? '').includes('Open Font License'), 'About lists the icon and font licences');
          $<HTMLButtonElement>('.about-head button')!.click();
          await until(() => !$('.about'));
          // A big library: generated worlds in a throwaway worlds folder (never the repository's worlds/).
          const start = $('.start')!;
          const reload = async (n: number) => {
            await window.lore.smokeLibrary(n);
            window.dispatchEvent(new Event('focus'));
            const want = (await window.lore.listWorlds()).length;
            await until(() => count('.shelf .shelf-book:not(.new-book)') === want && !$('.shelf .world-meta')?.textContent?.includes('Reading') && [...document.querySelectorAll('.shelf .world-meta')].every((m) => !m.textContent?.includes('Reading')), 15000);
            return want;
          };
          const rowsOf = () => {
            const rows = new Map<number, HTMLElement[]>();
            for (const c of [...document.querySelectorAll<HTMLElement>('.shelf .shelf-book')]) rows.set(c.offsetTop, [...(rows.get(c.offsetTop) ?? []), c]);
            return [...rows.values()];
          };
          const settleShelf = async () => { await tick(50); for (const an of $('.library .shelf')!.getAnimations({ subtree: true })) an.finish(); await tick(); };
          // 30, 100 and 300 books: they all load, wrap into rows, and a book still comes out quickly.
          const sizes: string[] = [];
          // Shown, so the cover observer gets painted frames.
          await window.lore.smokeShow(true);
          await until(() => !document.hidden, 3000);
          for (const n of [30, 100, 300]) {
            const t0 = performance.now();
            const want = await reload(n);
            const loaded = performance.now() - t0;
            const rows = rowsOf();
            const books = [...document.querySelectorAll<HTMLElement>('.shelf .shelf-book:not(.new-book)')];
            const mid = rows[Math.floor(rows.length / 2)]!;
            const b = mid[Math.floor(mid.length / 2)]!;
            const t1 = performance.now();
            b.dispatchEvent(new PointerEvent('pointerenter'));
            await until(() => b.classList.contains('is-out'));
            const out = performance.now() - t1;
            b.dispatchEvent(new PointerEvent('pointerleave'));
            await until(() => count('.shelf .is-out') === 0);
            await settleShelf();
            start.scrollTop = 0;
            await tick(300);
            const near = count('.shelf [data-near]');
            sizes.push(`${n}: ${books.length} books in ${rows.length} rows, loaded in ${Math.round(loaded)} ms, out in ${Math.round(out)} ms, ${near} covers loaded at the top`);
            if (n === 300) expect(near > 0 && near < books.length && !books.find((b) => b.dataset['key']?.endsWith('of-300-300'))?.hasAttribute('data-near'), `books far below the fold wait to load their covers (${near} of ${books.length})`);
            dom[`shelf${n}Rows`] = rows.length;
            expect(books.length === want && rows.length > 1 && out < 600 && loaded < 12000, `a shelf of ${n} worlds: ${sizes[sizes.length - 1]}`);
          }
          summary['shelfSizes'] = sizes.join('; ');
          // About 60 books at the smallest window size: more than one shelf, lazily loaded, scrolls to the last one.
          await window.lore.smokeResize(1024, 640);
          await tick(200);
          start.scrollTop = 0;
          const total = await reload(60);
          await tick(300);
          const rows = rowsOf();
          const cards = () => [...document.querySelectorAll<HTMLElement>('.shelf .shelf-book:not(.new-book)')];
          const last = cards()[cards().length - 1]!;
          dom['shelfRows60'] = rows.length;
          expect(rows.length > 1 && cards().length === total && total >= 60, `60 worlds wrap onto ${rows.length} shelves (${cards().length} of ${total} books)`);
          const shelfEl = $('.library .shelf')!;
          // Every row stands on its own plank: the plank gradient repeats once per row height.
          const rowGap = rows[1]![0]!.offsetTop - rows[0]![0]!.offsetTop;
          const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
          expect(Math.abs(rowGap - 17.6 * rem) < 2, `rows are one plank apart (${rowGap}px)`);
          await window.lore.smokeShow(true);
          await until(() => !document.hidden, 3000);
          const hero = $('.start-hero h1')!.getBoundingClientRect();
          for (let i = 0; i < 40 && start.scrollTop + start.clientHeight < start.scrollHeight - 2; i++) await window.lore.smokeMouse([{ type: 'wheel', x: hero.left + 20, y: 400, deltaY: 240 }]);
          await tick(200);
          {
            const r = last.querySelector('.book-spine')!.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.6);
            expect(start.scrollTop > 0 && r.bottom <= innerHeight && r.top >= 0 && !!hit && last.contains(hit), `the last book is reached by scrolling the library (scrolled ${Math.round(start.scrollTop)}px, book at ${Math.round(r.top)}-${Math.round(r.bottom)} of ${innerHeight})`);
            expect(await until(() => last.hasAttribute('data-near')), 'scrolled into view, the last book loads its cover');
            expect(document.documentElement.scrollTop === 0 && document.body.scrollTop === 0, 'only the library scrolls, not the page');
          }
          // Hover on a lower row: only that row moves, everything stays inside the frame, and leaving puts it all back.
          const full = rowsOf().map((r) => r.filter((c) => !c.classList.contains('new-book'))).filter((r) => r.length >= 3);
          const lower = full[full.length - 1]!;
          const rowAbove = full[full.length - 2]!;
          const target = lower[0]!;
          const restAt = cards().map((c) => c.querySelector('.book-spine')!.getBoundingClientRect().left);
          const atRest = () => cards().every((c, i) => Math.abs(c.querySelector('.book-spine')!.getBoundingClientRect().left - restAt[i]!) < 1.5 && (c.style.getPropertyValue('--push') || '0px') === '0px');
          const at = (c: HTMLElement) => { const r = c.querySelector('.book-spine')!.getBoundingClientRect(); return { type: 'move' as const, x: r.left + r.width / 2, y: r.top + r.height * 0.6 }; };
          const away = () => { const r = $('.shelf-head h2')!.getBoundingClientRect(); return { type: 'move' as const, x: r.left + 5, y: r.top + r.height / 2 }; };
          $('.shelf-head h2')!.scrollIntoView({ block: 'nearest' });
          await tick(100);
          target.scrollIntoView({ block: 'center' });
          await tick(200);
          await window.lore.smokeMouse([at(target)]);
          expect(await until(() => target.classList.contains('is-out')), 'a book on the last shelf comes out under the real pointer');
          await tick(900);
          {
            const box = shelfEl.getBoundingClientRect();
            const cover = target.querySelector('.book-cover')!.getBoundingClientRect();
            const sameRow = lower.filter((c) => c !== target);
            const pushed = sameRow.filter((c) => (c.style.getPropertyValue('--push') || '0px') !== '0px').length;
            const otherPushed = rowAbove.filter((c) => (c.style.getPropertyValue('--push') || '0px') !== '0px').length;
            const hy = parseFloat(shelfEl.style.getPropertyValue('--hy'));
            expect(cover.left >= box.left - 2 && cover.right <= box.right + 2 && pushed > 0 && otherPushed === 0 && Math.abs(hy - (target.offsetTop + target.offsetHeight * 0.25)) < 2,
              `on a lower shelf the cover stays inside (${Math.round(cover.left - box.left)}..${Math.round(box.right - cover.right)}px), only its row moves (${pushed} pushed, ${otherPushed} on the row above) and the shelf looks along that row (${hy}px)`);
          }
          await window.lore.smokeMouse([away()]);
          await until(() => count('.shelf .is-out, .shelf .is-closing') === 0, 3000);
          await until(() => shelfEl.getAnimations({ subtree: true }).every((an) => an.playState !== 'running'), 3000);
          await tick(100);
          expect(atRest(), 'leaving a lower shelf returns every book to rest');
          // Search: live filtering, best match first, accent and Turkish i tolerant.
          const box = $<HTMLInputElement>('.library-search input')!;
          expect(box.placeholder === 'Search books...' && !!$('.start-hero .library-search') && !!$('.library-search .search-mark'), 'the search box sits in the library header');
          const type = async (q: string) => { box.value = q; box.dispatchEvent(new Event('input', { bubbles: true })); await tick(120); };
          const names = () => cards().map((c) => c.dataset['name']);
          const countText = () => $('.shelf-count')!.textContent ?? '';
          await type('shelf book');
          const shelfBooks = names().filter((n) => n?.startsWith('Shelf Book')).length;
          expect(cards().length === shelfBooks && shelfBooks === 55 && countText() === `55 of ${total} books` && !$('.shelf .new-book'), `typing filters the shelf (${cards().length} shown, "${countText()}")`);
          expect(rowsOf().length > 1, 'the filtered shelf still wraps onto several shelves');
          await type('sehir');
          expect(names().join() === 'Şehir Masalları', `"sehir" finds Şehir (${names().join()})`);
          await type('istanbul');
          expect(names().join() === 'İSTANBUL Gecesi', `"istanbul" finds İSTANBUL (${names().join()})`);
          await type('ILIK');
          expect(names().join() === 'Ilık Rüzgar', `"ILIK" finds Ilık (${names().join()})`);
          await type('kervan');
          expect(names().join() === 'Ilık Rüzgar', `a word from the description finds the book (${names().join()})`);
          await type('emile bronte');
          expect(names().join() === 'Northern Tales', `the author matches without accents (${names().join()})`);
          await type('fjords');
          expect(names().join() === 'Northern Tales', `the subtitle matches (${names().join()})`);
          await type('glass');
          expect(names().join() === 'The Glass Garden,Shelf Book 006', `a title match comes before a description match (${names().join()})`);
          await type('zzqx');
          expect(cards().length === 0 && !!$('.shelf-empty') && /No book on the shelf matches/.test($('.shelf-empty')!.textContent ?? '') && countText() === `0 of ${total} books`, 'nothing matching shows a friendly empty state');
          $<HTMLButtonElement>('.shelf-empty button')!.click();
          expect(await until(() => cards().length === total && !$('.shelf-empty') && !!$('.shelf .new-book') && box.value === ''), 'Clear search in the empty state brings every book back');
          await type('shelf');
          $<HTMLButtonElement>('.library-search .search-clear')!.click();
          expect(await until(() => cards().length === total && box.value === '' && countText() === `${total} books`), 'the clear button restores all books');
          await type('shelf');
          box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          expect(await until(() => cards().length === total && box.value === ''), 'Escape clears the search');
          box.blur();
          document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
          expect(document.activeElement === box, '/ focuses the search');
          box.blur();
          document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
          expect(document.activeElement === box, 'Ctrl+F focuses the search');
          await window.lore.smokeShow(false);
          // The sample world: one match, Enter opens it, and it loads with its story.
          await type('camelamamm');
          expect(names().join() === 'Camelamamm' && /Press Enter/.test($('.shelf-hint')!.textContent ?? ''), `one match for the sample world (${names().join()})`);
          box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          expect(await until(() => !!$('.home') && document.title.startsWith('Camelamamm'), 8000), 'Enter opens the only matching book: Camelamamm loads');
          dom['camelTiles'] = count('.home .entry-tile');
          expect(dom['camelTiles'] >= 20, `Camelamamm's home shows its entries (${dom['camelTiles']})`);
        }
      } catch (e) {
        fails.push(String((e as Error).stack ?? e));
      }
      // A console error fails the smoke run in the main process.
      if (fails.length) console.error(`smoke checks failed: ${fails.join(' | ')}`);
      window.lore.smokeReport({ ...summary, dom });
    });
  }, [open]);

  const analysis = useStoryAnalysis(world);
  const warnings = useMemo(() => {
    if (!world) return [];
    const base = checkWorld(world, builtinRules);
    return analysis?.warnings.length ? sortWarnings([...base, ...analysis.warnings]) : base;
  }, [world, analysis]);

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

  /** Several entries changed together (a link edited on a graph): update them at once and write their files now. */
  const writeEntries = (changed: Entry[]): void => {
    if (!world || !dir || !changed.length) return;
    const by = new Map(changed.map((e) => [e.id, e]));
    const files = { ...world.files };
    for (const e of changed) files[e.id] = world.files[e.id] ?? entryPath(e);
    setWorld({ ...world, entries: world.entries.map((e) => by.get(e.id) ?? e), files });
    for (const e of changed) {
      const path = files[e.id]!;
      schedule(e.id, () => window.lore.writeFile(dir, path, serializeEntry(e)));
      void flush(e.id);
    }
  };

  /** Add a new entry and write its file; `show` opens it in the editor. */
  const addEntry = (entry: Entry, show: boolean): void => {
    if (!world || !dir) return;
    const path = entryPath(entry);
    setWorld({ ...world, entries: [...world.entries, entry], files: { ...world.files, [entry.id]: path } });
    if (show) {
      setSelectedId(entry.id);
      setView('editor');
    }
    schedule(entry.id, () => window.lore.writeFile(dir, path, serializeEntry(entry)));
  };

  const createEntry = (type: EntryType, name: string): void => {
    if (!world) return;
    addEntry(blankEntry(type, newEntryId(type, name, new Set(world.entries.map((e) => e.id))), name), true);
  };

  /** Deletes ask first (ConfirmDialog); this is what the dialog's button does. */
  const [doomed, setDoomed] = useState<{ kind: 'entry'; entry: Entry } | { kind: 'chapter'; file: string } | null>(null);
  const deleteEntry = async (entry: Entry): Promise<void> => {
    if (!world || !dir) return;
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

  // ---------------------------------------------------------------------------------------- the story
  const story = sortChapters(world?.story ?? []);

  /** Replace chapters (same file names) and write each changed one. */
  const saveChapters = (changed: StoryChapter[], all = story): void => {
    if (!world || !dir) return;
    const by = new Map(changed.map((c) => [c.file, c]));
    const next = all.map((c) => by.get(c.file) ?? c);
    for (const c of changed) if (!all.some((x) => x.file === c.file)) next.push(c);
    setWorld({ ...world, story: sortChapters(next) });
    for (const c of changed) schedule(`story:${c.file}`, () => window.lore.writeFile(dir, c.file, serializeChapter(c)));
  };

  const createChapter = (): void => {
    const order = Math.max(0, ...story.map((c) => c.order)) + 1;
    const title = `Chapter ${story.length + 1}`;
    const ch: StoryChapter = { file: chapterPath(order, title, story.map((c) => c.file)), title, order, body: '' };
    saveChapters([ch]);
    transition(() => { setChapterFile(ch.file); setReveal(undefined); setView('story'); });
    setTimeout(() => document.querySelector<HTMLInputElement>('.story-title')?.select(), 50);
  };

  /** Swap a chapter with its neighbour; orders are renumbered 1..n, file names stay. */
  const moveChapter = (file: string, step: -1 | 1): void => {
    const list = [...story];
    const i = list.findIndex((c) => c.file === file);
    const j = i + step;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    const renumbered = list.map((c, k) => ({ ...c, order: k + 1 }));
    saveChapters(renumbered.filter((c) => story.find((x) => x.file === c.file)!.order !== c.order), renumbered);
  };

  const deleteChapter = async (file: string): Promise<void> => {
    const ch = story.find((c) => c.file === file);
    if (!world || !dir || !ch) return;
    clearTimeout(timers.current.get(`story:${file}`));
    pending.current.delete(`story:${file}`);
    const rest = story.filter((c) => c.file !== file);
    setWorld({ ...world, story: rest });
    setChapterFile(rest[Math.max(0, story.indexOf(ch) - 1)]?.file ?? null);
    await window.lore.deleteFile(dir, file);
  };

  const setIgnored = (ignored: StoryIgnore[]): void => {
    if (!world || !dir) return;
    setWorld({ ...world, storyIgnored: ignored });
    schedule(STORY_IGNORED_FILE, () => window.lore.writeFile(dir, STORY_IGNORED_FILE, serializeStoryIgnored(ignored)));
  };

  const storyActions: StoryActions = {
    onChange: (ch) => saveChapters([ch]),
    onOpen: (id) => transition(() => { setSelectedId(id); setView('editor'); }),
    onAdd: (p: Proposal) => {
      if (!world) return;
      const target = p.matchedExistingId ? world.entries.find((e) => e.id === p.matchedExistingId) : undefined;
      if (p.kind === 'update' && target) {
        updateEntry(applyFields(target, p.fields, world));
        toasts.push({ tone: 'ok', text: `Updated ${target.name}`, action: { label: 'Open', run: () => storyActions.onOpen(target.id) } });
        return;
      }
      const entry = proposalEntry(p, world, new Set(world.entries.map((e) => e.id)));
      addEntry(entry, false);
      toasts.push({ tone: 'ok', text: `Added ${entry.name} (${TYPE_SINGULAR[entry.type].toLowerCase()})`, action: { label: 'Open', run: () => storyActions.onOpen(entry.id) } });
    },
    onMerge: (p, id) => {
      const target = world?.entries.find((e) => e.id === id);
      if (!world || !target) return;
      // Merging only fills gaps: what the entry already says stays; the proposal's name becomes an alias.
      const t = target as Entry & Record<string, unknown>;
      const f: ProposalFields = { ...p.fields };
      for (const k of ['born', 'died', 'date', 'place', 'status'] as const) if (t[k] !== undefined && t[k] !== '') delete f[k];
      if (target.details?.['title'] ?? target.extra?.['title']) delete f.title;
      for (const k of ['occupation', 'gender'] as const) if (target.details?.[k]) delete f[k];
      const known = new Set([target.name, ...(target.aliases ?? [])].map(normalizeName));
      if (!known.has(normalizeName(p.name))) f.aliases = [...(f.aliases ?? []), p.name];
      updateEntry(applyFields(target, f, world));
      toasts.push({ tone: 'ok', text: `Merged “${p.name}” into ${target.name}` });
    },
    onIgnore: (ps) => {
      if (!world) return;
      const have = new Set((world.storyIgnored ?? []).map((i) => i.key));
      const today = new Date().toISOString().slice(0, 10);
      setIgnored([...(world.storyIgnored ?? []), ...ps.filter((p) => !have.has(p.key)).map((p) => ({ key: p.key, name: p.name, ignoredAt: today }))]);
      toasts.push({ tone: 'ok', text: ps.length === 1 ? `Ignored ${ps[0]!.name}` : `Ignored ${ps.length} proposals` });
    },
    onRestore: (key) => world && setIgnored((world.storyIgnored ?? []).filter((i) => i.key !== key)),
    onJump: (span) => world && jump(storyFact(world, span)),
    onSearch: (text) => transition(() => { setQuery(text); setView('editor'); }),
  };

  const jump = (fact: FactRef): void => {
    if (isStoryFact(fact) && fact.chapter) {
      const chapter = fact.chapter;
      const [start, end] = fact.span ?? [0, 0];
      transition(() => { setChapterFile(chapter); setView('story'); setReveal({ start, end, n: performance.now() }); });
      return;
    }
    if (!world?.entries.some((e) => e.id === fact.entryId)) return;
    setSelectedId(fact.entryId);
    setView('editor');
    // After render, scroll to the field and focus its first input.
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(fact.field)}"]`) ?? document.querySelector<HTMLElement>(`[data-field="${CSS.escape(fact.field.replace(/\[\d+\]$/, ''))}"]`);
      if (!el) return document.getElementById('entry-title')?.focus();
      const closed = el.closest('details:not([open])') as HTMLDetailsElement | null;
      if (closed) closed.open = true;
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

  /** Back to the library: write what is pending, then close the world (Back returns to it). */
  const closeWorld = () => flush().then(() => { setWorld(null); setDir(null); dirRef.current = null; setSettings(false); setDoomed(null); document.title = 'Lore-Forge'; });

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
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        document.getElementById('search')?.focus();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void flush().then(() => toasts.push({ tone: 'ok', text: 'All changes saved' }));
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        transition(() => setView('home'));
      } else if (mod && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        const next = (['editor', 'timeline', 'relations', 'story'] as const)[Number(e.key) - 1]!;
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
      toasts.push({ tone: 'ok', text: `${label} saved: ${r.pages} pages (plus a .md copy)${r.notes?.length ? `. ${r.notes.join(' ')}` : ''}`, action: { label: 'Show in folder', run: () => void window.lore.showInFolder(r.pdf) } });
    } catch (e) {
      toasts.push({ tone: 'error', text: `${label} failed: ${(e as Error).message}` });
    }
  };
  const saveDocx = async (options: PublishOptions) => {
    try {
      await flush();
      const r = await window.lore.exportDocx(dir, options);
      if (!r) return;
      setPreview(null);
      toasts.push({ tone: 'ok', text: 'Story Book saved for Word. Word fills in the contents page numbers when it opens the file.', action: { label: 'Show in folder', run: () => void window.lore.showInFolder(r.docx) } });
    } catch (e) {
      toasts.push({ tone: 'error', text: `Word export failed: ${(e as Error).message}` });
    }
  };
  const saveBook = async (book: BookSettings) => {
    try {
      const saved = await window.lore.saveBook(dir, book);
      setWorld((w) => {
        if (!w) return w;
        const { book: _old, ...manifest } = w.manifest;
        return { ...w, manifest: Object.keys(saved).length ? { ...manifest, book: saved } : manifest };
      });
    } catch (e) {
      toasts.push({ tone: 'error', text: `Could not save the book details: ${(e as Error).message}` });
    }
  };
  const saveCalendar = async (calendar: Calendar): Promise<boolean> => {
    try {
      const saved = await window.lore.saveCalendar(dir, calendar);
      setWorld((w) => (w ? { ...w, manifest: { ...w.manifest, calendar: saved } } : w));
      toasts.push({ tone: 'ok', text: 'Calendar saved' });
      return true;
    } catch (e) {
      toasts.push({ tone: 'error', text: `Could not save the calendar: ${(e as Error).message}` });
      return false;
    }
  };
  const saveCover = async (cover: WorldCoverSettings, picked?: string) => {
    const saved = await window.lore.saveCover(dir, cover, picked);
    setWorld((w) => {
      if (!w) return w;
      const { cover: _old, ...manifest } = w.manifest;
      return { ...w, manifest: Object.keys(saved).length ? { ...manifest, cover: saved } : manifest };
    });
    toasts.push({ tone: 'ok', text: 'Cover saved' });
  };
  const openEntry = (id: string) => transition(() => { setSelectedId(id); setView('editor'); });
  const goView = (v: View, mode?: RelationMode) => transition(() => { if (mode) setRelMode(mode); setReveal(undefined); setView(v); });

  const selected = world.entries.find((e) => e.id === selectedId);
  const goHome = (to: 'timeline' | 'tree' | 'web' | 'codex' | 'book') => (to === 'codex' || to === 'book' ? setPreview(to) : to === 'timeline' ? goView('timeline') : goView('relations', to));
  const tabs: [View, IconName, string][] = [['home', 'house', 'Home'], ['editor', 'quill-ink', 'Editor'], ['timeline', 'hourglass', 'Timeline'], ['relations', 'spider-web', 'Relationships'], ['story', 'feather', 'Story']];
  return (
    <WorldDir.Provider value={dir}>
    <ErasLink.Provider value={() => setSettings(true)}>
    <div class="app" style={{ '--sidebar-w': `${sidebarW}px` }}>
      <Aura calm />
      <header class="topbar">
        <div class="world-title">
          {/* Always the way out to the library; Alt+Left and mouse button 4 still step back through history. */}
          <button type="button" class="ghost icon-only nav-back" onClick={() => void closeWorld()} aria-label="Back to the library" title="Back to the library"><Icon name="plain-arrow" class="point-left" /></button>
          <h1>
            <button type="button" class="world-home-btn" onClick={() => goView('home')} aria-current={view === 'home' ? 'page' : undefined} title="World home: cover, counts, timeline, family tree and more">
              <span class="mini-book" aria-hidden="true">
                <span class="mini-page" />
                <span class="mini-cover"><WorldBookCover dir={dir} world={world} /></span>
              </span>
              <span class="world-name">{world.manifest.name}</span>
            </button>
          </h1>
        </div>
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
          <SaveIndicator save={save} />
          <button type="button" class="ghost small icon-only top-settings" aria-haspopup="dialog" onClick={() => setSettings(true)} aria-label="World settings" title="World settings: calendar, eras and months"><Icon name="cog" /></button>
        </div>
      </header>
      {view === 'story' ? (
        <ChapterList chapters={story} current={chapterFile} warnings={warnings} onCreate={createChapter} onMove={moveChapter} onDelete={(f) => setDoomed({ kind: 'chapter', file: f })}
          onSelect={(f) => transition(() => { setChapterFile(f); setReveal(undefined); })} />
      ) : (
      <Sidebar entries={world.entries} warnings={warnings} selectedId={selectedId} query={query} onQuery={setQuery} onSelect={(id) => transition(() => { setSelectedId(id); if (view === 'timeline' || view === 'home') setView('editor'); })} onCreate={createEntry} creating={creating} onCreating={setCreating} />
      )}
      <PaneResizer width={sidebarW} onWidth={setSidebarW} />
      <main class={`main${view === 'story' ? ' main-story' : view === 'timeline' ? ' main-fill' : ''}`} id="main">
        {view === 'editor' &&
          (selected ? (
            <EntryEditor key={selected.id} dir={dir} world={world} entry={selected} warnings={warnings.filter((w) => involves(w, selected.id))} actions={actions} onChange={updateEntry} onDelete={() => setDoomed({ kind: 'entry', entry: selected })} onOpen={openEntry} />
          ) : (
            <div class="empty-state">
              <Icon class="empty-icon" name={world.entries.length ? 'pointing' : 'world'} />
              <p>{world.entries.length ? 'Pick an entry on the left to edit it.' : 'This world is empty. Start with a character, a place or an event: use “+ New” on the left.'}</p>
            </div>
          ))}
        {view === 'home' && <WorldHome dir={dir} world={world} warnings={warnings} onOpen={openEntry} onGo={goHome} onChange={updateEntry} onCoverSave={saveCover} onSettings={() => setSettings(true)} onReload={() => void flush().then(() => open(dir))} onLibrary={() => void closeWorld()} />}
        {view === 'timeline' && <TimelineView world={world} warnings={warnings} selectedId={selectedId} onOpen={openEntry} />}
        {view === 'story' && (() => {
          const chapter = story.find((c) => c.file === chapterFile) ?? story[0];
          const empty: StoryAnalysis = { proposals: [], ignored: [], links: [], extraction: { proposals: [], appearances: [] }, warnings: [] };
          return <StoryView key={chapter?.file ?? 'none'} world={world} chapter={chapter} analysis={analysis ?? empty} warnings={warnings} reveal={reveal} actions={storyActions} onCreate={createChapter} />;
        })()}
        {view === 'relations' && <RelationsView world={world} entry={selected} mode={relMode} onMode={setRelMode} onOpen={(id) => setSelectedId(id)} onWrite={writeEntries} />}
      </main>
      <WarningsPanel warnings={warnings} selectedId={selectedId} actions={actions} />
      {preview && <PreviewDialog dir={dir} world={world} kind={preview} onClose={() => setPreview(null)} onSave={savePdf} onSaveDocx={saveDocx} onSaveBook={saveBook} />}
      {doomed?.kind === 'entry' && (
        <ConfirmDialog title={`Delete “${doomed.entry.name}”?`} confirmLabel="Delete entry" onClose={() => setDoomed(null)} onConfirm={() => deleteEntry(doomed.entry).then(() => setDoomed(null))}
          subject={<div class="confirm-world"><Portrait entry={doomed.entry} size="md" /><div><strong class="confirm-name">{doomed.entry.name}</strong><span class="muted">{TYPE_SINGULAR[doomed.entry.type]} · {world.files[doomed.entry.id]}</span></div></div>}>
          <p>Removes this entry's file from the world folder. Links to it from other entries will show as warnings.</p>
        </ConfirmDialog>
      )}
      {doomed?.kind === 'chapter' && (() => {
        const ch = story.find((c) => c.file === doomed.file);
        return ch && (
          <ConfirmDialog title={`Delete “${ch.title}”?`} confirmLabel="Delete chapter" onClose={() => setDoomed(null)} onConfirm={() => deleteChapter(ch.file).then(() => setDoomed(null))}
            subject={<div class="confirm-world"><span class="confirm-chapter" aria-hidden="true"><Icon name="feather" /></span><div><strong class="confirm-name">{ch.title}</strong><span class="muted">{ch.body.trim() ? `${ch.body.trim().split(/\s+/).length} words` : 'Empty'} · {ch.file}</span></div></div>}>
            <p>Removes this chapter's file from the story folder. Entries added from it stay.</p>
          </ConfirmDialog>
        );
      })()}
      {settings && <WorldSettings world={world} onSave={saveCalendar} onClose={() => setSettings(false)} />}
      <ToastStack toasts={toasts.toasts} dismiss={toasts.dismiss} />
    </div>
    </ErasLink.Provider>
    </WorldDir.Provider>
  );
}
