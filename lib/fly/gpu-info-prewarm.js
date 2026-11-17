/** Page-owned GPU detection before FlyMode or any policy reader is imported.
 * Repeated/StrictMode callers share one worker. The probe keeps the driver
 * context warm until the real canvas is ready, then releases its ownership.
 */
import { cachedGpuInfo, primeGpuInfo, readGpuInfo } from './device-class';

const PROBE_TIMEOUT_MS = 30000;
const ORPHAN_TIMEOUT_MS = 60000;
const IDENTITY_KEY = 'skyloom.gpu-identity.v1';
const IDENTITY_VERSION = 1;
const IDENTITY_TTL_MS = 10 * 60 * 1000;
const IDENTITY_MAX_BYTES = 2048;
const contextLossListeners = new WeakMap();
let identitySequence = 0;
let preparation = null;

function browserStamp(scope) {
  const nav = scope.navigator;
  const ua = nav?.userAgent, platform = nav?.platform;
  if (typeof ua !== 'string' || !ua || ua.length > 512 || typeof platform !== 'string' || platform.length > 128) return null;
  return { ua, platform };
}

function reusableIdentity(info, stamp, scope) {
  if (!stamp || !/Windows NT/i.test(stamp.ua) || !/^Win/i.test(stamp.platform)) return false;
  if (scope.matchMedia?.('(pointer: coarse)')?.matches) return false;
  if (typeof info?.vendor !== 'string' || !info.vendor || info.vendor.length > 256 ||
      typeof info.renderer !== 'string' || info.renderer.length > 512) return false;
  // Start with identifiable Windows desktop GeForce products. Mobile/ambiguous
  // strings and software contexts keep the worker path. UA + renderer cannot
  // positively rule out every hybrid GPU; the short lease and real-canvas
  // refresh bound staleness without changing the session's tier policy.
  return /NVIDIA/i.test(`${info.vendor} ${info.renderer}`) &&
    /\bGeForce\s+(?:RTX|GTX)\s+\d{3,4}\b/i.test(info.renderer) &&
    !/Laptop|Mobile|Max-Q|(?:RTX|GTX)\s+\d{3,4}M\b|SwiftShader|llvmpipe|softpipe|Software|Microsoft Basic/i.test(info.renderer);
}

function removeBrowserIdentity(scope, expected) {
  try {
    const storage = scope.localStorage;
    if (expected === undefined || storage?.getItem(IDENTITY_KEY) === expected) storage?.removeItem(IDENTITY_KEY);
  } catch { /* Storage restrictions must never block flight. */ }
}

function readBrowserIdentity(scope) {
  let raw;
  try {
    raw = scope.localStorage?.getItem(IDENTITY_KEY);
    if (!raw) return null;
    if (raw.length > IDENTITY_MAX_BYTES) throw Error('oversized GPU identity');
    const entry = JSON.parse(raw), stamp = browserStamp(scope), now = Date.now();
    if (entry?.version !== IDENTITY_VERSION || !stamp || entry.ua !== stamp.ua || entry.platform !== stamp.platform ||
        !Number.isFinite(entry.observedAt) || entry.observedAt > now ||
        entry.expiresAt !== entry.observedAt + IDENTITY_TTL_MS || now >= entry.expiresAt ||
        !reusableIdentity(entry.info, stamp, scope)) throw Error('stale GPU identity');
    return entry.info;
  } catch {
    if (raw) removeBrowserIdentity(scope, raw);
    return null;
  }
}

/** Persist only identity read from the actual flight context, never a probe. */
function rememberCanvasIdentity(scope, context, info) {
  if (!scope) return;
  try {
    const stamp = browserStamp(scope);
    if (typeof context?.getParameter !== 'function' || typeof context?.getExtension !== 'function' ||
        !reusableIdentity(info, stamp, scope) || context.isContextLost?.()) {
      removeBrowserIdentity(scope);
      return;
    }
    const observedAt = Date.now();
    const raw = JSON.stringify({ version: IDENTITY_VERSION, ...stamp, observedAt,
      expiresAt: observedAt + IDENTITY_TTL_MS, info,
      // Distinguish successive real contexts, even with identical identity and
      // clock time: losing an older context must not erase a newer lease.
      token: `${observedAt}:${++identitySequence}:${Math.random()}` });
    if (raw.length > IDENTITY_MAX_BYTES) { removeBrowserIdentity(scope); return; }
    scope.localStorage?.setItem(IDENTITY_KEY, raw);
    const canvas = context?.canvas;
    if (canvas?.addEventListener) {
      const old = contextLossListeners.get(canvas);
      if (old) canvas.removeEventListener?.('webglcontextlost', old);
      const lost = () => removeBrowserIdentity(scope, raw);
      contextLossListeners.set(canvas, lost);
      canvas.addEventListener('webglcontextlost', lost, { once: true });
    }
  } catch {
    // A newly observed context must not leave an older GPU identity behind
    // when storage becomes read-only or its quota is exhausted.
    removeBrowserIdentity(scope);
  }
}

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
  const started = performance.now();
  const remembered = readBrowserIdentity(scope);
  if (remembered) {
    const info = primeGpuInfo(remembered);
    (scope.__flyStats ??= {}).gpuInfoProbe = {
      status: 'ready', source: 'browser-cache', ms: Math.round(performance.now() - started), released: true,
    };
    return Promise.resolve(info);
  }

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
  const context = gl?.getContext?.() ?? gl;
  const info = readGpuInfo(context);
  rememberCanvasIdentity(globalThis.window, context, info);
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
