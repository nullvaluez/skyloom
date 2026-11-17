// Adversarial verify (stream E): from a <pose>.verify.json, (1) canopy cover against ESA WorldCover class 10
// within 600 and 900 m: crown-area SUM and crown UNION (2 m raster) inside real canopy, for the WP layers
// (crowns + patches) and the legacy layers; (2) every drawn crown centre against OpenFreeMap z14 data fetched
// here: water polygons, building polygons, road centrelines (class half-width, no kerb), aeroway polygons
// and runway lines. Usage: node wp-ground-verify-cover.mjs <file.verify.json>
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(process.env.WT ? process.env.WT + '/package.json' : new URL('../package.json', import.meta.url));
const sharp = require('sharp'); const { VectorTile } = require('@mapbox/vector-tile'); const Pbf = require('pbf').PbfReader ?? require('pbf').default ?? require('pbf');
const file = process.argv[2];
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
const R = 6378137, DEG = 180 / Math.PI;
const [px, pz] = d.player;
const lon0 = px / R * DEG, lat0 = (2 * Math.atan(Math.exp(-pz / R)) - Math.PI / 2) * DEG, cosL = Math.cos(lat0 / DEG);
const Z = 14, N = 2 ** Z;
const toPix = (lon, lat) => { const r = lat / DEG; return [(lon + 180) / 360 * N * 256, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * N * 256]; };
const mPerPx = 2 * Math.PI * R / (N * 256) * cosL;
const [cx, cy] = toPix(lon0, lat0);
const legend = new Map([[0x006400, 10], [0xffbb22, 20], [0xffff4c, 30], [0xf096ff, 40], [0xfa0000, 50], [0xb4b4b4, 60], [0xf0f0f0, 70], [0x0064c8, 80], [0x0096a0, 90], [0x00cf75, 95], [0xfae6a0, 100]]);
const tiles = new Map();
const rMax = 950 / mPerPx;
for (let ty = Math.floor((cy - rMax) / 256); ty <= Math.floor((cy + rMax) / 256); ty++) for (let tx = Math.floor((cx - rMax) / 256); tx <= Math.floor((cx + rMax) / 256); tx++) {
  const u = `https://wmts.terrascope.be/?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=esa-worldcover-map-10m-2021-v2_map&STYLE=default&TILEMATRIXSET=EPSG:3857&TILEMATRIX=${Z}&TILECOL=${tx}&TILEROW=${ty}&FORMAT=image/png&TIME=2021-01-01`;
  const r = await fetch(u); if (!r.ok) continue;
  const { data } = await sharp(Buffer.from(await r.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  tiles.set(`${tx}_${ty}`, data);
}
const cls = (gx, gy) => { const t = tiles.get(`${Math.floor(gx / 256)}_${Math.floor(gy / 256)}`); if (!t) return -1; const i = ((Math.floor(gy) & 255) * 256 + (Math.floor(gx) & 255)) * 4; if (t[i + 3] !== 255) return 0; return legend.get((t[i] << 16) | (t[i + 1] << 8) | t[i + 2]) ?? 0; };
function cover(trees, radiusM) {
  const rPx = radiusM / mPerPx, cellPx = 2 / mPerPx, nC = Math.ceil(2 * rPx / cellPx), cov = new Uint8Array(nC * nC);
  let sum = 0;
  for (const [lon, lat, rad] of trees) {
    const [gx, gy] = toPix(lon, lat);
    if ((gx - cx) ** 2 + (gy - cy) ** 2 > rPx * rPx) continue;
    sum += Math.PI * rad * rad;
    const rr = rad / mPerPx;
    const x0 = Math.max(0, Math.floor((gx - rr - (cx - rPx)) / cellPx)), x1 = Math.min(nC - 1, Math.floor((gx + rr - (cx - rPx)) / cellPx));
    const y0 = Math.max(0, Math.floor((gy - rr - (cy - rPx)) / cellPx)), y1 = Math.min(nC - 1, Math.floor((gy + rr - (cy - rPx)) / cellPx));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const qx = cx - rPx + (x + 0.5) * cellPx, qy = cy - rPx + (y + 0.5) * cellPx; if ((qx - gx) ** 2 + (qy - gy) ** 2 <= rr * rr) cov[y * nC + x] = 1; }
  }
  let disc = 0, tree = 0, uIn = 0, uOut = 0;
  for (let y = 0; y < nC; y++) for (let x = 0; x < nC; x++) {
    const qx = cx - rPx + (x + 0.5) * cellPx, qy = cy - rPx + (y + 0.5) * cellPx;
    if ((qx - cx) ** 2 + (qy - cy) ** 2 > rPx * rPx) continue;
    const c = cls(qx, qy); if (c < 0) continue; disc++;
    const t = c === 10 || c === 95; if (t) tree++;
    if (cov[y * nC + x]) { if (t) uIn++; else uOut++; }
  }
  const canopyM2 = tree * 4;
  return { realSharePct: +(100 * tree / disc).toFixed(1), sumPct: canopyM2 ? +(100 * sum / canopyM2).toFixed(1) : null, unionInPct: tree ? +(100 * uIn / tree).toFixed(1) : null, unionOutsideOfNonTreePct: disc - tree ? +(100 * uOut / (disc - tree)).toFixed(1) : null };
}
const wp = [...d.crowns.map((c) => [c[0], c[1], c[2]]), ...d.patches];
const res = { pose: d.pose, crowns: d.crowns.length, patches: d.patches.length, legacy: d.legacy.length };
for (const r of [600, 900]) { res['wp' + r] = cover(wp, r); res['wpCrownsOnly' + r] = cover(d.crowns.map((c) => [c[0], c[1], c[2]]), r); if (d.legacy.length) res['legacy' + r] = cover(d.legacy, r); }
// OFM checks on crown centres
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const tmpl = tj.tiles[0];
const ofm = new Map();
async function tileOf(x, y) { const key = `${x}/${y}`; if (ofm.has(key)) return ofm.get(key); const r = await fetch(tmpl.replace('{z}', 14).replace('{x}', x).replace('{y}', y)); const vt = r.ok ? new VectorTile(new Pbf(Buffer.from(await r.arrayBuffer()))) : null; const prep = vt ? prepTile(vt) : null; ofm.set(key, prep); return prep; }
const ROAD_W = { motorway: 22, trunk: 18, primary: 14, secondary: 12, tertiary: 10, minor: 8, service: 5, rail: 6, transit: 5 };
function prepTile(vt) {
  const polys = { water: [], building: [], aeroway: [] }, lines = [];
  for (const name of ['water', 'building', 'aeroway', 'transportation']) {
    const L = vt.layers[name]; if (!L) continue;
    for (let i = 0; i < L.length; i++) {
      const f = L.feature(i); const g = f.loadGeometry().map((r) => r.map((p) => [p.x / L.extent, p.y / L.extent]));
      if (f.type === 3 && polys[name]) polys[name].push({ g, props: f.properties });
      if (f.type === 2 && name === 'transportation' && f.properties.brunnel !== 'tunnel' && ROAD_W[f.properties.class]) lines.push({ g, w: ROAD_W[f.properties.class], cls: f.properties.class });
      if (f.type === 2 && name === 'aeroway' && f.properties.class === 'runway') lines.push({ g, w: 60, cls: 'runway' });
    }
  }
  return { polys, lines };
}
const inPoly = (rings, x, y) => { let ins = false; for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; };
const segD = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; const t = l ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l)) : 0; return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); };
const hits = { water: 0, building: 0, aeroway: 0, road: 0, runway: 0, roadByCls: {} }, examples = [];
for (const c of d.crowns) {
  const [lon, lat] = c; const [gx, gy] = toPix(lon, lat); const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
  const T = await tileOf(tx, ty); if (!T) continue;
  const x = gx / 256 - tx, y = gy / 256 - ty;
  const tileM = 2 * Math.PI * R / N * cosL;
  for (const kind of ['water', 'building', 'aeroway']) for (const p of T.polys[kind]) { if (kind === 'water' && p.props.class === 'swimming_pool') continue; if (inPoly(p.g, x, y)) { hits[kind]++; if (examples.length < 12) examples.push([kind, lon, lat]); break; } }
  for (const L of T.lines) { let dm = Infinity; for (const part of L.g) for (let i = 1; i < part.length; i++) dm = Math.min(dm, segD(x, y, part[i - 1], part[i]) * tileM); if (dm < L.w / 2) { if (L.cls === 'runway') hits.runway++; else { hits.road++; hits.roadByCls[L.cls] = (hits.roadByCls[L.cls] || 0) + 1; } if (examples.length < 12) examples.push([L.cls, lon, lat, +dm.toFixed(1)]); break; } }
}
res.ofmCrownHits = hits; res.examples = examples;
res.live = { draws: d.draws, tris: d.triangles, near: d.near, far: d.far, deck: d.deck, satveg: d.satveg, crownStats: d.crownStats };
console.log(JSON.stringify(res));
fs.writeFileSync(file.replace(/\.verify\.json$/, '.cover.json'), JSON.stringify(res, null, 1));
