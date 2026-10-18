#!/usr/bin/env node
/*
 * Room-only render harness for the observation lounge (node + playwright).
 *
 * WHAT IT DOES. Serves the repository over a tiny local http server (an
 * importmap maps 'three' to node_modules; extensionless relative specifiers
 * resolve to .js / .mjs as webpack resolves them; /models/... falls back to
 * public/), opens scripts/lounge-room-render/index.html in headless Chromium
 * (SwiftShader WebGL2), builds the REAL room through lib/fly/airport-lounge.js
 * createAirportLounge({variant}) with the real procedural surface-map bake and
 * the real AO bake, and renders named room-local poses (poses.mjs) at fixed
 * times of day with the per-frame feed components/fly/AirportLounge.jsx gives
 * the room (interior shading, glass, steam, boards, probe, exposure bias).
 * renderer.debug.checkShaderErrors is on; ANY page error, shader compile error
 * or console error fails the run with a non-zero exit. Each pose prints the
 * scene pass's renderer.info draws/triangles (room + instruments + the two
 * harness stand-ins, sky and ground) and the room stats.
 *
 * WHAT IT APPROXIMATES / DOES NOT DO (cite it as "the room-only harness",
 * never as the app): a procedural sky gradient + ground plane instead of the
 * world; one harness DirectionalLight + HemisphereLight carrying the app's own
 * cinema-environment sun/fill values instead of the CSM cascades; three's
 * UnrealBloomPass + OutputPass (AgX) + SMAAPass instead of the app's
 * postprocessing chain — NO N8AO, NO aerial perspective, NO immersive clouds,
 * NO grade/vignette, NO TRUE_SCALE anisotropy, no live exterior, no HUD, no
 * live traffic (boards and instrument screens show their honest empty states).
 * SwiftShader: no frame-time or fps meaning whatsoever. The page half
 * (scripts/lounge-room-render/harness.js) documents the stand-ins in detail;
 * a lane that changes AirportLounge.jsx's per-frame feed mirrors it there.
 *
 * USAGE
 *   node scripts/render-lounge-room.cjs [--variant pier|classic] [--poses a,b,c]
 *     [--tod day,golden,night] [--size 1280x720] [--out DIR] [--sheet]
 *     [--flags A,B,-C] [--list]
 *   --variant  pier (default) or classic
 *   --poses    comma list of pose names (default: every pose the variant has)
 *   --tod      comma list of day, golden, night (default: all three)
 *   --size     WxH (default 1280x720)
 *   --out      output directory (default .graphics-review/lounge-second-level/render)
 *   --sheet    also write labelled contact sheets (ImageMagick montage)
 *   --flags    harness-visible switches: LOUNGE_INSTRUMENTS (on by default for
 *              the pier, the owner's review pair; -LOUNGE_INSTRUMENTS turns it
 *              off; off by default for classic), NIGHT_WATCH, NO_BLOOM,
 *              NO_SMAA, NO_PROBE, SAFE_BUMP (diagnostic: guards the room
 *              shader's lgBump normalize, see harness.js). Every flag is also passed to the page URL
 *              (?flags=...) and to window.__loungeHarnessFlags.
 *   --at       an ad-hoc standing pose, name:ex,ey,ez:tx,ty,tz (room-local
 *              eye and target; repeatable; rendered after the named poses)
 *   --list     print the pose names per variant and exit
 *
 * Output: <out>/<variant>-<pose>-<tod>.png, <out>/stats-<variant>.json and,
 * with --sheet, <out>/sheet-<variant>.png (rows = poses, columns = times of
 * day) plus <out>/sheet-<variant>-<tod>.png.
 */
'use strict';
// Node notes that observation-config.js is ESM in a typeless package; that is expected here.
process.removeAllListeners('warning');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const TOD_ORDER = ['day', 'golden', 'night'];

function parseArgs(argv) {
  const opts = { variant: 'pier', poses: null, tods: TOD_ORDER.slice(), size: [1280, 720], out: path.join(ROOT, '.graphics-review/lounge-second-level/render'), sheet: false, flags: [], list: false, at: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [k, inline] = a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, null];
    const val = () => inline ?? argv[++i];
    if (k === '--variant') opts.variant = val() === 'classic' ? 'classic' : 'pier';
    else if (k === '--poses') opts.poses = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--tod') opts.tods = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--size') { const m = /^(\d+)x(\d+)$/.exec(val()); if (!m) throw new Error('--size WxH'); opts.size = [Number(m[1]), Number(m[2])]; }
    else if (k === '--out') opts.out = path.resolve(val());
    else if (k === '--sheet') opts.sheet = true;
    else if (k === '--flags') opts.flags = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--list') opts.list = true;
    else if (k === '--at') {
      const m = /^([\w-]+):(-?[\d.]+),(-?[\d.]+),(-?[\d.]+):(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)$/.exec(val());
      if (!m) throw new Error('--at name:ex,ey,ez:tx,ty,tz');
      const n = m.slice(2).map(Number);
      opts.at.push({ name: m[1], eye: n.slice(0, 3), target: n.slice(3) });
    }
    else throw new Error(`unknown argument ${a}`);
  }
  for (const t of opts.tods) if (!TOD_ORDER.includes(t)) throw new Error(`unknown --tod ${t}`);
  return opts;
}

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.bin': 'application/octet-stream', '.png': 'image/png', '.css': 'text/css', '.wasm': 'application/wasm' };

/** A static server: repo root, then public/; extensionless specifiers resolve to .js / .mjs. */
function serve() {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const candidates = [];
      for (const base of [ROOT, path.join(ROOT, 'public')]) {
        const p = path.resolve(base, rel);
        if (!p.startsWith(base)) continue;
        candidates.push(p, `${p}.js`, `${p}.mjs`, path.join(p, 'index.js'));
      }
      const file = candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
      if (!file) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch (error) {
      res.writeHead(500); res.end(String(error));
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function sheet(files, out, tile, labels) {
  const args = [];
  files.forEach((f, i) => args.push('-label', labels[i], f));
  execFileSync('montage', [...args, '-tile', tile, '-geometry', '480x270+4+4', '-pointsize', '15', '-background', '#151515', '-fill', '#e8e8e8', out], { stdio: 'pipe' });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { POSES, resolvePose } = await import(path.join(ROOT, 'scripts/lounge-room-render/poses.mjs'));
  if (opts.list) {
    for (const v of ['pier', 'classic']) console.log(`${v}: ${POSES.filter((p) => p.variants.includes(v)).map((p) => p.name).join(', ')}`);
    return;
  }
  const poses = opts.poses ?? (opts.at.length ? [] : POSES.filter((p) => p.variants.includes(opts.variant)).map((p) => p.name));
  for (const p of poses) if (!resolvePose(p, opts.variant)) throw new Error(`pose ${p} does not exist in the ${opts.variant} room (--list)`);
  fs.mkdirSync(opts.out, { recursive: true });

  const { chromium } = require('playwright');
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const failures = [];
  const consoleWarnings = [];
  let exitCode = 0;
  try {
    const page = await browser.newPage({ viewport: { width: opts.size[0], height: opts.size[1] }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(600000);
    page.on('pageerror', (e) => failures.push(`pageerror: ${e.stack ?? e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') failures.push(`console.error: ${m.text().slice(0, 4000)}`);
      else if (m.type() === 'warning') consoleWarnings.push(m.text().slice(0, 300));
    });
    page.on('requestfailed', (r) => failures.push(`request failed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
    page.on('response', (r) => { if (r.status() >= 400) failures.push(`HTTP ${r.status()}: ${r.url()}`); });
    await page.addInitScript((flags) => { window.__loungeHarnessFlags = flags; window.__flySunOverride = Date.UTC(2026, 9, 18, 16, 0, 0); }, opts.flags);
    const query = opts.flags.length ? `?flags=${encodeURIComponent(opts.flags.join(','))}` : '';
    await page.goto(`http://127.0.0.1:${port}/scripts/lounge-room-render/index.html${query}`);
    await page.waitForFunction(() => window.__loungeHarnessReady === true || false, null, { timeout: 120000 }).catch((e) => failures.push(`harness never became ready: ${e.message}`));
    if (failures.length) throw new Error('setup failed');
    const setup = await page.evaluate(({ variant, size, flags }) => window.__loungeHarness.setup({ variant, width: size[0], height: size[1], flags }), { variant: opts.variant, size: opts.size, flags: opts.flags });
    const r = setup.room;
    console.log(`ROOM ${opts.variant}${setup.instruments ? ' + instruments' : ''}: ${r.draws} draws · ${r.triangles} triangles (room ${r.roomTriangles}) · ${r.practicals} practicals · ${r.shadowBoxes} shadow boxes · surface maps ${(r.textureBytes / 1048576).toFixed(2)} MiB · AO ${setup.aoApplied ? 'applied' : 'MISSING'}`);
    const stats = { variant: opts.variant, flags: opts.flags, size: opts.size, setup, renders: [] };
    const written = [];
    for (const tod of opts.tods) {
      for (let pose of [...poses, ...opts.at]) {
        const res = await page.evaluate(({ pose, tod }) => window.__loungeHarness.render(pose, tod), { pose, tod });
        if (typeof pose === 'object') pose = pose.name;
        if (res.skipped) { console.log(`SKIP ${pose} ${tod}: ${res.reason}`); continue; }
        const file = path.join(opts.out, `${opts.variant}-${pose}-${tod}.png`);
        fs.writeFileSync(file, Buffer.from(res.image.split(',')[1], 'base64'));
        written.push({ pose, tod, file });
        delete res.image;
        stats.renders.push(res);
        console.log(`${pose.padEnd(24)} ${tod.padEnd(6)} scene ${String(res.scene.calls).padStart(3)} draws · ${String(res.scene.triangles).padStart(7)} tris · frame ${res.frame.calls} draws · exp ${res.shading.exposure} · non-finite px ${res.nonFinite.nan + res.nonFinite.inf} · ${res.ms} ms`);
      }
    }
    const pageErrors = await page.evaluate(() => window.__loungeHarness.errors.slice());
    for (const e of pageErrors) failures.push(`harness: ${e}`);
    stats.warnings = consoleWarnings;
    stats.failures = failures;
    fs.writeFileSync(path.join(opts.out, `stats-${opts.variant}.json`), JSON.stringify(stats, null, 2));
    if (opts.sheet && written.length) {
      const ordered = [];
      for (const pose of [...poses, ...opts.at.map((a) => a.name)]) for (const tod of opts.tods) { const w = written.find((x) => x.pose === pose && x.tod === tod); if (w) ordered.push(w); }
      sheet(ordered.map((w) => w.file), path.join(opts.out, `sheet-${opts.variant}.png`), `${opts.tods.length}x`, ordered.map((w) => `${w.pose} · ${w.tod}`));
      for (const tod of opts.tods) {
        const set = written.filter((w) => w.tod === tod);
        if (set.length) sheet(set.map((w) => w.file), path.join(opts.out, `sheet-${opts.variant}-${tod}.png`), `${Math.min(4, set.length)}x`, set.map((w) => `${w.pose} · ${w.tod}`));
      }
      console.log(`sheets written to ${opts.out}`);
    }
  } catch (error) {
    failures.push(`driver: ${error.stack ?? error.message}`);
  } finally {
    await browser.close();
    server.close();
  }
  if (consoleWarnings.length) console.log(`(${consoleWarnings.length} console warnings; see stats json)`);
  if (failures.length) {
    exitCode = 1;
    console.error(`FAIL render-lounge-room: ${failures.length} error(s)`);
    for (const f of failures.slice(0, 20)) console.error(`  ${f.split('\n').slice(0, 12).join('\n  ')}`);
  } else console.log(`PASS render-lounge-room: ${opts.variant}, zero page/shader/console errors`);
  process.exit(exitCode);
}

main().catch((error) => { console.error(error); process.exit(1); });
