// World Pass review, skeptic "feasibility": would a worker that drapes on the
// raw DEM (S-P1, G-P1, G-P5, G-P6) put content on the ground the player SEES?
// The drawn terrain is Esri Terrain3D LERC meshed by Martini at a per-zoom
// error (TERRA_SHARP.demErrorTable 13:45 14:18 15:5 16:2 m). Measures, per
// pose and zoom, |mesh height - raw grid height| over every grid sample, and
// |AWS Terrarium - Esri LERC| (the other DEM some proposals name).
// Usage: node scripts/wp-probe-feasibility-dem.mjs [outJson]
import fs from 'node:fs';
import { createRequire } from 'node:module';
import Martini from '@mapbox/martini';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
const Lerc = require('lerc');
const OUT = process.argv[2] || '.graphics-review/world-pass/review/critique-feasibility/dem.json';
const ERR = { 12: 178, 13: 45, 14: 18, 15: 5, 16: 2 }; // 12: three-tile default curve 7000*(1-z/17)^3 (TERRA_SHARP has no z12 entry)
const tileOf = (lat, lon, z) => [Math.floor((lon + 180) / 360 * 2 ** z), Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * 2 ** z)];
const POSES = { 'hongkong-midlevels': [22.276, 114.152], 'sf-hills': [37.757, -122.447], midtown: [40.754, -73.984], yosemite: [37.73, -119.6] };
function pct(a, p) { const s = Float64Array.from(a).sort(); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); }
async function lercGrid(z, x, y) {
  const r = await fetch(`https://server.arcgisonline.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer/tile/${z}/${y}/${x}`);
  const d = Lerc.decode(await r.arrayBuffer()); return { w: d.width, h: d.height, dem: d.pixels[0] };
}
function meshDev(g, err) {
  const n = g.w; const terr = new Float32Array(g.dem);
  const t = new Martini(n).createTile(terr); const { vertices, triangles } = t.getMesh(err);
  const dev = [];
  for (let k = 0; k < triangles.length; k += 3) {
    const a = triangles[k] * 2, b = triangles[k + 1] * 2, c = triangles[k + 2] * 2;
    const ax = vertices[a], ay = vertices[a + 1], bx = vertices[b], by = vertices[b + 1], cx = vertices[c], cy = vertices[c + 1];
    const za = terr[ay * n + ax], zb = terr[by * n + bx], zc = terr[cy * n + cx];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (!den) continue;
    for (let y = Math.min(ay, by, cy); y <= Math.max(ay, by, cy); y++) for (let x = Math.min(ax, bx, cx); x <= Math.max(ax, bx, cx); x++) {
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den, l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      dev.push(Math.abs(l1 * za + l2 * zb + l3 * zc - terr[y * n + x]));
    }
  }
  return { tris: triangles.length / 3, p50: pct(dev, 0.5), p90: pct(dev, 0.9), p99: pct(dev, 0.99), max: pct(dev, 1) };
}
async function terrarium(z, x, y) {
  const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`);
  const { data, info } = await sharp(Buffer.from(await r.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
  const e = new Float32Array(info.width * info.height); for (let i = 0; i < e.length; i++) { const o = i * info.channels; e[i] = data[o] * 256 + data[o + 1] + data[o + 2] / 256 - 32768; }
  return { w: info.width, e };
}
const res = {};
for (const [name, [lat, lon]] of Object.entries(POSES)) {
  res[name] = {};
  for (const z of [12, 13, 14, 15, 16]) {
    const [x, y] = tileOf(lat, lon, z);
    try { const g = await lercGrid(z, x, y); res[name]['z' + z] = { grid: `${g.w}x${g.h}`, relief: +(Math.max(...g.dem) - Math.min(...g.dem)).toFixed(1), err: ERR[z], ...meshDev(g, ERR[z]) };
      if (z === 14) { // Terrarium vs Esri at the LERC grid points (bilinear on pixel centres)
        const t = await terrarium(z, x, y); const d = [];
        for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) { const u = i / (g.w - 1) * t.w - 0.5, v = j / (g.h - 1) * t.w - 0.5; const x0 = Math.max(0, Math.min(t.w - 2, Math.floor(u))), y0 = Math.max(0, Math.min(t.w - 2, Math.floor(v))); const fx = Math.min(1, Math.max(0, u - x0)), fy = Math.min(1, Math.max(0, v - y0));
          const q = (a, b) => t.e[b * t.w + a]; const h = (q(x0, y0) * (1 - fx) + q(x0 + 1, y0) * fx) * (1 - fy) + (q(x0, y0 + 1) * (1 - fx) + q(x0 + 1, y0 + 1) * fx) * fy; d.push(Math.abs(h - g.dem[j * g.w + i])); }
        res[name].terrariumVsEsriZ14 = { p50: pct(d, 0.5), p90: pct(d, 0.9), p99: pct(d, 0.99), max: pct(d, 1) };
      }
    } catch (e) { res[name]['z' + z] = { error: String(e).slice(0, 200) }; }
  }
  console.log(name, JSON.stringify(res[name]));
}
fs.mkdirSync(OUT.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
