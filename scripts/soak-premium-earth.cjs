/** Live-provider endurance check for the optional Premium Earth preview.
 * Uses the real clock, free governor and moving aircraft. Scripted altitude/
 * heading keep the route repeatable; this is renderer evidence, not flight QA.
 * FLY_URL=http://localhost:3021; --minutes=15 --mobile=1 --flags=...
 * Desktop phone emulation never certifies Safari or physical iPhone thermals.
 */
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const [k,...v]=a.replace(/^--/,'').split('=');return[k,v.join('=')||'1'];}));
const minutes=Number(args.minutes||15),mobile=args.mobile==='1';
if(!Number.isFinite(minutes)||minutes<.25||minutes>30)throw Error('Expected 0.25–30 minutes');
const root=path.resolve(args.out||'.graphics-review/premium-earth/soak');fs.mkdirSync(root,{recursive:true});
const flags=args.flags??'MATERIAL_SCANS,SCENERY_FORMS,SHOWCASE_EARTH,BUILDING_REALISM,CITY_HORIZON,TWILIGHT_BALANCE';
const route=[
 {name:'Manhattan noon',lat:40.72,lon:-74.015,altM:900,heading:0,hour:13},
 {name:'Yosemite valley',lat:37.726,lon:-119.649,altM:4000,heading:80,hour:14},
 {name:'Yosemite boundary',lat:37.74,lon:-119.72,altM:4000,heading:90,hour:16},
 {name:'Manhattan night return',lat:40.72,lon:-74.015,altM:950,heading:10,hour:23},
 {name:'Yosemite granite return',lat:37.722,lon:-119.646,altM:4000,heading:35,hour:15},
];
const percentile=(values,q)=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[Math.min(a.length-1,Math.floor(a.length*q))]:null;};
const summarize=a=>({count:a.length,p50:percentile(a,.5),p95:percentile(a,.95),p99:percentile(a,.99),over100:a.filter(v=>v>100).length});
const sourceFiles=fs.readdirSync('lib/fly',{recursive:true}).filter(p=>/\.(?:js|json)$/.test(p)).map(p=>path.join('lib/fly',p));
const sourceHash=()=>{const h=crypto.createHash('sha256');for(const f of sourceFiles)h.update(f).update(fs.readFileSync(f));return h.digest('hex');};
(async()=>{
 const report={at:new Date().toISOString(),minutes,mobileEmulation:mobile,flags,source:sourceHash(),venue:'Installed Chrome / D3D11, live world providers, real clock, governor free; scripted moving route. Phone emulation is not physical iPhone acceptance.',samples:[],events:[],errors:[]};
 let browser;
 const save=()=>fs.writeFileSync(path.join(root,'soak.json'),JSON.stringify(report,null,2));
 try{
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',args:['--use-angle=d3d11','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const page=await browser.newPage({viewport:mobile?{width:430,height:932}:{width:1440,height:900},deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile});
  page.on('pageerror',e=>report.errors.push(e.message));page.on('crash',()=>report.errors.push('renderer crashed'));
  page.on('console',m=>{if(m.type()==='error'&&/shader|GLSL|WebGL|ReferenceError|TypeError/i.test(m.text()))report.errors.push(m.text().slice(0,1000));});
  await page.addInitScript(({mobile})=>{
   window.__flyTitleBypass=true;window.__flyVisualsOverride='enhanced';
   if(mobile){window.__flyDeviceClassOverride='phone';window.__flyCityDeviceClass='phone';}
   localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-quality-tier',mobile?'medium':'high');localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');localStorage.setItem('fly-encounters','0');localStorage.setItem('fly-controls-seen','1');
   localStorage.setItem('fly-explorer-preferences-v1',JSON.stringify({version:1,settings:{tutorial:'done'}}));
  },{mobile});
  await page.route('**/api/aircraft?**',r=>r.fulfill({json:{ac:[],now:Date.now(),total:0,source:'endurance test'}}));
  await page.route('**/api/weather**',r=>r.fulfill({json:{found:false}}));
  await page.goto(`${process.env.FLY_URL||'http://localhost:3021'}/?graphicsReview=1&diag=1&flags=${encodeURIComponent(flags)}`,{waitUntil:'domcontentloaded',timeout:180000});
  await page.waitForFunction(()=>window.__fly?.warpToGeo&&window.__flyStore&&window.__flyStats?.frame,null,{timeout:180000});
  report.gpu=await page.evaluate(()=>{let s=window.__fly.engine.object;while(s.parent)s=s.parent;const g=s.__r3f.root.getState().gl.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return e&&g.getParameter(e.UNMASKED_RENDERER_WEBGL);});
  if(/software|swiftshader|llvmpipe/i.test(report.gpu))throw Error('Real GPU required');
  await page.evaluate(()=>{
   const r=window.__fly,s=window.__flyStore.getState();s.setHangarOpen(false);s.setPhase('flying');r.operations.profile=null;r.operations.phase='airborne';
   const probe=window.__premiumSoak={steady:[],transition:[],last:0,lastWarp:performance.now()};
   const step=r.flight.step.bind(r.flight);
   r.flight.step=(dt,cmd)=>{step(dt,{...cmd,turn:0,pitch:0,boost:false});if(!probe.leg)return;const t=(performance.now()-probe.lastWarp)/1000;r.flight.pos.y=probe.leg.altM;r.flight.heading=probe.leg.heading*Math.PI/180+t*Math.PI/90;r.flight.pitch=.01;r.flight.bank=.08;};
   const tick=t=>{if(probe.last){const dt=t-probe.last;((r.worldLoading||t-probe.lastWarp<20000)?probe.transition:probe.steady).push(dt);}probe.last=t;probe.raf=requestAnimationFrame(tick);};probe.raf=requestAnimationFrame(tick);
  });
  const t0=Date.now();let previous=-1,lastShot=-1;
  while(Date.now()-t0<minutes*60000){
   const elapsed=(Date.now()-t0)/60000,index=Math.min(4,Math.floor(elapsed/(minutes/5)));
   if(index!==previous){previous=index;const leg=route[index];await page.evaluate(l=>{const r=window.__fly,p=window.__premiumSoak;p.leg=l;p.lastWarp=performance.now();window.__flySunOverride=Date.UTC(2026,6,18)+(l.hour-l.lon/15)*3600000;window.__flyWeatherOverride='clear';r.warpToGeo(l.lat,l.lon,{altM:l.altM,headingRad:l.heading*Math.PI/180,name:null});},leg);report.events.push({elapsed,...leg});console.log('LEG',leg.name);}
   const sample=await page.evaluate(elapsed=>{const r=window.__fly,s=window.__flyStore.getState();let scene=r.engine.object;while(scene.parent)scene=scene.parent;const g=scene.__r3f.root.getState().gl;return{elapsed,tier:s.qualityTier,loading:r.worldLoading,render:{...g.info.render},memory:{...g.info.memory},programs:g.info.programs.length,heap:performance.memory?.usedJSHeapSize,governor:window.__flyGov?.state(),surface:r.earthSurface,agl:r.flight.pos.y-r.flight.groundElev,streamers:Object.fromEntries(['satBuildings','satSkyline','satVeg'].map(k=>[k,r[k]?.stats])),position:{...r.flight.pos}};},elapsed);
   report.samples.push(sample);report.elapsed=elapsed;save();
   if(Math.floor(elapsed)!==lastShot){lastShot=Math.floor(elapsed);await page.screenshot({path:path.join(root,`minute-${lastShot}.png`)});console.log(`MINUTE ${lastShot} tier=${sample.tier} loading=${sample.loading} draws=${sample.render.calls} tris=${sample.render.triangles} errors=${report.errors.length}`);}
   await page.waitForTimeout(5000);
  }
  const frames=await page.evaluate(()=>{cancelAnimationFrame(window.__premiumSoak.raf);return{steady:window.__premiumSoak.steady,transition:window.__premiumSoak.transition};});
  report.steady=summarize(frames.steady);report.transitions=summarize(frames.transition);report.sourceAtEnd=sourceHash();report.sourceChanged=report.source!==report.sourceAtEnd;
  report.complete=true;report.resources={p95Draws:percentile(report.samples.map(s=>s.render.calls),.95),p95Triangles:percentile(report.samples.map(s=>s.render.triangles),.95),maxTextures:Math.max(...report.samples.map(s=>s.memory.textures)),maxGeometries:Math.max(...report.samples.map(s=>s.memory.geometries))};
  report.checks={noRuntimeErrors:!report.errors.length,stableSource:!report.sourceChanged,visitedBothRegions:report.events.length===5,regionalDEMObserved:report.samples.some(s=>s.surface?.showcase?.elevation?.replaced>0),materialAssetsReady:report.samples.some(s=>s.surface?.materials?.bytes>0),clearance:report.samples.filter(s=>!s.loading).every(s=>s.agl>200),noStuckFinalLoad:!report.samples.slice(-3).every(s=>s.loading)};
  console.log(JSON.stringify({checks:report.checks,steady:report.steady,resources:report.resources}));if(Object.values(report.checks).some(v=>!v))process.exitCode=1;
 }catch(e){report.errors.push(e.message);console.error(e);process.exitCode=1;}
 finally{save();await browser?.close();}
})();
