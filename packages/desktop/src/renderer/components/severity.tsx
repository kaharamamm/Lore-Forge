import type { IconName, Warning } from '@lore-forge/core';
import { Icon } from './icon.tsx';

const BADGE = {
  error: { icon: 'cancel', label: 'Error' },
  warning: { icon: 'hazard-sign', label: 'Warning' },
  info: { icon: 'info', label: 'Info' },
  intended: { icon: 'check-mark', label: 'Intended' },
} as const satisfies Record<string, { icon: IconName; label: string }>;

/** Icon for a warning severity. */
export const SEVERITY_ICON = { error: BADGE.error.icon, warning: BADGE.warning.icon, info: BADGE.info.icon } as const;

export type BadgeKind = keyof typeof BADGE;
export const kindOf = (w: Warning): BadgeKind => (w.intended ? 'intended' : w.severity);

/** Severity shown with an icon and a word, never colour alone. */
export function SeverityBadge({ kind }: { kind: BadgeKind }) {
  const b = BADGE[kind];
  return (
    <span class={`badge badge-${kind}`}>
      <Icon name={b.icon} /> {b.label}
    </span>
  );
}

/** Compact count, e.g. an error icon and "2", for lists. */
export function CountBadge({ warnings }: { warnings: Warning[] }) {
  const active = warnings.filter((w) => !w.intended);
  if (active.length === 0) return null;
  const kind = active.some((w) => w.severity === 'error') ? 'error' : active.some((w) => w.severity === 'warning') ? 'warning' : 'info';
  return (
    <span class={`count count-${kind}`} aria-label={`${active.length} ${BADGE[kind].label.toLowerCase()}${active.length > 1 ? 's' : ''}`}>
      <span aria-hidden="true"><Icon name={BADGE[kind].icon} /> {active.length}</span>
    </span>
  );
}
