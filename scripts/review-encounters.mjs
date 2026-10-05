import {chromium} from 'playwright';
import fs from 'node:fs';
import {register,createRequire} from 'node:module';
register('./_node-resolve.mjs',import.meta.url);
const require=createRequire(import.meta.url),{enterFlight}=require('./_skip-menus.js');
const {ADVENTURES}=await import('../lib/fly/adventures.mjs');
const {activityCourse}=await import('../lib/fly/adventure-activities.mjs');
const out='.graphics-review/encounters';fs.mkdirSync(out,{recursive:true});
const report={errors:[],views:[],checks:[],performance:[],note:'Live browser observations, not a paired baseline performance certification.'};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
page.on('pageerror',e=>{if(!report.errors.some(x=>x.message===e.message))report.errors.push({message:e.message,stack:e.stack});});
const check=(name,pass,data)=>{report.checks.push({name,pass,data});console.log(`${pass?'PASS':'FAIL'} ${name}`);};
try{
  await page.addInitScript(()=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-crash-mode','forgiving');});
  await page.goto('http://localhost:3091/?graphicsReview=1',{waitUntil:'domcontentloaded',timeout:180000});
  await enterFlight(page,{lat:40.7,lon:-74.015,altM:700,headingRad:0,name:null},{timeoutMs:240000,waitReveal:true});
  await page.evaluate(()=>window.__flyStore.getState().setFlightMode('free'));
  await page.waitForFunction(()=>!window.__fly.worldLoading,undefined,{timeout:180000});
  await page.waitForTimeout(5000);
  check('encounter runtime attaches',await page.evaluate(()=>!!window.__fly.encounters));
  for(const id of ['prop','fighter','cargo']){
    await page.evaluate(id=>{const r=window.__fly;r.flight.speed=0;window.__flyStore.getState().setAircraftId(id);r.__reviewStep=r.flight.step;r.flight.step=function(){};},id);
    await page.waitForTimeout(2000);
    for(const mode of ['world','close']){
      await page.evaluate(mode=>window.__flyStore.setState({chaseFraming:mode}),mode);await page.waitForTimeout(2500);
      const data=await page.evaluate(()=>({camera:{fov:window.__fly.camera.fov,position:window.__fly.camera.position.toArray()},player:window.__flyStats.player,traffic:window.__fly.traffic.items.length}));
      await page.screenshot({path:`${out}/${id}-${mode}.png`});report.views.push({id,mode,...data});
    }
    await page.evaluate(()=>{const r=window.__fly;r.flight.step=r.__reviewStep;delete r.__reviewStep;});
  }
  // This leg uses the feed as observed. Never inject a track to make it pass.
  await page.evaluate(()=>{const r=window.__fly;r.autopilot.disengage();window.__flyStore.getState().setAircraftId('fighter');r.flight.speed=r.flight.cfg.speeds.cruise;r.input.neutralize();});
  await page.waitForTimeout(2500);
  await page.getByRole('button',{name:'Nearby',exact:true}).click();
  const live=await page.evaluate(()=>window.__fly.encounters.controller.candidates.find(c=>c.kind==='traffic'));
  if(live){
    await page.getByRole('button',{name:new RegExp(live.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click();
    await page.getByRole('button',{name:'Assist alongside',exact:true}).click();await page.mouse.move(720,450);
    await page.waitForFunction(()=>!window.__fly.encounters.controller.active,undefined,{timeout:180000}).catch(()=>{});
    const outcome=await page.evaluate(()=>({active:window.__fly.encounters.controller.active?.seconds,result:window.__fly.encounters.controller.result}));
    report.liveEncounter={hex:live.hex,...outcome};check('observed live encounter completed',outcome.result==='Flight memory saved in your logbook.',outcome);
    await page.evaluate(()=>{window.__fly.encounters.end();window.__fly.autopilot.disengage();window.__fly.targeting.lockedHex=null;window.__fly.targeting.target=null;window.__flyStore.getState().clearLock();});
  }else report.liveEncounter={available:false};
  const route=ADVENTURES[0],course=activityCourse(route,'prop',route.activities[0].id);
  await page.evaluate(p=>{const r=window.__fly,s=window.__flyStore.getState();s.setAircraftId('prop');s.setFlightMode('free');window.__flyStore.setState({chaseFraming:'world'});r.warpToGeo(p.lat,p.lon,{altM:p.altM,headingRad:p.headingDeg*Math.PI/180,name:null});},course.approach);
  await page.waitForFunction(()=>!window.__fly.worldLoading,undefined,{timeout:180000});
  await page.waitForTimeout(3000);
  await page.getByRole('button',{name:'Nearby',exact:true}).click();
  const candidates=await page.evaluate(()=>window.__fly.encounters.controller.candidates.map(c=>({id:c.id,source:c.source})));
  check('local course offered using live DEM',candidates.some(c=>c.id===course.id),candidates);
  if(candidates.some(c=>c.id===course.id)){
    await page.getByRole('button',{name:new RegExp(course.name)}).click();
    check('course HUD appears',await page.getByTestId('encounter-card').isVisible());
    await page.screenshot({path:`${out}/local-course.png`});
    await page.evaluate(()=>window.__fly.encounters.end());
  }
  await page.evaluate(()=>window.__flyStore.getState().setLogbookOpen(true));
  await page.getByRole('button',{name:'Memories',exact:true}).click();
  check('memories tab available',await page.getByRole('region',{name:'Flight memories'}).isVisible());
  await page.screenshot({path:`${out}/memories.png`});
  await page.evaluate(()=>window.__flyStore.getState().setLogbookOpen(false));
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>window.__flyStore.getState().phase==='flying');
  await page.getByRole('button',{name:'Nearby',exact:true}).click();await page.screenshot({path:`${out}/phone-nearby.png`});
  check('small screen has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.setViewportSize({width:1440,height:900});
  report.performance=await page.evaluate(()=>new Promise(resolve=>{
    const times=[],start=performance.now();let prev=start;
    function frame(now){times.push(now-prev);prev=now;if(now-start<15000)requestAnimationFrame(frame);else{times.sort((a,b)=>a-b);resolve({frames:times.length,rafP95:times[Math.floor(times.length*.95)],notRenderedFrameTiming:true});}}requestAnimationFrame(frame);
  }));
  check('no page errors',report.errors.length===0,report.errors);
}catch(error){report.failure=String(error);console.error(error);process.exitCode=1;}
finally{fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
