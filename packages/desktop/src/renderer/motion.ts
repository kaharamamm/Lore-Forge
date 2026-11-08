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
 * Run a state change as a CSS View Transition: the old view fades out while the new one rises in.
 * Preact renders on the next microtask, so the update callback waits one task for the new DOM.
 */
export function transition(update: () => void): void {
  if (!document.startViewTransition || reduced()) return update();
  const vt = document.startViewTransition(() => {
    update();
    return new Promise<void>((done) => setTimeout(done, 0));
  });
  // A quick second change skips the first animation (its update still runs); that is not an error.
  const ignore = () => {};
  vt.ready.catch(ignore);
  vt.finished.catch(ignore);
  vt.updateCallbackDone.catch(ignore);
}
