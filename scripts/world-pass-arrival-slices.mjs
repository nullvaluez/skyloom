/** ARRIVAL within-run progress and water admission regression gate.
 * Actual engine methods, fake frame clock, no renderer/network/worker threads.
 * Optional red calibration: --root=.graphics-review/world-performance/before-dev
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootArg = process.argv.find((arg) => arg.startsWith('--root='));
const root = path.resolve(rootArg?.slice(7) || path.join(import.meta.dirname, '..'));
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) specifier = pathToFileURL(path.join(root, specifier.slice(2))).href;
  if (specifier.startsWith('.') || specifier.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL);
    if (existsSync(fileURLToPath(url) + '.js')) return next(url.href + '.js', context);
  }
  return next(specifier, context);
} });
globalThis.window = { location: { search: '' }, matchMedia: () => ({ matches: false }),
  __flyWorldPassTierOverride: { preset: 'ultra', mobile: false }, __flyFinalizePaceOverride: { enabled: false } };
const load = (file) => import(pathToFileURL(path.join(root, file)).href);
const { SatBuildingEngine } = await load('lib/fly/toy-world/sat-building-engine.js');
const { WPQ_POS_K } = await load('lib/fly/toy-world/wp-quant.js');
const { resetWpFrameSlice, wpWholeFinalize } = await load('lib/fly/toy-world/wp-frame-slice.js');
const { noteFinalizeFrame } = await load('lib/fly/finalize-pace.js');

let passed = 0, failed = 0, clock = 0;
const realPerformance = globalThis.performance;
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => clock } });
globalThis.document = { timeline: { currentTime: 1 } };
const check = (name, run) => {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack}`); }
};
const bytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const equalArray = (a, b) => {
  assert.equal(a.constructor, b.constructor);
  assert.ok(bytes(a).equals(bytes(b)), 'typed-array bytes differ');
};
function engine(on = true) {
  const e = new SatBuildingEngine({ groundAt: () => ({ elev: 10, tileZ: 15 }) });
  if (on) e._arr = { ...e._arr, on: true, uploads: true, drapeCap: true, footings: true,
    cfg: { honestZ: 14, finalizeSliceMs: 2.5, uploadBudgetMB: 24, finalizePerFrame: 4 } };
  return e;
}

// A giant first run, a small run, another boundary-crossing run, an empty run
// and a tail exercise resumes, run boundaries, bounds and contact metadata.
function fixture(mode) {
  const count = [20003, 7, 4099, 0, 19], nR = count.length;
  const start = new Uint32Array(nR + 1);
  for (let i = 0; i < nR; i++) start[i + 1] = start[i] + count[i];
  const q = mode === 'quantized', stride = q ? 4 : 3;
  const pos = q ? new Int16Array(start[nR] * stride) : new Float32Array(start[nR] * stride);
  const ax = Float64Array.from(count, (_, i) => i * 12.5 - 20);
  const az = Float64Array.from(count, (_, i) => i * -3.25 + 9);
  const prep = { runMinY: new Float32Array(nR).fill(-1.25), runMaxY: new Float32Array(nR).fill(63.125),
    runR: new Float32Array(nR).fill(25.75), footStart: new Uint32Array([0, 3, 3, 6, 6, 6]) };
  if (q) prep.posQ = true;
  for (let r = 0; r < nR; r++) for (let v = start[r]; v < start[r + 1]; v++) {
    pos[v * stride] = q ? (v % 40 - 20) * 16 : ax[r] + (v % 40 - 20) * 0.31;
    pos[v * stride + 1] = q ? v % 1031 - 20 : (v % 1031 - 20) / 16;
    pos[v * stride + 2] = q ? (v % 23 - 11) * 16 : az[r] + (v % 23 - 11) * 0.27;
    if (q) pos[v * stride + 3] = 32767;
  }
  const p = { runs: { count: nR, start, ax, az }, g: new Float64Array([100000, 80.123, -100000, 75, 90]),
    gz: new Uint8Array([15, 13, 15, 15, 15]), fb: new Uint8Array([0, 0, 1, 0, 0]) };
  const bld = { pos, ...(mode === 'fallback' ? {} : { prep }) };
  // Independent expected buffer: one typed-array write per original vertex.
  // Float32 rounding happens at that write; lattice clamp limits are explicit.
  const expected = pos.slice(), offsets = Array.from(p.g);
  if (q) {
    const oy = 80;
    for (let r = 0; r < nR; r++) offsets[r] = Math.max(-32747, Math.min(31757, Math.round((p.g[r] - oy) * WPQ_POS_K)));
  }
  for (let r = 0; r < nR; r++) for (let v = start[r]; v < start[r + 1]; v++) expected[v * stride + 1] += offsets[r];
  return { p, bld, expected, offsets, stride };
}
const output = (s) => Object.fromEntries(['r', 'walked', 'q', 'colX', 'colZ', 'colTop', 'colR', 'drapeRuns',
  'unsettled', 'oversize', 'bx0', 'bx1', 'by0', 'by1', 'bz0', 'bz1'].map((key) => [key, s[key]]));
for (const mode of ['quantized', 'prepared float', 'fallback']) {
  check(`${mode}: first giant run yields before publishing its record`, () => {
    const e = engine(), f = fixture(mode), before = f.bld.pos.slice();
    const s = e._runWalkBegin(f.p, f.bld, 100.25, -19.75);
    assert.equal(e._runWalkStep(s, f.p, f.bld, -1), false);
    assert.equal(s.r, 0); assert.equal(s.drapeRuns[0], undefined);
    assert.equal(s.colTop[0], 0);
    equalArray(f.bld.pos.subarray(0, 4096 * f.stride), f.expected.subarray(0, 4096 * f.stride));
    equalArray(f.bld.pos.subarray(4096 * f.stride), before.subarray(4096 * f.stride));
    e.dispose();
  });
  check(`${mode}: resumed bytes, bounds, columns and footings equal an uninterrupted walk`, () => {
    const e = engine(), f = fixture(mode), full = fixture(mode);
    const s = e._runWalkBegin(f.p, f.bld, 100.25, -19.75);
    const whole = e._runWalkBegin(full.p, full.bld, 100.25, -19.75);
    assert.equal(e._runWalkStep(whole, full.p, full.bld, Infinity), true);
    let calls = 0;
    do {
      const before = f.bld.pos.slice();
      e._runWalkStep(s, f.p, f.bld, -1);
      let changed = 0;
      for (let i = 1; i < before.length; i += f.stride) if (before[i] !== f.bld.pos[i]) changed++;
      assert.ok(changed <= 4096, `one slice touched ${changed} vertices`);
      assert.ok(++calls < 100);
    } while (!s.walked);
    assert.ok(calls > 4);
    equalArray(f.bld.pos, f.expected);
    equalArray(f.bld.pos, full.bld.pos);
    assert.deepEqual(output(s), output(whole));
    assert.equal(s.unsettled, 2); assert.equal(s.oversize, 1);
    assert.equal(s.drapeRuns[2].fb, true);
    if (mode !== 'fallback') assert.equal(s.drapeRuns[0].footing, true);
    if (mode === 'quantized') {
      assert.equal(s.q.clamped, 2, 'clamps count once per run, not once per slice');
      assert.equal(s.q.oy, 80);
      assert.deepEqual(s.drapeRuns.map((run) => run.gq), f.offsets);
    }
    e.dispose();
  });
}
check('empty run set finishes with no vertex or contact records', () => {
  const e = engine(), f = { runs: { count: 0, start: new Uint32Array(1), ax: [], az: [] }, g: [], gz: [] };
  const bld = { pos: new Float32Array() }, s = e._runWalkBegin(f, bld, 0, 0);
  assert.equal(e._runWalkStep(s, f, bld, -1), true);
  assert.deepEqual(s.drapeRuns, []); e.dispose();
});

function frame() {
  document.timeline.currentTime++;
  clock = 0; noteFinalizeFrame(1 / 60);
}
function waterEngine(on = true, n = 1) {
  const e = engine(on);
  e.waterEnabled = true;
  for (let i = 0; i < n; i++) {
    const key = `water-${i}`, tile = { x: 8192 + i, y: 8192, z: 14 };
    const water = { pos: new Float32Array([0, 0, 0, 100, 0, 0, 100, 0, 100, 0, 0, 100]),
      uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), idx: new Uint16Array([0, 1, 2, 0, 2, 3, 0, 0, 1]) };
    e.chunks.set(key, { state: 'draping', tile });
    e._waterKeys.add(key);
    e.pendingFinalize.push({ key, tile, result: { satWater: water } });
  }
  const attach = e._attachWater;
  e._attachWater = function(chunk, water) {
    attach.call(this, chunk, water); // Real shoreline/filter/normals/bounds/samples.
    clock += 7; // Deterministic measured cost, independent of host speed.
  };
  return e;
}
check('water-only tile yields to a REACH reservation and resumes next frame', () => {
  resetWpFrameSlice(); frame(); const e = waterEngine();
  assert.equal(wpWholeFinalize(), true);
  e._finalizePending(10);
  assert.equal(e.pendingFinalize.length, 1);
  assert.equal(e.chunks.get('water-0').state, 'draping');
  assert.equal(e.object.children.length, 0);
  frame(); e._finalizePending(11);
  assert.equal(e.pendingFinalize.length, 0);
  assert.equal(e.chunks.get('water-0').state, 'ready');
  assert.equal(e.chunks.get('water-0').readyAt, 11);
  assert.ok(e.chunks.get('water-0').waterSamples.length);
  e.dispose();
});
check('water-only work spends the shared allowance and reports its cost', () => {
  resetWpFrameSlice(); frame(); const e = waterEngine();
  e._finalizePending(10);
  assert.equal(e._wp.frameWorst.water, 7);
  assert.equal(e._wp.frameWorst.rest, 0);
  assert.equal(e._stepEst.commit, 7);
  assert.equal(wpWholeFinalize(), false, 'REACH must not stack after water');
  e.dispose();
});
check('water-only commits respect the slice deadline and cannot starve', () => {
  resetWpFrameSlice(); frame(); const e = waterEngine(true, 2);
  e._finalizePending(10);
  assert.equal(e.pendingFinalize.length, 1);
  assert.equal(e.chunks.get('water-1').state, 'draping');
  frame(); e._finalizePending(11);
  assert.equal(e.pendingFinalize.length, 0, 'expensive commit progresses in a fresh frame');
  e.dispose();
});
check('water accompanying a building contributes to shared frame cost', () => {
  resetWpFrameSlice(); frame(); const e = waterEngine();
  const p = e.pendingFinalize[0];
  p.ready = true; p.result.satBuilding = { anchor: new Float32Array(), pos: new Float32Array() };
  // Isolate the surrounding commit/accounting from already-tested building prep.
  e._prefinalizeArrival = () => true;
  e._finalizeArrival = () => { clock += 1; };
  e._finalizePending(10);
  assert.equal(e._wp.frameWorst.fin, 1);
  assert.equal(e._wp.frameWorst.water, 7);
  assert.equal(e._wp.frameWorst.rest, 0);
  assert.equal(e._stepEst.commit, 8);
  assert.equal(wpWholeFinalize(), false);
  e.dispose();
});
check('ARRIVAL off keeps water admission and exact geometry unchanged', () => {
  resetWpFrameSlice(); frame(); const off = waterEngine(false), on = waterEngine(true);
  assert.equal(wpWholeFinalize(), true);
  off._finalizePending(10);
  assert.equal(off.pendingFinalize.length, 0, 'flag-off does not consult the new admission');
  assert.equal(off._stepEst, undefined);
  frame(); on._finalizePending(10);
  const a = off.chunks.get('water-0'), b = on.chunks.get('water-0');
  assert.deepEqual(Object.keys(a.water.geometry.attributes), Object.keys(b.water.geometry.attributes));
  for (const key of Object.keys(a.water.geometry.attributes)) equalArray(a.water.geometry.attributes[key].array, b.water.geometry.attributes[key].array);
  assert.deepEqual(a.water.geometry.index, b.water.geometry.index);
  assert.deepEqual(a.water.geometry.boundingSphere, b.water.geometry.boundingSphere);
  assert.deepEqual(a.waterSamples, b.waterSamples);
  assert.equal(a.waterY, b.waterY); assert.equal(a.water.renderOrder, b.water.renderOrder);
  off.dispose(); on.dispose();
});
Object.defineProperty(globalThis, 'performance', { configurable: true, value: realPerformance });
delete globalThis.document;
console.log(`\n${passed} PASS / ${failed} FAIL`);
if (failed) process.exitCode = 1;
