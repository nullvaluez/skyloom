import {chromium} from 'playwright';
import {register,createRequire} from 'node:module';
import fs from 'node:fs';
register('./_node-resolve.mjs',import.meta.url);
const {enterFlight}=createRequire(import.meta.url)('./_skip-menus.js');
const {ADVENTURES}=await import('../lib/fly/adventures.mjs');
const {activityCourse}=await import('../lib/fly/adventure-activities.mjs');
const {PHOTO}=await import('../lib/fly/fly-constants.js');
const photoOnly=process.argv.includes('--photo-only');
const out='.graphics-review/encounters',report={errors:[],checks:[]};fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
page.on('pageerror',e=>{report.errors.push({message:e.message,stack:e.stack});});
const check=(name,pass,data)=>{report.checks.push({name,pass,data});console.log(`${pass?'PASS':'FAIL'} ${name}`);if(!pass)process.exitCode=1;};
const route=ADVENTURES[0],course=activityCourse(route,'prop',route.activities[0].id),photo=activityCourse(route,'prop',route.activities[2].id);
try{
  await page.addInitScript(()=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');localStorage.setItem('fly-aircraft','prop');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-crash-mode','forgiving');});
  await page.goto('http://localhost:3091/?graphicsReview=1',{waitUntil:'domcontentloaded',timeout:120000});
  await enterFlight(page,{...(photoOnly?photo:course).approach,headingDeg:(photoOnly?photo:course).approach.headingDeg,name:null},{timeoutMs:180000,waitReveal:true});
  await page.evaluate(()=>window.__flyStore.getState().setFlightMode('free'));
  await page.waitForFunction(()=>!window.__fly.worldLoading,undefined,{timeout:180000});
  if(!photoOnly){
  await page.getByRole('button',{name:'Nearby',exact:true}).click();await page.getByRole('button',{name:new RegExp(course.name)}).click();
  await page.evaluate(()=>{
    const r=window.__fly,read=r.input.read,rad=Math.PI/180,clamp=x=>Math.max(-1,Math.min(1,x));
    r.__encounterReview={read,minAgl:Infinity,started:performance.now()};
    r.input.read=function(){
      const cmd=read.call(this),a=r.encounters.controller.active,target=r.encounters.waypoint(),f=r.flight;
      if(!a||!target)return cmd;
      const p=r.engine.worldToGeo(f.pos),dx=(target.lon-p.x)*111320*Math.cos(p.y*rad),dy=(target.lat-p.y)*111320;
      const error=((Math.atan2(dx,dy)-f.heading+3*Math.PI)%(2*Math.PI))-Math.PI;
      const maxTurn=f.cfg.maxYawRateDeg*2.2*rad*(f.speed>f.cfg.highSpeedTurnCutover?.5:1),pitch=Math.atan2(target.altM-p.z,Math.max(250,Math.hypot(dx,dy)));
      r.__encounterReview.minAgl=Math.min(r.__encounterReview.minAgl,f.agl);
      return {...cmd,turn:clamp(error*.8/maxTurn),pitch:clamp((pitch-f.pitch)*1.5/(f.cfg.maxPitchRateDeg*rad)),speedPreset:'cruise',boost:false};
    };
  });
  console.log('Flying the live-terrain course with ordinary steering commands.');
  await page.waitForFunction(()=>!window.__fly.encounters.controller.active,undefined,{timeout:180000});
  const flight=await page.evaluate(()=>{const r=window.__fly,review=r.__encounterReview;r.input.read=review.read;delete r.__encounterReview;return {wallSec:(performance.now()-review.started)/1000,minAgl:review.minAgl,save:JSON.parse(localStorage.getItem('fly-encounters-v1')||'null')};});
  check('local course completed through controls on live terrain',flight.save?.memories.some(m=>m.encounterId===course.id),flight);
  await page.screenshot({path:`${out}/course-complete.png`,timeout:10000});
  await page.evaluate(p=>window.__fly.warpToGeo(p.lat,p.lon,{altM:p.altM,headingRad:p.headingDeg*Math.PI/180,name:null}),photo.approach);
  }
  await page.waitForFunction(()=>!window.__fly.worldLoading,undefined,{timeout:180000});await page.waitForTimeout(1000);
  await page.getByRole('button',{name:'Nearby',exact:true}).click();await page.getByRole('button',{name:new RegExp(photo.name)}).click();
  await page.evaluate(()=>{const r=window.__fly,old=r.encounters.photo;r.encounters.photo=function(frame,blob){window.__encounterCaptured={frame,bytes:blob?.size};return old.call(this,frame,blob);};});
  await page.getByRole('button',{name:'Photo',exact:true}).click();await page.waitForTimeout(500);
  await page.evaluate(({target,PHOTO})=>{
    const r=window.__fly,f=r.flight,p=r.engine.worldToGeo(f.pos),rad=Math.PI/180;
    const dx=(target.lon-p.x)*111320*Math.cos(p.y*rad),dy=(target.lat-p.y)*111320;
    const yaw=Math.atan2(dx,dy)-f.heading,pitch=Math.atan2(p.z-target.altM,Math.hypot(dx,dy));
    r.input.setLookActive(true);r.input.addLook(-(yaw-r.photoRig._look.yaw)/PHOTO.yawRate,-(pitch-r.photoRig._look.pitch)/PHOTO.pitchRate);
  },{target:photo.target,PHOTO});
  await page.waitForTimeout(1500);await page.evaluate(()=>window.__fly.input.setLookActive(false));
  await page.getByTestId('photo-shutter').click();
  await page.waitForFunction(id=>JSON.parse(localStorage.getItem('fly-encounters-v1')||'null')?.memories.some(m=>m.encounterId===id),photo.id,{timeout:45000});
  const photoMemory=await page.evaluate(()=>JSON.parse(localStorage.getItem('fly-encounters-v1')).memories[0]);
  check('real shutter saves photo discovery and a local photo reference',photoMemory.encounterId===photo.id&&!!photoMemory.photoRef,photoMemory);
  await page.getByTestId('photo-exit').click();await page.evaluate(()=>window.__flyStore.getState().setLogbookOpen(true));
  await page.getByRole('button',{name:'Memories',exact:true}).click();await page.waitForTimeout(700);
  await page.screenshot({path:`${out}/earned-memories.png`,timeout:10000});
  check('photo thumbnail renders in journal',await page.getByRole('img',{name:'Your view during this encounter'}).count()===1);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(5000);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('fly-encounters-v1')).memories.length);check('memories survive reload',saved===(photoOnly?1:2),saved);
  check('no page errors',!report.errors.length,report.errors);
}catch(error){report.failure=String(error);report.diagnostics=await page.evaluate(()=>({captured:window.__encounterCaptured,photo:window.__flyStats?.photo,active:window.__fly?.encounters?.controller.active,phase:window.__flyStore.getState().phase,frames:window.__fly?.framesRendered})).catch(()=>null);console.error(error);process.exitCode=1;await page.screenshot({path:`${out}/flight-failure.png`,timeout:5000}).catch(()=>{});}
finally{fs.writeFileSync(`${out}/${photoOnly?'live-photo':'live-flight'}.json`,JSON.stringify(report,null,2));await browser.close();}
