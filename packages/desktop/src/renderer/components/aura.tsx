import { hash } from '@lore-forge/core';
import { useEffect, useRef } from 'preact/hooks';

/** Deterministic mote positions, sizes and timings, so the sky looks the same on every render. */
const motes = (n: number) => Array.from({ length: n }, (_, i) => {
  const h = hash(`mote${i}`);
  return { '--x': `${h % 100}%`, '--y': `${(h >>> 8) % 100}%`, '--s': `${0.15 + ((h >>> 16) % 4) * 0.07}rem`, '--t': `${14 + ((h >>> 4) % 14)}s`, '--delay': `-${(h >>> 12) % 20}s`, '--dx': `${((h >>> 20) % 7) - 2}rem` };
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
const SCENE_RUNES = Array.from({ length: 11 }, (_, i) => {
  const h = hash(`rune${i}`);
  return { d: RUNES[h % RUNES.length]!, style: { '--x': `${4 + (h >>> 3) % 92}%`, '--y': `${20 + (h >>> 9) % 70}%`, '--t': `${22 + (h >>> 5) % 18}s`, '--delay': `-${(h >>> 13) % 30}s`, '--r': `${((h >>> 7) % 40) - 20}deg`, '--k': `${(0.8 + ((h >>> 11) % 6) * 0.12).toFixed(2)}` } };
});
/** Three beams from a high window on the left: angle, width, place and brightness, each with its own dust. */
const SHAFTS = [
  { '--a': '-27deg', '--sw': '22rem', '--sx': '2%', '--so': '0.85', '--t': '17s', '--delay': '-4s' },
  { '--a': '-21deg', '--sw': '12rem', '--sx': '17%', '--so': '1', '--t': '13s', '--delay': '-9s' },
  { '--a': '-16deg', '--sw': '7rem', '--sx': '27%', '--so': '0.7', '--t': '21s', '--delay': '-2s' },
].map((style, s) => ({
  style,
  dust: Array.from({ length: [9, 7, 4][s]! }, (_, i) => {
    const h = hash(`dust${s}-${i}`);
    return { '--x': `${10 + (h >>> 2) % 80}%`, '--y': `${(h >>> 10) % 85}%`, '--s': `${0.1 + ((h >>> 17) % 4) * 0.05}rem`, '--t': `${14 + (h >>> 6) % 16}s`, '--delay': `-${(h >>> 14) % 24}s`, '--dx': `${((h >>> 21) % 5) - 2}rem` };
  }),
}));
/** Out-of-focus specks of light close to the viewer: few, large, soft and slow. */
const BOKEH = Array.from({ length: 8 }, (_, i) => {
  const h = hash(`bokeh${i}`);
  return { '--x': `${(h >>> 3) % 96}%`, '--y': `${8 + (h >>> 11) % 84}%`, '--s': `${2.4 + ((h >>> 5) % 6) * 0.7}rem`, '--t': `${28 + (h >>> 7) % 22}s`, '--delay': `-${(h >>> 15) % 40}s`, '--bx': `${((h >>> 19) % 13) - 6}rem`, '--by': `${((h >>> 23) % 9) - 6}rem`, '--hue': i % 3 === 2 ? '255 186 110' : '255 222 160' };
});
/** Embers rising from the two candles: from the bottom corners, swaying a little, fading as they climb. */
const EMBERS = Array.from({ length: 16 }, (_, i) => {
  const h = hash(`ember${i}`);
  const left = i % 2 === 0;
  const x = (h >>> 2) % 16;
  return { '--x': `${left ? 2 + x : 82 + x}%`, '--s': `${0.14 + ((h >>> 9) % 3) * 0.06}rem`, '--t': `${7 + (h >>> 5) % 7}s`, '--delay': `-${(h >>> 13) % 14}s`, '--sway': `${[-1.6, -0.9, 0.8, 1.2, 1.8][(h >>> 17) % 5]}rem`, '--rise': `${18 + (h >>> 21) % 16}rem` };
});

/**
 * The library's scene, back to front: slow clouds of colour, three beams of light with dust, drifting runes,
 * candle glows with embers rising from them, mist along the floor and a few large out-of-focus specks of light,
 * under a vignette. Each depth is a layer that moves a little with the mouse (parallax), the nearest the most.
 * Only transform and opacity animate. Paused while the window is hidden; still (no drift, no flicker, no
 * parallax, no embers) under reduced motion.
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
      <div class="scene-layer depth-0">
        <span class="nebula nebula-gold" />
        <span class="nebula nebula-violet" />
        <span class="nebula nebula-blue" />
      </div>
      <div class="scene-layer depth-1">
        {SHAFTS.map((s, k) => <div key={k} class="light-shaft" style={s.style}>{s.dust.map((m, i) => <span key={i} class="dust" style={m} />)}</div>)}
      </div>
      <div class="scene-layer depth-2">
        {SCENE_RUNES.map((r, i) => (
          <svg key={i} class="rune" style={r.style} viewBox="0 0 10 16"><path d={r.d} /></svg>
        ))}
      </div>
      <div class="scene-layer depth-3">
        <span class="mist mist-back" />
        <span class="candle candle-left" />
        <span class="candle candle-right" />
        {EMBERS.map((e, i) => <span key={i} class="ember" style={e} />)}
        <span class="mist mist-front" />
      </div>
      <div class="scene-layer depth-4">
        {BOKEH.map((b, i) => <span key={i} class="bokeh" style={b} />)}
      </div>
      <div class="vignette" />
    </div>
  );
}

/** Pause every CSS animation while the window is hidden or minimised (html.is-hidden). Call once at start-up. */
export function pauseWhenHidden(): void {
  const sync = () => document.documentElement.classList.toggle('is-hidden', document.hidden);
  document.addEventListener('visibilitychange', sync);
  sync();
}
