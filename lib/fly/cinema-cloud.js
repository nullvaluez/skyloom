// Rounded banks share a 128-km periodic field on CPU and GPU. Integer hashes
// remain below float32's exact-integer limit, avoiding sin-hash precision drift.
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const mod=(x,n)=>((x%n)+n)%n;
function hash(x,z,seed){const n=mod(mod(x,16)*73+mod(z,16)*151+seed*47,251);return mod(n*n*13+n*37+101,251)/251;}
function bank(x,z,h,cx,cz,coverage){
 const a=hash(cx,cz,1),b=hash(cx,cz,2),c=hash(cx,cz,3);
 const presence=1-smooth(coverage-.08,coverage+.08,a);if(!presence)return 0;
 const px=x-(cx+.25+.5*b)*8,pz=z-(cz+.25+.5*c)*8,width=(2.5+coverage*1.2)*(.8+.5*c);
 // This is only a broad coverage mask. The cellular volume supplies billows;
 // there are no repeated crown/shoulder primitives in the visible density.
 return Math.max(0,1-Math.hypot(px/width,(h-.36)/(.28+.22*b),pz/(width*(.65+.55*b)))+.25)*presence;
}
export function cinemaCloudDensity(x,y,z,{base=1500,thickness=2300,coverage=.5},noise){
 const h=(y-base)/thickness;if(h<=0||h>=1)return 0;
 const qx=x/1024,qy=y/1024,qz=z/1024,cx=Math.floor(qx/8),cz=Math.floor(qz/8);
 let shape=0;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)shape=Math.max(shape,bank(qx,qz,h,cx+dx,cz+dz,coverage));
 if(shape<=0)return 0;
 const body=noise(qx,qy,qz,0),edge=noise(qx,qy,qz,1);
 return Math.max(0,body-Math.max(0,1-shape)*.60-.16-(1-edge)*.12)*3*smooth(0,.065,h)*(1-smooth(.82,1,h));
}
export const CINEMA_CLOUD_GLSL=`
uniform highp sampler3D cinemaNoiseVolume;
uniform float cinemaNoiseReady;
float cinemaHash(vec2 p,float seed){
 p=mod(p,16.);float n=mod(p.x*73.+p.y*151.+seed*47.,251.);
 return mod(n*n*13.+n*37.+101.,251.)/251.;
}
float cinemaBank(vec2 x,float h,vec2 cell){
 float a=cinemaHash(cell,1.),b=cinemaHash(cell,2.),c=cinemaHash(cell,3.);
 float presence=1.-smoothstep(coverage-.08,coverage+.08,a);if(presence<=0.)return 0.;
 vec2 p=x-(cell+.25+.5*vec2(b,c))*8.;float width=(2.5+coverage*1.2)*(.8+.5*c);
 return max(0.,1.-length(vec3(p.x/width,(h-.36)/(.28+.22*b),p.y/(width*(.65+.55*b))))+.25)*presence;
}
float cinemaDensity(vec3 q,float footprint,float h){
 vec2 cell=floor(q.xz/8.);float shape=0.;
 for(int z=-1;z<=1;z++)for(int x=-1;x<=1;x++)shape=max(shape,cinemaBank(q.xz,h,cell+vec2(float(x),float(z))));
 if(shape<=0.)return 0.;
 // The march terminates independently per pixel. Explicit LOD avoids undefined
 // implicit derivatives inside that divergent loop; this volume has one level.
 vec2 billow=textureLod(cinemaNoiseVolume,q/8.,0.).rg;
 float d=max(0.,billow.r-max(0.,1.-shape)*.60-.16-(1.-billow.g)*.12)*3.;
 return d*smoothstep(0.,.065,h)*(1.-smoothstep(.82,1.,h))*cinemaNoiseReady;
}
`;
