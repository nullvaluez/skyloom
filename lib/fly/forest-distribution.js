import { worldHash } from './living-earth.js';

/** Reposition stands only inside the UNION of accepted forest cells. These
 * cells already exclude roads, water, buildings and airports. Never use a
 * broad woodland polygon as permission to scatter through its clearings.
 * Source identities and instance count stay stable; no camera/rebase inputs. */
export function distributeForest(mask, tileX, tileY) {
  const {size,forest:source}=mask;
  if(!size||!source?.length)return source;
  const occupied=new Uint8Array(size*size),out=new Float32Array(source);
  for(let i=0;i<source.length;i+=3){
    const cx=source[i]*size,cy=source[i+1]*size,r=source[i+2]*size/2;
    for(let y=Math.round(cy-r);y<Math.round(cy+r);y++)
      occupied.fill(1,y*size+Math.round(cx-r),y*size+Math.round(cx+r));
  }
  // Geometry has a rotation-independent radius below .48 of its width.
  // A full bounding square is conservative for every yaw and both crown LODs.
  const fits=(x,y,width)=>{
    const r=width*.49,loX=Math.floor(x-r),hiX=Math.floor(x+r),loY=Math.floor(y-r),hiY=Math.floor(y+r);
    if(loX<0||loY<0||hiX>=size||hiY>=size)return false;
    for(let py=loY;py<=hiY;py++)for(let px=loX;px<=hiX;px++)if(!occupied[py*size+px])return false;
    return true;
  };
  for(let i=0;i<source.length;i+=3){
    const cx=source[i]*size,cy=source[i+1]*size,w=source[i+2]*size;
    const wx=tileX*size+Math.round(cx),wy=tileY*size+Math.round(cy);
    for(let attempt=0;attempt<12;attempt++){
      const salt=attempt*193;
      const x=cx+(worldHash(wx,wy,113+salt)-.5)*w*.94;
      const y=cy+(worldHash(wx,wy,947+salt)-.5)*w*.94;
      const width=w*(.78+worldHash(wx,wy,263+salt)*.42);
      if(!fits(x,y,width))continue;
      out[i]=x/size;out[i+1]=y/size;out[i+2]=width/size;break;
    }
  }
  return out;
}
