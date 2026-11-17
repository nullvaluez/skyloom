// WORLD PASS E (GROUND): copied from the review's scripts/wp-probe-ground-canopy.mjs and extended
// with the crown UNION (rasterised at 2 m) inside real canopy and a per-layer count. Reads the
// dumps of scripts/wp-ground-live.cjs ([lon, lat, radiusM, layer]).
// World-pass ground review: how much of the REAL tree canopy do the placed 3D trees cover?
// Real canopy = ESA WorldCover 2021 class 10 (tree cover), the same keyless WMTS the game's
// sat-veg worker already reads (lib/fly/world-cover.js). Placed trees come from a
// <shot>.dump.json (scripts/wp-probe-ground-capture.cjs --dump): rows [lon, lat, radiusM, form, cls].
// Usage: node scripts/wp-probe-ground-canopy.mjs <dump.json> [radiusM=900]
import fs from 'node:fs'; import path from 'node:path'; import sharp from 'sharp';
const file = process.argv[2], radiusM = Number(process.argv[3] || 900);
const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
const R = 6378137, D = 180 / Math.PI, Z = 14, N = 2 ** Z;
const [px, pz] = dump.player;
const lon0 = px / R * D, lat0 = (2 * Math.atan(Math.exp(-pz / R)) - Math.PI / 2) * D, cosL = Math.cos(lat0 / D);
const toPix = (lon, lat) => { const r = lat / D; return [(lon + 180) / 360 * N * 256, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * N * 256]; };
const mPerPx = 2 * Math.PI * R / (N * 256) * cosL, [cx, cy] = toPix(lon0, lat0), rPx = radiusM / mPerPx;
const legend = new Map([[0x006400, 10], [0xffbb22, 20], [0xffff4c, 30], [0xf096ff, 40], [0xfa0000, 50], [0xb4b4b4, 60], [0xf0f0f0, 70], [0x0064c8, 80], [0x0096a0, 90], [0x00cf75, 95], [0xfae6a0, 100]]);
const tiles = new Map();
for (let ty = Math.floor((cy - rPx) / 256); ty <= Math.floor((cy + rPx) / 256); ty++) for (let tx = Math.floor((cx - rPx) / 256); tx <= Math.floor((cx + rPx) / 256); tx++) {
  const u = `https://wmts.terrascope.be/?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=esa-worldcover-map-10m-2021-v2_map&STYLE=default&TILEMATRIXSET=EPSG:3857&TILEMATRIX=${Z}&TILECOL=${tx}&TILEROW=${ty}&FORMAT=image/png&TIME=2021-01-01`;
  const r = await fetch(u); if (!r.ok) continue;
  const { data } = await sharp(Buffer.from(await r.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  tiles.set(`${tx}_${ty}`, data);
}
const cls = (gx, gy) => { const t = tiles.get(`${Math.floor(gx / 256)}_${Math.floor(gy / 256)}`); if (!t) return -1; const i = ((Math.floor(gy) & 255) * 256 + (Math.floor(gx) & 255)) * 4; if (t[i + 3] !== 255) return 0; return legend.get((t[i] << 16) | (t[i + 1] << 8) | t[i + 2]) ?? 0; };
let disc = 0, tree = 0; const hist = {};
for (let y = Math.floor(cy - rPx); y <= cy + rPx; y++) for (let x = Math.floor(cx - rPx); x <= cx + rPx; x++) {
  if ((x - cx) ** 2 + (y - cy) ** 2 > rPx * rPx) continue; const c = cls(x, y); if (c < 0) continue; disc++; hist[c] = (hist[c] || 0) + 1; if (c === 10) tree++;
}
const pxArea = mPerPx * mPerPx, canopyM2 = tree * pxArea;
const trees = dump.trees.filter(([lon, lat]) => { const [gx, gy] = toPix(lon, lat); return (gx - cx) ** 2 + (gy - cy) ** 2 < rPx * rPx; });
let crownM2 = 0, onCanopy = 0; const byLayer = {}; for (const [lon, lat, rad, layer] of trees) { crownM2 += Math.PI * rad * rad; byLayer[layer] = (byLayer[layer] || 0) + 1; const [gx, gy] = toPix(lon, lat); if (cls(gx, gy) === 10) onCanopy++; }
// union at 2 m: cells of the disc covered by any crown, inside / outside real canopy
const cellPx = 2 / mPerPx, nC = Math.ceil(2 * rPx / cellPx), cov = new Uint8Array(nC * nC);
for (const [lon, lat, rad] of trees) { const [gx, gy] = toPix(lon, lat), rr = rad / mPerPx; const x0 = Math.max(0, Math.floor((gx - rr - (cx - rPx)) / cellPx)), x1 = Math.min(nC - 1, Math.floor((gx + rr - (cx - rPx)) / cellPx)), y0 = Math.max(0, Math.floor((gy - rr - (cy - rPx)) / cellPx)), y1 = Math.min(nC - 1, Math.floor((gy + rr - (cy - rPx)) / cellPx)); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const qx = cx - rPx + (x + 0.5) * cellPx, qy = cy - rPx + (y + 0.5) * cellPx; if ((qx - gx) ** 2 + (qy - gy) ** 2 <= rr * rr) cov[y * nC + x] = 1; } }
let uIn = 0, uOut = 0, cTree = 0, cDisc = 0; for (let y = 0; y < nC; y++) for (let x = 0; x < nC; x++) { const qx = cx - rPx + (x + 0.5) * cellPx, qy = cy - rPx + (y + 0.5) * cellPx; if ((qx - cx) ** 2 + (qy - cy) ** 2 > rPx * rPx) continue; const c = cls(qx, qy); if (c < 0) continue; cDisc++; const t = c === 10; if (t) cTree++; if (cov[y * nC + x]) { if (t) uIn++; else uOut++; } }
const out = { file: path.basename(file), lat0: +lat0.toFixed(4), lon0: +lon0.toFixed(4), radiusM, worldCoverPxM: +mPerPx.toFixed(1),
  realCanopyKm2: +(canopyM2 / 1e6).toFixed(3), realCanopySharePct: +(100 * tree / disc).toFixed(1),
  placedTrees: trees.length, placedOnWorldCoverTreePct: trees.length ? +(100 * onCanopy / trees.length).toFixed(1) : null,
  placedCrownAreaKm2: +(crownM2 / 1e6).toFixed(4), crownCoverOfRealCanopyPct: canopyM2 ? +(100 * crownM2 / canopyM2).toFixed(2) : null,
  treesPerKm2OfRealCanopy: canopyM2 ? +(trees.length / (canopyM2 / 1e6)).toFixed(0) : null,
  unionInCanopyPct: cTree ? +(100 * uIn / cTree).toFixed(1) : null, unionOutsideCanopyPctOfDisc: cDisc ? +(100 * uOut / cDisc).toFixed(1) : null, byLayer,
  classSharePct: Object.fromEntries(Object.entries(hist).map(([k, v]) => [k, +(100 * v / disc).toFixed(1)])) };
console.log(JSON.stringify(out));
fs.writeFileSync(file.replace(/\.dump\.json$/, `.canopy${radiusM}.json`), JSON.stringify(out, null, 1));
