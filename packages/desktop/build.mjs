// Bundles main, preload and renderer with esbuild. Core is bundled from its TypeScript source.
import { build, context } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const common = { bundle: true, sourcemap: true, conditions: ['source'], logLevel: 'info', target: 'es2023' };
const configs = [
  { ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.cjs', platform: 'node', format: 'cjs', external: ['electron'] },
  { ...common, entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload.cjs', platform: 'node', format: 'cjs', external: ['electron'] },
  { ...common, entryPoints: ['src/renderer/main.tsx'], outfile: 'dist/renderer/app.js', platform: 'browser', format: 'iife', jsx: 'automatic', jsxImportSource: 'preact' },
];

await mkdir('dist/renderer', { recursive: true });
await cp('src/renderer/index.html', 'dist/renderer/index.html');
await cp('src/renderer/styles.css', 'dist/renderer/styles.css');
if (watch) {
  for (const c of configs) await (await context(c)).watch();
  console.log('Watching. Press Ctrl+R in the app to reload after renderer changes (restart for main changes).');
} else {
  await Promise.all(configs.map((c) => build(c)));
}
