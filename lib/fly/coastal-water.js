import { DataTexture, LinearFilter, Matrix4, RGBAFormat, UnsignedByteType, Vector2 } from 'three';
import { CINEMA_GLSL } from './cinema-sky.js';

const empty = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType);
empty.minFilter = empty.magFilter = LinearFilter;
empty.needsUpdate = true;
export const COASTAL_WATER_UNIFORMS = {
  uCoastReflection: { value: empty },
  uCoastMatrix: { value: new Matrix4() },
  uCoastReady: { value: 0 },
  uCoastTexel: { value: new Vector2(1 / 768, 1 / 512) },
};
export function clearCoastalReflection() {
  COASTAL_WATER_UNIFORMS.uCoastReady.value = 0;
  COASTAL_WATER_UNIFORMS.uCoastReflection.value = empty;
}

// Periodic gradient fields share the transported 4096-m material frame. Each
// octave drifts independently; there are no coherent sine-wave fronts crossing
// the whole sea. Analytic gradients avoid normal-map texture/sampler overhead.
export const COASTAL_WATER_GLSL = `
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
`;
