import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const {enterFlight}=createRequire(import.meta.url)('./_skip-menus.js');
const out='.graphics-review/encounters',report={samples:[],errors:[],scope:'Encounter enabled/disabled comparison on final tree; not a pre-change camera/geometry benchmark.'};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
page.on('pageerror',e=>report.errors.push(e.message));
try{
 await page.addInitScript(()=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');});
 await page.goto('http://localhost:3091/?graphicsReview=1',{waitUntil:'domcontentloaded',timeout:120000});
 await enterFlight(page,{lat:40.72,lon:-74.02,altM:900,headingRad:.3,name:null},{timeoutMs:180000,waitReveal:true});
 await page.waitForFunction(()=>!window.__fly.worldLoading,undefined,{timeout:180000});
 await page.evaluate(()=>{const r=window.__fly;window.__flyStore.getState().setFlightMode('free');r.__benchmarkStep=r.flight.step;r.flight.step=function(){};r.input.neutralize();});
 await page.waitForTimeout(10000);
 for(const enabled of [false,true,true,false]){
   await page.evaluate(enabled=>window.__flyStore.setState({encountersEnabled:enabled}),enabled);await page.waitForTimeout(2000);
   const sample=await page.evaluate(()=>new Promise(resolve=>{
     const rt=window.__fly,gl=window.__flyComposer.getRenderer(),times=[],cost=[],tick=rt.encounters.tick;
     rt.encounters.tick=function(dt){const start=performance.now();tick.call(this,dt);cost.push(performance.now()-start);};
     let last=performance.now(),start=last,rendered=rt.framesRendered;
     const pct=(list,p)=>{list.sort((a,b)=>a-b);return list[Math.floor(list.length*p)]??null;};
     const poll=()=>{const now=performance.now();if(rt.framesRendered!==rendered){times.push(now-last);last=now;rendered=rt.framesRendered;}
       if(now-start<15000){requestAnimationFrame(poll);return;}
       rt.encounters.tick=tick;const ext=gl.getContext().getExtension('WEBGL_debug_renderer_info');
       resolve({frames:times.length,p95:pct(times,.95),tickP95:pct(cost,.95),tickMax:Math.max(...cost),programs:gl.info.programs.length,
         textures:gl.info.memory.textures,geometries:gl.info.memory.geometries,dpr:gl.getPixelRatio(),tier:window.__flyStore.getState().qualityTier,
         gpu:ext&&gl.getContext().getParameter(ext.UNMASKED_RENDERER_WEBGL)});
     };requestAnimationFrame(poll);
   }));
   report.samples.push({enabled,...sample});console.log(JSON.stringify({enabled,p95:sample.p95,tickP95:sample.tickP95,tickMax:sample.tickMax,programs:sample.programs}));
 }
 const avg=enabled=>report.samples.filter(s=>s.enabled===enabled).reduce((n,s)=>n+s.p95,0)/2;
 report.p95Ratio=avg(true)/avg(false);report.withinTenPercent=report.p95Ratio<=1.1;
}catch(error){report.failure=String(error);process.exitCode=1;}
finally{fs.writeFileSync(`${out}/performance.json`,JSON.stringify(report,null,2));await browser.close();}
