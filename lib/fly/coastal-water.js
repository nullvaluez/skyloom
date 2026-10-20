import { DataTexture, LinearFilter, Matrix4, RGBAFormat, UnsignedByteType, Vector2, Vector4 } from 'three';
import { CINEMA_GLSL } from './cinema-sky.js';
import { SEA_STATE } from './fly-constants.js';
import { pinned } from './fly-pins.js';
import { isMobileGraphicsClass } from './device-class.js';

const SEA = pinned(SEA_STATE, '__flySeaStateOverride');
/** TRUE EARTH SEA_STATE: the physically based sea (on). Off is the 2026-09-28 water. */
export const SEA_STATE_ACTIVE = SEA.enabled === true;
/** The regional water colour (SEA_STATE.region). Phones and tablets compile
 * the uniform albedo; desktop Low keeps it at run time (zero gain). */
export const SEA_REGION = Object.freeze({ ...SEA_STATE.region, ...SEA.region });
export const SEA_REGION_COMPILED = SEA_STATE_ACTIVE && SEA_REGION.enabled === true && !isMobileGraphicsClass();

const empty = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType);
empty.minFilter = empty.magFilter = LinearFilter;
empty.needsUpdate = true;

/** Whitecap fraction of the sea surface at a 10 m wind speed (m/s).
 * Monahan & O'Muircheartaigh (1980), W = 3.84e-6 U^3.41, capped for gales. */
export function whitecapCoverage(windMps) {
  const u = Math.max(0, Math.min(30, Number.isFinite(windMps) ? windMps : 0));
  return Math.min(0.25, 3.84e-6 * u ** 3.41);
}
/** Upper-tail threshold (in standard deviations) that a unit-normal crest
 * field exceeds with probability `coverage` (Abramowitz & Stegun 26.2.23). */
export function crestThreshold(coverage) {
  const p = Math.min(0.5, Math.max(1e-7, coverage));
  const t = Math.sqrt(-2 * Math.log(p));
  return t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
}

export const SEA_STATE_DEFAULT_MPS = 5;
export const COASTAL_WATER_UNIFORMS = {
  uCoastReflection: { value: empty },
  uCoastMatrix: { value: new Matrix4() },
  uCoastReady: { value: 0 },
  uCoastTexel: { value: new Vector2(1 / 768, 1 / 512) },
  // xy: direction the wind blows toward (world XZ, unit); z: wind speed m/s;
  // w: whitecap coverage. uSeaFoam.x: the crest threshold for that coverage.
  uSeaState: { value: new Vector4(1, 0, SEA_STATE_DEFAULT_MPS, whitecapCoverage(SEA_STATE_DEFAULT_MPS)) },
  uSeaFoam: { value: new Vector2() },
  // The regional colour lookup (lib/fly/r25-ground.js writes these per frame).
  // uSeaRegionMap xy: the floating origin in reference-zoom tiles; z: tiles
  // per world unit; w: the atlas span in tiles. uSeaRegionCam xy: the camera
  // in tiles; z/w: the radii of full and zero weight. Zero gain = the uniform albedo.
  uSeaRegionMap: { value: new Vector4(0, 0, 0, 8) },
  uSeaRegionCam: { value: new Vector4() },
  uSeaRegionGain: { value: 0 },
};
// Resolved caps are a soft step on a unit crest field times a ripple breakup
// term. Solve for the threshold whose expected cover equals the measured
// whitecap fraction, so near caps and the far mean agree (no visible seam).
// A sharp bright core and a faint, wider halo of dissolving foam.
const FOAM_CORE = [0.05, 0.3], FOAM_HALO = [0.75, 0.12];
const capProfile = (t, z) => Math.max(smoothstep(t - FOAM_CORE[0], t + FOAM_CORE[1], z), smoothstep(t - FOAM_HALO[0], t, z) * FOAM_HALO[1]);
const normalPdf = (z) => Math.exp(-0.5 * z * z) / 2.5066283;
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function expected(f) { let sum = 0; for (let z = -5; z <= 5; z += 0.01) sum += f(z) * normalPdf(z) * 0.01; return sum; }
export const FOAM_BREAKUP_MEAN = expected((z) => Math.min(1, Math.max(0, 0.75 + 0.35 * z)));
export function foamCapThreshold(coverage) {
  const target = Math.min(0.5, Math.max(1e-7, coverage)) / FOAM_BREAKUP_MEAN;
  let lo = -3, hi = 6;
  for (let i = 0; i < 40; i++) {
    const t = (lo + hi) / 2;
    if (expected((z) => capProfile(t, z)) > target) lo = t; else hi = t;
  }
  return (lo + hi) / 2;
}
function setFoamThresholds(coverage) {
  COASTAL_WATER_UNIFORMS.uSeaFoam.value.set(crestThreshold(coverage), foamCapThreshold(coverage));
}
setFoamThresholds(COASTAL_WATER_UNIFORMS.uSeaState.value.w);
export function clearCoastalReflection() {
  COASTAL_WATER_UNIFORMS.uCoastReady.value = 0;
  COASTAL_WATER_UNIFORMS.uCoastReflection.value = empty;
}

/** Feed the live (already damped) weather wind into the sea. The weather
 * model's baseline is a constant 5 m/s +X wind, so harness pins stay fixed. */
export function updateSeaState(wx) {
  const x = Number.isFinite(wx?.windX) ? wx.windX : SEA_STATE_DEFAULT_MPS;
  const z = Number.isFinite(wx?.windZ) ? wx.windZ : 0;
  const speed = Math.hypot(x, z), state = COASTAL_WATER_UNIFORMS.uSeaState.value;
  if (speed > 0.05) state.x = x / speed, state.y = z / speed;
  if (Math.abs(state.z - speed) < 1e-4) return;
  state.z = speed;
  state.w = whitecapCoverage(speed);
  setFoamThresholds(state.w);
}

// Periodic gradient fields share the transported 4096-m material frame. Each
// octave drifts independently; there are no coherent sine-wave fronts crossing
// the whole sea. Analytic gradients avoid normal-map texture/sampler overhead.
//
// The slope statistics follow Cox & Munk's measurements of the wind-roughened
// sea. Each resolved band carries a fixed share of that variance; as a band
// falls below the pixel footprint its share moves into the sun/sky BRDF
// (Bruneton, Neyret & Holzschuch 2010, "Real-time Realistic Ocean Lighting
// using Seamless Transitions from Geometry to BRDF"), so distant water keeps
// the physically sized sun glitter instead of turning into a perfect mirror.
const SEA_STATE_GLSL = `
${CINEMA_GLSL}
uniform sampler2D uCoastReflection;
uniform mat4 uCoastMatrix;
uniform float uCoastReady;
uniform vec2 uCoastTexel;
uniform vec4 uSeaState;
uniform vec2 uSeaFoam;
vec2 seaGradient(vec2 cell,float period){
 cell=mod(cell,period);
 vec3 h=fract(vec3(cell.xyx)*vec3(.1031,.1030,.0973));
 h+=dot(h,h.yxz+33.33);
 return normalize(fract((h.xx+h.yz)*h.zy)*2.-1.+vec2(.0001));
}
// Height and its exact two partial derivatives. Quintic interpolation keeps
// both slope and curvature continuous between cells, including wrapped cells.
vec3 seaNoise(vec2 p,float period){
 vec2 cell=floor(p),f=fract(p);
 vec2 a=seaGradient(cell,period),b=seaGradient(cell+vec2(1,0),period);
 vec2 c=seaGradient(cell+vec2(0,1),period),d=seaGradient(cell+vec2(1,1),period);
 vec4 v=vec4(dot(a,f),dot(b,f-vec2(1,0)),dot(c,f-vec2(0,1)),dot(d,f-vec2(1,1)));
 vec2 u=f*f*f*(f*(f*6.-15.)+10.),du=30.*f*f*(f-1.)*(f-1.);
 vec2 grad=mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
 grad+=du*vec2(mix(v.y-v.x,v.w-v.z,u.y),mix(v.z-v.x,v.w-v.y,u.x));
 return vec3(mix(mix(v.x,v.y,u.x),mix(v.z,v.w,u.x),u.y),grad);
}
vec3 seaBand(vec2 metres,float spacing,mat2 basis,vec2 drift,float pixelM,out float resolved){
 float stretch=length(basis[0]);
 resolved=1.-smoothstep(.3,1.4,pixelM*stretch/spacing);
 if(resolved<.001){resolved=0.;return vec3(0.);}
 vec3 wave=seaNoise(basis*(metres/spacing)+drift,4096./spacing);
 // Chain rule in the surface plane. Integer bases preserve both wrap axes.
 wave.yz=vec2(dot(basis[0],wave.yz),dot(basis[1],wave.yz))/stretch;
 return wave*resolved;
}
// Cox & Munk (1954): total mean-square slope of a clean wind-roughened sea,
// and its upwind/crosswind split.
float seaSlopeVariance(){return .003+.00512*clamp(uSeaState.z,0.,30.);}
vec2 seaSlopeAxes(){float u=clamp(uSeaState.z,0.,30.);vec2 axes=vec2(.00316*u,.003+.00192*u);return axes/(axes.x+axes.y);}
// Shares of that variance carried by the four resolved bands; the remainder
// is always finer than the smallest band and lives in the BRDF.
const vec4 SEA_SHARE=vec4(.022,.05,.12,.15);
// Mean squared gradient of one unit-amplitude seaNoise band (measured, 2e5 samples).
const float SEA_UNIT_SLOPE=.78;
struct SeaSample{vec2 slope;float rough;float height;float crest;float crestResolved;float fine;float unresolved;};
SeaSample seaSample(vec2 metres,float time,float pixelM){
 vec2 p=mod(metres,4096.);
 // Calmer and rougher patches of the same sea, mean ~1 so the average still
 // matches the measured slope statistics for the wind.
 float rough=.72+.56*smoothstep(-.42,.42,seaNoise(p/256.+vec2(time*.007,-time*.004),16.).x);
 float total=seaSlopeVariance()*rough;
 vec4 amp=sqrt(SEA_SHARE*total/SEA_UNIT_SLOPE),r;
 vec3 swell=seaBand(p,128.,mat2(2,1,-1,2),vec2(time*.013,time*.009),pixelM,r.x);
 vec3 chop=seaBand(p,32.,mat2(1,2,-2,1),vec2(-time*.052,time*.034),pixelM,r.y);
 vec3 ripple=seaBand(p,8.,mat2(3,2,-2,3),vec2(time*.13,-time*.09),pixelM,r.z);
 vec3 capillary=seaBand(p,2.,mat2(1,-1,1,1),vec2(-time*.24,-time*.17),pixelM,r.w);
 SeaSample s;
 s.slope=swell.yz*amp.x+chop.yz*amp.y+ripple.yz*amp.z+capillary.yz*amp.w;
 // Energy-conserving retirement: a band attenuated by r keeps r^2 of its
 // variance as geometry and hands the rest to the BRDF.
 s.unresolved=total*max(0.,1.-dot(SEA_SHARE,r*r));
 s.rough=rough;
 s.height=swell.x*.6+chop.x*.4;
 // Unit-variance crest field (rms of a unit band height is .216): caps form
 // on the 8 m waves riding the crests of the 32 m chop, and on the chop
 // alone (larger flecks) once the ripple is finer than a pixel. The 2 m
 // capillary band breaks up their edges once it is resolved.
 s.crest=(chop.x*.6+ripple.x*.8)/(.216*sqrt(.36+.64*r.z*r.z)+1e-4);
 s.crestResolved=r.y;
 s.fine=capillary.x/.216;
 return s;
}
// x is the local roughness; yz are the resolved surface slopes. The finite
// pixel footprint retires detail in the distance instead of forming moire.
vec3 seaSurface(vec2 metres,float time,float pixelM){
 SeaSample s=seaSample(metres,time,pixelM);
 return vec3(s.rough,s.slope);
}
float seaErfc(float x){return 2.*exp(-x*x)/(2.319*x+sqrt(4.+1.52*x*x));}
// Smith masking for a Gaussian slope distribution.
float seaLambda(float cosTheta,float sigmaSq){
 float v=cosTheta/sqrt(max(1e-7,(1.-cosTheta*cosTheta)*2.*sigmaSq));
 return max(0.,(exp(-v*v)-v*1.7724539*seaErfc(v))/(3.5449077*v));
}
float seaAxisVariance(vec3 d,vec3 tx,vec3 ty,vec2 sigmaSq){
 float x=dot(d,tx),y=dot(d,ty),c2=x*x/max(1e-7,x*x+y*y);
 return sigmaSq.x*c2+sigmaSq.y*(1.-c2);
}
// Microfacet sun reflection (BRDF x cos L) for an anisotropic Gaussian slope
// distribution about the resolved normal n.
float seaSunBRDF(vec3 l,vec3 v,vec3 n,vec3 tx,vec3 ty,vec2 sigmaSq){
 vec3 h=normalize(l+v);
 float zH=dot(h,n);
 if(zH<=.001)return 0.;
 float zx=dot(h,tx)/zH,zy=dot(h,ty)/zH;
 float p=exp(-.5*(zx*zx/sigmaSq.x+zy*zy/sigmaSq.y))/(6.2831853*sqrt(sigmaSq.x*sigmaSq.y));
 float fresnel=.02+.98*pow(1.-clamp(dot(v,h),0.,1.),5.);
 float zL=max(dot(l,n),.01),zV=max(dot(v,n),.01),zH2=zH*zH;
 float masking=1.+seaLambda(zL,seaAxisVariance(l,tx,ty,sigmaSq))+seaLambda(zV,seaAxisVariance(v,tx,ty,sigmaSq));
 return fresnel*p/(masking*zV*zH2*zH2*4.);
}
// Fresnel reflectance averaged over the unresolved slopes (Bruneton 2010).
float seaMeanFresnel(float cosV,float sigmaV){
 return .02+.98*pow(1.-cosV,5.*exp(-2.69*sigmaV))/(1.+22.7*pow(sigmaV,1.5));
}
uniform vec4 uSeaRegionMap;
uniform vec4 uSeaRegionCam;
uniform float uSeaRegionGain;
// Regional water colour. Esri's low zooms are one colour-balanced mosaic, so
// the z11 colour reference (lib/fly/r25-color-ref.js) holds the same colour
// on both sides of every terrain tile edge, LOD step and capture outline. Its
// mip level 1 is not a mip: it is a water-only layer, premultiplied by the
// share of a texel that is open water (the vector water layer, with cloud,
// glint and haze pixels rejected), so filtering never mixes in the shore.
// Sampled at the fragment's world position: one texture across all tiles.
// xyz: linear albedo; w: weight (coverage, distance from the camera, gain).
vec4 seaRegional(sampler2D atlas,vec2 ground){
 if(uSeaRegionGain<=0.)return vec4(0.);
 vec2 t=uSeaRegionMap.xy+ground*uSeaRegionMap.z;
 float reach=1.-smoothstep(uSeaRegionCam.z,uSeaRegionCam.w,length(t-uSeaRegionCam.xy));
 if(reach<=0.)return vec4(0.);
 vec4 s=textureLod(atlas,fract(t/uSeaRegionMap.w),1.);
 vec3 c=s.rgb/max(s.a,.004);
 // What survives as bright and grey is cloud, glint or haze, not water
 // (the same rule as each pixel's, r25-color-ref.js seaPixelWeight).
 float luma=dot(c,vec3(.2126,.7152,.0722));
 float grey=1.-smoothstep(.25,.5,(max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b)))/max(luma,.001));
 float w=smoothstep(.04,.25,s.a)*(1.-smoothstep(.1,.2,luma)*grey)*reach*uSeaRegionGain;
 return vec4(min(c,vec3(.32)),w);
}
// Open water keeps the physical albedo: the regional colour applies only
// where it is clearly greener or redder than that albedo. Shallows, reefs,
// sediment and harbour water all are (z11 G .04-.37 or R .02-.13 against the
// albedo's .016/.0044); deep water is not, and that is where the z11 mosaic
// still carries straight swath edges (the Coral Sea's blue steps .037-.060
// across them while G stays .015-.021). A dark blue lake stays physical too.
vec3 seaBody(vec3 albedo,vec4 regional){
 vec3 excess=regional.rgb-albedo;
 float distinct=smoothstep(.01,.03,max(excess.g,excess.r));
 return mix(albedo,regional.rgb,regional.a*distinct*.85);
}
float seaHash(vec2 c){vec3 q=fract(vec3(c.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
vec2 seaGauss(vec2 cell,float epoch){
 float u1=max(1e-4,seaHash(cell+vec2(epoch*17.31,epoch*3.7))),u2=seaHash(cell.yx+vec2(epoch*9.17+3.1,epoch*5.3));
 return sqrt(-2.*log(u1))*vec2(cos(6.2831853*u2),sin(6.2831853*u2));
}
// Glitter: when the footprint is finer than a 0.5 m cell, each cell carries
// one discrete capillary facet drawn from the unresolved distribution, so
// the sun breaks into twinkling points. Their expectation is the smooth lobe,
// which they converge to as the footprint grows.
float seaGlitter(vec2 metres,float time,float pixelM,vec3 l,vec3 v,vec3 n,vec3 tx,vec3 ty,vec2 sigmaSq,float smooth_,out float weight){
 weight=1.-smoothstep(.12,.45,pixelM);
 if(weight<.001)return smooth_;
 vec2 g=mod(metres,4096.)*2.,cell=floor(g);
 float phase=seaHash(cell+71.3),clock=time*(2.2+1.6*seaHash(cell+11.9))+phase*8.;
 float epoch=floor(clock),turn=fract(clock)*1.5707963;
 vec2 facet=seaGauss(cell,epoch)*cos(turn)+seaGauss(cell,epoch+1.)*sin(turn);
 vec2 sigma=sqrt(sigmaSq*.85);
 vec3 fn=normalize(n-tx*facet.x*sigma.x-ty*facet.y*sigma.y);
 vec2 centre=vec2(seaHash(cell+5.1),seaHash(cell+9.4))*.5+.25;
 float aa=pixelM*2.,radius=.24;
 float spot=1.-smoothstep(radius-aa,radius+aa,length(fract(g)-centre));
 // 1/coverage keeps the cell's mean energy equal to its facet's lobe.
 float sharp=seaSunBRDF(l,v,fn,tx,ty,sigmaSq*.15)*spot/(3.1415927*(radius*radius+aa*aa));
 return mix(smooth_,sharp,weight);
}
vec3 coastalWater(vec3 world,vec2 metres,vec3 eye,vec3 sun,vec3 moon,float day,float night,float overcast,float time,float pixelM,float shore,vec4 regional){
 SeaSample s=seaSample(metres,time,pixelM);
 vec3 n=normalize(vec3(s.slope.x,1.,s.slope.y));
 vec3 windDir=normalize(vec3(uSeaState.x,0.,uSeaState.y)+vec3(1e-5,0.,0.));
 vec3 tx=normalize(windDir-n*dot(n,windDir)),ty=cross(n,tx);
 vec2 sigmaSq=max(vec2(2e-5),s.unresolved*seaSlopeAxes());
 float cosV=clamp(dot(n,eye),.001,1.);
 float sigmaV=sqrt(seaAxisVariance(eye,tx,ty,sigmaSq));
 float fresnel=seaMeanFresnel(cosV,sigmaV);
 vec3 ray=reflect(-eye,n);ray.y=abs(ray.y);
 // Light: the cinematic key (sun by day, moon by night) and the sky dome.
 vec3 key,keyE,sky,skyE;
 if(uCinema>.5){
  key=uCinemaKey;keyE=uCinemaKeyColor*uCinemaAir.w;
  sky=cinemaSky(ray);
  skyE=1.5707963*(cinemaSky(vec3(0.,1.,0.))+cinemaSky(normalize(vec3(eye.x,.08,eye.z))));
 }else{
  key=day>.02?sun:moon;keyE=(vec3(1.,.93,.80)*5.2*day+vec3(.18,.24,.34)*.9*night)*(1.-.84*overcast);
  vec3 horizon=mix(vec3(.028,.061,.115),vec3(.34,.51,.64),day),zenith=mix(vec3(.007,.020,.055),vec3(.045,.17,.31),day);
  sky=mix(horizon,zenith,smoothstep(-.04,.9,ray.y));
  sky=mix(sky,mix(vec3(.033,.053,.079),vec3(.26,.31,.34),day),overcast*.5);
  skyE=1.5707963*(zenith+horizon);
 }
 float keyUp=smoothstep(-.02,.05,key.y);
 // Overcast and fog hide the disc itself; diffuse light already carries them.
 float disc=uCinema>.5?uCinemaOptics.x:(1.-overcast)*(1.-overcast);
 vec3 lightE=keyE*max(0.,key.y)+skyE;
 // Water body: a physical albedo, moved toward the regional colour where the
 // z11 reference has one. The streamed high-zoom imagery is never read: Esri's
 // mosaic gives each capture its own water tone (the Hudson is luma .005 in
 // one capture and .12 in the next), and each terrain tile samples its own
 // texture, so a body colour taken from it drew every capture outline, tile
 // edge and LOD step as a seam. The shore weight is the vector classification.
 vec3 albedo=mix(vec3(.0035,.011,.026),vec3(.006,.026,.033),.35+.3*shore*(1.-shore));
 albedo=seaBody(albedo,regional);
 albedo*=.9+.1*s.rough;
 vec3 water=albedo*lightE*.31830989*(1.-fresnel)+sky*fresnel;
 // Light passing through the thin crests of waves lit from behind.
 vec3 toSun=normalize(vec3(key.x,0.,key.z)+vec3(1e-5,0.,0.));
 float back=pow(max(0.,dot(-normalize(vec3(eye.x,0.,eye.z)+vec3(1e-5,0.,0.)),toSun)),4.);
 float lowSun=1.-smoothstep(.08,.45,key.y);
 water+=vec3(.05,.30,.26)*keyE*clamp(s.height*2.2,0.,1.)*back*(1.-eye.y)*keyUp*lowSun*lowSun*.06;
 // Sun or moon glitter: physically sized lobe, and discrete facets up close.
 float lobe=seaSunBRDF(key,eye,n,tx,ty,sigmaSq),glitterWeight;
 lobe=seaGlitter(metres,time,pixelM,key,eye,n,tx,ty,sigmaSq,lobe,glitterWeight);
 // Day keeps the physical energy; the moon path is lifted for dark-adapted eyes.
 float gain=mix(1.,6.,night);
 vec3 glint=min(keyE*lobe*gain*keyUp*disc,vec3(12.));
 // Whitecaps: the measured coverage for this wind, on the resolved crests,
 // and as a mean albedo once the crests are finer than a pixel.
 // uSeaFoam.y is solved on the CPU so the resolved caps' expected cover is
 // the measured fraction; the far mean meets them without a seam.
 float foam=0.;
 if(uSeaState.w>1e-5){
  float threshold=uSeaFoam.y-(s.rough-1.)*.6;
  // Caps break and dissolve as a faster field passes over the crests, rather
  // than sliding along with them. Its mean shift is zero.
  if(s.crestResolved>.001)threshold+=seaNoise(mod(metres,4096.)/64.+vec2(time*.21,-time*.17),64.).x*2.2;
  float caps=max(smoothstep(threshold-${FOAM_CORE[0]},threshold+${FOAM_CORE[1]},s.crest),smoothstep(threshold-${FOAM_HALO[0]},threshold,s.crest)*${FOAM_HALO[1]});
  caps*=clamp(.75+.35*s.fine,0.,1.);
  foam=clamp(mix(uSeaState.w*(.85+.15*s.rough),caps,s.crestResolved),0.,1.);
 }
 water=mix(water+glint,vec3(.56)*lightE*.31830989,foam);
 if(uCoastReady>.5 && abs(world.y)<5.){
   vec4 projected=uCoastMatrix*vec4(world.x,0.,world.z,1.);
   vec2 uv=projected.xy/max(.001,projected.w);
   vec2 sampleUV=uv+s.slope*vec2(.006,.012);
   float edge=smoothstep(0.,.04,min(min(sampleUV.x,sampleUV.y),min(1.-sampleUV.x,1.-sampleUV.y)));
   if(projected.w>0. && edge>0.){
     // Rough water stretches reflections toward the viewer: lights become
     // columns, facades smear vertically, calm patches stay crisp.
     float stretch=clamp(sqrt(s.unresolved)*.9,uCoastTexel.y*2.,.16);
     vec4 reflected=texture2D(uCoastReflection,sampleUV)*.36;
     reflected+=texture2D(uCoastReflection,sampleUV+vec2(uCoastTexel.x,stretch*.45))*.22;
     reflected+=texture2D(uCoastReflection,sampleUV-vec2(uCoastTexel.x,stretch*.45))*.22;
     reflected+=texture2D(uCoastReflection,sampleUV+vec2(0.,stretch))*.10;
     reflected+=texture2D(uCoastReflection,sampleUV-vec2(0.,stretch))*.10;
     vec3 city=reflected.rgb/max(.001,reflected.a);
     float reflectivity=mix(.48,.88,night)*(.45+fresnel*.55)*(1.-foam);
     water=mix(water,city*vec3(.72,.86,.98),reflected.a*edge*reflectivity);
   }
 }
 return water;
}
`;

// The 2026-09-28 water, verbatim, for ?flags=-SEA_STATE. The overload at the
// end takes the call site's current arguments, so both variants compile there.
const LEGACY_COASTAL_WATER_GLSL = `
${CINEMA_GLSL}
uniform sampler2D uCoastReflection;
uniform mat4 uCoastMatrix;
uniform float uCoastReady;
uniform vec2 uCoastTexel;
vec2 seaGradient(vec2 cell,float period){
 cell=mod(cell,period);
 vec3 h=fract(vec3(cell.xyx)*vec3(.1031,.1030,.0973));
 h+=dot(h,h.yxz+33.33);
 return normalize(fract((h.xx+h.yz)*h.zy)*2.-1.+vec2(.0001));
}
// Height and its exact two partial derivatives. Quintic interpolation keeps
// both slope and curvature continuous between cells, including wrapped cells.
vec3 seaNoise(vec2 p,float period){
 vec2 cell=floor(p),f=fract(p);
 vec2 a=seaGradient(cell,period),b=seaGradient(cell+vec2(1,0),period);
 vec2 c=seaGradient(cell+vec2(0,1),period),d=seaGradient(cell+vec2(1,1),period);
 vec4 v=vec4(dot(a,f),dot(b,f-vec2(1,0)),dot(c,f-vec2(0,1)),dot(d,f-vec2(1,1)));
 vec2 u=f*f*f*(f*(f*6.-15.)+10.),du=30.*f*f*(f-1.)*(f-1.);
 vec2 grad=mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
 grad+=du*vec2(mix(v.y-v.x,v.w-v.z,u.y),mix(v.z-v.x,v.w-v.y,u.x));
 return vec3(mix(mix(v.x,v.y,u.x),mix(v.z,v.w,u.x),u.y),grad);
}
vec3 seaBand(vec2 metres,float spacing,mat2 basis,vec2 drift,float pixelM){
 float stretch=length(basis[0]);
 float resolved=1.-smoothstep(.3,1.4,pixelM*stretch/spacing);
 if(resolved<.001)return vec3(0.);
 vec3 wave=seaNoise(basis*(metres/spacing)+drift,4096./spacing);
 // Chain rule in the surface plane. Integer bases preserve both wrap axes.
 wave.yz=vec2(dot(basis[0],wave.yz),dot(basis[1],wave.yz))/stretch;
 return wave*resolved;
}
// x is the local wind response; yz are surface slopes. The finite pixel
// footprint retires detail in the distance instead of forming moire bands.
vec3 seaSurface(vec2 metres,float time,float pixelM){
 vec2 p=mod(metres,4096.);
 float wind=.30+.70*smoothstep(-.42,.42,seaNoise(p/256.+vec2(time*.007,-time*.004),16.).x);
 vec3 swell=seaBand(p,128.,mat2(2,1,-1,2),vec2(time*.013,time*.009),pixelM);
 vec3 chop=seaBand(p,32.,mat2(1,2,-2,1),vec2(-time*.052,time*.034),pixelM);
 vec3 ripple=seaBand(p,8.,mat2(3,2,-2,3),vec2(time*.13,-time*.09),pixelM);
 vec3 capillary=seaBand(p,2.,mat2(1,-1,1,1),vec2(-time*.24,-time*.17),pixelM);
 vec2 slope=(swell.yz*.062+chop.yz*.038+ripple.yz*.021+capillary.yz*.009)*wind;
 return vec3(wind,slope);
}
vec3 coastalWater(vec3 world,vec2 metres,vec3 eye,vec3 sun,vec3 moon,float day,float night,float overcast,float time){
 float pixelM=max(length(dFdx(metres)),length(dFdy(metres)));
 vec3 surface=seaSurface(metres,time,pixelM);
 vec2 slope=surface.yz;
 vec3 n=normalize(vec3(slope.x,1.,slope.y));
 vec3 ray=reflect(-eye,n);
 float fresnel=.035+.965*pow(1.-max(0.,dot(n,eye)),4.5);
 float skyHeight=smoothstep(-.04,.9,ray.y);
 vec3 horizon=mix(vec3(.028,.061,.115),vec3(.34,.51,.64),day);
 vec3 zenith=mix(vec3(.007,.020,.055),vec3(.045,.17,.31),day);
 vec3 sky=mix(horizon,zenith,skyHeight);
 // Reflected horizon/zenith and overcast response. No repeating cloud blobs
 // painted onto the water; actual city silhouettes come from the capture.
 sky=mix(sky,mix(vec3(.033,.053,.079),vec3(.26,.31,.34),day),overcast*.5);
 if(uCinema>.5)sky=cinemaSky(ray);
 vec3 body=mix(vec3(.004,.018,.034),vec3(.008,.063,.078),day);
 body*=.88+.12*surface.x;
 vec3 water=mix(body,sky,.19+fresnel*.76);
 float roughSun=pow(max(0.,dot(ray,sun)),160.);
 float softSun=pow(max(0.,dot(ray,sun)),18.);
 float moonPath=pow(max(0.,dot(ray,moon)),85.);
 float glitter=.74+.26*surface.x;
 if(uCinema>.5){
   float facing=max(0.,dot(ray,uCinemaKey));
   float path=pow(facing,mix(85.,160.,uCinemaLight.x))*2.8+pow(facing,18.)*.18;
   water+=uCinemaKeyColor*path*(uCinemaAir.w/3.7)*glitter;
 }else{
   water+=vec3(1.,.79,.48)*(roughSun*2.8+softSun*.18)*day*(1.-overcast)*glitter;
   water+=vec3(.38,.61,.95)*moonPath*night*(1.-overcast)*1.55*glitter;
 }
 if(uCoastReady>.5 && abs(world.y)<5.){
   vec4 projected=uCoastMatrix*vec4(world.x,0.,world.z,1.);
   vec2 uv=projected.xy/max(.001,projected.w);
   vec2 distortion=slope*vec2(.010,.020);
   vec2 sampleUV=uv+distortion;
   float edge=smoothstep(0.,.04,min(min(sampleUV.x,sampleUV.y),min(1.-sampleUV.x,1.-sampleUV.y)));
   if(projected.w>0. && edge>0.){
     vec4 reflected=texture2D(uCoastReflection,sampleUV)*.5;
     reflected+=texture2D(uCoastReflection,sampleUV+uCoastTexel*vec2(1.,2.))*.25;
     reflected+=texture2D(uCoastReflection,sampleUV-uCoastTexel*vec2(1.,2.))*.25;
     vec3 city=reflected.rgb/max(.001,reflected.a);
     float reflectivity=mix(.48,.88,night)*(.55+fresnel*.45);
     water=mix(water,city*vec3(.72,.86,.98),reflected.a*edge*reflectivity);
   }
 }
 return water;
}
vec3 coastalWater(vec3 world,vec2 metres,vec3 eye,vec3 sun,vec3 moon,float day,float night,float overcast,float time,float pixelM,vec3 imagery,float shore){
 return coastalWater(world,metres,eye,sun,moon,day,night,overcast,time);
}
`;
export const COASTAL_WATER_GLSL = SEA_STATE_ACTIVE ? SEA_STATE_GLSL : LEGACY_COASTAL_WATER_GLSL;
/** Both variants, for the node and GPU gates. */
export const COASTAL_WATER_VARIANTS = { seaState: SEA_STATE_GLSL, legacy: LEGACY_COASTAL_WATER_GLSL };
