// Tries the built-in voice on a few sentences: prints the phonemes and writes speech to WAV files in the folder given.
// node --conditions=source packages/desktop/scripts/try-voice.ts <out-dir> [voice]   (after scripts/fetch-voices.mjs)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import { parseLexicon, phonemize } from '../src/voice/english.ts';
import { Kokoro, type OrtLike } from '../src/voice/kokoro.ts';
import { KOKORO_VOICES as BUILT_IN_VOICES } from '../src/shared/voices.ts';

const out = process.argv[2] ?? '.';
const voice = BUILT_IN_VOICES.find((v) => v.id === (process.argv[3] ?? 'af_heart'))!;
const root = join(import.meta.dirname, '..');
const lex = parseLexicon(readFileSync(join(root, 'voice-data', `en-${voice.accent}.txt`), 'utf8'));
const lines = [
  'Every morning in Camelamamm began with a song, and every morning Mr Camel was awake to hear it.',
  "The kettle always began to sing a moment later, as if it were answering. Mr Camel had never decided whether that was the kettle's idea or his own.",
  'On the 10th morning of Highheat, in 1920, he folded his legs, set out his glass, and waited; the well did not sing.',
  '"Well," he said to nobody. "That is new." Malquor and Qarim watched from the Street of Kettles.',
];
const model = await Kokoro.load(ort as unknown as OrtLike, join(root, 'voices', 'kokoro', 'model.onnx'), 4);
const raw = readFileSync(join(root, 'voices', 'kokoro', `${voice.id}.bin`));
const pack = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const all: Float32Array[] = [];
for (const line of lines) {
  const p = phonemize(line, lex, voice.accent);
  console.log(`${line}\n  ${p}\n`);
  const t0 = performance.now();
  const audio = await model.speak(p, pack, 1);
  console.log(`  ${(audio.length / 24000).toFixed(1)} s of speech in ${(performance.now() - t0).toFixed(0)} ms\n`);
  all.push(audio, new Float32Array(9600));
}
const pcm = Int16Array.from(all.flatMap((a) => [...a]), (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767))));
const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length * 2, 4); header.write('WAVE', 8); header.write('fmt ', 12);
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(24000, 24);
header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length * 2, 40);
writeFileSync(join(out, `sample-${voice.id}.wav`), Buffer.concat([header, Buffer.from(pcm.buffer)]));
console.log(`wrote ${join(out, `sample-${voice.id}.wav`)}`);
