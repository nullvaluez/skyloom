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
const PL = { 'tokyo-bay': [35.625, 139.785], 'nyc-bay': [40.7, -74.03], 'nyc-top': [40.754, -73.984], paris: [48.853, 2.33], brooklyn: [40.678, -73.97], london: [51.502, -0.1], 'sf-golden-gate': [37.8199, -122.4783] };
const report = {};
for (const [name, [lat, lon]] of Object.entries(PL)) {
  const n = 2 ** 13, x0 = Math.floor((lon + 180) / 360 * n), r = lat * Math.PI / 180, y0 = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  const agg = { tiles: 0, chains: 0, water: 0, landmark: 0, features: 0, clear: [], lengths: [], ribbonVertsOff: 0, ribbonVertsOn: 0 };
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const on = await api.buildTile(13, x0 + dx, y0 + dy, 'sat-roads', { airportLandmarks: false, operationsAirports: [], worldPass: wp });
    const off = await api.buildTile(13, x0 + dx, y0 + dy, 'sat-roads', { airportLandmarks: false, operationsAirports: [] });
    agg.tiles++;
    agg.ribbonVertsOff += off?.satRoads ? off.satRoads.pos.length / 3 : 0;
    agg.ribbonVertsOn += on?.satRoads ? on.satRoads.pos.length / 3 : 0;
    const b = on?.wpBridges; if (!b) continue;
    agg.chains += b.stats.chains; agg.water += b.stats.water; agg.landmark += b.stats.landmark; agg.features += b.stats.features;
    for (let c = 0; c < b.chains.length; c += 9) { agg.clear.push(+b.chains[c + 3].toFixed(1)); agg.lengths.push(Math.round(b.chains[c + 8])); }
  }
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
  report[name] = { ...agg, clear: undefined, lengths: undefined, clearP50: q(agg.clear, 0.5), clearP90: q(agg.clear, 0.9), clearMax: q(agg.clear, 1), lengthP50: q(agg.lengths, 0.5), lengthMax: q(agg.lengths, 1), clearHist: agg.clear.reduce((h, v) => { const k = v <= 3 ? '2.5' : v <= 6 ? '5.5-6' : v <= 12 ? '6-12' : v <= 25 ? '12-25' : '25-45'; h[k] = (h[k] || 0) + 1; return h; }, {}) };
  console.log(name, JSON.stringify(report[name]));
}
if (typeof args.out === 'string') fs.writeFileSync(path.resolve(args.out), JSON.stringify(report, null, 1));
process.exit(0);
