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
import { DataUtils } from 'three';

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

// ---------------------------------------------------------------------------
// THE MIRROR TEST — the probe's JS `perspectiveDepthToViewZ` against three's
// own GLSL, same inputs, same outputs.
//
// `lib/fly/depth-probe.js` reconstructs the view Z the harness judges. If that
// mirror ever drifts from the shader — or is written with the very
// double-conversion this round is fixing — the gate would certify the probe's
// copy of the bug and report it as a pass. So the two return expressions are
// EXTRACTED from the installed three build and evaluated directly: they are
// pure arithmetic over `depth`, `near` and `far`, so the GLSL text is valid JS
// as written and needs no translation that could itself introduce an error.
// ---------------------------------------------------------------------------
const THREE_SRC = readFileSync(
  new URL('../node_modules/three/build/three.module.js', import.meta.url),
  'utf8'
);
function glslPerspectiveDepthToViewZ() {
  const i = THREE_SRC.indexOf('var packing = ');
  const q = THREE_SRC.indexOf('"', i);
  const e = THREE_SRC.indexOf('";', q + 1);
  const chunk = JSON.parse(THREE_SRC.slice(q, e + 1));
  const a = chunk.indexOf('float perspectiveDepthToViewZ(');
  const body = chunk.slice(a, chunk.indexOf('\n}', a));
  const rev = /#ifdef USE_REVERSED_DEPTH_BUFFER\s*return ([^;]+);/.exec(body);
  const std = /#else\s*return ([^;]+);/.exec(body);
  if (!rev || !std) throw new Error('three\'s perspectiveDepthToViewZ no longer parses — the mirror cannot be checked');
  return {
    reversedExpr: rev[1].trim(),
    standardExpr: std[1].trim(),
    reversed: new Function('depth', 'near', 'far', `return ${rev[1]};`),
    standard: new Function('depth', 'near', 'far', `return ${std[1]};`),
  };
}

const PROBE_SRC = readFileSync(new URL('../lib/fly/depth-probe.js', import.meta.url), 'utf8');
const mirror = new Function(
  `${PROBE_SRC.replace(/^import[\s\S]*?from 'three';/m, '').replace(/\bexport\s+function\b/g, 'function')}
   return perspectiveDepthToViewZ;`
)();

console.log('\nMIRROR TEST — lib/fly/depth-probe.js vs three\'s own GLSL');
const G = glslPerspectiveDepthToViewZ();
console.log(`  GLSL reversed : ${G.reversedExpr}`);
console.log(`  GLSL standard : ${G.standardExpr}`);
let worstRev = 0;
let worstStd = 0;
for (let i = 0; i <= 2000; i++) {
  const d = i / 2000; // the whole [0,1] depth range, endpoints included
  for (const [n, f] of [
    [near, far],
    [0.1, 1000],
    [2.5, 600000],
    [1, 8000], // the shadow ortho's near/far, for good measure
  ]) {
    const a = mirror(d, n, f, true);
    const b = G.reversed(d, n, f);
    const c = mirror(d, n, f, false);
    const e = G.standard(d, n, f);
    // Exact equality is the right bar: same operations, same order, same
    // doubles. Anything else means the mirror was re-derived, not transcribed.
    if (!Object.is(a, b)) worstRev = Math.max(worstRev, Math.abs(a - b) || Infinity);
    if (!Object.is(c, e)) worstStd = Math.max(worstStd, Math.abs(c - e) || Infinity);
  }
}
const mirrorOk = worstRev === 0 && worstStd === 0;
console.log(
  `  8004 comparisons across 4 frustums, both branches: ${
    mirrorOk ? 'BIT-IDENTICAL' : `MISMATCH (rev ${worstRev}, std ${worstStd})`
  }`
);

// ---------------------------------------------------------------------------
// THE COPY-TARGET PRECISION LADDER — what each float path costs the
// reconstruction, and whether the probe's DECLARED numbers are the real ones.
//
// The probe cannot read a depth attachment directly, so it samples it into a
// 1x1 float target. `EXT_color_buffer_float` gives FloatType; without it,
// `EXT_color_buffer_half_float` gives HalfFloatType — a rung that exists
// because refusing outright would have been stricter than the gate it serves.
// This section round-trips the reversed texel through BOTH formats at the
// gate's own probe depths and asserts (a) every path is inside the 1% bound and
// (b) the constants the probe reports as `precisionWorstPct` are those numbers,
// so a green row cannot be green on a precision claim nobody checked.
// ---------------------------------------------------------------------------
const f32 = (v) => Math.fround(v);
const f16 = (v) => DataUtils.fromHalfFloat(DataUtils.toHalfFloat(v));
const PROBE_Z = [50, 700, 4000];
console.log('\nCOPY-TARGET PRECISION — reconstruction error as a % of the true distance');
console.log(['z (m)', 'reversed raw', 'float32', 'float16'].map((h) => h.padEnd(18)).join(''));
console.log('-'.repeat(72));
let worst16 = 0;
let worst32 = 0;
for (const z of PROBE_Z) {
  const v = rawReversedDepth(z);
  const t = viewZ_reversedFormula(v);
  const e32 = (Math.abs(viewZ_reversedFormula(f32(v)) - t) / z) * 100;
  const e16 = (Math.abs(viewZ_reversedFormula(f16(v)) - t) / z) * 100;
  worst32 = Math.max(worst32, e32);
  worst16 = Math.max(worst16, e16);
  console.log(
    [z, v.toExponential(4), e32.toFixed(6) + '%', e16.toFixed(4) + '%']
      .map((c) => String(c).padEnd(18))
      .join('')
  );
}
console.log(`\n  worst float32 ${worst32.toFixed(6)}%   worst float16 ${worst16.toFixed(4)}%`);
console.log('  verify-depth-roundtrip bounds the reconstruction at 1%.');

const precGates = [
  ['every float16 path is inside the 1% bound', worst16 < 1, `${worst16.toFixed(4)}%`],
  ['…with at least 10x of margin', worst16 < 0.1, `${(1 / worst16).toFixed(0)}x inside`],
  ['float32 is exact for this gate', worst32 < 0.001, `${worst32.toFixed(6)}%`],
  [
    'the table matches the values the probe declares',
    (() => {
      const m = /const PRECISION_WORST_PCT = \{ float32: ([\d.e-]+), float16: ([\d.e-]+) \};/.exec(
        PROBE_SRC
      );
      if (!m) return false;
      // The probe rounds for readability; require it to be no OPTIMISTIC than
      // the measurement — a declared cost may overstate, never understate.
      return +m[2] >= worst16 - 5e-5 && +m[1] >= worst32 - 5e-7;
    })(),
    'declared >= measured, never optimistic',
  ],
  [
    'the probe ladders float32 -> float16 -> honest refusal',
    /EXT_color_buffer_float'\)\s*\?\s*FloatType[\s\S]{0,200}EXT_color_buffer_half_float'\)\s*\n?\s*\?\s*HalfFloatType[\s\S]{0,120}: null;/.test(
      PROBE_SRC
    ),
  ],
  [
    'half-float texels are decoded with three\'s own DataUtils.fromHalfFloat',
    /DataUtils\.fromHalfFloat\(buf\[i\]\)/.test(PROBE_SRC) &&
      /new Uint16Array\(4\)/.test(PROBE_SRC),
    'a HALF_FLOAT readback returns raw 16-bit patterns, not numbers',
  ],
  [
    'the refusal survives for the case where NEITHER float target renders',
    /neither EXT_color_buffer_float nor EXT_color_buffer_half_float renders here/.test(PROBE_SRC),
  ],
  [
    'precision, its cost and its provenance are all in the return value',
    /precision: null,/.test(PROBE_SRC) &&
      /precisionWorstPct: null,/.test(PROBE_SRC) &&
      /precisionNote: null,/.test(PROBE_SRC),
  ],
];
console.log('');
let precOk = true;
for (const [name, ok, detail] of precGates) {
  if (!ok) precOk = false;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

// The probe must also be dev-only and must not invent a number it cannot stand
// behind — both are properties of its source, and both are what keep a green
// gate honest.
const probeGates = [
  [
    // The property, restated for the two-format probe: `raw` is texel 0 passed
    // through `px()`, and `px()` decodes a half-float BIT PATTERN and does
    // nothing else — no un-reversing, no normalisation, no packing. The
    // `1.0 -` scan is the one that would catch the recon-L2 mistake being
    // reintroduced inside the probe itself.
    'the probe reports the depth attachment AS STORED (no un-reversing)',
    /out\.raw = px\(0\);/.test(PROBE_SRC) &&
      /const px = \(i\) => \(precision === 'float16' \? DataUtils\.fromHalfFloat\(buf\[i\]\) : buf\[i\]\);/.test(
        PROBE_SRC
      ) &&
      !/1\.0 - /.test(PROBE_SRC),
  ],
  [
    'the probe reads `reversed` from the renderer, not from the request',
    /gl\.state\?\.buffers\?\.depth\?\.getReversed\?\.\(\) === true/.test(PROBE_SRC),
  ],
  [
    'the probe refuses rather than guessing when it can quantify nothing',
    /renders here — refusing to report a depth this probe cannot quantify/.test(PROBE_SRC),
  ],
  [
    'the probe names which buffer every number came from',
    /source: 'composer\.depthTexture/.test(PROBE_SRC) && /cocSource/.test(PROBE_SRC),
  ],
  [
    'the probe is installed from a production-dead branch',
    /process\.env\.NODE_ENV === 'production'\) return undefined;\s*\n\s*return installDepthProbe/.test(
      readFileSync(new URL('../components/fly/FlyEffectComposer.jsx', import.meta.url), 'utf8')
    ),
  ],
  [
    'window.__flyDof is published from the same dev-only idiom',
    /process\.env\.NODE_ENV !== 'production' && typeof window !== 'undefined'\) \{\s*\n\s*window\.__flyDof = o \?\? null;/.test(
      readFileSync(new URL('../components/fly/Effects.jsx', import.meta.url), 'utf8')
    ),
  ],
];
console.log('');
let probeOk = true;
for (const [name, ok] of probeGates) {
  if (!ok) probeOk = false;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
}

console.log('\nGate recipe for E (verify-depth-roundtrip):');
console.log('  Toy high tier, Neon NYC, camera parked. Call window.__flyDepthProbe(x, y) at');
console.log('  three pixels whose true view distance is known from a raycast: ~50 m,');
console.log('  ~700 m (the focus plane), ~4000 m.');
console.log('  RED  : reconstructed |viewZ| is 2.50-2.51 m at ALL THREE (this table).');
console.log('  GREEN: |reconstructed - true| / true <= 1% at all three, and the CoC at the');
console.log('         focus plane is < 0.02 while the 4 km sample is > 0.5.');
console.log('  HOOK : window.__flyDepthProbe(x, y) -> { raw, viewZ, coc, reversed, near, far,');
console.log('         drawingBuffer, precision, precisionWorstPct, precisionNote, source,');
console.log('         cocSource, cocReason, error }. x/y are DRAWING-BUFFER pixels,');
console.log('         top-left origin. window.__flyDof is the live DepthOfFieldEffect (or');
console.log('         null). Both dev-only.');
console.log('         PRINT `precision` WITH THE RESULT: float32 costs 0.000002% of z and');
console.log('         float16 costs at worst 0.0754%, both inside the 1% bound, but a green');
console.log('         row should say which number it is green on. An `error` means NEITHER');
console.log('         float target renders — record it as NOT RUNNABLE with that reason.');

const allOk = mirrorOk && probeOk && precOk;
console.log(
  allOk
    ? '\nPROOF: PASS (mirror bit-identical to three\'s GLSL; precision ladder quantified; probe contract intact)'
    : '\nPROOF: FAIL'
);
process.exit(allOk ? 0 : 1);
