import { useState } from 'preact/hooks';
import { ENTRY_TYPES, isEnded, LIFECYCLE, normalizeName, TYPE_ICON, TYPE_LABELS, TYPE_SINGULAR, type Entry, type EntryType, type Warning } from '@lore-forge/core';
import { CountBadge } from './severity.tsx';
import { involves } from './warnings.tsx';
import { Icon } from './icon.tsx';

interface Props {
  entries: Entry[];
  warnings: Warning[];
  selectedId: string | null;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
  onCreate: (type: EntryType, name: string) => void;
}

export function Sidebar({ entries, warnings, selectedId, query, onQuery, onSelect, onCreate }: Props) {
  const [creating, setCreating] = useState<EntryType | null>(null);
  const [name, setName] = useState('');
  const q = normalizeName(query);
  const matches = (e: Entry) => !q || [e.name, e.id, ...(e.aliases ?? []), ...(e.tags ?? [])].some((s) => normalizeName(s).includes(q));
  return (
    <nav class="sidebar" aria-label="Entries">
      <div class="search">
        <label for="search" class="sr-only">Search entries</label>
        <input id="search" type="search" placeholder="Search (Ctrl+K)" value={query} onInput={(e) => onQuery(e.currentTarget.value)} />
      </div>
      {ENTRY_TYPES.map((type) => {
        const list = entries.filter((e) => e.type === type && matches(e)).sort((a, b) => a.name.localeCompare(b.name));
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
              <p class="muted empty-hint">{q ? 'No matches.' : `No ${TYPE_LABELS[type].toLowerCase()} yet — “+ New” adds one.`}</p>
            )}
            <ul>
              {list.map((e) => {
                const ended = isEnded(e);
                const lc = LIFECYCLE[e.type];
                return (
                <li key={e.id}>
                  <button type="button" class={`entry-link t-${e.type}${ended ? ' is-ended' : ''}`} aria-current={e.id === selectedId ? 'page' : undefined} data-entry-id={e.id} onClick={() => onSelect(e.id)}>
                    <span class="entry-name">{e.name}{ended && lc && <span class="ended-mark" title={lc.endedWord}> <Icon name={lc.endedIcon} /><span class="sr-only">({lc.endedWord})</span></span>}</span>
                    {e.type === 'character' && e.race && <span class="entry-sub">{e.race}</span>}
                    <CountBadge warnings={warnings.filter((w) => involves(w, e.id))} />
                  </button>
                </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
