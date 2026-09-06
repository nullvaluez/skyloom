/**
 * R24 C LIGHT — POST_ORDER (recon L6) node-level proof.
 *
 * Three claims, all checkable without a GPU:
 *   (A) the reordered chain is a PERMUTATION of the same descriptor list, and
 *       the merged EffectPass count can only FALL (Owens has zero draw
 *       headroom at 261);
 *   (B) the grade knobs act on an UNBOUNDED signal today and a bounded one
 *       after the reorder — quantified as the input range each knob sees;
 *   (C) SMAA's edge detector sees the same unbounded signal today.
 *
 * The descriptor order is read out of components/fly/Effects.jsx itself, so
 * this proof cannot drift from the shipped list.
 *
 * Run: node scripts/r24-c-post-order-proof.mjs
 */
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../components/fly/Effects.jsx', import.meta.url), 'utf8');
const body = SRC.slice(SRC.indexOf('export function buildPassList'), SRC.indexOf('function smaaSpec'));

/** Descriptor ids in SOURCE order, with the gate each sits behind. */
const ORDER = [...body.matchAll(/id:\s*'([a-z-]+)'/g)].map((m) => m[1]);
const EXTRA = ['smaa', 'tone']; // pushed via smaaSpec()/toneSpec()
const full = (style, tier) => {
  const toy = style === 'toy';
  const sat = style === 'satellite';
  const keep = new Set([
    ...(tier !== 'low' ? ['bloom'] : []),
    ...(tier === 'high' ? ['speed'] : []),
    ...(sat && tier === 'high' ? ['aerial'] : []),
    ...(sat ? ['sat-hue', 'sat-bc', 'sat-wb'] : []),
    ...(toy ? ['toy-hue', 'toy-bc', 'toy-noise'] : []),
    ...(toy && tier === 'high' ? ['toy-dof'] : []),
    'vignette',
    ...EXTRA,
  ]);
  return [...ORDER, ...EXTRA].filter((id, i, a) => keep.has(id) && a.indexOf(id) === i);
};

// Mirrors reorderForDisplaySpace() in Effects.jsx exactly.
const PRE_CURVE = new Set(['bloom', 'speed', 'aerial', 'toy-dof']);
function reorder(list) {
  if (!list.includes('tone')) return list;
  const pre = list.filter((p) => PRE_CURVE.has(p));
  const post = list.filter((p) => !PRE_CURVE.has(p) && p !== 'tone' && p !== 'smaa');
  return [...pre, 'tone', ...post, ...(list.includes('smaa') ? ['smaa'] : [])];
}

// FlyEffectComposer's merge rule: a CONVOLUTION effect gets its own pass;
// consecutive non-convolution effects merge into one.
const CONV = new Set(['bloom', 'toy-dof', 'smaa']);
function passCount(list) {
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    n++;
    if (!CONV.has(list[i])) while (i + 1 < list.length && !CONV.has(list[i + 1])) i++;
  }
  return n;
}

console.log('\nR24 C — POST_ORDER proof (recon L6)   [descriptor order read from Effects.jsx]\n');
let ok = true;
for (const style of ['satellite', 'toy']) {
  for (const tier of ['high', 'medium', 'low']) {
    const red = full(style, tier);
    const green = reorder(red);
    const permutation =
      red.length === green.length && [...red].sort().join() === [...green].sort().join();
    const pr = passCount(red);
    const pg = passCount(green);
    if (!permutation || pg > pr) ok = false;
    console.log(`${style}/${tier}`);
    console.log(`  RED   ${red.join(' → ')}   [${pr} EffectPasses]`);
    console.log(`  GREEN ${green.join(' → ')}   [${pg} EffectPasses]`);
    console.log(`  permutation: ${permutation ? 'YES' : 'NO'} · passes ${pr} → ${pg} (${pg <= pr ? 'never rises' : 'RISES — BUDGET BREAK'})\n`);
  }
}

// ---- (B)/(C) what the grade and the edge detector actually see -------------
const IN = [[0.59719, 0.35458, 0.04823], [0.076, 0.90834, 0.01566], [0.0284, 0.13383, 0.83777]];
const OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
const mul = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const sat01 = (x) => Math.min(1, Math.max(0, x));
const aces = (c) => {
  let v = c.map((x) => x / 0.6);
  v = mul(IN, v);
  v = v.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
  return mul(OUT, v).map(sat01);
};
const oetf = (c) => (c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055);

// Representative scene-linear values actually present in a Neon night frame.
const SCENE = [
  ['deep sky / void', 0.004],
  ['unlit facade', 0.03],
  ['lit ground', 0.18],
  ['road ribbon (additive)', 0.9],
  ['window emissive', 3.2],
  ['runway light / crown', 12.0],
];
console.log('What the grade and SMAA see, per pixel class (scene-linear → the value the');
console.log('sRGB-input grade effects actually receive):\n');
console.log(['pixel class', 'scene linear', 'RED grade in', 'GREEN grade in'].map((h) => h.padEnd(26)).join(''));
console.log('-'.repeat(104));
let redMax = 0;
for (const [name, lin] of SCENE) {
  const red = oetf(lin); // sRGBTransferOETF on UNBOUNDED scene linear
  const green = oetf(aces([lin, lin, lin])[0]); // ACES first, then the same encode
  redMax = Math.max(redMax, red);
  console.log(
    [name, lin.toFixed(3), red.toFixed(3), green.toFixed(3)].map((c) => String(c).padEnd(26)).join('')
  );
}
console.log(`\nRED input range spans 0 .. ${redMax.toFixed(2)} — a BrightnessContrast knob defined`);
console.log('for [0,1] is being applied to values up to ' + redMax.toFixed(1) + ', and ACES then re-curves the');
console.log('result, so the knob\'s visible effect is a function of how bright the emissives are.');
console.log('GREEN input range is 0 .. 1 by construction (ACES saturates), which is what the');
console.log('effects were written for AND what SMAA\'s luma threshold was tuned for.\n');


// ---------------------------------------------------------------------------
// (D) THE CLIP NOBODY DOCUMENTED, and the post-curve grade re-fit.
// ---------------------------------------------------------------------------
// HueSaturationEffect's shader ends `outputColor = vec4(min(color, 1.0), a)`
// (postprocessing index.js, hue_saturation_default). On the R21 chain that
// effect runs BEFORE the tone map, on sRGB-encoded SCENE-LINEAR values — so
// every fragment brighter than 1.0 linear was HARD-CLIPPED TO WHITE before the
// filmic curve ever saw it. The ACES pass added in R13 has been rolling off a
// signal that was already clipped. The reorder is what gives it something to
// roll off.
const eotf = (c) => (c <= 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));
const bc = (v, contrast, brightness = 0) => {
  let c = v + (brightness - 0.5);
  c = contrast > 0 ? c / (1 - contrast) : c * (1 + contrast);
  return c + 0.5;
};
const clamp1 = (v) => Math.min(v, 1); // grayscale: saturation is a no-op, the clamp is NOT
const q8 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);

/** R21 order, grayscale, neutral white balance, screen centre (vignette = x1). */
const redDisplay = (x, con) => {
  const graded = Math.max(0, bc(clamp1(oetf(x)), con)); // hue clamps, bc grades, in sRGB
  const lin = eotf(graded); // the merged pass decodes back to linear at its end
  return q8(oetf(aces([lin, lin, lin])[0])); // then the separate ACES pass, then encode
};
/** R24 order: ACES first, then the same grade in display space. */
const greenDisplay = (x, con) => q8(bc(clamp1(oetf(aces([x, x, x])[0])), con));

const CONSTS = readFileSync(new URL('../lib/fly/fly-constants.js', import.meta.url), 'utf8');
const SKYC = +/grade: \{[\s\S]*?contrast:\s*([0-9.]+)/.exec(CONSTS)[1];

console.log('\n(D) HueSaturation clamps at 1.0 BEFORE the curve on the R21 chain.');
console.log(`    Grayscale display value, satellite grade (contrast ${SKYC}):\n`);
console.log(['scene linear', 'RED 8-bit', 'GREEN 8-bit'].map((h) => h.padEnd(18)).join(''));
console.log('-'.repeat(54));
for (const [, lin] of SCENE) {
  console.log([lin.toFixed(3), redDisplay(lin, SKYC), greenDisplay(lin, SKYC)].map((c) => String(c).padEnd(18)).join(''));
}
console.log('\n    RED gives the SAME 8-bit value to every pixel at or above ~1.0 linear —');
console.log('    a lit window at 3.2 and a runway light at 12.0 are indistinguishable. GREEN');
console.log('    keeps them apart, because ACES rolls them off before anything clamps.\n');

// Least-squares re-fit of the contrast knob so the MIDTONES keep the R21 look.
// Highlights are deliberately NOT fitted: their RED behaviour IS the clip.
const grid = Array.from({ length: 60 }, (_, i) => 0.004 * Math.pow(0.6 / 0.004, i / 59));
const rms = (con) =>
  Math.sqrt(grid.reduce((a, x) => a + (redDisplay(x, SKYC) - greenDisplay(x, con)) ** 2, 0) / grid.length);
let best = { c: SKYC, err: Infinity };
for (let c = -0.5; c <= 0.6; c += 0.001) {
  const e = rms(+c.toFixed(3));
  if (e < best.err) best = { c: +c.toFixed(3), err: e };
}
console.log(`    Midtone-matched post-curve contrast (satellite): ${best.c}`);
console.log(`      rms over 0.004..0.6 linear: ${best.err.toFixed(2)}/255`);
console.log(`      (leaving the knob at ${SKYC} would be ${rms(SKYC).toFixed(2)}/255)`);
console.log('    A STARTING POINT for the user checkpoint, not a certified look: matching');
console.log('    the R21 midtones is the conservative default, and the highlights are');
console.log('    SUPPOSED to change — that is the defect being fixed.\n');

console.log(ok ? 'PROOF: PASS (all compositions are permutations; pass count never rises)'
              : 'PROOF: FAIL');
process.exit(ok ? 0 : 1);
