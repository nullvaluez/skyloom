// World Pass review, skeptic "feasibility": does "keep the whole building in
// the tile that owns its centroid" (D-P4, FableFlight buildings.rs:1587) work
// on OpenFreeMap tiles? Counts building polygons that cross a tile edge, how
// many of those are still cut by the 64-unit tile buffer (generator clip), and
// for those, whether the centroid rule keeps it in 0, 1 or 2 tiles.
// Usage: node scripts/wp-probe-feasibility-buffer.mjs [outJson]
import fs from 'node:fs';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
const OUT = process.argv[2] || '.graphics-review/world-pass/review/critique-feasibility/buffer.json';
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const tpl = tj.tiles[0];
const tileOf = (lat, lon, z) => [Math.floor((lon + 180) / 360 * 2 ** z), Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * 2 ** z)];
const cache = new Map();
async function polys(z, x, y) {
  const k = `${z}/${x}/${y}`; if (cache.has(k)) return cache.get(k);
  const buf = new Uint8Array(await (await fetch(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y))).arrayBuffer());
  const L = new VectorTile(new PbfReader(buf)).layers.building; const out = [];
  if (L) for (let i = 0; i < L.length; i++) { const f = L.feature(i); if (f.properties.hide_3d) continue; const g = f.loadGeometry(); let sign = 0;
    for (const r of g) { let a = 0; for (let j = 0, n = r.length; j < n; j++) { const p = r[j], q = r[(j + 1) % n]; a += p.x * q.y - q.x * p.y; } if (!sign) sign = Math.sign(a); if (Math.sign(a) === sign) out.push({ r, a: Math.abs(a / 2), h: f.properties.render_height }); } }
  cache.set(k, out); return out;
}
const ext = 4096, B = 64;
function stats(list) {
  const s = { polys: list.length, crossEdge: 0, cutByBuffer: 0, cutCentroidIn: 0, cutCentroidOut: 0 };
  for (const p of list) {
    let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9, cx = 0, cy = 0; const n = p.r.length - 1 || 1;
    for (let j = 0; j < n; j++) { const q = p.r[j]; mnx = Math.min(mnx, q.x); mny = Math.min(mny, q.y); mxx = Math.max(mxx, q.x); mxy = Math.max(mxy, q.y); cx += q.x / n; cy += q.y / n; }
    const cross = mnx < 0 || mny < 0 || mxx > ext || mxy > ext; if (!cross) continue; s.crossEdge++;
    const cut = mnx <= -B + 1 || mny <= -B + 1 || mxx >= ext + B - 1 || mxy >= ext + B - 1;
    if (cut) { s.cutByBuffer++; if (cx >= 0 && cy >= 0 && cx < ext && cy < ext) s.cutCentroidIn++; else s.cutCentroidOut++; }
  }
  return s;
}
const CITIES = { midtown: [40.754, -73.984], paris: [48.853, 2.33], tokyo: [35.67, 139.735], phoenix: [33.38, -111.84], lagos: [6.45, 3.39] };
const res = { build: tpl };
for (const [c, [lat, lon]] of Object.entries(CITIES)) {
  const [x0, y0] = tileOf(lat, lon, 14); const agg = { polys: 0, crossEdge: 0, cutByBuffer: 0, cutCentroidIn: 0, cutCentroidOut: 0 };
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const s = stats(await polys(14, x0 + dx, y0 + dy)); for (const k in agg) agg[k] += s[k]; }
  agg.metresPerUnit = (40075016.7 * Math.cos(lat * Math.PI / 180)) / 2 ** 14 / ext;
  agg.bufferTrueM = +(B * agg.metresPerUnit).toFixed(1);
  res[c] = agg; console.log(c, JSON.stringify(agg));
}
fs.mkdirSync(OUT.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
