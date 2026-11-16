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
const OUT = process.argv[3] || '.graphics-review/world-pass/review/critique-regression/overture-owens.json';
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
const R = 6378137;
const tileOf = (lat, lon, z) => [Math.floor((lon + 180) / 360 * 2 ** z), Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * 2 ** z)];
const POSES = { owens: [36.6, -118.1], 'lone-pine': [36.606, -118.063], melton: [-37.683, 144.58], powell: [40.199, -83.0811] };

await header();
console.log('header', JSON.stringify({ minZ: H.minZ, maxZ: H.maxZ, tileC: H.tileC, tileType: H.tileType, rootEntries: H.root.length }));
const layers = (H.meta.vector_layers || []).map((l) => ({ id: l.id, minzoom: l.minzoom, maxzoom: l.maxzoom, fields: l.fields }));
console.log('layers', JSON.stringify(layers).slice(0, 2500));
const result = { url: URL_, header: { minZ: H.minZ, maxZ: H.maxZ }, layers, metaKeys: Object.keys(H.meta), attribution: H.meta.attribution ?? H.meta.license ?? null, poses: {} };
const Z = Math.min(14, H.maxZ);
for (const [name, [lat, lon]] of Object.entries(POSES)) {
  const [cx, cy] = tileOf(lat, lon, Z); const agg = { tiles: 0, kb: 0, features: {}, keys: {}, sources: {}, height: 0, floors: 0, roofShape: 0, roofColor: 0, facadeColor: 0, facadeMat: 0, roofMat: 0, cls: 0, parts: 0, ms: 0 };
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const t = await tile(Z, cx + dx, cy + dy); agg.perTile ??= {}; const tk=`${cx+dx}/${cy+dy}`; if (!t) { agg.perTile[tk]='none'; continue; } agg.perTile[tk]={osm:0,ml:0};
    agg.tiles++; agg.kb += t.raw / 1024; agg.ms += t.ms;
    const vt = new VectorTile(new PbfReader(t.data));
    for (const [ln, L] of Object.entries(vt.layers)) {
      agg.features[ln] = (agg.features[ln] || 0) + L.length;
      for (let i = 0; i < L.length; i++) {
        const p = L.feature(i).properties;
        for (const k of Object.keys(p)) agg.keys[`${ln}.${k}`] = (agg.keys[`${ln}.${k}`] || 0) + 1;
        if (p.height != null) agg.height++; if (p.num_floors != null) agg.floors++; if (p.roof_shape) agg.roofShape++; if (p.roof_color) agg.roofColor++; if (p.facade_color) agg.facadeColor++; if (p.facade_material) agg.facadeMat++; if (p.roof_material) agg.roofMat++; if (p.class) agg.cls++;
        if (ln.includes('part')) agg.parts++;
        const src = String(p['@geometry_source'] ?? p.sources ?? p.source ?? '').slice(0, 80);
        const tag = /OpenStreetMap/i.test(src) ? 'osm' : /Microsoft/i.test(src) ? 'microsoft' : /Google/i.test(src) ? 'google' : /Esri/i.test(src) ? 'esri' : src ? src.slice(0, 30) : 'none';
        agg.sources[tag] = (agg.sources[tag] || 0) + 1; if(tag==='osm') agg.perTile[tk].osm++; else agg.perTile[tk].ml++;
      }
    }
  }
  agg.kb = Math.round(agg.kb); agg.ms = Math.round(agg.ms);
  result.poses[name] = agg;
  console.log(name, JSON.stringify(agg.perTile));
}
result.requests = requests; result.bytesFetched = bytesFetched;
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
console.log('wrote', OUT, 'requests', requests, 'MB', (bytesFetched / 1e6).toFixed(1));
