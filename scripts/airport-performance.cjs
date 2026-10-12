// Paired local evidence plus a 20-minute lifecycle soak. Run after the build.
// Physical midrange certification remains a separate, explicitly recorded gate.
const {chromium}=require('playwright');
const fs=require('fs'),crypto=require('crypto'),cp=require('child_process');
const {enterFlight}=require('./_skip-menus');
const {captureStreamersSettled}=require('./graphics-capture-census.cjs');
const out='.graphics-review/living-airports',mode=process.argv[2]||'paired';
const comparison=mode==='paired'||mode==='resources';
const sites=[{id:'columbus',lat:39.997,lon:-82.894,altM:950,headingRad:1.7},{id:'urban',lat:40.713,lon:-74.016,altM:850,headingRad:0},{id:'mountain',lat:47.26,lon:11.35,altM:2100,headingRad:1.2},{id:'coast',lat:-33.948,lon:151.18,altM:1000,headingRad:0}];
const report={mode,at:new Date().toISOString(),head:cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),diffHash:crypto.createHash('sha256').update(cp.execFileSync('git',['diff','--no-ext-diff'])).digest('hex'),next:require('next/package.json').version,buildIds:{candidate:fs.readFileSync('.next-airports-review/BUILD_ID','utf8'),baseline:fs.readFileSync('.graphics-review/living-airports/baseline/.next/BUILD_ID','utf8')},environment:'Owner PC, isolated headless hardware Chrome. Not the physical RTX 3060/RX 6600 reference.',runs:[],errors:[]};
const reuseBaselines=mode==='paired'&&process.env.AIRPORT_REUSE_BASELINES==='1';
if(reuseBaselines){const source=`${out}/paired-before-spatial.json`,previous=JSON.parse(fs.readFileSync(source));if(previous.buildIds.baseline!==report.buildIds.baseline)throw Error('Baseline build changed');report.runs=previous.runs.filter(r=>r.arm==='baseline');report.reusedBaseline={source,at:previous.at,note:'Three unchanged baseline runs retained; all candidate runs repeated after exact terrain lookup optimization. Not interleaved with the repeated candidate.'};}
report.untrackedSources=Object.fromEntries(cp.execFileSync('git',['ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(f=>/^(lib|components|hooks|stores|public\/data\/runways)\//.test(f)).map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
function save(){fs.writeFileSync(`${out}/${mode}-report.json`,JSON.stringify(report,null,2));}
async function snapshot(page){return page.evaluate(()=>{const r=window.__fly,s=window.__flyStore.getState(),canvas=document.querySelector('canvas'),gl=canvas?.getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');return {gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,viewport:[innerWidth,innerHeight],buffer:canvas?[canvas.width,canvas.height]:null,settings:{quality:s.qualityTier,preset:s.qualityPreset,visuals:s.visuals,style:s.mapStyle,hour:s.conditionsHour,weather:s.conditionsWeather},cinemaProfile:r?.cinemaProfile,governor:window.__flyGov?.state(),camera:r.camera?{position:r.camera.position.toArray(),fov:r.camera.fov,quaternion:r.camera.quaternion.toArray()}:null,readiness:r?.worldReadiness,geo:r?.geo,traffic:r?.trafficStatus,frame:window.__flyStats?.frame?.sample?.()||window.__flyStats?.frame,stats:window.__flyStats,graphics:window.__graphicsReview,textures:window.__groundTextureAudit?.snapshot(),heap:performance.memory?.usedJSHeapSize,loading:r?.worldLoading,sun:r?.sun};});}
async function startWindow(page){await page.evaluate(()=>{window.__flyStats?.frame?.reset?.();const b=window.__airportMeasure={frames:[],running:true,last:0};function tick(){if(!b.running)return;const now=performance.now();if(b.last)b.frames.push(now-b.last);b.last=now;requestAnimationFrame(tick);}requestAnimationFrame(tick);});}
async function endWindow(page){const frames=await page.evaluate(()=>{const b=window.__airportMeasure;b.running=false;return b.frames;});const a=[...frames].sort((a,b)=>a-b),at=q=>a[Math.min(a.length-1,Math.floor(a.length*q))];return {count:a.length,p50:at(.5),p95:at(.95),p99:at(.99),worstDt:a.at(-1),long100:a.filter(v=>v>100).length,long33:a.filter(v=>v>33).length};}
async function boot(browser,url,quality,width){report.allocationAudit=mode==='resources';const page=await browser.newPage({viewport:{width,height:1440},deviceScaleFactor:1});if(mode==='resources')await page.addInitScript(require('./ground-texture-audit.cjs').installGroundTextureAudit);page.on('crash',()=>{report.errors.push('Renderer process crashed');browser.close();});page.on('pageerror',e=>report.errors.push(e.message));await page.addInitScript(({quality,holdQuality})=>{if(holdQuality)window.__flyGovPin='hold';window.__flyVisualsOverride='enhanced';window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,9,12,16);localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-quality-tier',quality);localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-encounters','0');},{quality,holdQuality:comparison});if(comparison)await page.route('**/api/aircraft?**',route=>route.fulfill({json:{ac:[],now:Date.now(),source:'QA quiet fixture'}}));await page.goto(url,{waitUntil:'domcontentloaded'});await enterFlight(page,sites[0],{waitReveal:false,timeoutMs:180000});await page.waitForFunction(()=>window.__flyBoot?.pct===100,undefined,{timeout:65000}).catch(async()=>{report.loadingLimited??=[];report.loadingLimited.push(await page.evaluate(()=>window.__fly.worldReadiness));const button=page.getByRole('button',{name:'Continue with reduced detail',exact:true});if(await button.isVisible())await button.click();});await page.evaluate(()=>{const s=window.__flyStore.getState();s.setConditionsHour?.(12);s.setConditionsWeather?.('clear');s.setFlightMode('free');});return page;}
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});try{
 if(comparison){
  // The same provider response is replayed to both arms so contact density and
  // feed failures cannot masquerade as rendering changes. Quiet is deliberate.
  report.qualityHold='Existing __flyGovPin=hold on both arms; sustained route leaves governor active';report.trafficFixture='empty live response; this does not certify dense traffic';report.pins={sunUTC:'2026-10-12T16:00:00Z',weather:'baseline',visuals:'enhanced',style:'satellite'};
  for(const [quality,width]of (mode==='resources'?[['high',5120]]:[['medium',2560],['high',5120]]))for(let pair=1;pair<=(mode==='resources'?1:3);pair++)for(const arm of reuseBaselines?['candidate']:pair%2?['baseline','candidate']:['candidate','baseline']){
   const url=arm==='baseline'?'http://localhost:3098/?graphicsReview=1':'http://localhost:3097/?graphicsReview=1&airports=on&airportArt=on&airportScenery=on';
   console.log(`START ${arm} ${quality} pair ${pair}`);const p=await boot(browser,url,quality,width);
   await p.route('**/api/aircraft?**',route=>route.fulfill({json:{ac:[],now:Date.now(),source:'QA quiet fixture'}}));
   const run={quality,width,pair,arm,sites:[]};report.runs.push(run);
   for(const site of sites){
    if(arm==='candidate'){const id={columbus:'KCMH',urban:'KJFK',mountain:'LOWI',coast:'YSSY'}[site.id];await p.evaluate(id=>window.__fly.airportWatch.enter(id),id);await p.evaluate(()=>window.__fly.airportWatch.leave());}
    const start=Date.now();await p.evaluate(site=>{const r=window.__fly,s=window.__flyStore.getState();s.setPhase('flying');r.operations.phase='airborne';r.operations.profile=null;r.warpToGeo(site.lat,site.lon,{altM:site.altM,headingRad:site.headingRad});r.input.speedPreset='slow';s.setPhase('paused');},site);
    await p.waitForFunction(()=>!window.__fly.worldLoading,undefined,{timeout:90000});await p.waitForFunction(captureStreamersSettled,undefined,{timeout:60000});await p.waitForTimeout(6000);
    const loadingMs=Date.now()-start;
    if(pair===1)await p.screenshot({path:`${out}/${arm}-${quality}-${site.id}.png`,timeout:30000,style:'body * { visibility:hidden!important; } canvas { visibility:visible!important; }'});
    const before=await snapshot(p);await startWindow(p);await p.evaluate(()=>window.__flyStore.getState().setPhase('flying'));
    await p.waitForTimeout(12000);
    const windowFrame=await endWindow(p),reading=await snapshot(p);run.sites.push({site:site.id,loadingMs,...reading,before:{governor:before.governor,cinemaProfile:before.cinemaProfile,camera:before.camera,geo:before.geo},rollingFrame:reading.frame,frame:windowFrame});save();console.log(`${arm} ${quality} pair ${pair} ${site.id}: p95=${windowFrame.p95} p99=${windowFrame.p99}`);
   }await p.close();
  }
 }else{
  const p=await boot(browser,'http://localhost:3097/?graphicsReview=1&airports=on&airportArt=on&airportScenery=on','high',5120);
  const start=Date.now();let leg=0;report.requiredDurationMs=1200000;
  while(Date.now()-start<1200000){
   const airport=['KCMH','KJFK','LOWI','YSSY'][leg%4];
   const transferStart=Date.now();
   await p.evaluate(id=>{window.__soakTransferError=null;window.__fly.airportWatch.enter(id).catch(e=>window.__soakTransferError=e.message);},airport);await p.waitForFunction(id=>window.__fly.airportWatch.airport?.id.startsWith(id)||window.__soakTransferError,airport,{timeout:60000});
   await p.waitForFunction(()=>!window.__fly.worldLoading,undefined,{timeout:90000});
   await p.getByTestId('warp-hold').waitFor({state:'hidden',timeout:10000});
   const transferMs=Date.now()-transferStart;
   await p.evaluate(hour=>{delete window.__flySunOverride;window.__flyStore.getState().setConditionsHour(hour);},[12,18,0][leg%3]);
   for(let view=0;view<3;view++){await p.evaluate(i=>window.__fly.airportWatch.chooseView(i),view);await p.waitForTimeout(3000);}
   if(leg%4===0){try{const [photo]=await Promise.all([p.waitForEvent('download',{timeout:45000}),p.getByRole('button',{name:'Photo',exact:true}).click({timeout:20000})]);await photo.delete();}catch(error){report.photoFailure={leg,state:await snapshot(p),text:await p.locator('body').innerText()};await p.screenshot({path:`${out}/soak-photo-failure.png`});throw error;}}
   const joined=await p.evaluate(()=>{const r=window.__fly;const contacts=r.traffic.items.filter(t=>!(t.flags&1)&&t.stale===0&&t.distM<15000&&t.ry>r.flight.groundElev+500).slice(0,12);let result={ok:false,message:'No suitable live contact'};for(const t of contacts){result=r.airportWatch.join(t.hex);if(result.ok)break;}return {...result,attempted:contacts.length};});
   if(joined.ok){await p.waitForTimeout(8000);await p.evaluate(()=>window.__fly.autopilot.disengage());}
   const site=sites[leg%sites.length];await p.evaluate(site=>{const r=window.__fly,s=window.__flyStore.getState();r.airportWatch.leave();r.operations.profile=null;r.operations.phase='airborne';s.setPhase('flying');r.warpToGeo(site.lat,site.lon,{altM:site.altM,headingRad:site.headingRad});},site);
   await p.waitForFunction(()=>!window.__fly.worldLoading,undefined,{timeout:90000});
   await startWindow(p);
   await p.keyboard.down('d');await p.waitForTimeout(3500);await p.keyboard.up('d');await p.waitForTimeout(10000);
   const flightFrame=await endWindow(p);let background=null;
   if(leg%4===3){const other=await browser.newPage();await other.bringToFront();await p.waitForTimeout(1000);background=await p.evaluate(()=>document.hidden);await other.close();await p.bringToFront();}
   const reading=await snapshot(p);report.runs.push({elapsedMs:Date.now()-start,leg,airport,joined,transferMs,flightFrame,background,...reading});save();console.log(`soak ${Math.round((Date.now()-start)/60000)} min, leg ${leg}, ${airport}, heap ${Math.round((reading.heap||0)/1048576)} MiB`);leg++;
  }report.durationMs=Date.now()-start;await p.close();
 }
}catch(e){report.failure=e.stack;console.error(e);process.exitCode=1;}finally{save();await browser.close();}})();
