// R25 D GROUND — THE COLOUR REFERENCE (plan FLY_ROUND25_PLAN.md, role D §3).
//
// THE DEFECT. Esri World Imagery is a MOSAIC of captures flown in different
// seasons and years; at z15-17 neighbouring tiles differ in exposure and
// white balance, and at cruise the ground reads as a quilt. R19's SAT_QUILT
// hid the seams by GREYING the ground toward a fixed anchor (desaturate +
// flatten) — i.e. by throwing away colour everywhere to hide it in a few
// places.
//
// THE FIX. Esri's LOW zooms (z11 here) are served from a colour-BALANCED
// product. So keep a rolling atlas of z11 reference slots around the camera
// and let each high-zoom tile borrow its LOW-FREQUENCY colour from it:
//     hi *= clamp(ref / textureLod(map, uv, lodK), clampLo, clampHi)
// where lodK is the tile's own mip whose texel matches one reference texel
// (lib/fly/r25-relief.js lodKFor). Detail is untouched (the ratio is ~1 at
// every frequency above the reference's), the capture-to-capture steps are
// divided out, and SAT_QUILT is retired to (0, 0) in Enhanced.
//
// ATLAS. atlasPx^2 RGBA8 sRGB, (atlasPx / slotPx)^2 slots of slotPx^2 (8 x 8
// slots of 64^2 = one 512^2 texture, 1 MiB, no mips). TOROIDAL addressing:
// reference tile (X, Y) lives in slot (X mod span, Y mod span), so a recentre
// on a z11 tile crossing only invalidates and re-fetches the entering row or
// column; RepeatWrapping makes bilinear filtering across a slot boundary read
// the true geographic neighbour. Alpha = 255 where a slot holds data, 0 where
// it does not (the shader fades the ratio to 1 through alpha, and to 1 over
// `edgeFadeTiles` at the window border).
//
// SOURCE. Fetched through the SAME imagery source object the terrain engine
// streams (lib/fly/tile-sources.js — the ArcGIS World_Imagery URL, or E's
// offline fixture when `window.__flyTileFixture` rewrote it), so the fixture
// routes the reference exactly as it routes the tiles.
//
// SEA LAYER (SEA_STATE.region, 2026-10-21). Mip level 1 of the same texture
// is NOT a mip of level 0: it is the water-only colour of each reference
// tile, (atlasPx / 2)^2 with slotPx / 2 slots in the same toroidal places.
// Each texel holds the linear colour of the tile's open-water pixels
// premultiplied by their share of the texel (rgb stored sRGB-encoded, so the
// GPU decodes before it filters; alpha linear), so bilinear filtering never
// mixes the shore into the water and an empty slot weighs nothing. Water is
// OpenFreeMap's vector water layer at the reference zoom; bright grey pixels
// (cloud, glint, haze), and a 2 px rim around them, are rejected. The terrain
// samples level 0 at an explicit LOD 0 only (LINEAR_MIPMAP_NEAREST
// magnifies at LOD 0, so its pixels do not change); the water samples LOD 1.
// Without the sea option the texture is exactly the R25 one.

import {
  DataTexture,
  LinearFilter,
  LinearMipmapNearestFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { R25_GROUND } from './fly-constants';
import { paintSurfacePolygon } from './earth-surface-mask';

const SRGB_TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LIN[i] = c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}
function linToSrgb8(l) {
  const v = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/**
 * Box-downsample an RGBA8 sRGB image (w x h, row 0 = north) to slot x slot,
 * averaging in LINEAR light (the GPU's sRGB mip chain averages linear too, so
 * ref and textureLod(map) are the same kind of mean). Alpha out = 255.
 */
export function downsampleToSlot(rgba, w, h, slot) {
  const out = new Uint8Array(slot * slot * 4);
  for (let sy = 0; sy < slot; sy++) {
    const y0 = Math.floor((sy * h) / slot);
    const y1 = Math.max(y0 + 1, Math.floor(((sy + 1) * h) / slot));
    for (let sx = 0; sx < slot; sx++) {
      const x0 = Math.floor((sx * w) / slot);
      const x1 = Math.max(x0 + 1, Math.floor(((sx + 1) * w) / slot));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * w + x) * 4;
          r += SRGB_TO_LIN[rgba[o]];
          g += SRGB_TO_LIN[rgba[o + 1]];
          b += SRGB_TO_LIN[rgba[o + 2]];
          n++;
        }
      }
      const o = (sy * slot + sx) * 4;
      out[o] = linToSrgb8(r / n);
      out[o + 1] = linToSrgb8(g / n);
      out[o + 2] = linToSrgb8(b / n);
      out[o + 3] = 255;
    }
  }
  return out;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How much one linear pixel counts as open-water colour. Water in the z11
 * mosaic is dark (luma p90 .01-.14 over 16 measured sites; turbid estuaries
 * such as the Thames and the Yangtze reach .12 with chroma/luma >= .3) or,
 * in the shallows, bright but strongly coloured. Bright grey is cloud, sun
 * glint or haze (luma .2-.6, chroma/luma < .25).
 */
export function seaPixelWeight(r, g, b) {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  return 1 - smooth(0.1, 0.2, l) * (1 - smooth(0.25, 0.5, chroma / Math.max(1e-4, l)));
}

/** The vector water layer of one tile as a size x size 0/1 mask (row 0 = north). */
export function waterMaskFromTile(bytes, size) {
  const mask = new Uint8Array(size * size);
  const layer = new VectorTile(new PbfReader(bytes)).layers.water;
  if (!layer) return mask;
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    // Seasonal water is not open water (stylized-earth surfaceClass agrees).
    if (f.type !== 3 || f.properties.intermittent === 1) continue;
    paintSurfacePolygon(mask, size, f.loadGeometry(), layer.extent, 1);
  }
  return mask;
}

/**
 * One sea slot (slot x slot RGBA8) from an RGBA8 sRGB image and its water
 * mask (both w x h): premultiplied linear water colour, sRGB-encoded, and
 * the clean-water share in alpha. Rejected pixels carry a 2 px rim (a 5 x 5
 * minimum) so a cloud's soft edge cannot tint the water around it.
 */
export function seaSlotFromPixels(rgba, w, h, water, slot) {
  const n = w * h;
  const weight = new Float32Array(n);
  for (let i = 0; i < n; i++) weight[i] = seaPixelWeight(SRGB_TO_LIN[rgba[i * 4]], SRGB_TO_LIN[rgba[i * 4 + 1]], SRGB_TO_LIN[rgba[i * 4 + 2]]);
  const rows = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 1;
      for (let d = Math.max(0, x - 2); d <= Math.min(w - 1, x + 2); d++) m = Math.min(m, weight[y * w + d]);
      rows[y * w + x] = m;
    }
  }
  const out = new Uint8Array(slot * slot * 4);
  for (let sy = 0; sy < slot; sy++) {
    const y0 = Math.floor((sy * h) / slot);
    const y1 = Math.max(y0 + 1, Math.floor(((sy + 1) * h) / slot));
    for (let sx = 0; sx < slot; sx++) {
      const x0 = Math.floor((sx * w) / slot);
      const x1 = Math.max(x0 + 1, Math.floor(((sx + 1) * w) / slot));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          if (!water[i]) continue;
          let c = 1;
          for (let d = Math.max(0, y - 2); d <= Math.min(h - 1, y + 2); d++) c = Math.min(c, rows[d * w + x]);
          r += c * SRGB_TO_LIN[rgba[i * 4]];
          g += c * SRGB_TO_LIN[rgba[i * 4 + 1]];
          b += c * SRGB_TO_LIN[rgba[i * 4 + 2]];
          a += c;
        }
      }
      const k = 1 / ((y1 - y0) * (x1 - x0));
      const o = (sy * slot + sx) * 4;
      out[o] = linToSrgb8(r * k);
      out[o + 1] = linToSrgb8(g * k);
      out[o + 2] = linToSrgb8(b * k);
      out[o + 3] = Math.round(Math.min(1, a * k) * 255);
    }
  }
  return out;
}

/** Fractional reference-zoom tile coordinates of a lon/lat (Web Mercator XYZ). */
export function geoToTile(lon, lat, z) {
  const n = 2 ** z;
  const la = Math.max(-85.05112878, Math.min(85.05112878, lat)) * (Math.PI / 180);
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n,
  };
}

const mod = (a, n) => ((a % n) + n) % n;

/**
 * The rolling atlas. `fetchSlot(x, y, z)` resolves to Uint8Array(slot^2 * 4)
 * sRGB (or null on a miss); the browser default is `imageSlotFetcher`.
 */
export class ColorRefAtlas {
  constructor({
    zoom = R25_GROUND.colorRef.zoom,
    slotPx = R25_GROUND.colorRef.slotPx,
    atlasPx = R25_GROUND.colorRef.atlasPx,
    maxFetches = R25_GROUND.colorRef.maxFetches,
    fetchSlot = null,
    sea = false,
    fetchSea = null,
    maxSeaFetches = 2,
  } = {}) {
    this.zoom = zoom;
    this.slot = slotPx;
    this.px = atlasPx;
    this.span = Math.max(1, Math.floor(atlasPx / slotPx));
    this.maxFetches = maxFetches;
    this.fetchSlot = fetchSlot;
    this.data = new Uint8Array(atlasPx * atlasPx * 4); // alpha 0 = empty
    this.texture = new DataTexture(this.data, atlasPx, atlasPx, RGBAFormat, UnsignedByteType);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.wrapS = this.texture.wrapT = RepeatWrapping;
    this.texture.magFilter = this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;
    this.texture.name = 'r25-color-ref';
    this.x0 = null; // window origin (reference tile coords)
    this.y0 = null;
    this.slots = new Map(); // "sx,sy" -> { x, y, state: 'pending'|'ok'|'miss' }
    this.inflight = 0;
    this.dirty = false;
    this.loaded = 0;
    this.stats = { recentres: 0, fetched: 0, misses: 0, uploads: 0 };
    this._gen = 0;
    // The sea layer (header). seaWanted gates its fetches (the owner sets it
    // every frame); an atlas built without it is byte-for-byte the R25 one.
    this.seaPx = sea ? atlasPx >> 1 : 0;
    this.seaSlot = sea ? slotPx >> 1 : 0;
    this.seaData = sea ? new Uint8Array(this.seaPx * this.seaPx * 4) : null;
    this.fetchSea = sea ? fetchSea : null;
    this.maxSeaFetches = maxSeaFetches;
    this.seaWanted = false;
    this.seaInflight = 0;
    this.seaQueue = [];
    this.seaStats = { fetched: 0, misses: 0, built: 0 };
    if (sea) {
      this.texture.mipmaps = [
        { data: this.data, width: atlasPx, height: atlasPx },
        { data: this.seaData, width: this.seaPx, height: this.seaPx },
      ];
      this.texture.minFilter = LinearMipmapNearestFilter;
    }
  }

  /** GPU bytes (one RGBA8 texture; level 1 is the sea layer when present). */
  bytes() {
    return this.px * this.px * 4 + (this.seaData?.length ?? 0);
  }

  /** The window the shader reads: (x0, y0, span). */
  get window() {
    return { x0: this.x0 ?? 0, y0: this.y0 ?? 0, span: this.span };
  }

  _clearSlot(sx, sy) {
    const s = this.slot;
    for (let y = 0; y < s; y++) {
      const row = ((sy * s + y) * this.px + sx * s) * 4;
      this.data.fill(0, row, row + s * 4);
    }
  }

  _writeSlot(sx, sy, bytes) {
    const s = this.slot;
    for (let y = 0; y < s; y++) {
      const row = ((sy * s + y) * this.px + sx * s) * 4;
      this.data.set(bytes.subarray(y * s * 4, (y + 1) * s * 4), row);
    }
  }

  /** Write (bytes) or clear (null) one sea slot in level 1. */
  _seaSlot(sx, sy, bytes) {
    const s = this.seaSlot;
    for (let y = 0; y < s; y++) {
      const row = ((sy * s + y) * this.seaPx + sx * s) * 4;
      if (bytes) this.seaData.set(bytes.subarray(y * s * 4, (y + 1) * s * 4), row);
      else this.seaData.fill(0, row, row + s * 4);
    }
  }

  /**
   * Recentre on a lon/lat (a no-op unless the camera's reference tile moved)
   * and top up the fetch queue. Returns true when the window moved.
   */
  update(lon, lat) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    const t = geoToTile(lon, lat, this.zoom);
    const half = Math.floor(this.span / 2);
    const x0 = Math.floor(t.x) - half;
    const y0 = Math.floor(t.y) - half;
    let moved = false;
    if (x0 !== this.x0 || y0 !== this.y0) {
      moved = true;
      this.stats.recentres++;
      this.x0 = x0;
      this.y0 = y0;
      // Every slot whose resident tile left the window is invalidated NOW (its
      // toroidal slot is about to hold a different place).
      for (let j = 0; j < this.span; j++) {
        for (let i = 0; i < this.span; i++) {
          const X = x0 + i;
          const Y = y0 + j;
          const sx = mod(X, this.span);
          const sy = mod(Y, this.span);
          const k = sx + ',' + sy;
          const cur = this.slots.get(k);
          if (cur && cur.x === X && cur.y === Y) continue;
          if (cur?.state === 'ok') {
            this._clearSlot(sx, sy);
            this.loaded--;
            this.dirty = true;
          }
          if (cur?.sea === 'ok') {
            this._seaSlot(sx, sy, null);
            this.dirty = true;
          }
          this.slots.set(k, { x: X, y: Y, state: 'want', sea: this.seaData ? 'want' : 'off' });
        }
      }
    }
    this._pump();
    this._pumpSea();
    return moved;
  }

  _pumpSea() {
    if (!this.fetchSea || !this.seaWanted || this.seaInflight >= this.maxSeaFetches) return;
    const want = [];
    const now = clock();
    for (const [k, s] of this.slots) {
      if (s.sea === 'miss' && now >= s.retryAt) s.sea = 'want';
      if (s.sea === 'want') want.push([k, s]);
    }
    if (!want.length) return;
    const n = 2 ** this.zoom;
    const cx = this.x0 + this.span / 2;
    const cy = this.y0 + this.span / 2;
    want.sort((a, b) => Math.hypot(a[1].x + 0.5 - cx, a[1].y + 0.5 - cy) - Math.hypot(b[1].x + 0.5 - cx, b[1].y + 0.5 - cy));
    const gen = this._gen;
    for (const [k, s] of want) {
      if (this.seaInflight >= this.maxSeaFetches) break;
      if (s.y < 0 || s.y >= n) {
        s.sea = 'void';
        continue;
      }
      s.sea = 'pending';
      this.seaInflight++;
      const X = s.x;
      const Y = s.y;
      Promise.resolve()
        .then(() => this.fetchSea(mod(X, n), Y, this.zoom))
        .catch(() => null)
        .then((build) => {
          this.seaInflight--;
          if (gen !== this._gen) return;
          const cur = this.slots.get(k);
          if (!cur || cur.x !== X || cur.y !== Y) return; // recentred away
          if (typeof build === 'function') {
            cur.sea = 'queued';
            this.seaQueue.push({ k, X, Y, build });
          } else this._seaMiss(cur);
          this._pumpSea();
        });
    }
  }

  /**
   * Build at most `budget` queued sea slots. The mask raster and the 5 x 5
   * rejection run on the main thread (measured over 144 real z11 tiles at
   * 128 px: median 0.95 ms, p90 1.9 ms), so the owner builds one per frame.
   */
  processSea(budget = 1) {
    while (budget > 0 && this.seaQueue.length) {
      const job = this.seaQueue.shift();
      const cur = this.slots.get(job.k);
      if (!cur || cur.x !== job.X || cur.y !== job.Y || cur.sea !== 'queued') continue;
      budget--;
      let bytes = null;
      try {
        bytes = job.build();
      } catch {
        bytes = null;
      }
      if (!bytes || bytes.length !== this.seaSlot * this.seaSlot * 4) {
        this._seaMiss(cur);
        continue;
      }
      const [sx, sy] = job.k.split(',').map(Number);
      this._seaSlot(sx, sy, bytes);
      cur.sea = 'ok';
      this.seaStats.built++;
      this.dirty = true;
    }
  }

  /** A failed sea slot stays empty and is retried after a backoff. */
  _seaMiss(cur) {
    cur.sea = 'miss';
    cur.retryAt = clock() + 10;
    this.seaStats.misses++;
  }

  /**
   * Distance (reference tiles) from (cx, cy) to the nearest window slot whose
   * sea layer is not in place (on its way, or failed and waiting to retry);
   * Infinity when every slot holds its layer. An empty slot next to a full
   * one would be a straight edge, so the owner keeps its reach inside this.
   */
  seaResolvedRadius(cx, cy) {
    let r = Infinity;
    for (const s of this.slots.values()) {
      if (s.sea === 'ok' || s.sea === 'void' || s.sea === 'off') continue;
      const dx = Math.max(s.x - cx, 0, cx - s.x - 1);
      const dy = Math.max(s.y - cy, 0, cy - s.y - 1);
      r = Math.min(r, Math.hypot(dx, dy));
    }
    return r;
  }

  _pump() {
    if (!this.fetchSlot || this.inflight >= this.maxFetches) return;
    // Cheap exit on the common frame (nothing wanted): no allocation.
    let any = false;
    for (const s of this.slots.values()) {
      if (s.state === 'want') {
        any = true;
        break;
      }
    }
    if (!any) return;
    const n = 2 ** this.zoom;
    // Nearest-first: centre outwards.
    const want = [];
    for (const [k, s] of this.slots) if (s.state === 'want') want.push([k, s]);
    if (!want.length) return;
    const cx = this.x0 + this.span / 2;
    const cy = this.y0 + this.span / 2;
    want.sort((a, b) => Math.hypot(a[1].x + 0.5 - cx, a[1].y + 0.5 - cy) - Math.hypot(b[1].x + 0.5 - cx, b[1].y + 0.5 - cy));
    const gen = this._gen;
    for (const [k, s] of want) {
      if (this.inflight >= this.maxFetches) break;
      if (s.y < 0 || s.y >= n) {
        s.state = 'miss';
        continue;
      }
      s.state = 'pending';
      this.inflight++;
      const X = s.x;
      const Y = s.y;
      Promise.resolve()
        .then(() => this.fetchSlot(mod(X, n), Y, this.zoom))
        .catch(() => null)
        .then((bytes) => {
          this.inflight--;
          if (gen !== this._gen) return;
          const cur = this.slots.get(k);
          if (!cur || cur.x !== X || cur.y !== Y) return; // recentred away
          if (!bytes || bytes.length !== this.slot * this.slot * 4) {
            cur.state = 'miss';
            this.stats.misses++;
          } else {
            const [sx, sy] = k.split(',').map(Number);
            this._writeSlot(sx, sy, bytes);
            cur.state = 'ok';
            this.loaded++;
            this.stats.fetched++;
            this.dirty = true;
          }
          this._pump();
        });
    }
  }

  /** Slots still waiting for (or fetching) their reference tile. */
  pendingCount() {
    let n = 0;
    for (const s of this.slots.values()) if (s.state === 'want' || s.state === 'pending') n++;
    return n;
  }

  /** Free the GPU copy only (a Classic toggle); the CPU atlas is kept. */
  releaseGpu() {
    this.texture.dispose();
  }

  /** Re-upload the kept CPU atlas (back to Enhanced). */
  restoreGpu() {
    this.texture.needsUpdate = true;
  }

  /** Push pending writes to the GPU (at most once per call). */
  flush() {
    if (!this.dirty) return false;
    this.dirty = false;
    this.texture.needsUpdate = true;
    this.stats.uploads++;
    return true;
  }

  dispose() {
    this._gen++;
    this.texture.dispose();
    this.slots.clear();
    this.seaQueue.length = 0;
    this.loaded = 0;
  }
}

/**
 * Browser slot fetcher over a three-tile imagery source (`getUrl(x, y, z)`).
 * Straight `fetch` (no raster-cache: 64 small tiles per warp) → ImageBitmap →
 * 2D canvas → linear-light box average. Returns null on any failure.
 */
export function imageSlotFetcher(getSource, slotPx = R25_GROUND.colorRef.slotPx) {
  return async (x, y, z) => {
    const img = await tilePixels(getSource, x, y, z);
    return img && downsampleToSlot(img.data, img.width, img.height, slotPx);
  };
}

/** One reference tile's ImageData (at `size` px when given), or null. */
async function tilePixels(getSource, x, y, z, size = 0) {
  const src = getSource();
  if (!src || typeof src.getUrl !== 'function') return null;
  if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function') return null;
  const url = src.getUrl(x, y, z);
  if (!url || url.startsWith('data:')) return null; // toy's solid tile
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) return null;
  const bmp = await createImageBitmap(await res.blob());
  const w = size || bmp.width;
  const h = size || bmp.height;
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return cx.getImageData(0, 0, w, h);
}

const SEA_TILE_PX = 128;
const OCEAN = Symbol('ocean');
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

// OpenFreeMap's versioned tile URL, resolved once (the vector worker reads the
// same TileJSON). A failed lookup is retried on the next slot.
const OFM_TILEJSON = 'https://tiles.openfreemap.org/planet';
let ofmTemplate = null;
async function ofmTileUrl(x, y, z) {
  ofmTemplate ??= fetch(OFM_TILEJSON).then((r) => (r.ok ? r.json() : null)).then((j) => j?.tiles?.[0] ?? null, () => null);
  const t = await ofmTemplate;
  if (!t) ofmTemplate = null;
  return t && t.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

/**
 * Browser sea-slot fetcher: the reference tile's pixels (the browser cache
 * usually holds them from the colour slot) and its vector water layer, in
 * parallel. Resolves to a deferred builder (`processSea` runs it, one per
 * frame) or null when either half is missing.
 */
export function seaSlotFetcher(getSource, seaSlotPx = R25_GROUND.colorRef.slotPx >> 1) {
  return async (x, y, z) => {
    const [img, vector] = await Promise.all([
      tilePixels(getSource, x, y, z, SEA_TILE_PX),
      ofmTileUrl(x, y, z)
        .then((url) => url && fetch(url, { mode: 'cors', credentials: 'omit' }))
        // OpenFreeMap answers 404 / 204 where it ships nothing: open ocean.
        .then((r) => (r?.ok && r.status !== 204 ? r.arrayBuffer() : r?.status === 404 || r?.status === 204 ? OCEAN : null)),
    ]);
    if (!img || !vector || img.width !== img.height) return null;
    const water = vector === OCEAN ? new Uint8Array(img.width * img.height).fill(1) : waterMaskFromTile(new Uint8Array(vector), img.width);
    return () => seaSlotFromPixels(img.data, img.width, img.height, water, seaSlotPx);
  };
}

