// Dev tool: dump layer/class/geometry stats for one OpenFreeMap tile.
// Usage: node scripts/inspect-mvt.mjs <z> <x> <y>
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';

const [z, x, y] = process.argv.slice(2).map(Number);
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const url = tj.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y);
const buf = await (await fetch(url)).arrayBuffer();
const vt = new VectorTile(new PbfReader(new Uint8Array(buf)));
for (const [name, layer] of Object.entries(vt.layers)) {
  const byClass = new Map();
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    const key = `${f.properties.class ?? '?'}·t${f.type}`;
    byClass.set(key, (byClass.get(key) ?? 0) + 1);
  }
  console.log(name.padEnd(18), [...byClass.entries()].map(([k, v]) => `${k}×${v}`).join(' '));
}
