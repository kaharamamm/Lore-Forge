// Downloads the built-in voices into voices/kokoro/: Kokoro-82M (Apache-2.0) as ONNX, and the packs of the English
// voices Lore-Forge offers (src/shared/voices.ts). Files already there with the right checksum are kept, so a second
// run downloads nothing. The release workflow runs this before packaging; electron-builder ships voices/ as a resource.
// Run: node scripts/fetch-voices.mjs
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The version of onnx-community/Kokoro-82M-v1.0-ONNX the files come from. */
const REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const BASE = `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/${REVISION}`;
const OUT = join(import.meta.dirname, '..', 'voices', 'kokoro');

/** Path in the model repository -> [file here, SHA-256]. */
const FILES = {
  'onnx/model_quantized.onnx': ['model.onnx', 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478'],
  'voices/af_heart.bin': ['af_heart.bin', 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b'],
  'voices/af_bella.bin': ['af_bella.bin', 'f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b'],
  'voices/af_nicole.bin': ['af_nicole.bin', 'cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a'],
  'voices/af_aoede.bin': ['af_aoede.bin', '4a004c33430762e2461eedb2013fad808ef4ab3121f5300f554476caf58d8361'],
  'voices/af_kore.bin': ['af_kore.bin', '9be5221b6a941c04b561959b8ff0b06e809444dcc4ab7e75a7b23606f691819e'],
  'voices/af_sarah.bin': ['af_sarah.bin', '4409fbc125afabacc615d94db5398d847006a737b0247d6892b7a9a0007a2f0a'],
  'voices/am_fenrir.bin': ['am_fenrir.bin', 'c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43'],
  'voices/am_michael.bin': ['am_michael.bin', '1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1'],
  'voices/am_puck.bin': ['am_puck.bin', 'fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0'],
  'voices/bf_emma.bin': ['bf_emma.bin', '669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73'],
  'voices/bf_isabella.bin': ['bf_isabella.bin', '3754352c4aaa46d17f27654ab7518d65b62ad6163a0f55a5f4330c2da2c4e94f'],
  'voices/bm_george.bin': ['bm_george.bin', 'c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc'],
  'voices/bm_fable.bin': ['bm_fable.bin', 'f889083196807b4adb15e9204252165f503b8d33d3982e681c52443c49d798f1'],
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

await mkdir(OUT, { recursive: true });
let fetched = 0;
for (const [from, [name, sum]] of Object.entries(FILES)) {
  const to = join(OUT, name);
  if (existsSync(to) && sha256(await readFile(to)) === sum) continue;
  const r = await fetch(`${BASE}/${from}`);
  if (!r.ok) throw new Error(`${from}: ${r.status} ${r.statusText}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (sha256(bytes) !== sum) throw new Error(`${from}: the download does not match its checksum`);
  await writeFile(`${to}.part`, bytes);
  await rm(to, { force: true });
  await rename(`${to}.part`, to);
  fetched++;
  console.log(`${name}: ${(bytes.length / 1e6).toFixed(1)} MB`);
}
// The licence travels with the model and voices.
await writeFile(join(OUT, 'NOTICE.txt'), [
  'Kokoro-82M by hexgrad (https://huggingface.co/hexgrad/Kokoro-82M), in the ONNX form of onnx-community',
  `(https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX, revision ${REVISION}).`,
  'The model and the voice packs are licensed under the Apache License, Version 2.0: see LICENSE.txt or',
  'https://www.apache.org/licenses/LICENSE-2.0',
  '',
].join('\n'));
await writeFile(join(OUT, 'LICENSE.txt'), await readFile(join(import.meta.dirname, '..', 'voice-data', 'LICENSE.txt')));
console.log(fetched ? `Built-in voices ready in ${OUT}` : 'Built-in voices already there.');
