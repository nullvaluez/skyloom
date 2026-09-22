// Versioned gameplay airport geometry. Runway endpoints/elevations: FAA NASR
// facts effective 2026-09-03, reproduced by airnav.com/airport/{icao}.
// Taxi corridors follow the FAA 2609 airport diagrams, simplified for gameplay.
// Stand positions/widths are authored approximations, NOT surveyed navigation.
// Coordinates are WGS84; heights/lengths are true metres. No external assets.
export const AIRPORT_OPERATIONS_VERSION = 1;
const end = (lat, lon, feet) => ({ lat, lon, elevation: feet * .3048 });
export const OPERATIONS_AIRPORTS = [
  { id: 'KOSU', name: 'Ohio State University', runway: '09R', reciprocal: '27L', width: 30.48,
    a: end(40 + 4.628820/60, -(83 + 4.896158/60), 901.3), b: end(40 + 4.670905/60, -(83 + 3.824775/60), 889.6),
    fleet: ['prop', 'warbird-prop'], taxiSide: 1, taxiOffset: 105, standAlong: 530 },
  { id: 'KCMH', name: 'John Glenn Columbus', runway: '10R', reciprocal: '28L', width: 45.72,
    a: end(39 + 59.619088/60, -(82 + 54.550703/60), 804.9), b: end(39 + 59.496837/60, -(82 + 52.390905/60), 815),
    taxiSide: 1, taxiOffset: 150, standAlong: 1250, exitAlong: 1525 },
  // Use the apron-facing runway: 05R has no southeast parallel taxiway.
  // Displaced landing thresholds are distinct from usable takeoff pavement.
  { id: 'KLCK', name: 'Rickenbacker International', runway: '05L', reciprocal: '23R', width: 45.72,
    a: end(39 + 48.201255/60, -(82 + 56.642443/60), 735.5), b: end(39 + 49.579945/60, -(82 + 54.835283/60), 737.3),
    thresholdA: 898*.3048, thresholdB: 989*.3048,
    taxiSide: -1, taxiOffset: 300, standAlong: 1400, exitAlong: 2200 },
];
export const airportById = id => OPERATIONS_AIRPORTS.find(a => a.id === id);
export const airportExitAlong = a => Math.min(FRAMES.get(a.id).length-100,a.exitAlong ?? a.standAlong+450);
export const airportEligible = (airport, aircraft) => !!airport && aircraft !== 'glider' && (!airport.fleet || airport.fleet.includes(aircraft));
const R = 6378137, rad = Math.PI/180;
export function projectAirportPoint(lon, lat) {
  return { x: R * lon * rad, z: -R * Math.log(Math.tan(Math.PI/4 + lat*rad/2)) };
}
export function airportFrame(a) {
  const p = projectAirportPoint(a.a.lon,a.a.lat), q = projectAirportPoint(a.b.lon,a.b.lat);
  const k = 1/Math.cos(a.a.lat*rad), length = Math.hypot(q.x-p.x,q.z-p.z)/k;
  const ux=(q.x-p.x)/(length*k), uz=(q.z-p.z)/(length*k);
  return { ...p, k, length, ux, uz, heading: Math.atan2(ux,-uz) };
}
const FRAMES = new Map(OPERATIONS_AIRPORTS.map(a=>[a.id,airportFrame(a)]));
export const airportTaxiExits = a => [65,airportExitAlong(a),FRAMES.get(a.id).length-65];
const PAVEMENTS=new Map(OPERATIONS_AIRPORTS.map(a=>{
  const length=FRAMES.get(a.id).length,offset=a.taxiSide*a.taxiOffset,half=a.id==='KOSU'?10:24;
  const rect=(kind,s0,s1,c0,c1)=>Object.freeze({kind,s0,s1,c0,c1});
  return [a.id,Object.freeze([
    rect('runway',0,length,-a.width/2,a.width/2),
    rect('taxiway',40,length-40,offset-half,offset+half),
    ...airportTaxiExits(a).map(s=>rect('taxiway',s-half,s+half,Math.min(a.taxiSide*a.width/2,offset),Math.max(a.taxiSide*a.width/2,offset))),
    rect('apron',a.standAlong-90,a.standAlong+90,offset+a.taxiSide*45-90,offset+a.taxiSide*45+90),
  ])];
}));
/** Render, wheel contact, terrain flattening and exclusions share these bounds. */
export const airportPavements = a => PAVEMENTS.get(a.id);
export function airportPoint(a, along, cross=0) {
  const f=FRAMES.get(a.id);
  return { x:f.x+(f.ux*along-f.uz*cross)*f.k, z:f.z+(f.uz*along+f.ux*cross)*f.k,
    y:a.a.elevation+(a.b.elevation-a.a.elevation)*Math.max(0,Math.min(1,along/f.length)) };
}
export function airportLocal(a,x,z) {
  const f=FRAMES.get(a.id), dx=(x-f.x)/f.k,dz=(z-f.z)/f.k;
  return { along:dx*f.ux+dz*f.uz,cross:-dx*f.uz+dz*f.ux };
}
export function taxiRoute(a, arrival=false, reverse=false, exitAlong=airportExitAlong(a)) {
  const side=a.taxiSide, offset=a.taxiOffset*side;
  const start=reverse?FRAMES.get(a.id).length-65:65;
  const route=[[a.standAlong,offset+side*75],[a.standAlong,offset],[start,offset],[start,0],[reverse?start-125:190,0]];
  return arrival ? [[exitAlong,0],
    [exitAlong,offset],...route.slice(0,2).reverse()] : route;
}
export function airportSurface(a,x,z,margin=0) {
  const l=airportLocal(a,x,z);
  const surface=airportPavements(a).find(r=>l.along>=r.s0-margin&&l.along<=r.s1+margin&&l.cross>=r.c0-margin&&l.cross<=r.c1+margin);
  return surface ? { ...l, kind:surface.kind, airport:a, height:airportPoint(a,l.along).y } : null;
}
export function findAirportSurface(x,z,margin=0) {
  for(const a of OPERATIONS_AIRPORTS){const s=airportSurface(a,x,z,margin);if(s)return s;}
  return null;
}
export function nearestOperationsAirport(x,z) {
  return OPERATIONS_AIRPORTS.reduce((best,a)=>{
    const p=airportLocal(a,x,z), distance=Math.hypot(p.cross,Math.max(0,-p.along,p.along-FRAMES.get(a.id).length));
    return !best||distance<best.distance?{airport:a,distance}:best;
  },null);
}
