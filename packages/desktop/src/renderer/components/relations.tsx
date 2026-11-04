import { useEffect, useMemo, useState } from 'preact/hooks';
import { detailField, detailRelations, entryIcon, familyTree, inverseLabel, RELATION_GROUPS, relationKind, relationLabel, relationWeb, TYPE_SINGULAR, WorldIndex, type Entry, type IconName, type RelationGroup, type World } from '@lore-forge/core';
import { ENTRY_DRAG, LinkDialog, type GraphLink, type LinkDraft } from './link-edit.tsx';
import { FamilyTreeSvg } from './graphs.tsx';
import { RelationWebFlow } from './web.tsx';
import { EntryLabel, EntryLink } from './type.tsx';
import { Icon } from './icon.tsx';
import { Select } from './select.tsx';

interface Link {
  /** e.g. "parent of", "killed by". */
  label: string;
  group: RelationGroup;
  other: Entry | undefined;
  otherRef: string;
  when?: string;
  link: GraphLink;
  /** Set by a detail field, e.g. "Home". */
  via?: string;
}

type ViewState = { add: string[]; hide: string[] };
type Undo = { kind: 'entries'; before: Entry[]; what: string } | { kind: 'view'; before: ViewState; what: string };
const EMPTY_VIEW: ViewState = { add: [], hide: [] };

export type RelationMode = 'web' | 'tree';
type Mode = RelationMode;

/** Default graph for an entry: characters open on their family tree, everything else on the web. */
export const defaultRelationMode = (entry: Entry | undefined): Mode => (entry?.type === 'character' ? 'tree' : 'web');

/**
 * Relationships of one entry: the family tree or the web, both editable. Drag entries from the sidebar onto
 * the canvas, drag from a card's connector to another card to link them, click a line to edit or delete it.
 * Every change is written to the entry files at once; Ctrl+Z undoes the last one.
 */
export function RelationsView({ world, entry, mode: chosen, onMode, onOpen, onWrite }: {
  world: World; entry: Entry | undefined; mode: Mode | null; onMode: (m: Mode) => void; onOpen: (id: string) => void; onWrite: (changed: Entry[]) => void;
}) {
  const mode = chosen ?? defaultRelationMode(entry);
  const setMode = onMode;
  const [shown, setShown] = useState<ViewState>(EMPTY_VIEW);
  const [undo, setUndo] = useState<Undo[]>([]);
  const [draft, setDraft] = useState<LinkDraft | null>(null);
  const [notice, setNotice] = useState('');
  const [over, setOver] = useState(false);
  const [target, setTarget] = useState('');
  useEffect(() => { setShown(EMPTY_VIEW); setNotice(''); }, [entry?.id, mode]);
  const tree = useMemo(() => (mode === 'tree' ? familyTree(world, entry?.id, shown) : undefined), [world, entry?.id, mode, shown]);
  const web = useMemo(() => (mode === 'web' && entry ? relationWeb(world, entry.id, shown) : undefined), [world, entry?.id, mode, shown]);
  const ix = new WorldIndex(world);
  const nameOf = (id: string) => ix.byIdOf(id)?.name ?? id;

  const write = (changed: Entry[], what: string) => {
    const before = changed.flatMap((c) => world.entries.filter((e) => e.id === c.id));
    setUndo((u) => [...u.slice(-49), { kind: 'entries', before, what }]);
    onWrite(changed);
    setNotice(`${what}. Saved to ${changed.map((c) => c.name).join(' and ')}. Ctrl+Z undoes it.`);
  };
  const setView = (next: ViewState, what: string) => {
    setUndo((u) => [...u.slice(-49), { kind: 'view', before: shown, what }]);
    setShown(next);
  };
  const undoLast = () => {
    const last = undo[undo.length - 1];
    if (!last) return;
    setUndo((u) => u.slice(0, -1));
    if (last.kind === 'entries') onWrite(last.before);
    else setShown(last.before);
    setNotice(`Undone: ${last.what.toLowerCase()}.`);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z' || draft) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      undoLast();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const addToView = (id: string) => {
    const e = ix.byIdOf(id);
    if (!e || !entry) return;
    if (mode === 'tree' && e.type !== 'character') return setNotice(`Only characters go in the family tree; ${e.name} is a ${TYPE_SINGULAR[e.type].toLowerCase()}. Try the relationship web.`);
    if (id === entry.id || (!shown.hide.includes(id) && (tree?.nodes ?? web?.nodes ?? []).some((n) => n.id === id))) return setNotice(`${e.name} is already on the canvas.`);
    setView({ add: [...shown.add.filter((x) => x !== id), id], hide: shown.hide.filter((x) => x !== id) }, `Added ${e.name} to the view`);
    setNotice(`${e.name} added to the view. Drag from its gold dot to link it, or use Connect below.`);
  };
  const hideNode = (id: string) => {
    setView({ add: shown.add.filter((x) => x !== id), hide: [...shown.hide, id] }, `Removed ${nameOf(id)} from the view`);
    setNotice(`${nameOf(id)} removed from this view only. The entry and its relationships are unchanged. Ctrl+Z brings it back.`);
  };
  const connect = (from: string, to: string) => { if (from !== to) setDraft({ kind: 'new', from, to }); };
  const drop = {
    onDragOver: (e: DragEvent) => { if (e.dataTransfer?.types.includes(ENTRY_DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      const id = e.dataTransfer?.getData(ENTRY_DRAG);
      setOver(false);
      if (!id) return;
      e.preventDefault();
      if (entry) addToView(id); else onOpen(id);
    },
  };
  if (!entry) {
    return (
      <section class="relations">
        <h2><Icon name="spider-web" /> Relationships</h2>
        <div class={`empty-state drop-zone${over ? ' is-over' : ''}`} {...drop}><Icon class="empty-icon" name="compass" /><p>Pick an entry in the sidebar, or drag one here, to see who and what it is tied to.</p></div>
      </section>
    );
  }
  const links: Link[] = [];
  const span = (from?: string, to?: string) => (from || to ? `${from ?? '?'} – ${to ?? '?'}` : undefined);
  const groupOf = (type: string): RelationGroup => relationKind(type)?.group ?? 'other';
  for (const e of world.entries) {
    (e.relations ?? []).forEach((r, index) => {
      const t = ix.resolve(r.target);
      const link: GraphLink = { from: e.id, to: t?.id ?? r.target, type: r.type, holder: e.id, index };
      if (e.id === entry.id) links.push({ label: relationLabel(r.type), group: groupOf(r.type), other: t, otherRef: r.target, when: span(r.from, r.to), link });
      else if (t?.id === entry.id) links.push({ label: inverseLabel(r.type), group: groupOf(r.type), other: e, otherRef: e.id, when: span(r.from, r.to), link });
    });
    for (const d of detailRelations(e)) {
      const src = ix.resolve(d.source), dst = ix.resolve(d.target);
      const link: GraphLink = { from: src?.id ?? d.source, to: dst?.id ?? d.target, type: d.type, holder: e.id, field: d.field };
      const via = detailField(e.type, d.field)?.label;
      if (src?.id === entry.id) links.push({ label: relationLabel(d.type), group: groupOf(d.type), other: dst, otherRef: d.target, link, ...(via ? { via } : {}) });
      else if (dst?.id === entry.id) links.push({ label: inverseLabel(d.type), group: groupOf(d.type), other: src, otherRef: d.source, link, ...(via ? { via } : {}) });
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

      <div class={`graph-card drop-zone${over ? ' is-over' : ''}`} {...drop}>
        {mode === 'tree' && tree && (tree.nodes.length ? (
          <>
            <p class="muted graph-note">
              {entry.type === 'character' && tree.nodes.some((n) => n.focus) ? `${entry.name}'s family` : 'Every family in this world'}, oldest generation on top. Select a card to open it; drag a card's gold dot onto another to link them; click a line to edit it.
            </p>
            <FamilyTreeSvg tree={tree} onOpen={onOpen} onConnect={connect} onHide={hideNode}
              onEdit={(ed) => { const h = ix.byIdOf(ed.holder); const r = h?.relations?.[ed.index]; if (r) setDraft({ kind: 'edit', link: { from: ed.from, to: ed.to, type: r.type, holder: ed.holder, index: ed.index } }); }} />
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
            <p class="muted graph-note">{entry.name} in the middle; arrows read “from → to”. Drag a card's gold dot onto another to link them; click a line to edit it; drag entries in from the sidebar.</p>
            <RelationWebFlow world={world} web={web} onOpen={onOpen} onConnect={connect} onHide={hideNode}
              onEdit={(ed) => setDraft({ kind: 'edit', link: { from: ed.from, to: ed.to, type: ed.type, holder: ed.holder, ...(ed.index !== undefined ? { index: ed.index } : {}), ...(ed.field ? { field: ed.field } : {}) } })} />
          </>
        ) : (
          <div class="empty-state"><Icon class="empty-icon" name="spider-web" /><p>Nothing is tied to {entry.name} yet. Add allies, enemies, members, rulers or owners in the editor.</p></div>
        ))}
        <div class="graph-tools">
          <form class="connect-form" onSubmit={(e) => { e.preventDefault(); if (target) connect(entry.id, target); }}>
            <label for="connect-target">Connect {entry.name} to</label>
            <Select id="connect-target" value={target} onChange={setTarget} placeholder="Pick an entry…" options={[...world.entries].filter((e) => e.id !== entry.id && (mode === 'web' || e.type === 'character')).sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ value: e.id, label: `${e.name} · ${TYPE_SINGULAR[e.type].toLowerCase()}`, icon: entryIcon(e), tone: `t-${e.type}` }))} />
            <button type="submit" class="ghost small" disabled={!target}><Icon name="spider-web" /> Connect…</button>
          </form>
          <button type="button" class="ghost small undo-btn" disabled={!undo.length} onClick={undoLast} title={undo.length ? `Undo: ${undo[undo.length - 1]!.what}` : 'Nothing to undo'}><Icon name="fast-backward-button" /> Undo</button>
          {shown.hide.length > 0 && <button type="button" class="ghost small" onClick={() => setView({ ...shown, hide: [] }, 'Showed hidden cards')}>Show {shown.hide.length} hidden</button>}
        </div>
        <p class="graph-notice muted" role="status" aria-live="polite">{notice}</p>
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
                  {l.via && <span class="muted"> · from {l.via}</span>}
                  <button type="button" class="ghost small icon-only rel-edit" aria-label={`Edit ${l.label} ${l.other?.name ?? l.otherRef}`} title="Edit or delete this link" onClick={() => setDraft({ kind: 'edit', link: l.link })}><Icon name="quill" /></button>
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
      {draft && (
        <LinkDialog world={world} draft={draft} {...(mode === 'tree' ? { prefer: 'family' as RelationGroup } : {})} onClose={() => setDraft(null)} onOpen={onOpen}
          onWrite={(changed) => write(changed, draft.kind === 'new' ? 'Linked' : 'Changed a link')} />
      )}
    </section>
  );
}
