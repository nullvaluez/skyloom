/**
 * LIVING WORLD — GROUND_MIST (FLY_LIVING_WORLD.md): valley mist and low haze
 * at dawn, dusk and in humid air, in the Enhanced aerial pass.
 *
 * MODEL. Two exponential height layers of droplets over a REGIONAL floor:
 *  - a dense, shallow valley layer (radiation fog: tens of metres deep,
 *    opaque in the hollows, patchy), seen from above as white pools with the
 *    ridges standing clear;
 *  - a broad, thin low haze (the morning murk a few hundred metres deep).
 * The floor is the aerial pass's damped haze ground (CLOUD_CALM) followed DOWN
 * into valleys in floorSec[0] and back UP in floorSec[1], so flying over a
 * ridge does not lift the fog out of the valley beside it, and a tile refining
 * under the aircraft never moves the layer.
 *
 * PER PIXEL. Optical depth along the straight eye-to-surface segment, in
 * closed form for exp(-height / H) (the living-air integral's shape), with the
 * density capped capScaleHeights below the floor. The valley layer's cover is
 * a periodic value-noise field (65,536 scene units: a floating-origin rebase,
 * a multiple of 704 m, never moves it; the phase also carries the wind drift),
 * sampled where the fog sits on the path: near the eye, near the surface, or,
 * over a long path through the layer, its mean. In-scatter is skylight from
 * the whole dome leaning to the sky along the ray, the key light through a
 * Henyey-Greenstein lobe while the key body is up (the golden glow toward a
 * low sun; the moon after the key switches) and, at night, the city light
 * under the mist. The physical aerial perspective and the weather fog then
 * apply on top.
 *
 * WHEN. The dawn/dusk window of the true sun elevation, strongest in the
 * morning (the sun east of the meridian), a night level before dawn and after
 * dusk, plus the weather's fog and overcast. The layers fade as the camera
 * climbs above them (aloftM), the haze entirely (cruise views stay clear),
 * the valley pools to keepAloft. Off (one early-out) outside Enhanced and on
 * the Low tier; phones drop the second noise octave.
 */
import { Vector4 } from 'three';
import { livingWorldBlock, livingWorldOn } from './living-world';

/** The noise period in scene units (shared with the night-light tint field). */
export const GM_PERIOD = 65536;
const mod = (n, d) => ((n % d) + d) % d;
const clamp01 = (v) => (v <= 0 ? 0 : v >= 1 ? 1 : Number.isFinite(v) ? v : 0);
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const fract = (v) => v - Math.floor(v);

const DEFAULTS = {
  enabled: false,
  valley: { density: 0.0008, heightM: 70, keepAloft: 0.6 },
  haze: { density: 0.00005, heightM: 400, keepAloft: 0 },
  capScaleHeights: 1,
  maxOpacity: 0.7,
  floorSec: [10, 120, 2],
  settleSec: 30,
  aloftM: [1000, 2200],
  todElDeg: [-10, -3, 7, 14],
  evening: 0.55,
  night: 0.45,
  humid: { fog: 1, overcast: 0.25 },
  cell: 4096,
  cover: [0.72, 0.3],
  driftK: 1,
  light: { sky: 0.8, key: 0.3, g: 0.72, city: 0.55, shadow: 0.8 },
  tiers: { phone: 'cheap', low: 'off' },
};
/** The block with defaults for anything a partial pin leaves out. */
export function resolveGroundMist(block) {
  const b = block ?? {};
  const sub = (k) => ({ ...DEFAULTS[k], ...(b[k] ?? {}) });
  return { ...DEFAULTS, ...b, valley: sub('valley'), haze: sub('haze'), humid: sub('humid'), light: sub('light'), tiers: sub('tiers') };
}
/** On for this page load (lib/fly/living-world.js, the one reader). */
export const GROUND_MIST_ON = livingWorldOn('GROUND_MIST');
export const GM = resolveGroundMist(livingWorldBlock('GROUND_MIST'));

// ---------------------------------------------------------------------------
// Pure helpers (scripts/verify-living-ground.mjs drives these directly).
// ---------------------------------------------------------------------------

/**
 * Mist amount from the sun: the dawn/dusk window todElDeg [on0, on1, off0,
 * off1], a night level before it opens, and morning (1) versus evening
 * (`evening`) blended by the sun's east-west side (`east` in [-1, 1]).
 */
export function mistTimeOfDay(elDeg, east, cfg = GM) {
  const [a0, a1, b0, b1] = cfg.todElDeg;
  const open = smooth(a0, a1, elDeg);
  const dawn = open * (1 - smooth(b0, b1, elDeg));
  const night = (1 - open) * cfg.night;
  return Math.max(dawn, night) * mix(cfg.evening, 1, smooth(-0.15, 0.15, east));
}

/** The weather's share: fog and overcast (runtime.weather.wx through the cinema environment). */
export function mistHumidity(fog, overcast, cfg = GM) {
  return clamp01(fog) * cfg.humid.fog + clamp01(overcast) * cfg.humid.overcast;
}

/**
 * One frame of the regional floor: down toward lower ground in floorSec[0],
 * up in floorSec[1]. A warp (new epoch), an empty state or a jump of more
 * than 4 km re-seeds it with no glide, and for settleSec of wall time after
 * that it follows in floorSec[2] both ways: the ground it reads (the damped
 * haze ground) starts from a half-loaded DEM and converges over seconds, and
 * the slow rise must not hold the mist under the true valley floor for
 * minutes. A non-finite sample keeps the floor. `now` is seconds.
 */
export function stepMistFloor(st, groundY, dt, epoch, cfg = GM, now = 0) {
  if (!Number.isFinite(groundY)) return Number.isFinite(st.y) ? st.y : 0;
  if (!Number.isFinite(st.y) || st.epoch !== epoch || Math.abs(groundY - st.y) > 4000) {
    st.y = groundY;
    st.epoch = epoch;
    st.fastUntil = now + (cfg.settleSec ?? 20);
    return st.y;
  }
  // A low-pass step is stable at any dt; a slow frame just converges further.
  const s = Math.max(0, Math.min(1, Number.isFinite(dt) ? dt : 0));
  const fast = now < (st.fastUntil ?? -Infinity);
  const tau = Math.max(1e-3, fast ? (cfg.floorSec[2] ?? 2) : groundY < st.y ? cfg.floorSec[0] : cfg.floorSec[1]);
  st.y += (groundY - st.y) * (1 - Math.exp(-s / tau));
  return st.y;
}

/**
 * Path length at floor density (metres) of the segment of length L from
 * height a to height b above the floor, density exp(-y/H) capped `cap`
 * metres below the floor. Mirrors gmDepth() in the shader.
 */
export function mistDepth(L, a, b, H, cap) {
  const ca = Math.max(a, -cap), cb = Math.max(b, -cap), d = cb - ca;
  if (Math.abs(d) < 1e-3 * H) return L * Math.exp((-0.5 * (ca + cb)) / H);
  return (L * (Math.exp(-ca / H) - Math.exp(-cb / H)) * H) / d;
}

/** The shader's lattice hash (Hoskins), for the noise at the eye. */
function gmHash(x, y) {
  let qx = fract(x * 0.1031), qy = fract(y * 0.103), qz = fract(x * 0.0973);
  const d = qx * (qy + 33.33) + qy * (qz + 33.33) + qz * (qx + 33.33);
  qx += d;
  qy += d;
  qz += d;
  return fract((qx + qy) * qz);
}
function gmValue(px, py, period) {
  const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const x0 = mod(ix, period), y0 = mod(iy, period), x1 = mod(ix + 1, period), y1 = mod(iy + 1, period);
  return mix(mix(gmHash(x0, y0), gmHash(x1, y0), ux), mix(gmHash(x0, y1), gmHash(x1, y1), ux), uy);
}
/**
 * The cover field at scene coordinates already offset by the phase, in
 * cells of `cell` scene units, `period` cells to the repeat. Mirrors gmNoise().
 */
export function mistNoise(x, z, cell, period, detail = 1) {
  const px = x / cell, pz = z / cell;
  const n = 0.62 * gmValue(px, pz, period) + 0.38 * gmValue(px * 2 + 7.31, pz * 2 + 3.17, period * 2);
  return detail > 0 ? mix(n, gmValue(px * 4 + 1.93, pz * 4 + 8.71, period * 4), 0.22) : n;
}

// ---------------------------------------------------------------------------
// The shader side (Enhanced aerial pass).
// ---------------------------------------------------------------------------

/** Shared uniform holders (the live pass and its prewarm twin bind the same objects). */
export const GROUND_MIST_UNIFORMS = {
  // x valley density (1/m), y valley scale height (m), z haze density (1/m), w haze scale height (m)
  uGMLayer: { value: new Vector4(0, 70, 0, 400) },
  // x floor (m), y max opacity (0 = off), z density cap (scale heights below the floor), w Mercator scale
  uGMFloor: { value: new Vector4(0, 0, 2, 1) },
  // xy phase (scene units, mod GM_PERIOD), z 1/cell (scene units), w period (cells)
  uGMNoise: { value: new Vector4(0, 0, 1 / 4096, 16) },
  // x cover field at the eye, y its mean, z cover threshold, w detail octave (0 / 1)
  uGMPath: { value: new Vector4(0.5, 0.5, 0.6, 1) },
  // x sky gain, y key gain, z phase g, w city-light gain
  uGMLight: { value: new Vector4(0.8, 0.3, 0.72, 0.55) },
  // x how much of the direct light a shadowed surface's mist loses, y-w -.
  uGMLight2: { value: new Vector4(0.8, 0, 0, 0) },
};

/**
 * Declarations + `gmMist(c, world, distM, dir, trueY, haze, glow)`: the
 * surface radiance c seen through the mist (before haze and exposure). Reads
 * the pass's own uCamPos and CINEMA_GLSL's key light (uCinemaKey,
 * uCinemaKeyColor, uCinemaAir.w = its intensity); `dir` and the key are
 * TRUE-frame directions, distances true metres.
 */
export const GROUND_MIST_GLSL = /* glsl */ `
uniform vec4 uGMLayer;
uniform vec4 uGMFloor;
uniform vec4 uGMNoise;
uniform vec4 uGMPath;
uniform vec4 uGMLight;
uniform vec4 uGMLight2;
float gmHash(vec2 c){
  vec3 q=fract(vec3(c.xyx)*vec3(.1031,.1030,.0973));
  q+=dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
float gmValue(vec2 p,float period){
  vec2 i=floor(p),f=p-i,u=f*f*(3.-2.*f);
  vec2 i0=mod(i,period),i1=mod(i+1.,period);
  return mix(mix(gmHash(i0),gmHash(vec2(i1.x,i0.y)),u.x),mix(gmHash(vec2(i0.x,i1.y)),gmHash(i1),u.x),u.y);
}
float gmNoise(vec2 xz){
  vec2 p=xz*uGMNoise.z;
  float n=.62*gmValue(p,uGMNoise.w)+.38*gmValue(p*2.+vec2(7.31,3.17),uGMNoise.w*2.);
  if(uGMPath.w>.5)n=mix(n,gmValue(p*4.+vec2(1.93,8.71),uGMNoise.w*4.),.22);
  return n;
}
// Path length at floor density of exp(-y/H), y from a to b over length L.
float gmDepth(float L,float a,float b,float H,float cap){
  float ca=max(a,-cap),cb=max(b,-cap),d=cb-ca;
  if(abs(d)<1.0e-3*H)return L*exp(-.5*(ca+cb)/H);
  return L*(exp(-ca/H)-exp(-cb/H))*H/d;
}
vec3 gmMist(vec3 c,vec3 world,float distM,vec3 dir,float trueY,vec3 haze,vec3 glow){
  if(uGMFloor.y<=0.)return c;
  float a=uCamPos.y-uGMFloor.x,b=trueY-uGMFloor.x;
  float lv=gmDepth(distM,a,b,uGMLayer.y,uGMFloor.z*uGMLayer.y);
  float lh=gmDepth(distM,a,b,uGMLayer.w,uGMFloor.z*uGMLayer.w);
  float n=gmNoise(world.xz+uGMNoise.xy);
  // Where the valley layer sits on this path: at the eye, at the surface, or,
  // through a long stretch of it, everywhere (then its cover is the mean).
  float wa=exp(-max(a,0.)/uGMLayer.y),wb=exp(-max(b,0.)/uGMLayer.y);
  float np=(uGMPath.x*wa+n*wb)/max(wa+wb,1.0e-4);
  np=mix(np,uGMPath.y,smoothstep(.4,3.,lv*uGMFloor.w*uGMNoise.z));
  float cover=smoothstep(uGMPath.z-.14,uGMPath.z+.14,np);
  float tau=lv*uGMLayer.x*cover+lh*uGMLayer.z*(.55+.9*n);
  float alpha=(1.-exp(-tau))*uGMFloor.y;
  if(alpha<=0.)return c;
  float g=uGMLight.z,mu=dot(dir,uCinemaKey);
  float hg=(1.-g*g)/(12.5663706*pow(max(1.+g*g-2.*g*mu,1.0e-4),1.5));
  // Direct light only while the key body (sun, or the moon after the switch)
  // is above the horizon: a valley before sunrise is lit by the sky alone.
  hg*=smoothstep(-.017,.052,uCinemaKey.y);
  // Valley mist under a low sun lies mostly in the valley's own shadow, and
  // the ground under the pixel says whether it does: white-balanced against
  // the key, a sunlit surface keeps roughly its albedo while a shadowed one,
  // lit by the blue sky alone, turns blue. Its mist keeps the sky light and
  // little of the forward glow (the layer's sunlit top above it).
  vec3 gmWb=c/max(uCinemaKeyColor,vec3(.02));
  hg*=1.-uGMLight2.x*smoothstep(.04,.30,(gmWb.b-gmWb.r)/max(gmWb.b+gmWb.r,1.0e-4));
  // Skylight from the whole dome (its horizon-to-zenith mean), leaning to the
  // sky along the ray: the bright horizon toward a low sun is a sliver of
  // what lights a valley floor.
  vec3 sky=mix(mix(uCinemaHorizon,uCinemaZenith,.5),haze,.3);
  vec3 inS=sky*uGMLight.x+uCinemaKeyColor*(uCinemaAir.w*hg*uGMLight.y)+glow*uGMLight.w;
  return mix(c,inS,alpha);
}
`;

// ---------------------------------------------------------------------------
// The per-frame driver (called from the aerial pass's own update()).
// ---------------------------------------------------------------------------

const _drv = { frame: -1, floor: { y: NaN, epoch: -1 }, driftX: 0, driftZ: 0 };
/** Live state for stats and harnesses. */
export const GROUND_MIST_STATS = { on: GROUND_MIST_ON, live: false, amount: 0, tod: 0, humid: 0, floorY: 0, camH: 0, valley: 0, haze: 0 };

/**
 * One frame. ctx: { frame, dt, cinema, tier, phone, origin: {x, z} | null,
 * camX, camY, camZ (rebased), groundY (damped), kMerc, warpEpoch, sunDir
 * [x, y, z] (true), fog, overcast, wind: [x, z] (unit, toward) and windMps }.
 */
export function stepGroundMist(ctx, cfg = GM) {
  if (!GROUND_MIST_ON || !ctx || ctx.frame === _drv.frame) return;
  _drv.frame = ctx.frame;
  const U = GROUND_MIST_UNIFORMS;
  const mode = ctx.phone ? cfg.tiers.phone : ctx.tier === 'low' ? cfg.tiers.low : 'full';
  if (!ctx.cinema || mode === 'off') {
    U.uGMFloor.value.y = 0;
    GROUND_MIST_STATS.live = false;
    return;
  }
  const k = Number.isFinite(ctx.kMerc) && ctx.kMerc > 0 ? ctx.kMerc : 1;
  const floorY = stepMistFloor(_drv.floor, ctx.groundY, ctx.dt, ctx.warpEpoch, cfg, ctx.now ?? 0);
  const sd = ctx.sunDir ?? [0, 1, 0];
  const el = (Math.asin(Math.max(-1, Math.min(1, sd[1]))) * 180) / Math.PI;
  const east = sd[0] / Math.max(1e-3, Math.hypot(sd[0], sd[2]));
  const tod = mistTimeOfDay(el, east, cfg);
  const humid = mistHumidity(ctx.fog, ctx.overcast, cfg);
  const amount = clamp01(tod + humid);
  const camH = ctx.camY - floorY;
  const aloft = smooth(cfg.aloftM[0], cfg.aloftM[1], camH);
  const kv = amount * (1 - aloft * (1 - cfg.valley.keepAloft));
  const kh = amount * (1 - aloft * (1 - cfg.haze.keepAloft));
  U.uGMLayer.value.set(cfg.valley.density * kv, cfg.valley.heightM, cfg.haze.density * kh, cfg.haze.heightM);
  U.uGMFloor.value.set(floorY, kv + kh > 1e-4 ? cfg.maxOpacity : 0, cfg.capScaleHeights, k);
  // The field drifts downwind (scene units), wrapped on its own period.
  const dt = Math.max(0, Math.min(0.1, Number.isFinite(ctx.dt) ? ctx.dt : 0));
  const w = ctx.wind ?? [0, 0];
  const v = (Number.isFinite(ctx.windMps) ? ctx.windMps : 0) * cfg.driftK * k * dt;
  _drv.driftX = mod(_drv.driftX + w[0] * v, GM_PERIOD);
  _drv.driftZ = mod(_drv.driftZ + w[1] * v, GM_PERIOD);
  const o = ctx.origin ?? { x: 0, z: 0 };
  const px = mod(o.x - _drv.driftX, GM_PERIOD), pz = mod(o.z - _drv.driftZ, GM_PERIOD);
  const period = Math.max(1, Math.round(GM_PERIOD / Math.max(256, cfg.cell)));
  const cell = GM_PERIOD / period;
  const detail = mode === 'cheap' ? 0 : 1;
  U.uGMNoise.value.set(px, pz, 1 / cell, period);
  U.uGMPath.value.set(mistNoise(ctx.camX + px, ctx.camZ + pz, cell, period, detail), 0.5, mix(cfg.cover[0], cfg.cover[1], amount), detail);
  U.uGMLight.value.set(cfg.light.sky, cfg.light.key, cfg.light.g, cfg.light.city);
  U.uGMLight2.value.set(Math.max(0, Math.min(1, cfg.light.shadow ?? 0)), 0, 0, 0);
  Object.assign(GROUND_MIST_STATS, { live: kv + kh > 1e-4, amount, tod, humid, floorY, camH, valley: kv, haze: kh });
}

/** Forget the floor: the next frame re-seeds it from the haze ground (harness seam). */
export function reseedGroundMist() {
  _drv.floor.y = NaN;
}

/** Test seam: the node gate drives the driver without a renderer. */
export const __groundMistInternals = { _drv };
