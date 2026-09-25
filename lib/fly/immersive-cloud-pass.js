import { Pass } from 'postprocessing';
import { Data3DTexture, HalfFloatType, LinearFilter, Matrix4, RedFormat, RepeatWrapping, ShaderMaterial, Vector2, Vector3, Vector4, WebGLRenderTarget } from 'three';
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

const vertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const common = `
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
 return texture(noiseVolume,(i+f+.5)/64.).r;
}
vec3 metric(vec3 p){vec2 dx=p.xz-bendCenter;return vec3(p.x/metricScale,p.y+dot(dx,dx)*bendK,p.z/metricScale);}
float filteredNoise(vec3 p,float footprint){
 // Do not point-sample details smaller than a march interval. Their mean is
 // .5, so removing an unresolved octave preserves coverage instead of filling
 // all the holes (or eroding the cloud away) at the horizon and on low tier.
 float resolved=1.-smoothstep(.35,1.,footprint);
 return mix(.5,noise3(p),resolved);
}
float densityAt(vec3 p,float footprint){
 float h=(p.y-base)/thickness;
 if(h<=0.||h>=1.)return 0.;
 vec3 q=vec3(p.x*metricScale+phase.x,p.y,p.z*metricScale+phase.z)/1024.;
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
const march = common + `
uniform float steps, rangeM;
void main(){
 vec3 ray=rayAt(vUv);float metricRay=length(vec3(ray.x/metricScale,ray.y,ray.z/metricScale));
 float limit=min(rangeM/metricRay,distanceAt(vUv));
 // Conservative slab bounds include curvature; the density uses exact unbent height.
 float low=base-600.,high=base+thickness;
 float a=0.,b=limit;
 if(abs(ray.y)>.0001){float t0=(low-eye.y)/ray.y,t1=(high-eye.y)/ray.y;a=max(0.,min(t0,t1));b=min(limit,max(t0,t1));}
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
  float t=a+(float(i)+jitter)*stride;
  vec3 p=metric(eye+ray*t);
  float d=densityAt(p,footprint);if(d<.002)continue;
  float shadow=densityAt(p+sunDir*170.,footprint)*.65+densityAt(p+sunDir*480.,footprint)*.35;
  float illumination=exp(-shadow*mix(2.6,3.15,cinematicLight*(1.0-overcast*.65)));
  float h=clamp((p.y-base)/thickness,0.,1.);
  vec3 lower=mix(vec3(.18,.23,.31),vec3(.16,.20,.26),cinematicLight);
  vec3 upper=mix(vec3(.52,.62,.75),vec3(.62,.68,.74),cinematicLight);
  vec3 ambient=mix(lower,upper,h)*(.12+.65*day);
  vec3 color=ambient+key*illumination*(.055+day*(.6+.85*forward));
  float alpha=1.-exp(-d*stride*metricRay*.006);
  light+=trans*alpha*color;trans*=1.-alpha;
 }
 gl_FragColor=vec4(light,trans);
}`;
const composite = common + `
uniform sampler2D inputBuffer, clouds;
uniform vec2 texel;
uniform float cloudMix;
uniform vec3 skyHorizon, skyZenith, skySunTint;
uniform float skySunVisibility, skyFog;
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
  if(p.y<base&&sunDir.y>.08){
   vec3 projected=p+sunDir*((base+thickness*.35-p.y)/sunDir.y);
   float shade=density(projected);
   scene*=1.-clamp(shade*.32,0.,.23)*day*cloudMix;
  }
 }
 vec2 cell=vUv/texel-.5,origin=floor(cell+.5);
 vec4 sum=vec4(0);float total=0.;
 // Reconstruct the stratified reduced-resolution volume with a small Gaussian,
 // rejecting samples across real scene-depth edges (aircraft/terrain).
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec2 uv=(origin+vec2(float(x),float(y))+.5)*texel;
  float sampleDistance=distanceAt(uv);
  vec2 offset=origin+vec2(float(x),float(y))-cell;
  float weight=exp(-dot(offset,offset)*1.25);
  weight*=exp(-abs(sampleDistance-dist)/max(2.,dist*.008));
  sum+=texture2D(clouds,uv)*weight;total+=weight;
 }
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
export const marchR25 = swapExact(
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
  '  float alpha=1.-exp(-d*stride*metricRay*.006);',
  '  float alpha=(1.-exp(-d*stride*metricRay*.006))*(1.-smoothstep(uR25Fade.x,uR25Fade.y,t*metricRay));'
);

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
export const compositeR25 = swapExact(
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
  vec3 entryP=metric(eye+ray*entry);
  float ta=livingAirTransmission(entry*mRay,eye.y-uR25GroundY,entryP.y-uR25GroundY);
  vec3 air=uR25CFlags.x>.5?r25SkyHorizon(dot(ray,sunDir)):skyHorizon;
  cloudLight=cloudLight*ta+air*(1.-c.a)*(1.-ta);
 }
 vec3 result=scene*c.a+cloudLight*uR25Exposure;`
);

// R25 C: the one live pass (one satellite composer at a time), so the
// prewarm's lazy alternate-profile warm can compile its Enhanced pair.
let _livePass = null;
/** Compile the live pass's Enhanced pair (lazy alternate warm). false if none. */
export function warmLiveCloudR25(renderer) {
  if (!_livePass || !renderer) return false;
  _livePass.warmR25(renderer);
  return true;
}

/** Two bounded full-screen draws; no history to invalidate at warps/rebases. */
export class ImmersiveCloudPass extends Pass {
  constructor(camera,runtime) {
    super('ImmersiveClouds');
    this.needsDepthTexture=true;
    this.flightCamera=camera;this.runtime=runtime;this.tier='high';this.elapsed=0;this.mix=0;this.driftX=0;this.driftZ=0;
    this.size=new Vector2(1,1);
    this.target=new WebGLRenderTarget(1,1,{type:HalfFloatType,depthBuffer:false});
    this.noise=new Data3DTexture(cloudNoiseVolume(),64,64,64);
    this.noise.format=RedFormat;this.noise.minFilter=LinearFilter;this.noise.magFilter=LinearFilter;
    this.noise.wrapS=this.noise.wrapT=this.noise.wrapR=RepeatWrapping;this.noise.unpackAlignment=1;this.noise.needsUpdate=true;
    this.uniforms={
      sceneDepth:{value:null},noiseVolume:{value:this.noise},inverseProjection:{value:new Matrix4()},cameraWorld:{value:new Matrix4()},
      eye:{value:new Vector3()},phase:{value:new Vector3()},sunDir:{value:new Vector3(0,1,0)},
      bendCenter:{value:new Vector2()},reverseDepth:{value:0},metricScale:{value:1},bendK:{value:0},
      base:{value:1500},thickness:{value:1100},coverage:{value:.43},day:{value:1},golden:{value:0},night:{value:0},
      cinematicLight:{value:1},overcast:{value:0},
      steps:{value:48},rangeM:{value:IMMERSIVE.clouds.rangeM},inputBuffer:{value:null},
      clouds:{value:this.target.texture},texel:{value:new Vector2(1,1)},cloudMix:{value:0},
      skyHorizon:{value:new Vector3()},skyZenith:{value:new Vector3()},skySunTint:{value:new Vector3()},
      skySunVisibility:{value:1},skyFog:{value:0},
    };
    const material=(fragmentShader)=>new ShaderMaterial({uniforms:this.uniforms,vertexShader:vertex,fragmentShader,depthTest:false,depthWrite:false,toneMapped:false});
    this.marchMaterial=material(march);this.compositeMaterial=material(composite);
    this.fullscreenMaterial=this.compositeMaterial;
    this.stats={active:true,steps:48,width:1,height:1,inside:0,draws:2,r25:false};
    // R25 C: the Enhanced pair is built on first use (Enhanced data is
    // allocated lazily); a pinned Classic session never allocates or compiles it.
    this.r25=null;
    this.cloudLight=new Float64Array(9);
    _livePass=this;
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
    const material=(fragmentShader)=>new ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader,depthTest:false,depthWrite:false,toneMapped:false});
    this.r25={uniforms,march:material(marchR25),composite:material(compositeR25)};
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
    this.fullscreenMaterial=this.compositeMaterial;renderer.compile(this.scene,this.camera);
  }
  setSize(width,height){
    this.size.set(width,height);
    const p=immersiveProfile(this.tier);
    const w=Math.max(1,Math.ceil(width*p.cloudScale)),h=Math.max(1,Math.ceil(height*p.cloudScale));
    if(this.target.width!==w||this.target.height!==h)this.target.setSize(w,h);
    this.uniforms.texel.value.set(1/w,1/h);Object.assign(this.stats,{width:w,height:h,steps:p.cloudSteps});
  }
  setTier(tier){if(this.tier!==tier){this.tier=tier;this.setSize(this.size.x,this.size.y);}}
  render(renderer,input,output,delta=0){
    const rt=this.runtime,u=this.uniforms,cam=this.flightCamera;
    const paused=useFlyStore.getState().phase==='paused';
    // R25 C: `window.__flyCloudFreeze` (dev pin) stops the drift so pixel
    // gates capture the same cloud field twice. Production never reads it.
    const frozen=process.env.NODE_ENV==='development'&&typeof window!=='undefined'&&!!window.__flyCloudFreeze;
    const state=immersiveLighting(rt.sun,rt.weather?.wx),k=mercatorScale(rt.flight?.latDeg||0),b=getBend();
    // Weather wind is true m/s; the density grid uses projected Mercator XZ.
    if(!paused&&!frozen){const dt=Math.min(delta,.1);this.elapsed+=dt;this.driftX+=(rt.weather?.wx?.windX??5)*k*dt;this.driftZ+=(rt.weather?.wx?.windZ??0)*k*dt;}
    u.inverseProjection.value.copy(cam.projectionMatrixInverse);u.cameraWorld.value.copy(cam.matrixWorld);
    u.eye.value.copy(cam.position);u.reverseDepth.value=renderer.capabilities.reversedDepthBuffer?1:0;
    u.metricScale.value=k;u.bendCenter.value.set(b.cx,b.cz);u.bendK.value=b.k;
    // Use a fixed geographic grid, not a ground-relative cloud base that follows mountains.
    const ox=rt.origin?.anchor.x||0,oz=rt.origin?.anchor.z||0;
    u.phase.value.set(cloudPhase(ox-this.driftX),0,cloudPhase(oz-this.driftZ));
    const sin=Math.min(1,Math.max(-1,rt.sun?.sinEl??1)),az=rt.sun?.az||0,c=Math.sqrt(1-sin*sin);
    u.sunDir.value.set(-Math.sin(az)*c,sin,Math.cos(az)*c);
    for(const key of ['day','golden','night'])u[key].value=state[key];
    u.cinematicLight.value=cinematicFlightOn('lighting')?1:0;u.overcast.value=state.overcast;
    const sky=livingSkyPalette(state,rt.weather?.wx);
    u.skyHorizon.value.fromArray(sky.horizon);u.skyZenith.value.fromArray(sky.zenith);u.skySunTint.value.fromArray(sky.sunTint);
    u.skySunVisibility.value=sky.sunVisibility;u.skyFog.value=sky.fog;
    u.base.value=state.cloudBase;u.thickness.value=state.cloudThickness;u.coverage.value=state.cloudCoverage;
    u.steps.value=immersiveProfile(this.tier).cloudSteps;
    this.mix+= (1-this.mix)*(1-Math.exp(-Math.min(delta,.1)*1.5));u.cloudMix.value=this.mix;
    this.stats.inside=Math.min(1,cloudDensity(cam.position.x+ox-this.driftX,cam.position.y,cam.position.z+oz-this.driftZ,{base:state.cloudBase,thickness:state.cloudThickness,coverage:state.cloudCoverage})*2);
    rt.immersiveClouds=this.stats;
    const r25=this.r25Frame(rt);
    this.stats.r25=!!r25;
    this.fullscreenMaterial=r25?.marchOn?this.r25.march:this.marchMaterial;renderer.setRenderTarget(this.target);renderer.render(this.scene,this.camera);
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
    q.uR25GroundY.value=rt.flight?.groundElev??0;
    if(m){
      writeSkyUniforms(m,q);
      q.uR25SunDisc.value.fromArray(m.sunDisc);
    } else {
      q.uR25SkyP.value.set(.76,0,0,0);
    }
    // The dip is the DOME's live value (FlyScene -> setSkyDip), read here at
    // composer time; skyDip off = eye-level up, the Classic convention.
    q.uR25SkyP.value.y=f.skyDip?getSkyDip():0;
    // livingAirProfile(wx, lat), inlined without its per-call object (the
    // arithmetic is living-atmosphere.js's; verify-r25-sky.mjs asserts it).
    const wx=rt.weather?.wx,lat=rt.flight?.latDeg||0;
    q.uLivingAir.value.set(1,1/Math.max(.1,Math.cos(lat*Math.PI/180)),
      .00012+Math.min(1,Math.max(0,wx?.overcastT||0))*.000045+Math.min(1,Math.max(0,wx?.fogT||0))*.00024,1200);
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
  dispose(){this.target.dispose();this.noise.dispose();this.marchMaterial.dispose();this.compositeMaterial.dispose();if(this.r25){this.r25.march.dispose();this.r25.composite.dispose();this.r25=null;}if(_livePass===this)_livePass=null;delete this.runtime.immersiveClouds;}
}
