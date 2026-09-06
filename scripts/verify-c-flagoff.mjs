#!/usr/bin/env node
/**
 * R24 C LIGHT — verify-c-flagoff. A NODE gate: no browser, no dev server, no
 * tiles. It proves the ONE property every R24 feature is required to have and
 * that no pixel gate can prove cheaply — that with the flags off, the tree
 * emits the R21 text.
 *
 * It is a STRUCTURAL proof, and that is the point: a pixel A/B can only show
 * that two frames matched at the poses someone thought to sample, while this
 * shows that the alternate branch is unreachable. Three checks:
 *
 *   (1) every C flag ships the RULED SHIP STATE (W3 close flip — this was
 *       "every flag ships enabled:false" through W1/W2, and it is the ONLY
 *       gate here whose expectation moves with the flip; (2) and (3) below do
 *       NOT, and that is the point of them — see the note above gate (1));
 *   (2) every GLSL injection C added is inside a predicate ternary whose false
 *       branch is the R21 string (so flag-off cannot reach new text);
 *   (3) the FINAL tile key goes through the shared `r24VariantKey` helper and
 *       returns the bare R19 key when every token is false;
 *   (4) the MONUMENT MATERIAL CONTRACT (R24 C, F4) — the RED/GREEN calibration
 *       for `verify-monuments-sat`'s three added gates, plus the fourth
 *       contract ("toy monuments are still MeshToon with their 3-step ramp")
 *       which lives here and only here because it is a claim about an
 *       UNREACHABLE BRANCH, and unreachability is a source property that a
 *       satellite-booting harness cannot assert without a style flip.
 *
 * Run: node scripts/verify-c-flagoff.mjs
 */
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
const fails = [];
let n = 0;
const gate = (name, ok, detail = '') => {
  n++;
  if (!ok) fails.push(name);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// ---- (1) every C flag ships the RULED SHIP STATE ---------------------------
// W3 CLOSE FLIP. Through W1/W2 this read "every C flag ships enabled:false".
// It is the ONE gate in this file whose expectation moves with the flip, and
// the reason the other two do not is the whole argument for keeping this file
// after the close: gates (2) and (3) assert that the FALSE branch of every
// injection is the R21 string verbatim and that `r24VariantKey` returns the
// bare R19 key when every token is false. Those are properties of the SOURCE,
// not of the flag's value — so they keep proving that the round is one flag
// flip away from R21 even now that the flags are on, which is exactly what a
// revert contract is for (R20 §7: "a one-flag revert contract rots as flags
// accumulate" — this is the anti-rot).
//
// Sub-values are asserted too, not just `enabled`: the ruled state is a state,
// not a boolean, and `dayK` in particular is a number the round deliberately
// did NOT spend (see the constants comment).
const SHIP = {
  LINEAR_HAZE: { enabled: true },
  ONE_SUN: { enabled: true, extra: [[/dayK:\s*1\.0\b/, 'dayK 1.0 (the demotion ships OFF — unmeasured)'], [/monumentsLambert:\s*true/, 'monumentsLambert']] },
  POST_ORDER: { enabled: true, extra: [[/smaaPreset:\s*'high'/, "smaaPreset 'high'"], [/dither:\s*true/, 'dither']] },
  DEPTH_FIX: { enabled: true },
  SHADOW_CALM: {
    enabled: true,
    extra: [
      [/biasSignFix:\s*true/, 'biasSignFix'],
      [/kernel:\s*'world'/, "kernel 'world'"],
      [/texelSnap:\s*true/, 'texelSnap'],
      [/satCadence:\s*0\b/, 'satCadence 0 (the documented refusal)'],
    ],
  },
  TERRAIN_LIGHT: {
    enabled: true,
    extra: [
      [/fragmentHill:\s*true/, 'fragmentHill'],
      [/microFwidth:\s*true/, 'microFwidth'],
      // THE ONE SUB-FLAG THAT STAYS OFF, and it is not an oversight: turning it
      // on makes `verify-skirt-worker`'s element-by-element identity leg go RED
      // BY DESIGN (normals differ; positions, uv and indices do not), so it
      // needs its own certification with a flag-on ARM. The tile half ships;
      // the worker half waits for that.
      [/workerNormals:\s*false/, 'workerNormals OFF — needs its own certification'],
    ],
  },
  CLOUD_LIT: { enabled: true },
  LAMBERT_ENV: { enabled: true, extra: [[/reflectivity:\s*0\.15/, 'reflectivity 0.15']] },
};
const consts = read('lib/fly/fly-constants.js');
const blockOf = (f) => {
  const i = consts.indexOf(`export const ${f} = `);
  if (i < 0) return '';
  const semi = consts.indexOf('\n};', i);
  const line = consts.indexOf('\n', i);
  // single-line block (`= { … };`) or multi-line (`= {\n … \n};`)
  return semi > i && semi < i + 4000 ? consts.slice(i, semi + 3) : consts.slice(i, line);
};
for (const [f, want] of Object.entries(SHIP)) {
  const b = blockOf(f);
  const en = new RegExp(`enabled:\\s*${want.enabled}`).test(b);
  const missing = (want.extra ?? []).filter(([re]) => !re.test(b)).map(([, n]) => n);
  gate(
    `${f} ships the ruled state (enabled:${want.enabled}${
      want.extra ? ', ' + want.extra.map(([, n]) => n).join(', ') : ''
    })`,
    b !== '' && en && missing.length === 0,
    missing.length ? `MISSING: ${missing.join(' | ')}` : ''
  );
}

// ---- (2) the injections are branch-gated ----------------------------------
const wb = read('lib/fly/toy-world/world-bend.js');
gate(
  'haze setters decode only under the LINEAR_HAZE accessor',
  /function hazeC\(c\) \{\s*return linearHazeOn\(\) \? srgbToLinear\(c\) : c;/.test(wb)
);
gate(
  'linearHazeOn() falls through to the constant when no pin is set',
  /export function linearHazeOn\(\) \{[\s\S]{0,600}?\n  return LINEAR_HAZE\.enabled;\n\}/.test(wb)
);
gate(
  'the pin is DEV-ONLY and null-guarded before it is read',
  /process\.env\.NODE_ENV === 'development' &&\s*\n\s*typeof window !== 'undefined' &&\s*\n\s*window\.__flyLinearHazeOverride != null/.test(
    wb
  )
);
gate(
  'groundOverlayOffset returns null with SHADOW_CALM off',
  /export function groundOverlayOffset\([^)]*\) \{\s*if \(!SHADOW_CALM\.enabled\) return null;/.test(wb)
);
gate(
  'uHillElev is only wired under hillElevOn()',
  /if \(hillElevOn\(\)\) shader\.uniforms\.uHillElev = hillUniforms\.uHillElev;/.test(wb)
);
gate(
  'the fragment-stage relief is a hillFragOn() ternary in BOTH stages',
  (wb.match(/hillFragOn\(\)\s*\n?\s*\?/g) || []).length >= 3,
  `${(wb.match(/hillFragOn\(\)/g) || []).length} references`
);
gate(
  'the R21 vertex N·L string survives verbatim as the false branch',
  wb.includes(
    "'vHill = clamp( dot( normalize( transformedNormal ), normalize( ( viewMatrix * vec4( uHillDir, 0.0 ) ).xyz ) ), 0.0, 1.0 );"
  )
);
gate(
  'the R21 micro-grain line survives verbatim as the false branch',
  wb.includes(
    "'  diffuseColor.rgb *= 1.0 + ( n - 0.5 ) * 2.0 * uMicroAmp * uMicroStrength;"
  )
);
const ap = read('components/fly/AerialPerspective.jsx');
gate(
  'the sky early-out text is chosen by DEPTH_FIX at module load',
  /const SKY_TEST = DEPTH_FIX\.enabled \? '[^']+' : 'd >= 0\.999999';/.test(ap)
);
gate(
  'uHazeColor decodes only under the LINEAR_HAZE accessor',
  /if \(linearHazeOn\(\)\) \{[\s\S]{0,200}SRGBColorSpace\);\s*\} else \{/.test(ap)
);
// THE PIN'S ONLY REAL CONTRACT. `__flyLinearHazeOverride` governs the tree only
// while `linearHazeOn()` is the sole reader: one surviving `LINEAR_HAZE.enabled`
// anywhere else — a new content layer, a second uniform, a "small" inline
// ternary — silently splits a pinned A/B into a half-decoded tree, and the
// measurement would look like a tuning result instead of a mixed build. So this
// gate counts readers across the WHOLE source tree, not just the two files
// above, and allows exactly the accessor's own fall-through.
{
  const files = [
    'lib/fly/toy-world/world-bend.js',
    'components/fly/AerialPerspective.jsx',
    'components/fly/FlyScene.jsx',
    'components/fly/Effects.jsx',
    'components/fly/SkyDome.jsx',
    'components/fly/FlyEffectComposer.jsx',
    'lib/fly/prewarm.js',
    'lib/fly/cloud-material.js',
    'lib/fly/post-policy.js',
    'lib/fly/shadow-kernel.js',
  ];
  const raw = [];
  for (const f of files) {
    const src = read(f);
    const lines = src.split('\n');
    for (const m of src.matchAll(/LINEAR_HAZE\.enabled/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      // R20 §7: a grep gate reads comments too. Skip lines that OPEN as a
      // comment (`//`, `/*`, or a docblock's `*`) — this file's own header
      // names the constant in prose. A trailing comment still counts, which
      // fails LOUD instead of hiding a reader: the conservative direction.
      const t = (lines[line - 1] || '').trim();
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
      raw.push(`${f}:${line}`);
    }
  }
  gate(
    'the raw LINEAR_HAZE.enabled has exactly ONE reader — linearHazeOn()',
    raw.length === 1 && raw[0].startsWith('lib/fly/toy-world/world-bend.js:'),
    `readers: ${raw.join(', ') || 'none'}`
  );
}
const fx = read('components/fly/Effects.jsx');
gate(
  'the pass reorder is a POST_ORDER ternary over ONE descriptor list',
  /return POST_ORDER\.enabled \? reorderForDisplaySpace\(list\) : list;/.test(fx)
);
gate(
  'the CoC patch no-ops with DEPTH_FIX off',
  /function patchDofDepth\(effect\) \{\s*if \(!DEPTH_FIX\.enabled \|\| !effect\) return effect;/.test(fx)
);
const sk = read('lib/fly/shadow-kernel.js');
gate(
  'the ShaderChunk edit is unreachable with SHADOW_CALM off',
  /if \(_state\.installed \|\| !SHADOW_CALM\.enabled\) return _state;/.test(sk)
);
const pp = read('lib/fly/post-policy.js');
gate(
  'finishPassChain no-ops with POST_ORDER off',
  /if \(!POST_ORDER\.enabled \|\| !POST_ORDER\.dither/.test(pp)
);
const cm = read('lib/fly/cloud-material.js');
gate(
  'the lit cloud class is null with CLOUD_LIT off',
  /export const LitCloudMaterial = CLOUD_LIT\.enabled \? makeLitCloudMaterial\(\) : null;/.test(cm)
);
gate(
  'the cloud shader early-outs at mix 0',
  /if \( uCloudMix <= 0\.0 \) return col;/.test(cm)
);

// ---- monument material contract -------------------------------------------
// R24 C (F4). `scripts/verify-monuments-sat.js` gained three browser gates for
// the ONE_SUN material swap (Toon → Lambert in satellite). That harness needs a
// browser, and this container's browser-gate budget belongs to certification —
// so its RED/GREEN is calibrated HERE, structurally, from the two components'
// own source. This is not a weaker substitute for the browser gate; it answers
// a different and stricter question. A browser gate reads whichever material
// happened to be constructed at one pose in one style; this proves WHICH
// BRANCH CAN RUN, in both styles, under both flag states, without booting
// anything.
//
// The fourth contract in C's ledger — "toy monuments are still MeshToon with
// their 3-step ramp" — lives here and only here, deliberately: it is a claim
// about an UNREACHABLE branch, and unreachability is a source property. A
// satellite harness cannot assert it without a style flip, and a style flip in
// a harness whose eleven frozen numbers are the point is a bad trade.
const LM = read('components/fly/LandmarkMonuments.jsx');
const MM = read('components/fly/MonumentModels.jsx');

// The satellite swap is guarded by the flag in BOTH representations, and the
// guard returns EARLY — so with the flag off the Toon construction below it is
// the only reachable one. That is the RED the browser gates will read.
gate(
  'archetype: the Lambert swap is ONE_SUN-guarded and returns early',
  /if \(ONE_SUN\.enabled && ONE_SUN\.monumentsLambert\) \{[\s\S]{0,400}?new MeshLambertMaterial\(\{[\s\S]{0,200}?vertexColors: true,[\s\S]{0,1600}?return ml;\s*\}/.test(
    LM
  )
);
gate(
  'marquee: the Lambert swap is ONE_SUN-guarded, satellite-only, returns early',
  /if \(!isToy && ONE_SUN\.enabled && ONE_SUN\.monumentsLambert\) \{[\s\S]{0,300}?new MeshLambertMaterial\(\{ vertexColors: true, side: DoubleSide \}\);[\s\S]{0,200}?return ml;\s*\}/.test(
    MM
  )
);
// GREEN side: both swaps produce the SAME class, which is what
// verify-monuments-sat gate 10 (the R20 interchangeability invariant) asserts
// at runtime. Proven here by construction rather than by coincidence of pose.
gate(
  'both representations swap to the SAME class (MeshLambertMaterial)',
  (LM.match(/new MeshLambertMaterial\(/g) || []).length === 1 &&
    (MM.match(/new MeshLambertMaterial\(/g) || []).length === 1
);
// MeshLambert is one of exactly three classes three r185 hands
// scene.environment to (WebGLPrograms.js:60-63) — the mechanism behind
// verify-monuments-sat gate 9, and behind the R20 §5b.4 Taj night residual
// ("MeshToonMaterial takes no envMap"). Assert the list has not moved under us.
{
  const programs = read('node_modules/three/src/renderers/webgl/WebGLPrograms.js');
  gate(
    'three still gives scene.environment to Standard/Lambert/Phong only',
    /isMeshStandardMaterial \|\| material\.isMeshLambertMaterial \|\| material\.isMeshPhongMaterial/.test(
      programs.replace(/\s+/g, ' ')
    ),
    'the mechanism verify-monuments-sat gate 9 rests on'
  );
}
// THE RED the three browser gates will read on a flag-off tree, stated as a
// source fact rather than as an expectation: with ONE_SUN off the guarded early
// return above is not taken, so the SATELLITE archetype falls through to the
// R13 stone-ramp Toon — which fails gate 8 (not Lambert) and gate 9 (Toon is
// not one of the three classes three gives scene.environment to). Gate 10
// passes trivially there because BOTH representations are Toon, which is why
// its own comment says it is a guard against a future half-move, not a RED.
gate(
  'flag-off satellite archetype still constructs MeshToon (the browser gates\' RED)',
  /const m = new MeshToonMaterial\(\{\s*color: LANDMARKS_3D\.satStyle\.color,\s*gradientMap: ramp,\s*vertexColors: true,\s*\}\);/.test(
    LM
  ),
  'and the marquee falls through to the shared Toon line asserted below'
);

// THE FOURTH CONTRACT: toy is untouched, in both representations.
gate(
  'toy archetype monuments are still MeshToon with a 3-step ramp',
  /new DataTexture\(new Uint8Array\(\[110, 190, 255\]\), 3, 1, RedFormat\)/.test(
    LM.replace(/\s+/g, ' ')
  ) && /new MeshToonMaterial\(\{ vertexColors: true, gradientMap: ramp \}\)/.test(LM)
);
gate(
  'toy marquee monuments are still MeshToon with a 3-step ramp',
  /isToy \? \[110, 190, 255\] : LANDMARKS_3D\.satStyle\.ramp/.test(MM.replace(/\s+/g, ' ')) &&
    /new MeshToonMaterial\(\{ vertexColors: true, gradientMap: ramp, side: DoubleSide \}\)/.test(MM)
);
// …and the toy branch cannot reach the Lambert swap at all: the marquee guard
// begins with `!isToy`, and the archetype swap sits inside `if (!isToy)`.
gate(
  'the toy branch cannot reach either Lambert swap',
  /if \(!isToy && ONE_SUN\.enabled/.test(MM) &&
    LM.indexOf('if (!isToy) {') >= 0 &&
    LM.indexOf('if (ONE_SUN.enabled && ONE_SUN.monumentsLambert) {') > LM.indexOf('if (!isToy) {')
);
// The Lambert env multiply is coupled in BOTH, so a monument cannot take a
// full-strength mirror tint the buildings around it are about to stop taking.
gate(
  'both monument Lamberts read LAMBERT_ENV.reflectivity',
  /if \(LAMBERT_ENV\.enabled\) ml\.reflectivity = LAMBERT_ENV\.reflectivity;/.test(LM) &&
    /if \(LAMBERT_ENV\.enabled\) ml\.reflectivity = LAMBERT_ENV\.reflectivity;/.test(MM)
);
// The harness must actually carry the three gates this calibration is for.
{
  const H = read('scripts/verify-monuments-sat.js');
  gate(
    'verify-monuments-sat carries the three added material gates',
    /satellite monument material is MeshLambert with vertexColors/.test(H) &&
      /satellite monument material takes scene\.environment/.test(H) &&
      /marquee and archetype monuments are the SAME material class/.test(H)
  );
  gate(
    '…and its eleven frozen gates are untouched',
    (H.match(/gate\(/g) || []).length === 13 &&
      /gate\('draw budget \(≤ 480\)', \(s\.draws \?\? 0\) <= 480/.test(H) &&
      /gate\('monument layer draws measurably, within budget', delta >= 1 && delta <= 15/.test(H),
    '13 = 10 frozen + zero-errors + the three added, minus none removed'
  );
}

// ---- (3) the shared key helper --------------------------------------------
gate('r24VariantKey is exported', /export function r24VariantKey\(base, tokens\)/.test(wb));
gate(
  'r24VariantKey returns the base when every token is false',
  /return t \? base \+ '-' \+ t \+ '24' : base;/.test(wb)
);
gate(
  'the tile key goes through the helper with the FIXED token order e/f/a/l',
  /\[hillElevOn\(\), 'e'\][\s\S]{0,200}\[hillFragOn\(\), 'f'\][\s\S]{0,200}\[AERIAL_LAW\.enabled, 'a'\][\s\S]{0,200}\[!!lodFade, 'l'\]/.test(
    wb
  )
);
gate(
  'applyHillshade accepts D\'s per-material lodFade predicate',
  /export function applyHillshade\(material, cfg, lodFade = null\)/.test(wb)
);

console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : `VERIFY: PASS (${n} gates)`);
process.exit(fails.length ? 1 : 0);
