// World Pass skeptic, angle "realism" (read-only probe). Is a "median of mapped neighbours" height
// prior biased? Compares footprint area of buildings with a mapped height (render_height != 5)
// against unmapped ones, and the mapped-height distribution, in 3x3 z14 tiles per place.
// Usage: node scripts/wp-probe-realism-mapbias.mjs <outJson>
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import fs from 'node:fs';
const OUT = process.argv[2] || '.graphics-review/world-pass/review/critique-realism/mapbias.json';
const PLACES = { lagos: [6.45, 3.39], phoenix: [33.38, -111.84], tokyo: [35.67, 139.735], dubai: [25.185, 55.26], london: [51.502, -0.1], powell: [40.199, -83.0811] };
const Z = 14;
const tileXY = (lat, lon, z) => { const n = 2 ** z, r = lat * Math.PI / 180; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)]; };
const tmpl = (await (await fetch('https://tiles.openfreemap.org/planet')).json()).tiles[0];
function sa(r) { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[i].x - r[j].x) * (r[i].y + r[j].y); return s; }
function polys(rings) { const out = []; let ext = 0; for (const r of rings) { if (r.length < 3) continue; const a = sa(r); if (!a) continue; const s = a > 0 ? 1 : -1; if (!ext) ext = s; if (s === ext) out.push(Math.abs(a) / 2); } return out; }
const q = (a, p) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return +b[Math.min(b.length - 1, Math.floor(b.length * p))].toFixed(1); };
const res = {};
for (const [name, [lat, lon]] of Object.entries(PLACES)) {
  const [cx, cy] = tileXY(lat, lon, Z); const mArea = [], uArea = [], mH = [];
  const mPerUnit = (2 * Math.PI * 6378137 * Math.cos(lat * Math.PI / 180)) / (2 ** Z * 4096);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const buf = Buffer.from(await (await fetch(tmpl.replace('{z}', Z).replace('{x}', cx + dx).replace('{y}', cy + dy))).arrayBuffer());
    const L = new VectorTile(new PbfReader(buf)).layers.building; if (!L) continue;
    const k = mPerUnit * mPerUnit * (4096 / L.extent) ** 2;
    for (let f = 0; f < L.length; f++) { const ft = L.feature(f); if (ft.type !== 3 || ft.properties.hide_3d) continue; const h = +ft.properties.render_height || 5; const mapped = h !== 5; for (const a of polys(ft.loadGeometry())) { const m2 = a * k; if (m2 < 15) continue; if (mapped) { mArea.push(m2); mH.push(h); } else uArea.push(m2); } }
  }
  res[name] = { mapped: mArea.length, unmapped: uArea.length, mappedShare: +(mArea.length / (mArea.length + uArea.length)).toFixed(3), mappedAreaP50: q(mArea, 0.5), unmappedAreaP50: q(uArea, 0.5), mappedHeightP25: q(mH, 0.25), mappedHeightP50: q(mH, 0.5), mappedHeightP75: q(mH, 0.75) };
  console.log(name, JSON.stringify(res[name]));
}
fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
