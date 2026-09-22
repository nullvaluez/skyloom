import assert from 'node:assert/strict';
import { Vector3, BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, EventDispatcher } from 'three';
import { FlightOperations } from '../lib/fly/flight-operations.js';
import { OPERATIONS_AIRPORTS,airportById,airportFrame,airportPoint,airportLocal,airportSurface,airportTaxiExits,taxiRoute,airportEligible } from '../lib/fly/operations-airports.js';
import { operationsProfile } from '../lib/fly/operations-profiles.js';
import { operationsFootprint,addOperationsMask } from '../lib/fly/operations-scenery.js';
import { installOperationsTerrain } from '../lib/fly/operations-terrain.js';
let checks=0;
function test(name,fn){fn();checks++;console.log(`PASS ${name}`);}
const make=(id='prop',a='KOSU')=>{const f={pos:new Vector3(),cfg:{speeds:{cruise:id==='prop'?60:240}},speed:0,turnRate:0,pitchRate:0};const o=new FlightOperations();assert.ok(o.begin(f,id,a));return {f,o};};
const run=(o,f,seconds,cmd={},hz=60)=>{for(let i=0;i<Math.round(seconds*hz);i++)o.advance(1/hz,f,cmd);};
test('published runway lengths and coordinate round trips',()=>{for(const a of OPERATIONS_AIRPORTS){const frame=airportFrame(a);assert.ok(Math.abs(frame.length-({KOSU:1525,KCMH:3083,KLCK:3628}[a.id]))<10);for(const [s,c] of [[0,0],[100,50],[frame.length,-50]]){const p=airportPoint(a,s,c),l=airportLocal(a,p.x,p.z);assert.ok(Math.abs(l.along-s)<1e-6);assert.ok(Math.abs(l.cross-c)<1e-6);}}});
test('every authored taxi route stays on a physical surface in both directions',()=>{for(const a of OPERATIONS_AIRPORTS)for(const arrival of [false,true])for(const reverse of [false,true])for(const exit of airportTaxiExits(a)){const route=taxiRoute(a,arrival,reverse,exit);for(let j=1;j<route.length;j++)for(let q=0;q<=100;q++){const t=q/100,p=airportPoint(a,route[j-1][0]*(1-t)+route[j][0]*t,route[j-1][1]*(1-t)+route[j][1]*t);assert.ok(airportSurface(a,p.x,p.z),`${a.id} ${arrival} ${reverse} segment ${j}`);}}});
test('parking brake holds at full power without rotation',()=>{const {f,o}=make();const before=f.pos.clone();run(o,f,20,{throttle:1,pitch:1});assert.equal(o.phase,'parked');assert.equal(f.speed,0);assert.ok(f.pos.distanceTo(before)<.001);});
test('zero speed cannot rotate and no-input parked aircraft stays level',()=>{const {f,o}=make();run(o,f,10,{pitch:1});assert.equal(o.takeoffs,0);assert.equal(f.pos.y,f.groundElev+o.profile.clearance);});
test('all eight powered aircraft take off on compatible runways',()=>{for(const id of ['prop','warbird-prop','fighter','military','warbird-jet','bizjet','airliner','cargo']){const {f,o}=make(id,id==='prop'?'KOSU':'KLCK');const p=airportPoint(o.airport,65);f.pos.set(p.x,p.y+o.profile.clearance,p.z);f.heading=airportFrame(o.airport).heading;o.parkingBrake=false;o.phase='takeoffRoll';run(o,f,35,{throttle:1,pitch:.65});assert.equal(o.phase,'airborne',id);assert.ok(o.takeoffs===1,id);assert.ok(f.agl>o.profile.clearance+1,id);}});
test('aborted takeoff brakes to rest',()=>{const {f,o}=make();const p=airportPoint(o.airport,65);f.pos.set(p.x,p.y+o.profile.clearance,p.z);f.heading=airportFrame(o.airport).heading;o.parkingBrake=false;o.phase='takeoffRoll';run(o,f,6,{throttle:1});run(o,f,10,{throttle:0,brake:1});assert.equal(f.speed,0);assert.equal(o.takeoffs,0);});
test('idle-power flare preserves glide energy and accepts a range of gentle inputs',()=>{
  for(const id of ['prop','warbird-prop','fighter','military','warbird-jet','bizjet','airliner','cargo'])for(const duration of id==='prop'?[.12,.18,.23,.3]:[.12,.18]){
    const {f,o}=make(id,'KLCK'),point=airportPoint(o.airport,600);
    f.pos.set(point.x,point.y+o.profile.clearance+8,point.z);f.heading=airportFrame(o.airport).heading;f.speed=o.profile.approach;f.pitch=-Math.PI/60;
    o.phase='approach';o.vy=Math.sin(f.pitch)*f.speed;o.setPowerPreset(0);
    for(let i=0;i<120*35&&!o.grounded&&o.phase!=='crashed';i++)o.advance(1/120,f,{pitch:i<duration*120?1:0});
    assert.equal(o.phase,'landingRoll',`${id} flare ${duration}: ${o.reason}`);assert.equal(o.contactCount,1);
  }
});
test('gentle actual runway touchdown emits once and allows parking completion',()=>{const {f,o}=make();const p=airportPoint(o.airport,250);f.pos.set(p.x,p.y+o.profile.clearance+.1,p.z);f.heading=airportFrame(o.airport).heading;f.speed=29;f.pitch=-.025;o.phase='approach';o.parkingBrake=false;o.vy=-.8;run(o,f,1,{throttle:.48});assert.equal(o.phase,'landingRoll');assert.equal(o.events.filter(e=>e.type==='touchdown').length,1);const stand=airportPoint(o.airport,...taxiRoute(o.airport)[0]);f.pos.set(stand.x,stand.y+o.profile.clearance,stand.z);f.speed=0;o.phase='taxiIn';o.parkingBrake=true;run(o,f,3,{throttle:0});assert.equal(o.phase,'completed');assert.equal(o.summary.destination,'KOSU');assert.equal(o.events.filter(e=>e.type==='completed').length,1);});
test('hard touchdown fails with retry preserving practice attribution',()=>{const {f,o}=make();const p=airportPoint(o.airport,250);f.pos.set(p.x,p.y+o.profile.clearance+.01,p.z);f.heading=airportFrame(o.airport).heading;f.speed=35;f.pitch=-.4;o.phase='approach';o.vy=-12;run(o,f,.1);assert.equal(o.phase,'crashed');assert.ok(o.retry(f));assert.equal(o.phase,'approach');assert.equal(o.assisted,true);assert.ok(f.agl>=0);});
test('blocking overlays and background gaps do not move the aircraft',()=>{const {f,o}=make();const before=f.pos.clone();for(let i=0;i<20;i++)o.advance(10,f,{throttle:1},true);assert.equal(f.pos.distanceTo(before),0);assert.equal(o.accumulator,0);});
test('render rates produce equivalent taxi distance',()=>{const poses=[30,60,120].map(hz=>{const {f,o}=make();o.parkingBrake=false;run(o,f,2,{throttle:.15},hz);return f.pos;});for(const p of poses)assert.ok(p.distanceTo(poses[0])<.001);});
test('unsupported airport and glider combinations are rejected',()=>{assert.equal(airportEligible(airportById('KOSU'),'cargo'),false);assert.equal(airportEligible(airportById('KLCK'),'glider'),false);assert.equal(operationsProfile('unknown'),null);});
test('warps clear landing attribution and never create contact',()=>{const {f,o}=make();o.lastTouchdown={quality:'Good'};o.warp(f);assert.equal(o.phase,'airborne');assert.equal(o.assisted,true);assert.equal(o.lastTouchdown,null);assert.equal(o.events.filter(e=>e.type==='touchdown').length,0);});
test('all powered aircraft land safely at approach speed',()=>{for(const id of ['prop','warbird-prop','fighter','military','warbird-jet','bizjet','airliner','cargo']){const {f,o}=make(id,'KLCK'),point=airportPoint(o.airport,400);f.pos.set(point.x,point.y+o.profile.clearance+.1,point.z);f.heading=airportFrame(o.airport).heading;f.speed=o.profile.approach;f.pitch=-.02;o.vy=-1;o.phase='approach';o.parkingBrake=false;run(o,f,1,{throttle:o.profile.approach/f.cfg.speeds.cruise});assert.equal(o.phase,'landingRoll',id);}});
test('wind selection freezes a reciprocal runway and its taxi route remains paved',()=>{const {f,o}=make();const frame=airportFrame(o.airport);o.chooseRunway({windX:frame.ux*8,windZ:frame.uz*8});assert.equal(o.runwayName,'27L');const route=taxiRoute(o.airport,false,o.reverse);for(let j=1;j<route.length;j++)for(let q=0;q<=20;q++){const t=q/20,p=airportPoint(o.airport,route[j-1][0]*(1-t)+route[j][0]*t,route[j-1][1]*(1-t)+route[j][1]*t);assert.ok(airportSurface(o.airport,p.x,p.z));}o.retry(f);assert.ok(airportLocal(o.airport,f.pos.x,f.pos.z).along>frame.length);});
test('firm contact bounces once then settles rather than duplicating a landing',()=>{const {f,o}=make();const p=airportPoint(o.airport,300);f.pos.set(p.x,p.y+o.profile.clearance+.01,p.z);f.heading=airportFrame(o.airport).heading;f.speed=29;f.pitch=-.12;o.vy=-3.5;o.phase='approach';o.parkingBrake=false;run(o,f,2,{throttle:.48});assert.equal(o.events.filter(e=>e.type==='bounce').length,1);assert.equal(o.events.filter(e=>e.type==='touchdown').length,1);assert.equal(o.phase,'landingRoll');});
test('large frame gaps are bounded and go-around never creates a touchdown',()=>{const {f,o}=make();o.parkingBrake=false;const before=f.pos.clone();o.advance(120,f,{throttle:1});assert.ok(f.pos.distanceTo(before)<1);o.phase='approach';o.goAround();assert.equal(o.phase,'airborne');assert.equal(o.throttle,1);assert.equal(o.contactCount,0);});
test('curated pavement excludes scenery without an aeroway layer',()=>{const a=airportById('KOSU'),center=airportPoint(a,400),frame={cx:center.x,cz:center.z,tileSpan:800,mercX0:center.x-400,mercYTop:-center.z+400};const mask=addOperationsMask(null,64,frame);assert.ok(mask.some(v=>v===255));assert.ok(operationsFootprint([{x:31,y:31},{x:33,y:31},{x:33,y:33},{x:31,y:33}],frame,64));const far={cx:0,cz:0,tileSpan:800,mercX0:0,mercYTop:0};assert.equal(addOperationsMask(null,64,far),null);});
test('displaced landing threshold rejects early contact but remains takeoff pavement',()=>{const {f,o}=make('cargo','KLCK');const p=airportPoint(o.airport,100);assert.equal(airportSurface(o.airport,p.x,p.z).kind,'runway');f.pos.set(p.x,p.y+o.profile.clearance+.01,p.z);f.heading=airportFrame(o.airport).heading;f.speed=o.profile.approach;f.pitch=-.02;o.vy=-1;o.phase='approach';run(o,f,.1);assert.equal(o.phase,'crashed');assert.match(o.reason,/displaced threshold/);});
test('choosing a distant destination does not take over cruise flight',()=>{
  const {f,o}=make();o.phase='airborne';f.pos.x+=200000;f.pos.y+=2000;
  o.selectDestination('KCMH');assert.equal(o.phase,'airborne');assert.equal(o.destination,'KCMH');
  assert.equal(o.advance(1/60,f,{}),false);
});
test('guidance respects the reciprocal approach already being flown',()=>{
  const {f,o}=make(),a=o.airport,frame=airportFrame(a),p=airportPoint(a,frame.length+1200,-15);
  f.pos.set(p.x,p.y+100,p.z);f.heading=frame.heading+Math.PI;o.phase='airborne';
  o.guideApproach(f,{windX:-frame.ux*8,windZ:-frame.uz*8});
  assert.equal(o.phase,'approach');assert.equal(o.reverse,true);assert.equal(o.runwayName,'27L');
  const g=o.approachGuidance(f);assert.ok(g.lateral>0);assert.ok(g.distance>1199&&g.distance<1201);
  assert.ok(g.targetHeight>p.y+70&&g.targetHeight<p.y+80);
});
test('retry uses each aircraft approach throttle and resets angular rates',()=>{
  for(const id of ['prop','warbird-prop','fighter','military','warbird-jet','bizjet','airliner','cargo']){
    const {f,o}=make(id,'KLCK');f.turnRate=1;f.pitchRate=1;
    assert.ok(o.retry(f));assert.equal(o.throttle,o.profile.approach/f.cfg.speeds.cruise);
    assert.equal(f.turnRate,0);assert.equal(f.pitchRate,0);assert.ok(f.agl>160&&f.agl<185);
    assert.ok(Math.abs(o.approachGuidance(f).vertical)<.001);
  }
});
test('guidance reads never advance ground routes and guidance-off still progresses',()=>{
  const {f,o}=make(),p=airportPoint(o.airport,...taxiRoute(o.airport)[1]);
  f.pos.set(p.x,p.y+o.profile.clearance,p.z);const before=o.routeIndex;
  for(let i=0;i<10;i++)o.guidanceTarget(f);assert.equal(o.routeIndex,before);
  o.guidance=false;run(o,f,.1);assert.equal(o.routeIndex,before+1);
});
test('reciprocal touchdown records its direction and accepts opposite-end displacement',()=>{
  const {f,o}=make('cargo','KLCK'),p=airportPoint(o.airport,100);
  f.pos.set(p.x,p.y+o.profile.clearance+.01,p.z);f.heading=airportFrame(o.airport).heading+Math.PI;
  f.speed=o.profile.approach;f.pitch=-.02;o.vy=-1;o.phase='approach';
  run(o,f,.1,{throttle:o.profile.approach/f.cfg.speeds.cruise});
  assert.equal(o.phase,'landingRoll');assert.equal(o.reverse,true);
});
test('airport terrain deformation preserves skirt depth instead of collapsing triangles',()=>{
  const p=airportPoint(airportById('KOSU'),530,180),g=new BufferGeometry();
  g.setAttribute('position',new Float32BufferAttribute([-1,0,-1,1,0,-1,1,0,1,-1,0,1,-1,-40,-1,1,-40,-1],3));
  g.setIndex([0,2,1,0,3,2,0,1,5,0,5,4]);
  const mesh=new Mesh(g,new MeshBasicMaterial());mesh.position.set(p.x,p.y+20,p.z);
  const map=new EventDispatcher(),release=installOperationsTerrain({object:mesh,map,_anchor:new Vector3()});
  assert.ok(Math.abs(g.attributes.position.getY(0)-g.attributes.position.getY(4)-40)<.001);
  const a=new Vector3(),b=new Vector3(),c=new Vector3();
  for(let i=0;i<g.index.count;i+=3){a.fromBufferAttribute(g.attributes.position,g.index.getX(i));b.fromBufferAttribute(g.attributes.position,g.index.getX(i+1));c.fromBufferAttribute(g.attributes.position,g.index.getX(i+2));assert.ok(b.sub(a).cross(c.sub(a)).lengthSq()>0);}
  release();g.dispose();mesh.material.dispose();
});
test('arrival guidance advances past a missed exit in either runway direction',()=>{
  for(const airport of OPERATIONS_AIRPORTS)for(const reverse of [false,true]){
    const {o,f}=make('prop',airport.id),length=airportFrame(airport).length,direction=reverse?-1:1;
    o.phase='landingRoll';o.reverse=reverse;o.routeIndex=0;f.speed=20;
    let p=airportPoint(airport,reverse?length-100:100);f.pos.set(p.x,p.y+o.profile.clearance,p.z);f.heading=airportFrame(airport).heading+(reverse?Math.PI:0);
    o.updateArrivalExit(f);const first=o.arrivalExit;assert.ok((first-(reverse?length-100:100))*direction>0);
    // Rolling fast past an exit cannot consume the turn marker.
    p=airportPoint(airport,first);f.pos.set(p.x,p.y+o.profile.clearance,p.z);run(o,f,.1,{throttle:0});assert.equal(o.routeIndex,0);
    o.phase='taxiIn';o.routeIndex=1;
    p=airportPoint(airport,first+direction*40);f.pos.set(p.x,p.y+o.profile.clearance,p.z);o.updateArrivalExit(f);
    assert.ok((o.arrivalExit-first)*direction>0);assert.equal(o.routeIndex,0);
    // Turning off the runway keeps the chosen connector stable.
    const chosen=o.arrivalExit;p=airportPoint(airport,chosen+direction*40,airport.taxiSide*(airport.width/2+5));f.pos.set(p.x,p.y+o.profile.clearance,p.z);o.routeIndex=1;o.updateArrivalExit(f);assert.equal(o.arrivalExit,chosen);
  }
});
test('scenery exclusions catch crossing edges and containing polygons without clearing neighbors',()=>{
  const airport=airportById('KOSU'),center=airportPoint(airport,750),frame={cx:center.x,cz:center.z,tileSpan:5000,mercX0:center.x-2500,mercYTop:-center.z+2500};
  const ring=coords=>coords.map(([s,c])=>{const p=airportPoint(airport,s,c);return {x:p.x-frame.mercX0,y:p.z+frame.mercYTop};});
  // No vertex or centroid lies on pavement in this long crossing footprint.
  assert.ok(operationsFootprint(ring([[300,-700],[320,-700],[320,240],[300,240]]),frame,5000));
  assert.ok(operationsFootprint(ring([[-100,-100],[1700,-100],[1700,300],[-100,300]]),frame,5000));
  assert.equal(operationsFootprint(ring([[300,-300],[320,-300],[320,-200],[300,-200]]),frame,5000),false);
});
test('slow taxi across a pavement edge keeps steering and can return without resetting',()=>{
  const {o,f}=make(),a=o.airport,frame=airportFrame(a),p=airportPoint(a,200,a.taxiOffset-9.9);
  f.pos.set(p.x,p.y+o.profile.clearance,p.z);f.heading=frame.heading-Math.PI/2;f.speed=3;
  o.phase='taxiOut';o.parkingBrake=false;
  const before=f.pos.clone();run(o,f,3,{powerPreset:1});
  assert.ok(f.pos.distanceTo(before)>5,'a low-speed edge must not become an invisible wall');
  assert.ok(f.speed>1,'the aircraft must retain enough motion to steer');
  const heading=f.heading;run(o,f,6,{turn:1});assert.ok(f.heading-heading>1,'steering remains responsive off pavement');
  assert.equal(o.phase,'taxiOut');assert.equal(o.takeoffs,0);
});
test('high-speed pavement excursions still fail instead of granting grass takeoffs',()=>{
  const {o,f}=make(),a=o.airport,p=airportPoint(a,200,a.taxiOffset-9.9);
  f.pos.set(p.x,p.y+o.profile.clearance,p.z);f.heading=airportFrame(a).heading-Math.PI/2;f.speed=20;
  o.phase='taxiOut';o.parkingBrake=false;run(o,f,.2,{throttle:1,pitch:1});
  assert.equal(o.phase,'crashed');assert.equal(o.takeoffs,0);
});
test('runway lineup is an explicit stationary assisted shortcut, never a takeoff',()=>{
  for(const reverse of [false,true]){
    const {o,f}=make();o.reverse=reverse;assert.ok(o.lineUp(f));
    assert.equal(o.assisted,true);assert.equal(o.parkingBrake,true);assert.equal(f.speed,0);assert.equal(o.takeoffs,0);
    assert.ok(o.takeoffStatus(f).aligned);assert.equal(o.takeoffStatus(f).reverse,reverse);
    assert.ok(o.startTakeoff(f));run(o,f,.1);assert.equal(o.phase,'takeoffRoll');
    run(o,f,20,{pitch:.7});assert.equal(o.phase,'airborne');assert.equal(o.takeoffs,1);
    assert.equal(o.lineUp(f),false);assert.equal(o.contactCount,0);
  }
});
test('takeoff action requires runway alignment and taxi reaches usable speed promptly',()=>{
  const {o,f}=make();assert.equal(o.startTakeoff(f),false);o.startTaxi();run(o,f,4);
  assert.ok(f.speed>3,'taxi should not spend twenty seconds crawling up to walking speed');
  assert.ok(f.speed<=o.profile.taxiSpeed);
  o.lineUp(f);f.heading+=Math.PI/2;assert.equal(o.startTakeoff(f),false);
});
test('go-around arrests a descent and climbs without inventing touchdown credit',()=>{
  const {o,f}=make();o.phase='approach';f.pos.y+=30;f.speed=o.profile.approach;f.pitch=-.2;o.vy=-5;
  const height=f.pos.y;assert.ok(o.goAround(f));run(o,f,3);
  assert.ok(f.pos.y>height+3);assert.equal(o.contactCount,0);assert.equal(o.lastTouchdown,null);
});
test('returning from cruise preserves entry speed and has a stable ownership band',()=>{
  const {o,f}=make();o.phase='airborne';o.lowSpeed=false;f.pos.y+=450;f.speed=30;o.throttle=0;
  o.advance(1/60,f,{});assert.ok(Math.abs(f.speed-30)<.01);assert.equal(o.lowSpeed,true);
  f.pos.y=f.groundElev+525;assert.equal(o.advance(1/60,f,{}),true);
  f.pos.y=f.groundElev+560;assert.equal(o.advance(1/60,f,{}),false);
  f.pos.y=f.groundElev+525;assert.equal(o.advance(1/60,f,{}),false);
});
console.log(`VERIFY: PASS (${checks} checks)`);
