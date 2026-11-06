import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icon.tsx';

/** One coach mark: where to go first (idempotent, so Back works), what to point at, and what to say. */
export interface TourStep {
  title: string;
  text: string;
  /** CSS selector of the thing to point at; the step waits (briefly) for it to appear. */
  anchor: string;
  go?: () => Promise<unknown> | void;
}

interface Box { top: number; left: number; width: number; height: number }

const PAD = 8;
const CARD_W = 340;

/** Where the card goes: under the spotlight if there is room, else above, else beside it; always inside the window. */
function cardPlace(box: Box | null, cardH: number): { top: number; left: number } {
  const W = innerWidth;
  const H = innerHeight;
  if (!box) return { top: (H - cardH) / 2, left: (W - CARD_W) / 2 };
  const clampX = (x: number) => Math.max(12, Math.min(W - CARD_W - 12, x));
  const clampY = (y: number) => Math.max(12, Math.min(H - cardH - 12, y));
  const below = box.top + box.height + PAD + 12;
  if (below + cardH < H - 12) return { top: below, left: clampX(box.left) };
  const above = box.top - PAD - 12 - cardH;
  if (above > 12) return { top: above, left: clampX(box.left) };
  const right = box.left + box.width + PAD + 12;
  if (right + CARD_W < W - 12) return { top: clampY(box.top), left: right };
  return { top: clampY(box.top), left: clampX(box.left - PAD - 12 - CARD_W) };
}

/**
 * The first-run tour: a spotlight on one part of the app at a time, with a card saying what it is.
 * Back and Next (or the arrow keys) move through the steps; Skip or Esc ends it. It only moves around and reads.
 * The step lives in the caller: the tour is drawn by both the library and the world screen, so it remounts between them.
 */
export function Tour({ steps, step: i, onStep: setI, onClose }: { steps: TourStep[]; step: number; onStep: (i: number) => void; onClose: (finished: boolean) => void }) {
  const [box, setBox] = useState<Box | null>(null);
  const [ready, setReady] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const [cardH, setCardH] = useState(200);
  const step = steps[i]!;
  const last = i === steps.length - 1;

  // Go to the step's place, then follow its anchor (it can move as the layout settles or the window resizes).
  useEffect(() => {
    let live = true;
    let el: Element | null = null;
    setReady(false);
    const measure = () => {
      if (!live) return;
      if (!el?.isConnected) el = document.querySelector(step.anchor);
      const r = el?.getBoundingClientRect();
      const b = r && r.width > 0 ? { top: Math.max(0, r.top), left: Math.max(0, r.left), width: Math.min(r.width, innerWidth - Math.max(0, r.left)), height: Math.min(r.bottom, innerHeight) - Math.max(0, r.top) } : null;
      setBox((old) => (old && b && Math.abs(old.top - b.top) + Math.abs(old.left - b.left) + Math.abs(old.width - b.width) + Math.abs(old.height - b.height) < 1 ? old : b));
    };
    void (async () => {
      await step.go?.();
      for (let t = 0; live && t < 3000 && !document.querySelector(step.anchor); t += 50) await new Promise((r) => setTimeout(r, 50));
      if (!live) return;
      document.querySelector(step.anchor)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      measure();
      setReady(true);
    })();
    const timer = setInterval(measure, 250);
    addEventListener('resize', measure);
    return () => {
      live = false;
      clearInterval(timer);
      removeEventListener('resize', measure);
    };
  }, [i]);

  useLayoutEffect(() => {
    if (card.current) setCardH(card.current.offsetHeight);
  });
  useEffect(() => {
    if (ready) next.current?.focus();
  }, [ready, i]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false);
      else if (e.key === 'ArrowRight') setI(Math.min(steps.length - 1, i + 1));
      else if (e.key === 'ArrowLeft') setI(Math.max(0, i - 1));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [i, onClose, setI, steps.length]);

  const at = cardPlace(box, cardH);
  return (
    <div class="tour" data-step={i}>
      <div class="tour-block" onMouseDown={(e) => e.preventDefault()} />
      <div class={`tour-spot${box ? '' : ' is-none'}`} style={box ? { top: `${box.top - PAD}px`, left: `${box.left - PAD}px`, width: `${box.width + 2 * PAD}px`, height: `${box.height + 2 * PAD}px` } : undefined} />
      <div ref={card} class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text" style={{ top: `${at.top}px`, left: `${at.left}px`, width: `${CARD_W}px` }}>
        <p class="tour-count"><Icon name="direction-signs" /> Tour · {i + 1} of {steps.length}</p>
        <h2 id="tour-title" class="tour-title">{step.title}</h2>
        <p id="tour-text" class="tour-text">{step.text}</p>
        <div class="tour-dots" aria-hidden="true">{steps.map((_, n) => <span key={n} class={n === i ? 'is-on' : ''} />)}</div>
        <div class="tour-actions">
          <button type="button" class="ghost small tour-skip" onClick={() => onClose(false)}>{last ? 'Close' : 'Skip tour'}</button>
          <span class="tour-move">
            <button type="button" class="ghost small tour-back" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
            <button ref={next} type="button" class="primary small tour-next" disabled={!ready} onClick={() => (last ? onClose(true) : setI(i + 1))}>{last ? 'Finish' : 'Next'}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
