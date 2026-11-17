/** World Pass resource ownership and parked vegetation regression gate.
 * No renderer, network, or worker threads. Runs the real engine methods with a
 * photo-worker stand-in and measured flat ground. To calibrate the failure:
 *   node scripts/world-pass-lifecycle.mjs --root=.graphics-review/world-performance/before-dev
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

globalThis.window = {
  location: { search: '' }, matchMedia: () => ({ matches: false }),
  __flyWorldPassTierOverride: { preset: 'ultra', mobile: false },
};
const workers = [];
globalThis.Worker = class PhotoWorker {
  constructor() { this.messages = []; this.terminated = false; workers.push(this); }
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply() {
    const message = this.messages.shift();
    if (message) this.onmessage?.({ data: { id: message.id, n: 512, alb: new Uint8Array(512 * 512 * 4) } });
  }
};
const load = (file) => import(pathToFileURL(path.join(root, file)).href);
const { SatSkylineEngine } = await load('lib/fly/toy-world/sat-skyline-engine.js');
const { SatVegEngine } = await load('lib/fly/toy-world/sat-veg-engine.js');
const { __resetWorldPassLatchForTests } = await load('lib/fly/world-pass.js');
const { SAT_VEG, STREAM_KEEPER } = await load('lib/fly/fly-constants.js');
const { noteFinalizeFrame } = await load('lib/fly/finalize-pace.js');
let passed = 0, failed = 0;
function check(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.log(`FAIL ${name}: ${error.message}`); }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

// React can discard the first memo construction, and replays setup/cleanup on
// the retained object. No resource belongs to the discarded construction.
const discarded = new SatSkylineEngine({ groundAt: () => null });
const skyline = new SatSkylineEngine({ groundAt: () => null });
check('discarded memo constructions create no photo worker or atlas', () => {
  assert.equal(workers.length, 0);
  assert.equal(discarded._photos, null); assert.equal(discarded._atlas, null);
  assert.equal(skyline._photos, null); assert.equal(skyline._atlas, null);
});
const api = { setDiag: () => Promise.resolve() };
skyline.setWorker(api);
const firstPhotos = skyline._photos, firstAtlas = skyline._atlas;
const firstWorker = workers.at(-1);
check('effect attachment creates one photo owner and the existing atlas size', () => {
  assert.equal(workers.length, 1);
  assert.ok(firstPhotos); assert.ok(firstAtlas);
  assert.equal(firstAtlas.texture.image.data.byteLength, 40 * 1024 * 1024);
  assert.equal(skyline._standInU.uStandInPhotos.value, firstAtlas.texture);
});
const attachedWorkers = workers.length;
skyline.setWorker(api);
check('repeated attachment is idempotent', () => {
  assert.equal(workers.length, attachedWorkers);
  assert.equal(skyline._photos, firstPhotos); assert.equal(skyline._atlas, firstAtlas);
});
firstPhotos.want([{ key: 'old', pz: 12, px: 0, py: 0 }]);
let disposedAtlas = 0;
firstAtlas.texture.addEventListener('dispose', () => { disposedAtlas++; });
skyline._photoArrived.push('stale'); skyline._photoRamps.set(0, 1); skyline._photoK[0] = 1;
skyline.dispose();
firstWorker.reply(); await flush();
check('cleanup releases photo resources and ignores late completions', () => {
  assert.equal(firstWorker.terminated, true); assert.equal(disposedAtlas, 1);
  assert.equal(skyline._photos, null); assert.equal(skyline._atlas, null);
  assert.equal(skyline._standInU.uStandInPhotos.value, null);
  assert.equal(skyline._photoArrived.length, 0); assert.equal(skyline._photoRamps.size, 0);
  assert.ok(skyline._photoK.every((v) => v === 0));
});
skyline.setWorker(api);
check('StrictMode effect replay attaches fresh resources and restores fades', () => {
  assert.equal(workers.length, attachedWorkers + 1);
  assert.notEqual(skyline._photos, firstPhotos); assert.notEqual(skyline._atlas, firstAtlas);
  assert.equal(skyline._hardEvict, false);
});
skyline._photos.want([{ key: 'replay', pz: 12, px: 0, py: 0 }]);
workers.at(-1).reply(); await flush();
check('photo completion works after effect replay', () => {
  assert.ok(skyline._photos.get('replay'));
  assert.deepEqual(skyline._photoArrived, ['replay']);
});
skyline.dispose(); discarded.dispose();
check('all attached photo workers terminate on final teardown', () => {
  assert.ok(workers.every((w) => w.terminated));
});

window.__flyWorldReachOverride = { enabled: false };
__resetWorldPassLatchForTests();
const beforeOff = workers.length;
const offSkyline = new SatSkylineEngine({ groundAt: () => null });
offSkyline.setWorker(api); offSkyline.dispose();
check('REACH off never allocates photo resources', () => assert.equal(workers.length, beforeOff));

for (const groundOn of [false, true]) {
  window.__flyWorldGroundOverride = { enabled: groundOn };
  __resetWorldPassLatchForTests();
  const veg = new SatVegEngine({ groundAt: () => ({ elev: 120, tileZ: 17 }), maxChunks: 2 });
  const requests = [];
  veg.setWorker({ buildTile: (...args) => { requests.push(args); return new Promise(() => {}); } });
  // Limit the fixture to two desired tiles in both arms. This changes the
  // fixture size, not either engine's sampling or parking implementation.
  veg.ringChunks = 2; veg.ringR = SAT_VEG.ring.r;
  veg._refreshDesired(0, 0, 0, 0);
  const tiles = veg.queue.slice(0, 2);
  assert.equal(tiles.length, 2);
  const world = 2 * Math.PI * 6378137;
  const chunks = tiles.map((tile, i) => {
    const span = world / 2 ** tile.z;
    const c = { key: `${tile.z}/${tile.x}/${tile.y}`, tile, span,
      cx: -world / 2 + (tile.x + 0.5) * span, cz: -world / 2 + (tile.y + 0.5) * span,
      state: i ? 'ready' : 'sampling', veg: new Float32Array([0, 0, 5, 0]), readyAt: 0,
      canopy: groundOn ? {} : null, coarse: false, wpGridAt: 0, regridSec: 60 };
    if (i) c.grid = new Float32Array((SAT_VEG.gridSegments + 1) ** 2).fill(120);
    veg.chunks.set(c.key, c); return c;
  });
  const readyGrid = chunks[1].grid;
  const partial = { key: chunks[0].key, chunk: chunks[0], regrid: false,
    grid: new Float32Array((SAT_VEG.gridSegments + 1) ** 2).fill(120),
    gridZoom: new Uint8Array((SAT_VEG.gridSegments + 1) ** 2).fill(17), gi: 1, miss: 0, coarse: 0 };
  veg.pendingSample.push(partial);
  if (groundOn) {
    chunks[1].wpBusy = true;
    veg.wpPending.push({ key: chunks[1].key, chunk: chunks[1], grid: null, gi: 0 });
  }
  assert.equal(STREAM_KEEPER.parkVeg, true);
  veg.update(10, 0, 0, SAT_VEG.cullAglOffM + 100);
  check(`GROUND ${groundOn ? 'on' : 'off'}: parking keeps jobs and pauses sampling`, () => {
    assert.equal(veg._parked, true); assert.ok(veg.pendingSample.includes(partial));
    assert.equal(partial.gi, 1); assert.equal(veg.nearest(0, 0).length, 0);
    assert.equal(requests.length, 0);
    if (groundOn) { assert.equal(veg.wpPending.length, 1); assert.equal(veg.wpPending[0].gi, 0); }
  });
  for (let i = 0; i < 20; i++) {
    noteFinalizeFrame(1 / 60);
    veg.update(20 + i / 60, 0, 0, 0);
  }
  check(`GROUND ${groundOn ? 'on' : 'off'}: descent finishes retained jobs without rebuilding ready tiles`, () => {
    assert.equal(chunks[0].state, 'ready'); assert.equal(veg.pendingSample.length, 0);
    assert.equal(chunks[1].grid, readyGrid); assert.equal(requests.length, 0);
    if (groundOn) { assert.ok(chunks[1].wpGrid); assert.equal(chunks[1].wpBusy, false); }
  });
  if (groundOn) {
    chunks[1].wpBusy = true;
    veg.wpPending.push({ key: chunks[1].key, chunk: chunks[1], grid: null, gi: 0 });
  }
  veg.dispose();
  check(`GROUND ${groundOn ? 'on' : 'off'}: teardown clears pending grids`, () => {
    assert.equal(veg.pendingSample.length, 0); assert.equal(veg.wpPending.length, 0);
    if (groundOn) assert.equal(chunks[1].wpBusy, false);
  });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
