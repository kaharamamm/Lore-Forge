import { ICON_SIZE, ICONS, type IconName } from '@lore-forge/core';

/**
 * A game-icons.net icon (CC BY 3.0, see About) as inline SVG in the current text colour.
 * Decorative by default; pass `label` when the icon is the only thing saying what it means.
 */
export function Icon({ name, label, class: cls }: { name: IconName; label?: string; class?: string }) {
  return (
    <svg class={`icon${cls ? ` ${cls}` : ''}`} viewBox={`0 0 ${ICON_SIZE} ${ICON_SIZE}`} width="1em" height="1em" fill="currentColor" focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' })}>
      {ICONS[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

/** The same icon placed inside an SVG drawing, `size` units square with its top-left at (x, y). */
export function SvgIcon({ name, x, y, size, class: cls }: { name: IconName; x: number; y: number; size: number; class?: string }) {
  return (
    <svg class={cls} x={x} y={y} width={size} height={size} viewBox={`0 0 ${ICON_SIZE} ${ICON_SIZE}`} fill="currentColor" aria-hidden="true">
      {ICONS[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
