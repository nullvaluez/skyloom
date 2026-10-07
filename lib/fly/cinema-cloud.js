// Rounded banks share a 128-km periodic field on CPU and GPU. Integer hashes
// remain below float32's exact-integer limit, avoiding sin-hash precision drift.
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const mod=(x,n)=>((x%n)+n)%n;
function hash(x,z,seed){const n=mod(mod(x,16)*73+mod(z,16)*151+seed*47,251);return mod(n*n*13+n*37+101,251)/251;}
/** Exact periodic bank parameters. RGBA32F/nearest retains the original
 * float32 hashes; 4 KiB replaces 27 modular hashes at EVERY density sample,
 * including the three light samples and the full-resolution shadow lookup. */
export function cinemaBankData(){
 const data=new Float32Array(16*16*4);
 for(let z=0;z<16;z++)for(let x=0;x<16;x++)for(let seed=1;seed<=3;seed++)data[(x+16*z)*4+seed-1]=hash(x,z,seed);
 return data;
}
function bank(x,z,h,cx,cz,coverage){
 const a=hash(cx,cz,1),b=hash(cx,cz,2),c=hash(cx,cz,3);
 const presence=1-smooth(coverage-.08,coverage+.08,a);if(!presence)return 0;
 const px=x-(cx+.25+.5*b)*8-(h-.25)*(b-.5)*2,pz=z-(cz+.25+.5*c)*8-(h-.25)*(c-.5)*2,width=(2.2+coverage*1.35)*(.72+.65*c);
 // This is only a broad coverage mask. The cellular volume supplies billows;
 // there are no repeated crown/shoulder primitives in the visible density.
 return Math.max(0,1-Math.hypot(px/width,(h-(.30+.17*c))/(.22+.26*b),pz/(width*(.6+.65*b)))+.25)*presence;
}
// relative (CLOUD_CALM): the noise rides the base, the GPU text's twin.
export function cinemaCloudDensity(x,y,z,{base=1500,thickness=2300,coverage=.5},noise,relative=false){
 const h=(y-base)/thickness;if(h<=0||h>=1)return 0;
 const qx=x/1024,qy=(relative?y-base:y)/1024,qz=z/1024,cx=Math.floor(qx/8),cz=Math.floor(qz/8);
 let shape=0;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)shape=Math.max(shape,bank(qx,qz,h,cx+dx,cz+dz,coverage));
 if(shape<=0)return 0;
 const body=noise(qx*1.5,qy*1.5,qz*1.5,0),edge=noise(qx*4,qy*4,qz*4,1);
 return Math.max(0,body-Math.max(0,1-shape)*.52-.19-(1-edge)*.18)*4*smooth(0,.08,h)*(1-smooth(.86,1,h));
}
export const CINEMA_CLOUD_GLSL=`
uniform highp sampler3D cinemaNoiseVolume;
uniform float cinemaNoiseReady;
#ifdef CINEMA_BANK_LUT
uniform highp sampler2D cinemaBanks;
#endif
float cinemaHash(vec2 p,float seed){
 p=mod(p,16.);float n=mod(p.x*73.+p.y*151.+seed*47.,251.);
 return mod(n*n*13.+n*37.+101.,251.)/251.;
}
float cinemaBank(vec2 x,float h,vec2 cell){
#ifdef CINEMA_BANK_LUT
 vec3 bank=textureLod(cinemaBanks,(mod(cell,16.)+.5)/16.,0.).rgb;
 float a=bank.x,b=bank.y,c=bank.z;
#else
 float a=cinemaHash(cell,1.),b=cinemaHash(cell,2.),c=cinemaHash(cell,3.);
#endif
 float presence=1.-smoothstep(coverage-.08,coverage+.08,a);if(presence<=0.)return 0.;
 vec2 p=x-(cell+.25+.5*vec2(b,c))*8.-(h-.25)*(vec2(b,c)-.5)*2.;float width=(2.2+coverage*1.35)*(.72+.65*c);
 return max(0.,1.-length(vec3(p.x/width,(h-(.30+.17*c))/(.22+.26*b),p.y/(width*(.6+.65*b))))+.25)*presence;
}
float cinemaDensity(vec3 q,float footprint,float h){
 vec2 cell=floor(q.xz/8.);float shape=0.;
 for(int z=-1;z<=1;z++)for(int x=-1;x<=1;x++)shape=max(shape,cinemaBank(q.xz,h,cell+vec2(float(x),float(z))));
 if(shape<=0.)return 0.;
 // Both density channels need a footprint, not just erosion. Point-sampling
 // the body at 16–32 steps aliases its cellular detail into crawling texture.
 // Explicit LOD is defined even inside this divergent ray march. At footprint
 // zero the CPU passage sampler still reads the exact same full-detail field.
 // Keep the bank's large billows even at the last effects rung. Averaging
 // beyond two levels erases them and reveals the ellipsoidal coverage mask.
 float bodyLod=clamp(log2(max(1.,footprint*1.5/128.)),0.,2.);
 float edgeLod=max(0.,log2(max(1.,footprint*4./128.)));
 float body=textureLod(cinemaNoiseVolume,q*1.5/8.,bodyLod).r;
 float erosion=textureLod(cinemaNoiseVolume,q*4./8.,edgeLod).g;
 float d=max(0.,body-max(0.,1.-shape)*.52-.19-(1.-erosion)*.18)*4.;
 return d*smoothstep(0.,.08,h)*(1.-smoothstep(.86,1.,h))*cinemaNoiseReady;
}
`;
