/**
 * Ogg Opus files (RFC 7845), the audiobook's format: the identification header the encoder made, a comment header
 * with the book's title, author, chapters and cover, then the audio, in pages of about a second each.
 */

/** Ogg's checksum: CRC-32 with polynomial 0x04c11db7, not reflected, starting at zero. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

export function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]!) >>> 0;
  return crc;
}

/** A packet's lacing values: 255 for each full segment, then what is left (0 when the packet fills its last segment). */
export function lacing(size: number): number[] {
  const out = new Array<number>(Math.floor(size / 255)).fill(255);
  out.push(size % 255);
  return out;
}

const BOS = 0x02;
const EOS = 0x04;
const CONTINUED = 0x01;
/** About a second of audio per page: Opus packets of 20 ms. */
const PACKETS_PER_PAGE = 50;

const utf8 = new TextEncoder();

/** The comment header: who made the file, then "KEY=value" comments. */
export function opusTags(vendor: string, comments: readonly string[]): Uint8Array {
  const parts = [utf8.encode('OpusTags'), u32le(utf8.encode(vendor).length), utf8.encode(vendor), u32le(comments.length)];
  for (const c of comments) {
    const bytes = utf8.encode(c);
    parts.push(u32le(bytes.length), bytes);
  }
  return concat(parts);
}

/** A time in a chapter comment: 01:02:03.450. */
export function timeStamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(Math.floor(ms / 3_600_000))}:${two(Math.floor(ms / 60_000) % 60)}:${two(Math.floor(ms / 1000) % 60)}.${String(ms % 1000).padStart(3, '0')}`;
}

/** Chapter marks as players read them from Vorbis comments: CHAPTER001=00:00:00.000 and CHAPTER001NAME=... */
export function chapterComments(chapters: readonly { title: string; start: number }[]): string[] {
  return chapters.slice(0, 999).flatMap((c, i) => {
    const n = String(i + 1).padStart(3, '0');
    return [`CHAPTER${n}=${timeStamp(c.start)}`, `CHAPTER${n}NAME=${c.title.replace(/\s+/g, ' ').trim()}`];
  });
}

/** The cover as a METADATA_BLOCK_PICTURE comment: a FLAC picture block (a front cover), in base64. */
export function pictureComment(mime: string, data: Uint8Array, width: number, height: number): string {
  const m = utf8.encode(mime);
  const block = concat([u32be(3), u32be(m.length), m, u32be(0), u32be(width), u32be(height), u32be(24), u32be(0), u32be(data.length), data]);
  return `METADATA_BLOCK_PICTURE=${Buffer.from(block).toString('base64')}`;
}

/**
 * Writes an Ogg Opus stream as its packets come: `headers` first, then each audio packet with how many samples
 * (at 48 kHz) it holds, then `finish`. Pages go to `out` in order.
 */
export class OggOpusWriter {
  private seq = 0;
  /** Samples (at 48 kHz) in the audio packets so far. */
  private samples = 0n;
  /** The granule position of the last page written. */
  private written = 0n;
  private lace: number[] = [];
  private parts: Uint8Array[] = [];
  private count = 0;
  private readonly serial: number;
  private readonly out: (page: Uint8Array) => Promise<void> | void;

  constructor(serial: number, out: (page: Uint8Array) => Promise<void> | void) {
    this.serial = serial;
    this.out = out;
  }

  /** The identification and comment headers, each from the start of a page; a long comment header runs over several. */
  async headers(head: Uint8Array, tags: Uint8Array): Promise<void> {
    await this.alone(head, BOS);
    await this.alone(tags, 0);
  }

  /** One audio packet. A page holds about a second; a new one starts when the next packet would not fit. */
  async packet(data: Uint8Array, samples: number): Promise<void> {
    const lv = lacing(data.length);
    if (this.count && (this.lace.length + lv.length > 255 || this.count >= PACKETS_PER_PAGE)) await this.flush(0, this.samples);
    this.lace.push(...lv);
    this.parts.push(data);
    this.count++;
    this.samples += BigInt(samples);
  }

  /**
   * The last page, marked as the end of the stream. `end` is the granule position of the last sample to keep (the
   * pre-skip plus the length of the sound), so a player drops the encoder's padding after it.
   */
  async finish(end?: bigint): Promise<void> {
    const last = end !== undefined && end < this.samples ? (end > this.written ? end : this.written) : this.samples;
    await this.flush(EOS, last);
  }

  private async flush(flags: number, granule: bigint): Promise<void> {
    await this.out(this.page(flags, granule, this.lace, this.parts));
    this.written = granule;
    this.lace = [];
    this.parts = [];
    this.count = 0;
  }

  /** A header packet on pages of its own: the pages it does not end on have no granule position (-1). */
  private async alone(packet: Uint8Array, flags: number): Promise<void> {
    const lv = lacing(packet.length);
    let at = 0;
    let offset = 0;
    while (at < lv.length) {
      const take = lv.slice(at, at + 255);
      const bytes = take.reduce((n, x) => n + x, 0);
      const ends = at + take.length === lv.length;
      await this.out(this.page(at === 0 ? flags : CONTINUED, ends ? 0n : -1n, take, [packet.subarray(offset, offset + bytes)]));
      at += take.length;
      offset += bytes;
    }
  }

  private page(flags: number, granule: bigint, lace: readonly number[], parts: readonly Uint8Array[]): Uint8Array {
    const size = parts.reduce((n, p) => n + p.length, 0);
    const page = new Uint8Array(27 + lace.length + size);
    const v = new DataView(page.buffer);
    page.set([0x4f, 0x67, 0x67, 0x53]);
    page[5] = flags;
    v.setBigInt64(6, granule, true);
    v.setUint32(14, this.serial, true);
    v.setUint32(18, this.seq++, true);
    page[26] = lace.length;
    page.set(lace, 27);
    let at = 27 + lace.length;
    for (const p of parts) {
      page.set(p, at);
      at += p.length;
    }
    v.setUint32(22, oggCrc(page), true);
    return page;
  }
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
