import { useMemo, useState } from 'preact/hooks';
import { ENTRY_TYPES, isEnded, LIFECYCLE, raceLabel, racesOf, statusOf, TYPE_ICON, TYPE_LABELS, WorldIndex, type Entry, type IconName, type Warning, type World, type WorldCoverSettings } from '@lore-forge/core';
import { Icon } from './icon.tsx';
import { Portrait, WorldBookCover } from './cover.tsx';
import { PictureEditor } from './picture.tsx';
import { CoverEditor } from './cover-editor.tsx';
import { kindOf } from './severity.tsx';
import { animated } from '../motion.ts';
import { t, tj, tm } from '../i18n.tsx';

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
  /** Open Settings (language, display, library), as in the top bar. */
  onAppSettings: () => void;
  /** Read every file of the world again from disk (after editing them outside Lore-Forge). */
  onReload: () => void;
  /** Close the world and go back to the library shelf. */
  onLibrary: () => void;
  /** Make an editable copy of this world (and open it). */
  onDuplicate: () => void;
  /** This is the read-only sample that ships with the app. */
  sample?: boolean;
}

/** One line under a card: race or status for people and places, the summary for the rest. */
function tagline(ix: WorldIndex, e: Entry): string {
  const status = LIFECYCLE[e.type]?.statuses.find((x) => x.value === statusOf(e));
  const race = racesOf(e).map((r) => raceLabel(r, (x) => ix.resolve(x)?.name)).join(', ') || undefined;
  return [race, status && status.value !== 'unknown' ? tm(status.label) : undefined].filter(Boolean).join(' · ') || e.summary || '';
}

/** The world at a glance: its cover, what is in it, and a card for every entry. */
export function WorldHome({ dir, world, warnings, onOpen, onGo, onChange, onCoverSave, onSettings, onAppSettings, onReload, onLibrary, onDuplicate, sample = false }: Props) {
  const ix = useMemo(() => new WorldIndex(world), [world]);
  const [editing, setEditing] = useState<string | null>(null);
  const [coverOpen, setCoverOpen] = useState(false);
  const picking = editing ? world.entries.find((e) => e.id === editing) : undefined;
  // Open warnings only: the ones marked as intended are not something to fix.
  const open = warnings.filter((w) => !w.intended);
  const errors = open.filter((w) => kindOf(w) === 'error').length;
  const eras = world.manifest.calendar.eras.length;
  const groups = ENTRY_TYPES.map((t) => [t, world.entries.filter((e) => e.type === t).sort((a, b) => a.name.localeCompare(b.name))] as const);
  const actions: [Parameters<Props['onGo']>[0], IconName, string][] = [
    ['timeline', 'hourglass', t('Timeline')], ['tree', 'family-tree', t('Family tree')], ['web', 'spider-web', t('Relationship web')],
    ['codex', 'book-cover', t('World Codex')], ['book', 'open-book', t('Story Book')],
  ];
  return (
    <div class="home">
      <section class="home-hero" aria-labelledby="home-title">
        <button type="button" class="home-cover" onClick={() => setCoverOpen(true)} aria-label={t('Change the cover of {world}', { world: world.manifest.name })} title={t('Change the cover')}>
          <span class="cover-page" aria-hidden="true" />
          <span class="world-cover"><WorldBookCover dir={dir} world={world} title={world.manifest.name} /></span>
          <span class="home-cover-badge" aria-hidden="true"><Icon name="paint-brush" /> {t('Change cover')}</span>
        </button>
        <div class="home-intro">
          <button type="button" class="ghost small home-library" onClick={onLibrary} title={t('Close this world and go back to the shelf of worlds')}><Icon name="bookshelf" /> {t('Library')}</button>
          <h2 id="home-title" class="home-title">{world.manifest.name}</h2>
          {world.manifest.description && <p class="home-desc">{world.manifest.description}</p>}
          <ul class="home-stats" aria-label={t('What is in this world')}>
            {groups.map(([t, list]) => (
              <li key={t} class={`t-${t}`}><a href={`#home-${t}`} onClick={(e) => { e.preventDefault(); document.getElementById(`home-${t}`)?.scrollIntoView({ block: 'start' }); }}><Icon name={TYPE_ICON[t]} /> {tj(`{n} ${TYPE_LABELS[t]}`, { n: <strong>{list.length}</strong> })}</a></li>
            ))}
            <li class="t-era"><a href="#timeline" title={t('Open the Timeline')} onClick={(e) => { e.preventDefault(); onGo('timeline'); }}><Icon name="hourglass" /> {tj('{n} Eras', { n: <strong>{eras}</strong> })}</a></li>
            {open.length > 0 && (
              <li class={`home-warn ${errors ? 'is-error' : 'is-warning'}`}>
                <a href="#warnings-title" title={t('{errors} errors, {warnings} warnings: show them', { errors, warnings: open.length - errors })} onClick={(e) => { e.preventDefault(); const h = document.getElementById('warnings-title'); h?.scrollIntoView({ block: 'start' }); h?.focus(); }}>
                  <Icon name="hazard-sign" /> {open.length === 1 ? tj('{n} Warning', { n: <strong>{open.length}</strong> }) : tj('{n} Warnings', { n: <strong>{open.length}</strong> })}
                </a>
              </li>
            )}
          </ul>
          {sample && <p class="home-sample"><Icon name="locked-chest" /> {t('The sample world that comes with Lore-Forge is read-only. Duplicate it to make a copy you can edit.')}</p>}
          <div class="home-actions">
            {actions.map(([to, icon, label]) => <button key={to} type="button" class={to === 'codex' || to === 'book' ? 'publish' : 'ghost'} onClick={() => onGo(to)}><Icon name={icon} /> {label}</button>)}
            {/* The two settings stay side by side, also when the row wraps. */}
            <span class="home-settings-pair">
              <button type="button" class="ghost home-app-settings" onClick={onAppSettings} title={t('Settings: language, display and the library')}><Icon name="cog" /> {t('Settings')}</button>
              <button type="button" class="ghost home-settings" onClick={onSettings}><Icon name="calendar" /> {t('World settings')}</button>
            </span>
            <button type="button" class={sample ? 'primary home-duplicate' : 'ghost home-duplicate'} onClick={onDuplicate} title={t('Make a full copy of this world under a new name, and open it')}><Icon name="files" /> {t('Duplicate')}</button>
            <button type="button" class="ghost home-reload" onClick={onReload} title={t('Read every file of this world again, after editing them outside Lore-Forge')}><Icon name="cycle" /> {t('Reload from disk')}</button>
          </div>
        </div>
      </section>
      {groups.map(([type, list]) => list.length > 0 && (
        <section key={type} class={`home-group t-${type}`} aria-labelledby={`home-${type}`}>
          <h3 id={`home-${type}`} tabIndex={-1}><Icon name={TYPE_ICON[type]} /> {tm(TYPE_LABELS[type])} <span class="muted">({list.length})</span></h3>
          <ul class="tile-grid" ref={animated}>
            {list.map((e) => {
              const lc = LIFECYCLE[e.type];
              const ended = isEnded(e);
              return (
                <li key={e.id} class="tile-cell" data-tile-id={e.id}>
                  <button type="button" class={`entry-tile t-${e.type}${ended ? ' is-ended' : ''}`} onClick={() => onOpen(e.id)}>
                    <Portrait entry={e} size="lg" />
                    <span class="tile-name">{e.name}{ended && lc && <> <Icon name={lc.endedIcon} label={tm(lc.endedWord)} /></>}</span>
                    <span class="tile-sub muted">{tagline(ix, e)}</span>
                  </button>
                  <button type="button" class="tile-paint" onClick={() => setEditing(e.id)} aria-label={t('Change the picture for {name}', { name: e.name })} title={t('Change icon, colours or picture')}><Icon name="paint-brush" /></button>
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
