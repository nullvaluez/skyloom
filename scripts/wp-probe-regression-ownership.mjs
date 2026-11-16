// Regression critique probe (read-only): does "whole footprint owned by its centroid tile" (D-P4) hold with
// OpenFreeMap's 64-unit buffer? For every pair of adjacent z14 tiles, rings that cross the shared edge are
// matched across the two tiles by overlap of their edge crossing; we count rings that are still CUT at the
// buffer boundary (any vertex within 0.5 unit of -64 or 4160 on that axis) and simulate ownership from each
// side's own (buffer-clipped) geometry: 'both' = duplicate, 'neither' = vanishes.
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import fs from 'node:fs';
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const tpl = tj.tiles[0];
const tileOf = (lat, lon, z) => [Math.floor((lon + 180) / 360 * 2 ** z), Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * 2 ** z)];
const POSES = { midtown: [40.754, -73.984], paris: [48.853, 2.33], tokyo: [35.67, 139.735] };
const E = 4096;
function rings(x, y, buf) { return buf; }
async function load(x, y) {
  const r = await fetch(tpl.replace('{z}', 14).replace('{x}', x).replace('{y}', y)); if (!r.ok) return [];
  const vt = new VectorTile(new PbfReader(new Uint8Array(await r.arrayBuffer())));
  const L = vt.layers.building; const out = [];
  if (L) for (let i = 0; i < L.length; i++) for (const ring of L.feature(i).loadGeometry()) {
    let a = 0, cx = 0, cy = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) { const f = ring[j].x * ring[k].y - ring[k].x * ring[j].y; a += f; cx += (ring[j].x + ring[k].x) * f; cy += (ring[j].y + ring[k].y) * f; }
    for (const p of ring) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    if (Math.abs(a) < 1) continue;
    out.push({ cx: cx / (3 * a), cy: cy / (3 * a), minX, maxX, minY, maxY, area: Math.abs(a / 2) });
  }
  return out;
}
const res = {};
for (const [name, [lat, lon]] of Object.entries(POSES)) {
  const [cx, cy] = tileOf(lat, lon, 14); const T = {};
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) T[`${cx + dx}/${cy + dy}`] = await load(cx + dx, cy + dy);
  let crossing = 0, stillCut = 0, both = 0, neither = 0, agree = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 0; dx++) {
    // vertical shared edge between A=(x,y) and B=(x+1,y): A's x=4096 is B's x=0
    const A = T[`${cx + dx}/${cy + dy}`], B = T[`${cx + dx + 1}/${cy + dy}`];
    const aC = A.filter(r => r.minX < E && r.maxX > E), bC = B.filter(r => r.minX < 0 && r.maxX > 0);
    crossing += aC.length;
    for (const ra of aC) {
      // match: the B ring whose y-range overlaps most and that also crosses the edge
      let best = null, bo = 0;
      for (const rb of bC) { const o = Math.min(ra.maxY, rb.maxY) - Math.max(ra.minY, rb.minY); if (o > bo) { bo = o; best = rb; } }
      if (!best) continue;
      const cutA = ra.minX <= -63.5 || ra.maxX >= E + 63.5, cutB = best.minX <= -63.5 || best.maxX >= E + 63.5;
      if (cutA || cutB) stillCut++;
      const ownA = ra.cx >= 0 && ra.cx < E, ownB = best.cx >= 0 && best.cx < E; // each side judges with its own clipped ring
      if (ownA && ownB) both++; else if (!ownA && !ownB) neither++; else agree++;
    }
  }
  res[name] = { verticalEdgeCrossings: crossing, stillCutAtBuffer: stillCut, ownedByBoth: both, ownedByNeither: neither, consistent: agree };
  console.log(name, JSON.stringify(res[name]));
}
fs.writeFileSync('.graphics-review/world-pass/review/critique-regression/ownership.json', JSON.stringify(res, null, 1));
