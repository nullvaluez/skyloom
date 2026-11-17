/* wp-reach-verify: adversarial probe for stream C (REACH), adapted from scripts/world-pass-budget.cjs (boot/warp/settle path unchanged). */
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
const save = () => fs.writeFileSync(path.join(out, `verify-budget-${label}-${quality}.json`), JSON.stringify(report, null, 2));

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
      try { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'owner.txt'), `wp-reach-verify-budget ${label} pid ${process.pid} ${new Date().toISOString()}`); heldSlot = p; return Date.now() - t0; }
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
    // Round 2: shader compile errors and the stand-in material's anchor warning are console errors.
    p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && /Shader|wp-reach|WebGLProgram/i.test(t)) { report.errors.push('console ' + t.slice(0, 400)); save(); } });
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
      await p.waitForTimeout(Number(args.dwell || 3000)); // round 2: --dwell=<ms> lets the per-building drape finish
      const m = await p.evaluate(async () => {
        // wp-reach-verify: independent count of what the skyline engine submits per frame, in every pass.
        const r = window.__fly; let scene = r.engine.object; while (scene.parent) scene = scene.parent;
        const gl = scene.__r3f.root.getState().gl;
        const e = r.satSkyline;
        const acc = { frames: 0, main: 0, refl: 0, mainMax: 0, totMax: 0, passes: {}, meshDrawsMax: 0 };
        let cur = { main: 0, refl: 0, draws: 0 };
        const wrapped = new WeakSet();
        const wrap = () => {
          for (const c of e.chunks.values()) {
            const mesh = c.mesh; if (!mesh || wrapped.has(mesh)) continue; wrapped.add(mesh);
            const ob = mesh.onBeforeRender;
            mesh.onBeforeRender = function (renderer, sc, cam, geo, mat, grp) {
              ob.call(this, renderer, sc, cam, geo, mat, grp);
              const rt = renderer.getRenderTarget();
              const name = rt ? (rt.texture?.name || 'rt') : 'screen';
              const g = this.geometry;
              const t = g.isInstancedBufferGeometry ? (g.instanceCount || 0) * ((g.index ? g.index.count : 0) / 3) : (g.index ? g.index.count / 3 : (g.attributes.position?.count || 0) / 3);
              const k = name === 'coastal-city-reflection' ? 'refl' : 'main';
              cur[k] += t; cur.draws += 1; acc.passes[name] = (acc.passes[name] || 0) + t;
            };
          }
        };
        await new Promise((res) => {
          let n = 0;
          const tick = () => {
            wrap();
            if (n > 0) { acc.frames++; acc.main += cur.main; acc.refl += cur.refl; acc.mainMax = Math.max(acc.mainMax, cur.main); acc.totMax = Math.max(acc.totMax, cur.main + cur.refl); acc.meshDrawsMax = Math.max(acc.meshDrawsMax, cur.draws); }
            cur = { main: 0, refl: 0, draws: 0 }; n++;
            if (n > 90) res(); else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        for (const k of Object.keys(acc.passes)) acc.passes[k] = Math.round(acc.passes[k] / Math.max(1, acc.frames));
        // Resident memory of the far ring: geometry attribute bytes (shared base box once) + retained JS arrays.
        let gpuBytes = 0, jsBytes = 0, resident = 0, groups = 0, meshes = 0;
        const seenAttr = new Set();
        for (const c of e.chunks.values()) {
          if (!c.mesh) continue; meshes++;
          const geo = c.mesh.geometry;
          for (const a of Object.values(geo.attributes)) { if (seenAttr.has(a)) continue; seenAttr.add(a); gpuBytes += a.array?.byteLength ?? 0; }
          if (geo.index && !seenAttr.has(geo.index)) { seenAttr.add(geo.index); gpuBytes += geo.index.array.byteLength; }
          if (c.standIns) { groups++; resident += c.standIns.n; jsBytes += (c.standIns.size?.byteLength || 0) + (c.standIns.ax?.byteLength || 0) + (c.standIns.az?.byteLength || 0); }
          if (c.drape?.grid) jsBytes += c.drape.grid.byteLength;
        }
        // Drape truth: stand-in ground y against the drawn-mesh ground query at the stand-in's own centre.
        const diffs = [], gaps = [], burys = []; let nonFinite = 0, sampled = 0, noGround = 0;
        for (const c of e.chunks.values()) {
          const S = c.standIns; if (!S || !c.drape) continue;
          const g = e._horizon?.groupN ?? 4;
          const WORLD = (c.drape.gspan * 2 ** c.group.z) / g, R = WORLD / (2 * Math.PI), D = 180 / Math.PI;
          const lim = Math.min(S.n, Math.max(40, c.standInCount || 0));
          const stepI = Math.max(1, Math.floor(lim / 150));
          for (let i = 0; i < lim; i += stepI) {
            const base = S.base.array[i];
            if (!Number.isFinite(base)) { nonFinite++; continue; }
            const wx = c.mesh.position.x + S.ax[i], wz = c.mesh.position.z + S.az[i];
            const s = r.engine.getGroundAt((wx / R) * D, (2 * Math.atan(Math.exp(-wz / R)) - Math.PI / 2) * D);
            sampled++;
            if (!s || !Number.isFinite(s.elev)) { noGround++; continue; }
            diffs.push(base - s.elev);
            // Round 2: the box's four corners on the drawn mesh. gap = how far the wall bottom
            // (base - 6 m sink, SAT_BUILDINGS.baseSinkM) floats over the lowest corner's ground
            // (> 0 = daylight under the downhill wall); bury = how far the highest corner's ground
            // rises over the roof (> 0 = the box is under the hill there).
            const dimA = c.mesh.geometry.attributes.aStandInDim;
            if (dimA) {
              const hu = (dimA.array[i * 4] / 65535) * 1000, hv = (dimA.array[i * 4 + 1] / 65535) * 1000, h = (dimA.array[i * 4 + 2] / 65535) * 1000, yaw = (dimA.array[i * 4 + 3] / 65535) * Math.PI * 2;
              const cy = Math.cos(yaw), sy = Math.sin(yaw);
              let lo = Infinity, hi = -Infinity;
              for (const [u, v] of [[hu, hv], [hu, -hv], [-hu, hv], [-hu, -hv]]) {
                const cx = wx + cy * u - sy * v, cz = wz + sy * u + cy * v;
                const g = r.engine.getGroundAt((cx / R) * D, (2 * Math.atan(Math.exp(-cz / R)) - Math.PI / 2) * D);
                if (g && Number.isFinite(g.elev)) { lo = Math.min(lo, g.elev); hi = Math.max(hi, g.elev); }
              }
              if (Number.isFinite(lo)) { gaps.push(base - 6 - lo); burys.push(hi - (base + h)); }
            }
          }
        }
        const abs = diffs.map(Math.abs).sort((a, b) => a - b);
        const q = (f) => abs.length ? +abs[Math.min(abs.length - 1, Math.floor(f * abs.length))].toFixed(1) : null;
        const sinkN = diffs.filter((d) => d < -5).length, floatN = diffs.filter((d) => d > 5).length;
        const gq = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(f * s.length))].toFixed(1) : null; };
        const pick = (s) => s ? Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === 'number' || typeof v === 'boolean')) : null;
        return {
          aglM: +(r.flight.pos.y - r.flight.groundElev).toFixed(0),
          reach: !!e._reach,
          draws: gl.info.render.calls, triangles: gl.info.render.triangles,
          skyline: { frames: acc.frames, mainTrisAvg: Math.round(acc.main / Math.max(1, acc.frames)), reflTrisAvg: Math.round(acc.refl / Math.max(1, acc.frames)), mainTrisMax: acc.mainMax, allPassTrisMax: acc.totMax, passes: acc.passes, meshDrawsPerFrameMax: acc.meshDrawsMax },
          resident: { meshes, standInGroups: groups, standIns: resident, gpuMiB: +(gpuBytes / 1048576).toFixed(1), jsMiB: +(jsBytes / 1048576).toFixed(1), totalMiB: +((gpuBytes + jsBytes) / 1048576).toFixed(1) },
          drape: { sampled, nonFinite, noGround, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), sinkOver5m: sinkN, floatOver5m: floatN, cornerGapP95: gq(gaps, 0.95), cornerGapMax: gq(gaps, 1), floatingOver1m: gaps.filter((g) => g > 1).length, buriedOver0m: burys.filter((b) => b > 0).length, cornerSamples: gaps.length },
          budget: e._standInStat ? { ...e._standInStat, reflH: e._standInView?.reflH ?? null, factor: e._standInK } : null,
          refl: r.coastalReflection ? { active: r.coastalReflection.active, height: r.coastalReflection.height } : null,
          arrival: { firstTileSec: e.stats?.firstTileSec ?? null, fullRingSec: e.stats?.fullRingSec ?? null },
          stats: pick(e.stats),
        };
      });
      report.poses.push({ pose: name, settled, settleMs, ...m }); save();
      console.log(name, JSON.stringify(m));
    }
  } catch (e) { report.errors.push('fatal ' + e.message); console.error(e); }
  finally { save(); await browser.close(); releaseSlot(); console.log('DONE', out); }
})();
