import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoZoom, cleanDisplay, DEFAULT_DISPLAY, fitPage, fits, maximizedPage, percent, RESOLUTIONS, resolutionIndex, roomFor, sizeLabel, stepScale, storedDisplay, zoomFor } from '../src/shared/display.ts';

const size = (width: number, height: number) => ({ width, height });
/** Windows 11 at 100%: 8 px borders on each side, a 31 px title bar. */
const FRAME = size(16, 39);

test('Auto keeps the 1920 x 1080 proportions: 100% there, 133% on 2K, 200% on 4K', () => {
  assert.equal(autoZoom(size(1920, 1080)), 1);
  assert.equal(percent(autoZoom(size(2560, 1440))), '133%');
  assert.equal(autoZoom(size(2560, 1440)) * 1080, 1440, 'a 2K page shows the 1920 x 1080 layout exactly');
  assert.equal(autoZoom(size(3840, 2160)), 2);
  assert.equal(autoZoom(size(1600, 900)) * 1920, 1600, '1600 x 900 shows the 1920 x 1080 layout exactly');
});

test('a maximized window keeps the full-screen zoom: the title bar and taskbar do not shrink it', () => {
  assert.equal(autoZoom(size(1920, 1009)), 1, 'maximized on a 1920 x 1080 screen');
  assert.equal(percent(autoZoom(size(2560, 1369))), '133%', 'maximized on a 2560 x 1440 screen');
  assert.equal(autoZoom(size(3840, 2089)), 2, 'maximized on a 4K screen');
  assert.deepEqual(maximizedPage(size(2560, 1392), FRAME), size(2560, 1369));
  assert.deepEqual(maximizedPage(size(1920, 1032), FRAME), size(1920, 1009));
});

test('Auto stays readable in small windows and never runs away on huge or odd ones', () => {
  assert.equal(autoZoom(size(1280, 720)), 0.8);
  assert.equal(autoZoom(size(1366, 768)), 0.8);
  assert.equal(autoZoom(size(800, 480)), 0.8);
  assert.equal(autoZoom(size(7680, 4320)), 2);
  assert.equal(autoZoom(size(0, 0)), 1);
  assert.equal(autoZoom(size(Number.NaN, 900)), 1);
  // A wide, short window follows its height; steps are 5% (or a listed size's exact ratio).
  assert.equal(autoZoom(size(3440, 1369)), 1.35);
  assert.equal(autoZoom(size(2200, 1300)), 1.15);
  for (let w = 800; w <= 4000; w += 37) {
    const z = autoZoom(size(w, Math.round((w * 9) / 16)));
    assert.ok(z >= 0.8 && z <= 2, `${w}: ${z}`);
    assert.ok(Math.abs(z * 20 - Math.round(z * 20)) < 1e-9 || RESOLUTIONS.some((r) => Math.abs(r.width / 1920 - z) < 1e-9), `${w}: ${z} is a step`);
  }
});

test('a fixed scale is used as it is; Auto follows the page', () => {
  assert.equal(zoomFor(1.25, size(1280, 720)), 1.25);
  assert.equal(zoomFor('auto', size(1280, 720)), 0.8);
  assert.equal(zoomFor('auto', size(1920, 1080)), 1);
});

test('only sizes that fit the screen can be picked; Full HD needs full screen on a 1920 x 1080 screen', () => {
  const room1080 = roomFor(size(1920, 1032), FRAME);
  assert.deepEqual(room1080, size(1904, 993));
  assert.deepEqual(RESOLUTIONS.filter((r) => fits(r, room1080)).map(sizeLabel), ['1280 × 720', '1366 × 768', '1600 × 900']);
  const room2k = roomFor(size(2560, 1392), FRAME);
  assert.deepEqual(RESOLUTIONS.filter((r) => fits(r, room2k)).map(sizeLabel), ['1280 × 720', '1366 × 768', '1600 × 900', '1920 × 1080']);
  assert.ok(fits(size(1906, 994), room1080), 'a pixel or two over still fits');
  // A saved size too big for this screen, or below the window's minimum, is brought within both.
  assert.deepEqual(fitPage(size(2560, 1440), room1080), size(1904, 993));
  assert.deepEqual(fitPage(size(300, 200), room1080), size(800, 480));
});

test('a size within a pixel or two of a listed one is that one; any other is the user\'s own', () => {
  assert.equal(resolutionIndex(size(1280, 720)), 0);
  assert.equal(resolutionIndex(size(1279, 721)), 0);
  assert.equal(resolutionIndex(size(2560, 1440)), 4);
  assert.equal(resolutionIndex(size(1500, 900)), -1);
});

test('settings.json: bad values fall back to the defaults, good ones are kept', () => {
  assert.deepEqual(cleanDisplay(undefined), DEFAULT_DISPLAY);
  assert.deepEqual(cleanDisplay('fullscreen'), DEFAULT_DISPLAY);
  assert.deepEqual(cleanDisplay({ mode: 'fullscreen', width: 1280, height: 720, scale: 1.25 }), { mode: 'fullscreen', width: 1280, height: 720, scale: 1.25 });
  assert.deepEqual(cleanDisplay({ mode: 'kiosk', width: '1280', height: 720, scale: 3 }), DEFAULT_DISPLAY);
  assert.deepEqual(cleanDisplay({ width: 1500.4, height: 899.6 }), { ...DEFAULT_DISPLAY, width: 1500, height: 900 });
  assert.deepEqual(cleanDisplay({ width: 640, height: 900 }), DEFAULT_DISPLAY, 'below the minimum window, both fall back');
  assert.deepEqual(cleanDisplay({ width: 1e9, height: 900 }), DEFAULT_DISPLAY);
  assert.deepEqual(cleanDisplay({ scale: Number.NaN }), DEFAULT_DISPLAY);
  assert.equal(cleanDisplay({ scale: 0.9 }).scale, 0.9);
  assert.equal(cleanDisplay({ scale: 'auto' }).scale, 'auto');
});

test('settings.json keeps only what differs from the defaults (maximized, 1920 x 1080, Auto)', () => {
  assert.equal(storedDisplay(DEFAULT_DISPLAY), undefined);
  assert.equal(storedDisplay(undefined), undefined);
  assert.deepEqual(storedDisplay({ ...DEFAULT_DISPLAY, mode: 'fullscreen' }), { mode: 'fullscreen' });
  assert.deepEqual(storedDisplay({ mode: 'windowed', width: 1280, height: 720, scale: 'auto' }), { mode: 'windowed', width: 1280, height: 720 });
  assert.deepEqual(storedDisplay({ ...DEFAULT_DISPLAY, scale: 1.1 }), { scale: 1.1 });
  assert.deepEqual(storedDisplay({ ...DEFAULT_DISPLAY, scale: 7 }), undefined, 'a bad value is not stored');
});

test('Ctrl+Plus and Ctrl+Minus step through the fixed scales from the zoom in use, and stop at the ends', () => {
  assert.equal(stepScale(1, 1), 1.1);
  assert.equal(stepScale(1, -1), 0.9);
  assert.equal(stepScale(4 / 3, 1), 1.5, 'from Auto on 2K');
  assert.equal(stepScale(4 / 3, -1), 1.25);
  assert.equal(stepScale(0.85, -1), 0.8);
  assert.equal(stepScale(1.5, 1), null);
  assert.equal(stepScale(2, 1), null, 'Auto on 4K is already larger than any fixed scale');
  assert.equal(stepScale(2, -1), 1.5);
  assert.equal(stepScale(0.8, -1), null);
});
