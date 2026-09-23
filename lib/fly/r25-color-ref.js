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

import {
  DataTexture,
  LinearFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { R25_GROUND } from './fly-constants';

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
  }

  /** GPU bytes (one RGBA8 texture, no mips). */
  bytes() {
    return this.px * this.px * 4;
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
          this.slots.set(k, { x: X, y: Y, state: 'want' });
        }
      }
    }
    this._pump();
    return moved;
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
    const src = getSource();
    if (!src || typeof src.getUrl !== 'function') return null;
    if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function') return null;
    const url = src.getUrl(x, y, z);
    if (!url || url.startsWith('data:')) return null; // toy's solid tile
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    const w = bmp.width;
    const h = bmp.height;
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    bmp.close?.();
    const img = cx.getImageData(0, 0, w, h);
    return downsampleToSlot(img.data, w, h, slotPx);
  };
}

