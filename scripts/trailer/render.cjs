// Skyloom trailer frame renderer (headless Chromium).
//   node scripts/trailer/render.cjs --out DIR [--from F] [--to F] [--step N] [--w 1920 --h 1080]
//        [--frames 10,240,480] [--scenes globe,sky] [--workers 1] [--worker k]
// Serve the repo root at http://127.0.0.1:8765 first (python3 -m http.server 8765).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const A = {}; for (let i = 2; i < process.argv.length; i += 2) A[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const outDir = A.out || '/tmp/trailer-frames'; fs.mkdirSync(outDir, { recursive: true });
const base = A.url || 'http://127.0.0.1:8765/scripts/trailer/index.html';
const qs = new URLSearchParams({ w: A.w || 1920, h: A.h || 1080, ...(A.scenes ? { scenes: A.scenes } : {}), ...(A.mb ? { mb: A.mb } : {}), ...(A.msaa ? { msaa: A.msaa } : {}) });

(async () => {
  const b = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=6000'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', (e) => console.log('pageerror:', e.message));
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.text().slice(0, 300)); });
  await p.goto(`${base}?${qs}${A.q ? '&' + A.q : ''}`);
  await p.waitForFunction(() => window.ready || window.bootError, null, { timeout: 600000 });
  const err = await p.evaluate(() => window.bootError); if (err) { console.log('BOOT ERROR', err); process.exit(1); }
  const total = await p.evaluate(() => window.T.frames);
  let list;
  if (A.frames) list = A.frames.split(',').map(Number);
  else { const from = +(A.from || 0), to = Math.min(+(A.to || total - 1), total - 1), step = +(A.step || 1); list = []; for (let f = from; f <= to; f += step) list.push(f); }
  const W = +(A.workers || 1), K = +(A.worker || 0); list = list.filter((_, i) => i % W === K);
  const skip = A.resume === '1';
  const t0 = Date.now(); let done = 0;
  for (const f of list) {
    const file = path.join(outDir, `f${String(f).padStart(5, '0')}.jpg`);
    if (skip && fs.existsSync(file)) continue;
    const s = Date.now();
    const d = await p.evaluate((f) => window.T.renderFrame(f), f);
    fs.writeFileSync(file, Buffer.from(d.split(',')[1], 'base64'));
    done++;
    if (done % 10 === 0 || list.length < 30) console.log(`frame ${f} ${Date.now() - s}ms  (${done}/${list.length}, avg ${((Date.now() - t0) / done / 1000).toFixed(2)}s)`);
  }
  await b.close();
})();
