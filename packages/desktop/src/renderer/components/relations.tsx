import { useMemo } from 'preact/hooks';
import { familyTree, inverseLabel, RELATION_GROUPS, relationKind, relationLabel, relationWeb, WorldIndex, type Entry, type IconName, type RelationGroup, type World } from '@lore-forge/core';
import { FamilyTreeSvg, RelationWebSvg } from './graphs.tsx';
import { EntryLabel, EntryLink } from './type.tsx';
import { Icon } from './icon.tsx';

interface Link {
  /** e.g. "parent of", "killed by". */
  label: string;
  group: RelationGroup;
  other: Entry | undefined;
  otherRef: string;
  when?: string;
}

export type RelationMode = 'web' | 'tree';
type Mode = RelationMode;

/** Default graph for an entry: characters open on their family tree, everything else on the web. */
export const defaultRelationMode = (entry: Entry | undefined): Mode => (entry?.type === 'character' ? 'tree' : 'web');

export function RelationsView({ world, entry, mode: chosen, onMode, onOpen }: { world: World; entry: Entry | undefined; mode: Mode | null; onMode: (m: Mode) => void; onOpen: (id: string) => void }) {
  const mode = chosen ?? defaultRelationMode(entry);
  const setMode = onMode;
  const tree = useMemo(() => (mode === 'tree' ? familyTree(world, entry?.id) : undefined), [world, entry?.id, mode]);
  const web = useMemo(() => (mode === 'web' && entry ? relationWeb(world, entry.id) : undefined), [world, entry?.id, mode]);
  if (!entry) {
    return (
      <section class="relations">
        <h2><Icon name="spider-web" /> Relationships</h2>
        <div class="empty-state"><Icon class="empty-icon" name="compass" /><p>Pick an entry in the sidebar to see who and what it is tied to.</p></div>
      </section>
    );
  }
  const ix = new WorldIndex(world);
  const links: Link[] = [];
  const span = (from?: string, to?: string) => (from || to ? `${from ?? '?'} – ${to ?? '?'}` : undefined);
  const groupOf = (type: string): RelationGroup => relationKind(type)?.group ?? 'other';
  for (const r of entry.relations ?? []) links.push({ label: relationLabel(r.type), group: groupOf(r.type), other: ix.resolve(r.target), otherRef: r.target, when: span(r.from, r.to) });
  for (const e of world.entries) {
    if (e.id === entry.id) continue;
    for (const r of e.relations ?? []) {
      if (ix.resolve(r.target)?.id === entry.id) links.push({ label: inverseLabel(r.type), group: groupOf(r.type), other: e, otherRef: e.id, when: span(r.from, r.to) });
    }
  }
  const events = world.entries.filter((e) => e.type === 'event' && [...(e.participants ?? []).map((p) => p.id), ...(e.actions ?? []).flatMap((a) => [a.actor, a.target ?? '']), e.place ?? ''].some((ref) => ix.resolve(ref)?.id === entry.id));
  const groups = (Object.keys(RELATION_GROUPS) as RelationGroup[]).map((g) => [g, links.filter((l) => l.group === g)] as const).filter(([, ls]) => ls.length > 0);
  const modes: [Mode, IconName, string][] = [['tree', 'family-tree', 'Family tree'], ['web', 'spider-web', 'Relationship web']];
  return (
    <section class="relations" aria-labelledby="relations-title">
      <header class="view-head">
        <h2 id="relations-title" tabIndex={-1}>Relationships of <EntryLabel entry={entry} /></h2>
        <div class="segmented" role="group" aria-label="Show">
          {modes.map(([m, icon, label]) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}><Icon name={icon} /> {label}</button>
          ))}
        </div>
      </header>

      <div class="graph-card">
        {mode === 'tree' && tree && (tree.nodes.length ? (
          <>
            <p class="muted graph-note">
              {entry.type === 'character' && tree.nodes.some((n) => n.focus) ? `${entry.name}'s family` : 'Every family in this world'}, oldest generation on top. Select a box to open it.
            </p>
            <div class="graph-scroll"><FamilyTreeSvg tree={tree} onOpen={onOpen} /></div>
            <ul class="legend" aria-label="Legend">
              <li><span class="lg lg-parent" aria-hidden="true" /> parent → child</li>
              <li><Icon name="diamond-ring" /> spouses</li>
              <li><span class="lg lg-sibling" aria-hidden="true" /> siblings</li>
              <li><Icon name="tombstone" /> dead (shown faded)</li>
            </ul>
          </>
        ) : (
          <div class="empty-state"><Icon class="empty-icon" name="sprout" /><p>{entry.type === 'character' ? `${entry.name} has no family yet.` : 'No families yet.'} Add <strong>parent of</strong>, <strong>child of</strong>, <strong>spouse of</strong> or <strong>sibling of</strong> relationships in the editor to grow a tree.</p></div>
        ))}
        {mode === 'web' && web && (web.nodes.length > 1 ? (
          <>
            <p class="muted graph-note">{entry.name} in the middle; arrows read “from → to”. Select a box to open it.</p>
            <div class="graph-scroll"><RelationWebSvg web={web} onOpen={onOpen} /></div>
          </>
        ) : (
          <div class="empty-state"><Icon class="empty-icon" name="spider-web" /><p>Nothing is tied to {entry.name} yet. Add allies, enemies, members, rulers or owners in the editor.</p></div>
        ))}
      </div>

      <div class="rel-grid">
        {groups.map(([g, ls]) => (
          <section class={`rel-card g-${g}`} key={g}>
            <h3><Icon name={RELATION_GROUPS[g].icon} /> {RELATION_GROUPS[g].label}</h3>
            <ul>
              {ls.map((l, i) => (
                <li key={i}>
                  <span class="rel-label">{l.label}</span>{' '}
                  {l.other ? <EntryLink entry={l.other} onOpen={onOpen} /> : <span class="missing"><Icon name="cancel" /> {l.otherRef} (missing)</span>}
                  {l.when && <span class="muted"> · {l.when}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <section class="rel-card">
          <h3><Icon name="crossed-swords" /> Events</h3>
          {events.length === 0 ? <p class="muted">Not in any event yet.</p> : (
            <ul>
              {events.map((e) => (
                <li key={e.id}>
                  <EntryLink entry={e} onOpen={onOpen} />
                  {e.type === 'event' && e.date && <span class="muted"> · {e.date}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
