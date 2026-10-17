import assert from 'node:assert/strict';
import { compileSceneAsync } from '../lib/fly/compile-scene-safe.js';
import { createRoomWarmLifecycle } from '../lib/fly/lounge/room-lifecycle.mjs';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let count = 0;
const check = async (name, run) => { await run(); count++; console.log('PASS ' + name); };
const driver = () => {
  let ready = false, lost = false, polls = 0, dispatches = 0, propertiesReads = 0;
  const material = {}, program = { isReady() { polls++; return ready; } }, canvas = new EventTarget();
  const gl = { domElement: canvas, getContext: () => ({ isContextLost: () => lost }), extensions: { has: () => true },
    compile() { dispatches++; return new Set([material]); }, properties: { get() { propertiesReads++; return { currentProgram: program }; } } };
  return { gl, material, done: () => { ready = true; }, lose() { lost = true; canvas.dispatchEvent(new Event('webglcontextlost')); },
    counts: () => ({ polls, dispatches, propertiesReads }) };
};
await check('dispatch and real readiness polling occur without disabling shader diagnostics', async () => {
  const d = driver(), scene = {}, job = compileSceneAsync(d.gl, scene, {});
  assert.deepEqual(d.counts(), { polls: 1, dispatches: 1, propertiesReads: 1 });
  d.done(); assert.equal(await job, scene); assert.equal(d.counts().propertiesReads, 1);
});
await check('context loss rejects and stops polling before renderer properties can be replaced', async () => {
  const d = driver(), job = compileSceneAsync(d.gl, {}, {}), rejected = assert.rejects(job, error => error.code === 'WEBGL_CONTEXT_LOST');
  d.lose(); await rejected; const before = d.counts();
  d.gl.properties.get = () => { throw Error('retired renderer table'); };
  await delay(25); assert.deepEqual(d.counts(), before);
});
await check('compile dispatch and readiness errors are observable rejections', async () => {
  const d = driver(); d.gl.compile = () => { throw Error('dispatch failure'); };
  await assert.rejects(compileSceneAsync(d.gl, {}, {}), /dispatch failure/);
  const e = driver(); e.gl.properties.get = () => ({ currentProgram: { isReady() { throw Error('readiness failure'); } } });
  await assert.rejects(compileSceneAsync(e.gl, {}, {}), /readiness failure/);
});
await check('unmount invalidates callbacks but keeps material owners until every poll settles', async () => {
  const gate = createRoomWarmLifecycle(), a = deferred(), b = deferred(); let updates = 0, disposed = false;
  gate.run(() => Promise.allSettled([a.promise, b.promise]), () => updates++);
  const released = gate.deactivate(() => { disposed = true; });
  a.resolve(); await Promise.resolve(); assert.equal(disposed, false);
  b.resolve(); await released; assert.equal(disposed, true); assert.equal(updates, 0);
});
await check('late completion recovers readiness after a degraded reveal without hiding the room', async () => {
  let time = 1; const gate = createRoomWarmLifecycle({ now: () => time }), job = deferred();
  gate.run(() => job.promise); gate.bypass('explicit-reduced');
  assert.equal(gate.canShow(), true); assert.equal(gate.state.status, 'bypassed');
  time = 20; job.resolve(); await gate.afterPending();
  assert.equal(gate.state.status, 'ready'); assert.equal(gate.state.readyAt, 20);
  assert.equal(gate.state.bypassReason, 'explicit-reduced');
  gate.reset('retry', { preserveReveal: true }); assert.equal(gate.canShow(), true, 'A retry cannot hide a room already released explicitly');
});
await check('a past bypass cannot reveal unprepared context or newly mounted generations', async () => {
  const gate = createRoomWarmLifecycle();
  gate.bypass('cap'); await gate.run(() => Promise.resolve());
  gate.reset('context-lost'); assert.equal(gate.canShow(), false);
  assert.equal(gate.state.bypassReason, 'cap', 'Historical arrival evidence remains available');
  gate.bypass('explicit-reduced'); gate.activate(); assert.equal(gate.canShow(), false);
  gate.reset('texture-bake'); assert.equal(gate.canShow(), false);
});
await check('failed work remains retryable and obsolete context completion cannot certify new work', async () => {
  const gate = createRoomWarmLifecycle(), old = deferred(), next = deferred();
  gate.run(() => old.promise); gate.reset('context-restored'); gate.run(() => next.promise);
  old.resolve(); await Promise.resolve(); assert.equal(gate.state.status, 'compiling');
  next.reject(Error('compile failed')); await gate.afterPending(); assert.equal(gate.state.status, 'failed');
  gate.reset('retry'); await gate.run(() => Promise.resolve()); assert.equal(gate.state.status, 'ready');
});
await check('StrictMode remount prevents an old lease from disposing the reused resource', async () => {
  const gate = createRoomWarmLifecycle(), old = deferred(); let disposals = 0;
  gate.run(() => old.promise); const released = gate.deactivate(() => disposals++);
  gate.activate(); old.resolve(); await released; assert.equal(disposals, 0);
  await gate.run(() => Promise.resolve()); await gate.deactivate(() => disposals++); assert.equal(disposals, 1);
});
console.log(`ROOM PROGRAM LIFECYCLE: ${count}/${count}`);
