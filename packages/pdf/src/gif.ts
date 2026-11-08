/**
 * GIF pictures in the exports. PDF (PDFKit) and Word embed PNG and JPEG only, so a GIF, animated or not, goes in
 * as its first frame, turned into a PNG here. Plain TypeScript and node:zlib, no image library.
 */
import { deflateSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';

export interface Frame {
  width: number;
  height: number;
  /** width × height × 4 bytes, RGBA. */
  rgba: Uint8Array;
}

/** LZW codes of one GIF image into colour indices (at most `count`; missing ones stay 0). */
function lzw(minSize: number, data: Uint8Array, count: number): Uint8Array {
  const out = new Uint8Array(count);
  const clear = 1 << minSize;
  const end = clear + 1;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; }
  let size = minSize + 1;
  let next = end + 1;
  let old = -1;
  let first = 0;
  let o = 0;
  let bits = 0;
  let datum = 0;
  let pos = 0;
  while (o < count) {
    while (bits < size && pos < data.length) {
      datum |= data[pos++]! << bits;
      bits += 8;
    }
    if (bits < size) break;
    let code = datum & ((1 << size) - 1);
    datum >>>= size;
    bits -= size;
    if (code === clear) {
      size = minSize + 1;
      next = end + 1;
      old = -1;
      continue;
    }
    if (code === end) break;
    if (old === -1) {
      if (code >= clear) break;
      out[o++] = suffix[code]!;
      old = first = code;
      continue;
    }
    const read = code;
    let sp = 0;
    if (code >= next) {
      if (code > next) break;
      // The code being defined right now: the last string plus its own first byte.
      stack[sp++] = first;
      code = old;
    }
    while (code >= clear) {
      stack[sp++] = suffix[code]!;
      code = prefix[code]!;
    }
    first = suffix[code]!;
    stack[sp++] = first;
    if (next < 4096) {
      prefix[next] = old;
      suffix[next] = first;
      next++;
      if (next === 1 << size && size < 12) size++;
    }
    old = read;
    while (sp > 0 && o < count) out[o++] = stack[--sp]!;
  }
  return out;
}

/** The first frame of a GIF, on its full canvas (outside the frame and its transparent colour: transparent). */
export function gifFirstFrame(data: Uint8Array): Frame | undefined {
  const head = String.fromCharCode(...data.subarray(0, 6));
  if ((head !== 'GIF87a' && head !== 'GIF89a') || data.length < 13) return undefined;
  const u16 = (i: number) => data[i]! | (data[i + 1]! << 8);
  const width = u16(6);
  const height = u16(8);
  if (!width || !height || width * height > 64e6) return undefined;
  const flags = data[10]!;
  let pos = 13;
  let global: Uint8Array | null = null;
  if (flags & 0x80) {
    const n = 3 << ((flags & 7) + 1);
    global = data.subarray(pos, pos + n);
    pos += n;
  }
  let transparent = -1;
  const skipBlocks = () => {
    while (pos < data.length) {
      const n = data[pos++]!;
      if (!n) return;
      pos += n;
    }
  };
  while (pos < data.length) {
    const kind = data[pos++];
    if (kind === 0x21) {
      const label = data[pos++];
      if (label === 0xf9 && data[pos] === 4) {
        if (data[pos + 1]! & 1) transparent = data[pos + 4]!;
        pos += 5;
        skipBlocks();
      } else skipBlocks();
    } else if (kind === 0x2c) {
      const left = u16(pos);
      const top = u16(pos + 2);
      const w = u16(pos + 4);
      const h = u16(pos + 6);
      const f = data[pos + 8]!;
      pos += 9;
      let table = global;
      if (f & 0x80) {
        const n = 3 << ((f & 7) + 1);
        table = data.subarray(pos, pos + n);
        pos += n;
      }
      if (!table) return undefined;
      const minSize = data[pos++]!;
      if (minSize < 1 || minSize > 11) return undefined;
      const parts: Uint8Array[] = [];
      let total = 0;
      while (pos < data.length) {
        const n = data[pos++]!;
        if (!n) break;
        parts.push(data.subarray(pos, pos + n));
        total += n;
        pos += n;
      }
      const joined = new Uint8Array(total);
      let at = 0;
      for (const p of parts) { joined.set(p, at); at += p.length; }
      const indices = lzw(minSize, joined, w * h);
      // Interlaced images store rows in four passes: every 8th from 0, every 8th from 4, every 4th from 2, every 2nd from 1.
      const rows: number[] = [];
      if (f & 0x40) for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]] as const) for (let y = start; y < h; y += step) rows.push(y);
      else for (let y = 0; y < h; y++) rows.push(y);
      const rgba = new Uint8Array(width * height * 4);
      rows.forEach((y, r) => {
        const cy = top + y;
        if (cy >= height) return;
        for (let x = 0; x < w; x++) {
          const cx = left + x;
          if (cx >= width) break;
          const idx = indices[r * w + x]!;
          if (idx === transparent || idx * 3 + 2 >= table.length) continue;
          const o = (cy * width + cx) * 4;
          rgba[o] = table[idx * 3]!;
          rgba[o + 1] = table[idx * 3 + 1]!;
          rgba[o + 2] = table[idx * 3 + 2]!;
          rgba[o + 3] = 255;
        }
      });
      return { width, height, rgba };
    } else return undefined;
  }
  return undefined;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(parts: readonly Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC[(c ^ p[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** An RGBA picture as a PNG file. */
export function encodePng({ width, height, rgba }: Frame): Buffer {
  const chunk = (type: string, body: Uint8Array): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const name = Buffer.from(type, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32([name, body]));
    return Buffer.concat([len, name, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // no filter
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}

/** A GIF's first frame as a PNG file; undefined when the file is not a GIF that can be read. */
export function gifToPng(data: Uint8Array): Buffer | undefined {
  const f = gifFirstFrame(data);
  return f && encodePng(f);
}

/** A picture the exports can embed: PNG and JPEG as they are, a GIF as a PNG of its first frame. */
export type Picture = { data: Buffer; type: 'png' | 'jpg' } | { problem: 'type' | 'missing' | 'unreadable' };

/** The picture file at `path`, ready to embed, or why it cannot be. */
export function readPicture(path: string): Picture {
  const ext = /\.[^./\\]+$/.exec(path)?.[0].toLowerCase() ?? '';
  if (!['.png', '.jpg', '.jpeg', '.gif'].includes(ext)) return { problem: 'type' };
  if (!existsSync(path)) return { problem: 'missing' };
  let data: Buffer;
  try {
    data = readFileSync(path);
  } catch {
    return { problem: 'unreadable' };
  }
  if (ext !== '.gif') return { data, type: ext === '.png' ? 'png' : 'jpg' };
  const png = gifToPng(data);
  return png ? { data: png, type: 'png' } : { problem: 'unreadable' };
}
