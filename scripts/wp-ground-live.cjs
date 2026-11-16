/** WORLD PASS E (GROUND): live tree census at a pose (adapted from scripts/world-pass-budget.cjs:
 * the same boot, warp, settle path and the same three-slot GPU lock). Per pose: draw calls and triangles
 * (renderer info), and per tree layer (WpCanopyLayer near / far, the legacy SatVeg pool, LivingForest)
 * meshes, instances, triangles and bytes; writes <out>/<pose>.dump.json with every drawn tree within
 * 1.3 km as [lon, lat, radiusM, layer] for scripts/wp-ground-canopy-dump.mjs.
 *
 *   node scripts/wp-ground-live.cjs --url=http://localhost:3325 --pose=central-park --quality=ultra --flags=WORLD_GROUND --out=<dir>
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
const save = () => fs.writeFileSync(path.join(out, `live-${quality}.json`), JSON.stringify(report, null, 2));

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
      // WP GROUND: wait for the canopy's photo looks, then read trees, draws and memory.
      await p.waitForFunction(() => { const c = window.__wpCanopy?.stats; return !c || (c.chunks > 0 && c.looks >= c.chunks) || c.chunks === 0; }, undefined, { timeout: 60000, polling: 1000 }).catch(() => null);
      await p.waitForTimeout(2500);
      const m = await p.evaluate(() => {
        const r = window.__fly; let scene = r.engine.object; while (scene.parent) scene = scene.parent;
        const gl = scene.__r3f.root.getState().gl;
        const R = 6378137, D = 180 / Math.PI, f = r.flight, px = f.pos.x, pz = f.pos.z, k = 1 / Math.cos(f.latDeg * Math.PI / 180);
        const toGeo = (wx, wz) => [wx / R * D, (2 * Math.atan(Math.exp(-wz / R)) - Math.PI / 2) * D];
        const trees = [];
        const layers = {};
        const add = (name, mesh, radiusOf) => {
          if (!mesh || !mesh.visible) return;
          const geo = mesh.geometry; const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
          const L = layers[name] ??= { meshes: 0, instances: 0, triangles: 0, bytes: 0 };
          L.meshes++; L.instances += mesh.count; L.triangles += tris * mesh.count;
          L.bytes += mesh.instanceMatrix.array.byteLength + (mesh.instanceColor?.array.byteLength ?? 0);
          for (const a of Object.values(geo.attributes)) L.bytes += a.array?.byteLength ?? 0;
          if (geo.index) L.bytes += geo.index.array.byteLength;
          const a = mesh.instanceMatrix.array;
          // Every tree pool lives in worldRoot with ABSOLUTE positions (worldRoot carries -anchor).
          const ox = mesh.position.x, oz = mesh.position.z;
          for (let i = 0; i < mesh.count; i++) {
            const sx = Math.hypot(a[i * 16], a[i * 16 + 2]); if (sx < 1e-3) continue;
            const wx = ox + a[i * 16 + 12], wz = oz + a[i * 16 + 14];
            if (Math.hypot(wx - px, wz - pz) > 1300 * k) continue;
            const [lon, lat] = toGeo(wx, wz); trees.push([+lon.toFixed(7), +lat.toFixed(7), +(radiusOf(sx, mesh) / k).toFixed(2), name]);
          }
        };
        const wp = window.__wpCanopy;
        if (wp) { add('wp-near', wp.meshes.near, (s) => s); add('wp-far', wp.meshes.far, (s) => s); }
        add('satveg', window.__satVeg?.mesh, (s) => s);
        scene.traverse((n) => { if (n.isInstancedMesh && /^forest:/.test(n.name)) { n.geometry.computeBoundingBox?.(); const b = n.geometry.boundingBox; const rr = b ? Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2 : 0.5; add('living-forest', n, (s) => s * rr); } });
        // Ground contact: the drawn-mesh ground under a sample of drawn crowns vs the crown base.
        const contact = { n: 0, buriedOver1m: 0, floatingOver1m: 0, maxBuried: 0, maxFloat: 0, samples: [] };
        const cm = wp?.meshes.near;
        if (cm) { const a = cm.instanceMatrix.array, step = Math.max(1, Math.floor(cm.count / 400)); for (let i = 0; i < cm.count; i += step) { const wx = cm.position.x + a[i * 16 + 12], wz = cm.position.z + a[i * 16 + 14], base = a[i * 16 + 13]; const [lon, lat] = toGeo(wx, wz); const g = r.engine.getGroundAt(lon, lat); if (!g || !Number.isFinite(g.elev)) continue; const d = base - g.elev; contact.n++; if (d < -1) contact.buriedOver1m++; if (d > 1) contact.floatingOver1m++; contact.maxBuried = Math.max(contact.maxBuried, -d); contact.maxFloat = Math.max(contact.maxFloat, d); if (contact.samples.length < 8) contact.samples.push({ d: +d.toFixed(2), sxz: +Math.hypot(a[i * 16], a[i * 16 + 2]).toFixed(2), sy: +a[i * 16 + 5].toFixed(2), dist: +Math.hypot(wx - px, wz - pz).toFixed(0), tileZ: g.tileZ }); } }
        return { contact, anchor: r.origin?.anchor ?? null, draws: gl.info.render.calls, triangles: gl.info.render.triangles, layers, wpStats: wp?.stats ?? null, forest: r.earthSurface?.forest?.stats ?? null, player: [px, pz], lat: f.latDeg, trees, veg: r.satVeg?.stats ? Object.fromEntries(Object.entries(r.satVeg.stats).filter(([, v]) => typeof v !== 'object')) : null };
      });
      const dumpFile = path.join(out, `${name}.dump.json`);
      fs.writeFileSync(dumpFile, JSON.stringify({ player: m.player, lat0: m.lat, trees: m.trees }));
      delete m.trees;
      report.poses.push({ pose: name, settled, settleMs, ...m }); save();
      console.log(name, JSON.stringify({ contact: m.contact, draws: m.draws, tris: m.triangles, layers: m.layers, wp: m.wpStats, forest: m.forest && { patches: m.forest.patches, draws: m.forest.draws, triangles: m.forest.triangles, replacedBy: m.forest.replacedBy } }));
    }
  } catch (e) { report.errors.push('fatal ' + e.message); console.error(e); }
  finally { save(); await browser.close(); releaseSlot(); console.log('DONE', out); }
})();
