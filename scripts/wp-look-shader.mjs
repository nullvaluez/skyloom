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
// (4) latched: flip the pin, the material keeps the latched answer
window.__flyWorldLookOverride = { enabled: false };
check('(4) latched for the page load', program(false).key === on[false].key);
// (3) sub-switches
WP.__resetWorldPassLatchForTests();
window.__flyWorldLookOverride = { enabled: true, roofPhoto: false, authority: false };
const none = program(false);
check('(3) roofPhoto + authority off: no edits', !none.frag.includes('wlBase') && !none.key.includes('world-look'));
console.log(`${pass} passed${process.exitCode ? ', FAILURES' : ''}`);
