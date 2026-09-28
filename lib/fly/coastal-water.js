import { DataTexture, LinearFilter, Matrix4, RGBAFormat, UnsignedByteType, Vector2 } from 'three';

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

// Every spatial frequency is an integer over the earth material's transported
// 4096-m phase. Derivative filtering retires waves before they shimmer aloft.
export const COASTAL_WATER_GLSL = `
uniform sampler2D uCoastReflection;
uniform mat4 uCoastMatrix;
uniform float uCoastReady;
uniform vec2 uCoastTexel;
float seaWave(vec2 p,vec2 frequency,float time){
 float phase=dot(p,frequency)+time+1.4*sin(dot(p,floor(frequency.yx*.43))+time*.09);
 return sin(phase)*(1.-smoothstep(.7,3.,fwidth(phase)));
}
vec3 coastalWater(vec3 world,vec2 metres,vec3 eye,vec3 sun,vec3 moon,float day,float night,float overcast,float time){
 vec2 p=metres*.00153398078788564;
 float broad=seaWave(p,vec2(37.,79.),time*.23);
 float crossWave=seaWave(p,vec2(-127.,53.),-time*.41);
 float middle=seaWave(p,vec2(353.,197.),time*.67);
 float fine=seaWave(p,vec2(-881.,617.),-time*1.11);
 vec2 slope=vec2(broad*.043+middle*.038+fine*.022,crossWave*.036+middle*.025-fine*.018);
 vec3 n=normalize(vec3(slope.x,1.,slope.y));
 vec3 ray=reflect(-eye,n);
 float fresnel=.035+.965*pow(1.-max(0.,dot(n,eye)),4.5);
 float skyHeight=smoothstep(-.04,.9,ray.y);
 vec3 horizon=mix(vec3(.028,.061,.115),vec3(.34,.51,.64),day);
 vec3 zenith=mix(vec3(.007,.020,.055),vec3(.045,.17,.31),day);
 vec3 sky=mix(horizon,zenith,skyHeight);
 // A broad sky reflection varies with the reflected direction, rather than
 // one constant blue. It complements the separately captured real waterfront.
 float cloud=sin(ray.x*13.+ray.z*7.+time*.01)*sin(ray.z*17.-ray.x*5.);
 cloud=smoothstep(.10,.65,cloud)*smoothstep(.05,.35,ray.y)*(1.-smoothstep(.5,.9,ray.y));
 sky=mix(sky,mix(vec3(.065,.095,.15),vec3(.63,.68,.68),day),cloud*(.13+overcast*.36));
 sky=mix(sky,mix(vec3(.033,.053,.079),vec3(.26,.31,.34),day),overcast*.5);
 vec3 body=mix(vec3(.004,.018,.034),vec3(.010,.078,.091),day);
 body*=.94+.035*broad+.025*crossWave;
 vec3 water=mix(body,sky,.19+fresnel*.76);
 float roughSun=pow(max(0.,dot(ray,sun)),160.);
 float softSun=pow(max(0.,dot(ray,sun)),18.);
 float moonPath=pow(max(0.,dot(ray,moon)),85.);
 float glitter=.58+.42*middle;
 water+=vec3(1.,.79,.48)*(roughSun*2.8+softSun*.18)*day*(1.-overcast)*glitter;
 water+=vec3(.38,.61,.95)*moonPath*night*(1.-overcast)*1.55*glitter;
 if(uCoastReady>.5 && abs(world.y)<5.){
   vec4 projected=uCoastMatrix*vec4(world.x,0.,world.z,1.);
   vec2 uv=projected.xy/max(.001,projected.w);
   vec2 distortion=slope*vec2(.014,.030);
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
