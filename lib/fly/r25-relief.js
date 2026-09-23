// R25 D GROUND — DEM RELIEF NORMAL MAPS (plan FLY_ROUND25_PLAN.md, role D §1).
//
// THE DEFECT. The satellite terrain's relief comes from per-VERTEX normals of a
// Martini-decimated mesh (z13 error 91 m: whole ridgelines collapse into one
// triangle) that three-tile computes last-writer (index.js `ee`). The FULL
// decoded DEM grid — 257^2 samples per LERC tile — is thrown away in the
// worker. So relief is both coarse and faceted exactly where the eye expects a
// hillside.
//
// THE FIX. When the request carries `r25Relief` (Visuals Enhanced), the DEM
// decode also returns a mapPx^2 RG8 normal map computed by CENTRAL DIFFERENCES
// over the full decoded grid (LERC: in the worker, lib/fly/vendor/three-tile/
// workers/skirt-tail.src.js `r25ReliefMap`; terrain-rgb — E's offline fixture —
// on the main thread from the grid the decode worker already returned, via
// `reliefFromGrid` below). The two implementations are the SAME algorithm and
// scripts/verify-r25-ground.mjs proves them byte-equal.
//
// FRAME. The map holds the WORLD-frame normal: world X = east, Y = up,
// Z = south (the tile mesh is rotated -90deg about X, so local (x, y, z) ->
// world (x, z, -y)). Horizontal units are the world's own (Web Mercator
// metres: a z tile spans 2*pi*6378137 / 2^z), heights are metres — exactly the
// frame the rendered geometry and its vertex normals live in, so the relief
// shading agrees with the silhouette. RG = (nx, nz) * 0.5 + 0.5; ny is
// reconstructed (a terrain normal always faces up).
//
// LAYOUT. CORNER-ALIGNED: texel i sits at u = i / (N - 1), data row j at
// v = j / (N - 1) (row 0 = SOUTH, three's flipY=false DataTexture). The edge
// texels are therefore the physical tile edge, which is what lets two
// same-LOD neighbours be STITCHED to one shared value (`stitchPair`). The
// shader maps vR25Uv * (1 - 1/N) + 0.5/N (world-bend.js r25ReliefGLSL).
//
// POOL. <= poolTiles DataTextures (RG8, mipmapped), LRU by last-VISIBLE frame
// (three-tile's R24 PATCH 26 stamp `_r24LastVisible`), bound into a
// per-material holder {uR25Relief, uR25HasRelief} (the attachLodFade idiom).
// An evicted tile falls back to its vertex normal (uR25HasRelief 0). The CPU
// bytes stay on the geometry (userData.r25Relief) so a re-bind needs no decode.

import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGFormat,
  ShaderChunk,
  UnsignedByteType,
} from 'three';
import { R25_GROUND } from './fly-constants';

// The mesh sub-flag's predicate, INSTALLED by lib/fly/r25-ground.js (which owns
// the world-bend import) so lib/fly/terrain-engine.js can latch it at engine
// creation through this leaf module — terrain-engine keeps importing only
// relative, alias-free modules. Uninstalled = false (the flag-off answer).
let _meshPredicate = null;
/** r25-ground.js installs `() => r25GroundOn('mesh')`. */
export function setR25MeshPredicate(fn) {
  _meshPredicate = typeof fn === 'function' ? fn : null;
}
/** Launch-time latch read by TerrainEngine's constructor. */
export function r25MeshLatched() {
  try {
    return !!_meshPredicate?.();
  } catch {
    return false;
  }
}

/** Web Mercator world width (metres) — three-tile's ProjMCT mapWidth. */
export const MERCATOR_WIDTH_M = 2 * Math.PI * 6378137;

/**
 * Normal map from a height grid. `dem` is row-major, row 0 = NORTH (both the
 * LERC/Martini grid and terrain-rgb's image rows), `w` x `h` samples covering
 * exactly the tile (x, y, z). Returns Uint8Array(N * N * 2), layout above.
 *
 * KEEP IN LOCK-STEP with `r25ReliefMap` in workers/skirt-tail.src.js — the
 * node gate diffs the two byte for byte.
 */
export function reliefFromGrid(dem, w, h, z, N = R25_GROUND.relief.mapPx) {
  const out = new Uint8Array(N * N * 2);
  if (!dem || w < 2 || h < 2 || dem.length < w * h || N < 2) return out;
  const span = MERCATOR_WIDTH_M / Math.pow(2, z);
  const sx = span / (w - 1); // world units per grid column (east)
  const sz = span / (h - 1); // world units per grid row (south)
  // Node gradients: central differences inside, one-sided on the border.
  const gx = new Float32Array(w * h);
  const gz = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    const r0 = r > 0 ? r - 1 : r;
    const r1 = r < h - 1 ? r + 1 : r;
    for (let c = 0; c < w; c++) {
      const c0 = c > 0 ? c - 1 : c;
      const c1 = c < w - 1 ? c + 1 : c;
      const k = r * w + c;
      gx[k] = (dem[r * w + c1] - dem[r * w + c0]) / ((c1 - c0) * sx);
      gz[k] = (dem[r1 * w + c] - dem[r0 * w + c]) / ((r1 - r0) * sz);
    }
  }
  const inv = 1 / (N - 1);
  for (let j = 0; j < N; j++) {
    const fy = (1 - j * inv) * (h - 1); // row 0 of the map = south = grid row h-1
    let y0 = Math.floor(fy);
    if (y0 > h - 2) y0 = h - 2;
    const ty = fy - y0;
    for (let i = 0; i < N; i++) {
      const fx = i * inv * (w - 1);
      let x0 = Math.floor(fx);
      if (x0 > w - 2) x0 = w - 2;
      const tx = fx - x0;
      const a = y0 * w + x0;
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      const ga = gx[a] + (gx[b] - gx[a]) * tx;
      const gb = gx[c] + (gx[d] - gx[c]) * tx;
      const za = gz[a] + (gz[b] - gz[a]) * tx;
      const zb = gz[c] + (gz[d] - gz[c]) * tx;
      const hx = ga + (gb - ga) * ty;
      const hz = za + (zb - za) * ty;
      const l = Math.sqrt(hx * hx + 1 + hz * hz);
      const o = (j * N + i) * 2;
      out[o] = Math.round((-hx / l * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((-hz / l * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

/** Decode one texel back to a unit world normal (the shader's algebra). */
export function decodeRelief(bytes, N, i, j) {
  const o = (j * N + i) * 2;
  const x = (bytes[o] / 255) * 2 - 1;
  const z = (bytes[o + 1] / 255) * 2 - 1;
  const y = Math.sqrt(Math.max(0, 1 - x * x - z * z));
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/**
 * Same-LOD edge stitching. `a` is the WEST (dir 'e': b is east of a) or the
 * NORTH (dir 's': b is south of a) tile. The shared physical edge becomes the
 * byte average in BOTH maps, so the two tiles sample the same normal at the
 * seam. Returns the number of texels changed.
 */
export function stitchPair(a, b, N, dir) {
  let n = 0;
  for (let k = 0; k < N; k++) {
    // 'e': a's east column (i = N-1) meets b's west column (i = 0), same row.
    // 's': a's SOUTH row (j = 0) meets b's NORTH row (j = N-1), same column.
    const ia = dir === 'e' ? (k * N + (N - 1)) * 2 : k * 2;
    const ib = dir === 'e' ? k * N * 2 : ((N - 1) * N + k) * 2;
    for (let c = 0; c < 2; c++) {
      const v = (a[ia + c] + b[ib + c] + 1) >> 1;
      if (a[ia + c] !== v || b[ib + c] !== v) n++;
      a[ia + c] = v;
      b[ib + c] = v;
    }
  }
  return n;
}

/**
 * The mip level of a tile's own map whose texel footprint matches ONE
 * reference texel (colour transfer: hi *= ref / textureLod(map, uv, lodK)).
 * A tile at z spans 2^(refZoom - z) reference tiles, so one reference tile
 * holds texPx * 2^(z - refZoom) of its texels against slotPx reference texels.
 */
export function lodKFor(tileZ, texPx = 256, refZoom = R25_GROUND.colorRef.zoom, slotPx = R25_GROUND.colorRef.slotPx) {
  const maxL = Math.log2(Math.max(1, texPx));
  const k = Math.log2(Math.max(1, texPx) / slotPx) + (tileZ - refZoom);
  return Math.min(maxL, Math.max(0, k));
}

/** GPU bytes of one relief texture with its full mip chain (RG8). */
export function reliefTextureBytes(N = R25_GROUND.relief.mapPx) {
  let b = 0;
  for (let s = N; s >= 1; s >>= 1) b += s * s * 2;
  return b;
}

/**
 * The per-material holder (the attachLodFade idiom): the uniform objects the
 * Enhanced tile program binds, plus three's own map chunk (world-bend splices
 * the colour/sharpen terms into it for a material with no LOD-fade slot).
 * Idempotent.
 */
export function r25HolderFor(material) {
  const ud = material.userData;
  if (!ud.__r25Ground) {
    ud.__r25Ground = {
      uR25Relief: { value: null },
      uR25HasRelief: { value: 0 },
      // (2^(refZoom - z), x * s, y * s, lodK); s = 0 means "not bound yet".
      uR25TileXf: { value: { x: 0, y: 0, z: 0, w: 0, isVector4: true } },
      chunk: ShaderChunk.map_fragment,
    };
  }
  return ud.__r25Ground;
}

function makeReliefTexture(N) {
  const t = new DataTexture(new Uint8Array(N * N * 2), N, N, RGFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.flipY = false;
  t.name = 'r25-relief';
  return t;
}

/**
 * The bounded relief texture pool.
 *
 * EVICTION NEVER THRASHES. A tile that is not visible (three-tile's parked
 * model, `model.visible === false`) is evicted first, least recently VISIBLE
 * first. A VISIBLE entry is only ever displaced by an incoming tile of a
 * strictly HIGHER zoom (nearer, bigger on screen), lowest zoom first — a
 * strict order with no cycle, so relief can never flip on and off between two
 * visible tiles. With nothing evictable the incoming tile keeps its vertex
 * normals (uR25HasRelief 0) until a slot frees.
 */
export class ReliefPool {
  constructor({ maxTiles = R25_GROUND.relief.poolTiles, mapPx = R25_GROUND.relief.mapPx, isVisible = null } = {}) {
    this.max = maxTiles;
    this.N = mapPx;
    this.entries = new Map(); // key -> { key, tex, holders:Set, data, tile, stamp }
    this.free = [];
    this.allocated = 0;
    this.stats = { binds: 0, evictions: 0, stitches: 0, peak: 0, refused: 0 };
    this._clock = 0;
    this.isVisible = isVisible || ((tile) => tile?.model?.visible !== false);
  }

  /** GPU bytes the pool owns right now (allocated textures, mip chains included). */
  bytes() {
    return this.allocated * reliefTextureBytes(this.N);
  }

  _stamp(e) {
    const v = e.tile?._r24LastVisible;
    return Number.isFinite(v) ? v * 1e6 + e.stamp : e.stamp;
  }

  _takeTexture(exceptKey, incomingZ = Infinity) {
    if (this.free.length) return this.free.pop();
    if (this.allocated < this.max) {
      this.allocated++;
      this.stats.peak = Math.max(this.stats.peak, this.allocated);
      return makeReliefTexture(this.N);
    }
    // 1) the least recently VISIBLE hidden entry; 2) else the lowest-zoom
    // visible entry, only if strictly below the incoming tile's zoom.
    let worst = null;
    let ws = Infinity;
    let low = null;
    let lz = Infinity;
    for (const e of this.entries.values()) {
      if (e.key === exceptKey) continue;
      if (!this.isVisible(e.tile)) {
        const s = this._stamp(e);
        if (s < ws) {
          ws = s;
          worst = e;
        }
      } else {
        const z = e.tile?.z ?? Infinity;
        if (z < lz || (z === lz && e.stamp < (low?.stamp ?? Infinity))) {
          lz = z;
          low = e;
        }
      }
    }
    if (!worst && low && lz < incomingZ) worst = low;
    if (!worst) {
      this.stats.refused++;
      return null;
    }
    this.stats.evictions++;
    this._unbind(worst);
    this.entries.delete(worst.key);
    return worst.tex;
  }

  _unbind(e) {
    for (const h of e.holders) {
      if (h.uR25Relief.value === e.tex) {
        h.uR25Relief.value = null;
        h.uR25HasRelief.value = 0;
      }
    }
    e.holders.clear();
  }

  has(key) {
    return this.entries.has(key);
  }

  /**
   * Bind `data` (the tile's CPU relief bytes) for tile `key` into `holders`.
   * Re-binding an existing key only (re)attaches holders and refreshes recency.
   * Returns the entry or null when the pool is exhausted.
   */
  bind(key, data, holders, tile = null) {
    let e = this.entries.get(key);
    if (!e) {
      if (!data || data.length !== this.N * this.N * 2) return null;
      const tex = this._takeTexture(key, tile?.z ?? Infinity);
      if (!tex) return null;
      tex.image.data = data; // the geometry's own bytes (stitching writes them)
      tex.needsUpdate = true;
      e = { key, tex, holders: new Set(), data, tile, stamp: 0 };
      this.entries.set(key, e);
      this.stats.binds++;
    } else if (data && data !== e.data && data.length === this.N * this.N * 2) {
      // The tile's geometry was replaced in place (a DEM refresh): new bytes.
      e.data = data;
      e.tex.image.data = data;
      e.tex.needsUpdate = true;
    }
    e.stamp = ++this._clock;
    if (tile) e.tile = tile;
    for (const h of holders) {
      h.uR25Relief.value = e.tex;
      h.uR25HasRelief.value = 1;
      e.holders.add(h);
    }
    return e;
  }

  /** Stitch `key` with its bound same-LOD neighbours (keys from `neighbourKey`). */
  stitch(key, neighbourKey) {
    const e = this.entries.get(key);
    if (!e) return 0;
    let n = 0;
    for (const [dx, dy, dir, west] of [
      [1, 0, 'e', true],
      [-1, 0, 'e', false],
      [0, 1, 's', true],
      [0, -1, 's', false],
    ]) {
      const o = this.entries.get(neighbourKey(dx, dy));
      if (!o) continue;
      const k = west ? stitchPair(e.data, o.data, this.N, dir) : stitchPair(o.data, e.data, this.N, dir);
      if (k) {
        o.tex.needsUpdate = true;
        n += k;
      }
    }
    // Corners are shared by up to FOUR tiles; pairwise stitching leaves them
    // one texel apart, so set each to the byte mean of every bound owner.
    // [corner i, j of `e`] -> the other owners' (dx, dy, i, j).
    const L = this.N - 1;
    for (const [ci, cj, others] of [
      [L, L, [[1, 0, 0, L], [0, -1, L, 0], [1, -1, 0, 0]]], // NE
      [0, L, [[-1, 0, L, L], [0, -1, 0, 0], [-1, -1, L, 0]]], // NW
      [L, 0, [[1, 0, 0, 0], [0, 1, L, L], [1, 1, 0, L]]], // SE
      [0, 0, [[-1, 0, L, 0], [0, 1, 0, L], [-1, 1, L, L]]], // SW
    ]) {
      const owners = [[e, ci, cj]];
      for (const [dx, dy, i, j] of others) {
        const o = this.entries.get(neighbourKey(dx, dy));
        if (o) owners.push([o, i, j]);
      }
      if (owners.length < 2) continue;
      for (let c = 0; c < 2; c++) {
        let sum = 0;
        for (const [o, i, j] of owners) sum += o.data[(j * this.N + i) * 2 + c];
        const v = Math.round(sum / owners.length);
        for (const [o, i, j] of owners) {
          const k = (j * this.N + i) * 2 + c;
          if (o.data[k] !== v) {
            o.data[k] = v;
            o.tex.needsUpdate = true;
            n++;
          }
        }
      }
    }
    if (n) {
      e.tex.needsUpdate = true;
      this.stats.stitches++;
    }
    return n;
  }

  release(key) {
    const e = this.entries.get(key);
    if (!e) return;
    this._unbind(e);
    this.entries.delete(key);
    // Drop the reference to the (disposed) geometry's bytes; the next bind
    // replaces the image data before any upload.
    e.tex.image.data = (this._blank ??= new Uint8Array(this.N * this.N * 2));
    this.free.push(e.tex);
  }

  /** Drop every texture (Classic toggle / engine teardown). Holders fall back. */
  dispose() {
    for (const e of this.entries.values()) {
      this._unbind(e);
      e.tex.dispose();
    }
    for (const t of this.free) t.dispose();
    this.entries.clear();
    this.free.length = 0;
    this.allocated = 0;
  }
}
