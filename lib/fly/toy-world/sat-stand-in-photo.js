/**
 * World Pass C (REACH), round 2b: the ground photo under the far ring, on the
 * MAIN thread. Stream C owns this file. Used only by sat-skyline-engine.js
 * while the stand-ins are on (the engine's latched `_reach`); with the stream
 * off nothing here is constructed.
 *
 * WHY HERE AND NOT IN THE WORKER. Round 2 fetched the photo inside each
 * skyline worker and awaited it (up to 1.5 s) inside every tile build, after
 * the tile's own vector-tile fetch: the photo's latency sat on the critical
 * path of every group, the waiting builds held in-flight slots, and each of
 * the three pooled workers fetched and decoded the same photo again (Esri
 * requests 17 -> 97) with its own latch, so a rebuilt tile could change colour
 * depending on which worker built it. Now:
 *   - one photo per skyline group (a group of 4 x 4 z14 tiles is one z12
 *     tile; at `subZoom` 1 the photo is its 2 x 2 z13 tiles, 512 px, so a 30 m
 *     boulevard is about two pixels), wanted when the group enters the desired
 *     ring, nearest first, at most `maxInFlight` groups at once, at low fetch
 *     priority (the terrain's own imagery requests go first);
 *   - decoded once, here, into the de-lit ground albedo (luma clamped to
 *     [albedoMin, albedoMax] and chroma to satMax in linear light), kept on
 *     the CPU for the per-building colour (a (2r+1)^2 box mean, applyPhoto)
 *     and on the GPU (createPhotoAtlas) for the shader's per-fragment read;
 *   - NEVER awaited by a build. A group finalizes with whatever is here; a
 *     photo that lands while the group is still being born (patchSec) is
 *     written into it; later than that the group keeps its palette colour for
 *     its whole residency (the latch, one per page, held on the chunk).
 */

import { ClampToEdgeWrapping, DataArrayTexture, LinearFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import { applyPhoto, loadPhoto, photoAlbedo, photoSize } from './sat-stand-in-photo-core';

export { applyPhoto, photoAlbedo, photoSize };


/**
 * The page's photo store. `key` is the skyline group key; (pz, px, py) its
 * photo tile at the group's own zoom; cfg.subZoom 1 fetches its 2 x 2
 * children instead. Fetch, decode and de-lighting run in one small worker
 * (sat-stand-in-photo.worker.js), never on the main thread. onReady(key) is
 * called once per photo that decoded.
 */
export function createStandInPhotos(cfg = {}, onReady = () => {}) {
  const maxInFlight = Math.max(1, cfg.maxInFlight ?? 2);
  const maxCached = Math.max(8, cfg.maxCached ?? 48);
  const sub = Math.max(0, Math.min(2, cfg.subZoom | 0));
  const S = photoSize(sub);
  const done = new Map(); // key -> { alb, n } | null (failed) | undefined (in flight); LRU order
  const order = []; // [{ key, pz, px, py }] wanted, nearest first
  const waiting = new Map(); // id -> resolve
  let inFlight = 0;
  let disposed = false;
  let nextId = 1;
  const stat = { fetched: 0, failed: 0 };
  let worker = null;
  try {
    if (typeof Worker === 'function') {
      worker = new Worker(new URL('./sat-stand-in-photo.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        const r = waiting.get(data.id);
        waiting.delete(data.id);
        r?.(data.alb ? { alb: data.alb, n: data.n } : null);
      };
    }
  } catch {
    worker = null;
  }
  const plain = { albedoMin: cfg.albedoMin, albedoMax: cfg.albedoMax, satMax: cfg.satMax };
  const load = (e) => {
    if (!worker) return loadPhoto(e, sub, plain).catch(() => null);
    return new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      worker.postMessage({ id, e: { pz: e.pz, px: e.px, py: e.py }, sub, cfg: plain });
    });
  };

  const start = () => {
    while (!disposed && inFlight < maxInFlight && order.length) {
      const e = order.shift();
      if (done.has(e.key)) continue;
      done.set(e.key, undefined);
      inFlight += 1;
      load(e).then((photo) => {
        inFlight -= 1;
        if (disposed) return;
        done.delete(e.key);
        done.set(e.key, photo);
        if (photo) stat.fetched += 1;
        else stat.failed += 1;
        while (done.size > maxCached) {
          const old = done.keys().next().value;
          if (done.get(old) === undefined) break; // never drop an in-flight marker
          done.delete(old);
        }
        if (photo) onReady(e.key);
        start();
      });
    }
  };

  return {
    stat,
    size: S,
    /** The wanted photos, nearest first (replaces the previous order). */
    want(list) {
      if (disposed || (!worker && typeof OffscreenCanvas === 'undefined')) return;
      order.length = 0;
      for (const e of list) if (!done.has(e.key)) order.push(e);
      start();
    },
    /** The photo { alb, n } for a group key, or null (not here yet, or failed). */
    get(key) {
      const a = done.get(key);
      if (!a) return null;
      done.delete(key); // LRU touch
      done.set(key, a);
      return a;
    },
    dispose() {
      disposed = true;
      order.length = 0;
      done.clear();
      waiting.clear();
      worker?.terminate();
      worker = null;
    },
  };
}

/**
 * Round 2b (street pattern): the decoded photos on the GPU, one layer of an
 * S x S x `layers` sRGB array texture per resident group. A slot is held by
 * the chunk that drew it and freed on eviction; a freed slot is reused only
 * after `quarantineMs`, so a group still fading out never shows another
 * group's photo. alloc() returns -1 when every slot is busy (the group then
 * keeps the per-building colour).
 */
export function createPhotoAtlas(S = 256, layers = 40, quarantineMs = 4000) {
  const data = new Uint8Array(S * S * 4 * layers);
  const texture = new DataArrayTexture(data, S, S, layers);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const freeAt = new Float64Array(layers).fill(-Infinity); // when each free slot became free
  const busy = new Uint8Array(layers);
  const stat = { allocMsMax: 0 };
  return {
    texture,
    layers,
    stat,
    alloc(photo) {
      if (!photo || photo.n !== S) return -1;
      const now = performance.now();
      let s = -1;
      for (let i = 0; i < layers; i++) if (!busy[i] && now - freeAt[i] >= quarantineMs && (s < 0 || freeAt[i] < freeAt[s])) s = i;
      if (s < 0) return -1;
      busy[s] = 1;
      data.set(photo.alb, s * S * S * 4);
      texture.addLayerUpdate(s);
      texture.needsUpdate = true;
      stat.allocMsMax = Math.max(stat.allocMsMax, performance.now() - now);
      return s;
    },
    free(s) {
      if (!(s >= 0) || !busy[s]) return;
      busy[s] = 0;
      freeAt[s] = performance.now();
    },
    dispose() {
      texture.dispose();
    },
  };
}
