/**
 * LOOK PASS A (ATMOS) gate: lib/fly/look-atmos.js, FLY_LOOK_PASS.md.
 *
 * Node only (no GPU). Asserts the seam contracts the look rests on:
 *  (1) flag off: the aerial text is returned byte for byte, the mist floor is
 *      0 and the per-frame update switches the layer off;
 *  (2) flag on: the boundary-layer edit lands exactly once, before the world
 *      fade, with its declarations once before mainImage, and a text without
 *      the physical anchor (PHYS_SKY off, Classic) is returned unchanged;
 *  (3) the device gate: outside desktop High/Ultra (allowed = false) the
 *      layer is off (w = 0) and the mist floor is 0, so Medium, phones and Low
 *      keep the previous law exactly;
 *  (4) the shipped AerialPerspective wiring picks the layer text only in the
 *      Enhanced branch and keeps the clarity text as its fallback.
 * Run: node scripts/verify-look-atmos.mjs
 */
import { register } from 'node:module';
import fs from 'node:fs';

register('./_node-resolve.mjs', import.meta.url);
const LA = await import('../lib/fly/look-atmos.js');

let pass = 0;
let fail = 0;
const check = (name, ok, note = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

const AT = '      if(uR25Mode.x>.5)lit=mix(lit,haze,smoothstep(uR25WorldFade.x,uR25WorldFade.y,dXZ));\n';
const SRC = `uniform float uX;\nvoid mainImage(const in vec4 inputColor,const in vec2 uv,const in float depth,out vec4 outputColor){\n${AT}}\n`;

check('(1a) flag off: the aerial text is the input, byte for byte', LA.lookAtmosAerialShader(SRC, false) === SRC);
const on = LA.lookAtmosAerialShader(SRC, true);
const count = (s, t) => s.split(t).length - 1;
check('(2a) flag on: the layer call lands once, before the world fade', count(on, 'lit=lookAtmos(lit,metricRay,trueY);') === 1 && on.indexOf('lookAtmos(lit,') < on.indexOf(AT));
check('(2b) flag on: declarations once, before mainImage', count(on, 'vec3 lookAtmos(') === 1 && on.indexOf('vec3 lookAtmos(') < on.indexOf('void mainImage('));
check('(2c) a text without the physical anchor is returned unchanged', LA.lookAtmosAerialShader('void mainImage(){}', true) === 'void mainImage(){}');
let threw = false;
try { LA.lookAtmosAerialShader(SRC + SRC, true); } catch { threw = true; }
check('(2d) a repeated anchor throws instead of editing silently', threw);

const env = { day: 1, golden: 0, overcast: 0 };
LA.updateLookAtmos(env, false);
check('(3a) outside desktop High/Ultra the layer is off (w = 0)', LA.LOOK_ATMOS_UNIFORMS.uLookAtmosA.value.w === 0);
check('(3b) outside desktop High/Ultra the mist floor is 0', [-20, -3, 0, 7, 20, 45].every((el) => LA.lookMistFloor(el, false) === 0 && LA.lookMistFloor(el, true) === 0));
LA.updateLookAtmos(env, true);
const A = LA.LOOK_ATMOS_UNIFORMS.uLookAtmosA.value;
if (LA.LOOK_ATMOS_ON) {
  check('(3c) flag on, desktop: the layer is on with a finite positive density', A.w === 1 && A.x > 0 && Number.isFinite(A.x));
  const E = LA.LOOK_ATMOS_UNIFORMS.uLookAtmosE.value;
  check('(3d) flag on: the opacity cap is in (0, 1] and the noon tint is white', E.x > 0 && E.x <= 1 && E.y === 1 && E.z === 1 && E.w === 1);
  const mist = [-20, -10, -3, 0, 3, 7, 12, 20, 45].map((el) => LA.lookMistFloor(el, false));
  check('(3e) flag on: the evening mist floor is bounded [0, 1.5] and present at golden hour', mist.every((v) => v >= 0 && v <= 1.5) && LA.lookMistFloor(7, false) > 0.2, mist.map((v) => v.toFixed(2)).join(' '));
} else {
  check('(3c) flag off: the layer stays off even on desktop', A.w === 0);
}

const ap = fs.readFileSync(new URL('../components/fly/AerialPerspective.jsx', import.meta.url), 'utf8');
check('(4a) wiring: the layer text only in the Enhanced branch, the clarity text its fallback',
  ap.includes('r25 && LOOK_TEXT_ON ? enhancedFragmentShaderLook : r25 ? enhancedFragmentShaderClarity : fragmentShader')
  && ap.includes('const enhancedFragmentShaderLook = lookAtmosAerialShader(enhancedFragmentShaderClarity);'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
