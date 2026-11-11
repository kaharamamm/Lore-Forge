/**
 * Kokoro-82M (Apache-2.0, https://huggingface.co/hexgrad/Kokoro-82M), the model behind the built-in voices, run with
 * ONNX Runtime: phonemes become token ids, a voice is a "style" (one row of 256 numbers from its pack, chosen by the
 * length of the text), and out comes speech, 24,000 samples a second. One run takes at most 510 tokens, so longer
 * text is cut at sentence ends, then commas, then spaces.
 */
import { KOKORO_VOCAB } from './kokoro-vocab.ts';

export const KOKORO_SAMPLE_RATE = 24000;
/** Phonemes in one run: 510 tokens with the two pads, and a little room. */
const MAX_PHONEMES = 500;
/** Numbers in one row of a voice pack; a pack has a row for each text length up to 510. */
const STYLE = 256;

/** The token ids of phonemes; characters Kokoro does not know are left out. */
export function kokoroTokens(phonemes: string): number[] {
  const out: number[] = [];
  for (const c of phonemes) {
    const id = KOKORO_VOCAB[c];
    if (id !== undefined) out.push(id);
  }
  return out;
}

/** Phonemes cut into runs the model takes: at sentence ends, else commas and dashes, else spaces. */
export function kokoroChunks(phonemes: string, max = MAX_PHONEMES): string[] {
  const out: string[] = [];
  let rest = phonemes.trim();
  while (rest.length > max) {
    const head = rest.slice(0, max);
    const last = (marks: string[]) => Math.max(...marks.map((m) => head.lastIndexOf(m)));
    const sentence = last(['. ', '! ', '? ', '; ', '… ']);
    const clause = last([', ', ': ', ' —']);
    const space = head.lastIndexOf(' ');
    const at = sentence > max / 3 ? sentence + 1 : clause > max / 3 ? clause + 1 : space > 0 ? space : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** What Kokoro needs of ONNX Runtime (onnxruntime-node and onnxruntime-web both fit). */
export interface OrtLike {
  InferenceSession: { create(path: string, options?: Record<string, unknown>): Promise<OrtSession> };
  Tensor: new (type: 'int64' | 'float32', data: BigInt64Array | Float32Array, dims: readonly number[]) => unknown;
}
export interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown }>>;
}

export class Kokoro {
  private readonly ort: OrtLike;
  private readonly session: OrtSession;
  private constructor(ort: OrtLike, session: OrtSession) {
    this.ort = ort;
    this.session = session;
  }

  /** The model from its .onnx file, on `threads` processor threads. */
  static async load(ort: OrtLike, model: string, threads: number): Promise<Kokoro> {
    return new Kokoro(ort, await ort.InferenceSession.create(model, { intraOpNumThreads: threads, graphOptimizationLevel: 'all' }));
  }

  /** Speech for phonemes in a voice (its pack: rows of 256 numbers) at a speed (1 is normal), as samples from -1 to 1. */
  async speak(phonemes: string, pack: Float32Array, speed = 1): Promise<Float32Array> {
    const parts: Float32Array[] = [];
    for (const chunk of kokoroChunks(phonemes)) {
      const ids = kokoroTokens(chunk);
      if (!ids.length) continue;
      const row = Math.min(ids.length, Math.floor(pack.length / STYLE) - 1);
      const out = await this.session.run({
        input_ids: new this.ort.Tensor('int64', BigInt64Array.from([0, ...ids, 0], (x) => BigInt(x)), [1, ids.length + 2]),
        style: new this.ort.Tensor('float32', pack.slice(row * STYLE, row * STYLE + STYLE), [1, STYLE]),
        speed: new this.ort.Tensor('float32', Float32Array.of(speed), [1]),
      });
      parts.push(out['waveform']!.data as Float32Array);
    }
    const audio = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      audio.set(p, at);
      at += p.length;
    }
    return audio;
  }
}
