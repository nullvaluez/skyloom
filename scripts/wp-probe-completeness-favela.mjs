// Completeness critique probe: building polygons and the 70 m2 floor at Rocinha (informal settlement).
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import zlib from 'node:zlib';
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const lat = -22.9885, lon = -43.2480, z = 14;
const cx = Math.floor((lon + 180) / 360 * 2 ** z), cy = Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * 2 ** z);
let b = new Uint8Array(await (await fetch(tj.tiles[0].replace('{z}', z).replace('{x}', cx).replace('{y}', cy))).arrayBuffer()); if (b[0] === 0x1f) b = new Uint8Array(zlib.gunzipSync(b));
const L = new VectorTile(new PbfReader(b)).layers.building;
const mPerUnit = 40075016.7 * Math.cos(lat * Math.PI / 180) / 2 ** z / L.extent;
let polys = 0, under70 = 0, under30 = 0, mapped = 0; const areas = [];
for (let i = 0; i < L.length; i++) { const f = L.feature(i); if (f.properties.hide_3d) continue; const rh = f.properties.render_height;
  for (const r of f.loadGeometry()) { let a = 0; for (let k = 0, j = r.length - 1; k < r.length; j = k++) a += (r[j].x * r[k].y - r[k].x * r[j].y); a = a / 2 * mPerUnit * mPerUnit; if (Math.abs(a) < 1e-6) continue; const A = Math.abs(a); if (A < 2) continue; polys++; areas.push(A); if (A < 70.4) under70++; if (A < 30) under30++; if (rh != null && rh !== 5) mapped++; } }
areas.sort((x, y) => x - y);
console.log(JSON.stringify({ tile: `${z}/${cx}/${cy}`, ringsIncludingHoles: polys, under70, under30, share_under70: +(under70 / polys).toFixed(2), medianM2: Math.round(areas[areas.length >> 1]), mappedNon5: mapped }));
