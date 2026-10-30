import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icon.tsx';

export type SaveState = { kind: 'saved' } | { kind: 'saving' } | { kind: 'failed'; message: string };

/**
 * Save state shown only when it changes: "Saving…", then "Saved" for a moment, then nothing.
 * A failure stays until the next successful save. The element stays in the page (role=status) but is hidden when idle.
 */
export function SaveIndicator({ save }: { save: SaveState }) {
  const [shown, setShown] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setShown(true);
    if (save.kind !== 'saved') return;
    const t = setTimeout(() => setShown(false), 1600);
    return () => clearTimeout(t);
  }, [save]);
  return (
    <span class={`save save-${save.kind}${shown || save.kind === 'failed' ? ' is-shown' : ''}`} role="status">
      {save.kind === 'saved' ? <><Icon name="check-mark" /> Saved</> : save.kind === 'saving' ? 'Saving…' : <><Icon name="cancel" /> Save failed: {save.message}</>}
    </span>
  );
}

const WIDTH_KEY = 'lore-forge.sidebarWidth';
export const SIDEBAR_MIN = 220;
export const SIDEBAR_DEFAULT = 300;
/** At most this many px, and never more than 30% of the window, so the editor stays the widest pane. */
export const sidebarMax = () => Math.min(460, Math.round(window.innerWidth * 0.3));
const clampWidth = (w: number) => Math.round(Math.max(SIDEBAR_MIN, Math.min(sidebarMax(), w)));

/** Sidebar width in px, remembered between sessions. */
export function useSidebarWidth(): [number, (w: number) => void] {
  const [w, setW] = useState(() => clampWidth(Number(localStorage.getItem(WIDTH_KEY)) || SIDEBAR_DEFAULT));
  const set = (next: number) => {
    const c = clampWidth(next);
    setW(c);
    localStorage.setItem(WIDTH_KEY, String(c));
  };
  useEffect(() => {
    const onResize = () => setW((cur) => clampWidth(cur));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return [w, set];
}

/** Drag handle on the sidebar's right edge (arrow keys work too). */
export function PaneResizer({ width, onWidth }: { width: number; onWidth: (w: number) => void }) {
  const drag = (e: PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    const left = el.parentElement!.getBoundingClientRect().left;
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-dragging');
    const move = (ev: PointerEvent) => onWidth(ev.clientX - left);
    const up = () => {
      el.classList.remove('is-dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    e.preventDefault();
  };
  return (
    <div class="pane-resizer" role="separator" aria-orientation="vertical" aria-label="Resize the sidebar" tabIndex={0}
      aria-valuenow={width} aria-valuemin={SIDEBAR_MIN} aria-valuemax={sidebarMax()}
      onPointerDown={drag} onDblClick={() => onWidth(SIDEBAR_DEFAULT)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          onWidth(width + (e.key === 'ArrowLeft' ? -16 : 16));
        }
      }} />
  );
}
