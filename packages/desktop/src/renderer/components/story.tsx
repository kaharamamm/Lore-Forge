import { Fragment } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  chapterDate, ENTRY_TYPES, entryIcon, guessEntry, sentences, type Guess, relationLabel, TYPE_ICON, TYPE_SINGULAR, wordCount, WorldIndex,
  type Entry, type EntryType, type Proposal, type ProposalFields, type SourceSpan, type StoryAnalysis, type StoryChapter, type Warning, type World,
} from '@lore-forge/core';
import { Icon } from './icon.tsx';
import { Select } from './select.tsx';
import { kindOf } from './severity.tsx';
import { EntryLabel, TypeBadge } from './type.tsx';
import { ProseEditor, type SpanMark, type TextPick } from './prose.tsx';

export interface StoryActions {
  onChange: (ch: StoryChapter) => void;
  onOpen: (id: string) => void;
  /** Create the entry (or apply the update) this proposal describes, possibly edited first. */
  onAdd: (p: Proposal) => void;
  onMerge: (p: Proposal, entryId: string) => void;
  onIgnore: (ps: Proposal[]) => void;
  onRestore: (key: string) => void;
  onJump: (span: SourceSpan) => void;
  /** Search the world's entries for a text. */
  onSearch: (text: string) => void;
}

// ------------------------------------------------------------------------------------------ chapters

export function ChapterList({ chapters, current, warnings, onSelect, onCreate, onMove, onDelete }: {
  chapters: readonly StoryChapter[];
  current: string | null;
  warnings: readonly Warning[];
  onSelect: (file: string) => void;
  onCreate: () => void;
  onMove: (file: string, step: -1 | 1) => void;
  onDelete: (file: string) => void;
}) {
  const total = chapters.reduce((n, c) => n + wordCount(c.body), 0);
  return (
    <aside class="sidebar story-chapters" aria-labelledby="chapters-title">
      <div class="pane-head">
        <h2 id="chapters-title"><Icon name="scroll-quill" /> Chapters</h2>
        <button type="button" class="small" onClick={onCreate}><Icon name="feather" /> New chapter</button>
      </div>
      <p class="muted small">{chapters.length} chapter{chapters.length === 1 ? '' : 's'} · {total.toLocaleString('en')} words</p>
      <ol class="chapter-list">
        {chapters.map((c, i) => {
          const n = warnings.filter((w) => !w.intended && w.offending.chapter === c.file).length;
          return (
            <li key={c.file} class="chapter-row">
              <button type="button" class="chapter-link" aria-current={c.file === current ? 'page' : undefined} onClick={() => onSelect(c.file)}>
                <span class="chapter-n">{i + 1}</span>
                <span class="chapter-name">{c.title || 'Untitled'}</span>
                {n > 0 && <span class="count count-warning" title={`${n} warning${n === 1 ? '' : 's'}`}><Icon name="hazard-sign" /> {n}</span>}
              </button>
              {c.file === current && (
                <span class="chapter-tools">
                  <button type="button" class="ghost small icon-only" disabled={i === 0} onClick={() => onMove(c.file, -1)} aria-label="Move chapter up" title="Move up"><Icon class="rot-up" name="play-button" /></button>
                  <button type="button" class="ghost small icon-only" disabled={i === chapters.length - 1} onClick={() => onMove(c.file, 1)} aria-label="Move chapter down" title="Move down"><Icon class="rot-down" name="play-button" /></button>
                  <button type="button" class="ghost small icon-only danger" onClick={() => onDelete(c.file)} aria-label="Delete chapter" title="Delete chapter"><Icon name="trash-can" /></button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

// ------------------------------------------------------------------------------------------- the view

export function StoryView({ world, chapter, analysis, warnings, reveal, actions, onCreate }: {
  world: World;
  chapter: StoryChapter | undefined;
  analysis: StoryAnalysis;
  /** All current warnings; the ones on this chapter's sentences are underlined. */
  warnings: readonly Warning[];
  reveal?: { start: number; end: number; n: number };
  actions: StoryActions;
  onCreate: () => void;
}) {
  const [pick, setPick] = useState<TextPick | null>(null);
  const [manual, setManual] = useState<{ p: Proposal; mode: 'edit' | 'merge' } | null>(null);
  const guess = useMemo(() => {
    if (!pick || !chapter) return undefined;
    const s = sentences(chapter.body).find((x) => x.start <= pick.start && x.start + x.text.length >= pick.end);
    return guessEntry(world, pick.text, s?.text ?? pick.text);
  }, [pick?.start, pick?.end, pick?.text, world]);
  const onPick = (pk: TextPick | null) => {
    if (!pk || pk.how !== 'quick' || !chapter) return setPick(pk);
    // Ctrl+Shift+A: add the selection straight away with the guessed type, or offer to open what is already there.
    const s = sentences(chapter.body).find((x) => x.start <= pk.start && x.start + x.text.length >= pk.end);
    const g = guessEntry(world, pk.text, s?.text ?? pk.text);
    if (!g) return setPick(null);
    if (g.existing) return setPick({ ...pk, how: 'select' });
    setPick(null);
    const span: SourceSpan = s ? { chapter: chapter.file, start: s.start, end: s.start + s.text.length, quote: s.text } : { chapter: chapter.file, start: pk.start, end: pk.end, quote: pk.text };
    actions.onAdd({ key: `pick:${chapter.file}:${pk.start}`, kind: 'create', entryType: g.type, name: g.name, fields: {}, sourceSpan: span, confidence: g.confidence, pattern: 'picked' });
  };
  if (!chapter) {
    return (
      <div class="empty-state">
        <Icon class="empty-icon" name="feather" />
        <p>Write the whole story here, chapter by chapter. Names you use are linked to your entries, new people, places and events are offered as proposals, and contradictions are flagged as you type.</p>
        <button type="button" class="primary" onClick={onCreate}>Start the first chapter</button>
      </div>
    );
  }
  const marks: SpanMark[] = [];
  for (const w of warnings) {
    for (const f of [w.offending, w.conflicting]) {
      if (f?.chapter === chapter.file && f.span) marks.push({ start: f.span[0], end: f.span[1], cls: `warn-line warn-${kindOf(w)}`, title: kindOf(w) === 'error' ? 'Error' : kindOf(w) === 'intended' ? 'Intended' : 'Warning', detail: w.message });
    }
  }
  const words = wordCount(chapter.body);
  const pickProposal = (pk: TextPick, g: Guess, type: EntryType): Proposal => {
    const s = sentences(chapter.body).find((x) => x.start <= pk.start && x.start + x.text.length >= pk.end);
    const span: SourceSpan = s ? { chapter: chapter.file, start: s.start, end: s.start + s.text.length, quote: s.text } : { chapter: chapter.file, start: pk.start, end: pk.end, quote: pk.text };
    const name = type === g.type ? g.name : /^the\s/i.test(pk.text) ? `The ${pk.text.slice(4)}` : pk.text;
    return { key: `pick:${chapter.file}:${pk.start}:${type}`, kind: 'create', entryType: type, name, fields: {}, sourceSpan: span, confidence: g.confidence, pattern: 'picked' };
  };
  return (
    <div class="story">
      <section class="story-write" aria-label="Manuscript">
        <div class="story-head">
          <input class="story-title" aria-label="Chapter title" value={chapter.title} placeholder="Chapter title" onInput={(e) => actions.onChange({ ...chapter, title: e.currentTarget.value })} />
          <label class="story-date">
            <span>Date</span>
            <input value={chapter.date ?? ''} placeholder={chapterDate(chapter) ?? 'e.g. 1872 OK'} onInput={(e) => { const v = e.currentTarget.value; const { date: _d, ...rest } = chapter; actions.onChange(v.trim() ? { ...rest, date: v } : rest); }} />
          </label>
          <span class="muted small story-count" role="status">{words.toLocaleString('en')} word{words === 1 ? '' : 's'}</span>
        </div>
        <ProseEditor id="story-text" world={world} value={chapter.body} fill marks={marks} reveal={reveal} label={`Text of ${chapter.title || 'this chapter'}`}
          onInput={(body) => actions.onChange({ ...chapter, body })} onOpen={actions.onOpen} onPick={onPick} />
        {pick && guess && (
          <PickMenu pick={pick} guess={guess} onClose={() => setPick(null)}
            onOpen={(id) => { setPick(null); actions.onOpen(id); }}
            onAdd={(type) => { setManual({ p: pickProposal(pick, guess, type), mode: 'edit' }); setPick(null); }}
            onLink={() => { setManual({ p: pickProposal(pick, guess, guess.type), mode: 'merge' }); setPick(null); }}
            onSearch={() => { setPick(null); actions.onSearch(pick.text); }} />
        )}
      </section>
      <ProposalsPanel world={world} chapter={chapter} analysis={analysis} actions={actions} manual={manual} onManualDone={() => setManual(null)} />
    </div>
  );
}

// ------------------------------------------------------------------------------------- picked text

/**
 * What to do with picked story text. A selection shows a small chip with the guess ("Add “Saltmere” as
 * Place", or "Open Saltmere" when it exists) and a More button; right-click shows the whole menu.
 * Arrow keys move, Esc closes, and the menu stays inside the window.
 */
function PickMenu({ pick, guess, onClose, onOpen, onAdd, onLink, onSearch }: {
  pick: TextPick;
  guess: Guess;
  onClose: () => void;
  onOpen: (id: string) => void;
  onAdd: (type: EntryType) => void;
  onLink: () => void;
  onSearch: () => void;
}) {
  const [full, setFull] = useState(pick.how === 'menu');
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x: pick.x, y: pick.y });
  const [size, setSize] = useState('');
  // A layout effect: a plain effect could run after a click on More that came in first, and close the menu again.
  useLayoutEffect(() => setFull(pick.how === 'menu'), [pick]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const y = pick.y + r.height + 8 > innerHeight ? Math.max(8, pick.y - r.height - 8) : pick.y;
    setAt({ x: Math.max(8, Math.min(pick.x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, innerHeight - r.height - 8)) });
  }, [pick, full, size]);
  useEffect(() => { if (full) box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(); }, [pick, full]);
  useEffect(() => {
    // A smaller window keeps the menu on screen.
    const onResize = () => { setSize(`${innerWidth}x${innerHeight}`); requestAnimationFrame(() => setSize(`${innerWidth}x${innerHeight}.`)); };
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('mousedown', away, true);
    addEventListener('keydown', esc);
    return () => { removeEventListener('mousedown', away, true); removeEventListener('keydown', esc); };
  }, [onClose]);
  const onKey = (e: KeyboardEvent) => {
    const items = [...box.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
    if (go === null || !items.length) return;
    e.preventDefault();
    items[(go + items.length) % items.length]!.focus();
  };
  const label = TYPE_SINGULAR[guess.type];
  const short = pick.text.length > 28 ? `${pick.text.slice(0, 27)}…` : pick.text;
  return (
    <div ref={box} class={`pick-menu${full ? ' is-full' : ''}`} style={{ left: `${at.x}px`, top: `${at.y}px` }} onKeyDown={onKey}
      role={full ? 'menu' : 'toolbar'} aria-label={`Add “${pick.text}” to the world`}>
      {!full && (
        <div class="pick-chip">
          {guess.existing ? (
            <button type="button" class="small pick-open" onClick={() => onOpen(guess.existing!.id)}><Icon name={TYPE_ICON[guess.type]} /> Open {guess.existing.name}</button>
          ) : (
            <button type="button" class="small primary pick-add" onClick={() => onAdd(guess.type)} title="Add the selection (Ctrl+Shift+A)"><Icon name={TYPE_ICON[guess.type]} /> Add “{short}” as {label}</button>
          )}
          <button type="button" class="ghost small icon-only pick-more" aria-label="More ways to add" title="More" aria-haspopup="menu" onClick={() => setFull(true)}><Icon class="rot-down" name="play-button" /></button>
        </div>
      )}
      {full && (
        <>
          <p class="pick-title" aria-hidden="true">“{short}”</p>
          {guess.existing && <button type="button" role="menuitem" class="pick-item pick-open" onClick={() => onOpen(guess.existing!.id)}><Icon name={TYPE_ICON[guess.type]} /> Open {guess.existing.name}</button>}
          {ENTRY_TYPES.map((t) => (
            <button key={t} type="button" role="menuitem" class={`pick-item t-${t}${!guess.existing && t === guess.type ? ' is-guess' : ''}`} data-type={t} onClick={() => onAdd(t)}>
              <Icon name={TYPE_ICON[t]} /> Add as {TYPE_SINGULAR[t]}{!guess.existing && t === guess.type && <span class="pick-hint">best guess</span>}
            </button>
          ))}
          <hr />
          <button type="button" role="menuitem" class="pick-item pick-link" onClick={onLink}><Icon name="linked-rings" /> Link to existing…</button>
          <button type="button" role="menuitem" class="pick-item pick-search" onClick={onSearch}><Icon name="magnifying-glass" /> Search the world for “{short}”</button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------- proposals

const FIELD_LABEL: Record<keyof ProposalFields, string> = {
  title: 'Title', occupation: 'Occupation', gender: 'Gender', aliases: 'Also called', born: 'Born', died: 'Died', status: 'Status', date: 'Date', place: 'Place', participants: 'Participants', actions: 'Actions', relations: 'Relations',
};

/** Field lines for a proposal card, with names in place of ids. */
function fieldLines(f: ProposalFields, ix: WorldIndex): [string, string][] {
  const name = (r: string) => ix.byIdOf(r)?.name ?? r;
  const out: [string, string][] = [];
  for (const k of Object.keys(FIELD_LABEL) as (keyof ProposalFields)[]) {
    const v = f[k];
    if (v === undefined || (Array.isArray(v) && !v.length)) continue;
    const text = k === 'participants' ? (v as string[]).map(name).join(', ')
      : k === 'aliases' ? (v as string[]).join(', ')
      : k === 'actions' ? (f.actions ?? []).map((a) => [name(a.actor), a.verb, a.target ? name(a.target) : ''].join(' ').trim()).join('; ')
      : k === 'relations' ? (f.relations ?? []).map((r) => `${relationLabel(r.type)} ${name(r.target)}${r.from ? ` (from ${r.from})` : ''}`).join('; ')
      : k === 'place' ? name(v as string)
      : String(v);
    out.push([FIELD_LABEL[k], text]);
  }
  return out;
}

function ProposalsPanel({ world, chapter, analysis, actions, manual, onManualDone }: {
  world: World; chapter: StoryChapter; analysis: StoryAnalysis; actions: StoryActions;
  /** A proposal made from picked text, shown first with its form open. */
  manual: { p: Proposal; mode: 'edit' | 'merge' } | null;
  onManualDone: () => void;
}) {
  const ix = useMemo(() => new WorldIndex(world), [world]);
  const here = (p: Proposal) => [p.sourceSpan, ...(p.alsoAt ?? [])].some((s) => s.chapter === chapter.file);
  const open = [...analysis.proposals].sort((a, b) => Number(here(b)) - Number(here(a)));
  const existing = [...new Map(analysis.links.filter((l) => l.sourceSpan.chapter === chapter.file).map((l) => [l.entryId, l])).values()]
    .map((l) => ({ entry: ix.byIdOf(l.entryId), span: l.sourceSpan }))
    .filter((x): x is { entry: Entry; span: SourceSpan } => !!x.entry);
  return (
    <section class="proposals" aria-labelledby="proposals-title">
      <div class="pane-head">
        <h2 id="proposals-title"><Icon name="sparkles" /> Proposals</h2>
        {open.length > 1 && <button type="button" class="ghost small" onClick={() => actions.onIgnore(open)}><Icon name="semi-closed-eye" /> Ignore all</button>}
      </div>
      <p class="muted small">Found in your story. Nothing is added until you choose.</p>
      {open.length === 0 && <p class="proposals-empty muted">No new people, places or events found. Try “King Camel was born in 1998.”</p>}
      <ul class="proposal-list">
        {manual && <ProposalCard key={`${manual.p.key}:${manual.mode}`} p={manual.p} ix={ix} world={world} initial={manual.mode} onDone={onManualDone} actions={actions} />}
        {open.map((p) => <ProposalCard key={p.key} p={p} ix={ix} world={world} actions={actions} otherChapter={!here(p) ? world.story?.find((c) => c.file === p.sourceSpan.chapter)?.title : undefined} />)}
      </ul>
      {existing.length > 0 && (
        <>
          <h3 class="proposals-sub">Already in your world</h3>
          <ul class="exists-list">
            {existing.map(({ entry }) => (
              <li key={entry.id} class="exists-item">
                <button type="button" class="link exists-link" onClick={() => actions.onOpen(entry.id)}>
                  Already exists: {entry.name} ({TYPE_SINGULAR[entry.type].toLowerCase()})
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {analysis.ignored.length > 0 && (
        <details class="ignored-list">
          <summary>Ignored ({analysis.ignored.length})</summary>
          <ul>
            {analysis.ignored.map((p) => (
              <li key={p.key}>
                <span>{p.kind === 'create' ? 'New' : 'Update'} {TYPE_SINGULAR[p.entryType].toLowerCase()} {p.name}</span>
                <button type="button" class="ghost small" onClick={() => actions.onRestore(p.key)}>Restore</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function ProposalCard({ p, ix, world, actions, otherChapter, initial, onDone }: {
  p: Proposal; ix: WorldIndex; world: World; actions: StoryActions; otherChapter?: string | undefined;
  /** Picked-text proposals open straight in a form and go away when it closes. */
  initial?: 'edit' | 'merge';
  onDone?: () => void;
}) {
  const [mode, setModeRaw] = useState<'view' | 'edit' | 'merge'>(initial ?? 'view');
  const setMode = (m: 'view' | 'edit' | 'merge') => (m === 'view' && onDone ? onDone() : setModeRaw(m));
  const target = p.matchedExistingId ? ix.byIdOf(p.matchedExistingId) : undefined;
  const prev = p.previous ? fieldLines(p.previous, ix) : [];
  return (
    <li class={`proposal t-${p.entryType}${onDone ? ' is-picked' : ''}`} data-key={p.key}>
      <div class="proposal-head">
        <TypeBadge type={p.entryType} short />
        <span class="proposal-name">{p.name}</span>
        <span class="proposal-kind">{onDone ? 'From your selection' : p.kind === 'create' ? `New ${TYPE_SINGULAR[p.entryType].toLowerCase()}` : 'Update'}</span>
      </div>
      {target && <p class="proposal-target">Changes <button type="button" class="link" onClick={() => actions.onOpen(target.id)}><EntryLabel entry={target} /></button></p>}
      <dl class="proposal-fields">
        {fieldLines(p.fields, ix).map(([k, v]) => {
          const was = prev.find(([pk]) => pk === k)?.[1];
          return <Fragment key={k}><dt>{k}</dt><dd>{was ? <><s class="muted">{was}</s> <span class="sr-only">changes to</span> {v}</> : v}</dd></Fragment>;
        })}
      </dl>
      <button type="button" class="link proposal-quote" onClick={() => actions.onJump(p.sourceSpan)} title="Show the sentence">
        “{p.sourceSpan.quote}”{otherChapter && <span class="muted"> ({otherChapter})</span>}
      </button>
      {mode === 'view' && (
        <div class="proposal-actions">
          <button type="button" class="primary small" onClick={() => actions.onAdd(p)}><Icon name="check-mark" /> {p.kind === 'create' ? 'Add' : 'Apply'}</button>
          <button type="button" class="small" onClick={() => setMode('edit')}><Icon name="pencil" /> Edit…</button>
          {p.kind === 'create' && <button type="button" class="small" onClick={() => setMode('merge')}><Icon name="linked-rings" /> Merge…</button>}
          <button type="button" class="ghost small" onClick={() => actions.onIgnore([p])}><Icon name="semi-closed-eye" /> Ignore</button>
        </div>
      )}
      {mode === 'edit' && <ProposalForm p={p} onCancel={() => setMode('view')} onSave={(q) => { setMode('view'); actions.onAdd(q); }} />}
      {mode === 'merge' && <MergeForm p={p} world={world} onCancel={() => setMode('view')} onMerge={(id) => { setMode('view'); actions.onMerge(p, id); }} />}
    </li>
  );
}

/** Edit a proposal before adding it: type, name, title, dates, place, and which relations to keep. */
function ProposalForm({ p, onSave, onCancel }: { p: Proposal; onSave: (p: Proposal) => void; onCancel: () => void }) {
  const [type, setType] = useState<EntryType>(p.entryType);
  const [name, setName] = useState(p.name);
  const [f, setF] = useState<ProposalFields>(p.fields);
  const [keep, setKeep] = useState<boolean[]>((p.fields.relations ?? []).map(() => true));
  const text = (k: 'title' | 'occupation' | 'gender' | 'born' | 'died' | 'date' | 'place', label: string) => (
    <label class="field">
      <span>{label}</span>
      <input value={(f[k] as string | undefined) ?? ''} onInput={(e) => setF({ ...f, [k]: e.currentTarget.value })} />
    </label>
  );
  const save = (e: Event) => {
    e.preventDefault();
    const fields: ProposalFields = { ...f, relations: (f.relations ?? []).filter((_, i) => keep[i]) };
    for (const k of ['title', 'occupation', 'gender', 'born', 'died', 'date', 'place'] as const) if (!fields[k]?.trim()) delete fields[k];
    if (!fields.relations?.length) delete fields.relations;
    onSave({ ...p, entryType: type, name: name.trim() || p.name, fields });
  };
  const isCreate = p.kind === 'create';
  return (
    <form class="proposal-form" onSubmit={save} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      {isCreate && (
        <div class="row">
          <label class="field">
            <span>Type</span>
            <Select value={type} onChange={(v) => setType(v as EntryType)} options={ENTRY_TYPES.map((t) => ({ value: t, label: TYPE_SINGULAR[t], icon: TYPE_ICON[t], tone: `t-${t}` }))} />
          </label>
          <label class="field">
            <span>Name</span>
            <input value={name} onInput={(e) => setName(e.currentTarget.value)} autoFocus />
          </label>
        </div>
      )}
      <div class="row">
        {type === 'character' && <>{text('title', 'Title')}{text('occupation', 'Occupation')}{text('gender', 'Gender')}</>}
        {(type === 'character' || type === 'faction' || type === 'place' || type === 'item') && <>{text('born', type === 'character' ? 'Born' : 'Founded / made')}{text('died', type === 'character' ? 'Died' : 'Ended')}</>}
        {type === 'event' && <>{text('date', 'Date')}{text('place', 'Place')}</>}
      </div>
      {(f.relations ?? []).length > 0 && (
        <fieldset class="proposal-rels">
          <legend>Relations</legend>
          {(f.relations ?? []).map((r, i) => (
            <label key={i} class="check">
              <input type="checkbox" checked={keep[i]} onChange={(e) => setKeep(keep.map((k, j) => (j === i ? e.currentTarget.checked : k)))} />
              {relationLabel(r.type)} {r.target}{r.from ? ` (from ${r.from})` : ''}
            </label>
          ))}
        </fieldset>
      )}
      <div class="row">
        <button type="submit" class="primary small"><Icon name="check-mark" /> {isCreate ? 'Add' : 'Apply'}</button>
        <button type="button" class="ghost small" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** Fold a proposal into an entry that already exists (the name becomes an alias). */
function MergeForm({ p, world, onMerge, onCancel }: { p: Proposal; world: World; onMerge: (id: string) => void; onCancel: () => void }) {
  const choices = [...world.entries].sort((a, b) => Number(b.type === p.entryType) - Number(a.type === p.entryType) || a.name.localeCompare(b.name));
  const [id, setId] = useState(choices[0]?.id ?? '');
  return (
    <form class="proposal-form" onSubmit={(e) => { e.preventDefault(); if (id) onMerge(id); }} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <label class="field">
        <span>Merge “{p.name}” into</span>
        <Select value={id} onChange={setId} autoFocus options={choices.map((e) => ({ value: e.id, label: `${e.name} (${TYPE_SINGULAR[e.type].toLowerCase()})`, icon: entryIcon(e), tone: `t-${e.type}` }))} />
      </label>
      <div class="row">
        <button type="submit" class="primary small" disabled={!id}><Icon name="linked-rings" /> Merge</button>
        <button type="button" class="ghost small" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
