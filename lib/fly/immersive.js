/** Standard visual treatment. URL parameters and old preview switches cannot disable it. */
export const IMMERSIVE = {
  revision: 1,
  environmentSize: 2048,
  features: { lighting: true, materials: true, clouds: true, camera: true, audio: true },
  clouds: { baseM: 1500, thicknessM: 1100, periodM: 131072, rangeM: 22000 },
  profiles: {
    high: { cloudScale: 0.5, cloudSteps: 96, shadowSize: 2048 },
    medium: { cloudScale: 0.5, cloudSteps: 64, shadowSize: 1024 },
    low: { cloudScale: 0.35, cloudSteps: 32, shadowSize: 512 },
  },
};
export function immersiveOn(feature) {
  return !feature || IMMERSIVE.features[feature] === true;
}
export const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const smooth = (a,b,v) => { const t=clamp01((v-a)/(b-a)); return t*t*(3-2*t); };
const lerpM = (a,b,t) => a+(b-a)*t;

/**
 * ROUND 25 (C LIGHT) — THE MOON AS A LIGHT. Pure, and deliberately IMPORT-FREE:
 * scripts/immersive-unit.mjs loads this file as a `data:` URL, where a relative
 * specifier cannot resolve at all, so the moon's CONFIG and CLOCK arrive as
 * arguments and the flag lives in the caller (components/fly/LightBubbleRig.jsx,
 * which reads LIGHT_BUBBLE_R25 through lib/fly/r25-pins.js).
 *
 * SYNODIC PHASE, NOT AN EPHEMERIS (plan §8). One mean lunation from a known new
 * moon: exact enough that "tonight is a bright moon" and "tonight is not" agree
 * with the sky, wrong by up to ~14 h of phase over a century — which is
 * invisible in a light intensity and is the whole reason a 40 kB ephemeris is
 * not being shipped for it.
 *
 * @param {number} nowMs         wall clock (or the harness/sun override clock)
 * @param {number} epochNewMoonMs a known new moon, ms
 * @param {number} synodicDays   mean lunation, days
 * @returns {{phase:number, illum:number}} phase 0..1 (0 = new), illum 0..1
 */
export function moonIllum(nowMs, epochNewMoonMs, synodicDays) {
  const perMs = (Number.isFinite(synodicDays) && synodicDays > 0 ? synodicDays : 29.530588) * 86400000;
  const t = Number.isFinite(nowMs) ? nowMs : 0;
  const e = Number.isFinite(epochNewMoonMs) ? epochNewMoonMs : 0;
  let phase = ((t - e) / perMs) % 1;
  if (phase < 0) phase += 1;
  return { phase, illum: (1 - Math.cos(2 * Math.PI * phase)) / 2 };
}

/** Pure lighting state: true elevation, never the clamped hillshade sun. */
export function immersiveLighting(sun = {}, weather = {}) {
  const elevation = Math.asin(Math.min(1,Math.max(-1,sun.sinEl ?? 1))) * 180 / Math.PI;
  const day = smooth(-6,16,elevation), night = 1-smooth(-12,-2,elevation);
  const overcast = clamp01(weather.overcastT);
  // presenceFrac is already damped by the weather model. Reading coverPct or
  // state here would jump as soon as a new report arrives. Keep neutral baseline
  // and overcast endpoints identical while clear/few/scattered open real gaps.
  const presence = clamp01(weather.presenceFrac ?? 1);
  const golden = smooth(-5,1,elevation)*(1-smooth(8,25,elevation))*(1-overcast);
  // --- R25 C (LIGHT_BUBBLE_R25.moon): the night key becomes MOONLIGHT -------
  // Today the deep-night key is the constant 0.09 and the moon only steers its
  // DIRECTION (R24 ONE_SUN) — so a full moon and a new moon light the world
  // identically. `sun.moon` is the rig's per-frame publication
  // { illum, keyNew, keyFull, envNew, envFull, fillGain }; when it is ABSENT
  // (flag off, toy, or before the first rig frame) every expression below is
  // the R24 one and `moon` is not even a key on the result.
  //
  // IDENTITY BY CONSTRUCTION, not by inspection. Each moon term is a DELTA from
  // the R24 value, scaled by `w = (1 - day) * up`:
  //   · `up` = smooth(-8, 0, antiSolarElDeg) with antiSolarElDeg = -elevation.
  //     The app's moon is DRAWN anti-solar at a fixed elevation
  //     (lib/fly/sun-model.js moonDirFromSun, which is exactly what ONE_SUN
  //     blends the key toward), so "the moon is up" is "the anti-solar point is
  //     up", and that is -elevation. up is EXACTLY 0 at and above 8 deg of sun.
  //   · `1 - day` is EXACTLY 0 at and above 16 deg.
  // So every daylight number is bit-for-bit R24 (a + 0.0 === a), and the flag
  // can only move a frame where the sun is below 8 deg.
  //
  // The charter writes the night key as `mix(keyNew, keyFull, illum) * up +
  // 0.02`. Applying `up` to the DELTA instead of to the whole term is
  // deliberate: written literally, up -> 0 would land the key on 0.02 rather
  // than on R24's 0.09 and the moon flag would DIM the key across 8..16 deg of
  // DAYLIGHT, where (1 - day) > 0. At up === 1 (the night this is for) the two
  // readings are the same number. See scripts/r25-c-light.md.
  const m = sun.moon;
  let mKey = 0;
  let mFill = 0;
  let mEnv = 0;
  let moonOut = null;
  if (m && Number.isFinite(m.illum)) {
    const illum = clamp01(m.illum);
    const up = Number.isFinite(m.up) ? clamp01(m.up) : smooth(-8,0,-elevation);
    const w = (1-day)*up;
    if (w > 0) {
      mKey = (lerpM(m.keyNew ?? 0.025, m.keyFull ?? 0.16, illum)+0.02-0.09)*w;
      mEnv = (lerpM(m.envNew ?? 0.05, m.envFull ?? 0.10, illum*up)+0.04-0.14)*w;
      mFill = (m.fillGain ?? 0.04)*illum*w;
    }
    moonOut = { illum, up, k: w };
  }
  return {
    day, night, golden, overcast,
    ...(moonOut ? { moon: moonOut } : null),
    sun: (0.09+2.5*day+mKey)*(1-0.83*overcast),
    fill: (0.10+0.34*day)*(1+0.42*overcast)+mFill,
    environment: (0.14+0.38*day+mEnv)*(1+0.15*overcast),
    cloudCoverage: 0.26+0.17*presence+0.35*overcast,
    cloudBase: IMMERSIVE.clouds.baseM,
    cloudThickness: IMMERSIVE.clouds.thicknessM*(1+0.5*overcast),
    haze: 0.28+0.72*day,
  };
}
/** Periodic coordinates keep float32 density stable through origin rebases. */
export function cloudPhase(metres) {
  const p=IMMERSIVE.clouds.periodM;
  return ((metres%p)+p)%p;
}
const fract=(v)=>v-Math.floor(v);
function cloudHash(x,y,z){return Math.round(fract(Math.sin(cloudMod(x)*127.1+cloudMod(y)*311.7+cloudMod(z)*74.7)*43758.5453)*255)/255;}
const cloudMod=(v)=>((v%64)+64)%64;
export function cloudNoiseVolume(){
  const data=new Uint8Array(64*64*64);
  for(let z=0;z<64;z++)for(let y=0;y<64;y++)for(let x=0;x<64;x++)data[x+64*(y+64*z)]=Math.round(cloudHash(x,y,z)*255);
  return data;
}
function cloudNoise(x,y,z){
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
  const sx=smooth(0,1,fract(x)),sy=smooth(0,1,fract(y)),sz=smooth(0,1,fract(z));
  let n=0;for(let a=0;a<2;a++)for(let b=0;b<2;b++)for(let c=0;c<2;c++)n+=cloudHash(ix+a,iy+b,iz+c)*(a?sx:1-sx)*(b?sy:1-sy)*(c?sz:1-sz);
  return n;
}
/** CPU counterpart for cockpit visibility/audio; sampling the same fixed density field. */
export function cloudDensity(x,y,z,{base=1500,thickness=1100,coverage=.43}={}){
  const h=(y-base)/thickness;if(h<=0||h>=1)return 0;
  const qx=cloudPhase(x)/1024,qy=y/1024,qz=cloudPhase(z)/1024;
  const shape=cloudNoise(qx*.5,qy*.5,qz*.5)*.65+cloudNoise(qx,qy,qz)*.35;
  const erosion=cloudNoise(qx*4,qy*4,qz*4)*.13+cloudNoise(qx*8,qy*8,qz*8)*.055;
  return Math.max(0,shape-(1-coverage)-erosion)*smooth(0,.16,h)*(1-smooth(.55,1,h))*3.8;
}
export function readReducedMotion() {
  if (typeof window === 'undefined') return false;
  try {
    const saved=localStorage.getItem('fly-reduced-motion');
    return saved == null ? !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches : saved==='1';
  } catch { return false; }
}
export function saveReducedMotion(value) {
  try { localStorage.setItem('fly-reduced-motion',value?'1':'0'); } catch { /* private browsing */ }
}
