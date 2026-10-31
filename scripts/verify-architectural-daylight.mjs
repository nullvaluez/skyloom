import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_node-resolve.mjs', import.meta.url);
// Isolate the authored fallback first; the physical-sky override is exercised
// below and in the browser with the shipped PHYS_SKY default enabled.
globalThis.window = { location: { search: '?graphicsReview=1' }, __flyBuildingRealismOverride: { enabled: true }, __flyPhysSkyOverride: { enabled: false } };
const { createCinemaEnvironment, evaluateCinemaEnvironment } = await import('../lib/fly/cinema-environment.js');
const { applyCinemaArt } = await import('../lib/fly/cinema-art.js');
const { applyArchitecturalDaylight } = await import('../lib/fly/architectural-daylight.js');

let passed = 0;
const check = (name, test) => { test(); passed++; console.log(`PASS ${name}`); };
const environment = (degrees, weather = {}) => applyCinemaArt(evaluateCinemaEnvironment(
  createCinemaEnvironment(), { sinEl: Math.sin(degrees * Math.PI / 180), az: 1.2 }, weather,
));
const corrected = (degrees, weather) => applyArchitecturalDaylight(environment(degrees, weather));

check('neutral surfaces receive daylight rather than a permanent amber key', () => {
  const before = environment(60), after = corrected(60);
  assert.ok(before.keyColor[2] / before.keyColor[0] < 0.7, 'positive control reproduces the yellow source');
  assert.ok(after.keyColor[2] / after.keyColor[0] >= 0.9);
  assert.ok(after.keyColor[1] / after.keyColor[0] >= 0.95);
  assert.deepEqual(after.sunTint, after.keyColor);
});

check('low sun remains warm and overcast removes the excess colour cast', () => {
  const noon = corrected(60), low = corrected(6), cloud = corrected(6, { overcastT: 1 });
  assert.ok(low.keyColor[0] > low.keyColor[1] && low.keyColor[1] > low.keyColor[2]);
  assert.ok(low.keyColor[2] < noon.keyColor[2] - 0.2);
  assert.ok(cloud.keyColor[2] > low.keyColor[2]);
  assert.ok(cloud.sun < low.sun * 0.25);
  assert.ok(cloud.fill > noon.fill);
});

check('full-night lighting, moon, exposure and atmosphere remain byte-identical', () => {
  for (const degrees of [-90, -30, -12, -7]) for (const overcastT of [0, 0.5, 1]) {
    const e = environment(degrees, { overcastT }), before = structuredClone(e);
    assert.deepEqual(applyArchitecturalDaylight(e), before);
  }
});

check('illumination never changes geometry, sun direction, haze, exposure or cloud shape', () => {
  const mutable = new Set(['keyColor', 'fillColor', 'groundColor', 'sunTint', 'fill', 'environment']);
  for (const degrees of [-6, 0, 6, 20, 60]) {
    const e = environment(degrees), before = structuredClone(e);
    applyArchitecturalDaylight(e);
    for (const key of Object.keys(e)) if (!mutable.has(key)) assert.deepEqual(e[key], before[key], key);
  }
});

check('continuous finite response through sunrise, weather and sunset', () => {
  for (const overcastT of [0, 0.5, 1]) for (const fogT of [0, 0.5, 1]) {
    let previous;
    for (let degree = -90; degree <= 90; degree += 0.02) {
      const e = corrected(degree, { overcastT, fogT });
      for (const [key, value] of Object.entries(e)) for (const n of Array.isArray(value) ? value : [value]) {
        assert.ok(Number.isFinite(n), key);
      }
      for (const color of [e.keyColor, e.fillColor, e.groundColor]) assert.ok(color.every(n => n >= 0 && n <= 1));
      if (previous) for (let i = 0; i < 3; i++) assert.ok(Math.abs(e.keyColor[i] - previous.keyColor[i]) < 0.004);
      previous = e;
    }
  }
});

// The actual frame writer must use the correction, not only the pure helper.
const { updateCinemaFrame, CINEMA_UNIFORMS } = await import('../lib/fly/cinema-frame.js');
const { useFlyStore } = await import('../stores/fly-store.js');
check('Enhanced frame publishes the corrected key; Classic and Neon retain their renderer', () => {
  const runtime = { sun: { sinEl: 0.8, az: 1.2 }, weather: { wx: {} }, flight: { latDeg: 40, pos: { x: 0, y: 700, z: 0 } }, origin: { anchor: { x: 0, z: 0 } } };
  useFlyStore.setState({ mapStyle: 'satellite', visuals: 'enhanced' });
  const e = updateCinemaFrame(runtime, useFlyStore.getState());
  assert.ok(e.keyColor[2] / e.keyColor[0] >= 0.9);
  assert.deepEqual(CINEMA_UNIFORMS.uCinemaKeyColor.value.toArray(), e.keyColor);
  for (const [mapStyle, visuals] of [['satellite', 'classic'], ['toy', 'enhanced']]) {
    useFlyStore.setState({ mapStyle, visuals });
    assert.equal(updateCinemaFrame(runtime, useFlyStore.getState()), null);
  }
});
const { applyPhysicalSky } = await import('../lib/fly/atmosphere/runtime.js');
check('physical atmosphere retains authority over the solar spectrum and intensity', () => {
  for (const degrees of [3, 15, 45, 80]) {
    const runtime = { flight: { pos: { y: 700 } } };
    const before = applyPhysicalSky(environment(degrees), runtime);
    const after = applyPhysicalSky(corrected(degrees), runtime);
    assert.deepEqual(after.keyColor, before.keyColor);
    assert.equal(after.sun, before.sun);
    assert.ok(after.fill > before.fill);
  }
});
delete globalThis.window;
console.log(`${passed} architectural daylight checks passed`);
