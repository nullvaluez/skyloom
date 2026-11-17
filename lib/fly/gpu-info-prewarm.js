/** Page-owned GPU detection before FlyMode or any policy reader is imported.
 * Repeated/StrictMode callers share one worker. The probe keeps the driver
 * context warm until the real canvas is ready, then releases its ownership.
 */
import { cachedGpuInfo, primeGpuInfo, readGpuInfo } from './device-class';

const PROBE_TIMEOUT_MS = 30000;
const ORPHAN_TIMEOUT_MS = 60000;
let preparation = null;

function cleanup(p) {
  clearTimeout(p.timeout);
  clearTimeout(p.orphan);
  p.worker?.terminate();
  p.worker = null;
  p.scope?.removeEventListener?.('pagehide', p.cancel);
  if (p.report) p.report.released = true;
}

/** Cancel page-owned work without creating a synchronous fallback on exit. */
export function cancelGpuInfoPreparation() {
  const p = preparation;
  if (!p) return;
  cleanup(p);
  if (!p.done) {
    p.done = true;
    if (p.report) p.report.status = 'cancelled';
    p.resolve(null);
  }
  preparation = null;
}

export function prepareGpuInfo() {
  const scope = globalThis.window;
  if (!scope) return Promise.resolve(null);
  if (preparation && preparation.scope !== scope) cancelGpuInfoPreparation();
  const cached = cachedGpuInfo();
  if (cached) return Promise.resolve(cached);
  if (preparation) return preparation.promise;

  const p = { scope, done: false, worker: null, timeout: null, orphan: null, start: performance.now() };
  p.promise = new Promise((resolve) => { p.resolve = resolve; });
  preparation = p;
  p.report = (scope.__flyStats ??= {}).gpuInfoProbe = { status: 'probing', source: null, ms: null, released: false };
  p.cancel = () => { if (preparation === p) cancelGpuInfoPreparation(); };
  scope.addEventListener?.('pagehide', p.cancel, { once: true });

  const finish = (info, source, retainWorker) => {
    if (p.done || preparation !== p) return;
    p.done = true;
    clearTimeout(p.timeout);
    primeGpuInfo(info);
    Object.assign(p.report, { status: 'ready', source, ms: Math.round(performance.now() - p.start) });
    if (retainWorker) {
      // Failed component/chunk loads must not retain the temporary context
      // indefinitely if the real canvas never mounts.
      p.orphan = setTimeout(() => cleanup(p), ORPHAN_TIMEOUT_MS);
    } else cleanup(p);
    p.resolve(info);
  };
  const fallback = (reason) => {
    if (p.done || preparation !== p) return;
    cleanup(p);
    // Unsupported worker WebGL keeps the previous detection policy. A failed
    // worker answer is never cached as an invented Medium/High verdict.
    finish(readGpuInfo(), reason, false);
  };
  if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') {
    fallback('main-unsupported');
    return p.promise;
  }
  try {
    p.worker = new Worker(new URL('./gpu-info.worker.js', import.meta.url), { type: 'module' });
    p.worker.onmessage = ({ data }) => {
      if (p.done || preparation !== p || data?.type !== 'gpu-info') return;
      if (!data.ok || typeof data.renderer !== 'string' || !data.renderer.trim()) { fallback('main-worker-unavailable'); return; }
      finish({ vendor: data.vendor, renderer: data.renderer }, 'worker', true);
    };
    p.worker.onerror = (event) => { event.preventDefault?.(); fallback('main-worker-error'); };
    // A slow driver must not be abandoned after a short UI timeout only to
    // repeat the same blocking initialization on the main thread. Thirty
    // seconds exceeds the observed 9–14 second second-page initialization.
    p.timeout = setTimeout(() => fallback('main-timeout'), PROBE_TIMEOUT_MS);
    p.worker.postMessage({ type: 'probe' });
  } catch {
    fallback('main-worker-error');
  }
  return p.promise;
}

/** FlyCanvas onCreated: the real context wins, then the temporary worker ends. */
export function adoptGpuContext(gl) {
  const info = readGpuInfo(gl?.getContext?.() ?? gl);
  const p = preparation;
  if (p) {
    cleanup(p);
    if (!p.done) {
      p.done = true;
      Object.assign(p.report, { status: 'ready', source: 'canvas', ms: Math.round(performance.now() - p.start) });
      p.resolve(info);
    }
  }
  return info;
}
