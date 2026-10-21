import { Vector3 } from 'three';
import { projectAdventureWaypoint } from './adventure-guidance.mjs';
import { FEEL_ON, escortedHex } from './encounter-feel';
import { mercatorScale } from './coords';

export function createEncounterPainter(){
  const point=new Vector3();
  return(ctx,width,height,runtime,state,airDrop)=>{
    const a=runtime.encounters?.controller.active,target=runtime.encounters?.waypoint();
    if(!a||!target||state.phase!=='flying'||state.screen!=='flight'||state.cameraMode==='photo'||state.atlasOpen||state.logbookOpen||state.inspectHex||state.hangarOpen||state.adventureOpen)return;
    const {engine,flight,camera,origin}=runtime;if(!engine||!camera||!origin)return;
    // PLAY PASS (ENCOUNTER_FEEL): the escort card and the lock bracket already mark an escorted aircraft; a third ring would sit on its hull.
    if(FEEL_ON&&a.kind==='traffic'&&escortedHex(runtime)===a.hex)return;
    point.copy(engine.geoToWorld(target.lon,target.lat,target.altM));
    point.y-=airDrop(Math.hypot(point.x-flight.pos.x,point.z-flight.pos.z),point.y);point.x-=origin.anchor.x;point.z-=origin.anchor.z;
    const p=projectAdventureWaypoint(point,camera,width,height);if(!p)return;
    if(FEEL_ON){paintFeel(ctx,width,height,p,a,Math.hypot((point.x+origin.anchor.x-flight.pos.x)/mercatorScale(flight.latDeg),point.y-flight.pos.y,(point.z+origin.anchor.z-flight.pos.z)/mercatorScale(flight.latDeg)));return;}
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

/**
 * PLAY PASS (ENCOUNTER_FEEL): a marker you can find. The review followed
 * "Frame the Midtown skyline" from Nearby: a 9 px arrow at the screen edge,
 * then a thin 16 px ring with a 12 px label — no distance, nothing that grows
 * as you close. Now the ring glows in the experience's colour (amber for a
 * discovery, cyan for live traffic) and carries what to do and how far; off
 * screen the chevron is larger and says how far too.
 */
const FEEL_FONT='600 12px ui-sans-serif, system-ui, sans-serif';
function paintFeel(ctx,width,height,p,a,distM){
  const color=a.kind==='traffic'?'#4fe3ff':'#ffc561';
  const nm=distM/1852,dist=nm<0.1?`${Math.round(distM)} m`:nm<10?`${nm.toFixed(1)} nm`:`${Math.round(nm)} nm`;
  const what=a.kind==='traffic'?a.name:a.kind==='photo'?'Frame this view':!a.approached?'Approach':`Gate ${a.gate+1} of 5`;
  ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2.5;ctx.shadowColor=color;ctx.shadowBlur=10;
  if(p.onScreen){
    const t=(typeof performance==='undefined'?0:performance.now())/1000,r=(a.kind==='photo'?20:16)+Math.sin(t*2.4)*1.5;
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.stroke();
    ctx.beginPath();ctx.arc(p.x,p.y,2.6,0,Math.PI*2);ctx.fill();
    ctx.shadowBlur=0;ctx.font=FEEL_FONT;ctx.textAlign='center';ctx.textBaseline='middle';
    const text=`${what} · ${dist}`,w=ctx.measureText(text).width+18,y=p.y+r+18;
    ctx.fillStyle='rgba(5,9,19,.72)';capsule(ctx,p.x-w/2,y-11,w,22);ctx.fill();
    ctx.fillStyle='#eef5ff';ctx.fillText(text,p.x,y+.5);
  }else{
    const r=Math.min(width,height)*.36,cx=width/2+Math.cos(p.angle)*r,cy=height/2+Math.sin(p.angle)*r;
    ctx.translate(cx,cy);ctx.save();ctx.rotate(p.angle);
    ctx.beginPath();ctx.moveTo(15,0);ctx.lineTo(-8,-11);ctx.lineTo(-3,0);ctx.lineTo(-8,11);ctx.closePath();ctx.fill();ctx.restore();
    ctx.shadowBlur=0;ctx.font=FEEL_FONT;ctx.textAlign='center';ctx.textBaseline='middle';
    const ox=-Math.cos(p.angle)*30,oy=-Math.sin(p.angle)*26,w=ctx.measureText(dist).width+14;
    ctx.fillStyle='rgba(5,9,19,.72)';capsule(ctx,ox-w/2,oy-10,w,20);ctx.fill();
    ctx.fillStyle='#eef5ff';ctx.fillText(dist,ox,oy+.5);
  }
  ctx.restore();
}
function capsule(ctx,x,y,w,h){ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,w,h,h/2);else ctx.rect(x,y,w,h);}
