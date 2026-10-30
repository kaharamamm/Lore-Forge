import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUNDLED_FONTS, bundledFont, coverArt, hslHex, hsvToRgb, luminance, parseHex, rgbToHsv, splitAlpha, spineInkFor, toHex, worldCoverArt } from '@lore-forge/core';
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
