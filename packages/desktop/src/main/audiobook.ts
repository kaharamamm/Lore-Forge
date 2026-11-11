/**
 * Saving an audiobook. The window makes the speech and encodes it (Opus) and sends the packets here as they come; they
 * wait in a file next to the audiobook. At the end the audiobook is written as one Ogg Opus file (.opus) with the
 * book's title, author, cover and a mark for each chapter, which can only be written once every chapter's start is
 * known.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { open, rm, type FileHandle } from 'node:fs/promises';
import type { AudiobookInfo } from '../shared/api.ts';
import { chapterComments, opusTags, OggOpusWriter, pictureComment } from './ogg-opus.ts';

interface Job {
  file: string;
  temp: string;
  handle: FileHandle;
  /** Each packet's size in bytes, and how many samples (at 48 kHz) it holds. */
  sizes: number[];
  samples: number[];
  /** Writes in order, one after the other. */
  writing: Promise<void>;
}

const jobs = new Map<string, Job>();

/** Starts an audiobook that will be saved as `file`; the packets wait in `file`.part. */
export async function startAudiobook(file: string): Promise<string> {
  const id = randomUUID();
  const temp = `${file}.part`;
  jobs.set(id, { file, temp, handle: await open(temp, 'w'), sizes: [], samples: [], writing: Promise.resolve() });
  return id;
}

/** More packets: their bytes one after the other, each one's size, and the samples in each. */
export function addAudio(id: string, data: Uint8Array, sizes: number[], samples: number[]): Promise<void> {
  const job = jobs.get(id);
  if (!job) return Promise.reject(new Error('This audiobook is no longer being made.'));
  const ok = (a: unknown): a is number[] => Array.isArray(a) && a.every((n) => Number.isInteger(n) && n > 0 && n < 1 << 20);
  if (!(data instanceof Uint8Array) || !ok(sizes) || !ok(samples) || sizes.length !== samples.length || sizes.reduce((n, s) => n + s, 0) !== data.length) {
    return Promise.reject(new Error('The audio sent for the audiobook was not complete.'));
  }
  job.writing = job.writing.then(async () => {
    await job.handle.write(data);
    job.sizes.push(...sizes);
    job.samples.push(...samples);
  });
  return job.writing;
}

export type AudiobookTags = AudiobookInfo & { cover?: { mime: string; data: Uint8Array; width: number; height: number } };

/** The audiobook's details as the window sent them, checked: an Opus header, and text and numbers where they belong. */
export function audiobookInfo(value: unknown): AudiobookInfo {
  const v = (value ?? {}) as Partial<Record<keyof AudiobookInfo, unknown>>;
  const head = v.head instanceof Uint8Array ? v.head : undefined;
  if (!head || head.length < 19 || new TextDecoder().decode(head.subarray(0, 8)) !== 'OpusHead') throw new Error('The audiobook has no Opus header.');
  const text = (x: unknown, max = 500): string => (typeof x === 'string' ? x.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : '');
  const chapters = Array.isArray(v.chapters) ? v.chapters : [];
  const author = text(v.author);
  return {
    head,
    end: Number.isFinite(v.end) ? Number(v.end) : 0,
    title: text(v.title) || 'Audiobook',
    ...(author ? { author } : {}),
    reader: text(v.reader),
    language: text(v.language, 10),
    chapters: chapters
      .filter((c): c is { title: unknown; start: unknown } => !!c && typeof c === 'object')
      .map((c) => ({ title: text(c.title), start: Number(c.start) }))
      .filter((c) => Number.isFinite(c.start) && c.start >= 0),
  };
}

/** Writes the audiobook: the headers with the chapters and the cover, then the audio from the waiting file. */
export async function finishAudiobook(id: string, tags: AudiobookTags): Promise<{ file: string; bytes: number }> {
  const job = jobs.get(id);
  if (!job) throw new Error('This audiobook is no longer being made.');
  jobs.delete(id);
  await job.writing;
  await job.handle.close();
  const comments = [
    `TITLE=${tags.title}`,
    `ALBUM=${tags.title}`,
    ...(tags.author ? [`ARTIST=${tags.author}`, `ALBUMARTIST=${tags.author}`] : []),
    `PERFORMER=${tags.reader}`,
    'GENRE=Audiobook',
    `LANGUAGE=${tags.language}`,
    ...chapterComments(tags.chapters),
    ...(tags.cover ? [pictureComment(tags.cover.mime, tags.cover.data, tags.cover.width, tags.cover.height)] : []),
  ];
  const out = await open(job.file, 'w');
  let bytes = 0;
  try {
    // Pages are gathered and written a few hundred kilobytes at a time.
    let held: Uint8Array[] = [];
    let heldBytes = 0;
    const flush = async () => {
      if (!heldBytes) return;
      await out.write(Buffer.concat(held));
      bytes += heldBytes;
      held = [];
      heldBytes = 0;
    };
    const writer = new OggOpusWriter(randomBytes(4).readUInt32LE(0), async (page) => {
      held.push(page);
      heldBytes += page.length;
      if (heldBytes >= 1 << 19) await flush();
    });
    await writer.headers(tags.head, opusTags('Lore-Forge', comments));
    const input = await open(job.temp, 'r');
    try {
      const chunk = Buffer.alloc(1 << 22);
      let rest: Buffer = Buffer.alloc(0);
      let i = 0;
      for (;;) {
        const { bytesRead } = await input.read(chunk, 0, chunk.length, null);
        if (!bytesRead) break;
        // A copy: the chunk is read into again, and the writer keeps packets until their page is full.
        const buf = Buffer.concat([rest, chunk.subarray(0, bytesRead)]);
        let at = 0;
        while (i < job.sizes.length && at + job.sizes[i]! <= buf.length) {
          await writer.packet(buf.subarray(at, at + job.sizes[i]!), job.samples[i]!);
          at += job.sizes[i]!;
          i++;
        }
        rest = buf.subarray(at);
      }
    } finally {
      await input.close();
    }
    await writer.finish(BigInt(Math.max(0, Math.round(tags.end))));
    await flush();
  } finally {
    await out.close();
  }
  await rm(job.temp, { force: true });
  return { file: job.file, bytes };
}

/** Stops an audiobook: the waiting file goes, and nothing is saved. */
export async function cancelAudiobook(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  await job.writing.catch(() => {});
  await job.handle.close().catch(() => {});
  await rm(job.temp, { force: true });
}

/** When the app quits: the waiting files of the audiobooks still being made go (at once: the app is closing). */
export function dropAudiobooks(): void {
  for (const job of jobs.values()) rmSync(job.temp, { force: true });
  jobs.clear();
}
