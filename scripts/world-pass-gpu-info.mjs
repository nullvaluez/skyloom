/** Early GPU detection ownership gate. Fake worker/GL/timers only: never
 * creates a hardware context, launches Chrome, or runs the device benchmark.
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') || specifier.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL);
    if (existsSync(fileURLToPath(url) + '.js')) return next(url.href + '.js', context);
  }
  return next(specifier, context);
} });
const { cachedGpuInfo, readGpuInfo, gpuClass } = await import('../lib/fly/device-class.js');
const { prepareGpuInfo, adoptGpuContext, cancelGpuInfoPreparation } = await import('../lib/fly/gpu-info-prewarm.js');
const original = Object.fromEntries(['window', 'document', 'Worker', 'OffscreenCanvas', 'setTimeout', 'clearTimeout'].map((key) => [key, globalThis[key]]));
const RTX = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 5080, Direct3D11)';
const RTX_NEXT = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 5090, Direct3D11)';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0 Safari/537.36';
const originalDateNow = Date.now;
const workers = [], timers = [];
let probes = 0, lost = 0, passes = 0;
const check = (name, run) => { run(); passes++; console.log(`PASS ${name}`); };
function gl(renderer = RTX) {
  const listeners = new Map();
  return { VENDOR: 1, RENDERER: 2, canvas: {
    listeners,
    addEventListener(type, fn, options) { listeners.set(type, { fn, once: options?.once }); },
    removeEventListener(type, fn) { if (listeners.get(type)?.fn === fn) listeners.delete(type); },
    dispatch(type) { const event = listeners.get(type); if (event?.once) listeners.delete(type); event?.fn(); },
  },
    getExtension(name) { return name === 'WEBGL_debug_renderer_info' ? { UNMASKED_VENDOR_WEBGL: 3, UNMASKED_RENDERER_WEBGL: 4 } : name === 'WEBGL_lose_context' ? { loseContext: () => lost++ } : null; },
    getParameter(key) { return key === 1 || key === 3 ? 'vendor' : renderer; },
  };
}
class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
class ProbeWorker {
  constructor() { this.messages = []; this.terminated = false; workers.push(this); }
  postMessage(data) { this.messages.push(data); }
  terminate() { this.terminated = true; }
  reply(data = { type: 'gpu-info', ok: true, vendor: 'NVIDIA', renderer: RTX }) { this.onmessage?.({ data }); }
}
function page({ storage = new MemoryStorage(), ua = UA, platform = 'Win32', coarse = false } = {}) {
  cancelGpuInfoPreparation();
  const listeners = new Map();
  globalThis.window = {
    localStorage: storage, navigator: { userAgent: ua, platform }, matchMedia: () => ({ matches: coarse }),
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    dispatch(type) { listeners.get(type)?.(); }, listeners,
  };
  globalThis.Worker = ProbeWorker;
  globalThis.OffscreenCanvas = class {};
  globalThis.document = { createElement() { probes++; return { getContext: () => gl() }; } };
  return window;
}
try {
  globalThis.setTimeout = (fn, ms) => { const timer = { fn, ms, cancelled: false }; timers.push(timer); return timer; };
  globalThis.clearTimeout = (timer) => { if (timer) timer.cancelled = true; };
  page();
  const first = prepareGpuInfo(), duplicate = prepareGpuInfo();
  const worker = workers.at(-1);
  check('concurrent/StrictMode starts share one probe without a main-thread context', () => {
    assert.equal(first, duplicate); assert.equal(workers.length, 1); assert.equal(probes, 0);
    assert.deepEqual(worker.messages, [{ type: 'probe' }]);
  });
  worker.reply();
  const info = await first;
  check('successful probe primes policy reads while retaining its context', () => {
    assert.equal(info.renderer, RTX); assert.equal(gpuClass(readGpuInfo().renderer).cls, 'high');
    for (let i = 0; i < 10; i++) assert.equal(readGpuInfo().renderer, RTX);
    assert.equal(probes, 0); assert.equal(worker.terminated, false);
    assert.equal(window.__flyStats.gpuInfoProbe.source, 'worker');
    assert.equal(window.localStorage.values.size, 0, 'worker identity must never persist');
  });
  const actual = gl('Actual canvas renderer');
  adoptGpuContext(actual);
  check('actual canvas is authoritative and releases all temporary ownership', () => {
    assert.equal(readGpuInfo().renderer, 'Actual canvas renderer');
    assert.equal(worker.terminated, true); assert.equal(window.listeners.size, 0);
    assert.ok(timers.every((timer) => timer.cancelled));
  });
  assert.equal((await prepareGpuInfo()).renderer, 'Actual canvas renderer');
  adoptGpuContext({ getContext: () => gl('Renderer wrapper context') });
  check('Three renderer wrapper refreshes authority from its native context', () => {
    assert.equal(readGpuInfo().renderer, 'Renderer wrapper context');
    assert.equal(probes, 0);
  });

  page();
  const cancelled = prepareGpuInfo(), cancelWorker = workers.at(-1), beforeCancel = probes;
  window.dispatch('pagehide'); cancelWorker.reply();
  assert.equal(await cancelled, null);
  check('page exit cancels without probing synchronously or accepting late replies', () => {
    assert.equal(cancelWorker.terminated, true); assert.equal(probes, beforeCancel);
    assert.equal(cachedGpuInfo(), null); assert.equal(window.listeners.size, 0);
  });

  page();
  const failed = prepareGpuInfo(), failedWorker = workers.at(-1), beforeFailure = probes;
  failedWorker.reply({ type: 'gpu-info', ok: false, renderer: '' });
  assert.equal((await failed).renderer, RTX);
  check('failed worker answer does not poison the synchronous fallback', () => {
    assert.equal(failedWorker.terminated, true); assert.equal(probes, beforeFailure + 1);
    assert.equal(readGpuInfo().renderer, RTX); assert.equal(probes, beforeFailure + 1);
    assert.equal(window.__flyStats.gpuInfoProbe.source, 'main-worker-unavailable');
    assert.equal(window.localStorage.values.size, 0, 'throwaway fallback is not real-canvas authority');
  });

  page(); globalThis.Worker = undefined;
  const beforeUnsupported = probes;
  await prepareGpuInfo(); await prepareGpuInfo(); readGpuInfo();
  check('unsupported worker platform keeps the existing detection once', () => {
    assert.equal(probes, beforeUnsupported + 1);
    assert.equal(window.__flyStats.gpuInfoProbe.source, 'main-unsupported');
    assert.equal(lost, 2);
  });

  page();
  const timedOut = prepareGpuInfo(), timeoutWorker = workers.at(-1), beforeTimeout = probes;
  const timeout = timers.at(-1);
  check('probe allows thirty seconds before bounded fallback', () => assert.equal(timeout.ms, 30000));
  timeout.fn(); await timedOut;
  check('timeout terminates the worker before fallback and leaves no listener', () => {
    assert.equal(timeoutWorker.terminated, true); assert.equal(probes, beforeTimeout + 1);
    assert.equal(window.listeners.size, 0);
  });

  page();
  const orphaned = prepareGpuInfo(), orphanWorker = workers.at(-1);
  orphanWorker.reply(); await orphaned;
  const orphan = timers.at(-1); assert.equal(orphan.ms, 60000); orphan.fn();
  check('failed app mount cannot retain a probe worker indefinitely', () => {
    assert.equal(orphanWorker.terminated, true); assert.equal(readGpuInfo().renderer, RTX);
    assert.equal(window.listeners.size, 0);
  });

  page();
  const errored = prepareGpuInfo(), errorWorker = workers.at(-1);
  let prevented = false;
  errorWorker.onerror({ preventDefault: () => { prevented = true; } });
  await errored;
  check('worker load/CSP errors release resources and use the fallback', () => {
    assert.equal(prevented, true); assert.equal(errorWorker.terminated, true);
    assert.equal(readGpuInfo().renderer, RTX);
  });

  const replies = [], options = [];
  const workerContext = vm.createContext({ self: { postMessage: (data) => replies.push(data) },
    OffscreenCanvas: class { getContext(type, config) { options.push([type, config]); return gl(); } } });
  vm.runInContext(readFileSync(new URL('../lib/fly/gpu-info.worker.js', import.meta.url), 'utf8'), workerContext);
  workerContext.self.onmessage({ data: { type: 'probe' } });
  check('worker performs the probe with the flight canvas GPU preference', () => {
    assert.equal(replies[0].renderer, RTX); assert.equal(replies[0].ok, true);
    assert.equal(options[0][0], 'webgl2'); assert.equal(options[0][1].powerPreference, 'high-performance');
    assert.equal(options[0][1].antialias, false);
  });

  // Returning-page cache tests share storage, while replacing the page scope.
  // No worker result alone can establish the persistent identity lease.
  let now = 1000000;
  Date.now = () => now;
  function seed(storage = new MemoryStorage()) {
    page({ storage });
    const context = gl();
    adoptGpuContext(context);
    assert.equal(storage.values.size, 1);
    const [key, raw] = [...storage.values][0];
    return { storage, context, key, raw };
  }
  const remembered = seed(), beforeReturningWorkers = workers.length, beforeReturningProbes = probes;
  page({ storage: remembered.storage });
  const returning = await prepareGpuInfo();
  check('returning page reuses real desktop GPU identity with no worker or context', () => {
    assert.equal(returning.renderer, RTX);
    assert.equal(workers.length, beforeReturningWorkers); assert.equal(probes, beforeReturningProbes);
    assert.equal(window.__flyStats.gpuInfoProbe.source, 'browser-cache');
    assert.equal(window.__flyStats.gpuInfoProbe.released, true);
    assert.equal(window.listeners.size, 0);
    const entry = JSON.parse(remembered.raw);
    assert.equal(entry.expiresAt - entry.observedAt, 10 * 60 * 1000);
  });
  now += 50;
  adoptGpuContext({ getContext: () => gl(RTX_NEXT) });
  check('native renderer replaces the returning-page identity and refreshes its lease', () => {
    assert.equal(readGpuInfo().renderer, RTX_NEXT);
    const fresh = JSON.parse(remembered.storage.getItem(remembered.key));
    assert.equal(fresh.info.renderer, RTX_NEXT); assert.equal(fresh.observedAt, now);
  });
  remembered.storage.setItem(remembered.key, remembered.raw);
  const authoritative = await prepareGpuInfo();
  check('stale browser entry cannot overwrite native authority on the same page', () => {
    assert.equal(authoritative.renderer, RTX_NEXT);
    assert.equal(readGpuInfo().renderer, RTX_NEXT);
    assert.equal(workers.length, beforeReturningWorkers);
  });
  for (const renderer of ['NVIDIA GeForce RTX 4080 SUPER', 'NVIDIA GeForce GTX 1080 Ti']) {
    const storage = new MemoryStorage();
    page({ storage }); adoptGpuContext(gl(renderer)); page({ storage });
    const before = workers.length, reused = await prepareGpuInfo();
    check(`desktop product reuse includes ${renderer}`, () => {
      assert.equal(reused.renderer, renderer); assert.equal(workers.length, before);
      assert.equal(window.__flyStats.gpuInfoProbe.source, 'browser-cache');
    });
  }

  page();
  const racing = prepareGpuInfo(), lateWorker = workers.at(-1);
  adoptGpuContext(gl(RTX_NEXT)); lateWorker.reply();
  const raced = await racing;
  check('late probe cannot replace newly adopted native or persistent identity', () => {
    assert.equal(raced.renderer, RTX_NEXT); assert.equal(readGpuInfo().renderer, RTX_NEXT);
    assert.equal(lateWorker.terminated, true);
    assert.equal(JSON.parse([...window.localStorage.values.values()][0]).info.renderer, RTX_NEXT);
  });

  async function rejectCache(name, mutate = (entry) => entry, options = {}) {
    const fixture = seed();
    const altered = mutate(JSON.parse(fixture.raw));
    fixture.storage.setItem(fixture.key, typeof altered === 'string' ? altered : JSON.stringify(altered));
    page({ storage: fixture.storage, ...options });
    const before = workers.length, pending = prepareGpuInfo();
    check(name, () => {
      assert.equal(workers.length, before + 1, 'invalid cache must start the ordinary worker path');
      assert.equal(cachedGpuInfo(), null); assert.equal(fixture.storage.values.size, 0);
    });
    cancelGpuInfoPreparation(); await pending;
  }
  await rejectCache('expired identity is discarded', (entry) => ({ ...entry, observedAt: now - 600000, expiresAt: now }));
  await rejectCache('future clock or rollback cannot extend an identity lease', (entry) => ({ ...entry, observedAt: now + 1, expiresAt: now + 600001 }));
  await rejectCache('unsupported cache schema is discarded', (entry) => ({ ...entry, version: 2 }));
  await rejectCache('tampered long expiry is discarded', (entry) => ({ ...entry, expiresAt: now + 600001 }));
  await rejectCache('browser version change invalidates identity', (entry) => entry, { ua: UA.replace('138.0', '139.0') });
  await rejectCache('platform change invalidates identity', (entry) => entry, { platform: 'Linux x86_64' });
  await rejectCache('coarse touch never reuses desktop identity', (entry) => entry, { coarse: true });
  await rejectCache('malformed JSON is discarded', () => '{');
  await rejectCache('oversized storage input is discarded before parsing', () => 'x'.repeat(2049));
  await rejectCache('software renderer cannot be injected through a cached record', (entry) => ({ ...entry, info: { vendor: 'Google', renderer: 'SwiftShader' } }));

  for (const renderer of [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Laptop GPU, Direct3D11)',
    'NVIDIA GeForce GTX 1080 Max-Q', 'NVIDIA GeForce GTX 980M',
    'NVIDIA Mobile GeForce RTX 4080', 'ANGLE (Google, SwiftShader)',
    'NVIDIA GeForce', 'Apple GPU', 'AMD Radeon RX 7900 XTX',
  ]) {
    const fixture = seed();
    adoptGpuContext(gl(renderer));
    check(`actual ${renderer} clears the desktop lease`, () => {
      assert.equal(fixture.storage.values.size, 0); assert.equal(readGpuInfo().renderer, renderer);
    });
  }
  const workerStorage = new MemoryStorage();
  page({ storage: workerStorage });
  const software = prepareGpuInfo();
  workers.at(-1).reply({ type: 'gpu-info', ok: true, vendor: 'Google', renderer: 'SwiftShader' });
  await software;
  check('software worker answer is page-local and retains the existing class policy', () => {
    assert.equal(gpuClass(readGpuInfo().renderer).cls, 'low');
    assert.equal(workerStorage.values.size, 0);
  });
  page({ storage: workerStorage });
  const workerAgain = prepareGpuInfo(), workerAgainCount = workers.length;
  workers.at(-1).reply(); await workerAgain;
  adoptGpuContext(null);
  check('a missing real context cannot persist the cached probe identity', () => {
    assert.equal(workerStorage.values.size, 0); assert.equal(workers.length, workerAgainCount);
  });

  page();
  Object.defineProperty(window, 'localStorage', { get() { throw Error('storage denied'); } });
  const restricted = prepareGpuInfo(), restrictedWorker = workers.at(-1);
  restrictedWorker.reply(); await restricted;
  adoptGpuContext(gl());
  check('denied storage retains successful worker detection and cleanup', () => {
    assert.equal(readGpuInfo().renderer, RTX); assert.equal(restrictedWorker.terminated, true);
  });
  const quota = seed();
  quota.storage.setItem = () => { throw Error('quota'); };
  adoptGpuContext(gl(RTX_NEXT));
  check('failed native cache write removes older identity without changing authority', () => {
    assert.equal(quota.storage.values.size, 0); assert.equal(readGpuInfo().renderer, RTX_NEXT);
  });
  const lostIdentity = seed();
  lostIdentity.context.canvas.dispatch('webglcontextlost');
  check('real context loss invalidates its persistent identity', () => assert.equal(lostIdentity.storage.values.size, 0));
  const oldContext = seed(), newContext = gl();
  adoptGpuContext(newContext);
  oldContext.context.canvas.dispatch('webglcontextlost');
  check('losing an older context cannot erase a newer canvas lease', () => assert.equal(oldContext.storage.values.size, 1));
  adoptGpuContext(newContext);
  check('repeated adoption keeps only one context-loss listener', () => assert.equal(newContext.canvas.listeners.size, 1));
  newContext.canvas.dispatch('webglcontextlost');
  assert.equal(oldContext.storage.values.size, 0);
} finally {
  cancelGpuInfoPreparation();
  Date.now = originalDateNow;
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
}
console.log(`\n${passes} passed`);
