/**
 * R24 C LIGHT — LINEAR_HAZE (recon L1) node-level RED/GREEN proof.
 *
 * The defect is arithmetic, not perceptual, so it can be PROVEN here without a
 * GPU: the terrain at the fade band's END is, by construction, exactly
 * `uEdgeColor`; the SkyDome band directly above it is, by construction, exactly
 * `Color.setRGB(rim, SRGBColorSpace)`. Both land in the same linear HalfFloat
 * buffer and both pass through the same ACES + sRGB encode. So the rim-seam
 * luma delta at any pose is a closed-form function of ONE authored triple.
 *
 * RED  = today's tree: terrain fade-end carries the RAW sRGB triple.
 * GREEN= LINEAR_HAZE: terrain fade-end carries srgbToLinear(triple).
 *
 * Run: node scripts/r24-c-linear-haze-proof.mjs
 * (No dev server, no browser, no tiles — pure arithmetic over the constants.)
 */
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../lib/fly/fly-constants.js', import.meta.url), 'utf8');

// --- three's ColorManagement SRGBToLinear, verbatim -------------------------
const s2l = (c) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));
const l2s = (c) => (c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055);

// --- three's ACESFilmicToneMapping, verbatim (exposure 1) -------------------
const IN = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
];
const OUT = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];
const mul = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const sat = (x) => Math.min(1, Math.max(0, x));
function aces(c) {
  let v = c.map((x) => (x * 1) / 0.6);
  v = mul(IN, v);
  v = v.map((x) => {
    const a = x * (x + 0.0245786) - 0.000090537;
    const b = x * (0.98372900 * x + 0.4329510) + 0.238081;
    return a / b;
  });
  v = mul(OUT, v);
  return v.map(sat);
}
const LUMA = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
/** Linear scene value -> the 8-bit display value the frame buffer ends up with. */
const display = (lin) => aces(lin).map((c) => Math.round(l2s(c) * 255));
const lum8 = (lin) => +LUMA(aces(lin).map(l2s)).toFixed(4) * 255;

// --- pull the authored rim triples straight out of fly-constants -----------
function grabBlock(name) {
  const i = SRC.indexOf(`export const ${name} = `);
  if (i < 0) throw new Error(`${name} not found`);
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) {
    if (SRC[k] === '{') d++;
    else if (SRC[k] === '}') { d--; if (d === 0) return SRC.slice(j, k + 1); }
  }
  throw new Error('unbalanced');
}
function tod() {
  const sky = grabBlock('SKY');
  const i = sky.indexOf('tod:');
  const arr = sky.slice(i, sky.indexOf(']', sky.indexOf('[', i)) + 1);
  const rows = [...arr.matchAll(/frac:\s*([0-9.]+),\s*rim:\s*'(#[0-9a-fA-F]{6})'/g)];
  return rows.map((m) => ({ frac: +m[1], hex: m[2] }));
}
function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function grabHex(block, key) {
  const m = new RegExp(`${key}:\\s*'(#[0-9a-fA-F]{6})'`).exec(block);
  return m ? m[1] : null;
}

const cases = [];
for (const k of tod()) cases.push({ name: `SKY.altAtmo rim @frac ${k.frac} ${k.hex}`, rgb: hex(k.hex) });
const globe = grabBlock('GLOBE');
const rimBlock = globe.slice(globe.indexOf('rim:'));
for (const style of ['satellite', 'toy']) {
  const m = new RegExp(`${style}:\\s*'(#[0-9a-fA-F]{6})'`).exec(rimBlock);
  if (m) cases.push({ name: `GLOBE.rim.${style} ${m[1]}`, rgb: hex(m[1]) });
}
const toy = grabBlock('TOY');
const hazeHex = grabHex(toy.slice(toy.indexOf('haze:')), 'color');
if (hazeHex) cases.push({ name: `TOY.haze.color ${hazeHex}`, rgb: hex(hazeHex) });

console.log('\nR24 C — LINEAR_HAZE rim-seam proof (recon L1)');
console.log('Terrain at fade-end vs the SkyDome band directly above it.');
console.log('Both are the SAME authored triple; only the decode differs.\n');
const head = ['case', 'RED Δluma/255', 'RED ΔRGB/255', 'GREEN Δ'].map((h) => h.padEnd(34)).join('');
console.log(head);
console.log('-'.repeat(head.length));
let worst = 0;
for (const c of cases) {
  const dome = c.rgb.map(s2l);            // what fog + SkyDome put in the buffer
  const redTerrain = c.rgb.slice();        // today: raw sRGB in a linear buffer
  const greenTerrain = c.rgb.map(s2l);     // LINEAR_HAZE
  const dRed = Math.abs(lum8(redTerrain) - lum8(dome));
  const rgbRed = display(redTerrain).map((v, i) => v - display(dome)[i]);
  const dGreen = Math.abs(lum8(greenTerrain) - lum8(dome));
  worst = Math.max(worst, dRed);
  console.log(
    c.name.padEnd(34) +
      dRed.toFixed(1).padEnd(34) +
      `[${rgbRed.join(', ')}]`.padEnd(34) +
      dGreen.toFixed(3)
  );
}
console.log('\nWorst RED rim-seam luma delta: ' + worst.toFixed(1) + '/255');
console.log('GREEN is 0.000 BY CONSTRUCTION (identical decode, identical curve).');
console.log('\nGate recommendation for E (verify-linear-haze):');
console.log('  bound: |luma(terrain @ fade-end) - luma(dome band)| <= 3/255');
console.log('  poses: satellite Owens FL120 (empty control) + Neon NYC FL260,');
console.log('         noon (sun.frac 1.0) AND deep night (sun.frac 0.0).');
