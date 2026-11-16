// World-pass review (system lens), read-only: what does ONE decode of a dense
// z14 OpenFreeMap tile cost (PBF parse + every layer's geometry), i.e. the
// work each satellite worker repeats for the same tile today?
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
const UA = { 'User-Agent': 'world-pass-review-probe/1.0' };
const tj = await (await fetch('https://tiles.openfreemap.org/planet', { headers: UA })).json();
const tiles = { 'manhattan-midtown z14': [14, 4824, 6156], 'manhattan z13': [13, 2412, 3078], 'tokyo z14': [14, 14552, 6451] };
const out = {};
for (const [name, [z, x, y]] of Object.entries(tiles)) {
  const buf = new Uint8Array(await (await fetch(tj.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y), { headers: UA })).arrayBuffer());
  const run = (layers) => {
    const vt = new VectorTile(new PbfReader(buf));
    let n = 0;
    for (const ln of layers ?? Object.keys(vt.layers)) {
      const l = vt.layers[ln]; if (!l) continue;
      for (let i = 0; i < l.length; i++) { const f = l.feature(i); const g = f.loadGeometry(); n += g.length; void f.properties; }
    }
    return n;
  };
  for (let i = 0; i < 5; i++) run(); // warm
  const N = 20;
  let t = performance.now(); for (let i = 0; i < N; i++) run(); const all = (performance.now() - t) / N;
  t = performance.now(); for (let i = 0; i < N; i++) run(['building']); const bld = (performance.now() - t) / N;
  const vt = new VectorTile(new PbfReader(buf));
  out[name] = { kb: Math.round(buf.length / 1024), layers: Object.fromEntries(Object.entries(vt.layers).map(([k, l]) => [k, l.length])), msAllLayers: +all.toFixed(2), msBuildingLayer: +bld.toFixed(2) };
}
console.log(JSON.stringify(out, null, 1));
