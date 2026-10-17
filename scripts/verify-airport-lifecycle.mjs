// Observation lounge lifecycle + seated camera gate (node, real modules).
//
// Lifecycle: enter / select / follow / join / return / cancel / dispose keep
// the player where it was on every refusal and never write a saved setup.
// Camera: the seat never moves; look-around eases with inertia inside the
// look limits; the optics run 1x-25x with FOV = 58 / mag; the binoculars
// auto-acquire, lock onto a moving aircraft with zero steady lag, slew wide
// before zooming in, and survive TRUE_SCALE (the rendered aim, not the scene
// pitch, points at the aircraft); wheel zoom keeps the pointed-at direction
// under the pointer. Board: arrivals/departures/ground from runway geometry.
//
// Run: node scripts/verify-airport-lifecycle.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import {Vector3,PerspectiveCamera} from 'three';
registerHooks({resolve(s,c,next){if(s.startsWith('@/'))s=new URL('../'+s.slice(2),import.meta.url).href;if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}return next(s,c);}});
const {connectAirportWatch,drawnPoint}=await import('../lib/fly/airport-watch-runtime.js');
const {useFlyStore}=await import('../stores/fly-store.js');
const {getRuntimeAction}=await import('../lib/fly/runtime-bus.js');
const {projectAirportPoint,airportById,airportFrame,airportPoint}=await import('../lib/fly/operations-airports.js');
const {worldReadiness,SCENERY_HOLD_MS}=await import('../lib/fly/world-readiness.js');
const {setTrueScaleK,trueScaleOn}=await import('../lib/fly/true-scale.js');
const {ndcDirection,angularSeparation}=await import('../lib/fly/airport-watch-camera.mjs');
const {LOUNGE_ROOM}=await import('../lib/fly/observation-config.js');
globalThis.window={location:{search:'?graphicsReview=1&airports=on'},matchMedia:()=>({matches:false})};
const saved=new Map();globalThis.localStorage={setItem:(k,v)=>saved.set(k,v),getItem:k=>saved.get(k)};
globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync('public'+url,'utf8'))});
const engine={worldToGeo:p=>new Vector3(p.x/6378137*180/Math.PI,(2*Math.atan(Math.exp(-p.z/6378137))-Math.PI/2)*180/Math.PI,p.y),getGroundAt:()=>({tileZ:18,elev:250})};
const flight={pos:new Vector3(),cfg:{speeds:{slow:60,boost:300}},heading:0,speed:100,pitch:0,bank:0};
const runtime={engine,flight,worldLoading:false,traffic:{tracks:new Map(),items:[]},trafficStatus:{state:'live'},autopilot:{mode:'off',disengage(){this.mode='off';}},adventures:{suspend(){}},operations:{phase:'airborne',profile:null,events:[],warp(){},snapshot(){return {...this,events:this.events.slice()};},restore(s){Object.assign(this,s);}},warpToGeo(lat,lon,{altM,headingRad=0}){const p=projectAirportPoint(lon,lat);flight.pos.set(p.x,altM,p.z);flight.heading=headingRad;return true;},interceptHex(){runtime.autopilot.mode='intercept';return true;}};
runtime.targeting={lockedHex:null,target:null,_lockT:0};
useFlyStore.setState({runtimeReady:true,aircraftId:'fighter',soundOn:false});
const dispose=connectAirportWatch(runtime);let checks=0;
const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
const DEG=Math.PI/180;
await check('enter uses one runtime and holds observation state',async()=>{assert.equal(await runtime.airportWatch.enter('KCMH'),true);assert.equal(useFlyStore.getState().airportWatch.id,'KCMH');assert.equal(runtime.airportWatch.views.length,1);});
const watch=runtime.airportWatch;
const camera=new PerspectiveCamera(50,16/9,2.5,600000);
runtime.camera=camera;
const frames=(n,dt=1/60)=>{for(let i=0;i<n;i++)watch.updateCamera(dt,camera);};
watch.updateCamera(0,camera);

// The camera's forward as it RENDERS: TRUE_SCALE folds the scene y by k0.
const renderedForward=(k0=1)=>{const p=camera.rotation.x,y=camera.rotation.y;return new Vector3(-Math.sin(y)*Math.cos(p),Math.sin(p)*k0,-Math.cos(y)*Math.cos(p)).normalize();};
const eye=()=>new Vector3(watch.seat.x,watch.seat.y+LOUNGE_ROOM.eye[1],watch.seat.z);
// Angle between the rendered aim and a contact's drawn position (rendered frame).
const aimError=(t,k0=1)=>{const p=drawnPoint(t,flight.pos,{}),e=eye();const d=new Vector3(p.x-e.x,(p.y-e.y)*k0,p.z-e.z).normalize();return renderedForward(k0).angleTo(d);};
// Place a contact at a room-relative true (yaw, pitch) and range from the eye.
const k=watch.frame.k;
const placeAt=(t,yaw,pitch,range)=>{const e=eye(),h=Math.cos(pitch)*range,a=watch.roomHeading+yaw;t.rx=e.x-Math.sin(a)*h*k;t.rz=e.z-Math.cos(a)*h*k;t.ry=t.ryd=e.y+Math.sin(pitch)*range;return t;};
const mk=(hex,extra={})=>({hex,rx:0,ry:0,ryd:0,rz:0,yaw:0,stale:0,flags:0,horizonFade:1,distM:5000,fix1:{vE:0,vN:0,vUp:0,latRad:40*DEG,t:1},meta:{flight:hex.toUpperCase()},...extra});
const setTraffic=(...ts)=>{runtime.traffic.tracks=new Map(ts.map(t=>[t.hex,t]));runtime.traffic.items=ts;};

await check('first person looking and zoom keep a fixed seat, independent of terrain refinements',()=>{const position=camera.position.clone();watch.move(90,-30);watch.zoomBy(-300);frames(60);assert.equal(camera.position.distanceTo(position),0);assert.equal(camera.near,.08);assert.ok(camera.fov<58);const sample=engine.getGroundAt;engine.getGroundAt=()=>({tileZ:18,elev:700});frames(2);assert.equal(camera.position.distanceTo(position),0);engine.getGroundAt=sample;watch.resetLook();frames(90);});
await check('look-around eases with inertia and stops at the look limits',()=>{
  watch.resetLook();frames(60);const y0=watch.yaw,gain=58*DEG/1080;
  watch.dragLook(300,0,1080);watch.updateCamera(1/60,camera);const first=watch.yaw-y0;
  assert.ok(first>0&&first<300*gain,'one frame moves part of the way');
  frames(60);assert.ok(Math.abs(watch.yaw-y0-300*gain)<1e-3,'settles on the dragged angle (grab gain = field of view per pixel)');
  for(let i=0;i<40;i++)watch.dragLook(2000,-4000,1080);frames(120);
  assert.ok(Math.abs(watch.yaw-LOUNGE_ROOM.look.yawMax)<1e-6&&Math.abs(watch.pitch-LOUNGE_ROOM.look.pitchMin)<1e-6,'clamped to the room look limits');
  watch.resetLook();frames(120);assert.ok(Math.abs(watch.yaw)<1e-3&&Math.abs(watch.pitch-LOUNGE_ROOM.look.defaultPitch)<1e-3,'face the runway returns to the default pose');
});
await check('optics: FOV = 58 / magnification, eased, with the binocular mask tied to magnification',()=>{
  watch.setMagnification(12);frames(90);assert.ok(Math.abs(camera.fov-58/12)<1e-3,camera.fov);assert.equal(watch.binocular,true);assert.ok(watch.optics.amount>.999);
  watch.setMagnification(20);watch.updateCamera(1/60,camera);assert.ok(camera.fov<58/12&&camera.fov>58/20,'zoom eases, never jumps');
  frames(90);assert.ok(Math.abs(camera.fov-58/20)<1e-3);
  watch.binoculars(false);frames(120);assert.ok(Math.abs(camera.fov-58)<1e-3);assert.equal(watch.binocular,false);assert.equal(watch.optics.amount,0);
  for(let i=0;i<200;i++)watch.zoomBy(-120);frames(240);assert.ok(Math.abs(camera.fov-58/25)<1e-3,'wheel caps at 25x');
  for(let i=0;i<200;i++)watch.zoomBy(120);frames(240);assert.ok(Math.abs(camera.fov-58)<1e-3,'and floors at 1x');
});
await check('wheel zoom keeps the pointed-at direction under the pointer',()=>{
  watch.resetLook();frames(120);const u=.55,v=-.3,tanV0=Math.tan(58*DEG/2);
  const before=ndcDirection(watch.yaw,watch.pitch,u,v,tanV0*camera.aspect,tanV0,{});
  for(let i=0;i<8;i++)watch.zoomAt(-90,u,v);frames(120);
  const tanV=Math.tan(camera.fov*DEG/2),after=ndcDirection(watch.yaw,watch.pitch,u,v,tanV*camera.aspect,tanV,{});
  const drift=angularSeparation(before.yaw,before.pitch,after.yaw,after.pitch);
  assert.ok(camera.fov<58/2.5);assert.ok(drift<1e-4,'anchor drift '+drift);
  watch.binoculars(false);watch.resetLook();frames(120);
});

await check('rail raise cancels a pending pointer anchor without rotating or acquiring a contact',()=>{
  watch.clearSelection();watch.resetLook();frames(120);watch.yaw=0;watch.pitch=0;
  watch.zoomAt(-20,.8,.2);frames(1);
  assert.ok(watch.optics.mag<watch.optics.target&&watch.optics.target<1.5,'wheel zoom is still settling below binocular activation');
  const yaw=watch.yaw,pitch=watch.pitch;
  watch.binoculars(true,{acquire:false});frames(120);
  assert.ok(Math.abs(watch.yaw-yaw)<1e-8,'rail preserves yaw instead of reusing the cursor anchor');
  assert.ok(Math.abs(watch.pitch-pitch)<1e-8,'rail preserves pitch');
  assert.equal(watch.selected,null);assert.equal(watch.tracking,false);assert.equal(watch.binocular,true);
  watch.binoculars(false);watch.resetLook();frames(120);
});

const near=placeAt(mk('aaa111'),.08,.05,6000),far=placeAt(mk('bbb222'),.6,.02,9000),behind=placeAt(mk('ccc333'),3.0,.04,4000);
setTraffic(near,far,behind);
await check('binoculars with nothing selected auto-acquire the aircraft nearest the centre of view',()=>{watch.clearSelection();watch.resetLook();frames(60);watch.binoculars(true);assert.equal(watch.selected,'aaa111');assert.equal(watch.tracking,true);assert.equal(useFlyStore.getState().lockedHex,'aaa111','soft lock kept for hero detail');assert.equal(runtime.targeting.lockedHex,'aaa111','and written where FlyScene and DetailedTraffic read it');assert.equal(runtime.targeting.target,near);frames(150);assert.ok(aimError(near)<camera.fov*DEG*.01,'locked and centred: '+aimError(near));watch.binoculars(false);frames(90);});
await check('clearing the selection releases the lock',()=>{watch.clearSelection();assert.equal(runtime.targeting.lockedHex,null);assert.equal(useFlyStore.getState().lockedHex,null);});
await check('a contact behind the lounge walls cannot be followed',()=>{watch.select('ccc333');assert.equal(watch.selected,'ccc333');assert.equal(watch.tracking,false);assert.match(watch.notice,/behind the lounge/);watch.clearSelection();});
await check('the lock holds a crossing aircraft with zero steady lag at 20x',()=>{
  const t=placeAt(mk('ddd444'),-.3,.08,5000);t.fix1={vE:-70*Math.cos(watch.roomHeading),vN:-70*Math.sin(watch.roomHeading),vUp:-3,latRad:t.fix1.latRad,t:1};setTraffic(t);
  watch.select('ddd444',{binoculars:true});watch.setMagnification(20);
  let worst=0;const scale=1/Math.cos(t.fix1.latRad);
  for(let i=0;i<600;i++){const dt=1/60;t.rx+=t.fix1.vE*scale*dt;t.rz-=t.fix1.vN*scale*dt;t.ry+=t.fix1.vUp*dt;t.ryd=t.ry;t._lastUpdate=performance.now()/1000;watch.updateCamera(dt,camera);if(i>240)worst=Math.max(worst,aimError(t));}
  assert.ok(Math.abs(camera.fov-58/20)<1e-2,'reached 20x '+camera.fov);
  assert.ok(worst<camera.fov*DEG*.02,`steady aim error ${(worst/DEG).toFixed(4)}° in a ${camera.fov.toFixed(2)}° field`);
});
await check('slewing to a distant contact widens the field first, then zooms back in',()=>{const t=placeAt(mk('eee555'),.9,.1,7000);setTraffic(t,runtime.traffic.items[0]);watch.select('eee555');let widest=0;for(let i=0;i<240;i++){watch.updateCamera(1/60,camera);widest=Math.max(widest,camera.fov);}assert.ok(widest>58/20*4,'field opened to '+widest.toFixed(1)+'°');assert.ok(Math.abs(camera.fov-58/20)<.05,'and closed back on the lock: '+camera.fov);assert.ok(aimError(t)<camera.fov*DEG*.02);watch.binoculars(false);frames(120);});
await check('TRUE_SCALE: the rendered aim, not the scene pitch, points at the aircraft',()=>{if(!trueScaleOn()){console.log('  (TRUE_SCALE off in this tree: scene and rendered pitch coincide)');return;}setTrueScaleK(1.31);const t=placeAt(mk('fff666'),.2,.25,4000);setTraffic(t);watch.select('fff666',{binoculars:true});watch.setMagnification(12);frames(240);assert.ok(aimError(t,1.31)<camera.fov*DEG*.02,'rendered error '+(aimError(t,1.31)/DEG).toFixed(4));const e=eye(),truePitch=Math.atan2(t.ry-e.y,Math.hypot(t.rx-e.x,t.rz-e.z)/k);assert.ok(Math.abs(camera.rotation.x-truePitch)>camera.fov*DEG*.2,'writing the true pitch as the scene pitch would miss by '+((camera.rotation.x-truePitch)/DEG).toFixed(2)+'°');setTrueScaleK(1);watch.binoculars(false);watch.clearSelection();frames(120);});
await check('dragging releases a follow and keeps the selection',()=>{const t=placeAt(mk('ggg777'),.1,.05,5000);setTraffic(t);watch.select('ggg777');frames(30);assert.ok(watch.tracking);watch.dragLook(-40,0,1080);assert.equal(watch.tracking,false);assert.equal(watch.selected,'ggg777');watch.clearSelection();});

const contact={hex:'aabbcc',rx:flight.pos.x+800,ry:1500,rz:flight.pos.z+500,yaw:0,stale:0,flags:0,fix1:{vE:100,vN:0,vUp:0},meta:{flight:'TEST'}};
setTraffic(contact);
await check('fresh tracking stays at the deck; a lost contact restores the authored view',()=>{watch.select(contact.hex);const before=flight.pos.clone();watch.updateCamera(0,camera);assert.ok(watch.tracking);assert.equal(flight.pos.distanceTo(before),0);contact.stale=2;watch.updateCamera(0,camera);assert.equal(watch.tracking,false);assert.match(watch.notice,/Contact lost/);contact.stale=0;});
await check('rejection never moves the player',()=>{const p=flight.pos.clone();contact.flags=1;assert.equal(watch.join(contact.hex).ok,false);assert.equal(flight.pos.distanceTo(p),0);assert.ok(watch.active);contact.flags=0;});
await check('missing terrain rejects before repositioning',()=>{const sample=engine.getGroundAt;engine.getGroundAt=()=>null;const p=flight.pos.clone();assert.equal(watch.join(contact.hex).ok,false);assert.equal(flight.pos.distanceTo(p),0);engine.getGroundAt=sample;});
await check('failed Escort rolls back to the deck position and operations',()=>{runtime.interceptHex=()=>false;const p=flight.pos.clone();runtime.operations.profile={id:'old'};runtime.operations.phase='parked';assert.equal(watch.join(contact.hex).ok,false);assert.ok(flight.pos.distanceTo(p)<.001);assert.ok(watch.active);assert.equal(runtime.operations.phase,'parked');assert.equal(runtime.operations.profile.id,'old');runtime.interceptHex=()=>{runtime.autopilot.mode='intercept';return true;};});

await check('board: aligned final, climb-out and ground traffic land on the right lists',()=>{
  const rw=airportById('KCMH'),f=airportFrame(rw),elev=(rw.a.elevation+rw.b.elevation)/2;
  const v=(along,cross,y,vx,vy,vz,flags,hex)=>{const p=airportPoint(rw,along,cross);return {hex,rx:p.x,ry:y,ryd:y,rz:p.z,stale:0,flags,horizonFade:1,fix1:{vE:vx,vN:vy,vUp:vz,latRad:40*DEG,t:1},meta:{flight:hex.toUpperCase(),t:'A320',category:'A3'}};};
  const fin=v(-7000,40,elev+7000*Math.tan(3*DEG),f.ux*72,-f.uz*72,-3.6,0,'dal123'),dep=v(f.length+2500,-60,elev+500,f.ux*85,-f.uz*85,9,0,'swa22'),gnd=v(900,150,elev,3,0,0,1,'n123ab');
  setTraffic(fin,dep,gnd);
  const b=watch.board();
  assert.deepEqual(b.arrivals.map(r=>r.hex),['dal123']);assert.equal(b.arrivals[0].runway,'10R');assert.ok(b.arrivals[0].etaS>80&&b.arrivals[0].etaS<120,b.arrivals[0].etaS);assert.equal(b.arrivals[0].airline,'Delta Air Lines');
  assert.deepEqual(b.departures.map(r=>r.hex),['swa22']);assert.deepEqual(b.ground.map(r=>r.hex),['n123ab']);
  for(const r of [...b.arrivals,...b.departures,...b.ground])for(const key of ['hex','label','airline','type','phase','category','distanceM','altM','speedMs','vsMs','etaS'])assert.ok(key in r,'row field '+key);
  assert.equal(watch.board(),b,'cached between pollers');
  setTraffic(contact);
});

await check('safe join transfers to existing Escort and supplies return address',()=>{assert.equal(watch.join(contact.hex).ok,true);assert.equal(watch.active,false);assert.equal(runtime.escort.source,'airport');assert.equal(useFlyStore.getState().airportReturn.id,'KCMH');assert.equal(runtime.operations.phase,'airborne');assert.equal(runtime.operations.profile,null);assert.equal(camera.near,2.5);assert.equal(camera.fov,50);});
await check('return releases Escort and restores observation without a reward',async()=>{await watch.enter(useFlyStore.getState().airportReturn.id);assert.equal(runtime.escort,null);assert.equal(runtime.autopilot.mode,'off');assert.ok(watch.active);assert.equal(useFlyStore.getState().airportReturn,null);assert.equal(watch.binocular,false);assert.equal(watch.selected,null);});
await check('cancelled airport request cannot replace the current view',async()=>{const pending=watch.enter('KJFK');watch.cancelPending();assert.equal(await pending,false);assert.equal(watch.airport.id,'KCMH');});
await check('saved flight setup is untouched by observing or joining',()=>{assert.equal(saved.has('fly-last-setup-v1'),false);assert.equal(saved.has('fly-departure'),false);});
await check('only a validated observer can leave the local terrain hold',()=>{const rt={airportWatch:{active:true,validated:true},terraStats:{sharp:false,camTileZ:18,targetZ:18}};assert.equal(worldReadiness(rt,SCENERY_HOLD_MS).parts.terrain,true);assert.equal(worldReadiness(rt,0).parts.terrain,false);rt.airportWatch.validated=false;assert.equal(worldReadiness(rt,SCENERY_HOLD_MS).parts.terrain,false);rt.airportWatch.active=false;rt.airportWatch.validated=true;assert.equal(worldReadiness(rt,SCENERY_HOLD_MS).parts.terrain,false);});
await check('exit to title clears the lounge return address',async()=>{const {exitToTitle}=await import('../lib/fly/front-door.js');useFlyStore.setState({airportReturn:{id:'KCMH',view:'deck'}});assert.equal(exitToTitle({}),true);assert.equal(useFlyStore.getState().airportReturn,null);});
await check('dispose removes runtime actions and transient state',()=>{dispose();assert.equal(runtime.airportWatch,undefined);assert.equal(getRuntimeAction('joinAirportContact'),null);assert.equal(useFlyStore.getState().airportWatch,null);});
console.log(`AIRPORT LIFECYCLE: ${checks}/${checks}`);
