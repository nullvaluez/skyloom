/**
 * World Pass D (LOOK) node gate: the architecture program with the look stream
 * on and off. Builds the near and far materials against three's real standard
 * program (the graphics-unit idiom) and checks:
 *   (1) flag off: no WORLD_LOOK text and no look key (the program is today's);
 *   (2) look on (pins: ?flags=WORLD_LOOK at desktop Ultra): every anchored edit
 *       applied exactly once, near and far, and the key names the switches;
 *   (3) with a sub-switch off the matching edits are absent;
 *   (4) the reader is latched: a later pin change does not move a material.
 *   node scripts/wp-look-shader.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) specifier = new URL('../' + specifier.slice(2), import.meta.url).href;
  if (specifier.startsWith('.') || specifier.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL);
    if (fs.existsSync(fileURLToPath(url) + '.js')) return next(url.href + '.js', context);
  }
  return next(specifier, context);
} });

globalThis.window = globalThis.window ?? { location: { search: '' } };
const { ShaderLib } = await import('three');
const WP = await import('../lib/fly/world-pass.js');
const M = await import('../lib/fly/satellite-architecture-material.js');
let pass = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (ok) pass++;
  else process.exitCode = 1;
};
const program = (distant) => {
  const m = M.createSatelliteArchitectureMaterial({ distant });
  const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
  m.onBeforeCompile(shader);
  const key = m.customProgramCacheKey();
  m.dispose();
  return { frag: shader.fragmentShader, vert: shader.vertexShader, key };
};
const count = (s, t) => s.split(t).length - 1;

// (1) off
WP.__resetWorldPassLatchForTests();
for (const distant of [false, true]) {
  const p = program(distant);
  check(`(1) off ${distant ? 'far' : 'near'}: no WORLD_LOOK edit, no key`, !p.frag.includes('wlBase') && !p.frag.includes('WORLD_LOOK') && !p.key.includes('world-look'));
}
// (2) on
WP.__resetWorldPassLatchForTests();
window.__flyWorldPassTierOverride = true;
window.__flyWorldLookOverride = { enabled: true };
const on = {};
for (const distant of [false, true]) {
  const p = (on[distant] = program(distant));
  const name = distant ? 'far' : 'near';
  check(`(2) on ${name}: base captured once`, count(p.frag, 'vec3 wlBase = diffuseColor.rgb;') === 1);
  check(`(2) on ${name}: roof albedo from the worker`, count(p.frag, 'cityRoof=wlBase;') === 1);
  check(`(2) on ${name}: key`, /\|world-look-v\d+-rw?/.test(p.key), p.key);
}
check('(2) look-facade roof value steps aside', /lfDay\*lfRoof\*0\.\)/.test(on[false].frag));
for (const distant of [false, true]) {
  const p = on[distant], name = distant ? 'far' : 'near';
  // Round 2: the near ring's material code is in the style byte (2 / 3), the far mass's in the red offset.
  const wf = p.frag.indexOf('float isWall = style.z;'), fl = p.frag.indexOf('isWall=min(isWall,1.);');
  const firstUse = p.frag.indexOf('isWall', p.frag.indexOf('float wlZ=isWall;') + 'float wlZ=isWall;'.length + 1);
  // Round 3: the byte is material + 4 x (night gain code + 1); the gain scales the albedo at night only.
  const nightAt = p.frag.indexOf('diffuseColor.rgb=wlBase*mix(1.,wlNight,uArchitectureNight);');
  check(`(2) on ${name}: wall material and night gain decoded (style byte and red offset) before any pass`, count(p.frag, 'float wlZm=wlZ-4.*floor(wlZ*.25);') === 1 && count(p.frag, 'float wlMode=wlZm>2.5?2.:wlZm>1.5?1.:0.;') === 1 && count(p.frag, 'float wlNight=wlZ>3.5?exp2(-1.+4.*(floor(wlZ*.25)-1.)/62.):1.;') === 1 && count(p.frag, 'float wlModeR=wlBase.r>7.5?2.:wlBase.r>3.5?1.:0.;') === 1 && wf >= 0 && fl > wf && firstUse === fl && nightAt >= 0 && nightAt < p.frag.indexOf('cityDay='));
  check(`(2) on ${name}: wall albedo from the worker, the tag decides curtain glass`, count(p.frag, 'cityWall=wlBase;') === 1 && count(p.frag, 'cityCurtain=wlMode>1.5?0.:wlMode>.5?1.:cityCurtain;') === 1);
  check(`(2) on ${name}: look-facade wall identity terms step aside, dark glass on curtain only`, /lfDay\*lfFace\*0\.\)/.test(p.frag) && /lfDarkT\*cityCurtain\)/.test(p.frag));
}
// (5) round 3: the night gain round trip, worker encode (colour.js nightGainCode,
// look-roofs.js material + 4 x (code + 1)) against the GLSL decode as written above.
{
  const CO = await import('../lib/fly/toy-world/worker/sat-buildings/colour.js');
  let worst = 0, modeOk = true;
  for (let g = 0.5; g <= 8; g *= 1.01) for (const mat of [1, 2, 3]) {
    const z = mat + 4 * (CO.nightGainCode(g) + 1);
    const zm = z - 4 * Math.floor(z * 0.25);
    const mode = zm > 2.5 ? 2 : zm > 1.5 ? 1 : 0;
    const gain = z > 3.5 ? 2 ** (-1 + (4 * (Math.floor(z * 0.25) - 1)) / 62) : 1;
    worst = Math.max(worst, Math.abs(Math.log2(gain / g)));
    if (mode !== mat - 1 || z > 255) modeOk = false;
  }
  check('(5) night gain code round trip (material kept, gain within half a step, byte <= 255)', modeOk && worst <= 2 / 62 + 1e-9, `worst log2 error ${worst}`);
}
// (4) latched: flip the pin, the material keeps the latched answer
window.__flyWorldLookOverride = { enabled: false };
check('(4) latched for the page load', program(false).key === on[false].key);
// (3) sub-switches
WP.__resetWorldPassLatchForTests();
window.__flyWorldLookOverride = { enabled: true, roofPhoto: false, authority: false };
const none = program(false);
check('(3) roofPhoto + authority off: no edits', !none.frag.includes('wlBase') && !none.key.includes('world-look'));
console.log(`${pass} passed${process.exitCode ? ', FAILURES' : ''}`);
