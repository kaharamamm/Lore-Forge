/**
 * Renaming an entry everywhere. After a name changes in the editor, a line under it says where the old name is still
 * written and offers to change it; the dialog lists every place (in the story, in the entries, on the maps) to change
 * or leave, and whether the old name stays as another name.
 */
import { useMemo, useState } from 'preact/hooks';
import { customFields, DETAIL_FIELDS, planRename, TYPE_ICON, VISUAL_FIELDS, type IconName, type RenameHit, type World } from '@lore-forge/core';
import { t, tm } from '../i18n.tsx';
import { Dialog } from './dialog.tsx';
import { Icon } from './icon.tsx';

/**
 * Per book (its folder) and entry: the name the book still uses for the entry, as far as this session knows. Set when
 * its name is first edited, moved on by a rename everywhere, and set back when that is undone, so the offer comes
 * again after Not now or Undo the next time the name box is left.
 */
const NAME_IN_BOOK = new Map<string, string>();
const nameKey = (dir: string, id: string): string => `${dir}\n${id}`;
export const nameInBook = (dir: string, id: string): string | undefined => NAME_IN_BOOK.get(nameKey(dir, id));
export function setNameInBook(dir: string, id: string, name: string): void {
  NAME_IN_BOOK.set(nameKey(dir, id), name);
}

/** Links read as their words in the list: [[place-well|Singing Well]] "Singing Well", [[Saltmere]] "Saltmere". */
const readable = (s: string): string => s.replace(/\[\[[^\]|\n]+\|([^\]\n]*)\]\]/g, '$1').replace(/\[\[([^\]|\n]+)\]\]/g, '$1');

/** What a hit's field is called in the editor: "Summary", "Home", "Relationships", "Chapter title". */
export function hitField(world: World, hit: RenameHit): string {
  if (hit.owner === 'maps') return t('Maps');
  if (hit.owner.startsWith('story:')) return hit.field === 'title' ? t('Chapter title') : hit.field === 'pov' ? t('Point of view') : hit.field === 'summary' ? t('What happens') : t('Text');
  const entry = world.entries.find((e) => e.id === hit.owner);
  const m = /^([A-Za-z]+)(?:\[(\d+)\])?(?:\.([^.[]+))?/.exec(hit.field);
  const [, top = hit.field, row, key] = m ?? [];
  switch (top) {
    case 'aliases': return t('Other names');
    case 'summary': return t('Summary');
    case 'body': return t('Text');
    case 'chapter': return t('Chapter (optional)');
    case 'partOf': return t('Part of (region)');
    case 'place': return t('Place');
    case 'race': return t('Race or kind');
    case 'relations': return t('Relationships');
    case 'locations': return t('Locations over time');
    case 'participants': return t('Participants');
    case 'actions': return t('What happened');
    case 'looks': return t('Look: {name}', { name: entry?.looks?.[Number(row)]?.name ?? '' });
    case 'details': {
      const d = entry && DETAIL_FIELDS[entry.type].find((x) => x.key === key);
      return d ? tm(d.label) : key ?? hit.field;
    }
    case 'fields': return (entry && customFields(world.manifest, entry.type).find((x) => x.key === key)?.name) ?? key ?? hit.field;
    case 'visual': {
      const v = entry && VISUAL_FIELDS[entry.type].find((x) => x.key === key);
      return v ? tm(v.label) : key ?? hit.field;
    }
    default: return hit.field;
  }
}

/** Under the name, after it changed: where the old name is still written, and the offer to change it. */
export function RenameOffer({ from, to, count, onReview, onDismiss }: { from: string; to: string; count: number; onReview: () => void; onDismiss: () => void }) {
  return (
    <div class="rename-offer" role="status">
      <Icon name="quill-ink" />
      <span class="rename-offer-text">{count === 1 ? t('“{name}” still appears once in the book.', { name: from }) : t('“{name}” still appears {n} times in the book.', { name: from, n: count })}</span>
      <span class="rename-offer-actions">
        <button type="button" class="small primary rename-review" onClick={onReview}>{count === 1 ? t('Change it to “{name}”…', { name: to }) : t('Change them to “{name}”…', { name: to })}</button>
        <button type="button" class="ghost small" onClick={onDismiss}>{t('Not now')}</button>
      </span>
    </div>
  );
}

/** Every place the old name would change, grouped by chapter, entry and maps, each with a tick to keep it or not. */
export function RenameDialog({ world, entryId, from, to, onApply, onClose }: {
  world: World;
  entryId: string;
  from: string;
  to: string;
  /** Makes the change: every place except `skip`; `keepOldName` keeps the old name as another name. */
  onApply: (skip: Set<string>, keepOldName: boolean) => Promise<void>;
  onClose: () => void;
}) {
  // Listed once, as the book is when the dialog opens.
  const hits = useMemo(() => planRename(world, entryId, from, to), []);
  // A name another entry has too: a plain mention may be about that one, so those start unticked.
  const [off, setOff] = useState(() => new Set(hits.filter((h) => h.shared).map((h) => h.id)));
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const groups = useMemo(() => {
    const by = new Map<string, RenameHit[]>();
    for (const h of hits) by.set(h.owner, [...(by.get(h.owner) ?? []), h]);
    return [...by.entries()];
  }, [hits]);
  const chosen = hits.length - off.size;
  const toggle = (ids: string[], on: boolean): void => {
    const next = new Set(off);
    for (const id of ids) {
      if (on) next.delete(id);
      else next.add(id);
    }
    setOff(next);
  };
  const owner = (key: string): { icon: IconName; name: string } => {
    if (key === 'maps') return { icon: 'treasure-map', name: t('Maps') };
    if (key.startsWith('story:')) {
      const c = world.story?.find((x) => `story:${x.file}` === key);
      return { icon: 'scroll-quill', name: c?.title || t('Untitled') };
    }
    const e = world.entries.find((x) => x.id === key);
    return { icon: e ? TYPE_ICON[e.type] : 'scroll-unfurled', name: e?.id === entryId ? to : e?.name || key };
  };
  const apply = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await onApply(off, keep);
    } catch (e) {
      setProblem((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog class="rename-dialog" title={t('Change “{from}” to “{to}”', { from, to })} onClose={onClose}
      footer={hits.length ? (
        <>
          <label class="rename-keep"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.currentTarget.checked)} /> {t('Keep “{name}” as another name', { name: from })}</label>
          <button type="button" class="ghost" onClick={onClose}>{t('Cancel')}</button>
          <button type="button" class="primary rename-apply" disabled={!chosen || busy} onClick={() => void apply()}>{chosen === 1 ? t('Change 1 place') : t('Change {n} places', { n: chosen })}</button>
        </>
      ) : <button type="button" class="primary" onClick={onClose}>{t('Close')}</button>}>
      {!hits.length ? (
        <p>{t('“{name}” is not written anywhere in the book any more.', { name: from })}</p>
      ) : (
        <>
          <p class="muted">{t('Each place below changes. Untick the ones that should stay as they are.')}</p>
          {hits.some((h) => h.shared) && <p class="hint rename-shared"><Icon name="hazard-sign" /> {t('Another entry is also called “{name}”, so the places that only say the name are not ticked. Tick the ones about this entry.', { name: from })}</p>}
          <div class="rename-groups">
            {groups.map(([key, list]) => {
              const o = owner(key);
              const all = list.every((h) => !off.has(h.id));
              return (
                <section key={key} class="rename-group">
                  <label class="rename-owner">
                    <input type="checkbox" checked={all} onChange={(e) => toggle(list.map((h) => h.id), e.currentTarget.checked)} />
                    <Icon name={o.icon} /> <strong>{o.name}</strong> <span class="muted small">{list.length}</span>
                  </label>
                  <ul>
                    {list.map((h) => (
                      <li key={h.id}>
                        <label class="rename-hit">
                          <input type="checkbox" checked={!off.has(h.id)} onChange={(e) => toggle([h.id], e.currentTarget.checked)} />
                          <span class="rename-field">{hitField(world, h)}</span>
                          <span class="rename-line">{readable(h.before)}<del>{h.old}</del><ins>{h.new}</ins>{readable(h.after)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
          {problem && <p class="small error-line" role="alert">{problem}</p>}
        </>
      )}
    </Dialog>
  );
}
