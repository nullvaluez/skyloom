/** Physical city light must disappear with the terrain it illuminates.
 * Real AerialPerspective program text, page-load flag arms, no GPU required.
 * Run: node scripts/verify-twilight-ground.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { register, registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const leg = process.argv.find((arg) => arg.startsWith('--leg='))?.slice(6);
const factor = '*(uR25Mode.x>.5?1.-smoothstep(uR25WorldFade.x,uR25WorldFade.y,dXZ):1.)';
if (leg) {
  globalThis.window = { location: { search: '', href: 'http://localhost/' },
    __flyTwilightBalanceOverride: { enabled: leg === 'on' },
    __flyNightLightsOverride: { enabled: true }, __flyGroundMistOverride: { enabled: true },
  };
  const inert = new Proxy(function () {}, { get: (_, key) => key === Symbol.toPrimitive ? () => 0 : inert,
    apply: () => inert, construct: () => inert });
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return inert; } };
  if (leg === 'head') {
    const sources = new Map(['lib/fly/living-ground.js', 'lib/fly/night-lights-atlas.js'].map((file) =>
      [new URL(`../${file}`, import.meta.url).href, execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' })]));
    registerHooks({ load(url, context, next) {
      return sources.has(url) ? { format: 'module', shortCircuit: true, source: sources.get(url) } : next(url, context);
    } });
  }
  register('./_node-resolve.mjs', import.meta.url);
  register('./_alias-loader.mjs', import.meta.url);
  register('./_r25-c-jsx-loader.mjs', import.meta.url);
  const { AerialPerspectiveEffect } = await import('../components/fly/AerialPerspective.jsx');
  const { LIVING_GROUND_SHADERS } = await import('../lib/fly/living-ground.js');
  const enhanced = new AerialPerspectiveEffect({ r25: true });
  const classic = new AerialPerspectiveEffect();
  process.stdout.write(JSON.stringify({ enhanced: enhanced.getFragmentShader(), classic: classic.getFragmentShader(),
    uniforms: [...enhanced.uniforms.keys()].sort(), patched: LIVING_GROUND_SHADERS['aerial-enhanced'] }));
  enhanced.dispose(); classic.dispose();
  process.exit(0);
}

const arm = (name) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), `--leg=${name}`],
  { encoding: 'utf8', maxBuffer: 4e6 }));
const head = arm('head'), off = arm('off'), on = arm('on');
assert.equal(off.enhanced, head.enhanced);
assert.equal(off.classic, head.classic);
assert.deepEqual(off.uniforms, head.uniforms);
console.log('PASS flag off is byte-identical to literal git HEAD ground and night-light shader output');

assert.equal(on.patched, 'patched');
assert.equal(on.enhanced.split(factor).length, 2);
const grazing = on.enhanced.match(/\nfloat nlGrazingVisibility\(vec3 metricRay\)\{[\s\S]*?\n\}\n/)[0];
assert.equal(on.enhanced.replace(factor, '').replace(grazing, '').replace('*nlGrazingVisibility(metricRay)', ''), off.enhanced);
assert.equal(on.classic, off.classic);
assert.deepEqual(on.uniforms, off.uniforms);
assert.ok(on.enhanced.includes(`lit+=lgEmit*apT*transmission${factor};`));
assert.ok(on.enhanced.includes('lit=mix(lit,haze,smoothstep(uR25WorldFade.x,uR25WorldFade.y,dXZ));'));
assert.ok(on.enhanced.includes('transmittance*=1.-smoothstep(uR25WorldFade.x,uR25WorldFade.y,dXZ);'));
console.log('PASS only the physical emitter dissolve and VIIRS grazing visibility change; Classic and uniform budget unchanged');

// Evaluate the exact emitted GLSL factor numerically. The first model-off
// arm guards the conditional: without a sky model there is no world dissolve.
const smoothstep = (a, b, d) => { const t = Math.max(0, Math.min(1, (d - a) / (b - a))); return t * t * (3 - 2 * t); };
const evaluate = new Function('uR25Mode', 'uR25WorldFade', 'dXZ', 'smoothstep', `return ${factor.slice(1)};`);
for (const edgeStart of [30000, 45000, 60000]) {
  const band = { x: edgeStart * .6, y: edgeStart };
  let previous = 1;
  for (let i = 0; i <= 200; i++) {
    const distance = i / 100 * edgeStart;
    const weight = evaluate({ x: 1 }, band, distance, smoothstep);
    assert.ok(weight >= 0 && weight <= previous + 1e-12);
    assert.equal(weight, 1 - smoothstep(band.x, band.y, distance));
    assert.equal(evaluate({ x: 0 }, band, distance, smoothstep), 1);
    if (distance <= band.x) assert.equal(weight, 1);
    if (distance >= band.y) assert.equal(weight, 0);
    // Daylight/twilight/night emitters and every channel retain exactly their
    // original physical air T and weather T; nothing adds energy anywhere.
    for (const emit of [0, .015, .12, 1]) for (const airT of [0, .2, .8, 1]) for (const weatherT of [0, .4, 1]) {
      const before = emit * airT * weatherT;
      const after = before * weight;
      assert.ok(after >= 0 && after <= before);
      if (distance >= band.y) assert.equal(after, 0);
    }
    previous = weight;
  }
  assert.equal(evaluate({ x: 1 }, band, (band.x + band.y) / 2, smoothstep), .5);
  const epsilon = .01;
  assert.ok(1 - evaluate({ x: 1 }, band, band.x + epsilon, smoothstep) < 1e-10);
  assert.ok(evaluate({ x: 1 }, band, band.y - epsilon, smoothstep) < 1e-10);
}
console.log('PASS every tier: smooth monotone fade, identity before the band, zero light on fully vanished terrain');
console.log('PASS both physical and weather attenuation survive; no daylight, twilight or night energy increase');

// Execute the actual assembled GLSL function's scalar/vector arithmetic.
// This covers latitude-independent metric elevation, not the anisotropic scene
// ray which previously made angular tuning depend on Mercator latitude.
const body = grazing.slice(grazing.indexOf('{') + 1, grazing.lastIndexOf('}'))
  .replace(/\bfloat\b/g, 'let').replace(/\babs\(/g, 'Math.abs(').replace(/\bmax\(/g, 'Math.max(')
  .replace('length(metricRay)', 'Math.hypot(metricRay.x,metricRay.y,metricRay.z)');
const visibility = new Function('metricRay', 'smoothstep', 'mix', body);
const angleVisibility = (degrees) => visibility({ x: Math.cos(degrees * Math.PI / 180), y: Math.sin(degrees * Math.PI / 180), z: 0 }, smoothstep, (a, b, t) => a + (b - a) * t);
let previous = 0;
for (let angle = 0; angle <= 90; angle += .1) {
  const weight = angleVisibility(angle);
  assert.ok(weight >= .1 - 1e-12 && weight <= 1 && weight >= previous - 1e-12);
  if (angle <= 1) assert.equal(weight, .1);
  if (angle >= 6) assert.equal(weight, 1);
  previous = weight;
}
assert.equal(angleVisibility(0), .1);
assert.equal(angleVisibility(6), 1);
assert.ok(angleVisibility(1.001) - .1 < 1e-6);
assert.ok(1 - angleVisibility(5.999) < 1e-6);
assert.equal(angleVisibility(-3), angleVisibility(3));
// Measured pose: 390m camera, 60deg FOV, real-Earth bend, NYC true-scale view.
// The original band lies in rows450..480, ~26.5..7.6km true, mostly BEFORE the
// 36km scene world fade. Reproduce that previously untested near-horizon case.
const rows = [{ y: 450, angle: .95448 }, { y: 455, angle: 1.28429 }, { y: 460, angle: 1.61429 },
  { y: 470, angle: 2.27480 }, { y: 480, angle: 2.93584 }];
for (const row of rows) {
  row.visibility = +angleVisibility(row.angle).toFixed(4);
  assert.ok(row.visibility < .43);
}
assert.ok(on.enhanced.includes('city=textureLod(uNLAtlas,uv,3.5).rgb*uNLParams.y*fresh*w;'));
console.log('PASS actual VIIRS shader: continuous true-angle occlusion, exact identity at6deg+, city-to-mist unchanged');
console.log(`PASS measured low-flight band now attenuated even before world fade: ${JSON.stringify(rows)}`);
