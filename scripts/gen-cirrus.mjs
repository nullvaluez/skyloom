// Round 19 (D GOLDENHOUR) — generate a self-made (CC0) CIRRUS wisp sprite for
// the high deck in CloudField. White RGB (the material tints it, exactly like
// cloud.png / cloud-toon.png); alpha carries the shape.
//
// Cirrus is not a small cumulus: it is ice crystals sheared by the jet stream,
// so the read is FIBROUS and STRETCHED — long filaments running one way, soft
// hooked ends, and a low peak opacity you can see blue through. The generator
// is anisotropic fbm value-noise (sampled ~7x finer across the streaks than
// along them) put through a soft threshold, times an elliptical envelope so
// the billboard has no hard edge.
//
// Deterministic: a fixed integer hash, no Math.random, so re-running produces
// a byte-identical PNG.
//
// Run: node scripts/gen-cirrus.mjs
import sharp from 'sharp';

const N = 512;

/** Deterministic 2D value hash in [0,1). */
function h2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const fade = (t) => t * t * (3 - 2 * t);

/** Bilinear value noise on an integer lattice. */
function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = fade(xf);
  const v = fade(yf);
  const a = h2(xi, yi);
  const b = h2(xi + 1, yi);
  const c = h2(xi, yi + 1);
  const d = h2(xi + 1, yi + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

/** Five-octave fbm. */
function fbm(x, y) {
  let sum = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  for (let o = 0; o < 5; o++) {
    sum += vnoise(fx, fy) * amp;
    fx *= 2.03;
    fy *= 2.011;
    amp *= 0.5;
  }
  return sum; // ~[0,1)
}

const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const buf = Buffer.alloc(N * N * 4);
for (let py = 0; py < N; py++) {
  for (let px = 0; px < N; px++) {
    const u = px / N;
    const v = py / N;

    // Shear: filaments run along +X and lean slightly, like a real fallstreak.
    // A/B'd against a 3.2/22 variant (scripts/r19-d-cirrus-preview.png): that
    // one read as a mackerel altocumulus field — pretty, but the wrong cloud.
    // 1.8/30 is ~17x finer across the streaks than along them, which is what
    // pulls the noise into the long fibres cirrus is actually made of.
    const sx = u * 1.8 + v * 1.1;
    const sy = v * 30.0;

    // Two fbm layers: the body, and a finer one that erodes it into fibres.
    const body = fbm(sx, sy);
    const fibre = fbm(sx * 2.6 + 31.7, sy * 2.2 + 11.3);

    // Soft threshold — cirrus is mostly gaps.
    let a = ss(0.46, 0.72, body);
    a *= 0.45 + 0.55 * ss(0.30, 0.70, fibre);

    // Elliptical envelope: wide and flat, faded to nothing at every edge so
    // the quad never shows a seam against the sky.
    const dx = (u - 0.5) / 0.52;
    const dy = (v - 0.5) / 0.30;
    a *= 1 - ss(0.55, 1.0, Math.sqrt(dx * dx + dy * dy));

    // Cirrus is thin: cap well under opaque so the deck reads as veil.
    a = Math.min(1, a) * 0.72;

    const i = (py * N + px) * 4;
    buf[i] = 255;
    buf[i + 1] = 255;
    buf[i + 2] = 255;
    buf[i + 3] = Math.round(a * 255);
  }
}

await sharp(buf, { raw: { width: N, height: N, channels: 4 } })
  .png()
  .toFile('public/textures/cloud-cirrus.png');
console.log('wrote public/textures/cloud-cirrus.png');
