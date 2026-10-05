import { Vector3 } from 'three';
import { projectAdventureWaypoint } from './adventure-guidance.mjs';

export function createEncounterPainter(){
  const point=new Vector3();
  return(ctx,width,height,runtime,state,airDrop)=>{
    const a=runtime.encounters?.controller.active,target=runtime.encounters?.waypoint();
    if(!a||!target||state.phase!=='flying'||state.screen!=='flight'||state.cameraMode==='photo'||state.atlasOpen||state.logbookOpen||state.inspectHex||state.hangarOpen||state.adventureOpen)return;
    const {engine,flight,camera,origin}=runtime;if(!engine||!camera||!origin)return;
    point.copy(engine.geoToWorld(target.lon,target.lat,target.altM));
    point.y-=airDrop(Math.hypot(point.x-flight.pos.x,point.z-flight.pos.z),point.y);point.x-=origin.anchor.x;point.z-=origin.anchor.z;
    const p=projectAdventureWaypoint(point,camera,width,height);if(!p)return;
    ctx.save();ctx.strokeStyle='#afd7cd';ctx.fillStyle='#afd7cd';ctx.lineWidth=2;
    if(p.onScreen){
      ctx.beginPath();ctx.arc(p.x,p.y,a.kind==='photo'?16:12,0,Math.PI*2);ctx.stroke();
      ctx.font='12px system-ui';ctx.textAlign='center';ctx.fillText(a.kind==='traffic'?a.name:a.kind==='photo'?'Frame this view':!a.approached?'Approach':`Gate ${a.gate+1}`,p.x,p.y+30);
    }else{
      const r=Math.min(width,height)*.32;ctx.translate(width/2+Math.cos(p.angle)*r,height/2+Math.sin(p.angle)*r);ctx.rotate(p.angle);
      ctx.beginPath();ctx.moveTo(9,0);ctx.lineTo(-5,-6);ctx.lineTo(-5,6);ctx.closePath();ctx.fill();
    }
    ctx.restore();
  };
}
