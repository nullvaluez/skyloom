import { buildEarthSurfaceMask,paintSurfacePolygon } from './earth-surface-mask';
import { airportSceneryMask } from './airport-scenery-mask';
import { worldCoverAt } from './world-cover';

/** Conservative roadside candidates. A successfully parsed vector tile plus
 * residential land or observed built-up pixels supplies settlement evidence.
 * Every candidate's entire clearance disc must avoid mapped occupancy, water,
 * crops, forests and airfields. Output is inferred scenery, never a real address. */
export function buildRoadsideInfill(vt,cover,trueSpan,max=384){
  const roads=vt.layers.transportation;if(!roads)return[];
  const n=256,mask=buildEarthSurfaceMask(vt,n),residential=new Uint8Array(n*n),airports=airportSceneryMask(vt,n,trueSpan,true),occupied=new Uint8Array(n*n);
  const land=vt.layers.landuse;
  if(land)for(let i=0;i<land.length;i++){const f=land.feature(i);if(f.type===3&&f.properties.class==='residential')paintSurfacePolygon(residential,n,f.loadGeometry(),land.extent,1);}
  const clear=(x,y)=>{
    const cx=Math.floor(x*n),cy=Math.floor(y*n),r=Math.max(1,Math.ceil(12*n/trueSpan));
    if(cx-r<0||cy-r<0||cx+r>=n||cy+r>=n)return false;
    for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      const j=(cy+dy)*n+cx+dx,c=mask.classes[j];
      if(mask.exclusion[j]||airports?.[j]||occupied[j]||c!==0&&c!==7)return false;
      if(!residential[j]&&worldCoverAt(cover,cx+dx+.5,cy+dy+.5,n)!==50)return false;
    }
    return true;
  };
  const candidates=[];
  for(let i=0;i<roads.length;i++){
    const f=roads.feature(i);
    if(f.type!==2||!['minor','residential','living_street','tertiary','unclassified'].includes(f.properties.class)||f.properties.brunnel)continue;
    for(const ring of f.loadGeometry())for(let j=1;j<ring.length;j++){
      const a=ring[j-1],b=ring[j],dx=(b.x-a.x)/roads.extent,dy=(b.y-a.y)/roads.extent,len=Math.hypot(dx,dy);if(len*trueSpan<18)continue;
      const nx=-dy/len,ny=dx/len,step=38/trueSpan,offset=23/trueSpan;
      for(let d=step*.5;d<len;d+=step)for(const side of [-1,1]){
        const x=a.x/roads.extent+dx*d/len+nx*side*offset,y=a.y/roads.extent+dy*d/len+ny*side*offset;
        if(clear(x,y))candidates.push({x,y,yaw:-Math.atan2(dy,dx)});
      }
    }
  }
  // Spatial hash order distributes a bounded pool across a whole tile, rather
  // than letting source feature order consume it in a single subdivision.
  candidates.sort((a,b)=>hash(a.x,a.y)-hash(b.x,b.y));
  const result=[];
  for(const c of candidates){
    if(!clear(c.x,c.y))continue;result.push(c);if(result.length>=max)break;
    const cx=Math.floor(c.x*n),cy=Math.floor(c.y*n),r=Math.ceil(18*n/trueSpan);
    for(let y=Math.max(0,cy-r);y<=Math.min(n-1,cy+r);y++)occupied.fill(1,y*n+Math.max(0,cx-r),y*n+Math.min(n,cx+r+1));
  }
  return result;
}
function hash(x,y){return (Math.imul(Math.round(x*65536),374761393)^Math.imul(Math.round(y*65536),668265263))>>>0;}
