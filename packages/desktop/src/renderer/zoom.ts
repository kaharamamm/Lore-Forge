import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';

/**
 * Runs `fn` on the next animation frame, or after 50 ms when frames are not coming (a hidden or throttled window),
 * whichever is first. Returns a cancel function.
 */
export function nextFrame(fn: () => void): () => void {
  let done = false;
  const run = () => { if (done) return; done = true; cancelAnimationFrame(raf); clearTimeout(timer); fn(); };
  const raf = requestAnimationFrame(run);
  const timer = setTimeout(run, 50);
  return () => { done = true; cancelAnimationFrame(raf); clearTimeout(timer); };
}

export interface PanZoom {
  t: ZoomTransform;
  /** Zoom around the middle of the element. */
  zoomBy: (k: number) => void;
  /** Pan by screen pixels. */
  panBy: (dx: number, dy: number) => void;
  set: (t: ZoomTransform) => void;
  /** Re-apply the constraint to the current transform (after the view or the content changes size). */
  reclamp: () => void;
}

/**
 * d3-zoom on an element: drag to pan, Ctrl (⌘)+scroll or pinch to zoom; a plain wheel still scrolls the page.
 * `xOnly` keeps panning horizontal (the timeline scrolls its lanes natively). Clicks on things marked
 * with `ignore` never start a pan.
 *
 * With `live`, a gesture does not re-render on every event: `live(next, shown)` may draw a frame itself (say, a
 * CSS offset for a pure pan) and return true; otherwise the state follows at most once per animation frame. The
 * state always catches up when the gesture ends (mouse up, the wheel at rest, any button or programmatic move).
 */
export function usePanZoom<E extends Element>(ref: { current: E | null }, opts: { min: number; max: number; xOnly?: boolean; ignore?: string; clamp?: (t: ZoomTransform) => ZoomTransform; live?: (next: ZoomTransform, shown: ZoomTransform) => boolean }): PanZoom {
  // The latest clamp, read by d3 on every drag, wheel and programmatic move.
  const clamp = useRef(opts.clamp);
  clamp.current = opts.clamp;
  const live = useRef(opts.live);
  live.current = opts.live;
  const [t, setState] = useState<ZoomTransform>(zoomIdentity);
  /** The transform the last render drew, and a state update waiting for the next frame. */
  const shown = useRef<ZoomTransform>(zoomIdentity);
  const frame = useRef<{ cancel: (() => void) | null; next: ZoomTransform }>({ cancel: null, next: zoomIdentity });
  const setT = (next: ZoomTransform) => {
    frame.current.cancel?.();
    frame.current.cancel = null;
    shown.current = next;
    setState(next);
  };
  const onZoom = (next: ZoomTransform) => {
    if (!live.current) return setT(next);
    if (live.current(next, shown.current)) return;
    frame.current.next = next;
    if (!frame.current.cancel) frame.current.cancel = nextFrame(() => { frame.current.cancel = null; setT(frame.current.next); });
  };
  /** Drops a vertical offset when the view only moves sideways. */
  const xOnly = (tr: ZoomTransform) => (opts.xOnly && tr.y ? zoomIdentity.translate(tr.x, 0).scale(tr.k) : tr);
  const z = useRef<ZoomBehavior<E, unknown> | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const behavior = zoom<E, unknown>()
      .scaleExtent([opts.min, opts.max])
      .filter((ev: MouseEvent & WheelEvent) => (ev.type === 'wheel' ? ev.ctrlKey || ev.metaKey : !ev.button) && !(opts.ignore && (ev.target as Element).closest?.(opts.ignore)))
      .wheelDelta((ev: WheelEvent) => -ev.deltaY * (ev.deltaMode === 1 ? 0.05 : ev.deltaMode ? 1 : 0.002))
      .on('zoom', (ev: { transform: ZoomTransform }) => onZoom(ev.transform))
      .on('end', (ev: { transform: ZoomTransform }) => { if (live.current) setT(ev.transform); });
    behavior.constrain((tr) => (clamp.current ? clamp.current(xOnly(tr)) : xOnly(tr)));
    select(el).call(behavior);
    z.current = behavior;
    return () => { select(el).on('.zoom', null); z.current = null; frame.current.cancel?.(); frame.current.cancel = null; };
  }, [ref.current, opts.min, opts.max]);
  const sel = () => select(ref.current!);
  return {
    t,
    zoomBy: (k) => { if (z.current && ref.current) z.current.scaleBy(sel(), k); },
    panBy: (dx, dy) => { if (z.current && ref.current) { const k = zoomTransform(ref.current).k; z.current.translateBy(sel(), dx / k, dy / k); } },
    // d3's transform() skips the constraint, so the move is clamped first: d3 never sees (and a live pan never
    // draws, nor a pending frame commits) a transform past the ends, even for a moment.
    set: (next) => { if (z.current && ref.current) z.current.transform(sel(), clamp.current ? clamp.current(xOnly(next)) : next); },
    reclamp: () => { if (z.current && ref.current && clamp.current) z.current.translateBy(sel(), 0, 0); },
  };
}

export { zoomIdentity };
