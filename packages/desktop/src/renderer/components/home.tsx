import { useMemo, useState } from 'preact/hooks';
import { ENTRY_TYPES, isEnded, LIFECYCLE, racesOf, statusOf, TYPE_ICON, TYPE_LABELS, WorldIndex, type Entry, type IconName, type Warning, type World, type WorldCoverSettings } from '@lore-forge/core';
import { Icon } from './icon.tsx';
import { Portrait, WorldBookCover } from './cover.tsx';
import { PictureEditor } from './picture.tsx';
import { CoverEditor } from './cover-editor.tsx';
import { kindOf } from './severity.tsx';
import { animated } from '../motion.ts';

interface Props {
  dir: string;
  world: World;
  warnings: Warning[];
  onOpen: (id: string) => void;
  onGo: (to: 'timeline' | 'tree' | 'web' | 'codex' | 'book') => void;
  onChange: (entry: Entry) => void;
  onCoverSave: (cover: WorldCoverSettings, picked?: string) => Promise<void>;
  /** Open World settings (the calendar: eras and months). */
  onSettings: () => void;
  /** Read every file of the world again from disk (after editing them outside Lore-Forge). */
  onReload: () => void;
  /** Close the world and go back to the library shelf. */
  onLibrary: () => void;
}

/** One line under a card: race or status for people and places, the summary for the rest. */
function tagline(ix: WorldIndex, e: Entry): string {
  const status = LIFECYCLE[e.type]?.statuses.find((x) => x.value === statusOf(e));
  const race = racesOf(e).map((r) => ix.nameOf(r)).join(', ') || undefined;
  return [race, status && status.value !== 'unknown' ? status.label : undefined].filter(Boolean).join(' · ') || e.summary || '';
}

/** The world at a glance: its cover, what is in it, and a card for every entry. */
export function WorldHome({ dir, world, warnings, onOpen, onGo, onChange, onCoverSave, onSettings, onReload, onLibrary }: Props) {
  const ix = useMemo(() => new WorldIndex(world), [world]);
  const [editing, setEditing] = useState<string | null>(null);
  const [coverOpen, setCoverOpen] = useState(false);
  const picking = editing ? world.entries.find((e) => e.id === editing) : undefined;
  const errors = warnings.filter((w) => kindOf(w) === 'error').length;
  const groups = ENTRY_TYPES.map((t) => [t, world.entries.filter((e) => e.type === t).sort((a, b) => a.name.localeCompare(b.name))] as const);
  const actions: [Parameters<Props['onGo']>[0], IconName, string][] = [
    ['timeline', 'hourglass', 'Timeline'], ['tree', 'family-tree', 'Family tree'], ['web', 'spider-web', 'Relationship web'],
    ['codex', 'book-cover', 'World Codex'], ['book', 'open-book', 'Story Book'],
  ];
  return (
    <div class="home">
      <section class="home-hero" aria-labelledby="home-title">
        <button type="button" class="home-cover" onClick={() => setCoverOpen(true)} aria-label={`Change the cover of ${world.manifest.name}`} title="Change the cover">
          <span class="cover-page" aria-hidden="true" />
          <span class="world-cover"><WorldBookCover dir={dir} world={world} title={world.manifest.name} /></span>
          <span class="home-cover-badge" aria-hidden="true"><Icon name="paint-brush" /> Change cover</span>
        </button>
        <div class="home-intro">
          <button type="button" class="ghost small home-library" onClick={onLibrary} title="Close this world and go back to the shelf of worlds"><Icon name="bookshelf" /> Library</button>
          <h2 id="home-title" class="home-title">{world.manifest.name}</h2>
          {world.manifest.description && <p class="home-desc">{world.manifest.description}</p>}
          <ul class="home-stats" aria-label="What is in this world">
            {groups.map(([t, list]) => (
              <li key={t} class={`t-${t}`}><a href={`#home-${t}`} onClick={(e) => { e.preventDefault(); document.getElementById(`home-${t}`)?.scrollIntoView({ block: 'start' }); }}><Icon name={TYPE_ICON[t]} /> <strong>{list.length}</strong> {TYPE_LABELS[t]}</a></li>
            ))}
          </ul>
          <p class="muted home-facts">
            {world.manifest.calendar.eras.length} {world.manifest.calendar.eras.length === 1 ? 'era' : 'eras'} · {warnings.length ? `${warnings.length} warnings${errors ? `, ${errors} errors` : ''}` : 'no warnings'}
          </p>
          <div class="home-actions">
            {actions.map(([to, icon, label]) => <button key={to} type="button" class={to === 'codex' || to === 'book' ? 'publish' : 'ghost'} onClick={() => onGo(to)}><Icon name={icon} /> {label}</button>)}
            <button type="button" class="ghost home-settings" onClick={onSettings}><Icon name="cog" /> World settings</button>
            <button type="button" class="ghost home-reload" onClick={onReload} title="Read every file of this world again, after editing them outside Lore-Forge"><Icon name="cycle" /> Reload from disk</button>
          </div>
        </div>
      </section>
      {groups.map(([t, list]) => list.length > 0 && (
        <section key={t} class={`home-group t-${t}`} aria-labelledby={`home-${t}`}>
          <h3 id={`home-${t}`} tabIndex={-1}><Icon name={TYPE_ICON[t]} /> {TYPE_LABELS[t]} <span class="muted">({list.length})</span></h3>
          <ul class="tile-grid" ref={animated}>
            {list.map((e) => {
              const lc = LIFECYCLE[e.type];
              const ended = isEnded(e);
              return (
                <li key={e.id} class="tile-cell" data-tile-id={e.id}>
                  <button type="button" class={`entry-tile t-${e.type}${ended ? ' is-ended' : ''}`} onClick={() => onOpen(e.id)}>
                    <Portrait entry={e} size="lg" />
                    <span class="tile-name">{e.name}{ended && lc && <> <Icon name={lc.endedIcon} label={lc.endedWord} /></>}</span>
                    <span class="tile-sub muted">{tagline(ix, e)}</span>
                  </button>
                  <button type="button" class="tile-paint" onClick={() => setEditing(e.id)} aria-label={`Change the picture for ${e.name}`} title="Change icon, colours or picture"><Icon name="paint-brush" /></button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {coverOpen && <CoverEditor dir={dir} world={world} onSave={onCoverSave} onClose={() => setCoverOpen(false)} />}
      {picking && <PictureEditor dir={dir} entry={picking} onChange={onChange} onClose={() => setEditing(null)} />}
    </div>
  );
}
