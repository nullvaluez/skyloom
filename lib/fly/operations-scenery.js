import { OPERATIONS_AIRPORTS, nearbyOperationsAirports, airportLocal, airportPavements, findAirportSurface, nearestOperationsAirport } from './operations-airports.js';
import { projectAirportPoint } from './operations-airports.js';
import { airportLandmark } from './airport-landmarks.js';
let landmarksEnabled=false;
const landmarkBounds=new WeakMap();
export function setAirportLandmarks(value){landmarksEnabled=value;}
function exclusions(airport){
  const pavement=airportPavements(airport);
  const spec=landmarksEnabled&&airportLandmark(airport);if(!spec)return pavement;
  if(landmarkBounds.has(airport))return landmarkBounds.get(airport);
  const bounds=[];
  const terminal=projectAirportPoint(...spec.terminal),tower=projectAirportPoint(...spec.tower);
  const k=1/Math.cos(spec.terminal[1]*Math.PI/180),angle=spec.heading*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  for(const [x,z,w,d]of spec.wings){
    const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sz])=>{const dx=x+sx*(w/2+3),dz=z+sz*(d/2+3);return airportLocal(airport,terminal.x+(dx*c-dz*s)*k,terminal.z+(dx*s+dz*c)*k);});
    bounds.push({s0:Math.min(...corners.map(p=>p.along)),s1:Math.max(...corners.map(p=>p.along)),c0:Math.min(...corners.map(p=>p.cross)),c1:Math.max(...corners.map(p=>p.cross))});
  }
  const local=airportLocal(airport,tower.x,tower.z);bounds.push({s0:local.along-20,s1:local.along+20,c0:local.cross-20,c1:local.cross+20});
  const value=[...pavement,...bounds];landmarkBounds.set(airport,value);return value;
}
const inside=(p,r)=>p.along>=r.s0&&p.along<=r.s1&&p.cross>=r.c0&&p.cross<=r.c1;
function segmentIntersects(a,b,r){
  let enter=0,leave=1;
  for(const [start,delta,min,max] of [[a.along,b.along-a.along,r.s0,r.s1],[a.cross,b.cross-a.cross,r.c0,r.c1]]){
    if(Math.abs(delta)<1e-10){if(start<min||start>max)return false;continue;}
    const t0=(min-start)/delta,t1=(max-start)/delta;
    enter=Math.max(enter,Math.min(t0,t1));leave=Math.min(leave,Math.max(t0,t1));
    if(enter>leave)return false;
  }
  return true;
}
function containsPoint(points,along,cross){
  let hit=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if((a.cross>cross)!==(b.cross>cross)&&along<(b.along-a.along)*(cross-a.cross)/(b.cross-a.cross)+a.along)hit=!hit;
  }
  return hit;
}
export function operationsFootprint(ring, frame, extent) {
  if(!ring?.length)return false;
  if(nearestOperationsAirport(frame.cx,frame.cz).distance>frame.tileSpan+(landmarksEnabled?4000:700))return false;
  const scale=frame.tileSpan/extent;
  // Vertex/centroid probes miss a long building crossing the runway when all
  // sampled points are outside. Test edges and containment against the same
  // finite rectangles used by pavement rendering and wheel contact.
  for(const airport of nearbyOperationsAirports(frame.cx,frame.cz,frame.tileSpan+(landmarksEnabled?4000:700))){
    const points=ring.map(p=>airportLocal(airport,frame.mercX0+p.x*scale,-frame.mercYTop+p.y*scale));
    let minS=Infinity,maxS=-Infinity,minC=Infinity,maxC=-Infinity;
    for(const p of points){minS=Math.min(minS,p.along);maxS=Math.max(maxS,p.along);minC=Math.min(minC,p.cross);maxC=Math.max(maxC,p.cross);}
    for(const pavement of exclusions(airport)){
      const r={s0:pavement.s0-15,s1:pavement.s1+15,c0:pavement.c0-15,c1:pavement.c1+15};
      if(maxS<r.s0||minS>r.s1||maxC<r.c0||minC>r.c1)continue;
      if(points.some(p=>inside(p,r)))return true;
      for(let i=0,j=points.length-1;i<points.length;j=i++)if(segmentIntersects(points[j],points[i],r))return true;
      if(containsPoint(points,r.s0,r.c0))return true;
    }
  }
  return false;
}
// --- Observation lounge: the airport set's footprint (MAIN THREAD) -----------
//
// While a lounge is open, the procedural airport set (lib/fly/airport-set/*)
// stands where the satellite world may already have streamed OSM buildings —
// often the real terminal itself. Those buildings are retired IN PLACE for
// the session: every vertex of a building whose footprint anchor
// (`aBendAnchor`, the per-building bend anchor the worker bakes) falls inside
// the set's footprint has its x/z snapped onto that anchor, leaving zero-area
// triangles that neither draw nor cast shadows. The engine's heal-in-place
// path only adds Y deltas, so the retirement survives DEM refinement;
// restore() puts the original x/z back on leave.
//
// Why not in the worker request: the vector-tile worker only learns a
// boolean (`airportLandmarks`), and observation is a main-thread state. Doing
// it here also catches chunks that were resident BEFORE the lounge opened
// (no airportContentEpoch rebuild of the whole building ring).

/**
 * @param site  resolveLoungeSite() result (x, z, heading, k)
 * @param rects room-local rectangles [{x0, x1, z0, z1}] (planAirportSet().footprint)
 */
export function airportSetRetirement(site,rects){
  const c=Math.cos(site.heading),s=Math.sin(site.heading),k=site.k;
  const local=(x,z)=>{const ux=(x-site.x)/k,uz=(z-site.z)/k;return [ux*c-uz*s,ux*s+uz*c];};
  const inside=(x,z)=>{const [lx,lz]=local(x,z);for(const r of rects)if(lx>=r.x0&&lx<=r.x1&&lz>=r.z0&&lz<=r.z1)return true;return false;};
  // Scene-space bounding circle of all rectangles: a cheap chunk reject.
  let reach=0;for(const r of rects)for(const [x,z] of [[r.x0,r.z0],[r.x1,r.z0],[r.x0,r.z1],[r.x1,r.z1]])reach=Math.max(reach,Math.hypot(x,z)*k);
  const touched=new Map(); // geometry -> { idx, xz } | null (looked at, nothing inside)
  let retired=0;
  return {
    get retired(){return retired;},
    /** Retire buildings in resident ready chunks not seen yet. Returns vertices collapsed. */
    sweep(engine){
      if(!engine?.chunks)return 0;
      let collapsed=0;
      for(const chunk of engine.chunks.values()){
        const mesh=chunk?.mesh,g=mesh?.geometry;
        if(chunk.state!=='ready'||!g||touched.has(g))continue;
        const pos=g.getAttribute('position'),anchor=g.getAttribute('aBendAnchor');
        if(!pos||!anchor){touched.set(g,null);continue;}
        if(!g.boundingSphere)g.computeBoundingSphere();
        const bs=g.boundingSphere,cx=mesh.position.x+bs.center.x,cz=mesh.position.z+bs.center.z;
        if(Math.hypot(cx-site.x,cz-site.z)>reach+bs.radius){touched.set(g,null);continue;}
        const p=pos.array,a=anchor.array,idx=[],xz=[];
        let lastKey=NaN,lastIn=false;
        for(let v=0;v<pos.count;v++){
          const ax=a[v*2],az=a[v*2+1];
          // Vertices of one building are contiguous and share its anchor.
          const key=ax*1e5+az;
          if(key!==lastKey){lastKey=key;lastIn=inside(mesh.position.x+ax,mesh.position.z+az);}
          if(!lastIn)continue;
          idx.push(v);xz.push(p[v*3],p[v*3+2]);
          p[v*3]=ax;p[v*3+2]=az;
        }
        if(!idx.length){touched.set(g,null);continue;}
        touched.set(g,{idx:Uint32Array.from(idx),xz:Float32Array.from(xz)});
        pos.clearUpdateRanges?.();pos.needsUpdate=true;
        collapsed+=idx.length;retired+=idx.length;
      }
      return collapsed;
    },
    /** Put every retired building back (safe on geometries already evicted). */
    restore(){
      for(const [g,saved] of touched){
        if(!saved)continue;
        const pos=g.getAttribute('position');if(!pos)continue;
        const p=pos.array;
        for(let i=0;i<saved.idx.length;i++){const v=saved.idx[i];p[v*3]=saved.xz[i*2];p[v*3+2]=saved.xz[i*2+1];}
        pos.clearUpdateRanges?.();pos.needsUpdate=true;
      }
      touched.clear();retired=0;
    },
  };
}

export function addOperationsMask(mask,size,frame) {
  if(!frame||nearestOperationsAirport(frame.cx,frame.cz).distance>frame.tileSpan+(landmarksEnabled?4000:700))return mask;
  mask??=new Uint8Array(size*size);
  const cell=frame.tileSpan/size;
  const bounds=landmarksEnabled?OPERATIONS_AIRPORTS.map(a=>({a,bounds:exclusions(a)})):null;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const px=frame.mercX0+(x+.5)*cell,pz=-frame.mercYTop+(y+.5)*cell;
    if(findAirportSurface(px,pz,15)||bounds?.some(({a,bounds})=>{const local=airportLocal(a,px,pz);return bounds.some(r=>inside(local,r));}))mask[y*size+x]=255;
  }
  return mask;
}
