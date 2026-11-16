// Completeness critique probe: how many bridge segments (transportation brunnel=bridge)
// cross OSM water in the 3x3 z14 tiles around a pose. These get no 3D deck and,
// where they lie inside a water polygon, the earth water shader paints over them.
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import zlib from 'node:zlib';
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const tmpl = tj.tiles[0];
const tileOf = (lat, lon, z) => [Math.floor((lon + 180) / 360 * 2 ** z), Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * 2 ** z)];
const POSES = { paris: [48.8535, 2.353], nyc: [40.705, -73.985], london: [51.506, -0.09], tokyo: [35.655, 139.76], hongkong: [22.29, 114.165], venice: [45.437, 12.335] };
function pip(pt, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; }
const out = {};
for (const [name, [lat, lon]] of Object.entries(POSES)) {
  const [cx, cy] = tileOf(lat, lon, 14); let bridges = 0, overWater = 0, lenOverWaterM = 0, byClass = {};
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const url = tmpl.replace('{z}', 14).replace('{x}', cx + dx).replace('{y}', cy + dy);
    const r = await fetch(url); if (!r.ok) continue; let b = new Uint8Array(await r.arrayBuffer()); if (b[0] === 0x1f) b = new Uint8Array(zlib.gunzipSync(b));
    const vt = new VectorTile(new PbfReader(b)); const W = vt.layers.water, T = vt.layers.transportation; if (!T) continue;
    const rings = []; if (W) for (let i = 0; i < W.length; i++) { const f = W.feature(i); if (f.type === 3) for (const r of f.loadGeometry()) rings.push(r); }
    const mPerUnit = 40075016.7 * Math.cos(lat * Math.PI / 180) / 2 ** 14 / T.extent;
    for (let i = 0; i < T.length; i++) { const f = T.feature(i); if (f.properties.brunnel !== 'bridge' || f.type !== 2) continue; const cls = f.properties.class; if (cls === 'path' || cls === 'track') continue;
      for (const line of f.loadGeometry()) { bridges++; byClass[cls] = (byClass[cls] || 0) + 1; let wet = false;
        for (let k = 1; k < line.length; k++) { const m = { x: (line[k].x + line[k - 1].x) / 2, y: (line[k].y + line[k - 1].y) / 2 }; let inW = 0; for (const rg of rings) if (pip(m, rg)) inW ^= 1; if (inW) { wet = true; lenOverWaterM += Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y) * mPerUnit; } }
        if (wet) overWater++; } }
  }
  out[name] = { bridgeSegments: bridges, segmentsCrossingWater: overWater, deckLengthOverWaterM: Math.round(lenOverWaterM), byClass };
}
console.log(JSON.stringify(out, null, 1));
