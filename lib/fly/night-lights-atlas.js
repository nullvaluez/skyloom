/**
 * LIVING WORLD (GROUND) — NIGHT_LIGHTS: real city lights from altitude.
 *
 * THE GAP. The generated city lights (road ribbons and lamp pools, windows,
 * the skyline) live in rings a few kilometres across and switch off on the
 * climb (roads above 4.2–5.2 km AGL, the skyline above 7.5–9 km), so at night
 * every city beyond ~10 km, and every city at all from cruise, was dark.
 *
 * THE SOURCE. NASA GIBS's VIIRS Black Marble (lib/fly/tile-sources.js
 * NIGHT_LIGHTS_SOURCE): z8 tiles, ~470 m per texel at 40°N. Sixteen of them sit
 * in a 4×4 TOROIDAL atlas (the `_select`/`_pump` shape of
 * earth-surface-engine.js): slot = tile index mod 4 on each axis, so a window
 * shift only refills the column or row that left, and with RepeatWrapping
 * every interior neighbour is a texture neighbour, mipmaps included. The
 * window is centred on the aircraft's nearest tile corner, so the edge is at
 * least 1.5 tiles (≈235 km Mercator) away — past the world's own edge band.
 * Texels hold the radiance (the 8-bit product's background removed, its
 * curve undone, once per tile on decode) in an sRGB8 texture: the hardware
 * decodes to linear before filtering and averages mips in linear, so a
 * distant city keeps its brightness while dim suburbs keep their precision.
 * Alpha = loaded.
 *
 * THE LOOK (the GLSL below, called from the Enhanced aerial pass through
 * lib/fly/living-ground.js). The radiance is drawn as emissive ground light,
 * attenuated by the same physical air and weather as the terrain. The
 * radiance is redistributed onto a street-light pattern (night-lights-
 * pattern.js: a periodic, mipmapped texture of lamps along procedural street
 * grids, fixed to the world and filtered by the GPU over each pixel's
 * footprint), in sodium-to-LED lamp colours; seen from above, part of a bright
 * core's light reads as lit ground with a halo round it. The blurred radiance
 * also lights any valley mist lying over a city. (The first version drew its
 * own per-pixel points, which crawled in flight once they were smaller than a
 * pixel, and toward the horizon it was a smooth blurred glow plus a lit-air
 * term: a muddy band. Both are gone.)
 *
 * Fetches go through the raster cache (GIBS answers `no-store`), only while
 * the flag is on, the Enhanced pass is drawing, the profile allows it, and the
 * sun is low (`prefetchFrac`): a day flight never fetches a tile.
 */
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  RepeatWrapping,
  SRGBColorSpace,
  RGBAFormat,
  UnsignedByteType,
  Vector4,
} from 'three';
import { fetchRasterBlob } from './raster-cache';
// SHIP PASS CITY (CT-5): the NIGHT_RHYTHM seam edit and the shipped near-fade end it re-anchors to.
import { NIGHT_RHYTHM_ON, nightLightsSeamGLSL } from './night-rhythm';
import { livingWorldBlock } from './living-world';

const WORLD = 40075016.68557849;
const SLOTS = 4;
const mod = (n, d) => ((n % d) + d) % d;

/** Shared uniform holders, merged into the Enhanced aerial effect's map. */
export const NIGHT_LIGHTS_UNIFORMS = {
  uNLAtlas: { value: null },
  uNLBounds: { value: new Vector4(0, 0, 1, 1) }, // rebased west, north edge of the window; tile span; 1/span
  uNLSlots: { value: new Vector4(0, 0, 0, 0) }, // the window origin's atlas slot (x, y)
  uNLSlotFade: { value: new Matrix4().set(...new Array(16).fill(1)) }, // per atlas slot [x][y]: a fresh tile's fade-in
  uNLParams: { value: new Vector4(0, 1, 0, 0.001) }, // night weight (0 = off), radiance gain, halo gain, radians per pixel
  uNLGlow: { value: new Vector4(0.25, 0.7, 0.04, 0.3) }, // glow share in the outskirts, in a core; view elevation (sin) from which it applies
  uNLDensity: { value: new Vector4(0.12, 0.35, 0.75, 1.5) }, // radiance (sqrt, of gain) where the countryside, suburb, core lamps take over; footprint scale
  uNLFade: { value: new Vector4(0, 1, 1e9, 2e9) }, // near fade (true m from the eye); far fade (scene units from the bend centre)
  uNLPat: { value: null }, // the street-light pattern (night-lights-pattern.js)
  uNLPatPlace: { value: new Vector4(0, 0, 1, 0) }, // pattern phase x, z (scene units); 1/period; ready (0..1)
  uNLPatNorm: { value: new Vector4(1, 1, 1, 1) }, // 1/mean of the core, suburb, countryside channels; lamps' edge-on gain cap
  uNLMist: { value: 0 }, // share of the blurred city light that lights valley mist over it
  uNLSodium: { value: new Vector4(1, 0.6, 0.27, 0.75) }, // sodium lamp colour (luminance 1 after normalising); its share in the outskirts
  uNLLed: { value: new Vector4(1, 0.93, 0.84, 0.35) }, // LED / commercial white; the sodium share left in a core
};

/**
 * The lights (after living-ground.js's shared hash and periodic noise).
 *
 * WHAT HOLDS STILL. Nothing here depends on the screen except the size of
 * the pixel's footprint: the VIIRS radiance and the street-light pattern are
 * both textures fixed to the world, sampled with the footprint as their
 * gradients, so the GPU's trilinear + anisotropic filtering integrates exactly
 * the light inside each pixel, near or grazing. A lamp is never a hard
 * sub-pixel dot (the pattern's lamps are bilinear tents, and `uNLDensity.w`
 * keeps the filter at least that many texels wide), it moves with the ground,
 * and a far city keeps its streets and clusters across the screen instead of
 * thinning to a smooth band. The pattern only redistributes the VIIRS light
 * (each channel's mean is 1), so the city's brightness is the satellite's.
 */
const NIGHT_LIGHTS_GLSL_SHIPPED = /* glsl */ `
uniform sampler2D uNLAtlas;
uniform vec4 uNLBounds;
uniform vec4 uNLSlots;
uniform mat4 uNLSlotFade;
uniform vec4 uNLParams;
uniform vec4 uNLGlow;
uniform vec4 uNLDensity;
uniform vec4 uNLFade;
uniform sampler2D uNLPat;
uniform vec4 uNLPatPlace;
uniform vec4 uNLPatNorm;
uniform float uNLMist;
uniform vec4 uNLSodium;
uniform vec4 uNLLed;
float nlLum(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
// A fresh tile's fade at an atlas uv: element [slot x][slot y], selected
// without dynamic indexing (which D3D compiles into a warned-about helper).
float nlFresh(vec2 uv){
  vec2 s=mod(floor(uv*4.),4.);
  const vec4 I=vec4(0.,1.,2.,3.);
  return dot(uNLSlotFade*step(abs(vec4(s.x)-I),vec4(.5)),step(abs(vec4(s.y)-I),vec4(.5)));
}
// Emissive city light at a ground pixel (scene-linear radiance), and the
// city's blurred radiance there (lighting any valley mist lying over it).
vec3 nlLights(vec3 world,vec3 metricRay,float dXZ,float trueY,out vec3 city){
  city=vec3(0.);
  if(uNLParams.x<=0.)return vec3(0.);
  float far=1.-smoothstep(uNLFade.z,uNLFade.w,dXZ);
  vec2 t=(world.xz-uNLBounds.xy)*uNLBounds.w;
  vec2 e=min(t,4.-t);
  // Only on the ground: the terrain grid where it covers, the aircraft's own
  // ground beyond it, so aircraft, traffic and far tower tops stay unlit.
  vec4 gf=gfField(world.xz);
  float above=trueY-mix(uGroundY,gf.y,gf.w);
  float w=far*smoothstep(0.,.4,min(e.x,e.y))*uNLParams.x*(1.-smoothstep(mix(1500.,300.,gf.w),mix(2500.,600.,gf.w),above));
  if(w<=0.)return vec3(0.);
  vec2 uv=(t+uNLSlots.xy)*.25;
  float fresh=nlFresh(uv);
  city=textureLod(uNLAtlas,uv,3.5).rgb*uNLParams.y*fresh*w;
  float near=smoothstep(uNLFade.x,uNLFade.y,length(metricRay.xz))*uNLPatPlace.w;
  if(near<=0.)return vec3(0.);
  // The pixel's ground footprint (scene units): across the view, and
  // stretched along it by the grazing angle; its axes are the gradients.
  vec3 toP=world-uCamPos;
  float sd=length(toP);
  vec3 ray=toP/max(sd,1e-3);
  float across=sd*uNLParams.w;
  float along=across/max(abs(ray.y),.01);
  vec2 hz=ray.xz;float hl=length(hz);
  vec2 dir=hl>1e-5?hz/hl:vec2(1.,0.),side=vec2(-dir.y,dir.x);
  float k=uNLBounds.w*.25;
  vec3 L=textureGrad(uNLAtlas,uv,dir*along*k,side*across*k).rgb*uNLParams.y*fresh;
  float lum=nlLum(L);
  // The lamps: the pattern channel for this much light (countryside, suburb,
  // core: each a subset of the next, so lamps dim out rather than move).
  float pk=uNLPatPlace.z*uNLDensity.w;
  vec3 pat=textureGrad(uNLPat,(world.xz+uNLPatPlace.xy)*uNLPatPlace.z,dir*along*pk,side*across*pk).rgb*uNLPatNorm.rgb;
  float dn=sqrt(clamp(lum/max(uNLParams.y,1e-6),0.,4.));
  float lamps=mix(mix(pat.b,pat.g,smoothstep(uNLDensity.x,uNLDensity.y,dn)),pat.r,smoothstep(uNLDensity.y,uNLDensity.z,dn));
  // The lamps' colour: VIIRS measures how much light, not its colour (the
  // product's hue is a rendering ramp), so lamps take a lamp palette: mostly
  // sodium orange in the outskirts, whiter (LED, floodlit lots) in a core,
  // varying by district (a world-fixed noise).
  float sod=mix(uNLSodium.w,uNLLed.w,smoothstep(.35,1.,dn))*(.7+.6*lgNoise((world.xz+uNLPatPlace.xy)*(1./2048.),16.));
  vec3 hue=mix(uNLLed.rgb/nlLum(uNLLed.rgb),uNLSodium.rgb/nlLum(uNLSodium.rgb),clamp(sod,0.,1.));
  // Seen from above, part of a bright core's light reads as lit ground (and a
  // halo of scattered light round it); seen edge-on it is the lamps.
  float view=smoothstep(uNLGlow.z,uNLGlow.w,abs(ray.y));
  float g=mix(uNLGlow.x,uNLGlow.y,smoothstep(.12,.7,dn))*view;
  float halo=nlLum(textureLod(uNLAtlas,uv,max(2.,log2(max(along*uNLBounds.w*256.,1.))+1.)).rgb)*uNLParams.y*fresh*uNLParams.z*view;
  // Lamps radiate in every direction, so a pixel's worth of them seen
  // edge-on gathers more of them than the same pixel seen from above: a far
  // city brightens toward the horizon (up to uNLPatNorm.w) instead of greying.
  float edge=clamp(uNLGlow.w/max(abs(ray.y),1e-3),1.,uNLPatNorm.w);
  return hue*(lum*mix(lamps*edge,1.,g)+halo)*w*near;
}
`;

/*
 * SHIP PASS CITY (CT-5, NIGHT_RHYTHM): the hand-off seam with the road ring is
 * an anchored edit on the text above (lib/fly/night-rhythm.js). Flag off: the
 * exported text IS the shipped text, byte for byte.
 */
export const NIGHT_LIGHTS_GLSL = NIGHT_RHYTHM_ON
  ? nightLightsSeamGLSL(NIGHT_LIGHTS_GLSL_SHIPPED, livingWorldBlock('NIGHT_LIGHTS').nearFade[1])
  : NIGHT_LIGHTS_GLSL_SHIPPED;

/** 8-bit product -> radiance (background removed, curve applied), sRGB-encoded for an sRGB8 texel. */
function makeDecodeLut(background, curve) {
  const lut = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
  for (let c = 0; c < 3; c++) {
    const bg = background[c];
    for (let v = 0; v < 256; v++) {
      const x = Math.min(1, Math.max(0, (v - bg) / (255 - bg))) ** curve;
      lut[c][v] = Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
    }
  }
  return lut;
}

let _scratch = null;
/** Decode a tile blob to RGBA bytes (OffscreenCanvas; one shared scratch). */
async function decodeTile(blob, size) {
  const bitmap = await createImageBitmap(blob);
  try {
    if (!_scratch || _scratch.width !== size) {
      const canvas = new OffscreenCanvas(size, size);
      _scratch = { width: size, canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) };
    }
    _scratch.ctx.clearRect(0, 0, size, size);
    _scratch.ctx.drawImage(bitmap, 0, 0, size, size);
    return _scratch.ctx.getImageData(0, 0, size, size).data;
  } finally {
    bitmap.close?.();
  }
}

/**
 * The resident atlas: one 1024² RGBA8 texture (4 MB, 5.3 MB with mips), its
 * sixteen slots, the fetch queue and the upload throttle. Built lazily by
 * lib/fly/living-ground.js the first time a night needs it; `source` is
 * tile-sources.js NIGHT_LIGHTS_SOURCE (handed in, so this module stays
 * importable where three-tile is not).
 */
export class NightLightsAtlas {
  constructor(block, source) {
    this.source = source;
    this.z = source.maxZoom;
    this.tile = source.tileSize;
    this.size = SLOTS * this.tile;
    this.maxRequests = Math.max(1, block.maxRequests ?? 4);
    this.lut = makeDecodeLut(source.background, block.curve ?? 2.2);
    const data = new Uint8Array(this.size * this.size * 4);
    const t = new DataTexture(data, this.size, this.size, RGBAFormat, UnsignedByteType);
    t.name = 'night-lights-atlas';
    t.wrapS = t.wrapT = RepeatWrapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.colorSpace = SRGBColorSpace;
    t.flipY = false;
    t.anisotropy = 4;
    t.needsUpdate = true;
    this.texture = t;
    // shownAt: when the slot's tile reached the GPU (its fade-in starts).
    this.slots = Array.from({ length: SLOTS * SLOTS }, () => ({ key: null, tx: 0, ty: 0, gen: 0, state: 'empty', retryAt: 0, written: false, shownAt: Infinity }));
    this.minX = NaN;
    this.minY = NaN;
    this.inFlight = 0;
    this.dirty = false;
    this.lastUpload = -Infinity;
    this.disposed = false;
    this.stats = { ready: 0, loading: 0, failed: 0, noData: 0, fetched: 0, uploads: 0, lastError: null };
  }

  /** Tile span (scene units) at the atlas zoom. */
  get span() {
    return WORLD / 2 ** this.z;
  }

  /** Centre the 4×4 window on the tile corner nearest `x, z` (ABSOLUTE scene units). */
  locate(x, z) {
    const span = this.span;
    const mx = Math.round((x + WORLD / 2) / span) - 2;
    const my = Math.round((z + WORLD / 2) / span) - 2;
    if (mx === this.minX && my === this.minY) return false;
    this.minX = mx;
    this.minY = my;
    for (let dy = 0; dy < SLOTS; dy++)
      for (let dx = 0; dx < SLOTS; dx++) {
        const tx = mx + dx, ty = my + dy;
        const index = mod(ty, SLOTS) * SLOTS + mod(tx, SLOTS);
        const slot = this.slots[index];
        const key = `${this.z}/${tx}/${ty}`;
        if (slot.key === key) continue;
        slot.key = key;
        slot.tx = tx;
        slot.ty = ty;
        slot.gen++;
        slot.retryAt = 0;
        slot.state = ty < 0 || ty >= 2 ** this.z ? 'no-data' : 'empty';
        slot.written = false;
        slot.shownAt = Infinity;
        this._clear(index);
      }
    return true;
  }

  /** Start fetches (nearest the window centre first) up to the request cap. */
  pump(now) {
    if (this.disposed) return;
    const cx = this.minX + 2, cy = this.minY + 2;
    while (this.inFlight < this.maxRequests) {
      let best = -1, bestD = Infinity;
      for (let i = 0; i < this.slots.length; i++) {
        const s = this.slots[i];
        if (s.state !== 'empty' && !(s.state === 'error' && now >= s.retryAt)) continue;
        const d = Math.hypot(s.tx + 0.5 - cx, s.ty + 0.5 - cy);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) return;
      this._fetch(best);
    }
  }

  _fetch(index) {
    const slot = this.slots[index];
    const { key, gen, tx, ty } = slot;
    slot.state = 'loading';
    this.inFlight++;
    const url = this.source.url(this.z, mod(tx, 2 ** this.z), ty);
    fetchRasterBlob(url)
      .then((blob) => decodeTile(blob, this.tile))
      .then((rgba) => {
        if (this.disposed || slot.key !== key || slot.gen !== gen) return;
        this._write(index, rgba);
        slot.written = true;
        slot.state = 'ready';
        this.stats.fetched++;
      })
      .catch((error) => {
        if (this.disposed || slot.key !== key || slot.gen !== gen) return;
        // A 4xx is an answer (no tile there); anything else is asked again later.
        const status = Number(String(error?.message ?? '').match(/raster (\d{3})/)?.[1]);
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) slot.state = 'no-data';
        else {
          slot.state = 'error';
          slot.retryAt = performance.now() / 1000 + 20;
        }
        this.stats.lastError = { key, message: String(error?.message ?? error).slice(0, 160) };
      })
      .finally(() => {
        this.inFlight--;
      });
  }

  _clear(index) {
    const data = this.texture.image.data, w = this.size, n = this.tile;
    const sx = (index % SLOTS) * n, sy = Math.floor(index / SLOTS) * n;
    for (let y = 0; y < n; y++) data.fill(0, ((sy + y) * w + sx) * 4, ((sy + y) * w + sx + n) * 4);
    this.dirty = true;
  }

  _write(index, rgba) {
    const data = this.texture.image.data, w = this.size, n = this.tile, [lr, lg, lb] = this.lut;
    const sx = (index % SLOTS) * n, sy = Math.floor(index / SLOTS) * n;
    for (let y = 0; y < n; y++) {
      let p = ((sy + y) * w + sx) * 4, q = y * n * 4;
      for (let x = 0; x < n; x++, p += 4, q += 4) {
        data[p] = lr[rgba[q]];
        data[p + 1] = lg[rgba[q + 1]];
        data[p + 2] = lb[rgba[q + 2]];
        data[p + 3] = 255;
      }
    }
    this.dirty = true;
  }

  /** Re-upload (with mips) at most every `minSec` while slots change. */
  flush(now, minSec = 0.35) {
    if (!this.dirty || now - this.lastUpload < minSec) return;
    this.dirty = false;
    this.lastUpload = now;
    this.texture.needsUpdate = true;
    this.stats.uploads++;
    for (const slot of this.slots) {
      if (!slot.written) continue;
      slot.written = false;
      slot.shownAt = now;
    }
  }

  /**
   * Each slot's fade-in (0..1 over `sec` from its upload) into `m`, a
   * Matrix4 read in GLSL as m[slotX][slotY]: a tile that arrives while its
   * city is on screen brightens over a second instead of switching on.
   */
  fades(now, sec, m) {
    const e = m.elements;
    for (let i = 0; i < this.slots.length; i++) {
      const t = (now - this.slots[i].shownAt) / Math.max(0.05, sec);
      e[(i % SLOTS) * 4 + Math.floor(i / SLOTS)] = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
    }
    return m;
  }

  census() {
    const s = this.stats;
    s.ready = s.loading = s.failed = s.noData = 0;
    for (const slot of this.slots) {
      if (slot.state === 'ready') s.ready++;
      else if (slot.state === 'loading') s.loading++;
      else if (slot.state === 'error') s.failed++;
      else if (slot.state === 'no-data') s.noData++;
    }
    return s;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.texture.dispose();
  }
}
