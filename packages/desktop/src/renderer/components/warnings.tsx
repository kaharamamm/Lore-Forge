import { useState } from 'preact/hooks';
import type { FactRef, Warning } from '@lore-forge/core';
import { kindOf, SeverityBadge } from './severity.tsx';

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
      <p class="warning-message">{w.message}</p>
      {w.intended?.note && <p class="warning-note">Note: {w.intended.note}</p>}
      <div class="warning-actions">
        {!compact && (
          <button type="button" class="link" onClick={() => actions.onJump(w.offending)}>
            Go to {w.offending.source} <span class="muted">({w.offending.field})</span>
          </button>
        )}
        {w.conflicting && (
          <button type="button" class="link" onClick={() => actions.onJump(w.conflicting!)}>
            Canon: {w.conflicting.source} <span class="muted">({w.conflicting.field})</span>
          </button>
        )}
        {w.intended ? (
          <button type="button" class="ghost small" onClick={() => actions.onUnmark(w)}>Unmark intended</button>
        ) : (
          !marking && <button type="button" class="ghost small" onClick={() => setMarking(true)}>Mark intended…</button>
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
            Why is this intended? (saved in intended.json)
            <input type="text" value={note} placeholder="e.g. resurrection, unreliable narrator" onInput={(e) => setNote(e.currentTarget.value)} autoFocus onKeyDown={(e) => e.key === 'Escape' && setMarking(false)} />
          </label>
          <div class="row">
            <button type="submit" class="primary small">Mark intended</button>
            <button type="button" class="ghost small" onClick={() => setMarking(false)}>Cancel</button>
          </div>
        </form>
      )}
    </li>
  );
}

export function WarningsPanel({ warnings, selectedId, actions }: { warnings: Warning[]; selectedId: string | null; actions: WarningActions }) {
  const [scope, setScope] = useState<'all' | 'entry'>('all');
  const shown = scope === 'entry' && selectedId ? warnings.filter((w) => involves(w, selectedId)) : warnings;
  const active = shown.filter((w) => !w.intended);
  const intended = shown.filter((w) => w.intended);
  const count = (s: Warning['severity']) => warnings.filter((w) => !w.intended && w.severity === s).length;
  return (
    <aside class="warnings-panel" aria-labelledby="warnings-title">
      <div class="panel-head">
        <h2 id="warnings-title" tabIndex={-1}>Warnings</h2>
        <p class="summary" aria-live="polite">
          {count('error')} errors · {count('warning')} warnings · {warnings.filter((w) => w.intended).length} intended
        </p>
        <div class="segmented" role="group" aria-label="Show warnings for">
          <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All</button>
          <button type="button" aria-pressed={scope === 'entry'} disabled={!selectedId} onClick={() => setScope('entry')}>This entry</button>
        </div>
      </div>
      {active.length === 0 && <p class="ok-line"><span aria-hidden="true">✓ </span>No open warnings{scope === 'entry' ? ' for this entry' : ''}.</p>}
      <ul class="warning-list">
        {active.map((w) => <WarningItem key={w.id} w={w} actions={actions} />)}
      </ul>
      {intended.length > 0 && (
        <details class="intended-group">
          <summary>Marked intended ({intended.length})</summary>
          <ul class="warning-list">
            {intended.map((w) => <WarningItem key={w.id} w={w} actions={actions} />)}
          </ul>
        </details>
      )}
    </aside>
  );
}

export const involves = (w: Warning, id: string): boolean => w.offending.entryId === id || w.conflicting?.entryId === id;
