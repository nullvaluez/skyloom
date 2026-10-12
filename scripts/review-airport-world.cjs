const {chromium}=require('playwright'),fs=require('fs');
const {enterFlight}=require('./_skip-menus');
const {captureStreamersSettled,captureSceneCensus}=require('./graphics-capture-census.cjs');
const out='.graphics-review/living-airports',report={purpose:'Matched poses with UI hidden only during capture. Visual evidence, not a benchmark.',shots:[],errors:[]};
const sites=[{id:'columbus-day',airport:'KCMH',lat:39.997,lon:-82.894,altM:950,headingRad:1.7},{id:'urban-day',airport:'KJFK',lat:40.713,lon:-74.016,altM:850,headingRad:0},{id:'mountain-dusk',airport:'LOWI',lat:47.26,lon:11.35,altM:2100,headingRad:1.2},{id:'coast-night',airport:'YSSY',lat:-33.948,lon:151.18,altM:1000,headingRad:0}];
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});try{
 for(const arm of ['baseline','candidate']){
  const p=await browser.newPage({viewport:{width:2560,height:1440},deviceScaleFactor:1});p.on('pageerror',e=>report.errors.push(e.message));
  await p.addInitScript(()=>{window.__flyVisualsOverride='enhanced';window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,9,12,16);localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');});
  await p.route('**/api/aircraft?**',route=>route.fulfill({json:{ac:[],now:Date.now(),source:'QA quiet fixture'}}));
  await p.goto(`http://localhost:${arm==='baseline'?3098:3097}/?graphicsReview=1${arm==='candidate'?'&airports=on&airportArt=on&airportScenery=on':''}`);
  await enterFlight(p,sites[0]);await p.waitForFunction(()=>window.__flyBoot?.pct===100,undefined,{timeout:90000});
  for(const site of sites){
   if(arm==='candidate'){await p.evaluate(id=>window.__fly.airportWatch.enter(id),site.airport);await p.evaluate(()=>window.__fly.airportWatch.leave());}
   await p.evaluate(site=>{const r=window.__fly,s=window.__flyStore.getState();r.warpToGeo(site.lat,site.lon,{altM:site.altM,headingRad:site.headingRad});s.setPhase('paused');r.chaseCam?.snap?.();},site);
   await p.waitForFunction(()=>!window.__fly.worldLoading,undefined,{timeout:90000});await p.waitForFunction(captureStreamersSettled,undefined,{timeout:60000});await p.waitForTimeout(5000);
   const file=`visual-${arm}-${site.id}.png`;await p.screenshot({path:`${out}/${file}`,style:'body * { visibility: hidden !important; } canvas { visibility: visible !important; }'});
   report.shots.push({arm,site,file,census:await p.evaluate(captureSceneCensus),graphics:await p.evaluate(()=>window.__graphicsReview)});fs.writeFileSync(`${out}/visual-report.json`,JSON.stringify(report,null,2));console.log(file);
  }await p.close();
 }
}catch(e){report.failure=e.stack;console.error(e);process.exitCode=1;}finally{fs.writeFileSync(`${out}/visual-report.json`,JSON.stringify(report,null,2));await browser.close();}})();
