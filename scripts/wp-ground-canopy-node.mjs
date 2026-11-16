/**
 * WORLD PASS E (GROUND): canopy cover and placement truth in node, no GPU.
 *
 * Runs the REAL vector-tile worker in-process (the world-pass-worker-proof
 * idiom: comlink stubbed, WorldCover decoded with sharp) on the z14 'sat-veg'
 * tiles around each pose, with the World Pass request for WORLD_GROUND on, then
 * applies the layer's own level selection (lib/fly/ground-canopy-select.js) at
 * the pose, and measures against ESA WorldCover 2021 class 10:
 *   - crown area (sum of pi r^2, the review probe's metric) / real canopy,
 *   - crown UNION (rasterised at 2 m) inside real canopy / real canopy,
 * within 600 m and 900 m; for the "before" it reports the legacy SatVeg rows
 * the same way (the review's method: every streamed row, no decimation).
 * And placement truth: every placed crown centre tested against the tile's own
 * building and water polygons, road centrelines (half the class width, no
 * kerb), aeroway polygons and runways.
 *
 *   node scripts/wp-ground-canopy-node.mjs [--poses=a,b] [--tier=ultra|high] [--out=<json>]
 *
 * Inputs are recorded once under .graphics-review/world-pass/ground/node-inputs
 * and replayed after that.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUTS = path.join(ROOT, '.graphics-review/world-pass/ground/node-inputs');
const args = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const POSES = {
  'central-park': [40.769, -73.976], brooklyn: [40.678, -73.97], paris: [48.853, 2.33], powell: [40.199, -83.0811],
  'phoenix-suburb': [33.38, -111.84], 'iowa-farm': [41.95, -93.7], rio: [-22.94, -43.14], 'rio-tijuca': [-22.955, -43.255], tokyo: [35.67, 139.735],
};
const poseNames = String(args.poses || Object.keys(POSES).join(',')).split(',');
const tierName = args.tier === 'high' ? 'high' : 'ultra';

const COMLINK = 'file:///wp-ground-comlink-stub.mjs';
const probe = (base) => { for (const ext of ['', '.js', '.mjs', '/index.js']) { const p = base + ext; try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return pathToFileURL(p).href; } catch { /* next */ } } return null; };
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'comlink') return { url: COMLINK, shortCircuit: true };
    if (spec.startsWith('@/')) { const u = probe(path.join(ROOT, spec.slice(2))); if (u) return { url: u, shortCircuit: true }; }
    if (/^\.{1,2}\//.test(spec) && ctx.parentURL?.startsWith('file:')) {
      const base = fileURLToPath(new URL(spec, ctx.parentURL));
      if (!(fs.existsSync(base) && fs.statSync(base).isFile())) { const u = probe(base); if (u) return { url: u, shortCircuit: true }; }
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url === COMLINK) return { format: 'module', shortCircuit: true, source: 'export const expose=(a)=>{globalThis.__wpGroundApi=a;}; export const transfer=(v)=>v;' };
    return next(url, ctx);
  },
});

fs.mkdirSync(INPUTS, { recursive: true });
const indexFile = path.join(INPUTS, 'index.json');
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : {};
const realFetch = globalThis.fetch;
const seen = [];
globalThis.fetch = async (input) => {
  const url = String(input?.url ?? input);
  seen.push(url);
  let rec = index[url];
  if (!rec) {
    let res;
    for (let a = 0; ; a++) {
      try { res = await realFetch(url, { credentials: 'omit' }); if (res.status >= 500 || res.status === 429) throw new Error('http ' + res.status); break; } catch (e) { if (a >= 3) throw e; await new Promise((r) => setTimeout(r, 1500 * (a + 1))); }
    }
    const body = Buffer.from(await res.arrayBuffer());
    const file = crypto.createHash('sha256').update(url).digest('hex').slice(0, 32) + '.bin';
    fs.writeFileSync(path.join(INPUTS, file), body);
    rec = { file, status: res.status, type: res.headers.get('content-type') ?? '' };
    index[url] = rec;
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 1));
  }
  const body = fs.readFileSync(path.join(INPUTS, rec.file));
  const nullBody = rec.status === 204 || rec.status === 304;
  return new Response(nullBody ? null : body, { status: rec.status, headers: rec.type ? { 'content-type': rec.type } : {} });
};
const { default: sharp } = await import('sharp');
globalThis.createImageBitmap = async (blob) => {
  const { data, info } = await sharp(Buffer.from(await blob.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data), close() {} };
};
globalThis.OffscreenCanvas = class {
  constructor(w, h) { this.width = w; this.height = h; this._img = new Uint8ClampedArray(w * h * 4); }
  getContext() { const c = this; return { drawImage(b) { c._img.set(b.data.subarray(0, c._img.length)); }, getImageData(x, y, w, h) { return { data: c._img, width: w, height: h }; } }; }
};

await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/vector-tile.worker.js')).href);
const api = globalThis.__wpGroundApi;
const C = await import(pathToFileURL(path.join(ROOT, 'lib/fly/fly-constants.js')).href);
const { selectCanopy } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/ground-canopy-select.js')).href);
const { VectorTile } = await import('@mapbox/vector-tile');
const { PbfReader: Pbf } = await import('pbf');
const { decodeWorldCover } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/world-cover.js')).href);

const G = C.WORLD_GROUND;
const subs = { truth: ['heights', 'typology', 'smallBand', 'roofs'], arrival: ['fastQuery', 'drapeCap', 'workerPrep', 'uploads', 'footings', 'readiness'], reach: ['standIns'], look: ['roofPhoto', 'walls', 'structures', 'authority'], ground: ['trees', 'bridges'] };
const wp = { v: 1, key: 'wp1-node-ground', any: true, tier: tierName };
for (const [s, list] of Object.entries(subs)) wp[s] = { on: s === 'ground', ...Object.fromEntries(list.map((k) => [k, s === 'ground'])), worker: s === 'ground' ? JSON.parse(JSON.stringify(G.worker)) : null };
const OPTS = { airportLandmarks: false, operationsAirports: [], worldPass: wp };

const R = 6378137, WORLD = 2 * Math.PI * R, Z = 14, N = 2 ** Z, SPAN = WORLD / N;
const merc = (lat, lon) => [(lon * Math.PI / 180) * R, -Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * R];
const tileOfWorld = (wx, wz) => [Math.floor((wx + WORLD / 2) / SPAN), Math.floor((wz + WORLD / 2) / SPAN)];
const ROAD_HALF = { motorway: 11, trunk: 9, primary: 7, secondary: 6, tertiary: 5, minor: 4, service: 2.5, track: 1.5, raceway: 5, busway: 4, rail: 3, transit: 2.5 };

const tileCache = new Map();
async function buildTile(x, y) {
  const key = `${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  seen.length = 0;
  const r = await api.buildTile(Z, x, y, 'sat-veg', OPTS);
  const mvtUrl = seen.find((u) => u.includes(`/${Z}/${x}/${y}.pbf`));
  const wcUrl = seen.find((u) => u.includes('worldcover'));
  let vt = null, wc = null;
  if (mvtUrl && index[mvtUrl]) { const buf = fs.readFileSync(path.join(INPUTS, index[mvtUrl].file)); try { vt = new VectorTile(new Pbf(buf)); } catch { vt = null; } }
  if (wcUrl && index[wcUrl] && index[wcUrl].status === 200) {
    const { data } = await sharp(fs.readFileSync(path.join(INPUTS, index[wcUrl].file))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    wc = decodeWorldCover(new Uint8Array(data));
  }
  const cx = -WORLD / 2 + x * SPAN + SPAN / 2, cz = -(WORLD / 2 - y * SPAN) + SPAN / 2;
  const t = { x, y, cx, cz, span: SPAN, r, vt, wc, canopy: r?.wpCanopy ?? null, veg: r?.satVeg ?? null };
  tileCache.set(key, t);
  return t;
}
function polysOf(vt, layer, pred) {
  const L = vt?.layers?.[layer];
  const out = [];
  if (!L) return out;
  for (let i = 0; i < L.length; i++) { const f = L.feature(i); if (pred(f)) out.push({ f, g: f.loadGeometry(), e: L.extent }); }
  return out;
}
const inRings = (rings, x, y) => { let inside = false; for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside; } return inside; };
const segDist = (px, py, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy; const t = l ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l)) : 0; return Math.hypot(px - a.x - t * dx, py - a.y - t * dy); };

function truthFor(t) {
  if (t.truth) return t.truth;
  const vt = t.vt;
  t.truth = {
    bld: polysOf(vt, 'building', (f) => f.type === 3),
    water: polysOf(vt, 'water', (f) => f.type === 3),
    aero: polysOf(vt, 'aeroway', (f) => f.type === 3),
    runway: polysOf(vt, 'aeroway', (f) => f.type === 2 && f.properties.class === 'runway'),
    roads: polysOf(vt, 'transportation', (f) => f.type === 2 && f.properties.brunnel !== 'tunnel' && ROAD_HALF[f.properties.class]),
  };
  return t.truth;
}
function violation(t, wx, wz) {
  const T = truthFor(t);
  const u = (wx - (t.cx - SPAN / 2)) / SPAN, v = (wz - (t.cz - SPAN / 2)) / SPAN;
  const check = (list, kind) => { for (const p of list) if (inRings(p.g, u * p.e, v * p.e)) return kind; return null; };
  let hit = check(T.bld, 'roof') || check(T.water, 'water') || check(T.aero, 'aeroway');
  if (hit) return hit;
  const mPerExtent = (e) => (SPAN / t.k) / e;
  for (const p of T.runway) { const s = mPerExtent(p.e); for (const line of p.g) for (let i = 1; i < line.length; i++) if (segDist(u * p.e, v * p.e, line[i - 1], line[i]) * s < 30) return 'runway'; }
  for (const p of T.roads) { const s = mPerExtent(p.e), hw = ROAD_HALF[p.f.properties.class]; for (const line of p.g) for (let i = 1; i < line.length; i++) if (segDist(u * p.e, v * p.e, line[i - 1], line[i]) * s < hw) return 'road'; }
  return null;
}

const report = { tier: tierName, date: new Date().toISOString(), poses: {} };
for (const name of poseNames) {
  const [lat, lon] = POSES[name];
  const [px, pz] = merc(lat, lon);
  const k = 1 / Math.cos(lat * Math.PI / 180);
  const cfg = G.canopy[tierName];
  const reach = (cfg.d3 + 200) * k;
  const [tx0, ty0] = tileOfWorld(px - reach, pz - reach), [tx1, ty1] = tileOfWorld(px + reach, pz + reach);
  const chunks = [];
  const t0 = performance.now();
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const t = await buildTile(tx, ty);
    t.k = 1 / Math.cos(Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + 0.5)) / N))));
    chunks.push(t);
  }
  const buildMs = performance.now() - t0;
  const near = [], far = [];
  const sel = selectCanopy(chunks, px, pz, { k, ...cfg }, (ch, i) => near.push([ch, i]), (ch, lvl, i, f) => far.push([ch, lvl, i, f]));
  // real canopy and crowns within R
  const out = { sel, buildMs: Math.round(buildMs), tiles: chunks.length, worker: {} };
  for (const t of chunks) if (t.canopy) for (const [kk, v] of Object.entries(t.canopy.stats.byContext)) out.worker[kk] = (out.worker[kk] || 0) + v;
  out.workerMsP50 = (() => { const a = chunks.map((t) => t.canopy?.stats.ms).filter(Number.isFinite).sort((p, q) => p - q); return a.length ? [a[a.length >> 1], a[a.length - 1]] : null; })();
  out.msBy = chunks.map((t) => t.canopy?.stats.msBy).filter(Boolean).sort((a, b) => Object.values(b).reduce((p, q) => p + q, 0) - Object.values(a).reduce((p, q) => p + q, 0)).slice(0, 2);
  out.workerAccepted = chunks.reduce((a, t) => a + (t.canopy?.stats.accepted ?? 0), 0);
  out.workerRejected = chunks.reduce((a, t) => { const s = t.canopy?.stats; return s ? { keepOut: a.keepOut + s.keepOut, building: a.building + s.building, airport: a.airport + s.airport } : a; }, { keepOut: 0, building: 0, airport: 0 });
  for (const RM of [600, 900]) {
    const Rw = RM * k, cellM = 2, cw = cellM * k, nG = Math.ceil((2 * Rw) / cw);
    const grid = new Uint8Array(nG * nG); // bit0 real canopy, bit1 after crowns, bit2 before rows
    let disc = 0, real = 0;
    const wcAt = (wx, wz) => { const [tx, ty] = tileOfWorld(wx, wz); const t = tileCache.get(`${tx}/${ty}`); if (!t?.wc) return -1; const u = (wx - (t.cx - SPAN / 2)) / SPAN, v = (wz - (t.cz - SPAN / 2)) / SPAN; return t.wc[Math.min(255, (v * 256) | 0) * 256 + Math.min(255, (u * 256) | 0)]; };
    for (let gy = 0; gy < nG; gy++) for (let gx = 0; gx < nG; gx++) {
      const wx = px - Rw + (gx + 0.5) * cw, wz = pz - Rw + (gy + 0.5) * cw;
      if ((wx - px) ** 2 + (wz - pz) ** 2 > Rw * Rw) { grid[gy * nG + gx] = 128; continue; }
      disc++;
      if (wcAt(wx, wz) === 10) { grid[gy * nG + gx] |= 1; real++; }
    }
    const stamp = (wx, wz, rTrue, bit) => {
      const rr = rTrue * k, gx0 = Math.floor((wx - rr - (px - Rw)) / cw), gx1 = Math.floor((wx + rr - (px - Rw)) / cw), gy0 = Math.floor((wz - rr - (pz - Rw)) / cw), gy1 = Math.floor((wz + rr - (pz - Rw)) / cw);
      for (let gy = Math.max(0, gy0); gy <= Math.min(nG - 1, gy1); gy++) for (let gx = Math.max(0, gx0); gx <= Math.min(nG - 1, gx1); gx++) {
        const cx = px - Rw + (gx + 0.5) * cw, cz = pz - Rw + (gy + 0.5) * cw;
        if ((cx - wx) ** 2 + (cz - wz) ** 2 <= rr * rr && !(grid[gy * nG + gx] & 128)) grid[gy * nG + gx] |= bit;
      }
    };
    let sumAfter = 0, sumBefore = 0, nAfter = 0, nBefore = 0, onCanopyAfter = 0;
    const inside = (wx, wz) => (wx - px) ** 2 + (wz - pz) ** 2 < Rw * Rw;
    const viol = { roof: 0, road: 0, water: 0, aeroway: 0, runway: 0 };
    for (const [ch, i] of near) {
      const l0 = ch.canopy.l0, wx = ch.cx + l0[i * 5], wz = ch.cz + l0[i * 5 + 1], r = l0[i * 5 + 2];
      if (!inside(wx, wz)) continue;
      nAfter++; sumAfter += Math.PI * r * r; stamp(wx, wz, r, 2); if (wcAt(wx, wz) === 10) onCanopyAfter++;
      const v = violation(ch, wx, wz); if (v) viol[v]++;
    }
    let farIn = 0;
    for (const [ch, lvl, i] of far) {
      const a = ch.canopy['l' + lvl], wx = ch.cx + a[i * 7], wz = ch.cz + a[i * 7 + 1], r = a[i * 7 + 2];
      if (!inside(wx, wz)) continue;
      farIn++; nAfter++; sumAfter += Math.PI * r * r; stamp(wx, wz, r, 2);
    }
    for (const t of chunks) if (t.veg) for (let i = 0; i < t.veg.length; i += 4) {
      const wx = t.cx + t.veg[i], wz = t.cz + t.veg[i + 1], r = t.veg[i + 2];
      if (!inside(wx, wz)) continue;
      nBefore++; sumBefore += Math.PI * r * r; stamp(wx, wz, r, 4);
    }
    let unionAfterIn = 0, unionAfter = 0, unionBeforeIn = 0;
    for (let i = 0; i < grid.length; i++) { const g = grid[i]; if (g & 128) continue; if (g & 2) { unionAfter++; if (g & 1) unionAfterIn++; } if (g & 4 && g & 1) unionBeforeIn++; }
    const realM2 = real * cellM * cellM;
    out['r' + RM] = {
      realCanopyKm2: +(realM2 / 1e6).toFixed(3), realSharePct: +(100 * real / disc).toFixed(1),
      before: { rows: nBefore, crownSumPct: +(100 * sumBefore / realM2).toFixed(1), unionInCanopyPct: +(100 * unionBeforeIn / Math.max(1, real)).toFixed(1) },
      after: { instances: nAfter, crowns: nAfter - farIn, patches: farIn, crownSumPct: +(100 * sumAfter / realM2).toFixed(1), unionInCanopyPct: +(100 * unionAfterIn / Math.max(1, real)).toFixed(1), unionOutsideCanopyPctOfDisc: +(100 * (unionAfter - unionAfterIn) / disc).toFixed(1), crownsOnWorldCoverTreePct: +(100 * onCanopyAfter / Math.max(1, nAfter - farIn)).toFixed(1) },
      violations: viol,
    };
  }
  report.poses[name] = out;
  console.log(name, JSON.stringify({ sel: out.sel, r600: out.r600, r900: { real: out.r900.realCanopyKm2, before: out.r900.before, after: out.r900.after }, workerMs: out.workerMsP50, msBy: out.msBy, buildMs: out.buildMs, tiles: out.tiles, worker: out.worker, rejected: out.workerRejected }));
}
if (typeof args.out === 'string') fs.writeFileSync(path.resolve(args.out), JSON.stringify(report, null, 1));
process.exit(0);
