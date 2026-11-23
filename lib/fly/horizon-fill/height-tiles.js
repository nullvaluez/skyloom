/**
 * HORIZON FILL (FLY_HORIZON_FILL.md, stream A DATA): the height-tile source.
 *
 * Fetches the padded z11 GHS-BUILT-H height tiles (130 x 130 codes, 16,900
 * bytes; lib/fly/city-height-grid.mjs) from /api/city-height for the fill
 * worker. Plain module: no `window`, no flags, no three. Every collaborator is
 * injected, so the node gate drives it with a fake fetch, a fake Cache API and
 * a fake clock.
 *
 *   const src = createHeightTiles({ fetchImpl, cachesImpl, config, now })
 *   src.get(tx, ty)      -> Promise<Uint8Array | null>   never rejects
 *   src.peek(tx, ty)     -> Uint8Array | null             memory only, no side effects
 *   src.prefetch(list)   [[tx, ty], ...] nearest first; returns the number started
 *   src.stats()          counters
 *
 * Three caches: a memory LRU of decoded tiles (config.data.memoryTiles), the
 * Cache API across sessions (config.data.cacheName, trimmed to cacheTiles,
 * keyed by the single-tile URL), and the route's immutable HTTP caching.
 * In-flight requests are deduplicated; at most maxInFlight network requests
 * run at once; a get() jumps the queue ahead of prefetches. When more than one
 * tile is queued and config.data.batch > 0, up to `batch` tiles go in one
 * request (the batched route, framing below). HTTP 429 or a per-tile "busy"
 * retries after retrySec.busy; any other failure after retrySec.failed; until
 * then get() resolves null at once (the chunk is "missing"). tx wraps modulo
 * 2048; ty outside [0, 2048) resolves null.
 *
 * BATCH FRAMING (shared with app/api/city-height/route.js through
 * lib/fly/city-height-source.mjs):
 *   request   GET /api/city-height?v=1&tiles=tx.ty,tx.ty,...   1 to CITY_HEIGHT_BATCH_MAX tiles
 *   response  200 application/octet-stream:
 *     bytes 0-3   'CHB1'
 *     byte  4     n, the number of tiles requested
 *     bytes 5..   n status bytes in request order: 0 ok, 1 busy (retry soon), 2 failed
 *     then        16,900 bytes for each ok tile, in request order
 *   A batch can succeed partly. 400 for a malformed list, 429 when the server
 *   could start none of the reads.
 */
import { CITY_HEIGHT_BYTES, CITY_HEIGHT_TILES } from '../city-height-grid.mjs';

export const CITY_HEIGHT_BATCH_MAX = 16;
export const BATCH_MAGIC = [0x43, 0x48, 0x42, 0x31]; // 'CHB1'
export const BATCH_OK = 0;
export const BATCH_BUSY = 1;
export const BATCH_FAILED = 2;

const DATA_DEFAULTS = Object.freeze({
  memoryTiles: 96,
  cacheName: 'fly-horizon-fill-height-v1',
  cacheTiles: 512,
  maxInFlight: 3,
  retrySec: { busy: 3, failed: 60 },
  batch: 8,
  endpoint: '/api/city-height',
  timeoutMs: 22000,
});

/** Parse `tx.ty,tx.ty` into [[tx, ty], ...] (tx, ty in [0, 2048), no duplicates), or null. */
export function parseCityHeightTiles(text, max = CITY_HEIGHT_BATCH_MAX) {
  if (typeof text !== 'string' || text.length === 0 || text.length > max * 10) return null;
  const parts = text.split(',');
  if (parts.length < 1 || parts.length > max) return null;
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const m = /^(\d{1,4})\.(\d{1,4})$/.exec(p);
    if (!m) return null;
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (x >= CITY_HEIGHT_TILES || y >= CITY_HEIGHT_TILES) return null;
    const key = y * CITY_HEIGHT_TILES + x;
    if (seen.has(key)) return null;
    seen.add(key);
    out.push([x, y]);
  }
  return out;
}

/** The query string of a batched request. */
export function cityHeightTilesParam(list) {
  return list.map(([x, y]) => `${x}.${y}`).join(',');
}

/** entries: [{ status, bytes? }] in request order -> Uint8Array body. */
export function encodeCityHeightBatch(entries) {
  const n = entries.length;
  let ok = 0;
  for (const e of entries) if (e.status === BATCH_OK) ok++;
  const out = new Uint8Array(5 + n + ok * CITY_HEIGHT_BYTES);
  out.set(BATCH_MAGIC, 0);
  out[4] = n;
  let o = 5 + n;
  entries.forEach((e, i) => {
    const okTile = e.status === BATCH_OK && e.bytes && e.bytes.length === CITY_HEIGHT_BYTES;
    out[5 + i] = okTile ? BATCH_OK : e.status === BATCH_BUSY ? BATCH_BUSY : BATCH_FAILED;
    if (okTile) {
      out.set(e.bytes, o);
      o += CITY_HEIGHT_BYTES;
    }
  });
  return o === out.length ? out : out.slice(0, o);
}

/** body -> [{ status, bytes }] for `count` requested tiles, or null if the framing is wrong. */
export function decodeCityHeightBatch(body, count) {
  const b = body instanceof Uint8Array ? body : new Uint8Array(body);
  if (b.length < 5 || b[0] !== BATCH_MAGIC[0] || b[1] !== BATCH_MAGIC[1] || b[2] !== BATCH_MAGIC[2] || b[3] !== BATCH_MAGIC[3]) return null;
  const n = b[4];
  if (n !== count || b.length < 5 + n) return null;
  let ok = 0;
  for (let i = 0; i < n; i++) if (b[5 + i] === BATCH_OK) ok++;
  if (b.length !== 5 + n + ok * CITY_HEIGHT_BYTES) return null;
  const out = [];
  let o = 5 + n;
  for (let i = 0; i < n; i++) {
    const status = b[5 + i];
    if (status === BATCH_OK) {
      out.push({ status, bytes: b.slice(o, o + CITY_HEIGHT_BYTES) });
      o += CITY_HEIGHT_BYTES;
    } else {
      out.push({ status: status === BATCH_BUSY ? BATCH_BUSY : BATCH_FAILED, bytes: null });
    }
  }
  return out;
}

const wrapX = (tx) => ((tx % CITY_HEIGHT_TILES) + CITY_HEIGHT_TILES) % CITY_HEIGHT_TILES;

export function createHeightTiles({ fetchImpl = null, cachesImpl = null, config = {}, now = () => Date.now() } = {}) {
  const d = { ...DATA_DEFAULTS, ...(config.data ?? {}) };
  const retrySec = { ...DATA_DEFAULTS.retrySec, ...(d.retrySec ?? {}) };
  const memoryTiles = Math.max(1, d.memoryTiles | 0);
  const cacheTiles = Math.max(0, d.cacheTiles | 0);
  const maxInFlight = Math.max(1, d.maxInFlight | 0);
  const batch = Math.max(0, Math.min(CITY_HEIGHT_BATCH_MAX, d.batch | 0));
  const endpoint = d.endpoint;

  const memory = new Map(); // key -> Uint8Array (LRU: oldest first)
  const retryAt = new Map(); // key -> ms
  const pending = new Map(); // key -> Promise
  const waiters = new Map(); // key -> resolve(bytes | null) for queued network loads
  const queue = []; // keys waiting for a network slot, front first
  let active = 0;
  let cachePromise = null;
  let putsSinceTrim = 0;
  const s = {
    gets: 0, memoryHits: 0, cacheHits: 0, cacheWrites: 0, cacheErrors: 0, requests: 0, batches: 0,
    networkTiles: 0, failed: 0, busy: 0, backoffHits: 0, prefetched: 0,
  };

  const keyOf = (tx, ty) => ty * CITY_HEIGHT_TILES + tx;
  const urlOf = (key) => `${endpoint}?v=1&x=${key % CITY_HEIGHT_TILES}&y=${Math.floor(key / CITY_HEIGHT_TILES)}`;

  function remember(key, bytes) {
    memory.delete(key);
    memory.set(key, bytes);
    while (memory.size > memoryTiles) memory.delete(memory.keys().next().value);
  }

  function openCache() {
    if (!cachesImpl || !d.cacheName || cacheTiles <= 0) return Promise.resolve(null);
    if (!cachePromise) cachePromise = Promise.resolve().then(() => cachesImpl.open(d.cacheName)).catch(() => null);
    return cachePromise;
  }

  async function readCache(key) {
    const cache = await openCache();
    if (!cache) return null;
    const url = urlOf(key);
    try {
      const res = await cache.match(url);
      if (!res) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === CITY_HEIGHT_BYTES) return bytes;
      await cache.delete(url); // a corrupt entry must not poison every return visit
    } catch {
      s.cacheErrors++;
    }
    return null;
  }

  async function writeCache(key, bytes) {
    const cache = await openCache();
    if (!cache) return;
    try {
      await cache.put(urlOf(key), new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
      s.cacheWrites++;
      if (++putsSinceTrim >= 16) {
        putsSinceTrim = 0;
        const keys = await cache.keys();
        for (const k of keys.slice(0, Math.max(0, keys.length - cacheTiles))) await cache.delete(k);
      }
    } catch {
      s.cacheErrors++; // storage quotas never discard a tile already in memory
    }
  }

  function settle(key, bytes, retryKind) {
    const resolve = waiters.get(key);
    waiters.delete(key);
    if (bytes) {
      retryAt.delete(key);
      remember(key, bytes);
      s.networkTiles++;
      writeCache(key, bytes);
    } else {
      if (retryKind === 'busy') s.busy++;
      else s.failed++;
      retryAt.set(key, now() + 1000 * (retryKind === 'busy' ? retrySec.busy : retrySec.failed));
    }
    resolve?.(bytes);
  }

  async function fetchOne(keys) {
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(d.timeoutMs) : undefined;
    const single = keys.length === 1;
    const url = single
      ? urlOf(keys[0])
      : `${endpoint}?v=1&tiles=${cityHeightTilesParam(keys.map((k) => [k % CITY_HEIGHT_TILES, Math.floor(k / CITY_HEIGHT_TILES)]))}`;
    s.requests++;
    if (!single) s.batches++;
    let res;
    try {
      if (!fetchImpl) throw new Error('no fetch');
      res = await fetchImpl(url, { signal, credentials: 'same-origin', priority: 'low' });
    } catch {
      for (const k of keys) settle(k, null, 'failed');
      return;
    }
    if (!res || !res.ok) {
      const kind = res && res.status === 429 ? 'busy' : 'failed';
      try {
        await res?.body?.cancel?.();
      } catch {
        /* nothing to release */
      }
      for (const k of keys) settle(k, null, kind);
      return;
    }
    let body;
    try {
      body = new Uint8Array(await res.arrayBuffer());
    } catch {
      for (const k of keys) settle(k, null, 'failed');
      return;
    }
    if (single) {
      settle(keys[0], body.length === CITY_HEIGHT_BYTES ? body : null, 'failed');
      return;
    }
    const entries = decodeCityHeightBatch(body, keys.length);
    if (!entries) {
      for (const k of keys) settle(k, null, 'failed');
      return;
    }
    entries.forEach((e, i) => settle(keys[i], e.status === BATCH_OK ? e.bytes : null, e.status === BATCH_BUSY ? 'busy' : 'failed'));
  }

  function pump() {
    while (active < maxInFlight && queue.length > 0) {
      const n = batch > 0 ? Math.min(batch, queue.length) : 1;
      const keys = queue.splice(0, n);
      active++;
      fetchOne(keys).finally(() => {
        active--;
        pump();
      });
    }
  }

  function enqueue(key, urgent) {
    const at = queue.indexOf(key);
    if (at >= 0) {
      if (urgent && at > 0) {
        queue.splice(at, 1);
        queue.unshift(key);
      }
      return;
    }
    if (urgent) queue.unshift(key);
    else queue.push(key);
  }

  function load(key, urgent) {
    const p = (async () => {
      const cached = await readCache(key);
      if (cached) {
        s.cacheHits++;
        retryAt.delete(key);
        remember(key, cached);
        return cached;
      }
      return new Promise((resolve) => {
        waiters.set(key, resolve);
        enqueue(key, urgent);
        pump();
      });
    })()
      .catch(() => null)
      .finally(() => pending.delete(key));
    pending.set(key, p);
    return p;
  }

  function resolveKey(tx, ty) {
    if (!Number.isInteger(tx) || !Number.isInteger(ty) || ty < 0 || ty >= CITY_HEIGHT_TILES) return -1;
    return keyOf(wrapX(tx), ty);
  }

  function request(tx, ty, urgent) {
    const key = resolveKey(tx, ty);
    if (key < 0) return Promise.resolve(null);
    s.gets++;
    const hit = memory.get(key);
    if (hit) {
      s.memoryHits++;
      remember(key, hit);
      return Promise.resolve(hit);
    }
    const p = pending.get(key);
    if (p) {
      if (urgent && waiters.has(key)) enqueue(key, true);
      return p;
    }
    const until = retryAt.get(key);
    if (until !== undefined && until > now()) {
      s.backoffHits++;
      return Promise.resolve(null);
    }
    return load(key, urgent);
  }

  return {
    get(tx, ty) {
      return request(tx, ty, true);
    },
    peek(tx, ty) {
      const key = resolveKey(tx, ty);
      return key < 0 ? null : memory.get(key) ?? null;
    },
    prefetch(list) {
      let started = 0;
      if (!Array.isArray(list)) return 0;
      for (const item of list) {
        if (!Array.isArray(item)) continue;
        const key = resolveKey(item[0], item[1]);
        if (key < 0 || memory.has(key) || pending.has(key)) continue;
        const until = retryAt.get(key);
        if (until !== undefined && until > now()) continue;
        load(key, false);
        started++;
      }
      s.prefetched += started;
      return started;
    },
    stats() {
      return { ...s, inFlight: active, queued: queue.length, pending: pending.size, memory: memory.size };
    },
  };
}
