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
const workers = [], timers = [];
let probes = 0, lost = 0, passes = 0;
const check = (name, run) => { run(); passes++; console.log(`PASS ${name}`); };
function gl(renderer = RTX) {
  return { VENDOR: 1, RENDERER: 2,
    getExtension(name) { return name === 'WEBGL_debug_renderer_info' ? { UNMASKED_VENDOR_WEBGL: 3, UNMASKED_RENDERER_WEBGL: 4 } : name === 'WEBGL_lose_context' ? { loseContext: () => lost++ } : null; },
    getParameter(key) { return key === 1 || key === 3 ? 'vendor' : renderer; },
  };
}
class ProbeWorker {
  constructor() { this.messages = []; this.terminated = false; workers.push(this); }
  postMessage(data) { this.messages.push(data); }
  terminate() { this.terminated = true; }
  reply(data = { type: 'gpu-info', ok: true, vendor: 'NVIDIA', renderer: RTX }) { this.onmessage?.({ data }); }
}
function page() {
  cancelGpuInfoPreparation();
  const listeners = new Map();
  globalThis.window = {
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
} finally {
  cancelGpuInfoPreparation();
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
}
console.log(`\n${passes} passed`);
