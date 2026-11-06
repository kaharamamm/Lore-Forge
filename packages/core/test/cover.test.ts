import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUNDLED_FONTS, bundledFont, cleanCoverSettings, COVER_SAFE, coverArt, coverPosition, emblemBox, placeOnCover, hslHex, hsvToRgb, luminance, parseHex, rgbToHsv, splitAlpha, spineInkFor, toHex, worldCoverArt } from '@lore-forge/core';
import { world } from './helpers.ts';

const ratio = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]; return (x + 0.05) / (y + 0.05); };

test('colours: hex with and without alpha, HSV round trip', () => {
  assert.deepEqual(parseHex('#336699'), { r: 51, g: 102, b: 153, a: 1 });
  assert.equal(parseHex('#336699cc')?.a, 0.8);
  assert.equal(parseHex('#3369'), null);
  assert.equal(toHex({ r: 51, g: 102, b: 153, a: 1 }), '#336699');
  assert.equal(toHex({ r: 51, g: 102, b: 153, a: 0.8 }), '#336699cc');
  assert.deepEqual(splitAlpha('#336699cc'), ['#336699', 0.8]);
  const hsv = rgbToHsv(parseHex('#c0392b')!);
  assert.equal(toHex(hsvToRgb(hsv.h, hsv.s, hsv.v)), '#c0392b');
});

test('cover art: generated from the world id, chosen settings win, pictures can be turned off', () => {
  const a = coverArt('w1');
  assert.deepEqual(coverArt('w1'), a, 'the same world always gets the same cover');
  assert.ok(a.icon && a.titleStyle === 'display' && a.stars.length > 0);
  const b = coverArt('w1', { color: '#336699', color2: '#336699', icon: 'none', titleStyle: 'serif', titleColor: '#ffcc00', image: 'none' }, 'images/x.png');
  assert.equal(b.top, '#336699');
  assert.equal(b.bottom, '#336699', 'plain colour');
  assert.equal(b.icon, null);
  assert.equal(b.titleStyle, 'serif');
  assert.equal(b.titleColor, '#ffcc00');
  assert.equal(b.image, undefined);
  assert.equal(coverArt('w1', {}, 'images/x.png').image, 'images/x.png', 'the world picture is the fallback');
  assert.equal(coverArt('w1', { image: 'images/cover-a.png' }, 'images/x.png').imageOpacity, 0.9);
  assert.equal(coverArt('w1', { icon: 'not-an-icon', titleStyle: 'gothic' as never }).titleStyle, 'display', 'unknown values fall back');
  assert.ok(worldCoverArt(world([])).icon);
});

test('cover art: the spine title is readable on any cover colour', () => {
  for (let h = 0; h < 360; h += 30) for (const l of [5, 20, 35, 50, 65, 80, 95]) {
    const art = coverArt('x', { color: hslHex(h, 60, l) });
    assert.ok(ratio(art.spineInk, art.spine) >= 4, `${art.spineInk} on ${art.spine}: ${ratio(art.spineInk, art.spine).toFixed(2)}`);
  }
});

test('cover switches, spine from the picture edge, overrides and font', () => {
  const plain = coverArt('w', {});
  assert.equal(plain.showTitle, true);
  assert.equal(plain.showEmblem, true);
  assert.equal(plain.font, undefined);
  const off = coverArt('w', { showTitle: false, showEmblem: false, font: ' Pirata One ' });
  assert.equal(off.showTitle, false);
  assert.equal(off.showEmblem, false);
  assert.ok(off.icon, 'the emblem stays for the spine');
  assert.equal(off.font, 'Pirata One');
  // The picture's left edge sets the spine, but only when there is a picture; a chosen spine colour wins.
  assert.equal(coverArt('w', { image: 'images/a.png' }, undefined, '#d0c090').spine, '#d0c090');
  assert.equal(coverArt('w', { image: 'none' }, 'images/b.png', '#d0c090').spine, plain.spine);
  assert.equal(coverArt('w', { image: 'images/a.png', spineColor: '#112233' }, undefined, '#d0c090').spine, '#112233');
  // Spine lettering stays readable (4:1 or better) on any spine, unless one is chosen.
  const ratio = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]; return (x + 0.05) / (y + 0.05); };
  for (let v = 0; v <= 255; v += 5) {
    const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`;
    assert.ok(ratio(hex, spineInkFor(hex)) >= 4, `${hex} on ${spineInkFor(hex)}`);
  }
  assert.equal(coverArt('w', { spineInk: '#ff0000' }).spineInk, '#ff0000');
});

test('bundled cover fonts', () => {
  assert.equal(BUNDLED_FONTS.length, 16);
  assert.equal(bundledFont('liberation serif')?.source, 'liberation');
  assert.equal(bundledFont('Comic Sans'), undefined);
});

test('cover positions: clamped to 0..100, broken ones ignored, the default places without them', () => {
  assert.deepEqual(coverPosition({ x: 140, y: -20 }), { x: 100, y: 0 });
  assert.deepEqual(coverPosition({ x: 33.333, y: 50 }), { x: 33.3, y: 50 });
  for (const bad of [null, 'x', { x: 1 }, { x: '5', y: 5 }, { x: NaN, y: 1 }, { x: 1, y: Infinity }]) assert.equal(coverPosition(bad), undefined, JSON.stringify(bad));
  const plain = coverArt('w1');
  assert.ok(!('titlePos' in plain) && !('emblemPos' in plain), 'old world.json files keep the default places');
  assert.deepEqual(emblemBox(plain), { x: 84, y: 70, size: 72 });
  const art = coverArt('w1', { titlePos: { x: 0, y: 100 }, emblemPos: { x: 250, y: -3 } });
  assert.deepEqual(art.titlePos, { x: 0, y: 100 });
  assert.deepEqual(art.emblemPos, { x: 100, y: 0 });
});

test('cover positions: the title and the emblem never leave the frame, whatever their size and the page shape', () => {
  // The 240 x 320 canvas, an A4 PDF page and a 6x9 print page.
  for (const [W, H] of [[240, 320], [595.28, 841.89], [432, 648]] as const) {
    const k = W / 240;
    const safe = { left: COVER_SAFE.left * k, top: COVER_SAFE.top * k, right: W - COVER_SAFE.left * k, bottom: H - COVER_SAFE.top * k };
    for (const [w, h] of [[72 * k, 72 * k], [184 * k, 30 * k], [10, 10], [W, H * 2]] as const) {
      for (const x of [-50, 0, 25, 50, 99.9, 100, 400]) for (const y of [-50, 0, 50, 100, 400]) {
        const p = placeOnCover({ x, y }, w, h, W, H);
        const fitsW = w <= safe.right - safe.left, fitsH = h <= safe.bottom - safe.top;
        // Inside the room when it fits; centred on it when it is bigger than the room.
        if (fitsW) assert.ok(p.x >= safe.left - 1e-9 && p.x + w <= safe.right + 1e-9, `x ${x} on ${W}x${H}: ${p.x}+${w}`);
        else assert.ok(Math.abs(p.x + w / 2 - W / 2) < 1e-9);
        if (fitsH) assert.ok(p.y >= safe.top - 1e-9 && p.y + h <= safe.bottom + 1e-9, `y ${y} on ${W}x${H}: ${p.y}+${h}`);
        else assert.ok(Math.abs(p.y + h / 2 - H / 2) < 1e-9);
      }
    }
  }
  // Corners: 0 and 100 put the emblem's edges on the safe margins of the canvas.
  assert.deepEqual(emblemBox({ emblemPos: { x: 0, y: 0 } }), { x: 22, y: 22, size: 72 });
  assert.deepEqual(emblemBox({ emblemPos: { x: 100, y: 100 } }), { x: 218 - 72, y: 298 - 72, size: 72 });
});

test('cover positions: saved to world.json as two clamped numbers, next to the other settings', () => {
  const saved = cleanCoverSettings({ color: '#336699', icon: '', showTitle: true, showEmblem: false, titlePos: { x: 12.345, y: 140 }, emblemPos: { x: 'a' } as never });
  assert.deepEqual(saved, { color: '#336699', showEmblem: false, titlePos: { x: 12.3, y: 100 } });
  // Round trip through JSON, as world.json does.
  const back = coverArt('w1', JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(back.titlePos, { x: 12.3, y: 100 });
  assert.equal(back.emblemPos, undefined);
});
