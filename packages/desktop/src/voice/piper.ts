/**
 * A Piper voice (VITS, exported to ONNX by Piper's training): a voice made from someone's recordings with the Voice
 * Studio (tools/voice-studio). Its config.json says its sample rate and which id each phoneme has; the text arrives as
 * IPA phonemes (english.ts and ipa.ts, or turkish.ts), the same ones the voice was trained on.
 */
import type { OrtLike, OrtSession } from './kokoro.ts';

/** What Lore-Forge reads from a Piper voice's config.json. */
export interface PiperConfig {
  audio: { sample_rate: number };
  inference?: { noise_scale?: number; length_scale?: number; noise_w?: number };
  phoneme_id_map: Record<string, number[]>;
}

/** The ids Piper's training gave a phoneme string: start, pad, each phoneme with a pad after it, end. */
export function piperIds(phonemes: string, map: PiperConfig['phoneme_id_map']): number[] {
  const pad = map['_'] ?? [0];
  const out = [...(map['^'] ?? [1]), ...pad];
  for (const c of phonemes.normalize('NFD')) {
    const id = map[c];
    if (id) out.push(...id, ...pad);
  }
  out.push(...(map['$'] ?? [2]));
  return out;
}

/** Long text in pieces of whole sentences, so no single run grows too big. */
function pieces(phonemes: string, max = 400): string[] {
  const out: string[] = [];
  let piece = '';
  for (const sentence of phonemes.split(/(?<=[.!?;])\s+/)) {
    if (piece && piece.length + sentence.length > max) {
      out.push(piece);
      piece = '';
    }
    piece = piece ? `${piece} ${sentence}` : sentence;
  }
  if (piece.trim()) out.push(piece);
  return out;
}

export class Piper {
  readonly sampleRate: number;
  private readonly ort: OrtLike;
  private readonly session: OrtSession;
  private readonly config: PiperConfig;
  private constructor(ort: OrtLike, session: OrtSession, config: PiperConfig) {
    this.ort = ort;
    this.session = session;
    this.config = config;
    this.sampleRate = config.audio.sample_rate;
  }

  static async load(ort: OrtLike, model: string, config: PiperConfig, threads: number): Promise<Piper> {
    return new Piper(ort, await ort.InferenceSession.create(model, { intraOpNumThreads: threads, graphOptimizationLevel: 'all' }), config);
  }

  /** Speech for IPA phonemes at a speed (1 is normal), as samples from -1 to 1. */
  async speak(phonemes: string, speed = 1): Promise<Float32Array> {
    const inf = this.config.inference ?? {};
    const scales = Float32Array.of(inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) / speed, inf.noise_w ?? 0.8);
    const parts: Float32Array[] = [];
    for (const piece of pieces(phonemes)) {
      const ids = piperIds(piece, this.config.phoneme_id_map);
      const out = await this.session.run({
        input: new this.ort.Tensor('int64', BigInt64Array.from(ids, (x) => BigInt(x)), [1, ids.length]),
        input_lengths: new this.ort.Tensor('int64', BigInt64Array.of(BigInt(ids.length)), [1]),
        scales: new this.ort.Tensor('float32', scales, [3]),
      });
      parts.push(out['output']!.data as Float32Array);
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
