/**
 * LIVING WORLD (GROUND) — the seam between the GROUND workstream and the
 * Enhanced aerial pass (components/fly/AerialPerspective.jsx). Two blocks:
 *
 *   NIGHT_LIGHTS  lib/fly/night-lights-atlas.js  city lights from altitude
 *   GROUND_MIST   lib/fly/ground-mist.js         valley mist
 *
 * Both are drawn where the aerial pass already knows each ground pixel's world
 * position, true height and the air in front of it, and both act on the
 * GROUND radiance before that air is applied, so lights and mist are hazed,
 * curved and faded by exactly the law the terrain is:
 *
 *   ground = terrain (the scene buffer); emit = night lights (own fades)
 *   mist:   ground = ground*T + mistLight*(1-T);  emit *= T
 *   air:    lit = ground*airT + inscatter ...;  lit += emit*airT + cityGlow*(1-airT)
 *
 * Both read one terrain grid around the aircraft (ground-mist.js GroundField):
 * the mist pools in its basins, and the lights stay on its surface.
 *
 * TEXT. livingGroundAerial() PATCHES the built Enhanced text (after PHYS_SKY
 * and TRUE_SCALE, whose anchors it leaves intact) with exact, single-match
 * substitutions that THROW on a miss (the R25 swapExact rule). With both
 * blocks off it returns its input unchanged, the effect gains no uniforms and
 * update() never reaches this module: flag off is the previous program, key
 * and frame, and nothing is fetched or sampled.
 *
 * RUNTIME. The atlas and the field need the flight (absolute position, the
 * floating-origin anchor, sun, weather, the terrain engine), which the aerial
 * effect is never handed. attachLivingGround(runtime) is that hand-off, made
 * once by whoever owns both (FLY_LIVING_WORLD.md, GROUND); until it is made,
 * both blocks draw nothing. Per-frame work happens in the effect's own
 * update(), which postprocessing calls just before the pass draws.
 */
import { livingWorldOn, livingWorldBlock } from './living-world';
import { NIGHT_LIGHTS_GLSL, NIGHT_LIGHTS_UNIFORMS, NightLightsAtlas, nightLightsPhase } from './night-lights-atlas';
import {
  GROUND_FIELD_GLSL,
  GROUND_FIELD_UNIFORMS,
  GROUND_MIST_GLSL,
  GROUND_MIST_UNIFORMS,
  GroundField,
  groundMistPhase,
  groundMistStrength,
} from './ground-mist';
import { PHYS_SKY_TEXT_ACTIVE } from './cinema-sky';
import { cinemaOn, cinemaProfile } from './cinema-policy';
import { getEdgeFade } from './toy-world/world-bend';
import { mercatorScale } from './coords';
import { SAT_ROADS } from './fly-constants';
import { graphicsReviewOn } from './satellite-visuals';

const NL_ON = livingWorldOn('NIGHT_LIGHTS');
const GM_ON = livingWorldOn('GROUND_MIST');
const NL = livingWorldBlock('NIGHT_LIGHTS');
const GM = livingWorldBlock('GROUND_MIST');
const WORLD = 40075016.68557849;
const mod = (n, d) => ((n % d) + d) % d;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** True when either block changes the Enhanced aerial program. */
export const LIVING_GROUND_ACTIVE = NL_ON || GM_ON;

/** Every uniform the patched program declares (none with both blocks off). */
export const LIVING_GROUND_UNIFORMS = LIVING_GROUND_ACTIVE
  ? { ...GROUND_FIELD_UNIFORMS, ...(NL_ON ? NIGHT_LIGHTS_UNIFORMS : {}), ...(GM_ON ? GROUND_MIST_UNIFORMS : {}) }
  : {};

/** Per-program edit results ('patched' | 'off'), for the gate and the device report. */
export const LIVING_GROUND_SHADERS = {};

// Shared by both blocks: a hash and value noise on a lattice of period n cells
// (each block's phase period is a whole number of its lattices).
const COMMON_GLSL = /* glsl */ `
float lgHash(vec2 c){vec3 q=fract(vec3(c.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float lgNoise(vec2 p,float n){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  float a=lgHash(mod(i,n)),b=lgHash(mod(i+vec2(1.,0.),n)),c=lgHash(mod(i+vec2(0.,1.),n)),d=lgHash(mod(i+1.,n));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
`;

const MAIN = 'void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {';
const AIR = '    float transmission=livingAirTransmission(length(metricRay),uCamPos.y-uGroundY,h);\n';
const PHYS_LIT = '      vec3 lit=inputColor.rgb*apT+apS*uPskySunIllum+pskyNightAir(apDir)*(1.-apT);\n';
const PHYS_OUT = '      outputColor=vec4(lit*uR25Exposure,inputColor.a);\n';
const LIVING_OUT = '    outputColor=vec4((inputColor.rgb*transmittance+haze*(1.-transmittance))*uR25Exposure,inputColor.a);\n';

function swap(src, from, to) {
  const at = src.indexOf(from);
  if (at < 0 || src.indexOf(from, at + from.length) >= 0)
    throw new Error(`living-ground: anchor ${at < 0 ? 'missing' : 'repeated'}: ${from.trim().slice(0, 70)}`);
  return src.slice(0, at) + to + src.slice(at + from.length);
}

/**
 * The Enhanced aerial text with the GROUND blocks in it (or unchanged with
 * both off). `phys` says whether the PHYS_SKY cinema branch is in the text.
 */
export function livingGroundAerial(src, phys = PHYS_SKY_TEXT_ACTIVE) {
  if (!LIVING_GROUND_ACTIVE) {
    LIVING_GROUND_SHADERS['aerial-enhanced'] = 'off';
    return src;
  }
  const driver = /* glsl */ `
// LIVING WORLD (GROUND): the ground pixel before the air in front of it.
void livingGround(vec3 world,vec3 metricRay,float dXZ,float dist,float trueY,vec2 screen,inout vec3 ground,out vec3 emit,out vec3 air){
  emit=vec3(0.);air=vec3(0.);
  ${NL_ON ? 'vec3 city;emit=nlLights(world,metricRay,dXZ,dist,trueY,screen,city);air=city*uNLParams.w;' : ''}
  ${GM_ON ? `gmApply(world,metricRay,${NL_ON ? 'city*uNLMist' : 'vec3(0.)'},ground,emit);` : ''}
}
`;
  const decl = `${COMMON_GLSL}${GROUND_FIELD_GLSL}${NL_ON ? NIGHT_LIGHTS_GLSL : ''}${GM_ON ? GROUND_MIST_GLSL : ''}${driver}`;
  let out = swap(src, MAIN, `${decl}${MAIN}`);
  out = swap(out, AIR, `${AIR}    vec3 lgGround=inputColor.rgb,lgEmit,lgAir;\n    livingGround(world,metricRay,dXZ,dist,trueY,uv,lgGround,lgEmit,lgAir);\n`);
  if (phys) {
    out = swap(out, PHYS_LIT, PHYS_LIT.replace('inputColor.rgb*apT', 'lgGround*apT'));
    // After the world's edge fade: the lights carry their own far fade.
    out = swap(out, PHYS_OUT, `      lit+=lgEmit*apT*transmission+lgAir*(1.-apT*transmission);\n${PHYS_OUT}`);
  }
  out = swap(
    out,
    LIVING_OUT,
    '    outputColor=vec4((lgGround*transmittance+haze*(1.-transmittance)+lgEmit*transmittance+lgAir*(1.-transmittance))*uR25Exposure,inputColor.a);\n'
  );
  LIVING_GROUND_SHADERS['aerial-enhanced'] = 'patched';
  return out;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

let _rt = null;
let _atlas = null;
let _field = null;
const _s = {
  vt: NaN, // runtime.explorerVisualTime at the last frame (stops in photo mode)
  driftX: 0,
  driftZ: 0,
  fieldFade: 0,
  lastPx: NaN,
  lastPz: NaN,
  profile: null,
  nightK: 0,
  mist: null,
  sourceLoading: false,
};

function quiet() {
  if (NL_ON) NIGHT_LIGHTS_UNIFORMS.uNLParams.value.x = 0;
  if (GM_ON) GROUND_MIST_UNIFORMS.uGMParams.value.x = 0;
}

/**
 * Hand the GROUND blocks the flight runtime (FlyMode's runtime object). Call
 * once from a component that owns it; returns the detach (which also frees
 * the atlas and the field). A no-op with both blocks off.
 */
export function attachLivingGround(runtime) {
  if (!LIVING_GROUND_ACTIVE || !runtime) return () => {};
  _rt = runtime;
  return () => {
    if (_rt !== runtime) return;
    _rt = null;
    _atlas?.dispose();
    _atlas = null;
    _field?.dispose();
    _field = null;
    if (NL_ON) NIGHT_LIGHTS_UNIFORMS.uNLAtlas.value = null;
    GROUND_FIELD_UNIFORMS.uGFMap.value = null;
    quiet();
  };
}

/**
 * Per frame, from the Enhanced aerial effect's update(). `frame` is the
 * aerial pass's own feed (camera basis, FOV); `heightPx` the render height.
 */
export function updateLivingGround(frame, heightPx) {
  const rt = _rt;
  const f = rt?.flight, a = rt?.origin?.anchor;
  const profile = cinemaOn() ? cinemaProfile().name : null;
  _s.profile = profile;
  if (!f || !a || !profile || profile.startsWith('phone') || profile === 'low') return quiet();
  const now = performance.now() / 1000;
  const vt = Number.isFinite(rt.explorerVisualTime) ? rt.explorerVisualTime : now;
  const dt = Number.isFinite(_s.vt) ? Math.max(0, Math.min(0.1, vt - _s.vt)) : 0;
  _s.vt = vt;
  const k = mercatorScale(f.latDeg ?? 0);
  const agl = f.pos.y - (f.groundElev ?? 0);
  // A warp (or a respawn) moves the aircraft tens of kilometres in one frame.
  const jumped = Number.isFinite(_s.lastPx) && Math.hypot(f.pos.x - _s.lastPx, f.pos.z - _s.lastPz) > 20000;
  _s.lastPx = f.pos.x;
  _s.lastPz = f.pos.z;
  const nightWants = NL_ON ? updateNightLights(rt, f, a, frame, heightPx, k, agl, now) : false;
  const mist = GM_ON ? (_s.mist = groundMistStrength(rt.sun, rt.weather?.wx, GM)) : null;
  const steps = GM_ON ? GM.steps?.[profile] ?? 0 : 0;
  const mistWants = !!mist && steps > 0 && mist.strength > 0.002;
  const live = updateField(rt, f, a, frame, k, agl, now, dt, jumped, nightWants || mistWants);
  if (GM_ON) updateGroundMist(rt, a, k, dt, mist, mistWants ? steps : 0, live);
}

/** The atlas and the lights' uniforms; returns whether the lights want the terrain grid. */
function updateNightLights(rt, f, a, frame, heightPx, k, agl, now) {
  const U = NIGHT_LIGHTS_UNIFORMS;
  const frac = rt.sun?.frac ?? 1;
  // The road network's own dusk ramp, so the city arrives together; and since
  // these are bright points that would glitter on a sunlit valley floor, gone
  // by sunrise (street lights switch at civil twilight).
  const ramp = SAT_ROADS.night;
  const el = (Math.asin(Math.max(-1, Math.min(1, rt.sun?.sinEl ?? 1))) * 180) / Math.PI;
  const twilight = NL.twilightEl ?? [-5, 0.5];
  const nightK = (_s.nightK = clamp01(1 - frac / ramp.dayFrac) ** ramp.gamma * (1 - smooth(twilight[0], twilight[1], el)));
  const want = frac < (NL.prefetchFrac ?? 0.45);
  if (want && !_atlas && !_s.sourceLoading) {
    // The GIBS source entry lives in tile-sources.js, which drags three-tile in;
    // load it when a night first needs it (it is already in the app's bundle).
    _s.sourceLoading = true;
    const owner = rt;
    import('./tile-sources')
      .then(({ NIGHT_LIGHTS_SOURCE }) => {
        if (_rt !== owner || _atlas) return;
        _atlas = new NightLightsAtlas(NL, NIGHT_LIGHTS_SOURCE);
        U.uNLAtlas.value = _atlas.texture;
      })
      .catch(() => {})
      .finally(() => {
        _s.sourceLoading = false;
      });
  }
  if (!_atlas) {
    U.uNLParams.value.x = 0;
    return false;
  }
  _atlas.locate(f.pos.x, f.pos.z);
  if (want) _atlas.pump(now);
  _atlas.flush(now);
  const span = _atlas.span;
  U.uNLBounds.value.set(_atlas.minX * span - WORLD / 2 - a.x, _atlas.minY * span - WORLD / 2 - a.z, span, 1 / span);
  U.uNLSlots.value.set(mod(_atlas.minX, 4), mod(_atlas.minY, 4), NL.band ?? 1, 0);
  U.uNLParams.value.set(nightK, NL.gain, NL.sparkle, NL.glow);
  // Near: the generated road ring (true metres), which the climb retires.
  const roadK = 1 - smooth(SAT_ROADS.cullAglOnM, SAT_ROADS.cullAglOffM, agl);
  const ringM = (SAT_ROADS.ring.r / k) * roadK;
  const edge = getEdgeFade();
  U.uNLFade.value.set(NL.nearFade[0] * ringM, Math.max(1, NL.nearFade[1] * ringM), NL.farFade[0] * edge.endM, NL.farFade[1] * edge.endM);
  // The smallest sparkle cell is a power of two, so every level divides the
  // phase period and the points stay put across a floating-origin rebase.
  const cell = 2 ** Math.round(Math.log2(Math.max(4, NL.sparkleCell ?? 32)));
  const pixelAngle = (2 * (frame.tanHalfFov ?? 0.5)) / Math.max(1, heightPx || 1);
  U.uNLPattern.value.set(nightLightsPhase(a.x), nightLightsPhase(a.z), pixelAngle, cell);
  U.uNLMist.value = NL.mistGlow ?? 0;
  const im = NL.imagery;
  U.uNLImagery.value.set(im.share, im.power, im.radiusPx, im.cap);
  return nightK > 0;
}

/** The shared terrain grid: built while either block wants it; returns the live grid or null. */
function updateField(rt, f, a, frame, k, agl, now, dt, jumped, wanted) {
  const engine = rt.engine;
  if (wanted && engine && !_field) {
    _field = new GroundField(GM);
    GROUND_FIELD_UNIFORMS.uGFMap.value = _field.texture;
  }
  if (!_field) return null;
  if (jumped) _field.invalidate();
  if (wanted && engine) {
    // Centre the grid ahead of the view (the camera's -Z, on the ground plane).
    let fx = -frame.camZ[0], fz = -frame.camZ[2];
    const fl = Math.hypot(fx, fz);
    if (fl > 1e-4) { fx /= fl; fz /= fl; } else { fx = 0; fz = 0; }
    const w = _field.want(f.pos.x, f.pos.z, fx, fz, agl, k);
    if (_field.stale(w, now)) _field.step(engine, w, f.groundElev ?? 0, now, GM.map.budgetMs);
  }
  const live = _field.live;
  // A new or lost grid eases in and out (the conditions are already damped).
  _s.fieldFade += ((live ? 1 : 0) - _s.fieldFade) * (1 - Math.exp(-dt / 1.2));
  if (!live) {
    _s.fieldFade = 0;
    GROUND_FIELD_UNIFORMS.uGFBounds.value.set(0, 0, 1, 0);
    return null;
  }
  GROUND_FIELD_UNIFORMS.uGFBounds.value.set(live.x0 - a.x, live.z0 - a.z, live.size, live.base);
  return live;
}

function updateGroundMist(rt, a, k, dt, s, steps, live) {
  const U = GROUND_MIST_UNIFORMS;
  if (!live || steps <= 0) {
    U.uGMParams.value.x = 0;
    return;
  }
  U.uGMParams.value.set(s.strength * _s.fieldFade, GM.extinction, steps, live.top);
  const L = GM.light;
  U.uGMLight.value.set(L.g, L.forward, L.albedo, L.ambient);
  U.uGMKey.value = L.key;
  // Banks drift with the surface wind (scene units), slower than it.
  const wx = rt.weather?.wx;
  _s.driftX = groundMistPhase(_s.driftX + (wx?.windX ?? 5) * k * dt * GM.drift);
  _s.driftZ = groundMistPhase(_s.driftZ + (wx?.windZ ?? 0) * k * dt * GM.drift);
  U.uGMDrift.value.set(groundMistPhase(a.x + _s.driftX), groundMistPhase(a.z + _s.driftZ), GM.patchiness, k);
}

/** What the blocks are doing now (dev handle, gates). */
export function livingGroundStats() {
  return {
    attached: !!_rt,
    profile: _s.profile,
    field: _field ? { ..._field.stats, live: _field.live ? { ..._field.live } : null, building: !!_field.build, fade: _s.fieldFade } : null,
    nightLights: NL_ON
      ? { nightK: _s.nightK, params: NIGHT_LIGHTS_UNIFORMS.uNLParams.value.toArray(), fade: NIGHT_LIGHTS_UNIFORMS.uNLFade.value.toArray(),
          atlas: _atlas ? { ..._atlas.census(), window: [_atlas.minX, _atlas.minY] } : null }
      : null,
    groundMist: GM_ON ? { ...(_s.mist ?? {}), params: GROUND_MIST_UNIFORMS.uGMParams.value.toArray() } : null,
  };
}

// Dev / review handle: lets a harness attach a runtime before the integration
// seam exists, and read what the blocks are doing. Never on a player's build.
if (LIVING_GROUND_ACTIVE && typeof window !== 'undefined' && (process.env.NODE_ENV === 'development' || graphicsReviewOn())) {
  // `blocks` are the live tunables (per-frame reads land on the next frame).
  window.__flyLivingGround = { attach: attachLivingGround, stats: livingGroundStats, blocks: { NIGHT_LIGHTS: NL, GROUND_MIST: GM } };
}
