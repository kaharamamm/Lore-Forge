import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { worldCodex } from '@lore-forge/core';
import { loadWorld } from '@lore-forge/core/node';
import { gifFirstFrame, gifToPng, readPicture, renderPdf, renderDocx } from '@lore-forge/pdf';

/** GIFs made with Pillow, each with the SHA-1 of Pillow's RGBA for its first frame (transparent pixels as 0,0,0,0). */
const cases = JSON.parse(readFileSync(new URL('./fixtures/gif-cases.json', import.meta.url), 'utf8')) as Record<string, { b64: string; w: number; h: number; sha1: string }>;
const example = join(import.meta.dirname, '..', '..', '..', 'worlds', 'camelamamm');

for (const [name, c] of Object.entries(cases)) {
  test(`GIF first frame: ${name} decodes the way Pillow does`, () => {
    const f = gifFirstFrame(Buffer.from(c.b64, 'base64'));
    assert.ok(f, 'decoded');
    assert.deepEqual([f.width, f.height], [c.w, c.h]);
    assert.equal(createHash('sha1').update(f.rgba).digest('hex'), c.sha1);
  });
}

test('the PNG made from a GIF holds the same pixels', () => {
  const gif = Buffer.from(cases['interlaced']!.b64, 'base64');
  const frame = gifFirstFrame(gif)!;
  const png = gifToPng(gif)!;
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), frame.width);
  assert.equal(png.readUInt32BE(20), frame.height);
  const idat = png.indexOf('IDAT');
  const raw = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
  const row = frame.width * 4 + 1;
  for (let y = 0; y < frame.height; y++) {
    assert.equal(raw[y * row], 0);
    assert.deepEqual([...raw.subarray(y * row + 1, (y + 1) * row)], [...frame.rgba.subarray(y * frame.width * 4, (y + 1) * frame.width * 4)]);
  }
});

test('not a GIF, or a broken one: nothing, no crash', () => {
  assert.equal(gifFirstFrame(Buffer.from('not a gif at all')), undefined);
  const gif = Buffer.from(cases['noise']!.b64, 'base64');
  assert.doesNotThrow(() => gifFirstFrame(gif.subarray(0, gif.length / 2)));
});

test('the exports embed a GIF as its first frame', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lore-gif-'));
  try {
    await writeFile(join(dir, 'anim.gif'), Buffer.from(cases['animated']!.b64, 'base64'));
    const pic = readPicture(join(dir, 'anim.gif'));
    assert.ok('data' in pic && pic.type === 'png');
    assert.deepEqual(readPicture(join(dir, 'nope.gif')), { problem: 'missing' });
    assert.deepEqual(readPicture(join(dir, 'x.webp')), { problem: 'type' });
    // A document whose only picture is the GIF (the world folder is the temporary one, so the cover has no picture).
    const doc = worldCodex(await loadWorld(example));
    doc.blocks = [{ kind: 'image', file: 'anim.gif', caption: 'An animated picture', details: [] }];
    const { pdf } = await renderPdf(doc, { worldDir: dir });
    assert.ok(pdf.includes('/Subtype /Image'), 'the PDF has the picture');
    const docx = await renderDocx(doc, dir);
    const media = Object.keys(unzipSync(new Uint8Array(docx))).filter((f) => f.startsWith('word/media/'));
    assert.ok(media.some((f) => f.endsWith('.png')), `the Word file has the picture as a PNG (${media.join(', ')})`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
