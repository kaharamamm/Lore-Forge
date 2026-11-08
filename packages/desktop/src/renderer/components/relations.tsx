import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { detailField, detailRelations, entryIcon, familyTree, inverseLabel, RELATION_GROUPS, relationKind, relationLabel, relationWeb, TYPE_SINGULAR, type Entry, type IconName, type RelationGroup, type World } from '@lore-forge/core';
import { worldIndex } from '../hooks.ts';
import { same } from '../merge.ts';
import { ENTRY_DRAG, LinkDialog, type GraphLink, type LinkDraft } from './link-edit.tsx';
import { FamilyTreeSvg } from './graphs.tsx';
import { RelationWebFlow } from './web.tsx';
import { EntryLabel, EntryLink } from './type.tsx';
import { Icon } from './icon.tsx';
import { Select } from './select.tsx';
import { lower, t, tj, tm } from '../i18n.tsx';

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
type Undo = { kind: 'entries'; before: Entry[]; after: Entry[]; what: string } | { kind: 'view'; before: ViewState; what: string };
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
  const ix = worldIndex(world);
  const nameOf = (id: string) => ix.byIdOf(id)?.name ?? id;

  const latest = useRef(world);
  latest.current = world;
  const write = (changed: Entry[], what: string) => {
    const before = changed.flatMap((c) => world.entries.filter((e) => e.id === c.id));
    setUndo((u) => [...u.slice(-49), { kind: 'entries', before, after: changed, what }]);
    onWrite(changed);
    setNotice(t('{what}. Saved to {names}. Ctrl+Z undoes it.', { what, names: changed.map((c) => c.name).join(` ${t('and')} `) }));
  };
  const setView = (next: ViewState, what: string) => {
    setUndo((u) => [...u.slice(-49), { kind: 'view', before: shown, what }]);
    setShown(next);
  };
  const undoLast = () => {
    const last = undo[undo.length - 1];
    if (!last) return;
    setUndo((u) => u.slice(0, -1));
    if (last.kind === 'entries') onWrite(undoChange(last.before, last.after, latest.current.entries));
    else setShown(last.before);
    setNotice(t('Undone: {what}.', { what: lower(last.what) }));
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
    if (mode === 'tree' && e.type !== 'character') return setNotice(t('Only characters go in the family tree; {name} is a {type}. Try the relationship web.', { name: e.name, type: lower(tm(TYPE_SINGULAR[e.type])) }));
    if (id === entry.id || (!shown.hide.includes(id) && (tree?.nodes ?? web?.nodes ?? []).some((n) => n.id === id))) return setNotice(t('{name} is already on the canvas.', { name: e.name }));
    setView({ add: [...shown.add.filter((x) => x !== id), id], hide: shown.hide.filter((x) => x !== id) }, t('Added {name} to the view', { name: e.name }));
    setNotice(t('{name} added to the view. Drag from its gold dot to link it, or use Connect below.', { name: e.name }));
  };
  const hideNode = (id: string) => {
    setView({ add: shown.add.filter((x) => x !== id), hide: [...shown.hide, id] }, t('Removed {name} from the view', { name: nameOf(id) }));
    setNotice(t('{name} removed from this view only. The entry and its relationships are unchanged. Ctrl+Z brings it back.', { name: nameOf(id) }));
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
        <h2><Icon name="spider-web" /> {t('Relationships')}</h2>
        <div class={`empty-state drop-zone${over ? ' is-over' : ''}`} {...drop}><Icon class="empty-icon" name="compass" /><p>{t('Pick an entry in the sidebar, or drag one here, to see who and what it is tied to.')}</p></div>
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
  const modes: [Mode, IconName, string][] = [['tree', 'family-tree', t('Family tree')], ['web', 'spider-web', t('Relationship web')]];
  return (
    <section class="relations" aria-labelledby="relations-title">
      <header class="view-head">
        <h2 id="relations-title" tabIndex={-1}>{tj('Relationships of {entry}', { entry: <EntryLabel entry={entry} /> })}</h2>
        <div class="segmented" role="group" aria-label={t('Show')}>
          {modes.map(([m, icon, label]) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}><Icon name={icon} /> {label}</button>
          ))}
        </div>
      </header>

      <div class={`graph-card drop-zone${over ? ' is-over' : ''}`} {...drop}>
        {mode === 'tree' && tree && (tree.nodes.length ? (
          <>
            <p class="muted graph-note">
              {entry.type === 'character' && tree.nodes.some((n) => n.focus) ? t("{name}'s family, oldest generation on top. Select a card to open it; drag a card's gold dot onto another to link them; click a line to edit it.", { name: entry.name }) : t("Every family in this world, oldest generation on top. Select a card to open it; drag a card's gold dot onto another to link them; click a line to edit it.")}
            </p>
            <FamilyTreeSvg tree={tree} onOpen={onOpen} onConnect={connect} onHide={hideNode}
              onEdit={(ed) => { const h = ix.byIdOf(ed.holder); const r = h?.relations?.[ed.index]; if (r) setDraft({ kind: 'edit', link: { from: ed.from, to: ed.to, type: r.type, holder: ed.holder, index: ed.index } }); }} />
            <ul class="legend" aria-label={t('Legend')}>
              <li><span class="lg lg-parent" aria-hidden="true" /> {t('parent → child')}</li>
              <li><Icon name="diamond-ring" /> {t('spouses')}</li>
              <li><span class="lg lg-sibling" aria-hidden="true" /> {t('siblings')}</li>
              <li><Icon name="tombstone" /> {t('dead')}</li>
            </ul>
          </>
        ) : (
          <div class="empty-state"><Icon class="empty-icon" name="sprout" /><p>{entry.type === 'character' ? t('{name} has no family yet.', { name: entry.name }) : t('No families yet.')} {tj('Add {parent}, {child}, {spouse} or {sibling} relationships in the editor to grow a tree.', { parent: <strong>{tm('parent of')}</strong>, child: <strong>{tm('child of')}</strong>, spouse: <strong>{tm('spouse of')}</strong>, sibling: <strong>{tm('sibling of')}</strong> })}</p></div>
        ))}
        {mode === 'web' && web && (web.nodes.length > 1 ? (
          <>
            <p class="muted graph-note">{t("{name} in the middle; arrows read “from → to”. Drag a card's gold dot onto another to link them; click a line to edit it; drag entries in from the sidebar.", { name: entry.name })}</p>
            <RelationWebFlow world={world} web={web} onOpen={onOpen} onConnect={connect} onHide={hideNode}
              onEdit={(ed) => setDraft({ kind: 'edit', link: { from: ed.from, to: ed.to, type: ed.type, holder: ed.holder, ...(ed.index !== undefined ? { index: ed.index } : {}), ...(ed.field ? { field: ed.field } : {}) } })} />
          </>
        ) : (
          <div class="empty-state"><Icon class="empty-icon" name="spider-web" /><p>{t('Nothing is tied to {name} yet. Add allies, enemies, members, rulers or owners in the editor.', { name: entry.name })}</p></div>
        ))}
        <div class="graph-tools">
          <form class="connect-form" onSubmit={(e) => { e.preventDefault(); if (target) connect(entry.id, target); }}>
            <label for="connect-target">{t('Connect {name} to', { name: entry.name })}</label>
            <Select id="connect-target" value={target} onChange={setTarget} placeholder={t('Pick an entry…')} options={[...world.entries].filter((e) => e.id !== entry.id && (mode === 'web' || e.type === 'character')).sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ value: e.id, label: `${e.name} · ${lower(tm(TYPE_SINGULAR[e.type]))}`, icon: entryIcon(e), tone: `t-${e.type}` }))} />
            <button type="submit" class="ghost small" disabled={!target}><Icon name="spider-web" /> {t('Connect…')}</button>
          </form>
          <button type="button" class="ghost small undo-btn" disabled={!undo.length} onClick={undoLast} title={undo.length ? t('Undo: {what}', { what: undo[undo.length - 1]!.what }) : t('Nothing to undo')}><Icon name="fast-backward-button" /> {t('Undo')}</button>
          {shown.hide.length > 0 && <button type="button" class="ghost small" onClick={() => setView({ ...shown, hide: [] }, t('Showed hidden cards'))}>{t('Show {n} hidden', { n: shown.hide.length })}</button>}
        </div>
        <p class="graph-notice muted" role="status" aria-live="polite">{notice}</p>
      </div>

      <div class="rel-grid">
        {groups.map(([g, ls]) => (
          <section class={`rel-card g-${g}`} key={g}>
            <h3><Icon name={RELATION_GROUPS[g].icon} /> {tm(RELATION_GROUPS[g].label)}</h3>
            <ul>
              {ls.map((l, i) => (
                <li key={i} class="rel-row">
                  <span class="rel-label">{tm(l.label)}</span>
                  <span class="rel-line">
                    {l.other ? <EntryLink entry={l.other} onOpen={onOpen} /> : <span class="missing"><Icon name="cancel" /> {t('{ref} (missing)', { ref: l.otherRef })}</span>}
                    {l.when && <span class="rel-meta">{l.when}</span>}
                    {l.via && <span class="rel-meta">{t('from {field}', { field: tm(l.via) })}</span>}
                  </span>
                  <button type="button" class="ghost small icon-only rel-edit" aria-label={t('Edit {relation} {name}', { relation: tm(l.label), name: l.other?.name ?? l.otherRef })} title={t('Edit or delete this link')} onClick={() => setDraft({ kind: 'edit', link: l.link })}><Icon name="quill" /></button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <section class="rel-card">
          <h3><Icon name="crossed-swords" /> {t('Events')}</h3>
          {events.length === 0 ? <p class="muted">{t('Not in any event yet.')}</p> : (
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
          onWrite={(changed) => write(changed, draft.kind === 'new' ? t('Linked') : t('Changed a link'))} />
      )}
    </section>
  );
}

/**
 * Undo of a link change: only the fields that change touched go back to how they were. Edits made to the same
 * entries since (in the editor, or by an AI assistant) stay.
 */
function undoChange(before: readonly Entry[], after: readonly Entry[], now: readonly Entry[]): Entry[] {
  return before.map((b) => {
    const a = after.find((x) => x.id === b.id) as Record<string, unknown> | undefined;
    const cur = now.find((e) => e.id === b.id);
    if (!a || !cur) return b;
    const was = b as unknown as Record<string, unknown>;
    const out = { ...cur } as Record<string, unknown>;
    for (const k of new Set([...Object.keys(was), ...Object.keys(a)])) {
      if (same(was[k], a[k])) continue;
      if (was[k] === undefined) delete out[k];
      else out[k] = was[k];
    }
    return out as unknown as Entry;
  });
}
