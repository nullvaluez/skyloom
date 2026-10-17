// Final rear-scenery admission. Room ranking stays separate: a good skyline
// room must not move merely because the generated rear apron does not fit.
import { AIRFIELD, SEAT } from './observation-config.js';
import { STAND_CLASS } from './airport-layout.js';
import { planAirportSet } from './airport-set/plan.js';
import { airportFrame, airportPoint } from './operations-airports.js';

const inRing = (x,z,r) => { let hit=false; for(let i=0,j=r.length-2;i<r.length;j=i,i+=2) if((r[i+1]>z)!==(r[j+1]>z)&&x<(r[j]-r[i])*(z-r[i+1])/(r[j+1]-r[i+1])+r[i]) hit=!hit; return hit; };
const inPiece = (x,z,p) => x>=p.x0&&x<=p.x1&&z>=p.z0&&z<=p.z1&&inRing(x,z,p.rings[0])&&!p.rings.slice(1).some(r=>inRing(x,z,r));
const hitsRect = (ax,az,bx,bz,r) => { let lo=0,hi=1; for(const [a,d,min,max] of [[ax,bx-ax,r.x0,r.x1],[az,bz-az,r.z0,r.z1]]) { if(Math.abs(d)<1e-9) { if(a<min||a>max)return false; } else { const p=(min-a)/d,q=(max-a)/d;lo=Math.max(lo,Math.min(p,q));hi=Math.min(hi,Math.max(p,q));if(lo>hi)return false; } } return true; };
const overlap = (a,b) => a.x0<=b.x1&&a.x1>=b.x0&&a.z0<=b.z1&&a.z1>=b.z0;
const expand = (r,m) => ({x0:r.x0-m,x1:r.x1+m,z0:r.z0-m,z1:r.z1+m});
const polyHits = (p,r) => overlap(p,r) && ([[r.x0,r.z0],[r.x1,r.z0],[r.x1,r.z1],[r.x0,r.z1]].some(([x,z])=>inPiece(x,z,p)) || p.rings.some(ring=>ring.some((_,i)=>i%2===0&&hitsRect(ring[i],ring[i+1],ring[(i+2)%ring.length],ring[(i+3)%ring.length],r))));

/** Exact obstacle intersections plus <=1 m coverage checks of the complete
 * authored rear apron, not the sparse ranking samples. All geometry is true
 * room-local metres. Roads are checked against occupied stand/support bounds;
 * a service road crossing an unoccupied generated loop is not a collision. */
export function assessPierRearSet(features, frame, layout, runways = []) {
  const meta={revision:1,sampleM:1}; let samples=0;
  const fail=(reason,extra={})=>({...meta,safe:false,reason,samples,...extra});
  const apron=layout?.aprons?.find(a=>a.side==='back');
  if(!apron||!features?.aerodromes?.length||features.occluderRevision!==1||!Array.isArray(features.occluders))return fail('missing-rear-footprint-evidence');
  const c=Math.cos(frame.heading||0),s=Math.sin(frame.heading||0),k=frame.k||1;
  const local=(x,z)=>{const dx=(x-frame.x)/k,dz=(z-frame.z)/k;return [dx*c-dz*s,dx*s+dz*c];};
  const polygon=p=>{const rings=p.rings.map(r=>{const out=[];for(let i=0;i<r.length;i+=2)out.push(...local(r[i],r[i+1]));return out;});const xs=rings[0].filter((_,i)=>i%2===0),zs=rings[0].filter((_,i)=>i%2);return {...p,rings,x0:Math.min(...xs),x1:Math.max(...xs),z0:Math.min(...zs),z1:Math.max(...zs)};};
  const buildings=features.occluders.map(polygon);
  for(const b of buildings)if(polyHits(b,apron))return fail('rear-apron-building',{featureId:b.id});
  const surfaces=(features.pavements||[]).map(polygon);
  for(const p of surfaces)if((p.cls==='runway'||p.cls==='taxiway')&&polyHits(p,apron))return fail('rear-apron-flight-pavement',{featureId:p.id});
  const lineHits=(pts,r)=>{for(let i=2;i<pts.length;i+=2){const a=local(pts[i-2],pts[i-1]),b=local(pts[i],pts[i+1]);if(hitsRect(...a,...b,r))return true;}return false;};
  for(const [lines,width]of [[features.runwayLines||[],SEAT.runwayHalfM],[features.taxiwayLines||[],SEAT.taxiwayHalfM]])for(const line of lines)if(lineHits(line.pts,expand(apron,width)))return fail('rear-apron-flight-centreline',{featureId:line.id});
  for(const rw of runways){const len=airportFrame(rw).length,half=rw.width/2+SEAT.shoulderM;const rings=[[[0,-half],[len,-half],[len,half],[0,half]].flatMap(([along,cross])=>{const p=airportPoint(rw,along,cross);return[p.x,p.z];})];if(polyHits(polygon({rings}),apron))return fail('rear-apron-registered-runway',{featureId:rw.id});}
  const bounds=features.aerodromes.map(polygon).filter(p=>overlap(p,apron)),pavement=surfaces.filter(p=>p.cls==='apron'&&overlap(p,apron));
  const covered=(x,z)=>{samples++;if(!bounds.some(p=>inPiece(x,z,p)))return 'rear-apron-outside-aerodrome';if(!pavement.some(p=>inPiece(x,z,p)))return 'rear-apron-missing-pavement';return null;};
  const nx=Math.ceil(apron.x1-apron.x0),nz=Math.ceil(apron.z1-apron.z0);
  for(let i=0;i<=nx;i++)for(let j=0;j<=nz;j++){const x=apron.x0+(apron.x1-apron.x0)*i/nx,z=apron.z0+(apron.z1-apron.z0)*j/nz,reason=covered(x,z);if(reason)return fail(reason,{point:[x,z]});}
  // Probe sub-grid gaps on both sides of source edges too. This remains
  // sampled coverage, not an exact polygon-union proof; shared tile cuts
  // remain covered by their neighbouring piece.
  for(const p of [...bounds,...pavement])for(const ring of p.rings)for(let i=0;i<ring.length;i+=2){const ax=ring[i],az=ring[i+1],bx=ring[(i+2)%ring.length],bz=ring[(i+3)%ring.length],dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz);if(!len||!hitsRect(ax,az,bx,bz,apron))continue;const n=Math.ceil(len);for(let j=0;j<=n;j++)for(const sign of [-1,1]){const x=ax+dx*j/n-sign*dz/len*.02,z=az+dz*j/n+sign*dx/len*.02;if(x<=apron.x0||x>=apron.x1||z<=apron.z0||z>=apron.z1)continue;const reason=covered(x,z);if(reason)return fail(reason,{point:[x,z]});}}
  const plan=planAirportSet({...frame,variant:'pier',rearSet:true,floorM:layout.floorM,airportId:frame.airportId||'rear-safety',ident:frame.ident||'rear-safety'},layout);
  const solids=[];
  const box=(kind,x,z,hx,hz)=>solids.push({kind,x0:x-hx,x1:x+hx,z0:z-hz,z1:z+hz});
  for(const stand of plan.stands.filter(s=>s.side==='back')){const size=STAND_CLASS[stand.cls];box('stand',stand.x,stand.z,size.span/2,size.length/2);for(const bridge of stand.bridges)for(const pose of [bridge.docked,bridge.retracted]){box('bridge-rotunda',pose.rot.x,pose.rot.z,AIRFIELD.structures.bridge.rotundaR+1.5,AIRFIELD.structures.bridge.rotundaR+1.5);const x=pose.rot.x-Math.sin(pose.yaw)*pose.columnS,z=pose.rot.z-Math.cos(pose.yaw)*pose.columnS;box('bridge-column',x,z,2,2);}}
  for(const mast of plan.masts.filter(m=>m.z>layout.terminal.z1))box('mast',mast.x,mast.z,1,1);
  for(const road of features.roads||[]){if(road.brunnel==='tunnel')continue;const clearance=['service','track','minor'].includes(road.cls)?4:8;for(const solid of solids)if(lineHits(road.pts,expand(solid,clearance)))return fail('rear-structure-road-clearance',{featureId:road.id,obstacle:solid.kind,clearanceM:clearance});}
  return {...meta,safe:true,reason:'contained-clear-rear-set',samples};
}
