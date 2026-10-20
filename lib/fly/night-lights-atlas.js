/**
 * LIVING WORLD — NIGHT_LIGHTS (FLY_LIVING_WORLD.md; TRUE_EARTH_PASS.md Phase 2):
 * distant cities at night.
 *
 * WHY. The generated night is local: night-ground's light map spans ±1 km,
 * the satellite road ring reaches 12 km and culls above 5.2 km AGL, building
 * windows go above 3 km AGL and skyline windows by 9 km. Beyond that the
 * ground is black, so from cruise at night only the city under you exists.
 * This adds the measured night: NASA's VIIRS "Black Marble" composite from
 * GIBS (keyless, public domain, CORS *), added by the Enhanced aerial pass as
 * emission where the generated lights end, before the haze.
 *
 * WHICH LAYER. VIIRS_Black_Marble (2016) over VIIRS_CityLights_2012: the 2012
 * product is a heavily bloomed visualisation (light spills kilometres over
 * Lake Michigan, a quarter of the Northeast corridor sits above 200/255) with
 * JPEG blocks; Black Marble is crisp, keeps water black at the shore and has
 * the wider range. Its moonlit land, snow and sea are blue-grey and the
 * lights warm to white, so nightLightsKey() separates them by colour.
 *
 * ATLAS (cloned from earth-surface-engine's _select/_pump). One band per zoom
 * (z6/z7/z8), each a 4x4 window of 256 px slots around the camera, TOROIDAL:
 * tile (X, Y) lives in slot (X mod 4, Y mod 4), so a window step invalidates
 * one row or column. All bands share ONE R8 DataArrayTexture (a layer each;
 * RepeatWrapping per layer keeps bilinear filtering geographic across slot
 * boundaries), and a commit uploads only its own 256² rectangle
 * (copyTextureToTexture's texSubImage3D branch, from a staging view of the
 * same CPU array, the earth-surface idiom). No mips: the shader picks the
 * band by the pixel's ground footprint and averages taps along the ray in
 * the coarsest band, decoding each to linear first (a mip of the encoded
 * value would darken an isolated town several times over).
 *
 * WHEN. Fetched only while the flag is on, the profile is Enhanced, the tier
 * allows it and the sun is below fetchElDeg; everything is released after
 * releaseSec of day. Fetches are abortable (a window step aborts the slot it
 * replaces). A 4xx is "nothing there" (black, final), a network failure is no
 * lights and a retry later, and offlineAfter failures with no success pause
 * the source for offlineSec. The offline fixture never fetches.
 */
import {
  Box2,
  DataArrayTexture,
  DataTexture,
  LinearFilter,
  NoColorSpace,
  RedFormat,
  RepeatWrapping,
  UnsignedByteType,
  Vector3,
  Vector4,
} from 'three';
import { livingWorldBlock, livingWorldOn } from './living-world';

export const NL_WORLD = 40075016.68557849;
const HALF = NL_WORLD / 2;
/** Every periodic pattern here repeats over this many scene units (a rebase never moves one). */
export const NL_PERIOD = 65536;
const mod = (n, d) => ((n % d) + d) % d;
const clamp01 = (v) => (v <= 0 ? 0 : v >= 1 ? 1 : Number.isFinite(v) ? v : 0);
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

const DEFAULTS = {
  enabled: false,
  url: '',
  key: { ratio: [0.62, 0.95], black: 10 },
  bands: [6, 7, 8],
  bandsPhone: [6, 7],
  slotPx: 256,
  maxRequests: 4,
  retrySec: [15, 60, 300],
  offlineAfter: 8,
  offlineSec: 300,
  fetchElDeg: 6,
  releaseElDeg: 10,
  releaseSec: 60,
  fadeSec: 1.5,
  nightElDeg: [1, -8],
  rangeLowM: [7000, 13000],
  rangeHighM: [0, 1500],
  aglM: [3000, 5200],
  heightGateM: [2500, 4000],
  gain: 2.4,
  gamma: 2.2,
  aniso: 0.6,
  edgeTiles: 0.15,
  sodium: [1, 0.53, 0.17],
  led: [1, 0.8, 0.58],
  ledMix: [0.12, 0.7],
  tintCellM: 3000,
};
/** The block with defaults for anything a partial pin leaves out. */
export function resolveNightLights(block) {
  const b = block ?? {};
  return { ...DEFAULTS, ...b, key: { ...DEFAULTS.key, ...(b.key ?? {}) } };
}
/** On for this page load (lib/fly/living-world.js, the one reader). */
export const NIGHT_LIGHTS_ON = livingWorldOn('NIGHT_LIGHTS');
export const NL = resolveNightLights(livingWorldBlock('NIGHT_LIGHTS'));

// ---------------------------------------------------------------------------
// Pure helpers (scripts/verify-living-ground.mjs drives these directly).
// ---------------------------------------------------------------------------

/** Absolute scene position (Web Mercator metres; x east, z south) of a lon/lat. */
export function geoToScene(lon, lat) {
  const R = NL_WORLD / (2 * Math.PI);
  const la = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  return { x: (R * lon * Math.PI) / 180, z: -R * Math.log(Math.tan(Math.PI / 4 + la / 2)) };
}

/** Fractional XYZ tile coordinates (GIBS / Google order: y = 0 at the north) of a scene position. */
export function sceneToTile(x, z, zoom) {
  const span = NL_WORLD / 2 ** zoom;
  return { tx: (x + HALF) / span, ty: (z + HALF) / span };
}

/**
 * First tile of a 4-wide window on one axis. Held while the camera keeps at
 * least `margin` tiles on both sides, re-centred otherwise (to 1.5-2.5 tiles
 * either side), so flying back and forth over a tile edge never thrashes.
 */
export function windowStart(prev, t, margin = 1.2) {
  if (Number.isFinite(prev) && t >= prev + margin && t <= prev + 4 - margin) return prev;
  return Math.floor(t - 1.5);
}

/** The toroidal slot of absolute tile (X, Y): row-major 4x4. */
export const slotIndex = (X, Y) => mod(Y, 4) * 4 + mod(X, 4);

/** The lights' night weight from the true sun elevation (0 at nightElDeg[0], 1 at [1]). */
export function nightLightsWeight(elDeg, cfg = NL) {
  return smooth(cfg.nightElDeg[0], cfg.nightElDeg[1], elDeg);
}

/**
 * The range ramp [start, end] in true metres from the camera at an eye AGL:
 * rangeLowM below aglM[0] (the generated roads and skyline windows cover the
 * near city), rangeHighM above aglM[1] (they have culled; the measured layer
 * takes the whole view).
 */
export function nightLightsRange(aglM, cfg = NL) {
  const t = smooth(cfg.aglM[0], cfg.aglM[1], aglM);
  return [mix(cfg.rangeLowM[0], cfg.rangeHighM[0], t), mix(cfg.rangeLowM[1], cfg.rangeHighM[1], t)];
}

/**
 * Emission key of one RGBA8 GIBS tile into R8 (display-encoded: the shader
 * decodes with `gamma`). Luminance above the black level, times a warmth key
 * on (R+1)/(B+1): Black Marble's moonlit ground, snow, desert and sea sit at
 * 0.3-0.6, lights at 1.0 (saturated white) to 2.0 (sodium orange).
 */
export function nightLightsKey(rgba, n, key = NL.key, out = new Uint8Array(n)) {
  const r0 = key.ratio[0];
  const span = Math.max(1e-6, key.ratio[1] - r0);
  const black = key.black;
  const inv = 1 / Math.max(1, 255 - black);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    let k = ((r + 1) / (b + 1) - r0) / span;
    k = k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
    let v = (0.2126 * r + 0.7152 * g + 0.0722 * b - black) * inv;
    v = v <= 0 ? 0 : v >= 1 ? 1 : v;
    out[i] = Math.round(v * k * 255);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The atlas.
// ---------------------------------------------------------------------------

const _region = new Box2();
const _at = new Vector3();
const now0 = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

export class NightLightsAtlas {
  /**
   * `bands` are zooms coarse to fine (one texture layer each).
   * `fetchTile(z, x, y, signal)` resolves to Uint8Array(slotPx²) of keyed
   * emission, null for "nothing there", or rejects (network failure).
   */
  constructor({ bands, slotPx = 256, maxRequests = 4, fetchTile = null, retrySec = [15, 60, 300], offlineAfter = 8, offlineSec = 300, fadeSec = 1.5, clock = now0 } = {}) {
    this.slot = slotPx;
    this.side = slotPx * 4;
    this.layers = Math.max(1, bands.length);
    this.maxRequests = maxRequests;
    this.fetchTile = fetchTile;
    this.retrySec = retrySec;
    this.offlineAfter = offlineAfter;
    this.offlineSec = offlineSec;
    this.fadeSec = Math.max(1e-3, fadeSec);
    this.clock = clock;
    this.bands = bands.map((z, i) => ({
      z, i, span: NL_WORLD / 2 ** z, minX: NaN, minY: NaN, tx: 0, ty: 0,
      slots: Array.from({ length: 16 }, () => ({ key: null, gen: 0, state: 'empty', retryAt: 0, tries: 0, born: 0, ctl: null })),
    }));
    this.data = new Uint8Array(this.side * this.side * this.layers);
    const t = (this.texture = new DataArrayTexture(this.data, this.side, this.side, this.layers));
    t.format = RedFormat;
    t.type = UnsignedByteType;
    t.colorSpace = NoColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.magFilter = t.minFilter = LinearFilter;
    t.generateMipmaps = false;
    t.flipY = false;
    t.unpackAlignment = 1;
    t.name = 'night-lights-atlas';
    t.needsUpdate = true;
    // The same bytes seen as one tall 2D image (layer-major = row-major), never
    // rendered: copyTextureToTexture takes its CPU branch and uploads one
    // slot rectangle with UNPACK_SKIP_ROWS = layer * side + row.
    this.staging = new DataTexture(this.data, this.side, this.side * this.layers, RedFormat, UnsignedByteType);
    this.staging.unpackAlignment = 1;
    this.staging.flipY = false;
    this.staging.name = 'night-lights-staging';
    this.dirty = [];
    this.queue = [];
    this.inflight = 0;
    this.nextSelect = 0;
    this.ready = new Float32Array(48);
    this.fails = 0;
    this.successes = 0;
    this.offlineUntil = 0;
    this.disposed = false;
    this.stats = { requested: 0, loaded: 0, noData: 0, failed: 0, aborted: 0, uploads: 0, fullUploads: 0, offline: false, lastError: null };
  }

  /** GPU bytes (one R8 array texture, no mips). */
  bytes() {
    return this.data.byteLength;
  }

  /** Follow the camera (absolute scene x/z) and top up the requests. */
  update(x, z, now = this.clock()) {
    if (this.disposed || !Number.isFinite(x) || !Number.isFinite(z)) return;
    let moved = false;
    for (const b of this.bands) {
      b.tx = (x + HALF) / b.span;
      b.ty = (z + HALF) / b.span;
      const mx = windowStart(b.minX, b.tx);
      const my = windowStart(b.minY, b.ty);
      if (mx !== b.minX || my !== b.minY) {
        b.minX = mx;
        b.minY = my;
        moved = true;
      }
    }
    if (moved || now >= this.nextSelect) {
      this.nextSelect = now + 0.5;
      this._select(now);
    }
    this._pump(now);
    this._weights(now);
  }

  _select(now) {
    const queue = [];
    const nb = this.bands.length;
    for (const b of this.bands) {
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 4; dx++) {
          const X = b.minX + dx, Y = b.minY + dy, idx = slotIndex(X, Y), s = b.slots[idx];
          const key = `${b.z}/${X}/${Y}`;
          if (s.key !== key) {
            if (s.ctl) {
              s.ctl.abort();
              s.ctl = null;
              this.stats.aborted++;
            }
            if (s.state === 'ready') this._clearSlot(b, idx);
            s.key = key;
            s.gen++;
            s.state = 'empty';
            s.retryAt = 0;
            s.tries = 0;
            s.born = 0;
          }
          if (s.state === 'empty' || (s.state === 'error' && now >= s.retryAt)) {
            // Ring 0 is the camera's own tile, 1 its neighbours...; nearest ring
            // first, within a ring the coarse band (it covers the most view),
            // then the nearer tile centre.
            const ring = Math.max(Math.abs(X - Math.floor(b.tx)), Math.abs(Y - Math.floor(b.ty)));
            const d = Math.hypot(X + 0.5 - b.tx, Y + 0.5 - b.ty);
            queue.push({ b, idx, key, X, Y, gen: s.gen, pri: ring * nb + b.i + Math.min(0.99, d * 0.1) });
          }
        }
      }
    }
    queue.sort((p, q) => p.pri - q.pri);
    this.queue = queue;
  }

  _pump(now) {
    if (!this.fetchTile || now < this.offlineUntil) return;
    while (!this.disposed && this.inflight < this.maxRequests && this.queue.length) {
      const job = this.queue.shift();
      const s = job.b.slots[job.idx];
      if (s.key !== job.key || s.gen !== job.gen || (s.state !== 'empty' && s.state !== 'error')) continue;
      const n = 2 ** job.b.z;
      if (job.Y < 0 || job.Y >= n) {
        s.state = 'no-data';
        s.born = now;
        this.stats.noData++;
        continue;
      }
      s.state = 'loading';
      this.inflight++;
      this.stats.requested++;
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      s.ctl = ctl;
      Promise.resolve()
        .then(() => this.fetchTile(job.b.z, mod(job.X, n), job.Y, ctl ? ctl.signal : null))
        .then((bytes) => this._arrive(job, s, ctl, bytes, null), (err) => this._arrive(job, s, ctl, null, err || new Error('fetch failed')));
    }
  }

  _arrive(job, s, ctl, bytes, err) {
    this.inflight--;
    if (s.ctl === ctl) s.ctl = null;
    if (this.disposed || s.key !== job.key || s.gen !== job.gen) return; // replaced or released
    if (err && (err.name === 'AbortError' || ctl?.signal?.aborted)) return;
    const now = this.clock();
    if (!err && bytes && bytes.length !== this.slot * this.slot) err = new Error(`slot size ${bytes.length}`);
    if (err) {
      s.state = 'error';
      s.tries++;
      s.retryAt = now + this.retrySec[Math.min(s.tries - 1, this.retrySec.length - 1)];
      this.stats.failed++;
      this.stats.lastError = String(err.message ?? err).slice(0, 160);
      this.fails++;
      if (this.successes === 0 && this.fails >= this.offlineAfter) {
        // Blocked host (the fixture, an office proxy, no network): stop asking.
        this.offlineUntil = now + this.offlineSec;
        this.fails = 0;
        this.stats.offline = true;
      }
      return;
    }
    this.fails = 0;
    this.stats.offline = false;
    s.born = now;
    if (!bytes) {
      s.state = 'no-data';
      this.stats.noData++;
      return;
    }
    this.successes++;
    this._writeSlot(job.b, job.idx, bytes);
    s.state = 'ready';
    this.stats.loaded++;
  }

  _slotRect(b, idx) {
    return [(idx % 4) * this.slot, Math.floor(idx / 4) * this.slot, b.i * this.side * this.side];
  }

  _writeSlot(b, idx, bytes) {
    const [sx, sy, base] = this._slotRect(b, idx), s = this.slot, w = this.side;
    for (let y = 0; y < s; y++) this.data.set(bytes.subarray(y * s, (y + 1) * s), base + (sy + y) * w + sx);
    this.dirty.push(sx, b.i * w + sy, s, s, b.i);
  }

  _clearSlot(b, idx) {
    const [sx, sy, base] = this._slotRect(b, idx), s = this.slot, w = this.side;
    for (let y = 0; y < s; y++) this.data.fill(0, base + (sy + y) * w + sx, base + (sy + y) * w + sx + s);
    this.dirty.push(sx, b.i * w + sy, s, s, b.i);
  }

  _weights(now) {
    this.ready.fill(0);
    for (const b of this.bands) {
      if (b.i > 2) continue; // the shader carries three bands
      for (let i = 0; i < 16; i++) {
        const s = b.slots[i];
        if (s.state === 'ready' || s.state === 'no-data') this.ready[b.i * 16 + i] = clamp01((now - s.born) / this.fadeSec);
      }
    }
  }

  /** Upload this frame's committed slots (before the pass samples the atlas). */
  flush(renderer) {
    if (!this.dirty.length || this.disposed) return 0;
    const t = this.texture, d = this.dirty;
    if (!renderer?.copyTextureToTexture || !renderer.properties?.has?.(t) || t.version === 0) {
      // No GPU copy yet: the first bind uploads the whole (current) array.
      t.needsUpdate = true;
      d.length = 0;
      this.stats.fullUploads++;
      return 1;
    }
    let n = 0;
    for (let i = 0; i < d.length; i += 5) {
      _region.min.set(d[i], d[i + 1]);
      _region.max.set(d[i] + d[i + 2], d[i + 1] + d[i + 3]);
      renderer.copyTextureToTexture(this.staging, t, _region, _at.set(d[i], d[i + 1] - d[i + 4] * this.side, d[i + 4]));
      n++;
    }
    d.length = 0;
    this.stats.uploads += n;
    return n;
  }

  /** Slot census by state (stats / gates). */
  census() {
    const c = { ready: 0, loading: 0, empty: 0, error: 0, noData: 0 };
    for (const b of this.bands) for (const s of b.slots) c[s.state === 'no-data' ? 'noData' : s.state]++;
    return c;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const b of this.bands) {
      for (const s of b.slots) {
        if (s.ctl) {
          s.ctl.abort();
          s.ctl = null;
        }
      }
    }
    this.queue = [];
    this.dirty.length = 0;
    this.texture.dispose();
    this.staging.dispose();
  }
}

/**
 * The browser fetcher: GIBS PNG → ImageBitmap → 2D canvas → keyed R8. A 4xx
 * resolves null (nothing there); a network or 5xx failure rejects.
 */
export function gibsFetcher(url = NL.url, key = NL.key, slotPx = NL.slotPx) {
  let canvas = null;
  let ctx = null;
  return async (z, x, y, signal) => {
    if (!url || typeof fetch !== 'function' || typeof createImageBitmap !== 'function') return null;
    const res = await fetch(url.replace('{z}', z).replace('{y}', y).replace('{x}', x), { mode: 'cors', credentials: 'omit', signal: signal ?? undefined });
    if (res.status >= 400 && res.status < 500) return null;
    if (!res.ok) throw new Error(`GIBS ${res.status}`);
    const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    try {
      if (!ctx) {
        canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(slotPx, slotPx) : Object.assign(document.createElement('canvas'), { width: slotPx, height: slotPx });
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      }
      if (!ctx) return null;
      ctx.clearRect(0, 0, slotPx, slotPx);
      ctx.drawImage(bmp, 0, 0, slotPx, slotPx);
      return nightLightsKey(ctx.getImageData(0, 0, slotPx, slotPx).data, slotPx * slotPx, key);
    } finally {
      bmp.close?.();
    }
  };
}

// ---------------------------------------------------------------------------
// The shader side (Enhanced aerial pass).
// ---------------------------------------------------------------------------

/** Shared uniform holders (the live pass and its prewarm twin bind the same objects). */
export const NIGHT_LIGHTS_UNIFORMS = {
  uNLAtlas: { value: null },
  // Per band (coarse to fine): xy window origin (rebased scene units), z 1/tile span (scene), w layer (-1 absent).
  uNLBandA: { value: new Float32Array([0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0, -1]) },
  // Per band: xy slot of the window's first tile (mod 4), z 1/texel (true metres), w -.
  uNLBandB: { value: new Float32Array(12) },
  // Per-slot arrival weights (band * 16 + slot).
  uNLReady: { value: new Float32Array(48) },
  // x strength (gain * night), y/z range ramp (true m), w decode gamma.
  uNL: { value: new Vector4(0, 7000, 13000, 2.2) },
  // x/y height gate (m above the damped ground), z anisotropy, w window edge fade (tiles).
  uNLGate: { value: new Vector4(2500, 4000, 0.6, 0.15) },
  // x/y LED share (low, high), z/w tint-noise phase (scene units, mod NL_PERIOD).
  uNLTint: { value: new Vector4(0.12, 0.7, 0, 0) },
  // x 1/tint cell (scene units), y tint-noise period (cells), z/w -.
  uNLMisc: { value: new Vector4(1 / 4096, 16, 0, 0) },
  uNLSodium: { value: new Vector3(1, 0.53, 0.17) },
  uNLLed: { value: new Vector3(1, 0.8, 0.58) },
};

/**
 * Declarations + `nlEmission(world, distM, dir, trueY, dXZ)`: the city light
 * leaving a terrain point (scene-linear radiance, before haze and exposure).
 * Reads the pass's own uniforms (uGroundY, uBendK, uTanHalfFov, uLivingAir)
 * and postprocessing's `resolution`. textureLod only: no derivatives, so it is
 * safe after the pass's per-pixel early-outs.
 */
export const NIGHT_LIGHTS_GLSL = /* glsl */ `
uniform highp sampler2DArray uNLAtlas;
uniform vec4 uNLBandA[3];
uniform vec4 uNLBandB[3];
uniform vec4 uNLReady[12];
uniform vec4 uNL;
uniform vec4 uNLGate;
uniform vec4 uNLTint;
uniform vec4 uNLMisc;
uniform vec3 uNLSodium;
uniform vec3 uNLLed;
float nlHash(vec2 c){
  vec3 q=fract(vec3(c.xyx)*vec3(.1031,.1030,.0973));
  q+=dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
float nlValue(vec2 p,float period){
  vec2 i=floor(p),f=p-i,u=f*f*(3.-2.*f);
  vec2 i0=mod(i,period),i1=mod(i+1.,period);
  return mix(mix(nlHash(i0),nlHash(vec2(i1.x,i0.y)),u.x),mix(nlHash(vec2(i0.x,i1.y)),nlHash(i1),u.x),u.y);
}
// One band: decoded linear light at xz (taps spread along the ray when the
// footprint outgrows a texel), and its cover (arrival * inside * edge fade).
float nlBand(int b,vec2 xz,vec2 alongXZ,float taps,out float cover){
  cover=0.;
  vec4 A=uNLBandA[b];
  if(A.w<0.)return 0.;
  vec2 t=(xz-A.xy)*A.z;
  if(t.x<0.||t.y<0.||t.x>=4.||t.y>=4.)return 0.;
  vec4 B=uNLBandB[b];
  vec2 tile=floor(t);
  int sx=int(mod(B.x+tile.x,4.)),sy=int(mod(B.y+tile.y,4.));
  vec2 e=clamp(min(t,4.-t)/max(uNLGate.w,1.0e-3),0.,1.);
  cover=uNLReady[b*4+sy][sx]*e.x*e.y;
  vec2 uv=(B.xy+t)*.25,du=alongXZ*A.z*.25;
  float v=pow(textureLod(uNLAtlas,vec3(uv,A.w),0.).r,uNL.w);
  if(taps>1.5){
    v+=pow(textureLod(uNLAtlas,vec3(uv+du*.33,A.w),0.).r,uNL.w);
    v+=pow(textureLod(uNLAtlas,vec3(uv-du*.33,A.w),0.).r,uNL.w);
    v*=1./3.;
  }
  return v;
}
vec3 nlEmission(vec3 world,float distM,vec3 dir,float trueY,float dXZ){
  if(uNL.x<=0.)return vec3(0.);
  float k=smoothstep(uNL.y,uNL.z,distM)*(1.-smoothstep(uNLGate.x,uNLGate.y,trueY-uGroundY));
  if(k<=0.)return vec3(0.);
  // Ground footprint of one pixel in true metres: across the ray it is the
  // pixel angle times the distance; along it, that over the grazing angle
  // (the view's own slope plus the curved ground's tilt toward the eye).
  float pix=2.*uTanHalfFov/max(resolution.y,1.);
  float graze=max(abs(dir.y)+2.*uBendK*dXZ*uLivingAir.y,.015);
  float across=distM*pix,along=across/graze;
  float fp=pow(along,uNLGate.z)*pow(across,1.-uNLGate.z);
  vec2 h=dir.xz;
  float hl=length(h);
  vec2 alongXZ=hl>1.0e-4?h/hl*along*uLivingAir.y:vec2(0.);
  float c0,c1,c2;
  // Coarse to fine: each finer band covers the coarser one where it has the
  // pixel's detail (footprint under ~a texel) and where its slot has arrived.
  float v=nlBand(0,world.xz,alongXZ,along*uNLBandB[0].z>1.5?3.:1.,c0)*c0;
  float v1=nlBand(1,world.xz,alongXZ,1.,c1);
  v=mix(v,v1,c1*(1.-smoothstep(.75,1.5,fp*uNLBandB[1].z)));
  float v2=nlBand(2,world.xz,alongXZ,1.,c2);
  v=mix(v,v2,c2*(1.-smoothstep(.75,1.5,fp*uNLBandB[2].z)));
  if(v<=0.)return vec3(0.);
  // Sodium to LED by neighbourhood (a slow world-space field) and brightness:
  // cores read whiter, outskirts orange. Each tint carries luminance 1.
  float n=nlValue((world.xz+uNLTint.zw)*uNLMisc.x,uNLMisc.y);
  float led=clamp(mix(uNLTint.x,uNLTint.y,n)+.35*(sqrt(v)-.4),0.,1.);
  vec3 tint=mix(uNLSodium,uNLLed,led);
  tint/=max(dot(tint,vec3(.2126,.7152,.0722)),1.0e-3);
  return tint*(v*uNL.x*k);
}
`;

// ---------------------------------------------------------------------------
// The per-frame driver (called from the aerial pass's own update()).
// ---------------------------------------------------------------------------

const _drv = { atlas: null, bandsKey: '', idle: 0, frame: -1, fetcher: null };
/** Live state for stats, harnesses and the device report. */
export const NIGHT_LIGHTS_STATS = { on: NIGHT_LIGHTS_ON, live: false, strength: 0, night: 0, range: [0, 0], bands: [], slots: null, atlasBytes: 0, fetch: null };

/**
 * One frame. ctx: { frame, now, dt, renderer, cinema, tier, phone, fixture,
 * origin: {x, z} | null (floating-origin anchor), camX, camY, camZ (rebased),
 * groundY, kMerc, sunSinEl }. Writes NIGHT_LIGHTS_UNIFORMS; returns nothing.
 */
export function stepNightLights(ctx, cfg = NL) {
  if (!NIGHT_LIGHTS_ON || !ctx || ctx.frame === _drv.frame) return;
  _drv.frame = ctx.frame;
  const U = NIGHT_LIGHTS_UNIFORMS;
  const el = (Math.asin(Math.max(-1, Math.min(1, ctx.sunSinEl ?? 1))) * 180) / Math.PI;
  const bands = ctx.phone ? cfg.bandsPhone : cfg.bands;
  const live = !!ctx.cinema && ctx.tier !== 'low' && !!ctx.origin && bands.length > 0;
  const keep = live && !ctx.fixture && el < cfg.releaseElDeg;
  const fetchNow = keep && el < cfg.fetchElDeg;
  const key = bands.join(',');
  if (_drv.atlas && (_drv.bandsKey !== key || (!keep && (_drv.idle += ctx.dt ?? 0) > cfg.releaseSec))) releaseNightLights();
  if (keep) _drv.idle = 0;
  if (fetchNow && !_drv.atlas) {
    _drv.fetcher ??= gibsFetcher(cfg.url, cfg.key, cfg.slotPx);
    _drv.atlas = new NightLightsAtlas({
      bands, slotPx: cfg.slotPx, maxRequests: cfg.maxRequests, fetchTile: _drv.fetcher,
      retrySec: cfg.retrySec, offlineAfter: cfg.offlineAfter, offlineSec: cfg.offlineSec, fadeSec: cfg.fadeSec,
    });
    _drv.bandsKey = key;
  }
  const a = _drv.atlas;
  const night = nightLightsWeight(el, cfg);
  const strength = live && a ? cfg.gain * night : 0;
  if (a && live) {
    const o = ctx.origin;
    if (fetchNow) a.update(ctx.camX + o.x, ctx.camZ + o.z, ctx.now);
    else a._weights(ctx.now ?? a.clock());
    a.flush(ctx.renderer);
  }
  U.uNL.value.x = strength;
  NIGHT_LIGHTS_STATS.live = !!a && live;
  NIGHT_LIGHTS_STATS.strength = strength;
  NIGHT_LIGHTS_STATS.night = night;
  if (strength <= 0) {
    U.uNLAtlas.value = a?.texture ?? null;
    return;
  }
  const o = ctx.origin;
  const k = Number.isFinite(ctx.kMerc) && ctx.kMerc > 0 ? ctx.kMerc : 1;
  const A = U.uNLBandA.value, B = U.uNLBandB.value;
  for (let i = 0; i < 3; i++) {
    const b = a.bands[i];
    if (!b || !Number.isFinite(b.minX)) {
      A[i * 4 + 3] = -1;
      continue;
    }
    A[i * 4] = b.minX * b.span - HALF - o.x;
    A[i * 4 + 1] = b.minY * b.span - HALF - o.z;
    A[i * 4 + 2] = 1 / b.span;
    A[i * 4 + 3] = b.i;
    B[i * 4] = mod(b.minX, 4);
    B[i * 4 + 1] = mod(b.minY, 4);
    B[i * 4 + 2] = (a.slot * k) / b.span;
  }
  U.uNLReady.value.set(a.ready);
  const range = nightLightsRange(ctx.camY - ctx.groundY, cfg);
  U.uNL.value.set(strength, range[0], range[1], cfg.gamma);
  U.uNLGate.value.set(cfg.heightGateM[0], cfg.heightGateM[1], cfg.aniso, cfg.edgeTiles);
  // In scene units, so the field never re-scales (and steps) with latitude.
  const cell = NL_PERIOD / Math.max(1, Math.round(NL_PERIOD / Math.max(64, cfg.tintCellM)));
  U.uNLTint.value.set(cfg.ledMix[0], cfg.ledMix[1], mod(o.x, NL_PERIOD), mod(o.z, NL_PERIOD));
  U.uNLMisc.value.set(1 / cell, NL_PERIOD / cell, 0, 0);
  U.uNLSodium.value.fromArray(cfg.sodium);
  U.uNLLed.value.fromArray(cfg.led);
  U.uNLAtlas.value = a.texture;
  NIGHT_LIGHTS_STATS.range = range;
}

/** Drop the atlas (GPU texture, CPU bytes, in-flight requests). */
export function releaseNightLights() {
  _drv.atlas?.dispose();
  _drv.atlas = null;
  _drv.bandsKey = '';
  _drv.idle = 0;
  NIGHT_LIGHTS_UNIFORMS.uNLAtlas.value = null;
  NIGHT_LIGHTS_UNIFORMS.uNL.value.x = 0;
  NIGHT_LIGHTS_STATS.live = false;
  NIGHT_LIGHTS_STATS.strength = 0;
}

/** Refresh NIGHT_LIGHTS_STATS' census (cheap; harness/diagnostic reads). */
export function nightLightsStats() {
  const a = _drv.atlas;
  NIGHT_LIGHTS_STATS.bands = a ? a.bands.map((b) => ({ z: b.z, minX: b.minX, minY: b.minY })) : [];
  NIGHT_LIGHTS_STATS.slots = a ? a.census() : null;
  NIGHT_LIGHTS_STATS.atlasBytes = a ? a.bytes() : 0;
  NIGHT_LIGHTS_STATS.fetch = a ? { ...a.stats, inflight: a.inflight, queued: a.queue.length } : null;
  return NIGHT_LIGHTS_STATS;
}

/** Test seam: the node gate drives the driver without a renderer. */
export const __nightLightsInternals = { _drv };
