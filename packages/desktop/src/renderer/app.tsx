import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  analyzeStory, applyFields, builtinRules, chapterPath, check, checkWorld, DEFAULT_STATUS, entryPath, LIFECYCLE, familyTree, INTENDED_FILE, isStoryFact, newEntryId, normalizeName, parseWorld,
  proposalEntry, relationWeb, searchEntries, eraUsage, worldCoverArt, serializeChapter, serializeEntry, serializeIntended, serializeStoryIgnored, sortChapters, sortWarnings, STORY_IGNORED_FILE, storyFact, timelineModel, TYPE_SINGULAR, WorldIndex,
  type BookSettings, type Calendar, type Entry, type EntryType, type FactRef, type IconName, type Proposal, type ProposalFields, type StoryAnalysis, type StoryChapter, type StoryIgnore, type Warning, type World, type WorldCoverSettings,
} from '@lore-forge/core';
import type { PdfKind, PublishOptions } from '../shared/api.ts';
import { EntryEditor } from './components/editor.tsx';
import { RelationsView, type RelationMode } from './components/relations.tsx';
import { Sidebar } from './components/sidebar.tsx';
import { DuplicateBook, StartScreen } from './components/start.tsx';
import { Tour, type TourStep } from './components/tour.tsx';
import { UpdateToast } from './components/updates.tsx';
import { viewers } from './components/models.tsx';
import { TimelineView } from './components/timeline.tsx';
import { PreviewDialog, previewDoc, sheetsOf } from './components/preview.tsx';
import { ToastStack, useToasts } from './components/toasts.tsx';
import { involves, WarningsPanel, type WarningActions } from './components/warnings.tsx';
import { Icon } from './components/icon.tsx';
import { Aura } from './components/aura.tsx';
import { ErasLink, WorldSettings } from './components/world-settings.tsx';
import { transition } from './motion.ts';
import { sameWarnings, useEvent, useSame, useSettledWorld } from './hooks.ts';
import { WorldHome } from './components/home.tsx';
import { forgetImages, Portrait, portraitFile, WorldBookCover, WorldDir } from './components/cover.tsx';
import { ConfirmDialog } from './components/confirm.tsx';
import { PaneResizer, SaveIndicator, sidebarMax, useSidebarWidth, type SaveState } from './components/chrome.tsx';
import { ChapterList, StoryView, type StoryActions } from './components/story.tsx';

type View = 'home' | 'editor' | 'timeline' | 'relations' | 'story';

const SAVE_DELAY_MS = 400;
/** Story analysis waits this long after the last keystroke in a chapter. */
const STORY_DELAY_MS = 300;
/** Pause in typing in an entry after which the story analysis runs again. */
const CHECK_DELAY_MS = 250;

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
      const popupFit = async (what: string, boxSel: string, mainSel: string, opts: { centred?: boolean; width?: [number, number] } = {}) => {
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
          // Centred on both axes (within 2px), and a comfortable width for its size.
          if (opts.centred && (Math.abs(r.left + r.width / 2 - innerWidth / 2) > 2 || Math.abs(r.top + r.height / 2 - innerHeight / 2) > 2)) bad.push(`${width}x${height}: the popup (${px(r)}) is not centred`);
          if (opts.width && (r.width < opts.width[0] || r.width > opts.width[1])) bad.push(`${width}x${height}: the popup is ${Math.round(r.width)}px wide, not ${opts.width[0]}-${opts.width[1]}`);
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
        // Eras and open warnings are chips like the entry counts; no warnings means no chip, and the old text line is gone.
        {
          const eras = w.manifest.calendar.eras.length, open = check(w).filter((x) => !x.intended).length;
          const era = $('.home-stats .t-era a'), warn = $('.home-stats .home-warn a');
          expect(!$('.home-facts') && !/no warnings|\d+ eras? ·/.test($('.home-intro')?.textContent ?? ''), 'the old "eras · warnings" line is gone');
          expect(!!era && era.textContent?.trim() === `${eras} Eras` && !!era.querySelector('.icon') && era.previousElementSibling === null && era.parentElement?.previousElementSibling?.classList.contains('t-note') === true, `an Eras chip after Notes (${era?.textContent})`);
          expect(open ? !!warn && warn.querySelector('strong')?.textContent === String(open) && /Warnings?$/.test(warn.textContent?.trim() ?? '') : !warn, `a warnings chip only when there are open warnings (${open}, chip ${warn?.textContent ?? 'none'})`);
          const chipH = (a: Element | null) => a?.getBoundingClientRect().height ?? 0;
          expect(Math.abs(chipH(era) - chipH($('.home-stats .t-note a'))) < 1 && (!warn || Math.abs(chipH(warn) - chipH(era)) < 1), 'the Eras and Warnings chips match the other chips');
          if (warn) { warn.click(); await tick(); expect(document.activeElement?.id === 'warnings-title', 'the warnings chip opens the warnings'); }
        }
        expect(paneFit().length === 0, `home layout: ${paneFit().join('; ')}`);
        const leyla = w.entries.find((e) => e.id === 'char-leyla') ?? w.entries.find((e) => e.type === 'character');
        if (leyla) {
          setSelectedId(leyla.id);
          setView('editor');
          await tick();
          // Renaming an entry to another's name warns straight away, in the entry and in the Warnings panel, while
          // the field still has focus; putting the name back clears it.
          {
            const other = w.entries.find((e) => e.id !== leyla.id)!;
            const nameIn = $<HTMLInputElement>('.editor [data-field="name"] input')!;
            const dup = () => [...document.querySelectorAll('.live-warnings li')].filter((li) => li.textContent?.includes(`"${other.name}" names both`)).length;
            const summary = () => $('.warnings-panel .summary')?.textContent ?? '';
            const before = summary();
            nameIn.focus();
            nameIn.value = other.name;
            nameIn.dispatchEvent(new Event('input', { bubbles: true }));
            expect(await until(() => dup() > 0 && summary() !== before, 150), `renaming to "${other.name}" warns at once, while typing (${summary()})`);
            nameIn.value = leyla.name;
            nameIn.dispatchEvent(new Event('input', { bubbles: true }));
            nameIn.blur();
            // (The panel's list animates removed rows out, so its counts are what is checked here.)
            expect(await until(() => dup() === 0 && summary() === before, 500), `putting the name back clears the warning (${before} before, ${summary()} after)`);
          }
          dom['editorMentions'] = count('.prose-mirror mark.mention');
          dom['statusPills'] = count('.lifecycle [role=radio]');
          expect(count('.lifecycle [role=radio] svg.icon') === dom['statusPills'], 'status pills have icons');
          await document.fonts.load('700 16px Cinzel', 'Şafak İlsa');
          expect(portraitFile(leyla) ? !!$('#entry-title > .portrait') && !$('#entry-title > .title-icon') : !!$('#entry-title > .title-icon'), 'the editor title shows the entry\'s round picture when it has one, else its type icon');
          {
            const plain = w.entries.find((e) => !portraitFile(e));
            if (plain) {
              setSelectedId(plain.id);
              expect(await until(() => $('#entry-title')?.textContent?.includes(plain.name) === true && !!$('#entry-title > .title-icon') && !$('#entry-title > .portrait')), `an entry without a picture keeps its type icon by the title (${plain.name})`);
              setSelectedId(leyla.id);
              await until(() => $('#entry-title')?.textContent?.includes(leyla.name) === true);
            }
          }
          dom['cinzel'] = document.fonts.check('700 16px Cinzel', 'Şafak') && getComputedStyle($('#entry-title')!).fontFamily.includes('Cinzel') ? 1 : 0;
          expect(dom['cinzel'] === 1, 'Cinzel headings load');
          expect(emojiIn($('.lifecycle')).length + emojiIn($('.editor-head')).length === 0, 'no emoji in the editor');
          dom['relationSelects'] = count('[data-field^="relations"] button.select[role=combobox]');
          expect(count('select') === 0 && count('.select .select-chevron') >= dom['relationSelects']!, 'dropdowns are the custom Select, with a chevron');
          // Status: exactly one is always selected; clicking the selected one keeps it.
          {
            const edge = (el: Element) => { const c = getComputedStyle(el); return parseFloat(c.borderLeftWidth) > parseFloat(c.borderTopWidth); };
            const lc = $('.lifecycle')!;
            expect(!edge(lc) && !!lc.querySelector('legend > svg.icon'), 'Status and dates is a card without a coloured edge rail, its legend has an icon');
            const railed = [...document.querySelectorAll('.editor .entry-chip, .editor .warning, .editor fieldset')].filter(edge);
            expect(railed.length === 0, `no coloured edge rails in the entry editor (${railed.map((e) => e.className).join(', ')})`);
            expect(parseFloat(getComputedStyle($('.editor')!).borderTopWidth) === 0, 'the editor has no coloured strip along its top');
            expect(count('.editor-head .editor-meta .meta-chip code') === 1 && $('.editor-head .meta-chip-path')?.textContent === w.files?.[leyla.id], 'the id and file show as chips under the title');
          }
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
          {
            const card = document.querySelector<SVGRectElement>('.family-tree .node rect');
            expect(count('.family-tree .node-stripe') === 0 && !!card && parseFloat(getComputedStyle(card).strokeWidth) <= 1.5, `family tree cards have no coloured stripe or thick border (${card ? getComputedStyle(card).strokeWidth : 'none'})`);
          }
          // Every line starts and ends on a card's border (within 2px), in the family tree and in the web.
          const offBorder = (p: DOMPoint, r: DOMRect) => {
            const ox = Math.max(r.left - p.x, 0, p.x - r.right), oy = Math.max(r.top - p.y, 0, p.y - r.bottom);
            return ox || oy ? Math.hypot(ox, oy) : Math.min(p.x - r.left, r.right - p.x, p.y - r.top, r.bottom - p.y);
          };
          const ends = (path: SVGGeometryElement) => {
            const m = path.getScreenCTM()!, len = path.getTotalLength();
            return [path.getPointAtLength(0), path.getPointAtLength(len)].map((p) => new DOMPoint(p.x, p.y).matrixTransform(m)) as [DOMPoint, DOMPoint];
          };
          const attached = (edges: Element[], line: (g: Element) => SVGGeometryElement | null, box: (id: string) => Element | null, from: string, to: string) => {
            const bad: string[] = [];
            for (const g of edges) {
              const path = line(g), a = box(g.getAttribute(from)!), b = box(g.getAttribute(to)!);
              if (!path || !a || !b) { bad.push(`${g.getAttribute(from)}->${g.getAttribute(to)}: missing`); continue; }
              const [p1, p2] = ends(path);
              const d1 = offBorder(p1, a.getBoundingClientRect()), d2 = offBorder(p2, b.getBoundingClientRect());
              if (d1 > 2 || d2 > 2) bad.push(`${g.getAttribute(from)}->${g.getAttribute(to)}: ${d1.toFixed(1)}/${d2.toFixed(1)}px`);
            }
            return bad;
          };
          {
            const treeEdges = [...document.querySelectorAll('.family-tree .edges > g[data-from]')];
            const bad = attached(treeEdges, (g) => g.querySelector<SVGGeometryElement>('.edge'), (id) => $(`.family-tree [data-node-id="${CSS.escape(id)}"] > rect`), 'data-from', 'data-to');
            expect(bad.length === 0, `family tree lines end on the cards' borders (${treeEdges.length} lines): ${bad.join('; ')}`);
            dom['treeEdges'] = treeEdges.length;
          }
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
            await tick(400);
            const webEdges = [...document.querySelectorAll('.relation-web .web-edge')];
            const bad = attached(webEdges, (g) => g.querySelector<SVGGeometryElement>('path.edge'), (id) => $(`.relation-web .react-flow__node[data-id="${CSS.escape(id)}"]`), 'data-source', 'data-target');
            expect(webEdges.length > 0 && bad.length === 0, `every web link starts and ends on a card's border, within 2px (${webEdges.length} links): ${bad.join('; ')}`);
            const labels = [...document.querySelectorAll<SVGGElement>('.relation-web .edge-label-group')];
            expect(labels.length > 0 && labels.every((l) => !!l.querySelector('.edge-label-bg')), 'web link labels sit on the line, on a backing');
            expect([...document.querySelectorAll<HTMLElement>('.relation-web .web-handle')].every((h) => getComputedStyle(h).visibility === 'hidden'), 'the web cards show no handle dots');
            const railed = [...document.querySelectorAll<HTMLElement>('.relation-web .web-node')].filter((n) => { const c = getComputedStyle(n); return c.boxShadow.includes('inset') || parseFloat(c.borderLeftWidth) > 1.5; });
            expect(count('.relation-web .web-node') > 0 && railed.length === 0, `web cards have no coloured left rail or thick border (${railed.length})`);
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
          expect(JSON.stringify(tabLabels) === JSON.stringify(['Home', 'Editor', 'Timeline', 'Relationships', 'Story']) && !!gear?.querySelector('svg') && gear.getAttribute('aria-label') === 'World settings' && gear.querySelector('.btn-label')?.textContent === 'World settings',
            `the view tabs, and World settings as a gear with its name in the top-right actions: ${JSON.stringify(tabLabels)}`);
          {
            // The words show on wide windows and fold away on narrow ones, where the tooltip and the accessible name stay.
            const shown = (b: Element | null) => (b?.querySelector('.btn-label')?.getBoundingClientRect().width ?? 0) > 0;
            const was = [innerWidth, innerHeight] as const;
            for (const [width, height, wide] of [[2560, 1440, true], [1920, 1080, true], [1280, 720, true], [1024, 640, false]] as const) {
              await window.lore.smokeResize(width, height);
              await until(() => innerWidth === width, 2000);
              window.dispatchEvent(new Event('resize'));
              await tick(150);
              expect(shown(gear) === wide && shown(back) === wide && !!gear!.title && !!back!.title && gear!.getAttribute('aria-label') === 'World settings',
                `at ${width}px the World settings and Library buttons ${wide ? 'show their names' : 'fold to icons with a tooltip'}`);
              // One bar: a single row, every control the same height on one centre line, the views centred (when the
              // sides leave room), World settings at the far right, nothing overlapping.
              const bar = $('.topbar')!.getBoundingClientRect();
              const parts = ['.topbar .nav-back', '.topbar .tabs', '.topbar .publish-actions', '.topbar .top-settings'].map((q) => $(q)!.getBoundingClientRect());
              const [b, t, p, g] = parts as [DOMRect, DOMRect, DOMRect, DOMRect];
              const mid = (r: DOMRect) => r.top + r.height / 2;
              const sameLine = parts.every((r) => Math.abs(mid(r) - mid(t)) <= 1 && Math.abs(r.height - t.height) <= 1);
              const order = b.right <= t.left && t.right <= p.left && p.right <= g.left && g.right <= bar.right && bar.right - g.right < 24;
              const centred = width < 1900 || Math.abs(t.left + t.width / 2 - bar.width / 2) <= 2;
              const tabsShown = [...document.querySelectorAll('.topbar .tabs .tab-label')].every((l) => l.getBoundingClientRect().width > 0);
              expect(bar.height < t.height * 2 + 4 && sameLine && order && centred && tabsShown && document.documentElement.scrollWidth <= innerWidth,
                `at ${width}px the top bar is one row: same height and centre line ${sameLine}, in order ${order}, views centred ${centred}, view names shown ${tabsShown} (bar ${Math.round(bar.height)}px, views ${Math.round(t.height)}px)`);
              const icon = $('.topbar .tabs .v-relations .icon')!;
              expect(getComputedStyle(icon).color !== getComputedStyle($('.topbar .tabs .v-story .icon')!).color && getComputedStyle($('.topbar .p-codex .icon')!).color !== getComputedStyle($('.topbar .p-book .icon')!).color,
                'each view and each export has its own accent colour');
            }
            await window.lore.smokeResize(was[0], was[1]);
            await until(() => innerWidth === was[0], 2000);
            window.dispatchEvent(new Event('resize'));
            await tick(150);
          }
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
          expect(!/saved in world\.json/.test($('.world-settings .dialog-head')?.textContent ?? ''), 'World settings has no "The calendar of …, saved in world.json" line');
          await popupFit('World settings (eras)', '.world-settings', '.ws-save', { centred: true });
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
        {
          // Images | 3D model: the test cube goes into models/<entry-id>/, renders, renames and deletes.
          const tab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.media-tab')].find((b) => b.textContent?.trim() === label);
          expect(!!tab('Images') && !!tab('3D model') && tab('Images')!.getAttribute('aria-selected') === 'true' && !!$('.ref-images'), 'entries have Images | 3D model tabs, Images first');
          tab('3D model')!.click();
          expect(await until(() => !!$('.models-empty')), 'an entry without models shows the empty 3D model tab');
          const model = await window.lore.smokeImportModel(d, target.id);
          tab('Images')!.click();
          await until(() => !!$('.ref-images'));
          tab('3D model')!.click();
          expect(await until(() => count('.model-chip') === 1 && !!$('.model-stage')), `the imported model is listed (${model})`);
          expect(await until(() => !!$('.model-stage.is-ready, .model-stage.is-error'), 20000) && !!$('.model-stage.is-ready'), `the 3D viewer loads the test cube: ${$('.model-error')?.textContent ?? ''}`);
          const view = viewers.get($('.model-viewer')!);
          await tick(300);
          const probe = view?.probe();
          dom['modelTriangles'] = probe?.triangles ?? 0;
          dom['modelPixels'] = probe?.drawn ?? 0;
          expect(!!probe && probe.meshes === 1 && probe.triangles === 12 && probe.drawn > 500, `the cube is drawn (${JSON.stringify(probe)})`);
          expect(count('script[src="./viewer.js"]') === 1 && !!$('.model-viewer canvas'), 'three.js is loaded on demand, once, into a canvas');
          const spin = [...document.querySelectorAll<HTMLButtonElement>('.model-tools button')].find((b) => b.textContent?.includes('Auto-rotate'))!;
          spin.click();
          expect(await until(() => spin.getAttribute('aria-pressed') === 'true'), 'auto-rotate turns on');
          [...document.querySelectorAll<HTMLButtonElement>('.model-tools button')].find((b) => b.textContent?.includes('Reset view'))!.click();
          [...document.querySelectorAll<HTMLButtonElement>('.models-bar button')].find((b) => b.textContent?.includes('Rename'))!.click();
          const input = await until(() => !!$('.model-rename input')) && $<HTMLInputElement>('.model-rename input')!;
          if (input) {
            input.value = 'Gold cube';
            $<HTMLFormElement>('.model-rename')!.requestSubmit();
          }
          expect(await until(() => ($('.model-chip-name')?.textContent ?? '') === 'Gold cube'), 'a model can be renamed');
          const listed = await window.lore.listModels(d, target.id);
          expect(listed.length === 1 && listed[0]!.file === `models/${target.id}/Gold cube.glb`, `the renamed file keeps its extension (${listed[0]?.file})`);
          [...document.querySelectorAll<HTMLButtonElement>('.models-bar button')].find((b) => b.textContent?.includes('Delete'))!.click();
          expect(await until(() => !!$('.confirm-dialog')), 'deleting a model asks first');
          $<HTMLButtonElement>('.confirm-dialog .confirm-go')!.click();
          expect(await until(() => !!$('.models-empty') && !$('.confirm-dialog')), 'the model is deleted');
          expect((await window.lore.listModels(d, target.id)).length === 0, 'the model file is gone');
          tab('Images')!.click();
          await until(() => !!$('.ref-images'));
        }
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
          const scale = () => $('.tl-scroll')?.dataset['ppy'] ?? '';
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
          {
            // Mid-drag the lanes are not drawn again: one CSS offset moves them, and the drop draws them in place.
            const held = firstLeft();
            $('.tl-lane .tl-track')!.dispatchEvent(new MouseEvent('mousedown', { ...at, button: 0 }));
            for (let i = 1; i <= 30; i++) window.dispatchEvent(new MouseEvent('mousemove', { ...at, clientX: at.clientX - i * 2 }));
            const pan = parseFloat(tl.style.getPropertyValue('--pan'));
            expect(firstLeft() === held && Math.abs(pan) > 20, `a pan moves the drawn lanes by an offset, without re-rendering (left ${held} -> ${firstLeft()}, offset ${pan}px)`);
            window.dispatchEvent(new MouseEvent('mouseup', { ...at, clientX: at.clientX - 60 }));
            expect(await until(() => firstLeft() !== held && parseFloat(tl.style.getPropertyValue('--pan') || '0') === 0), 'the drop draws the lanes at their new place and clears the offset');
          }
          $<HTMLButtonElement>('.tl-fit')!.click();
          expect(await until(() => scale() === before), 'timeline Fit restores the scale');
          expect(count('.tl-mark') === dom['timelineMarks'], 'every lane still drawn after zooming');
          // Panning stops at the first and last year (24px pad), at every zoom and window size; a span narrower
          // than the track stays pinned to its start. Drag, Shift+wheel and a sideways swipe all far past both ends.
          const edges = () => ({ from: Number(tl.dataset['from']), to: Number(tl.dataset['to']), view: tl.clientWidth - ($('.tl-label')?.offsetWidth ?? 0) });
          const drag = async (dx: number) => {
            const tr = $('.tl-lane .tl-track')!.getBoundingClientRect();
            const p = { clientX: tr.left + tr.width / 2, clientY: tr.top + 10, bubbles: true, view: window };
            $('.tl-lane .tl-track')!.dispatchEvent(new MouseEvent('mousedown', { ...p, button: 0 }));
            for (let i = 1; i <= 4; i++) window.dispatchEvent(new MouseEvent('mousemove', { ...p, clientX: p.clientX + (dx * i) / 4 }));
            window.dispatchEvent(new MouseEvent('mouseup', { ...p, clientX: p.clientX + dx }));
          };
          const wheel = (dx: number, shift: boolean) => tl.dispatchEvent(new WheelEvent('wheel', { ...(shift ? { deltaY: -dx, shiftKey: true } : { deltaX: -dx }), clientX: r.left + r.width / 2, clientY: r.top + 80, bubbles: true, cancelable: true, view: window }));
          const near = (a: number, b: number) => Math.abs(a - b) <= 2;
          /** After a resize the span may run past the track's end, but no empty space may open on either side. */
          const filled = async (how: string) => {
            const ok = () => { const e = edges(); return e.to - e.from <= e.view - 48 ? near(e.from, 24) : e.from <= 26 && e.to >= e.view - 26; };
            const good = await until(ok);
            const e = edges();
            expect(good, `${how}, no empty space past either end (from ${e.from}, to ${e.to}, track ${e.view})`);
          };
          const clamped = async (how: string, side: 'start' | 'end') => {
            await tick(120);
            const e = edges();
            const fits = e.to - e.from <= e.view - 48;
            const ok = side === 'start' || fits ? near(e.from, 24) : near(e.to, e.view - 24);
            expect(ok, `${how} past the ${side} stops at the ${fits ? 'pinned start' : side} (from ${e.from}, to ${e.to}, track ${e.view})`);
          };
          for (const [zoomName, clicks] of [['fit', 0], ['zoomed in', 3], ['zoomed out', -3]] as const) {
            $<HTMLButtonElement>('.tl-fit')!.click();
            await tick(80);
            for (let i = 0; i < Math.abs(clicks); i++) { $<HTMLButtonElement>(clicks > 0 ? '.tl-zoom-in' : '.tl-zoom-out')!.click(); await tick(40); }
            await drag(20000); await clamped(`${zoomName}: dragging`, 'start');
            await drag(-20000); await clamped(`${zoomName}: dragging`, 'end');
            wheel(20000, true); await clamped(`${zoomName}: Shift+wheel`, 'start');
            wheel(-20000, true); await clamped(`${zoomName}: Shift+wheel`, 'end');
            wheel(20000, false); await clamped(`${zoomName}: a sideways swipe`, 'start');
            wheel(-20000, false); await clamped(`${zoomName}: a sideways swipe`, 'end');
          }
          // Zooming out stops where the span fills the track: no empty time past the first or last year, with the
          // button or Ctrl+wheel.
          {
            $<HTMLButtonElement>('.tl-fit')!.click();
            await tick(80);
            const fitPpy = Number(scale());
            const inside = (how: string) => {
              const e = edges();
              expect(near(e.from, 24) && near(e.to, e.view - 24) && Math.abs(Number(scale()) - fitPpy) <= fitPpy * 0.001, `${how} stays inside the first and last year (from ${e.from}, to ${e.to}, track ${e.view}, ${scale()} vs ${fitPpy} px/year)`);
            };
            for (let i = 0; i < 4; i++) { $<HTMLButtonElement>('.tl-zoom-out')!.click(); await tick(40); }
            await tick(120);
            inside('zoom out from Fit');
            for (let i = 0; i < 2; i++) { $<HTMLButtonElement>('.tl-zoom-in')!.click(); await tick(40); }
            await drag(-20000); await tick(80);
            for (let i = 0; i < 4; i++) { $<HTMLButtonElement>('.tl-zoom-out')!.click(); await tick(40); }
            await tick(120);
            inside('zoom out from the end, zoomed in');
            tl.dispatchEvent(new WheelEvent('wheel', { deltaY: 3000, ctrlKey: true, clientX: r.left + r.width * 0.8, clientY: r.top + 80, bubbles: true, cancelable: true, view: window }));
            await tick(160);
            inside('Ctrl+wheel zoom out');
          }
          $<HTMLButtonElement>('.tl-fit')!.click();
          await tick(80);
          for (let i = 0; i < 3; i++) { $<HTMLButtonElement>('.tl-zoom-in')!.click(); await tick(40); }
          await drag(-20000); await clamped('zoomed in again, dragging', 'end');
          // Zoomed in and parked at the end: a wider window pulls the end back to the track's edge.
          for (const [width, height] of [[1280, 720], [2560, 1440]] as const) {
            await window.lore.smokeResize(width, height);
            for (let i = 0; i < 40 && (window.innerWidth !== width || window.innerHeight !== height); i++) await tick(50);
            await tick(200);
            await filled(`resized to ${width}x${height} while parked at the end`);
            await drag(20000); await clamped(`at ${width}x${height}, dragging`, 'start');
            await drag(-20000); await clamped(`at ${width}x${height}, dragging`, 'end');
          }
          $<HTMLButtonElement>('.tl-fit')!.click();
          await tick(120);
          // The Gantt: an era ribbon and column per era, plain group titles, wide bars with icon,
          // title and dates.
          const tlm = timelineModel(w, check(w))!;
          expect(count('.tl-era') === tlm.eras.length && count('.tl-band') === tlm.eras.length && tlm.eras.length > 0, `an era ribbon and column per era (${count('.tl-era')}, ${count('.tl-band')} of ${tlm.eras.length})`);
          expect(count('.tl-strip') === 0 && count('.tl-group-head .tl-track > *') === 0, 'group titles carry no strip lines');
          expect(!!$('.tl-bar .tl-bar-body .icon') && !!$('.tl-bar .tl-bar-title') && !!$('.tl-bar.has-dates .tl-bar-dates'), 'wide bars show an icon, a title and their dates');
          expect([...document.querySelectorAll<HTMLElement>('.tl-bar')].every((b) => b.offsetHeight >= 30), 'bars are tall enough for a title and dates');
          // Zoomed in far enough, the axis names the calendar's months under the years.
          const monthNames = new Set((w.manifest.calendar.months ?? []).map((m) => m.name));
          for (let i = 0; i < 30 && !$('.tl-head .tl-label')?.textContent?.includes('months'); i++) { $<HTMLButtonElement>('.tl-zoom-in')!.click(); await tick(30); }
          await tick(120);
          const minorText = [...document.querySelectorAll('.tl-axis .tl-tick:not(.is-major)')].map((t) => t.textContent ?? '');
          expect(monthNames.size > 0 && minorText.some((t) => monthNames.has(t)), `months on the axis when zoomed in (${minorText.slice(0, 4).join(', ')})`);
          // The overview: its frame covers everything at Fit; a click or drag in it, or Home/End, moves the view,
          // and it never goes past the first or last year.
          $<HTMLButtonElement>('.tl-fit')!.click();
          await tick(120);
          const mini = $('.tl-mini')!;
          const frame = () => $('.tl-mini-view')!.getBoundingClientRect();
          const mr = () => mini.getBoundingClientRect();
          expect(!!mini && frame().width >= mr().width * 0.9, `the overview frame covers the whole span at Fit (${Math.round(frame().width)} of ${Math.round(mr().width)}px)`);
          // Right after Fit, dragging the overview's frame (or anywhere in it) far past either end moves nothing out
          // of the first and last year.
          {
            const m = mr(), y = m.top + m.height / 2;
            for (const [at, to] of [[0.5, 1.6], [0.5, -0.6], [0.2, 3], [0.95, -2]] as const) {
              $<HTMLButtonElement>('.tl-fit')!.click();
              await tick(80);
              mini.dispatchEvent(new PointerEvent('pointerdown', { clientX: m.left + m.width * at, clientY: y, button: 0, pointerId: 9, bubbles: true }));
              for (let i = 1; i <= 6; i++) mini.dispatchEvent(new PointerEvent('pointermove', { clientX: m.left + m.width * (at + ((to - at) * i) / 6), clientY: y, pointerId: 9, bubbles: true }));
              await tick(120);
              const e = edges();
              const ok = near(e.from, 24) && near(e.to, e.view - 24) && Math.abs(frame().left - mr().left) <= 3 && Math.abs(frame().right - mr().right) <= 3;
              mini.dispatchEvent(new PointerEvent('pointerup', { clientX: m.left + m.width * to, clientY: y, pointerId: 9, bubbles: true }));
              await tick(120);
              const after = edges();
              expect(ok && near(after.from, 24) && near(after.to, after.view - 24), `after Fit, dragging the overview from ${at} to ${to} stays inside the first and last year (from ${e.from}, to ${e.to}, track ${e.view}; after ${after.from}..${after.to}; frame ${Math.round(frame().left)}..${Math.round(frame().right)} of ${Math.round(mr().left)}..${Math.round(mr().right)})`);
            }
          }
          for (let i = 0; i < 4; i++) { $<HTMLButtonElement>('.tl-zoom-in')!.click(); await tick(40); }
          await tick(120);
          expect(frame().width < mr().width * 0.5, 'the overview frame shrinks when zoomed in');
          const press = (at: number, to = at) => {
            const m = mr(), x = (f: number) => m.left + m.width * f, y = m.top + m.height / 2;
            mini.dispatchEvent(new PointerEvent('pointerdown', { clientX: x(at), clientY: y, button: 0, pointerId: 7, bubbles: true }));
            mini.dispatchEvent(new PointerEvent('pointermove', { clientX: x(to), clientY: y, pointerId: 7, bubbles: true }));
            mini.dispatchEvent(new PointerEvent('pointerup', { clientX: x(to), clientY: y, pointerId: 7, bubbles: true }));
          };
          press(0.995); await clamped('a click at the end of the overview', 'end');
          expect(Math.abs(frame().right - mr().right) <= 3, `the overview frame sits at the end (${Math.round(frame().right)} vs ${Math.round(mr().right)})`);
          press(0.5, -2); await clamped('dragging the overview', 'start');
          expect(Math.abs(frame().left - mr().left) <= 3, `the overview frame sits at the start (${Math.round(frame().left)} vs ${Math.round(mr().left)})`);
          press(0.5); await tick(120);
          const mid = edges();
          expect(mid.from < 24 - 10 && mid.to > mid.view - 24 + 10, `a click in the middle of the overview shows the middle (from ${mid.from}, to ${mid.to})`);
          mini.focus();
          mini.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
          await clamped('End in the overview', 'end');
          mini.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
          await clamped('Home in the overview', 'start');
          const fromBefore = edges().from;
          mini.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
          expect(await until(() => edges().from < fromBefore - 20), 'ArrowRight in the overview moves later');
          mini.blur();
          $<HTMLButtonElement>('.tl-fit')!.click();
          await tick(120);
          // The toolbar carries no hint line and no scale readout.
          expect(!$('.timeline .view-head p') && !$('.tl-scale') && !/px per year|dated entries/.test($('.timeline')!.textContent ?? ''), 'the timeline has no hint line and no px-per-year readout');
          // Type chips: on by default; off hides that type's group, on brings it back.
          {
            const chip = $<HTMLButtonElement>('.type-filters .tl-chip.t-character')!;
            expect(!!chip && chip.getAttribute('aria-pressed') === 'true' && !!$('.tl-group.t-character'), 'the Characters chip starts on');
            chip.click();
            expect(await until(() => !$('.tl-group.t-character') && chip.getAttribute('aria-pressed') === 'false'), 'turning the Characters chip off hides the characters');
            chip.click();
            expect(await until(() => !!$('.tl-group.t-character') && chip.getAttribute('aria-pressed') === 'true'), 'turning it on brings them back');
          }
          // Entries with a picture show it: a tall picture card for a span, a round picture for a moment.
          expect(await until(() => !!$('.tl-mark.has-image')), 'entries with a picture show it on the timeline');
          {
            const card = $<HTMLElement>('.tl-bar.has-image');
            expect(!card || (card.offsetHeight >= 70 && card.closest('.tl-lane')!.classList.contains('is-tall')), `a picture card is tall, in a tall lane (${card?.offsetHeight}px)`);
            const plain = $<HTMLElement>('.tl-bar:not(.has-image)');
            expect(!plain || plain.offsetHeight >= 40, `cards are tall enough for a title and dates (${plain?.offsetHeight}px)`);
          }
          // Stacked layout: each type's entries packed side by side on as few rows as fit, none overlapping, every one
          // still drawn and reachable from the keyboard; Lanes brings one lane per entry back.
          {
            $<HTMLButtonElement>('.tl-layout-stacked')!.click();
            expect(await until(() => !!$('.tl-stack-row')), 'Stacked packs the entries into rows');
            const rows = [...document.querySelectorAll<HTMLElement>('.tl-stack-row')];
            expect(count('.tl-mark') === dom['timelineMarks'] && rows.length < dom['timelineMarks']!, `Stacked keeps every entry on fewer rows (${count('.tl-mark')} marks on ${rows.length} rows)`);
            const clash = rows.flatMap((row) => {
              const rs = [...row.querySelectorAll<HTMLElement>(':scope .tl-mark')].map((m) => m.getBoundingClientRect()).sort((a, b) => a.left - b.left);
              return rs.slice(1).filter((b, i) => b.left < rs[i]!.right - 1).map(() => row);
            });
            expect(clash.length === 0, `no two entries overlap on a stacked row (${clash.length})`);
            expect(count('.tl-stack-row .tl-mark[tabindex="0"]') === dom['timelineMarks'], 'stacked entries are keyboard stops');
            $<HTMLButtonElement>('.tl-layout-lanes')!.click();
            expect(await until(() => !$('.tl-stack-row') && count('.tl-lane') === dom['timelineMarks']), 'Lanes brings one lane per entry back');
          }
        }
        {
          // The timeline fills the pane down to the bottom, at each window size.
          for (const [width, height] of [[1280, 720], [2560, 1440], [1920, 1080]] as const) {
            await window.lore.smokeResize(width, height);
            for (let i = 0; i < 40 && (window.innerWidth !== width || window.innerHeight !== height); i++) await tick(50);
            await tick(150);
            const gap = $('.main')!.getBoundingClientRect().bottom - $('.tl-frame')!.getBoundingClientRect().bottom;
            expect(gap >= 0 && gap <= 32, `timeline at ${width}x${height} reaches the bottom of the pane (gap ${Math.round(gap)}px)`);
          }
        }
        // The Eras chip on the world home opens the Timeline.
        setView('home');
        {
          const era = (await until(() => !!$('.home-stats .t-era a'))) ? $('.home-stats .t-era a') : null;
          era?.click();
          expect(await until(() => !!$('.main-fill .tl-scroll') && !$('.home')), 'the Eras chip opens the Timeline');
          await tick(150);
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
            expect(count('.preview .doc-front-title') === 1 && count('.preview .doc-front-half-title') === 0, 'a title page, no half-title');
            expect(count('.preview .doc-front-copyright') === 0, 'no copyright page when there is no copyright text or publisher');
            // The cover keeps its page shape (it used to shrink to a strip) and carries the book title.
            const cv = $('.preview .sheet-cover.has-art')!.getBoundingClientRect();
            expect(cv.height > cv.width * 1.3 && !!$('.preview .sheet-cover-text .sheet-title'), `the cover sheet keeps its page shape and shows the title (${Math.round(cv.width)}x${Math.round(cv.height)})`);
            expect(count('.preview .doc-opener') > 0 && count('.preview .doc-dropcap') > 0, 'chapter openers with a drop cap');
            // The chapter date is at the top right of the opener, above its label.
            const stamp = $('.preview .doc-stamp');
            expect(!!stamp && getComputedStyle(stamp).textAlign === 'right' && stamp.getBoundingClientRect().bottom <= $('.preview .doc-opener')!.getBoundingClientRect().top + 1, 'the chapter date sits at the top right, above the title');
            // Raised initial (the default): no indent, on the first line's baseline, flush with the rest of its word.
            const capP = $('.preview .doc-dropcap')!;
            const cap = capP.querySelector<HTMLElement>('.doc-cap')!;
            const after = document.createRange();
            const firstText = cap.nextSibling!;
            after.setStart(firstText, 0);
            after.setEnd(firstText, 1);
            const capBox = cap.getBoundingClientRect(), nextBox = after.getBoundingClientRect();
            expect(capP.classList.contains('cap-raised') && getComputedStyle(capP).textIndent === '0px', `the first paragraph has no indent (${getComputedStyle(capP).textIndent})`);
            expect(Math.abs(nextBox.left - capBox.right) < 2.5, `no gap after the raised initial (${(nextBox.left - capBox.right).toFixed(1)} px)`);
            expect(capBox.height > nextBox.height * 2 && Math.abs(capBox.bottom - nextBox.bottom) < capBox.height * 0.25, 'the raised initial is big and stands on the first line');
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
            // The style bar: every change shows in the pages at once and is saved in world.json "book".
            expect(!!$('.preview .book-toolbar[aria-label="Book style"]') && count('.preview .book-toolbar .bt-group') === 5, 'the Story Book style bar has its five groups');
            const sheetFont = () => parseFloat(getComputedStyle($('.preview .sheet.is-print:not(.is-front)')!).fontSize);
            const before = sheetFont();
            const size = $<HTMLInputElement>('.preview input[name="book-body-size"]')!;
            typeInto(size, '13');
            expect(await until(() => sheetFont() > before * 1.15), `a bigger text size shows in the pages (${before} -> ${sheetFont()} px)`);
            expect(await bookOnDisk((ws) => ws.manifest.book?.bodySize === 13), 'the text size is saved in world.json');
            const color = $<HTMLInputElement>('.preview input[name="book-chapter-color"]')!;
            typeInto(color, '#7a1f3d');
            expect(await until(() => getComputedStyle($('.preview .doc-opener')!).color === 'rgb(122, 31, 61)'), 'the chapter title colour shows at once');
            expect(await choose($('.preview .chapter-font-select')!, 'Cinzel Decorative'), 'a chapter title font can be chosen');
            expect(await until(() => getComputedStyle($('.preview .doc-opener')!).fontFamily.includes('Cinzel Decorative')), 'the chapter title font shows at once');
            ($('.preview .bt-cap-dropped') as HTMLButtonElement).click();
            expect(await until(() => !!$('.preview .doc-dropcap.cap-dropped .doc-cap') && getComputedStyle($('.preview .doc-cap')!).getPropertyValue('initial-letter').startsWith('2')), 'Dropped: a two-line initial');
            ($('.preview .bt-cap-none') as HTMLButtonElement).click();
            expect(await until(() => count('.preview .doc-dropcap') === 0), 'None: no initial');
            ($('.preview .bt-dates') as HTMLButtonElement).click();
            expect(await until(() => count('.preview .doc-stamp') === 0), 'hiding the dates removes them from the pages');
            expect(await bookOnDisk((ws) => ws.manifest.book?.dropCap === 'none' && ws.manifest.book?.dateStamps === false && ws.manifest.book?.chapterFont === 'Cinzel Decorative' && ws.manifest.book?.chapterColor === '#7a1f3d'), 'the style is saved in world.json');
            ($('.preview .bt-reset') as HTMLButtonElement).click();
            expect(await until(() => count('.preview .doc-stamp') > 0 && count('.preview .doc-dropcap.cap-raised') > 0), 'Reset style brings back the dates and the raised initial');
            expect(await bookOnDisk((ws) => ['bodySize', 'chapterColor', 'chapterFont', 'dropCap', 'dateStamps'].every((k) => !(k in (ws.manifest.book ?? {}))) && ws.manifest.book?.trim === 'a5'), 'Reset style clears the look from world.json and keeps the other book settings');
            expect(await choose($('.preview .trim-select')!, 'a4'), 'A4 can be chosen');
            expect(await until(() => count('.preview .sheet.trim-a4') > 0 && !!$('.preview .sheet-cover.trim-a4')), 'A4 reshapes the pages and the cover');
            expect(await choose($('.preview .trim-select')!, 'a5'), 'back to A5');
            expect(await bookOnDisk((ws) => ws.manifest.book?.trim === 'a5'), 'A5 saved again');
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
        {
          const cur = $('.story-chapters .chapter-link[aria-current="page"]');
          expect(!!cur && !getComputedStyle(cur).boxShadow.includes('inset') && getComputedStyle(cur).borderTopColor === getComputedStyle(cur).borderLeftColor, `the open chapter is a tile without an edge rail (${cur ? getComputedStyle(cur).boxShadow : 'none open'})`);
        }
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
        await popupFit('picture and icon picker', '.picture-editor', '.picture-editor .dialog-actions .primary', { centred: true });
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
          await popupFit('relationship dialog', '.link-dialog', '.link-dialog .link-save', { centred: true });
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
        {
          const rails = [...document.querySelectorAll<HTMLElement>('.type-group')].filter((g) => parseFloat(getComputedStyle(g).borderLeftWidth) > parseFloat(getComputedStyle(g).borderTopWidth));
          const cur = $('.type-group .entry-link[aria-current="page"]');
          expect(rails.length === 0 && (!cur || !getComputedStyle(cur).boxShadow.includes('inset')), `sidebar groups and the open entry have no coloured edge rail (${rails.length} groups, ${cur ? getComputedStyle(cur).boxShadow : 'none open'})`);
          // "+ New" can be closed without creating anything: Escape, ×, leaving it empty, or a click outside.
          {
            const total = () => worldRef.current?.entries.length ?? -1;
            const had = total();
            const open = async () => { $<HTMLButtonElement>('.type-group.t-place .type-head button')!.click(); return until(() => document.activeElement?.id === 'new-place'); };
            const gone = (how: string) => until(() => !$('.new-entry')).then((ok) => expect(ok && total() === had, `${how} closes "+ New" without adding an entry`));
            expect(await open(), '"+ New" opens a name box, focused');
            document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            await gone('Escape');
            await open();
            $<HTMLButtonElement>('.new-entry-cancel')!.click();
            await gone('the × button');
            expect(await open(), 'opened again, the name box is focused again');
            // (A hidden smoke window gets no real blur, so the event is sent: focusout, which onBlur listens to.)
            $<HTMLInputElement>('#new-place')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
            await gone('leaving the empty box');
            await open();
            typeInto($<HTMLInputElement>('#new-place')!, 'Half a name');
            $('.sidebar .search')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            await gone('a click outside (with a name typed)');
          }
          const groups = [...document.querySelectorAll<HTMLElement>('.type-group')];
          expect(groups.length > 0 && groups.every((g) => getComputedStyle(g).backgroundImage !== 'none' && parseFloat(getComputedStyle(g).borderTopWidth) > 0 && parseFloat(getComputedStyle(g.querySelector('.type-head')!).borderBottomWidth) > 0), 'each sidebar type group is a soft panel with a hairline under its heading');
        }
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
          const runeShapes = new Set([...document.querySelectorAll('.scene .rune path')].map((p) => p.getAttribute('d')));
          const runeSizes = new Set([...document.querySelectorAll<HTMLElement>('.scene .rune')].map((r) => r.style.getPropertyValue('--k')));
          expect(count('.scene .rune') >= 24 && count('.scene .rune') <= 30 && count('.scene .rune.is-sigil') >= 4 && count('.scene .is-glyph') === 0 && runeShapes.size >= 24 && runeSizes.size >= 5,
            `only runes drift in the library, many different ones in varied sizes, capped (${count('.scene .rune')} runes, ${runeShapes.size} shapes, ${runeSizes.size} sizes, ${count('.scene .rune.is-sigil')} sigils, ${count('.scene .is-glyph')} writing things)`);
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
        await popupFit('New book', '.library-dialog', '.create-book button[type="submit"]', { centred: true });
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
          {
            const cover = $('.create-preview .world-cover')!.getBoundingClientRect(), spine = $('.create-preview .create-spine')!.getBoundingClientRect();
            expect(cover.height > 100 && Math.abs(spine.height - cover.height) <= 2 && Math.abs(spine.bottom - cover.bottom) <= 2, `the new book's spine is as tall as its cover (${Math.round(spine.height)} vs ${Math.round(cover.height)}px)`);
          }
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
        await popupFit('Book cover editor', '.cover-editor', '.cover-save', { centred: true });
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
          {
            // Title and emblem places: X/Y numbers and sliders, clamped so both stay inside the gold frame at every
            // corner; a drag on the preview moves the emblem and stops at the border; Reset position goes back.
            const frame = () => { const c = $('.cover-editor-preview .world-cover')!.getBoundingClientRect(); const k = c.width / 240; return { l: c.left + 16 * k, t: c.top + 16 * k, r: c.right - 16 * k, b: c.bottom - 16 * k }; };
            const inside = (sel: string) => { const f = frame(), el = $(sel); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= f.l - 0.5 && r.right <= f.r + 0.5 && r.top >= f.t - 0.5 && r.bottom <= f.b + 0.5; };
            const setNum = (sel: string, v: number) => { const i = $<HTMLInputElement>(sel)!; i.value = String(v); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new FocusEvent('blur')); i.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); };
            const num = (sel: string) => $<HTMLInputElement>(sel)!.valueAsNumber;
            expect(!!$('.cover-editor .position-title .position-x') && !!$('.cover-editor .position-emblem .position-y-number') && $<HTMLButtonElement>('.cover-editor .position-title .position-reset')!.disabled, 'the Title and Emblem groups have X/Y sliders and numbers, and Reset position is off until a place is chosen');
            for (const [x, y] of [[0, 0], [100, 100], [0, 100], [100, 0], [-40, 250]] as const) {
              for (const which of ['title', 'emblem']) {
                setNum(`.position-${which} .position-x-number`, x);
                await tick();
                setNum(`.position-${which} .position-y-number`, y);
                await tick();
              }
              await tick(60);
              expect(inside('.cover-editor-preview .cover-title.is-placed') && inside('.cover-editor-preview .cover-emblem'), `title and emblem stay inside the frame at X ${x}, Y ${y}`);
            }
            expect(num('.position-title .position-x-number') === 0 && num('.position-title .position-y-number') === 100, `positions outside 0 to 100 are clamped (title ${num('.position-title .position-x-number')}, ${num('.position-title .position-y-number')}; emblem ${num('.position-emblem .position-x-number')}, ${num('.position-emblem .position-y-number')})`);
            $<HTMLButtonElement>('.cover-editor .position-emblem .position-reset')!.click();
            await tick();
            expect($<HTMLButtonElement>('.cover-editor .position-emblem .position-reset')!.disabled, 'Reset position puts the emblem back');
            const g = $('.cover-editor-preview .cover-emblem')!;
            const gr = g.getBoundingClientRect();
            const pointer = (target: Element, type: string, x: number, y: number) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 }));
            pointer(g, 'pointerdown', gr.left + gr.width / 2, gr.top + gr.height / 2);
            pointer($('.cover-editor-preview')!, 'pointermove', gr.left + 2000, gr.top + gr.height / 2 + 10);
            pointer($('.cover-editor-preview')!, 'pointerup', gr.left + 2000, gr.top + gr.height / 2 + 10);
            await tick(60);
            expect(num('.position-emblem .position-x-number') === 100 && inside('.cover-editor-preview .cover-emblem'), `dragging the emblem far right stops it at the border (X ${num('.position-emblem .position-x-number')})`);
            setNum('.position-title .position-x-number', 20);
            await tick();
            setNum('.position-title .position-y-number', 30);
            await tick();
          }
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
          await popupFit('unsaved changes confirm', '.confirm-dialog', '.confirm-go', { centred: true });
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
        {
          const c = (await fromDisk()).manifest.cover ?? {};
          expect(c.titlePos?.x === 20 && c.titlePos.y === 30 && c.emblemPos?.x === 100, `title and emblem places are saved to world.json: ${JSON.stringify({ t: c.titlePos, e: c.emblemPos })}`);
          const home = $('.home-cover .world-cover')!.getBoundingClientRect(), t = $('.home-cover .cover-title.is-placed')?.getBoundingClientRect();
          const k = home.width / 240;
          expect(!!t && t.left >= home.left + 16 * k - 0.5 && t.top >= home.top + 16 * k - 0.5 && t.left < home.left + home.width / 2 && t.top < home.top + home.height / 2, 'world home draws the title at its saved place, inside the frame');
        }
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
          const lastBook = [...document.querySelectorAll('.shelf .world-card')].filter((c) => (c as HTMLElement).offsetTop === ($('.shelf .world-card') as HTMLElement).offsetTop).pop()!.getBoundingClientRect();
          expect(first.left - shelfBox.left <= 24, `the first book starts at the left edge of the shelf (${Math.round(first.left - shelfBox.left)}px in)`);
          {
            // Rows run the full width: a row that wraps leaves no more than one book's room (plus the space kept for
            // a cover to open at the end of the row) on its right.
            const firstTop = ($('.shelf .world-card') as HTMLElement).offsetTop;
            const wraps = [...document.querySelectorAll<HTMLElement>('.shelf .world-card')].some((c) => c.offsetTop > firstTop);
            const pr = parseFloat(getComputedStyle($('.library .shelf')!).paddingRight);
            if (wraps) expect(shelfBox.right - lastBook.right <= first.width + pr + 8, `full rows reach across the shelf (${Math.round(shelfBox.right - lastBook.right)}px left on the right, padding ${Math.round(pr)}px)`);
          }
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
              expect(zr.right <= shelfBox.right + 2 && zr.left >= shelfBox.left - 2, `a book at the right edge opens inside the shelf (${z.classList.contains('opens-left') ? 'to the left' : 'shifted'}, ${Math.round(shelfBox.right - zr.right)}px)`);
              z.dispatchEvent(new PointerEvent('pointerleave'));
              await until(() => count('.shelf .is-out') === 0);
              await tick(600);
              await settleAll();
            }
            // Reduced motion: no turn, the spine crossfades to a flat cover.
            const css = [...document.styleSheets].flatMap((sh) => [...sh.cssRules]).filter((x) => x instanceof CSSMediaRule && x.conditionText.includes('prefers-reduced-motion')).map((x) => x.cssText).join(' ');
            expect(/\.shelf-book\.is-out \.book-spine \{ opacity: 0; \}/.test(css) && /\.shelf-book\.is-out \.book-body \{ --turn: 0deg; \}/.test(css) && /\.shelf-book\.is-out \.book-pull, \.shelf-book\.is-out\.opens-left \.book-pull \{ transform: none; \}/.test(css), 'reduced motion crossfades instead of turning');
            // Keyboard focus (the unfocused smoke window gets no real focus events, so send them as Tab would). The
            // real pointer is parked off the shelf first: a book turning under it makes Chromium send pointer moves,
            // and a move over another book puts back a book that only these fake events focused.
            await window.lore.smokeMouse([{ type: 'move', x: 2, y: 2 }]);
            await tick(300);
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
        await popupFit('delete confirm', '.confirm-dialog', '.confirm-go', { centred: true });
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
          // Duplicate: the sample (read-only when installed) becomes an editable copy. Nothing opens: the copy lands
          // right after its original on the shelf and glows for a moment. From inside a world, Duplicate goes back
          // to the library and shows the copy the same way. A copy looks exactly like its original.
          const sampleDir = await window.lore.sampleWorld();
          const shelfKeys = () => [...document.querySelectorAll<HTMLElement>('.shelf .shelf-book:not(.new-book)')].map((c) => c.dataset['key']!);
          const bookOf = (k: string) => [...document.querySelectorAll<HTMLElement>('.shelf .shelf-book')].find((c) => c.dataset['key'] === k);
          const sampleBook = () => (sampleDir ? bookOf(sampleDir) : undefined);
          expect(!!sampleDir && !!sampleBook(), 'the sample world is on the shelf');
          sampleBook()!.dispatchEvent(new PointerEvent('pointerenter'));
          await until(() => sampleBook()!.classList.contains('is-out'));
          const dupBtn = sampleBook()!.querySelector<HTMLButtonElement>('.book-duplicate');
          expect(!!dupBtn && (dupBtn.getAttribute('aria-label') ?? '').startsWith('Duplicate'), 'books have a Duplicate button next to Delete');
          dupBtn!.click();
          expect(await until(() => $<HTMLInputElement>('#duplicate-name')?.value === 'Camelamamm (copy)'), 'Duplicate asks for a name, prefilled with "(copy)"');
          await popupFit('duplicate dialog', '.library-dialog', '.duplicate-book .primary', { centred: true });
          // The copy's first frame: its look when its book is put on the shelf (before it is painted) and on the next frame.
          const bookLook = (b: HTMLElement) => ['--h', '--w', '--d', '--spine', '--spine-ink'].map((v) => b.style.getPropertyValue(v)).join(' ');
          const firstFrame = (name: string) => new Promise<{ first: string; next: string }>((done) => {
            const seen = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('.shelf-book')].find((b) => b.dataset['name'] === name);
            const mo = new MutationObserver(() => {
              const b = seen(document);
              if (!b) return;
              mo.disconnect();
              const first = bookLook(b);
              requestAnimationFrame(() => done({ first, next: bookLook(b) }));
            });
            mo.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => { mo.disconnect(); done({ first: '', next: '' }); }, 15000);
          });
          const copyFrame = firstFrame('Camelamamm (copy)');
          $<HTMLFormElement>('.duplicate-book')!.requestSubmit();
          const freshKey = () => document.querySelector<HTMLElement>('.shelf .shelf-book[data-fresh]')?.dataset['key'];
          expect(await until(() => !$('.duplicate-book') && !!freshKey(), 15000), `the copy glows on the shelf: ${$('.duplicate-book .error-line')?.textContent ?? ''}`);
          const copy = freshKey()!;
          expect(!dirRef.current && !$('.home') && !!$('#library-shelf') && document.title === 'Lore-Forge', `duplicating does not open the copy (${document.title})`);
          expect(shelfKeys().indexOf(copy) === shelfKeys().indexOf(sampleDir!) + 1, `the copy sits right after its original (${shelfKeys().indexOf(sampleDir!)} and ${shelfKeys().indexOf(copy)})`);
          const settings = await window.lore.settings();
          const order = settings.shelfOrder ?? [];
          expect(order.indexOf(copy) === order.indexOf(sampleDir!) + 1 && order.indexOf(copy) > 0, 'that place is saved in the shelf order');
          expect((document.querySelector('.shelf-moved')?.textContent ?? '').includes('Made a copy'), 'the copy is announced');
          const peek = async (x: string) => { const files = await window.lore.peekWorld(x); return files ? parseWorld(files) : null; };
          const [orig, twin] = await Promise.all([peek(sampleDir!), peek(copy)]);
          expect(copy.startsWith(settings.worldsDir) && !!orig && !!twin && twin.manifest.id !== orig.manifest.id && twin.manifest.name === 'Camelamamm (copy)' && twin.entries.length === orig.entries.length,
            `the copy is a new world in the worlds folder with a new id and every entry (${copy})`);
          dom['duplicateEntries'] = twin?.entries.length ?? 0;
          expect(!!orig && !!twin && JSON.stringify(worldCoverArt(twin)) === JSON.stringify(worldCoverArt(orig)), 'the copy has the very same cover as its original');
          await tick(300);
          const spineLook = (k: string) => { const b = bookOf(k); return b ? ['--h', '--w', '--d', '--spine', '--spine-ink'].map((v) => b.style.getPropertyValue(v)).join(' ') : ''; };
          expect(!!spineLook(copy) && spineLook(copy) === spineLook(sampleDir!), `its book on the shelf looks the same: spine colours and size (${spineLook(copy)} vs ${spineLook(sampleDir!)})`);
          {
            const { first, next } = await copyFrame;
            const want = bookLook(sampleBook()!);
            expect(!!first && first === want && next === want, `the copy has its original's colours and size from its first frame (${first} / ${next} vs ${want})`);
          }
          expect(await until(() => !freshKey(), 5000), 'the glow fades after a moment');
          await tick(400);
          {
            // About 3 s on, nothing is left lit: no glow, no book out, no focus ring on a book.
            const why = (b: HTMLElement) => {
              const cs = getComputedStyle(b.querySelector('.book-spine')!);
              return [b.hasAttribute('data-fresh') && 'data-fresh', b.classList.contains('is-out') && 'out', cs.animationName !== 'none' && `animation ${cs.animationName}`, cs.outlineStyle !== 'none' && `outline ${cs.outlineStyle}`,
                !!b.querySelector(':focus-visible') && 'focus ring', cs.filter !== 'none' && `filter ${cs.filter}`].filter(Boolean).join('+');
            };
            const lit = [...document.querySelectorAll<HTMLElement>('.shelf .shelf-book:not(.new-book)')].filter((b) => why(b));
            expect(lit.length === 0, `no book stays highlighted after the copy is shown (${lit.map((b) => `${b.dataset['name']}: ${why(b)}`).join(', ')})`);
          }
          // From inside the copy: Duplicate goes back to the library.
          bookOf(copy)!.querySelector<HTMLElement>('.world-book')!.click();
          expect(await until(() => !!$('.home') && document.title.startsWith('Camelamamm (copy)'), 15000), `the copy opens from the shelf (${document.title})`);
          expect(count('.home-cover .cover-art') === 1, 'the copy keeps its cover');
          $<HTMLButtonElement>('.home-duplicate')!.click();
          expect(await until(() => $<HTMLInputElement>('#duplicate-name')?.value === 'Camelamamm (copy) (copy)'), 'world home has Duplicate too');
          const nameBox = $<HTMLInputElement>('#duplicate-name')!;
          nameBox.value = 'Smoke Twin';
          nameBox.dispatchEvent(new Event('input', { bubbles: true }));
          await tick();
          const twinFrame = firstFrame('Smoke Twin');
          $<HTMLFormElement>('.duplicate-book')!.requestSubmit();
          expect(await until(() => !$('.home') && !!$('#library-shelf') && bookOf(freshKey() ?? '')?.dataset['name'] === 'Smoke Twin', 15000), `duplicating from inside a world goes back to the library and shows the copy (${document.title})`);
          const twin2 = freshKey()!;
          {
            const { first, next } = await twinFrame;
            const want = bookLook(bookOf(copy)!);
            expect(!!first && first === want && next === want, `a copy made inside a world has the right colours from its first frame in the library (${first} / ${next} vs ${want})`);
          }
          expect(shelfKeys().indexOf(twin2) === shelfKeys().indexOf(copy) + 1 && !dirRef.current, 'that copy sits right after the world it was made from');
          // Tidy up: the copies would otherwise show up in the library tests below.
          for (const x of (await window.lore.listWorlds()).filter((x) => x !== sampleDir && /camelamamm|smoke.twin/i.test(x))) await window.lore.trashWorld(x);
          await window.lore.saveSettings({ shelfOrder: [] });
          window.dispatchEvent(new Event('focus'));
          await tick(300);
        }
        {
          // The sample can leave the library: Remove from library only hides it (nothing is deleted), and Show sample
          // world in Library settings brings it back. There is only ever one Camelamamm on the shelf.
          const sampleDir = await window.lore.sampleWorld();
          const sampleBook = () => [...document.querySelectorAll<HTMLElement>('.shelf .shelf-book')].find((c) => c.dataset['key'] === sampleDir);
          const camels = () => [...document.querySelectorAll<HTMLElement>('.shelf .shelf-book')].filter((c) => c.dataset['name'] === 'Camelamamm').length;
          expect(await until(() => !!sampleBook()) && camels() === 1, `one Camelamamm on the shelf (${camels()})`);
          const del = sampleBook()!.querySelector<HTMLButtonElement>('.book-delete');
          expect(!!del && /^Remove Camelamamm from the library$/.test(del.getAttribute('aria-label') ?? ''), `the sample has a Remove from library button (${del?.getAttribute('aria-label')})`);
          del!.click();
          expect(await until(() => /from the library\?/.test($('.confirm-dialog #confirm-title')?.textContent ?? '') && ($('.confirm-dialog .confirm-go')?.textContent ?? '').includes('Remove from library') && !/trash/i.test($('.confirm-dialog')?.textContent ?? '')),
            `removing the sample asks to remove it from the library, not to trash it (${$('.confirm-dialog #confirm-title')?.textContent})`);
          $<HTMLButtonElement>('.confirm-dialog .confirm-go')!.click();
          expect(await until(() => !sampleBook() && !$('.confirm-dialog'), 5000), 'Remove from library takes the sample off the shelf');
          expect((await window.lore.settings()).hideSample === true && (await window.lore.peekWorld(sampleDir!)) !== null && !(await window.lore.listWorlds()).includes(sampleDir!), 'the sample is only hidden: its folder stays');
          $<HTMLButtonElement>('.start-actions button[aria-label="Library settings"]')!.click();
          expect(await until(() => !!$('.library-settings .show-sample') && !$<HTMLInputElement>('.library-settings .show-sample')!.checked), 'Library settings shows the sample as hidden');
          $<HTMLInputElement>('.library-settings .show-sample')!.click();
          await tick();
          $<HTMLButtonElement>('.library-settings .settings-save')!.click();
          expect(await until(() => !$('.library-dialog') && !!sampleBook(), 5000), 'Show sample world puts the sample back on the shelf');
          expect(!(await window.lore.settings()).hideSample, 'Show sample world is saved');
        }
        {
          // The library's own dialogs fit too.
          $<HTMLButtonElement>('.start-actions button[aria-label="Library settings"]')!.click();
          expect(await until(() => !!$('.library-dialog')), 'Library settings opens');
          await popupFit('Library settings', '.library-dialog', '.library-dialog .dialog-actions .primary', { centred: true });
          {
            // Grouped sections with their labels in one column; the folder is a field with Browse…; Cancel and Save
            // sit at the bottom right, outside the scrolling body.
            const dlg = $('.library-settings')!;
            const heads = [...dlg.querySelectorAll('.settings-heading')].map((h) => h.textContent);
            expect(heads.join('|') === 'Where new worlds go|Sample world', `Library settings has two sections (${heads.join(', ')})`);
            const labels = [...dlg.querySelectorAll<HTMLElement>('.settings-row > .settings-label')].map((l) => Math.round(l.getBoundingClientRect().left));
            expect(new Set(labels).size === 1, `the settings labels line up (${labels.join(', ')})`);
            const input = $<HTMLInputElement>('.library-settings #worlds-dir')!, browse = $('.library-settings .folder-browse')!;
            expect(input.readOnly && input.value.length > 0 && browse.getBoundingClientRect().left >= input.getBoundingClientRect().right - 1 && Math.abs(browse.getBoundingClientRect().top - input.getBoundingClientRect().top) < 6, 'the folder is a field with Browse… beside it');
            const foot = $('.library-settings > .dialog-actions')!, save = $('.library-settings .settings-save')!, cancel = $('.library-settings .settings-cancel')!;
            const fr = foot.getBoundingClientRect(), sr = save.getBoundingClientRect(), cr = cancel.getBoundingClientRect();
            expect(!$('.library-settings .dialog-body')!.contains(foot) && fr.right - sr.right < 40 && cr.right <= sr.left + 1 && Math.abs(cr.top - sr.top) < 2, 'Cancel and Save sit together at the bottom right');
            // Show sample world off, then Cancel: nothing changes.
            $<HTMLInputElement>('.library-settings .show-sample')!.click();
            await tick();
            expect(/Unsaved/.test($('.library-settings .settings-status')!.textContent ?? ''), 'a change in Library settings is a draft until Save');
            cancel.click();
            await until(() => !$('.library-dialog'));
            expect(!(await window.lore.settings()).hideSample, 'Cancel leaves the settings as they were');
          }
          $<HTMLButtonElement>('.start-about')!.click();
          expect(await until(() => !!$('.about')), 'About opens from the library');
          await popupFit('library About', '.about', '.about-head button', { centred: true, width: [600, 820] });
          {
            // The credits are folded away but still there (the licences require them); the head stays put while the body scrolls.
            const box = $<HTMLDetailsElement>('.about .credits-box')!;
            expect(!!box && !box.open && /Credits and licences/.test(box.querySelector('summary')?.textContent ?? '') && count('.about .credits-box .credit') === 10, 'About folds the ten credits into a closed "Credits and licences" section');
            const firstInBody = $('.about .dialog-body')!.firstElementChild;
            expect(!!firstInBody?.classList.contains('updates') && !!$('.about .about-tour') && ($('.about .about-tour')!.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, 'Updates and the tour come first in About, the credits after');
            box.open = true;
            await tick(100);
            const cols = getComputedStyle($('.about .credits-box .credit')!).gridTemplateColumns.split(' ').length;
            expect(cols === 2 || innerWidth <= 700, `the credits are a two-column list (${cols})`);
            const head = $('.about .about-head')!.getBoundingClientRect().top;
            const body = $('.about .dialog-body')!;
            body.scrollTop = body.scrollHeight;
            await tick(50);
            const about = $('.about')!.getBoundingClientRect();
            expect(Math.abs($('.about .about-head')!.getBoundingClientRect().top - head) < 1 && about.bottom <= innerHeight + 1 && about.top >= -1, 'the open credits scroll inside About, under a fixed head, and About stays inside the window');
            expect(!$('.about .updates .small-print') && !/Updates replace only the app|new worlds go to|All releases/.test($('.about .updates')?.textContent ?? ''), 'Updates in About has no small print about worlds or all releases');
            box.open = false;
          }
          dom['credits'] = count('.about .credit');
          expect(($('.about')!.textContent ?? '').includes('CC BY 3.0') && ($('.about')!.textContent ?? '').includes('Open Font License'), 'About lists the icon and font licences');
          expect(/three\.js/.test($('.about')!.textContent ?? '') && /electron-updater/.test($('.about')!.textContent ?? ''), 'About credits three.js and electron-updater');
          const upd = await window.lore.updateState();
          expect(!!$('.about .updates') && ($('.updates-version')?.textContent ?? '').includes(upd.version) && !!$('.about .update-check') && !!$('.about .update-auto input') && !!$('.about .about-tour'),
            'About has Updates (version, Check now, the automatic switch) and Take the tour');
          expect(upd.status === 'off' && !!$<HTMLButtonElement>('.about .update-check')?.disabled && !$('.update-toast'), `the updater is off in the smoke run (${upd.status}: ${upd.offReason ?? ''})`);
          summary['updater'] = `${upd.status} (${upd.offReason ?? ''})`;
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
            expect(books.length === want && (n === 30 || rows.length > 1) && out < 600 && loaded < 12000, `a shelf of ${n} worlds: ${sizes[sizes.length - 1]}`);
          }
          summary['shelfSizes'] = sizes.join('; ');
          {
            // Rearranging the shelf (220 books): the New book is first and stays put; the last book is dragged with the
            // real mouse from the last shelf to the first (the library scrolls up by itself near its top edge), right
            // after the first book. The drop does not open it, the order is saved and comes back from disk.
            await reload(220);
            await settleShelf();
            const shelfEl = $('.library .shelf')!;
            const all = () => [...document.querySelectorAll<HTMLElement>('.shelf .shelf-book:not(.new-book)')];
            const keys = () => all().map((c) => c.dataset['key']!);
            const spine = (c: Element) => c.querySelector('.book-spine')!.getBoundingClientRect();
            const before = keys();
            expect(shelfEl.firstElementChild?.classList.contains('new-book') === true, 'the New book comes first on the first shelf');
            const moving = all()[before.length - 1]!;
            const key = moving.dataset['key']!;
            moving.scrollIntoView({ block: 'center' });
            await tick(300);
            const r0 = spine(moving);
            const sx = r0.left + r0.width / 2, sy = r0.top + r0.height * 0.6;
            // As with a real mouse, the book comes out on hover before it is picked up (its spine then turns edge-on).
            await window.lore.smokeMouse([{ type: 'move', x: sx - 1, y: sy }, { type: 'move', x: sx, y: sy }]);
            expect(await until(() => moving.classList.contains('is-out'), 3000), 'the book comes out under the pointer before the drag');
            await tick(700);
            await window.lore.smokeMouse([{ type: 'down', x: sx, y: sy }, { type: 'move', x: sx + 3, y: sy - 3, held: true }, { type: 'move', x: sx + 10, y: sy - 30, held: true }]);
            expect(await until(() => moving.hasAttribute('data-dragged') && !!$('.shelf-lift')), 'picking up a book lifts a copy of it, and the book waits, faded, in its place');
            {
              const liftEl = $<HTMLElement>('.shelf-lift')!, sp = moving.querySelector<HTMLElement>('.book-spine')!, lcs = getComputedStyle(liftEl);
              expect(count('.shelf-lift') === 1 && Math.abs(liftEl.offsetWidth - sp.offsetWidth) <= 2 && Math.abs(liftEl.offsetHeight - sp.offsetHeight) <= 2 && sp.offsetWidth > 20
                && lcs.backgroundImage !== 'none' && !/rgba\(0, 0, 0, 0\)|transparent/.test(lcs.backgroundColor) && lcs.opacity === '1',
                `the lifted copy is a full, opaque spine: ${liftEl.offsetWidth}x${liftEl.offsetHeight} for ${sp.offsetWidth}x${sp.offsetHeight}, ${lcs.backgroundColor}, opacity ${lcs.opacity}`);
              const lift = liftEl.getBoundingClientRect();
              expect(sx + 10 >= lift.left - 12 && sx + 10 <= lift.right + 12 && sy - 30 >= lift.top - 12 && sy - 30 <= lift.bottom + 12 && !$('.shelf-drop') && !$('.shelf-ghost'),
                `the lifted copy follows the pointer, no marker line (${Math.round(lift.left)},${Math.round(lift.top)} ${Math.round(lift.width)}x${Math.round(lift.height)} for ${Math.round(sx + 10)},${Math.round(sy - 30)})`);
              expect(parseFloat(getComputedStyle(moving.querySelector('.book-pull')!).opacity) < 0.5 && getComputedStyle(moving.querySelector('.book-spine')!).outlineStyle === 'dashed', 'the placeholder is a faded copy with a dashed outline');
            }
            await tick(200);
            expect(count('.shelf .is-out') === 0, 'no book comes out while one is dragged');
            const wasTop = start.scrollTop;
            await window.lore.smokeMouse([{ type: 'move', x: sx, y: start.getBoundingClientRect().top + 10, held: true }]);
            expect(wasTop > 0 && (await until(() => start.scrollTop === 0, 10000)), `held near the top edge, the library scrolls up (from ${Math.round(wasTop)}px, now ${Math.round(start.scrollTop)}px)`);
            const b1 = spine(all()[0]!), b2 = spine(all()[1]!);
            const tx = b2.left + 2, ty = b2.top + b2.height / 2;
            await window.lore.smokeMouse([{ type: 'move', x: tx, y: ty, held: true }]);
            expect(await until(() => keys()[1] === key, 3000), `the placeholder moves into the gap between the first two books (${keys().slice(0, 3).map((k) => k.split(/[\\/]/).pop()).join(', ')})`);
            await tick(60);
            const preview = keys();
            const sliding = all().slice(2, 8).filter((b) => b.getAnimations().length > 0).length;
            expect(preview.length === before.length && preview[0] === before[0] && preview[2] === before[1] && preview[preview.length - 1] === before[before.length - 2] && sliding > 0,
              `the books after it slide aside (${sliding} sliding), across shelves, and its old place on the last shelf closes`);
            await window.lore.smokeMouse([{ type: 'up', x: tx, y: ty }]);
            expect(await until(() => count('.shelf-lift') === 0 && !moving.hasAttribute('data-dragged'), 3000), 'on drop the lifted copy settles into the gap and is gone, and the book shows again');
            await tick(100);
            const after = keys();
            expect(after[0] === before[0] && after[1] === key && after[2] === before[1] && after.length === before.length,
              `the last book lands second on the first shelf (${after.slice(0, 3).map((k) => k.split(/[\\/]/).pop()).join(', ')})`);
            expect(!dirRef.current && !$('.home') && !$('.library-dialog'), 'dropping a book does not open it');
            expect(JSON.stringify((await window.lore.settings()).shelfOrder) === JSON.stringify(after), 'the new order is saved in settings');
            window.dispatchEvent(new Event('focus'));
            await tick(600);
            expect(JSON.stringify(await window.lore.listWorlds()) === JSON.stringify(after) && JSON.stringify(keys()) === JSON.stringify(after), 'the saved order comes back from disk');
            // The New book cannot be picked up.
            const nb = $('.shelf .new-book .book-spine')!.getBoundingClientRect();
            const nx = nb.left + nb.width / 2, ny = nb.top + nb.height * 0.4;
            await window.lore.smokeMouse([{ type: 'move', x: nx, y: ny }, { type: 'down', x: nx, y: ny }, { type: 'move', x: nx, y: ny + 12, held: true }, { type: 'move', x: nx, y: ny + 24, held: true }]);
            await tick(100);
            expect(!$('.shelf-lift') && !$('.shelf .new-book[data-dragged]'), 'the New book is not draggable');
            await window.lore.smokeMouse([{ type: 'up', x: nx, y: ny + 24 }]);
            await tick(200);
            if ($('.library-dialog')) { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await until(() => !$('.library-dialog')); }
            expect(shelfEl.firstElementChild?.classList.contains('new-book') === true && JSON.stringify(keys()) === JSON.stringify(after), 'the New book stays first');
            {
              // Escape puts a book being dragged back where it was; the order is not saved and nothing opens.
              // Each press starts with the pointer parked and every book back on the shelf (an open book covers its neighbours).
              const rest = async () => { await window.lore.smokeMouse([{ type: 'move', x: 2, y: 2 }]); await until(() => count('.shelf .is-out') === 0, 3000); await tick(700); };
              await rest();
              // The book picked up is the one under the pointer (a book out on hover can cover its neighbour); the
              // target is measured once the drag has put every book back in line.
              const h0 = spine(all()[5]!);
              const hx = h0.left + h0.width / 2, hy = h0.top + h0.height * 0.6;
              await window.lore.smokeMouse([{ type: 'move', x: hx, y: hy }, { type: 'down', x: hx, y: hy }, { type: 'move', x: hx - 10, y: hy, held: true }]);
              await until(() => !!$('.shelf [data-dragged]'), 3000);
              await tick(500);
              const held = $<HTMLElement>('.shelf [data-dragged]') ?? all()[5]!, heldKey = held.dataset['key']!;
              const t1 = spine(all()[1]!);
              await window.lore.smokeMouse([{ type: 'move', x: t1.left + 2, y: t1.top + t1.height / 2, held: true }]);
              expect(await until(() => keys()[1] === heldKey && !!$('.shelf-lift'), 3000), `a second drag moves its placeholder too (at ${keys().indexOf(heldKey)}, lift ${!!$('.shelf-lift')})`);
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
              expect(await until(() => JSON.stringify(keys()) === JSON.stringify(after) && !$('.shelf-lift') && !held.hasAttribute('data-dragged'), 3000), 'Escape sends the book back to its place');
              await window.lore.smokeMouse([{ type: 'up', x: t1.left + 2, y: t1.top + t1.height / 2 }]);
              await tick(200);
              expect(JSON.stringify(keys()) === JSON.stringify(after) && JSON.stringify((await window.lore.settings()).shelfOrder) === JSON.stringify(after) && !dirRef.current && !$('.library-dialog'), 'after Escape the order is unchanged and nothing opens');
              // Losing the window (blur) or a pointercancel mid-drag leaves nothing on the pointer either.
              for (const lose of ['blur', 'pointercancel'] as const) {
                await rest();
                const g0 = spine(all()[6]!);
                const gx = g0.left + g0.width / 2, gy = g0.top + g0.height * 0.6;
                await window.lore.smokeMouse([{ type: 'move', x: gx, y: gy }, { type: 'down', x: gx, y: gy }, { type: 'move', x: gx - 12, y: gy, held: true }, { type: 'move', x: gx - 40, y: gy, held: true }]);
                expect(await until(() => !!$('.shelf-lift'), 3000), `a drag starts before the ${lose}`);
                window.dispatchEvent(lose === 'blur' ? new Event('blur') : new PointerEvent('pointercancel', { pointerId: 1 }));
                expect(await until(() => count('.shelf-lift') === 0 && !$('.shelf [data-dragged]') && JSON.stringify(keys()) === JSON.stringify(after), 3000), `a ${lose} mid-drag removes the lifted copy and puts the book back`);
                await window.lore.smokeMouse([{ type: 'up', x: gx - 40, y: gy }]);
                await tick(200);
                if ($('.library-dialog')) { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await until(() => !$('.library-dialog')); }
              }
              expect(!dirRef.current && JSON.stringify((await window.lore.settings()).shelfOrder) === JSON.stringify(after), 'nothing opened or moved after them');
            }
            // Keyboard: Alt+Left, Alt+End and Alt+Home move the focused book; focus stays on it; nothing opens.
            const alt = (k: string) => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: k, altKey: true, bubbles: true, cancelable: true }));
            const k3 = all()[3]!.dataset['key']!;
            all()[3]!.querySelector<HTMLElement>('.world-book')!.focus();
            const focusedKey = () => document.activeElement?.closest<HTMLElement>('.shelf-book')?.dataset['key'];
            alt('ArrowLeft');
            expect(await until(() => keys()[2] === k3 && focusedKey() === k3), 'Alt+Left moves the focused book one place left and keeps focus on it');
            alt('End');
            expect(await until(() => keys()[keys().length - 1] === k3 && focusedKey() === k3), 'Alt+End moves it to the end of the last shelf');
            alt('Home');
            expect(await until(() => keys()[0] === k3 && focusedKey() === k3), 'Alt+Home moves it to the front of the first shelf');
            expect(!dirRef.current && /place 1 of/.test($('.shelf-moved')?.textContent ?? ''), `the move is announced and nothing opens (${$('.shelf-moved')?.textContent})`);
            expect(JSON.stringify((await window.lore.settings()).shelfOrder) === JSON.stringify(keys()), 'keyboard moves are saved too');
            // While a search filters the shelf, the order cannot be changed.
            const box = $<HTMLInputElement>('.library-search input')!;
            box.value = 'Shelf Book 01';
            box.dispatchEvent(new Event('input', { bubbles: true }));
            await until(() => all().length < 30 && all().length > 0);
            const filtered = keys();
            all()[1]!.querySelector<HTMLElement>('.world-book')!.focus();
            alt('ArrowLeft');
            await tick(100);
            expect(JSON.stringify(keys()) === JSON.stringify(filtered) && /Clear the search/.test($('.shelf-moved')?.textContent ?? ''), 'no rearranging while a search filters the shelf');
            box.value = '';
            box.dispatchEvent(new Event('input', { bubbles: true }));
            await until(() => all().length === before.length && !!$('.shelf .new-book'));
            (document.activeElement as HTMLElement | null)?.blur();
            // Park the pointer in the window's top-left corner, off the shelf at any window size, so no book is left
            // out under it when the window shrinks for the next part.
            await window.lore.smokeMouse([{ type: 'move', x: 2, y: 2 }]);
            await until(() => count('.shelf .is-out, .shelf .is-closing') === 0, 3000);
            // Forget the custom order, so the shelves that follow are in the plain order.
            await window.lore.saveSettings({ shelfOrder: [] });
            expect((await window.lore.settings()).shelfOrder === undefined, 'an empty order is not kept in settings');
            await settleShelf();
          }
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
          const bk = parseFloat(getComputedStyle(shelfEl).getPropertyValue('--bk')) || 1;
          expect(Math.abs(rowGap - (bk * 15.4 + 2.2) * rem) < 2, `rows are one plank apart (${rowGap}px, book scale ${bk})`);
          await window.lore.smokeShow(true);
          await until(() => !document.hidden, 3000);
          const hero = $('.start-hero h1')!.getBoundingClientRect();
          for (let i = 0; i < 40 && start.scrollTop + start.clientHeight < start.scrollHeight - 2; i++) await window.lore.smokeMouse([{ type: 'wheel', x: hero.left + 20, y: 400, deltaY: 240 }]);
          await tick(200);
          {
            const r = last.querySelector('.book-spine')!.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.6);
            expect(start.scrollTop > 0 && r.bottom <= innerHeight && r.top >= 0 && !!hit && last.contains(hit), `the last book is reached by scrolling the library (scrolled ${Math.round(start.scrollTop)}px of ${start.scrollHeight - start.clientHeight}, book at ${Math.round(r.top)}-${Math.round(r.bottom)} of ${innerHeight}, wheel over ${document.elementFromPoint(hero.left + 20, 400)?.className})`);
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
          expect(atRest(), `leaving a lower shelf returns every book to rest (${cards().filter((c, i) => Math.abs(c.querySelector('.book-spine')!.getBoundingClientRect().left - restAt[i]!) >= 1.5 || (c.style.getPropertyValue('--push') || '0px') !== '0px').map((c) => `${c.dataset['name']} ${Math.round(c.querySelector('.book-spine')!.getBoundingClientRect().left - restAt[cards().indexOf(c)]!)}px`).slice(0, 4).join('; ')})`);
          // Full width at every size: the first row fills the shelf, the shelf fills the library, and every title fits
          // (cover titles: no word sticking out, at most three lines; spines: no overflow).
          {
            const widths: string[] = [];
            for (const [width, height] of [[1024, 640], [1920, 1080], [2560, 1440]] as const) {
              await window.lore.smokeResize(width, height);
              await until(() => innerWidth === width && innerHeight === height, 2000);
              window.dispatchEvent(new Event('resize'));
              start.scrollTop = 0;
              await tick(500);
              await document.fonts.ready;
              const cs = getComputedStyle(start);
              const content = start.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
              const ss = getComputedStyle(shelfEl);
              const inner = shelfEl.clientWidth - parseFloat(ss.paddingLeft) - parseFloat(ss.paddingRight);
              const first = rowsOf()[0]!;
              const span = first[first.length - 1]!.offsetLeft + first[first.length - 1]!.offsetWidth - first[0]!.offsetLeft;
              const shelfShare = shelfEl.getBoundingClientRect().width / content;
              const rowShare = span / inner;
              const leftGap = first[0]!.offsetLeft - parseFloat(ss.paddingLeft);
              const rightGap = shelfEl.clientWidth - parseFloat(ss.paddingRight) - (first[first.length - 1]!.offsetLeft + first[first.length - 1]!.offsetWidth);
              const bookH = first[0]!.querySelector('.book-spine')!.getBoundingClientRect().height;
              widths.push(`${width}x${height}: ${first.length} per row, shelf ${Math.round(shelfShare * 100)}% of the library, row ${Math.round(rowShare * 100)}% of the shelf, book ${Math.round(bookH)}px`);
              expect(shelfShare >= 0.9 && rowShare >= 0.9 && leftGap < 3 && rightGap < first[0]!.offsetWidth + 24 && bookH <= 300, `the shelf uses the full width at ${widths[widths.length - 1]} (gaps ${Math.round(leftGap)}/${Math.round(rightGap)}px)`);
              // Every title on screen fits; the long ones too, taken off the shelf.
              const near = cards().filter((c) => c.getBoundingClientRect().top < innerHeight);
              const overflow = (el: Element | null) => !!el && ((el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1 || (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 1);
              // An ellipsis is the last resort: allowed only once the title is at its smallest size in one line.
              const badSpines = near.filter((c) => { const t = c.querySelector<HTMLElement>('.spine-title'); return !!t && !t.classList.contains('is-clamped') && overflow(t); }).map((c) => c.dataset['name']);
              expect(badSpines.length === 0, `spine titles fit at ${width}x${height}: ${badSpines.join(', ')}`);
              for (const name of ['The Extraordinary Chronicles of the Seventeen Sunken Kingdoms', 'Kartaltepe Mahallesinin Unutulmuş Masalları', 'Northern Tales']) {
                const c = cards().find((x) => x.dataset['name'] === name);
                if (!c) { expect(false, `the book ${name} is on the shelf`); continue; }
                c.scrollIntoView({ block: 'center' });
                c.dispatchEvent(new PointerEvent('pointerenter'));
                await until(() => c.classList.contains('is-out'));
                await tick(200);
                const t = c.querySelector<HTMLElement>('.book-cover .cover-title')!;
                const lh = parseFloat(getComputedStyle(t).lineHeight);
                const clamped = t.classList.contains('is-clamped');
                const lines = Math.round((clamped ? t.clientHeight : t.scrollHeight) / lh);
                // Ordinary titles fit whole; only a title too long for three lines at the smallest size ends in an ellipsis.
                expect(t.scrollWidth <= t.clientWidth && lines <= 3 && (name === 'Northern Tales' ? !clamped : true),
                  `the hovered title "${name}" fits at ${width}x${height} (${t.scrollWidth}/${t.clientWidth}px wide, ${lines} lines${clamped ? ', ellipsis' : ''}, ${getComputedStyle(t).fontSize})`);
                if (clamped) widths.push(`"${name.slice(0, 24)}…" ends in an ellipsis at ${width}x${height}`);
                c.dispatchEvent(new PointerEvent('pointerleave'));
                await until(() => count('.shelf .is-out') === 0);
                await settleShelf();
              }
            }
            summary['shelfWidths'] = widths.join('; ');
            await window.lore.smokeResize(1024, 640);
            await until(() => innerWidth === 1024, 2000);
            window.dispatchEvent(new Event('resize'));
            await tick(300);
          }
          // Search: live filtering, best match first, accent and Turkish i tolerant.
          const box = $<HTMLInputElement>('.library-search input')!;
          expect(box.placeholder === 'Search books...' && !!$('.start-hero .library-search') && !!$('.library-search .search-mark'), 'the search box sits in the library header');
          {
            // The header is the mark, the name, the search and the actions: no subtitle and no visible shelf hint; the
            // name is optically centred on the mark (its capitals, within 2px).
            const mark = $('.start-hero .start-mark')!.getBoundingClientRect(), name = $('.start-hero h1')!.getBoundingClientRect();
            const off = Math.abs(mark.top + mark.height / 2 - (name.top + name.height / 2));
            expect(!$('.start-hero p') && !/Write the worlds|Point at a book/.test($('.start')!.innerText) && $('.shelf-hint')!.getBoundingClientRect().width <= 1, 'the library header has no subtitle and the shelf no visible hint');
            expect(off <= 2 && name.height < parseFloat(getComputedStyle($('.start-hero h1')!).fontSize), `the Lore-Forge title is centred on its mark (${off.toFixed(1)}px off)`);
          }
          const type = async (q: string) => { box.value = q; box.dispatchEvent(new Event('input', { bubbles: true })); await tick(120); };
          const names = () => cards().map((c) => c.dataset['name']);
          const countText = () => $('.shelf-count')!.textContent ?? '';
          await type('shelf book');
          const shelfBooks = names().filter((n) => n?.startsWith('Shelf Book')).length;
          expect(cards().length === shelfBooks && shelfBooks === 53 && countText() === `53 of ${total} books` && !$('.shelf .new-book'), `typing filters the shelf (${cards().length} shown, "${countText()}")`);
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
          expect(names().join() === 'The Glass Garden,Shelf Book 008', `a title match comes before a description match (${names().join()})`);
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
          // The tour: from the library through the sample world. Esc skips; Back and Next move; Finish saves tourDone.
          await window.lore.smokeShow(true);
          await window.lore.smokeResize(1920, 1080);
          await until(() => innerWidth === 1920, 2000);
          window.dispatchEvent(new Event('resize'));
          $<HTMLButtonElement>('.home-library')!.click();
          await until(() => !!$('.start-tour'));
          expect((await window.lore.settings()).tourDone !== true && !$('.tour'), 'the tour does not start by itself in the smoke run');
          $<HTMLButtonElement>('.start-tour')!.click();
          expect(await until(() => !!$('.tour-card') && !($<HTMLButtonElement>('.tour-next')?.disabled ?? true)), 'Take the tour starts the tour');
          $<HTMLButtonElement>('.tour-next')!.click();
          await until(() => $('.tour')?.dataset['step'] === '1');
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          expect(await until(() => !$('.tour')) && (await window.lore.settings()).tourDone === true, 'Esc skips the tour, and it is not shown again');
          $<HTMLButtonElement>('.start-tour')!.click();
          await until(() => !!$('.tour-card'));
          const steps = Number(/of (\d+)/.exec($('.tour-count')?.textContent ?? '')?.[1] ?? 0);
          expect(steps >= 5 && steps <= 8, `the tour has 5 to 8 steps (${steps})`);
          const seen: string[] = [];
          for (let i = 0; i < steps; i++) {
            expect(await until(() => $('.tour')?.dataset['step'] === String(i) && !($<HTMLButtonElement>('.tour-next')?.disabled ?? true), 10000), `tour step ${i + 1} is ready`);
            await tick(350);
            const spot = $('.tour-spot')!.getBoundingClientRect();
            const card = $('.tour-card')!.getBoundingClientRect();
            const inside = card.left >= 0 && card.top >= 0 && card.right <= innerWidth + 1 && card.bottom <= innerHeight + 1;
            const title = $('.tour-title')?.textContent ?? '';
            seen.push(title);
            expect(spot.width > 10 && spot.height > 10 && inside && !$('.tour-spot.is-none'), `tour step ${i + 1} "${title}" points at something and its card is inside the window (spot ${Math.round(spot.left)},${Math.round(spot.top)} ${Math.round(spot.width)}x${Math.round(spot.height)}${$('.tour-spot.is-none') ? ' none' : ''}, card ${Math.round(card.left)},${Math.round(card.top)} ${Math.round(card.width)}x${Math.round(card.height)}, window ${innerWidth}x${innerHeight})`);
            if (i === 3) {
              $<HTMLButtonElement>('.tour-back')!.click();
              expect(await until(() => $('.tour')?.dataset['step'] === '2' && !!$('.home-hero')), 'Back returns to the previous step and its place');
              await until(() => !($<HTMLButtonElement>('.tour-next')?.disabled ?? true));
              $<HTMLButtonElement>('.tour-next')!.click();
              await until(() => $('.tour')?.dataset['step'] === '3' && !($<HTMLButtonElement>('.tour-next')?.disabled ?? true));
            }
            $<HTMLButtonElement>('.tour-next')!.click();
          }
          expect(await until(() => !$('.tour')), 'Finish closes the tour');
          expect(seen.length === steps && /library/i.test(seen[0] ?? '') && seen.some((t) => /Story/.test(t)) && seen.some((t) => /Warnings/.test(t)), `the tour covers the library, the sample, an entry, warnings and story (${seen.join(' / ')})`);
          summary['tour'] = seen.join(' / ');
          await window.lore.smokeShow(false);
        }
      } catch (e) {
        fails.push(String((e as Error).stack ?? e));
      }
      // A console error fails the smoke run in the main process.
      if (fails.length) console.error(`smoke checks failed: ${fails.join(' | ')}`);
      window.lore.smokeReport({ ...summary, dom });
    });
  }, [open]);

  // The rules take well under a millisecond, so they follow every edit: a rename to a taken name, or a death
  // before birth, warns at once. Only the story analysis (most of a check's time) waits for a pause in typing
  // in an entry, or for the field to lose focus. The list keeps its identity while its content is unchanged,
  // so a keystroke that changes no warning redraws none of the lists that show them.
  const [checked, settleNow] = useSettledWorld(world, CHECK_DELAY_MS);
  useEffect(() => {
    document.addEventListener('focusout', settleNow);
    return () => document.removeEventListener('focusout', settleNow);
  }, []);
  const analysis = useStoryAnalysis(checked);
  const ruleWarnings = useMemo(() => (world ? checkWorld(world, builtinRules) : []), [world]);
  const warnings = useSame(
    useMemo(() => (analysis?.warnings.length ? sortWarnings([...ruleWarnings, ...analysis.warnings]) : ruleWarnings), [ruleWarnings, analysis]),
    sameWarnings,
  );

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

  // Stable, so the warnings panel can skip drawing again while only an entry is being typed in.
  const onJump = useEvent(jump);
  const onMark = useEvent((w: Warning, note: string) => world && setIntended([...world.intended.filter((m) => m.warningId !== w.id), { warningId: w.id, ...(note ? { note } : {}), markedAt: new Date().toISOString().slice(0, 10) }]));
  const onUnmark = useEvent((w: Warning) => world && setIntended(world.intended.filter((m) => m.warningId !== w.id)));
  const actions: WarningActions = useMemo(() => ({ onJump, onMark, onUnmark }), []);

  /** Back to the library: write what is pending, then close the world (Back returns to it). */
  // A copy just made from inside a world: the library it goes back to shows it, next to its original.
  const [fresh, setFresh] = useState<string | null>(null);
  useEffect(() => { if (world) setFresh(null); }, [world]);
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

  // The first-run tour walks through the sample world. It starts by itself once, on the library (not when a world was
  // opened from the command line, and never in the smoke run); "Take the tour" starts it again.
  const [touring, setTouring] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  // Whether the sample is off the shelf (Library settings), so the tour points at the shelf instead of its book.
  const [sampleHidden, setSampleHidden] = useState(false);
  const startTour = () => { setTourStep(0); setTouring(true); void window.lore.settings().then((x) => setSampleHidden(!!x.hideSample)); };
  const [sample, setSample] = useState<string | null>(null);
  const [bundled, setBundled] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const worldRef = useRef(world);
  worldRef.current = world;
  useEffect(() => {
    void Promise.all([window.lore.sampleWorld(), window.lore.bundledWorld(), window.lore.settings(), window.lore.initialWorld()]).then(([s, b, set, first]) => {
      setSample(s);
      setBundled(b);
      if (!SMOKE && s && !set.tourDone && !first) startTour();
    });
  }, []);
  const endTour = () => {
    setTouring(false);
    void window.lore.saveSettings({ tourDone: true });
  };
  const show = (v: View, mode?: RelationMode) => transition(() => { if (mode) setRelMode(mode); setReveal(undefined); setPreview(null); setView(v); });
  const inSample = async (): Promise<World | null> => (sample && dirRef.current === sample ? worldRef.current : sample ? open(sample) : null);
  const tourSteps: TourStep[] = sample ? [
    { title: 'Your library', text: 'Every world is a book on this shelf. Point at one to take it out; click to open it. Search by title, author or description with Ctrl+F.', anchor: '#library-shelf', go: () => (dirRef.current ? closeWorld() : undefined) },
    sampleHidden
      ? { title: 'The sample world', text: 'Camelamamm is a small desert world that comes with Lore-Forge, with characters, places, events, a story and pictures. It is off your shelf now (Show sample world in Library settings puts it back), but the tour can still open it: Next opens it.', anchor: '#library-shelf', go: () => (dirRef.current ? closeWorld() : undefined) }
      : { title: 'The sample world', text: 'Camelamamm is a small desert world that comes with Lore-Forge, with characters, places, events, a story and pictures. Next opens it.', anchor: `.shelf-book[data-key="${CSS.escape(sample)}"]`, go: () => (dirRef.current ? closeWorld() : undefined) },
    { title: 'World home', text: 'Each world opens on its home page: the cover (click it to change it), what is in the world, and a card for every entry.', anchor: '.home-hero', go: async () => { await inSample(); show('home'); } },
    { title: 'An entry', text: 'Entries are characters, places, factions, items, events and lore. Each has facts, links to others, a visual description, and Images or 3D model tabs.', anchor: '.editor', go: async () => {
      const w = await inSample();
      const e = w?.entries.find((x) => x.images?.length) ?? w?.entries[0];
      if (e) transition(() => { setSelectedId(e.id); setReveal(undefined); setPreview(null); setView('editor'); });
    } },
    { title: 'Relationships and timeline', text: 'The tabs up here show the world as a timeline, a family tree and a relationship web, all built from the links in the entries.', anchor: '.tabs', go: async () => { await inSample(); show('relations', 'web'); } },
    { title: 'Warnings', text: 'Lore-Forge checks the world as you write: someone acting after their death, a broken link, a date outside its era. Click a warning to jump there, or mark it as intended.', anchor: '.warnings-panel', go: async () => { await inSample(); show('relations', 'web'); } },
    { title: 'Story', text: 'Write chapters here. Lore-Forge spots the people and places you mention, suggests new entries, and checks the story against the lore.', anchor: '.main-story', go: async () => { await inSample(); show('story'); } },
    { title: 'Make it yours', text: 'The sample stays as it is. Duplicate it to get a copy you can edit, or go back to the library and start a New book of your own.', anchor: '.home-duplicate', go: async () => { await inSample(); show('home'); } },
  ] : [];
  const overlays = (
    <>
      {touring && tourSteps.length > 0 && <Tour steps={tourSteps} step={Math.min(tourStep, tourSteps.length - 1)} onStep={setTourStep} onClose={endTour} />}
      <UpdateToast />
    </>
  );

  if (!world || !dir) return <><StartScreen onOpen={(d) => { setFresh(null); void open(d); }} error={loadError} onTour={startTour} highlight={fresh} />{overlays}</>;

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
  // The overlays sit second in both returns (library and world), so the tour keeps its place when a world opens.
  return (
    <>
    <WorldDir.Provider value={dir}>
    <ErasLink.Provider value={() => setSettings(true)}>
    <div class="app" style={{ '--sidebar-w': `${sidebarW}px` }}>
      <Aura calm />
      <header class="topbar">
        <div class="world-title">
          {/* Always the way out to the library; Alt+Left and mouse button 4 still step back through history. */}
          <button type="button" class="ghost nav-back has-label" onClick={() => void closeWorld()} aria-label="Back to the library" title="Back to the library"><Icon name="plain-arrow" class="point-left" /><span class="btn-label">Library</span></button>
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
            <button key={v} type="button" class={`view-tab v-${v}`} aria-pressed={view === v} onClick={() => goView(v)} aria-label={label} title={`${label} (${i ? `Ctrl+${i}` : 'Ctrl+H'})`}><Icon name={icon} /><span class="tab-label">{label}</span></button>
          ))}
        </nav>
        <div class="top-end">
          <div class="publish-actions" role="group" aria-label="Export">
            <button type="button" class="publish p-codex has-label" onClick={() => setPreview('codex')} aria-label="World Codex" title="World Codex: preview every entry with facts, visual description, reference images and art briefs; then save as PDF"><Icon name="book-cover" /><span class="btn-label">World Codex</span></button>
            <button type="button" class="publish p-book has-label" onClick={() => setPreview('book')} aria-label="Story Book" title="Story Book: preview your events and notes in story order as a book; then save as PDF or Word"><Icon name="open-book" /><span class="btn-label">Story Book</span></button>
          </div>
          <div class="top-actions">
            <SaveIndicator save={save} />
            <button type="button" class="ghost small top-settings has-label" aria-haspopup="dialog" onClick={() => setSettings(true)} aria-label="World settings" title="World settings: calendar, eras and months"><Icon name="cog" /><span class="btn-label">World settings</span></button>
          </div>
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
        {view === 'home' && <WorldHome dir={dir} world={world} warnings={warnings} onOpen={openEntry} onGo={goHome} onChange={updateEntry} onCoverSave={saveCover} onSettings={() => setSettings(true)} onReload={() => void flush().then(() => open(dir))} onLibrary={() => void closeWorld()} onDuplicate={() => void flush().then(() => setCopying(true))} sample={dir === bundled} />}
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
      {copying && <DuplicateBook dir={dir} name={world.manifest.name} onClose={() => setCopying(false)} onDone={(copy) => { setCopying(false); setFresh(copy); void closeWorld(); }} />}
      <ToastStack toasts={toasts.toasts} dismiss={toasts.dismiss} />
    </div>
    </ErasLink.Provider>
    </WorldDir.Provider>
    {overlays}
    </>
  );
}
