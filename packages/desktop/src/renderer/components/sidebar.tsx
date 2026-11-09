import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { ENTRY_TYPES, isEnded, LIFECYCLE, raceLabel, racesOf, searchChapters, searchEntries, searchMaps, TYPE_ICON, TYPE_LABELS, TYPE_SINGULAR, type Entry, type EntryType, type StoryChapter, type Warning, type WorldMap } from '@lore-forge/core';
import { lower, t, tm } from '../i18n.tsx';
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
  /** The chapters and maps, which a search finds too. */
  story: StoryChapter[] | undefined;
  maps: WorldMap[] | undefined;
  warnings: Warning[];
  selectedId: string | null;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
  /** Open a chapter in the Story (at the match in its text), or a map in the Map. */
  onChapter: (file: string, span?: [number, number]) => void;
  onMap: (id: string) => void;
  onCreate: (type: EntryType, name: string) => void;
  /** Which type's "new entry" form is open; lifted so the app can open and reset it. */
  creating: EntryType | null;
  onCreating: (type: EntryType | null) => void;
}

export function Sidebar({ entries, story, maps, warnings, selectedId, query, onQuery, onSelect, onChapter, onMap, onCreate, creating, onCreating: setCreating }: Props) {
  const [name, setName] = useState('');
  // A query searches names first, then basic facts, summary, appearance and details, then the body text.
  const hits = useMemo(() => (query.trim() ? searchEntries({ entries }, query) : null), [entries, query]);
  // Chapters (titles, then text) and maps (names) that match, listed after the entries.
  const chapterHits = useMemo(() => (query.trim() ? searchChapters({ story }, query) : []), [story, query]);
  const mapHits = useMemo(() => (query.trim() ? searchMaps({ maps }, query) : []), [maps, query]);
  const others = chapterHits.length + mapHits.length;
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
    <nav class="sidebar" aria-label={t('Entries')}>
      <div class="search">
        <label for="search" class="sr-only">{t('Search entries')}</label>
        <input id="search" type="search" placeholder={t('Search...')} value={query} onInput={(e) => onQuery(e.currentTarget.value)} />
      </div>
      {hits && (hits.length > 0 || !others) && (
        <section class="search-results" aria-labelledby="search-results-title">
          <div class="type-head"><h2 id="search-results-title"><Icon name="magnifying-glass" /> {t('Results')} <span class="muted">({hits.length})</span></h2></div>
          <p class="sr-only" aria-live="polite">{hits.length === 1 ? t('{n} entry matches', { n: hits.length }) : t('{n} entries match', { n: hits.length })}</p>
          {hits.length === 0 && <p class="muted empty-hint">{t('No entry mentions “{query}”.', { query: query.trim() })}</p>}
          <ul ref={animated}>
            {hits.map((h) => <li key={h.entry.id}>{link(h.entry, h.field === 'Name' ? undefined : <Snippet hit={h} />)}</li>)}
          </ul>
        </section>
      )}
      {hits && chapterHits.length > 0 && (
        <section class="search-also search-chapters" aria-labelledby="search-chapters-title">
          <div class="type-head"><h2 id="search-chapters-title"><Icon name="feather" /> {t('Chapters')} <span class="muted">({chapterHits.length})</span></h2></div>
          <ul>
            {chapterHits.map((h) => (
              <li key={h.file}>
                <button type="button" class={`entry-link search-link${h.field === 'Text' ? ' has-snippet' : ''}`} data-chapter={h.file} onClick={() => onChapter(h.file, h.span)}>
                  <span class="search-link-icon" aria-hidden="true"><Icon name="feather" /></span>
                  <span class="entry-name" title={h.title}>{h.title || t('Untitled')}</span>
                  {h.field === 'Text' && <Snippet hit={h} />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {hits && mapHits.length > 0 && (
        <section class="search-also search-maps" aria-labelledby="search-maps-title">
          <div class="type-head"><h2 id="search-maps-title"><Icon name="treasure-map" /> {t('Maps')} <span class="muted">({mapHits.length})</span></h2></div>
          <ul>
            {mapHits.map((m) => (
              <li key={m.id}>
                <button type="button" class="entry-link search-link" data-map={m.id} onClick={() => onMap(m.id)}>
                  <span class="search-link-icon" aria-hidden="true"><Icon name="treasure-map" /></span>
                  <span class="entry-name" title={m.name}>{m.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!hits && ENTRY_TYPES.map((type) => {
        const list = entries.filter((e) => e.type === type).sort((a, b) => a.name.localeCompare(b.name));
        return (
          <section class={`type-group t-${type}`} key={type} aria-labelledby={`group-${type}`}>
            <div class="type-head">
              <h2 id={`group-${type}`}><Icon name={TYPE_ICON[type]} /> {tm(TYPE_LABELS[type])} <span class="muted">({list.length})</span></h2>
              <button type="button" class="ghost small" aria-label={t('New {type}', { type: lower(tm(TYPE_SINGULAR[type])) })} onClick={() => { setCreating(type); setName(''); }}>{t('+ New')}</button>
            </div>
            {creating === type && (
              <NewEntryForm type={type} name={name} onName={setName} onCreate={(n) => { onCreate(type, n); setCreating(null); }} onCancel={() => setCreating(null)} />
            )}
            {list.length === 0 && (
              <p class="muted empty-hint">{t('No {types} yet. “+ New” adds one.', { types: lower(tm(TYPE_LABELS[type])) })}</p>
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
      <span class="entry-name" title={e.name}>{e.name}{ended && lc && <span class="ended-mark" title={tm(lc.endedWord)}> <Icon name={lc.endedIcon} /><span class="sr-only">({tm(lc.endedWord)})</span></span>}</span>
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
      <label for={`new-${type}`} class="sr-only">{t('Name of the new entry')}</label>
      <input id={`new-${type}`} type="text" placeholder={t('Name, then Enter')} value={name} ref={input} onInput={(e) => onName(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
        onBlur={(e) => { if (!e.currentTarget.value.trim() && !form.current?.contains(e.relatedTarget as Node)) onCancel(); }} />
      <button type="button" class="ghost small icon-only new-entry-cancel" aria-label={t('Cancel')} title={t('Cancel (Esc)')} onClick={onCancel}><Icon name="cancel" /></button>
    </form>
  );
}
