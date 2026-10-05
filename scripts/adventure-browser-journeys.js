// Optional live-world review queue. Requires the reversible control-only pilot.
// No route progress, poses, physics rates or graphics settings are overwritten.
window.__reviewJourneys=(()=>{
  const queue=window.__reviewRoutes.filter(r=>r.id!=='canyon-discovery').flatMap(r=>[
    [r.id,r.aircraftId],...(r.id==='manhattan-skyline'?[[r.id,r.aircraftId,r.id+':line']]:[]),
  ]);
  queue.push(['canyon-discovery','airliner'],['canyon-discovery','fighter']);
  const rows=[];let current=null,started=0,phase='idle';
  function next(){
    current=queue.shift();
    if(!current){phase='done';return;}
    started=performance.now();phase='flying';
    if(current[2])window.__reviewPilot.activity(current[2]);else window.__reviewPilot.start(current[0],current[1]);
  }
  const timer=setInterval(()=>{
    if(phase!=='flying')return;
    const report=window.__reviewPilot.report();
    if(report.result){
      rows.push(report.result);
      if(report.result.activityResult==='missed'){phase='failed';return;}
      if(!queue[0]?.[2])window.__fly.adventures.complete();
      next();
    }
    else if(report.active?.status==='retry'||performance.now()-started>1200000){
      rows.push({route:current[0],aircraft:current[1],failed:true,active:report.active});phase='failed';
      window.__flyStore.getState().setPhase('paused');
    }
  },500);
  return {start:next,report:()=>({phase,current,remaining:queue.length,rows}),stop(){clearInterval(timer);window.__reviewPilot.stop();delete window.__reviewJourneys;}};
})();
