import { Pass } from 'postprocessing';
import { Data3DTexture, HalfFloatType, LinearFilter, Matrix4, RedFormat, RepeatWrapping, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget } from 'three';
import { IMMERSIVE, cloudPhase, cloudDensity, cloudNoiseVolume, immersiveLighting } from './immersive';
import { mercatorScale } from './coords';
import { getBend } from './toy-world/world-bend';
import { useFlyStore } from '../../stores/fly-store';

const vertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const common = `
varying vec2 vUv;
uniform sampler2D sceneDepth;
uniform highp sampler3D noiseVolume;
uniform mat4 inverseProjection, cameraWorld;
uniform vec3 eye, phase, sunDir;
uniform vec2 bendCenter;
uniform float reverseDepth, metricScale, bendK, base, thickness, coverage, day, golden, night;
float noise3(vec3 p){
 vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return texture(noiseVolume,(i+f+.5)/64.).r;
}
vec3 metric(vec3 p){vec2 dx=p.xz-bendCenter;return vec3(p.x/metricScale,p.y+dot(dx,dx)*bendK,p.z/metricScale);}
float density(vec3 p){
 float h=(p.y-base)/thickness;
 if(h<=0.||h>=1.)return 0.;
 vec3 q=vec3(p.x*metricScale+phase.x,p.y,p.z*metricScale+phase.z)/1024.;
 float shape=noise3(q*.5)*.65+noise3(q)*.35;
 float erosion=noise3(q*4.)*.13+noise3(q*8.)*.055;
 float envelope=smoothstep(0.,.16,h)*(1.-smoothstep(.55,1.,h));
 return max(0.,shape-(1.-coverage)-erosion)*envelope*3.8;
}
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
 // Midpoint integration avoids both screen-door noise and temporal boiling.
 float jitter=.5;
 float forward=pow(max(0.,dot(ray,sunDir)),8.);
 vec3 key=mix(vec3(.92,.96,1.),vec3(1.,.67,.36),golden);
 for(int i=0;i<96;i++){
  if(float(i)>=steps||trans<.015)break;
  float t=a+(float(i)+jitter)*stride;
  vec3 p=metric(eye+ray*t);
  float d=density(p);if(d<.002)continue;
  float shadow=density(p+sunDir*170.)*.65+density(p+sunDir*480.)*.35;
  float illumination=exp(-shadow*2.6);
  float h=clamp((p.y-base)/thickness,0.,1.);
  vec3 ambient=mix(vec3(.18,.23,.31),vec3(.52,.62,.75),h)*(.12+.65*day);
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
void main(){
 vec3 ray=rayAt(vUv);float dist=distanceAt(vUv);
 vec3 scene=texture2D(inputBuffer,vUv).rgb;
 if(dist>900000.){
  // Remove photographed cloud silhouettes from the daylight background.
  float up=pow(clamp(ray.y*.75+.15,0.,1.),.45);
  vec3 horizon=mix(vec3(.55,.68,.79),vec3(.85,.53,.30),golden*.55);
  vec3 sky=mix(horizon,vec3(.065,.20,.43),up);
  float disc=smoothstep(.99988,.99997,dot(ray,sunDir));
  sky+=vec3(1.,.82,.57)*disc*4.;
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
 vec2 cell=vUv/texel-.5,origin=floor(cell),f=fract(cell);
 vec4 sum=vec4(0);float total=0.;
 for(int y=0;y<2;y++)for(int x=0;x<2;x++){
  vec2 uv=(origin+vec2(float(x),float(y))+.5)*texel;
  float sampleDistance=distanceAt(uv);
  float weight=(x==0?1.-f.x:f.x)*(y==0?1.-f.y:f.y);
  weight*=exp(-abs(sampleDistance-dist)/max(2.,dist*.008));
  sum+=texture2D(clouds,uv)*weight;total+=weight;
 }
 // At disocclusions reject low-res samples rather than bleeding clouds over aircraft.
 vec4 c=total>.001?sum/total:vec4(0,0,0,1);
 vec3 result=scene*c.a+c.rgb;
 gl_FragColor=vec4(mix(scene,result,cloudMix),1.);
}`;

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
      steps:{value:48},rangeM:{value:IMMERSIVE.clouds.rangeM},inputBuffer:{value:null},
      clouds:{value:this.target.texture},texel:{value:new Vector2(1,1)},cloudMix:{value:0},
    };
    const material=(fragmentShader)=>new ShaderMaterial({uniforms:this.uniforms,vertexShader:vertex,fragmentShader,depthTest:false,depthWrite:false,toneMapped:false});
    this.marchMaterial=material(march);this.compositeMaterial=material(composite);
    this.fullscreenMaterial=this.compositeMaterial;
    this.stats={active:true,steps:48,width:1,height:1,inside:0,draws:2};
  }
  setDepthTexture(texture){this.uniforms.sceneDepth.value=texture;}
  initialize(renderer){
    // Retain both programs for the entire pass lifetime, including quality steps.
    this.fullscreenMaterial=this.marchMaterial;renderer.compile(this.scene,this.camera);
    this.fullscreenMaterial=this.compositeMaterial;renderer.compile(this.scene,this.camera);
  }
  setSize(width,height){
    this.size.set(width,height);
    const p=IMMERSIVE.profiles[this.tier];
    const w=Math.max(1,Math.ceil(width*p.cloudScale)),h=Math.max(1,Math.ceil(height*p.cloudScale));
    if(this.target.width!==w||this.target.height!==h)this.target.setSize(w,h);
    this.uniforms.texel.value.set(1/w,1/h);Object.assign(this.stats,{width:w,height:h,steps:p.cloudSteps});
  }
  setTier(tier){if(this.tier!==tier){this.tier=tier;this.setSize(this.size.x,this.size.y);}}
  render(renderer,input,output,delta=0){
    const rt=this.runtime,u=this.uniforms,cam=this.flightCamera;
    const paused=useFlyStore.getState().phase==='paused';
    const state=immersiveLighting(rt.sun,rt.weather?.wx),k=mercatorScale(rt.flight?.latDeg||0),b=getBend();
    // Weather wind is true m/s; the density grid uses projected Mercator XZ.
    if(!paused){const dt=Math.min(delta,.1);this.elapsed+=dt;this.driftX+=(rt.weather?.wx?.windX??5)*k*dt;this.driftZ+=(rt.weather?.wx?.windZ??0)*k*dt;}
    u.inverseProjection.value.copy(cam.projectionMatrixInverse);u.cameraWorld.value.copy(cam.matrixWorld);
    u.eye.value.copy(cam.position);u.reverseDepth.value=renderer.capabilities.reversedDepthBuffer?1:0;
    u.metricScale.value=k;u.bendCenter.value.set(b.cx,b.cz);u.bendK.value=b.k;
    // Use a fixed geographic grid, not a ground-relative cloud base that follows mountains.
    const ox=rt.origin?.anchor.x||0,oz=rt.origin?.anchor.z||0;
    u.phase.value.set(cloudPhase(ox-this.driftX),0,cloudPhase(oz-this.driftZ));
    const sin=Math.min(1,Math.max(-1,rt.sun?.sinEl??1)),az=rt.sun?.az||0,c=Math.sqrt(1-sin*sin);
    u.sunDir.value.set(-Math.sin(az)*c,sin,Math.cos(az)*c);
    for(const key of ['day','golden','night'])u[key].value=state[key];
    u.base.value=state.cloudBase;u.thickness.value=state.cloudThickness;u.coverage.value=state.cloudCoverage;
    u.steps.value=IMMERSIVE.profiles[this.tier].cloudSteps;
    this.mix+= (1-this.mix)*(1-Math.exp(-Math.min(delta,.1)*1.5));u.cloudMix.value=this.mix;
    this.stats.inside=Math.min(1,cloudDensity(cam.position.x+ox-this.driftX,cam.position.y,cam.position.z+oz-this.driftZ,{base:state.cloudBase,thickness:state.cloudThickness,coverage:state.cloudCoverage})*2);
    rt.immersiveClouds=this.stats;
    this.fullscreenMaterial=this.marchMaterial;renderer.setRenderTarget(this.target);renderer.render(this.scene,this.camera);
    u.inputBuffer.value=input.texture;
    this.fullscreenMaterial=this.compositeMaterial;renderer.setRenderTarget(this.renderToScreen?null:output);renderer.render(this.scene,this.camera);
  }
  // Pass owns an orthographic fullscreen camera. Keep the flight camera separately.
  dispose(){this.target.dispose();this.noise.dispose();this.marchMaterial.dispose();this.compositeMaterial.dispose();delete this.runtime.immersiveClouds;}
}
