import { useEffect, useRef, useState } from 'preact/hooks';
import { hsvToRgb, parseHex, rgbToHsv, toHex, type Rgba } from '@lore-forge/core';
import { Popover } from './popover.tsx';

/** Theme colours offered in every picker: the app's gold, parchment, type colours and dark cover tones. */
export const THEME_SWATCHES = ['#e0bd6a', '#fbf3df', '#ffab91', '#8fd18f', '#f6c667', '#82cfff', '#ff8a8a', '#c9b3ff', '#7a2e2e', '#8a5a1c', '#2f5d3a', '#1f4f6b', '#3b3478', '#5c2a5e', '#2b2f3a', '#14161b'];

const RECENT_KEY = 'lore-forge.recent-colours';
const recentColours = (): string[] => {
  try { return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]).filter((c) => parseHex(c)); } catch { return []; }
};
const remember = (c: string) => localStorage.setItem(RECENT_KEY, JSON.stringify([c, ...recentColours().filter((x) => x !== c)].slice(0, 10)));

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

/** Drag inside an element: calls `move` with the pointer position relative to it, 0-1 on each axis. */
function drag(e: PointerEvent, move: (x: number, y: number, box: DOMRect) => void) {
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  const at = (ev: PointerEvent) => {
    const box = el.getBoundingClientRect();
    move((ev.clientX - box.left) / box.width, (ev.clientY - box.top) / box.height, box);
  };
  at(e);
  const up = () => { el.removeEventListener('pointermove', at); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
  el.addEventListener('pointermove', at);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

/**
 * Lore-Forge's own colour picker: a saturation/brightness square, a hue slider, an alpha slider over a checkerboard,
 * hex and RGB(A) fields, theme swatches and the colours picked recently. Keyboard: arrows on the square (Shift for
 * bigger steps) and on the sliders.
 */
export function ColorPicker({ value, onChange, alpha = true, swatches = THEME_SWATCHES }: { value: string; onChange: (hex: string) => void; alpha?: boolean; swatches?: string[] }) {
  const rgba = parseHex(value) ?? { r: 224, g: 189, b: 106, a: 1 };
  // Keep hue and saturation while they are undefined in RGB (greys, black), so dragging through them does not jump.
  const [hsv, setHsv] = useState(() => rgbToHsv(rgba));
  const own = useRef(value);
  useEffect(() => {
    if (value !== own.current) { own.current = value; setHsv(rgbToHsv(parseHex(value) ?? rgba)); }
  }, [value]);
  const [hex, setHexText] = useState(value);
  useEffect(() => setHexText(value), [value]);
  const [recent] = useState(recentColours);
  const emit = (next: { h: number; s: number; v: number }, a = rgba.a) => {
    setHsv(next);
    const out = toHex(hsvToRgb(next.h, next.s, next.v, alpha ? a : 1));
    own.current = out;
    onChange(out);
  };
  const setRgba = (c: Rgba) => {
    const out = toHex({ ...c, a: alpha ? c.a : 1 });
    own.current = out;
    setHsv((old) => { const n = rgbToHsv(c); return n.s === 0 || n.v === 0 ? { ...old, s: n.s, v: n.v } : n; });
    onChange(out);
  };
  const svKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const ds = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
    const dv = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
    if (!ds && !dv) return;
    e.preventDefault();
    emit({ ...hsv, s: clamp(hsv.s + ds), v: clamp(hsv.v + dv) });
  };
  const angle = hsv.h * 360;
  const pure = toHex(hsvToRgb(hsv.h, 1, 1));
  const solid = toHex({ ...rgba, a: 1 });
  const rgbField = (k: 'r' | 'g' | 'b', label: string) => (
    <label class="cp-num">
      <span>{label}</span>
      <input type="number" min={0} max={255} step={1} value={rgba[k]} aria-label={`${label} (0 to 255)`}
        onInput={(e) => { const n = Number(e.currentTarget.value); if (Number.isFinite(n)) setRgba({ ...rgba, [k]: clamp(Math.round(n), 0, 255) }); }} />
    </label>
  );
  return (
    <div class="color-picker" onKeyDown={(e) => e.key === 'Escape' || e.stopPropagation()}>
      <div class="cp-square" style={{ '--hue': pure }} onPointerDown={(e) => drag(e, (x, y) => emit({ ...hsv, s: clamp(x), v: clamp(1 - y) }))}>
        <span class="cp-square-knob" role="slider" tabIndex={0} aria-label="Saturation and brightness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.v * 100)}
          aria-valuetext={`saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: solid }} onKeyDown={svKey} />
      </div>
      <label class="cp-hue">
        <span class="field-label">Hue</span>
        <input type="range" min={0} max={359} step={1} value={Math.round(angle)} aria-valuetext={`${Math.round(angle)} degrees`} style={{ '--knob': pure }}
          onInput={(e) => emit({ ...hsv, h: Number(e.currentTarget.value) / 360 })} />
      </label>
      {alpha && (
        <label class="cp-alpha">
          <span class="field-label">Opacity</span>
          <input type="range" min={0} max={100} step={1} value={Math.round(rgba.a * 100)} aria-valuetext={`${Math.round(rgba.a * 100)}%`} style={{ '--solid': solid }}
            onInput={(e) => setRgba({ ...rgba, a: Number(e.currentTarget.value) / 100 })} />
        </label>
      )}
      <div class="cp-fields">
        <span class="cp-preview" aria-hidden="true"><span style={{ background: value }} /></span>
        <label class="cp-hex">
          <span>Hex</span>
          <input type="text" value={hex} spellcheck={false} maxLength={9} aria-label="Hex colour"
            onInput={(e) => { const t = e.currentTarget.value.trim(); setHexText(t); const c = parseHex(t.startsWith('#') ? t : `#${t}`); if (c) setRgba(c); }} />
        </label>
        {rgbField('r', 'R')}
        {rgbField('g', 'G')}
        {rgbField('b', 'B')}
        {alpha && (
          <label class="cp-num">
            <span>A</span>
            <input type="number" min={0} max={100} step={1} value={Math.round(rgba.a * 100)} aria-label="Opacity percent"
              onInput={(e) => { const n = Number(e.currentTarget.value); if (Number.isFinite(n)) setRgba({ ...rgba, a: clamp(n / 100) }); }} />
          </label>
        )}
      </div>
      <Swatches title="Theme" colours={swatches} value={value} onPick={(c) => setRgba(parseHex(c)!)} />
      {recent.length > 0 && <Swatches title="Recent" colours={recent} value={value} onPick={(c) => setRgba(parseHex(c)!)} />}
    </div>
  );
}

function Swatches({ title, colours, value, onPick }: { title: string; colours: string[]; value: string; onPick: (c: string) => void }) {
  return (
    <div class="cp-swatches" role="group" aria-label={`${title} colours`}>
      <span class="field-label">{title}</span>
      <div>
        {colours.map((c) => <button key={c} type="button" class="swatch" aria-pressed={c.toLowerCase() === value.toLowerCase()} aria-label={`${title} colour ${c}`} title={c} onClick={() => onPick(c)}><span style={{ background: c }} /></button>)}
      </div>
    </div>
  );
}

/**
 * A labelled colour button that opens the picker in a popover. Used for card pictures, covers and the new-book dialog.
 * Every change applies at once; a click outside, Escape or the button again closes it. The colour is remembered under
 * "Recent" when the popover closes.
 */
export function ColorField({ label, value, onChange, alpha = true, swatches, class: cls }: { label: string; value: string; onChange: (hex: string) => void; alpha?: boolean; swatches?: string[]; class?: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = (focus = true) => {
    setOpen(false);
    remember(value);
    if (focus) button.current?.focus();
  };
  return (
    <div class={`color-field${cls ? ` ${cls}` : ''}`}>
      <span class="field-label">{label}</span>
      <button ref={button} type="button" class="color-button" aria-expanded={open} aria-haspopup="dialog" onClick={() => (open ? close() : setOpen(true))}>
        <span class="cp-preview" aria-hidden="true"><span style={{ background: value }} /></span>
        <span class="color-hex">{value}</span>
        <span class="sr-only">, change {label.toLowerCase()}</span>
      </button>
      {open && (
        <Popover anchor={button} class="color-popover" role="dialog" aria-label={label} onClose={(why) => close(why === 'escape')}>
          <ColorPicker value={value} onChange={onChange} alpha={alpha} {...(swatches ? { swatches } : {})} />
        </Popover>
      )}
    </div>
  );
}
