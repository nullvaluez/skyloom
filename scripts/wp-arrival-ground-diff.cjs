/** WORLD PASS B (ARRIVAL, fastQuery): the differential test of the fast ground query.
 *
 * Boots the page (same boot, warp and settle path and the same GPU slot lock as
 * scripts/world-pass-budget.cjs), warps to each pose, waits for the world to settle,
 * then, in ONE synchronous page task per pose (so the terrain tree cannot change
 * under the comparison), samples N points with the shipped reference query
 * (TerrainGroundQuery.sampleReference) and with the exact batched path
 * (_sampleBatched inside begin/endBatch), and requires
 * identical answers: the same null / undefined, Object.is on elev, the same tileZ
 * and the same tile object. Points: half uniform over a 3 km disc in random order,
 * half the drape's shape (clusters of 2 to 40 points within 30 m, as consecutive
 * buildings of a tile). Timing per path over the same points.
 *
 *   node scripts/wp-arrival-ground-diff.cjs --url=http://localhost:3322 \
 *        --pose=hongkong,sf-hills,nyc-low,phoenix-suburb --points=250000 --out=<dir> [--quality=ultra]
 *
 * Writes <out>/ground-diff.json and prints one line per pose and a PASS / FAIL line.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const args = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const POSES = JSON.parse(fs.readFileSync(path.join(__dirname, 'world-pass-poses.json'), 'utf8'));
const url = typeof args.url === 'string' ? args.url : 'http://localhost:3322';
const quality = typeof args.quality === 'string' ? args.quality : 'ultra';
const flags = typeof args.flags === 'string' ? args.flags : '';
const nPoints = Number(args.points || 250000);
const poses = String(args.pose || 'hongkong,sf-hills,nyc-low,phoenix-suburb').split(',').filter(Boolean);
if (typeof args.out !== 'string') { console.error('--out=<dir> is required'); process.exit(2); }
const out = path.resolve(args.out);
fs.mkdirSync(out, { recursive: true });
const report = { tool: 'wp-arrival-ground-diff', url, quality, flags, nPoints, date: new Date().toISOString(), poses: [], errors: [] };
const save = () => fs.writeFileSync(path.join(out, 'ground-diff.json'), JSON.stringify(report, null, 2));

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
      try { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'owner.txt'), `wp-arrival-ground-diff pid ${process.pid} ${new Date().toISOString()}`); heldSlot = p; return Date.now() - t0; }
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
  const day = Date.parse('2026-09-22T00:00:00Z');
  const noonOf = (pose) => day + (12 - pose.lon / 15) * 3600000 + 2 * 3600000;
  const waited = await acquireSlot();
  console.log(`SLOT ${path.basename(heldSlot)} after ${waited}ms`);
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--js-flags=--max-old-space-size=4096'] });
  let ok = true;
  try {
    const p = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
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
    await p.route('**/api/aircraft?**', (r) => r.fulfill({ json: { ac: [], now: Date.now(), total: 0, source: 'ground diff' } }));
    await p.route('**/api/weather**', (r) => r.fulfill({ json: { found: false } }));
    await p.goto(`${url}/?graphicsReview=1${flags ? `&flags=${encodeURIComponent(flags)}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await p.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore, undefined, { timeout: 240000 });
    await p.evaluate(() => {
      const r = window.__fly, s = window.__flyStore.getState();
      r.operations.phase = 'airborne'; r.operations.profile = null; r.operations.warp(r.flight); s.setHangarOpen(false); s.setPhase('flying');
      const f = r.flight, step = f.step.bind(f);
      f.step = (dt, c) => { const h = window.__lookHold; step(dt, { ...c, turn: 0, pitch: 0, boost: false }); if (h) { f.pos.x = h.x; f.pos.y = h.y; f.pos.z = h.z; f.heading = h.heading; f.bank = 0; f.pitch = 0.02; f.agl = f.pos.y - f.groundElev; } };
    });
    for (const name of poses) {
      const pose = POSES[name];
      await p.evaluate(({ pose, sun }) => {
        const r = window.__fly; window.__lookHold = null; window.__flySunOverride = sun;
        r.warpToGeo(pose.lat, pose.lon, { altM: pose.altM, headingRad: pose.headingDeg * Math.PI / 180, name: null }); r.autopilot?.disengage?.();
        const f = r.flight; window.__lookHold = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: pose.headingDeg * Math.PI / 180 }; r.chaseCam?.snap?.();
      }, { pose, sun: noonOf(pose) });
      await p.waitForTimeout(4000);
      const settled = await p.waitForFunction(() => {
        const r = window.__fly; if (!r || r.worldLoading || !r.terraStats?.sharp) return false;
        for (const k of ['satBuildings', 'satSkyline']) { const s = r[k]?.stats; if (s && ['queued', 'building', 'draping'].some((f) => Number(s[f] || 0) !== 0)) return false; }
        return true;
      }, undefined, { timeout: 150000, polling: 1000 }).then(() => true, () => false);
      await p.waitForTimeout(2000);
      const m = await p.evaluate(({ n }) => {
        const r = window.__fly, q = r.engine._groundQuery, Q = q.constructor;
        const g0 = r.engine.worldToGeo(r.flight.pos), lon0 = g0.x, lat0 = g0.y;
        let seed = 987654321; const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
        const kx = 1 / (111320 * Math.cos(lat0 * Math.PI / 180)), ky = 1 / 110540;
        const lon = new Float64Array(n), lat = new Float64Array(n);
        let i = 0;
        for (; i < n / 2; i++) { const a = rand() * 6.2832, d = Math.sqrt(rand()) * 3000; lon[i] = lon0 + d * Math.cos(a) * kx; lat[i] = lat0 + d * Math.sin(a) * ky; }
        while (i < n) { const a = rand() * 6.2832, d = Math.sqrt(rand()) * 3000, cx = lon0 + d * Math.cos(a) * kx, cy = lat0 + d * Math.sin(a) * ky, m = 2 + Math.floor(rand() * 39); for (let j = 0; j < m && i < n; j++, i++) { lon[i] = cx + (rand() - 0.5) * 60 * kx; lat[i] = cy + (rand() - 0.5) * 60 * ky; } }
        // Edge cases: exact tile-box edges are hit by chance; add points on a fine lattice too.
        const ref = new Array(n), fast = new Array(n), bat = new Array(n);
        const t0 = performance.now(); for (let k = 0; k < n; k++) ref[k] = q.sampleReference(lon[k], lat[k]);
        const t1 = performance.now(); for (let k = 0; k < n; k++) fast[k] = q.sampleReference(lon[k], lat[k]); // reference twice: the run-to-run noise floor
        const t2 = performance.now();
        // Batches of 2,000 (about what one drape frame samples).
        for (let k = 0; k < n; k += 2000) { Q.beginBatch(); try { const e = Math.min(n, k + 2000); for (let j = k; j < e; j++) bat[j] = q._sampleBatched(lon[j], lat[j]); } finally { Q.endBatch(); } }
        const t3 = performance.now();
        // The drape's shape alone (the clustered half), batched, for timing.
        const h0 = Math.floor(n / 2), tc0 = performance.now();
        for (let k = h0; k < n; k += 2000) { Q.beginBatch(); try { const e = Math.min(n, k + 2000); for (let j = k; j < e; j++) q._sampleBatched(lon[j], lat[j]); } finally { Q.endBatch(); } }
        const usBatchedClustered = +((performance.now() - tc0) / (n - h0) * 1000).toFixed(3);
        const tr0 = performance.now(); for (let k = h0; k < n; k++) q.sampleReference(lon[k], lat[k]); const usReferenceClustered = +((performance.now() - tr0) / (n - h0) * 1000).toFixed(3);
        const same = (a, b) => (a === b) || (a && b && Object.is(a.elev, b.elev) && a.tileZ === b.tileZ && a.tile === b.tile);
        let diffFast = 0, diffBat = 0, nulls = 0, undef = 0, hits = 0; const examples = []; const zs = {};
        for (let k = 0; k < n; k++) {
          const a = ref[k];
          if (a === null) nulls++; else if (a === undefined) undef++; else { hits++; zs[a.tileZ] = (zs[a.tileZ] || 0) + 1; }
          if (!same(a, fast[k])) { diffFast++; if (examples.length < 5) examples.push({ k, path: 'reference-again', ref: a && { elev: a.elev, z: a.tileZ }, got: fast[k] && { elev: fast[k].elev, z: fast[k].tileZ } }); }
          if (!same(a, bat[k])) { diffBat++; if (examples.length < 5) examples.push({ k, path: 'batched', ref: a && { elev: a.elev, z: a.tileZ }, got: bat[k] && { elev: bat[k].elev, z: bat[k].tileZ } }); }
        }
        let emin = Infinity, emax = -Infinity; for (const a of ref) if (a) { if (a.elev < emin) emin = a.elev; if (a.elev > emax) emax = a.elev; }
        const us = (ms) => +(ms / n * 1000).toFixed(3);
        // The public path as the drape calls it, through the terrain engine, inside a batch.
        const te0 = performance.now(); Q.beginBatch(); try { for (let k = 0; k < n; k += 4) r.engine.getGroundAt(lon[k], lat[k]); } finally { Q.endBatch(); } const te1 = performance.now();
        return { n, hits, nulls, undef, tileZ: zs, elevRange: [emin, emax], diffFast, diffBat, examples,
          usReference: us(t1 - t0), usReferenceAgain: us(t2 - t1), usBatched: us(t3 - t2), usReferenceClustered, usBatchedClustered, usEngineBatchedIfArmed: +((te1 - te0) / (n / 4) * 1000).toFixed(3), armed: Q.armed(), fastStats: { ...q.fastStats } };
      }, { n: nPoints });
      if (args.profile) {
        m.profile = await p.evaluate(() => {
          const r = window.__fly, q = r.engine._groundQuery;
          const g0 = r.engine.worldToGeo(r.flight.pos), lon0 = g0.x, lat0 = g0.y;
          let seed = 4242; const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
          const kx = 1 / (111320 * Math.cos(lat0 * Math.PI / 180)), ky = 1 / 110540, n = 20000;
          const pts = []; for (let i = 0; i < n; i++) { const a = rand() * 6.2832, d = Math.sqrt(rand()) * 3000; pts.push([lon0 + d * Math.cos(a) * kx, lat0 + d * Math.sin(a) * ky]); }
          // Census of one walk per point.
          let nodes = 0, tiles = 0, meshes = 0, tri0 = q.stats.triangles; const meshHist = {};
          const map = q.map;
          for (const [lo, la] of pts) {
            map.updateWorldMatrix(true, false); q._projectWorld(lo, la, map.matrixWorld.elements);
            const st = [map.rootTile]; let m = 0;
            while (st.length) { const o = st.pop(); nodes++; if (o.isTile) { tiles++; const b = o.BBox; if (q._wx < b.min.x - 1e-6 || q._wx > b.max.x + 1e-6 || q._wz < b.min.z - 1e-6 || q._wz > b.max.z + 1e-6) continue; } if (o.isMesh) { m++; continue; } for (let i = o.children.length - 1; i >= 0; i--) st.push(o.children[i]); }
            meshes += m; meshHist[m] = (meshHist[m] || 0) + 1;
          }
          const time = (f) => { const t = performance.now(); for (const [lo, la] of pts) f(lo, la); return +((performance.now() - t) / n * 1000).toFixed(3); };
          const reached = [];
          const out = {
            nodesPerQuery: nodes / n, tileTestsPerQuery: tiles / n, meshesPerQuery: meshes / n, meshHist,
            usProject: time((lo, la) => q._projectWorld(lo, la, map.matrixWorld.elements)),
            usUpdateWorld: time(() => map.updateWorldMatrix(true, false)),
            usWalk: time((lo, la) => { q._projectWorld(lo, la, map.matrixWorld.elements); q._walk(q._wx, q._wz, reached, null); }),
            usWalkRecords: time((lo, la) => { q._projectWorld(lo, la, map.matrixWorld.elements); q._walk(q._wx, q._wz, reached, null); q._recordsOf(reached, []); }),
            usWalkFinish: time((lo, la) => { q._projectWorld(lo, la, map.matrixWorld.elements); q._walk(q._wx, q._wz, reached, null); const rs = q._recordsOf(reached, []); if (rs) q._finish(rs, q._wx, q._wz, q._mapInverse()); }),
          };
          const t1 = q.stats.triangles; time((lo, la) => q.sampleReference(lo, la)); out.trianglesPerQuery = (q.stats.triangles - t1) / n;
          return out;
        });
        console.log(name, 'PROFILE', JSON.stringify(m.profile));
      }
      const row = { pose: name, settled, ...m };
      report.poses.push(row); save();
      if (m.diffFast || m.diffBat) ok = false;
      console.log(name, JSON.stringify({ settled, hits: m.hits, nulls: m.nulls, undef: m.undef, elev: m.elevRange.map((v) => +v.toFixed(1)), tileZ: m.tileZ, diffFast: m.diffFast, diffBat: m.diffBat, us: [m.usReference, m.usReferenceAgain, m.usBatched], clustered: [m.usReferenceClustered, m.usBatchedClustered] }));
    }
  } catch (e) { ok = false; report.errors.push('fatal ' + e.message); console.error(e); }
  finally {
    report.pass = ok; save(); await browser.close(); releaseSlot();
    const total = report.poses.reduce((s, r) => s + r.n, 0);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${total} points, ${report.poses.reduce((s, r) => s + r.diffFast + r.diffBat, 0)} differences -> ${out}`);
  }
})();
