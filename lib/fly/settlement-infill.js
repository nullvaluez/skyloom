import { buildSceneryClearance,paintSurfacePolygon } from './earth-surface-mask';
import { airportSceneryMask } from './airport-scenery-mask';
import { worldCoverAt } from './world-cover';

/** Conservative roadside candidates. A successfully parsed vector tile plus
 * residential land or observed built-up pixels supplies settlement evidence.
 * Every candidate's entire clearance disc must avoid mapped occupancy, water,
 * crops, forests and airfields. Output is inferred scenery, never a real address. */
export function buildRoadsideInfill(vt,cover,trueSpan,max=384,surfaceMask=null,mixedLots=false,buildingMask=null){
  const roads=vt.layers.transportation;if(!roads)return[];
  // Skip rasterizing four clearance grids on tiles containing only highways,
  // rail, or tracks. Retain features in source order for deterministic output.
  const streets=[];
  for(let i=0;i<roads.length;i++){
    const f=roads.feature(i);
    if(f.type===2&&infillRoadClasses.has(f.properties.class)&&!f.properties.brunnel)streets.push(f);
  }
  if(!streets.length)return[];
  const n=256,mask=surfaceMask??buildSceneryClearance(vt),residential=new Uint8Array(n*n),airports=airportSceneryMask(vt,n,trueSpan,true),occupied=new Uint8Array(n*n);
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
  for(const f of streets){
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
  if (mixedLots && result.length < max && (!vt.layers.building?.length || buildingMask) &&
      cover?.includes(50) && cover.includes(30)) {
    // Preserve every earlier placement. Other mapped land uses (a school
    // yard, industrial site, field, etc.) do not supply residential evidence.
    if (land) for (let i=0;i<land.length;i++) {
      const f=land.feature(i);
      if (f.type===3 && f.properties.class!=='residential') {
        paintSurfacePolygon(residential,n,f.loadGeometry(),land.extent,1);
      }
    }
    addMixedLots(streets,roads.extent,cover,trueSpan,mask,buildingMask,airports,residential,occupied,result,max);
  }
  return result;
}

// In unmapped subdivisions a house and lawn share the old clearance square:
// the center may be demonstrably built while its neighbors are grass. Look
// only beside local streets; center on a classified pixel rather than a
// nominal setback. This is an inferred home, not a surveyed footprint.
function addMixedLots(streets, extent, cover, span, mask, buildingMask, airports, mappedUse, occupied, result, max) {
  const n=256, cellM=span/n, clearance=Math.max(1,Math.ceil(12/cellM));
  const separation=Math.ceil(18/cellM), candidates=new Map();
  const patchState=new Uint8Array(cover.length), queue=[];
  const buildingScale=(buildingMask?.n ?? 0)/n;
  // Broad pavement and long ribbons can have a locally thick corner. Follow
  // connected built cells until the entire small patch is known or one
  // physical bound is exceeded. A later hit on a rejected piece can stop
  // immediately. This also avoids inferring rows of houses along large lots.
  function compactPatch(center) {
    if (patchState[center]) return patchState[center]===1;
    queue.length=0;
    queue.push(center);
    patchState[center]=3;
    let x0=center%n,x1=x0,y0=center>>8,y1=y0,ok=true;
    for(let i=0;i<queue.length && ok;i++) {
      const p=queue[i], x=p%n, y=p>>8;
      x0=Math.min(x0,x); x1=Math.max(x1,x);
      y0=Math.min(y0,y); y1=Math.max(y1,y);
      if (x===0 || x===255 || y===0 || y===255 ||
          queue.length*cellM*cellM>1600 || (Math.max(x1-x0,y1-y0)+1)*cellM>65) { ok=false; break; }
      for(const q of [p-1,p+1,p-n,p+n]) {
        if (cover[q]!==50) continue;
        if (patchState[q]===2) { ok=false; break; }
        if (patchState[q]===0) { patchState[q]=3; queue.push(q); }
      }
    }
    const width=x1-x0+1,height=y1-y0+1;
    ok=ok && Math.max(width,height)<=3*Math.min(width,height) && queue.length>=0.30*width*height;
    for(const p of queue) patchState[p]=ok?1:2;
    return ok;
  }
  function evidence(x,y) {
    if (x<clearance || y<clearance || x+clearance>=n || y+clearance>=n) return 0;
    const center=y*n+x;
    if (cover[center]!==50) return 0;
    // A one-pixel line (road paint/pavement) is insufficient. The built
    // cluster must extend from the center along both map axes.
    if ((cover[center-1]!==50 && cover[center+1]!==50) ||
        (cover[center-n]!==50 && cover[center+n]!==50)) return 0;
    let built=0, grass=0, core=0;
    for(let dy=-clearance;dy<=clearance;dy++) for(let dx=-clearance;dx<=clearance;dx++) {
      const i=center+dy*n+dx;
      if (mask.exclusion[i] || mask.classes[i] || airports?.[i] || mappedUse[i] || occupied[i]) return 0;
      // The surface raster tests pixel centers. The worker's padded footprint
      // boxes also cover tiny mapped sheds that fit between those centers.
      if (buildingMask && buildingMask.mask[Math.floor((y+dy)*buildingScale)*buildingMask.n+
          Math.floor((x+dx)*buildingScale)]) return 0;
      if (cover[i]===50) {
        built++;
        if(Math.abs(dx)<=1 && Math.abs(dy)<=1) core++;
      } else if (cover[i]===30) grass++;
      else return 0; // water, tree, cropland, wetland, unknown, etc.
    }
    return built>=4 && grass>=Math.ceil((2*clearance+1)**2*0.25) && compactPatch(center) ? core : 0;
  }
  for(const street of streets) {
    if (!mixedLotStreets.has(street.properties.class)) continue;
    for(const line of street.loadGeometry()) for(let j=1;j<line.length;j++) {
      const a=line[j-1], b=line[j], dx=(b.x-a.x)*n/extent, dy=(b.y-a.y)*n/extent;
      const len=Math.hypot(dx,dy);
      if(!len) continue;
      const ax=a.x*n/extent, ay=a.y*n/extent, nx=-dy/len, ny=dx/len;
      const steps=Math.ceil(len);
      for(let k=0;k<=steps;k++) for(const side of [-1,1]) {
        const t=k/steps;
        for(let setback=20;setback<=40+cellM/2;setback+=cellM) {
          const x=Math.floor(ax+dx*t+nx*side*setback/cellM);
          const y=Math.floor(ay+dy*t+ny*side*setback/cellM);
          if(x<0 || x>=n || y<0 || y>=n || cover[y*n+x]!==50) continue;
          const along=Math.max(0,Math.min(1,((x+.5-ax)*dx+(y+.5-ay)*dy)/(len*len)));
          const distance=cellM*Math.hypot(x+.5-ax-dx*along,y+.5-ay-dy*along);
          if(distance<20 || distance>40) continue;
          const key=y*n+x, prior=candidates.get(key);
          if(prior===null || (prior && prior.distance<=distance)) continue;
          const core=prior?.core ?? evidence(x,y);
          candidates.set(key, core ? {x,y,core,distance,yaw:-Math.atan2(dy,dx)} : null);
        }
      }
    }
  }
  const ordered=[...candidates.values()].filter(Boolean).sort((a,b)=>
    b.core-a.core || hash((a.x+.5)/n,(a.y+.5)/n)-hash((b.x+.5)/n,(b.y+.5)/n));
  for(const p of ordered) {
    if(!evidence(p.x,p.y)) continue;
    result.push({x:(p.x+.5)/n,y:(p.y+.5)/n,yaw:p.yaw});
    if(result.length>=max) break;
    for(let y=Math.max(0,p.y-separation);y<=Math.min(n-1,p.y+separation);y++) {
      occupied.fill(1,y*n+Math.max(0,p.x-separation),y*n+Math.min(n,p.x+separation+1));
    }
  }
}
function hash(x,y){return (Math.imul(Math.round(x*65536),374761393)^Math.imul(Math.round(y*65536),668265263))>>>0;}
const infillRoadClasses=new Set(['minor','residential','living_street','tertiary','unclassified']);
const mixedLotStreets=new Set(['minor','residential','living_street']);
