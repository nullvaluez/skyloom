/**
 * Round 22 (A TERRA) — persistent raster cache for Esri imagery + DEM.
 *
 * WHY: the R21 TILE_PIPELINE cache (`fly-tiles-v1`) covers ONLY the
 * OpenFreeMap vector pbf the worker fetches. Every Esri IMAGERY jpeg and every
 * Terrain3D LERC blob is refetched from the network on every warp, every
 * return visit and every session — so a warp back to a place you flew five
 * minutes ago is exactly as slow as the first one, and the whole z2→z16
 * descent is paid again.
 *
 * MECHANISM: app-owned dataType loaders registered through the vendored
 * `LoaderFactory` (`registerMaterialLoader` / `registerGeometryLoader` — the
 * library's designed seam). NOT a Service Worker (Next dev scope + HMR risk
 * for zero gain) and NOT a `window.fetch` shim: upstream imagery rides
 * three's `ImageLoader`/`HTMLImageElement`, which never touches `fetch`, so a
 * shim would silently miss half the traffic. Subclassing the two vendored
 * loaders and swapping ONLY their `doLoad()` transport keeps every other
 * behavior (clip bounds, sRGB, martini decimation, the LERC worker pool)
 * byte-identical to upstream.
 *
 * The two loaders register under NEW dataTypes ('fly-image-cached' /
 * 'fly-lerc-cached'), so the stock 'image'/'lerc' loaders stay registered and
 * untouched: nothing can accidentally get the cache by omission. Only the
 * TERRA_CACHE-gated source subclasses in tile-sources.js select them.
 *
 * FAILURE POLICY (the R21 TILE_PIPELINE idiom): every cache operation is
 * wrapped — a missing Cache API, a full quota, a rejected `put`, a corrupt
 * entry — all degrade to a plain network fetch. The cache can never be the
 * reason a tile fails to load. HTTP failures are NEVER written to the cache
 * (a 404/429 stored as content would poison a tile for the life of the
 * install); they propagate as rejections so three-tile's own error material /
 * empty geometry path handles them exactly as before.
 */

import { Texture, SRGBColorSpace } from 'three';
import {
  LoaderFactory,
  TileImageLoader,
  TerrainLercLoader,
  TileGeometry,
  getSubImage,
  flyGetPatch,
} from './vendor/three-tile/index.js';
import { TERRA_CACHE } from './fly-constants';

export const CACHED_IMAGE_TYPE = 'fly-image-cached';
export const CACHED_LERC_TYPE = 'fly-lerc-cached';

// ── Cache API plumbing ─────────────────────────────────────────────────────

let _cachePromise = null;
let _cacheDead = false; // one hard failure disables the layer for the session

/** Lazily open (once) the versioned cache. Resolves to null when unavailable. */
function openCache() {
  if (_cacheDead) return Promise.resolve(null);
  if (_cachePromise) return _cachePromise;
  _cachePromise = (async () => {
    try {
      if (typeof caches === 'undefined') return null;
      return await caches.open(TERRA_CACHE.name);
    } catch {
      _cacheDead = true;
      return null;
    }
  })();
  return _cachePromise;
}

// Insertion-order trim. `cache.keys()` is expensive, so it runs at most once
// per `trimEvery` writes rather than on every put — the budget is a soft cap
// on disk, not a correctness invariant.
let _writes = 0;
const TRIM_EVERY = 400;

async function maybeTrim(cache) {
  if (++_writes % TRIM_EVERY !== 0) return;
  try {
    const keys = await cache.keys();
    const over = keys.length - (TERRA_CACHE.maxEntries || 9000);
    if (over <= 0) return;
    // Cache API preserves insertion order, so the head is the oldest.
    for (let i = 0; i < over; i++) await cache.delete(keys[i]);
  } catch {
    /* trimming is best-effort */
  }
}

/**
 * Cache-first fetch. Returns a Response on success; throws on network/HTTP
 * failure exactly like a bare fetch would.
 * `stats` counts hits/misses for the dev handle + verify-terra.
 */
export const rasterStats = {
  hits: 0,
  misses: 0,
  writes: 0,
  errors: 0,
  bypass: 0,
  // R24 (A "MOTION HOLD") — the failure receipts. `errorTiles` is incremented by
  // the vendored patch #8 site and mirrored here by terrain-engine's publisher.
  timeouts: 0,
  retries: 0,
  giveUps: 0,
  errorTiles: 0,
};

/**
 * R24 (A "MOTION HOLD") — TILE_HOLD.raster, or null for the R22 behaviour.
 *
 * THE DEFECT THIS CLOSES. Until now the raster path had NO failure policy of any
 * kind, in a file whose own header promises the opposite: no timeout (the fetch
 * below was bare, so a hung connection hangs a tile forever — and because
 * `Tile._removeSubTiles` sets `_loadState = "loading"` before awaiting it, a
 * hung merge freezes that tile AND ITS ENTIRE SUBTREE for the session), no
 * retry, no backoff and no telemetry. A single transient 429 or 5xx from Esri
 * hands the tile a 20%-opacity BLACK material that it keeps until the LOD
 * collapses it away — a dark square in the satellite plane with nothing
 * anywhere that counts it. R21 built exactly this machinery for the VECTOR
 * chunk path (`STREAM_KEEPER.retry`: reason-coded TTL, exponential backoff,
 * jitter, an AbortController timeout) and it was never ported to raster; this
 * is that port, deliberately keeping R21's shape so the two paths read alike.
 *
 * Null = every knob off ⇒ one bare, untimed attempt ⇒ the R22 code path.
 */
let _policy = null;
export function setRasterPolicy(p) {
  _policy = p && typeof p === 'object' ? p : null;
  return _policy;
}

/** Which HTTP statuses are worth asking again about. A 404 is an answer. */
function retryableStatus(s) {
  return s === 408 || s === 425 || s === 429 || s === 500 || s === 502 || s === 503 || s === 504;
}

/**
 * One attempt, with the policy's timeout. Separated so the retry loop below
 * reads as a loop and not as a nest. With no policy this is the R22 expression:
 * `fetch(url, { mode:'cors', credentials:'omit' })` and nothing else.
 */
async function fetchOnce(url, timeoutMs) {
  if (!(timeoutMs > 0) || typeof AbortController === 'undefined') {
    return fetch(url, { mode: 'cors', credentials: 'omit' });
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { mode: 'cors', credentials: 'omit', signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Bounded, reason-coded retry. THE BOUND IS THE POINT: `retries` is small (2)
 * and the backoff is exponential with jitter, because the failure this protects
 * against is transient contention — R24 measured the quadtree issuing ~10-20x
 * its transport-limited request rate under motion, which is exactly the way to
 * earn a 429 — and hammering a service that is already rate-limiting is how a
 * retry turns into the outage. A non-retryable status (404, 403) is an ANSWER
 * and is thrown on the first attempt, unchanged.
 *
 * With `_policy` null this function is `fetch(...)` + upstream's own `!res.ok`
 * throw, i.e. the R22 body verbatim: `retries` reads 0, the loop runs once,
 * `timeoutMs` is 0 so `fetchOnce` takes its no-AbortController branch.
 */
async function fetchWithPolicy(url) {
  const p = _policy;
  const tries = Math.max(0, p?.retries ?? 0) + 1;
  const timeoutMs = p?.timeoutMs ?? 0;
  const base = p?.backoffBaseMs ?? 0;
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchOnce(url, timeoutMs);
      if (res.ok) return res;
      last = new Error(`raster ${res.status} ${url}`);
      last.flyStatus = res.status;
      if (!retryableStatus(res.status)) throw last;
    } catch (e) {
      // An AbortError is our own timeout firing, and it IS worth another ask.
      const aborted = e?.name === 'AbortError';
      if (aborted) rasterStats.timeouts++;
      if (e?.flyStatus && !retryableStatus(e.flyStatus)) throw e;
      last = e;
    }
    if (i < tries - 1) {
      rasterStats.retries++;
      // Exponential with the R21 jitter fraction, so a burst of tiles failing
      // together does not come back as a synchronised burst.
      const wait = base * 2 ** i * (0.8 + Math.random() * 0.4);
      if (wait > 0) await sleep(wait);
    }
  }
  rasterStats.giveUps++;
  throw last ?? new Error(`raster failed ${url}`);
}

/**
 * HARNESS-ONLY alias, exported for the same reason the vendored module exports
 * `flyBoundaryEdgesRef`: the retry loop is the one piece of R24 that can HANG a
 * tile if it is wrong, and asserting its bound, its non-retryable path and its
 * timeout is worth more than reading it. scripts/r24-a-unit.js §6 is the caller.
 * Nothing in the app imports this name.
 */
export const __flyFetchWithPolicy = (url) => fetchWithPolicy(url);

async function cachedFetch(url) {
  const cache = await openCache();
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        rasterStats.hits++;
        return hit;
      }
    } catch {
      rasterStats.errors++;
    }
  } else {
    rasterStats.bypass++;
  }
  const res = await fetchWithPolicy(url);
  rasterStats.misses++;
  if (cache) {
    // Clone BEFORE the body is consumed by the caller.
    try {
      const copy = res.clone();
      // Fire-and-forget: a slow disk must never hold up a tile.
      cache
        .put(url, copy)
        .then(() => {
          rasterStats.writes++;
          return maybeTrim(cache);
        })
        .catch(() => {
          rasterStats.errors++;
        });
    } catch {
      rasterStats.errors++;
    }
  }
  return res;
}

/**
 * Warm a URL without building any GPU resource.
 * `useCache` is the caller's TERRA_CACHE state: with the cache layer OFF the
 * prefetch still helps (the descent's own ImageLoader/FileLoader fetches hit
 * the browser's HTTP cache), but writing entries into `fly-raster-v1` that no
 * loader will ever read would be dead weight, so it is skipped.
 */
export async function prefetchUrl(url, useCache = true) {
  try {
    const cache = useCache ? await openCache() : null;
    if (cache) {
      const hit = await cache.match(url);
      if (hit) return 'hit';
    }
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return 'err';
    if (cache) {
      try {
        await cache.put(url, res.clone());
        rasterStats.writes++;
      } catch {
        rasterStats.errors++;
      }
    }
    // Drain the body so the connection is released even without a cache.
    await res.arrayBuffer();
    return 'net';
  } catch {
    return 'err';
  }
}

// ── The two loaders ────────────────────────────────────────────────────────

/**
 * Imagery. Upstream `TileImageLoader.doLoad` is:
 *   loader.loadAsync(url) → HTMLImageElement → (clip) → new Texture(img)
 * We swap the transport for cachedFetch → blob → createImageBitmap, keep the
 * identical clip step (the vendored `getSubImage`, which draws through an
 * OffscreenCanvas and accepts an ImageBitmap), and set the identical color
 * space. `needsUpdate` is set explicitly: upstream relies on TileLoader's
 * `_materialClip` to raise it, which only runs on the first material build.
 */
class FlyCachedImageLoader extends TileImageLoader {
  constructor() {
    super();
    this.dataType = CACHED_IMAGE_TYPE;
    this.info = {
      ...this.info,
      description: 'R22 A TERRA: XYZ image loader over the fly-raster Cache API',
    };
  }

  async doLoad(url, params) {
    let bitmap;
    try {
      const res = await cachedFetch(url);
      const blob = await res.blob();
      bitmap = await createImageBitmap(blob);
    } catch {
      // Degrade to upstream's own transport rather than failing the tile.
      return super.doLoad(url, params);
    }
    let image = bitmap;
    const cb = params.clipBounds;
    if (cb && cb[2] - cb[0] < 1) image = getSubImage(bitmap, cb);
    const tex = new Texture(image);
    tex.colorSpace = SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }
}

/**
 * DEM. Upstream `TerrainLercLoader.doLoad` is:
 *   fileLoader.loadAsync(url) → ArrayBuffer → workerPool(decode+martini)
 * Only the first step changes. The worker pool, the clip bounds and the
 * R22 error table all travel exactly as they do upstream.
 */
class FlyCachedLercLoader extends TerrainLercLoader {
  constructor() {
    super();
    this.dataType = CACHED_LERC_TYPE;
    this.info = {
      ...this.info,
      description: 'R22 A TERRA: ArcGIS LERC loader over the fly-raster Cache API',
    };
  }

  async doLoad(url, params) {
    const { z, clipBounds } = params;
    let demData;
    try {
      const res = await cachedFetch(url);
      demData = await res.arrayBuffer();
    } catch {
      return super.doLoad(url, params);
    }
    const msg = {
      demData,
      z,
      clipBounds,
      errTable: flyGetPatch().demErrorTable || undefined,
    };
    const data = (await this._workerPool.postMessage(msg, [demData])).data;
    // Same construction as upstream (setAttributes, not setData — the worker
    // has already run the martini decimation).
    return new TileGeometry().setAttributes(data, z);
  }
}

// ── Registration (idempotent — HMR/StrictMode safe) ─────────────────────────

let _registered = false;

/**
 * Register the cached loaders exactly once per module instance. Safe to call
 * on every engine construction. Returns true when the cached dataTypes are
 * available for a source to select.
 */
export function registerRasterCacheLoaders() {
  if (_registered) return true;
  try {
    if (typeof window === 'undefined' || typeof caches === 'undefined') return false;
    LoaderFactory.registerMaterialLoader(new FlyCachedImageLoader());
    LoaderFactory.registerGeometryLoader(new FlyCachedLercLoader());
    _registered = true;
    return true;
  } catch {
    return false;
  }
}

/** True once the cached dataTypes are live in the LoaderFactory. */
export function rasterCacheReady() {
  return _registered;
}

/** Dev/harness handle: cache stats + a manual purge. */
export function installRasterCacheHandle() {
  if (typeof window === 'undefined') return;
  window.__flyRasterCache = {
    stats: () => ({ ...rasterStats, name: TERRA_CACHE.name, dead: _cacheDead }),
    purge: async () => {
      try {
        await caches.delete(TERRA_CACHE.name);
      } catch {
        /* ignore */
      }
      _cachePromise = null;
      rasterStats.hits = rasterStats.misses = rasterStats.writes = 0;
      rasterStats.errors = rasterStats.bypass = 0;
      return true;
    },
    count: async () => {
      try {
        const c = await openCache();
        return c ? (await c.keys()).length : -1;
      } catch {
        return -1;
      }
    },
  };
}
