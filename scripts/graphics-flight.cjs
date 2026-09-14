/* Native-resolution production flight check. No _boot.js and no governor/terrain pins. */
const {chromium}=require('playwright');
const fs=require('node:fs');
const groundBuildReceipt=require('./ground-build-receipt.cjs');
const args=Object.fromEntries(process.argv.slice(2).map(s=>{const[k,v]=s.replace(/^--/,'').split('=');return[k,v??true]}));
const cloudTraverse=!!args['cloud-traverse'];
const duration=Number(args.seconds||(cloudTraverse?180:90)),output=args.output||'.graphics-review/flight.json';
const width=Number(args.width||1920),height=Number(args.height||1080),stage=args.stage||'cinematic';
const pct=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))]:null;
// Benchmark trajectory, not a flight-control or cloud-density implementation.
function cloudTraverseAltitude(seconds,secondsTotal,lowM){
 const t=Math.max(0,Math.min(1,seconds/secondsTotal));
 return lowM+(4500-lowM)*(.5-.5*Math.cos(2*Math.PI*t));
}
function recordCloudFrame(profile,row){
 // Compact per-RAF trace: seconds, actual plane/camera MSL, inside, base/top,
 // actual AGL, rebase epoch. No raycast, density approximation or rendering call.
 profile.frames.push([row.seconds,row.altitudeM,row.cameraM,row.inside??null,row.baseM??null,row.topM??null,row.aglM,row.rebaseEpoch]);
 profile.altitudeMinM=Math.min(profile.altitudeMinM,row.altitudeM);
 profile.altitudeMaxM=Math.max(profile.altitudeMaxM,row.altitudeM);
 profile.cameraMinM=Math.min(profile.cameraMinM,row.cameraM);
 profile.cameraMaxM=Math.max(profile.cameraMaxM,row.cameraM);
 if(profile.previousAltitudeM!==null)profile.maxAltitudeStepM=Math.max(profile.maxAltitudeStepM,Math.abs(row.altitudeM-profile.previousAltitudeM));
 profile.previousAltitudeM=row.altitudeM;
 profile.firstAltitudeM??=row.altitudeM;profile.lastAltitudeM=row.altitudeM;
 profile.rebaseStart??=row.rebaseEpoch;profile.rebaseEnd=row.rebaseEpoch;
 const valid=row.active===true&&[row.inside,row.cameraM,row.baseM,row.topM,row.altitudeM,row.aglM].every(Number.isFinite)&&row.topM>row.baseM;
 if(!valid){profile.missingFrames++;profile.previousInside=null;return;}
 profile.validFrames++;profile.maxInside=Math.max(profile.maxInside,row.inside);
 const inside=row.inside>.05,ascending=row.seconds<profile.duration/2;
 if(inside){profile.insideFrames++;if(ascending)profile.insideAscent++;else profile.insideDescent++;}
 if(profile.previousInside!==null&&inside!==profile.previousInside){
  const type=inside?'entry':'exit';profile[type==='entry'?'entries':'exits']++;
  if(profile.transitions.length<128)profile.transitions.push({type,seconds:row.seconds,cameraM:row.cameraM,inside:row.inside,phase:ascending?'ascent':'descent'});
 }
 profile.previousInside=inside;
 const clear=row.inside<=.005;
 if(clear&&row.cameraM<=row.baseM-50){
  if(row.seconds<=profile.duration*.1)profile.clearBelowStart++;
  if(row.seconds>=profile.duration*.9&&row.aglM>=0&&row.aglM<=200)profile.clearBelowReturn++;
 }
 if(clear&&row.cameraM>=row.topM+50)profile.clearAbove++;
}
function cloudTraverseVerdict(profile,motion){
 const checks={stateAvailable:!!profile&&profile.validFrames>0&&profile.missingFrames===0,
  completeCycle:!!profile&&profile.frames.at(-1)?.[0]>=profile.duration&&profile.altitudeMaxM>=4490
   &&Math.abs(profile.firstAltitudeM-profile.lowM)<10&&Math.abs(profile.lastAltitudeM-profile.lowM)<25,
  actualCloudCrossings:!!profile&&profile.maxInside>.05&&profile.insideAscent>0&&profile.insideDescent>0&&profile.entries>0&&profile.exits>0,
  clearBelowAboveReturn:!!profile&&profile.clearBelowStart>0&&profile.clearAbove>0&&profile.clearBelowReturn>0,
  movingWithoutWarps:!!motion&&motion.totalGroundDistanceM>0&&motion.minimumMeasuredGroundSpeed>=50
   &&motion.teleports===0&&motion.crashes===0&&profile?.rebaseEnd>profile?.rebaseStart};
 const missing=Object.entries(checks).filter(([,pass])=>!pass).map(([name])=>name);
 return{status:missing.length?'BLOCKED':'PASS',checks,reason:missing.length?`Cloud traversal evidence incomplete: ${missing.join(', ')}`:undefined};
}
async function main(){
 const report={...require('./graphics-source.cjs')(),status:'BLOCKED',stage,native:[width,height],scenario:args.scenario||'urban',errors:[],networkFailures:[],samples:[],transitions:[],arrivals:[],seconds:duration};let browser;
 const save=()=>{fs.mkdirSync(require('path').dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));};
 try{
  if(cloudTraverse&&(!args['build-id']||!Number.isFinite(duration)||duration<180||args.scenario==='mixed'))throw Error('--cloud-traverse requires --build-id, at least 180 seconds and a continuous non-mixed route');
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--enable-webgl-developer-extensions']});
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.message));
  const rasterFailure=(url,detail)=>{if(/arcgis|esri/i.test(url)&&report.networkFailures.length<500)report.networkFailures.push({at:Date.now(),url,...detail});};
  page.on('requestfailed',r=>rasterFailure(r.url(),{error:r.failure()?.errorText}));
  page.on('response',r=>{if(r.status()>=400)rasterFailure(r.url(),{status:r.status()});});
  page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|ReferenceError|TypeError/.test(m.text()))report.errors.push(m.text().slice(0,1000))});
  report.weather=args.weather||'baseline';
  report.crashMode='forgiving'; // Rendering benchmark: an automated route must not respawn through buildings.
  await page.addInitScript(({hour,weather})=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-crash-mode','forgiving');window.__flyWeatherOverride=weather;window.__flySunOverride=Date.UTC(2026,6,18,hour);},{hour:Number(args.hour??4),weather:report.weather});
  await page.goto((args.url||'http://localhost:3000')+'/?graphics='+encodeURIComponent(stage)+'&graphicsReview=1',{waitUntil:'domcontentloaded',timeout:90000});
  if(args['build-id']){
    report.servedBuild=await groundBuildReceipt(page,args.url||'http://localhost:3000',args['build-id']);
  }
  await page.waitForFunction(()=>window.__flyBoot?.pct===100&&window.__fly,null,{timeout:90000});
  await page.evaluate(altM=>window.__fly.warpToGeo(40.7028,-74.017,{altM,name:null}),Number(args.alt??500));
  await page.waitForTimeout(25000);
  await page.waitForFunction(()=>window.__fly.satBuildings?.stats.ready>=4,null,{timeout:30000});
  report.hardware=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2');const e=gl.getExtension('WEBGL_debug_renderer_info');return{renderer:e&&gl.getParameter(e.UNMASKED_RENDERER_WEBGL),gpuTimer:!!gl.getExtension('EXT_disjoint_timer_query_webgl2')};});
  if(!report.hardware.gpuTimer || /swiftshader|software|llvmpipe/i.test(report.hardware.renderer||''))throw Error('Hardware GPU timing unavailable');
  await page.waitForFunction(()=>[...window.__fly.traffic.tracks.values()].some(t=>t.fix1 && t.stale!==2),null,{timeout:45000})
    .catch(()=>{throw Error('No live traffic available at benchmark readiness');});
  if(cloudTraverse){
    await page.waitForFunction(()=>window.__fly.immersiveClouds?.active&&Number.isFinite(window.__fly.immersiveClouds.inside)
      &&Number.isFinite(window.__fly.immersiveLighting?.cloudBase)&&Number.isFinite(window.__fly.immersiveLighting?.cloudThickness),null,{timeout:30000})
      .catch(()=>{throw Error('Actual runtime camera cloud state unavailable');});
    report.cloudProfile={kind:'cloud-traverse',duration,lowAglFt:300,apexMslM:4500,
      control:'Benchmark drives only altitude along a smooth cosine; ordinary horizontal flight, terrain and governor remain live. Not physical flight-control proof.',
      evidence:'Reads the installed cloud pass camera-density signal each RAF; does not independently prove GPU pixel continuity. Altitude step maximum is diagnostic.',
      traceColumns:['seconds','actualAltitudeM','cameraAltitudeM','inside','cloudBaseM','cloudTopM','actualAglM','rebaseEpoch'],
      threshold:{inside:.05,clear:.005,clearHeightMarginM:50},captures:'No screenshots during the timed traversal'};
    await page.addScriptTag({content:`window.__graphicsCloudProfile={altitude:${cloudTraverseAltitude.toString()},record:${recordCloudFrame.toString()}};`});
    await page.evaluate(()=>{const f=window.__fly.flight;f.pos.y=f.groundElev+91.44;f.pitch=0;});
    await page.waitForTimeout(3000);
  }
  await page.evaluate(({aglFt,boost,cloudTraverse,duration})=>{
    const rt=window.__fly,f=rt.flight,gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const bench=window.__graphicsFlight={frames:[],steadyFrames:[],arrivalFrames:[],gpu:[],longTasks:[],start:performance.now(),last:0,running:true,disjoint:0,loads:0,unloads:0,baseAltitude:f.pos.y,arrivalUntil:0,groundDistanceM:0,movingSeconds:0,teleports:0,lastPose:null};
    if(cloudTraverse)bench.cloud={duration,lowM:f.pos.y,frames:[],transitions:[],validFrames:0,missingFrames:0,insideFrames:0,insideAscent:0,insideDescent:0,
      entries:0,exits:0,clearBelowStart:0,clearAbove:0,clearBelowReturn:0,maxInside:0,altitudeMinM:Infinity,altitudeMaxM:-Infinity,
      cameraMinM:Infinity,cameraMaxM:-Infinity,maxAltitudeStepM:0,previousAltitudeM:null,previousInside:null};
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
        // Main's rebaseCalm no longer wakes the store for origin changes.
        // The runtime epoch is the counter that actually advances in flight.
        speed:f.speed,rebaseEpoch:rt.origin.epoch ?? window.__flyStore.getState().rebaseEpoch,
        warpEpoch:window.__flyStore.getState().warpEpoch,crashEpoch:window.__flyStore.getState().crashEpoch,
        groundDistanceM:bench.groundDistanceM,movingSeconds:bench.movingSeconds,teleports:bench.teleports,
        visualAgl:f.pos.y-(rt.groundElevVis??f.groundElev), ground:rt.groundImmersion,
        nightGround:rt.groundLighting,groundDetail:rt.groundDetail,shadowRadiusM:rt.shadowRadiusM,
        nearSupport:rt.satVeg?.stats?.nearSupport,supportMaxima:{...bench.supportMaxima},
        ...(bench.cloud?{cloudState:{...rt.immersiveClouds},cloudLayer:{baseM:rt.immersiveLighting?.cloudBase,thicknessM:rt.immersiveLighting?.cloudThickness},
          cloudCounts:{valid:bench.cloud.validFrames,missing:bench.cloud.missingFrames,entries:bench.cloud.entries,exits:bench.cloud.exits,maxInside:bench.cloud.maxInside}}:{}),
        pins:Object.fromEntries(['__flyGovPin','__flyTerraPin','__flyDepthPin','__flySettlePin','__flyClutterPin','__flyAerialOverride'].map(k=>[k,window[k]??null])),
        recentFrameP95:bench.frames.slice(-600).sort((a,b)=>a-b)[Math.floor(Math.min(600,bench.frames.length)*.95)]};
    };
    let active=null;const pending=[];
    function tick(now){
      if(!bench.running){if(active){gl.endQuery(ext.TIME_ELAPSED_EXT);gl.deleteQuery(active)}for(const q of pending)gl.deleteQuery(q);return;}
      if(bench.last){const dt=now-bench.last;bench.frames.push(dt);(now<bench.arrivalUntil?bench.arrivalFrames:bench.steadyFrames).push(dt);}bench.last=now;
      // Retain the mutable stats cell, avoiding a streamer census allocation
      // every RAF. Refresh only when the component bus actually changes.
      if(bench.supportBus!==rt.satVeg){bench.supportBus=rt.satVeg;bench.supportStats=rt.satVeg?.stats?.nearSupport;}
      if(bench.supportStats){
        const s=bench.supportStats,m=bench.supportMaxima??(bench.supportMaxima={queries:0,work:0,cached:0,ms:0});
        for(const key of ['queries','work','cached','ms'])m[key]=Math.max(m[key],s[key]??0);
      }
      const store=window.__flyStore.getState(),previous=bench.lastPose;
      if(previous){
        if(previous.warpEpoch===store.warpEpoch&&previous.crashEpoch===store.crashEpoch){
          // f.pos is already absolute Mercator. Accumulate each frame's path,
          // undoing map scale; neither rebases nor turns shorten this measure.
          bench.groundDistanceM+=Math.hypot(f.pos.x-previous.x,f.pos.z-previous.z)/Math.cosh((f.pos.z+previous.z)/(2*6378137));
          bench.movingSeconds+=(now-previous.at)/1000;
        }else bench.teleports++;
      }
      bench.lastPose={x:f.pos.x,z:f.pos.z,at:now,warpEpoch:store.warpEpoch,crashEpoch:store.crashEpoch};
      // Translating turns at actual flight speed, with a gentle altitude cycle.
      // No position freeze, no terrain pin: streaming sees real movement.
      const sec=(now-bench.start)/1000;f.heading=0.25+sec*0.024;f.pitch=0;f.bank=0.12;
      if(bench.cloud){
        const state=rt.immersiveClouds,light=rt.immersiveLighting;
        window.__graphicsCloudProfile.record(bench.cloud,{seconds:sec,altitudeM:f.pos.y,cameraM:rt.camera.position.y,inside:state?.inside,
          active:state?.active,baseM:light?.cloudBase,topM:light?.cloudBase+light?.cloudThickness,aglM:f.pos.y-f.groundElev,
          rebaseEpoch:rt.origin.epoch??store.rebaseEpoch});
        f.pos.y=window.__graphicsCloudProfile.altitude(sec,duration,bench.cloud.lowM);
      }else f.pos.y=Number.isFinite(aglFt)
        ? (rt.groundElevVis??f.groundElev)+aglFt*.3048+Math.min(15,aglFt*.08)*Math.sin(sec/20)
        : Math.max(f.groundElev+100,bench.baseAltitude+120*Math.sin(sec/20));
      if(boost)rt.input?.setBoost(true);
      if(ext){
        if(active){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(active);active=null;}
        if(gl.getParameter(ext.GPU_DISJOINT_EXT)){bench.disjoint++;for(const q of pending)gl.deleteQuery(q);pending.length=0;}
        while(pending.length&&gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE)){const q=pending.shift();bench.gpu.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q);}
        if(pending.length<8){active=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,active);}
      }
      bench.raf=requestAnimationFrame(tick);
    }
    bench.raf=requestAnimationFrame(tick);
  },{aglFt:args['agl-ft']===undefined?null:Number(args['agl-ft']),boost:!!args.boost,cloudTraverse,duration});
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
  const values=await page.evaluate(()=>{const b=window.__graphicsFlight;b.running=false;window.__fly.input?.setBoost(false);b.observer?.disconnect();return{frames:b.frames,steadyFrames:b.steadyFrames,arrivalFrames:b.arrivalFrames,gpu:b.gpu,disjoint:b.disjoint,longTasks:b.longTasks,...(b.cloud?{cloud:b.cloud}:{})}});
  report.timing={fps:1000/(values.frames.reduce((a,b)=>a+b,0)/values.frames.length),p95:pct(values.frames,.95),p99:pct(values.frames,.99),gpuP95:pct(values.gpu,.95),gpuSamples:values.gpu.length,disjoint:values.disjoint,cpuLongTasks:values.longTasks.length,cpuLongTaskP95:pct(values.longTasks,.95)};
  report.timing.steady={frames:values.steadyFrames.length,p95:pct(values.steadyFrames,.95),p99:pct(values.steadyFrames,.99),max:values.steadyFrames.reduce((m,v)=>Math.max(m,v),0)};
  report.timing.arrival={frames:values.arrivalFrames.length,p95:pct(values.arrivalFrames,.95),p99:pct(values.arrivalFrames,.99),max:values.arrivalFrames.reduce((m,v)=>Math.max(m,v),0)};
  for(const tier of ['high','medium','low','high']){
    await page.evaluate(t=>window.__flyStore.getState().setQualityTier(t),tier);
    await page.waitForTimeout(12000);
    report.transitions.push(await page.evaluate(t=>({requested:t,actual:window.__flyStore.getState().qualityTier,buildings:window.__fly.satBuildings?.stats,roads:window.__fly.satRoads?.stats,skyline:window.__fly.satSkyline?.stats,coveredTiles:window.__graphicsReview?.skylineCoveredTiles,nightEnabled:window.__fly.satBuildings?.nightEnabled,
      review:window.__graphicsReview,groundLighting:window.__fly.groundLighting,ground:window.__fly.groundImmersion}),tier));
    const captureDir=output.replace(/\.json$/,'-quality');fs.mkdirSync(captureDir,{recursive:true});
    await page.screenshot({path:`${captureDir}/${report.transitions.length}-${tier}.png`});
  }
  const absent=report.transitions.some(t=>!(t.buildings?.ready>0&&t.roads?.ready>0&&t.skyline?.ready>0&&t.nightEnabled));
  const unsuitable=/swiftshader|software|llvmpipe/i.test(report.hardware.renderer||'')||!values.gpu.length;
  const drawValues=report.samples.map(s=>s.review?.drawCalls||0),triValues=report.samples.map(s=>s.review?.triangles||0);
  report.budgets={drawP95:pct(drawValues,.95),triangleP95:pct(triValues,.95),native:report.samples.every(s=>s.review?.dpr===1),terrainTextureMBMax:Math.max(...report.samples.map(s=>s.terrainTextureBytes))/1048576,
    groundLightMapMBMax:Math.max(...report.samples.map(s=>s.nightGround?.bytes??0))/1048576,
    terrainAndGroundMapMBMax:Math.max(...report.samples.map(s=>s.terrainTextureBytes+(s.nightGround?.bytes??0)))/1048576};
  report.memory={heapStart:report.samples[0]?.heap,heapEnd:report.samples.at(-1)?.heap,heapMin:Math.min(...report.samples.map(s=>s.heap)),heapMax:Math.max(...report.samples.map(s=>s.heap)),programs:report.samples.map(s=>s.review?.programs),geometries:report.samples.map(s=>s.review?.geometries),note:'Texture estimate covers resident terrain RGBA uploads plus mipmaps and both allocated RGBA8 ground-light maps, not all renderer allocations; CPU metric covers browser long tasks. Renderer draw counters include offscreen ground-light updates.'};
  report.traffic={min:Math.min(...report.samples.map(s=>s.activeTraffic)),max:Math.max(...report.samples.map(s=>s.activeTraffic))};
  const missingTiles=report.samples.some(s=>s.failedImagery>0||s.terrainMeshes<20);
  const absentTraffic=report.traffic.max===0;
  const budgetsMeasured=drawValues.every(n=>n>1), budgetsPass=report.budgets.native&&report.budgets.drawP95<=375&&report.budgets.triangleP95<=2200000&&report.timing.gpuP95<=12&&report.budgets.terrainAndGroundMapMBMax<=300;
  report.unpinned=report.samples.every(s=>Object.values(s.pins).every(v=>v===null));
  // Guard a stalled simulation: a frame-time PASS must represent moving flight.
  report.motion={minimumSpeed:Math.min(...report.samples.map(s=>s.speed)),rebases:report.samples.at(-1)?.rebaseEpoch-report.samples[0]?.rebaseEpoch,
    crashes:report.samples.at(-1)?.crashEpoch-report.samples[0]?.crashEpoch,teleports:report.samples.at(-1)?.teleports,
    totalGroundDistanceM:report.samples.at(-1)?.groundDistanceM};
  const measuredSpeeds=report.samples.slice(1).flatMap((s,i)=>{
    const p=report.samples[i];if(s.arrival||p.arrival)return [];
    const seconds=s.movingSeconds-p.movingSeconds;if(seconds<=0)return [];
    const groundMetres=s.groundDistanceM-p.groundDistanceM;
    return [groundMetres/seconds];
  });
  report.motion.minimumMeasuredGroundSpeed=measuredSpeeds.length?Math.min(...measuredSpeeds):0;
  report.frameTargetMs=stage==='immersive'?16.7:20;
  const insufficientMotion=!Number.isFinite(report.motion.minimumSpeed)||!Number.isFinite(report.motion.minimumMeasuredGroundSpeed)||report.motion.minimumSpeed<50||report.motion.minimumMeasuredGroundSpeed<50;
  report.status=report.errors.length||absent||!report.unpinned?'FAIL':unsuitable||!budgetsMeasured||missingTiles||absentTraffic||insufficientMotion?'BLOCKED':report.timing.p95<=report.frameTargetMs&&report.timing.p99<=33.3&&budgetsPass?'PASS':'FAIL';
  report.reason=absent?'A required layer failed to remain ready through quality transitions':unsuitable?'GPU timing unavailable or software renderer':missingTiles?'Terrain imagery missing or insufficient residency':absentTraffic?'No live traffic available during measurement':!budgetsMeasured?'Scene draw/triangle counters unavailable':insufficientMotion?'Actual ground travel did not meet the existing 50 m/s movement floor':report.status==='FAIL'?'Errors, draw/triangle budget or frame-time target missed':undefined;
  if(cloudTraverse){
    report.cloudTraverse={...values.cloud,...cloudTraverseVerdict(values.cloud,report.motion)};
    if(report.status==='PASS'&&report.cloudTraverse.status!=='PASS'){report.status='BLOCKED';report.reason=report.cloudTraverse.reason;}
  }
 }catch(e){report.status='BLOCKED';report.reason=e.message;}
 finally{await browser?.close();fs.mkdirSync(require('path').dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,reason:report.reason,timing:report.timing,errors:report.errors.slice(0,3)}));process.exitCode=report.status==='BLOCKED'?2:report.status==='FAIL'?1:0;}
}
if(require.main===module)main();
module.exports={cloudTraverseAltitude,recordCloudFrame,cloudTraverseVerdict};
