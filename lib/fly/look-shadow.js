import { Vector4 } from 'three';
import { LOOK_SHADOW } from './fly-constants';
import { pinned } from './fly-pins';

/** LOOK PASS B (SHADOW): sun shadow reach, ambient occlusion, contact and cloud shadow: what grounds the world.
 * The owner block with any `?flags=` or console pin applied; FLY_LOOK_PASS.md. */
export const LOOK_SHADOW_CFG = pinned(LOOK_SHADOW, '__flyLookShadowOverride');
export const LOOK_SHADOW_ON = LOOK_SHADOW_CFG.enabled === true;

/** Diagnostics (graphics review / dev: window.__flyLookShadow). */
export const lookShadowStats = { cloudPatch: 'not-built' };
if (globalThis.window) globalThis.window.__flyLookShadow = lookShadowStats;

const num = (v, d) => (Number.isFinite(v) ? v : d);

/** 'ultra' | 'high' for a desktop High/Ultra cinema profile (and its governor rungs), else null. */
function lookProfileKey(profile) {
  const name = String(profile?.name || '');
  return name.startsWith('ultra') ? 'ultra' : name.startsWith('high') ? 'high' : null;
}

/**
 * Sun-shadow cascade range (metres) for a cinema profile. Flag off, or any
 * profile that is not desktop High/Ultra (Medium, phone, Low): the profile's
 * own range, unchanged.
 */
export function lookShadowRangeM(profile, cfg = LOOK_SHADOW_CFG) {
  const base = profile?.shadowRangeM ?? 0;
  if (cfg.enabled !== true || !profile) return base;
  const key = lookProfileKey(profile);
  if (!key) return base;
  const want = num(cfg.rangeM?.[key], base) * num(cfg.reach, 1);
  return Math.max(base, want);
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

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

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
export function lookShadowAoSun(ao, sinEl, base, state, look = LOOK_SHADOW_CFG) {
  if (look.enabled !== true || !ao || !base || !state) return null;
  const tuned = lookShadowAoConfig(base, look);
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
 * cloud ever reads as casting a shadow. This replaces that one line with a
 * Beer-law cover (1 - exp(-density * opticalK)) scaled to `darkMax`, a small
 * cool bias toward the open-sky fill, and an air floor so the term does not
 * vanish entirely through the haze. Strength and colour are uniforms, so the
 * dials never recompile the program.
 */
const SHADE_FROM = '   if(casterVisibility>0.)shade=density(projected);';
const SHADE_TO = '   if(casterVisibility>0.)shade=density(projected);\n   float lookRawShade=shade;';
const DARK_FROM = '   scene*=1.-clamp(shade*.32,0.,.23)*day*cloudMix;';
// A low sun throws a cloud's shadow kilometres from it, a long hard-edged band
// across the far terrain; it eases to `lowSun` of its strength there.
const darkTo = (lowSun) => `   // LOOK PASS B (SHADOW): readable cloud shadows (lib/fly/look-shadow.js).
   shade=max(shade,lookRawShade*casterVisibility*uLookCloudShadow.w);
   {float lookCover=(1.-exp(-shade*uLookCloudShadow.y))*uLookCloudShadow.x*day*cloudMix
      *mix(${lowSun.toFixed(3)},1.,smoothstep(.10,.38,shadowDir.y));
    scene*=1.-lookCover*vec3(1.,1.-uLookCloudShadow.z*.45,1.-uLookCloudShadow.z);}`;

function swapOnce(src, from, to) {
  const at = src.indexOf(from);
  if (at < 0 || src.indexOf(from, at + from.length) >= 0) return null;
  return src.slice(0, at) + to + src.slice(at + from.length);
}

/**
 * Patch the Enhanced cloud composite (the holder `ensureR25` builds) once.
 * Flag off, or an anchor drift: nothing changes and `.lookShadow.ok` is false.
 * The pass's own air fades sit between the two anchors and stay as they are;
 * the air floor (w) keeps that fraction of the un-hazed shadow.
 */
export function lookShadowCloudComposite(r25, cfg = LOOK_SHADOW_CFG) {
  if (!r25?.composite || cfg.enabled !== true || r25.lookShadow) return false;
  let f = r25.composite.fragmentShader;
  f = swapOnce(f, SHADE_FROM, SHADE_TO);
  if (f) f = swapOnce(f, DARK_FROM, darkTo(Math.max(0, Math.min(1, num(cfg.cloud?.lowSun, 0.35)))));
  if (f) f = swapOnce(f, 'void main(){', 'uniform vec4 uLookCloudShadow;\nvoid main(){');
  if (!f) {
    r25.lookShadow = { ok: false };
    lookShadowStats.cloudPatch = 'anchor-missing';
    return false;
  }
  r25.composite.fragmentShader = f;
  const u = { value: new Vector4() };
  r25.uniforms.uLookCloudShadow = u;
  r25.composite.uniforms.uLookCloudShadow = u;
  r25.lookShadow = { ok: true, uniform: u };
  lookShadowStats.cloudPatch = 'ok';
  lookShadowStats.cloudUniform = u; // graphics review: live dial (x dark, y optical, z cool, w air floor)
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
