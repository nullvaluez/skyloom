import { OPERATIONS_AIRPORTS, airportLocal, airportPavements, findAirportSurface, nearestOperationsAirport } from './operations-airports.js';
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
  if(nearestOperationsAirport(frame.cx,frame.cz).distance>frame.tileSpan+700)return false;
  const scale=frame.tileSpan/extent;
  // Vertex/centroid probes miss a long building crossing the runway when all
  // sampled points are outside. Test edges and containment against the same
  // finite rectangles used by pavement rendering and wheel contact.
  for(const airport of OPERATIONS_AIRPORTS){
    const points=ring.map(p=>airportLocal(airport,frame.mercX0+p.x*scale,-frame.mercYTop+p.y*scale));
    let minS=Infinity,maxS=-Infinity,minC=Infinity,maxC=-Infinity;
    for(const p of points){minS=Math.min(minS,p.along);maxS=Math.max(maxS,p.along);minC=Math.min(minC,p.cross);maxC=Math.max(maxC,p.cross);}
    for(const pavement of airportPavements(airport)){
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
  if(!frame||nearestOperationsAirport(frame.cx,frame.cz).distance>frame.tileSpan+700)return mask;
  mask??=new Uint8Array(size*size);
  const cell=frame.tileSpan/size;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)
    if(findAirportSurface(frame.mercX0+(x+.5)*cell,-frame.mercYTop+(y+.5)*cell,15))mask[y*size+x]=255;
  return mask;
}
