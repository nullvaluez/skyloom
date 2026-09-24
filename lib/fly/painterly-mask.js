// Appearance-only inner feather after WorldCover fills the vector mask. Raw
// classes, blend, exclusions and derived scenery remain immutable/reusable.
const natural=new Set([1,2,3,4,5,6,9,14]);
export function painterlyMaskBlend(mask, neighbors={}) {
  const {size,classes,exclusion,blend}=mask,radius=3,width=size+radius*2;
  const ids=new Uint8Array(width*width),distance=new Float32Array(ids.length).fill(radius);
  for(let y=-radius;y<size+radius;y++)for(let x=-radius;x<size+radius;x++){
    const dx=x<0?-1:x>=size?1:0,dy=y<0?-1:y>=size?1:0;
    const source=dx||dy?neighbors[`${dx},${dy}`]:mask;
    // Missing neighbours continue the edge until their real masks arrive.
    // Atlas edges must never become an invented biome boundary.
    const m=source??mask;
    const sx=source?(x+size)%size:Math.max(0,Math.min(size-1,x));
    const sy=source?(y+size)%size:Math.max(0,Math.min(size-1,y));
    const j=sy*size+sx;
    ids[(y+radius)*width+x+radius]=m.exclusion[j]===255?0:m.classes[j];
  }
  const relax=(i,j,step)=>{distance[i]=Math.min(distance[i],ids[i]===ids[j]?distance[j]+step:step*.5);};
  for(let y=0;y<width;y++)for(let x=0;x<width;x++){
    const i=y*width+x;if(x)relax(i,i-1,1);
    if(y){relax(i,i-width,1);if(x)relax(i,i-width-1,Math.SQRT2);if(x+1<width)relax(i,i-width+1,Math.SQRT2);}
  }
  for(let y=width-1;y>=0;y--)for(let x=width-1;x>=0;x--){
    const i=y*width+x;if(x+1<width)relax(i,i+1,1);
    if(y+1<width){relax(i,i+width,1);if(x)relax(i,i+width-1,Math.SQRT2);if(x+1<width)relax(i,i+width+1,Math.SQRT2);}
  }
  const out=new Uint8Array(blend);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const j=y*size+x;if(!natural.has(classes[j])||exclusion[j]===255)continue;
    const t=Math.min(1,distance[(y+radius)*width+x+radius]/radius);
    out[j]=Math.min(blend[j],Math.round(t*t*(3-2*t)*255));
  }
  return out;
}
