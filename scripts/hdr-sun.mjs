/**
 * One-shot tool: find the sun direction of an equirect .hdr so the Fly-mode
 * DirectionalLight can match the HDRI exactly (SKY.sunDirection in
 * lib/fly/fly-constants.js). Usage: node scripts/hdr-sun.mjs <file.hdr>
 *
 * Uses three's RGBELoader (pure ArrayBuffer parsing, no DOM) and three's
 * equirect convention: u = atan2(dir.z, dir.x)/2π + 0.5, v = asin(dir.y)/π + 0.5
 * (v=1 at the top row of the image as stored by RGBELoader with flipY=true).
 *
 * R25 (C SKY, iblAlign) — `node scripts/hdr-sun.mjs --r25` scans the FOUR
 * satellite time-of-day HDRIs (SKY.hdriCycle day/dawn/dusk/night) and prints
 * each one's sun AZIMUTH in the APP's hour-angle convention, i.e. the `az` of
 * the world direction (-sin az·cos el, sin el, cos az·cos el) that FlyScene's
 * key light, the hillshade and the dome lobe all use. That is the number
 * R25_SKY.iblAlign.hdriSunAz stores; r25SkyFrame rotates scene.environment /
 * scene.background about +Y so the baked sun lands on runtime.sun.az.
 *
 * AZIMUTH IS UNAMBIGUOUS where elevation is not: both row-order
 * interpretations below share the same `u`, so they share phi and therefore
 * the azimuth. The R25 estimate is the luminance-weighted centroid (a
 * unit-vector sum, so it cannot wrap across ±π) of the brightest 0.05 % of
 * texels: a single brightest texel is noisy on the 1k twilight files, and the
 * night file's "sun" is a sunset-remnant band one texel tall and dozens wide.
 * The RAW decode is scanned — SatEnvironment's texel caps are applied at load
 * and flatten exactly the texels this scan is looking for.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FloatType } from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function decode(file) {
  const buf = readFileSync(file);
  const loader = new RGBELoader().setDataType(FloatType);
  return loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** three's equirect direction for texel (x, y) under a row-order interpretation. */
function dirOf(x, y, width, height, row0Top) {
  const u = (x + 0.5) / width;
  const v = row0Top ? 1 - (y + 0.5) / height : (y + 0.5) / height;
  const phi = (u - 0.5) * 2 * Math.PI; // atan2(z, x)
  const elev = (v - 0.5) * Math.PI; // asin(y)
  const c = Math.cos(elev);
  return [Math.cos(phi) * c, Math.sin(elev), Math.sin(phi) * c];
}

/** App hour-angle azimuth of a world direction: dir = (-sin az·c, ·, cos az·c). */
export function appAzimuth(d) {
  return Math.atan2(-d[0], d[2]);
}

/** Luminance-weighted centroid of the brightest `frac` of texels, both row orders. */
export function sunEstimate(img, frac = 0.0005) {
  const { data, width, height } = img;
  const n = width * height;
  const lums = new Float32Array(n);
  for (let i = 0; i < n; i++) lums[i] = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
  const sorted = Float32Array.from(lums).sort();
  const cut = sorted[Math.max(0, Math.floor(n * (1 - frac)) - 1)];
  const out = {};
  for (const row0Top of [true, false]) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let i = 0; i < n; i++) {
      if (lums[i] < cut) continue;
      const d = dirOf(i % width, Math.floor(i / width), width, height, row0Top);
      sx += d[0] * lums[i];
      sy += d[1] * lums[i];
      sz += d[2] * lums[i];
    }
    const l = Math.hypot(sx, sy, sz) || 1;
    const d = [sx / l, sy / l, sz / l];
    out[row0Top ? 'row0Top' : 'row0Bottom'] = { dir: d, elDeg: (Math.asin(d[1]) * 180) / Math.PI, az: appAzimuth(d) };
  }
  return out;
}

async function r25() {
  const { SKY } = await import(pathToFileURL(path.join(ROOT, 'lib/fly/fly-constants.js')).href);
  const hc = SKY.hdriCycle;
  const table = {};
  for (const bucket of ['day', 'dawn', 'dusk', 'night']) {
    const file = path.join(ROOT, 'public', hc[bucket]);
    const est = sunEstimate(decode(file));
    // The sun sits ABOVE the horizon in the day/dawn/dusk files; pick the row
    // order that says so (the azimuth is the same either way — printed).
    const pick = est.row0Top.elDeg >= est.row0Bottom.elDeg ? est.row0Top : est.row0Bottom;
    const azAgree = Math.abs(est.row0Top.az - est.row0Bottom.az) < 1e-9;
    table[bucket] = +pick.az.toFixed(6);
    console.log(
      `${bucket.padEnd(5)} ${path.basename(file)}  az(app) ${pick.az.toFixed(6)} rad (${((pick.az * 180) / Math.PI).toFixed(2)}°)` +
        `  el ${pick.elDeg.toFixed(2)}°  dir [${pick.dir.map((v) => v.toFixed(4)).join(', ')}]  row orders agree on az: ${azAgree}`
    );
  }
  console.log(`\nR25_SKY.iblAlign.hdriSunAz = ${JSON.stringify(table)}`);
}

if (process.argv[2] === '--r25') {
  await r25();
} else if (process.argv[2]) {
  const file = process.argv[2];
  const { data, width, height } = decode(file);
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
}
