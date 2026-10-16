import { chromium } from 'playwright';
import fs from 'fs';
import http from 'http';
import path from 'path';
// serves the repo root: /node_modules/three, /public/models, /scripts/trailer/fleet
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(b); });
}).listen(0);
const port = server.address().port;
const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => console.log('[err]', e.message));
await page.goto(`http://127.0.0.1:${port}/scripts/trailer/fleet/index.html`);
await page.waitForFunction(() => window.ready === true);
if (job.info) { for (const u of job.info) console.log(u, JSON.stringify(await page.evaluate(x => window.info(x), u))); }
let n = 0; const t0 = Date.now();
for (const f of job.frames || []) {
  if (fs.existsSync(f.out) && !job.force) { n++; continue; }
  const url = await page.evaluate(x => window.renderFrame(x), f);
  fs.writeFileSync(f.out, Buffer.from(url.split(',')[1], 'base64'));
  n++; if (n % 20 === 0) console.log(n, 'frames', ((Date.now() - t0) / n / 1000).toFixed(2), 's/frame');
}
await browser.close(); server.close();
