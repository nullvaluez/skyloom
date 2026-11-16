// Regression critique probe (read-only): would a 15 m2 floor turn an empty (no-mesh) z14 tile into a non-empty one?
// Approximation: each ring's |area| (holes counted as rings too, which only over-counts). True m2 from tile span at the tile's centre latitude.
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const tpl = tj.tiles[0];
const tileOf = (lat, lon, z) => [Math.floor((lon + 180) / 360 * 2 ** z), Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * 2 ** z)];
const POSES = { owens: [36.6, -118.1], 'iowa-farm': [41.95, -93.7], powell: [40.199, -83.0811], tokyo: [35.67, 139.735] };
const out = {};
for (const [name, [lat, lon]] of Object.entries(POSES)) {
  const [cx, cy] = tileOf(lat, lon, 14); const per = {};
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = cx + dx, y = cy + dy;
    const r = await fetch(tpl.replace('{z}', 14).replace('{x}', x).replace('{y}', y)); if (!r.ok) continue;
    const vt = new VectorTile(new PbfReader(new Uint8Array(await r.arrayBuffer())));
    const L = vt.layers.building; const n = Math.PI * (1 - 2 * (y + 0.5) / 2 ** 14); const tlat = Math.atan(Math.sinh(n));
    const m = 40075016.686 * Math.cos(tlat) / 2 ** 14 / 4096; let ge70 = 0, b15_70 = 0, lt15 = 0;
    if (L) for (let i = 0; i < L.length; i++) for (const ring of L.feature(i).loadGeometry()) {
      let a = 0; for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) a += (ring[j].x + ring[k].x) * (ring[j].y - ring[k].y);
      const m2 = Math.abs(a / 2) * m * m; if (m2 >= 70) ge70++; else if (m2 >= 15) b15_70++; else lt15++;
    }
    per[`${x}/${y}`] = { ge70, b15_70, lt15 };
  }
  const tiles = Object.values(per);
  out[name] = { tiles: tiles.length, emptyAt70: tiles.filter(t => t.ge70 === 0).length, nonEmptyOnlyAt15: tiles.filter(t => t.ge70 === 0 && t.b15_70 > 0).length, band15_70: tiles.reduce((s, t) => s + t.b15_70, 0), ge70: tiles.reduce((s, t) => s + t.ge70, 0) };
  console.log(name, JSON.stringify(out[name]));
}
import fs from 'node:fs';
fs.writeFileSync('.graphics-review/world-pass/review/critique-regression/floor-empty-tiles.json', JSON.stringify(out, null, 1));
