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
 * attenuated by the same physical air and weather as the terrain. Inside a
 * block the camera can resolve, the light gathers into street lamps on a
 * gently warped grid with arterials — every term an analytically box-filtered
 * pulse train over the pixel's ground footprint, so the pattern converges to
 * its mean (exactly the VIIRS radiance) as the footprint grows: no sparkle,
 * no aliasing, no derivative instructions. A blurred mip lights the haze in
 * front of a city (the glow dome) and any valley mist lying over it.
 *
 * Fetches go through the raster cache (GIBS answers `no-store`), only while
 * the flag is on, the Enhanced pass is drawing, the profile allows it, and the
 * sun is low (`prefetchFrac`): a day flight never fetches a tile.
 */
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  RGBAFormat,
  UnsignedByteType,
  Vector4,
} from 'three';
import { fetchRasterBlob } from './raster-cache';

const WORLD = 40075016.68557849;
const SLOTS = 4;
const mod = (n, d) => ((n % d) + d) % d;
/** The sparkle field's phase period (scene units): every cell size divides it. */
export const NIGHT_LIGHTS_PERIOD = 16384;

/** Shared uniform holders, merged into the Enhanced aerial effect's map. */
export const NIGHT_LIGHTS_UNIFORMS = {
  uNLAtlas: { value: null },
  uNLBounds: { value: new Vector4(0, 0, 1, 1) }, // rebased west, north edge of the window; tile span; 1/span
  uNLSlots: { value: new Vector4(0, 0, 1, 0) }, // the window origin's atlas slot (x, y); the far band's level
  uNLParams: { value: new Vector4(0, 1, 0, 0) }, // night weight (0 = off), radiance gain, sparkle share, air glow
  uNLFade: { value: new Vector4(0, 1, 1e9, 2e9) }, // near fade (true m from the eye); far fade (scene units from the bend centre)
  uNLPattern: { value: new Vector4(0, 0, 0.001, 32) }, // sparkle phase x, z; radians per pixel; smallest sparkle cell (scene units)
  uNLMist: { value: 0 }, // share of the blurred city light that lights valley mist over it
  uNLImagery: { value: new Vector4(0, 2, 3, 2) }, // share, contrast power, ring radius (px), ratio cap
};

/**
 * The lights (after living-ground.js's shared hash and periodic noise). Every
 * lattice the pattern uses divides NIGHT_LIGHTS_PERIOD, so the phase-wrapped
 * coordinates are continuous across a floating-origin rebase.
 */
export const NIGHT_LIGHTS_GLSL = /* glsl */ `
uniform sampler2D uNLAtlas;
uniform vec4 uNLBounds;
uniform vec4 uNLSlots;
uniform vec4 uNLParams;
uniform vec4 uNLFade;
uniform vec4 uNLPattern;
uniform float uNLMist;
uniform vec4 uNLImagery;
// One level of the sparkle field: cells of size c (scene units), a point of
// light in a share (dens) of them at a random place, with an exponential
// brightness (mean 1/dens) that carries the cell's whole light, splatted as a
// gaussian the size of the pixel's footprint (sa along the view, ss across
// it; dir = the view's ground direction). The four cells around the pixel are
// summed, so a point is whole across a cell border. Mean 1 for any footprint.
float nlSparkleLevel(vec2 q,float c,float sa,float ss,vec2 dir,float dens){
  vec2 i0=floor(q/c-.5);
  float n=floor(${NIGHT_LIGHTS_PERIOD}./c+.5),sum=0.;
  for(int k=0;k<4;k++){
    vec2 cell=mod(i0+vec2(mod(float(k),2.),floor(float(k)*.5)),n);
    vec2 p=(i0+vec2(mod(float(k),2.),floor(float(k)*.5))+.1+.8*vec2(lgHash(cell+.5),lgHash(cell+19.5)))*c-q;
    float da=dot(p,dir),ds=dot(p,vec2(-dir.y,dir.x));
    float on=step(lgHash(cell+53.5),dens);
    sum+=on*-log(max(1.-lgHash(cell+37.5),.002))*exp(-.5*(da*da/(sa*sa)+ds*ds/(ss*ss)));
  }
  return sum*c*c/(6.2832*sa*ss*dens);
}
// City light gathered into points, mean 1. The cell follows the footprint
// along the view (two levels blended, so nothing pops), so a point is about
// a pixel tall wherever it lies: overhead the points are dense glitter, toward
// the horizon fewer and brighter, and where they would thin to a scatter they
// hand over to the band a distant city is (dimmed by uNLSlots.z: most of a
// far city's light is in highlights the eye reads as points, not as lit
// ground). dens (0..1, from the radiance) thins a dim outskirt's points and
// packs a bright core's.
float nlSparkle(vec2 q,float across,float alongF,vec2 dir,float dens){
  float c0=uNLPattern.w;
  float lod=log2(max(1.,1.5*alongF/c0));
  float l0=floor(lod),t=lod-l0;
  float sa=max(3.,.45*alongF),ss=max(3.,.45*across);
  float sp=mix(nlSparkleLevel(q,c0*exp2(l0),sa,ss,dir,dens),nlSparkleLevel(q,c0*exp2(l0+1.),sa,ss,dir,dens),t);
  return mix(sp,uNLSlots.z,smoothstep(10.,30.,1.5*alongF/max(across,1e-3)));
}
// Where the light does NOT fall, from the imagery already on screen: a pixel
// darker than a small ring around it (water, woods, a park) is dimmed, so a
// city's light stays off its rivers and out of its parks at any range,
// filtered as the imagery itself is. Darkening only: brightening by the same
// contrast embossed the terrain's own relief into the lights.
float nlLuma(vec2 p){return dot(texture2D(inputBuffer,p).rgb,vec3(.2126,.7152,.0722));}
float nlImagery(vec2 uv){
  vec2 r=texelSize*uNLImagery.z;
  float c=nlLuma(uv);
  float m=.25*(nlLuma(uv+vec2(r.x,0.))+nlLuma(uv-vec2(r.x,0.))+nlLuma(uv+vec2(0.,r.y))+nlLuma(uv-vec2(0.,r.y)));
  float ratio=clamp(c/max(.5*(c+m),1e-6),0.,uNLImagery.w);
  return pow(ratio,uNLImagery.y);
}
// Emissive city light at a ground pixel (scene-linear radiance), and the
// city's blurred radiance there (for the lit air and mist over it).
vec3 nlLights(vec3 world,vec3 metricRay,float dXZ,float dist,float trueY,vec2 screen,out vec3 city){
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
  city=textureLod(uNLAtlas,uv,3.5).rgb*uNLParams.y*w;
  float near=smoothstep(uNLFade.x,uNLFade.y,length(metricRay.xz));
  if(near<=0.)return vec3(0.);
  // The pixel's ground footprint: across the view, and stretched along it by
  // the grazing angle. Feeds both the anisotropic fetch and the sparkle.
  vec3 ray=normalize(world-uCamPos);
  float across=dist*uNLPattern.z;
  float alongF=across/max(abs(ray.y),.035);
  vec2 hz=ray.xz;float hl=length(hz);
  vec2 along=hl>1e-5?hz/hl:vec2(1.,0.),side=vec2(-along.y,along.x);
  float k=uNLBounds.w*.25;
  vec3 L=textureGrad(uNLAtlas,uv,along*alongF*k,side*across*k).rgb*uNLParams.y;
  float dens=clamp(1.3*sqrt(dot(L,vec3(.2126,.7152,.0722))/max(uNLParams.y,1e-6)),.12,1.)*mix(.35,1.,near);
  float points=mix(1.,nlSparkle(world.xz+uNLPattern.xy,across,alongF,along,dens),uNLParams.z);
  return L*mix(1.,nlImagery(screen),uNLImagery.x)*points*w*near;
}
`;

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
    this.slots = Array.from({ length: SLOTS * SLOTS }, () => ({ key: null, tx: 0, ty: 0, gen: 0, state: 'empty', retryAt: 0 }));
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

/** Wrap an absolute coordinate into the phase period (float64 on the CPU). */
export function nightLightsPhase(v) {
  return Number.isFinite(v) ? mod(v, NIGHT_LIGHTS_PERIOD) : 0;
}
