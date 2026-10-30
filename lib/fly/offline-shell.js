/**
 * SHIP PASS RL-8 (OFFLINE_SHELL) — registers public/sw.js, or removes it.
 *
 *   - flag ON, production build: register `/sw.js` (scope '/') once the page
 *     has loaded and the main thread is idle, so the first minute's streaming
 *     never competes with it; then hand the worker the first-party static
 *     files THIS visit already loaded (the Next chunks the title shell needs),
 *     so one visit is enough for an offline launch to show the title.
 *   - flag OFF (the kill switch): retire, unregister any Skyloom worker and
 *     delete its `skyloom-shell-*` caches, so turning the flag off in a release
 *     really takes the worker out of every returning player's browser.
 *   - development never registers (hot reload and a caching worker fight).
 *   - automation (navigator.webdriver) registers only when the flag is pinned
 *     on explicitly (`?flags=OFFLINE_SHELL`, i.e. `__flyOfflineShellOverride`):
 *     the harness fleet routes provider requests through Playwright, which a
 *     worker would sit in front of. scripts/verify-offline-shell.cjs pins it.
 * What the worker may cache is decided in public/sw.js (`shellCacheable`), the
 * one allowlist; scripts/verify-ship-release.mjs (W) runs it in a VM.
 */
import { shipPassOn } from './ship-pass';

export const SW_URL = '/sw.js';
export const SHELL_CACHE_PREFIX = 'skyloom-shell-';
/** At most this many already-loaded URLs are offered to the worker per visit. */
const WARM_MAX = 400;

function explicitPin() {
  return globalThis.window?.__flyOfflineShellOverride?.enabled === true;
}

/** What this page load should do: 'register' | 'unregister' | 'skip'. */
export function offlineShellAction({ on = shipPassOn('OFFLINE_SHELL'), production = process.env.NODE_ENV === 'production', webdriver = globalThis.navigator?.webdriver === true, pinned = explicitPin(), supported = !!globalThis.navigator?.serviceWorker } = {}) {
  if (!supported) return 'skip';
  if (!on) return 'unregister';
  if (!production) return 'skip';
  if (webdriver && !pinned) return 'skip';
  return 'register';
}

/**
 * Same-origin URLs this page has already fetched (scripts, styles, resource
 * timing entries). The worker filters them through its own allowlist, so this
 * list may be generous.
 */
export function warmUrls(doc = globalThis.document, perf = globalThis.performance, origin = globalThis.location?.origin) {
  const out = new Set();
  const add = (u) => {
    try {
      const url = new URL(u, origin);
      if (url.origin === origin) out.add(url.href);
    } catch {
      // not a URL
    }
  };
  try {
    for (const s of doc?.scripts ?? []) if (s.src) add(s.src);
    for (const l of doc?.querySelectorAll?.('link[rel="stylesheet"],link[rel="preload"],link[rel="modulepreload"]') ?? []) if (l.href) add(l.href);
    for (const e of perf?.getEntriesByType?.('resource') ?? []) add(e.name);
  } catch {
    // a DOM without these lists offers nothing
  }
  return [...out].slice(0, WARM_MAX);
}

/** Run `fn` after the load event, in an idle period (bounded by a timeout). Returns a cancel. */
export function whenIdle(fn, { timeout = 10000 } = {}) {
  const w = globalThis.window;
  if (!w) return () => {};
  let cancelled = false;
  let idleId = null;
  let timer = null;
  const run = () => {
    if (!cancelled) fn();
  };
  const go = () => {
    if (cancelled) return;
    if (w.requestIdleCallback) idleId = w.requestIdleCallback(run, { timeout });
    else timer = setTimeout(run, 2000);
  };
  if (w.document?.readyState === 'complete') go();
  else w.addEventListener('load', go, { once: true });
  return () => {
    cancelled = true;
    w.removeEventListener('load', go);
    if (idleId != null) w.cancelIdleCallback?.(idleId);
    if (timer) clearTimeout(timer);
  };
}

/** Ask a worker to stop answering and caching (public/sw.js 'retire'); resolves on its ack or after 2 s. */
function retireWorker(worker) {
  if (!worker || typeof MessageChannel !== 'function') return Promise.resolve(false);
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(false), 2000);
    ch.port1.onmessage = () => {
      clearTimeout(t);
      resolve(true);
    };
    try {
      worker.postMessage({ type: 'retire' }, [ch.port2]);
    } catch {
      clearTimeout(t);
      resolve(false);
    }
  });
}

/** Apply the action. Never throws; resolves to what it did. */
export async function syncOfflineShell(action = offlineShellAction()) {
  try {
    const sw = navigator.serviceWorker;
    if (action === 'register') {
      await sw.register(SW_URL, { scope: '/' });
      // Resources this visit loaded before the worker controlled the page:
      // offer them, so the title shell is complete in the cache after one visit.
      const ready = await sw.ready;
      ready.active?.postMessage({ type: 'warm', urls: warmUrls() });
      return 'registered';
    }
    if (action === 'unregister') {
      const regs = await sw.getRegistrations();
      let n = 0;
      for (const r of regs) {
        const url = r.active?.scriptURL || r.waiting?.scriptURL || r.installing?.scriptURL || '';
        if (new URL(url, location.href).pathname !== SW_URL) continue;
        // Retire first: an unregistered worker still serves this page, and
        // would re-create the caches deleted below.
        await retireWorker(r.active);
        if (await r.unregister()) n++;
      }
      if (globalThis.caches) for (const k of await caches.keys()) if (k.startsWith(SHELL_CACHE_PREFIX)) await caches.delete(k);
      return n ? 'unregistered' : 'none';
    }
  } catch {
    // a blocked or unsupported worker never stops the game
  }
  return 'skipped';
}
