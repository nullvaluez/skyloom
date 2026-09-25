// First-party painted marks, made reproducibly rather than sampled from photos.
// Low-frequency strokes wrap on the torus. Normals describe paint, not gravel.
import { MATERIAL_NAMES } from './cinematic-material-data';
export { MATERIAL_NAMES };
const fract = x => x - Math.floor(x);
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = x => x * x * (3 - 2 * x);
function hash(x, y, seed) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  n = Math.imul(n ^ n >>> 13, 1274126177);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
function wash(u, v, nx, ny, seed) {
  const x=fract(u)*nx,y=fract(v)*ny,ix=Math.floor(x),iy=Math.floor(y),a=smooth(fract(x)),b=smooth(fract(y));
  const h=(dx,dy)=>hash((ix+dx)%nx,(iy+dy)%ny,seed);
  return (h(0,0)*(1-a)+h(1,0)*a)*(1-b)+(h(0,1)*(1-a)+h(1,1)*a)*b;
}
export function paintedSample(layer, u, v) {
  u=fract(u);v=fract(v);
  const broad=wash(u,v,4,4,171+layer),stroke=wash(u+v,v,16,4,310+layer);
  const cross=wash(u,v-u,8,8,618+layer);
  const mineral=layer===5||layer===6, snow=layer===7;
  const value=.715+(broad-.5)*.11+(stroke-.5)*.075+(cross-.5)*.035;
  return { value:clamp(value),height:.5+(stroke-.5)*.045+(cross-.5)*.02,
    rough:snow?.84:layer===3?.86:.94, warmth:mineral?.014:snow?-.007:.004 };
}
export function buildPainterlyArrays(size=256) {
  const color=new Uint8Array(size*size*8*4),detail=new Uint8Array(color.length);
  for(let layer=0;layer<8;layer++){
    const samples=Array.from({length:size*size},(_,i)=>paintedSample(layer,(i%size+.5)/size,(Math.floor(i/size)+.5)/size));
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const s=samples[y*size+x],i=((layer*size+y)*size+x)*4;
      const dx=(samples[y*size+(x+1)%size].height-samples[y*size+(x+size-1)%size].height)*size*.01;
      const dy=(samples[((y+1)%size)*size+x].height-samples[((y+size-1)%size)*size+x].height)*size*.01;
      const length=Math.hypot(dx,dy,1);
      color.set([s.value+s.warmth,s.value,s.value-s.warmth,s.rough].map(v=>Math.round(clamp(v)*255)),i);
      detail.set([Math.round((.5-dx/length*.5)*255),Math.round((.5-dy/length*.5)*255),Math.round(s.height*255),255],i);
    }
  }
  return {color,detail,size,layers:8};
}
