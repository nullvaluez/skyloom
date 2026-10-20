/**
 * LIVING WORLD (GROUND) — GROUND_MIST: valley mist that lies in the landscape.
 *
 * WHAT A FLAT FOG CANNOT DO. The existing haze is a function of distance and
 * of height above ONE datum (the damped ground under the aircraft), so it can
 * thicken a whole plain but never fill one valley and leave the ridge beside
 * it clear. Mist from 1-3 km up is exactly that read: white pools in the
 * basins, ridges and treetops standing out of it, gold where the low sun
 * reaches it and blue-grey in the valley shade.
 *
 * THE FIELD (CPU, GroundField). A height grid around the aircraft (96² cells,
 * spanning AGL x 14 clamped to 36-120 km, ahead of the view, centre snapped to
 * the cell lattice so rebuilds agree cell for cell) sampled from the terrain
 * engine a slice per frame under a time budget. From it: the basin FLOOR (an
 * erosion over `floorM`, then smoothed), the local RELIEF (dilation minus
 * floor) that sets each pool's depth, and the smoothed TERRAIN for sun
 * shadowing. One RGBA half texture, heights relative to a base so half
 * precision stays fine-grained. NIGHT_LIGHTS reads the same terrain to keep
 * city light on the ground (never on an aircraft or a far tower top).
 *
 * THE MEDIUM (GLSL, in the Enhanced aerial pass). Density at a point is
 * exponential in its height above the local floor, capped at the pool's depth,
 * broken into drifting banks by periodic value noise that rides the surface
 * wind. Each ground pixel marches its ray where it is below the slab top (the
 * convex bent-world height along a straight scene ray is solved in closed
 * form, so a ray grazing over a misty valley toward a far ridge is marched
 * across the valley too), 4-10 steps by profile. Lighting is the key (sun or
 * moon) with a forward Henyey-Greenstein lobe, shadowed by the terrain grid
 * along the key's azimuth, plus the cloud ambient; the ground and its night
 * lights are seen through the result, and the whole is then hazed by the
 * existing atmosphere like the ground it lies on.
 *
 * WHEN. Strength = time of day x calm x humidity (groundMistStrength): the
 * night level rises to its peak just after sunrise, burns off by ~19 deg sun,
 * and returns after sunset; surface wind thins it; low visibility and rain
 * thicken it; a clear night favours it over an overcast one. The weather feed
 * carries no humidity, so visibility, rain and cloud stand in for it.
 */
import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, NoColorSpace, RGBAFormat, Vector4 } from 'three';

const WORLD = 40075016.68557849;
const R_EARTH = WORLD / (2 * Math.PI);
const RAD2DEG = 180 / Math.PI;
const mod = (n, d) => ((n % d) + d) % d;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
/** The coarsest DEM tile a grid sample may come from (~300 m per sample at z9). */
const MIN_DEM_Z = 9;
/** The drift/bank noise's phase period (scene units): its lattices divide it. */
export const GROUND_MIST_PERIOD = 16384;

/** The ground field's uniform holders (either GROUND block). */
export const GROUND_FIELD_UNIFORMS = {
  uGFMap: { value: null },
  uGFBounds: { value: new Vector4(0, 0, 1, 0) }, // rebased west, north edge; size (scene units); height base (m)
};
/** The mist's own uniform holders. */
export const GROUND_MIST_UNIFORMS = {
  uGMParams: { value: new Vector4(0, 0.0036, 0, -1e9) }, // strength (0 = off), floor extinction (1/m), steps, slab top (true m)
  uGMLight: { value: new Vector4(0.62, 0.7, 0.92, 0.9) }, // forward g, forward share, albedo, ambient gain
  uGMDrift: { value: new Vector4(0, 0, 0.65, 1) }, // noise phase x, z (scene units); patchiness; scene units per true metre
  uGMKey: { value: 0.2 }, // key gain
};

export const GROUND_FIELD_GLSL = /* glsl */ `
uniform sampler2D uGFMap;
uniform vec4 uGFBounds;
// floor (m), terrain (m), pool depth (m), coverage (0 outside the grid)
vec4 gfField(vec2 xz){
  vec2 uv=(xz-uGFBounds.xy)/uGFBounds.z;
  vec2 e=min(uv,1.-uv);
  vec4 f=textureLod(uGFMap,clamp(uv,0.,1.),0.);
  return vec4(f.xy+uGFBounds.w,f.z,smoothstep(0.,.14,min(e.x,e.y))*step(.5,f.w));
}
`;

export const GROUND_MIST_GLSL = /* glsl */ `
uniform vec4 uGMParams;
uniform vec4 uGMLight;
uniform vec4 uGMDrift;
uniform float uGMKey;
// The mean density over one march step whose true height runs ya..yb, with
// the field and the banks read at its middle (xz). The pool's exponential
// profile is integrated exactly along the step, so the thin dense layer on a
// valley floor needs no jitter to be found. Each bank octave gives way to its
// mean once a step is longer than its cells (step = the step's ground length,
// scene units): sampled under that, it only turns into dither noise.
float gmSegment(vec2 xz,float ya,float yb,float step){
  vec4 f=gfField(xz);
  float D=max(f.z,1.),H=.38*D;
  float a=max(min(ya,yb)-f.x,0.),b=max(max(ya,yb)-f.x,0.);
  if(f.w<=0.||a>D)return 0.;
  float body=b-a>1.?H*(exp(-a/H)-exp(-b/H))/(b-a):exp(-a/H);
  body*=1.-smoothstep(.35*D,D,.5*(a+b));
  vec2 q=xz+uGMDrift.xy;
  float n=mix(lgNoise(q*(1./512.),32.),.5,smoothstep(256.,1024.,step))*.62
    +mix(lgNoise(q*(1./128.),128.),.5,smoothstep(64.,256.,step))*.38;
  // Open plains keep a thinner veil than an enclosed valley (a shallow pool
  // seen edge-on otherwise draws a bright contour wherever the ground rises).
  return body*mix(1.,smoothstep(.2,.8,n)*1.75,uGMDrift.z)*mix(.45,1.,smoothstep(70.,170.,D))*f.w;
}
// Mist between the eye and a ground pixel: the ground (and its emissive light)
// seen through it, plus the mist's own scattered light. city = the night
// lights' blurred radiance under it, already scaled, lighting it from below.
void gmApply(vec3 world,vec3 metricRay,vec3 city,inout vec3 ground,inout vec3 emit){
  if(uGMParams.x<=0.)return;
  // True height along the straight scene ray P(t) = eye + A t is a convex
  // parabola on the bent world; solve where it lies below the slab top.
  vec3 A=world-uCamPos;
  vec2 ce=uCamPos.xz-uBendCenter;
  float a=uBendK*dot(A.xz,A.xz),b=A.y+2.*uBendK*dot(ce,A.xz),c=uCamPos.y+uBendK*dot(ce,ce)-uGMParams.w;
  float t0=0.,t1=1.;
  if(a>1e-7){
    float disc=b*b-4.*a*c;
    if(disc<=0.)return;
    float q=-.5*(b+(b<0.?-1.:1.)*sqrt(disc));
    float r0=q/a,r1=c/q;
    t0=min(r0,r1);t1=max(r0,r1);
  } else if(abs(b)>1e-6){
    float tc=-c/b;
    if(b<0.)t0=tc;else t1=tc;
  } else if(c>0.)return;
  t0=max(t0,0.);t1=min(t1,1.);
  if(t1<=t0)return;
  float n=uGMParams.z;
  float dt=(t1-t0)/n;
  float tau=0.,step=length(A.xz)*dt;
  vec3 pa=uCamPos+A*t0;
  vec2 da=pa.xz-uBendCenter;
  float ya=pa.y+dot(da,da)*uBendK;
  for(int i=0;i<12;i++){
    if(float(i)>=n)break;
    vec3 pb=uCamPos+A*(t0+float(i+1)*dt);
    vec2 db=pb.xz-uBendCenter;
    float yb=pb.y+dot(db,db)*uBendK;
    tau+=gmSegment(.5*(pa.xz+pb.xz),ya,yb,step);
    pa=pb;ya=yb;
  }
  tau*=uGMParams.x*uGMParams.y*dt*length(metricRay);
  if(tau<=1e-4)return;
  float T=exp(-tau);
  // Key visibility at the middle of the misty stretch: the terrain grid along
  // the key's azimuth, against the key's rise (the valley shade at dawn).
  vec3 pm=uCamPos+A*(.5*(t0+t1));
  vec2 dm=pm.xz-uBendCenter;
  float ym=pm.y+dot(dm,dm)*uBendK;
  vec3 key=uCinemaKey;
  float kh=length(key.xz),vis=1.;
  if(kh>1e-4){
    vec2 dir=key.xz/kh*uGMDrift.w;
    float rise=key.y/kh;
    vis*=smoothstep(-50.,50.,ym+rise*700.-gfField(pm.xz+dir*700.).y);
    vis*=smoothstep(-70.,70.,ym+rise*1900.-gfField(pm.xz+dir*1900.).y);
    vis*=smoothstep(-90.,90.,ym+rise*4200.-gfField(pm.xz+dir*4200.).y);
  }
  float mu=dot(normalize(metricRay),key),g=uGMLight.x;
  float hg=(1.-g*g)/pow(max(1.+g*g-2.*g*mu,1e-4),1.5);
  vec3 source=uGMLight.z*(mix(uCinemaCloudLower,uCinemaCloudUpper,.5)*uGMLight.w
    +uCinemaKeyColor*uCinemaAir.w*vis*mix(1.,hg,uGMLight.y)*uGMKey)+city;
  ground=ground*T+source*(1.-T);
  emit*=T;
}
`;

/**
 * How much mist the conditions allow, 0..~1.5. Pure (the gate calls it).
 * sun: { sinEl, hourAngle | az } (az is the hour angle in the legacy model;
 * negative = morning in both); wx: the damped weather state or null.
 */
export function groundMistStrength(sun, wx, block) {
  const T = block.time;
  const el = Math.asin(Math.max(-1, Math.min(1, sun?.sinEl ?? 1))) * RAD2DEG;
  const morning = (sun?.hourAngle ?? sun?.az ?? 0) < 0;
  let tod = morning
    ? mix(T.night, 1, smooth(T.dawnFrom, T.dawnFull, el)) * (1 - smooth(T.peakEl, T.burnOffEl, el))
    : T.night * smooth(T.duskFrom, T.duskFull, el);
  const wind = Math.hypot(wx?.windX ?? 5, wx?.windZ ?? 0);
  const calm = 1 - smooth(block.calmMps[0], block.calmMps[1], wind);
  const h = block.humid;
  const fogT = wx?.fogT ?? 0, precipT = wx?.precipT ?? 0, overcastT = wx?.overcastT ?? 0;
  const humid = Math.max(0, Math.min(1.5, h.base + h.fog * fogT + h.precip * precipT + h.overcast * overcastT * (1 - precipT)));
  // Humid air keeps a little mist in the valleys through the day.
  tod = Math.max(tod, T.humidDay * clamp01(fogT + precipT));
  return { strength: tod * calm * humid, tod, calm, humid, el, morning };
}

/** Absolute scene x/z -> lon/lat (Web-Mercator metres, z = -northing). */
function sceneToGeo(x, z, out) {
  out.lon = (x / R_EARTH) * RAD2DEG;
  out.lat = (2 * Math.atan(Math.exp(-z / R_EARTH)) - Math.PI / 2) * RAD2DEG;
  return out;
}

/** Separable square min/max filter of radius r (cells) in place via a scratch. */
function morph(src, dst, n, r, op, scratch) {
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let v = op === 'min' ? Infinity : -Infinity;
      for (let i = Math.max(0, x - r); i <= Math.min(n - 1, x + r); i++) {
        const s = src[y * n + i];
        v = op === 'min' ? (s < v ? s : v) : s > v ? s : v;
      }
      scratch[y * n + x] = v;
    }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let v = op === 'min' ? Infinity : -Infinity;
      for (let j = Math.max(0, y - r); j <= Math.min(n - 1, y + r); j++) {
        const s = scratch[j * n + x];
        v = op === 'min' ? (s < v ? s : v) : s > v ? s : v;
      }
      dst[y * n + x] = v;
    }
}
function boxBlur(src, dst, n, r, scratch) {
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let s = 0, c = 0;
      for (let i = Math.max(0, x - r); i <= Math.min(n - 1, x + r); i++) { s += src[y * n + i]; c++; }
      scratch[y * n + x] = s / c;
    }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let s = 0, c = 0;
      for (let j = Math.max(0, y - r); j <= Math.min(n - 1, y + r); j++) { s += scratch[j * n + x]; c++; }
      dst[y * n + x] = s / c;
    }
}

/**
 * The terrain-derived field (CPU grid + its texture). `step()` advances a
 * build under a time budget and swaps it live when complete; the texture is
 * replaced only at that swap, together with the bounds the shader reads.
 */
export class GroundField {
  constructor(block) {
    this.block = block;
    const n = (this.n = Math.max(16, block.map?.cells ?? 96));
    this.data = new Uint16Array(n * n * 4);
    const t = new DataTexture(this.data, n, n, RGBAFormat, HalfFloatType);
    t.name = 'ground-field';
    t.magFilter = t.minFilter = LinearFilter;
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.colorSpace = NoColorSpace;
    t.flipY = false;
    t.needsUpdate = true;
    this.texture = t;
    this.heights = new Float32Array(n * n);
    this.work = [new Float32Array(n * n), new Float32Array(n * n), new Float32Array(n * n), new Float32Array(n * n)];
    this.build = null;
    this.live = null; // { x0, z0, size, base, top, born }
    this.disposed = false;
    this.stats = { builds: 0, lastBuildMs: 0, samples: 0, misses: 0, cellM: 0 };
    this._geo = { lon: 0, lat: 0 };
  }

  /** The grid this aircraft wants: size from AGL, centre ahead of it, snapped to the cell lattice. */
  want(px, pz, fx, fz, agl, k) {
    const m = this.block.map;
    const sizeM = Math.min(m.maxKm, Math.max(m.minKm, (Math.max(0, agl) * m.aglK) / 1000)) * 1000;
    // Quantise the cell to a power-of-two ladder so small AGL changes reuse the grid.
    const cellM = 2 ** Math.round(Math.log2(sizeM / this.n));
    const cell = cellM * k, size = cell * this.n;
    const cx = Math.round((px + fx * 0.3 * size) / cell) * cell;
    const cz = Math.round((pz + fz * 0.3 * size) / cell) * cell;
    return { x0: cx - size / 2, z0: cz - size / 2, size, cell, cellM };
  }

  /**
   * True when grid `g` no longer serves the wanted `w`: moved by a sixth of
   * its size, or a different rung of the cell ladder (the Mercator scale
   * drifts a little every frame on a north-south flight; that is not a change).
   */
  static differs(g, w, moveFrac = 0.16) {
    if (!g) return true;
    if (Math.abs(g.size - w.size) > 0.2 * w.size) return true;
    return Math.hypot(g.x0 - w.x0, g.z0 - w.z0) > moveFrac * w.size;
  }

  /** True when the live grid should be rebuilt (moved, rescaled, or old enough that finer DEM has landed). */
  stale(w, now) {
    const L = this.live;
    return GroundField.differs(L, w) || now - L.born > (this.block.map.maxAgeSec ?? 30);
  }

  /**
   * Advance (or start) a build. `engine.getGroundAt(lon, lat)` answers
   * { elev, tileZ } or null; `base` is the aircraft's ground (the half-float
   * reference). A build keeps its own target unless the wanted grid moves
   * well away from it. Returns true on the frame the new grid goes live.
   */
  step(engine, w, base, now, budgetMs) {
    if (this.disposed || !engine?.getGroundAt) return false;
    let b = this.build;
    if (GroundField.differs(b, w, 0.3)) {
      b = this.build = { ...w, base, i: 0, misses: 0, t0: performance.now() };
    }
    const n = this.n, H = this.heights, g = this._geo;
    const end = performance.now() + budgetMs;
    while (b.i < n * n) {
      const ix = b.i % n, iz = (b.i / n) | 0;
      sceneToGeo(b.x0 + (ix + 0.5) * b.cell, b.z0 + (iz + 0.5) * b.cell, g);
      const s = engine.getGroundAt(g.lon, g.lat);
      // A coarse fallback tile answers with plateau-level heights (the toy
      // drape lesson): no pool may be built on it, so it counts as a miss.
      const e = s && Number.isFinite(s.elev) && (s.tileZ ?? 99) >= MIN_DEM_Z ? s.elev : NaN;
      if (!(e === e)) b.misses++;
      H[b.i++] = e;
      if ((b.i & 31) === 0 && performance.now() > end) return false;
    }
    this.stats.samples = n * n;
    this.stats.misses = b.misses;
    // A grid that is mostly unanswered (just after a warp) waits for the DEM.
    if (b.misses > 0.35 * n * n) {
      this.build = null;
      return false;
    }
    this._finish(b, now);
    this.build = null;
    return true;
  }

  _finish(b, now) {
    const n = this.n, H = this.heights, [E, D, T, S] = this.work, M = this.block;
    // Holes take the mean of their answered neighbours, then the base.
    for (let pass = 0; pass < 4; pass++)
      for (let i = 0; i < n * n; i++) {
        if (H[i] === H[i]) continue;
        const x = i % n, y = (i / n) | 0;
        let s = 0, c = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
          const v = H[yy * n + xx];
          if (v === v) { s += v; c++; }
        }
        if (c) H[i] = s / c;
      }
    for (let i = 0; i < n * n; i++) if (!(H[i] === H[i])) H[i] = b.base;
    const r = Math.max(1, Math.round(M.floorM / b.cellM));
    morph(H, E, n, r, 'min', S); // the basin floor
    morph(H, D, n, r, 'max', S); // the rim around it
    boxBlur(E, E, n, Math.max(1, r >> 1), S);
    boxBlur(D, D, n, Math.max(1, r >> 1), S);
    boxBlur(H, T, n, 1, S); // terrain for the key shadow
    const [dMin, dMax] = M.depthM;
    let top = -Infinity;
    const out = this.data;
    for (let i = 0; i < n * n; i++) {
      const depth = Math.min(dMax, Math.max(dMin, dMin + M.reliefK * (D[i] - E[i])));
      if (E[i] + depth > top) top = E[i] + depth;
      out[i * 4] = DataUtils.toHalfFloat(E[i] - b.base);
      out[i * 4 + 1] = DataUtils.toHalfFloat(T[i] - b.base);
      out[i * 4 + 2] = DataUtils.toHalfFloat(depth);
      out[i * 4 + 3] = DataUtils.toHalfFloat(1);
    }
    this.texture.needsUpdate = true;
    this.live = { x0: b.x0, z0: b.z0, size: b.size, base: b.base, top: top + 10, born: now, cellM: b.cellM };
    this.stats.builds++;
    this.stats.cellM = b.cellM;
    this.stats.lastBuildMs = Math.round(performance.now() - b.t0);
  }

  /** Drop the live grid (a warp): the mist fades out until the next one lands. */
  invalidate() {
    this.live = null;
    this.build = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.texture.dispose();
  }
}

/** Wrap an absolute coordinate into the noise phase period (float64 on the CPU). */
export function groundMistPhase(v) {
  return Number.isFinite(v) ? mod(v, GROUND_MIST_PERIOD) : 0;
}
