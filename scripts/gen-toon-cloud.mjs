// Generate a self-made (CC0) 2-3 step TOON cumulus puff sprite for the toy
// cloud deck. White RGB (the material tints it); alpha carries a hard-banded
// cloud silhouette (toon look vs cloud.png's soft gradient). 512×512.
import sharp from 'sharp';

const N = 512;
const buf = Buffer.alloc(N * N * 4);
// Classic flat-based cumulus: a row of top bumps over a flat base.
const circles = [
  { x: 0.30, y: 0.56, r: 0.19 },
  { x: 0.50, y: 0.46, r: 0.27 },
  { x: 0.70, y: 0.55, r: 0.21 },
  { x: 0.41, y: 0.60, r: 0.20 },
  { x: 0.60, y: 0.61, r: 0.20 },
  { x: 0.21, y: 0.62, r: 0.14 },
  { x: 0.80, y: 0.62, r: 0.14 },
];
const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
for (let py = 0; py < N; py++) {
  for (let px = 0; px < N; px++) {
    const u = px / N;
    const v = py / N;
    let cov = 0;
    for (const c of circles) {
      const d = Math.hypot(u - c.x, v - c.y);
      cov = Math.max(cov, ss(c.r, c.r * 0.72, d)); // 1 inside → 0 at the soft edge
    }
    cov *= ss(0.80, 0.72, v); // flatten the base (cut the lower skirt)
    // 3-step toon quantize with narrow AA ramps between bands
    let a = ss(0.16, 0.22, cov) * 0.5 + ss(0.42, 0.5, cov) * 0.5;
    const i = (py * N + px) * 4;
    buf[i] = 255;
    buf[i + 1] = 255;
    buf[i + 2] = 255;
    buf[i + 3] = Math.round(Math.min(1, a) * 255);
  }
}
await sharp(buf, { raw: { width: N, height: N, channels: 4 } })
  .png()
  .toFile('public/textures/cloud-toon.png');
console.log('wrote public/textures/cloud-toon.png');
