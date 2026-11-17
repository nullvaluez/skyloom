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
 * A shot is retried in a fresh page (up to three attempts) when the page reloads, the canvas
 * remounts, the WebGL context is lost or the frame comes out blank. Editing a source file while
 * a capture runs causes exactly that (hot reload), so wait for DONE before editing.
 * The reference labels baseline and baseline-a are read-only without --rebaseline.
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
  // Ohio suburb: roofs, trees, roads.
  'powell': { lat: 40.1990, lon: -83.0811, altM: 630, headingDeg: 339, note: 'suburb, vegetation, flat light' },
  // Featured: granite valley, long shadows, forest.
  'yosemite': { lat: 37.72, lon: -119.66, altM: 2850, headingDeg: 76, note: 'terrain relief, valley haze' },
  // Featured: glacier valley and the Jungfrau wall.
  'alps': { lat: 46.5935, lon: 7.9091, altM: 3150, headingDeg: 185, note: 'snow, ridgeline layering' },
  // Featured: bay, mountains and city in one frame.
  'rio': { lat: -22.94, lon: -43.14, altM: 1100, headingDeg: 260, note: 'coast, hills, city depth' },
  // Toward the low sun. Of the seven poses above only rio faces the golden-hour sun, and that is
  // where haze, grade and cloud light stack hardest. Use these with golden and dusk.
  'nyc-skyline-sun': { lat: 40.7080, lon: -73.9650, altM: 420, headingDeg: 268, note: 'Manhattan skyline against the low sun, river in front' },
  'powell-sun': { lat: 40.1990, lon: -83.0811, altM: 630, headingDeg: 268, note: 'flat suburb into the low sun' },
  'yosemite-sun': { lat: 37.72, lon: -119.66, altM: 2850, headingDeg: 268, note: 'granite valley into the low sun' },
  'nyc-cruise-sun': { lat: 40.62, lon: -74.08, altM: 7000, headingDeg: 268, note: 'cruise altitude into the low sun' },
};
// Target true solar elevation in degrees on the afternoon branch; 'noon' is solar noon + 2 h.
const TIMES = { noon: null, golden: 7, dusk: -3, night: -20 };
// --posefile=<json>: extra poses { name: { lat, lon, altM, headingDeg, note } } merged over the fixed set.
if (typeof args.posefile === 'string') Object.assign(POSES, JSON.parse(fs.readFileSync(path.resolve(args.posefile), 'utf8')));

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
const viewport = { width: Number(args.width || 1600), height: Number(args.height || 900) };

let home;
try { home = path.resolve(execSync('git rev-parse --path-format=absolute --git-common-dir', { encoding: 'utf8' }).trim(), '..'); }
catch { home = path.resolve(__dirname, '..'); }
const root = path.join(home, '.graphics-review', 'look-pass');
const out = path.resolve(typeof args.out === 'string' ? args.out : path.join(root, label));
if (/^baseline(-a)?$/.test(label) && !args.rebaseline && fs.existsSync(path.join(out, 'manifest.json'))) {
  console.error(`Refusing to write into the reference label "${label}". Pass --label=<stream>-wip and --url=http://localhost:<your port>.`);
  process.exit(2);
}
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

// ---- image metrics (file path or PNG buffer) ------------------------------
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
  const shots = poseNames.flatMap(p => timesFor(p).map(t => ({ pose: p, time: t, key: `${p}__${t}` })));
  const BLANK_STD = 2.5, MAX_TRIES = 3, sleep = ms => new Promise(r => setTimeout(r, ms));

  const waited = await acquireSlot();
  console.log(`SLOT ${label} ${path.basename(heldSlot)} after ${waited}ms`);
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  let page = null, current = 'boot';

  async function boot(first) {
    const p = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    p.on('pageerror', e => { report.errors.push({ scene: current, kind: 'pageerror', message: e.message }); save(); });
    p.on('console', m => { const t = m.text(); if (m.type() === 'error' && /shader|WebGL|GLSL|ReferenceError|TypeError/i.test(t)) { report.errors.push({ scene: current, kind: 'console', message: t.slice(0, 2500) }); save(); } else if (m.type() === 'error' && report.warnings.length < 60) report.warnings.push({ scene: current, message: t.slice(0, 600) }); });
    await p.addInitScript(({ quality, sun }) => {
      window.__flyGovPin = 'hold'; window.__flyVisualsOverride = 'enhanced'; window.__flyTitleBypass = true; window.__flyBoostInfinite = true;
      window.__flySunOverride = sun; window.__flyWeatherOverride = 'baseline';
      try {
        localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-quality-tier', quality); localStorage.setItem('fly-controls-seen', '1');
        localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-visuals', 'enhanced');
        localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } }));
      } catch {}
    }, { quality, sun: solve(POSES[first.pose], first.time) });
    await p.route('**/api/aircraft?**', r => r.fulfill({ json: { ac: [], now: Date.now(), total: 0, source: 'look pass' } }));
    await p.route('**/api/weather**', r => r.fulfill({ json: { found: false } }));
    await p.goto(`${url}/?graphicsReview=1${flags ? `&flags=${encodeURIComponent(flags)}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await p.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore, undefined, { timeout: 240000 });
    report.gpu = await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'), e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); });
    if (/swiftshader|llvmpipe|software|basic render/i.test(report.gpu || '')) throw Error(`Software renderer: ${report.gpu}`);
    console.log(`BOOT ${label} ${report.gpu}`);
    await p.evaluate(() => {
      const r = window.__fly, s = window.__flyStore.getState();
      r.operations.phase = 'airborne'; r.operations.profile = null; r.operations.warp(r.flight); s.setHangarOpen(false); s.setPhase('flying');
      const f = r.flight, step = f.step.bind(f);
      f.step = (dt, c) => {
        const h = window.__lookHold;
        step(dt, { ...c, turn: 0, pitch: 0, boost: false });
        if (h) { f.pos.x = h.x; f.pos.y = h.y; f.pos.z = h.z; f.heading = h.heading; f.bank = 0; f.pitch = h.pitch ?? 0.02; f.agl = f.pos.y - f.groundElev; }
      };
      let scene = r.engine.object; while (scene.parent) scene = scene.parent;
      scene.__r3f.root.getState().gl.domElement.setAttribute('data-look-canvas', '');
      Object.defineProperty(r.camera, 'fov', { configurable: true, get: () => 60, set: () => {} }); r.camera.updateProjectionMatrix();
      window.__lookSession = { flight: f, step: f.step };
    });
    return p;
  }

  // '' while the page this session set up is still the page on screen; otherwise the reason it is not.
  const alive = p => p.evaluate(() => {
    const k = window.__lookSession, r = window.__fly;
    if (!k || !r) return 'the page reloaded';
    if (r.flight !== k.flight || r.flight.step !== k.step) return 'the flight runtime was replaced';
    let scene = r.engine.object; while (scene.parent) scene = scene.parent;
    const gl = scene.__r3f?.root?.getState()?.gl, c = gl?.domElement;
    if (!c || !c.isConnected || !c.hasAttribute('data-look-canvas')) return 'the canvas remounted';
    if (gl.getContext().isContextLost()) return 'the WebGL context was lost';
    return '';
  }).catch(e => 'the page went away: ' + String(e.message).split('\n')[0]);

  async function warp(p, shot) {
    const pose = POSES[shot.pose];
    await p.evaluate(({ p, sun }) => {
      const r = window.__fly; window.__lookHold = null; window.__flySunOverride = sun;
      r.warpToGeo(p.lat, p.lon, { altM: p.altM, headingRad: p.headingDeg * Math.PI / 180, name: null }); r.autopilot?.disengage?.();
      const f = r.flight; window.__lookHold = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: p.headingDeg * Math.PI / 180, pitch: p.pitchDeg != null ? p.pitchDeg * Math.PI / 180 : undefined }; r.chaseCam?.snap?.();
    }, { p: pose, sun: solve(pose, shot.time) });
    await p.waitForTimeout(4000);
    const world = await waitWorld(p, Number(args.worldTimeout || 150000));
    console.log(`POSE ${label} ${shot.pose} settled=${world.settled} ${world.ms}ms`);
    return world;
  }

  // Returns '' when the shot is recorded, or the reason it has to be retried in a fresh page.
  async function shoot(p, shot, world, attempt) {
    const pose = POSES[shot.pose], final = attempt >= MAX_TRIES, file = `${shot.key}.png`;
    const utc = solve(pose, shot.time), want = elevationAt(pose, utc);
    await p.evaluate(v => { window.__flySunOverride = v; }, utc);
    await p.waitForFunction(el => Math.abs(Math.asin(window.__fly.sun.sinEl) * 180 / Math.PI - el) < 0.05, want, { timeout: 15000, polling: 250 }).catch(() => report.warnings.push({ scene: current, message: 'sun did not converge' }));
    await p.waitForTimeout(Number(args.settle || 7000));
    if (args['test-reload'] && attempt === 1) await p.reload({ waitUntil: 'domcontentloaded' });
    let why = await alive(p), png = null, metrics = null;
    if (!why) {
      png = await p.screenshot({ timeout: 60000, style: HIDE });
      metrics = await imageMetrics(png);
      why = metrics.frame.lumaStd < BLANK_STD ? 'the frame is blank' : await alive(p);
    }
    if (why && !final) return why;
    if (!png) { png = await p.screenshot({ timeout: 60000, style: HIDE }); metrics = await imageMetrics(png); }
    fs.writeFileSync(path.join(out, file), png);
    const telemetry = await p.evaluate(() => {
      const r = window.__fly, s = window.__flyStore.getState(); let scene = r.engine.object; while (scene.parent) scene = scene.parent;
      const gl = scene.__r3f?.root?.getState()?.gl;
      return { sunElevation: Math.asin(r.sun?.sinEl) * 180 / Math.PI, quality: s.qualityTier, visuals: s.visuals, aglM: r.flight.pos.y - r.flight.groundElev,
        render: gl ? { calls: gl.info.render.calls, triangles: gl.info.render.triangles, programs: gl.info.programs.length, textures: gl.info.memory.textures } : null,
        world: Object.fromEntries(['satBuildings', 'satSkyline', 'satRoads', 'satVeg', 'satClutter', 'parcelHomes'].map(k => [k, r[k]?.stats ? Object.fromEntries(Object.entries(r[k].stats).filter(([, v]) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')) : null])),
        fps: window.__flyStats?.fps ?? null, urlFlags: window.__flyUrlFlags ?? null };
    });
    if (args.dump) { const d = await p.evaluate(() => {
  const R = 6378137, D = 180 / Math.PI, r = window.__fly, eng = r.engine;
  const toGeo = (wx, wz) => [wx / R * D, (2 * Math.atan(Math.exp(-wz / R)) - Math.PI / 2) * D];
  const f = r.flight, lat0 = f.latDeg, k = 1 / Math.cos(lat0 * Math.PI / 180);
  const px = f.pos.x, pz = f.pos.z;
  const out = { lat0, k, player: [px, pz], buildings: [], trees: [], anchor: r.origin?.anchor ?? null };
  const sb = r.satBuildings;
  let considered = 0;
  if (sb?.chunks) for (const [key, c] of sb.chunks) {
    if (!c.mesh || !c.drapeRuns) continue;
    const p = c.mesh.geometry.attributes.position.array, ox = c.mesh.position.x, oz = c.mesh.position.z;
    for (const run of c.drapeRuns) {
      if (considered > 4000) break;
      let minY = Infinity, maxY = -Infinity;
      for (let i = run.start; i < run.end; i++) { const y = p[i * 3 + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      if (!(minY < run.ground)) continue; // elevated / bridge
      const seen = new Set(); let gmin = Infinity, gmax = -Infinity, cnt = 0;
      for (let i = run.start; i < run.end; i++) {
        if (Math.abs(p[i * 3 + 1] - minY) > 0.05) continue;
        const x = p[i * 3], z = p[i * 3 + 2], kk = x.toFixed(1) + ',' + z.toFixed(1);
        if (seen.has(kk)) continue; seen.add(kk);
        const [lon, lat] = toGeo(ox + x, oz + z); const g = eng.getGroundAt(lon, lat);
        if (!g || !Number.isFinite(g.elev)) continue;
        gmin = Math.min(gmin, g.elev); gmax = Math.max(gmax, g.elev); cnt++;
      }
      if (!cnt) continue; considered++;
      const [lon, lat] = toGeo(ox + run.ax, oz + run.az);
      out.buildings.push([+lon.toFixed(6), +lat.toFixed(6), +(run.ground).toFixed(2), +minY.toFixed(2), +gmin.toFixed(2), +gmax.toFixed(2), +(maxY - minY).toFixed(1), cnt, +Math.hypot(ox + run.ax - px, oz + run.az - pz).toFixed(0)]);
    }
  }
  const sv = window.__satVeg?.engine;
  if (sv?.chunks) for (const [key, c] of sv.chunks) {
    if (!c.veg || c.cx === undefined) continue;
    for (let i = 0; i < c.veg.length; i += 4) {
      const wx = c.cx + c.veg[i], wz = c.cz + c.veg[i + 1];
      if (Math.hypot(wx - px, wz - pz) > 2500) continue;
      const [lon, lat] = toGeo(wx, wz);
      out.trees.push([+lon.toFixed(7), +lat.toFixed(7), +c.veg[i + 2].toFixed(1), c.veg[i + 3], c.cls ? c.cls[i / 4] : -1]);
    }
  }
  const B = out.buildings;
  const exposed = B.filter(b => b[4] < b[3] - 0.01), buried = B.filter(b => b[5] - b[2] > 3);
  out.summary = { buildings: B.length, sinkUnits: B.length ? +(B[0][2] - B[0][3]).toFixed(2) : null,
    exposedUnderside: exposed.length, exposedMaxUnits: exposed.length ? +Math.max(...exposed.map(b => b[3] - b[4])).toFixed(1) : 0,
    uphillBuriedOver3: buried.length, buriedMaxUnits: buried.length ? +Math.max(...buried.map(b => b[5] - b[2])).toFixed(1) : 0,
    spanOver2: B.filter(b => b[5] - b[4] > 2).length, trees: out.trees.length, groundElev: f.groundElev, vegChunks: sv?.chunks?.size ?? null };
  return out;
}).catch(e => ({ error: e.message })); fs.writeFileSync(path.join(out, shot.key + '.dump.json'), JSON.stringify(d)); console.log('DUMP ' + shot.key + ' ' + JSON.stringify(d.summary || d.error)); }
    const burst = args.burst && !why ? await burstMetric(p).catch(e => ({ error: e.message })) : null;
    if (burst && !final) { const after = await alive(p); if (after) return `${after} during the motion burst`; }
    report.captures = report.captures.filter(c => c.file !== file); captured++;
    const entry = { pose: shot.pose, time: shot.time, file, utc, burst, iso: new Date(utc).toISOString(), worldSettled: world.settled, attempts: attempt, telemetry, metrics };
    if (why) { entry.blank = why; report.errors.push({ scene: shot.key, kind: 'bad-frame', message: `${why} on all ${MAX_TRIES} attempts; this frame is not usable evidence` }); }
    report.captures.push(entry); save();
    if (why) console.log(`BAD FRAME ${label} ${file}: ${why} on all ${MAX_TRIES} attempts. Not usable as evidence: read the errors array in manifest.json, fix the cause and capture it again.`);
    else console.log(`CAPTURE ${label} ${file} el=${telemetry.sunElevation.toFixed(2)} calls=${telemetry.render?.calls} tris=${telemetry.render?.triangles}${burst ? ` sparkle=${burst.sparklePct ?? burst.error}%` : ''}`);
    return '';
  }

  try {
    const tries = new Map(); let lastPose = null, world = null, restarts = 0;
    for (let i = 0; i < shots.length;) {
      const shot = shots[i], attempt = (tries.get(shot.key) || 0) + 1; tries.set(shot.key, attempt);
      let why;
      try {
        if (!page) { current = 'boot'; page = await boot(shot); lastPose = null; }
        if (lastPose !== shot.pose) { current = shot.pose; world = await warp(page, shot); lastPose = shot.pose; }
        current = shot.key;
        why = await shoot(page, shot, world, attempt);
      } catch (e) {
        if (attempt >= MAX_TRIES) throw e;
        why = 'error: ' + String(e.message).split('\n')[0];
      }
      if (!why) { i++; continue; }
      console.log(`RETRY ${label} ${shot.key}: ${why} (attempt ${attempt} of ${MAX_TRIES}). If a source file was edited while this capture ran, the hot reload is the cause: wait for DONE before editing.`);
      report.warnings.push({ scene: shot.key, message: `retry ${attempt}: ${why}` }); save();
      if (page) await page.close().catch(() => {});
      page = null;
      if (++restarts > 10) throw Error('More than 10 page restarts in one capture run');
      await sleep(6000);
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
