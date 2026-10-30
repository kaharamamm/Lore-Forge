import type { Warning } from '@lore-forge/core';

const BADGE = {
  error: { icon: '✖', label: 'Error' },
  warning: { icon: '▲', label: 'Warning' },
  info: { icon: 'ℹ', label: 'Info' },
  intended: { icon: '✓', label: 'Intended' },
} as const;

export type BadgeKind = keyof typeof BADGE;
export const kindOf = (w: Warning): BadgeKind => (w.intended ? 'intended' : w.severity);

/** Severity shown with an icon and a word, never colour alone. */
export function SeverityBadge({ kind }: { kind: BadgeKind }) {
  const b = BADGE[kind];
  return (
    <span class={`badge badge-${kind}`}>
      <span aria-hidden="true">{b.icon}</span> {b.label}
    </span>
  );
}

/** Compact count, e.g. "✖ 2", for lists. */
export function CountBadge({ warnings }: { warnings: Warning[] }) {
  const active = warnings.filter((w) => !w.intended);
  if (active.length === 0) return null;
  const kind = active.some((w) => w.severity === 'error') ? 'error' : active.some((w) => w.severity === 'warning') ? 'warning' : 'info';
  return (
    <span class={`count count-${kind}`} aria-label={`${active.length} ${BADGE[kind].label.toLowerCase()}${active.length > 1 ? 's' : ''}`}>
      <span aria-hidden="true">{BADGE[kind].icon} {active.length}</span>
    </span>
  );
}
