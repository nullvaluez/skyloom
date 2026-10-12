// Diagnostic only: alternate one material uniform in the same settled scene.
// This stationary sample attributes cost; it does not replace route acceptance.
const {chromium}=require('playwright');
const fs=require('fs');
const {enterFlight}=require('./_skip-menus');
const {captureStreamersSettled}=require('./graphics-capture-census.cjs');
const out='.graphics-review/living-airports';
const report={purpose:'Stationary same-scene material uniform ablation; not acceptance',at:new Date().toISOString(),build:fs.readFileSync('.next-airports-review/BUILD_ID','utf8'),runs:[],errors:[]};
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});try{
 const page=await browser.newPage({viewport:{width:2560,height:1440},deviceScaleFactor:1});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.addInitScript(()=>{window.__flyGovPin='hold';window.__flyVisualsOverride='enhanced';window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,9,12,16);localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-quality-tier','medium');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');});
 await page.route('**/api/aircraft?**',r=>r.fulfill({json:{ac:[],now:Date.now(),source:'QA quiet fixture'}}));
 await page.goto('http://localhost:3097/?graphicsReview=1&airports=on&airportScenery=on&airportArt=on');
 await enterFlight(page,{lat:39.997,lon:-82.894,altM:950,headingRad:1.7},{waitReveal:false,timeoutMs:180000});
 await page.waitForFunction(()=>window.__flyBoot?.pct===100,undefined,{timeout:65000}).catch(async()=>{report.initialLoading=await page.evaluate(()=>window.__fly.worldReadiness);const reduced=page.getByRole('button',{name:'Continue with reduced detail',exact:true});if(await reduced.isVisible())await reduced.click();else throw Error('The world did not reveal for material attribution.');});
 await page.evaluate(()=>window.__fly.airportWatch.enter('KCMH'));
 await page.evaluate(()=>{const r=window.__fly,s=window.__flyStore.getState();r.airportWatch.leave();r.operations.profile=null;r.operations.phase='airborne';r.warpToGeo(39.997,-82.894,{altM:950,headingRad:1.7});s.setPhase('paused');});
 await page.waitForFunction(()=>!window.__fly.worldLoading,undefined,{timeout:90000});await page.waitForFunction(captureStreamersSettled,undefined,{timeout:60000});await page.waitForTimeout(6000);
 for(const art of ['off','on','on','off','off','on']){
  await page.evaluate(art=>{const url=new URL(location.href);url.searchParams.set('airportArt',art);history.replaceState(null,'',url);},art);
  await page.waitForTimeout(2000);
  const reading=await page.evaluate(()=>new Promise(resolve=>{const frames=[],start=performance.now();let last=0;function tick(){const now=performance.now();if(last)frames.push(now-last);last=now;if(now-start<20000){requestAnimationFrame(tick);return;}frames.sort((a,b)=>a-b);const percentile=q=>frames[Math.min(frames.length-1,Math.floor(frames.length*q))];resolve({count:frames.length,p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),worst:frames.at(-1),graphics:window.__graphicsReview,governor:window.__flyGov.state(),cinemaProfile:window.__fly.cinemaProfile});}requestAnimationFrame(tick);}));
  report.runs.push({art,...reading});fs.writeFileSync(`${out}/material-ablation.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({art,p50:reading.p50,p95:reading.p95,p99:reading.p99}));
 }
}catch(e){report.failure=e.stack;process.exitCode=1;console.error(e);}finally{fs.writeFileSync(`${out}/material-ablation.json`,JSON.stringify(report,null,2));await browser.close();}})();
