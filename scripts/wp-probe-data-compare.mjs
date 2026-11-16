// World Pass review, lens "data" (read-only probe): like-for-like 3x3 z14
// comparison, OpenFreeMap building polygons (after the worker's admission
// rules) vs Overture buildings (PMTiles, range requests), plus Overture's
// @height_source / @geometry_source / class histograms. Same ground, same tiles.
import zlib from 'node:zlib';
import fs from 'node:fs';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const OV = 'https://tiles.overturemaps.org/2026-10-21.0/buildings.pmtiles';
const OUT = '.graphics-review/world-pass/review/data/compare.json';
const POSES = { 'nyc-street': [40.7311, -73.9892], tokyo: [35.67, 139.735], powell: [40.199, -83.0811], 'phoenix-suburb': [33.38, -111.84], lagos: [6.45, 3.39], 'iowa-farm': [41.95, -93.7], paris: [48.853, 2.33] };
const Z = 14, kRef = 1 / Math.cos(40 * Math.PI / 180), WORLD = 2 * Math.PI * 6378137;
const u64 = (b, o) => Number(new DataView(b.buffer, b.byteOffset).getBigUint64(o, true));
async function range(off, len) { const r = await fetch(OV, { headers: { Range: `bytes=${off}-${off + len - 1}` } }); return new Uint8Array(await r.arrayBuffer()); }
const gun = (b) => new Uint8Array(zlib.gunzipSync(b));
function rv(b, p) { let v = 0, s = 1, x; do { x = b[p.i++]; v += (x & 0x7f) * s; s *= 128; } while (x & 0x80); return v; }
function dir(b) { const p = { i: 0 }, n = rv(b, p), e = []; let l = 0; for (let i = 0; i < n; i++) { l += rv(b, p); e.push({ id: l }); } for (const x of e) x.rl = rv(b, p); for (const x of e) x.len = rv(b, p); e.forEach((x, i) => { const v = rv(b, p); x.off = v === 0 && i ? e[i - 1].off + e[i - 1].len : v - 1; }); return e; }
function rot(n, xy, rx, ry) { if (!ry) { if (rx) { xy[0] = n - 1 - xy[0]; xy[1] = n - 1 - xy[1]; } [xy[0], xy[1]] = [xy[1], xy[0]]; } }
function zid(z, x, y) { let a = 0; for (let t = 0; t < z; t++) a += 4 ** t; const xy = [x, y]; let d = 0; for (let s = 2 ** z / 2; s >= 1; s /= 2) { const rx = (xy[0] & s) > 0 ? 1 : 0, ry = (xy[1] & s) > 0 ? 1 : 0; d += s * s * ((3 * rx) ^ ry); rot(s, xy, rx, ry); } return a + d; }
function find(e, id) { let lo = 0, hi = e.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (e[m].id < id) lo = m + 1; else if (e[m].id > id) hi = m - 1; else return e[m]; } const x = e[hi]; return x && (x.rl === 0 || id - x.id < x.rl) ? x : null; }
const h0 = await range(0, 16384);
const H = { root: dir(gun(h0.subarray(u64(h0, 8), u64(h0, 8) + u64(h0, 16)))), leaf: u64(h0, 40), data: u64(h0, 56) };
async function ovTile(z, x, y) { const id = zid(z, x, y); let d = H.root; for (let k = 0; k < 4; k++) { const e = find(d, id); if (!e) return null; if (e.rl) return gun(await range(H.data + e.off, e.len)); d = dir(gun(await range(H.leaf + e.off, e.len))); } return null; }
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
async function ofmTile(z, x, y) { const r = await fetch(tj.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y)); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; }
function signedArea(r) { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[i].x - r[j].x) * (r[i].y + r[j].y); return s; }
function polysOf(f) { const out = []; let ext = 0; for (const r of f.loadGeometry()) { if (r.length < 3) continue; const a = signedArea(r); if (!a) continue; const s = Math.sign(a); if (!ext) ext = s; if (s === ext) out.push(Math.abs(a)); } return out; }
const tileOf = (lat, lon) => [Math.floor((lon + 180) / 360 * 2 ** Z), Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * 2 ** Z)];
const res = {};
for (const [name, [lat, lon]] of Object.entries(POSES)) {
  const [cx, cy] = tileOf(lat, lon);
  const o = { ofm: { polys: 0, admitted: 0, heightMapped: 0, under70: 0 }, ov: { buildings: 0, parts: 0, under70: 0, heightSrc: {}, geomSrc: {}, cls: {}, height: 0, floors: 0 } };
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = cx + dx, y = cy + dy, lt = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / 2 ** Z))), k = 1 / Math.cos(lt);
    const ob = await ofmTile(Z, x, y);
    if (ob) { const L = new VectorTile(new PbfReader(ob)).layers.building; if (L) { const sc = WORLD / 2 ** Z / L.extent, tA = 0.5 * sc * sc / (k * k); for (let i = 0; i < L.length; i++) { const f = L.feature(i); if (f.type !== 3 || f.properties.hide_3d) continue; const rh = f.properties.render_height ?? 0; for (const a of polysOf(f)) { o.ofm.polys++; const t = a * tA; if (t < 70.4) { o.ofm.under70++; continue; } if (t * kRef * kRef > 60000) continue; o.ofm.admitted++; if (rh !== 5 && rh > 0) o.ofm.heightMapped++; } } } }
    const vb = await ovTile(Z, x, y);
    if (vb) { const vt = new VectorTile(new PbfReader(vb)); for (const [ln, L] of Object.entries(vt.layers)) { const sc = WORLD / 2 ** Z / L.extent, tA = 0.5 * sc * sc / (k * k); for (let i = 0; i < L.length; i++) { const f = L.feature(i), p = f.properties; if (ln === 'building_part') { o.ov.parts++; continue; } if (p.is_underground) continue; o.ov.buildings++; const a = polysOf(f).reduce((s, v) => s + v, 0) * tA; if (a < 70.4) o.ov.under70++; const hs = p['@height_source'] ?? 'none'; o.ov.heightSrc[hs] = (o.ov.heightSrc[hs] || 0) + 1; const gs = String(p['@geometry_source'] ?? 'none'); o.ov.geomSrc[gs] = (o.ov.geomSrc[gs] || 0) + 1; if (p.class) o.ov.cls[p.class] = (o.ov.cls[p.class] || 0) + 1; if (p.height != null) o.ov.height++; if (p.num_floors != null) o.ov.floors++; } } }
  }
  const top = (m) => Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8));
  o.ov.cls = top(o.ov.cls); o.ov.heightSrc = top(o.ov.heightSrc); o.ov.geomSrc = top(o.ov.geomSrc);
  res[name] = o; console.log(name, JSON.stringify(o));
}
fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
