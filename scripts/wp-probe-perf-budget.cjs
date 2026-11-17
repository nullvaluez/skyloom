/** World Pass skeptic (perf): what the satellite world costs today, measured in the live page.
 * Copy of the boot/warp/settle path of scripts/look-pass-capture.cjs (same GPU slot lock).
 *   node scripts/wp-probe-perf-budget.cjs --url=http://localhost:3320 --poses=paris,tokyo --quality=ultra --out=<dir>
 * Per pose it records: GPU geometry bytes by layer (attribute + index arrays of every unique
 * geometry in the scene), building chunk vertex layout, castShadow triangle sums, cascades,
 * main-thread getGroundAt cost, raw WebGL bufferData cost, Esri imagery zooms the terrain
 * fetched (resource timing) with distance from the camera, rAF intervals, JS heap, storage.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { register } = require('node:module');

const args = Object.fromEntries(process.argv.slice(2).map(s => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const POSES = Object.assign({
  'nyc-street': { lat: 40.7311, lon: -73.9892, altM: 543, headingDeg: 6 },
}, JSON.parse(fs.readFileSync(path.join(__dirname, 'world-pass-poses.json'), 'utf8')));
const url = args.url || 'http://localhost:3320';
const quality = args.quality || 'ultra';
const poses = String(args.poses || 'paris').split(',').filter(p => POSES[p]);
const out = path.resolve(String(args.out));
fs.mkdirSync(out, { recursive: true });
const report = { url, quality, poses: [], errors: [] };
const save = () => fs.writeFileSync(path.join(out, `budget-${quality}.json`), JSON.stringify(report, null, 2));

let home;
try { home = path.resolve(execSync('git rev-parse --path-format=absolute --git-common-dir', { encoding: 'utf8' }).trim(), '..'); } catch { home = path.resolve(__dirname, '..'); }
const lockDir = path.join(home, '.graphics-review', 'look-pass', '.locks');
fs.mkdirSync(lockDir, { recursive: true });
let heldSlot = null;
async function acquireSlot() {
  const t0 = Date.now();
  for (;;) {
    for (let i = 0; i < 3; i++) {
      const p = path.join(lockDir, `slot-${i}`);
      try { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'owner.txt'), `perf-skeptic pid ${process.pid} ${new Date().toISOString()}`); heldSlot = p; return Date.now() - t0; }
      catch { try { if (Date.now() - fs.statSync(p).mtimeMs > 25 * 60 * 1000) fs.rmSync(p, { recursive: true, force: true }); } catch {} }
    }
    if (Date.now() - t0 > 40 * 60 * 1000) throw Error('no slot');
    await new Promise(r => setTimeout(r, 4000));
  }
}
const releaseSlot = () => { if (heldSlot) { try { fs.rmSync(heldSlot, { recursive: true, force: true }); } catch {} heldSlot = null; } };
process.on('exit', releaseSlot);

(async () => {
  register('./_node-resolve.mjs', pathToFileURL(__filename));
  const { computeSun } = await import('../lib/fly/sun-model.js');
  const day = Date.parse('2026-09-22T00:00:00Z');
  const noonOf = pose => day + (12 - pose.lon / 15) * 3600000 + 2 * 3600000;
  await acquireSlot();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--enable-precise-memory-info'] });
  try {
    const p = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    p.on('pageerror', e => { report.errors.push(e.message.slice(0, 300)); save(); });
    await p.addInitScript(({ quality, sun }) => {
      try { performance.setResourceTimingBufferSize(200000); } catch {}
      window.__flyGovPin = 'hold'; window.__flyVisualsOverride = 'enhanced'; window.__flyTitleBypass = true; window.__flyBoostInfinite = true;
      window.__flySunOverride = sun; window.__flyWeatherOverride = 'baseline'; window.__flyWorldPassCounters = true; // World Pass W0 arrival counters on engine stats (worldPassCounters)
      try {
        localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-quality-tier', quality); localStorage.setItem('fly-controls-seen', '1');
        localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-visuals', 'enhanced');
        localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } }));
      } catch {}
    }, { quality, sun: noonOf(POSES[poses[0]]) });
    await p.route('**/api/aircraft?**', r => r.fulfill({ json: { ac: [], now: Date.now(), total: 0, source: 'perf probe' } }));
    await p.route('**/api/weather**', r => r.fulfill({ json: { found: false } }));
    await p.goto(`${url}/?graphicsReview=1`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await p.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore, undefined, { timeout: 240000 });
    report.gpu = await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'), e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); });
    console.log('BOOT', report.gpu);
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
        performance.clearResourceTimings();
        r.warpToGeo(pose.lat, pose.lon, { altM: pose.altM, headingRad: pose.headingDeg * Math.PI / 180, name: null }); r.autopilot?.disengage?.();
        const f = r.flight; window.__lookHold = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: pose.headingDeg * Math.PI / 180 }; r.chaseCam?.snap?.();
      }, { pose, sun: noonOf(pose) });
      await p.waitForTimeout(4000);
      const t0 = Date.now();
      const settled = await p.waitForFunction(() => {
        const r = window.__fly; if (!r || r.worldLoading || !r.terraStats?.sharp) return false;
        for (const k of ['satBuildings', 'satSkyline', 'satRoads', 'satVeg']) { const s = r[k]?.stats; if (s && ['queued', 'building', 'sampling', 'draping', 'births', 'dying'].some(f => Number(s[f] || 0) !== 0)) return false; }
        return true;
      }, undefined, { timeout: Number(args.settleTimeout || 180000), polling: 1000 }).then(() => true, () => false);
      console.log('POSE', name, 'settled', settled, Date.now() - t0, 'ms');
      await p.waitForTimeout(5000);
      const m = await p.evaluate(async ({ pose }) => {
        const r = window.__fly; let scene = r.engine.object; while (scene.parent) scene = scene.parent;
        const gl = scene.__r3f.root.getState().gl, ctx = gl.getContext();
        const groups = { buildings: r.satBuildings?.object, skyline: r.satSkyline?.object, roads: r.satRoads?.object, terrain: r.engine?.object, clutter: r.satClutter?.object };
        const owner = new Map();
        for (const [g, o] of Object.entries(groups)) o?.traverse?.(n => { if (!owner.has(n)) owner.set(n, g); });
        const seen = new Set(), bytes = {}, tris = {}, shadowTris = {}, meshes = {}, inst = [];
        const geomBytes = geo => { let b = 0; for (const a of Object.values(geo.attributes)) b += a.array?.byteLength ?? (a.data?.array?.byteLength ?? 0); if (geo.index) b += geo.index.array.byteLength; return b; };
        scene.traverse(n => {
          if (!n.isMesh && !n.isPoints && !n.isLine) return;
          let g = owner.get(n) ?? 'other';
          if (g === 'other') { let q = n; while (q && g === 'other') { if (/veg|tree|canopy|forest/i.test(q.name || '')) g = 'veg/trees'; q = q.parent; } }
          const geo = n.geometry; if (!geo) return;
          const t = (geo.index ? geo.index.count : (geo.attributes.position?.count ?? 0)) / 3;
          const ic = n.isInstancedMesh ? n.count : 1;
          const drawn = n.isMesh ? Math.min(t, (geo.drawRange.count === Infinity ? t * 3 : geo.drawRange.count) / 3) * ic : 0;
          tris[g] = (tris[g] || 0) + (n.visible ? drawn : 0); meshes[g] = (meshes[g] || 0) + 1;
          if (n.castShadow && n.visible) shadowTris[g] = (shadowTris[g] || 0) + drawn;
          if (n.isInstancedMesh) { bytes[g] = (bytes[g] || 0) + n.instanceMatrix.array.byteLength + (n.instanceColor?.array.byteLength || 0); inst.push({ name: n.name || n.parent?.name || '', group: g, count: n.count, max: n.instanceMatrix.count, trisPer: t, visible: n.visible, castShadow: n.castShadow }); }
          if (seen.has(geo)) return; seen.add(geo);
          bytes[g] = (bytes[g] || 0) + geomBytes(geo);
        });
        // building chunk vertex layout
        const chunks = [];
        r.satBuildings?.object?.traverse?.(n => { if (n.isMesh && n.geometry?.attributes?.aBendAnchor) { const geo = n.geometry; chunks.push({ verts: geo.attributes.position.count, tris: (geo.index?.count ?? 0) / 3, bytes: geomBytes(geo), layout: Object.fromEntries(Object.entries(geo.attributes).map(([k, a]) => [k, `${a.array.constructor.name}x${a.itemSize}`])), index: geo.index?.array.constructor.name }); } });
        // main-thread ground query cost
        const g0 = r.engine.worldToGeo(r.flight.pos), lon0 = g0.x, lat0 = g0.y;
        let rnd = 12345; const rand = () => (rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        const pts = []; for (let i = 0; i < 20000; i++) { const a = rand() * 6.283, d = Math.sqrt(rand()) * 2500; pts.push([lon0 + d * Math.cos(a) / (111320 * Math.cos(lat0 * Math.PI / 180)), lat0 + d * Math.sin(a) / 110540]); }
        for (let i = 0; i < 500; i++) r.engine.getGroundAt(pts[i][0], pts[i][1]);
        for (const [x, y] of pts) r.engine.getGroundAt(x, y); let hits = 0; const tq = performance.now(); for (const [x, y] of pts) { const s = r.engine.getGroundAt(x, y); if (s && Number.isFinite(s.elev)) hits++; } const groundUs = (performance.now() - tq) / pts.length * 1000; const gq = r.engine._groundQuery?.stats;
        // raw buffer upload cost on this context
        const upload = [];
        for (const mb of [2, 8, 16, 32]) {
          const arr = new Float32Array(mb * 262144); for (let i = 0; i < arr.length; i += 1024) arr[i] = i;
          const ts = [];
          for (let k = 0; k < 3; k++) { const b = ctx.createBuffer(); ctx.bindBuffer(ctx.ARRAY_BUFFER, b); const t = performance.now(); ctx.bufferData(ctx.ARRAY_BUFFER, arr, ctx.STATIC_DRAW); const tCall = performance.now() - t; ctx.finish(); const tFin = performance.now() - t; ctx.bindBuffer(ctx.ARRAY_BUFFER, null); ctx.deleteBuffer(b); ts.push([+tCall.toFixed(2), +tFin.toFixed(2)]); }
          upload.push({ mb, callMs_finishMs: ts });
        }
        // imagery the terrain fetched since the warp
        const img = {};
        const R = 6371000, toRad = Math.PI / 180;
        for (const e of performance.getEntriesByType('resource')) {
          const mm = /World_Imagery\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)/.exec(e.name); if (!mm) continue;
          const z = +mm[1], y = +mm[2], x = +mm[3], n = 2 ** z;
          const lon = (x + 0.5) / n * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / n))) / toRad;
          const d = 2 * R * Math.asin(Math.sqrt(Math.sin((lat - lat0) * toRad / 2) ** 2 + Math.cos(lat * toRad) * Math.cos(lat0 * toRad) * Math.sin((lon - lon0) * toRad / 2) ** 2));
          const k = img[z] ??= { n: 0, bytes: 0, dists: [] }; k.n++; k.bytes += e.transferSize || e.encodedBodySize || 0; k.dists.push(Math.round(d));
        }
        for (const k of Object.values(img)) { k.dists.sort((a, b) => a - b); k.distP50 = k.dists[k.dists.length >> 1]; k.distMax = k.dists.at(-1); k.distMin = k.dists[0]; delete k.dists; }
        const ofm = performance.getEntriesByType('resource').filter(e => /openfreemap/.test(e.name)).length;
        // frame intervals
        const iv = []; let last = performance.now();
        await new Promise(res => { const tick = () => { const t = performance.now(); iv.push(t - last); last = t; if (iv.length < 360) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
        iv.sort((a, b) => a - b); const pc = q => +iv[Math.floor(q * (iv.length - 1))].toFixed(1);
        let storage = null; try { storage = await navigator.storage.estimate(); } catch {}
        let cacheKeys = null; try { const names = await caches.keys(); cacheKeys = {}; for (const nm of names) cacheKeys[nm] = (await (await caches.open(nm)).keys()).length; } catch {}
        const st = r.satBuildings?.stats || {};
        return {
          aglM: r.flight.pos.y - r.flight.groundElev, cascades: r.cinemaShadows?.cascades, shadowSize: r.cinemaShadows?.size, shadowBytes: r.cinemaShadows?.bytes,
          info: { calls: gl.info.render.calls, triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs?.length },
          geometryMiB: Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, +(v / 1048576).toFixed(1)])), totalGeometryMiB: +(Object.values(bytes).reduce((a, b) => a + b, 0) / 1048576).toFixed(1),
          trisByGroup: tris, shadowCasterTris: shadowTris, meshesByGroup: meshes, instanced: inst.filter(i => i.count > 0).slice(0, 40),
          buildingChunks: { n: chunks.length, verts: chunks.reduce((a, c) => a + c.verts, 0), tris: chunks.reduce((a, c) => a + c.tris, 0), MiB: +(chunks.reduce((a, c) => a + c.bytes, 0) / 1048576).toFixed(1), bytesPerVert: chunks.length ? +(chunks.reduce((a, c) => a + c.bytes, 0) / chunks.reduce((a, c) => a + c.verts, 0)).toFixed(1) : null, layout: chunks[0]?.layout, index: chunks[0]?.index, maxChunk: chunks.reduce((m, c) => c.tris > m.tris ? c : m, { tris: 0 }) },
          buildingStats: Object.fromEntries(Object.entries(st).filter(([, v]) => typeof v === 'number')),
          groundQuery: { usPerQuery: +groundUs.toFixed(2), hitFrac: +(hits / pts.length).toFixed(3), warmPasses: 2, engineStats: gq ? { ...gq } : null },
          upload, imagery: img, ofmRequests: ofm,
          frameMs: { p50: pc(0.5), p90: pc(0.9), p99: pc(0.99), max: pc(1) },
          heapMiB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null,
          storageMiB: storage ? +(storage.usage / 1048576).toFixed(0) : null, cacheKeys,
        };
      }, { pose });
      m.chunkMax = undefined;
      report.poses.push({ pose: name, settled, settleMs: Date.now() - t0, ...m }); save();
      console.log(name, JSON.stringify({ info: m.info, geo: m.totalGeometryMiB, bld: m.buildingChunks.MiB, ground: m.groundQuery, frame: m.frameMs }));
    }
  } catch (e) { report.errors.push('fatal ' + e.message); console.error(e); }
  finally { save(); await browser.close(); releaseSlot(); console.log('DONE', out); }
})();
