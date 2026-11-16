// World Pass skeptic "realism": mean RGB, luma and chroma spread of the city region (rows 55-100%) of two frames.
// Usage: node scripts/wp-probe-realism-abstats.mjs a.png b.png
import sharp from 'sharp';
for (const f of process.argv.slice(2)) {
  const img = sharp(f); const { width: w, height: h } = await img.metadata();
  const top = Math.round(h * 0.55); const { data } = await sharp(f).extract({ left: 0, top, width: w, height: h - top }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = 0, warm = 0, cs = 0; const L = [];
  for (let i = 0; i < data.length; i += 3) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; warm += data[i] - data[i + 2]; const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; L.push(l); const mx = Math.max(data[i], data[i + 1], data[i + 2]), mn = Math.min(data[i], data[i + 1], data[i + 2]); cs += mx ? (mx - mn) / mx : 0; }
  const m = L.reduce((a, v) => a + v, 0) / n, sd = Math.sqrt(L.reduce((a, v) => a + (v - m) ** 2, 0) / n);
  console.log(f.split(/[\/]/).slice(-3).join('/'), 'meanRGB', (r / n).toFixed(1), (g / n).toFixed(1), (b / n).toFixed(1), 'luma', m.toFixed(1), 'lumaSD', sd.toFixed(1), 'R-B', (warm / n).toFixed(1), 'sat', (cs / n).toFixed(3));
}
