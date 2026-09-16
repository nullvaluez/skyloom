/** First-party family models; neutral paint, never an inferred airline livery.
 * Dimensions describe representative family members, not a claim of exact subtype.
 * Length/span in metres, nose -Z and Y up; live positions are never altered. */
export const LIVE_AIRCRAFT = [
  {id:'a320',codes:['A318','A319','A320','A321','A19N','A20N','A21N'],length:37.57,span:35.8,radius:1.98,sweep:.31,engines:2,winglets:true},
  {id:'b737',codes:['B731','B732','B733','B734','B735','B736','B737','B738','B739','B37M','B38M','B39M','B3XM'],length:39.47,span:35.8,radius:1.88,sweep:.28,engines:2,winglets:true},
  {id:'a330',codes:['A332','A333','A338','A339'],length:63.66,span:60.3,radius:2.82,sweep:.35,engines:2},
  {id:'a350',codes:['A359','A35K'],length:66.8,span:64.75,radius:2.98,sweep:.39,engines:2,winglets:true},
  {id:'b777',codes:['B772','B773','B77L','B77W','B778','B779'],length:73.86,span:64.8,radius:3.10,sweep:.35,engines:2},
  {id:'b787',codes:['B788','B789','B78X'],length:62.81,span:60.12,radius:2.88,sweep:.39,engines:2},
  {id:'b747',codes:['B741','B742','B743','B744','B748','B74S'],length:70.66,span:64.44,radius:3.25,sweep:.42,engines:4,hump:true},
  {id:'a380',codes:['A388'],length:72.72,span:79.75,radius:3.57,sweep:.33,engines:4,doubleDeck:true},
  {id:'crj',codes:['CRJ1','CRJ2','CRJ7','CRJ9','CRJX'],length:36.2,span:24.85,radius:1.35,sweep:.29,engines:2,rearEngines:true,tTail:true},
  {id:'ejet',codes:['E170','E175','E75L','E75S','E190','E195','E290','E295'],length:36.24,span:28.72,radius:1.51,sweep:.28,engines:2,winglets:true},
  {id:'atr',codes:['AT43','AT45','AT46','AT72','AT73','AT75','AT76'],length:27.17,span:27.05,radius:1.43,sweep:.06,engines:2,prop:true,highWing:true,tTail:true},
  {id:'dash8',codes:['DH8A','DH8B','DH8C','DH8D'],length:32.84,span:28.42,radius:1.35,sweep:.06,engines:2,prop:true,highWing:true,tTail:true},
  {id:'business',codes:['C25A','C25B','C25C','C56X','C560','C680','C68A','C700','C750','GLF4','GLF5','GLF6','GLEX','GL5T','GL7T','CL60','FA7X','FA8X','E55P','E50P','LJ35','LJ45','LJ60','PC24'],length:22.7,span:21.4,radius:1.15,sweep:.37,engines:2,rearEngines:true,tTail:true},
  {id:'piston',codes:['C150','C152','C172','C182','C206'],length:8.3,span:11,radius:.58,sweep:.02,engines:1,prop:true,highWing:true},
  {id:'twin',codes:['BE20','BE30','BE9L','BE10','BE58','B350','B190','C310','C402','C414','C421','PA31'],length:13.3,span:16.6,radius:.8,sweep:.06,engines:2,prop:true},
  {id:'helicopter',codes:['R22','R44','R66','B06','B407','B412','EC35','EC45','H145','H135','AS50','AS55','S76','A109','A139'],length:12.7,span:11,radius:1.05,helicopter:true},
  {id:'lowwing-piston',codes:['PA28','PA32','SR20','SR22','BE36','DA40','DA50'],length:8.1,span:11.7,radius:.59,sweep:.02,engines:1,prop:true},
  {id:'single-turboprop',codes:['PC12','TBM7','TBM8','TBM9','TBM','P46T'],length:14.4,span:16.3,radius:.82,sweep:.06,engines:1,prop:true,tTail:true},
  {id:'twin-utility',codes:['DHC6','BN2P','BN2T','D228','C212'],length:15.8,span:19.8,radius:.9,sweep:.02,engines:2,prop:true,highWing:true},
];
const exact=new Map(LIVE_AIRCRAFT.flatMap((f,i)=>f.codes.map(c=>[c,i])));
export function resolveLiveAircraft(meta,archetype){
  const t=String(meta?.t??'').trim().toUpperCase();
  if(exact.has(t))return exact.get(t);
  // Existing broad classifications remain fallbacks, not fabricated type data.
  return archetype===1?12:archetype===2?13:archetype===3?15:null;
}
export function liveGearDown(track){ return !!(track.flags&1); }
export function liveModelLod(distanceM,selected=false,wasNear=false,detailM=900){return selected&&distanceM<8000||distanceM<detailM*(wasNear?1.25:1);}
