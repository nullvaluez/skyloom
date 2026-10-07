import { Pass } from 'postprocessing';
import { CINEMA_GLSL, CINEMA_UNIFORMS, cinemaEnvironment } from './cinema-frame';
import { CINEMA_CELESTIAL_GLSL } from './cinema-sky';
import { CINEMA_CLOUD_GLSL, cinemaBankData } from './cinema-cloud';
import { CLOUD_BOUNDS_GLSL } from './cinema-cloud-bounds';
import { CLOUD_FILTER_GLSL, CLOUD_RECONSTRUCTION_GLSL } from './cloud-reconstruction';
import { loadCinemaCloudVolume } from './cinema-cloud-volume';
import { cinemaOn, cinemaProfile } from './cinema-policy';
import { Data3DTexture, DataTexture, FloatType, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, NearestFilter, Matrix4, RedFormat, RGFormat, RGBAFormat, RepeatWrapping, ShaderMaterial, Vector2, Vector3, Vector4, WebGLRenderTarget } from 'three';
import { IMMERSIVE, cloudPhase, cloudDensity, cloudNoiseVolume, immersiveLighting, immersiveProfile } from './immersive';
import { mercatorScale } from './coords';
import { getBend } from './toy-world/world-bend';
import { useFlyStore } from '../../stores/fly-store';
import { cinematicFlightOn } from './stylized-earth';
import { livingSkyPalette } from './living-sky';
// R25 C SKY: the Enhanced composite paints the sky with the analytic model and
// hazes clouds by the living-air law; the dip is the dome's own (getSkyDip).
import { R25_SKY } from './fly-constants';
import { getR25Sky } from './r25-sky';
import { R25_SKY_GLSL_DECL, R25_SKY_GLSL_FUNCS, SKY_ROWS, writeSkyUniforms } from './sky-model';
import { LIVING_AIR_GLSL } from './living-atmosphere';
import { getSkyDip } from '../../components/fly/SkyDome';
import { paintedCloudLight } from './painterly-cloud-light';
import { CINEMATIC_EARTH, cinematicEarthOn, cloudTargetSize } from './cinematic-earth';
import { moonDirFromSun } from './sun-model';
import { ExhaustHeat, EXHAUST_HEAT_GLSL } from './exhaust-heat';
import { readReducedMotion } from './immersive';
import { CLOUD_SHADOW_RANGE_GLSL } from './cloud-shadow-range.mjs';
import { hdrGuarded } from './hdr-guard';
import { trueRayGLSL, trueScaleShader } from './true-scale';
import { cloudNoiseFollowsBase, hazeGroundY } from './cloud-calm';
import { ATMO_AERIAL_LOOKUP_GLSL } from './atmosphere/glsl.js';
import { physSkyShader, physWeatherExtinction } from './atmosphere/runtime.js';
import { PHYS_SKY_TEXT_ACTIVE } from './cinema-sky.js';

const vertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const commonText = `
varying vec2 vUv;
uniform sampler2D sceneDepth;
uniform highp sampler3D noiseVolume;
uniform mat4 inverseProjection, cameraWorld;
uniform vec3 eye, phase, sunDir;
uniform vec2 bendCenter;
uniform float reverseDepth, metricScale, bendK, base, thickness, coverage, day, golden, night;
uniform float cinematicLight, overcast;
float noise3(vec3 p){
 vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return textureLod(noiseVolume,(i+f+.5)/64.,0.).r;
}
vec3 metric(vec3 p){vec2 dx=p.xz-bendCenter;return vec3(p.x/metricScale,p.y+dot(dx,dx)*bendK,p.z/metricScale);}
float filteredNoise(vec3 p,float footprint){
 // Do not point-sample details smaller than a march interval. Their mean is
 // .5, so removing an unresolved octave preserves coverage instead of filling
 // all the holes (or eroding the cloud away) at the horizon and on low tier.
 float resolved=1.-smoothstep(.35,1.,footprint);
 return mix(.5,noise3(p),resolved);
}
${CINEMA_GLSL}
${CINEMA_CLOUD_GLSL}
${CLOUD_BOUNDS_GLSL}
float densityAt(vec3 p,float footprint){
 float h=(p.y-base)/thickness;
 if(h<=0.||h>=1.)return 0.;
 vec3 q=vec3(p.x*metricScale+phase.x,p.y,p.z*metricScale+phase.z)/1024.;
 if(uCinema>.5)return cinemaDensity(q,footprint,h);
 float shape=filteredNoise(q*.5,footprint*.5/1024.)*.65+filteredNoise(q,footprint/1024.)*.35;
 float erosion=filteredNoise(q*4.,footprint*4./1024.)*.13+filteredNoise(q*8.,footprint*8./1024.)*.055;
 float envelope=smoothstep(0.,.16,h)*(1.-smoothstep(.55,1.,h));
 return max(0.,shape-(1.-coverage)-erosion)*envelope*3.8;
}
float density(vec3 p){return densityAt(p,0.);}
vec3 viewAt(vec2 uv,float depth){vec4 v=inverseProjection*vec4(uv*2.-1.,reverseDepth>.5?depth:depth*2.-1.,1.);return v.xyz/v.w;}
float distanceAt(vec2 uv){float d=texture2D(sceneDepth,uv).r;return (reverseDepth>.5?d<.0000001:d>.9999999)?1000000.:length(viewAt(uv,d));}
vec3 rayAt(vec2 uv){return normalize(mat3(cameraWorld)*normalize(viewAt(uv,reverseDepth>.5?.00001:.99999)));}
`;
// CLOUD_CALM (lib/fly/cloud-calm.js): the cinema noise rides the cloud base,
// so a datum ease moves the deck as a whole instead of re-forming the clouds
// in place. An anchor miss keeps the text and clears CLOUD_CALM_GLSL_OK, which
// scripts/verify-cloud-calm.mjs asserts. Flag off: commonText, unchanged.
const CALM_FROM = ' if(uCinema>.5)return cinemaDensity(q,footprint,h);';
const CALM_TO = ' if(uCinema>.5)return cinemaDensity(vec3(q.x,(p.y-base)/1024.,q.z),footprint,h);';
export const CLOUD_CALM_GLSL_OK = commonText.split(CALM_FROM).length === 2;
const common = cloudNoiseFollowsBase() && CLOUD_CALM_GLSL_OK ? commonText.replace(CALM_FROM, CALM_TO) : commonText;
const march = common + `
uniform float steps, rangeM;
uniform float lightSamples;
void main(){
 vec3 ray=rayAt(vUv);float metricRay=length(vec3(ray.x/metricScale,ray.y,ray.z/metricScale));
 // Derivatives must be evaluated BEFORE any divergent return/march. Account
 // for both the integration interval and the projected pixel's footprint.
 float rayCone=max(length(dFdx(ray)),length(dFdy(ray)));
 float limit=min(rangeM/metricRay,distanceAt(vUv));
 // Conservative slab bounds include curvature; the density uses exact unbent height.
 float low=base-600.,high=base+thickness;
 float a=0.,b=limit;
 if(uCinema>.5){vec2 interval=cloudRayBounds(eye,ray,limit,bendCenter,bendK,base,high);a=interval.x;b=interval.y;}
 else if(abs(ray.y)>.0001){float t0=(low-eye.y)/ray.y,t1=(high-eye.y)/ray.y;a=max(0.,min(t0,t1));b=min(limit,max(t0,t1));}
 else if(eye.y<low||eye.y>high){gl_FragColor=vec4(0,0,0,1);return;}
 if(b<=a){gl_FragColor=vec4(0,0,0,1);return;}
 float stride=(b-a)/steps;
 float trans=1.;vec3 light=vec3(0);
 // A fixed midpoint on every pixel locks integration error into horizontal
 // contour bands. Spatial stratification breaks that correlation; no frame
 // counter/history means no temporal boiling, pause drift or rebase reset.
 float jitter=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
 // q.xz uses projected world metres (metric() is undone inside densityAt).
 // Applying latitude scale again would blur otherwise resolved polar clouds.
 float footprint=stride;
 float forward=pow(max(0.,dot(ray,sunDir)),8.);
 vec3 key=mix(vec3(.92,.96,1.),vec3(1.,.67,.36),golden);
 for(int i=0;i<96;i++){
  if(float(i)>=steps||trans<.015)break;
  float sampleJitter=uCinema>.5?.25+.5*cloudSampleJitter(gl_FragCoord.xy,i):jitter;
  float t=a+(float(i)+sampleJitter)*stride;
  vec3 p=metric(eye+ray*t);
  footprint=max(stride,t*rayCone);
  float d=densityAt(p,footprint);if(d<.002)continue;
  float shadow=0.;if(uCinema<.5)shadow=densityAt(p+sunDir*170.,footprint)*.65+densityAt(p+sunDir*480.,footprint)*.35;
  float illumination=exp(-shadow*mix(2.6,3.15,cinematicLight*(1.0-overcast*.65)));
  float h=clamp((p.y-base)/thickness,0.,1.);
  vec3 lower=mix(vec3(.18,.23,.31),vec3(.16,.20,.26),cinematicLight);
  vec3 upper=mix(vec3(.52,.62,.75),vec3(.62,.68,.74),cinematicLight);
  vec3 ambient=mix(lower,upper,h)*(.12+.65*day);
  vec3 color=ambient+key*illumination*(.055+day*(.6+.85*forward));
  if(uCinema>.5){
    float cloudShade;
    if(lightSamples<2.5)cloudShade=densityAt(p+uCinemaKey*170.,footprint)*.55+densityAt(p+uCinemaKey*600.,footprint)*.45;
    else cloudShade=densityAt(p+uCinemaKey*110.,footprint)*.38+densityAt(p+uCinemaKey*340.,footprint)*.34+densityAt(p+uCinemaKey*780.,footprint)*.28;
    float lit=exp(-cloudShade*mix(4.1,5.5,uCinemaArt*uCinemaLight.x));
    float mu=dot(ray,uCinemaKey);
    // A bounded dual-lobe ice/water phase gives luminous edges without
    // clipping the entire cloud. Reuse the three existing light samples.
    float phase=.24+.38*pow(max(0.,mu),8.)+.10*pow(max(0.,-mu),3.);
    float powder=1.-exp(-d*2.4);
    float multi=(1.-exp(-cloudShade*1.2))*.085;
    vec3 ambient=mix(uCinemaCloudLower,uCinemaCloudUpper,smoothstep(.02,.92,h));
    color=ambient*(.43+.20*powder)+uCinemaKeyColor*uCinemaAir.w*(lit*phase*(.82+.24*powder)+multi);
    // Sculpt the existing density with cool interiors and warm, luminous
    // edges. Same march/light samples, no extra volume or screen-space glow.
    float art=uCinemaArt*uCinemaLight.x*(1.-uCinemaOptics.z);
    float silver=pow(max(0.,mu),18.)*lit*(1.-exp(-d*3.));
    color=mix(color,color*mix(vec3(.70,.80,1.02),vec3(1.10,1.04,.92),lit)
      +uCinemaKeyColor*silver*.65*(1.-uCinemaLight.w),art);
  }
  float alpha=1.-exp(-d*stride*metricRay*mix(.006,.0027,uCinema));
  light+=trans*alpha*color;trans*=1.-alpha;
 }
 gl_FragColor=vec4(light,trans);
}`;
const composite = common + `
uniform sampler2D inputBuffer, clouds;
uniform vec2 texel;
uniform float cloudMix, rangeM;
uniform vec3 skyHorizon, skyZenith, skySunTint;
uniform float skySunVisibility, skyFog;
${CLOUD_SHADOW_RANGE_GLSL}
void main(){
 vec3 ray=rayAt(vUv);float dist=distanceAt(vUv);
 vec3 scene=texture2D(inputBuffer,vUv).rgb;
 if(dist>900000.){
  // Remove photographed cloud silhouettes from the daylight background.
  // The old background remained blue even while overcast removed 83% of
  // direct sunlight. The horizon now begins at the actual horizon, and the
  // same weather state controls its colour and the solar aureole.
  float up=pow(clamp(ray.y,0.,1.),.42)*(1.-skyFog*.8);
  vec3 sky=mix(skyHorizon,skyZenith,up);
  float facing=max(0.,dot(ray,sunDir));
  float aureole=pow(facing,16.)*.16+pow(facing,128.)*.26;
  float disc=smoothstep(.99988,.99997,facing);
  sky+=skySunTint*(aureole+disc*4.)*skySunVisibility;
  scene=mix(scene,sky,day);
 } else {
  vec3 p=metric(eye+ray*dist);
  // The same cloud density casts a broad, softened shadow onto opaque scenery.
  vec3 shadowDir=uCinema>.5?uCinemaKey:sunDir;
  if(p.y<base&&shadowDir.y>.08){
   vec3 projected=p+shadowDir*((base+thickness*.35-p.y)/shadowDir.y);
   float shade=0.;
   float casterVisibility=cloudShadowVisibility(projected,metric(eye),rangeM);
   if(casterVisibility>0.)shade=density(projected);
   // The march ends at rangeM. Without the same caster range here, invisible
   // clouds keep stamping shadows onto hazed distant scenery, looking airborne.
   shade*=casterVisibility;
   scene*=1.-clamp(shade*.32,0.,.23)*day*cloudMix;
  }
 }
${CLOUD_RECONSTRUCTION_GLSL}
 // At disocclusions reject low-res samples rather than bleeding clouds over aircraft.
 vec4 c=total>.001?sum/total:vec4(0,0,0,1);
 vec3 result=scene*c.a+c.rgb;
 gl_FragColor=vec4(mix(scene,result,cloudMix),1.);
}`;

// ---------------------------------------------------------------------------
// ROUND 25 (C SKY) — the ENHANCED march + composite. Built from the Classic
// texts above by exact substitutions that THROW if the anchor text is missing
// (the R24 three-import lesson: an un-asserted String.replace that no-ops on a
// miss ships a feature that silently is not there). The Classic strings are
// never modified, so Classic = the flag-off programs by construction.
// ---------------------------------------------------------------------------
function swapExact(src, from, to) {
  if (!src.includes(from)) throw new Error(`immersive-cloud-pass R25: anchor missing: ${from.slice(0, 60)}`);
  return src.replace(from, to);
}

// livingAirTransmission, arithmetic untouched, with its local `density`
// renamed: this program already declares a FUNCTION `density(vec3)` (common),
// and a local variable hiding a function name is exactly the kind of thing a
// strict GLSL front end rejects. Two occurrences, asserted.
const LIVING_AIR_CLOUD_GLSL = (() => {
  const n = (LIVING_AIR_GLSL.match(/\bdensity\b/g) || []).length;
  if (n !== 2) throw new Error(`immersive-cloud-pass R25: living-air density count ${n}`);
  return LIVING_AIR_GLSL.replace(/\bdensity\b/g, 'airDensity');
})();

/** March: model ambient/key chroma + the fadeStart..fadeEnd alpha ramp (no hard rangeM cut). */
const baseMarchR25 = swapExact(
  swapExact(
    swapExact(
      swapExact(march, 'uniform float steps, rangeM;', 'uniform float steps, rangeM;\nuniform vec3 uR25Key, uR25AmbLo, uR25AmbHi;\nuniform vec2 uR25Fade;'),
      ' vec3 key=mix(vec3(.92,.96,1.),vec3(1.,.67,.36),golden);',
      ' vec3 key=uR25Key;'
    ),
    `  vec3 lower=mix(vec3(.18,.23,.31),vec3(.16,.20,.26),cinematicLight);
  vec3 upper=mix(vec3(.52,.62,.75),vec3(.62,.68,.74),cinematicLight);
  vec3 ambient=mix(lower,upper,h)*(.12+.65*day);`,
    `  vec3 ambient=mix(uR25AmbLo,uR25AmbHi,h)*(.12+.65*day);`
  ),
  '  float alpha=1.-exp(-d*stride*metricRay*mix(.006,.0027,uCinema));',
  '  float alpha=(1.-exp(-d*stride*metricRay*mix(.006,.0027,uCinema)))*(1.-smoothstep(uR25Fade.x,uR25Fade.y,t*metricRay));'
);

// Enhanced only: the moon is the same directional source used by the ground.
// The density field and phase are unchanged, so switching tier never moves clouds.
const litMarchR25 = swapExact(swapExact(swapExact(baseMarchR25,
  'uniform float steps, rangeM;',
  'uniform float steps, rangeM; uniform vec3 cinemaKeyDir; uniform float cinema;'),
  'p+sunDir*170.,footprint)*.65+densityAt(p+sunDir*480.',
  'p+mix(sunDir,cinemaKeyDir,cinema)*170.,footprint)*.65+densityAt(p+mix(sunDir,cinemaKeyDir,cinema)*480.'),
  '  vec3 color=ambient+key*illumination*(.055+day*(.6+.85*forward));',
  `  vec3 color=ambient+key*illumination*(.055+day*(.6+.85*forward));
  if(cinema>.5){
    float silver=pow(max(0.,dot(ray,cinemaKeyDir)),12.) * (1.-overcast);
    vec3 moonFill=mix(vec3(.021,.036,.073),vec3(.065,.095,.17),h);
    vec3 lunar=moonFill+vec3(.12,.17,.26)*illumination*(.65+silver);
    color=mix(lunar,color+key*silver*illumination*.35,day);
  }`);

function sculptClouds(source){
  // Periodic domain curl breaks the straight noise-cell silhouettes. All
  // frequencies repeat within cloudPhase's 128-km period, including rebases.
  return swapExact(swapExact(source,
    ' float shape=filteredNoise(q*.5,footprint*.5/1024.)*.65+filteredNoise(q,footprint/1024.)*.35;',
    ' float shape=filteredNoise(q*.5,footprint*.5/1024.)*.48+filteredNoise(q,footprint/1024.)*.32+filteredNoise(q*2.,footprint*2./1024.)*.20;'),
    ' vec3 q=vec3(p.x*metricScale+phase.x,p.y,p.z*metricScale+phase.z)/1024.;',
    ' vec3 q=vec3(p.x*metricScale+phase.x,p.y,p.z*metricScale+phase.z)/1024.;\n if(uCinema<.5) q.xz += sin(q.zx*.19634954085)*vec2(.35,.25);');
}
export const marchR25 = sculptClouds(litMarchR25);

/**
 * Composite: (a) the sky pixels are the analytic model (uR25CFlags.x), with a
 * DIP-AWARE up either way — y' = ray.y + dip, the dome's own convention, so the
 * sky's horizon row lands on the bent rim instead of eye level; (b) the cloud
 * layer is hazed by the air in front of it (uR25CFlags.y): transmittance from
 * the SAME livingAirTransmission law the aerial pass uses, evaluated to the
 * slab-entry point, and in-scatter from the same horizon row the aerial mixes
 * toward; (c) the added sky and cloud radiance take the pre-curve exposure
 * (the aerial pass already exposed the scene underneath).
 */
const baseCompositeR25 = swapExact(
    swapExact(
      swapExact(composite,
        'uniform float skySunVisibility, skyFog;',
        `uniform float skySunVisibility, skyFog;
uniform vec4 uR25CFlags;
uniform float uR25Exposure, uR25GroundY;
uniform vec3 uR25SunDisc;
uniform vec4 uLivingAir;
${R25_SKY_GLSL_DECL}
${LIVING_AIR_CLOUD_GLSL}
${R25_SKY_GLSL_FUNCS}`
      ),
      `  float up=pow(clamp(ray.y,0.,1.),.42)*(1.-skyFog*.8);
  vec3 sky=mix(skyHorizon,skyZenith,up);
  float facing=max(0.,dot(ray,sunDir));
  float aureole=pow(facing,16.)*.16+pow(facing,128.)*.26;
  float disc=smoothstep(.99988,.99997,facing);
  sky+=skySunTint*(aureole+disc*4.)*skySunVisibility;
  scene=mix(scene,sky,day);`,
      `  float facing=max(0.,dot(ray,sunDir));
  float disc=smoothstep(.99988,.99997,facing);
  vec3 sky;
  if(uR25CFlags.x>.5){
   sky=r25Sky(ray,sunDir)+uR25SunDisc*disc;
  } else {
   float up=pow(clamp(ray.y+uR25SkyP.y,0.,1.),.42)*(1.-skyFog*.8);
   sky=mix(skyHorizon,skyZenith,up);
   float aureole=pow(facing,16.)*.16+pow(facing,128.)*.26;
   sky+=skySunTint*(aureole+disc*4.)*skySunVisibility;
  }
  scene=mix(scene,sky*uR25Exposure,day);`
    ),
    ` vec4 c=total>.001?sum/total:vec4(0,0,0,1);
 vec3 result=scene*c.a+c.rgb;`,
    ` vec4 c=total>.001?sum/total:vec4(0,0,0,1);
 vec3 cloudLight=c.rgb;
 if(uR25CFlags.y>.5&&c.a<.999){
  float lowS=base-600.,highS=base+thickness,entry=0.;
  if(abs(ray.y)>.0001){float s0=(lowS-eye.y)/ray.y,s1=(highS-eye.y)/ray.y;entry=max(0.,min(s0,s1));}
  float mRay=length(vec3(ray.x/metricScale,ray.y,ray.z/metricScale));
  if(uCinema>.5)entry=cloudRayBounds(eye,ray,rangeM/mRay,bendCenter,bendK,base,highS).x;
  vec3 entryP=metric(eye+ray*entry);
  float ta=livingAirTransmission(entry*mRay,eye.y-uR25GroundY,entryP.y-uR25GroundY);
  vec3 air;
  if(uCinema>.5)air=cinemaSky(normalize(vec3(ray.x,ray.y+uR25SkyP.y,ray.z)));
  else air=uR25CFlags.x>.5?r25SkyHorizon(dot(ray,sunDir)):skyHorizon;
  cloudLight=cloudLight*ta+air*(1.-c.a)*(1.-ta);
 }
 vec3 result=scene*c.a+cloudLight*uR25Exposure;`
);

// The input already contains aerial haze. Distant cloud shadows must lose
// contrast through that same air, or they stamp dark spots over the horizon.
const shadowCompositeR25 = swapExact(baseCompositeR25,
  '   if(casterVisibility>0.)shade=density(projected);',
  `   if(casterVisibility>0.)shade=density(projected);
   if(uCinema>.5){
     float metres=dist*length(vec3(ray.x/metricScale,ray.y,ray.z/metricScale));
     shade*=livingAirTransmission(metres,eye.y-uR25GroundY,p.y-uR25GroundY);
   }`);

const cinemaComposite = swapExact(swapExact(shadowCompositeR25,
  'uniform vec4 uR25CFlags;',
  'uniform vec4 uR25CFlags; uniform float cinema; uniform vec3 cinemaNightHorizon, cinemaNightZenith;'),
  '  scene=mix(scene,sky*uR25Exposure,day);',
  `  vec3 nightScene=scene;
  if(cinema>.5){
    float nightUp=pow(clamp(ray.y+uR25SkyP.y,0.,1.),.55);
    // Keep a small contribution from the HDRI and stars. Broad dark sky carries
    // the same horizon as terrain haze; bright stars cannot overwhelm the scene.
    nightScene=mix(cinemaNightHorizon,cinemaNightZenith,nightUp)+min(scene,vec3(.6))*.10*nightUp;
  }
  scene=mix(nightScene,sky,day)*uR25Exposure;
  if(uCinema>.5){
    vec3 skyRay=normalize(vec3(ray.x,ray.y+uR25SkyP.y,ray.z));
    scene=cinemaSky(skyRay)*uR25Exposure;
    scene+=cinemaCelestials(skyRay)*uR25Exposure;
  }`);

// The HDR sky replaces the legacy sky completely. Put legacy evaluation in
// its own branch instead of computing an eight-row atmosphere then overwriting
// it for every background pixel (especially expensive on mobile compilers).
const singleSkyComposite = swapExact(swapExact(cinemaComposite,
  '  float facing=max(0.,dot(ray,sunDir));\n  float disc=',
  '  if(uCinema<.5){\n  float facing=max(0.,dot(ray,sunDir));\n  float disc='),
  '  if(uCinema>.5){\n    vec3 skyRay=',
  '  }\n  if(uCinema>.5){\n    vec3 skyRay=');

export const compositeR25 = sculptClouds(swapExact(swapExact(singleSkyComposite,
  'void main(){', `${CINEMA_CELESTIAL_GLSL}\n${EXHAUST_HEAT_GLSL}\nvoid main(){`),
  ' vec3 scene=texture2D(inputBuffer,vUv).rgb;',
  ' vec3 scene=texture2D(inputBuffer,vUv+exhaustHeatOffset(dist)).rgb;'));

// TRUE_SCALE (lib/fly/true-scale.js): the march still runs along the SCENE
// ray (metric() maps every sample to true metres), but a depth sample's
// distance along that ray is its SCENE length, not its view-space length, and
// every sky / sun / key lookup takes the TRUE ray the pixel renders as. The
// dip stays in scene-ray terms and is mapped with the ray. Untouched when the
// flag is off; a drifted anchor leaves that one program untouched.
// The low-resolution filter and four-tap reconstruction compare VIEW distances;
// only the composite's centre pixel pays for the scene distance.
const TS_RAY_ANCHOR = 'vec3 rayAt(vec2 uv){return normalize(mat3(cameraWorld)*normalize(viewAt(uv,reverseDepth>.5?.00001:.99999)));}';
const TS_CLOUD_COMMON = [
  [
    TS_RAY_ANCHOR,
    TS_RAY_ANCHOR +
      trueRayGLSL('vec3(cameraWorld[0][1],cameraWorld[1][1],cameraWorld[2][1])') +
      'float tsSceneDistanceAt(vec2 uv){float d=texture2D(sceneDepth,uv).r;return (reverseDepth>.5?d<.0000001:d>.9999999)?1000000.:length(mat3(cameraWorld)*viewAt(uv,d));}\n',
  ],
];
const TS_CLOUD_MARCH = [
  ...TS_CLOUD_COMMON,
  [' float limit=min(rangeM/metricRay,distanceAt(vUv));', ' float limit=min(rangeM/metricRay,tsSceneDistanceAt(vUv));'],
  ['float forward=pow(max(0.,dot(ray,sunDir)),8.);', 'float forward=pow(max(0.,dot(tsTrueRay(ray),sunDir)),8.);'],
  ['float mu=dot(ray,uCinemaKey);', 'float mu=dot(tsTrueRay(ray),uCinemaKey);'],
  ['float silver=pow(max(0.,dot(ray,cinemaKeyDir)),12.)', 'float silver=pow(max(0.,dot(tsTrueRay(ray),cinemaKeyDir)),12.)', 'optional'],
];
const TS_CLOUD_COMPOSITE = [
  ...TS_CLOUD_COMMON,
  [' vec3 ray=rayAt(vUv);float dist=distanceAt(vUv);', ' vec3 ray=rayAt(vUv);float distView=distanceAt(vUv);float dist=tsSceneDistanceAt(vUv);'],
  ['weight*=exp(-abs(sampleDistance-dist)/max(2.,dist*.008));', 'weight*=exp(-abs(sampleDistance-distView)/max(2.,distView*.008));'],
  ['float facing=max(0.,dot(ray,sunDir));', 'float facing=max(0.,dot(tsTrueRay(ray),sunDir));'],
  ['float up=pow(clamp(ray.y,0.,1.),.42)', 'float up=pow(clamp(tsTrueRay(ray).y,0.,1.),.42)', 'optional'],
  ['sky=r25Sky(ray,sunDir)', 'sky=r25Sky(tsTrueRay(ray),sunDir)', 'optional'],
  ['r25SkyHorizon(dot(ray,sunDir))', 'r25SkyHorizon(dot(tsTrueRay(ray),sunDir))', 'optional'],
  ['pow(clamp(ray.y+uR25SkyP.y,0.,1.),', 'pow(clamp(tsTrueRay(vec3(ray.x,ray.y+uR25SkyP.y,ray.z)).y,0.,1.),', 'any'],
  ['normalize(vec3(ray.x,ray.y+uR25SkyP.y,ray.z))', 'tsTrueRay(normalize(vec3(ray.x,ray.y+uR25SkyP.y,ray.z)))', 'any'],
];
// PHYS_SKY (lib/fly/atmosphere/): in Enhanced the air in front of the cloud
// layer is the physical aerial volume (the night floor's air at night, weather
// extinction on top), and distant
// cloud shadows lose contrast through that same air. Asserted edits before
// TRUE_SCALE's (whose anchors they leave intact); off or a miss = unchanged.
const physComposite = (src) => physSkyShader('cloud-composite-r25', src, [
  ['uniform vec4 uLivingAir;\n', `uniform vec4 uLivingAir;\n${ATMO_AERIAL_LOOKUP_GLSL}`],
  [
    '  cloudLight=cloudLight*ta+air*(1.-c.a)*(1.-ta);\n',
    `  if(uCinema>.5){
   vec3 apS,apT,apDir=normalize(vec3(ray.x/metricScale,ray.y,ray.z/metricScale));
   pskyAerial(apDir,entry*mRay*.001,apS,apT);
   cloudLight=(cloudLight*apT+(apS*uPskySunIllum+pskyNightAir(apDir)*(1.-apT))*(1.-c.a))*ta+air*(1.-c.a)*(1.-ta);
  } else cloudLight=cloudLight*ta+air*(1.-c.a)*(1.-ta);\n`,
  ],
  [
    '     shade*=livingAirTransmission(metres,eye.y-uR25GroundY,p.y-uR25GroundY);\n',
    `     shade*=livingAirTransmission(metres,eye.y-uR25GroundY,p.y-uR25GroundY);
     {vec3 aS,aT;pskyAerial(normalize(vec3(ray.x/metricScale,ray.y,ray.z/metricScale)),metres*.001,aS,aT);shade*=dot(aT,vec3(.2126,.7152,.0722));}\n`,
  ],
]);
const tsMarch = (name, src) => trueScaleShader(name, src, TS_CLOUD_MARCH);
const tsComposite = (name, src) => trueScaleShader(name, src, TS_CLOUD_COMPOSITE);

// R25 C: the one live pass (one satellite composer at a time), so the
// prewarm's lazy alternate-profile warm can compile its Enhanced pair.
let _livePass = null;
/** Compile the live pass's Enhanced pair (lazy alternate warm). false if none. */
export function warmLiveCloudR25(renderer) {
  if (!_livePass || !renderer) return false;
  _livePass.warmR25(renderer);
  return true;
}

/** Three cloud-resolution draws and one scene composite; no temporal history. */
export class ImmersiveCloudPass extends Pass {
  constructor(camera,runtime) {
    super('ImmersiveClouds');
    this.needsDepthTexture=true;
    this.flightCamera=camera;this.runtime=runtime;this.tier='high';this.elapsed=0;this.mix=0;this.driftX=0;this.driftZ=0;
    this.size=new Vector2(1,1);
    this.target=new WebGLRenderTarget(1,1,{type:HalfFloatType,depthBuffer:false});
    this.filterTarget=this.target.clone();
    this.noise=new Data3DTexture(cloudNoiseVolume(),64,64,64);
    this.noise.format=RedFormat;this.noise.minFilter=LinearFilter;this.noise.magFilter=LinearFilter;
    this.noise.wrapS=this.noise.wrapT=this.noise.wrapR=RepeatWrapping;this.noise.unpackAlignment=1;this.noise.needsUpdate=true;
    this.cinemaNoise=new Data3DTexture(new Uint8Array(2),1,1,1);
    this.cinemaNoise.format=RGFormat;this.cinemaNoise.minFilter=LinearMipmapLinearFilter;this.cinemaNoise.magFilter=LinearFilter;
    this.cinemaNoise.generateMipmaps=true;
    this.cinemaNoise.wrapS=this.cinemaNoise.wrapT=this.cinemaNoise.wrapR=RepeatWrapping;this.cinemaNoise.unpackAlignment=1;this.cinemaNoise.needsUpdate=true;
    this.banks=new DataTexture(cinemaBankData(),16,16,RGBAFormat,FloatType);
    this.banks.minFilter=this.banks.magFilter=NearestFilter;
    this.banks.generateMipmaps=false;this.banks.needsUpdate=true;
    this.uniforms={
      sceneDepth:{value:null},noiseVolume:{value:this.noise},inverseProjection:{value:new Matrix4()},cameraWorld:{value:new Matrix4()},
      cinemaNoiseVolume:{value:this.cinemaNoise},cinemaNoiseReady:{value:0},cinemaBanks:{value:this.banks},
      eye:{value:new Vector3()},phase:{value:new Vector3()},sunDir:{value:new Vector3(0,1,0)},
      bendCenter:{value:new Vector2()},reverseDepth:{value:0},metricScale:{value:1},bendK:{value:0},
      base:{value:1500},thickness:{value:1100},coverage:{value:.43},day:{value:1},golden:{value:0},night:{value:0},
      cinematicLight:{value:1},overcast:{value:0},
      cinema:{value:0},cinemaKeyDir:{value:new Vector3(0,1,0)},
      cinemaNightHorizon:{value:new Vector3().fromArray(CINEMATIC_EARTH.nightHorizon)},
      cinemaNightZenith:{value:new Vector3().fromArray(CINEMATIC_EARTH.nightZenith)},
      steps:{value:48},lightSamples:{value:3},rangeM:{value:IMMERSIVE.clouds.rangeM},inputBuffer:{value:null},
      shadowFadeM:{value:new Vector2(IMMERSIVE.clouds.rangeM*.72,IMMERSIVE.clouds.rangeM)},
      clouds:{value:this.target.texture},texel:{value:new Vector2(1,1)},filterAxis:{value:new Vector2(1,0)},cloudMix:{value:0},
      skyHorizon:{value:new Vector3()},skyZenith:{value:new Vector3()},skySunTint:{value:new Vector3()},
      skySunVisibility:{value:1},skyFog:{value:0},
    };
    Object.assign(this.uniforms,CINEMA_UNIFORMS);
    this.heat = new ExhaustHeat();Object.assign(this.uniforms,this.heat.uniforms);
    const material=(fragmentShader)=>new ShaderMaterial({defines:{CINEMA_BANK_LUT:1},uniforms:this.uniforms,vertexShader:vertex,fragmentShader,depthTest:false,depthWrite:false,toneMapped:false});
    // HDR_GUARD: the composite is the last full pass before bloom (hdr-guard.js).
    this.marchMaterial=material(tsMarch('cloud-march',march));this.compositeMaterial=material(hdrGuarded(tsComposite('cloud-composite',composite)));
    this.filterMaterial=material(common+CLOUD_FILTER_GLSL);
    this.fullscreenMaterial=this.compositeMaterial;
    this.stats={active:true,steps:48,width:1,height:1,inside:0,draws:4,r25:false,reconstructionTaps:4};
    if(cinemaOn())this.ensureVolume();
    // R25 C: the Enhanced pair is built on first use (Enhanced data is
    // allocated lazily); a pinned Classic session never allocates or compiles it.
    this.r25=null;
    this.cloudLight=new Float64Array(9);
    _livePass=this;
  }
  /** A saved Classic boot can switch to Enhanced without remounting this pass. */
  ensureVolume(){
    if(this.volumeRequest||this.disposed)return;
    this.volumeRequest=loadCinemaCloudVolume().then(data=>{
      if(this.disposed)return;
      // texStorage3D is immutable: retire the placeholder before resizing it.
      this.cinemaNoise.dispose();this.cinemaNoise.image={data,width:64,height:64,depth:64};
      this.cinemaNoise.needsUpdate=true;this.volumeReady=true;
    }).catch(error=>{if(!this.disposed)this.stats.volumeError=error.message;});
  }
  /** Build (once) the Enhanced march + composite; returns the holder. */
  ensureR25(){
    if(this.r25)return this.r25;
    const uniforms={...this.uniforms,
      uR25Key:{value:new Vector3(1,1,1)},uR25AmbLo:{value:new Vector3()},uR25AmbHi:{value:new Vector3()},uR25Fade:{value:new Vector2(1e9,2e9)},
      uR25CFlags:{value:new Vector4()},uR25Exposure:{value:1},uR25GroundY:{value:0},uR25SunDisc:{value:new Vector3()},
      uLivingAir:{value:new Vector4(1,1,.00012,1200)},
      uR25SkyR:{value:new Float32Array(SKY_ROWS*3)},uR25SkyM:{value:new Float32Array(SKY_ROWS*3)},uR25SkyA:{value:new Float32Array(SKY_ROWS*3)},
      uR25SkyP:{value:new Vector4(.76,0,0,0)},uR25VeilH:{value:new Vector3()},uR25VeilZ:{value:new Vector3()}};
    const material=(fragmentShader)=>new ShaderMaterial({defines:{CINEMA_BANK_LUT:1},uniforms,vertexShader:vertex,fragmentShader,depthTest:false,depthWrite:false,toneMapped:false});
    this.r25={uniforms,march:material(tsMarch('cloud-march-r25',marchR25)),composite:material(hdrGuarded(tsComposite('cloud-composite-r25',physComposite(compositeR25))))};
    return this.r25;
  }
  /** Compile the Enhanced pair now (the prewarm's lazy alternate warm). */
  warmR25(renderer){
    const r=this.ensureR25(),prev=this.fullscreenMaterial;
    this.fullscreenMaterial=r.march;renderer.compile(this.scene,this.camera);
    this.fullscreenMaterial=r.composite;renderer.compile(this.scene,this.camera);
    this.fullscreenMaterial=prev;
  }
  setDepthTexture(texture){this.uniforms.sceneDepth.value=texture;}
  initialize(renderer){
    // Retain both programs for the entire pass lifetime, including quality steps.
    this.fullscreenMaterial=this.marchMaterial;renderer.compile(this.scene,this.camera);
    this.fullscreenMaterial=this.filterMaterial;renderer.compile(this.scene,this.camera);
    this.fullscreenMaterial=this.compositeMaterial;renderer.compile(this.scene,this.camera);
  }
  setSize(width,height){
    this.size.set(width,height);
    const p=immersiveProfile(this.tier);
    const [w,h]=cloudTargetSize(width,height,p);
    if(this.target.width!==w||this.target.height!==h)this.target.setSize(w,h);
    if(this.filterTarget.width!==w||this.filterTarget.height!==h)this.filterTarget.setSize(w,h);
    this.uniforms.texel.value.set(1/w,1/h);Object.assign(this.stats,{width:w,height:h,steps:p.cloudSteps});
  }
  setTier(tier){if(this.tier!==tier){this.tier=tier;this.setSize(this.size.x,this.size.y);}}
  render(renderer,input,output,delta=0){
    const rt=this.runtime,u=this.uniforms,cam=this.flightCamera;
    if(cinemaOn())this.ensureVolume();
    if(this.volumeReady)u.cinemaNoiseReady.value=Math.min(1,u.cinemaNoiseReady.value+Math.min(delta,.1));
    this.stats.densityModel=cinemaOn()?'cellular-v2':'legacy';this.stats.volumeReady=!!this.volumeReady;
    const profile=immersiveProfile(this.tier);
    u.lightSamples.value=profile.cloudLightSamples??3;
    this.stats.lightSamples=u.lightSamples.value;
    if(this._profile!==profile){this._profile=profile;this.setSize(this.size.x,this.size.y);}
    const paused=useFlyStore.getState().phase==='paused'||useFlyStore.getState().cameraMode==='photo';
    // R25 C: `window.__flyCloudFreeze` (dev pin) stops the drift so pixel
    // gates capture the same cloud field twice. Production never reads it.
    const frozen=process.env.NODE_ENV==='development'&&typeof window!=='undefined'&&!!window.__flyCloudFreeze;
    const state=immersiveLighting(rt.sun,rt.weather?.wx),k=rt.cinemaGeography?.worldUnitsPerMetre??mercatorScale(rt.flight?.latDeg||0),b=getBend();
    // Weather wind is true m/s; the density grid uses projected Mercator XZ.
    if(!paused&&!frozen){const dt=Math.min(delta,.1);this.elapsed+=dt;this.driftX+=(rt.weather?.wx?.windX??5)*k*dt;this.driftZ+=(rt.weather?.wx?.windZ??0)*k*dt;}
    u.inverseProjection.value.copy(cam.projectionMatrixInverse);u.cameraWorld.value.copy(cam.matrixWorld);
    u.eye.value.copy(cam.position);u.reverseDepth.value=renderer.capabilities.reversedDepthBuffer?1:0;
    u.metricScale.value=k;u.bendCenter.value.set(b.cx,b.cz);u.bendK.value=b.k;
    // Use a fixed geographic grid, not a ground-relative cloud base that follows mountains.
    const ox=rt.cinemaGeography?.originX??rt.origin?.anchor.x??0,oz=rt.cinemaGeography?.originZ??rt.origin?.anchor.z??0;
    u.phase.value.set(cloudPhase(ox-this.driftX),0,cloudPhase(oz-this.driftZ));
    const sin=Math.min(1,Math.max(-1,rt.sun?.sinEl??1)),az=rt.sun?.az||0,c=Math.sqrt(1-sin*sin);
    u.sunDir.value.set(-Math.sin(az)*c,sin,Math.cos(az)*c);
    u.cinema.value=cinematicEarthOn()?1:0;
    this._moon ??= [0,1,0];moonDirFromSun(az,this._moon);
    u.cinemaKeyDir.value.copy(u.sunDir.value);
    this._cinemaMoon ??= new Vector3();
    this._cinemaMoon.fromArray(this._moon);
    u.cinemaKeyDir.value.lerp(this._cinemaMoon,state.night).normalize();
    if(rt.cinemaEnvironment)u.cinemaKeyDir.value.fromArray(rt.cinemaEnvironment.keyDir);
    const store=useFlyStore.getState();
    this.heat.update(rt.flight,cam,!!u.cinema.value&&(cinemaOn()?cinemaProfile().name==='ultra':store.qualityPreset==='ultra'&&this.tier==='high')&&!readReducedMotion(),paused?0:delta,rt.origin?.anchor);
    for(const key of ['day','golden','night'])u[key].value=state[key];
    u.cinematicLight.value=cinematicFlightOn('lighting')?1:0;u.overcast.value=state.overcast;
    const sky=livingSkyPalette(state,rt.weather?.wx);
    u.skyHorizon.value.fromArray(sky.horizon);u.skyZenith.value.fromArray(sky.zenith);u.skySunTint.value.fromArray(sky.sunTint);
    u.skySunVisibility.value=sky.sunVisibility;u.skyFog.value=sky.fog;
    u.base.value=state.cloudBase;u.thickness.value=state.cloudThickness;u.coverage.value=state.cloudCoverage;
    u.steps.value=immersiveProfile(this.tier).cloudSteps;
    this.mix+= (1-this.mix)*(1-Math.exp(-Math.min(delta,.1)*1.5));u.cloudMix.value=this.mix;
    const cloudHeight=cam.position.y+((cam.position.x-b.cx)**2+(cam.position.z-b.cz)**2)*b.k;
    this.stats.inside=Math.min(1,cloudDensity(cam.position.x+ox-this.driftX,cloudHeight,cam.position.z+oz-this.driftZ,{base:state.cloudBase,thickness:state.cloudThickness,coverage:state.cloudCoverage})*2);
    rt.immersiveClouds=this.stats;
    const r25=this.r25Frame(rt);
    u.shadowFadeM.value.set(r25?.marchOn?R25_SKY.cloudAir.fadeStartM:IMMERSIVE.clouds.rangeM*.72,r25?.marchOn?R25_SKY.cloudAir.fadeEndM:IMMERSIVE.clouds.rangeM);
    this.stats.r25=!!r25;
    this.fullscreenMaterial=r25?.marchOn?this.r25.march:this.marchMaterial;renderer.setRenderTarget(this.target);renderer.render(this.scene,this.camera);
    this.fullscreenMaterial=this.filterMaterial;
    u.clouds.value=this.target.texture;u.filterAxis.value.set(1,0);
    renderer.setRenderTarget(this.filterTarget);renderer.render(this.scene,this.camera);
    u.clouds.value=this.filterTarget.texture;u.filterAxis.value.set(0,1);
    renderer.setRenderTarget(this.target);renderer.render(this.scene,this.camera);
    u.clouds.value=this.target.texture;
    u.inputBuffer.value=input.texture;
    this.fullscreenMaterial=r25?this.r25.composite:this.compositeMaterial;renderer.setRenderTarget(this.renderToScreen?null:output);renderer.render(this.scene,this.camera);
  }
  /**
   * R25 C: resolve this frame's Enhanced state from r25-sky's per-frame
   * publication (the same r25On predicates, evaluated once in r25SkyFrame) and
   * fill the Enhanced uniforms. null = Classic (nothing touched, nothing built).
   */
  r25Frame(rt){
    const sky=getR25Sky(),f=sky.flags;
    if(!sky.live||!(f.model||f.cloudAir||f.exposure||f.skyDip))return null;
    const r=this.ensureR25(),q=r.uniforms,m=sky.modelLive?sky.model:null;
    const modelSky=f.model&&!!m,air=f.cloudAir;
    q.uR25CFlags.value.set(modelSky?1:0,air?1:0,0,0);
    q.uR25Exposure.value=f.exposure?sky.exposure:1;
    // CLOUD_CALM: the damped haze ground (the raw ground when off).
    q.uR25GroundY.value=hazeGroundY(rt,rt.flight?.groundElev??0);
    if(m){
      writeSkyUniforms(m,q);
      q.uR25SunDisc.value.fromArray(m.sunDisc);
    } else {
      q.uR25SkyP.value.set(.76,0,0,0);
    }
    // The dip is the DOME's live value (FlyScene -> setSkyDip), read here at
    // composer time; skyDip off = eye-level up, the Classic convention.
    // PHYS_SKY: the physical sky has its own horizon, so its rays carry no dip.
    q.uR25SkyP.value.y=f.skyDip&&!(PHYS_SKY_TEXT_ACTIVE&&CINEMA_UNIFORMS.uCinema.value>.5)?getSkyDip():0;
    // livingAirProfile(wx, lat), inlined without its per-call object (the
    // arithmetic is living-atmosphere.js's; verify-r25-sky.mjs asserts it).
    const wx=rt.weather?.wx,lat=rt.flight?.latDeg||0;
    q.uLivingAir.value.set(1,1/Math.max(.1,Math.cos(lat*Math.PI/180)),
      .00012+Math.min(1,Math.max(0,wx?.overcastT||0))*.000045+Math.min(1,Math.max(0,wx?.fogT||0))*.00024,1200);
    // PHYS_SKY: the physical volume carries clear air; the law adds weather only.
    if(rt.cinemaEnvironment){q.uLivingAir.value.z=PHYS_SKY_TEXT_ACTIVE?physWeatherExtinction(cinemaEnvironment):cinemaEnvironment.extinction;q.uLivingAir.value.w=cinemaEnvironment.heightM;}
    const marchOn=air&&!!m;
    if(marchOn){
      const light=paintedCloudLight(m,this.uniforms.golden.value,this.cloudLight);
      q.uR25Key.value.fromArray(light,0);
      q.uR25AmbHi.value.fromArray(light,3);
      q.uR25AmbLo.value.fromArray(light,6);
      q.uR25Fade.value.set(R25_SKY.cloudAir.fadeStartM,R25_SKY.cloudAir.fadeEndM);
    }
    return {marchOn};
  }
  // Pass owns an orthographic fullscreen camera. Keep the flight camera separately.
  dispose(){this.disposed=true;this.target.dispose();this.filterTarget.dispose();this.filterMaterial.dispose();this.noise.dispose();this.cinemaNoise.dispose();this.banks.dispose();this.marchMaterial.dispose();this.compositeMaterial.dispose();if(this.r25){this.r25.march.dispose();this.r25.composite.dispose();this.r25=null;}if(_livePass===this)_livePass=null;delete this.runtime.immersiveClouds;}
}
