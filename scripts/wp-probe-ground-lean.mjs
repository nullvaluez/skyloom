// World-pass ground review: crop the Esri photo around a known building centroid and mark
// the map centroid, to see the photographed roof/facade lean and baked shadow.
// Usage: node scripts/wp-probe-ground-lean.mjs <lat> <lon> <out.png> [z=18] [halfPx=256]
import fs from 'node:fs'; import sharp from 'sharp';
const [lat, lon, out, zs = '18', hs = '256'] = process.argv.slice(2);
const z = +zs, half = +hs, N = 2 ** z, r = +lat * Math.PI / 180;
const gx = (+lon + 180) / 360 * N * 256, gy = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * N * 256;
const x0 = Math.floor((gx - half) / 256), x1 = Math.floor((gx + half) / 256), y0 = Math.floor((gy - half) / 256), y1 = Math.floor((gy + half) / 256);
const comps = [];
for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
  const res = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`);
  comps.push({ input: Buffer.from(await res.arrayBuffer()), left: (tx - x0) * 256, top: (ty - y0) * 256 });
}
const W = (x1 - x0 + 1) * 256, H = (y1 - y0 + 1) * 256;
const mosaic = await sharp({ create: { width: W, height: H, channels: 3, background: '#000' } }).composite(comps).png().toBuffer();
const cx = Math.round(gx - x0 * 256), cy = Math.round(gy - y0 * 256);
const mark = Buffer.from(`<svg width="${W}" height="${H}"><circle cx="${cx}" cy="${cy}" r="6" fill="none" stroke="red" stroke-width="3"/></svg>`);
const marked = await sharp(mosaic).composite([{ input: mark }]).png().toBuffer();
await sharp(marked).extract({ left: Math.max(0, cx - half), top: Math.max(0, cy - half), width: Math.min(2 * half, W - Math.max(0, cx - half)), height: Math.min(2 * half, H - Math.max(0, cy - half)) }).toFile(out);
console.log('ok', out, 'mPerPx', (2 * Math.PI * 6378137 / (N * 256) * Math.cos(r)).toFixed(3));
