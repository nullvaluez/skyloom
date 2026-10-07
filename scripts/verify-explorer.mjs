import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {register} from 'node:module';
register('./_node-resolve.mjs',import.meta.url);
const {InputController}=await import('../lib/fly/input-controller.js');
const {explorerPreferences,setExplorerPreferences,loadExplorerPreferences,validatePreferences,PREFERENCES_KEY}=await import('../lib/fly/explorer-preferences.mjs');
const {emptyExploration,rememberPlace,rememberLanding,validateExploration,EXPLORATION_KEY}=await import('../lib/fly/exploration.mjs');
const {parseBackup,createBackup,restoreBackup}=await import('../lib/fly/save-backup.mjs');
const {registerAirport,airportFrame,airportPoint,airportLocal,airportEligible,findAirportSurface,nearbyOperationsAirports}=await import('../lib/fly/operations-airports.js');
const {parseCsv,buildCatalog}=await import('./build-runway-db.mjs');
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
test('Enhanced quality latch survives long flights until an explicit preset change',async()=>{
  const {useFlyStore}=await import('../stores/fly-store.js'),{PERF_GOVERNOR}=await import('../lib/fly/fly-constants.js'),{createGovernor}=await import('../lib/fly/perf-governor.js');
  const before=useFlyStore.getState();useFlyStore.setState({mapStyle:'satellite',visuals:'enhanced',qualityPreset:'high'});
  try{
    const g=createGovernor({dpr0:1,tier0:'high',applyDpr(){},applyTier(){},applyEffects(){},cfg:{...PERF_GOVERNOR,bootGraceSec:0,refreshFrames:1,downHoldSec:.01,upHoldSecDpr:.01,upHoldSecTier:.01,cooldownSecDpr:0,cooldownSecTier:0}});
    let clock=0;const frames=(dt,n)=>{for(let i=0;i<n;i++){clock+=dt;g.tick(dt,clock,{bootPct:100});}};
    frames(1/60,5);g.ascendedAt.set(1,clock);frames(1/30,60);assert.ok(g.state().latched);
    frames(1/60,18000);assert.ok(g.state().latched);assert.ok(g.state().ceilingIdx>0);assert.ok(g.state().rung>=g.state().ceilingIdx);
  }finally{useFlyStore.setState(before);}
});
test('preferences validate and blocked storage retains live controls',()=>{
  const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  loadExplorerPreferences(blocked);setExplorerPreferences({sensitivity:1.4,invertPitch:true,music:0},blocked);
  const input=new InputController();input.keys.add('s');assert.equal(input.read().pitch,-1);input.keys.clear();input.touch={active:true,x:.5,y:0};assert.ok(input.read().turn>0&&input.read().turn<=1);
  const p=validatePreferences({version:1,settings:{sensitivity:100,master:-1,music:NaN}});assert.equal(p.settings.sensitivity,1.75);assert.equal(p.settings.master,0);assert.equal(p.settings.music,.65);
  loadExplorerPreferences(storage());assert.equal(explorerPreferences().invertPitch,false);
});
test('journal visits and landing events are idempotent and reject invalid coordinates',()=>{
  const p={id:'place:1',name:'A place',lat:40,lon:-74,at:10};const first=rememberPlace(emptyExploration(),p);assert.equal(rememberPlace(first,p),first);
  const landing={...p,id:'KCMH:1',quality:'Smooth'};const next=rememberLanding(first,landing);assert.equal(rememberLanding(next,landing),next);
  assert.throws(()=>validateExploration({...first,places:[{...p,lat:95}]}));assert.throws(()=>validateExploration({...first,places:[{...p,id:'__proto__'}]}));
});
test('old and new backups remain compatible and reject unsupported journal versions',()=>{
  const s=storage();s.setItem(EXPLORATION_KEY,JSON.stringify(emptyExploration()));s.setItem(PREFERENCES_KEY,JSON.stringify({version:1,settings:explorerPreferences()}));
  const backup=createBackup(s),target=storage();restoreBackup(target,backup);assert.deepEqual(JSON.parse(target.getItem(EXPLORATION_KEY)),emptyExploration());
  s.setItem('fly-aircraft','flying-wing');restoreBackup(target,createBackup(s));assert.equal(target.getItem('fly-aircraft'),'flying-wing');
  assert.throws(()=>parseBackup(JSON.stringify({...backup,data:{[EXPLORATION_KEY]:{version:9,places:[],landings:[]}}})));
});

test('interrupted restore never clears untouched preferences and retains a durable recovery',()=>{
  const s=storage();s.setItem('fly-aircraft','cargo');s.setItem('fly-quality-tier','ultra');
  const saved=s.setItem;let failed=false;
  s.setItem=(key,value)=>{if(key==='fly-quality-tier')failed=true;if(failed)throw Error('storage disconnected');saved(key,value);};
  const backup={format:'skyloom-guest-backup',version:1,data:{'fly-aircraft':'prop','fly-quality-tier':'low'}};
  assert.throws(()=>restoreBackup(s,backup),/recovery copy remains/);
  assert.equal(s.getItem('fly-quality-tier'),'ultra');
  const recovery=JSON.parse(s.getItem('fly-backup-recovery-v1'));assert.equal(recovery.previous['fly-aircraft'],'cargo');assert.equal(recovery.previous['fly-quality-tier'],'ultra');
});
test('CSV parser handles quoted commas, escapes, and rejects malformed input',()=>{
  assert.deepEqual(parseCsv('id,name\r\n1,"A, B"\r\n2,"C ""D"""\n'),[{id:'1',name:'A, B'},{id:'2',name:'C "D"'}]);assert.throws(()=>parseCsv('id,name\n1,"bad'));
  assert.equal(buildCatalog([{ident:'X',type:'heliport'}],[{airport_ident:'X',closed:'0'}]).index.length,0);
});
test('worldwide catalog has valid regional records and preserves shared pavement contact',()=>{
  const index=JSON.parse(readFileSync(new URL('../public/data/runways/v1/index.json',import.meta.url))).runways;assert.ok(index.length>10000);
  for(const code of ['KSFO','EGLL','RJTT','LFPG','LOWI','NZQN','TNCM','YSSY','KASE','VNLK']){
    const row=index.find(r=>r.ident===code);assert.ok(row,code);
    const region=JSON.parse(readFileSync(new URL(`../public/data/runways/v1/regions/${row.region}.json`,import.meta.url)));
    const a=registerAirport(region.airports.find(a=>a.id===row.id)),f=airportFrame(a),p=airportPoint(a,f.length/2),local=airportLocal(a,p.x,p.z);
    assert.ok(Math.abs(local.along-f.length/2)<1e-5,code);assert.ok(findAirportSurface(p.x,p.z),code);assert.ok(nearbyOperationsAirports(p.x,p.z).some(r=>r.id===a.id),code);
    assert.equal(airportEligible(a,'glider'),false);
  }
});

test('every shipped runway registers and catalog identities are unique',()=>{
  const rows=[];
  for(const file of readdirSync(new URL('../public/data/runways/v1/regions/',import.meta.url))){
    for(const raw of JSON.parse(readFileSync(new URL(`../public/data/runways/v1/regions/${file}`,import.meta.url))).airports){const a=registerAirport(raw);rows.push(a.id);assert.ok(Object.isFrozen(a)&&Object.isFrozen(a.a));assert.ok(a.thresholdA+a.thresholdB<airportFrame(a).length);}
  }
  assert.ok(rows.length>14000);assert.equal(new Set(rows).size,rows.length);
  assert.equal(nearbyOperationsAirports(0,0,1e9).length,rows.length+3);
  assert.deepEqual(nearbyOperationsAirports(NaN,0,100),[]);
});

test('ten varied airports accept actual contact in both directions on their fixed surface',async()=>{
  const {Vector3}=await import('three'),{FlightOperations}=await import('../lib/fly/flight-operations.js');
  const index=JSON.parse(readFileSync(new URL('../public/data/runways/v1/index.json',import.meta.url))).runways;
  for(const code of ['KSFO','EGLL','RJTT','LFPG','LOWI','NZQN','TNCM','YSSY','KASE','VNLK'])for(const reverse of [false,true]){
    const row=index.find(r=>r.ident===code),{airportById}=await import('../lib/fly/operations-airports.js'),a=airportById(row.id);
    const f={pos:new Vector3(),cfg:{speeds:{cruise:60}},speed:0,turnRate:0,pitchRate:0};const o=new FlightOperations();assert.ok(o.begin(f,'prop',a.id),code);
    const length=airportFrame(a).length,s=reverse?length-(a.thresholdB||0)-60:(a.thresholdA||0)+60,p=airportPoint(a,s);
    f.pos.set(p.x,p.y+o.profile.clearance+.01,p.z);f.heading=airportFrame(a).heading+(reverse?Math.PI:0);f.speed=o.profile.approach;const slope=(a.b.elevation-a.a.elevation)/length*(reverse?-1:1);o.vy=slope*f.speed-1;f.pitch=Math.asin(o.vy/f.speed);o.phase='approach';o.reverse=reverse;o.parkingBrake=false;o.setThrottle(f.speed/f.cfg.speeds.cruise);
    for(let i=0;i<120&&!o.grounded&&o.phase!=='crashed';i++)o.advance(1/120,f,{});
    assert.equal(o.phase,'landingRoll',`${code} ${reverse}: ${o.reason}`);assert.equal(o.contactCount,1);
    f.speed=0;o.parkingBrake=true;o.setThrottle(0);o.advance(.1,f,{});assert.equal(o.phase,'completed',code);
    assert.equal(o.events.filter(e=>e.type==='touchdown').length,1);assert.equal(airportPoint(a,s).y,p.y);
  }
});

test('free flight enters a nearby approach without teleporting or cutting power',async()=>{
  const {Vector3}=await import('three'),{FlightOperations}=await import('../lib/fly/flight-operations.js'),{airportById}=await import('../lib/fly/operations-airports.js');
  const a=airportById('KOSU'),p=airportPoint(a,-1500),f={pos:new Vector3(p.x,p.y+110,p.z),cfg:{speeds:{cruise:60}},speed:32,heading:airportFrame(a).heading,pitch:-.03,bank:0,latDeg:a.a.lat,groundElev:p.y,turnRate:0};
  const o=new FlightOperations();o.phase='airborne';o.freeAircraftId='prop';const before=f.pos.clone();o.advance(1/60,f,{speedPreset:'slow'});assert.ok(o.freeRoam);assert.ok(f.pos.distanceTo(before)<2);assert.ok(o.throttle>.5);assert.equal(o.phase,'approach');
  f.pos.y=p.y+1000;assert.equal(o.advance(1/60,f,{}),false);assert.equal(o.profile,null);
});

test('terrain candidate caching preserves runway height and bounded shoulders',async()=>{
  const {airportTerrainHeight}=await import('../lib/fly/operations-terrain.js'),{airportById}=await import('../lib/fly/operations-airports.js');
  const index=JSON.parse(readFileSync(new URL('../public/data/runways/v1/index.json',import.meta.url))).runways;
  const a=airportById(index.find(r=>r.ident==='VNLK').id),along=airportFrame(a).length/2;
  for(const cross of [0,a.width/2+2,a.width/2+82,a.width/2+170]){
    const p=airportPoint(a,along,cross),height=p.y-100;
    const candidates=nearbyOperationsAirports(p.x,p.z,1000);
    assert.equal(airportTerrainHeight(p.x,p.z,height,candidates),airportTerrainHeight(p.x,p.z,height));
    assert.equal(airportTerrainHeight(p.x,p.z,height,nearbyOperationsAirports(0,0,1e9)),airportTerrainHeight(p.x,p.z,height));
    if(cross<a.width/2+4)assert.ok(Math.abs(airportTerrainHeight(p.x,p.z,height,candidates)-p.y)<1e-5);
    if(cross>a.width/2+160)assert.equal(airportTerrainHeight(p.x,p.z,height,candidates),height);
  }
});

test('region stamps combine legacy achievements with casual exploration without granting duplicate rewards',async()=>{
  const {regionalCollections}=await import('../lib/fly/regional-collections.mjs'),{ADVENTURES}=await import('../lib/fly/adventures.mjs');const route=ADVENTURES[0];
  let journal=emptyExploration();route.checkpoints.forEach((p,i)=>{journal=rememberPlace(journal,{id:`discovery:${route.id}:${i}`,name:p.name,lat:p.lat,lon:p.lon,at:10});});
  const progress={completed:{[ADVENTURES[1].id]:{medal:3}},rewards:['fighter']},before=JSON.stringify(progress);
  const rows=regionalCollections(journal,progress);assert.equal(rows.length,6);assert.ok(rows[0].complete&&rows[1].complete);assert.equal(JSON.stringify(progress),before);
});

test('backup preserves existing aircraft and forgiving-flight preferences',()=>{
  const s=storage();s.setItem('fly-aircraft','cargo');s.setItem('fly-quality-tier','ultra');s.setItem('fly-crash-mode','forgiving');s.setItem(PREFERENCES_KEY,JSON.stringify({version:1,settings:explorerPreferences()}));const backup=createBackup(s),target=storage();restoreBackup(target,backup);assert.equal(target.getItem('fly-aircraft'),'cargo');assert.equal(target.getItem('fly-crash-mode'),'forgiving');assert.equal(target.getItem('fly-quality-tier'),'ultra');
});

test('Earth curvature is latitude consistent, distance bounded, and camera transitions cancel on warp',async()=>{
  const {earthBend,earthFade}=await import('../lib/fly/earth-horizon.js'),{PerspectiveCamera}=await import('three'),{CameraTransition}=await import('../lib/fly/camera-transition.js');
  for(const k of [1,1.3,2,4]){assert.ok(Math.abs(earthBend(k)*(10000*k)**2-7.8480506886)<.00001);assert.ok(earthFade('high',k).endM<=120000);}
  const c=new PerspectiveCamera(),blend=new CameraTransition();c.position.x=10;blend.update(c,'chase',0,1/60);c.position.x=100;blend.update(c,'photo',0,1/60);assert.ok(c.position.x>10&&c.position.x<100);c.position.x=500;blend.update(c,'chase',1,1/60);assert.equal(c.position.x,500);c.position.x=800;blend.update(c,'photo',1,1/60,true);assert.equal(c.position.x,800);
});

test('traffic freshness distinguishes empty live airspace, stale and failed feeds',async()=>{
  const {trafficStatus}=await import('../lib/fly/data-status.mjs');const now=1_800_000_000_000;
  assert.equal(trafficStatus({now:now/1000,ac:[]},null,now).state,'live');assert.equal(trafficStatus({now:(now-16000)/1000},null,now).state,'delayed');assert.equal(trafficStatus({now:now/1000},Error('offline'),now).state,'unavailable');
});

test('weather observations retain UTC age and endpoints remain configurable on the server',async()=>{
  const {weatherStatus}=await import('../lib/fly/data-status.mjs'),{providerURL,observationTime}=await import('../lib/fly/provider-config.mjs');const now=Date.UTC(2026,9,7,12);
  assert.equal(observationTime('2026-10-07T12:00'),now);assert.equal(observationTime(now/1000),now);assert.equal(observationTime(null),null);
  assert.equal(weatherStatus({found:true,observedAt:now},null,now).state,'live');assert.equal(weatherStatus({found:true,observedAt:now-91*60000},null,now).state,'delayed');assert.equal(weatherStatus({found:true},null,now).state,'delayed');assert.equal(weatherStatus({found:false},null,now).state,'unavailable');
  assert.equal(providerURL('https://example.com/lat/{lat}/lon/{lon}',{lat:40,lon:-74}).pathname,'/lat/40/lon/-74');assert.throws(()=>providerURL('file:///secret'));
});

test('Sydney arch has finite lightweight geometry and correct span transform',async()=>{
  const {buildLandmarkGeometries,monumentScale}=await import('../lib/fly/landmarks-3d.js');const all=buildLandmarkGeometries('sat'),g=all.archBridge;
  assert.ok(g.attributes.position.array.every(Number.isFinite));assert.ok((g.index?.count||g.attributes.position.count)/3<2500);
  const s=monumentScale({name:'Sydney Harbour Bridge',lm:'archBridge',hM:134,lmOpts:{spanM:503.5,headingDeg:12}});assert.ok(Math.abs(s.sx/s.sy-503.5/134)<1e-8);Object.values(all).forEach(g=>g.dispose());
});
