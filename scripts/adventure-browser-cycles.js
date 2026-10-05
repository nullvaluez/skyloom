// A bounded browser review helper; inject only into the local test page.
// Requires adventure-browser-pilot.js. No physics or graphics overrides.
window.__reviewCycles=(()=>{
  let stopped=false,frame=0,last=0,samples=[],rows=[],started=0,phase='idle',cycle=0,limit=3;
  const rt=window.__fly,store=window.__flyStore;
  function counters(){const s=window.__flyStats?.frame||{},r=rt.cinemaResources||{};return {programs:s.programs,geometries:s.geometries,textures:s.textures,targets:r.targets,ownedBytes:r.combinedBytes,heap:performance.memory?.usedJSHeapSize};}
  function launch(){window.__reviewPilot.start('canyon-discovery','prop','live');phase='loading';started=performance.now();}
  function tick(now){
    if(stopped)return;
    if(phase==='loading'&&!rt.worldLoading&&rt.worldReadiness?.ready){phase='warm';started=now;}
    if(phase==='warm'&&now-started>10000){samples=[];last=now;started=now;phase='measure';}
    else if(phase==='measure'){
      samples.push(now-last);last=now;
      if(now-started>25000){
        const ordered=samples.slice().sort((a,b)=>a-b);
        rows.push({cycle:++cycle,p95:ordered[Math.floor(ordered.length*.95)],frames:samples.length,hidden:document.hidden,seconds:(now-started)/1000,counters:counters()});
        store.getState().setPhase('paused');
        if(cycle>=limit){phase='done';return;}
        if(rt.adventures.prepare)rt.adventures.prepare('canyon-discovery');
        else {rt.operations.returnToHangar();store.getState().setScreen('hangar');}
        started=now;phase='hangar';
      }
    }
    if(phase==='hangar'&&now-started>2000)launch();
    frame=requestAnimationFrame(tick);
  }
  return {start(count=3){limit=count;launch();frame=requestAnimationFrame(tick);},report(){return {phase,rows};},stop(){stopped=true;cancelAnimationFrame(frame);window.__reviewPilot.stop();delete window.__reviewCycles;}};
})();
