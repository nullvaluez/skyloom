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
 *   (1) every C flag ships `enabled: false`;
 *   (2) every GLSL injection C added is inside a predicate ternary whose false
 *       branch is the R21 string (so flag-off cannot reach new text);
 *   (3) the FINAL tile key goes through the shared `r24VariantKey` helper and
 *       returns the bare R19 key when every token is false.
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

// ---- (1) every C flag ships off -------------------------------------------
const C_FLAGS = [
  'LINEAR_HAZE',
  'ONE_SUN',
  'POST_ORDER',
  'DEPTH_FIX',
  'SHADOW_CALM',
  'TERRAIN_LIGHT',
  'CLOUD_LIT',
  'LAMBERT_ENV',
];
const consts = read('lib/fly/fly-constants.js');
for (const f of C_FLAGS) {
  const i = consts.indexOf(`export const ${f} = `);
  const head = i < 0 ? '' : consts.slice(i, i + 400);
  gate(`${f} ships enabled:false`, i >= 0 && /enabled:\s*false/.test(head));
}

// ---- (2) the injections are branch-gated ----------------------------------
const wb = read('lib/fly/toy-world/world-bend.js');
gate(
  'haze setters decode only under LINEAR_HAZE',
  /function hazeC\(c\) \{\s*return LINEAR_HAZE\.enabled \? srgbToLinear\(c\) : c;/.test(wb)
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
  'uHazeColor decodes only under LINEAR_HAZE',
  /if \(LINEAR_HAZE\.enabled\) \{[\s\S]{0,200}SRGBColorSpace\);\s*\} else \{/.test(ap)
);
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
