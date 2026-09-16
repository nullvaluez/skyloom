/* Recorded production-world review, deliberately separate from timing gates.
 * Normal integrator; translating cruise/boost/turn/stop/return commands. */
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const [k,...v]=a.replace(/^--/,'').split('=');return[k,v.join('=')||true];}));
const url=args.url||'http://localhost:3028',siteName=args.site||'erie';
const sites={erie:{lat:41.7588,lon:-82.6925,ground:175,heading:349,noon:18,dusk:25,night:5},elyria:{lat:41.1859,lon:-82.0982,ground:252,heading:93,noon:18,dusk:25,night:5},manhattan:{lat:40.7028,lon:-74.017,ground:0,heading:17,noon:17,dusk:24.3,night:4},owens:{lat:36.601,lon:-118.06,ground:1150,heading:109,noon:20,dusk:27.3,night:8},powell:{lat:40.2083,lon:-83.0701,ground:280,heading:109,noon:18,dusk:25,night:5}};
sites['owens-boundary']={lat:36.6326,lon:-117.945,ground:2423,heading:172,noon:20,dusk:27.3,night:8};
sites.jfk={lat:40.6245,lon:-73.7854,ground:4,heading:44,noon:17,dusk:24.3,night:4};
Object.assign(sites,require('./earth-world-fixtures.cjs'));
const site=sites[siteName],seconds=Number(args.seconds||60),output=path.resolve(args.output||`.graphics-review/stylized-earth/final/motion-${siteName}`);
(async()=>{
 const report={...require('./graphics-source.cjs')(),status:'BLOCKED',purpose:'Recorded visual/movement evidence, not frame-time certification',errors:[],legs:[]};let browser,context;
 try{
  if(!site)throw Error('Unknown site');
  fs.mkdirSync(output,{recursive:true});
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
  context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,recordVideo:{dir:output,size:{width:1280,height:720}}});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|TypeError|ReferenceError/.test(m.text()))report.errors.push(m.text().slice(0,2000));});
  await page.addInitScript(({hour,weather})=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-crash-mode','forgiving');window.__flySunOverride=Date.UTC(2026,6,18)+hour*3600000;window.__flyWeatherOverride=weather;},{hour:site[args.time]??site.noon,weather:args.time==='overcast'?'overcast':'baseline'});
  await page.goto(`${url}/?earth=stylized&graphicsReview=1`,{waitUntil:'domcontentloaded',timeout:90000});
  if(args['build-id'])report.servedBuild=await require('./ground-build-receipt.cjs')(page,url,args['build-id']);
  await page.waitForFunction(()=>window.__flyBoot?.pct===100&&window.__fly,null,{timeout:120000});
  for(const feet of String(args.levels||'300,1000,3000').split(',').map(Number)){
   await page.evaluate(({site,feet})=>{
    const rt=window.__fly,f=rt.flight;delete f.step;rt.autopilot.disengage();rt.warpToGeo(site.lat,site.lon,{altM:(feet<10000?site.ground:0)+feet*.3048,name:null});
    f.heading=site.heading*Math.PI/180;f.pitch=0;f.bank=0;
    // Settle only the actor. All streaming, terrain, lighting and quality remain live.
    f.step=()=>{f.speed=0;};
   },{site,feet});
   await page.waitForTimeout(15000);
   await page.waitForFunction(()=>window.__fly.earthSurface?.ready>=16,null,{timeout:60000});
   const start=await page.evaluate(({feet,seconds,climb})=>{
    const rt=window.__fly,f=rt.flight;
    f.pos.y=feet<10000?f.groundElev+feet*.3048:Math.max(f.groundElev+100,feet*.3048);
    const altitude=f.pos.y,start={x:f.pos.x,z:f.pos.z};delete f.step;const step=f.step.bind(f);let elapsed=0,distance=0,last={...start};
    const control=window.__earthMotion={phase:'straight',distance:0,elapsed:0,stoppedFrames:0,returnMinM:Infinity,loads:0,unloads:0};
    rt.engine.map.addEventListener('tile-loaded',()=>control.loads++);rt.engine.map.addEventListener('tile-unload',()=>control.unloads++);
    f.step=(dt,cmd)=>{
      elapsed+=dt;const t=elapsed/seconds;
      const phase=t<.12?'straight':t<.20?'boost':t<.30?'bank':t<.46?'stop':'return';
      let turn=phase==='bank'?.65:0;
      if(phase==='return'){
        const heading=Math.atan2(start.x-f.pos.x,-(start.z-f.pos.z));
        const error=Math.atan2(Math.sin(heading-f.heading),Math.cos(heading-f.heading));turn=Math.max(-1,Math.min(1,error*1.5));
        control.returnMinM=Math.min(control.returnMinM,Math.hypot(start.x-f.pos.x,start.z-f.pos.z));
      }
      const climbM=climb?120*Math.sin(Math.PI*Math.max(0,Math.min(1,(t-.12)/.38))):0;
      const desired=(feet<10000?f.groundElev+feet*.3048:altitude)+climbM;
      step(dt,{...cmd,turn,pitch:Math.max(-.4,Math.min(.4,(desired-f.pos.y)*.002)),boost:phase==='boost',speedOverride:phase==='stop'?0:phase==='boost'?undefined:200,speedPreset:'cruise'});
      distance+=Math.hypot(f.pos.x-last.x,f.pos.z-last.z)/Math.cosh(f.pos.z/6378137);last={x:f.pos.x,z:f.pos.z};
      Object.assign(control,{phase,distance,elapsed});if(f.speed<.1)control.stoppedFrames++;
    };
    return{altitude,agl:f.pos.y-f.groundElev,start};
   },{feet,seconds,climb:!!args.climb});
   const leg={feet,datum:feet<10000?'AGL':'MSL',climb:!!args.climb,start,samples:[]};report.legs.push(leg);
   for(let i=0;i<seconds;i++){
    await page.waitForTimeout(1000);
    leg.samples.push(await page.evaluate(()=>{
      const r=window.__fly,f=r.flight;let root=r.engine.object;while(root.parent)root=root.parent;
      let terrain=0,badGeometry=0;root.traverse(o=>{if(o.isTile&&o.model?.parent===o)terrain++;const p=o.geometry?.attributes?.position;if(p&&o.name==='earth-scrub-and-stones'&&p.array.some(v=>!Number.isFinite(v)))badGeometry++;});
      return{at:performance.now(),control:{...window.__earthMotion},pos:{...f.pos},speed:f.speed,agl:f.pos.y-f.groundElev,earth:r.earthSurface,terrain,terrainState:r.terraStats,badGeometry,origin:r.origin.epoch,pins:['__flyTerraPin','__flyGovPin','__flyDepthPin'].map(k=>window[k]??null)};
    }));
   }
   await page.screenshot({path:path.join(output,`${feet}-end.png`)});
   console.log(`Recorded ${siteName} ${feet} ${leg.datum}: ${Math.round(leg.samples.at(-1).control.distance)} m, ${leg.samples.at(-1).control.stoppedFrames} stopped frames`);
  }
  report.status=report.errors.length?'FAIL':report.legs.every(l=>l.samples.every(s=>s.terrain>20&&s.earth?.ready>0&&s.earth.ready<=48&&s.badGeometry===0&&s.pins.every(p=>p===null))&&l.samples.at(-1).control.distance>100)?'CAPTURED':'BLOCKED';
  for(const leg of report.legs){leg.revisited=leg.samples.at(-1).control.returnMinM<500;leg.stopped=leg.samples.at(-1).control.stoppedFrames>0;}
  report.note='Captures require human visual review. revisited requires return within 500 Mercator units of the departure point; each leg reports achieved proximity. Altitude is commanded through ordinary pitch. Video downsampled to 720p from 1080p rendering.';
  const video=page.video();await context.close();context=null;await video.saveAs(path.join(output,'flight.webm'));report.video='flight.webm';
 }catch(e){report.reason=e.stack;}
 finally{await context?.close();await browser?.close();fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(`EARTH MOTION: ${report.status}`);process.exitCode=report.status==='CAPTURED'?0:report.status==='FAIL'?1:2;}
})();
