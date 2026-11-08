/**
 * Display settings (Settings, Display): how the window opens (in a window, maximized or full screen), the size
 * of its page in a window, and the interface scale (the page zoom). Pure, so it is tested without Electron
 * (test/display.test.ts); main/display.ts applies it to the window and the Settings dialog shows it.
 * Sizes are page (content) sizes in device-independent pixels: a "1920 × 1080" window shows a 1920 × 1080 page.
 */

export type WindowMode = 'windowed' | 'maximized' | 'fullscreen';
/** 'auto' follows the window's size (autoZoom); a number is one of SCALES, a fixed zoom factor. */
export type InterfaceScale = 'auto' | number;
export interface Size { width: number; height: number }

export interface DisplaySettings {
  mode: WindowMode;
  /** The page size of the window when it is not maximized or full screen. */
  width: number;
  height: number;
  scale: InterfaceScale;
}

/** What the Settings dialog shows: the settings and the window and screen they apply to. */
export interface DisplayState {
  settings: DisplaySettings;
  /** The window's page size now. */
  page: Size;
  /** The page zoom in use now. */
  zoom: number;
  /** The largest page a window fits on the screen the window is on (its work area less the window frame). */
  room: Size;
  /** That screen's size: the page in full screen. */
  screen: Size;
}

/** The size the interface was designed for: a full-screen 1920 × 1080 window. */
export const DESIGN: Size = { width: 1920, height: 1080 };
/**
 * Auto measures the page against this: as wide as the design, and as tall as the page of a maximized window on a
 * 1920 × 1080 screen (about 1010 px under the title bar and the taskbar), so that window stays at 100%.
 */
export const AUTO_BASE: Size = { width: 1920, height: 1000 };
/** Auto never goes below 80% (still readable at 1280 × 720) or above 200% (4K). */
export const AUTO_MIN = 0.8;
export const AUTO_MAX = 2;
/** The smallest page a window can have (the BrowserWindow minimum). */
export const MIN_PAGE: Size = { width: 800, height: 480 };
/** Larger values in settings.json are mistakes, not screens. */
const MAX_PAGE = 16384;
/** Sizes this close (px) count as the same: a page at 125% or 150% Windows scaling can come out a pixel off. */
const SAME_PX = 2;

export const WINDOW_MODES: readonly WindowMode[] = ['windowed', 'maximized', 'fullscreen'];
export const MODE_LABELS: Record<WindowMode, string> = { windowed: 'Windowed', maximized: 'Maximized', fullscreen: 'Full screen' };
export const RESOLUTIONS: readonly Size[] = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
];
export const SCALES: readonly number[] = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
/** What the app does without settings: maximized, the page in the design's proportions. */
export const DEFAULT_DISPLAY: DisplaySettings = { mode: 'maximized', width: DESIGN.width, height: DESIGN.height, scale: 'auto' };

/**
 * Zoom steps Auto snaps to: every 5%, plus the exact ratio of each listed width to the design width (5/6 for
 * 1600 × 900, 4/3 for 2560 × 1440), so those windows show the 1920 × 1080 layout exactly, not a few pixels off.
 */
const EXACT = RESOLUTIONS.map((r) => r.width / DESIGN.width);

/**
 * Auto's zoom for a page: the page measured against the design size (the smaller of width and height), snapped to a
 * step (see EXACT) and kept within 80% to 200%. 1920 × 1080 (or a maximized window on that screen) gives 100%,
 * 2560 × 1440 133%, 3840 × 2160 200%; 1280 × 720 gives 80%, and the responsive styles do the rest.
 */
export function autoZoom(page: Size): number {
  const raw = Math.min(page.width / AUTO_BASE.width, page.height / AUTO_BASE.height);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const r = Math.min(AUTO_MAX, Math.max(AUTO_MIN, raw));
  let best = Math.round(r * 20) / 20;
  for (const e of EXACT) if (Math.abs(e - r) < Math.abs(best - r) - 1e-9) best = e;
  return Math.min(AUTO_MAX, Math.max(AUTO_MIN, best));
}

/** The zoom for a scale setting and a page. */
export const zoomFor = (scale: InterfaceScale, page: Size): number => (scale === 'auto' ? autoZoom(page) : scale);

/** "133%" */
export const percent = (zoom: number): string => `${Math.round(zoom * 100)}%`;
/** "1920 × 1080" */
export const sizeLabel = (s: Size): string => `${Math.round(s.width)} × ${Math.round(s.height)}`;

export const sameSize = (a: Size, b: Size): boolean => Math.abs(a.width - b.width) <= SAME_PX && Math.abs(a.height - b.height) <= SAME_PX;
/** The listed resolution this size is, or -1 for a size of the user's own (a window resized by hand). */
export const resolutionIndex = (s: Size): number => RESOLUTIONS.findIndex((r) => sameSize(r, s));

/** The largest page a window fits in a screen's work area, given the window frame (outer size less page size). */
export const roomFor = (workArea: Size, frame: Size): Size => ({ width: Math.max(0, workArea.width - frame.width), height: Math.max(0, workArea.height - frame.height) });
/** A window with this page fits on the screen (sizes a pixel or two over still count, see sameSize). */
export const fits = (s: Size, room: Size): boolean => s.width <= room.width + SAME_PX && s.height <= room.height + SAME_PX;
/** A page size made to fit: no larger than the room and no smaller than the window's minimum. */
export const fitPage = (s: Size, room: Size): Size => ({
  width: Math.round(Math.max(MIN_PAGE.width, Math.min(s.width, room.width))),
  height: Math.round(Math.max(MIN_PAGE.height, Math.min(s.height, room.height))),
});

/**
 * The page of a maximized window: the whole work area under the title bar. On Windows the frame (outer less page)
 * is the title bar plus a border on each side that a maximized window pushes off the screen.
 */
export const maximizedPage = (workArea: Size, frame: Size): Size => ({ width: workArea.width, height: Math.max(0, workArea.height - Math.max(0, frame.height - frame.width)) });

/** Settings as read from settings.json: anything missing or wrong is the default. */
export function cleanDisplay(raw: unknown): DisplaySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mode = WINDOW_MODES.find((m) => m === r['mode']) ?? DEFAULT_DISPLAY.mode;
  const dim = (v: unknown, min: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= MAX_PAGE ? Math.round(v) : null);
  const width = dim(r['width'], MIN_PAGE.width), height = dim(r['height'], MIN_PAGE.height);
  const size = width !== null && height !== null ? { width, height } : { width: DEFAULT_DISPLAY.width, height: DEFAULT_DISPLAY.height };
  const s = r['scale'];
  const scale = typeof s === 'number' ? (SCALES.find((x) => Math.abs(x - s) < 1e-6) ?? DEFAULT_DISPLAY.scale) : DEFAULT_DISPLAY.scale;
  return { mode, ...size, scale };
}

/** What settings.json keeps: only what differs from the defaults (undefined when nothing does). */
export function storedDisplay(d: unknown): Partial<DisplaySettings> | undefined {
  const c = cleanDisplay(d);
  const out: Partial<DisplaySettings> = {};
  if (c.mode !== DEFAULT_DISPLAY.mode) out.mode = c.mode;
  if (c.width !== DEFAULT_DISPLAY.width || c.height !== DEFAULT_DISPLAY.height) Object.assign(out, { width: c.width, height: c.height });
  if (c.scale !== DEFAULT_DISPLAY.scale) out.scale = c.scale;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Ctrl+Plus and Ctrl+Minus: the next fixed scale up or down from the zoom in use (Auto's included); null past either
 * end, where the scale stays as it is. (Ctrl+0 is Auto.)
 */
export function stepScale(zoom: number, step: 1 | -1): number | null {
  return (step > 0 ? SCALES.find((s) => s > zoom + 0.001) : [...SCALES].reverse().find((s) => s < zoom - 0.001)) ?? null;
}
