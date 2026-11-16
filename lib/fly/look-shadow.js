import { Vector4 } from 'three';
import { LOOK_SHADOW } from './fly-constants';
import { pinned } from './fly-pins';
import { cinemaProfile } from './cinema-policy';
import { lookTierAllowed } from './look-tier';

/** LOOK PASS B (SHADOW): sun shadow reach, ambient occlusion, contact and cloud shadow: what grounds the world.
 * The owner block with any `?flags=` or console pin applied; FLY_LOOK_PASS.md. */
export const LOOK_SHADOW_CFG = pinned(LOOK_SHADOW, '__flyLookShadowOverride');
export const LOOK_SHADOW_ON = LOOK_SHADOW_CFG.enabled === true;

/** Diagnostics (graphics review / dev: window.__flyLookShadow). */
export const lookShadowStats = { cloudPatch: 'not-built' };
if (globalThis.window) globalThis.window.__flyLookShadow = lookShadowStats;

const num = (v, d) => (Number.isFinite(v) ? v : d);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** 'ultra' | 'high' for a desktop High/Ultra cinema profile (and its governor rungs), else null.
 * Allowed or not is the shared tier test (lib/fly/look-tier.js); the key only picks the range row. */
function lookProfileKey(profile) {
  if (!lookTierAllowed(profile)) return null;
  const name = String(profile?.name || '');
  return name.startsWith('ultra') ? 'ultra' : name.startsWith('high') ? 'high' : null;
}

/**
 * Sun-shadow cascade range (metres) for a cinema profile. Flag off, or any
 * profile that is not desktop High/Ultra (Medium, phone, Low): the profile's
 * own range, unchanged.
 */
export function lookShadowRangeM(profile, cfg = LOOK_SHADOW_CFG, aglM = NaN) {
  const base = profile?.shadowRangeM ?? 0;
  if (cfg.enabled !== true || !profile) return base;
  const key = lookProfileKey(profile);
  if (!key) return base;
  const want = Math.max(base, num(cfg.rangeM?.[key], base) * num(cfg.reach, 1));
  const k = lookShadowAglWeight(aglM, cfg);
  // Quantised to 250 m so a climb refits the cascades in steps, not every frame.
  return k >= 1 ? want : Math.max(base, Math.round((base + (want - base) * k) / 250) * 250);
}

/**
 * Round 3: the long reach is a low-altitude look. From `highAgl.fromM` to
 * `toM` above the ground it eases back to the profile's own range and light
 * depth: at cruise no cast shadow is visible, but a 26 km light box at a low
 * sun drew every terrain tile upstream as a caster. Cloud shadows (the
 * composite) are untouched. 1 = full reach; NaN height = full.
 */
export function lookShadowAglWeight(aglM, cfg = LOOK_SHADOW_CFG) {
  const h = cfg.highAgl;
  if (!h || !Number.isFinite(aglM)) return 1;
  return 1 - smooth(num(h.fromM, 2000), num(h.toM, 4500), aglM);
}

/** The cascades' light depth follows the same height weight (base 14000 / 4000). */
export function lookShadowLightDepthAt(r, profile, aglM, cfg = LOOK_SHADOW_CFG) {
  const d = lookShadowLightDepth(profile, cfg);
  if (!d || !r?.lights) return;
  const k = lookShadowAglWeight(aglM, cfg);
  const far = Math.round((14000 + (d.lightFar - 14000) * k) / 500) * 500;
  r.lightMargin = 4000 + (d.lightMargin - 4000) * k;
  for (const light of r.lights) {
    const cam = light.shadow?.camera;
    if (cam && cam.far !== far) { cam.far = far; cam.updateProjectionMatrix(); }
  }
}

/**
 * CSM light frustum depth (lightFar, lightMargin) for the longer reach on the
 * profile the rig is built for; null = the rig's own (flag off, Medium,
 * phone, Low).
 */
export function lookShadowLightDepth(profile, cfg = LOOK_SHADOW_CFG) {
  if (cfg.enabled !== true || !lookProfileKey(profile)) return null;
  return { lightFar: num(cfg.lightFarM, 14000), lightMargin: num(cfg.lightMarginM, 4000) };
}

/**
 * N8AO configuration at city scale: the radius (world metres) and intensity
 * grow; every other field is the caller's. `occlusion` blends from the
 * caller's own values (0) to the tuned ones (1). Flag off: `cfg` itself.
 */
export function lookShadowAoConfig(cfg, look = LOOK_SHADOW_CFG) {
  if (look.enabled !== true || !cfg) return cfg;
  const k = Math.max(0, num(look.occlusion, 1));
  if (k <= 0) return cfg;
  const ao = look.ao ?? {};
  const r0 = num(cfg.aoRadius, 24), i0 = num(cfg.intensity, 2.2);
  return {
    ...cfg,
    aoRadius: r0 + (num(ao.radiusM, r0) - r0) * k,
    intensity: i0 + (num(ao.intensity, i0) - i0) * k,
    distanceFalloff: num(ao.distanceFalloff, cfg.distanceFalloff),
  };
}


/**
 * City-scale occlusion is a DAYLIGHT term: under a high sun the open sky is
 * the fill a canyon loses. As the sun drops the frame is already mostly in
 * shadow, so the AO eases back to the caller's own (pre-pass) radius and
 * intensity: golden hour, dusk and night keep today's occlusion. Runs after
 * the ground-shading rig has written this frame's values (CinemaShadowRig,
 * priority -0.9 > -50.5) and scales them by the base/tuned ratio; `state`
 * remembers what it wrote so a frame the other rig skips is not scaled twice.
 * Returns the sun weight (1 = full city AO), or null when it does nothing.
 */
const aoCache = { base: null, look: null, tuned: null };
function tunedAo(base, look) {
  if (aoCache.base !== base || aoCache.look !== look) Object.assign(aoCache, { base, look, tuned: lookShadowAoConfig(base, look) });
  return aoCache.tuned;
}
export function lookShadowAoSun(ao, sinEl, base, state, look = LOOK_SHADOW_CFG) {
  if (look.enabled !== true || !ao || !base || !state) return null;
  const tuned = tunedAo(base, look); // computed once per (base, look): no per-frame allocation
  if (tuned === base) return null;
  const el = Math.asin(Math.max(-1, Math.min(1, num(sinEl, 1)))) * 180 / Math.PI;
  const sun = look.aoSun ?? {};
  const w = smooth(num(sun.fromDeg, 0), num(sun.fullDeg, 22), el);
  const pre = (key) => (state[key] != null && ao[key] === state[key].wrote ? state[key].pre : ao[key]);
  const rPre = pre('aoRadius'), iPre = pre('intensity');
  const rk = 1 + (num(base.aoRadius, 24) / tuned.aoRadius - 1) * (1 - w);
  const ik = 1 + ((num(base.intensity, 2.2) - 1) / Math.max(1e-3, tuned.intensity - 1) - 1) * (1 - w);
  const r = rPre * rk, i = 1 + (iPre - 1) * ik;
  if (Math.abs(ao.aoRadius - r) > 1e-3) ao.aoRadius = r;
  if (Math.abs(ao.intensity - i) > 1e-3) ao.intensity = i;
  state.aoRadius = { pre: rPre, wrote: ao.aoRadius };
  state.intensity = { pre: iPre, wrote: ao.intensity };
  lookShadowStats.aoSun = +w.toFixed(3);
  return w;
}

/*
 * CLOUD SHADOW. The Enhanced cloud composite already projects the cloud
 * density along the key light onto opaque scenery, but clamps the result to a
 * 23 % darkening and then fades it twice through the air, so in practice no
 * cloud ever reads as casting a shadow. On desktop High/Ultra only (the gate,
 * `uLookCloudShape.x`, which CinemaShadowRig drives from the live profile
 * every frame and which starts at 0) that line becomes:
 *  - a soft caster: the density averaged over a five-tap disc of `softM`
 *    metres, so a shadow is larger than its cloud with a feathered penumbra;
 *  - an edge broken by two octaves of the cloud noise at `noiseM` metres, so
 *    no straight or stamped boundary survives;
 *  - a Beer-law cover (1 - exp(-density * opticalK)) scaled to `darkMax`, a
 *    small cool bias, an air floor so it does not vanish in the haze, and
 *    `lowSun` of its strength with the sun near the horizon.
 * Gate 0 (Medium, phone, Low, no cascades, or the master dial at 0) runs the
 * original line on the original value, behind one uniform branch. Strength,
 * softness and the gate are uniforms: the dials never recompile the program.
 */
const SHADE_FROM = '   if(casterVisibility>0.)shade=density(projected);';
const SHADE_TO = `   if(casterVisibility>0.)shade=density(projected);
   // LOOK PASS B (SHADOW): keep the raw density, sample the soft caster, and
   // let the air fades below act on 1 so their product is recoverable.
   float lookRawShade=shade,lookSoft=shade;
   if(uLookCloudShape.x>0.){
    if(casterVisibility>0.){
     float lookR=uLookCloudShape.y/metricScale;
     float lookAvg=shade*.36+(density(projected+vec3(lookR,0.,lookR*.38))+density(projected+vec3(-lookR*.38,0.,lookR))
       +density(projected+vec3(-lookR,0.,-lookR*.38))+density(projected+vec3(lookR*.38,0.,-lookR)))*.16;
     lookSoft=max(shade*.8,lookAvg); // the core holds; the penumbra spreads past the cloud's edge
    }
    shade=1.;
   }`;
const DARK_FROM = '   scene*=1.-clamp(shade*.32,0.,.23)*day*cloudMix;';
const DARK_TO = `   // LOOK PASS B (SHADOW): readable, soft cloud shadows (lib/fly/look-shadow.js).
   if(uLookCloudShape.x>0.){
    float lookVis=shade;
    float lookBase=clamp(lookRawShade*lookVis*.32,0.,.23)*day*cloudMix;
    vec2 lookQ=vec2(projected.x*metricScale+phase.x,projected.z*metricScale+phase.z)/uLookCloudShape.z;
    float lookN=noise3(vec3(lookQ.x,7.31,lookQ.y))*.65+noise3(vec3(lookQ.x*3.1,19.7,lookQ.y*3.1))*.35;
    float lookD=lookSoft*(.55+.9*lookN);
    float lookCover=(1.-exp(-lookD*uLookCloudShadow.y))*uLookCloudShadow.x*day*cloudMix
      *max(lookVis,casterVisibility*uLookCloudShadow.w)*mix(uLookCloudShape.w,1.,smoothstep(.10,.38,shadowDir.y));
    vec3 lookDark=lookCover*vec3(1.,1.-uLookCloudShadow.z*.45,1.-uLookCloudShadow.z);
    scene*=1.-mix(vec3(lookBase),lookDark,min(uLookCloudShape.x,1.));
   } else scene*=1.-clamp(shade*.32,0.,.23)*day*cloudMix;`;

/** One gate/shape uniform shared by every patched composite; 0 until a High/Ultra rig says otherwise. */
const SHAPE = { value: new Vector4(0, 420, 900, 0.8) };
export const lookShadowCloudShape = SHAPE;

function swapOnce(src, from, to) {
  const at = src.indexOf(from);
  if (at < 0 || src.indexOf(from, at + from.length) >= 0) return null;
  return src.slice(0, at) + to + src.slice(at + from.length);
}

/**
 * Patch the Enhanced cloud composite (the holder `ensureR25` builds) once.
 * Flag off, or an anchor drift: nothing changes and `.lookShadow.ok` is false.
 * The pass's own air fades sit between the two anchors and stay as they are.
 */
export function lookShadowCloudComposite(r25, cfg = LOOK_SHADOW_CFG) {
  if (!r25?.composite || cfg.enabled !== true || r25.lookShadow) return false;
  let f = r25.composite.fragmentShader;
  f = swapOnce(f, SHADE_FROM, SHADE_TO);
  if (f) f = swapOnce(f, DARK_FROM, DARK_TO);
  if (f) f = swapOnce(f, 'void main(){', `uniform vec4 uLookCloudShadow, uLookCloudShape;
void main(){`);
  if (!f) {
    r25.lookShadow = { ok: false };
    lookShadowStats.cloudPatch = 'anchor-missing';
    return false;
  }
  r25.composite.fragmentShader = f;
  const u = { value: new Vector4() };
  r25.uniforms.uLookCloudShadow = u;
  r25.composite.uniforms.uLookCloudShadow = u;
  r25.uniforms.uLookCloudShape = SHAPE;
  r25.composite.uniforms.uLookCloudShape = SHAPE;
  r25.lookShadow = { ok: true, uniform: u, shape: SHAPE };
  lookShadowStats.cloudPatch = 'ok';
  lookShadowStats.cloudUniform = u; // graphics review: live dial (x dark, y optical, z cool, w air floor)
  lookShadowStats.cloudShape = SHAPE; // (x gate, y soft metres, z edge-noise metres, w low-sun strength)
  updateLookCloudShadow(r25, cfg);
  return true;
}

/** Write the dials into the patched composite's uniform (cheap; any frame). */
export function updateLookCloudShadow(r25, cfg = LOOK_SHADOW_CFG) {
  const u = r25?.lookShadow?.uniform;
  if (!u) return;
  const c = cfg.cloud ?? {};
  const k = Math.max(0, num(cfg.cloudShadow, 1));
  u.value.set(Math.min(0.9, num(c.darkMax, 0.5) * k), num(c.opticalK, 1.6), num(c.cool, 0.12), num(c.airFloor, 0.35));
}

/**
 * CinemaShadowRig, every frame: the cloud-shadow gate follows the live
 * profile. 1 (times the master dial, capped at 1) on desktop High/Ultra with
 * cascades; 0 everywhere else, which is the composite's original line.
 * Returns the gate.
 */
export function lookShadowCloudGate(profile, cfg = LOOK_SHADOW_CFG) {
  const c = cfg.cloud ?? {};
  const on = cfg.enabled === true && !!lookProfileKey(profile) && profile.cascades > 0;
  const g = on ? Math.max(0, Math.min(1, num(cfg.cloudShadow, 1))) : 0;
  SHAPE.value.set(g, num(c.softM, 420), Math.max(50, num(c.noiseM, 900)), Math.max(0, Math.min(1, num(c.lowSun, 0.8))));
  lookShadowStats.cloudGate = g;
  return g;
}

/**
 * Round 3, low-sun cast shadow. A cascade shadow removes only the key; what
 * is left is the sky fill (hemisphere) and the IBL, and at a 7 deg sun the
 * grade lifts both (cool open-sky fill), so a tree or house shadow on flat
 * ground was within a few percent of the lit ground beside it. Below
 * `fromDeg` of sun this scales the fill and IBL down (full by `fullDeg`),
 * in clear air only, so a shadowed pixel keeps its cool tint but is clearly
 * darker than the lit one. The key (`e.sun`) is NOT touched: clouds, water,
 * mist and the air read it. Runs from cinema-frame.js after the grade.
 * Master dial `lowSunShadow` (0 = none). Desktop High/Ultra only (r5):
 * Medium, phone and Low get weight 0 and key gain 1. Returns the weight applied.
 */
export function applyLookShadowLowSun(e, cfg = LOOK_SHADOW_CFG, profile) {
  const gate = cfg.enabled === true && e ? lowSunProfileGate(profile) : 0;
  if (!(gate > 0)) { lowSunKey = 1; lookShadowStats.lowSun = 0; return 0; }
  const L = cfg.lowSun ?? {};
  const k = Math.max(0, num(cfg.lowSunShadow, 1)) * gate;
  const el = Math.asin(Math.max(-1, Math.min(1, num(e.sunDir?.[1], 1)))) * 180 / Math.PI;
  const w = k * smooth(num(L.upFromDeg, -1), num(L.upFullDeg, 2.5), el)
    * (1 - smooth(num(L.fullDeg, 9), num(L.fromDeg, 17), el)) * (1 - Math.max(0, Math.min(1, num(e.overcast, 0))));
  if (w > 0) {
    e.fill *= Math.max(0.05, 1 - num(L.fill, 0.5) * w);
    e.environment *= Math.max(0.05, 1 - num(L.env, 0.4) * w);
  }
  lowSunKey = 1 + Math.max(0, num(L.key, 0)) * w;
  lookShadowStats.lowSun = +w.toFixed(3);
  return w;
}
let lowSunKey = 1;
/**
 * r5: the low-sun fill, IBL and key change is a desktop High/Ultra look like
 * the reach (Medium, phone and Low keep today's pixels). An explicit profile
 * (the node gate) answers 1/0 at once; the live profile eases over about half
 * a second, so a governor step does not pop. The first call snaps (a boot or
 * a still capture is never caught mid-ramp).
 */
let gateW = -1, gateT = 0;
function lowSunProfileGate(profile) {
  if (profile !== undefined) return lookProfileKey(profile) && profile.cascades > 0 ? 1 : 0;
  let p = null;
  try { p = cinemaProfile(); } catch { p = null; }
  const target = p && lookProfileKey(p) && p.cascades > 0 ? 1 : 0;
  const now = globalThis.performance?.now?.() ?? Date.now();
  if (gateW < 0) gateW = target;
  else gateW += Math.sign(target - gateW) * Math.min(Math.abs(target - gateW), Math.max(0, Math.min(1, (now - gateT) / 500)));
  gateT = now;
  lookShadowStats.lowSunGate = +gateW.toFixed(3);
  return gateW;
}
/**
 * The cascade lights' gain under a low sun (CinemaShadowRig): the direct term
 * on lit materials only, so the ground the fill cut darkened is lit back by
 * the sun and the shadow beside it is the difference. The shared key (clouds,
 * water, air read `e.sun` through uCinemaAir.w) is not touched. 1 = none.
 */
export function lookShadowKeyGain(cfg = LOOK_SHADOW_CFG) {
  return cfg.enabled === true ? lowSunKey : 1;
}

/**
 * Parcel homes cast into the sun cascades only when the legacy sun light
 * casts, which the cinema rig always turns off, so in Enhanced no house ever
 * cast a shadow. True on desktop High/Ultra while this pass's cascades run.
 */
export function lookShadowHomesCast(runtime, cfg = LOOK_SHADOW_CFG) {
  return cfg.enabled === true && runtime?.cinemaShadows?.lookCasters === true;
}

/**
 * Round 3: the desktop terrain shadow map's receiver takes four bilinear PCF
 * footprints instead of one, so the stair-stepped edge on a grazing cliff
 * (yosemite__golden) becomes a soft ramp. New shader text: the terrain
 * program key gains `-ls5` (terrainShadowKey; r4 widens the ring to ~2.4
 * texels under a low sun; the sign-off fix put it behind `uTsSoft`, -ls4 ->
 * -ls5). Flag off: today's text.
 */
export function lookShadowTerrainSoft(cfg = LOOK_SHADOW_CFG) {
  return cfg.enabled === true && cfg.terrainSoft !== false;
}

/**
 * Sign-off fix (rule 5): the soft ring is a desktop High/Ultra look. The
 * shader text is the same on every tier (a governor step never recompiles
 * the terrain); this uniform picks the path at run time. 0 = the original
 * single 2x2 PCF at its original cost and result (Medium, phone, Low), 1 =
 * the five-footprint ring. Bound to the earth surface only when the soft text
 * is compiled (terrain-shadow.js); flag off it is never bound.
 */
export const lookShadowTerrainSoftUniform = { value: 0 };

/**
 * TerrainShadowRig, every frame: the soft-ring gate follows the shared tier
 * test on the live cinema profile, eased like lowSunProfileGate (about half a
 * second, the first call snaps). An explicit profile (the node gate) answers
 * 1/0 at once and does not touch the uniform. Returns the gate.
 */
let softW = -1, softT = 0;
export function lookShadowTerrainSoftGate(profile, cfg = LOOK_SHADOW_CFG) {
  if (!lookShadowTerrainSoft(cfg)) return 0; // flag off: no soft text, nothing bound, nothing written
  if (profile !== undefined) return lookTierAllowed(profile) ? 1 : 0;
  let p = null;
  try { p = cinemaProfile(); } catch { p = null; }
  const target = p && lookTierAllowed(p) ? 1 : 0;
  const now = globalThis.performance?.now?.() ?? Date.now();
  if (softW < 0) softW = target;
  else softW += Math.sign(target - softW) * Math.min(Math.abs(target - softW), Math.max(0, Math.min(1, (now - softT) / 500)));
  softT = now;
  lookShadowTerrainSoftUniform.value = softW;
  lookShadowStats.terrainSoft = +softW.toFixed(3);
  return softW;
}
