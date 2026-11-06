// Writes cube.glb: a 1 x 1 x 1 gold cube (24 vertices with normals, 12 triangles), the smoke test's 3D model.
// Run: node packages/desktop/test/fixtures/make-cube.mjs
import { writeFileSync } from 'node:fs';

const faces = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]; // axis, sign
const pos = [];
const nor = [];
const idx = [];
for (const [axis, sign] of faces) {
  const [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
  const base = pos.length / 3;
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const p = [0, 0, 0];
    p[axis] = 0.5 * sign;
    p[u] = 0.5 * a;
    p[v] = 0.5 * b * sign;
    const n = [0, 0, 0];
    n[axis] = sign;
    pos.push(...p);
    nor.push(...n);
  }
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
const f32 = (a) => Buffer.from(new Float32Array(a).buffer);
const bin = Buffer.concat([f32(pos), f32(nor), Buffer.from(new Uint16Array(idx).buffer)]);
const json = {
  asset: { version: '2.0', generator: 'Lore-Forge make-cube.mjs' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'Cube' }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
  materials: [{ name: 'Gold', pbrMetallicRoughness: { baseColorFactor: [0.88, 0.74, 0.42, 1], metallicFactor: 0.6, roughnessFactor: 0.4 } }],
  buffers: [{ byteLength: bin.length }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 288, target: 34962 },
    { buffer: 0, byteOffset: 288, byteLength: 288, target: 34962 },
    { buffer: 0, byteOffset: 576, byteLength: 72, target: 34963 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
    { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
    { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' },
  ],
};
const pad = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
const j = pad(Buffer.from(JSON.stringify(json)), 0x20);
const b = pad(bin, 0);
const head = Buffer.alloc(12);
head.writeUInt32LE(0x46546c67, 0);
head.writeUInt32LE(2, 4);
head.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
const chunk = (data, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(data.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, data]); };
writeFileSync(new URL('./cube.glb', import.meta.url), Buffer.concat([head, chunk(j, 0x4e4f534a), chunk(b, 0x004e4942)]));
