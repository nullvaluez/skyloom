/**
 * WORLD PASS E (GROUND): bridge chains per place in node, no GPU (3 x 3 z13 sat-roads tiles,
 * flag on vs off): chains, over water, landmark-excluded, clearance and length distribution,
 * and the glow-ribbon vertices removed from under the decks. Same harness as wp-ground-canopy-node.mjs.
 * Original header of that harness follows.
 *
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
const wp = { v: 1, key: 'wp1-node-ground', any: true, tier: 'ultra' };
for (const [s, list] of Object.entries(subs)) wp[s] = { on: s === 'ground', ...Object.fromEntries(list.map((k) => [k, s === 'ground'])), worker: s === 'ground' ? JSON.parse(JSON.stringify(G.worker)) : null };
const PL = { 'tokyo-bay': [35.625, 139.785], 'nyc-bay': [40.7, -74.03], 'nyc-top': [40.754, -73.984], 'nyc-mid': [40.755, -73.99], paris: [48.853, 2.33], brooklyn: [40.678, -73.97], london: [51.502, -0.1], 'sf-golden-gate': [37.8199, -122.4783] };
if (typeof args.places === 'string') for (const k of Object.keys(PL)) if (!args.places.split(',').includes(k)) delete PL[k];
const report = {};
// Round 2: an independent joint count. For every end the worker marks LANDING,
// re-read the tile's raw bridge ways (the replayed MVT, not the worker's runs)
// and ask whether a way that is not part of this chain has an in-tile vertex
// within 2 m of the end (a joint between two OSM ways, where the deck must stay
// up). A raw way is "part of this chain" when every in-tile vertex of it lies
// on the chain's polyline (0.5 m).
const BW = { motorway: 1, trunk: 1, primary: 1, secondary: 1, tertiary: 1, minor: 1, service: 1, rail: 1, transit: 1, busway: 1 };
const WORLD = 2 * Math.PI * 6378137;
const tileUrl = (z, x, y) => Object.keys(index).find((u) => u.includes('openfreemap') && u.endsWith(`/${z}/${x}/${y}.pbf`));
async function rawBridgeWays(z, x, y) {
  const u = tileUrl(z, x, y); if (!u) return null;
  const res = await globalThis.fetch(u); if (!res.ok) return null;
  const vt = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
  const L = vt.layers.transportation; if (!L) return [];
  const span = WORLD / 2 ** z, sc = span / L.extent, ways = [];
  for (let i = 0; i < L.length; i++) {
    const f = L.feature(i); if (f.type !== 2 || f.properties.brunnel !== 'bridge' || !BW[f.properties.class]) continue;
    for (const line of f.loadGeometry()) {
      const v = line.map((p) => [p.x * sc - span / 2, p.y * sc - span / 2, p.x > 0.5 && p.y > 0.5 && p.x < L.extent - 0.5 && p.y < L.extent - 0.5]);
      if (v.some((p) => p[2])) ways.push(v);
    }
  }
  return ways;
}
const segD = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz; const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0; return Math.hypot(px - ax - t * dx, pz - az - t * dz); };
for (const [name, [lat, lon]] of Object.entries(PL)) {
  const n = 2 ** 13, x0 = Math.floor((lon + 180) / 360 * n), r = lat * Math.PI / 180, y0 = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  const kM = 1 / Math.cos(r);
  const agg = { tiles: 0, chains: 0, water: 0, landmark: 0, features: 0, ways: 0, joined: 0, clear: [], lengths: [], ribbonVertsOff: 0, ribbonVertsOn: 0, ribbonRows: 0, ends: 0, landings: 0, jointLandings: 0, glowChains: 0 };
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const on = await api.buildTile(13, x0 + dx, y0 + dy, 'sat-roads', { airportLandmarks: false, operationsAirports: [], worldPass: wp });
    const off = await api.buildTile(13, x0 + dx, y0 + dy, 'sat-roads', { airportLandmarks: false, operationsAirports: [] });
    agg.tiles++; agg.stamped = (agg.stamped ?? 0) + (on && on.wp === wp.key ? 1 : 0); agg.offStamped = (agg.offStamped ?? 0) + (off && off.wp !== undefined ? 1 : 0);
    agg.ribbonVertsOff += off?.satRoads ? off.satRoads.pos.length / 3 : 0;
    agg.ribbonVertsOn += on?.satRoads ? on.satRoads.pos.length / 3 : 0;
    const b = on?.wpBridges; if (!b) continue;
    agg.chains += b.stats.chains; agg.water += b.stats.water; agg.landmark += b.stats.landmark; agg.features += b.stats.features; agg.ways += b.stats.ways ?? 0; agg.joined += b.stats.joined ?? 0;
    agg.ribbonRows += b.ribbon ? b.ribbon.length / 8 : 0;
    const raw = await rawBridgeWays(13, x0 + dx, y0 + dy);
    const ST = b.stats.ways !== undefined ? 10 : 9;
    for (let c = 0; c < b.chains.length; c += ST) {
      agg.clear.push(+b.chains[c + 3].toFixed(1)); agg.lengths.push(Math.round(b.chains[c + 8]));
      if (!agg.longest || b.chains[c + 8] > agg.longest.lengthM) agg.longest = { tile: `13/${x0 + dx}/${y0 + dy}`, lengthM: Math.round(b.chains[c + 8]), clearM: +b.chains[c + 3].toFixed(1), landA: b.chains[c + 5], landB: b.chains[c + 6], overWater: b.chains[c + 7], cls: b.chains[c + 4], stations: b.chains[c + 1], ...(b.clr ? (() => { const s = Array.from(b.clr.subarray(b.chains[c], b.chains[c] + b.chains[c + 1])); let step = 0; for (let i = 1; i < s.length; i++) step = Math.max(step, Math.abs(s[i] - s[i - 1])); return { clrMin: +Math.min(...s).toFixed(1), clrMax: +Math.max(...s).toFixed(1), clrMaxStepM: +step.toFixed(2) }; })() : {}) };
      if (ST === 10 && b.chains[c + 9] > 0) agg.glowChains++;
      const first = b.chains[c], np = b.chains[c + 1];
      const P = (i) => [b.pts[(first + i) * 2], b.pts[(first + i) * 2 + 1]];
      const onChain = (q) => { for (let i = 0; i + 1 < np; i++) { const a = P(i), e = P(i + 1); if (segD(q[0], q[1], a[0], a[1], e[0], e[1]) < 0.5 * kM) return true; } return false; };
      for (const [end, li] of [[0, 5], [np - 1, 6]]) {
        agg.ends++;
        if (!(b.chains[c + li] > 0.5)) continue;
        agg.landings++;
        if (!raw) continue;
        const q = P(end);
        let joint = false;
        // A raw vertex near the end belongs to THIS chain when the way runs on
        // along the chain from it (a neighbour vertex on the chain); otherwise
        // the end meets another way there (a joint, or a T into its span).
        for (const w of raw) {
          for (let i = 0; i < w.length && !joint; i++) {
            const v = w[i];
            if (!v[2] || Math.hypot(v[0] - q[0], v[1] - q[1]) >= 2 * kM) continue;
            // the way's direction from v toward neighbour j: a point 3 m along it
            const along = (j) => {
              if (j < 0 || j >= w.length) return false;
              const d = Math.hypot(w[j][0] - v[0], w[j][1] - v[1]);
              if (d <= 0.5 * kM) return false;
              const t = Math.min(1, (3 * kM) / d);
              return onChain([v[0] + (w[j][0] - v[0]) * t, v[1] + (w[j][1] - v[1]) * t]);
            };
            if (!(along(i - 1) || along(i + 1))) joint = true;
          }
          if (joint) break;
        }
        if (joint) { agg.jointLandings++; if (process.env.JDBG) console.log("JOINT", name, dx, dy, JSON.stringify(q), JSON.stringify(raw.filter((w) => w.some((v) => Math.hypot(v[0] - q[0], v[1] - q[1]) < 2 * kM)).map((w) => [w.length, w.filter(onChain).length, w.slice(0, 3)])), "chain", np, JSON.stringify(P(0)), JSON.stringify(P(np - 1))); }
      }
    }
  }
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
  agg.jointPctOfLandings = +(100 * agg.jointLandings / Math.max(1, agg.landings)).toFixed(1);
  report[name] = { ...agg, clear: undefined, lengths: undefined, clearP50: q(agg.clear, 0.5), clearP90: q(agg.clear, 0.9), clearMax: q(agg.clear, 1), lengthP50: q(agg.lengths, 0.5), lengthMax: q(agg.lengths, 1), clearHist: agg.clear.reduce((h, v) => { const k = v <= 3 ? '2.5' : v <= 6 ? '5.5-6' : v <= 12 ? '6-12' : v <= 25 ? '12-25' : '25-45'; h[k] = (h[k] || 0) + 1; return h; }, {}) };
  console.log(name, JSON.stringify(report[name]));
}
if (typeof args.out === 'string') fs.writeFileSync(path.resolve(args.out), JSON.stringify(report, null, 1));
process.exit(0);
