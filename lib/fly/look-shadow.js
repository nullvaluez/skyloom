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

/**
 * Sun-shadow cascade range (metres) for a cinema profile. Flag off, or any
 * profile that is not desktop High/Ultra (Medium, phone, Low): the profile's
 * own range, unchanged.
 */
export function lookShadowRangeM(profile, cfg = LOOK_SHADOW_CFG) {
  const base = profile?.shadowRangeM ?? 0;
  if (cfg.enabled !== true || !profile) return base;
  const name = String(profile.name || '');
  const key = name.startsWith('ultra') ? 'ultra' : name.startsWith('high') ? 'high' : null;
  if (!key) return base;
  const want = num(cfg.rangeM?.[key], base) * num(cfg.reach, 1);
  return Math.max(base, want);
}

/** CSM light frustum depth (lightFar, lightMargin) for the longer reach; null = the rig's own. */
export function lookShadowLightDepth(cfg = LOOK_SHADOW_CFG) {
  if (cfg.enabled !== true) return null;
  return { lightFar: num(cfg.lightFarM, 14000), lightMargin: num(cfg.lightMarginM, 4000) };
}

/**
 * N8AO configuration at city scale: the radius (world metres) and intensity
 * grow; every other field is the caller's. Flag off: `cfg` itself.
 */
export function lookShadowAoConfig(cfg, look = LOOK_SHADOW_CFG) {
  if (look.enabled !== true || !cfg) return cfg;
  const k = num(look.occlusion, 1);
  if (k <= 0) return cfg;
  const ao = look.ao ?? {};
  return {
    ...cfg,
    aoRadius: num(ao.radiusM, cfg.aoRadius) * k,
    intensity: 1 + (num(ao.intensity, cfg.intensity) - 1) * k,
    distanceFalloff: num(ao.distanceFalloff, cfg.distanceFalloff),
  };
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
const DARK_TO = `   // LOOK PASS B (SHADOW): readable cloud shadows (lib/fly/look-shadow.js).
   shade=max(shade,lookRawShade*casterVisibility*uLookCloudShadow.w);
   {float lookCover=(1.-exp(-shade*uLookCloudShadow.y))*uLookCloudShadow.x*day*cloudMix;
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
  if (f) f = swapOnce(f, DARK_FROM, DARK_TO);
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
