/* Requested visual acceptance harness. Captures are held; timing is translating,
 * unpinned production terrain/governor, without allocation instrumentation.
 * Run modes separately. Missing providers/hardware are BLOCKED, never green. */
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
const {enterFlight}=require('./_skip-menus');
const {captureBudgetChecks}=require('./graphics-capture-budget.cjs');
const args=Object.fromEntries(process.argv.slice(2).map(s=>{const[k,...v]=s.replace(/^--/,'').split('=');return[k,v.join('=')||true];}));
const mode=args.mode||'capture',url=args.url||'http://localhost:3039';
const output=path.resolve(args.output||`.graphics-review/painterly/${mode}`);
const sites={
  ohio:{lat:40.20403,lon:-83.0896,ground:280,heading:3.9,hour:18},
  powell:{lat:40.2083,lon:-83.0701,ground:280,heading:1.9,hour:18},
  manhattan:{lat:40.7028,lon:-74.017,ground:0,heading:.3,hour:17},
  mountains:{lat:36.6326,lon:-117.945,ground:2423,heading:172*Math.PI/180,hour:20},
  owens:{lat:36.601,lon:-118.06,ground:1150,heading:1.9,hour:20},
  arid:{lat:36.44,lon:-117.96,ground:1100,heading:3.5,hour:20},
  desert:{lat:36.56,lon:-118.17,ground:1400,heading:2.4,hour:20},
  nevada:{lat:36.9174,lon:-116.0940,ground:1575,agl:192,heading:79*Math.PI/180,hour:20,weather:'clear'},
  alaska:{lat:64.6421,lon:-147.0470,ground:168,agl:469,heading:166*Math.PI/180,hour:22,weather:'clear'},
  rio:{lat:-22.9518,lon:-43.1776,ground:29,agl:880,heading:262*Math.PI/180,hour:23},
  coast:{lat:41.7588,lon:-82.6925,ground:175,heading:349*Math.PI/180,hour:18},
};
function read(){
  const rt=window.__fly,s=window.__flyStore.getState(),canvas=document.querySelector('canvas');
  let scene=rt.engine.object;while(scene.parent)scene=scene.parent;
  const seen=new Set(),buffers=new Set();let geometryBytes=0;
  const count=a=>{const array=a?.array??a?.data?.array;if(array&&!buffers.has(array)){buffers.add(array);geometryBytes+=array.byteLength;}};
  scene.traverse(o=>{if(o.geometry&&!seen.has(o.geometry)){seen.add(o.geometry);Object.values(o.geometry.attributes).forEach(count);count(o.geometry.index);}count(o.instanceMatrix);count(o.instanceColor);});
  let relief=0,resident=0;rt.engine.forEachLoadedTile(t=>{resident++;if(t.model.geometry?.userData.r25Relief)relief++;});
  return {profile:s.visuals,style:s.mapStyle,tier:s.qualityTier,pose:{x:rt.flight.pos.x,y:rt.flight.pos.y,z:rt.flight.pos.z,aglM:rt.flight.pos.y-rt.flight.groundElev,heading:rt.flight.heading,bank:rt.flight.bank},
    review:window.__graphicsReview,earth:rt.earthSurface,r25Ground:window.__flyStats?.r25Ground??rt.r25Ground,r25Sky:window.__flyStats?.r25Sky,
    residentTiles:resident,reliefTiles:relief,geometryBytes,geometryScope:'Live scene unique attribute payload, including instance attributes. Excludes cached/detached meshes and driver overhead.',textureAudit:window.__groundTextureAudit?.snapshot({topLimit:10}),
    canvas:[canvas.width,canvas.height],output:[innerWidth,innerHeight],traffic:rt.traffic?.tracks?.size,
    pins:{terrain:window.__flyTerraPin??null,governor:window.__flyGovPin??null},readiness:rt.worldReadiness};
}
// Report to microseconds; discard only binary floating-point subtraction noise.
const pct=(a,p)=>a.length?Number([...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*p)].toFixed(3)):null;
async function main(){
  fs.mkdirSync(output,{recursive:true});let browser;
  const report={mode,status:'IN_PROGRESS',source:require('./graphics-source.cjs')(),hardwareChecks:{desktop:'unverified',radeon780M:'unverified'},errors:[],terrainFailures:[],checks:[],shots:[]};
  const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  const check=(name,status,detail)=>{report.checks.push({name,status,detail});console.log(`${status} ${name}`);save();};
  try{
    browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
    const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
    page.on('pageerror',e=>report.errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|TypeError|ReferenceError/.test(m.text()))report.errors.push(m.text().slice(0,4000));});
    if(mode==='timing')page.on('response',r=>{if(/(?:MapServer|ImageServer)\/tile\//.test(r.url())&&r.status()>=400)report.terrainFailures.push({url:r.url(),status:r.status()});});
    const fresh=args.profile||'classic';
    await page.addInitScript(({mode,fresh})=>{
      localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals',fresh);localStorage.setItem('fly-aircraft','prop');
      localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-crash-mode','forgiving');
      window.__flyTitleBypass=true;window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,6,18,18);
      if(mode!=='timing'){window.__flyGovPin='hold';window.__flyCloudFreeze=1;}
    },{mode,fresh});
    if(mode==='allocation')await page.addInitScript(require('./ground-texture-audit.cjs').installGroundTextureAudit);
    await page.goto(`${url}/?graphicsReview=1`,{waitUntil:'domcontentloaded',timeout:90000});
    await enterFlight(page,{...sites.ohio,altM:380,name:null},{timeoutMs:90000,waitReveal:true});
    await page.evaluate(()=>window.__flyStore.getState().setAircraftId('prop'));
    report.hardware=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return{renderer:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),userAgent:navigator.userAgent};});
    console.log(JSON.stringify(report.hardware));
    report.freshProfile=fresh;
    const hold=async(site,time='daylight',bank=0)=>{
      await page.evaluate(({site,time,bank})=>{
        const rt=window.__fly,f=rt.flight;
        window.__flyWeatherOverride=time==='overcast'?'overcast':(site.weather||'baseline');
        window.__flySunOverride=Date.UTC(2026,6,18)+(time==='dusk'?25:time==='night'?5:site.hour)*3600000;
        rt.autopilot.disengage();rt.warpToGeo(site.lat,site.lon,{altM:site.ground+(site.agl||100),headingRad:site.heading,name:null});
        window.__paintStep??=f.step.bind(f);f.step=()=>{};
        f.heading=site.heading;f.pitch=-.04;f.bank=bank;f.speed=0;rt.chaseCam?.snap?.();
      },{site,time,bank});
      await page.waitForTimeout(Number(args.settle||16000));
      await page.evaluate(agl=>{const f=window.__fly.flight;f.pos.y=f.groundElev+agl;f.agl=agl;window.__fly.chaseCam?.snap?.();},site.agl||100);
      await page.waitForTimeout(2000);
      await page.waitForFunction(()=>window.__fly.worldReadiness?.ready&&window.__graphicsReview?.terrain?.sharp,null,{timeout:45000}).catch(()=>{});
    };
    if(mode==='timing'){
      report.measuredProfile=args['bench-profile']||'enhanced';
      await page.evaluate(p=>window.__flyStore.getState().setVisuals(p),report.measuredProfile);
      await page.waitForTimeout(25000);
      let profiler;
      if(args['cpu-profile']){
        profiler=await page.context().newCDPSession(page);await profiler.send('Profiler.enable');await profiler.send('Profiler.start');
        report.diagnosticOnly=true;
      }
      const seconds=Number(args.seconds||90);
      await page.evaluate(()=>{
        const rt=window.__fly,f=rt.flight;rt.autopilot.disengage();window.__flyStore.getState().setPhase('flying');
        const original=f.step.bind(f),target=f.groundElev+140;
        f.step=(dt,cmd)=>original(dt,{...cmd,speedOverride:180,turn:.10*Math.sin(performance.now()/8500),pitch:Math.max(-.2,Math.min(.2,(target-f.pos.y)*.002)),boost:false});
        const b=window.__paintTiming={start:performance.now(),last:0,frames:[],travel:0,previous:null,samples:[],run:true};
        function tick(now){if(!b.run)return;if(b.last)b.frames.push(now-b.last);b.last=now;
          const k=1/Math.cos(f.latDeg*Math.PI/180);if(b.previous)b.travel+=Math.hypot(f.pos.x-b.previous[0],f.pos.z-b.previous[1])/k;b.previous=[f.pos.x,f.pos.z];
          if(b.frames.length%60===0){const c=document.querySelector('canvas');let resident=0;rt.engine.forEachLoadedTile(()=>resident++);b.samples.push({seconds:(now-b.start)/1000,canvas:[c.width,c.height],tier:window.__flyStore.getState().qualityTier,triangles:window.__graphicsReview?.triangles,draws:window.__graphicsReview?.drawCalls,traffic:rt.traffic.tracks.size,resident,terrainSharp:window.__graphicsReview?.terrain?.sharp,camTileZ:window.__graphicsReview?.terrain?.camTileZ,programs:window.__graphicsReview?.programs});}
          requestAnimationFrame(tick);
        }requestAnimationFrame(tick);
      });
      for(let s=0;s<seconds;s+=10){await page.waitForTimeout(Math.min(10,seconds-s)*1000);console.log(`Flight ${Math.min(seconds,s+10)}/${seconds}s`);}
      const b=await page.evaluate(()=>{window.__paintTiming.run=false;return window.__paintTiming;});
      if(profiler){const {profile}=await profiler.send('Profiler.stop');fs.writeFileSync(path.join(output,'flight.cpuprofile'),JSON.stringify(profile));await profiler.detach();}
      report.timing={seconds,frames:b.frames.length,p95Ms:pct(b.frames,.95),p99Ms:pct(b.frames,.99),travelM:b.travel,samples:b.samples};
      report.final=await page.evaluate(read);
      // 'sharp' requires zero downloads and a settled zoom. It is an arrival
      // gate, not a valid requirement while translating across new tiles.
      // Keep graphics-flight's existing 20-resident-tile readiness floor,
      // require live traffic, and separately reject real provider failures.
      check('live traffic and loaded terrain during flight',b.samples.some(s=>s.traffic>0)&&b.samples.every(s=>s.resident>=20)&&!report.terrainFailures.length?'PASS':'BLOCKED',{minimumResident:Math.min(...b.samples.map(s=>s.resident)),providerFailures:report.terrainFailures.length});
      report.motionBudget={drawP95:pct(b.samples.map(s=>s.draws),.95),trianglesP95:pct(b.samples.map(s=>s.triangles),.95)};
      check('existing continuous-flight resource limits',report.motionBudget.drawP95<=375&&report.motionBudget.trianglesP95<=2200000?'PASS':'FAIL',report.motionBudget);
      check('terrain and governor unpinned',!report.final.pins.terrain&&!report.final.pins.governor?'PASS':'FAIL',report.final.pins);
      check('actual continuous ground travel',b.travel>=50*seconds?'PASS':'BLOCKED',{metres:b.travel});
      const hardware=!/swiftshader|software|llvmpipe/i.test(report.hardware.renderer||'');
      const resolution=b.samples.every(s=>s.canvas[0]>=1440&&s.canvas[1]>=810);
      check('1080p output with at least 75% internal resolution',resolution?'PASS':'FAIL',b.samples.map(s=>s.canvas));
      const integrated=/780M/i.test(report.hardware.renderer),target=integrated?33.3:16.7;
      check('p95 frame target',!hardware?'BLOCKED':report.timing.p95Ms<=target?'PASS':'FAIL',{targetMs:target,actualMs:report.timing.p95Ms,renderer:report.hardware.renderer});
      report.hardwareChecks[integrated?'radeon780M':'desktop']=!hardware||report.diagnosticOnly?'unverified':report.timing.p95Ms<=target&&resolution?'pass':'fail';
    }else{
      const names=(args.sites||'ohio,powell,manhattan,mountains,owens,arid,desert,coast').split(',');
      for(const name of names){
        for(const time of name==='ohio'?(args.times||'daylight,overcast,dusk,night').split(','):name==='rio'?['night']:['daylight']){
          await hold(sites[name],time);
          for(const profile of ['classic','enhanced']){
            await page.evaluate(p=>window.__flyStore.getState().setVisuals(p),profile);await page.waitForTimeout(profile==='enhanced'?10000:2500);
            const state=await page.evaluate(read),file=`${name}-${time}-${profile}.png`;
            await page.screenshot({path:path.join(output,file)});report.shots.push({name,time,profile,file,...state});save();console.log(`Captured ${file}`);
            if(args.reference&&profile==='enhanced'){
              await page.evaluate(()=>window.__flyPainterlyOverride=0);await page.waitForTimeout(1500);
              await page.screenshot({path:path.join(output,`${name}-${time}-r25-reference.png`)});
              await page.evaluate(()=>delete window.__flyPainterlyOverride);await page.waitForTimeout(1500);
            }
          }
        }
      }
      const enhanced=report.shots.filter(s=>s.profile==='enhanced');
      check('Classic-first relief reaches resident tiles',enhanced.some(s=>s.reliefTiles>0)?'PASS':'FAIL',enhanced.map(s=>({site:s.name,relief:s.reliefTiles,resident:s.residentTiles,queue:s.r25Ground?.backfill})));
      check('painted materials available',enhanced.every(s=>s.earth?.materials?.painterly?.state==='ready')?'PASS':'BLOCKED');
      check('mapped world ready in every matched view',report.shots.every(s=>s.readiness?.ready&&s.review?.terrain?.sharp)?'PASS':'BLOCKED',report.shots.map(s=>({file:s.file,ready:s.readiness?.ready,sharp:s.review?.terrain?.sharp,missing:s.readiness?.missing})));
      report.budgets=captureBudgetChecks(report.shots,mode==='allocation');
      check('existing per-scene resource limits',report.budgets.every(b=>b.pass)?'PASS':'FAIL',report.budgets);
      if(!args['shots-only']){
      // Repeated profile/style changes and tier reductions reuse mapped content.
      report.transitions=[];
      for(const [style,profile,tier]of [['toy','enhanced','high'],['toy','classic','high'],['satellite','enhanced','low'],['satellite','classic','medium'],['satellite','enhanced','high']]){
        await page.evaluate(([style,profile,tier])=>{const s=window.__flyStore.getState();s.setMapStyle(style);s.setVisuals(profile);s.setQualityTier(tier);},[style,profile,tier]);await page.waitForTimeout(6000);
        report.transitions.push(await page.evaluate(read));
      }
      check('Neon releases painterly resources',report.transitions.filter(s=>s.style==='toy').every(s=>!s.r25Ground?.live&&(!s.earth?.materials?.painterly?.bytes))?'PASS':'FAIL');
      await hold(sites.ohio,'daylight',.4);
      for(const profile of ['classic','enhanced']){
        await page.evaluate(p=>window.__flyStore.getState().setVisuals(p),profile);await page.waitForTimeout(3500);
        const state=await page.evaluate(read),file=`ohio-bank-revisit-${profile}.png`;
        await page.screenshot({path:path.join(output,file)});report.shots.push({name:'ohio',time:'bank / revisit',profile,file,...state});save();
      }
      report.revisit=await page.evaluate(read);
      check('bank and revisit resource limits',captureBudgetChecks(report.shots.filter(s=>s.time==='bank / revisit'),mode==='allocation').every(s=>s.pass)?'PASS':'FAIL');
      await page.evaluate(()=>window.__flyStore.getState().setHangarOpen(true));await page.waitForTimeout(1500);
      await page.evaluate(()=>window.__flyStore.getState().setHangarOpen(false));await page.waitForTimeout(1500);
      report.hangarReturn=await page.evaluate(read);
      check('hangar return retains Enhanced and loaded geography',report.hangarReturn.profile==='enhanced'&&report.hangarReturn.residentTiles>0?'PASS':'FAIL');
      // Real fetch failure followed by recovery; ordinary world layers keep running.
      await page.evaluate(()=>window.__flyStore.getState().setVisuals('classic'));await page.waitForTimeout(300);
      await page.route('**/materials/cinematic-v3/*.bin',r=>r.fulfill({status:503,body:'Controlled material outage'}));
      await page.evaluate(()=>window.__flyStore.getState().setVisuals('enhanced'));await page.waitForTimeout(2000);
      report.failedProvider=await page.evaluate(read);
      await page.unroute('**/materials/cinematic-v3/*.bin');await page.waitForTimeout(16000);
      report.recoveredProvider=await page.evaluate(read);
      check('material outage and recovery',report.failedProvider.earth?.materials?.painterly?.state==='fallback'&&report.recoveredProvider.earth?.materials?.painterly?.state==='ready'?'PASS':'FAIL');
      if(mode==='allocation'){
        // Allocation while actually streaming. No frame-time claim is made
        // from this instrumented run. Held poses alone miss transient uploads.
        await page.evaluate(()=>{
          const f=window.__fly.flight,step=window.__paintStep;
          window.__flyStore.getState().setPhase('flying');
          f.step=(dt,cmd)=>step(dt,{...cmd,speedOverride:180,turn:.1,pitch:0,boost:false});
        });
        report.motionAllocations=[];
        for(let i=0;i<6;i++){
          await page.waitForTimeout(10000);report.motionAllocations.push(await page.evaluate(read));
          if(i===0||i===5)await page.screenshot({path:path.join(output,`fast-flight-${i+1}.png`)});
          console.log(`Streaming allocation ${(i+1)*10}/60s`);save();
        }
        const last=report.motionAllocations.at(-1).textureAudit;
        check('texture allocation budget including continuous travel',last?.peakComplete&&last.peakBytes<=300*1048576?'PASS':'FAIL',last);
      }
      }
    }
    check('no runtime or shader errors',report.errors.length?'FAIL':'PASS',report.errors);
    report.status=report.checks.some(c=>c.status==='FAIL')?'FAIL':report.checks.some(c=>c.status==='BLOCKED')?'BLOCKED':'PASS';
  }catch(error){report.status='BLOCKED';report.reason=error.stack;console.error(error.message);}
  finally{await browser?.close();save();console.log(`PAINTERLY BROWSER: ${report.status}`);process.exitCode=report.status==='PASS'?0:report.status==='FAIL'?1:2;}
}
main();
