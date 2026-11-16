// World Pass review, lens "data" (read-only probe). Fetches the exact
// OpenFreeMap z14 tiles the satellite building ring would request at a pose
// (SAT_COVERAGE.high ringM 4400 mercator m, 16 nearest chunks, no lead) and
// replays the worker's admission stages offline: hide_3d, clipRing,
// classifyRingsSat, per-polygon explode, SAT_POLY_COVER area floor / ceiling,
// then height provenance. Also samples z13/z12 for generalisation.
// Usage: node scripts/wp-probe-data-tiles.mjs [outJson]
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import fs from 'node:fs';

const OUT = process.argv[2] || '.graphics-review/world-pass/review/data/tiles.json';
const R = 6378137, WORLD = 2 * Math.PI * R, HALF = WORLD / 2;
const POSES = {
  'nyc-street': [40.7311, -73.9892], 'nyc-top': [40.754, -73.984], brooklyn: [40.678, -73.97], paris: [48.853, 2.33],
  tokyo: [35.67, 139.735], london: [51.502, -0.1], powell: [40.199, -83.0811], 'phoenix-suburb': [33.38, -111.84],
  lagos: [6.45, 3.39], 'iowa-farm': [41.95, -93.7], dubai: [25.185, 55.26], hongkong: [22.29, 114.165],
};
const RING_M = 4400, MAXCH = 16, Z = 14;
const kRef = 1 / Math.cos((40 * Math.PI) / 180);

function signedArea(ring) { let s = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[i].x - ring[j].x) * (ring[i].y + ring[j].y); return s; }
function classifyRingsSat(rings) { const polys = []; let ext = 0, cur = null; for (const r of rings) { if (r.length < 3) continue; const a = signedArea(r); if (a === 0) continue; const s = a > 0 ? 1 : -1; if (!ext) ext = s; if (s === ext) { cur = { outer: r, holes: [] }; polys.push(cur); } else if (cur) cur.holes.push(r); } return polys; }
function lerpAt(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
function clipRing(ring, e) {
  let pts = ring;
  const edges = [[(p) => p.x >= 0, (a, b) => lerpAt(a, b, (0 - a.x) / (b.x - a.x))], [(p) => p.x <= e, (a, b) => lerpAt(a, b, (e - a.x) / (b.x - a.x))], [(p) => p.y >= 0, (a, b) => lerpAt(a, b, (0 - a.y) / (b.y - a.y))], [(p) => p.y <= e, (a, b) => lerpAt(a, b, (e - a.y) / (b.y - a.y))]];
  for (const [inside, isect] of edges) { if (!pts.length) return pts; const out = []; for (let i = 0; i < pts.length; i++) { const c = pts[i], p = pts[(i + pts.length - 1) % pts.length]; if (inside(c)) { if (!inside(p)) out.push(isect(p, c)); out.push(c); } else if (inside(p)) out.push(isect(p, c)); } pts = out; }
  return pts;
}
const lon2x = (lon) => R * lon * Math.PI / 180;
const lat2mercY = (lat) => R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
function ringTiles(lat, lon) {
  const px = lon2x(lon), pz = -lat2mercY(lat), span = WORLD / 2 ** Z, out = [];
  const t0x = Math.floor((px - RING_M + HALF) / span), t1x = Math.floor((px + RING_M + HALF) / span);
  const t0y = Math.floor((pz - RING_M + HALF) / span), t1y = Math.floor((pz + RING_M + HALF) / span);
  for (let ty = t0y; ty <= t1y; ty++) for (let tx = t0x; tx <= t1x; tx++) {
    const minX = -HALF + tx * span, minZ = -(HALF - ty * span);
    const dx = Math.max(minX - px, 0, px - (minX + span)), dz = Math.max(minZ - pz, 0, pz - (minZ + span));
    if (dx * dx + dz * dz > RING_M * RING_M) continue;
    out.push({ x: tx, y: ty, d2: (minX + span / 2 - px) ** 2 + (minZ + span / 2 - pz) ** 2 });
  }
  return out.sort((a, b) => a.d2 - b.d2).slice(0, MAXCH);
}
let tmpl;
async function getTile(z, x, y) {
  const url = tmpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const t = performance.now();
  const r = await fetch(url, { headers: { 'user-agent': 'tile-survey/1.0' } });
  if (r.status === 404 || r.status === 204) return { url, bytes: 0, vt: null, ms: performance.now() - t };
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  return { url, bytes: buf.length, vt: new VectorTile(new PbfReader(buf)), ms: performance.now() - t, enc: r.headers.get('content-encoding'), cache: r.headers.get('cache-control') };
}
function tileLatK(z, y) { const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / 2 ** z))); return 1 / Math.cos(lat); }

function survey(vt, z, y) {
  const L = vt.layers.building;
  const s = { features: 0, poly3: 0, hide3d: 0, ids: 0, keys: {}, colour: 0, colours: {}, minH: 0,
    polys: 0, multiPolyFeatures: 0, droppedSmall: 0, droppedHuge: 0, admitted: 0, edgeCut: 0, edgeCutDroppedSmall: 0,
    hDefault5: 0, hLevels: 0, hExplicit: 0, hTall35: 0, hMax: 0, area: { lt30: 0, lt70: 0, lt120n: 0, lt200: 0, lt1000: 0, lt10000: 0, ge10000: 0 },
    admittedTrueAreaM2: 0, hide3dArea: 0 };
  if (!L) return s;
  const k = tileLatK(z, y), span = WORLD / 2 ** z, scale = span / L.extent, e = L.extent;
  const trueA = 0.5 * scale * scale / (k * k), normA = trueA * kRef * kRef; // TRUE_AREAS: norm = true * kRef^2
  for (let i = 0; i < L.length; i++) {
    const f = L.feature(i); s.features++;
    for (const key of Object.keys(f.properties)) s.keys[key] = (s.keys[key] || 0) + 1;
    if (f.id !== undefined) s.ids++;
    if (f.type !== 3) continue; s.poly3++;
    const p = f.properties;
    if (p.colour) { s.colour++; s.colours[p.colour] = (s.colours[p.colour] || 0) + 1; }
    if (p.hide_3d) { s.hide3d++; continue; }
    if ((p.render_min_height ?? 0) > 0) s.minH++;
    const rings = f.loadGeometry().map((r) => clipRing(r, e));
    const polys = classifyRingsSat(rings.filter((r) => r.length >= 3));
    if (polys.length > 1) s.multiPolyFeatures++;
    let rawH = p.render_height ?? 0;
    for (const poly of polys) {
      s.polys++;
      const a = Math.abs(signedArea(poly.outer));
      const t = a * trueA, n = a * normA;
      const cut = poly.outer.some((q) => q.x <= 0 || q.y <= 0 || q.x >= e || q.y >= e);
      if (cut) s.edgeCut++;
      if (t < 30) s.area.lt30++; else if (t < 70) s.area.lt70++; else if (n < 120) s.area.lt120n++; else if (t < 200) s.area.lt200++; else if (t < 1000) s.area.lt1000++; else if (t < 10000) s.area.lt10000++; else s.area.ge10000++;
      if (n < 120) { s.droppedSmall++; if (cut) s.edgeCutDroppedSmall++; continue; }
      if (n > 60000) { s.droppedHuge++; continue; }
      s.admitted++; s.admittedTrueAreaM2 += t;
      if (rawH === 5 || rawH === 0) s.hDefault5++;
      else if (Math.abs(rawH / 3.66 - Math.round(rawH / 3.66)) < 0.02) s.hLevels++;
      else s.hExplicit++;
      if (rawH >= 35) s.hTall35++;
      if (rawH > s.hMax) s.hMax = rawH;
    }
  }
  return s;
}
const add = (a, b) => { for (const [k, v] of Object.entries(b)) { if (typeof v === 'number') a[k] = k === 'hMax' ? Math.max(a[k] || 0, v) : (a[k] || 0) + v; else if (v && typeof v === 'object') { a[k] = a[k] || {}; add(a[k], v); } } return a; };

const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
tmpl = tj.tiles[0];
const result = { tilejson: { tiles: tj.tiles, minzoom: tj.minzoom, maxzoom: tj.maxzoom, building: (tj.vector_layers || []).find((l) => l.id === 'building') }, poses: {} };
console.log('template', tmpl, 'maxzoom', tj.maxzoom, JSON.stringify(result.tilejson.building));
for (const [name, [lat, lon]] of Object.entries(POSES)) {
  const tiles = ringTiles(lat, lon);
  const agg = {}; let bytes = 0, ms = 0; const per = [];
  for (const t of tiles) {
    const g = await getTile(Z, t.x, t.y); bytes += g.bytes; ms += g.ms;
    const s = g.vt ? survey(g.vt, Z, t.y) : survey({ layers: {} }, Z, t.y);
    per.push({ tile: `${Z}/${t.x}/${t.y}`, bytes: g.bytes, features: s.features, admitted: s.admitted, droppedSmall: s.droppedSmall });
    add(agg, s);
  }
  // generalisation: the z13 and z12 parents of the centre tile, the same ground
  const c = tiles[0], lev = {};
  for (const zz of [13, 12]) {
    const sh = Z - zz, g = await getTile(zz, c.x >> sh, c.y >> sh);
    const s = g.vt ? survey(g.vt, zz, c.y >> sh) : null;
    // the z14 tiles that this parent covers, for a like-for-like count
    let childFeat = 0; let childPolys = 0;
    for (let dx = 0; dx < 2 ** sh; dx++) for (let dy = 0; dy < 2 ** sh; dy++) {
      if (zz === 12) continue; // only z13 gets the like-for-like child sum (4 tiles)
      const cg = await getTile(Z, ((c.x >> sh) << sh) + dx, ((c.y >> sh) << sh) + dy);
      if (cg.vt) { const cs = survey(cg.vt, Z, ((c.y >> sh) << sh) + dy); childFeat += cs.features; childPolys += cs.polys; }
    }
    lev[`z${zz}`] = s && { bytes: g.bytes, features: s.features, polys: s.polys, hide3d: s.hide3d, minH: s.minH, colour: s.colour, keys: s.keys, hTall35: s.hTall35, hDefault5: s.hDefault5, hLevels: s.hLevels, hExplicit: s.hExplicit, childZ14Features: zz === 13 ? childFeat : undefined, childZ14Polys: zz === 13 ? childPolys : undefined };
  }
  delete agg.colours;
  result.poses[name] = { lat, lon, tiles: tiles.length, bytes, fetchMs: Math.round(ms), agg, per, generalisation: lev };
  console.log(name, JSON.stringify({ tiles: tiles.length, kb: Math.round(bytes / 1024), features: agg.features, hide3d: agg.hide3d, polys: agg.polys, admitted: agg.admitted, droppedSmall: agg.droppedSmall, droppedHuge: agg.droppedHuge, edgeCut: agg.edgeCut, hDefault5: agg.hDefault5, hLevels: agg.hLevels, hExplicit: agg.hExplicit, colour: agg.colour, minH: agg.minH, keys: agg.keys, z13: lev.z13 && { f: lev.z13.features, child: lev.z13.childZ14Features }, z12: lev.z12 && lev.z12.features }));
}
fs.mkdirSync(OUT.replace(/[\\/][^\\/]*$/, ''), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
console.log('wrote', OUT);
