// Regression critique probe (read-only): OpenFreeMap z14 building polygon counts per tile for the Owens/Lone Pine/Melton/Powell 3x3.
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const tpl = tj.tiles[0];
const tileOf = (lat, lon, z) => [Math.floor((lon + 180) / 360 * 2 ** z), Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * 2 ** z)];
const POSES = { owens: [36.6, -118.1], 'lone-pine': [36.606, -118.063], melton: [-37.683, 144.58], powell: [40.199, -83.0811] };
for (const [name, [lat, lon]] of Object.entries(POSES)) {
  const [cx, cy] = tileOf(lat, lon, 14); const per = {};
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const url = tpl.replace('{z}', 14).replace('{x}', cx + dx).replace('{y}', cy + dy);
    const r = await fetch(url); const k = `${cx + dx}/${cy + dy}`;
    if (!r.ok) { per[k] = r.status; continue; }
    const vt = new VectorTile(new PbfReader(new Uint8Array(await r.arrayBuffer())));
    const L = vt.layers.building; let polys = 0;
    if (L) for (let i = 0; i < L.length; i++) { const g = L.feature(i).loadGeometry(); polys += g.length; }
    per[k] = polys;
  }
  console.log(name, JSON.stringify(per));
}
