import type { ComponentChildren, RefObject } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';

/** Why a popover closes: a click outside it, Escape inside it, or the page (or a panel) scrolling under it. */
export type PopoverClose = 'outside' | 'escape' | 'scroll';

/**
 * A floating panel in its own layer: rendered into <body> (so no panel can clip it or be pushed by it), placed under
 * its anchor or above it when there is more room there, kept inside the window, and repositioned on resize. A click
 * outside the anchor and the panel, Escape inside it, or scrolling the page or a panel behind it calls onClose, like
 * a native menu: a list left floating while its field scrolls away reads as broken. Scrolling a list inside the
 * panel is fine.
 */
export function Popover({ anchor, onClose, children, class: cls, matchWidth, onPointerDown, ...rest }: {
  anchor: RefObject<HTMLElement>;
  onClose: (why: PopoverClose) => void;
  children: ComponentChildren;
  class?: string;
  /** At least as wide as the anchor (list boxes). */
  matchWidth?: boolean;
  id?: string;
  role?: 'dialog' | 'listbox' | 'menu';
  'aria-label'?: string;
  /** A suggestion list keeps the focus in its text box: it cancels pointer downs on itself (its scrollbar too). */
  onPointerDown?: (e: PointerEvent) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      if (!a) return;
      const margin = 8, gap = 4;
      if (matchWidth) el.style.minWidth = `${Math.round(a.width)}px`;
      // Measuring the natural height lifts the cap for a moment, which would clamp every scrolled list inside to
      // the top: keep their scroll positions.
      const scrolled = [el, ...el.querySelectorAll<HTMLElement>('*')].filter((x) => x.scrollTop > 0).map((x) => [x, x.scrollTop] as const);
      el.style.maxHeight = '';
      const h = el.scrollHeight + 2;
      const below = window.innerHeight - a.bottom - gap - margin;
      const above = a.top - gap - margin;
      const up = h > below && above > below;
      // An anchor scrolled out of a short window still gets a panel inside it.
      const room = Math.min(window.innerHeight - 2 * margin, Math.max(80, up ? above : below));
      el.style.maxHeight = `${Math.floor(room)}px`;
      const height = Math.min(h, room);
      const top = up ? a.top - gap - height : a.bottom + gap;
      el.style.top = `${Math.round(Math.max(margin, Math.min(top, window.innerHeight - margin - height)))}px`;
      el.style.left = `${Math.round(Math.max(margin, Math.min(a.left, window.innerWidth - el.offsetWidth - margin)))}px`;
      el.classList.toggle('is-above', up);
      for (const [x, top] of scrolled) x.scrollTop = top;
    };
    place();
    // Placing changes the panel's own size, so do it on the next frame rather than inside the observer callback.
    let frame = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); });
    ro.observe(el);
    // The window's own size too: a resize event can come before the new height is in place.
    ro.observe(document.documentElement);
    // The page or a panel scrolling closes the popover; a list inside this panel scrolling does not (placing then
    // reset that list's scroll position, so the font list could not be scrolled at all). Scrolls in the first moment
    // after opening (a field scrolled into view as it takes the focus) only move the panel along.
    const opened = performance.now();
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && el.contains(e.target)) return;
      if (performance.now() - opened < 200) place();
      else close.current('scroll');
    };
    window.addEventListener('scroll', onScroll, true);
    const onResize = () => { place(); cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onResize); };
  }, []);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !anchor.current?.contains(t)) close.current('outside');
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, []);
  return createPortal(
    <div ref={box} class={`popover${cls ? ` ${cls}` : ''}`} {...rest} onPointerDown={onPointerDown}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close.current('escape'); } }}>
      {children}
    </div>,
    document.body,
  );
}
