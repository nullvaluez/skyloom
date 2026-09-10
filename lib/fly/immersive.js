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
  return {
    day, night, golden, overcast,
    sun: (0.09+2.5*day)*(1-0.83*overcast),
    fill: (0.10+0.34*day)*(1+0.42*overcast),
    environment: (0.14+0.38*day)*(1+0.15*overcast),
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
