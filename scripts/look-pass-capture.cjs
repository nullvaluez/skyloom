/** LOOK PASS shared capture: fixed poses x sun elevations on the production Enhanced path.
 * Installed Chrome / D3D11 / live world. Appearance evidence only, never an fps verdict.
 *
 *   node scripts/look-pass-capture.cjs --label=baseline
 *   Options: --url=http://localhost:3000  --poses=nyc-street,yosemite  --times=noon,golden,dusk,night
 *            --shots=nyc-street__noon,powell__golden   exact pose__time pairs (instead of the cross product)
 *            --flags=-LOOK_ATMOS,-LOOK_GRADE  --quality=ultra  --settle=7000  --slots=3
 *            --width=1600 --height=900  --out=<absolute dir>  --list
 *            --burst   after each still, 7 frames while the pose creeps forward 1.5 units a frame;
 *                      reports the share of pixels whose luma jumps > 30 between frames (shimmer proxy)
 *
 * Output: <main checkout>/.graphics-review/look-pass/<label>/<pose>__<time>.png + manifest.json.
 * A re-run into an existing label replaces the shots it captures and keeps the rest of the manifest.
 * A three-slot lock under .graphics-review/look-pass/.locks keeps concurrent agents from
 * oversubscribing the GPU; a run waits for a slot instead of failing.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const sharp = require('sharp');
const { pathToFileURL } = require('node:url');
const { register } = require('node:module');

const args = Object.fromEntries(process.argv.slice(2).map(s => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));

const POSES = {
  // Owner's Manhattan review pose: facades near, Midtown ahead.
  'nyc-street': { lat: 40.7311, lon: -73.9892, altM: 543, headingDeg: 6, note: 'facades, street canyons, mid skyline' },
  // Lower Manhattan across the harbour: water, skyline silhouette, depth layers.
  'nyc-harbor': { lat: 40.6890, lon: -74.0280, altM: 420, headingDeg: 30, note: 'water, skyline layering' },
  // Cruise: horizon, aerial perspective, cloud decks.
  'nyc-cruise': { lat: 40.62, lon: -74.08, altM: 7000, headingDeg: 30, note: 'horizon haze, altitude atmosphere' },
  // Owner's home area: suburb roofs, trees, roads.
  'powell': { lat: 40.1990, lon: -83.0811, altM: 630, headingDeg: 339, note: 'suburb, vegetation, flat light' },
  // Featured: granite valley, long shadows, forest.
  'yosemite': { lat: 37.72, lon: -119.66, altM: 2850, headingDeg: 76, note: 'terrain relief, valley haze' },
  // Featured: glacier valley and the Jungfrau wall.
  'alps': { lat: 46.5935, lon: 7.9091, altM: 3150, headingDeg: 185, note: 'snow, ridgeline layering' },
  // Featured: bay, mountains and city in one frame.
  'rio': { lat: -22.94, lon: -43.14, altM: 1100, headingDeg: 260, note: 'coast, hills, city depth' },
};
// Target true solar elevation in degrees on the afternoon branch; 'noon' is solar noon + 2 h.
const TIMES = { noon: null, golden: 7, dusk: -3, night: -20 };

if (args.list) { console.log(JSON.stringify({ poses: POSES, times: TIMES }, null, 1)); process.exit(0); }

const label = String(args.label || 'baseline');
const url = args.url || 'http://localhost:3000';
const flags = typeof args.flags === 'string' ? args.flags : '';
const quality = args.quality || 'ultra';
const date = args.date || '2026-09-22';
const shotPairs = typeof args.shots === 'string' ? args.shots.split(',').map(s => s.trim().split('__')).filter(([p, t]) => POSES[p] && t in TIMES) : null;
const poseNames = shotPairs ? [...new Set(shotPairs.map(([p]) => p))] : (typeof args.poses === 'string' ? args.poses.split(',') : Object.keys(POSES)).filter(n => POSES[n]);
const allTimes = (typeof args.times === 'string' ? args.times.split(',') : Object.keys(TIMES)).filter(n => n in TIMES);
const timesFor = pose => shotPairs ? shotPairs.filter(([p]) => p === pose).map(([, t]) => t) : allTimes;
const timeNames = timesFor(poseNames[0]);
const viewport = { width: Number(args.width || 1600), height: Number(args.height || 900) };

let home;
try { home = path.resolve(execSync('git rev-parse --path-format=absolute --git-common-dir', { encoding: 'utf8' }).trim(), '..'); }
catch { home = path.resolve(__dirname, '..'); }
const root = path.join(home, '.graphics-review', 'look-pass');
const out = path.resolve(typeof args.out === 'string' ? args.out : path.join(root, label));
fs.mkdirSync(out, { recursive: true });

const report = { label, url, flags, quality, date, viewport, venue: 'Installed Chrome / D3D11 / live world; fixed pose, real solar ephemeris, running clock', captures: [], errors: [], warnings: [] };
try { report.captures = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')).captures || []; } catch {}
const save = () => fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(report, null, 2));
let captured = 0;

// ---- GPU slot lock -------------------------------------------------------
const lockDir = path.join(root, '.locks');
fs.mkdirSync(lockDir, { recursive: true });
let heldSlot = null;
async function acquireSlot() {
  const slots = Number(args.slots || 3), staleMs = 25 * 60 * 1000, t0 = Date.now();
  for (;;) {
    for (let i = 0; i < slots; i++) {
      const p = path.join(lockDir, `slot-${i}`);
      try { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'owner.txt'), `${label} pid ${process.pid} ${new Date().toISOString()}`); heldSlot = p; return Date.now() - t0; }
      catch { try { if (Date.now() - fs.statSync(p).mtimeMs > staleMs) fs.rmSync(p, { recursive: true, force: true }); } catch {} }
    }
    if (Date.now() - t0 > 40 * 60 * 1000) throw Error('No GPU capture slot within 40 minutes');
    await new Promise(r => setTimeout(r, 4000));
  }
}
const releaseSlot = () => { if (heldSlot) { try { fs.rmSync(heldSlot, { recursive: true, force: true }); } catch {} heldSlot = null; } };
process.on('exit', releaseSlot);
process.on('SIGINT', () => { releaseSlot(); process.exit(130); });

// ---- image metrics -------------------------------------------------------
async function imageMetrics(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const band = (y0, y1) => {
    const top = Math.round(y0 * info.height), bottom = Math.round(y1 * info.height);
    let n = 0, sumL = 0, sumL2 = 0, sumS = 0; const rgb = [0, 0, 0], hist = new Uint32Array(256);
    for (let y = top; y < bottom; y += 2) for (let x = 0; x < info.width; x += 2) {
      const i = (y * info.width + x) * 3, r = data[i], g = data[i + 1], b = data[i + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      n++; sumL += l; sumL2 += l * l; sumS += mx ? (mx - mn) / mx : 0; rgb[0] += r; rgb[1] += g; rgb[2] += b; hist[Math.round(l)]++;
    }
    const pct = q => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= q * n) return v; } return 255; };
    const mean = sumL / n, round = v => Math.round(v * 100) / 100;
    return { meanLuma: round(mean), lumaStd: round(Math.sqrt(Math.max(0, sumL2 / n - mean * mean))), p05: pct(0.05), p50: pct(0.5), p95: pct(0.95), meanSat: round(sumS / n), meanRGB: rgb.map(v => round(v / n)) };
  };
  return { space: 'display sRGB bytes', frame: band(0, 1), upper: band(0, 0.33), middle: band(0.33, 0.66), lower: band(0.66, 1) };
}

const HIDE = 'body *{visibility:hidden!important}canvas[data-look-canvas]{visibility:visible!important}';
// Shimmer proxy: stills cannot see crawling windows or sparkling edges. Creep the held pose
// forward a little each frame and count pixels that flip hard between consecutive frames.
// Only meaningful as a ratio between two labels captured the same way.
async function burstMetric(page) {
  const dir = await page.evaluate(async () => {
    const f = window.__fly.flight, h = window.__lookHold; if (!h) return null;
    const p0 = { x: f.pos.x, z: f.pos.z }; window.__lookHold = null;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
    const dx = f.pos.x - p0.x, dz = f.pos.z - p0.z, n = Math.hypot(dx, dz);
    window.__lookHold = h; return n > 1e-6 ? { x: dx / n, z: dz / n } : null;
  });
  if (!dir) return null;
  await page.waitForTimeout(600);
  const frames = [], STEP = 1.5, COUNT = 7;
  for (let i = 0; i < COUNT; i++) {
    await page.evaluate(({ d, k }) => { const h = window.__lookHold; h.x += d.x * k; h.z += d.z * k; return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }, { d: dir, k: STEP });
    await page.waitForTimeout(120);
    frames.push(await sharp(await page.screenshot({ timeout: 60000, style: HIDE })).removeAlpha().greyscale().raw().toBuffer());
  }
  await page.evaluate(({ d, k }) => { const h = window.__lookHold; h.x -= d.x * k; h.z -= d.z * k; }, { d: dir, k: STEP * COUNT });
  let sparkle = 0, mean = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i]; let c = 0, sum = 0;
    for (let j = 0; j < a.length; j++) { const d = Math.abs(a[j] - b[j]); sum += d; if (d > 30) c++; }
    sparkle += c / a.length; mean += sum / a.length;
  }
  const n = frames.length - 1, round = v => Math.round(v * 1000) / 1000;
  return { frames: COUNT, stepUnits: STEP, sparklePct: round(sparkle / n * 100), meanAbsLuma: round(mean / n) };
}

async function waitWorld(page, timeout) {
  const t0 = Date.now();
  const settled = await page.waitForFunction(() => {
    const r = window.__fly; if (!r || r.worldLoading || !r.terraStats?.sharp) return false;
    for (const k of ['satBuildings', 'satSkyline', 'satRoads', 'satVeg']) { const s = r[k]?.stats; if (s && ['queued', 'building', 'sampling', 'draping', 'births', 'dying'].some(f => Number(s[f] || 0) !== 0)) return false; }
    return true;
  }, undefined, { timeout, polling: 1000 }).then(() => true, () => false);
  return { settled, ms: Date.now() - t0 };
}

(async () => {
  register('./_node-resolve.mjs', pathToFileURL(__filename));
  const { computeSun } = await import('../lib/fly/sun-model.js');
  const day = Date.parse(date + 'T00:00:00Z');
  const elevationAt = (pose, utc) => Math.asin(computeSun(pose.lon, pose.lat, utc).sinEl) * 180 / Math.PI;
  const solve = (pose, time) => {
    const noon = day + (12 - pose.lon / 15) * 3600000;
    if (TIMES[time] == null) return noon + 2 * 3600000;
    let lo = noon, hi = noon + 12 * 3600000;
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (elevationAt(pose, mid) > TIMES[time]) lo = mid; else hi = mid; }
    return Math.round((lo + hi) / 2);
  };

  const waited = await acquireSlot();
  console.log(`SLOT ${label} ${path.basename(heldSlot)} after ${waited}ms`);
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  let page, current = 'boot';
  try {
    page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    page.on('pageerror', e => { report.errors.push({ scene: current, kind: 'pageerror', message: e.message }); save(); });
    page.on('console', m => { const t = m.text(); if (m.type() === 'error' && /shader|WebGL|GLSL|ReferenceError|TypeError/i.test(t)) { report.errors.push({ scene: current, kind: 'console', message: t.slice(0, 2500) }); save(); } else if (m.type() === 'error' && report.warnings.length < 60) report.warnings.push({ scene: current, message: t.slice(0, 600) }); });
    await page.addInitScript(({ quality, sun }) => {
      window.__flyGovPin = 'hold'; window.__flyVisualsOverride = 'enhanced'; window.__flyTitleBypass = true; window.__flyBoostInfinite = true;
      window.__flySunOverride = sun; window.__flyWeatherOverride = 'baseline';
      try {
        localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-quality-tier', quality); localStorage.setItem('fly-controls-seen', '1');
        localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-visuals', 'enhanced');
        localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } }));
      } catch {}
    }, { quality, sun: solve(POSES[poseNames[0]], timeNames[0]) });
    await page.route('**/api/aircraft?**', r => r.fulfill({ json: { ac: [], now: Date.now(), total: 0, source: 'look pass' } }));
    await page.route('**/api/weather**', r => r.fulfill({ json: { found: false } }));
    await page.goto(`${url}/?graphicsReview=1${flags ? `&flags=${encodeURIComponent(flags)}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await page.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore, undefined, { timeout: 240000 });
    report.gpu = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'), e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); });
    if (/swiftshader|llvmpipe|software|basic render/i.test(report.gpu || '')) throw Error(`Software renderer: ${report.gpu}`);
    console.log(`BOOT ${label} ${report.gpu}`);
    await page.evaluate(() => {
      const r = window.__fly, s = window.__flyStore.getState();
      r.operations.phase = 'airborne'; r.operations.profile = null; r.operations.warp(r.flight); s.setHangarOpen(false); s.setPhase('flying');
      const f = r.flight, step = f.step.bind(f);
      f.step = (dt, c) => {
        const h = window.__lookHold;
        step(dt, { ...c, turn: 0, pitch: 0, boost: false });
        if (h) { f.pos.x = h.x; f.pos.y = h.y; f.pos.z = h.z; f.heading = h.heading; f.bank = 0; f.pitch = 0.02; f.agl = f.pos.y - f.groundElev; }
      };
      let scene = r.engine.object; while (scene.parent) scene = scene.parent;
      scene.__r3f.root.getState().gl.domElement.setAttribute('data-look-canvas', '');
      Object.defineProperty(r.camera, 'fov', { configurable: true, get: () => 60, set: () => {} }); r.camera.updateProjectionMatrix();
    });

    for (const poseName of poseNames) {
      const pose = POSES[poseName];
      current = poseName;
      await page.evaluate(({ p, sun }) => {
        const r = window.__fly; window.__lookHold = null; window.__flySunOverride = sun;
        r.warpToGeo(p.lat, p.lon, { altM: p.altM, headingRad: p.headingDeg * Math.PI / 180, name: null }); r.autopilot?.disengage?.();
        const f = r.flight; window.__lookHold = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: p.headingDeg * Math.PI / 180 }; r.chaseCam?.snap?.();
      }, { p: pose, sun: solve(pose, timesFor(poseName)[0]) });
      await page.waitForTimeout(4000);
      const world = await waitWorld(page, Number(args.worldTimeout || 150000));
      console.log(`POSE ${label} ${poseName} settled=${world.settled} ${world.ms}ms`);
      for (const time of timesFor(poseName)) {
        current = `${poseName}__${time}`;
        const utc = solve(pose, time), want = elevationAt(pose, utc);
        await page.evaluate(v => { window.__flySunOverride = v; }, utc);
        await page.waitForFunction(el => Math.abs(Math.asin(window.__fly.sun.sinEl) * 180 / Math.PI - el) < 0.05, want, { timeout: 15000, polling: 250 }).catch(() => report.warnings.push({ scene: current, message: 'sun did not converge' }));
        await page.waitForTimeout(Number(args.settle || 7000));
        const file = `${current}.png`;
        await page.screenshot({ path: path.join(out, file), timeout: 60000, style: HIDE });
        const telemetry = await page.evaluate(() => {
          const r = window.__fly, s = window.__flyStore.getState(); let scene = r.engine.object; while (scene.parent) scene = scene.parent;
          const gl = scene.__r3f?.root?.getState()?.gl;
          return { sunElevation: Math.asin(r.sun?.sinEl) * 180 / Math.PI, quality: s.qualityTier, visuals: s.visuals, aglM: r.flight.pos.y - r.flight.groundElev,
            render: gl ? { calls: gl.info.render.calls, triangles: gl.info.render.triangles, programs: gl.info.programs.length, textures: gl.info.memory.textures } : null,
            fps: window.__flyStats?.fps ?? null, urlFlags: window.__flyUrlFlags ?? null };
        });
        const burst = args.burst ? await burstMetric(page).catch(e => ({ error: e.message })) : null;
        report.captures = report.captures.filter(c => c.file !== file); captured++;
        report.captures.push({ pose: poseName, time, file, utc, burst, iso: new Date(utc).toISOString(), worldSettled: world.settled, telemetry, metrics: await imageMetrics(path.join(out, file)) }); save();
        console.log(`CAPTURE ${label} ${file} el=${telemetry.sunElevation.toFixed(2)} calls=${telemetry.render?.calls} tris=${telemetry.render?.triangles}${burst ? ` sparkle=${burst.sparklePct ?? burst.error}%` : ''}`);
      }
    }
  } catch (e) {
    report.errors.push({ scene: current, kind: 'fatal', message: e.message });
    if (page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    console.error(e.message);
  } finally {
    save(); await browser.close(); releaseSlot();
    console.log(`DONE ${label}: ${captured} captures, ${report.errors.length} errors -> ${out}`);
    if (report.errors.length) process.exitCode = 1;
  }
})().catch(e => { report.errors.push({ kind: 'fatal', message: e.message }); save(); releaseSlot(); console.error(e); process.exitCode = 1; });
