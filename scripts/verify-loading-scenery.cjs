const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const {enterHangar}=require('./_title'); // R25 (E, SANCTIONED): reach the hangar through the title when there is one
const output='.graphics-review/cloud-paths';fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
 const page=await browser.newPage({viewport:{width:1280,height:900}}),report={errors:[]};page.on('pageerror',e=>report.errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-map-style-2','satellite');window.__flyGovPin='hold';
  const timer=setInterval(()=>{const s=window.__fly?.earthSurface?.airports;if(!s)return;clearInterval(timer);Object.defineProperty(s,'nearPending',{get:()=>99,set:()=>{},configurable:true});window.__forcedPavementPending=true;},25);
 });
 try{
 await page.goto(process.env.FLY_URL||'http://localhost:3001');await enterHangar(page,'ops');await page.getByTestId('hangar-pick-prop').click({timeout:60000});await page.selectOption('#departure-airport','KOSU');await page.locator('input[value="runway"]').click();await page.getByTestId('hangar-fly').click();
 await page.waitForFunction(()=>window.__flyBoot?.pct===100&&!window.__fly.worldLoading,undefined,{timeout:65000});
 report.boot=await page.evaluate(()=>({forced:window.__forcedPavementPending,arrival:window.__fly.arrivalStats,readiness:window.__fly.worldReadiness,degraded:window.__fly.worldDegraded}));
 assert.equal(report.boot.forced,true);assert.equal(report.boot.degraded,false);assert.equal(report.boot.arrival.reason,'background-detail');assert.ok(report.boot.readiness.deferred.includes('airports'));console.log('Boot released with pending pavement: '+report.boot.arrival.holdMs+' ms');
 await page.evaluate(()=>{const r=window.__fly;r.operations.phase='airborne';r.operations.advance=()=>true;r.warpToGeo(39.9547,-82.8251,{altM:351,headingRad:283*Math.PI/180});r.flight.speed=0;});
 await page.waitForTimeout(1000);await page.getByTestId('warp-hold').waitFor({state:'hidden',timeout:65000});
 report.warp=await page.evaluate(()=>({arrival:window.__fly.arrivalStats,readiness:window.__fly.worldReadiness,degraded:window.__fly.worldDegraded}));
 assert.equal(report.warp.degraded,false);assert.equal(report.warp.arrival.reason,'background-detail');assert.ok(report.warp.readiness.deferred.includes('airports'));assert.equal(report.errors.length,0);
 console.log('Warp released with pending pavement: '+report.warp.arrival.holdMs+' ms');report.status='PASS';
 }catch(e){report.status='FAIL';report.error=String(e.stack);report.state=await page.evaluate(()=>({boot:window.__flyBoot,readiness:window.__fly?.worldReadiness}));console.error(report);process.exitCode=1;}finally{fs.writeFileSync('.graphics-review/cloud-paths/loading-report.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
