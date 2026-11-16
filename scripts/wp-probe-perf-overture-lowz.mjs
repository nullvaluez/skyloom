// World Pass review, lens "data" (read-only probe). Reads the public Overture
// buildings PMTiles archive with HTTP range requests (the way a web worker
// would), fetches the z14 tiles that cover a pose's centre and its 3x3, and
// counts features and attribute coverage. Compares against OpenFreeMap z14.
// Usage: node scripts/wp-probe-data-overture.mjs <pmtilesUrl> [outJson]
import zlib from 'node:zlib';
import fs from 'node:fs';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const URL_ = process.argv[2] || 'https://tiles.overturemaps.org/2026-10-21.0/buildings.pmtiles';
const OUT = process.argv[3] || '.graphics-review/world-pass/review/data/overture.json';
let bytesFetched = 0, requests = 0;
async function range(off, len) {
  requests++;
  const r = await fetch(URL_, { headers: { Range: `bytes=${off}-${off + len - 1}`, 'user-agent': 'tile-survey/1.0' } });
  if (r.status !== 206) throw new Error(`range ${r.status}`);
  const b = new Uint8Array(await r.arrayBuffer()); bytesFetched += b.length; return b;
}
const u64 = (b, o) => Number(new DataView(b.buffer, b.byteOffset).getBigUint64(o, true));
function decomp(b, c) { if (c === 2) return new Uint8Array(zlib.gunzipSync(b)); if (c === 1) return b; throw new Error('compression ' + c); }
function readVarint(b, p) { let v = 0, s = 1, x; do { x = b[p.i++]; v += (x & 0x7f) * s; s *= 128; } while (x & 0x80); return v; }
function parseDir(b) {
  const p = { i: 0 }; const n = readVarint(b, p); const e = []; let last = 0;
  for (let i = 0; i < n; i++) { last += readVarint(b, p); e.push({ id: last }); }
  for (let i = 0; i < n; i++) e[i].rl = readVarint(b, p);
  for (let i = 0; i < n; i++) e[i].len = readVarint(b, p);
  for (let i = 0; i < n; i++) { const v = readVarint(b, p); e[i].off = v === 0 && i > 0 ? e[i - 1].off + e[i - 1].len : v - 1; }
  return e;
}
function rot(n, xy, rx, ry) { if (ry === 0) { if (rx === 1) { xy[0] = n - 1 - xy[0]; xy[1] = n - 1 - xy[1]; } const t = xy[0]; xy[0] = xy[1]; xy[1] = t; } }
function zxyToId(z, x, y) {
  let acc = 0; for (let t = 0; t < z; t++) acc += 4 ** t;
  const n = 2 ** z; let d = 0; const xy = [x, y];
  for (let s = n / 2; s >= 1; s /= 2) { const rx = (xy[0] & s) > 0 ? 1 : 0, ry = (xy[1] & s) > 0 ? 1 : 0; d += s * s * ((3 * rx) ^ ry); rot(s, xy, rx, ry); }
  return acc + d;
}
function find(entries, id) { let lo = 0, hi = entries.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (entries[m].id < id) lo = m + 1; else if (entries[m].id > id) hi = m - 1; else return entries[m]; } if (hi >= 0) { const e = entries[hi]; if (e.rl === 0) return e; if (id - e.id < e.rl) return e; } return null; }
let H;
async function header() {
  const b = await range(0, 16384);
  H = { rootOff: u64(b, 8), rootLen: u64(b, 16), metaOff: u64(b, 24), metaLen: u64(b, 32), leafOff: u64(b, 40), dataOff: u64(b, 56), internalC: b[97], tileC: b[98], tileType: b[99], minZ: b[100], maxZ: b[101] };
  H.root = parseDir(decomp(b.subarray(H.rootOff, H.rootOff + H.rootLen), H.internalC));
  const m = await range(H.metaOff, H.metaLen); H.meta = JSON.parse(new TextDecoder().decode(decomp(m, H.internalC)));
  return H;
}
async function tile(z, x, y) {
  const id = zxyToId(z, x, y); let dir = H.root;
  for (let depth = 0; depth < 4; depth++) {
    const e = find(dir, id); if (!e) return null;
    if (e.rl > 0) { const t0 = performance.now(); const b = await range(H.dataOff + e.off, e.len); return { raw: b.length, ms: performance.now() - t0, data: decomp(b, H.tileC) }; }
    dir = parseDir(decomp(await range(H.leafOff + e.off, e.len), H.internalC));
  }
  return null;
}
// --- perf skeptic: what does Overture carry BELOW z14 (could a far field read it instead of 384 full OFM z14 tiles?)
const tileOf = (lat, lon, z) => [Math.floor((lon + 180) / 360 * 2 ** z), Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * 2 ** z)];
await header();
const out = { minZ: H.minZ, maxZ: H.maxZ, layers: (H.meta.vector_layers || []).map(l => ({ id: l.id, minzoom: l.minzoom, maxzoom: l.maxzoom })), poses: {} };
for (const [name, [lat, lon]] of Object.entries({ midtown: [40.7549, -73.984], paris: [48.853, 2.33], lagos: [6.45, 3.39] })) {
  out.poses[name] = {};
  for (const z of [11, 12, 13, 14]) {
    const [x, y] = tileOf(lat, lon, z); const t = await tile(z, x, y);
    if (!t) { out.poses[name][z] = null; continue; }
    const vt = new VectorTile(new PbfReader(t.data)); const agg = { kb: +(t.raw / 1024).toFixed(0), features: 0, height: 0, floors: 0, polys: 0, verts: 0 };
    for (const L of Object.values(vt.layers)) for (let i = 0; i < L.length; i++) { const f = L.feature(i); agg.features++; if (f.properties.height != null) agg.height++; if (f.properties.num_floors != null) agg.floors++; const g = f.loadGeometry(); agg.polys += g.length; for (const r of g) agg.verts += r.length; }
    out.poses[name][z] = agg; console.log(name, z, JSON.stringify(agg));
  }
}
out.requests = requests; out.bytesFetched = bytesFetched;
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 2));
