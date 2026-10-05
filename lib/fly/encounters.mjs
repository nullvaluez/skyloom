import { ADVENTURES } from './adventures.mjs';
import { activityCourse } from './adventure-activities.mjs';
import { adventureEnvelope, bearingDeg, crossesGate, distanceM } from './adventure-geometry.mjs';
import { TARGETING } from './fly-constants.js';

export const ENCOUNTER_KEY='fly-encounters-v1';
export const ENCOUNTER_LIMITS=Object.freeze({offerSec:12,cooldownSec:180,holdSec:30,maxSec:600,maxMemories:200});
export const LOCAL_DISCOVERIES=ADVENTURES.flatMap(route=>[route.activities[0],route.activities[2]].map(activity=>({
  id:activity.id,routeId:route.id,kind:activity.kind==='photo'?'photo':'course',name:activity.name,place:route.place,
  description:activity.instruction,source:'Skyloom discovery',
})));
const emergency=new Set(['7500','7600','7700']);
const angle=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
const validPosition=p=>p&&[p.lat,p.lon,p.altM].every(Number.isFinite)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;

export function liveCandidate(track,flight) {
  const fix=track?.fix1,speed=Math.hypot(fix?.vE,fix?.vN),cfg=flight?.cfg;
  if(!fix||!cfg||track.stale!==0||track.flags&1||track.opacity<.5||emergency.has(String(track.meta?.squawk))||
    !Number.isFinite(track.distM)||track.distM>6000||speed<cfg.speeds.slow*.65||speed>cfg.speeds.boost*.9)return null;
  const closing=cfg.speeds.boost-speed;
  if(track.distM>TARGETING.interceptHandoffM&&track.distM/Math.max(1,closing)>120)return null;
  return {id:`live:${track.hex}`,kind:'traffic',hex:track.hex,name:String(track.meta?.flight||track.meta?.r||track.hex).trim(),
    description:'Share a stretch of sky. Stay alongside for 30 seconds.',source:'Live traffic',distanceM:track.distM};
}

export function localCandidates(position,aircraftId,elevationAt) {
  if(!validPosition(position)||typeof elevationAt!=='function')return [];
  const envelope=adventureEnvelope(aircraftId),out=[];
  for(const discovery of LOCAL_DISCOVERIES){
    const route=ADVENTURES.find(r=>r.id===discovery.routeId),course=activityCourse(route,aircraftId,discovery.id);
    const distance=distanceM(position,course.approach);
    if(distance>Math.min(16000,envelope.speed*180)||course.approach.altM>envelope.ceiling||
      Math.abs(position.altM-course.approach.altM)>Math.max(1000,distance*.3))continue;
    // No requests here. Unknown DEM is not permission to offer a course.
    const points=[course.approach,...course.points];
    let safe=true;
    for(let i=0;i<points.length&&safe;i++){
      const a=i?points[i-1]:position,b=points[i];
      for(let n=0;n<=8;n++){
        const t=n/8,p={lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+(b.lon-a.lon)*t,altM:a.altM+(b.altM-a.altM)*t};
        const ground=elevationAt(p.lon,p.lat);
        if(!Number.isFinite(ground)||p.altM-ground<150){safe=false;break;}
      }
    }
    if(safe)out.push({...discovery,distanceM:distance,course});
  }
  return out;
}

/** Discrete lifecycle; continuous timers/positions never enter React or storage. */
export class EncounterController {
  constructor(publish=()=>{},remember=()=>{}) {
    this.publish=publish;this.remember=remember;this.clock=0;this.lastOffer=-150;
    this.candidates=[];this.offer=null;this.active=null;this.result=null;this.token=0;this.seen=new Set();this.epoch=null;
  }
  snapshot(){return {offer:this.offer,active:this.active?{...this.active,course:undefined}:null,result:this.result,candidates:this.candidates.map(c=>({...c,course:undefined}))};}
  change(){this.publish(this.snapshot());}
  scan(candidates,enabled,blocked){
    const next=candidates.filter(c=>!this.seen.has(c.id)).sort((a,b)=>Number(!!b.selected)-Number(!!a.selected)||a.distanceM-b.distanceM).slice(0,5);
    const signature=next.map(c=>c.id).join('|'),changed=signature!==this.candidates.map(c=>c.id).join('|');
    this.candidates=next;
    if(this.offer&&!next.some(c=>c.id===this.offer.id)){this.offer=null;this.change();}
    if(!this.active&&!this.offer&&enabled&&!blocked&&next.length&&this.clock-this.lastOffer>=ENCOUNTER_LIMITS.cooldownSec){
      this.offer={...next[0],course:undefined};this.offerAt=this.clock;this.lastOffer=this.clock;this.result=null;this.change();
    }else if(changed)this.change();
  }
  accept(id,context){
    const candidate=this.candidates.find(c=>c.id===id);
    if(!candidate||context.blocked||this.active)return false;
    this.active={...candidate,token:++this.token,aircraftId:context.aircraftId,epoch:context.epoch,elapsed:0,hold:0,gate:0,approached:false,photoRef:null};
    this.previous=null;this.offer=null;this.result=null;this.lastOffer=this.clock;this.change();return true;
  }
  dismiss(){if(this.offer)this.seen.add(this.offer.id);this.offer=null;this.change();}
  end(message='Encounter ended. Keep exploring.'){
    if(this.active)this.seen.add(this.active.id);
    this.active=null;this.offer=null;this.previous=null;this.result=message;this.resultAt=this.clock;++this.token;this.lastOffer=this.clock;this.change();
  }
  complete(context){
    const a=this.active;if(!a||!validPosition(context.position))return;
    const meta=context.track?.meta;
    this.remember({id:`${Date.now()}-${a.token}-${a.id}`,kind:a.kind,name:a.name,place:a.place||'Crossing paths',at:Date.now(),
      aircraftId:a.aircraftId,position:{...context.position},encounterId:a.id,
      traffic:a.kind==='traffic'?{hex:a.hex,flight:meta?.flight||null,type:meta?.t||null,registration:meta?.r||null}:null,photoRef:a.photoRef});
    this.end('Flight memory saved in your logbook.');
  }
  tick(dt,context){
    const delta=Math.min(.5,Math.max(0,dt||0));
    if(this.epoch!==null&&this.epoch!==context.epoch){this.end('A new place, a fresh sky.');this.candidates=[];this.seen.clear();}
    this.epoch=context.epoch;
    if(context.exclusive||context.crashed){if(this.active||this.offer)this.end('Keep exploring when you return to free flight.');return;}
    if(context.held){this.previous=null;return;}
    this.clock+=delta;
    if(this.result&&this.clock-this.resultAt>8){this.result=null;this.change();}
    if(this.offer&&this.clock-this.offerAt>=ENCOUNTER_LIMITS.offerSec)this.dismiss();
    const a=this.active;if(!a)return;
    if(a.aircraftId!==context.aircraftId){this.end();return;}
    a.elapsed+=delta;
    if(a.elapsed>ENCOUNTER_LIMITS.maxSec){this.end('The moment has passed. More discoveries await.');return;}
    if(a.kind==='traffic'){
      const t=context.track;
      if(!t||t.stale>=2||t.flags&1||emergency.has(String(t.meta?.squawk))){this.end('Live contact unavailable. Keep exploring.');return;}
      const alongside=t.stale===0&&t.distM>=60&&t.distM<=TARGETING.interceptHandoffM&&Math.abs(t.ryd-context.altM)<120&&angle(context.heading,t.yaw)<Math.PI/4;
      a.hold=alongside?a.hold+delta:0;
      const seconds=Math.floor(a.hold);if(seconds!==a.seconds||a.stale!==(t.stale!==0)){a.seconds=seconds;a.stale=t.stale!==0;this.change();}
      if(a.hold>=ENCOUNTER_LIMITS.holdSec)this.complete(context);
      return;
    }
    const position=context.position;if(!validPosition(position))return;
    const course=a.course;
    if(!Number.isFinite(context.agl)||context.agl<150){this.previous=null;return;}
    if(a.kind==='photo')return;
    const p=this.previous||position;
    // Warps not marked by an epoch must not sweep through every gate.
    if(distanceM(p,position)>Math.max(1200,context.speed*delta*2)){this.end();return;}
    if(!a.approached&&distanceM(position,course.approach)<course.gateRadiusM*2&&Math.abs(position.altM-course.approach.altM)<course.altitudeToleranceM){a.approached=true;this.change();}
    if(a.approached&&crossesGate(p,position,course.points[a.gate],course.headings[a.gate],course.gateRadiusM,course.altitudeToleranceM)){
      a.gate++;this.change();if(a.gate===course.points.length){this.complete(context);return;}
    }
    this.previous={...position};
  }
  waypoint(){const a=this.active;if(!a||a.kind==='traffic')return null;return a.kind==='photo'?a.course.target:!a.approached?a.course.approach:a.course.points[a.gate];}
  guidance(position){const point=this.waypoint();return point&&position?{point,bearing:Math.round(bearingDeg(position,point)),distanceM:distanceM(position,point)}:null;}
  photo(frame,context){
    const a=this.active;
    if(!a||!frame||![frame.x,frame.y,frame.distanceM].every(Number.isFinite)||frame.token!==a.token||frame.epoch!==a.epoch||context.epoch!==a.epoch||!frame.visible||!frame.knownTerrain||
      Math.abs(frame.x)>.78||Math.abs(frame.y)>.72||frame.distanceM>(a.kind==='traffic'?1500:a.course.photoRangeM)||context.exclusive)return false;
    if(a.kind==='photo')this.complete({...context,position:frame.position});
    return true;
  }
}

/** Whitelist every persisted field; imported data never becomes store actions. */
export function validateEncounterSave(value) {
  if(value?.version!==1||!Array.isArray(value.memories)||value.memories.length>ENCOUNTER_LIMITS.maxMemories)throw Error('Invalid flight memories.');
  const str=v=>typeof v==='string'&&v.length<=180;
  const nullable=v=>v===null||str(v);
  const memories=value.memories.map(m=>{
    if(!m||!['traffic','course','photo'].includes(m.kind)||!['id','name','place','aircraftId','encounterId'].every(k=>str(m[k]))||
      !Number.isFinite(m.at)||!validPosition(m.position)||!nullable(m.photoRef)||m.photoRef!==null&&!/^memory-[a-z0-9-]+$/i.test(m.photoRef))throw Error('Invalid flight memory.');
    let traffic=null;
    if(m.kind==='traffic'){
      if(!m.traffic||!str(m.traffic.hex)||!['flight','type','registration'].every(k=>nullable(m.traffic[k])))throw Error('Invalid observed aircraft.');
      traffic=Object.fromEntries(['hex','flight','type','registration'].map(k=>[k,m.traffic[k]]));
    }
    return Object.fromEntries(['id','kind','name','place','aircraftId','encounterId','at','photoRef'].map(k=>[k,m[k]]).concat([
      ['position',{lat:m.position.lat,lon:m.position.lon,altM:m.position.altM}],['traffic',traffic],
    ]));
  });
  return {version:1,memories};
}
