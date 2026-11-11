/** The audiobook: what is said and where it pauses, and the Ogg Opus file it is saved as. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorld } from '@lore-forge/core';
import { audiobookScript, chapterSaid } from '../src/renderer/audiobook.ts';
import { chapterComments, lacing, oggCrc, OggOpusWriter, opusTags, pictureComment, timeStamp } from '../src/main/ogg-opus.ts';

const book = (author?: string) => parseWorld([
  { path: 'world.json', content: JSON.stringify({ schemaVersion: 1, id: 'wells', name: 'The Wells', calendar: { eras: [{ id: 'OK', name: 'Old Kingdom', start: 0 }], defaultEra: 'OK' }, book: { title: 'The Singing Well', ...(author ? { author } : {}) } }) },
  { path: 'characters/char-nur.md', content: '---\nid: char-nur\ntype: character\nname: Nur\n---\n' },
  { path: 'story/01-the-well.md', content: '---\ntitle: The Well\norder: 1\n---\n\nThe well was quiet. [[char-nur|The girl]] listened.\nShe waited.\n\nMorning came.\n\n* * *\n\nNight fell on @char-nur.\n' },
  { path: 'story/02-chapter-2.md', content: '---\ntitle: Chapter 2\norder: 2\n---\n\nThe end.\n' },
  { path: 'story/03-plans.md', content: '---\ntitle: Plans\norder: 3\nstatus: idea\n---\n\n' },
]);
const nameOf = (ref: string) => (ref === 'char-nur' ? 'Nur' : ref);

test('the audiobook says the title and author, then each written chapter with its heading', () => {
  const s = audiobookScript(book('Ayla Demir'), 'en', nameOf);
  assert.deepEqual(s.opening.map((x) => [x.text, x.pause]), [['The Singing Well.', 1], ['By Ayla Demir.', 2.5]]);
  // The chapter still to write is left out; a chapter titled only "Chapter 2" is just its number.
  assert.deepEqual(s.chapters.map((c) => c.title), ['Chapter 1. The Well', 'Chapter 2']);
  assert.deepEqual(s.chapters[0]!.said.map((x) => [x.text, x.pause]), [
    ['Chapter 1. The Well.', 1.3],
    ['The well was quiet. The girl listened. She waited.', 0.7],
    ['Morning came.', 1.5],
    ['Night fell on Nur.', 2.5],
  ]);
  assert.equal(s.words, 3 + 2 + 15 + 2);
  // In Turkish, the headings are Turkish too.
  const tr = audiobookScript(book('Ayla Demir'), 'tr', nameOf);
  assert.deepEqual([tr.opening[1]!.text, tr.chapters[0]!.said[0]!.text, tr.chapters[1]!.title], ['Yazan: Ayla Demir.', 'Bölüm 1. The Well.', 'Bölüm 2']);
  assert.equal(audiobookScript(book(), 'en', nameOf).opening.length, 1);
});

test('long paragraphs are said a few sentences at a time', () => {
  const sentence = 'The caravan crossed the long white dunes under a hard and patient sun. ';
  const said = chapterSaid(sentence.repeat(12).trim(), nameOf);
  assert.ok(said.length >= 3, `${said.length} pieces`);
  assert.ok(said.every((s) => s.text.length <= 320));
  assert.deepEqual(said.slice(0, -1).map((s) => s.pause), said.slice(0, -1).map(() => 0.3));
});

test('Ogg pieces: the checksum is Ogg\'s, lacing, times and chapter marks', () => {
  // The first entries of libogg's checksum table.
  assert.deepEqual([1, 2, 4, 255].map((b) => oggCrc(new Uint8Array([b])).toString(16)), ['4c11db7', '9823b6e', '130476dc', 'b1f740b4']);
  assert.deepEqual([0, 254, 255, 600].map(lacing), [[0], [254], [255, 0], [255, 255, 90]]);
  assert.equal(timeStamp(3723.45), '01:02:03.450');
  assert.equal(timeStamp(0), '00:00:00.000');
  assert.deepEqual(chapterComments([{ title: 'The Singing Well', start: 0 }, { title: 'Chapter 1.\nThe Well', start: 6.5 }]), [
    'CHAPTER001=00:00:00.000', 'CHAPTER001NAME=The Singing Well', 'CHAPTER002=00:00:06.500', 'CHAPTER002NAME=Chapter 1. The Well',
  ]);
  const picture = Buffer.from(pictureComment('image/jpeg', new Uint8Array([1, 2, 3]), 800, 1200).split('=')[1]!, 'base64');
  assert.equal(picture.readUInt32BE(0), 3);
  assert.equal(picture.subarray(8, 18).toString(), 'image/jpeg');
  assert.deepEqual([...picture.subarray(-3)], [1, 2, 3]);
});

/** The pages of an Ogg stream, checked, and the packets they carry. */
function readOgg(bytes: Uint8Array) {
  const pages: { flags: number; granule: bigint; seq: number }[] = [];
  const packets: Uint8Array[] = [];
  let open: number[] = [];
  let at = 0;
  while (at < bytes.length) {
    const v = new DataView(bytes.buffer, bytes.byteOffset + at);
    assert.equal(Buffer.from(bytes.subarray(at, at + 4)).toString(), 'OggS');
    const count = bytes[at + 26]!;
    const lace = [...bytes.subarray(at + 27, at + 27 + count)];
    const size = 27 + count + lace.reduce((n, x) => n + x, 0);
    const page = new Uint8Array(bytes.subarray(at, at + size));
    const crc = new DataView(page.buffer).getUint32(22, true);
    page.fill(0, 22, 26);
    assert.equal(oggCrc(page), crc, `page ${pages.length} checksum`);
    pages.push({ flags: bytes[at + 5]!, granule: v.getBigInt64(6, true), seq: v.getUint32(18, true) });
    let data = at + 27 + count;
    for (const l of lace) {
      open.push(...bytes.subarray(data, data + l));
      data += l;
      if (l < 255) {
        packets.push(new Uint8Array(open));
        open = [];
      }
    }
    at += size;
  }
  return { pages, packets };
}

test('the Ogg Opus writer: headers on pages of their own, about a second of audio a page, the end trimmed', async () => {
  const out: Uint8Array[] = [];
  const w = new OggOpusWriter(0x1234, (p) => { out.push(p); });
  const head = new Uint8Array(19);
  head.set(Buffer.from('OpusHead'));
  // A comment header too long for one page, as with a cover.
  const tags = opusTags('Lore-Forge', ['TITLE=The Singing Well', `METADATA_BLOCK_PICTURE=${'A'.repeat(70000)}`]);
  await w.headers(head, tags);
  const packets = Array.from({ length: 120 }, (_, i) => new Uint8Array(80 + (i % 7)).fill(i));
  for (const p of packets) await w.packet(p, 960);
  await w.finish(BigInt(312 + 115 * 960));
  const { pages, packets: read } = readOgg(Buffer.concat(out));
  assert.deepEqual(read[0], head);
  assert.deepEqual(read[1], tags);
  assert.deepEqual(read.slice(2), packets);
  assert.deepEqual(pages.map((p) => p.seq), pages.map((_, i) => i));
  // The identification header: the first page, alone. The comment header: two pages, the first with no granule.
  assert.deepEqual(pages.slice(0, 3).map((p) => [p.flags, p.granule]), [[2, 0n], [0, -1n], [1, 0n]]);
  // Audio: 50 packets of 20 ms a page, the last page marked the end and trimmed to the sound.
  assert.deepEqual(pages.slice(3).map((p) => [p.flags, p.granule]), [[0, 48000n], [0, 96000n], [4, BigInt(312 + 115 * 960)]]);
});
