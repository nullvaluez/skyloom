/* Real-provider production endurance route. No fixture, governor pin or
 * feature override. Headless timing is diagnostic, not display/tearing or
 * human-feel certification. Never run alongside another GPU benchmark. */
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdirSync,writeFileSync}=require('node:fs');
const path=require('node:path');
const OUT=path.resolve('.graphics-review/beta'),PORT=3095,base=`http://127.0.0.1:${PORT}`;
const minutes=Number(process.env.BETA_SOAK_MINUTES||20);
if(!(minutes>0&&minutes<=30))throw Error('Expected 1–30 minutes');
mkdirSync(OUT,{recursive:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const legs=[
 {minute:0,name:'Manhattan daytime',lat:40.7033,lon:-74.017,altM:900,aircraft:'prop',hour:14,weather:'clear'},
 {minute:3,name:'Sydney coast dusk',lat:-33.86,lon:151.21,altM:650,aircraft:'warbird-prop',hour:18,weather:'scattered'},
 {minute:6,name:'Queenstown mountains',lat:-45.03,lon:168.66,altM:2800,aircraft:'fighter',hour:null,weather:null},
 {minute:9,name:'Manhattan night rain',lat:40.72,lon:-74.01,altM:1000,aircraft:'airliner',hour:23,weather:'rain'},
 {minute:12,name:'Ohio runway departure',ops:'runway'},
 {minute:15,name:'Ohio final approach',ops:'approach'},
 {minute:18,name:'Ocean photo and return',lat:21.75,lon:-159.6,altM:2200,aircraft:'cargo',hour:15,weather:'clear'},
];
const quantile=(rows,q)=>rows.length?[...rows].sort((a,b)=>a-b)[Math.min(rows.length-1,Math.floor(rows.length*q))]:null;
(async()=>{
 let browser,server,page,log='',renderer;const errors=[],samples=[],events=[],responses={};const began=Date.now();
 try {
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(PORT)],{env:{...process.env,FLY_BUILD_DIR:'.next-explorer',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
  for(let i=0;i<120;i++){try{if((await fetch(base)).ok)break;}catch{}if(i===119)throw Error('Server unavailable');await delay(500);}
  browser=await chromium.launch({args:[...(process.platform==='win32'?['--use-angle=d3d11']:[]),'--ignore-gpu-blocklist']});
  const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  await context.addInitScript(()=>{localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-crash-mode','forgiving');localStorage.setItem('fly-explorer-preferences-v1',JSON.stringify({version:1,settings:{tutorial:'skipped'}}));});
  page=await context.newPage();page.setDefaultTimeout(90000);page.on('pageerror',e=>errors.push(e.message));
  page.on('response',res=>{const host=new URL(res.url()).hostname;if(host==='127.0.0.1')return;const key=`${host}:${res.status()}`;responses[key]=(responses[key]||0)+1;});
  await page.goto(base+'/?graphicsReview=1&diag=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__fly?.launchSetup&&window.__flyStats?.frame);
  if(await page.getByRole('button',{name:'Hide',exact:true}).count())await page.getByRole('button',{name:'Hide',exact:true}).click();
  renderer=await page.evaluate(()=>{const gl=[...document.querySelectorAll('canvas')].map(c=>c.getContext('webgl2')).find(Boolean);const e=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(e.UNMASKED_RENDERER_WEBGL);});
  if(/swiftshader|llvmpipe|software/i.test(renderer))throw Error('Software renderer cannot certify this hardware route');
  console.log('SOAK renderer',renderer);
  await page.evaluate(()=>{
    const probe=window.__betaSoak={last:0,steady:[],transition:[],lastAction:performance.now(),frames:0};
    const read=()=>{const f=window.__flyStats?.frame,r=window.__fly,s=window.__flyStore?.getState();if(f&&f.count!==probe.last){probe.last=f.count;probe.frames++;const transient=!s||s.screen!=='flight'||s.phase==='paused'||s.cameraMode==='photo'||r.worldLoading||performance.now()-probe.lastAction<15000;(transient?probe.transition:probe.steady).push(f.lastDt);}probe.raf=requestAnimationFrame(read);};read();
  });
  const t0=Date.now();let legIndex=-1,photoDone=false,photoExited=false,lastLogged=-1;
  while(Date.now()-t0<minutes*60000){
    const elapsed=(Date.now()-t0)/60000,next=legs.findLastIndex(l=>elapsed>=l.minute);
    if(next!==legIndex){legIndex=next;const leg=legs[next];
      const ok=await page.evaluate(l=>{const r=window.__fly,s=window.__flyStore.getState();r.input.neutralize();s.setCameraMode('chase');s.setConditionsHour(l.hour??null);s.setConditionsWeather(l.weather??null);window.__betaSoak.lastAction=performance.now();
        if(l.ops){const ok=r.launchSetup({flightMode:'ops',aircraftId:'prop',airportId:'KOSU',start:l.ops});if(l.ops==='runway')r.operations.startTakeoff(r.flight);return ok;}
        return r.launchSetup({flightMode:'free',aircraftId:l.aircraft,dest:{id:'poi:beta-'+l.minute,name:l.name,kind:'city',region:'Endurance route',lat:l.lat,lon:l.lon,altM:l.altM,headingDeg:0}});
      },leg);if(!ok)throw Error('Could not start '+leg.name);events.push({elapsed,leg:leg.name});console.log('SOAK leg',leg.name);
    }
    if(elapsed>=18.5&&!photoDone){photoDone=true;await page.evaluate(()=>{window.__flyStore.getState().setCameraMode('photo');window.__betaSoak.lastAction=performance.now();});await page.screenshot({path:path.join(OUT,'soak-ocean-photo.png')});}
    if(elapsed>=18.7&&photoDone&&!photoExited){photoExited=true;await page.evaluate(()=>{window.__flyStore.getState().setCameraMode('chase');window.__betaSoak.lastAction=performance.now();});}
    const sample=await page.evaluate(({elapsed,leg})=>{const r=window.__fly,s=window.__flyStore.getState(),stats=window.__flyStats,f=stats.frame.sample();
      if(s.cameraMode!=='photo'&&!r.worldLoading){if(leg.ops==='runway')r.input.setTouchSteer(0,-.35);else if(!leg.ops)r.input.setTouchSteer(Math.sin(elapsed*6)*.08,Math.sin(elapsed*2)*.015);}
      return {elapsed,leg:leg.name,phase:s.phase,ops:r.operations.phase,alt:r.flight.pos.y,agl:r.flight.agl,tier:s.qualityTier,preset:s.qualityPreset,loading:r.worldLoading,frame:f,draws:stats.drawCalls??null,triangles:stats.triangles??null,wholeFrame:stats.diag??null,heap:performance.memory?.usedJSHeapSize??null,traffic:r.dataStatus?.traffic,weather:r.dataStatus?.weather,arrival:r.arrivalStats?{holdMs:r.arrivalStats.holdMs,reason:r.arrivalStats.reason}:null};
    },{elapsed,leg:legs[legIndex]});samples.push(sample);
    if(Math.floor(elapsed)!==lastLogged){lastLogged=Math.floor(elapsed);console.log(`SOAK ${lastLogged}m p95=${sample.frame.p95?.toFixed(1)} p99=${sample.frame.p99?.toFixed(1)} tier=${sample.tier} draws=${sample.draws} ops=${sample.ops} errors=${errors.length}`);await page.screenshot({path:path.join(OUT,`soak-${String(lastLogged).padStart(2,'0')}.png`)});}
    writeFileSync(path.join(OUT,'soak-progress.json'),JSON.stringify({renderer,minutes,elapsed,sample,events,errors,responses},null,2));
    await delay(5000);
  }
  const frames=await page.evaluate(()=>{cancelAnimationFrame(window.__betaSoak.raf);return {steady:window.__betaSoak.steady,transition:window.__betaSoak.transition};});
  const summarize=values=>({count:values.length,p50:quantile(values,.5),p95:quantile(values,.95),p99:quantile(values,.99),over100:values.filter(n=>n>100).length,max:values.length?values.reduce((a,b)=>Math.max(a,b),0):null});
  const report={at:new Date().toISOString(),minutes,wallMs:Date.now()-began,renderer,venue:'1920×1080 DPR1 headless Chromium; live providers; scripted input; High default with governor free',steady:summarize(frames.steady),transitions:summarize(frames.transition),samples,events,errors,responses};
  report.limits={p95Frame:20,p99Frame:33.3,p95Draws:375,p95Triangles:2200000};
  report.resource={p95Draws:quantile(samples.map(s=>s.draws).filter(Number.isFinite),.95),p95Triangles:quantile(samples.map(s=>s.triangles).filter(Number.isFinite),.95)};
  report.passes={noUncaughtErrors:errors.length===0,frameTarget:report.steady.p95<=20&&report.steady.p99<=33.3,drawCeiling:report.resource.p95Draws!=null&&report.resource.p95Draws<=375,triangleCeiling:report.resource.p95Triangles!=null&&report.resource.p95Triangles<=2200000};
  writeFileSync(path.join(OUT,'soak.json'),JSON.stringify(report,null,2));console.log('SOAK complete',JSON.stringify({steady:report.steady,resources:report.resource,passes:report.passes}));if(Object.values(report.passes).some(v=>!v))process.exitCode=1;
 }catch(e){console.error(e);errors.push(e.message);writeFileSync(path.join(OUT,'soak-error.json'),JSON.stringify({at:new Date().toISOString(),renderer,errors,samples,events,responses},null,2));process.exitCode=1;}
 finally{await browser?.close();server?.kill();writeFileSync(path.join(OUT,'soak-server.log'),log);}
})();
