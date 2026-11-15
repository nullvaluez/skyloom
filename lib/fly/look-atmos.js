import { Vector2, Vector4 } from 'three';
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
  // x below-horizon sky row lift (low altitude), y horizon lift, z haze gain, w crisp ramp (x crisp radius)
  uLookAtmosC: { value: new Vector4(0.5, 0.03, 1, 1.6) },
  // x isotropic sunlit scatter gain (warms the layer at golden hour),
  // y blue tint of the layer seen from above (0 = the horizon row), z-w its eye-height ramp (m)
  uLookAtmosD: { value: new Vector4(0, 0, 0, 0) },
  // x the layer's opacity ceiling short of the rim (distant ridges keep a
  // silhouette), yzw the tint of its sunlit scatter away from the sun
  // (lavender), already weighted by the golden hour
  uLookAtmosE: { value: new Vector4(1, 1, 1, 1) },
  // x where the rim melt starts (share of the world fade's start), y extra
  // gain of the sunlit scatter toward the sun's azimuth, z the layer-top line's
  // gain seen from altitude, w its place (share of the world fade's start)
  uLookAtmosF: { value: new Vector4(0.45, 0, 0, 0.8) },
};

/** LOOK PASS A: the ground mist's shape (x scale-height factor, y bank edge softness); 1, 0 = GROUND_MIST's own law. */
export const LOOK_MIST_SHAPE = { value: new Vector2(1, 0) };

const MAIN = 'void mainImage(';
const AT = '      if(uR25Mode.x>.5)lit=mix(lit,haze,smoothstep(uR25WorldFade.x,uR25WorldFade.y,dXZ));\n';
const DECL = /* glsl */ `uniform vec4 uLookAtmosA,uLookAtmosB,uLookAtmosC,uLookAtmosD,uLookAtmosE,uLookAtmosF;
// LOOK PASS A (ATMOS): the hazy boundary layer (lib/fly/look-atmos.js).
float laF(float h){return h<uLookAtmosA.y?h:uLookAtmosA.y+uLookAtmosA.z*(1.-exp(-(h-uLookAtmosA.y)/uLookAtmosA.z));}
float laD(float h){return h<uLookAtmosA.y?1.:exp(-(h-uLookAtmosA.y)/uLookAtmosA.z);}
vec3 lookAtmos(vec3 lit,vec3 metricRay,float trueY,vec3 haze,float dXZ){
  float dM=length(metricRay);
  float he=uCamPos.y-uGroundY,hp=trueY-uGroundY,dh=hp-he;
  float dens=abs(dh)<1.?laD(he):(laF(hp)-laF(he))/dh;
  float crisp=uLookAtmosB.x+uLookAtmosB.y*max(he,0.);
  float path=max(0.,dM-crisp)*smoothstep(crisp,crisp*uLookAtmosC.w,dM);
  // The rim: toward the end of the finite world the layer's ceiling rises to 1
  // and its colour becomes the exact sky row behind the terrain (haze), so the
  // far field melts into the sky instead of stopping under it as a flat slab.
  float rim=smoothstep(uR25WorldFade.x*uLookAtmosF.x,uR25WorldFade.x,dXZ);
  vec3 dir=metricRay/max(dM,1.);
  float down=clamp(-dir.y,0.,1.);
  float eyeHi=smoothstep(uLookAtmosD.z,uLookAtmosD.w,he);
  // Low down, the grazing rays (the last few degrees under the horizon) take
  // the exact sky row behind the terrain, horizon band included, and a ceiling
  // near 1 (only rays that look down: ridges above the eye keep the cap).
  float graze=(1.-eyeHi)*smoothstep(0.,.002,down)*(1.-smoothstep(.004,.06,down));
  float tight=(1.-eyeHi)*smoothstep(0.,.002,down)*(1.-smoothstep(.004,.035,down));
  float capO=max(mix(uLookAtmosE.x,1.,rim),mix(uLookAtmosE.x,.96,tight));
  float op=capO*(1.-exp(-uLookAtmosA.x*path*max(dens,0.)));
  // From altitude the steep rays (the city under the aircraft) keep most of their clarity.
  op*=1.-.6*eyeHi*smoothstep(.06,.35,down);
  // The air's colour is the sky's own horizon in this azimuth (low down, rays
  // that look down take a slightly higher, bluer row). Seen from above, the
  // layer is in-scatter over the ground: the bright horizon row tinted blue at
  // constant luminance, so it lifts and blues the ground, never darkens it.
  vec3 col=cinemaSky(normalize(vec3(dir.x,uLookAtmosC.y+down*uLookAtmosC.x*(1.-eyeHi),dir.z)))*uLookAtmosC.z;
  // (x.95: the sky band drawn above the terrain edge measures about 5% under haze.)
  col=mix(col,haze*.95,graze);
  float lum=dot(col,vec3(.2126,.7152,.0722));
  col=mix(col,lum*vec3(.70,.90,1.38),eyeHi*uLookAtmosD.y*smoothstep(.02,.12,down));
  // The layer top seen from altitude: a thin brighter line just short of the rim.
  float lw=uR25WorldFade.x*.12,lx=(dXZ-uR25WorldFade.x*uLookAtmosF.w)/max(lw,1.);
  col*=1.+eyeHi*uLookAtmosF.z*exp(-lx*lx);
  col=mix(col,haze,rim);
  // The layer's own scatter of the key light: warm and stronger toward the
  // sun's azimuth, lavender away from it, plus the forward lobe; tapered to 0
  // at the rim so it never stacks a band under the sky's horizon row.
  float g=uLookAtmosB.w,mu=dot(dir,uCinemaSun);
  float hg=(1.-g*g)/pow(max(1.+g*g-2.*g*mu,1e-4),1.5)*.0796;
  vec2 sh=uCinemaSun.xz,vh=dir.xz;
  float az=.5+.5*dot(sh,vh)*inversesqrt(max(dot(sh,sh)*dot(vh,vh),1e-8));
  float fwd=az*az;
  vec3 kc=uCinemaKeyColor*uCinemaAir.w;
  vec3 sc=mix(vec3(dot(kc,vec3(.2126,.7152,.0722)))*uLookAtmosE.yzw,kc*(1.+uLookAtmosF.y*fwd),fwd);
  col+=(sc*uLookAtmosD.x+kc*hg*uLookAtmosB.z)*(1.-max(rim,graze));
  return mix(lit,col,op);
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
  const out = once(src, AT, `      if(uLookAtmosA.w>.5)lit=lookAtmos(lit,metricRay,trueY,haze,dXZ);\n${AT}`, 'world fade');
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
    LOOK_MIST_SHAPE.value.set(1, 0);
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
  const hiRamp = L.highEyeM ?? HI_RAMP;
  LOOK_ATMOS_UNIFORMS.uLookAtmosD.value.set(num(C.glow, 1) * num(L.iso, 0.01) * (num(L.isoDay, 0.2) + golden), num(L.highBlue, 0.6), num(hiRamp[0], 2500), num(hiRamp[1], 6000));
  const tint = L.awayTint ?? AWAY_TINT;
  const tw = Math.min(1, golden);
  LOOK_ATMOS_UNIFORMS.uLookAtmosE.value.set(
    Math.min(1, Math.max(0, num(L.maxOpacity, 1))),
    1 + (num(tint[0], 1) - 1) * tw,
    1 + (num(tint[1], 1) - 1) * tw,
    1 + (num(tint[2], 1) - 1) * tw
  );
  LOOK_ATMOS_UNIFORMS.uLookAtmosF.value.set(
    Math.min(0.99, Math.max(0, num(L.rimFrom, 0.45))),
    num(L.towardSun, 1) * tw,
    num(L.topLine, 0.15),
    num(L.topLineAt, 0.8)
  );
  LOOK_ATMOS_UNIFORMS.uLookAtmosC.value.set(num(L.downBlue, 0.5), num(L.horizonLift, 0.03), num(L.hazeGain, 1), Math.max(1.01, num(L.crispRamp, 1.6)));
  // The mist: flatter and thinner by day (wisps along the floor), a little
  // deeper toward evening, with softer bank edges.
  // Night keeps GROUND_MIST's own shape (lit = 0).
  const M = C.mist ?? {};
  const lit = Math.min(1, Math.max(0, day + tw));
  const flat = Math.max(0.1, num(M.flatDay, 0.55) + (num(M.flatEve, 0.8) - num(M.flatDay, 0.55)) * tw);
  LOOK_MIST_SHAPE.value.set(1 + (flat - 1) * lit, Math.min(1, Math.max(0, num(M.soft, 0.6))) * lit);
}
const HI_RAMP = [2500, 6000];
const AWAY_TINT = [1, 0.86, 1.1];
