// R25 C SKY — "one atmosphere": the per-frame hooks W0 wired into FlyScene.
//
//   r25SkyAtmo(runtime, rim, voidC, ctx)  satellite branch, right after the
//       weather grey-mix: evaluates the analytic sky model (lib/fly/sky-model.js)
//       and overwrites the rim / void triples IN PLACE, so the fog, the tile
//       edge fade, the depth haze, the SkyDome band (setSkyAtmo), the overcast
//       lid and the aerial rim — every consumer below it in the frame — read the
//       model's horizon. The round-6 rule (one rim, one source) holds; the
//       source is now a scattering integral instead of a keyframe table.
//   r25SkyFrame(runtime, ctx)  the LAST write of the -50 block: retires the
//       haze stack by the aerial pass's authority, rotates the IBL so the HDRI
//       sun sits on runtime.sun.az, fills _aerialFeed.sunDir, and publishes the
//       frame state the Enhanced aerial / cloud passes read in their update().
//
// THE ONE PREDICATE. Every decision below is `r25On(R25_SKY, sub)` — flag AND
// the live profile is 'enhanced' AND the __flyR25Sky dev sub-pin is not 0. In
// Classic both hooks return before writing anything (verify-r25-flagoff [3]).
// The one thing Classic DOES do here is UNDO: the IBL rotation is the only
// state this module leaves on the scene between frames (FlyScene rewrites fog
// density and the depth-haze band every satellite frame), so the frame the
// profile flips back, or the style leaves satellite, restores the rotation it
// found. Nothing else persists.
//
// SATELLITE ONLY. r25SkyAtmo is only called from the satellite branch; the
// frame hook returns (after the undo) for every other style. Toy is untouched.
//
// NO PER-FRAME ALLOCATION after the first Enhanced frame: the model state,
// the published frame object and the saved rotation are created once, lazily
// (Enhanced data is allocated lazily — plan ruling 5).

import { AERIAL_LAW, R25_SKY, SKY, WORLD_EDGE } from './fly-constants';
import { r25On } from './visuals-profile';
import { getBend, getEdgeFade, setDepthHazeRGB } from './toy-world/world-bend';
import { weatherFogDensity, weatherHazeMax } from './weather-model';
import { computeSkyModel, createSkyState } from './sky-model';
import { legacyBucket, resolveSky, skyDuskOn, trueElevationDeg } from './sky-dusk';
import { satelliteExposureStops } from './satellite-atmosphere';

const DEG = Math.PI / 180;
const smooth = (a, b, v) => {
  let t = (v - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};

/**
 * The composite's `day` weight — immersiveLighting(sun).day, i.e.
 * smooth(-6, 16, true elevation). The cloud composite shows
 * mix(HDRI, sky, day); the one horizon is the same mix. Arithmetic-equal to
 * lib/fly/immersive.js (asserted by scripts/verify-r25-sky.mjs) without
 * allocating its result object every frame.
 */
export function skyDayWeight(sinEl) {
  const el = Math.asin(Math.min(1, Math.max(-1, Number.isFinite(sinEl) ? sinEl : 1))) / DEG;
  return smooth(-6, 16, el);
}

/**
 * The dome's live horizon dip, from the SAME inputs FlyScene's `setSkyDip`
 * line uses (the live edge-fade start, the effective bend k, the visual eye
 * AGL). r25SkyAtmo runs ~390 lines BEFORE that line in the same frame, so it
 * cannot read the dome's value; this is the identical formula
 * (verify-r25-sky.mjs source-checks FlyScene's expression against it).
 */
export function skyDipFor(edgeStartM, bendK, eyeAgl) {
  const dipStartM = edgeStartM > 1e8 ? WORLD_EDGE.fade.satellite.startM : edgeStartM;
  const rimDrop = dipStartM * dipStartM * bendK + eyeAgl;
  return rimDrop / Math.hypot(rimDrop, dipStartM);
}

/** App hour-angle world direction at the TRUE elevation. Writes out[3]. */
export function sunDirTrue(sun, out) {
  const sinEl = Math.min(1, Math.max(-1, Number.isFinite(sun?.sinEl) ? sun.sinEl : 1));
  const az = Number.isFinite(sun?.az) ? sun.az : 0;
  const c = Math.sqrt(1 - sinEl * sinEl);
  out[0] = -Math.sin(az) * c;
  out[1] = sinEl;
  out[2] = Math.cos(az) * c;
  return out;
}

// --- the published frame state (what the Enhanced passes read) ------------
// `live` is true only on frames where r25SkyFrame ran Enhanced in satellite;
// `modelLive` additionally requires r25SkyAtmo to have evaluated the model in
// this same frame. The passes render at priority 1, after the -50 block, so
// they always read THIS frame's values.
const r25Sky = {
  live: false,
  modelLive: false,
  flags: { model: false, skyDip: false, aerialSun: false, cloudAir: false, retireStack: false, iblAlign: false, exposure: false },
  model: null, // the sky-model state (lazy)
  exposure: 1,
  exposureStops: 0,
  sunDir: [0, 1, 0],
  aerialAuthority: 0,
  iblTheta: 0,
  frame: 0,
};

/**
 * Which AerialPerspectiveEffect TEXT the chain carries — the Enhanced variant
 * iff sun-angle in-scatter or the pre-curve exposure is asked for. Effects.jsx
 * (el) and its raw() twin (the prewarm) both call this, so they cannot build
 * different programs (the R21 el/raw rule). Satellite-only by the caller.
 */
export function aerialR25Wanted() {
  return r25On(R25_SKY, 'aerialSun') || r25On(R25_SKY, 'exposure');
}

/** Read-only view for the Enhanced aerial / cloud passes and the gates. */
export function getR25Sky() {
  return r25Sky;
}

// The aerial post pass's live strength. AerialPerspective registers a reader
// of its own `_state.strength` at module scope (it is the authoritative writer;
// FlyScene's feed object goes stale when the pass is cleared). A read, never a
// write; with no reader registered the authority is 0 and nothing retires.
let _aerialReader = null;
export function registerAerialStrengthReader(fn) {
  _aerialReader = typeof fn === 'function' ? fn : null;
}
function aerialStrengthNow() {
  const v = _aerialReader ? _aerialReader() : 0;
  return Number.isFinite(v) ? v : 0;
}

let _tick = 0;
let _atmoTick = -1;
let _rimRef = null; // FlyScene's _atmoRim (a stable reference), read in the frame hook
let _classicRim = null;
let _classicVoid = null;
let _dirScratch = null;
let _inp = null;

// IBL rotation undo record: the scene we rotated and what we found on it.
let _iblScene = null;
let _iblSaved = null;

function flagsNow(f) {
  f.model = r25On(R25_SKY, 'model');
  f.skyDip = r25On(R25_SKY, 'skyDip');
  f.aerialSun = r25On(R25_SKY, 'aerialSun');
  f.cloudAir = r25On(R25_SKY, 'cloudAir');
  f.retireStack = r25On(R25_SKY, 'retireStack');
  f.iblAlign = r25On(R25_SKY, 'iblAlign');
  f.exposure = r25On(R25_SKY, 'exposure');
  return f;
}

// FlyScene passes plain [r,g,b] arrays; a THREE.Color is accepted too (the
// verify-r25-flagoff recording fixture hands one in).
const rd = (t, i) => (t.isColor ? (i === 0 ? t.r : i === 1 ? t.g : t.b) : t[i]);
function wr(t, i, v) {
  if (t.isColor) {
    if (i === 0) t.r = v;
    else if (i === 1) t.g = v;
    else t.b = v;
  } else t[i] = v;
}

/**
 * Called immediately after applyWeatherAtmo(): may overwrite rim/voidC IN
 * PLACE with the analytic sky model's colours so fog, edge fade, depth haze,
 * setSkyAtmo and the aerial rim all read one horizon.
 * ctx is FlyScene's module-scope scratch (see _r25Ctx).
 */
export function r25SkyAtmo(runtime, rim, voidC, ctx) {
  if (!ctx || ctx.style !== 'satellite' || !rim) return;
  // The model feeds several Enhanced consumers; it is evaluated when any of
  // them is on, and only `model` lets it OWN the rim.
  const needModel =
    r25On(R25_SKY, 'model') || r25On(R25_SKY, 'aerialSun') || r25On(R25_SKY, 'cloudAir') || r25On(R25_SKY, 'skyDip');
  if (!needModel) return;
  const s = (r25Sky.model ??= createSkyState());
  _classicRim ??= [0, 0, 0];
  _classicVoid ??= [0, 0, 0];
  _dirScratch ??= [0, 1, 0];
  _inp ??= {
    sunDir: _dirScratch,
    eyeAltM: 0,
    dip: 0,
    overcastT: 0,
    fogT: 0,
    day: 1,
    classicRimSRGB: _classicRim,
    classicVoidSRGB: _classicVoid,
  };
  for (let c = 0; c < 3; c++) {
    _classicRim[c] = rd(rim, c);
    _classicVoid[c] = voidC ? rd(voidC, c) : _classicRim[c];
  }
  const sun = runtime?.sun;
  sunDirTrue(sun, _dirScratch);
  const wx = runtime?.weather?.wx;
  _inp.eyeAltM = ctx.flight?.pos?.y ?? 0;
  _inp.dip = skyDipFor(getEdgeFade().startM, getBend().k, Number.isFinite(ctx.eyeAgl) ? ctx.eyeAgl : 0);
  _inp.overcastT = wx?.overcastT ?? 0;
  _inp.fogT = wx?.fogT ?? 0;
  _inp.day = skyDayWeight(sun?.sinEl);
  computeSkyModel(s, _inp, R25_SKY.model);
  _atmoTick = _tick;
  _rimRef = rim;
  if (!r25On(R25_SKY, 'model')) return;
  for (let c = 0; c < 3; c++) {
    wr(rim, c, s.rimSRGB[c]);
    if (voidC) wr(voidC, c, s.voidSRGB[c]);
  }
}

function undoIbl() {
  if (!_iblScene || !_iblSaved) return;
  const e = _iblScene.environmentRotation;
  const b = _iblScene.backgroundRotation;
  if (e) e.set(_iblSaved[0], _iblSaved[1], _iblSaved[2]);
  if (b) b.set(_iblSaved[3], _iblSaved[4], _iblSaved[5]);
  _iblScene = null;
}

/** Circular mean of two azimuths weighted (1-s, s). */
function azMix(a, b, s) {
  if (!(s > 0)) return a;
  if (!(s < 1)) return b;
  return Math.atan2((1 - s) * Math.sin(a) + s * Math.sin(b), (1 - s) * Math.cos(a) + s * Math.cos(b));
}

/**
 * The sun azimuth (app convention) of the sky SatEnvironment is — or is about
 * to be — showing, from the same pure resolvers it uses (resolveSky when the
 * R19 dusk ladder is on, legacyBucket otherwise). A blend step {a, b, s}
 * takes the circular mean. null when a bucket has no table entry.
 */
export function hdriSunAzFor(sun, table = R25_SKY.iblAlign.hdriSunAz) {
  const az = Number.isFinite(sun?.az) ? sun.az : 0;
  let a;
  let b;
  let s;
  if (skyDuskOn()) {
    const r = resolveSky(az, trueElevationDeg(sun?.sinEl));
    a = r.a;
    b = r.b;
    s = r.s;
  } else {
    a = b = legacyBucket(sun?.frac ?? 1, az);
    s = 0;
  }
  const za = table[a];
  const zb = table[b];
  if (!Number.isFinite(za) || !Number.isFinite(zb)) return null;
  return azMix(za, zb, s);
}

/**
 * The +Y rotation that carries the HDRI's baked sun (azimuth hdriAz, app
 * hour-angle basis) onto the live sun azimuth. three samples the environment
 * at R^T·dir, so a texel at local direction d shows at world R·d, and a +Y
 * rotation by theta moves an app azimuth a to a - theta; hence
 * theta = hdriAz - sunAz, wrapped to (-pi, pi]. verify-r25-sky.mjs proves it
 * through three's own Euler -> Matrix4 -> transpose chain, not this comment.
 */
export function iblTheta(hdriAz, sunAz) {
  const t = hdriAz - sunAz;
  return Math.atan2(Math.sin(t), Math.cos(t));
}

/** Called once per frame after the style chain (sky/cloud/aerial/IBL/exposure writes). */
export function r25SkyFrame(runtime, ctx) {
  _tick += 1;
  const sat = !!ctx && ctx.style === 'satellite';
  const on = sat && r25On(R25_SKY);
  if (!on) {
    if(r25Sky.live && sat){
      if(ctx.classicSunColor)ctx.sun?.color.copy(ctx.classicSunColor);
      if(ctx.classicHemiColor)ctx.hemi?.color.copy(ctx.classicHemiColor);
    }
    // Classic / toy / sub-pin: undo the only persistent write, then nothing.
    if (_iblScene) undoIbl();
    if (r25Sky.live) {
      r25Sky.live = false;
      r25Sky.modelLive = false;
      if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && window.__flyStats?.r25Sky) {
        window.__flyStats.r25Sky.live = false;
      }
    }
    return;
  }
  const f = flagsNow(r25Sky.flags);
  r25Sky.live = true;
  r25Sky.frame = _tick;
  r25Sky.modelLive = _atmoTick === _tick - 1 && !!r25Sky.model?.valid;
  const sun = runtime?.sun;
  sunDirTrue(sun, r25Sky.sunDir);
  const wx = runtime?.weather?.wx;

  // The same model that illuminates clouds supplies the scene key and sky
  // fill. Keep the existing intensity/day/night ramps and use a bounded
  // chroma response, so dusk cannot turn into a red floodlight.
  if(r25Sky.modelLive && f.model){
    const m=r25Sky.model,w=m.day;
    const set=(light,base,rgb,lo,hi)=>{
      if(!light?.color||!base)return;
      const y=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
      if(y<1e-6){light.color.copy(base);return;}
      light.color.setRGB(base.r*(1-w)+Math.min(hi,Math.max(lo,rgb[0]/y))*w,
        base.g*(1-w)+Math.min(hi,Math.max(lo,rgb[1]/y))*w,
        base.b*(1-w)+Math.min(hi,Math.max(lo,rgb[2]/y))*w);
    };
    set(ctx.sun,ctx.classicSunColor,m.key,.62,1.14);
    set(ctx.hemi,ctx.classicHemiColor,m.ambient,.60,1.25);
  }

  // (1) RETIRE THE HAZE STACK — by the aerial pass's AUTHORITY. The post pass
  //     (AerialPerspective, the living-air law) is the one distance law; where
  //     it runs at full authority the 16-55 km tile band is a second fog on top
  //     of it and goes to 0, and the exp2 fog falls to the cruise floor
  //     (weather still thickens it). Where it does NOT run (the night ramp
  //     takes it out; the harness fleet pins it to 0) the Classic band stays,
  //     so Enhanced can never leave far terrain less hazed than Classic did.
  //     The 60-120 km rim fade — the world edge — is not touched.
  const auth = Math.min(1, Math.max(0, aerialStrengthNow() / 0.55));
  r25Sky.aerialAuthority = auth;
  if (f.retireStack && auth > 0) {
    const fog = ctx.scene?.fog;
    if (fog && fog.isFogExp2) {
      const floorD = wx ? weatherFogDensity(R25_SKY.retireStack.fogFloor, wx) : R25_SKY.retireStack.fogFloor;
      fog.density += (floorD - fog.density) * auth;
    }
    const lawOn = AERIAL_LAW.enabled && !!AERIAL_LAW.styles?.satellite;
    const classicMax = lawOn ? 0 : wx ? weatherHazeMax(SKY.haze.max, wx) : SKY.haze.max;
    const r = _rimRef;
    if (r) setDepthHazeRGB(SKY.haze.startM, SKY.haze.endM, rd(r, 0), rd(r, 1), rd(r, 2), classicMax * (1 - auth));
  }

  // (2) IBL ALIGNMENT — rotate environment + background about +Y so the HDRI's
  //     baked sun sits on the live sun azimuth (the key light's, the
  //     hillshade's and the dome lobe's). Classic writes nothing (0 = W0).
  const scene = ctx.scene;
  if (f.iblAlign && scene?.environmentRotation && sun) {
    const hAz = hdriSunAzFor(sun);
    if (hAz != null) {
      if (_iblScene !== scene) {
        if (_iblScene) undoIbl();
        _iblSaved ??= [0, 0, 0, 0, 0, 0];
        const e = scene.environmentRotation;
        const b = scene.backgroundRotation;
        _iblSaved[0] = e.x;
        _iblSaved[1] = e.y;
        _iblSaved[2] = e.z;
        _iblSaved[3] = b?.x ?? 0;
        _iblSaved[4] = b?.y ?? 0;
        _iblSaved[5] = b?.z ?? 0;
        _iblScene = scene;
      }
      const th = iblTheta(hAz, sun.az);
      r25Sky.iblTheta = th;
      if (scene.environmentRotation.y !== th) scene.environmentRotation.y = th;
      if (scene.backgroundRotation && scene.backgroundRotation.y !== th) scene.backgroundRotation.y = th;
    }
  } else if (_iblScene) {
    undoIbl();
  }

  // (3) THE AERIAL SUN — the in-scatter's Rayleigh tilt and Mie lobe point at
  //     the true-elevation sun (the basis setHillDir and the key light use).
  if (f.aerialSun && ctx.aerialFeed) {
    const d = (ctx.aerialFeed.sunDir ??= [0, 1, 0]);
    d[0] = r25Sky.sunDir[0];
    d[1] = r25Sky.sunDir[1];
    d[2] = r25Sky.sunDir[2];
  }

  // (4) PRE-CURVE EXPOSURE — the satellite-atmosphere stops, moved in front of
  //     the display curve (the grade then carries balanceTint only), plus C's
  //     one luminance knob (the C<->D contract: drift is fixed here only).
  if (f.exposure) {
    r25Sky.exposureStops = satelliteExposureStops(sun) + (R25_SKY.exposure.biasStops ?? 0);
    r25Sky.exposure = 2 ** r25Sky.exposureStops;
  } else {
    r25Sky.exposureStops = 0;
    r25Sky.exposure = 1;
  }

  // Dev telemetry on a 30-frame beat (the __flyStats idiom); compiled out of
  // production with the NODE_ENV constant.
  if (process.env.NODE_ENV === 'development' && _tick % 30 === 0 && typeof window !== 'undefined' && window.__flyStats) {
    const m = r25Sky.model;
    const st = (window.__flyStats.r25Sky ??= {});
    st.live = true;
    st.modelLive = r25Sky.modelLive;
    st.exposure = +r25Sky.exposure.toFixed(4);
    st.authority = +auth.toFixed(3);
    st.iblTheta = +r25Sky.iblTheta.toFixed(5);
    if (m?.valid) {
      st.rimSRGB = m.rimSRGB.map((v) => +v.toFixed(4));
      st.horizonLin = m.horizonAvg.map((v) => +v.toFixed(4));
      st.zenithLin = m.zenith.map((v) => +v.toFixed(4));
      st.dip = +m.dip.toFixed(5);
      st.day = +m.day.toFixed(4);
      st.integrations = m.integrations;
    }
  }
}
