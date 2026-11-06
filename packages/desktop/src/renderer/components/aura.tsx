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

/** The 24 runes of the Elder Futhark, as strokes in a 10x16 box (lines, so they need no font). */
const FUTHARK = [
  'M3 1v14M3 5l5-4M3 9l5-4', // fehu
  'M2 15V1l6 4v10', // uruz
  'M3 1v14M3 4l5 4-5 4', // thurisaz
  'M3 1v14M3 1l5 3M3 5l5 3', // ansuz
  'M2 15V1l5 3-5 3 5 8', // raidho
  'M8 1L2 8l6 7', // kaunan
  'M2 2l6 12M8 2l-6 12', // gebo
  'M3 15V1l5 3-5 3', // wunjo
  'M2 1v14M8 1v14M2 6l6 4', // hagalaz
  'M5 1v14M2 5l6 5', // naudiz
  'M5 1v14', // isaz
  'M4 2L1 5l3 3M6 8l3 3-3 3', // jera
  'M5 1v14M5 1l3 3M5 15l-3-3', // eihwaz
  'M2 1v14M2 1l5 3M2 15l5-3M7 4l2-2M7 12l2 2', // perthro
  'M5 1v14M5 6L1 1M5 6l4-5', // algiz
  'M7 1L2 6l6 4-5 5', // sowilo
  'M5 1v14M5 1L1 6M5 1l4 5', // tiwaz
  'M2 1v14M2 1l5 3.5L2 8l5 3.5L2 15', // berkano
  'M2 15V1l3 4 3-4v14', // ehwaz
  'M2 15V1l6 6M8 15V1L2 7', // mannaz
  'M3 15V1l5 4', // laguz
  'M5 1l4 7-4 7-4-7z', // ingwaz
  'M1 2v12l8-12v12z', // dagaz
  'M5 1l3 4-3 4-3-4zM3 7.5L1 15M7 7.5L9 15', // othala
];
/** A few Ogham letters (strokes on a stem) and a bind rune, in the same 10x16 box. */
const OGHAM = [
  'M5 1v14M5 4h4M5 7h4M5 10h4', // beith-like
  'M5 1v14M1 5h8M1 8h8', // cross strokes
  'M5 1v14M2 6l6-2M2 10l6-2M2 14l6-2', // slanted strokes
  'M5 1v14M5 1l4 4M5 1L1 5M5 15l4-4M5 15l-4-4', // bind rune
];
/** Old alchemists' signs and a star sigil, in a 16x16 box. */
const SIGILS = [
  'M8 2l6 11H2z', // fire
  'M2 3h12L8 14z', // water
  'M8 2l6 11H2zM3.5 9.5h9', // air
  'M2 3h12L8 14zM4.5 7.5h7', // earth
  'M8 2l5 7H3zM8 9v6M5 12h6', // sulphur
  'M8 3a5 5 0 1 0 .01 0M8 7.6v.8', // sun
  'M8 1v14M2 4.5l12 7M2 11.5l12-7', // star
];
type Rune = { box: string; kind: '' | ' is-sigil'; d: string };
/**
 * The scene's runes: most from the Elder Futhark, each a different one, then a few Ogham letters and sigils.
 * Places, sizes (about 0.6x to 1.5x), tilts (up to 30 degrees either way) and timings are fixed per rune, so
 * they do not jump between visits. Kept to under 30, faint and slow.
 */
const SCENE_RUNES = ([
  ...Array.from({ length: 18 }, (_, i): Rune => ({ box: '0 0 10 16', kind: '', d: FUTHARK[(i * 7) % FUTHARK.length]! })),
  ...OGHAM.slice(0, 3).map((d): Rune => ({ box: '0 0 10 16', kind: '', d })),
  ...SIGILS.slice(0, 6).map((d): Rune => ({ box: '0 0 16 16', kind: ' is-sigil', d })),
]).map((r, i) => {
  const h = hash(`rune${i}`);
  return { ...r, style: { '--x': `${3 + (h >>> 3) % 94}%`, '--y': `${18 + (h >>> 9) % 72}%`, '--t': `${22 + (h >>> 5) % 20}s`, '--delay': `-${(h >>> 13) % 34}s`, '--r': `${((h >>> 7) % 61) - 30}deg`, '--k': `${(0.6 + ((h >>> 11) % 10) * 0.1).toFixed(2)}` } };
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
 * The library's scene, back to front: slow clouds of colour, three beams of light with dust, drifting runes
 * (Elder Futhark, a little Ogham, old sigils), candle glows with embers rising from them, mist along the floor and a few large out-of-focus specks of light,
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
          <svg key={i} class={`rune${r.kind}`} style={r.style} viewBox={r.box}><path d={r.d} /></svg>
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
