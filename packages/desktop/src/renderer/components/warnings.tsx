import { useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import type { FactRef, Warning } from '@lore-forge/core';
import { animated } from '../motion.ts';
import { t, tj, tm } from '../i18n.tsx';
import { BADGE, kindOf, SeverityBadge, type BadgeKind } from './severity.tsx';
import { Icon } from './icon.tsx';
import { EditErasLink } from './world-settings.tsx';

export interface WarningActions {
  onJump: (fact: FactRef) => void;
  onMark: (w: Warning, note: string) => void;
  onUnmark: (w: Warning) => void;
}

export function WarningItem({ w, actions, compact }: { w: Warning; actions: WarningActions; compact?: boolean }) {
  const [marking, setMarking] = useState(false);
  const [note, setNote] = useState('');
  return (
    <li class={`warning warning-${kindOf(w)}`}>
      <div class="warning-head">
        <SeverityBadge kind={kindOf(w)} />
        <code class="rule-id">{w.ruleId}</code>
      </div>
      <p class="warning-message">{tm(w.message)}</p>
      <EditErasLink message={w.message} />
      {w.intended?.note && <p class="warning-note">{t('Note: {note}', { note: w.intended.note })}</p>}
      <div class="warning-actions">
        {!compact && (
          <button type="button" class="link" onClick={() => actions.onJump(w.offending)}>
            {tj('Go to {source} {where}', { source: tm(w.offending.source), where: <span class="muted">({w.offending.chapter ? t('sentence') : w.offending.field})</span> })}
          </button>
        )}
        {w.conflicting && (
          <button type="button" class="link" onClick={() => actions.onJump(w.conflicting!)}>
            {tj('Canon: {source} {where}', { source: tm(w.conflicting.source), where: <span class="muted">({w.conflicting.chapter ? t('sentence') : w.conflicting.field})</span> })}
          </button>
        )}
        {w.intended ? (
          <button type="button" class="ghost small" onClick={() => actions.onUnmark(w)}>{t('Unmark intended')}</button>
        ) : (
          !marking && <button type="button" class="ghost small" onClick={() => setMarking(true)}>{t('Mark intended…')}</button>
        )}
      </div>
      {marking && (
        <form
          class="mark-form"
          onSubmit={(e) => {
            e.preventDefault();
            actions.onMark(w, note.trim());
            setMarking(false);
            setNote('');
          }}
        >
          <label>
            {t('Why is this intended? (saved in intended.json)')}
            <input type="text" value={note} placeholder={t('e.g. resurrection, unreliable narrator')} onInput={(e) => setNote(e.currentTarget.value)} autoFocus onKeyDown={(e) => e.key === 'Escape' && setMarking(false)} />
          </label>
          <div class="row">
            <button type="submit" class="primary small">{t('Mark intended')}</button>
            <button type="button" class="ghost small" onClick={() => setMarking(false)}>{t('Cancel')}</button>
          </div>
        </form>
      )}
    </li>
  );
}

const COLLAPSED_KEY = 'lore-forge.warningSections';
const SECTIONS: [BadgeKind, string][] = [['error', 'Errors'], ['warning', 'Warnings'], ['info', 'Info'], ['intended', 'Marked intended']];

/** Memoized: while an entry is being typed in, the warnings (and so this panel) stay as they are. */
export const WarningsPanel = memo(function WarningsPanel({ warnings, selectedId, actions }: { warnings: Warning[]; selectedId: string | null; actions: WarningActions }) {
  const [scope, setScope] = useState<'all' | 'entry'>('all');
  const shown = scope === 'entry' && selectedId ? warnings.filter((w) => involves(w, selectedId)) : warnings;
  const active = shown.filter((w) => !w.intended);
  const [collapsed, setCollapsed] = useState<BadgeKind[]>(() => {
    try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '["intended"]') as BadgeKind[]; } catch { return ['intended']; }
  });
  const toggle = (k: BadgeKind) => {
    const next = collapsed.includes(k) ? collapsed.filter((x) => x !== k) : [...collapsed, k];
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
  };
  const count = (s: Warning['severity']) => warnings.filter((w) => !w.intended && w.severity === s).length;
  return (
    <aside class="warnings-panel" aria-labelledby="warnings-title">
      <div class="panel-head">
        <h2 id="warnings-title" tabIndex={-1}>{t('Warnings')}</h2>
        <p class="summary" aria-live="polite">
          {t('{errors} errors · {warnings} warnings · {intended} intended', { errors: count('error'), warnings: count('warning'), intended: warnings.filter((w) => w.intended).length })}
        </p>
        <div class="segmented" role="group" aria-label={t('Show warnings for')}>
          <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>{t('All')}</button>
          <button type="button" aria-pressed={scope === 'entry'} disabled={!selectedId} onClick={() => setScope('entry')}>{t('This entry')}</button>
        </div>
      </div>
      {active.length === 0 && <p class="ok-line"><span aria-hidden="true">✓ </span>{scope === 'entry' ? t('No open warnings for this entry.') : t('No open warnings.')}</p>}
      {SECTIONS.map(([kind, label]) => {
        const list = shown.filter((w) => kindOf(w) === kind);
        if (!list.length) return null;
        const open = !collapsed.includes(kind);
        return (
          <section key={kind} class={`warning-section is-${kind}${open ? ' is-open' : ''}`} data-kind={kind}>
            <h3>
              <button type="button" class="section-toggle" aria-expanded={open} onClick={() => toggle(kind)}>
                <Icon name="play-button" class="chevron" /> <Icon name={BADGE[kind].icon} /> {t(label)} <span class="section-count">({list.length})</span>
              </button>
            </h3>
            {open && (
              <ul class="warning-list" ref={animated}>
                {list.map((w) => <WarningItem key={w.id} w={w} actions={actions} />)}
              </ul>
            )}
          </section>
        );
      })}
    </aside>
  );
});

export const involves = (w: Warning, id: string): boolean => w.offending.entryId === id || w.conflicting?.entryId === id;
