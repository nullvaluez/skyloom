import assert from 'node:assert/strict';
import { AtmosphereLuts } from '../lib/fly/atmosphere/gpu.js';
import { atmosphereParams } from '../lib/fly/atmosphere/model.js';

const eye = { h: 1, muS: .7, maxKm: 450, nowSec: 0, aerialHz: 1, skyHz: 30 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const renderer = (parallel = true) => {
  let target = { original: true };
  const materials = new WeakMap();
  return {
    domElement: new EventTarget(), ready: false, autoClear: true, draws: [], compiles: [], polls: 0,
    extensions: { has: () => parallel }, getContext: () => ({ isContextLost: () => false }),
    properties: { get: material => materials.get(material) },
    getRenderTarget: () => target, setRenderTarget: value => { target = value; },
    compile(scene) {
      const material = scene.children[0].material;
      this.compiles.push({ material, target });
      materials.set(material, { currentProgram: { isReady: () => { this.polls++; return this.ready; } } });
      return new Set([material]);
    },
    render(scene) { this.draws.push({ material: scene.children[0].material, target }); },
  };
};
let count = 0;
const check = async (name, run) => { await run(); console.log('PASS ' + name); count++; };

await check('pending LUT links issue no draw or lookup publication and preserve renderer state', async () => {
  const luts = new AtmosphereLuts(atmosphereParams()), gl = renderer(), target = gl.getRenderTarget();
  assert.equal(luts.update(gl, eye), false);
  assert.equal(gl.draws.length, 0); assert.equal(gl.compiles.length, 4);
  assert.equal(gl.getRenderTarget(), target); assert.equal(gl.autoClear, true);
  assert.ok(Number.isNaN(luts.skyState.h)); assert.ok(Number.isNaN(luts.aerialState.h));
  for (let i = 0; i < 5; i++) assert.equal(luts.update(gl, eye), false);
  assert.equal(gl.compiles.length, 4, 'An unchanged pending batch dispatches once');
  gl.ready = true; await sleep(25);
  assert.equal(luts.update(gl, eye), true);
  const names = ['trans', 'ms', 'sky', 'aerial'];
  assert.deepEqual(gl.draws.map(draw => draw.material), names.map(name => luts.materials[name]));
  assert.deepEqual(gl.draws.map(draw => draw.target), names.map(name => luts[name]));
  assert.equal(luts.skyState.h, eye.h); assert.equal(luts.aerialState.maxKm, eye.maxKm);
  assert.equal(gl.getRenderTarget(), target); assert.equal(gl.autoClear, true);
  assert.equal(luts.update(gl, eye), false); assert.equal(gl.draws.length, 4);
  luts.setParams(atmosphereParams()); luts.update(gl, { ...eye, nowSec: 2 });
  assert.equal(gl.compiles.length, 4, 'Uniform/medium changes do not recompile'); luts.dispose();
});

await check('context restore requires a new exact batch and old completion cannot publish it', async () => {
  const luts = new AtmosphereLuts(atmosphereParams()), gl = renderer();
  luts.update(gl, eye); luts.invalidatePrograms(); luts.update(gl, eye);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(luts.programWarm.status, 'compiling'); assert.equal(gl.compiles.length, 8);
  assert.equal(gl.draws.length, 0);
  gl.ready = true; await sleep(25); luts.update(gl, eye);
  assert.equal(gl.draws.length, 4); assert.equal(luts.programWarm.status, 'ready'); luts.dispose();
});

await check('disposal cancels polling before deleting owned programs', async () => {
  const luts = new AtmosphereLuts(atmosphereParams()), gl = renderer();
  luts.update(gl, eye); luts.dispose(); const polls = gl.polls;
  await sleep(25); assert.equal(gl.polls, polls); assert.equal(gl.draws.length, 0);
  assert.equal(luts.update(gl, eye), false);
});

await check('unsupported parallel drivers retain the original four-draw path', () => {
  const luts = new AtmosphereLuts(atmosphereParams()), gl = renderer(false);
  assert.equal(luts.update(gl, eye), true); assert.equal(gl.compiles.length, 0);
  assert.equal(gl.draws.length, 4); assert.equal(luts.programWarm.status, 'unsupported'); luts.dispose();
});

console.log(`ATMOSPHERE PREWARM: ${count}/${count}`);
