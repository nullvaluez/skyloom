// Reproducible, network-free GPU check and contact sheet of the real fleet.
// node scripts/review-operator-liveries.cjs [--serve] [--software] [--channel chrome]
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright');
const { webpack } = require('next/dist/compiled/webpack/webpack');
const root = path.resolve(__dirname, '..'), out = path.join(root, '.graphics-review/operator-liveries');
fs.mkdirSync(out, { recursive: true });
async function main() {
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false, entry: path.join(__dirname, 'operator-livery-review.mjs'),
      output: { path: out, filename: 'bundle.js', hashFunction: 'sha256' },
      resolve: { alias: { '@': root }, extensions: ['.js', '.mjs', '.json'], fullySpecified: false },
      module: { rules: [{ test: /\.m?js$/, resolve: { fullySpecified: false } }] },
      optimization: { minimize: false }, cache: false,
    });
    compiler.run((error, stats) => { compiler.close(() => {}); error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve(); });
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Skyloom operator livery review</title></head><body style="margin:0;background:#c4d3de"><script>window.__flyOperatorLiveriesOverride={enabled:new URLSearchParams(location.search).get('off')!=='1'};</script><script src="/bundle.js"></script></body></html>`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
    const base = url.pathname.startsWith('/models/') ? path.join(root, 'public') : out;
    const file = path.resolve(base, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'model/gltf-binary'); fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(3187, '127.0.0.1', r));
  let browser;
  try {
    const channelIndex = process.argv.indexOf('--channel');
    browser = await chromium.launch({ headless: true, ...(channelIndex > 0 ? { channel: process.argv[channelIndex + 1] } : {}), args: process.argv.includes('--software') ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 1500, height: 1080 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:3187/');
    await page.waitForFunction(() => window.reviewReady, undefined, { timeout: 60000 });
    const report = await page.evaluate(() => window.review.run());
    report.errors = errors;
    const painted = await page.evaluate(() => window.review.gallery());
    report.cards = painted.cards;
    await page.screenshot({ path: path.join(out, 'operators-port.png') });
    await page.evaluate(() => window.review.gallery(true));
    await page.screenshot({ path: path.join(out, 'operators-starboard.png') });
    await page.evaluate(() => window.review.single('military'));
    await page.screenshot({ path: path.join(out, 'military-glb.png') });
    await page.evaluate(() => window.review.single(0, false, true));
    await page.screenshot({ path: path.join(out, 'delta-night.png') });
    await page.goto('http://127.0.0.1:3187/?off=1');
    await page.waitForFunction(() => window.reviewReady, undefined, { timeout: 60000 });
    report.control = await page.evaluate(() => window.review.run());
    const neutral = await page.evaluate(() => window.review.gallery());
    report.pixelChecks = report.cards.map((card, i) => ({ callsign: card.callsign, changed: painted.hashes[i] !== neutral.hashes[i] }));
    await page.screenshot({ path: path.join(out, 'operators-off.png') });
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    if (errors.length || report.programs.some(p => !p.runnable) || report.control.programs.some(p => !p.runnable) || report.pixelChecks.some(p => p.changed !== (p.callsign !== 'ZZZ123'))) throw Error(`GPU review failed: ${errors.join('\n')} ${JSON.stringify(report.pixelChecks)}`);
    console.log(JSON.stringify({ renderer: report.renderer, compiled: report.compiled.length, controlCompiled: report.control.compiled.length, pixelChecks: report.pixelChecks, errors, out }));
  } finally { await browser?.close(); if (!process.argv.includes('--serve')) await new Promise(r => server.close(r)); }
  if (process.argv.includes('--serve')) console.log('Review at http://127.0.0.1:3187/ (run window.review.run() in its console).');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
