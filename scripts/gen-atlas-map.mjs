/**
 * One-time generator for the Atlas world map: packs Natural Earth 110m
 * coastlines (PUBLIC DOMAIN — https://www.naturalearthdata.com) into a
 * compact binary polyline blob the atlas canvas strokes directly.
 *
 * Run BY THE DEVELOPER once (the repo ships the output; no runtime fetch
 * of third-party hosts — FLY_MODE_HANDOFF §3 no-keys/no-external rule):
 *
 *   1. Download ne_110m_coastline.geojson, e.g. from
 *      https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_coastline.geojson
 *   2. node scripts/gen-atlas-map.mjs <path-to-geojson>
 *
 * Output: public/atlas/coastlines.bin —
 *   uint32 lineCount · uint32[lineCount] pointCounts · float32[(lon,lat)…]
 */
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/gen-atlas-map.mjs <ne_110m_coastline.geojson>');
  process.exit(1);
}

// Light simplification: at world-map scale sub-0.1° wiggles are invisible;
// dropping them keeps the blob small. Endpoints always survive.
const MIN_STEP_DEG = 0.1;

const gj = JSON.parse(fs.readFileSync(src, 'utf8'));
const lines = [];
for (const f of gj.features) {
  const g = f.geometry;
  const parts =
    g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  for (const coords of parts) {
    const pts = [];
    let last = null;
    for (const [lon, lat] of coords) {
      if (!last || Math.abs(lon - last[0]) + Math.abs(lat - last[1]) >= MIN_STEP_DEG) {
        pts.push([lon, lat]);
        last = [lon, lat];
      }
    }
    const end = coords[coords.length - 1];
    if (last && (last[0] !== end[0] || last[1] !== end[1])) pts.push([end[0], end[1]]);
    if (pts.length >= 2) lines.push(pts);
  }
}

const counts = new Uint32Array(lines.length);
let total = 0;
lines.forEach((l, i) => {
  counts[i] = l.length;
  total += l.length;
});
const coords = new Float32Array(total * 2);
let o = 0;
for (const l of lines) {
  for (const [lon, lat] of l) {
    coords[o++] = lon;
    coords[o++] = lat;
  }
}

const header = new Uint32Array([lines.length]);
const buf = Buffer.concat([
  Buffer.from(header.buffer),
  Buffer.from(counts.buffer),
  Buffer.from(coords.buffer),
]);
const out = path.join(process.cwd(), 'public', 'atlas', 'coastlines.bin');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);
console.log(`coastlines.bin: ${lines.length} lines, ${total} points, ${(buf.length / 1024).toFixed(1)} KB`);
