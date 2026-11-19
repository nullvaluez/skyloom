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
 *   - never awaited by a build. A resident group can acquire its atlas slot
 *     after publication, including after a retry or slot quarantine.
 */

import { ClampToEdgeWrapping, DataArrayTexture, LinearFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import { applyPhoto, loadPhoto, photoAlbedo, photoSize } from './sat-stand-in-photo-core';
import { FLIGHT_CLARITY_ON } from '../world-clarity';

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
  const done = new Map();
  const failures = new Map();
  const active = new Map(); // key -> request identity, for cancellation across warps
  const waiting = new Map(); // worker message id -> resolver
  let disposed = false;
  let nextId = 1;
  const stat = { fetched: 0, failed: 0 };
  let worker = null;
  let workerFailed = false;
  const stopWorker = () => {
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      worker = null;
    }
    for (const resolve of waiting.values()) resolve(null);
    waiting.clear();
  };
  const plain = { albedoMin: cfg.albedoMin, albedoMax: cfg.albedoMax, satMax: cfg.satMax, filteredPhoto: FLIGHT_CLARITY_ON };
  function load(e, request, retry) {
    if (!worker && !workerFailed && typeof Worker === 'function') {
      try {
        worker = new Worker(new URL('./sat-stand-in-photo.worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
          const resolve = waiting.get(data.id);
          waiting.delete(data.id);
          resolve?.(data.alb ? { alb: data.alb, n: data.n } : null);
        };
        worker.onerror = worker.onmessageerror = () => { workerFailed = true; stopWorker(); };
      } catch { workerFailed = true; }
    }
    const settings = retry ? { ...plain, retry } : plain;
    if (!worker) {
      if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') return Promise.resolve(null);
      return loadPhoto(e, sub, settings, request.signal);
    }
    return new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      try { worker.postMessage({ id, e: { pz: e.pz, px: e.px, py: e.py }, sub, cfg: settings }); }
      catch { workerFailed = true; stopWorker(); }
    });
  }
  const remember = (map, key, value) => {
    map.delete(key);
    map.set(key, value);
    if (map.size > maxCached) map.delete(map.keys().next().value);
  };
  function cancel() {
    if (!active.size) return;
    for (const request of active.values()) request.abort();
    active.clear();
    stopWorker();
  }
  return {
    stat,
    size: S,
    cancel,
    // Only a fresh engine tick admits work. Completion cannot drain an old
    // destination's queue or launch another group after the boot gate closes.
    want(list, budget = maxInFlight) {
      if (disposed || ((workerFailed || typeof Worker !== 'function') && typeof OffscreenCanvas === 'undefined')) return;
      for (const e of list) {
        if (budget <= 0 || active.size >= maxInFlight) break;
        const failure = failures.get(e.key);
        if (done.has(e.key) || active.has(e.key) || failure?.at > performance.now()) continue;
        budget--;
        const request = new AbortController();
        active.set(e.key, request);
        load(e, request, !!failure).catch(() => null).then(photo => {
          if (active.get(e.key) !== request) return;
          active.delete(e.key);
          if (photo) {
            failures.delete(e.key);
            remember(done, e.key, photo);
            stat.fetched++;
            onReady(e.key);
          } else {
            const delay = Math.min(60000, (failure?.delay ?? 2500) * 2);
            remember(failures, e.key, { at: performance.now() + delay, delay });
            stat.failed++;
          }
        });
      }
    },
    get(key) {
      const photo = done.get(key);
      if (photo) remember(done, key, photo);
      return photo ?? null;
    },
    dispose() {
      disposed = true;
      cancel();
      stopWorker();
      done.clear();
      failures.clear();
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
  const height = FLIGHT_CLARITY_ON ? S + (S >> 1) : S;
  const layerBytes = S * height * 4;
  const data = new Uint8Array(layerBytes * layers);
  const texture = new DataArrayTexture(data, S, height, layers);
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
    available() {
      const now = performance.now();
      return busy.some((held, i) => !held && now - freeAt[i] >= quarantineMs);
    },
    alloc(photo) {
      if (!photo || photo.n !== S || photo.alb?.length !== layerBytes) return -1;
      const now = performance.now();
      let s = -1;
      for (let i = 0; i < layers; i++) if (!busy[i] && now - freeAt[i] >= quarantineMs && (s < 0 || freeAt[i] < freeAt[s])) s = i;
      if (s < 0) return -1;
      busy[s] = 1;
      data.set(photo.alb, s * layerBytes);
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
