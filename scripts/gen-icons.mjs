/**
 * Generate the PWA icon set referenced by public/manifest.json from
 * public/logo.webp. One-time developer script (Round 6 — the manifest
 * referenced /icons/* that never existed, 404ing on every load).
 * Run: node scripts/gen-icons.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp'); // transitive dep (next) — no new package

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const SRC = path.resolve('public/logo.webp');
const OUT = path.resolve('public/icons');

await mkdir(OUT, { recursive: true });
for (const size of SIZES) {
  const dest = path.join(OUT, `icon-${size}x${size}.png`);
  await sharp(SRC)
    .resize(size, size, { fit: 'contain', background: { r: 9, g: 12, b: 24, alpha: 1 } })
    .png()
    .toFile(dest);
  console.log('wrote', dest);
}
console.log('done —', SIZES.length, 'icons');
