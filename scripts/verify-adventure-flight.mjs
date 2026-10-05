// Control-driven flight-model rehearsal. No teleports after each authored
// approach, no manual progress writes, no speed or handling overrides.
// This proves steering feasibility, not live DEM clearance or player enjoyment.
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./_node-resolve.mjs',import.meta.url);
const {FlightModel}=await import('../lib/fly/flight-model.js');
const {FLIGHT,HANGAR}=await import('../lib/fly/fly-constants.js');
const {ADVENTURES,checkpointStart}=await import('../lib/fly/adventures.mjs');
const {AdventureController}=await import('../lib/fly/adventure-controller.mjs');
const {activityCourse,adventureMinutes}=await import('../lib/fly/adventure-activities.mjs');
const {ADVENTURE_AIRCRAFT_IDS,bearingDeg,distanceM}=await import('../lib/fly/adventure-geometry.mjs');
const rad=Math.PI/180,clamp=v=>Math.max(-1,Math.min(1,v));
function flightAt(p,id){
  const f=new FlightModel({...FLIGHT,...HANGAR.byId[id]?.flight});
  f.pos.set(0,p.altM,0);f.heading=p.headingDeg*rad;f.latDeg=p.lat;
  return f;
}
function geo(f,start){return {lat:start.lat-f.pos.z*Math.cos(start.lat*rad)/111320,lon:start.lon+f.pos.x/111320,altM:f.pos.y};}
function steer(f,p,target){
  const error=((bearingDeg(p,target)*rad-f.heading+3*Math.PI)%(2*Math.PI))-Math.PI;
  const maxTurn=f.cfg.maxYawRateDeg*2.2*rad*(f.speed>f.cfg.highSpeedTurnCutover?.5:1);
  const desiredPitch=Math.atan2(target.altM-p.altM,Math.max(250,distanceM(p,target)));
  return {turn:clamp(error*.8/maxTurn),pitch:clamp((desiredPitch-f.pitch)*1.5/(f.cfg.maxPitchRateDeg*rad)),speedPreset:'cruise',boost:false};
}
const rows=[],durationFailures=[];
for(const route of ADVENTURES)for(const id of ADVENTURE_AIRCRAFT_IDS){
  const c=new AdventureController();c.start(route.id,{aircraftId:id});
  const start=checkpointStart(route,0,id),f=flightAt(start,id);
  let seconds=0,first=null;
  for(;seconds<1800&&c.progress.active.index<route.checkpoints.length;seconds+=1/30){
    const p=geo(f,start),target=route.checkpoints[c.progress.active.index];
    f.step(1/30,steer(f,p,target));c.tick(1/30,geo(f,start),{speed:f.speed});
    if(c.progress.active.index&&first===null)first=seconds;
  }
  assert.equal(c.progress.active.index,route.checkpoints.length,`${route.id}/${id}: discoveries`);
  assert.ok(first>=20&&first<=40,`${route.id}/${id}: first discovery ${first}`);
  assert.ok(Math.abs(seconds/60-adventureMinutes(route,id))<1.5,`${route.id}/${id}: estimate vs ${seconds/60}`);
  if(id===route.aircraftId&&!(seconds>=300&&seconds<=600))durationFailures.push(`${route.id}: recommended duration ${seconds}s`);
  for(const activity of route.activities.filter(a=>a.kind!=='photo')){
    const course=activityCourse(route,id,activity.id),entry=course.approach,plane=flightAt(entry,id);
    c.retryActivity(course.id);
    let time=0;
    for(;time<1800&&c.progress.active.activities[activity.id]!=='complete';time+=1/30){
      const gate=c.reading?.gate||0,target=course.points[gate];
      const p=geo(plane,entry);plane.step(1/30,steer(plane,p,target));
      c.tick(1/30,geo(plane,entry),{speed:plane.speed});
      if(c.progress.active.activities[activity.id]==='missed')break;
    }
    assert.equal(c.progress.active.activities[activity.id],'complete',`${route.id}/${id}/${activity.name}: gate ${c.reading?.gate}, ${time.toFixed(1)}s`);
  }
  rows.push({route:route.id,aircraft:id,first:Math.round(first),minutes:+(seconds/60).toFixed(2)});
}
console.log(JSON.stringify(rows,null,2));
assert.deepEqual(durationFailures,[]);
console.log('PASS: 54 complete journeys + 108 activity courses using unchanged FlightModel controls. Terrain not simulated.');
