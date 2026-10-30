import { TYPE_LABELS, WorldIndex, type Entry, type World } from '@lore-forge/core';

interface Link {
  /** e.g. "parent of", "killed by". */
  label: string;
  other: Entry | undefined;
  otherRef: string;
  when?: string;
}

const GROUPS: [string, string[]][] = [
  ['Family', ['parent of', 'child of', 'sibling of', 'spouse of']],
  ['Allies and enemies', ['ally of', 'enemy of']],
  ['Power and belonging', ['member of', 'has member', 'leader of', 'led by', 'rules', 'ruled by', 'serves', 'served by']],
  ['Possessions', ['owns', 'owned by']],
  ['Killings', ['killed', 'killed by']],
];
const INVERSE: Record<string, string> = {
  'parent-of': 'child of', 'child-of': 'parent of', 'sibling-of': 'sibling of', 'spouse-of': 'spouse of', 'ally-of': 'ally of', 'enemy-of': 'enemy of',
  'member-of': 'has member', 'leader-of': 'led by', rules: 'ruled by', serves: 'served by', owns: 'owned by', killed: 'killed by',
};

export function RelationsView({ world, entry, onOpen }: { world: World; entry: Entry | undefined; onOpen: (id: string) => void }) {
  if (!entry) return <section class="relations"><h2>Relationships</h2><p class="muted">Select an entry in the sidebar to see its relationships.</p></section>;
  const ix = new WorldIndex(world);
  const links: Link[] = [];
  const span = (from?: string, to?: string) => (from || to ? `${from ?? '?'} – ${to ?? '?'}` : undefined);
  for (const r of entry.relations ?? []) links.push({ label: r.type.replace(/-/g, ' '), other: ix.resolve(r.target), otherRef: r.target, when: span(r.from, r.to) });
  for (const e of world.entries) {
    if (e.id === entry.id) continue;
    for (const r of e.relations ?? []) {
      if (ix.resolve(r.target)?.id === entry.id) links.push({ label: INVERSE[r.type] ?? `${r.type.replace(/-/g, ' ')} (from them)`, other: e, otherRef: e.id, when: span(r.from, r.to) });
    }
  }
  const events = world.entries.filter((e) => e.type === 'event' && [...(e.participants ?? []).map((p) => p.id), ...(e.actions ?? []).flatMap((a) => [a.actor, a.target ?? ''])].some((ref) => ix.resolve(ref)?.id === entry.id));
  const known = new Set(GROUPS.flatMap(([, ls]) => ls));
  const groups: [string, Link[]][] = [...GROUPS.map(([g, ls]): [string, Link[]] => [g, links.filter((l) => ls.includes(l.label))]), ['Other', links.filter((l) => !known.has(l.label))]];
  return (
    <section class="relations" aria-labelledby="relations-title">
      <h2 id="relations-title" tabIndex={-1}>Relationships of {entry.name}</h2>
      <p class="muted">Both directions: what {entry.name} says, and what other entries say about {entry.name}.</p>
      <div class="rel-grid">
        {groups.filter(([, ls]) => ls.length > 0).map(([g, ls]) => (
          <section class="rel-card" key={g}>
            <h3>{g}</h3>
            <ul>
              {ls.map((l, i) => (
                <li key={i}>
                  <span class="rel-label">{l.label}</span>{' '}
                  {l.other ? <button type="button" class="link" onClick={() => onOpen(l.other!.id)}>{l.other.name}</button> : <span class="missing"><span aria-hidden="true">✖ </span>{l.otherRef} (missing)</span>}
                  {l.other && <span class="muted"> · {TYPE_LABELS[l.other.type].replace(/s$/, '')}</span>}
                  {l.when && <span class="muted"> · {l.when}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <section class="rel-card">
          <h3>Events</h3>
          {events.length === 0 ? <p class="muted">Not in any event.</p> : (
            <ul>
              {events.map((e) => (
                <li key={e.id}>
                  <button type="button" class="link" onClick={() => onOpen(e.id)}>{e.name}</button>
                  {e.type === 'event' && e.date && <span class="muted"> · {e.date}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {links.length === 0 && <p class="muted">No relationships yet. Add some in the editor.</p>}
    </section>
  );
}
