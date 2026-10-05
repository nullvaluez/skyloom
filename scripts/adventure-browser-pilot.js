// Inject through the supported browser CDP developer surface after assigning
// window.__reviewRoutes from the catalogue. Test helper only, never bundled.
// Uses input.read commands exclusively after the normal adventure launch.
// Stop restores the original input method. Does not write aircraft positions,
// simulation dt/speed, discovery progress, activities, medals or test flags.
window.__reviewPilot?.stop();
window.__reviewPilot=(()=>{
  const runtime=window.__fly,input=runtime.input,read=input.read;
  const clamp=v=>Math.max(-1,Math.min(1,v)),rad=Math.PI/180;
  let result=null,frames=[],minAgl=Infinity,last=performance.now(),started=last,route=null,activityId=null;
  input.read=function(){
    const cmd=read.call(input),a=runtime.adventures.controller.progress.active;
    if(!route||!a||!['flying','finish'].includes(a.status)||window.__flyStore.getState().phase!=='flying')return cmd;
    const now=performance.now();if(now-last<1000&&frames.length<100000)frames.push(now-last);last=now;
    const course=activityId?runtime.adventures.controller.offer():null;
    const p=runtime.engine.worldToGeo(runtime.flight.pos),f=runtime.flight,target=activityId?course?.points[runtime.adventures.controller.reading?.gate||0]:route.checkpoints[a.index];
    if(!target)return cmd;
    const dx=(target.lon-p.x)*111320*Math.cos(p.y*rad),dy=(target.lat-p.y)*111320;
    const error=((Math.atan2(dx,dy)-f.heading+3*Math.PI)%(2*Math.PI))-Math.PI;
    const maxTurn=f.cfg.maxYawRateDeg*2.2*rad*(f.speed>f.cfg.highSpeedTurnCutover?.5:1);
    const pitch=Math.atan2(target.altM-p.z,Math.max(250,Math.hypot(dx,dy)));
    minAgl=Math.min(minAgl,f.agl);
    return {...cmd,turn:clamp(error*.8/maxTurn),pitch:clamp((pitch-f.pitch)*1.5/(f.cfg.maxPitchRateDeg*rad)),speedPreset:'cruise',boost:false};
  };
  const timer=setInterval(()=>{
    const a=runtime.adventures.controller.progress.active;
    if(route&&(activityId?['complete','missed'].includes(a?.activities[activityId]):a?.status==='finish')){
      const sorted=frames.slice().sort((a,b)=>a-b);
      result={route:route.id,aircraft:a.aircraftId,activityId,activityResult:activityId?a.activities[activityId]:undefined,elapsed:a.elapsed,wallSec:(performance.now()-started)/1000,minAgl,p95:sorted[Math.floor(sorted.length*.95)],frames:sorted.length,hidden:document.hidden};
      route=null;window.__flyStore.getState().setPhase('paused');
    }
  },250);
  return {
    start(id,aircraftId,conditions='curated'){
      route=window.__reviewRoutes.find(r=>r.id===id);activityId=null;frames=[];result=null;minAgl=Infinity;started=last=performance.now();
      return runtime.adventures.start(id,{aircraftId,conditions});
    },
    activity(id){
      route=window.__reviewRoutes.find(r=>r.id===runtime.adventures.controller.progress.active?.id);activityId=id;frames=[];result=null;minAgl=Infinity;started=last=performance.now();
      return runtime.adventures.retryActivity(id);
    },
    resume(){
      route=window.__reviewRoutes.find(r=>r.id===runtime.adventures.controller.progress.active?.id);activityId=null;frames=[];result=null;minAgl=Infinity;started=last=performance.now();
      return runtime.adventures.resume();
    },
    report(){return {result,active:runtime.adventures.controller.progress.active,frames:frames.length,hidden:document.hidden};},
    stop(){clearInterval(timer);input.read=read;delete window.__reviewPilot;},
  };
})();
