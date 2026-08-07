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
export const rasterStats = { hits: 0, misses: 0, writes: 0, errors: 0, bypass: 0 };

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
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`raster ${res.status} ${url}`);
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
