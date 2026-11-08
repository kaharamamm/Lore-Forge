import type { IconName, Warning } from '@lore-forge/core';
import { t } from '../i18n.tsx';
import { Icon } from './icon.tsx';

export const BADGE = {
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
      <Icon name={b.icon} /> {t(b.label)}
    </span>
  );
}

/** "2 errors", "1 warning", "3 infos": a count badge's name. */
function countLabel(kind: 'error' | 'warning' | 'info', n: number): string {
  if (kind === 'error') return n > 1 ? t('{n} errors', { n }) : t('{n} error', { n });
  if (kind === 'warning') return n > 1 ? t('{n} warnings', { n }) : t('{n} warning', { n });
  return n > 1 ? t('{n} infos', { n }) : t('{n} info', { n });
}

/** Compact count, e.g. an error icon and "2", for lists. */
export function CountBadge({ warnings }: { warnings: Warning[] }) {
  const active = warnings.filter((w) => !w.intended);
  if (active.length === 0) return null;
  const kind = active.some((w) => w.severity === 'error') ? 'error' : active.some((w) => w.severity === 'warning') ? 'warning' : 'info';
  return (
    <span class={`count count-${kind}`} aria-label={countLabel(kind, active.length)}>
      <span aria-hidden="true"><Icon name={BADGE[kind].icon} /> {active.length}</span>
    </span>
  );
}
