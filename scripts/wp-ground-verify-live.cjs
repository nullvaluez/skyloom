/** Adversarial verify (stream E GROUND): independent live census, not the implementer's probe.
 * Finds tree, deck and building meshes BY NAME in the scene graph, works in render-world coordinates via
 * matrixWorld, and per pose writes <out>/<pose>.verify.json.
 *   NODE_PATH=<wt>/node_modules node wp-ground-verify-live.cjs --wt=<worktree> --url=... --pose=a,b --quality=ultra [--flags=WORLD_GROUND] --out=<dir>
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const args = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const WT = args.wt || path.resolve(__dirname, '..');
const POSES = Object.assign({ powell: { lat: 40.1990, lon: -83.0811, altM: 630, headingDeg: 339 }, rio: { lat: -22.94, lon: -43.14, altM: 1100, headingDeg: 260 },
  tijuca: { lat: -22.955, lon: -43.245, altM: 900, headingDeg: 300 } }, JSON.parse(fs.readFileSync(path.join(WT, 'scripts', 'world-pass-poses.json'), 'utf8')));
const url = args.url || 'http://localhost:3325', quality = args.quality || 'ultra', flags = typeof args.flags === 'string' ? args.flags : '';
const poses = String(args.pose).split(',');
const out = path.resolve(args.out); fs.mkdirSync(out, { recursive: true });
const lockDir = path.join((() => { try { return path.resolve(require('node:child_process').execSync('git rev-parse --path-format=absolute --git-common-dir', { cwd: __dirname, encoding: 'utf8' }).trim(), '..'); } catch { return path.resolve(__dirname, '..'); } })(), '.graphics-review', 'look-pass', '.locks'); // the main checkout's shared GPU slot lock (as look-pass-capture.cjs) fs.mkdirSync(lockDir, { recursive: true });
let held = null;
async function slot() { for (;;) { for (let i = 0; i < 3; i++) { const p = path.join(lockDir, `slot-${i}`); try { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'owner.txt'), `wp-ground-verify ${process.pid} ${new Date().toISOString()}`); held = p; return; } catch { try { if (Date.now() - fs.statSync(p).mtimeMs > 25 * 60e3) fs.rmSync(p, { recursive: true, force: true }); } catch {} } } await new Promise((r) => setTimeout(r, 4000)); } }
const release = () => { if (held) { try { fs.rmSync(held, { recursive: true, force: true }); } catch {} held = null; } };
process.on('exit', release);
(async () => {
  await slot();
  console.log('SLOT', held);
  const day = Date.parse('2026-09-22T00:00:00Z');
  const sunOf = (pose) => day + (12 - pose.lon / 15) * 3600e3 + 2 * 3600e3;
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const errors = [];
  try {
    const p = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
    await p.addInitScript(({ quality, sun }) => {
      window.__flyGovPin = 'hold'; window.__flyVisualsOverride = 'enhanced'; window.__flyTitleBypass = true; window.__flyBoostInfinite = true; window.__flySunOverride = sun; window.__flyWeatherOverride = 'baseline';
      try { localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-quality-tier', quality); localStorage.setItem('fly-controls-seen', '1'); localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-visuals', 'enhanced'); localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } })); } catch {}
    }, { quality, sun: sunOf(POSES[poses[0]]) });
    await p.route('**/api/aircraft?**', (r) => r.fulfill({ json: { ac: [], now: Date.now(), total: 0 } }));
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
      await p.evaluate(({ pose, sun }) => { const r = window.__fly; window.__lookHold = null; window.__flySunOverride = sun; r.warpToGeo(pose.lat, pose.lon, { altM: pose.altM, headingRad: pose.headingDeg * Math.PI / 180, name: null }); r.autopilot?.disengage?.(); const f = r.flight; window.__lookHold = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: pose.headingDeg * Math.PI / 180 }; r.chaseCam?.snap?.(); }, { pose, sun: sunOf(pose) });
      const t0 = Date.now();
      await p.waitForTimeout(5000);
      const settled = await p.waitForFunction(() => { const r = window.__fly; if (!r || r.worldLoading || !r.terraStats?.sharp) return false; for (const k of ['satBuildings', 'satSkyline', 'satRoads', 'satVeg']) { const s = r[k]?.stats; if (s && ['queued', 'building', 'sampling', 'draping', 'births', 'dying'].some((f) => Number(s[f] || 0) !== 0)) return false; } return true; }, undefined, { timeout: 200000, polling: 1000 }).then(() => true, () => false);
      await p.waitForTimeout(15000);
      const m = await p.evaluate(() => {
        const r = window.__fly; let scene = r.engine.object; while (scene.parent) scene = scene.parent;
        scene.updateMatrixWorld(true);
        const gl = scene.__r3f.root.getState().gl;
        const R = 6378137, D = 180 / Math.PI, f = r.flight, k = 1 / Math.cos(f.latDeg * Math.PI / 180);
        const anc = (n) => { const a = []; let q = n; while (q) { if (q.name) a.push(q.name); q = q.parent; } return a.join('<'); };
        const byName = {}; const bMeshes = []; const tops = {};
        scene.traverse((n) => { if (n.name) byName[n.name] = n; if ((n.isMesh || n.isInstancedMesh) && n.visible) { const a = anc(n); if (/sat-buildings|parcel|monument|landmark|homes/i.test(a)) bMeshes.push(n); const g = n.geometry; const t = g?.index ? g.index.count / 3 : (g?.attributes?.position?.count ?? 0) / 3; const key = (a || '(unnamed)').slice(0, 70); tops[key] = (tops[key] || 0) + t * (n.isInstancedMesh ? n.count : 1); } });
        const someTree = byName['wp-canopy-near'] || window.__satVeg?.mesh || null;
        const root = someTree?.parent?.matrixWorld?.elements ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        const rx0 = root[12], rz0 = root[14];
        const toGeo = (rwx, rwz) => { const wx = rwx - rx0, wz = rwz - rz0; return [wx / R * D, (2 * Math.atan(Math.exp(-wz / R)) - Math.PI / 2) * D]; };
        const ppx = f.pos.x + rx0, ppz = f.pos.z + rz0;
        const lim = 1300 * k;
        const instWorld = (mesh, i) => { const a = mesh.instanceMatrix.array, o = i * 16, w = mesh.matrixWorld.elements; const x = a[o + 12], y = a[o + 13], z = a[o + 14]; return [w[0] * x + w[4] * y + w[8] * z + w[12], w[1] * x + w[5] * y + w[9] * z + w[13], w[2] * x + w[6] * y + w[10] * z + w[14], Math.hypot(a[o], a[o + 2])]; };
        const crowns = [], patches = [], legacy = [];
        const near = byName['wp-canopy-near'], far = byName['wp-canopy-far'];
        if (near?.visible) for (let i = 0; i < near.count; i++) { const [x, y, z, s] = instWorld(near, i); if (s < 1e-3 || Math.hypot(x - ppx, z - ppz) > lim) continue; crowns.push([x, y, z, s / k]); }
        if (far?.visible) for (let i = 0; i < far.count; i++) { const [x, , z, s] = instWorld(far, i); if (s < 1e-3 || Math.hypot(x - ppx, z - ppz) > lim) continue; const g = toGeo(x, z); patches.push([+g[0].toFixed(7), +g[1].toFixed(7), +(s / k).toFixed(2)]); }
        const sv = window.__satVeg?.mesh; if (sv?.visible) for (let i = 0; i < sv.count; i++) { const [x, , z, s] = instWorld(sv, i); if (s < 1e-3 || Math.hypot(x - ppx, z - ppz) > lim) continue; const g = toGeo(x, z); legacy.push([+g[0].toFixed(7), +g[1].toFixed(7), +(s / k).toFixed(2), 'satveg']); }
        scene.traverse((n) => { if (!n.isInstancedMesh || !n.visible || !/^forest:/.test(n.name)) return; n.geometry.computeBoundingBox(); const b = n.geometry.boundingBox; const rr = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2; for (let i = 0; i < n.count; i++) { const [x, , z, s] = instWorld(n, i); if (s < 1e-3 || Math.hypot(x - ppx, z - ppz) > lim) continue; const g = toGeo(x, z); legacy.push([+g[0].toFixed(7), +g[1].toFixed(7), +(s * rr / k).toFixed(2), 'forest']); } });
        const CELL = 16, grid = new Map();
        let tris = 0;
        const addTri = (t) => {
          const [ax, , az, bx, , bz, cx, , cz] = t;
          const area = Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az));
          if (area < 0.5) return;
          const x0 = Math.floor(Math.min(ax, bx, cx) / CELL), x1 = Math.floor(Math.max(ax, bx, cx) / CELL), z0 = Math.floor(Math.min(az, bz, cz) / CELL), z1 = Math.floor(Math.max(az, bz, cz) / CELL);
          if ((x1 - x0 + 1) * (z1 - z0 + 1) > 400) return;
          tris++;
          for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) { const key = gx * 100003 + gz; let b = grid.get(key); if (!b) grid.set(key, b = []); b.push(t); }
        };
        let curMesh = null, hitMesh = null; // round 2: which drawn mesh a crown stands in
        for (const mesh of bMeshes) { curMesh = mesh;
          const geo = mesh.geometry, pos = geo.attributes.position; if (!pos) continue;
          const idx = geo.index; const nT = idx ? idx.count / 3 : pos.count / 3;
          const reps = mesh.isInstancedMesh ? mesh.count : 1;
          const w = mesh.matrixWorld.elements;
          for (let ins = 0; ins < reps; ins++) {
            let M = w;
            if (mesh.isInstancedMesh) { const a = mesh.instanceMatrix.array, o = ins * 16; if (Math.hypot(a[o], a[o + 1], a[o + 2]) < 1e-6) continue; M = new Array(16); for (let r0 = 0; r0 < 4; r0++) for (let c = 0; c < 4; c++) { let s = 0; for (let q = 0; q < 4; q++) s += w[q * 4 + r0] * a[o + c * 4 + q]; M[c * 4 + r0] = s; } if (Math.hypot(M[12] - ppx, M[14] - ppz) > lim + 300) continue; }
            const tx = (i) => { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); return [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]]; };
            for (let t = 0; t < nT; t++) {
              const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
              const A = tx(i0); if (Math.hypot(A[0] - ppx, A[2] - ppz) > lim + 300) continue;
              const B = tx(i1), C = tx(i2);
              const T = [A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]]; T.mesh = curMesh; addTri(T);
            }
          }
        }
        const roofAt = (x, z) => { const b = grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)); if (!b) return null; let best = null; for (const t of b) { const [ax, ay, az, bx, by, bz, cx, cy, cz] = t; const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-9) continue; const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2; if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue; const y = l1 * ay + l2 * by + l3 * cy; if (best === null || y > best) { best = y; hitMesh = t.mesh; } } return best; };
        const outC = [];
        let underRoof = 0, crownOverRoof = 0, buried = 0, floating = 0, samples = 0;
        for (const [x, y, z, rT] of crowns) {
          const g = toGeo(x, z); const ground = r.engine.getGroundAt(g[0], g[1]);
          const roof = roofAt(x, z);
          const rr = (roof !== null && roof > y + 3) ? +(roof - y).toFixed(1) : null;
          if (rr !== null) underRoof++;
          let edge = 0; const re = Math.max(0, rT - 1.5) * k; if (re > 0) for (let a = 0; a < 8; a++) { const ry = roofAt(x + Math.cos(a * Math.PI / 4) * re, z + Math.sin(a * Math.PI / 4) * re); if (ry !== null && ry > y + 3) edge++; }
          if (edge >= 2) crownOverRoof++;
          let gd = null; if (ground && Number.isFinite(ground.elev)) { samples++; gd = +(y - ground.elev).toFixed(2); if (gd < -1.5) buried++; if (gd > 1.0) floating++; }
          const who = rr !== null ? (roofAt(x, z), anc(hitMesh) + "#" + (hitMesh?.name || hitMesh?.type)) : null;
          outC.push([+g[0].toFixed(7), +g[1].toFixed(7), +rT.toFixed(2), gd, rr, edge, who]);
        }
        const meshInfo = (n) => { if (!n || !n.geometry?.attributes?.position) return n ? { visible: n.visible, count: 0, triangles: 0, bytes: 0 } : null; const g = n.geometry; const tri = (g.index ? g.index.count : g.attributes.position.count) / 3; let bytes = 0; for (const a of Object.values(g.attributes)) bytes += a.array?.byteLength ?? 0; if (g.index) bytes += g.index.array.byteLength; if (n.isInstancedMesh) bytes += n.instanceMatrix.array.byteLength + (n.instanceColor?.array.byteLength ?? 0); return { visible: n.visible, count: n.isInstancedMesh ? n.count : 1, triangles: tri * (n.isInstancedMesh ? n.count : 1), capacityTriangles: n.isInstancedMesh ? tri * n.instanceMatrix.count : tri, bytes, castShadow: n.castShadow }; };
        const topList = Object.entries(tops).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([a, t]) => [a, Math.round(t)]);
        return { lat: f.latDeg, player: [ppx - rx0, ppz - rz0], draws: gl.info.render.calls, triangles: gl.info.render.triangles, near: meshInfo(near), far: meshInfo(far), deck: meshInfo(byName['wp-bridge-decks']), satveg: meshInfo(window.__satVeg?.mesh), roofTris: tris, bMeshCount: bMeshes.length, topList, crownStats: { n: crowns.length, underRoof, crownOverRoof, samples, buriedOver1_5: buried, floatingOver1: floating }, crowns: outC, patches, legacy, wpStats: window.__wpCanopy?.stats ?? null, bridgeStats: window.__wpBridges ? (({ heights, ...x }) => ({ ...x, heights }))(window.__wpBridges.stats) : null };
      });
      m.pose = name; m.settled = settled; m.settleMs = Date.now() - t0; m.errors = errors.slice();
      fs.writeFileSync(path.join(out, `${name}.verify.json`), JSON.stringify(m));
      console.log(name, JSON.stringify({ settled, draws: m.draws, tris: m.triangles, near: m.near, far: m.far, deck: m.deck, satveg: m.satveg, crownStats: m.crownStats, legacy: m.legacy.length, patches: m.patches.length, roofTris: m.roofTris, bMeshes: m.bMeshCount, wpCut: m.wpStats?.cut, bridge: m.bridgeStats && { chains: m.bridgeStats.chains, held: m.bridgeStats.held, tri: m.bridgeStats.triangles } }));
    }
  } catch (e) { console.error('FATAL', e.message); }
  finally { await browser.close(); release(); console.log('DONE errors', errors.length, errors.slice(0, 3)); }
})();
