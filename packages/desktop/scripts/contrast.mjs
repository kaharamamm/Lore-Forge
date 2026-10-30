// Checks WCAG contrast (>= 4.5:1) of text colours on the surfaces they sit on, read from styles.css.
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
const vars = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const v = (n) => (n.startsWith('#') ? n : vars[n] ?? (() => { throw new Error(`no --${n}`); })());
const surfaces = ['bg', 'panel', 'panel-2'];
const pairs = [];
for (const fg of ['text', 'muted', 'accent', 'gold', 'error', 'warning', 'info', 'intended', 'ok', 't-character', 't-place', 't-faction', 't-item', 't-event', 't-note']) for (const bg of surfaces) pairs.push([fg, bg]);
for (const [fg, bg] of [['error', 'error-bg'], ['warning', 'warning-bg'], ['info', 'info-bg'], ['intended', 'intended-bg'], ['text', 'info-bg']]) pairs.push([fg, bg]);
// Selected, pressed and checked controls (toggles, tabs, status pills, segmented buttons, icon choices) and primary buttons.
for (const bg of ['selected-bg', 'selected-hover', 'selected-gold-bg', 'primary-bg', 'primary-hover']) pairs.push(['selected-ink', bg]);
for (const fg of ['text', 'gold', 't-character', 't-place', 't-faction', 't-item', 't-event', 't-note']) pairs.push([fg, 'selected-gold-bg']);
pairs.push(['text', 'selected-bg']);
// Timeline bar text (#14161b) on each type colour; preview sheet ink on paper.
for (const t of ['character', 'place', 'faction', 'item', 'event', 'note']) pairs.push(['#14161b', `t-${t}`]);
for (const fg of ['#23201b', '#2d3e66', '#5a554c', '#4a4439', '#23336b']) pairs.push([fg, '#fbf8f1']);
pairs.push(['#23201b', '#efe9dc']);
// The library: shelf text on the wooden case, and cover text (parchment, title, counts) on the darkest cover overlay.
for (const fg of ['text', 'muted', 'gold']) for (const bg of ['wood-back', '#24180e']) pairs.push([fg, bg]);
for (const fg of ['#fbf3df', '#efe3c4', '#d9ccad', 'gold']) pairs.push([fg, '#1d140c']);
// Danger buttons: white on the solid red and its hover.
pairs.push(['#ffffff', '#8e2c26'], ['#ffffff', '#a3342d']);
// The library scene: hero and shelf text over the brightest spots (top glow plus light shaft, candle glow).
const mix = (a, b, t) => `#${[1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('')}`;
const lit = mix(mix(v('bg'), '#e0bd6a', 0.2), '#ffe6af', 0.08);
const candle = mix(v('bg'), '#ffaa46', 0.16);
for (const fg of ['text', 'muted', 'gold']) pairs.push([fg, lit], [fg, candle]);
let bad = 0;
for (const [fg, bg] of pairs) {
  const r = ratio(v(fg), v(bg));
  if (r < 4.5) { bad++; console.log(`FAIL ${fg} on ${bg}: ${r.toFixed(2)}`); }
}
console.log(`${pairs.length} pairs checked, ${bad} below 4.5:1`);
process.exit(bad ? 1 : 0);
