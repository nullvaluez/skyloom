import { Vector4 } from 'three';
import { LOOK_ATMOS } from './fly-constants';
import { pinned } from './fly-pins';

/** LOOK PASS A (ATMOS): air density, aerial perspective, fog and mist: the depth of the frame.
 * The owner block with any `?flags=` or console pin applied; FLY_LOOK_PASS.md. */
export const LOOK_ATMOS_CFG = pinned(LOOK_ATMOS, '__flyLookAtmosOverride');
export const LOOK_ATMOS_ON = LOOK_ATMOS_CFG.enabled === true;

/*
 * THE BOUNDARY LAYER (LOOK PASS A, change 1).
 *
 * What the baseline lacked: the physical aerial volume (PHYS_SKY, Hillaire
 * 2020) carries Earth's CLEAR air: sea-level extinction about 0.018 /km in
 * green, so terrain 20 km out keeps about 70% of its contrast, and above 900 m
 * AERIAL_CLARITY cuts its in-scatter further. Real air near the ground is a
 * hazy mixed layer one to two kilometres deep, several times thicker than that,
 * with a top you can see from above. That layer is what this adds.
 *
 * The model, per ground pixel, inside the Enhanced aerial pass (no new pass,
 * no new draw, no new texture):
 *  - density is a slab: 1 up to `topM` above the ground datum, then
 *    exp(-(h - topM) / topFadeM). Its antiderivative is closed form, so the
 *    optical depth along the straight ray from the eye to the pixel is exact:
 *    tau = beta x path x (F(h_pixel) - F(h_eye)) / (h_pixel - h_eye);
 *  - `path` is the metric distance past a crisp radius (`crispM`, growing with
 *    eye height by `crispPerEyeM`), so the first 1.5 km low down, and the city
 *    straight below the aircraft from altitude, are untouched: no veil;
 *  - the colour the air tends to is the physical sky's own horizon in this
 *    pixel's azimuth (cinemaSky on a ray lifted to just above the horizon), so
 *    distant land melts into the sky above it: blue at noon, peach toward a low
 *    sun, cool away from it. Rays that look DOWN take a higher sky row
 *    (`downBlue`), so seen from above the layer reads blue, and only the grazing
 *    band at the horizon reads white: a boundary-layer top;
 *  - plus the layer's own single scatter of the key light: an isotropic part
 *    (`iso`) that warms the whole layer at golden hour (warm sunlit air over the
 *    blue sky term reads lavender away from the sun) and a forward lobe
 *    (Henyey-Greenstein, `lobeG`) around the sun's azimuth.
 * Night thins it (`nightK`) so far city lights still read as points.
 */
const C = LOOK_ATMOS_CFG;
const L = C.layer ?? {};

/** The uniforms (shared holders, merged into the Enhanced aerial effect). */
export const LOOK_ATMOS_UNIFORMS = {
  // x extinction per metre at the layer base, y layer top (m), z top fade (m), w on
  uLookAtmosA: { value: new Vector4(0, 1800, 900, 0) },
  // x crisp radius (m), y crisp radius per metre of eye height, z sun lobe gain, w lobe g
  uLookAtmosB: { value: new Vector4(1500, 1, 0, 0.7) },
  // x below-horizon sky row lift, y horizon lift, z haze gain, w crisp ramp (x crisp radius)
  uLookAtmosC: { value: new Vector4(0.5, 0.03, 1, 1.6) },
  // x isotropic sunlit scatter gain (warms the whole layer at golden hour),
  // y gain of the haze colour on steep rays from altitude (the blue ground tint), z-w its eye-height ramp (m)
  uLookAtmosD: { value: new Vector4(0, 0, 0, 0) },
};

const MAIN = 'void mainImage(';
const AT = '      if(uR25Mode.x>.5)lit=mix(lit,haze,smoothstep(uR25WorldFade.x,uR25WorldFade.y,dXZ));\n';
const DECL = /* glsl */ `uniform vec4 uLookAtmosA,uLookAtmosB,uLookAtmosC,uLookAtmosD;
// LOOK PASS A (ATMOS): the hazy boundary layer (lib/fly/look-atmos.js).
float laF(float h){return h<uLookAtmosA.y?h:uLookAtmosA.y+uLookAtmosA.z*(1.-exp(-(h-uLookAtmosA.y)/uLookAtmosA.z));}
float laD(float h){return h<uLookAtmosA.y?1.:exp(-(h-uLookAtmosA.y)/uLookAtmosA.z);}
vec3 lookAtmos(vec3 lit,vec3 metricRay,float trueY){
  float dM=length(metricRay);
  float he=uCamPos.y-uGroundY,hp=trueY-uGroundY,dh=hp-he;
  float dens=abs(dh)<1.?laD(he):(laF(hp)-laF(he))/dh;
  float crisp=uLookAtmosB.x+uLookAtmosB.y*max(he,0.);
  float path=max(0.,dM-crisp)*smoothstep(crisp,crisp*uLookAtmosC.w,dM);
  float T=exp(-uLookAtmosA.x*path*max(dens,0.));
  vec3 dir=metricRay/max(dM,1.);
  float down=clamp(-dir.y,0.,1.);
  float hi=smoothstep(uLookAtmosD.z,uLookAtmosD.w,he)*smoothstep(0.,.25,down);
  vec3 col=cinemaSky(normalize(vec3(dir.x,uLookAtmosC.y+down*uLookAtmosC.x*(1.+hi),dir.z)))*uLookAtmosC.z*mix(1.,uLookAtmosD.y,hi);
  float g=uLookAtmosB.w,mu=dot(dir,uCinemaSun);
  float hg=(1.-g*g)/pow(max(1.+g*g-2.*g*mu,1e-4),1.5)*.0796;
  col+=uCinemaKeyColor*uCinemaAir.w*(hg*uLookAtmosB.z+uLookAtmosD.x);
  return lit*T+col*(1.-T);
}
`;

function once(src, from, to, what) {
  const at = src.indexOf(from);
  if (at < 0 || src.indexOf(from, at + from.length) >= 0) throw new Error(`look-atmos: ${what} anchor ${at < 0 ? 'missing' : 'repeated'}`);
  return src.slice(0, at) + to + src.slice(at + from.length);
}

/**
 * The Enhanced aerial text with the boundary layer (flag on), or `src`
 * unchanged. Needs the physical branch (PHYS_SKY); without it the text is
 * returned as it is.
 */
export function lookAtmosAerialShader(src, on = LOOK_ATMOS_ON) {
  if (!on || !src.includes(AT)) return src;
  const out = once(src, AT, `      if(uLookAtmosA.w>.5)lit=lookAtmos(lit,metricRay,trueY);\n${AT}`, 'world fade');
  return once(out, MAIN, `${DECL}${MAIN}`, 'mainImage');
}

const num = (v, d) => (Number.isFinite(v) ? v : d);
const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/*
 * GROUND MIST (LOOK PASS A, change 3). GROUND_MIST's time law is a dawn
 * event: zero from mid-morning to after sunset unless the feed reports fog or
 * rain. This raises a floor under it: a thin daytime residual in the basins
 * and an evening rise that starts in the golden hour (cooling air pools in the
 * valleys before the sun sets) and hands back to the night level. 0 when the
 * flag is off or the device is outside desktop High/Ultra (set per frame by
 * AtmosphereRig), so the node gates and Medium keep the old law exactly.
 */
let _mistAllowed = false;
/** The floor under GROUND_MIST's time-of-day strength (true sun elevation, degrees). */
export function lookMistFloor(elDeg, morning) {
  if (!LOOK_ATMOS_ON || !_mistAllowed || !Number.isFinite(elDeg)) return 0;
  const M = C.mist ?? {};
  const k = num(C.mistLevel, 1);
  const day = num(M.day, 0.3) * k;
  if (morning) return day;
  const eve = k * num(M.evening, 1) * smooth(num(M.eveFrom, 16), num(M.eveFull, 3), elDeg) * (1 - smooth(num(M.nightFrom, -5), num(M.nightTo, -14), elDeg));
  return Math.max(day * smooth(num(M.nightFrom, -5), 2, elDeg), eve);
}

/**
 * Per frame (AtmosphereRig): the layer for this frame's light, or off. `env`
 * is the cinema environment; `allowed` is the desktop High/Ultra gate (Medium,
 * phones and Low keep today's pixels: w = 0 skips the term).
 */
export function updateLookAtmos(env, allowed) {
  const A = LOOK_ATMOS_UNIFORMS.uLookAtmosA.value;
  _mistAllowed = LOOK_ATMOS_ON && !!allowed;
  if (!LOOK_ATMOS_ON || !allowed || !env) {
    A.w = 0;
    return;
  }
  const density = num(C.density, 1);
  const golden = num(env.golden, 0);
  const day = num(env.day, 1);
  const tod = (1 + golden * num(L.goldenBoost, 0.5)) * (num(L.nightK, 0.3) + (1 - num(L.nightK, 0.3)) * day);
  const weather = 1 - 0.5 * Math.min(1, Math.max(0, num(env.overcast, 0)));
  A.set((num(L.betaKm, 0.05) / 1000) * density * tod * weather, num(L.topM, 1800), Math.max(50, num(L.topFadeM, 900)), 1);
  LOOK_ATMOS_UNIFORMS.uLookAtmosB.value.set(
    num(L.crispM, 1500),
    num(L.crispPerEye, 1),
    num(C.glow, 1) * num(L.lobe, 0.04) * (num(L.lobeDay, 0.4) + golden),
    num(L.lobeG, 0.7)
  );
  const hiRamp = L.highEyeM ?? [2500, 6000];
  LOOK_ATMOS_UNIFORMS.uLookAtmosD.value.set(num(C.glow, 1) * num(L.iso, 0.01) * (num(L.isoDay, 0.2) + golden), num(L.highGain, 0.7), num(hiRamp[0], 2500), num(hiRamp[1], 6000));
  LOOK_ATMOS_UNIFORMS.uLookAtmosC.value.set(num(L.downBlue, 0.5), num(L.horizonLift, 0.03), num(L.hazeGain, 1), Math.max(1.01, num(L.crispRamp, 1.6)));
}
