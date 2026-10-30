// Renders src/renderer/icon.svg to the app icon files in build/: PNGs, icon.ico (Windows) and icon.icns (macOS).
// Run with Electron so no image tools are needed: `npx electron scripts/app-icon.cjs` (under xvfb-run on a headless box).
const { app, BrowserWindow } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const out = join(root, 'build');
const svg = readFileSync(join(root, 'src/renderer/icon.svg'), 'utf8');
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

/** ICO with PNG images inside (Windows Vista and later read these). */
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(([size, data], i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, at); head.writeUInt8(size >= 256 ? 0 : size, at + 1);
    head.writeUInt16LE(1, at + 4); head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(data.length, at + 8); head.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map(([, d]) => d)]);
}

/** ICNS with PNG chunks (ic07 128, ic08 256, ic09 512, ic10 1024@2x). */
function icns(bySize) {
  const chunks = [['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]].map(([type, size]) => {
    const data = bySize.get(size);
    const h = Buffer.alloc(8); h.write(type, 0, 'ascii'); h.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([h, data]);
  });
  const body = Buffer.concat(chunks);
  const h = Buffer.alloc(8); h.write('icns', 0, 'ascii'); h.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([h, body]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<body></body>');
  const bySize = new Map();
  for (const size of SIZES) {
    const url = await win.webContents.executeJavaScript(`new Promise((ok, fail) => {
      const img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = ${size};
        const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, ${size}, ${size}); ok(c.toDataURL('image/png')); };
      img.onerror = () => fail(new Error('the SVG did not load'));
      img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
    })`);
    bySize.set(size, Buffer.from(url.split(',')[1], 'base64'));
  }
  mkdirSync(join(out, 'icons'), { recursive: true });
  for (const [size, data] of bySize) if (size <= 512) writeFileSync(join(out, 'icons', `${size}x${size}.png`), data);
  writeFileSync(join(out, 'icon.png'), bySize.get(512));
  writeFileSync(join(out, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((s) => [s, bySize.get(s)])));
  writeFileSync(join(out, 'icon.icns'), icns(bySize));
  console.log(`Wrote ${SIZES.length} PNGs, icon.ico and icon.icns to ${out}`);
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
