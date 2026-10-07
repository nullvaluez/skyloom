/* Real-provider production endurance route. No fixture, governor pin or
 * feature override. Headless timing is diagnostic, not display/tearing or
 * human-feel certification. Never run alongside another GPU benchmark. */
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdirSync,writeFileSync}=require('node:fs');
const path=require('node:path');
const OUT=path.resolve(process.env.BETA_SOAK_OUT||'.graphics-review/beta'),PORT=3095,base=`http://127.0.0.1:${PORT}`;
const minutes=Number(process.env.BETA_SOAK_MINUTES||20);
if(!(minutes>0&&minutes<=30))throw Error('Expected 1–30 minutes');
mkdirSync(OUT,{recursive:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const allLegs=[
 {minute:0,name:'Manhattan daytime',lat:40.7033,lon:-74.017,altM:900,aircraft:'prop',hour:14,weather:'clear'},
 {minute:3,name:'Sydney coast dusk',lat:-33.86,lon:151.21,altM:650,aircraft:'warbird-prop',hour:18,weather:'scattered'},
 {minute:6,name:'Queenstown mountains',lat:-45.03,lon:168.66,altM:2800,aircraft:'fighter',hour:null,weather:null},
 {minute:9,name:'Manhattan night rain',lat:40.72,lon:-74.01,altM:1000,aircraft:'airliner',hour:23,weather:'rain'},
 {minute:12,name:'Ohio runway departure',ops:'runway'},
 {minute:15,name:'Ohio final approach',ops:'approach'},
 {minute:18,name:'Ocean photo and return',lat:21.75,lon:-159.6,altM:2200,aircraft:'cargo',hour:15,weather:'clear'},
];
const legs=process.env.BETA_SOAK_ROUTE==='airports'?allLegs.filter(l=>l.ops).map((l,i)=>({...l,minute:i*3})):allLegs;
const quantile=(rows,q)=>rows.length?[...rows].sort((a,b)=>a-b)[Math.min(rows.length-1,Math.floor(rows.length*q))]:null;
(async()=>{
 let browser,server,page,log='',renderer,cpu,lastProgress=Date.now();const errors=[],samples=[],events=[],responses={};const began=Date.now();
 const watchdog=setInterval(()=>{if(Date.now()-lastProgress>90000){errors.push('Browser did not report progress for 90 seconds');writeFileSync(path.join(OUT,'soak-stalled.json'),JSON.stringify({at:new Date().toISOString(),errors,samples,events},null,2));browser?.close().catch(()=>{});server?.kill();}},10000);
 try {
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(PORT)],{env:{...process.env,FLY_BUILD_DIR:'.next-explorer',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
  for(let i=0;i<120;i++){try{if((await fetch(base)).ok)break;}catch{}if(i===119)throw Error('Server unavailable');await delay(500);}
  browser=await chromium.launch({args:[...(process.platform==='win32'?['--use-angle=d3d11']:[]),'--ignore-gpu-blocklist']});
  const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  if(process.env.BETA_GPU_TRACE==='1')await context.addInitScript(()=>{
    const trace=window.__betaGpuCalls={totals:{},slow:[]};
    for(const name of ['compileShader','linkProgram','getProgramParameter','getShaderParameter','getActiveUniform','getActiveAttrib','getUniformLocation','getAttribLocation','getShaderInfoLog','getProgramInfoLog','getParameter','checkFramebufferStatus','readPixels','blitFramebuffer','useProgram','texImage2D','texSubImage2D','bufferData','bufferSubData','drawElements','drawElementsInstanced','drawArrays']){
      const original=WebGL2RenderingContext.prototype[name];if(!original)continue;
      WebGL2RenderingContext.prototype[name]=function(...args){const t=performance.now();try{return original.apply(this,args);}finally{const ms=performance.now()-t,row=trace.totals[name]??={count:0,ms:0,max:0};row.count++;row.ms+=ms;row.max=Math.max(row.max,ms);if(ms>20&&trace.slow.length<1000)trace.slow.push({name,ms,at:t,programs:window.__flyStats?.frame?.programs});}};
    }
  });
  await context.addInitScript(()=>{if(location.protocol!=='http:')return;localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-crash-mode','forgiving');localStorage.setItem('fly-explorer-preferences-v1',JSON.stringify({version:1,settings:{tutorial:'skipped'}}));});
  page=await context.newPage();page.setDefaultTimeout(90000);page.on('pageerror',e=>errors.push(e.message));
  if(process.env.BETA_CPU_TRACE==='1'){cpu=await context.newCDPSession(page);await cpu.send('Profiler.enable');await cpu.send('Profiler.start');}
  page.on('response',res=>{const host=new URL(res.url()).hostname;if(host==='127.0.0.1')return;const key=`${host}:${res.status()}`;responses[key]=(responses[key]||0)+1;});
  await page.goto(base+'/?graphicsReview=1&diag=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__fly?.launchSetup&&window.__flyStats?.frame);
  if(await page.getByRole('button',{name:'Hide',exact:true}).count())await page.getByRole('button',{name:'Hide',exact:true}).click();
  renderer=await page.evaluate(()=>{const gl=[...document.querySelectorAll('canvas')].map(c=>c.getContext('webgl2')).find(Boolean);const e=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(e.UNMASKED_RENDERER_WEBGL);});
  if(/swiftshader|llvmpipe|software/i.test(renderer))throw Error('Software renderer cannot certify this hardware route');
  console.log('SOAK renderer',renderer);
  await page.evaluate(()=>{
    const probe=window.__betaSoak={last:0,steady:[],transition:[],lastAction:performance.now(),frames:0};
    const read=()=>{
      const f=window.__flyStats?.frame,r=window.__fly,s=window.__flyStore?.getState(),leg=probe.leg;
      const inactive=!s||s.screen!=='flight'||s.phase==='paused'||s.cameraMode==='photo'||r.worldLoading;
      if(leg&&!inactive){
        const op=r.operations,flight=r.flight,clamp=v=>Math.max(-.9,Math.min(.9,v));
        if(leg.ops==='runway')r.input.setTouchSteer(0,op.grounded?-.9:clamp((flight.pitch-.10)*12));
        else if(leg.ops==='approach'){
          if(op.grounded){op.setThrottle(0);r.input.setBrake(1);r.input.setTouchSteer(0,0);}
          else if(op.phase==='approach'){
            const guide=op.approachGuidance(flight);
            const verticalSpeed=flight.agl<op.profile.clearance+2?-.5:Math.max(-3,Math.min(2,-flight.speed*Math.tan(Math.PI/60)-guide.vertical*.12));
            const pitch=Math.asin(verticalSpeed/Math.max(10,flight.speed));
            r.input.setTouchSteer(clamp(guide.headingError*4-guide.lateral*.005),clamp((flight.pitch-pitch)*12));
          }
        }else r.input.setTouchSteer(Math.sin(performance.now()/10000)*.2,Math.sin(performance.now()/15000)*.10);
      }
      if(f&&f.count!==probe.last){probe.last=f.count;probe.frames++;const stationary=r.operations?.grounded&&r.flight.speed<.5&&r.operations.phase!=='takeoffRoll';const transient=inactive||stationary||['crashed','completed','hangar'].includes(r.operations?.phase)||performance.now()-probe.lastAction<15000;(transient?probe.transition:probe.steady).push(f.lastDt);}probe.raf=requestAnimationFrame(read);
    };read();
  });
  const t0=Date.now();let legIndex=-1,photoDone=false,photoExited=false,lastLogged=-1;
  while(Date.now()-t0<minutes*60000){
    const elapsed=(Date.now()-t0)/60000,next=legs.findLastIndex(l=>elapsed>=l.minute);
    if(next!==legIndex){legIndex=next;const leg=legs[next];
      const ok=await page.evaluate(l=>{const r=window.__fly,s=window.__flyStore.getState();r.input.neutralize();s.setCameraMode('chase');s.setConditionsHour(l.hour??null);s.setConditionsWeather(l.weather??null);window.__betaSoak.lastAction=performance.now();window.__betaSoak.leg=l;
        if(l.ops){const ok=r.launchSetup({flightMode:'ops',aircraftId:'prop',airportId:'KOSU',start:l.ops});if(l.ops==='runway')r.operations.startTakeoff(r.flight);return ok;}
        return r.launchSetup({flightMode:'free',aircraftId:l.aircraft,dest:{id:'poi:beta-'+l.minute,name:l.name,kind:'city',region:'Endurance route',lat:l.lat,lon:l.lon,altM:l.altM,headingDeg:0}});
      },leg);if(!ok)throw Error('Could not start '+leg.name);events.push({elapsed,leg:leg.name});console.log('SOAK leg',leg.name);
    }
    if(elapsed>=18.5&&!photoDone){photoDone=true;await page.evaluate(()=>{window.__flyStore.getState().setCameraMode('photo');window.__betaSoak.lastAction=performance.now();});await page.screenshot({path:path.join(OUT,'soak-ocean-photo.png')});}
    if(elapsed>=18.7&&photoDone&&!photoExited){photoExited=true;await page.evaluate(()=>{window.__flyStore.getState().setCameraMode('chase');window.__betaSoak.lastAction=performance.now();});}
    const sample=await page.evaluate(({elapsed,leg})=>{const r=window.__fly,s=window.__flyStore.getState(),stats=window.__flyStats,f=stats.frame.sample();
      // Input is updated every animation frame, not every five-second sample.
      return {elapsed,leg:leg.name,phase:s.phase,ops:r.operations.phase,takeoffs:r.operations.takeoffs,landings:r.operations.contactCount,operationFailure:r.operations.reason,alt:r.flight.pos.y,agl:r.flight.agl,tier:s.qualityTier,preset:s.qualityPreset,loading:r.worldLoading,frame:f,draws:stats.diag?.calls??stats.drawCalls??null,triangles:stats.diag?.triangles??stats.triangles??null,wholeFrame:stats.diag??null,governor:window.__flyGov?.state(),heap:performance.memory?.usedJSHeapSize??null,traffic:r.dataStatus?.traffic,weather:r.dataStatus?.weather,arrival:r.arrivalStats?{holdMs:r.arrivalStats.holdMs,reason:r.arrivalStats.reason}:null};
    },{elapsed,leg:legs[legIndex]});samples.push(sample);lastProgress=Date.now();
    if(Math.floor(elapsed)!==lastLogged){lastLogged=Math.floor(elapsed);console.log(`SOAK ${lastLogged}m p95=${sample.frame.p95?.toFixed(1)} p99=${sample.frame.p99?.toFixed(1)} tier=${sample.tier} draws=${sample.draws} ops=${sample.ops} errors=${errors.length}`);await page.screenshot({path:path.join(OUT,`soak-${String(lastLogged).padStart(2,'0')}.png`)});}
    writeFileSync(path.join(OUT,'soak-progress.json'),JSON.stringify({renderer,minutes,elapsed,sample,events,errors,responses},null,2));
    await delay(5000);
  }
  const frames=await page.evaluate(()=>{cancelAnimationFrame(window.__betaSoak.raf);return {steady:window.__betaSoak.steady,transition:window.__betaSoak.transition};});
  const summarize=values=>({count:values.length,p50:quantile(values,.5),p95:quantile(values,.95),p99:quantile(values,.99),over100:values.filter(n=>n>100).length,max:values.length?values.reduce((a,b)=>Math.max(a,b),0):null});
  const report={at:new Date().toISOString(),route:process.env.BETA_SOAK_ROUTE||'world',minutes,wallMs:Date.now()-began,renderer,venue:'1920×1080 DPR1 headless Chromium; live providers; scripted input; High default with governor free',steady:summarize(frames.steady),transitions:summarize(frames.transition),samples,events,errors,responses};
  if(process.env.BETA_GPU_TRACE==='1')report.gpuCalls=await page.evaluate(()=>window.__betaGpuCalls);
  if(cpu){const {profile}=await cpu.send('Profiler.stop');writeFileSync(path.join(OUT,'cpu-profile.json'),JSON.stringify(profile));}
  report.limits={p95Frame:20,p99Frame:33.3,p95Draws:375,p95Triangles:2200000};
  report.resource={p95Draws:quantile(samples.map(s=>s.draws).filter(Number.isFinite),.95),p95Triangles:quantile(samples.map(s=>s.triangles).filter(Number.isFinite),.95)};
  report.passes={noUncaughtErrors:errors.length===0,operationsRoute:samples.some(s=>s.takeoffs>0)&&samples.some(s=>s.landings>0)&&!samples.some(s=>s.ops==='crashed'),frameTarget:report.steady.count>=1000&&report.steady.p95<=20&&report.steady.p99<=33.3,noRecurringStalls:report.steady.over100<=1,drawCeiling:report.resource.p95Draws!=null&&report.resource.p95Draws<=375,triangleCeiling:report.resource.p95Triangles!=null&&report.resource.p95Triangles<=2200000};
  writeFileSync(path.join(OUT,'soak.json'),JSON.stringify(report,null,2));console.log('SOAK complete',JSON.stringify({steady:report.steady,resources:report.resource,passes:report.passes}));if(Object.values(report.passes).some(v=>!v))process.exitCode=1;
 }catch(e){console.error(e);errors.push(e.message);writeFileSync(path.join(OUT,'soak-error.json'),JSON.stringify({at:new Date().toISOString(),renderer,errors,samples,events,responses},null,2));process.exitCode=1;}
 finally{clearInterval(watchdog);server?.kill();await browser?.close();writeFileSync(path.join(OUT,'soak-server.log'),log);}
})();
