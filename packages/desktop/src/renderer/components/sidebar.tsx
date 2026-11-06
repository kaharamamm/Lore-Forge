import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { ENTRY_TYPES, isEnded, LIFECYCLE, raceLabel, racesOf, searchEntries, TYPE_ICON, TYPE_LABELS, TYPE_SINGULAR, type Entry, type EntryType, type Warning } from '@lore-forge/core';
import { CountBadge } from './severity.tsx';
import { ENTRY_DRAG } from './link-edit.tsx';
import { Icon } from './icon.tsx';
import { animated } from '../motion.ts';
import { Portrait } from './cover.tsx';
import { Snippet } from './snippet.tsx';
import { useEvent } from '../hooks.ts';

const NO_WARNINGS: Warning[] = [];

interface Props {
  entries: Entry[];
  warnings: Warning[];
  selectedId: string | null;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
  onCreate: (type: EntryType, name: string) => void;
  /** Which type's "new entry" form is open; lifted so the app can open and reset it. */
  creating: EntryType | null;
  onCreating: (type: EntryType | null) => void;
}

export function Sidebar({ entries, warnings, selectedId, query, onQuery, onSelect, onCreate, creating, onCreating: setCreating }: Props) {
  const [name, setName] = useState('');
  // A query searches names first, then basic facts, summary, appearance and details, then the body text.
  const hits = useMemo(() => (query.trim() ? searchEntries({ entries }, query) : null), [entries, query]);
  // Each row's warnings and race names, worked out once per change instead of per row on every render.
  const warned = useMemo(() => {
    const by = new Map<string, Warning[]>();
    for (const w of warnings) for (const id of new Set([w.offending.entryId, w.conflicting?.entryId])) if (id) by.set(id, [...(by.get(id) ?? []), w]);
    return by;
  }, [warnings]);
  const names = useMemo(() => new Map(entries.map((e) => [e.id, e.name])), [entries]);
  const select = useEvent(onSelect);
  const link = (e: Entry, snippet?: preact.ComponentChildren) => (
    <EntryRow entry={e} selected={e.id === selectedId} warnings={warned.get(e.id) ?? NO_WARNINGS} onSelect={select} snippet={snippet}
      sub={e.type === 'character' && e.race ? racesOf(e).map((r) => raceLabel(r, (x) => names.get(x))).join(', ') : undefined} />
  );
  return (
    <nav class="sidebar" aria-label="Entries">
      <div class="search">
        <label for="search" class="sr-only">Search entries</label>
        <input id="search" type="search" placeholder="Search..." value={query} onInput={(e) => onQuery(e.currentTarget.value)} />
      </div>
      {hits && (
        <section class="search-results" aria-labelledby="search-results-title">
          <div class="type-head"><h2 id="search-results-title"><Icon name="magnifying-glass" /> Results <span class="muted">({hits.length})</span></h2></div>
          <p class="sr-only" aria-live="polite">{hits.length} {hits.length === 1 ? 'entry matches' : 'entries match'}</p>
          {hits.length === 0 && <p class="muted empty-hint">No entry mentions “{query.trim()}”.</p>}
          <ul ref={animated}>
            {hits.map((h) => <li key={h.entry.id}>{link(h.entry, h.field === 'Name' ? undefined : <Snippet hit={h} />)}</li>)}
          </ul>
        </section>
      )}
      {!hits && ENTRY_TYPES.map((type) => {
        const list = entries.filter((e) => e.type === type).sort((a, b) => a.name.localeCompare(b.name));
        return (
          <section class={`type-group t-${type}`} key={type} aria-labelledby={`group-${type}`}>
            <div class="type-head">
              <h2 id={`group-${type}`}><Icon name={TYPE_ICON[type]} /> {TYPE_LABELS[type]} <span class="muted">({list.length})</span></h2>
              <button type="button" class="ghost small" aria-label={`New ${TYPE_SINGULAR[type].toLowerCase()}`} onClick={() => { setCreating(type); setName(''); }}>+ New</button>
            </div>
            {creating === type && (
              <NewEntryForm type={type} name={name} onName={setName} onCreate={(n) => { onCreate(type, n); setCreating(null); }} onCancel={() => setCreating(null)} />
            )}
            {list.length === 0 && (
              <p class="muted empty-hint">No {TYPE_LABELS[type].toLowerCase()} yet. “+ New” adds one.</p>
            )}
            <ul ref={animated}>
              {list.map((e) => <li key={e.id}>{link(e)}</li>)}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}

/** One entry in the list. Memoized: typing in one entry leaves the other rows alone. */
const EntryRow = memo(function EntryRow({ entry: e, selected, warnings, sub, snippet, onSelect }: {
  entry: Entry; selected: boolean; warnings: Warning[]; sub: string | undefined; snippet?: preact.ComponentChildren; onSelect: (id: string) => void;
}) {
  const ended = isEnded(e);
  const lc = LIFECYCLE[e.type];
  return (
    <button type="button" class={`entry-link t-${e.type}${ended ? ' is-ended' : ''}${snippet ? ' has-snippet' : ''}`} aria-current={selected ? 'page' : undefined} data-entry-id={e.id} onClick={() => onSelect(e.id)}
      draggable onDragStart={(ev) => { ev.dataTransfer?.setData(ENTRY_DRAG, e.id); ev.dataTransfer?.setData('text/plain', e.name); if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy'; }}>
      <Portrait entry={e} size="xs" />
      <span class="entry-name" title={e.name}>{e.name}{ended && lc && <span class="ended-mark" title={lc.endedWord}> <Icon name={lc.endedIcon} /><span class="sr-only">({lc.endedWord})</span></span>}</span>
      {sub && <span class="entry-sub">{sub}</span>}
      <CountBadge warnings={warnings} />
      {snippet}
    </button>
  );
});

/**
 * The name box under "+ New". Enter creates the entry; Escape, ×, a click outside, or leaving it empty closes it
 * without creating anything.
 */
function NewEntryForm({ type, name, onName, onCreate, onCancel }: { type: EntryType; name: string; onName: (n: string) => void; onCreate: (name: string) => void; onCancel: () => void }) {
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Focused here rather than with autofocus, which the browser honours only once per page.
    input.current?.focus();
    const outside = (e: PointerEvent) => { if (!form.current?.contains(e.target as Node)) onCancel(); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, []);
  return (
    <form ref={form} class="new-entry" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate(name.trim()); else onCancel(); }}>
      <label for={`new-${type}`} class="sr-only">Name of the new entry</label>
      <input id={`new-${type}`} type="text" placeholder="Name, then Enter" value={name} ref={input} onInput={(e) => onName(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
        onBlur={(e) => { if (!e.currentTarget.value.trim() && !form.current?.contains(e.relatedTarget as Node)) onCancel(); }} />
      <button type="button" class="ghost small icon-only new-entry-cancel" aria-label="Cancel" title="Cancel (Esc)" onClick={onCancel}><Icon name="cancel" /></button>
    </form>
  );
}
