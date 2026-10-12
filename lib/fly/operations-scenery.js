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
