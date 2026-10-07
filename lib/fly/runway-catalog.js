import { airportById, registerAirport, OPERATIONS_AIRPORTS } from './operations-airports';
let indexPromise;
const regions=new Map();
async function json(url){const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Airport data could not load. Try again.');return r.json();}
export function runwayIndex(){
  indexPromise??=json('/data/runways/v1/index.json').then(v=>{if(v.version!==1||!Array.isArray(v.runways))throw Error('Unsupported runway catalog');return v.runways;}).catch(e=>{indexPromise=null;throw e;});return indexPromise;
}
export async function loadRunwayRegion(region){
  if(!/^\d{1,2}-\d{1,2}$/.test(region))throw Error('Invalid runway region');
  if(!regions.has(region))regions.set(region,json(`/data/runways/v1/regions/${region}.json`).then(v=>{if(v.version!==1||!Array.isArray(v.airports))throw Error('Unsupported runway region');return v.airports.map(registerAirport);}).catch(e=>{regions.delete(region);throw e;}));
  return regions.get(region);
}
export async function ensureAirport(id){
  if(!airportById(id)){const item=(await runwayIndex()).find(r=>r.id===id);if(!item)return null;await loadRunwayRegion(item.region);}
  const airport=airportById(id);
  try{localStorage.setItem('fly-runway-last-v1',JSON.stringify(airport));}catch{/* Optional cache. */}
  return airport;
}
export function restoreLastRunway(){try{const raw=localStorage.getItem('fly-runway-last-v1');if(raw&&raw.length<4096){const a=JSON.parse(raw);if(a.authored===false&&typeof a.id==='string'&&/^[\w-]+:\d{1,2}[LRC]?-\d{1,2}[LRC]?$/.test(a.id)&&typeof a.name==='string'&&a.name.length<160)registerAirport(a);}}catch{/* Bad cache must never stop boot. */}}
export async function loadNearbyRunways(lat,lon){
  const index=await runwayIndex();
  const local=index.filter(a=>Math.abs(a.lat-lat)<.4&&Math.abs(a.lon-lon)*Math.cos(lat*Math.PI/180)<.4);
  await Promise.all([...new Set(local.map(a=>a.region))].map(loadRunwayRegion));return local;
}
export async function searchRunways(query,geo){
  const q=query.trim().toLowerCase();
  const authored=OPERATIONS_AIRPORTS.map(a=>({id:a.id,name:a.name,ident:a.id,runway:a.runway,lat:a.a.lat,lon:a.a.lon}));
  return [...authored,...await runwayIndex()].filter(r=>!q||`${r.ident} ${r.name} ${r.runway}`.toLowerCase().includes(q)).sort((a,b)=>{
    if(q){const exact=Number(b.ident.toLowerCase()===q)-Number(a.ident.toLowerCase()===q);if(exact)return exact;}
    if(geo)return Math.hypot(a.lat-geo.lat,(a.lon-geo.lon)*Math.cos(geo.lat*Math.PI/180))-Math.hypot(b.lat-geo.lat,(b.lon-geo.lon)*Math.cos(geo.lat*Math.PI/180));
    return a.name.localeCompare(b.name);
  }).slice(0,12);
}
