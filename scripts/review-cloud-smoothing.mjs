import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {enterFlight}=createRequire(import.meta.url)('./_skip-menus.js');
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const out=args.output??'.graphics-review/cloud-smoothing/desktop';fs.mkdirSync(out,{recursive:true});
const report={errors:[],samples:[],performance:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
const page=await browser.newPage({viewport:args.phone?{width:390,height:844}:{width:1440,height:900},deviceScaleFactor:args.phone?2:1,isMobile:!!args.phone,hasTouch:!!args.phone});
page.on('pageerror',e=>report.errors.push(e.message));
page.on('console',m=>{if(/shader error|VALIDATE_STATUS false|GL_INVALID|INVALID_OPERATION/i.test(m.text()))report.errors.push(m.text());});
try{
 await page.addInitScript(()=>{
  localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');localStorage.setItem('fly-quality-tier','high');
  localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-crash-mode','forgiving');
  window.__flyCloudFreeze=true;window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,8,27,20);
 });
 await page.goto('http://localhost:3091/?graphicsReview=1',{waitUntil:'domcontentloaded',timeout:120000});
 await enterFlight(page,{lat:36.09,lon:-112.1,altM:2700,headingRad:2,name:null},{waitReveal:true});
 await page.evaluate(()=>{const r=window.__fly;r.flight.step=()=>{};r.input.neutralize();window.__flyStore.setState({encountersEnabled:false});});
 await page.waitForFunction(()=>!window.__fly.worldLoading,undefined,{timeout:150000});await page.waitForTimeout(15000);
 for(const smooth of [0,1]){
  await page.evaluate(smooth=>{window.__flyCloudSmooth=smooth;},smooth);await page.waitForTimeout(1500);
  await page.screenshot({path:`${out}/${smooth?'after':'before'}.png`});
  report.samples.push(await page.evaluate(smooth=>{const r=window.__fly,rr=window.__flyComposer.getRenderer();return{smooth,profile:r.cinemaProfile,clouds:r.immersiveClouds,resources:r.cinemaResources,camera:{pos:r.camera.position.toArray(),q:r.camera.quaternion.toArray()},textures:rr.info.memory.textures,programs:rr.info.programs.length};},smooth));
 }
 for(const field of ['pos','q'])assert.ok(report.samples[0].camera[field].every((n,i)=>Math.abs(n-report.samples[1].camera[field][i])<(field==='pos'?.001:1e-9)),'camera moved');
 assert.equal(report.samples[0].profile.name,report.samples[1].profile.name,'profile changed');
 for(const smooth of args.timing?[0,1,1,0]:[]){
  await page.evaluate(smooth=>{window.__flyCloudSmooth=smooth;},smooth);await page.waitForTimeout(1500);
  const timing=await page.evaluate(()=>new Promise(resolve=>{const r=window.__fly,frames=[],start=performance.now();let last=start,frame=r.framesRendered;
   function tick(now){if(frame!==r.framesRendered){frames.push(now-last);last=now;frame=r.framesRendered;}if(now-start<10000)return requestAnimationFrame(tick);
    frames.sort((a,b)=>a-b);resolve({frames:frames.length,p50:frames[Math.floor(frames.length*.5)],p95:frames[Math.floor(frames.length*.95)],profile:r.cinemaProfile?.name});}requestAnimationFrame(tick);
  }));report.performance.push({smooth,...timing});console.log('Timing',smooth,timing);
 }
 assert.equal(report.errors.length,0,'shader/browser errors');console.log('PASS matched cloud screenshots');
}catch(e){report.failure=e.stack;process.exitCode=1;console.error(e);}
finally{fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
