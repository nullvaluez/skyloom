// WORLD PASS review, lens "stream": source-data census. How many buildings does OpenFreeMap
// carry per z14 tile, how many are tall, and what do the shipped caps keep?
// Also measures z13/z12/z15 building presence and per-tile bytes/latency (the streaming cost).
// Read-only: fetches public tiles, writes JSON under the review folder.
//   node scripts/wp-probe-stream-tiles.mjs
import { VectorTile } from '@mapbox/vector-tile';
import * as PbfNS from 'pbf';
const Pbf = PbfNS.PbfReader;
import fs from 'node:fs';
import zlib from 'node:zlib';

const OUT = 'C:/Users/bfecho/skyloom-3/.claude/worktrees/mystifying-curran-97a006/.graphics-review/world-pass/review/stream/tiles.json';
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const tmpl = tj.tiles[0];
const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
async function tile(z, x, y) {
  const url = tmpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const t0 = performance.now();
  const res = await fetch(url);
  let buf = Buffer.from(await res.arrayBuffer());
  const ms = performance.now() - t0;
  const bytes = buf.length;
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  const vt = new VectorTile(new Pbf(buf));
  const L = vt.layers.building;
  let n = 0, tall35 = 0, h20 = 0, withH = 0, polys = 0, neg = 0;
  const hs = [];
  if (L) for (let i = 0; i < L.length; i++) {
    const f = L.feature(i); n++;
    const h = Number(f.properties.render_height ?? f.properties.height);
    if (Number.isFinite(h)) { withH++; hs.push(h); if (h >= 35) tall35++; if (h >= 20) h20++; }
    // polygons (outer rings) in the feature
    const g = f.loadGeometry();
    for (const ring of g) { let a = 0; for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) a += (ring[j].x - ring[k].x) * (ring[j].y + ring[k].y); if (a > 0) polys += 1; else if (a < 0) neg += 1; }
  }
  hs.sort((a, b) => b - a);
  return { z, x, y, status: res.status, bytes, ms: Math.round(ms), cors: res.headers.get('access-control-allow-origin'), buildings: n, withH, tall35, h20, polysPos: polys, polysNeg: neg, maxH: hs[0] ?? null, p90H: hs[Math.floor(hs.length * 0.1)] ?? null };
}
const PLACES = {
  midtown: [40.7549, -73.9840], downtown: [40.7075, -74.0110], brooklyn: [40.6780, -73.9700], jersey: [40.7280, -74.0776],
  powell: [40.1590, -83.0750], paris: [48.8566, 2.3522], tokyo: [35.6900, 139.7000], phoenix: [33.3800, -111.8400], lagos: [6.4500, 3.3900], owens: [36.6, -118.06],
};
const out = { tilejson: { tiles: tmpl, maxzoom: tj.maxzoom, minzoom: tj.minzoom }, z14: {}, zooms: {} };
for (const [name, [lat, lon]] of Object.entries(PLACES)) {
  const z = 14, cx = lon2x(lon, z), cy = lat2y(lat, z);
  const rows = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) rows.push(await tile(z, cx + dx, cy + dy));
  out.z14[name] = { center: rows[4], sum: rows.reduce((a, r) => a + r.buildings, 0), max: Math.max(...rows.map(r => r.buildings)), tall35: rows.reduce((a, r) => a + r.tall35, 0), bytes: rows.reduce((a, r) => a + r.bytes, 0), msMean: Math.round(rows.reduce((a, r) => a + r.ms, 0) / rows.length), rows };
  console.log(name, JSON.stringify({ sum: out.z14[name].sum, max: out.z14[name].max, tall35: out.z14[name].tall35, kb: Math.round(out.z14[name].bytes / 1024), ms: out.z14[name].msMean, center: rows[4].buildings }));
}
// Building presence across zooms at Midtown (what a far mass could stream instead of z14)
for (const z of [12, 13, 14]) {
  const r = await tile(z, lon2x(-73.984, z), lat2y(40.7549, z));
  out.zooms[z] = r; console.log('zoom', z, JSON.stringify(r));
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('wrote', OUT);
