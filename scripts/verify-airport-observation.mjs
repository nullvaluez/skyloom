import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
registerHooks({resolve(s,c,next){if(s.startsWith('@/'))s=new URL('../'+s.slice(2),import.meta.url).href;if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}return next(s,c);}});
const {airportActivity,joinBlocker,observationViews,discoveryNeedsSceneRefresh}=await import('../lib/fly/airport-observation.mjs');
const registry=await import('../lib/fly/operations-airports.js');
const {trafficStatus}=await import('../lib/fly/data-status.mjs');
const {livingAirportsOn}=await import('../lib/fly/airport-feature-policy.js');
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
const t={hex:'abc123',rx:1000,ry:1200,rz:0,stale:0,flags:0,fix1:{vE:-100,vN:0,vUp:-3},meta:{flight:' SKY123 '}};
check('approach classification uses radial movement and descent',()=>assert.equal(airportActivity(t,{x:0,z:0}).category,'approach'));
check('departure requires outward movement and climb',()=>assert.equal(airportActivity({...t,fix1:{vE:100,vN:0,vUp:3}},{x:0,z:0}).category,'departure'));
check('stale positions never imply a flight phase',()=>assert.equal(airportActivity({...t,stale:1},{x:0,z:0}).category,'nearby'));
check('ground is observed separately',()=>assert.equal(airportActivity({...t,flags:1},{x:0,z:0}).category,'ground'));
check('activity is bounded to local airport radius',()=>assert.equal(airportActivity({...t,rx:50000},{x:0,z:0}),null));
const safe={track:t,status:'live',cfg:{speeds:{slow:60,boost:300}},ground:300,targetGround:400,altitude:1200};
check('fresh compatible terrain-clear join allowed',()=>assert.equal(joinBlocker(safe),null));
check('speed-compatible contact above the chosen aircraft ceiling is rejected',()=>assert.match(joinBlocker({...safe,altitude:6000,cfg:{...safe.cfg,ceiling:5500,ceilingSoftZone:1000}}),/ceiling/));
for(const [name,patch]of [['missing',{track:null}],['stale',{track:{...t,stale:1}}],['grounded',{track:{...t,flags:1}}],['delayed',{status:'delayed'}],['unavailable',{status:'unavailable'}],['missing terrain',{ground:null}],['target terrain',{targetGround:null}],['clearance',{ground:1000}],['loading',{ready:false}],['incompatible speed',{cfg:{speeds:{slow:5,boost:30}}}],['glider',{aircraftId:'glider'}]])check('join rejected: '+name,()=>assert.equal(typeof joinBlocker({...safe,...patch}),'string'));
const cmh=registry.airportById('KCMH');
check('distant discovery retains shared engines; overlapping and unknown bounds refresh',()=>{assert.equal(discoveryNeedsSceneRefresh({x:0,z:0},{x:800000,z:0},1.4),false);assert.equal(discoveryNeedsSceneRefresh({x:0,z:0},{x:30000,z:0},1.4),true);assert.equal(discoveryNeedsSceneRefresh({x:0,z:0},{x:800000,z:0},10),true);assert.equal(discoveryNeedsSceneRefresh(null,{x:0,z:0}),true);});
check('Ohio identity remains authored and unchanged',()=>{assert.equal(cmh.runway,'10R');assert.ok(registry.airportPavements(cmh).some(p=>p.kind==='taxiway'));});
check('generic geometry is runway-only',()=>{const a=registry.registerAirport({...cmh,id:'TEST:10-28',ident:'TEST'});assert.equal(a.authored,false);assert.equal(registry.airportPavements(a).length,1);});
check('registry rejects bad terrain coordinates',()=>assert.throws(()=>registry.registerAirport({...cmh,id:'bad',a:{...cmh.a,lat:NaN}})));
check('registry retirement preserves authored airports',()=>{registry.retainDiscoveredAirports([]);assert.equal(registry.airportById('TEST:10-28'),undefined);assert.equal(registry.airportById('KCMH'),cmh);});
check('every airport provides one fixed window seat',()=>{assert.equal(observationViews(cmh,3000).length,1);assert.equal(observationViews(cmh,3000)[0].id,'lounge');assert.equal(observationViews({...cmh,id:'TEST'},3000).length,1);});
check('provider states distinguish delayed and unavailable',()=>{assert.equal(trafficStatus({now:1000},null,1001000).state,'live');assert.equal(trafficStatus({now:1000},null,1020000).state,'delayed');assert.equal(trafficStatus(null,null).state,'unavailable');});
globalThis.window={location:{search:'?graphicsReview=1&airports=on&airportArt=off&airportScenery=on'},matchMedia:()=>({matches:false})};
check('rollout parts are independent',()=>{assert.equal(livingAirportsOn(),true);assert.equal(livingAirportsOn('worldArt'),false);assert.equal(livingAirportsOn('scenery'),true);});
check('mobile is always excluded',()=>{window.matchMedia=()=>({matches:true});window.ontouchstart=null;assert.equal(livingAirportsOn(),false);delete window.ontouchstart;});
check('ordinary desktop release has the lounge; world art and airport scenery stay review-only',()=>{window.matchMedia=()=>({matches:false});window.location.search='';assert.equal(livingAirportsOn(),true);assert.equal(livingAirportsOn('worldArt'),false);assert.equal(livingAirportsOn('scenery'),false);window.location.search='?graphicsReview=1&airports=off';assert.equal(livingAirportsOn(),false);});
delete globalThis.window;
check('every checked-in runway passes runtime validation',()=>{
  let count=0;for(const file of fs.readdirSync('public/data/runways/v1/regions')){
    const region=JSON.parse(fs.readFileSync('public/data/runways/v1/regions/'+file,'utf8'));
    for(const row of region.airports){registry.registerAirport(row);registry.retainDiscoveredAirports([]);count++;}
  }assert.equal(count,14094);
});
// --- the lounge experience: optics, head, board and local sky (pure modules) ---
const cam=await import('../lib/fly/airport-watch-camera.mjs');
const {VIEW}=await import('../lib/fly/observation-config.js');
const near=(a,b,eps,msg)=>assert.ok(Math.abs(a-b)<=eps,`${msg??''} ${a} vs ${b}`);
check('optics: FOV = 58 / magnification, clamped 1x..25x, presets 7/12/20',()=>{near(cam.fovForMag(1),58,1e-9);near(cam.fovForMag(7),58/7,1e-9);assert.equal(cam.clampMag(40),25);assert.equal(cam.clampMag(0.2),1);assert.deepEqual([...VIEW.optics.steps],[7,12,20]);assert.equal(cam.maskAmount(1),0);assert.equal(cam.maskAmount(7),1);});
check('optics: magnification eases in log space and lands exactly on the target',()=>{let m=1,steps=0;while(m!==7&&steps<400){m=cam.easeMag(m,7,1/60);steps++;}assert.equal(m,7);assert.ok(steps>5&&steps<200,'eased over '+steps+' frames');});
check('head: the critically damped follow settles without overshoot and tracks a moving target with zero lag',()=>{const s={x:0,v:0};let peak=0;for(let i=0;i<600;i++){cam.springTo(s,1,0,VIEW.head.lockOmega,1/60);peak=Math.max(peak,s.x);}near(s.x,1,1e-6,'settled');assert.ok(peak<=1+1e-9,'no overshoot '+peak);const m={x:0,v:0.3};let target=0;for(let i=0;i<120;i++){target+=0.3/60;cam.springTo(m,target,0.3,VIEW.head.lockOmega,1/60);}near(m.x,target,1e-9,'feed-forward lag');});
check('head: TRUE_SCALE pitch is written so the RENDERED view looks where the head does',()=>{for(const k0 of [1,1.31,2.4])for(const p of [-0.4,0,0.05,0.6]){near(Math.atan(k0*Math.tan(cam.scenePitch(p,k0))),p,1e-12,'k0 '+k0);}});
check('head: zoom-to-cursor keeps the point under the cursor fixed',()=>{const tanV=Math.tan(29*cam.DEG),tanH=tanV*16/9,d=cam.ndcDirection(0.2,0.1,0.6,-0.3,tanH,tanV);const nv=Math.tan(3*cam.DEG),nh=nv*16/9,h=cam.anchorHead(d.yaw,d.pitch,0.6,-0.3,nh,nv),back=cam.ndcDirection(h.yaw,h.pitch,0.6,-0.3,nh,nv);near(cam.angularSeparation(back.yaw,back.pitch,d.yaw,d.pitch),0,1e-7,'anchor');});
check('picking: the radius grows with magnification and is capped',()=>{assert.ok(cam.pickRadius(7)>cam.pickRadius(1));assert.equal(cam.pickRadius(1),VIEW.pick.basePx);assert.ok(cam.pickRadius(25)<=VIEW.pick.maxPx);});
check('binoculars: a big pointing error widens the field so the target is found, then closes back',()=>{assert.ok(cam.slewMag(0.5,20)<20);assert.equal(cam.slewMag(0,20),20);});
const {buildBoard,runwayDirections,airlineFor,contactLabel}=await import('../lib/fly/airport-watch-board.mjs');
// One east-west runway: 09 lands eastbound onto x = 0, 27 westbound onto x = 3000 (scene metres, k = 1).
const runways=runwayDirections([{runway:'09',reciprocal:'27',a:{elevation:200},b:{elevation:200},thresholdA:0,thresholdB:0}],()=>({x:0,z:0,ux:1,uz:0,length:3000,k:1}));
const boardCtx=(nowSec)=>({eye:{x:1500,y:230,z:-800},k:1,ref:{x:1500,z:0},fieldElev:200,runways,nowSec});
const contact=(hex,{x,z,y,vE=0,vN=0,vUp=0,ground=false,flight,type='A320',t=1})=>({hex,rx:x,ry:y,ryd:y,rz:z,stale:0,flags:ground?1:0,fix1:{vE,vN,vUp,latRad:0,t},meta:{flight,t:type,r:'N'+hex.slice(0,4).toUpperCase()}});
const fleet=()=>[
  contact('arr001',{x:-8000,z:0,y:200+8000*Math.tan(3*cam.DEG),vE:70,vUp:-3.5,flight:'DAL123'}),
  contact('dep001',{x:5000,z:0,y:800,vE:80,vUp:8,flight:'SWA22',type:'B738'}),
  contact('gnd001',{x:1000,z:200,y:200,vE:8,ground:true,flight:'N123AB',type:'C172'}),
  contact('ovr001',{x:20000,z:10000,y:11000,vE:230,flight:'UAL9',type:'B789'}),
  contact('loc001',{x:-5000,z:9000,y:1200,vN:60,flight:'N55LC',type:'C172'}),
];
check('board: every contact lands on the right list with stable row fields',()=>{const b=buildBoard(fleet(),boardCtx(10),new Map());const at=(list)=>b[list].map(r=>r.hex);assert.deepEqual(at('arrivals'),['arr001']);assert.deepEqual(at('departures'),['dep001']);assert.deepEqual(at('ground'),['gnd001']);assert.deepEqual(at('overhead'),['ovr001']);assert.deepEqual(at('local'),['loc001']);const row=b.arrivals[0];for(const key of ['hex','label','airline','type','typeCode','phase','phaseLabel','category','distanceM','altM','aglM','speedMs','vsMs','etaS','runway','stale'])assert.ok(key in row,'row has '+key);assert.equal(row.category,'arrival');assert.equal(row.runway,'09');near(row.etaS,8000/70,0.5,'ETA');assert.equal(row.airline,'Delta Air Lines');assert.equal(b.departures[0].runway,'09');assert.equal(b.departures[0].category,'departure');assert.equal(b.ground[0].etaS,null);});
check('board: a reciprocal approach is labelled with the reciprocal runway',()=>{const b=buildBoard([contact('arr027',{x:3000+6000,z:150,y:200+6000*Math.tan(3*cam.DEG),vE:-65,vUp:-3.2})],boardCtx(10),new Map());assert.equal(b.arrivals[0]?.runway,'27');});
check('board: a one-off category change waits holdSec before a row moves; a contact that leaves is dropped',()=>{const memo=new Map(),t=fleet()[4];buildBoard([t],boardCtx(0),memo);t.fix1={...t.fix1,vUp:9,vN:0,vE:-60,t:2};t.ry=600;let b=buildBoard([t],boardCtx(1),memo);assert.deepEqual(b.local.map(r=>r.hex),['loc001'],'held on its list');b=buildBoard([t],boardCtx(1+VIEW.board.holdSec+0.1),memo);assert.deepEqual(b.departures.map(r=>r.hex),['loc001'],'moved after the hold');t.fix1={...t.fix1,vUp:0,vE:0,vN:0};t.ry=5000;t.rx=60000;b=buildBoard([t],boardCtx(30),memo);assert.equal(b.departures.length+b.local.length,0,'a contact that left the range is dropped at once');});
check('board: a ground roll that speeds up is a takeoff, one that slows down has landed',()=>{for(const [dv,list,label] of [[6,'departures','Takeoff roll'],[-6,'arrivals','Landed']]){const memo=new Map(),t=contact('rol001',{x:1500,z:0,y:200,vE:40,ground:true,t:1});buildBoard([t],boardCtx(0),memo);t.fix1={...t.fix1,vE:40+dv,t:2};buildBoard([t],boardCtx(1),memo);t.fix1={...t.fix1,vE:40+2*dv,t:3};const b=buildBoard([t],boardCtx(2+VIEW.board.holdSec),memo);assert.equal(b[list][0]?.phaseLabel,label,list);}});
check('board: touchdown reads Landed at once while the row holds its place',()=>{const memo=new Map(),t=fleet()[0];buildBoard([t],boardCtx(0),memo);Object.assign(t,{rx:200,ry:200,flags:1});t.fix1={...t.fix1,vUp:0,vE:70,t:2};const b=buildBoard([t],boardCtx(1),memo);assert.equal(b.arrivals[0]?.hex,'arr001');assert.equal(b.arrivals[0].phaseLabel,'Landed');assert.equal(b.arrivals[0].phase,'runway');assert.equal(b.ground.length,0);});
check('board: a delayed position holds its row; contacts never invent an airline',()=>{const memo=new Map(),t=fleet()[0];buildBoard([t],boardCtx(0),memo);t.stale=1;assert.equal(buildBoard([t],boardCtx(60),memo).arrivals.length,1);assert.equal(airlineFor('N123AB'),null);assert.equal(airlineFor('DAL1234'),'Delta Air Lines');assert.equal(contactLabel({flight:'  ',r:'G-ABCD'},'abc'),'G-ABCD');assert.equal(contactLabel(null,'abc123'),'ABC123');});
const sky=await import('../lib/fly/airport-watch-sky.mjs');
const utc=(s)=>Date.parse(s);
check('local clock: offline zones with daylight saving (Columbus, Innsbruck, Sydney, Phoenix, Auckland)',()=>{
  const z=(lat,lon,at)=>sky.localClockAt(lat,lon,utc(at)).zone;
  assert.equal(z(39.998,-82.892,'2026-01-15T12:00Z'),'UTC−5');assert.equal(z(39.998,-82.892,'2026-07-15T12:00Z'),'UTC−4');
  assert.equal(z(39.998,-82.892,'2026-03-08T06:59Z'),'UTC−5');assert.equal(z(39.998,-82.892,'2026-03-08T07:01Z'),'UTC−4');
  assert.equal(z(47.2602,11.3439,'2026-03-29T00:59Z'),'UTC+1');assert.equal(z(47.2602,11.3439,'2026-03-29T01:01Z'),'UTC+2');
  assert.equal(z(-33.9461,151.1772,'2026-06-15T00:00Z'),'UTC+10');assert.equal(z(-33.9461,151.1772,'2026-10-12T00:00Z'),'UTC+11');
  assert.equal(z(33.4342,-112.0116,'2026-07-15T00:00Z'),'UTC−7');assert.equal(z(-37.0082,174.785,'2026-10-12T00:00Z'),'UTC+13');
  assert.equal(sky.localClockAt(39.998,-82.892,utc('2026-10-12T22:00Z')).text,'18:00');
});
check('local clock: open ocean falls back to labelled solar time, never a guessed zone',()=>assert.equal(sky.localClockAt(-40,-130,utc('2026-10-12T00:00Z')).zone,'solar'));
check('golden hour now: low-sun airports first, spread apart, labelled with the sunset or sunrise',()=>{
  // Find an instant where the sun is ~3 degrees up and setting at Columbus.
  let at=utc('2026-10-12T21:00Z');while(sky.sunElevationDeg(39.998,-82.892,at)>3)at+=60000;
  const airports=[{ident:'KCMH',name:'John Glenn Columbus International Airport',lat:39.998,lon:-82.892,length:3049},{ident:'KDAY',name:'Dayton International Airport',lat:39.902,lon:-84.219,length:3200},{ident:'LOWI',name:'Innsbruck Airport',lat:47.2602,lon:11.3439,length:2000}];
  const list=sky.goldenHourNow(airports,at);
  assert.equal(list.length,1,'one pick per region and none in the dark: '+list.map(a=>a.ident));
  assert.ok(['KCMH','KDAY'].includes(list[0].ident));assert.equal(list[0].rising,false);assert.match(list[0].label,/^Sunset in \d+ min$/);assert.ok(list[0].minutes>5&&list[0].minutes<60,'minutes '+list[0].minutes);assert.equal(list[0].name.endsWith('Airport'),false);
  assert.equal(sky.sunStateAt(39.998,-82.892,at).kind,'golden');assert.equal(sky.sunStateAt(39.998,-82.892,utc('2026-10-12T17:00Z')).kind,'day');assert.equal(sky.sunStateAt(39.998,-82.892,utc('2026-10-13T05:00Z')).kind,'night');
});
console.log(`AIRPORT OBSERVATION: ${checks}/${checks}`);
