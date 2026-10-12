const {chromium}=require('playwright'),fs=require('fs');
const {enterFlight}=require('./_skip-menus');
const out='.graphics-review/living-airports',report={runs:[],errors:[],purpose:'Attribute the Columbus regression; CPU sampling is diagnostic and cannot certify frame timing.'};
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});try{
for(const arm of ['baseline','candidate-off','candidate-no-art','candidate-full']){
 const page=await browser.newPage({viewport:{width:2560,height:1440}});page.on('pageerror',e=>report.errors.push(e.message));
 await page.addInitScript(()=>{window.__flyVisualsOverride='enhanced';window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,9,12,16);localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-quality-tier','medium');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');});
 await page.route('**/api/aircraft?**',r=>r.fulfill({json:{ac:[],now:Date.now(),source:'QA quiet fixture'}}));
 const full=arm==='candidate-full'||arm==='candidate-no-art';
 await page.goto(`http://localhost:${arm==='baseline'?3098:3097}/?graphicsReview=1${full?'&airports=on&airportScenery=on&airportArt='+(arm==='candidate-full'?'on':'off'):''}`);
 await enterFlight(page,{lat:39.997,lon:-82.894,altM:950,headingRad:1.7});await page.waitForFunction(()=>window.__flyBoot?.pct===100,undefined,{timeout:90000});
 if(full){await page.evaluate(()=>window.__fly.airportWatch.enter('KCMH'));await page.evaluate(()=>window.__fly.airportWatch.leave());}
 await page.evaluate(()=>{window.__fly.warpToGeo(39.997,-82.894,{altM:950,headingRad:1.7});window.__flyStore.getState().setPhase('paused');window.__fly.input.speedPreset='slow';});await page.waitForFunction(()=>!window.__fly.worldLoading,undefined,{timeout:90000});await page.waitForTimeout(12000);
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});const before=await cdp.send('Performance.getMetrics');await cdp.send('Profiler.start');
 await page.evaluate(()=>{window.__flyStats.frame.reset();window.__flyStore.getState().setPhase('flying');});await page.waitForTimeout(12000);
 const reading=await page.evaluate(()=>({frame:window.__flyStats.frame.sample(),graphics:window.__graphicsReview}));const after=await cdp.send('Performance.getMetrics'),{profile}=await cdp.send('Profiler.stop');fs.writeFileSync(`${out}/cost-${arm}.cpuprofile`,JSON.stringify(profile));
 const previous=Object.fromEntries(before.metrics.map(m=>[m.name,m.value]));const metricDelta=Object.fromEntries(after.metrics.map(m=>[m.name,m.value-(previous[m.name]||0)]));const counts=new Map();for(const id of profile.samples||[])counts.set(id,(counts.get(id)||0)+1);const top=profile.nodes.map(n=>({function:n.callFrame.functionName,url:n.callFrame.url,line:n.callFrame.lineNumber+1,hits:counts.get(n.id)||0})).sort((a,b)=>b.hits-a.hits).slice(0,20);
 report.runs.push({arm,...reading,metricDelta,top});fs.writeFileSync(`${out}/cost-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({arm,p95:reading.frame.p95,taskSeconds:metricDelta.TaskDuration,scriptSeconds:metricDelta.ScriptDuration,top:top.slice(0,5)}));await page.close();
}
}catch(e){report.failure=e.stack;console.error(e);process.exitCode=1;}finally{fs.writeFileSync(`${out}/cost-report.json`,JSON.stringify(report,null,2));await browser.close();}})();
