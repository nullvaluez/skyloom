import { airportById, registerAirport, retainDiscoveredAirports, AUTHORED_AIRPORT_IDS, OPERATIONS_AIRPORTS } from './operations-airports';
let indexPromise;
const regions=new Map();
const active = new Map();
let flightContext=null;
export function setRunwayFlightContext(operations){flightContext=operations;}
export const RUNWAY_CACHE_LIMIT = 4;
// Discovered runway rows kept registered, protected rows included. Four large
// protected airports (KORD 8 rows, KDFW 7, KDEN 6, KBOS 6) still leave room
// for nearby discovery; 16 did not (FLY_GATE_TO_GATE_PLAN.md W0.7).
export const RUNWAY_ACTIVE_LIMIT = 48;

// Protected idents. A role ('lounge', 'departure', 'destination', 'nearby',
// or any other name a caller owns) holds at most one ident, and that ident
// protects every catalog row whose id starts with `IDENT:`. The observed
// runway and the saved departure hold the two internal roles below; the live
// flight's departure and destination are read when eviction runs.
const protectedByRole = new Map();
const PIN_OBSERVATION = 'pin:observation', PIN_DEPARTURE = 'pin:departure';
const identOfId = (id) => String(id).split(':')[0];

/** Protect (or, with null, release) every catalog row of `ident` under `role`. Accepts an ident or a runway id. */
export function protectRunwayIdent(role, ident) {
  if (ident) protectedByRole.set(role, identOfId(ident));
  else protectedByRole.delete(role);
}

/** The idents eviction skips right now. */
export function protectedRunwayIdents() {
  const idents = new Set(protectedByRole.values());
  for (const id of [flightContext?.destination, flightContext?.airport?.id]) if (id) idents.add(identOfId(id));
  return idents;
}

function activate(a) {
  const airport=registerAirport(a);
  if (!AUTHORED_AIRPORT_IDS.has(airport.id)) {
    active.delete(airport.id); active.set(airport.id,airport);
    // Evict the least recently used unprotected row, never the row being
    // activated. When every other row is protected there is nothing left to
    // evict: stop and let protected rows run over the limit.
    if (active.size > RUNWAY_ACTIVE_LIMIT) {
      const keep = protectedRunwayIdents();
      for (const id of [...active.keys()]) {
        if (active.size <= RUNWAY_ACTIVE_LIMIT) break;
        if (id !== airport.id && !keep.has(identOfId(id))) active.delete(id);
      }
    }
    retainDiscoveredAirports(active.keys());
  }
  return airport;
}
async function json(url){const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Airport data could not load. Try again.');return r.json();}
export function runwayIndex(){
  indexPromise??=json('/data/runways/v1/index.json').then(v=>{if(v.version!==1||!Array.isArray(v.runways))throw Error('Unsupported runway catalog');return v.runways;}).catch(e=>{indexPromise=null;throw e;});return indexPromise;
}
export async function loadRunwayRegion(region){
  if(!/^\d{1,2}-\d{1,2}$/.test(region))throw Error('Invalid runway region');
  if(!regions.has(region))regions.set(region,json(`/data/runways/v1/regions/${region}.json`).then(v=>{if(v.version!==1||!Array.isArray(v.airports))throw Error('Unsupported runway region');return v.airports;}).catch(e=>{regions.delete(region);throw e;}));
  const value=regions.get(region);regions.delete(region);regions.set(region,value);
  while(regions.size>RUNWAY_CACHE_LIMIT)regions.delete(regions.keys().next().value);
  return regions.get(region);
}
export async function ensureAirport(id){
  if(!airportById(id)){const index=await runwayIndex();const item=index.find(r=>r.id===id)||index.filter(r=>r.ident===id).sort((a,b)=>(b.length||0)-(a.length||0))[0];if(!item)return null;const rows=await loadRunwayRegion(item.region);const row=rows.find(a=>a.id===item.id);if(!row)return null;id=activate(row).id;}
  const airport=airportById(id);
  if(airport?.authored===false)activate(airport);
  try{localStorage.setItem('fly-runway-last-v1',JSON.stringify(airport));}catch{/* Optional cache. */}
  return airport;
}
// The deck's geometry must survive unrelated discovery/cancelled requests.
// Setting the next deck is synchronous and restores it if it was evicted while
// its region was loading. Only one observer and one departure are pinned, and
// each pin protects its whole ident (protectRunwayIdent).
export function setRunwayObservation(a){
  const id=a?.authored===false?a.id:null;
  protectRunwayIdent(PIN_OBSERVATION,id);
  if(id)activate(a);
}
export function saveRunwayDeparture(a){
  const id=a?.authored===false?a.id:null;
  protectRunwayIdent(PIN_DEPARTURE,id);
  if(id)try{localStorage.setItem('fly-runway-departure-v1',JSON.stringify(a));}catch{/* Optional resume geometry. */}
}
export function restoreLastRunway(){for(const key of ['fly-runway-last-v1','fly-runway-departure-v1'])try{const raw=localStorage.getItem(key);if(raw&&raw.length<4096){const a=JSON.parse(raw);if(a.authored===false&&typeof a.id==='string'&&/^[\w-]+:\d{1,2}[LRC]?-\d{1,2}[LRC]?$/.test(a.id)&&typeof a.name==='string'&&a.name.length<160)activate(a);}}catch{/* Bad cache must never stop boot. */}}
export async function loadNearbyRunways(lat,lon){
  const index=await runwayIndex();
  const local=index.filter(a=>!AUTHORED_AIRPORT_IDS.has(a.ident)&&Math.abs(a.lat-lat)<.25&&Math.abs(a.lon-lon)*Math.cos(lat*Math.PI/180)<.25).sort((a,b)=>Math.hypot(a.lat-lat,a.lon-lon)-Math.hypot(b.lat-lat,b.lon-lon)).slice(0,8);
  const rows=(await Promise.all([...new Set(local.map(a=>a.region))].map(loadRunwayRegion))).flat();
  for(const item of local){const row=rows.find(a=>a.id===item.id);if(row)activate(row);}return local;
}
export async function searchRunways(query,geo){
  const q=query.trim().toLowerCase();
  const authored=OPERATIONS_AIRPORTS.filter(a=>AUTHORED_AIRPORT_IDS.has(a.id)).map(a=>({id:a.id,name:a.name,ident:a.id,runway:a.runway,lat:a.a.lat,lon:a.a.lon}));
  return [...authored,...await runwayIndex()].filter(r=>!q||`${r.ident} ${r.name} ${r.runway}`.toLowerCase().includes(q)).sort((a,b)=>{
    if(q){const exact=Number(b.ident.toLowerCase()===q)-Number(a.ident.toLowerCase()===q);if(exact)return exact;}
    if(geo)return Math.hypot(a.lat-geo.lat,(a.lon-geo.lon)*Math.cos(geo.lat*Math.PI/180))-Math.hypot(b.lat-geo.lat,(b.lon-geo.lon)*Math.cos(geo.lat*Math.PI/180));
    return a.name.localeCompare(b.name);
  }).slice(0,12);
}
