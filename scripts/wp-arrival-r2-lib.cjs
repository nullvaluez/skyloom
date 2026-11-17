/** WORLD PASS B r2: the shared boot / warp / GPU-slot helpers of the wp-arrival-r2-* probes.
 * Same boot path, pins and three-slot lock as scripts/world-pass-budget.cjs and look-pass-capture.cjs
 * (installed Chrome, D3D11, live world, 1600 x 900, Ultra unless --quality). Evidence for ratios
 * between arms on one shared machine, never an fps verdict.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const args = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const POSES = Object.assign({ powell: { lat: 40.199, lon: -83.0811, altM: 630, headingDeg: 339 } },
  JSON.parse(fs.readFileSync(path.join(__dirname, 'world-pass-poses.json'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(__dirname, 'wp-arrival-poses.json'), 'utf8')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = Date.parse('2026-09-22T00:00:00Z');
const noonOf = (pose) => day + (12 - pose.lon / 15) * 3600000 + 2 * 3600000;

let home;
try { home = path.resolve(execSync('git rev-parse --path-format=absolute --git-common-dir', { encoding: 'utf8' }).trim(), '..'); } catch { home = path.resolve(__dirname, '..'); }
const lockDir = path.join(home, '.graphics-review', 'look-pass', '.locks');
fs.mkdirSync(lockDir, { recursive: true });
let heldSlot = null;
async function acquireSlot(label) {
  const t0 = Date.now();
  for (;;) {
    for (let i = 0; i < 3; i++) {
      const p = path.join(lockDir, `slot-${i}`);
      try { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'owner.txt'), `${label} pid ${process.pid} ${new Date().toISOString()}`); heldSlot = p; return Date.now() - t0; }
      catch { try { if (Date.now() - fs.statSync(p).mtimeMs > 25 * 60 * 1000) fs.rmSync(p, { recursive: true, force: true }); } catch {} }
    }
    if (Date.now() - t0 > 40 * 60 * 1000) throw Error('No GPU capture slot within 40 minutes');
    await sleep(4000);
  }
}
const releaseSlot = () => { if (heldSlot) { try { fs.rmSync(heldSlot, { recursive: true, force: true }); } catch {} heldSlot = null; } };
process.on('exit', releaseSlot);
process.on('SIGINT', () => { releaseSlot(); process.exit(130); });

async function launch() {
  return chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--enable-precise-memory-info'] });
}

/** Boot one page with the probe pins, the flag arm, and the hold-the-aircraft hook. */
async function boot(browser, { url, flags = '', quality = 'ultra', firstPose, errors, consoleErrors, init }) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
  if (consoleErrors) page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 400)); });
  await page.addInitScript(({ quality, sun }) => {
    window.__flyGovPin = 'hold'; window.__flyVisualsOverride = 'enhanced'; window.__flyTitleBypass = true; window.__flyBoostInfinite = true;
    window.__flySunOverride = sun; window.__flyWeatherOverride = 'baseline'; window.__flyWorldPassCounters = true;
    try {
      localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-quality-tier', quality); localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-visuals', 'enhanced');
      localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } }));
    } catch {}
  }, { quality, sun: noonOf(firstPose) });
  if (init) await page.addInitScript(init);
  await page.route('**/api/aircraft?**', (r) => r.fulfill({ json: { ac: [], now: Date.now(), total: 0, source: 'wp-arrival r2' } }));
  await page.route('**/api/weather**', (r) => r.fulfill({ json: { found: false } }));
  await page.goto(`${url}/?graphicsReview=1${flags ? `&flags=${encodeURIComponent(flags)}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore && !!window.__fly.engine, undefined, { timeout: 240000 });
  const gpu = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'), e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); });
  if (/swiftshader|llvmpipe|software|basic render/i.test(gpu || '')) throw Error(`Software renderer: ${gpu}`);
  await page.evaluate(() => {
    const r = window.__fly, s = window.__flyStore.getState();
    r.operations.phase = 'airborne'; r.operations.profile = null; r.operations.warp(r.flight); s.setHangarOpen(false); s.setPhase('flying');
    const f = r.flight, step = f.step.bind(f);
    f.step = (dt, c) => {
      const h = window.__lookHold;
      step(dt, { ...c, turn: 0, pitch: 0, boost: false });
      if (h) {
        if (h.v) { const k = 1 / Math.cos(2 * Math.atan(Math.exp(-h.z / 6378137)) - Math.PI / 2); h.x += Math.sin(h.heading) * h.v * k * dt; h.z += -Math.cos(h.heading) * h.v * k * dt; }
        f.pos.x = h.x; f.pos.y = h.y; f.pos.z = h.z; f.heading = h.heading; f.bank = 0; f.pitch = 0.02; f.agl = f.pos.y - f.groundElev;
      }
    };
    Object.defineProperty(r.camera, 'fov', { configurable: true, get: () => 60, set: () => {} }); r.camera.updateProjectionMatrix();
  });
  return { page, gpu };
}

async function warp(page, pose) {
  await page.evaluate(({ pose, sun }) => {
    const r = window.__fly; window.__lookHold = null; window.__flySunOverride = sun;
    r.warpToGeo(pose.lat, pose.lon, { altM: pose.altM, headingRad: pose.headingDeg * Math.PI / 180, name: null }); r.autopilot?.disengage?.();
    const f = r.flight; window.__lookHold = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: pose.headingDeg * Math.PI / 180 }; r.chaseCam?.snap?.();
  }, { pose, sun: noonOf(pose) });
}

async function settle(page, timeoutMs = 180000) {
  return page.waitForFunction(() => {
    const r = window.__fly; if (!r || r.worldLoading || !r.terraStats?.sharp) return false;
    for (const k of ['satBuildings', 'satSkyline', 'satRoads', 'satVeg']) { const s = r[k]?.stats; if (s && ['queued', 'building', 'sampling', 'draping', 'births', 'dying'].some((f) => Number(s[f] || 0) !== 0)) return false; }
    return true;
  }, undefined, { timeout: timeoutMs, polling: 1000 }).then(() => true, () => false);
}

/** Geometry bytes by layer: the CPU arrays (world-pass-budget's count) and a GPU estimate
 *  (a 3-component 8- or 16-bit attribute is stored as 4 components under ANGLE / D3D11). */
async function geometry(page) {
  return page.evaluate(() => {
    const r = window.__fly; let scene = r.engine.object; while (scene.parent) scene = scene.parent;
    const gl = scene.__r3f.root.getState().gl;
    const groups = { buildings: r.satBuildings?.object, horizon: r.satSkyline?.object, roads: r.satRoads?.object, terrain: r.engine?.object, clutter: r.satClutter?.object, veg: r.satVeg?.object };
    const owner = new Map();
    for (const [g, o] of Object.entries(groups)) o?.traverse?.((n) => { if (!owner.has(n)) owner.set(n, g); });
    const seen = new Set(), cpu = {}, gpu = {};
    const attrGpu = (a) => { const arr = a.array ?? a.data?.array; if (!arr) return 0; const bpe = arr.BYTES_PER_ELEMENT, n = a.count ?? arr.length / a.itemSize; const c = a.itemSize === 3 && bpe < 4 ? 4 : a.itemSize; return a.isInterleavedBufferAttribute ? arr.byteLength : n * c * bpe; };
    scene.traverse((n) => {
      if (!n.isMesh && !n.isPoints && !n.isLine) return;
      let g = owner.get(n) ?? 'other';
      if (g === 'other') { let q = n; while (q && g === 'other') { if (/veg|tree|canopy|forest/i.test(q.name || '')) g = 'veg'; q = q.parent; } }
      const geo = n.geometry; if (!geo) return;
      if (n.isInstancedMesh) { const b = n.instanceMatrix.array.byteLength + (n.instanceColor?.array.byteLength || 0); cpu[g] = (cpu[g] || 0) + b; gpu[g] = (gpu[g] || 0) + b; }
      if (seen.has(geo)) return; seen.add(geo);
      for (const a of Object.values(geo.attributes)) { cpu[g] = (cpu[g] || 0) + (a.array?.byteLength ?? a.data?.array?.byteLength ?? 0); gpu[g] = (gpu[g] || 0) + attrGpu(a); }
      if (geo.index) { cpu[g] = (cpu[g] || 0) + geo.index.array.byteLength; gpu[g] = (gpu[g] || 0) + geo.index.array.byteLength; }
    });
    const MiB = (v) => +((v || 0) / 1048576).toFixed(1);
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    return {
      draws: gl.info.render.calls, triangles: gl.info.render.triangles,
      cpuMiB: { ...Object.fromEntries(Object.entries(cpu).map(([k, v]) => [k, MiB(v)])), total: MiB(sum(cpu)) },
      gpuMiB: { ...Object.fromEntries(Object.entries(gpu).map(([k, v]) => [k, MiB(v)])), total: MiB(sum(gpu)) },
      heapMiB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null,
    };
  });
}

module.exports = { args, POSES, sleep, noonOf, acquireSlot, releaseSlot, launch, boot, warp, settle, geometry };
