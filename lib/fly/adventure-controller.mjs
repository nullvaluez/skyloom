import { adventureById, COLLECTION_REWARDS, distanceM, LIVERIES } from './adventures.mjs';
export const emptyProgress = () => ({active:null,completed:{},rewards:[],liveries:{},interest:null});
export function validateProgress(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))return emptyProgress();
  const result=emptyProgress();
  for(const [id,c] of Object.entries(input.completed||{}))if(adventureById(id)&&c&&Number.isInteger(c.medal)&&c.medal>=1&&c.medal<=3)result.completed[id]={medal:c.medal,at:Number.isFinite(c.at)?c.at:0};
  const earned=Object.keys(result.completed).map(id=>adventureById(id).reward);
  for(const r of COLLECTION_REWARDS)if(Object.keys(result.completed).length>=r.count)earned.push(r.aircraftId);
  result.rewards=[...new Set(earned)];
  for(const id of result.rewards)if(input.liveries?.[id]==='earned')result.liveries[id]='earned';
  if(['yes','maybe','no'].includes(input.interest))result.interest=input.interest;
  const a=input.active;
  if(a&&adventureById(a.id)&&Number.isInteger(a.index)&&a.index>=0&&a.index<=4){
    result.active={id:a.id,index:a.index,photo:a.photo===true,steady:a.steady===true,status:a.index===4?'finish':'paused',elapsed:Math.max(0,Math.min(86400,Number(a.elapsed)||0))};
  }
  return result;
}
// Renderer/storage independent. Points are checked along the flown segment so
// high-speed flight cannot tunnel through a checkpoint. Epoch changes never score.
export class AdventureController {
  constructor(progress=emptyProgress(),publish=()=>{},event=()=>{}) {this.progress=validateProgress(progress);this.publish=publish;this.event=event;this.previous=null;this.steadySec=0;this.epoch=null;}
  change(){this.publish({...this.progress});}
  start(id){if(!adventureById(id))return false;this.progress.active={id,index:0,photo:false,steady:false,status:'flying',elapsed:0};this.reset();this.event('adventure_started',{adventureId:id});this.change();return true;}
  reset(){this.previous=null;this.steadySec=0;this.epoch=null;}
  pause(reason='paused'){const a=this.progress.active;if(!a||a.status==='finish')return; a.status=reason;this.previous=null;this.change();}
  resume(){const a=this.progress.active;if(!a)return false;a.status=a.index===4?'finish':'flying';this.reset();this.change();return true;}
  retry(){if(!this.progress.active)return false;this.event('adventure_retried',{adventureId:this.progress.active.id});return this.resume();}
  abandon(){this.progress.active=null;this.reset();this.change();}
  photo(position){const a=this.progress.active,route=adventureById(a?.id);if(!route||!['flying','finish'].includes(a.status)||!position)return false;
    if(!route.checkpoints.some(p=>distanceM(position,p)<1500))return false;
    if(!a.photo){a.photo=true;this.change();}return true;}
  tick(dt,position,{epoch=0,held=false,bank=0,speed=0,crashed=false}={}) {
    const a=this.progress.active;if(!a||a.status!=='flying')return;
    if(crashed){this.pause('retry');return;}
    if(this.epoch!=null&&epoch!==this.epoch){this.pause('retry');return;}this.epoch=epoch;
    if(held||!position||![position.lat,position.lon,position.altM].every(Number.isFinite)){this.previous=null;this.steadySec=0;return;}
    const elapsed=Number.isFinite(dt)?Math.max(0,Math.min(dt,.5)):0;a.elapsed+=elapsed;
    this.steadySec=Math.abs(bank)<.18&&speed>15?this.steadySec+elapsed:0;
    if(this.steadySec>=30&&!a.steady){a.steady=true;this.change();}
    const target=adventureById(a.id).checkpoints[a.index];
    const p=this.previous||position;
    if(distanceM(p,position)>Math.max(1200,speed*Math.max(dt,.1)*2)){this.pause('retry');return;}
    const k=111320*Math.cos(target.lat*Math.PI/180);
    const ax=(p.lon-target.lon)*k,ay=(p.lat-target.lat)*111320,bx=(position.lon-target.lon)*k,by=(position.lat-target.lat)*111320;
    const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
    const alt=p.altM+(position.altM-p.altM)*t;
    if(Math.hypot(ax+t*dx,ay+t*dy)<=target.radiusM&&Math.abs(alt-target.altM)<=900){
      a.index++;this.event('adventure_checkpoint',{adventureId:a.id,checkpoint:a.index});
      if(a.index===4)a.status='finish';this.change();
    }
    this.previous={...position};
  }
  complete(now=Date.now()) {
    const a=this.progress.active;if(!a||a.index!==4)return null;
    const route=adventureById(a.id),medal=1+Number(a.photo)+Number(a.steady),old=this.progress.completed[a.id];
    this.progress.completed={...this.progress.completed,[a.id]:{medal:Math.max(medal,old?.medal||0),at:old?.at||now}};
    const rewards=new Set(this.progress.rewards);rewards.add(route.reward);
    for(const r of COLLECTION_REWARDS)if(Object.keys(this.progress.completed).length>=r.count)rewards.add(r.aircraftId);
    const fresh=[...rewards].filter(id=>!this.progress.rewards.includes(id));this.progress.rewards=[...rewards];
    const summary={id:a.id,medal,elapsed:a.elapsed,rewards:fresh};this.progress.active=null;this.reset();this.change();
    this.event('adventure_completed',{adventureId:a.id,medal});for(const id of fresh)this.event('reward_claimed',{rewardId:LIVERIES[id].name.toLowerCase().replaceAll(' ','-')});return summary;
  }
}
