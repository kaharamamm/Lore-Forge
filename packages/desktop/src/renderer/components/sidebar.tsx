import { useState } from 'preact/hooks';
import { ENTRY_TYPES, normalizeName, TYPE_LABELS, type Entry, type EntryType, type Warning } from '@lore-forge/core';
import { CountBadge } from './severity.tsx';
import { involves } from './warnings.tsx';

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
          <section class="type-group" key={type} aria-labelledby={`group-${type}`}>
            <div class="type-head">
              <h2 id={`group-${type}`}>{TYPE_LABELS[type]} <span class="muted">({list.length})</span></h2>
              <button type="button" class="ghost small" aria-label={`New ${TYPE_LABELS[type].replace(/s$/, '').toLowerCase()}`} onClick={() => { setCreating(type); setName(''); }}>+ New</button>
            </div>
            {creating === type && (
              <form class="new-entry" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onCreate(type, name.trim()); setCreating(null); } }}>
                <label for={`new-${type}`} class="sr-only">Name of the new entry</label>
                <input id={`new-${type}`} type="text" placeholder="Name, then Enter" value={name} autoFocus onInput={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Escape' && setCreating(null)} />
              </form>
            )}
            <ul>
              {list.map((e) => (
                <li key={e.id}>
                  <button type="button" class="entry-link" aria-current={e.id === selectedId ? 'page' : undefined} data-entry-id={e.id} onClick={() => onSelect(e.id)}>
                    <span class="entry-name">{e.name}</span>
                    <CountBadge warnings={warnings.filter((w) => involves(w, e.id))} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
