import { adventureById, COLLECTION_REWARDS, LIVERIES } from './adventures.mjs';
import { activityCourse } from './adventure-activities.mjs';
import { crossesGate, distanceM, segmentClosest, validAircraft } from './adventure-geometry.mjs';

export const emptyProgress = () => ({active:null,completed:{},rewards:[],liveries:{},records:{},interest:null});
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const elapsed=v=>Math.max(0,Math.min(86400,Number(v)||0));
const conditions=v=>v==='live'?'live':'curated';
function activityResults(route,input={}) {
  return Object.fromEntries(route.activities.map(a=>[a.id,['complete','missed','skipped'].includes(input?.[a.id])?input[a.id]:'available']));
}
export function validateProgress(input) {
  if(!object(input))return emptyProgress();
  const result=emptyProgress();
  for(const [id,c] of Object.entries(object(input.completed)?input.completed:{}))if(adventureById(id)&&c&&Number.isInteger(c.medal)&&c.medal>=1&&c.medal<=3)result.completed[id]={medal:c.medal,at:Number.isFinite(c.at)?c.at:0};
  const earned=Object.keys(result.completed).map(id=>adventureById(id).reward);
  for(const r of COLLECTION_REWARDS)if(Object.keys(result.completed).length>=r.count)earned.push(r.aircraftId);
  result.rewards=[...new Set(earned)];
  for(const id of result.rewards)if(input.liveries?.[id]==='earned')result.liveries[id]='earned';
  if(['yes','maybe','no'].includes(input.interest))result.interest=input.interest;
  for(const [key,r] of Object.entries(object(input.records)?input.records:{})){
    const [routeId,aircraftId,mode]=key.split('|'),route=adventureById(routeId);
    if(route&&validAircraft(aircraftId)&&['curated','live'].includes(mode)&&object(r))result.records[key]={activities:activityResults(route,r.activities),elapsed:elapsed(r.elapsed)};
  }
  const a=input.active,route=adventureById(a?.id);
  if(route&&Number.isInteger(a.index)&&a.index>=0&&a.index<=route.checkpoints.length){
    result.active={id:a.id,index:a.index,aircraftId:validAircraft(a.aircraftId)?a.aircraftId:route.aircraftId,conditions:conditions(a.conditions),
      activities:activityResults(route,a.activities),status:a.index===route.checkpoints.length?'finish':'paused',elapsed:elapsed(a.elapsed)};
  }
  return result;
}

// Pure controller. Continuous measurements stay out of React and storage.
export class AdventureController {
  constructor(progress=emptyProgress(),publish=()=>{},event=()=>{}) {
    this.progress=validateProgress(progress);this.publish=publish;this.event=event;this.runToken=0;this.reset();
  }
  change(){this.publish({...this.progress});}
  start(id,options={}) {
    const route=adventureById(id);if(!route)return false;
    this.progress.active={id,index:0,aircraftId:validAircraft(options.aircraftId)?options.aircraftId:route.aircraftId,conditions:conditions(options.conditions),activities:activityResults(route),status:'flying',elapsed:0};
    this.runToken++;this.reset();this.event('adventure_started',{adventureId:id});this.change();return true;
  }
  reset(){this.previous=null;this.epoch=null;this.attempt=null;this.reading=null;this.replayId=null;}
  pause(reason='paused') {
    const a=this.progress.active;if(!a)return;
    if(this.attempt)a.activities[this.attempt.id]='available';
    a.status=reason;
    this.reset();this.change();
  }
  resume(){const a=this.progress.active;if(!a)return false;for(const id of Object.keys(a.activities))if(a.activities[id]==='active')a.activities[id]='available';a.status=a.index===adventureById(a.id).checkpoints.length?'finish':'flying';this.runToken++;this.reset();this.change();return true;}
  retry(){if(!this.progress.active)return false;this.event('adventure_retried',{adventureId:this.progress.active.id});return this.resume();}
  retryActivity(id) {
    const a=this.progress.active,route=adventureById(a?.id);
    if(!route?.activities.some(x=>x.id===id)||a.activities[id]==='complete')return false;
    this.resume();a.activities[id]='available';this.replayId=id;this.change();return true;
  }
  skipActivity(id) {
    const a=this.progress.active;if(!a||!(id in a.activities)||a.activities[id]==='complete')return;
    a.activities[id]='skipped';this.attempt=null;this.reading=null;this.replayId=null;this.change();
  }
  abandon(){this.progress.active=null;this.runToken++;this.reset();this.change();}
  offer() {
    const a=this.progress.active,route=adventureById(a?.id);if(!route)return null;
    const activity=route.activities.find(x=>x.id===(this.attempt?.id||this.replayId))||route.activities.find(x=>a.activities[x.id]==='available'&&a.index>=x.unlockIndex&&a.index<=x.expiresIndex);
    return activity?activityCourse(route,a.aircraftId,activity.id):null;
  }
  recordActivity(id) {
    const a=this.progress.active,route=adventureById(a?.id);
    if(!route||a.activities[id]==='complete')return;
    a.activities[id]='complete';
    const key=[a.id,a.aircraftId,a.conditions].join('|');
    const record=this.progress.records[key],activities=activityResults(route,record?.activities);
    activities[id]='complete';
    this.progress.records={...this.progress.records,[key]:{activities,elapsed:a.elapsed}};
    this.event('activity_complete',{adventureId:a.id,activityId:id});this.change();
  }
  photo(frame) {
    const a=this.progress.active,route=adventureById(a?.id);
    if(!route||!['flying','finish'].includes(a.status)||!frame||frame.runToken!==this.runToken||frame.epoch!==this.epoch)return false;
    const target=route.activities.find(x=>x.kind==='photo'),course=activityCourse(route,a.aircraftId,target.id);
    if(a.index<target.unlockIndex&&this.replayId!==target.id||frame.targetId!==target.id||!frame.visible||!frame.position||!Number.isFinite(frame.x)||!Number.isFinite(frame.y)||Math.abs(frame.x)>.78||Math.abs(frame.y)>.72)return false;
    const distance=distanceM(frame.position,target.target);
    if(distance<100||distance>course.photoRangeM)return false;
    if(this.replayId===target.id)this.replayId=null;
    this.recordActivity(target.id);
    return true;
  }
  tick(dt,position,{epoch=0,held=false,speed=0,crashed=false}={}) {
    const a=this.progress.active;if(!a||!['flying','finish'].includes(a.status))return;
    if(crashed||this.epoch!=null&&epoch!==this.epoch){this.pause('retry');return;}this.epoch=epoch;
    if(held||!position||![position.lat,position.lon,position.altM].every(Number.isFinite)){this.previous=null;return;}
    const seconds=Number.isFinite(dt)?Math.max(0,Math.min(dt,.5)):0;a.elapsed+=seconds;
    const p=this.previous||position,route=adventureById(a.id);
    if(distanceM(p,position)>Math.max(1200,speed*Math.max(dt,.1)*2)){this.pause('retry');return;}
    if(a.index<route.checkpoints.length&&!this.replayId){
      const target=route.checkpoints[a.index],closest=segmentClosest(p,position,target);
      if(closest.distance<=target.radiusM&&Math.abs(closest.altM-target.altM)<=900){
        a.index++;if(a.index===route.checkpoints.length)a.status='finish';
        this.event('adventure_checkpoint',{adventureId:a.id,checkpoint:a.index});this.change();
      }
    }
    for(const activity of route.activities)if(a.index>activity.expiresIndex&&a.activities[activity.id]==='available'&&this.replayId!==activity.id){a.activities[activity.id]='skipped';this.change();}
    const course=this.offer();
    if(course&&course.kind!=='photo'){
      let attempt=this.attempt;
      if(!attempt&&crossesGate(p,position,course.points[0],course.headings[0],course.gateRadiusM,course.altitudeToleranceM)){
        attempt=this.attempt={id:course.id,gate:1,outsideSec:0};a.activities[course.id]='active';
        this.event('activity_started',{adventureId:a.id,activityId:course.id});this.change();
      }
      if(attempt){
        const gate=course.points[attempt.gate],last=course.points[attempt.gate-1];
        const closest=segmentClosest(last,gate,position);
        const inCorridor=closest.distance<=course.gateRadiusM*1.6&&Math.abs(position.altM-closest.altM)<=course.altitudeToleranceM;
        attempt.outsideSec=inCorridor?0:attempt.outsideSec+seconds;
        this.reading={id:course.id,progress:attempt.gate/course.points.length,gate:attempt.gate,inside:inCorridor};
        // One fast frame may cross several ordered gates. Keep the swept
        // segment, rather than dropping later crossings until the next frame.
        while(attempt.gate<course.points.length&&crossesGate(p,position,course.points[attempt.gate],course.headings[attempt.gate],course.gateRadiusM,course.altitudeToleranceM))attempt.gate++;
        if(attempt.gate===course.points.length){
          this.attempt=null;this.reading=null;this.replayId=null;
          this.recordActivity(course.id);
        }else if(attempt.outsideSec>3){
          a.activities[course.id]='missed';this.attempt=null;this.reading=null;this.replayId=null;
          this.event('activity_missed',{adventureId:a.id,activityId:course.id});this.change();
        }
      }
    }
    this.previous={...position};
  }
  complete(now=Date.now()) {
    const a=this.progress.active,route=adventureById(a?.id);if(!route||a.index!==route.checkpoints.length)return null;
    const count=Object.values(a.activities).filter(x=>x==='complete').length,medal=count===3?3:count>=2?2:1,old=this.progress.completed[a.id];
    this.progress.completed={...this.progress.completed,[a.id]:{medal:Math.max(medal,old?.medal||0),at:old?.at||now}};
    const key=[a.id,a.aircraftId,a.conditions].join('|'),previous=this.progress.records[key];
    const activities=Object.fromEntries(route.activities.map(x=>[x.id,a.activities[x.id]==='complete'||previous?.activities[x.id]==='complete'?'complete':a.activities[x.id]]));
    this.progress.records={...this.progress.records,[key]:{activities,elapsed:a.elapsed}};
    const rewards=new Set(this.progress.rewards);rewards.add(route.reward);
    for(const r of COLLECTION_REWARDS)if(Object.keys(this.progress.completed).length>=r.count)rewards.add(r.aircraftId);
    const fresh=[...rewards].filter(id=>!this.progress.rewards.includes(id));this.progress.rewards=[...rewards];
    const summary={id:a.id,aircraftId:a.aircraftId,conditions:a.conditions,activities:{...a.activities},medal,elapsed:a.elapsed,rewards:fresh};
    this.progress.active=null;this.runToken++;this.reset();this.change();
    this.event('adventure_completed',{adventureId:a.id,medal});for(const id of fresh)this.event('reward_claimed',{rewardId:LIVERIES[id].name.toLowerCase().replaceAll(' ','-')});return summary;
  }
}
