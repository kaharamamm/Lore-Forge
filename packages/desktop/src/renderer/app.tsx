import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  check, entryPath, familyTree, INTENDED_FILE, parseWorld, relationWeb, serializeEntry, serializeIntended, timelineModel, WorldIndex,
  type Entry, type EntryType, type FactRef, type Warning, type World,
} from '@lore-forge/core';
import type { PdfKind, PublishOptions } from '../shared/api.ts';
import { EntryEditor } from './components/editor.tsx';
import { RelationsView } from './components/relations.tsx';
import { Sidebar } from './components/sidebar.tsx';
import { StartScreen } from './components/start.tsx';
import { TimelineView } from './components/timeline.tsx';
import { PreviewDialog, previewDoc, sheetsOf } from './components/preview.tsx';
import { ToastStack, useToasts } from './components/toasts.tsx';
import { involves, WarningsPanel, type WarningActions } from './components/warnings.tsx';

type View = 'editor' | 'timeline' | 'relations';
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
const count = (sel: string) => document.querySelectorAll(sel).length;

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
  return { id, type, name, body: '' } as Entry;
}

export function App() {
  const [dir, setDir] = useState<string | null>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>('editor');
  const [query, setQuery] = useState('');
  const [save, setSave] = useState<SaveState>({ kind: 'saved' });
  const [preview, setPreview] = useState<PdfKind | null>(null);
  const toasts = useToasts();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<string, () => Promise<void>>());

  const open = useCallback(async (d: string) => {
    try {
      const w = parseWorld(await window.lore.readWorld(d));
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
      try {
        const leyla = w.entries.find((e) => e.id === 'char-leyla') ?? w.entries.find((e) => e.type === 'character');
        if (leyla) {
          setSelectedId(leyla.id);
          setView('editor');
          await tick();
          dom['editorMentions'] = count('.prose-mirror mark.mention');
          dom['statusPills'] = count('.lifecycle [role=radio]');
          dom['relationSelects'] = count('[data-field^="relations"] select');
          setView('relations');
          await tick();
          dom['treeNodes'] = count('.family-tree .node');
          document.querySelector<HTMLButtonElement>('.relations .segmented button:nth-child(2)')?.click();
          await tick();
          dom['webNodes'] = count('.relation-web .node');
          dom['webEdges'] = count('.relation-web .web-edge');
        }
        setView('timeline');
        await tick(150);
        dom['timelineMarks'] = count('.tl-mark');
        dom['timelineBands'] = count('.tl-band');
        dom['timelineWarnings'] = count('.tl-warn');
        for (const k of ['codex', 'book'] as const) {
          setPreview(k);
          await tick(150);
          dom[`${k}Sheets`] = count('.preview .sheet');
          dom[`${k}Headings`] = count('.preview .doc-h');
          setPreview(null);
          await tick();
        }
        setView('editor');
      } catch (e) {
        dom['error'] = 1;
        console.error(e);
      }
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

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.getElementById('search')?.focus();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void flush().then(() => toasts.push({ tone: 'ok', text: '💾 All changes saved' }));
      } else if (mod && ['1', '2', '3'].includes(e.key)) {
        e.preventDefault();
        setView((['editor', 'timeline', 'relations'] as const)[Number(e.key) - 1]!);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        document.getElementById('warnings-title')?.focus();
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

  // Write anything pending before the window closes.
  useEffect(() => {
    const onUnload = () => void flush();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  });

  if (!world || !dir) return <StartScreen onOpen={(d) => void open(d)} error={loadError} />;

  const savePdf = async (kind: PdfKind, options: PublishOptions) => {
    const label = kind === 'codex' ? '📖 World Codex' : '📚 Story Book';
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
  const openEntry = (id: string) => { setSelectedId(id); setView('editor'); };

  const selected = world.entries.find((e) => e.id === selectedId);
  const tabs: [View, string, string][] = [['editor', '✏️', 'Editor'], ['timeline', '🕰️', 'Timeline'], ['relations', '🕸️', 'Relationships']];
  return (
    <div class="app">
      <header class="topbar">
        <div class="world-title">
          <h1>{world.manifest.name}</h1>
          <span class="muted path" title={dir}>{dir}</span>
        </div>
        <nav class="tabs" aria-label="Views">
          {tabs.map(([v, emoji, label], i) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} title={`Ctrl+${i + 1}`}><span aria-hidden="true">{emoji} </span>{label}</button>
          ))}
        </nav>
        <div class="publish-actions">
          <button type="button" class="publish" onClick={() => setPreview('codex')} title="Preview every entry with facts, visual description, reference images and art briefs; then save as PDF">📖 World Codex</button>
          <button type="button" class="publish" onClick={() => setPreview('book')} title="Preview your events and notes in story order as a book; then save as PDF">📚 Story Book</button>
        </div>
        <div class="top-actions">
          <span class={`save save-${save.kind}`} role="status">
            {save.kind === 'saved' ? '✓ Saved' : save.kind === 'saving' ? '… Saving' : `✖ Save failed: ${save.message}`}
          </span>
          <button type="button" class="ghost small" onClick={() => void flush().then(() => open(dir))} title="Reload all files from disk">Reload</button>
          <button type="button" class="ghost small" onClick={() => void flush().then(() => { setWorld(null); setDir(null); document.title = 'Lore-Forge'; })}>Close world</button>
        </div>
      </header>
      <Sidebar entries={world.entries} warnings={warnings} selectedId={selectedId} query={query} onQuery={setQuery} onSelect={(id) => { setSelectedId(id); if (view === 'timeline') setView('editor'); }} onCreate={createEntry} />
      <main class="main" id="main">
        {view === 'editor' &&
          (selected ? (
            <EntryEditor key={selected.id} dir={dir} world={world} entry={selected} warnings={warnings.filter((w) => involves(w, selected.id))} actions={actions} onChange={updateEntry} onDelete={() => void deleteEntry(selected)} onOpen={openEntry} />
          ) : (
            <div class="empty-state">
              <span class="empty-emoji" aria-hidden="true">{world.entries.length ? '👈' : '🌍'}</span>
              <p>{world.entries.length ? 'Pick an entry on the left to edit it.' : 'This world is empty. Start with a character, a place or an event: use “+ New” on the left.'}</p>
            </div>
          ))}
        {view === 'timeline' && <TimelineView world={world} warnings={warnings} selectedId={selectedId} onOpen={openEntry} />}
        {view === 'relations' && <RelationsView world={world} entry={selected} onOpen={(id) => setSelectedId(id)} />}
      </main>
      <WarningsPanel warnings={warnings} selectedId={selectedId} actions={actions} />
      {preview && <PreviewDialog dir={dir} world={world} kind={preview} onClose={() => setPreview(null)} onSave={savePdf} />}
      <ToastStack toasts={toasts.toasts} dismiss={toasts.dismiss} />
    </div>
  );
}
