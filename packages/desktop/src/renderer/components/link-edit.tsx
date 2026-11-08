import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { detailField, detailList, entryIcon, RELATION_GROUPS, relationKindsFor, TYPE_SINGULAR, WorldIndex, type Entry, type RelationGroup, type World } from '@lore-forge/core';
import { worldIndex } from '../hooks.ts';
import { lower, t, tj, tm } from '../i18n.tsx';
import { Icon } from './icon.tsx';
import { Select } from './select.tsx';

/** A link drawn on a graph and where it lives: `holder.relations[index]`, or a reference detail field of `holder`. */
export interface GraphLink {
  from: string;
  to: string;
  type: string;
  holder: string;
  index?: number;
  field?: string;
}

export type LinkDraft = { kind: 'new'; from: string; to: string } | { kind: 'edit'; link: GraphLink };

/** A relation choice: stored on `from` pointing at `to`, or the other way round when only the reverse fits. */
interface Choice { value: string; holder: string; target: string; type: string; text: string; group: RelationGroup }

function choices(ix: WorldIndex, a: Entry, b: Entry, prefer?: RelationGroup): Choice[] {
  const fwd = relationKindsFor(a.type, b.type).map((k): Choice => ({ value: `f:${k.type}`, holder: a.id, target: b.id, type: k.type, group: k.group, text: t('{from} {relation} {to}', { from: a.name, relation: tm(k.label), to: b.name }) }));
  const back = relationKindsFor(b.type, a.type).filter((k) => !k.symmetric || a.type !== b.type).map((k): Choice => ({ value: `r:${k.type}`, holder: b.id, target: a.id, type: k.type, group: k.group, text: t('{from} {relation} {to}', { from: b.name, relation: tm(k.label), to: a.name }) }));
  void ix;
  const all = [...fwd, ...back];
  return prefer ? [...all.filter((c) => c.group === prefer), ...all.filter((c) => c.group !== prefer)] : all;
}

/** The entries a link change touches, with their new content. */
export type LinkWrite = Entry[];

const withRelations = (e: Entry, relations: NonNullable<Entry['relations']>): Entry => {
  const { relations: _r, ...rest } = e;
  return (relations.length ? { ...rest, relations } : rest) as Entry;
};

/**
 * New link (pick a type that fits the two entries; the list is limited by the relation table) or
 * edit one (type, note, or delete). Links that come from a detail field (home, ruler, owners...)
 * can only be removed here; their wording is set by the field.
 */
export function LinkDialog({ world, draft, prefer, onClose, onWrite, onOpen }: {
  world: World; draft: LinkDraft; prefer?: RelationGroup; onClose: () => void; onWrite: (changed: LinkWrite) => void; onOpen: (id: string) => void;
}) {
  const ix = worldIndex(world);
  const link = draft.kind === 'edit' ? draft.link : undefined;
  const a = ix.byIdOf(draft.kind === 'new' ? draft.from : link!.from)!;
  const b = ix.byIdOf(draft.kind === 'new' ? draft.to : link!.to)!;
  const holder = link ? ix.byIdOf(link.holder) : undefined;
  const rel = link?.index !== undefined ? holder?.relations?.[link.index] : undefined;
  const opts = choices(ix, a, b, prefer);
  const initial = link ? (link.holder === a.id ? `f:${link.type}` : `r:${link.type}`) : opts[0]?.value ?? '';
  const [pick, setPick] = useState(initial);
  const [note, setNote] = useState(rel?.note ?? '');
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const field = link?.field && holder ? detailField(holder.type, link.field) : undefined;

  const save = () => {
    const c = opts.find((o) => o.value === pick);
    if (!c) return;
    const writes = new Map<string, Entry>();
    const get = (id: string) => writes.get(id) ?? ix.byIdOf(id)!;
    if (link && link.index !== undefined && holder) {
      // Remove the old relation first; it moves when the direction changes.
      const kept = (get(holder.id).relations ?? []).filter((_, i) => i !== link.index);
      if (c.holder === holder.id) {
        const next = [...(holder.relations ?? [])];
        next[link.index] = { ...next[link.index]!, type: c.type, target: c.target, ...(note.trim() ? { note: note.trim() } : {}) };
        if (!note.trim()) delete next[link.index]!.note;
        writes.set(holder.id, withRelations(holder, next));
      } else {
        writes.set(holder.id, withRelations(holder, kept));
        const h = get(c.holder);
        writes.set(h.id, withRelations(h, [...(h.relations ?? []), { type: c.type, target: c.target, ...(note.trim() ? { note: note.trim() } : {}) }]));
      }
    } else {
      const h = get(c.holder);
      writes.set(h.id, withRelations(h, [...(h.relations ?? []), { type: c.type, target: c.target, ...(note.trim() ? { note: note.trim() } : {}) }]));
    }
    onWrite([...writes.values()]);
    onClose();
  };
  const remove = () => {
    if (!link || !holder) return;
    if (link.index !== undefined) onWrite([withRelations(holder, (holder.relations ?? []).filter((_, i) => i !== link.index))]);
    else if (link.field) {
      const other = link.holder === link.from ? link.to : link.from;
      const left = detailList(holder, link.field).filter((ref) => ix.resolve(ref)?.id !== other);
      const details = { ...holder.details };
      if (left.length) details[link.field] = Array.isArray(holder.details?.[link.field]) ? left : left[0]!;
      else delete details[link.field];
      const { details: _d, ...rest } = holder;
      onWrite([(Object.keys(details).length ? { ...rest, details } : rest) as Entry]);
    }
    onClose();
  };
  // In <body>, like every modal: inside a pane, the side panels next to it could paint over it.
  return createPortal(
    <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section class="about link-dialog" role="dialog" aria-modal="true" aria-labelledby="link-title">
        <header class="dialog-head">
          <h2 id="link-title">{draft.kind === 'new' ? t('New relationship') : t('Edit relationship')}</h2>
          <p class="muted link-ends">
            <span class={`link-end t-${a.type}`}><Icon name={entryIcon(a)} /> {a.name} <span class="muted">· {lower(tm(TYPE_SINGULAR[a.type]))}</span></span>
            <Icon name="spider-web" class="link-mid" />
            <span class={`link-end t-${b.type}`}><Icon name={entryIcon(b)} /> {b.name} <span class="muted">· {lower(tm(TYPE_SINGULAR[b.type]))}</span></span>
          </p>
        </header>
        <div class="dialog-body">
        {field ? (
          <p>{tj('This link comes from the {field} field of {name}. Change its wording there, or remove it here.', { field: <strong>{tm(field.label)}</strong>, name: holder!.name })}</p>
        ) : opts.length === 0 ? (
          <p class="error-line">{t('No relationship type in the table fits a {a} and a {b}. Add a custom one in the editor.', { a: lower(tm(TYPE_SINGULAR[a.type])), b: lower(tm(TYPE_SINGULAR[b.type])) })}</p>
        ) : (
          <>
            <div class="field">
              <label for="link-type">{t('Relationship')}</label>
              <Select id="link-type" buttonRef={first} value={pick} onChange={setPick}
                options={[
                  ...(Object.keys(RELATION_GROUPS) as RelationGroup[]).flatMap((g) => opts.filter((o) => o.group === g).map((o) => ({ value: o.value, label: o.text, group: tm(RELATION_GROUPS[g].label), icon: RELATION_GROUPS[g].icon }))),
                  ...(link && !opts.some((o) => o.value === initial) ? [{ value: initial, label: t('{type} (custom)', { type: link.type.replace(/-/g, ' ') }) }] : []),
                ]} />
            </div>
            <div class="field">
              <label for="link-note">{t('Label or note (optional)')}</label>
              <input id="link-note" type="text" value={note} placeholder={t('e.g. sworn at the oasis')} onInput={(e) => setNote(e.currentTarget.value)} />
            </div>
          </>
        )}
        </div>
        <div class="dialog-actions">
          {link && <button type="button" class="danger link-delete" onClick={remove}><Icon name="trash-can" /> {t('Delete link')}</button>}
          {link && <button type="button" class="ghost" onClick={() => { onOpen(link.holder); onClose(); }}>{t('Open {name} in the editor', { name: ix.byIdOf(link.holder)?.name ?? '' })}</button>}
          <span class="spacer" />
          <button type="button" class="ghost" onClick={onClose}>{t('Cancel')}</button>
          {!field && opts.length > 0 && <button type="button" class="primary link-save" onClick={save}><Icon name="check-mark" /> {draft.kind === 'new' ? t('Connect') : t('Save')}</button>}
        </div>
      </section>
    </div>,
    document.body,
  );
}

/** Drag data for an entry dragged from the sidebar onto a graph. */
export const ENTRY_DRAG = 'application/x-lore-entry';
