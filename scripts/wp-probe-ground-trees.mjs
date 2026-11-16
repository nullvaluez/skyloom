// World-pass ground review probe: do the 3D trees stand where the photograph shows trees?
// Reads a <shot>.dump.json written by scripts/wp-probe-ground-capture.cjs (tree lon/lat),
// fetches the same keyless Esri World Imagery tiles the game draws (z17), and scores every
// tree and a set of random control points with a "treeness" measure: green-dominant,
// dark and rough texels (FableFlight src/trees.rs `treeness`, MIT, used here only to measure).
// Usage: node scripts/wp-probe-ground-trees.mjs <dump.json> [radiusM=900]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const file = process.argv[2], radiusM = Number(process.argv[3] || 900);
const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
const Z = 17, N = 2 ** Z, cacheDir = path.join(path.dirname(file), 'esri-cache');
fs.mkdirSync(cacheDir, { recursive: true });
const R = 6378137, D = 180 / Math.PI;
const [px, pz] = dump.player;
const lon0 = px / R * D, lat0 = (2 * Math.atan(Math.exp(-pz / R)) - Math.PI / 2) * D;
const k = 1 / Math.cos(lat0 / D);
const toPix = (lon, lat) => { const r = lat / D; return [(lon + 180) / 360 * N * 256, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * N * 256]; };
const [cx, cy] = toPix(lon0, lat0);
const mPerPx = 2 * Math.PI * R / (N * 256) / k;
const rPx = radiusM / mPerPx;
const tiles = new Map();
async function tile(tx, ty) {
  const key = `${tx}_${ty}`; if (tiles.has(key)) return tiles.get(key);
  const f = path.join(cacheDir, `${Z}_${key}.jpg`);
  let buf;
  if (fs.existsSync(f)) buf = fs.readFileSync(f);
  else {
    const r = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${ty}/${tx}`);
    if (!r.ok) { tiles.set(key, null); return null; }
    buf = Buffer.from(await r.arrayBuffer()); fs.writeFileSync(f, buf);
  }
  const { data } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  tiles.set(key, data); return data;
}
const x0 = Math.floor((cx - rPx) / 256), x1 = Math.floor((cx + rPx) / 256), y0 = Math.floor((cy - rPx) / 256), y1 = Math.floor((cy + rPx) / 256);
for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) await tile(tx, ty);
const rgb = (gx, gy) => { const t = tiles.get(`${Math.floor(gx / 256)}_${Math.floor(gy / 256)}`); if (!t) return null; const i = ((Math.floor(gy) & 255) * 256 + (Math.floor(gx) & 255)) * 3; return [t[i], t[i + 1], t[i + 2]]; };
const greenness = ([r, g, b]) => { const s = r + g + b + 1, exg = (2 * g - r - b) / s, l = s / 3; return Math.min(1, Math.max(0, (exg - 0.015) / 0.09)) * Math.min(1, Math.max(0, (175 - l) / 70)); };
function treeness(gx, gy) {
  const c = rgb(gx, gy); if (!c) return null;
  const g = greenness(c); if (g <= 0) return 0;
  let s = 0, s2 = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const q = rgb(gx + dx, gy + dy); if (!q) return null; const l = (q[0] + q[1] + q[2]) / 3; s += l; s2 += l * l; }
  const sd = Math.sqrt(Math.max(0, s2 / 9 - (s / 9) ** 2)), dark = Math.min(1, Math.max(0, (150 - s / 9) / 55));
  return g * (0.2 + 0.8 * Math.min(1, Math.max(0, (sd - 3) / 8))) * (0.35 + 0.65 * dark);
}
// Score over a ~3 m disc: a placed canopy of radius >= 3.5 m should cover photographed canopy.
function score(gx, gy) { let n = 0, s = 0; const r = Math.max(1, Math.round(3 / mPerPx)); for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) { if (dx * dx + dy * dy > r * r) continue; const t = treeness(gx + dx, gy + dy); if (t == null) continue; s += t; n++; } return n ? s / n : null; }
const T = Number(process.argv[4] || 0.12);
const trees = dump.trees.map(([lon, lat, rad, kind, cls]) => { const [gx, gy] = toPix(lon, lat); return { gx, gy, rad, kind, cls }; }).filter(t => Math.hypot(t.gx - cx, t.gy - cy) < rPx);
let hit = 0, n = 0; const col = [0, 0, 0]; const byCls = {};
for (const t of trees) { const s = score(t.gx, t.gy); if (s == null) continue; n++; const on = s > T; if (on) hit++; const c = rgb(t.gx, t.gy); col[0] += c[0]; col[1] += c[1]; col[2] += c[2]; (byCls[t.cls] ??= [0, 0])[0]++; if (on) byCls[t.cls][1]++; }
// Control: uniform random points in the disc (seeded), and photo-canopy area for recall.
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
let cHit = 0, cN = 0;
const qs = []; for (let i = 0; i < 4000; i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * rPx; const s = score(cx + Math.cos(a) * r, cy + Math.sin(a) * r); if (s == null) continue; qs.push(s); cN++; if (s > T) cHit++; } qs.sort((a, b) => a - b); console.error("random-score quantiles p25,p50,p75,p90,p97", [.25,.5,.75,.9,.97].map(q => qs[Math.floor(q * (qs.length - 1))].toFixed(3)).join(","));
// Recall: share of photo-canopy samples that have a placed tree within 8 m.
const grid = new Map(), cell = 10 / mPerPx;
for (const t of trees) { const key = `${Math.floor(t.gx / cell)},${Math.floor(t.gy / cell)}`; (grid.get(key) ?? grid.set(key, []).get(key)).push(t); }
let canopy = 0, covered = 0;
for (let i = 0; i < 6000; i++) {
  const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * rPx, gx = cx + Math.cos(a) * r, gy = cy + Math.sin(a) * r;
  const s = score(gx, gy); if (s == null || s <= T) continue; canopy++;
  let near = false; const kx = Math.floor(gx / cell), ky = Math.floor(gy / cell);
  for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) for (const t of grid.get(`${kx + dx},${ky + dy}`) ?? []) if (Math.hypot(t.gx - gx, t.gy - gy) * mPerPx < 8) { near = true; break; }
  if (near) covered++;
}
const areaKm2 = Math.PI * (radiusM / 1000) ** 2;
const result = {
  file: path.basename(file), lat0: +lat0.toFixed(5), lon0: +lon0.toFixed(5), radiusM, mPerPx: +mPerPx.toFixed(3), threshold: T,
  treesInDisc: trees.length, treesPerKm2: +(trees.length / areaKm2).toFixed(0),
  treesOnPhotoCanopyPct: n ? +(100 * hit / n).toFixed(1) : null,
  randomPointsOnPhotoCanopyPct: cN ? +(100 * cHit / cN).toFixed(1) : null,
  photoCanopySharePct: cN ? +(100 * cHit / cN).toFixed(1) : null,
  photoCanopyWithTreeWithin8mPct: canopy ? +(100 * covered / canopy).toFixed(1) : null,
  meanPhotoRGBUnderTrees: n ? col.map(v => Math.round(v / n)) : null,
  byClass: byCls,
};
console.log(JSON.stringify(result));
fs.writeFileSync(file.replace(/\.dump\.json$/, '.trees.json'), JSON.stringify(result, null, 1));
