// Bundles main, preload and renderer with esbuild. Core is bundled from its TypeScript source.
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const watch = process.argv.includes('--watch');
const common = { bundle: true, sourcemap: true, conditions: ['source'], logLevel: 'info', target: 'es2023' };
const configs = [
  // pdfkit stays external: its ESM build locates data files with import.meta.url, which a CJS bundle cannot provide.
  // @lore-forge/pdf itself only uses import.meta when `require` is missing, which never happens in CJS.
  { ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.cjs', platform: 'node', format: 'cjs', external: ['electron', 'pdfkit'], logOverride: { 'empty-import-meta': 'silent' } },
  { ...common, entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload.cjs', platform: 'node', format: 'cjs', external: ['electron'] },
  // React Flow runs on Preact through preact/compat.
  { ...common, entryPoints: ['src/renderer/main.tsx'], outfile: 'dist/renderer/app.js', platform: 'browser', format: 'iife', jsx: 'automatic', jsxImportSource: 'preact',
    alias: { react: 'preact/compat', 'react-dom': 'preact/compat', 'react/jsx-runtime': 'preact/jsx-runtime' }, define: { 'process.env.NODE_ENV': '"production"' } },
];

await mkdir('dist/renderer', { recursive: true });
await cp('src/renderer/index.html', 'dist/renderer/index.html');
await cp('src/renderer/styles.css', 'dist/renderer/styles.css');
await cp(createRequire(import.meta.url).resolve('@xyflow/react/dist/style.css'), 'dist/renderer/xyflow.css');
await bundleFonts();

/** Cinzel (SIL OFL 1.1) headings: the woff2 files and their @font-face rules, from @fontsource/cinzel. */
async function bundleFonts() {
  const pkg = dirname(createRequire(import.meta.url).resolve('@fontsource/cinzel/package.json'));
  await mkdir('dist/renderer/fonts', { recursive: true });
  const ranges = JSON.parse(await readFile(join(pkg, 'unicode.json'), 'utf8'));
  let css = '';
  for (const weight of [600, 700]) {
    for (const subset of ['latin-ext', 'latin']) {
      const file = `cinzel-${subset}-${weight}-normal.woff2`;
      css += `@font-face { font-family: 'Cinzel'; font-style: normal; font-display: swap; font-weight: ${weight}; src: url(./fonts/${file}) format('woff2'); unicode-range: ${ranges[subset]}; }\n`;
      await cp(join(pkg, 'files', file), join('dist/renderer/fonts', file));
    }
  }
  await cp(join(pkg, 'LICENSE'), 'dist/renderer/fonts/Cinzel-OFL.txt');
  await writeFile('dist/renderer/fonts.css', css);
}
if (watch) {
  for (const c of configs) await (await context(c)).watch();
  console.log('Watching. Press Ctrl+R in the app to reload after renderer changes (restart for main changes).');
} else {
  await Promise.all(configs.map((c) => build(c)));
}
