import { screen, type BrowserWindow, type Display } from 'electron';
import { cleanDisplay, fitPage, maximizedPage, roomFor, sameSize, stepScale, zoomFor, type DisplaySettings, type DisplayState, type Size, type WindowMode } from '../shared/display.ts';

/**
 * Window events settle this long before the zoom, the saved settings and the dialog follow them: dragging a window
 * edge sends dozens of resize events, and each one only restarts this timer.
 */
const SETTLE_MS = 150;
/** The frame (outer size less page size) of a window not made yet, as on Windows 11: 8 px borders and a 31 px title bar. */
const FRAME_GUESS: Size = { width: 16, height: 39 };

export interface WindowDisplay {
  /** The settings and the window and screen they apply to, for Settings. */
  state(): DisplayState;
  /** Changes the settings: applied to the window at once, and saved. */
  set(patch: Partial<DisplaySettings>): DisplayState;
  /** Shows the window the first time, in its mode: it is made hidden, at its windowed size. */
  show(): void;
}

/** Size options for a new window with these settings: its windowed page (BrowserWindow useContentSize), fitted to the main screen. */
export function windowSize(d: DisplaySettings): { width: number; height: number; useContentSize: true } {
  return { ...fitPage(d, roomFor(screen.getPrimaryDisplay().workAreaSize, FRAME_GUESS)), useContentSize: true };
}

/**
 * Display settings for one window (see shared/display.ts). The window is the truth: when it is maximized, restored,
 * resized or put in full screen (by the title bar, Windows Snap, F11 or Settings), its mode and windowed page
 * size become the settings and are saved, so it opens the same way next time. The interface scale is the page zoom
 * (webContents.setZoomFactor), set again only when it changes. F11 toggles full screen (Esc does not: it closes
 * dialogs); Ctrl+Plus and Ctrl+Minus step the scale and Ctrl+0 is Auto, in place of the hidden menu's own zoom keys.
 */
export function attachDisplay(win: BrowserWindow, initial: DisplaySettings, on: { save: (d: DisplaySettings) => void; changed: (s: DisplayState) => void }): WindowDisplay {
  let cur = cleanDisplay(initial);
  // The page it was made with (hiding the menu bar since then made the page taller), then the frame, measured while
  // the window is hidden at its windowed size.
  const made = windowSize(cur);
  win.setContentSize(made.width, made.height);
  win.center();
  const [ow = 0, oh = 0] = win.getSize(), [cw = 0, ch = 0] = win.getContentSize();
  const frame: Size = { width: Math.max(0, ow - cw), height: Math.max(0, oh - ch) };
  let shown = false;
  /** Where F11 goes back to from full screen (maximized when the app opened in full screen). */
  let back: WindowMode = cur.mode === 'fullscreen' ? 'maximized' : cur.mode;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sent = '';

  const display = (): Display => screen.getDisplayMatching(win.getBounds());
  const page = (): Size => {
    const [width = 0, height = 0] = win.getContentSize();
    return { width, height };
  };
  const modeNow = (): WindowMode => (win.isFullScreen() ? 'fullscreen' : win.isMaximized() ? 'maximized' : 'windowed');
  /** The window's page; before it is first shown, the page it is about to get in its mode. */
  const expected = (): Size => {
    if (shown) return page();
    const d = display();
    return cur.mode === 'fullscreen' ? d.size : cur.mode === 'maximized' ? maximizedPage(d.workAreaSize, frame) : page();
  };
  const applyZoom = (): void => {
    if (win.isDestroyed()) return;
    const z = zoomFor(cur.scale, expected());
    if (Math.abs(win.webContents.getZoomFactor() - z) > 0.001) win.webContents.setZoomFactor(z);
  };
  const state = (): DisplayState => {
    const d = display();
    return { settings: { ...cur }, page: page(), zoom: win.webContents.getZoomFactor(), room: roomFor(d.workAreaSize, frame), screen: { width: d.size.width, height: d.size.height } };
  };
  const tell = (s = state()): DisplayState => {
    const key = JSON.stringify(s);
    if (key !== sent) {
      sent = key;
      on.changed(s);
    }
    return s;
  };
  /** Once window events settle: the window's mode and windowed size become the settings, and the zoom follows the page. */
  const settle = (): void => {
    timer = undefined;
    if (win.isDestroyed() || !shown || win.isMinimized()) return;
    const mode = modeNow();
    let next = cur;
    if (mode !== cur.mode) next = { ...next, mode };
    if (mode === 'windowed' && !sameSize(page(), cur)) next = { ...next, ...page() };
    if (mode !== 'fullscreen') back = mode;
    if (next !== cur) {
      cur = next;
      on.save(cur);
    }
    applyZoom();
    tell();
  };
  const later = (): void => {
    clearTimeout(timer);
    timer = setTimeout(settle, SETTLE_MS);
  };
  win.on('resize', later);
  win.on('maximize', later);
  win.on('unmaximize', later);
  win.on('enter-full-screen', later);
  win.on('leave-full-screen', later);
  win.on('restore', later);
  // Another screen may have another work area (which sizes fit).
  win.on('moved', later);
  win.on('closed', () => clearTimeout(timer));
  // The zoom belongs to the page: set it as each page load commits (the first one before anything is drawn).
  win.webContents.on('did-navigate', applyZoom);

  /** Puts the window in the settings' mode; in a window, at their page size (centred on its screen when that changes). */
  const apply = (resize: boolean): void => {
    if (cur.mode === 'fullscreen') {
      if (!win.isFullScreen()) win.setFullScreen(true);
      return;
    }
    // Leaving full screen, Windows brings back the maximized state the window had before.
    if (win.isFullScreen()) win.setFullScreen(false);
    if (cur.mode === 'maximized') {
      if (!win.isMaximized()) win.maximize();
      return;
    }
    if (win.isMaximized()) win.unmaximize();
    if (resize || !sameSize(page(), cur)) {
      win.setContentSize(cur.width, cur.height);
      win.center();
    }
  };

  const set = (patch: Partial<DisplaySettings>): DisplayState => {
    const sized = patch.width !== undefined || patch.height !== undefined;
    let next = cleanDisplay({ ...cur, ...patch });
    // A window always fits its screen (the default 1920 x 1080 does not fit a 1920 x 1080 screen with a title bar).
    if (next.mode === 'windowed') next = { ...next, ...fitPage(next, state().room) };
    if (next.mode === 'fullscreen' && cur.mode !== 'fullscreen') back = cur.mode;
    cur = next;
    on.save(cur);
    if (shown) {
      apply(sized);
      applyZoom();
      later();
    }
    return tell();
  };

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' && !input.control && !input.alt && !input.meta && !input.shift) {
      e.preventDefault();
      if (!input.isAutoRepeat) set({ mode: win.isFullScreen() ? back : 'fullscreen' });
      return;
    }
    // Ctrl (Cmd) with + - 0, not AltGr (Ctrl+Alt), which types characters on many keyboards.
    if (!(input.control || input.meta) || input.alt) return;
    const up = input.key === '+' || input.key === '=';
    const down = input.key === '-';
    const reset = !input.shift && (input.key === '0' || input.code === 'Digit0' || input.code === 'Numpad0');
    if (!up && !down && !reset) return;
    e.preventDefault();
    if (reset) {
      if (cur.scale !== 'auto') set({ scale: 'auto' });
      return;
    }
    const z = stepScale(win.webContents.getZoomFactor(), up ? 1 : -1);
    if (z !== null) set({ scale: z });
  });

  return {
    state,
    set,
    show() {
      if (cur.mode === 'fullscreen') win.setFullScreen(true);
      else if (cur.mode === 'maximized') win.maximize();
      win.show();
      shown = true;
      applyZoom();
      later();
    },
  };
}
