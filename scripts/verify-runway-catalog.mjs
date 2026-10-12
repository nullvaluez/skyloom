import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
registerHooks({resolve(s,c,next){if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}return next(s,c);}});
const calls=new Map();
globalThis.localStorage={setItem(){},getItem(){return null;}};
globalThis.fetch=async url=>{calls.set(url,(calls.get(url)||0)+1);return {ok:true,json:async()=>JSON.parse(fs.readFileSync('public'+url,'utf8'))};};
const catalog=await import('../lib/fly/runway-catalog.js');
const registry=await import('../lib/fly/operations-airports.js');
const {airportTerrainHeight}=await import('../lib/fly/operations-terrain.js');
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
const index=await catalog.runwayIndex();
await check('simultaneous index readers share one fetch',async()=>{await Promise.all([catalog.runwayIndex(),catalog.runwayIndex()]);assert.equal(calls.get('/data/runways/v1/index.json'),1);});
await check('a fifth region evicts the least recently used of four',async()=>{const regions=[...new Set(index.map(a=>a.region))].slice(0,5);for(const id of regions)await catalog.loadRunwayRegion(id);const url=`/data/runways/v1/regions/${regions[0]}.json`,before=calls.get(url);await catalog.loadRunwayRegion(regions[0]);assert.equal(calls.get(url),before+1);});
const selected=await catalog.ensureAirport('KJFK');
await check('revisiting a cached airport protects it during nearby discovery',async()=>{
 const others=index.filter(a=>a.id!==selected.id&&a.ident!=='KJFK').slice(0,15);
 for(const a of others)await catalog.ensureAirport(a.id);
 assert.ok(registry.airportById(selected.id));
 await catalog.ensureAirport(selected.id);
 await catalog.loadNearbyRunways(selected.a.lat,selected.a.lon);
 assert.ok(registry.airportById(selected.id));
});
await check('discovered registry stays bounded and retains the active departure',async()=>{
 const departure=await catalog.ensureAirport('LOWI');catalog.saveRunwayDeparture(departure);
 for(const a of index.slice(80,115))await catalog.ensureAirport(a.id);
 assert.ok(registry.airportById(departure.id));
 assert.ok(registry.OPERATIONS_AIRPORTS.filter(a=>a.authored===false).length<=16);
 for(const id of ['KCMH','KOSU','KLCK'])assert.ok(registry.airportById(id));
});
await check('Explorer destination stays registered while discovery rotates the cache',async()=>{
 const destination=await catalog.ensureAirport('YSSY');catalog.setRunwayFlightContext({destination:destination.id});
 for(const a of index.slice(140,180))await catalog.ensureAirport(a.id);
 assert.ok(registry.airportById(destination.id));assert.ok(registry.OPERATIONS_AIRPORTS.filter(a=>a.authored===false).length<=16);catalog.setRunwayFlightContext(null);
});
await check('spatial rejection is identical to exact pavement queries at all margins',()=>{
 for(const airport of registry.OPERATIONS_AIRPORTS){
  const length=registry.airportFrame(airport).length;
  for(const margin of [0,15,160])for(let i=0;i<=12;i++)for(let j=-25;j<=25;j++){
   const p=registry.airportPoint(airport,-200+(length+400)*i/12,j*20);
   const exact=registry.OPERATIONS_AIRPORTS.map(a=>registry.airportSurface(a,p.x,p.z,margin)).find(Boolean)||null;
   assert.deepEqual(registry.findAirportSurface(p.x,p.z,margin),exact);
  }
 }
});
await check('the observed airport survives unrelated discovery without raising the registry bound',async()=>{
 const observed=await catalog.ensureAirport('KJFK');catalog.setRunwayObservation(observed);
 for(const a of index.slice(120,160))await catalog.ensureAirport(a.id);
 assert.ok(registry.airportById(observed.id));assert.ok(registry.airportById('LOWI:08-26'));
 assert.ok(registry.OPERATIONS_AIRPORTS.filter(a=>a.authored===false).length<=16);
 catalog.setRunwayObservation(null);
 for(const a of index.slice(170,205))await catalog.ensureAirport(a.id);
 assert.equal(registry.airportById(observed.id),undefined);
});
await check('spatial cells preserve overlap order, large margins, polar fields and retirement',()=>{
 const keep=registry.OPERATIONS_AIRPORTS.filter(a=>a.authored===false).map(a=>a.id);
 const polar=registry.registerAirport({id:'POLAR:09-27',name:'Spatial oracle',runway:'09',reciprocal:'27',width:500,a:{lat:84.5,lon:20,elevation:50},b:{lat:84.5,lon:20.5,elevation:65}});
 for(const a of registry.OPERATIONS_AIRPORTS){
  const length=registry.airportFrame(a).length;
  for(const margin of [-5,0,15,160,650])for(let i=0;i<90;i++){
   const p=registry.airportPoint(a,-700+(length+1400)*(i*.61803398875%1),-900+1800*(i*.41421356237%1));
   const expected=registry.OPERATIONS_AIRPORTS.map(a=>registry.airportSurface(a,p.x,p.z,margin)).find(Boolean)||null;
   assert.deepEqual(registry.findAirportSurface(p.x,p.z,margin),expected);
  }
 }
 const center=registry.airportPoint(polar,1000);assert.ok(registry.findAirportSurface(center.x,center.z));
 registry.retainDiscoveredAirports(keep);assert.equal(registry.findAirportSurface(center.x,center.z),null);
});
function originalHeight(x,z,height){
 if(registry.nearestOperationsAirport(x,z).distance>650)return height;
 const exact=registry.findAirportSurface(x,z,4);if(exact)return exact.height;
 const outer=registry.findAirportSurface(x,z,160);if(!outer)return height;
 let lo=4,hi=160;for(let i=0;i<8;i++){const m=(lo+hi)/2;if(registry.findAirportSurface(x,z,m))hi=m;else lo=m;}
 const t=1-(hi-4)/156;return height+(outer.height-height)*t*t*(3-2*t);
}
await check('early terrain rejection preserves the original height and shoulder blend',()=>{
 for(const a of registry.OPERATIONS_AIRPORTS){const length=registry.airportFrame(a).length;for(let i=0;i<150;i++)for(const cross of [-900,-650,-300,-160,-40,0,40,160,300,650,900]){
  const p=registry.airportPoint(a,-500+(length+1000)*i/149,cross),height=90+i;
  assert.ok(Math.abs(airportTerrainHeight(p.x,p.z,height)-originalHeight(p.x,p.z,height))<1e-10);
 }}
});
// Isolated CPU diagnostic; not a browser performance acceptance number.
const probe=registry.airportPoint(registry.airportById('KCMH'),20000,20000),iterations=200000;
const time=fn=>{const start=performance.now();let sum=0;for(let i=0;i<iterations;i++)sum+=fn(probe.x+i%100,probe.z,100);assert.equal(sum,iterations*100);return performance.now()-start;};
time(airportTerrainHeight);time(originalHeight);
console.log('ISOLATED FAR TERRAIN LOOKUP (ms)',JSON.stringify({iterations,before:time(originalHeight),indexed:time(airportTerrainHeight)}));
console.log(`RUNWAY CATALOG: ${checks}/${checks}`);
