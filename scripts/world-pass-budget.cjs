/** WORLD PASS budget tool (FLY_WORLD_PASS.md, "Budget"): what the satellite world costs at a pose.
 * Adapted from scripts/wp-probe-perf-budget.cjs: the same boot / warp / settle path as
 * scripts/look-pass-capture.cjs and the same three-slot GPU lock under
 * <main checkout>/.graphics-review/look-pass/.locks. Installed Chrome, D3D11, live world.
 * Evidence for ratios between arms on one machine, never an fps verdict.
 *
 *   node scripts/world-pass-budget.cjs --url=http://localhost:3320 --pose=nyc-low,paris --quality=ultra \
 *        --flags=WORLD_TRUTH --out=<dir> [--posefile=<json>] [--settleTimeout=180000] [--label=base]
 *
 * --pose (or --poses): comma list from the fixed set below + scripts/world-pass-poses.json (+ --posefile).
 * Per pose: draws and triangles (renderer info), geometry MiB by layer (attribute + index arrays of every
 * unique geometry: buildings, horizon/skyline, veg/trees, roads, terrain, other), JS heap, the building and
 * skyline engines' arrival counters (seconds from the warp to the first detailed tile and to a full ring,
 * tiles stuck draping, non-finite drape restarts, finalize ms, resident geometry bytes), and the main-thread
 * getGroundAt cost in microseconds (20,000 warm calls within 2.5 km). Writes <out>/budget-<quality>.json.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { register } = require('node:module');

const args = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
// The look-pass-capture fixed set (the poses the harness owns) + the World Pass review poses.
const POSES = Object.assign({
  'nyc-street': { lat: 40.7311, lon: -73.9892, altM: 543, headingDeg: 6 },
  'nyc-harbor': { lat: 40.6890, lon: -74.0280, altM: 420, headingDeg: 30 },
  'nyc-cruise': { lat: 40.62, lon: -74.08, altM: 7000, headingDeg: 30 },
  powell: { lat: 40.1990, lon: -83.0811, altM: 630, headingDeg: 339 },
  yosemite: { lat: 37.72, lon: -119.66, altM: 2850, headingDeg: 76 },
  alps: { lat: 46.5935, lon: 7.9091, altM: 3150, headingDeg: 185 },
  rio: { lat: -22.94, lon: -43.14, altM: 1100, headingDeg: 260 },
}, JSON.parse(fs.readFileSync(path.join(__dirname, 'world-pass-poses.json'), 'utf8')));
if (typeof args.posefile === 'string') Object.assign(POSES, JSON.parse(fs.readFileSync(path.resolve(args.posefile), 'utf8')));
const url = typeof args.url === 'string' ? args.url : 'http://localhost:3320';
const quality = typeof args.quality === 'string' ? args.quality : 'ultra';
const flags = typeof args.flags === 'string' ? args.flags : '';
const label = typeof args.label === 'string' ? args.label : 'budget';
const poseArg = String(args.pose || args.poses || 'nyc-low');
const poses = poseArg.split(',').map((s) => s.trim()).filter(Boolean);
const unknown = poses.filter((p) => !POSES[p]);
if (unknown.length) { console.error(`Unknown pose(s): ${unknown.join(', ')}`); process.exit(2); }
if (typeof args.out !== 'string') { console.error('--out=<dir> is required'); process.exit(2); }
const out = path.resolve(args.out);
fs.mkdirSync(out, { recursive: true });
const report = { tool: 'world-pass-budget', label, url, quality, flags, date: new Date().toISOString(), viewport: { width: 1600, height: 900 }, venue: 'Installed Chrome / D3D11 / live world; fixed pose, noon + 2 h', poses: [], errors: [] };
const save = () => fs.writeFileSync(path.join(out, `budget-${quality}.json`), JSON.stringify(report, null, 2));

let home;
try { home = path.resolve(execSync('git rev-parse --path-format=absolute --git-common-dir', { encoding: 'utf8' }).trim(), '..'); } catch { home = path.resolve(__dirname, '..'); }
const lockDir = path.join(home, '.graphics-review', 'look-pass', '.locks');
fs.mkdirSync(lockDir, { recursive: true });
let heldSlot = null;
async function acquireSlot() {
  const t0 = Date.now();
  for (;;) {
    for (let i = 0; i < Number(args.slots || 3); i++) {
      const p = path.join(lockDir, `slot-${i}`);
      try { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'owner.txt'), `world-pass-budget ${label} pid ${process.pid} ${new Date().toISOString()}`); heldSlot = p; return Date.now() - t0; }
      catch { try { if (Date.now() - fs.statSync(p).mtimeMs > 25 * 60 * 1000) fs.rmSync(p, { recursive: true, force: true }); } catch {} }
    }
    if (Date.now() - t0 > 40 * 60 * 1000) throw Error('No GPU capture slot within 40 minutes');
    await new Promise((r) => setTimeout(r, 4000));
  }
}
const releaseSlot = () => { if (heldSlot) { try { fs.rmSync(heldSlot, { recursive: true, force: true }); } catch {} heldSlot = null; } };
process.on('exit', releaseSlot);
process.on('SIGINT', () => { releaseSlot(); process.exit(130); });

(async () => {
  register('./_node-resolve.mjs', pathToFileURL(__filename));
  const day = Date.parse('2026-09-22T00:00:00Z');
  const noonOf = (pose) => day + (12 - pose.lon / 15) * 3600000 + 2 * 3600000;
  const waited = await acquireSlot();
  console.log(`SLOT ${path.basename(heldSlot)} after ${waited}ms`);
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--enable-precise-memory-info'] });
  try {
    const p = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 });
    p.on('pageerror', (e) => { report.errors.push(e.message.slice(0, 300)); save(); });
    await p.addInitScript(({ quality, sun }) => {
      window.__flyGovPin = 'hold'; window.__flyVisualsOverride = 'enhanced'; window.__flyTitleBypass = true; window.__flyBoostInfinite = true;
      window.__flySunOverride = sun; window.__flyWeatherOverride = 'baseline';
      try {
        localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-quality-tier', quality); localStorage.setItem('fly-controls-seen', '1');
        localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-visuals', 'enhanced');
        localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } }));
      } catch {}
    }, { quality, sun: noonOf(POSES[poses[0]]) });
    await p.route('**/api/aircraft?**', (r) => r.fulfill({ json: { ac: [], now: Date.now(), total: 0, source: 'world pass budget' } }));
    await p.route('**/api/weather**', (r) => r.fulfill({ json: { found: false } }));
    const t0Boot = Date.now();
    await p.goto(`${url}/?graphicsReview=1${flags ? `&flags=${encodeURIComponent(flags)}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await p.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore, undefined, { timeout: 240000 });
    report.bootMs = Date.now() - t0Boot;
    report.gpu = await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'), e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); });
    if (/swiftshader|llvmpipe|software|basic render/i.test(report.gpu || '')) throw Error(`Software renderer: ${report.gpu}`);
    console.log('BOOT', report.gpu, report.bootMs, 'ms');
    await p.evaluate(() => {
      const r = window.__fly, s = window.__flyStore.getState();
      r.operations.phase = 'airborne'; r.operations.profile = null; r.operations.warp(r.flight); s.setHangarOpen(false); s.setPhase('flying');
      const f = r.flight, step = f.step.bind(f);
      f.step = (dt, c) => { const h = window.__lookHold; step(dt, { ...c, turn: 0, pitch: 0, boost: false }); if (h) { f.pos.x = h.x; f.pos.y = h.y; f.pos.z = h.z; f.heading = h.heading; f.bank = 0; f.pitch = 0.02; f.agl = f.pos.y - f.groundElev; } };
      Object.defineProperty(r.camera, 'fov', { configurable: true, get: () => 60, set: () => {} }); r.camera.updateProjectionMatrix();
    });
    for (const name of poses) {
      const pose = POSES[name];
      await p.evaluate(({ pose, sun }) => {
        const r = window.__fly; window.__lookHold = null; window.__flySunOverride = sun;
        r.warpToGeo(pose.lat, pose.lon, { altM: pose.altM, headingRad: pose.headingDeg * Math.PI / 180, name: null }); r.autopilot?.disengage?.();
        const f = r.flight; window.__lookHold = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: pose.headingDeg * Math.PI / 180 }; r.chaseCam?.snap?.();
      }, { pose, sun: noonOf(pose) });
      const t0 = Date.now();
      await p.waitForTimeout(4000);
      const settled = await p.waitForFunction(() => {
        const r = window.__fly; if (!r || r.worldLoading || !r.terraStats?.sharp) return false;
        for (const k of ['satBuildings', 'satSkyline', 'satRoads', 'satVeg']) { const s = r[k]?.stats; if (s && ['queued', 'building', 'sampling', 'draping', 'births', 'dying'].some((f) => Number(s[f] || 0) !== 0)) return false; }
        return true;
      }, undefined, { timeout: Number(args.settleTimeout || 180000), polling: 1000 }).then(() => true, () => false);
      const settleMs = Date.now() - t0;
      console.log('POSE', name, 'settled', settled, settleMs, 'ms');
      await p.waitForTimeout(3000);
      const m = await p.evaluate(() => {
        const r = window.__fly; let scene = r.engine.object; while (scene.parent) scene = scene.parent;
        const gl = scene.__r3f.root.getState().gl;
        const groups = { buildings: r.satBuildings?.object, horizon: r.satSkyline?.object, roads: r.satRoads?.object, terrain: r.engine?.object, clutter: r.satClutter?.object, veg: r.satVeg?.object };
        const owner = new Map();
        for (const [g, o] of Object.entries(groups)) o?.traverse?.((n) => { if (!owner.has(n)) owner.set(n, g); });
        const seen = new Set(), bytes = {}, tris = {};
        const geomBytes = (geo) => { let b = 0; for (const a of Object.values(geo.attributes)) b += a.array?.byteLength ?? (a.data?.array?.byteLength ?? 0); if (geo.index) b += geo.index.array.byteLength; return b; };
        scene.traverse((n) => {
          if (!n.isMesh && !n.isPoints && !n.isLine) return;
          let g = owner.get(n) ?? 'other';
          if (g === 'other') { let q = n; while (q && g === 'other') { if (/veg|tree|canopy|forest/i.test(q.name || '')) g = 'veg'; q = q.parent; } }
          const geo = n.geometry; if (!geo) return;
          const t = (geo.index ? geo.index.count : (geo.attributes.position?.count ?? 0)) / 3;
          const ic = n.isInstancedMesh ? n.count : 1;
          if (n.isMesh && n.visible) tris[g] = (tris[g] || 0) + Math.min(t, (geo.drawRange.count === Infinity ? t * 3 : geo.drawRange.count) / 3) * ic;
          if (n.isInstancedMesh) bytes[g] = (bytes[g] || 0) + n.instanceMatrix.array.byteLength + (n.instanceColor?.array.byteLength || 0);
          if (seen.has(geo)) return; seen.add(geo);
          bytes[g] = (bytes[g] || 0) + geomBytes(geo);
        });
        // main-thread ground query cost (same sampler as wp-probe-perf-budget.cjs)
        const g0 = r.engine.worldToGeo(r.flight.pos), lon0 = g0.x, lat0 = g0.y;
        let rnd = 12345; const rand = () => (rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        const pts = []; for (let i = 0; i < 20000; i++) { const a = rand() * 6.283, d = Math.sqrt(rand()) * 2500; pts.push([lon0 + d * Math.cos(a) / (111320 * Math.cos(lat0 * Math.PI / 180)), lat0 + d * Math.sin(a) / 110540]); }
        for (const [x, y] of pts) r.engine.getGroundAt(x, y);
        let hits = 0; const tq = performance.now(); for (const [x, y] of pts) { const s = r.engine.getGroundAt(x, y); if (s && Number.isFinite(s.elev)) hits++; }
        const groundUs = (performance.now() - tq) / pts.length * 1000;
        const pick = (s) => s ? Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === 'number' || typeof v === 'boolean')) : null;
        const MiB = (v) => +((v || 0) / 1048576).toFixed(1);
        return {
          aglM: +(r.flight.pos.y - r.flight.groundElev).toFixed(0),
          draws: gl.info.render.calls, triangles: gl.info.render.triangles, programs: gl.info.programs?.length ?? null,
          geometryMiB: { buildings: MiB(bytes.buildings), horizon: MiB(bytes.horizon), veg: MiB(bytes.veg), roads: MiB(bytes.roads), clutter: MiB(bytes.clutter), terrain: MiB(bytes.terrain), other: MiB(bytes.other), total: MiB(Object.values(bytes).reduce((a, b) => a + b, 0)) },
          trisByGroup: Object.fromEntries(Object.entries(tris).map(([k, v]) => [k, Math.round(v)])),
          heapMiB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null,
          arrival: {
            buildings: { firstTileSec: r.satBuildings?.stats?.firstTileSec ?? null, fullRingSec: r.satBuildings?.stats?.fullRingSec ?? null, stuck: r.satBuildings?.stats?.drapeStuck ?? null, nonFiniteRestarts: r.satBuildings?.stats?.drapeNonFiniteRestarts ?? null, finalizeMsMax: r.satBuildings?.stats?.finalizeMsMax ?? null, geomMiB: MiB(r.satBuildings?.stats?.geomBytes) },
            horizon: { firstTileSec: r.satSkyline?.stats?.firstTileSec ?? null, fullRingSec: r.satSkyline?.stats?.fullRingSec ?? null, stuck: r.satSkyline?.stats?.drapeStuck ?? null, nonFiniteRestarts: r.satSkyline?.stats?.drapeNonFiniteRestarts ?? null, finalizeMsMax: r.satSkyline?.stats?.finalizeMsMax ?? null, geomMiB: MiB(r.satSkyline?.stats?.geomBytes) },
          },
          groundQuery: { usPerQuery: +groundUs.toFixed(2), hitFrac: +(hits / pts.length).toFixed(3) },
          worldPass: window.__flyStats?.worldPass?.state ?? null,
          stats: { buildings: pick(r.satBuildings?.stats), horizon: pick(r.satSkyline?.stats) },
        };
      });
      report.poses.push({ pose: name, settled, settleMs, ...m }); save();
      console.log(name, JSON.stringify({ draws: m.draws, tris: m.triangles, geo: m.geometryMiB, arrival: m.arrival.buildings, ground: m.groundQuery.usPerQuery, heap: m.heapMiB, wp: m.worldPass?.key }));
    }
  } catch (e) { report.errors.push('fatal ' + e.message); console.error(e); }
  finally { save(); await browser.close(); releaseSlot(); console.log('DONE', out); }
})();
