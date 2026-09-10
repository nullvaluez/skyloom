/* Native-resolution production flight check. No _boot.js and no governor/terrain pins. */
const {chromium}=require('playwright');
const fs=require('node:fs');
const args=Object.fromEntries(process.argv.slice(2).map(s=>{const[k,v]=s.replace(/^--/,'').split('=');return[k,v??true]}));
const duration=Number(args.seconds||90),output=args.output||'.graphics-review/flight.json';
const width=Number(args.width||1920),height=Number(args.height||1080),stage=args.stage||'cinematic';
const pct=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))]:null;
(async()=>{
 const report={...require('./graphics-source.cjs')(),status:'BLOCKED',stage,native:[width,height],scenario:args.scenario||'urban',errors:[],networkFailures:[],samples:[],transitions:[],arrivals:[],seconds:duration};let browser;
 const save=()=>{fs.mkdirSync(require('path').dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));};
 try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--enable-webgl-developer-extensions']});
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.message));
  const rasterFailure=(url,detail)=>{if(/arcgis|esri/i.test(url)&&report.networkFailures.length<500)report.networkFailures.push({at:Date.now(),url,...detail});};
  page.on('requestfailed',r=>rasterFailure(r.url(),{error:r.failure()?.errorText}));
  page.on('response',r=>{if(r.status()>=400)rasterFailure(r.url(),{status:r.status()});});
  page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|ReferenceError|TypeError/.test(m.text()))report.errors.push(m.text().slice(0,1000))});
  report.weather=args.weather||'baseline';
  await page.addInitScript(({hour,weather})=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-controls-seen','1');window.__flyWeatherOverride=weather;window.__flySunOverride=Date.UTC(2026,6,18,hour);},{hour:Number(args.hour??4),weather:report.weather});
  await page.goto((args.url||'http://localhost:3000')+'/?graphics='+encodeURIComponent(stage)+'&graphicsReview=1',{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>window.__flyBoot?.pct===100&&window.__fly,null,{timeout:90000});
  await page.evaluate(altM=>window.__fly.warpToGeo(40.7028,-74.017,{altM,name:null}),Number(args.alt??500));
  await page.waitForTimeout(25000);
  await page.waitForFunction(()=>window.__fly.satBuildings?.stats.ready>=4,null,{timeout:30000});
  report.hardware=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2');const e=gl.getExtension('WEBGL_debug_renderer_info');return{renderer:e&&gl.getParameter(e.UNMASKED_RENDERER_WEBGL),gpuTimer:!!gl.getExtension('EXT_disjoint_timer_query_webgl2')};});
  if(!report.hardware.gpuTimer || /swiftshader|software|llvmpipe/i.test(report.hardware.renderer||''))throw Error('Hardware GPU timing unavailable');
  await page.waitForFunction(()=>[...window.__fly.traffic.tracks.values()].some(t=>t.fix1 && t.stale!==2),null,{timeout:45000})
    .catch(()=>{throw Error('No live traffic available at benchmark readiness');});
  await page.evaluate(()=>{
    const rt=window.__fly,f=rt.flight,gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const bench=window.__graphicsFlight={frames:[],steadyFrames:[],arrivalFrames:[],gpu:[],longTasks:[],start:performance.now(),last:0,running:true,disjoint:0,loads:0,unloads:0,baseAltitude:f.pos.y,arrivalUntil:0};
    rt.engine.map.addEventListener('tile-loaded',()=>bench.loads++);
    rt.engine.map.addEventListener('tile-unload',()=>bench.unloads++);
    if(PerformanceObserver.supportedEntryTypes.includes('longtask')){
      bench.observer=new PerformanceObserver(list=>{for(const e of list.getEntries())if(bench.running)bench.longTasks.push(e.duration);});
      bench.observer.observe({type:'longtask'});
    }
    bench.sample=()=>{
      let terrainTextures=0,terrainTextureBytes=0,terrainMeshes=0,failedImagery=0;
      const failedTiles=[];
      const seen=new Set();
      rt.engine.map.traverse(o=>{
        if(!o.isTile||o.model?.parent!==o)return;terrainMeshes++;
        for(const mat of o.model.material){
          if(mat.userData.flyError){failedImagery++;if(failedTiles.length<24)failedTiles.push({id:o.id,x:o.x,y:o.y,z:o.z,visible:o.visible,
            loadedEpoch:o._loadedEpoch,rootEpoch:o._root?._epoch,loadState:o._loadState,
            retryAttempts:o._rasterRetryAttempts,retryAt:o._rasterRetryAt});}
          const tex=mat.map,im=tex?.image;
          if(im&&!seen.has(tex)){seen.add(tex);terrainTextures++;terrainTextureBytes+=(im.width||0)*(im.height||0)*4*(tex.generateMipmaps?4/3:1);}
        }
      });
      return{at:Date.now(),review:window.__graphicsReview,terrain:rt.terraStats,
        heap:performance.memory?.usedJSHeapSize,position:{...f.pos},origin:{...rt.origin.anchor},
        activeTraffic:[...rt.traffic.tracks.values()].filter(t=>t.fix1 && t.stale!==2).length,
        terrainMeshes,terrainTextures,terrainTextureBytes,failedImagery,failedTiles,
        loads:bench.loads,unloads:bench.unloads,frames:bench.frames.length,
        arrival:performance.now()<bench.arrivalUntil,agl:f.pos.y-f.groundElev,governor:window.__flyGov?.state?.(),
        speed:f.speed,rebaseEpoch:window.__flyStore.getState().rebaseEpoch,
        pins:Object.fromEntries(['__flyGovPin','__flyTerraPin','__flyDepthPin','__flySettlePin','__flyClutterPin','__flyAerialOverride'].map(k=>[k,window[k]??null])),
        recentFrameP95:bench.frames.slice(-600).sort((a,b)=>a-b)[Math.floor(Math.min(600,bench.frames.length)*.95)]};
    };
    let active=null;const pending=[];
    function tick(now){
      if(!bench.running){if(active){gl.endQuery(ext.TIME_ELAPSED_EXT);gl.deleteQuery(active)}for(const q of pending)gl.deleteQuery(q);return;}
      if(bench.last){const dt=now-bench.last;bench.frames.push(dt);(now<bench.arrivalUntil?bench.arrivalFrames:bench.steadyFrames).push(dt);}bench.last=now;
      // Translating turns at actual flight speed, with a gentle altitude cycle.
      // No position freeze, no terrain pin: streaming sees real movement.
      const sec=(now-bench.start)/1000;f.heading=0.25+sec*0.024;f.pitch=0;f.bank=0.12;
      f.pos.y=Math.max(f.groundElev+100,bench.baseAltitude+120*Math.sin(sec/20));
      if(ext){
        if(active){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(active);active=null;}
        if(gl.getParameter(ext.GPU_DISJOINT_EXT)){bench.disjoint++;for(const q of pending)gl.deleteQuery(q);pending.length=0;}
        while(pending.length&&gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE)){const q=pending.shift();bench.gpu.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q);}
        if(pending.length<8){active=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,active);}
      }
      bench.raf=requestAnimationFrame(tick);
    }
    bench.raf=requestAnimationFrame(tick);
  });
  const end=Date.now()+duration*1000;
  report.status='IN_PROGRESS';save();
  while(Date.now()<end){
    await page.waitForTimeout(10000);
    report.samples.push(await page.evaluate(()=>window.__graphicsFlight.sample()));save();
    if(report.samples.length%3===0)console.log(`Flight ${report.samples.length*10}s: ${report.samples.at(-1).review?.tier}, p95 ${report.samples.at(-1).recentFrameP95?.toFixed(1)}ms, buildings ${report.samples.at(-1).review?.buildings?.ready}`);
    if(args.scenario==='mixed' && report.samples.length%15===0 && Date.now()+30000<end){
      const places=[[40.2083,-83.0701,600],[-37.683,144.582,500],[48.8579,2.301,600],[36.601,-118.06,1700],[40.7028,-74.017,500]];
      const destination=places[(report.samples.length/15-1)%places.length];
      report.arrivals.push({at:Date.now(),destination,classification:'All frames in the first 30 s after a warp are arrival frames; raw timings retain them.'});
      await page.evaluate(p=>{const b=window.__graphicsFlight;b.arrivalUntil=performance.now()+30000;window.__fly.warpToGeo(p[0],p[1],{altM:p[2],name:null});b.baseAltitude=window.__fly.flight.pos.y;},destination);
    }
  }
  const values=await page.evaluate(()=>{const b=window.__graphicsFlight;b.running=false;b.observer?.disconnect();return{frames:b.frames,steadyFrames:b.steadyFrames,arrivalFrames:b.arrivalFrames,gpu:b.gpu,disjoint:b.disjoint,longTasks:b.longTasks}});
  report.timing={fps:1000/(values.frames.reduce((a,b)=>a+b,0)/values.frames.length),p95:pct(values.frames,.95),p99:pct(values.frames,.99),gpuP95:pct(values.gpu,.95),gpuSamples:values.gpu.length,disjoint:values.disjoint,cpuLongTasks:values.longTasks.length,cpuLongTaskP95:pct(values.longTasks,.95)};
  report.timing.steady={frames:values.steadyFrames.length,p95:pct(values.steadyFrames,.95),p99:pct(values.steadyFrames,.99),max:values.steadyFrames.reduce((m,v)=>Math.max(m,v),0)};
  report.timing.arrival={frames:values.arrivalFrames.length,p95:pct(values.arrivalFrames,.95),p99:pct(values.arrivalFrames,.99),max:values.arrivalFrames.reduce((m,v)=>Math.max(m,v),0)};
  for(const tier of ['high','medium','low','high']){
    await page.evaluate(t=>window.__flyStore.getState().setQualityTier(t),tier);
    await page.waitForTimeout(12000);
    report.transitions.push(await page.evaluate(t=>({requested:t,actual:window.__flyStore.getState().qualityTier,buildings:window.__fly.satBuildings?.stats,roads:window.__fly.satRoads?.stats,skyline:window.__fly.satSkyline?.stats,coveredTiles:window.__graphicsReview?.skylineCoveredTiles,nightEnabled:window.__fly.satBuildings?.nightEnabled}),tier));
    const captureDir=output.replace(/\.json$/,'-quality');fs.mkdirSync(captureDir,{recursive:true});
    await page.screenshot({path:`${captureDir}/${report.transitions.length}-${tier}.png`});
  }
  const absent=report.transitions.some(t=>!(t.buildings?.ready>0&&t.roads?.ready>0&&t.skyline?.ready>0&&t.nightEnabled));
  const unsuitable=/swiftshader|software|llvmpipe/i.test(report.hardware.renderer||'')||!values.gpu.length;
  const drawValues=report.samples.map(s=>s.review?.drawCalls||0),triValues=report.samples.map(s=>s.review?.triangles||0);
  report.budgets={drawP95:pct(drawValues,.95),triangleP95:pct(triValues,.95),native:report.samples.every(s=>s.review?.dpr===1),terrainTextureMBMax:Math.max(...report.samples.map(s=>s.terrainTextureBytes))/1048576};
  report.memory={heapStart:report.samples[0]?.heap,heapEnd:report.samples.at(-1)?.heap,heapMin:Math.min(...report.samples.map(s=>s.heap)),heapMax:Math.max(...report.samples.map(s=>s.heap)),programs:report.samples.map(s=>s.review?.programs),geometries:report.samples.map(s=>s.review?.geometries),note:'Texture estimate covers resident terrain RGBA uploads plus mipmaps, not all renderer allocations; CPU metric covers browser long tasks.'};
  report.traffic={min:Math.min(...report.samples.map(s=>s.activeTraffic)),max:Math.max(...report.samples.map(s=>s.activeTraffic))};
  const missingTiles=report.samples.some(s=>s.failedImagery>0||s.terrainMeshes<20);
  const absentTraffic=report.traffic.max===0;
  const budgetsMeasured=drawValues.every(n=>n>1), budgetsPass=report.budgets.native&&report.budgets.drawP95<=480&&report.budgets.triangleP95<=2200000;
  report.unpinned=report.samples.every(s=>Object.values(s.pins).every(v=>v===null));
  // Guard a stalled simulation: a frame-time PASS must represent moving flight.
  report.motion={minimumSpeed:Math.min(...report.samples.map(s=>s.speed)),rebases:report.samples.at(-1)?.rebaseEpoch-report.samples[0]?.rebaseEpoch};
  report.frameTargetMs=stage==='immersive'?16.7:20;
  report.status=report.errors.length||absent||!report.unpinned?'FAIL':unsuitable||!budgetsMeasured||missingTiles||absentTraffic||report.motion.minimumSpeed<50?'BLOCKED':report.timing.p95<=report.frameTargetMs&&report.timing.p99<=33.3&&budgetsPass?'PASS':'FAIL';
  report.reason=absent?'A required layer failed to remain ready through quality transitions':unsuitable?'GPU timing unavailable or software renderer':missingTiles?'Terrain imagery missing or insufficient residency':absentTraffic?'No live traffic available during measurement':!budgetsMeasured?'Scene draw/triangle counters unavailable':report.status==='FAIL'?'Errors, draw/triangle budget or frame-time target missed':undefined;
 }catch(e){report.status='BLOCKED';report.reason=e.message;}
 finally{await browser?.close();fs.mkdirSync(require('path').dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,reason:report.reason,timing:report.timing,errors:report.errors.slice(0,3)}));process.exitCode=report.status==='BLOCKED'?2:report.status==='FAIL'?1:0;}
})();
