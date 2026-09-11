import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { MeshStandardMaterial, MeshDepthMaterial, ShaderLib } from 'three';
const base = new URL('../', import.meta.url);
const read = name => fs.readFileSync(new URL(name, base), 'utf8');
const near = read('lib/fly/near-ground.js').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const source = read('lib/fly/daylight-depth.js').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const ctx = { process: { env: { NODE_ENV: 'production' } }, graphicsReviewOn: () => false };
vm.createContext(ctx);
vm.runInContext(`${near}\n${source}\nObject.assign(globalThis,{applyDaylightSurface,daylightDepthWeight,daylightNearHazeMix,updateDaylightDepth,DAYLIGHT_DEPTH_UNIFORMS,DAYLIGHT_DEPTH});`, ctx);
let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
test('day/night/overcast surface response is bounded and finite', () => {
  assert.equal(ctx.daylightDepthWeight(-1), 0);
  assert.equal(ctx.daylightDepthWeight(1), 1);
  assert.ok(ctx.daylightDepthWeight(1, 1) < ctx.daylightDepthWeight(1, 0));
  for (let el = -1; el <= 1; el += 0.005) {
    const k = ctx.daylightDepthWeight(el, 0.4);
    assert.ok(Number.isFinite(k) && k >= 0 && k <= 1);
  }
});
test('style exit and night restore material lighting without a reconstruction', () => {
  const rt = { sun: { sinEl: 1 }, weather: { wx: { overcastT: 0 } } };
  assert.equal(ctx.updateDaylightDepth(rt, true), 1);
  assert.equal(ctx.updateDaylightDepth(rt, false), 0);
  rt.sun.sinEl = -1;
  assert.equal(ctx.updateDaylightDepth(rt, true), 0);
});
test('near haze preserves its zero and disabled identities and never increases', () => {
  for (const old of [0, 0.01, 0.1, 0.2]) {
    assert.equal(ctx.daylightNearHazeMix(old, 0), old);
    assert.ok(ctx.daylightNearHazeMix(old, 1) <= old);
  }
  assert.ok(ctx.daylightNearHazeMix(0.1, 1) < 0.1 / 2);
});
test('composed Standard shader changes only indirect diffuse, retaining direct and emission paths', () => {
  for (const surface of ['terrain', 'building', 'canopy', 'clutter']) {
    const m = new MeshStandardMaterial();
    let before = 0; m.onBeforeCompile = () => { before++; };
    ctx.applyDaylightSurface(m, surface);
    const shader = { ...ShaderLib.standard, uniforms: {} };
    m.onBeforeCompile(shader);
    assert.equal(before, 1);
    assert.match(shader.fragmentShader, /reflectedLight\.indirectDiffuse \*= mix\(1\.0,/);
    assert.ok(shader.fragmentShader.includes('#include <emissivemap_fragment>'));
    assert.ok(shader.fragmentShader.includes('#include <lights_fragment_begin>'));
    assert.equal(shader.uniforms.uDaylightDepth, ctx.DAYLIGHT_DEPTH_UNIFORMS.uDaylightDepth);
    assert.ok(m.customProgramCacheKey().endsWith(`-daylight-${surface}-v1`));
    m.dispose();
  }
});
test('depth shaders and repeated composition retain their identity', () => {
  const depth = new MeshDepthMaterial(), before = depth.customProgramCacheKey();
  ctx.applyDaylightSurface(depth);
  assert.equal(depth.customProgramCacheKey(), before);
  const m = new MeshStandardMaterial(); ctx.applyDaylightSurface(m);
  const once = m.customProgramCacheKey(); ctx.applyDaylightSurface(m);
  assert.equal(m.customProgramCacheKey(), once);
  depth.dispose(); m.dispose();
});
test('bent receivers sample the displayed surface without changing environment coordinates', () => {
  const m = new MeshStandardMaterial(); m.userData.__worldBend = 'anchor';
  ctx.applyDaylightSurface(m);
  const shader = { ...ShaderLib.standard, uniforms: {} }; m.onBeforeCompile(shader);
  const projected = shader.vertexShader.indexOf('worldPosition = wPos;');
  const shadow = shader.vertexShader.indexOf('#include <shadowmap_vertex>');
  const restored = shader.vertexShader.indexOf('worldPosition = daylightFlatWorldPosition;');
  assert.ok(projected >= 0 && projected < shadow && shadow < restored);
  m.dispose();
});
const effects = read('components/fly/Effects.jsx');
const start = effects.indexOf('const PRE_CURVE =');
const end = effects.indexOf('\n/**', start);
const reorderSource = effects.slice(start, end);
const reorder = vm.runInNewContext(`${reorderSource}\nreorderForDisplaySpace;`);
test('real final ordering composites cloud radiance before bloom and tone mapping at every Satellite tier', () => {
  for (const tier of ['high', 'medium', 'low']) {
    const ids = [...(tier === 'high' ? ['n8ao'] : []), 'aerial', 'immersive-clouds', ...(tier !== 'low' ? ['bloom'] : []), 'sat-hue', 'sat-bc', 'vignette', 'smaa', 'tone'];
    const input = ids.map(id => ({ id })), out = reorder(input), order = Array.from(out, p => p.id);
    assert.deepEqual([...order].sort(), [...ids].sort());
    assert.ok(order.indexOf('aerial') < order.indexOf('immersive-clouds'));
    assert.ok(order.indexOf('immersive-clouds') < order.indexOf('tone'));
    if (tier !== 'low') assert.ok(order.indexOf('immersive-clouds') < order.indexOf('bloom'));
    assert.ok(order.indexOf('tone') < order.indexOf('sat-bc'));
    assert.equal(order.at(-1), 'smaa');
  }
});
test('ordering gate reproduces the inherited late-cloud defect without moving an assertion', () => {
  const broken = vm.runInNewContext(`${reorderSource.replace("'immersive-clouds', ", '')}\nreorderForDisplaySpace;`);
  const out = broken(['aerial', 'immersive-clouds', 'bloom', 'tone', 'sat-bc'].map(id => ({ id })));
  const ids = Array.from(out, p => p.id);
  assert.ok(ids.indexOf('immersive-clouds') > ids.indexOf('tone'));
});
test('no-tone path retains the original list and Neon has no injected cloud pass', () => {
  const noTone = ['aerial', 'immersive-clouds'].map(id => ({ id }));
  assert.equal(reorder(noTone), noTone);
  const toy = reorder(['bloom', 'toy-dof', 'toy-hue', 'vignette', 'tone', 'smaa'].map(id => ({ id })));
  assert.equal(toy.filter(p => p.id === 'immersive-clouds').length, 0);
});
console.log(`VERIFY: PASS daylight depth ${checks}/${checks}; browser appearance and budgets remain separate`);
