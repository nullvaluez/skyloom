/**
 * One-shot tool: find the sun direction of an equirect .hdr so the Fly-mode
 * DirectionalLight can match the HDRI exactly (SKY.sunDirection in
 * lib/fly/fly-constants.js). Usage: node scripts/hdr-sun.mjs <file.hdr>
 *
 * Uses three's RGBELoader (pure ArrayBuffer parsing, no DOM) and three's
 * equirect convention: u = atan2(dir.z, dir.x)/2π + 0.5, v = asin(dir.y)/π + 0.5
 * (v=1 at the top row of the image as stored by RGBELoader with flipY=true).
 */
import { readFileSync } from 'node:fs';
import { FloatType } from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

const file = process.argv[2];
const buf = readFileSync(file);
const loader = new RGBELoader().setDataType(FloatType);
const { data, width, height } = loader.parse(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
);

let best = -1;
let bx = 0;
let by = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (lum > best) {
      best = lum;
      bx = x;
      by = y;
    }
  }
}

// RGBE scanlines run top-of-image first; RGBELoader marks flipY=true so GL
// shows row 0 at v=1... except it stores rows bottom-up already. Emit both
// interpretations; the elevation close to the HDRI's advertised sun height
// (e.g. 48° for kloofendal_48d) is the right one.
const u = (bx + 0.5) / width;
for (const [label, v] of [
  ['row0=top  ', 1 - (by + 0.5) / height],
  ['row0=bottom', (by + 0.5) / height],
]) {
  const phi = (u - 0.5) * 2 * Math.PI; // atan2(z, x)
  const elev = (v - 0.5) * Math.PI; // asin(y)
  const y = Math.sin(elev);
  const c = Math.cos(elev);
  const xd = Math.cos(phi) * c;
  const zd = Math.sin(phi) * c;
  console.log(
    `${label} elev=${((elev * 180) / Math.PI).toFixed(1)}° dir=[${xd.toFixed(3)}, ${y.toFixed(3)}, ${zd.toFixed(3)}] maxLum=${best.toFixed(0)}`
  );
}
