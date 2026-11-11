/**
 * The voices Lore-Forge brings with it, which run on the user's own computer, offline: English voices of Kokoro-82M
 * (Apache-2.0), chosen for how well they read (their packs are voices/kokoro/<id>.bin, from
 * scripts/fetch-voices.mjs), and voices made from someone's recordings with the Voice Studio (tools/voice-studio),
 * each a Piper model in voices/piper/<id>/ (model.onnx, config.json, lore-forge.json).
 */
export interface BuiltInVoice {
  /** Kokoro's name for a Kokoro voice (af_ American female, am_ American male, bf_ British female, bm_ British male), the folder name for a Piper voice. */
  id: string;
  name: string;
  /** The language the voice reads. */
  language: 'en' | 'tr';
  /** How an English voice pronounces: American or British. */
  accent?: 'us' | 'gb';
  gender: 'female' | 'male';
  engine: 'kokoro' | 'piper';
}

const kokoro = (id: string, name: string, accent: 'us' | 'gb', gender: 'female' | 'male'): BuiltInVoice => ({ id, name, language: 'en', accent, gender, engine: 'kokoro' });

export const KOKORO_VOICES: readonly BuiltInVoice[] = [
  kokoro('af_heart', 'Heart', 'us', 'female'),
  kokoro('af_bella', 'Bella', 'us', 'female'),
  kokoro('af_nicole', 'Nicole', 'us', 'female'),
  kokoro('af_aoede', 'Aoede', 'us', 'female'),
  kokoro('af_kore', 'Kore', 'us', 'female'),
  kokoro('af_sarah', 'Sarah', 'us', 'female'),
  kokoro('am_fenrir', 'Fenrir', 'us', 'male'),
  kokoro('am_michael', 'Michael', 'us', 'male'),
  kokoro('am_puck', 'Puck', 'us', 'male'),
  kokoro('bf_emma', 'Emma', 'gb', 'female'),
  kokoro('bf_isabella', 'Isabella', 'gb', 'female'),
  kokoro('bm_george', 'George', 'gb', 'male'),
  kokoro('bm_fable', 'Fable', 'gb', 'male'),
];

/** What a Piper voice's lore-forge.json says about it. */
export interface PiperVoiceInfo {
  name: string;
  language: 'en' | 'tr';
  gender: 'female' | 'male';
}

/** A Piper voice folder's lore-forge.json as a voice; undefined when it does not say enough. */
export function piperVoice(id: string, info: unknown): BuiltInVoice | undefined {
  const o = info as Partial<PiperVoiceInfo> | null;
  if (!o || typeof o.name !== 'string' || !o.name.trim() || (o.language !== 'en' && o.language !== 'tr')) return undefined;
  return { id, name: o.name.trim(), language: o.language, ...(o.language === 'en' ? { accent: 'us' as const } : {}), gender: o.gender === 'female' ? 'female' : 'male', engine: 'piper' };
}

/** A name of the book and how its author says it (the entry's pronunciation), for the built-in voices. */
export interface SpokenName {
  name: string;
  say: string;
}

/** Samples a second of the Kokoro voices' speech (a Piper voice says its own). */
export const KOKORO_SAMPLE_RATE = 24000;
