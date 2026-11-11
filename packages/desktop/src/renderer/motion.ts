import autoAnimate from '@formkit/auto-animate';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Longer lists do not slide: auto-animate watches every child's position, which costs every keystroke in a big world. */
export const ANIMATED_MAX = 100;

/**
 * Ref callback: children of this element slide in, out and into place when the list changes, unless the list is
 * long (see ANIMATED_MAX). auto-animate itself stays still when the system asks for reduced motion.
 */
const animatedEls = new WeakSet<Element>();
export function animated(el: Element | null): void {
  if (!el || animatedEls.has(el)) return;
  animatedEls.add(el);
  if (el.childElementCount > ANIMATED_MAX) return;
  autoAnimate(el as HTMLElement, { duration: 180, easing: 'ease-out' });
}

/**
 * A change of view or entry, with the main pane's new content fading in. A plain animation on the pane, not a View
 * Transition: Chromium sends every click to the page root while one plays, so a quick second click after a switch
 * was lost, and it pictured the whole window before each change. Preact renders on a microtask, so the fade starts
 * on the one after it, before the new content is first drawn.
 */
export function transition(update: () => void): void {
  update();
  if (reduced()) return;
  void Promise.resolve().then(() => {
    const main = document.querySelector<HTMLElement>('.main');
    if (!main?.animate) return;
    for (const a of main.getAnimations()) if (a.id === 'view-fade') a.cancel();
    // Opacity only: a moving pane would give wrong positions to anything measured while it plays.
    main.animate([{ opacity: 0.35 }, { opacity: 1 }], { id: 'view-fade', duration: 160, easing: 'ease-out' });
  });
}
