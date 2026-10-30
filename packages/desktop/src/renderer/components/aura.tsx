import { hash } from '@lore-forge/core';
import { useEffect, useRef } from 'preact/hooks';

/** Deterministic mote positions, sizes and timings, so the sky looks the same on every render. */
const motes = (n: number) => Array.from({ length: n }, (_, i) => {
  const h = hash(`mote${i}`);
  return { '--x': `${h % 100}%`, '--y': `${(h >>> 8) % 100}%`, '--s': `${0.15 + ((h >>> 16) % 4) * 0.07}rem`, '--t': `${14 + ((h >>> 4) % 14)}s`, '--delay': `-${(h >>> 12) % 20}s` };
});
const FULL = motes(22);
const CALM = motes(12);

/**
 * The library's ambient light: a soft breathing glow and slowly drifting motes, behind the content (CSS animation
 * only). `calm` is the quieter version for the working views. Paused while the window is hidden; no motes with
 * reduced motion. `local` fills its positioned parent instead of the window.
 */
export function Aura({ calm, local, scene }: { calm?: boolean; local?: boolean; scene?: boolean }) {
  return (
    <div class={`aura${calm ? ' is-calm' : ''}${local ? ' is-local' : ''}`} aria-hidden="true">
      {scene && <LibraryScene />}
      {(calm ? CALM : FULL).map((m, i) => <span key={i} class="mote" style={m} />)}
    </div>
  );
}

/** Simple rune strokes (a 10x16 box), drawn as lines so they need no font. */
const RUNES = [
  'M3 1v14M3 3l5 3M3 7l5 3', // fehu
  'M2 1v14M2 1l6 4v10', // uruz
  'M3 1v14M3 4l5 4-5 4', // thurisaz
  'M5 1v14M5 1l-3 4M5 1l3 4', // tiwaz
  'M2 1v14M8 1v14M2 1l6 6M8 1l-6 6', // mannaz-ish
  'M5 1v14M1 5l8 6M9 5l-8 6', // algiz-ish
  'M2 3l6 10M8 3l-6 10', // gebo
  'M5 1l4 7-4 7-4-7z', // ingwaz
];
const SCENE_RUNES = Array.from({ length: 9 }, (_, i) => {
  const h = hash(`rune${i}`);
  return { d: RUNES[h % RUNES.length]!, style: { '--x': `${4 + (h >>> 3) % 92}%`, '--y': `${20 + (h >>> 9) % 70}%`, '--t': `${22 + (h >>> 5) % 18}s`, '--delay': `-${(h >>> 13) % 30}s`, '--r': `${((h >>> 7) % 40) - 20}deg` } };
});
const SHAFT_MOTES = Array.from({ length: 14 }, (_, i) => {
  const h = hash(`dust${i}`);
  return { '--x': `${(h >>> 2) % 100}%`, '--y': `${(h >>> 10) % 100}%`, '--s': `${0.1 + ((h >>> 17) % 3) * 0.05}rem`, '--t': `${16 + (h >>> 6) % 16}s`, '--delay': `-${(h >>> 14) % 24}s` };
});

/**
 * The library's scene: a shaft of light with dust, a few drifting runes and two candle glows, each on a layer
 * that moves a little with the mouse (parallax). Only transform and opacity animate. Paused while the window
 * is hidden; still (no drift, no flicker, no parallax) under reduced motion.
 */
function LibraryScene() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    // Setting two custom properties per move is cheap; the layers ease toward them with a CSS transition.
    const onMove = (e: MouseEvent) => {
      if (still.matches || document.hidden || !root.current) return;
      root.current.style.setProperty('--px', (e.clientX / innerWidth - 0.5).toFixed(3));
      root.current.style.setProperty('--py', (e.clientY / innerHeight - 0.5).toFixed(3));
    };
    addEventListener('mousemove', onMove, { passive: true });
    return () => removeEventListener('mousemove', onMove);
  }, []);
  return (
    <div class="scene" ref={root}>
      <div class="scene-layer depth-1">
        <div class="light-shaft">{SHAFT_MOTES.map((m, i) => <span key={i} class="dust" style={m} />)}</div>
      </div>
      <div class="scene-layer depth-2">
        {SCENE_RUNES.map((r, i) => (
          <svg key={i} class="rune" style={r.style} viewBox="0 0 10 16"><path d={r.d} /></svg>
        ))}
      </div>
      <div class="scene-layer depth-3">
        <span class="candle candle-left" />
        <span class="candle candle-right" />
      </div>
    </div>
  );
}

/** Pause every CSS animation while the window is hidden or minimised (html.is-hidden). Call once at start-up. */
export function pauseWhenHidden(): void {
  const sync = () => document.documentElement.classList.toggle('is-hidden', document.hidden);
  document.addEventListener('visibilitychange', sync);
  sync();
}
