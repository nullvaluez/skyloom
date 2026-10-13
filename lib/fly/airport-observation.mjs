// Pure activity and join rules. These are observations, never runway assignments.
export const FLAGSHIP_AIRPORTS = [
  {id:'KCMH',name:'Columbus',tag:'Ohio · United States'},
  {id:'KJFK',name:'New York JFK',tag:'New York · United States'},
  {id:'LOWI',name:'Innsbruck',tag:'Tyrol · Austria'},
  {id:'YSSY',name:'Sydney',tag:'New South Wales · Australia'},
];
// All tile-derived airport consumers keep local rings below 100 km. At a
// transfer beyond two such rings the ordinary streamer replaces every slot;
// rebuilding its workers/materials as well only repeats shader compilation.
// Nearby discovery still invalidates existing geometry and exclusion masks.
export function discoveryNeedsSceneRefresh(previous,destination,k=1) {
  if(!previous||!destination)return true;
  const distance=Math.hypot(previous.x-destination.x,previous.z-destination.z)/Math.max(1,k);
  return !Number.isFinite(distance)||distance<=200000;
}
export function airportActivity(track, center, k=1, radius=25000) {
  const dx=(track.rx-center.x)/k,dz=(track.rz-center.z)/k;
  const distance=Math.hypot(dx,dz);
  if(!Number.isFinite(distance)||distance>radius)return null;
  const speed=Math.hypot(track.fix1?.vE||0,track.fix1?.vN||0);
  const radial=distance>1?(dx*(track.fix1?.vE||0)-dz*(track.fix1?.vN||0))/distance:0;
  const vertical=track.fix1?.vUp||0;
  const ground=!!(track.flags&1);
  const category=ground?'ground':track.stale===0&&radial<-15&&vertical<1?'approach':track.stale===0&&radial>15&&vertical>1?'departure':'nearby';
  return {hex:track.hex,label:track.meta?.flight?.trim()||track.meta?.r||track.hex,category,distance,speed,stale:track.stale};
}
export function joinBlocker({track,status,cfg,aircraftId,ground,targetGround,altitude,ready=true}) {
  if(!ready)return 'The world is still loading. Wait for the terrain to settle.';
  if(!track)return 'This aircraft has left the local scope.';
  if(status!=='live'||track.stale!==0)return 'A fresh live position is required to join.';
  if(track.flags&1)return 'This aircraft is on the ground. You can still watch it.';
  const speed=Math.hypot(track.fix1?.vE||0,track.fix1?.vN||0);
  if(aircraftId==='glider'||!cfg?.speeds||!Number.isFinite(speed)||speed<cfg.speeds.slow*.8||speed>cfg.speeds.boost*1.05)return 'Choose an aircraft with a compatible flight speed in the hangar.';
  if(!Number.isFinite(ground)||!Number.isFinite(targetGround))return 'Terrain clearance is not known here yet. Try again after it loads.';
  if(!Number.isFinite(altitude)||altitude-ground<300||altitude-targetGround<300)return 'This contact is too close to terrain for a safe airborne join.';
  if(altitude>18000)return 'This contact is above the supported join altitude.';
  if(Number.isFinite(cfg.ceiling)&&altitude>cfg.ceiling-Math.min(300,cfg.ceilingSoftZone||0))return 'This contact is above your aircraft’s comfortable flight ceiling. Choose another aircraft in the hangar.';
  return null;
}
// One seated window per airport. With a resolved site (lib/fly/lounge-site.js)
// the view carries its placement; without one, the legacy midfield estimate.
export function observationViews(airport,length,site=null) {
  if(site)return [{id:'lounge',label:'Window seat',along:site.along,cross:site.cross,height:site.floorM,lookAlong:site.along}];
  return [{id:'lounge',label:'Window seat',along:length*.46,cross:-(airport.width/2+150),height:8,lookAlong:length*.52}];
}
