/**
 * R24 C LIGHT — DEPTH_FIX (recon L2 / FL-07) node-level RED/GREEN proof.
 *
 * The reversed-depth double conversion is pure arithmetic over three's own
 * formulas and postprocessing's own shader text, so it is provable here with
 * no GPU. Every formula below is transcribed VERBATIM from the installed
 * libraries, with the file:line it came from.
 *
 * Run: node scripts/r24-c-depth-roundtrip-proof.mjs
 */
import { readFileSync } from 'node:fs';

const C = readFileSync(new URL('../lib/fly/fly-constants.js', import.meta.url), 'utf8');
const near = +/^\s*near:\s*([0-9.]+)/m.exec(C)[1];
const far = +/^\s*far:\s*([0-9]+),\s*\/\/ 600 km/m.exec(C)[1];
const focus = +/dofFocusM:\s*([0-9]+)/.exec(C)[1];
const range = +/dofRangeM:\s*([0-9]+)/.exec(C)[1];

// three/src/math/Matrix4.js makePerspective, reversedDepth branch:
//   c = near/(far-near) ; d = far*near/(far-near) ; te[11] = -1
// => clip.z = c*viewZ + d, clip.w = -viewZ, and with EXT_clip_control
//    ZERO_TO_ONE the window depth IS clip.z/clip.w:
const rawReversedDepth = (z) => (near * (far / z - 1)) / (far - near);

// three.module.js:463 <packing>, under USE_REVERSED_DEPTH_BUFFER:
const viewZ_reversedFormula = (d) => (near * far) / ((near - far) * d - near);
// postprocessing/build/index.js:4939 CircleOfConfusionMaterial readDepth:
//   #elif defined(USE_REVERSED_DEPTH_BUFFER)  depth = 1.0 - depth;
const libUnreverse = (d) => 1 - d;

const smoothstep = (a, b, x) => {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};

console.log('\nR24 C — DEPTH_FIX round-trip proof (recon L2 / FL-07)');
console.log(`camera: near ${near} m, far ${far} m, reversedDepthBuffer: true (FlyCanvas.jsx:100)`);
console.log(`toy DoF: focus ${focus} m, range ${range} m (TOY.dofFocusM / dofRangeM)\n`);

const Z = [5, 50, 200, 700, 2000, 8000, 40000, 300000];
const head = ['true dist (m)', 'raw d (rev)', 'RED viewZ', 'RED err', 'GREEN viewZ', 'GREEN err'];
console.log(head.map((h) => h.padEnd(15)).join(''));
console.log('-'.repeat(head.length * 15));
for (const z of Z) {
  const raw = rawReversedDepth(z);
  const red = viewZ_reversedFormula(libUnreverse(raw)); // library un-reverses, three re-reverses
  const green = viewZ_reversedFormula(raw); // DEPTH_FIX: raw reaches the reversed formula
  console.log(
    [
      z,
      raw.toExponential(4),
      red.toFixed(3),
      (Math.abs(-z - red)).toFixed(1),
      green.toFixed(3),
      (Math.abs(-z - green)).toFixed(6),
    ]
      .map((c) => String(c).padEnd(15))
      .join('')
  );
}

console.log('\nCoC magnitude at screen centre — smoothstep(0, focusRange, |dist - focusDistance|):');
console.log(['true dist (m)', 'RED CoC', 'GREEN CoC'].map((h) => h.padEnd(15)).join(''));
console.log('-'.repeat(45));
let redMin = Infinity, redMax = -Infinity;
for (const z of Z) {
  const raw = rawReversedDepth(z);
  const redD = Math.abs(viewZ_reversedFormula(libUnreverse(raw)));
  const greenD = Math.abs(viewZ_reversedFormula(raw));
  const rc = smoothstep(0, range, Math.abs(redD - focus));
  const gc = smoothstep(0, range, Math.abs(greenD - focus));
  redMin = Math.min(redMin, rc);
  redMax = Math.max(redMax, rc);
  console.log([z, rc.toFixed(4), gc.toFixed(4)].map((c) => String(c).padEnd(15)).join(''));
}
console.log(`\nRED CoC spread across 5 m .. 300 km: ${redMin.toFixed(4)} .. ${redMax.toFixed(4)}`);
console.log('  i.e. a FLAT ~0.177 mix of the half-res blur over the whole frame — global');
console.log('  softness, no tilt-shift band. GREEN is 0.000 in the focus band and rises');
console.log('  monotonically with distance, which is what a tilt-shift diorama IS.');

console.log('\nWhy `getViewPosition` needs no patch, though it looks wrong:');
const c = near / (far - near);
const d = (far * near) / (far - near);
console.log(`  P (reversed) row2 = [0, 0, ${c.toExponential(3)}, ${d.toExponential(3)}], row3 = [0,0,-1,0]`);
console.log(`  P^-1 row2 = [0, 0, 0, -1]  ->  viewPos.z = -clipW = viewZ, and clipW is built`);
console.log(`  FROM viewZ (projectionMatrix[2][3]*viewZ + [3][3] = -viewZ). The bogus NDC z`);
console.log(`  ("depth*2-1" under zero-to-one clip control) multiplies a zero column. So the`);
console.log(`  reconstruction is exact once viewZ is: the one-token deletion is the whole fix.`);

console.log('\nAerialPerspective sky early-out:');
const skyRaw = 0; // reversed clear value
console.log(`  sky raw depth (reversed clear)         = ${skyRaw}`);
console.log(`  after the merged EffectMaterial readDepth = ${libUnreverse(skyRaw)}  (index.js:14646)`);
console.log(`  RED   test  d >= 0.999999 with d = 1-depth = ${1 - libUnreverse(skyRaw)}  -> NEVER FIRES`);
console.log(`  GREEN test  depth >= 0.999999            = ${libUnreverse(skyRaw)}  -> fires, and fires`);
console.log(`  on a NON-reversed device too (standard clear 1.0, readDepth is identity there).`);

console.log('\nGate recipe for E (verify-depth-roundtrip):');
console.log('  Toy high tier, Neon NYC, camera parked. Read __flyStats.dofProbe (or sample the');
console.log('  CoC render target) at three pixels whose true view distance is known from a');
console.log('  raycast: ~50 m, ~700 m (the focus plane), ~4000 m.');
console.log('  RED  : reconstructed |viewZ| is 2.50-2.51 m at ALL THREE (this table).');
console.log('  GREEN: |reconstructed - true| / true <= 1% at all three, and the CoC at the');
console.log('         focus plane is < 0.02 while the 4 km sample is > 0.5.');
