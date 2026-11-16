// World Pass review, skeptic "feasibility": which attributes are really in
// OpenFreeMap tiles at z12/z13/z14 for a few test cities (building,
// transportation, poi, housenumber, landuse). Read-only, public tiles.
// Usage: node scripts/wp-probe-feasibility-ofm.mjs [outJson]
import fs from 'node:fs';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
const OUT = process.argv[2] || '.graphics-review/world-pass/review/critique-feasibility/ofm.json';
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const tpl = tj.tiles[0];
const tileOf = (lat, lon, z) => [Math.floor((lon + 180) / 360 * 2 ** z), Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * 2 ** z)];
const CITIES = { midtown: [40.754, -73.984], paris: [48.853, 2.33], tokyo: [35.67, 139.735], phoenix: [33.38, -111.84] };
const res = { build: tpl };
for (const [c, [lat, lon]] of Object.entries(CITIES)) {
  res[c] = {};
  for (const z of [12, 13, 14]) {
    const [x, y] = tileOf(lat, lon, z);
    const r = await fetch(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    const buf = new Uint8Array(await r.arrayBuffer());
    const vt = new VectorTile(new PbfReader(buf));
    const o = { bytes: buf.length, layers: {} };
    for (const ln of ['building', 'transportation', 'poi', 'housenumber', 'landuse', 'landcover']) {
      const L = vt.layers[ln]; if (!L) { o.layers[ln] = null; continue; }
      const keys = {}; let rings = 0; const vals = {};
      for (let i = 0; i < L.length; i++) {
        const f = L.feature(i); const p = f.properties;
        for (const k of Object.keys(p)) keys[k] = (keys[k] || 0) + 1;
        if (ln === 'building') { rings += f.loadGeometry().length; if (p.render_height != null) { const h = p.render_height; vals[Number.isInteger(h) ? 'int' : 'dec'] = (vals[Number.isInteger(h) ? 'int' : 'dec'] || 0) + 1; } }
        if (ln === 'poi' && p.class) vals[p.class] = (vals[p.class] || 0) + 1;
      }
      o.layers[ln] = { features: L.length, rings: ln === 'building' ? rings : undefined, keys, vals: ln === 'building' ? vals : Object.fromEntries(Object.entries(vals).sort((a, b) => b[1] - a[1]).slice(0, 8)) };
    }
    res[c]['z' + z] = o;
  }
  console.log(c, JSON.stringify({ z12b: res[c].z12.layers.building?.features ?? null, z13b: res[c].z13.layers.building && { f: res[c].z13.layers.building.features, rings: res[c].z13.layers.building.rings, keys: res[c].z13.layers.building.keys }, z14b: res[c].z14.layers.building && { f: res[c].z14.layers.building.features, rings: res[c].z14.layers.building.rings, keys: res[c].z14.layers.building.keys, h: res[c].z14.layers.building.vals }, z14tr: res[c].z14.layers.transportation?.keys, z14poi: res[c].z14.layers.poi && res[c].z14.layers.poi.features, z14hn: res[c].z14.layers.housenumber?.features }));
}
fs.mkdirSync(OUT.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
