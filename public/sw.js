/* SHIP PASS RL-8 (OFFLINE_SHELL) — Skyloom's service worker.
 *
 * Caches FIRST-PARTY STATIC ASSETS only, so a warm boot reads them from disk
 * and an offline launch still shows the title shell:
 *   - Next's content-hashed build output (/_next/static/…): cache first;
 *   - the game's own static files (models, materials, HDRIs, textures, fonts,
 *     audio, runway and atlas data, icons, share and journey art):
 *     stale-while-revalidate;
 *   - page navigations: network first, the cached shell when offline.
 * It NEVER caches /api/* (live traffic, weather, registry, entitlements),
 * provider tiles or anything cross-origin: those requests are not touched.
 * Caches are versioned (CACHE below); an activate drops every older version.
 * Registered by lib/fly/offline-shell.js in production only, behind
 * OFFLINE_SHELL; with the flag off that module unregisters this worker and
 * deletes its caches (the kill switch).
 */
const VERSION = 'v1';
const CACHE = `skyloom-shell-${VERSION}`;
const SHELL = '/';
const STATIC_PREFIXES = ['/models/', '/materials/', '/hdri/', '/textures/', '/fonts/', '/audio/', '/data/', '/atlas/', '/icons/', '/og/', '/adventures/', '/splash/'];
const STATIC_FILES = ['/manifest.json', '/logo.webp'];
// The kill switch (lib/fly/offline-shell.js, flag off) retires this worker
// before unregistering it: an unregistered worker keeps serving the pages it
// already controls, and any caches.open() would re-create the cache the page
// just deleted. Retired, it answers nothing and stores nothing. (If the
// browser restarts it mid-page, the next page load's kill switch deletes the
// caches again, and that load is no longer controlled.)
let retired = false;

/** 'immutable' | 'static' | 'shell' | null — which strategy a request gets (null: not ours). */
function shellCacheable(url, origin, mode, method) {
  if (method !== 'GET') return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin !== origin) return null; // provider tiles, ADS-B, weather, analytics: never
  const p = u.pathname;
  if (p.startsWith('/api/') || p === '/api') return null; // live data: never
  if (p === '/sw.js') return null;
  if (p.startsWith('/_next/static/')) return 'immutable';
  if (STATIC_FILES.includes(p) || STATIC_PREFIXES.some((x) => p.startsWith(x))) return 'static';
  if (mode === 'navigate' && (p === '/' || p === '')) return 'shell';
  return null;
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('skyloom-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page offers what it loaded before this worker controlled it (the first
// visit's Next chunks and static files: lib/fly/offline-shell.js warmUrls()).
// Each URL passes the same allowlist as a live request; one fetch at a time,
// and only what the cache does not hold yet.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === 'retire') {
    retired = true;
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith('skyloom-shell-')).map((k) => caches.delete(k))))
        .catch(() => {})
        .then(() => event.ports && event.ports[0] && event.ports[0].postMessage('retired')),
    );
    return;
  }
  if (retired || !data || data.type !== 'warm' || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter((u) => typeof u === 'string').slice(0, 400)
    .filter((u) => { const k = shellCacheable(u, self.location.origin, 'cors', 'GET'); return k === 'immutable' || k === 'static'; });
  event.waitUntil(caches.open(CACHE).then(async (c) => {
    for (const u of urls) {
      try {
        if (await c.match(u)) continue;
        const res = await fetch(u, { credentials: 'same-origin' });
        if (res.status === 200 && res.type === 'basic') await c.put(u, res);
      } catch {
        // offline or gone: the live fetch handler fills it later
      }
    }
  }));
});

self.addEventListener('fetch', (event) => {
  if (retired) return; // the network, untouched
  const req = event.request;
  const kind = shellCacheable(req.url, self.location.origin, req.mode, req.method);
  if (!kind || req.headers.has('range')) return; // not ours (or a ranged media read): the network, untouched
  if (kind === 'immutable') {
    event.respondWith(
      caches.open(CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.status === 200 && res.type === 'basic') c.put(req, res.clone()).catch(() => {});
        return res;
      }))),
    );
    return;
  }
  if (kind === 'static') {
    event.respondWith(
      caches.open(CACHE).then((c) => c.match(req).then((hit) => {
        const live = fetch(req).then((res) => {
          if (res.status === 200 && res.type === 'basic') c.put(req, res.clone()).catch(() => {});
          return res;
        });
        if (hit) {
          event.waitUntil(live.catch(() => {}));
          return hit;
        }
        return live;
      })),
    );
    return;
  }
  // shell: network first, the cached title shell offline
  event.respondWith(
    fetch(req).then((res) => {
      if (res.status === 200 && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(SHELL, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.open(CACHE).then((c) => c.match(SHELL)).then((hit) => hit || Response.error())),
  );
});
