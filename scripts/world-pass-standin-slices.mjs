/** REACH slice equivalence and atomic-publication gate. No GPU or network.
 * The original synchronous merge/drape/photo/geometry helpers are the oracle;
 * fake frame time proves yielding and cancellation without timing thresholds.
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(import.meta.dirname, '..');
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
const { createStandInPreparation, advanceStandInPreparation } = await import('../lib/fly/toy-world/sat-stand-in-prep.js');
const { mergeStandInParts, drapeStandIns, createStandInGeometry } = await import('../lib/fly/toy-world/sat-stand-ins.js');
const { applyPhoto, loadPhoto } = await import('../lib/fly/toy-world/sat-stand-in-photo-core.js');
const { SatSkylineEngine } = await import('../lib/fly/toy-world/sat-skyline-engine.js');
const { createStandInPhotos, createPhotoAtlas } = await import('../lib/fly/toy-world/sat-stand-in-photo.js');
const { SAT_SKYLINE } = await import('../lib/fly/fly-constants.js');
const { resetWpFrameSlice, wpSliceMayRun, wpSliceSpend } = await import('../lib/fly/toy-world/wp-frame-slice.js');
const { noteFinalizeFrame } = await import('../lib/fly/finalize-pace.js');
let pass = 0;
const check = (name, run) => { run(); pass++; console.log(`PASS ${name}`); };
const bytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const equalArray = (a, b, name) => {
  assert.equal(a.constructor, b.constructor, `${name} array type`);
  assert.ok(bytes(a).equals(bytes(b)), `${name} bytes differ`);
};
const equalGeometry = (a, b) => {
  assert.deepEqual(Object.keys(a.attributes), Object.keys(b.attributes));
  for (const key of Object.keys(a.attributes)) {
    equalArray(a.attributes[key].array, b.attributes[key].array, key);
    assert.equal(a.attributes[key].normalized, b.attributes[key].normalized);
    assert.equal(a.attributes[key].itemSize, b.attributes[key].itemSize);
  }
  equalArray(a.index.array, b.index.array, 'index');
  assert.deepEqual(a.boundingSphere, b.boundingSphere);
  assert.equal(a.instanceCount, b.instanceCount);
};
function partsOf(count, perPart) {
  const parts = [];
  for (let p = 0; p < count; p++) {
    const n = typeof perPart === 'function' ? perPart(p) : perPart;
    const si = { n, pos: new Float32Array(n * 2), dim: new Float32Array(n * 4),
      col: new Uint8Array(n * 8), size: new Float32Array(n) };
    if (p % 2) si.gnd = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      // Repeated keys exercise merge ties. Values cross quantization bounds,
      // wrap yaw in both directions and clamp photo/drape coordinates.
      si.size[i] = 500 - Math.floor(i / 3) * 0.25;
      si.pos[i * 2] = Math.sin(i * 3 + p) * 18000;
      si.pos[i * 2 + 1] = Math.cos(i * 7 - p) * 18000;
      si.dim.set([i % 1001 + 0.001, (i * 3) % 1200 + 0.0003, (i * 17 + p) % 1500, i * 0.17 - 90], i * 4);
      for (let c = 0; c < 8; c++) si.col[i * 8 + c] = (i * 71 + p * 33 + c * 17) % 256;
      if (si.gnd) for (let c = 0; c < 4; c++) si.gnd[i * 4 + c] = (i * 91 + p * 3 + c * 27) % 256;
    }
    parts.push({ si, dx: (p % 4 - 1.5) * 2300.1, dz: (Math.floor(p / 4) - 1.5) * 2300.1 });
  }
  return parts;
}
const gridN = SAT_SKYLINE.drapeGridN * 2;
const grid = Float32Array.from({ length: (gridN + 1) ** 2 }, (_, i) => Math.sin(i / 7) * 200 - 20);
const photo = { n: 512, alb: Uint8Array.from({ length: 512 * 512 * 4 }, (_, i) => (i * 71 + Math.floor(i / 2048) * 11) % 256) };
const gspan = 2 * Math.PI * 6378137 / 2 ** 14 * 4;
for (const [name, parts, alb, slot, radius] of [
  ['empty', [], null, -1, 1],
  ['empty parts', partsOf(16, 0), photo, 39, 1],
  ['mixed tiles, tied keys', partsOf(16, (p) => p % 3 ? 133 : 0), null, -1, 1],
  ['photo and atlas', partsOf(16, 512), photo, 7, 1],
  ['photo without atlas', partsOf(3, 259), photo, -1, 0],
]) {
  check(`sliced ${name}: exact merge, photo, drape, attributes and bounds`, () => {
    const reference = mergeStandInParts(parts);
    if (alb) applyPhoto(alb, reference.ax, reference.az, reference.n, gspan, reference.gnd, slot, radius);
    const base = drapeStandIns(reference, grid, gridN, gspan, new Float32Array(reference.n));
    const expected = createStandInGeometry(reference, base, gspan);
    const job = createStandInPreparation(parts, grid, gridN, gspan, alb, slot, radius);
    let clock = 0, frames = 0;
    while (!job.done && frames++ < 10000) advanceStandInPreparation(job, clock + 3, () => ++clock);
    assert.ok(job.done); assert.ok(frames > 1, 'the job must span fake frame deadlines');
    const actual = job.result;
    assert.equal(actual.m.n, reference.n); assert.equal(actual.m.maxH, reference.maxH);
    for (const key of ['ax', 'az', 'dim', 'wall', 'roof', 'gnd', 'size']) equalArray(actual.m[key], reference[key], key);
    equalArray(actual.baseY, base, 'ground');
    const hx = Float32Array.from({ length: reference.n }, (_, i) => Math.hypot(reference.dim[i * 4], reference.dim[i * 4 + 1]) / 65535 * 1000);
    equalArray(actual.hx, hx, 'half diagonals'); assert.ok(actual.gz.every((v) => v === 0));
    const geometry = createStandInGeometry(actual.m, actual.baseY, gspan, actual);
    equalGeometry(geometry, expected);
    assert.ok(job.bytes >= Object.values(actual.m).reduce((n, a) => n + (a?.byteLength ?? 0), 0));
    geometry.dispose(); expected.dispose();
  });
}

const originalPerformance = globalThis.performance;
let clock = 0;
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => (clock += 0.25) } });
globalThis.document = { timeline: { currentTime: 0 } };
const nextFrame = () => { document.timeline.currentTime += 16.7; noteFinalizeFrame(1 / 60); };
function pendingEngine(parts, withPhoto = false) {
  const e = new SatSkylineEngine({ groundAt: () => ({ elev: 0, tileZ: 17 }) });
  const group = { z: 14, gx: 0, gy: 0 }, key = '14/0/0';
  const chunk = { group, gen: 1, state: 'draping', mesh: null, parts };
  const p = { key, gen: 1, group, parts, grid: grid.slice(), gridZoom: new Uint8Array(grid.length).fill(17), gi: grid.length, bad: 0 };
  e.chunks.set(key, chunk); e.pendingFinalize.push(p);
  const freed = [];
  e._photos = { get: () => withPhoto ? photo : null, dispose() {}, stat: { fetched: 0, failed: 0 } };
  e._atlas = { stat: { allocMsMax: 0 }, alloc: () => 5, free: (slot) => { if (slot >= 0) freed.push(slot); }, dispose() {} };
  return { e, p, chunk, key, freed };
}
try {
  resetWpFrameSlice();
  const { e, p, chunk, key, freed } = pendingEngine(partsOf(16, 512));
  nextFrame(); e._finalizePending(1);
  check('first slice owns temporary buffers but publishes no mesh', () => {
    assert.ok(p.standInPrep); assert.equal(chunk.mesh, null); assert.equal(e.object.children.length, 0);
    assert.ok(e.stats.standInPrepBytes > 0);
  });
  let frames = 0;
  while (e.pendingFinalize.length && frames++ < 1000) {
    nextFrame(); e._finalizePending(1 + frames / 60);
    if (e.pendingFinalize.length) assert.equal(chunk.mesh, null);
  }
  check('complete preparation publishes once and releases staging ownership', () => {
    assert.ok(frames > 1 && frames < 1000); assert.equal(chunk.state, 'ready');
    assert.equal(e.object.children.length, 1); assert.equal(e.stats.standInPrepBytes, 0);
    assert.equal(chunk._pendingStandIns, null); assert.equal(p.standInPrep, null);
  });

  e._photos.get = () => photo;
  e._photoArrived.push(key);
  const beforePhoto = chunk.standIns.gnd.array, beforeCopy = beforePhoto.slice();
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => ++clock } });
  nextFrame(); e._patchPhotos(10);
  check('partial photo patch leaves resident attribute and fade unchanged', () => {
    assert.ok(e._photoPatch); assert.equal(chunk.standIns.gnd.array, beforePhoto);
    equalArray(beforePhoto, beforeCopy, 'unpublished photo bytes');
    assert.equal(chunk.standIns.slot, -1); assert.equal(e._photoRamps.size, 0);
    assert.equal(e.stats.standInPhotoPatchBytes, beforePhoto.byteLength);
  });
  for (let i = 0; e._photoPatch && i < 100; i++) { nextFrame(); e._patchPhotos(11 + i); }
  check('photo patch swaps complete slot bytes and starts the original fade', () => {
    const S = chunk.standIns;
    assert.equal(e._photoPatch, null); assert.equal(S.slot, 5); assert.notEqual(S.gnd.array, beforePhoto);
    for (let i = 0; i < S.n; i++) {
      for (let c = 0; c < 3; c++) assert.equal(S.gnd.array[i * 4 + c], beforeCopy[i * 4 + c]);
      assert.equal(S.gnd.array[i * 4 + 3], 6);
    }
    assert.equal(e._photoK[5], 0); assert.ok(e._photoRamps.has(5));
    e._stepPhotoRamps(e._photoRamps.get(5) + e._reachCfg.photo.fadeSec);
    assert.equal(e._photoK[5], 1); assert.equal(e.stats.standInPhotoPatchBytes, 0);
  });
  const patchChunk = { standIns: { slot: -1, n: chunk.standIns.n, gnd: chunk.standIns.gnd.clone() } };
  const patchBefore = patchChunk.standIns.gnd.array;
  e.chunks.set('patch-cancel', patchChunk);
  e._atlas.alloc = () => 6;
  e._photoArrived.push('patch-cancel');
  nextFrame(); e._patchPhotos(30);
  assert.ok(e._photoPatch);
  e._evict('patch-cancel', patchChunk);
  check('eviction cancels a partial photo patch without mutating resident bytes', () => {
    assert.equal(e._photoPatch, null); assert.equal(patchChunk.standIns.gnd.array, patchBefore);
    assert.equal(patchChunk.standIns.slot, -1); assert.ok(freed.includes(6));
    assert.equal(e.stats.standInPhotoPatchBytes, 0);
  });
  e.dispose(); assert.ok(freed.includes(5));

  resetWpFrameSlice();
  const cancelled = pendingEngine(partsOf(16, 512), true);
  nextFrame(); cancelled.e._finalizePending(1);
  cancelled.e._evict(cancelled.key, cancelled.chunk);
  nextFrame(); cancelled.e._finalizePending(2);
  check('eviction cancels partial geometry and frees its reserved atlas slot', () => {
    assert.deepEqual(cancelled.freed, [5]); assert.equal(cancelled.p.standInPrep, null);
    assert.equal(cancelled.e.object.children.length, 0); assert.equal(cancelled.e.pendingFinalize.length, 0);
  });
  cancelled.e.dispose();

  // ARRIVAL has a frame every <= HOLD+1 requests even while REACH has work.
  resetWpFrameSlice();
  const fair = pendingEngine(partsOf(16, 1024));
  let arrivalFrames = 0, reachFrames = 0;
  for (let i = 0; i < 40; i++) {
    nextFrame();
    if (wpSliceMayRun()) { wpSliceSpend(2.5); arrivalFrames++; }
    const before = fair.p.standInPrep?.steps ?? 0;
    fair.e._finalizePending(i / 60);
    if ((fair.p.standInPrep?.steps ?? before) > before) reachFrames++;
  }
  check('REACH preparation retains the shared allowance fairness', () => {
    assert.ok(arrivalFrames >= 10, `ARRIVAL frames ${arrivalFrames}`);
    assert.ok(reachFrames >= 5, `REACH frames ${reachFrames}`);
  });
  fair.e.dispose();
} finally {
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: originalPerformance });
  delete globalThis.document;
}
// Drive the real store without a provider, and count admissions across ticks.
{
  const requests = [], ready = [];
  let now = 0;
  const savedWorker = globalThis.Worker;
  globalThis.Worker = class {
    postMessage(message) { requests.push({ owner: this, message }); }
    terminate() { this.terminated = true; }
  };
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
  const photos = createStandInPhotos({ maxInFlight: 1 }, key => ready.push(key));
  const entry = key => ({ key, pz: 12, px: 1, py: 2 });
  const answer = async (r, alb) => {
    r.owner.onmessage?.({ data: { id: r.message.id, n: 1, alb } });
    await new Promise(resolve => setImmediate(resolve));
  };
  try {
    photos.want([entry('a'), entry('stale')]);
    await answer(requests[0], null);
    photos.want([entry('a')]);
    assert.equal(requests.length, 1);
    now = 5001;
    photos.want([entry('a')]);assert.equal(requests[1].message.cfg.retry, true);
    await answer(requests[1], new Uint8Array(4));
    photos.want([entry('a'), entry('old')]);
    photos.cancel();
    assert.ok(requests[2].owner.terminated);
    photos.want([entry('destination')]);
    await answer(requests[2], new Uint8Array(4));
    await answer(requests[3], new Uint8Array(4));
    assert.deepEqual(ready, ['a', 'destination']);
    assert.equal(photos.stat.failed, 1);
    check('failed photos retry with backoff, completion starts no stale work, and warps cancel old requests', () => {
      assert.ok(photos.get('a'));assert.equal(photos.get('old'), null);
    });

    const engine = new SatSkylineEngine({ groundAt: () => null });
    const atlas = createPhotoAtlas(1, 1, 4000);
    const cached = { n: 1, alb: new Uint8Array(4) };
    const slot = atlas.alloc(cached);
    const S = { n: 1, slot: -1, gnd: { array: new Uint8Array(4) } };
    engine.chunks.set('a', { group: { z: 14, gx: 0, gy: 0 }, standIns: S });
    const admissions = [];
    engine._photos = { get: () => cached, want: (list, budget) => admissions.push([list[0].key, budget]), cancel() {}, dispose() {} };
    engine._atlas = atlas;engine.building = 2;
    engine.setPhotoGate(() => false);engine._pumpPhotos(0);
    assert.equal(admissions.length, 0);
    engine.setPhotoGate(() => 'busy');
    engine._photoArrived.push('a');engine._patchPhotos(1);
    assert.equal(S.slot, -1);
    atlas.free(slot);
    now += 3999;engine._pumpPhotos(2);assert.equal(admissions.length, 0);
    now += 2;engine._pumpPhotos(4);engine._pumpPhotos(4.5);
    assert.deepEqual(admissions, [['a', 1]]);assert.deepEqual(engine._photoArrived, ['a']);
    engine._patchPhotos(5);
    check('boot holds all requests, streaming admits one group, and a cached photo attaches after quarantine', () => {
      assert.equal(S.slot, 0);assert.equal(S.gnd.array[3], 1);
    });
    let disposedTextures = 0;
    atlas.texture.addEventListener('dispose', () => { disposedTextures++; });
    engine.dispose();
    assert.equal(disposedTextures, 1);
  } finally {
    photos.dispose();
    globalThis.Worker = savedWorker;
    Object.defineProperty(globalThis, 'performance', { configurable: true, value: originalPerformance });
  }
}
{
  const saved = { fetch: globalThis.fetch, OffscreenCanvas: globalThis.OffscreenCanvas, createImageBitmap: globalThis.createImageBitmap };
  const controller = new AbortController();
  const e = { pz: 12, px: 1, py: 1 };
  let aborted = 0, closed = 0;
  try {
    globalThis.fetch = async (_url, { signal }) => ({
      ok: true, blob: () => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { aborted++; reject(signal.reason); }, { once: true });
      }),
    });
    const pending = loadPhoto(e, 1, {}, controller.signal);
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    assert.equal(await pending, null);assert.equal(aborted, 4);
    globalThis.fetch = async () => new Response(new Uint8Array(3072));
    globalThis.createImageBitmap = async () => ({ close() { closed++; } });
    globalThis.OffscreenCanvas = class { getContext() { throw Error('context lost'); } };
    await assert.rejects(loadPhoto(e, 1), /context lost/);
    check('cancellation aborts four pending bodies and a canvas failure releases every decoded bitmap', () => {
      assert.equal(closed, 4);
    });
  } finally { Object.assign(globalThis, saved); }
}
console.log(`\n${pass} passed`);
