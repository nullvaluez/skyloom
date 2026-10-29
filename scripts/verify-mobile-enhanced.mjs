import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_node-resolve.mjs', import.meta.url);
const { MOBILE_ENHANCED } = await import('../lib/fly/fly-constants.js');
const { mobileEnhancedOn, mobileShadowRange, stepMobileShadowRange } = await import('../lib/fly/mobile-enhanced.js');
const { useFlyStore } = await import('../stores/fly-store.js');
const { updateDaylightDepth, DAYLIGHT_DEPTH_UNIFORMS } = await import('../lib/fly/daylight-depth.js');
const { AtmosphereLuts } = await import('../lib/fly/atmosphere/gpu.js');
const { atmosphereParams } = await import('../lib/fly/atmosphere/model.js');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('PASS ' + name); };
const state = { mapStyle: 'satellite', visuals: 'enhanced', qualityTier: 'medium' };
globalThis.window = { location: { search: '' }, ontouchstart: null, matchMedia: () => ({ matches: true }) };
check('new look ships off, with a device/style/tier-scoped review switch', () => {
  assert.equal(MOBILE_ENHANCED.enabled, false);
  assert.equal(mobileEnhancedOn(state, true), false);
  window.__flyMobileEnhancedOverride = { enabled: true };
  assert.equal(mobileEnhancedOn(state, true), true);
  assert.equal(mobileEnhancedOn({ ...state, qualityTier: 'high' }, true), true);
  for (const next of [{ ...state, visuals: 'classic' }, { ...state, mapStyle: 'toy' }, { ...state, qualityTier: 'low' }]) assert.equal(mobileEnhancedOn(next, true), false);
  assert.equal(mobileEnhancedOn(state, false), false);
});
check('shadow coverage reaches nearby ground within a fixed single-map range ceiling', () => {
  assert.equal(mobileShadowRange(500, 0), 500);
  assert.ok(mobileShadowRange(500, 500) > 500);
  assert.equal(mobileShadowRange(500, 20000), 1200);
  for (const invalid of [NaN, Infinity, undefined, -10]) assert.equal(mobileShadowRange(500, invalid), 500);
  let previous = 500;
  for (let agl = 0; agl < 20000; agl += 10) {
    const range = mobileShadowRange(500, agl);
    assert.ok(range >= previous && range <= 1200); previous = range;
  }
});
check('rendered-ground refinement eases shadow coverage; warp clears the old location', () => {
  let prior = stepMobileShadowRange(null, 500, 1, 1 / 60);
  let last = prior.rangeM;
  for (let i = 0; i < 300; i++) {
    prior = stepMobileShadowRange(prior, 1200, 1, 1 / 60);
    assert.ok(prior.rangeM >= last && prior.rangeM <= 1200);
    assert.ok(prior.rangeM - last < 12); last = prior.rangeM;
  }
  assert.ok(prior.rangeM > 1195);
  assert.equal(stepMobileShadowRange(prior, 500, 2, 1 / 60).rangeM, 500);
  assert.equal(stepMobileShadowRange(prior, 500, 1, NaN).rangeM, prior.rangeM);
});
check('world depth uses the existing indirect term and preserves night and fallback profiles', () => {
  useFlyStore.setState(state);
  const runtime = { sun: { sinEl: 1 }, weather: { wx: { overcastT: 0 } } };
  assert.equal(updateDaylightDepth(runtime, true), .45);
  assert.equal(updateDaylightDepth(runtime, false), 0, 'unmount cleanup resets the shared uniform');
  runtime.weather.wx.overcastT = 1;
  assert.ok(updateDaylightDepth(runtime, true) < .2);
  runtime.sun.sinEl = -.5;
  assert.equal(updateDaylightDepth(runtime, true), 0);
  runtime.sun.sinEl = 1;
  useFlyStore.setState({ qualityTier: 'low' });
  assert.equal(updateDaylightDepth(runtime, true), 0);
  useFlyStore.setState(state); window.__flyMobileEnhancedOverride.enabled = false;
  assert.equal(updateDaylightDepth(runtime, true), 0);
  assert.equal(DAYLIGHT_DEPTH_UNIFORMS.uDaylightDepth.value, 0);
});
function renderer() {
  return { autoClear: true, target: null, draws: 0, getRenderTarget() { return this.target; },
    setRenderTarget(t) { this.target = t; }, render() { this.draws++; } };
}
check('declared sky cadence reduces rapid-climb LUT work without changing tables', () => {
  const baseline = new AtmosphereLuts(atmosphereParams());
  const bounded = new AtmosphereLuts(atmosphereParams());
  const a = renderer(), b = renderer();
  try {
    for (let i = 0; i <= 240; i++) {
      const eye = { h: .2 + i / 120 * .3, muS: .6, maxKm: 160, nowSec: i / 120, aerialHz: 10 };
      baseline.update(a, eye); bounded.update(b, { ...eye, skyHz: 30 });
    }
    assert.equal(baseline.stats.skyRenders, 241);
    assert.equal(bounded.stats.skyRenders, 61);
    assert.equal(bounded.stats.aerialRenders, baseline.stats.aerialRenders);
    assert.equal(bounded.sky.width, baseline.sky.width);
    assert.equal(bounded.sky.height, baseline.sky.height);
    assert.equal(bounded.materials.sky.fragmentShader, baseline.materials.sky.fragmentShader);
    assert.equal(b.target, null); assert.equal(b.autoClear, true);
    console.log(`  sky draws: ${baseline.stats.skyRenders} -> ${bounded.stats.skyRenders} over 2 s at 120 Hz (synthetic climb)`);
  } finally { baseline.dispose(); bounded.dispose(); }
});
check('warp, sun jump, clock reset and context restoration bypass the cadence hold', () => {
  const luts = new AtmosphereLuts(atmosphereParams()), gl = renderer();
  const eye = { h: .2, muS: .6, maxKm: 160, nowSec: 10, aerialHz: 10, skyHz: 30 };
  try {
    luts.update(gl, eye);
    luts.update(gl, { ...eye, h: .21, nowSec: 10.001 });
    assert.equal(luts.stats.skyRenders, 1);
    luts.update(gl, { ...eye, h: 2, nowSec: 10.002 });
    assert.equal(luts.skyState.h, 2);
    luts.update(gl, { ...eye, h: 2, muS: .2, nowSec: 10.003 });
    assert.equal(luts.skyState.muS, .2);
    luts.update(gl, { ...eye, h: 2.01, muS: .2, nowSec: 0 });
    assert.equal(luts.skyState.h, 2.01);
    const before = luts.stats.skyRenders;
    luts.invalidate(); luts.update(gl, { ...eye, nowSec: 0 });
    assert.equal(luts.stats.skyRenders, before + 1);
    assert.equal(luts.stats.staticRenders, 2);
  } finally { luts.dispose(); }
});
delete globalThis.window;
console.log(`PASS ${passed} mobile Enhanced checks`);
