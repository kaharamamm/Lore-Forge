/**
 * Book history: the snapshots Lore-Forge kept of a book (when it was opened, while you worked, before each Ask AI
 * task and each restore), what changed since one, and putting one thing or the whole book back. For an entry: its
 * versions, the fields that differ from now, and putting one back.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { DETAIL_FIELDS, parseEntry, VISUAL_FIELDS, type Entry, type World } from '@lore-forge/core';
import type { HistoryChange, HistorySnapshot, HistoryVersion } from '../../shared/api.ts';
import { localeOf } from '../../shared/i18n.ts';
import { describeFile } from '../describe.ts';
import { language, t, tm } from '../i18n.tsx';
import { ConfirmDialog } from './confirm.tsx';
import { Dialog } from './dialog.tsx';
import { Icon } from './icon.tsx';

const message = (e: unknown): string => ((e as Error)?.message ?? String(e)).replace(/^Error invoking remote method '\w+': (Error: )?/, '');
const short = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The day and time, in the app's language. */
export const atText = (at: number): string => new Date(at).toLocaleString(localeOf(language()), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * When, in words. Today: the clock time and how long ago (with seconds within the hour, so snapshots kept close
 * together stay apart: "14:03:05 · 2 minutes ago"); before today: the day and time.
 */
export function whenText(at: number, now = Date.now()): string {
  const locale = localeOf(language());
  const diff = now - at;
  if (new Date(at).toDateString() !== new Date(now).toDateString()) return atText(at);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const ago = diff < 60_000 ? rtf.format(0, 'second') : diff < 3_600_000 ? rtf.format(-Math.round(diff / 60_000), 'minute') : rtf.format(-Math.round(diff / 3_600_000), 'hour');
  const time = new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', ...(diff < 3_600_000 ? { second: '2-digit' } : {}) });
  return `${time} · ${ago}`;
}

/** Why a snapshot was kept, in words. */
export function reasonText(s: HistorySnapshot): string {
  switch (s.reason) {
    case 'open': return t('When the book was opened');
    case 'auto': return t('While you worked');
    case 'ask': return s.label ? t('Before Ask AI: “{task}”', { task: short(s.label) }) : t('Before an Ask AI task');
    case 'restore': return s.label ? t('Before restoring {what}', { what: short(s.label) }) : t('Before a restore');
    case 'undo': return s.label ? t('Before undoing the AI task “{task}”', { task: short(s.label) }) : t('Before undoing an AI task');
    case 'manual': return s.label ? short(s.label) : t('Kept by you');
  }
}

const REASON_ICONS = { open: 'open-book', auto: 'hourglass', ask: 'magic-lamp', restore: 'cycle', undo: 'cycle', manual: 'tied-scroll' } as const;

/** A value as one short line: lists joined, objects as "key: value", long text cut. */
function valueText(v: unknown): string {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'string') return short(v.replace(/\s+/g, ' ').trim(), 240);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.every((x) => typeof x !== 'object' || x === null) ? short(v.join(', '), 240) : t('{count} items', { count: v.length });
  return short(Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${valueText(x)}`).join('; '), 240);
}

/** An entry's fields one level deep: details and visual description field by field, everything else whole. */
function fieldsOf(e: Entry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (k === 'id' || k === 'type') continue;
    if ((k === 'details' || k === 'visual') && v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [kk, vv] of Object.entries(v)) out[`${k}.${kk}`] = vv;
    } else out[k] = v;
  }
  return out;
}

const BASE_LABELS: Record<string, string> = {
  name: 'Name', aliases: 'Aliases', summary: 'Summary', status: 'Status', race: 'Race or kind', born: 'Born', died: 'Died', founded: 'Founded',
  destroyed: 'Destroyed', dissolved: 'Dissolved', created: 'Made', date: 'Date', end: 'End', place: 'Place', partOf: 'Part of (region)',
  participants: 'Participants', actions: 'Actions', locations: 'Where they lived', relations: 'Relationships', images: 'Pictures',
  picture: 'Card picture', looks: 'Looks', tags: 'Tags', body: 'Text', chapter: 'Chapter', bookOrder: 'Book order',
};

function fieldLabel(type: Entry['type'], key: string): string {
  if (key.startsWith('details.')) {
    const f = DETAIL_FIELDS[type].find((x) => x.key === key.slice(8));
    return f ? tm(f.label) : key.slice(8);
  }
  if (key.startsWith('visual.')) {
    const f = VISUAL_FIELDS[type].find((x) => x.key === key.slice(7));
    return f ? tm(f.label) : key.slice(7);
  }
  return BASE_LABELS[key] ? t(BASE_LABELS[key]!) : key;
}

/** The fields an older version of an entry has differently from now. */
export function entryDiff(then: Entry, now: Entry): { key: string; then: string; now: string }[] {
  const a = fieldsOf(then);
  const b = fieldsOf(now);
  const out: { key: string; then: string; now: string }[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null)) continue;
    out.push({ key: k, then: valueText(a[k]), now: valueText(b[k]) });
  }
  return out;
}

export interface HistoryProps {
  dir: string;
  world: World;
  /** One entry's versions (else the whole book). */
  entryId?: string | null;
  /** An AI is working on the book: nothing can be restored meanwhile. */
  busy: boolean;
  onClose: () => void;
  /** Save what is waiting to be saved first; false when that failed. */
  beforeChange: () => Promise<boolean>;
  /** Files a restore changed (to read again at once). */
  onRestored: (files: string[]) => void;
  onOpen: (id: string) => void;
}

export function HistoryDialog({ dir, world, entryId, busy, onClose, beforeChange, onRestored, onOpen }: HistoryProps) {
  const entry = entryId ? world.entries.find((e) => e.id === entryId) : undefined;
  const path = entry ? world.files[entry.id] : undefined;
  const [list, setList] = useState<(HistorySnapshot | HistoryVersion)[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [changes, setChanges] = useState<HistoryChange[] | null>(null);
  const [then, setThen] = useState<Entry | null | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = async (keep?: string | null): Promise<void> => {
    try {
      const items = entryId ? (path ? await window.lore.historyVersions(dir, path) : []) : await window.lore.historyList(dir);
      setList(items);
      setSelected((cur) => {
        const want = keep ?? cur;
        return want && items.some((s) => s.id === want) ? want : (items[0]?.id ?? null);
      });
    } catch (e) {
      setProblem(message(e));
      setList([]);
    }
  };
  useEffect(() => { void load(); }, [dir, entryId]);

  // What the chosen snapshot has: the changes since (the book), or that version of the entry.
  useEffect(() => {
    if (!selected) return;
    let live = true;
    setChanges(null);
    setThen(undefined);
    if (entryId && path) {
      void window.lore.historyRead(dir, selected, path).then((text) => {
        if (live) setThen(text ? (parseEntry(text).entry ?? null) : null);
      });
    } else if (!entryId) {
      void window.lore.historyChanges(dir, selected).then((c) => { if (live) setChanges(c); }).catch((e) => live && setProblem(message(e)));
    }
    return () => { live = false; };
  }, [selected, world]);

  const snap = list?.find((s) => s.id === selected) ?? null;
  const restore = async (paths: string[] | null, what: string): Promise<void> => {
    if (!selected || working) return;
    if (busy) {
      setProblem(t('An AI is working on this book. Wait for it to finish, or stop it, then try again.'));
      return;
    }
    setWorking(true);
    setProblem(null);
    setDone(null);
    try {
      if (!(await beforeChange())) throw new Error(t('Some changes could not be saved first, so nothing was restored. Try again in a moment.'));
      const changed = await window.lore.historyRestore(dir, selected, paths, what);
      onRestored(changed);
      setDone(changed.length ? t('Restored. The book as it was before is kept in the history too.') : t('Nothing to restore: it is already the same.'));
      await load(selected);
    } catch (e) {
      setProblem(message(e));
    } finally {
      setWorking(false);
    }
  };
  const keepNow = async (): Promise<void> => {
    setProblem(null);
    try {
      await beforeChange();
      const s = await window.lore.historyKeep(dir, t('Kept by you'));
      setDone(s ? t('Kept. You can come back to the book as it is now.') : t('Nothing changed since the last snapshot.'));
      await load(s?.id ?? null);
    } catch (e) {
      setProblem(message(e));
    }
  };

  const diff = useMemo(() => (entry && then ? entryDiff(then, entry) : []), [entry, then]);
  const title = entry ? t('History of {name}', { name: entry.name || entry.id }) : t('Book history');
  const groups = useMemo(() => {
    const out = new Map<string, { change: HistoryChange; label: string; entryId?: string }[]>();
    for (const c of changes ?? []) {
      const d = describeFile(world, c.path, c.name);
      const group = d.kind === 'entry' ? t('Entries') : d.kind === 'chapter' ? t('Chapters') : d.kind === 'book' ? t('The book') : d.kind === 'picture' ? t('Pictures') : d.kind === 'model' ? t('3D models') : t('Other files');
      out.set(group, [...(out.get(group) ?? []), { change: c, label: d.label, ...(d.entryId ? { entryId: d.entryId } : {}) }]);
    }
    return [...out];
  }, [changes, world]);

  return (
    <Dialog title={title} onClose={onClose} class="history-dialog"
      footer={<>
        {!entry && <button type="button" class="ghost" onClick={() => void keepNow()}><Icon name="tied-scroll" /> {t('Keep a snapshot now')}</button>}
        <button type="button" class="primary" onClick={onClose}>{t('Close')}</button>
      </>}>
      <p class="muted history-about">
        {entry
          ? t('Earlier versions of this entry, from the snapshots Lore-Forge keeps of the book on this computer.')
          : t('Lore-Forge keeps a snapshot of the book on this computer when you open it, every 20 minutes while it changes, before each Ask AI task and before every restore. Pick one to see what changed since, and put things back.')}
      </p>
      {problem && <p class="error-line" role="alert"><Icon name="cancel" /> {problem}</p>}
      {done && <p class="ok-line" role="status"><Icon name="check-mark" /> {done}</p>}
      {list === null ? <p class="muted">{t('Loading…')}</p> : !list.length ? (
        <p class="history-empty">{entry && !path ? t('This entry is not saved yet, so it has no history.') : entry ? t('No earlier versions of this entry yet.') : t('No snapshots yet. The first one is kept the next time the book opens, or press Keep a snapshot now.')}</p>
      ) : (
        <div class="history-body">
          <ol class="history-list" aria-label={t('Snapshots')}>
            {list.map((s) => (
              <li key={s.id}>
                <button type="button" class="history-item" aria-pressed={s.id === selected} onClick={() => setSelected(s.id)} title={new Date(s.at).toLocaleString(localeOf(language()))}>
                  <Icon name={REASON_ICONS[s.reason]} />
                  <span class="history-item-text">
                    <strong>{whenText(s.at)}</strong>
                    <span class="muted">{'exists' in s && !s.exists ? t('Deleted then') : reasonText(s)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div class="history-detail" aria-live="polite">
            {snap && <h3>{whenText(snap.at)} <span class="muted">· {reasonText(snap)}</span></h3>}
            {entry ? (
              then === undefined ? <p class="muted">{t('Loading…')}</p>
                : then === null ? <p class="muted">{t('This entry did not exist then (it had been deleted).')}</p>
                : !diff.length ? <p class="muted">{t('This version is the same as now.')}</p>
                : (
                  <>
                    <table class="history-diff">
                      <thead><tr><th>{t('Field')}</th><th>{t('Then')}</th><th>{t('Now')}</th></tr></thead>
                      <tbody>
                        {diff.map((d) => <tr key={d.key}><th scope="row">{fieldLabel(entry.type, d.key)}</th><td>{d.then || <span class="muted">{t('(empty)')}</span>}</td><td>{d.now || <span class="muted">{t('(empty)')}</span>}</td></tr>)}
                      </tbody>
                    </table>
                    <button type="button" class="primary" disabled={working} onClick={() => void restore([path!], entry.name || entry.id)}><Icon name="cycle" /> {t('Restore this version')}</button>
                  </>
                )
            ) : changes === null ? <p class="muted">{t('Loading…')}</p> : !changes.length ? <p class="muted">{t('The book is the same as then.')}</p> : (
              <>
                <p class="muted">{t('Since then:')}</p>
                {groups.map(([group, rows]) => (
                  <section key={group} class="history-group">
                    <h4>{group}</h4>
                    <ul>
                      {rows.map(({ change, label, entryId: id }) => (
                        <li key={change.path} class={`history-change is-${change.state}`}>
                          <span class="history-change-name">
                            {id && change.state !== 'removed' ? <button type="button" class="link" onClick={() => { onOpen(id); onClose(); }}>{label}</button> : label}
                          </span>
                          <span class="history-state">{change.state === 'changed' ? t('changed') : change.state === 'added' ? t('added since') : t('deleted since')}</span>
                          <button type="button" class="ghost small" disabled={working} onClick={() => void restore([change.path], label)}>
                            {change.state === 'added' ? t('Remove') : change.state === 'removed' ? t('Bring back') : t('Put back')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                <button type="button" class="danger history-all" disabled={working} onClick={() => setConfirmAll(true)}><Icon name="cycle" /> {t('Restore the whole book to this point')}</button>
              </>
            )}
          </div>
        </div>
      )}
      {confirmAll && snap && (
        <ConfirmDialog title={t('Restore the whole book as it was on {when}?', { when: atText(snap.at) })} confirmLabel={t('Restore the whole book')} confirmIcon="cycle"
          onClose={() => setConfirmAll(false)} onConfirm={async () => { setConfirmAll(false); await restore(null, t('the whole book')); }}>
          <p>{t('Everything changed since then goes back as it was ({count} files). The book as it is now is kept in the history first, so this can be undone too.', { count: changes?.length ?? 0 })}</p>
        </ConfirmDialog>
      )}
    </Dialog>
  );
}
