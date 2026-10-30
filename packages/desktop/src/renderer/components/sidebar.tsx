import { useMemo, useState } from 'preact/hooks';
import { ENTRY_TYPES, isEnded, LIFECYCLE, searchEntries, TYPE_ICON, TYPE_LABELS, TYPE_SINGULAR, type Entry, type EntryType, type Warning } from '@lore-forge/core';
import { CountBadge } from './severity.tsx';
import { involves } from './warnings.tsx';
import { ENTRY_DRAG } from './link-edit.tsx';
import { Icon } from './icon.tsx';
import { animated } from '../motion.ts';
import { Portrait } from './cover.tsx';
import { Snippet } from './snippet.tsx';

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
  const link = (e: Entry, snippet?: preact.ComponentChildren) => {
    const ended = isEnded(e);
    const lc = LIFECYCLE[e.type];
    return (
      <button type="button" class={`entry-link t-${e.type}${ended ? ' is-ended' : ''}${snippet ? ' has-snippet' : ''}`} aria-current={e.id === selectedId ? 'page' : undefined} data-entry-id={e.id} onClick={() => onSelect(e.id)}
        draggable onDragStart={(ev) => { ev.dataTransfer?.setData(ENTRY_DRAG, e.id); ev.dataTransfer?.setData('text/plain', e.name); if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy'; }}>
        <Portrait entry={e} size="xs" />
        <span class="entry-name" title={e.name}>{e.name}{ended && lc && <span class="ended-mark" title={lc.endedWord}> <Icon name={lc.endedIcon} /><span class="sr-only">({lc.endedWord})</span></span>}</span>
        {e.type === 'character' && e.race && <span class="entry-sub">{e.race}</span>}
        <CountBadge warnings={warnings.filter((w) => involves(w, e.id))} />
        {snippet}
      </button>
    );
  };
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
              <form class="new-entry" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onCreate(type, name.trim()); setCreating(null); } }}>
                <label for={`new-${type}`} class="sr-only">Name of the new entry</label>
                <input id={`new-${type}`} type="text" placeholder="Name, then Enter" value={name} autoFocus onInput={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Escape' && setCreating(null)} />
              </form>
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
