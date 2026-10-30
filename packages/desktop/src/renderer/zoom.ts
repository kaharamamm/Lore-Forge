import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';

export interface PanZoom {
  t: ZoomTransform;
  /** Zoom around the middle of the element. */
  zoomBy: (k: number) => void;
  /** Pan by screen pixels. */
  panBy: (dx: number, dy: number) => void;
  set: (t: ZoomTransform) => void;
}

/**
 * d3-zoom on an element: drag to pan, Ctrl (⌘)+scroll or pinch to zoom; a plain wheel still scrolls the page.
 * `xOnly` keeps panning horizontal (the timeline scrolls its lanes natively). Clicks on things marked
 * with `ignore` never start a pan.
 */
export function usePanZoom<E extends Element>(ref: { current: E | null }, opts: { min: number; max: number; xOnly?: boolean; ignore?: string }): PanZoom {
  const [t, setT] = useState<ZoomTransform>(zoomIdentity);
  const z = useRef<ZoomBehavior<E, unknown> | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const behavior = zoom<E, unknown>()
      .scaleExtent([opts.min, opts.max])
      .filter((ev: MouseEvent & WheelEvent) => (ev.type === 'wheel' ? ev.ctrlKey || ev.metaKey : !ev.button) && !(opts.ignore && (ev.target as Element).closest?.(opts.ignore)))
      .wheelDelta((ev: WheelEvent) => -ev.deltaY * (ev.deltaMode === 1 ? 0.05 : ev.deltaMode ? 1 : 0.002))
      .on('zoom', (ev: { transform: ZoomTransform }) => setT(ev.transform));
    if (opts.xOnly) behavior.constrain((tr) => (tr.y ? zoomIdentity.translate(tr.x, 0).scale(tr.k) : tr));
    select(el).call(behavior);
    z.current = behavior;
    return () => { select(el).on('.zoom', null); z.current = null; };
  }, [ref.current, opts.min, opts.max]);
  const sel = () => select(ref.current!);
  return {
    t,
    zoomBy: (k) => { if (z.current && ref.current) z.current.scaleBy(sel(), k); },
    panBy: (dx, dy) => { if (z.current && ref.current) z.current.translateBy(sel(), dx / t.k, dy / t.k); },
    set: (next) => { if (z.current && ref.current) z.current.transform(sel(), next); },
  };
}

export { zoomIdentity };
