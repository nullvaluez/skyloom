import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {enterFlight}=createRequire(import.meta.url)('./_skip-menus.js');
const options=Object.fromEntries(process.argv.slice(2).map(arg=>arg.replace(/^--/,'').split('=')));
const out=options.output??'.graphics-review/visual-pass/paired';fs.mkdirSync(out,{recursive:true});
const report={errors:[],cases:[],performance:[],scope:'Same-session art disabled/enabled, real geographic tiles, fixed sun/weather/camera. Live aircraft remain live.'};
const sites={
 city:{lat:40.72,lon:-74.02,altM:900,headingRad:.3,name:null},
 canyon:{lat:36.09,lon:-112.1,altM:2700,headingRad:2,name:null},
};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
const errors=[];
let stage='boot';
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(/shader error|VALIDATE_STATUS false|GL_INVALID|INVALID_OPERATION/i.test(m.text()))errors.push(stage+': '+m.text().slice(0,1400));});
async function snapshot(){return page.evaluate(()=>{
 const r=window.__fly,renderer=window.__flyComposer.getRenderer(),gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
 return {sun:r.sun,weather:r.weather?.wx,environment:r.cinemaEnvironment,camera:{position:r.camera.position.toArray(),quaternion:r.camera.quaternion.toArray(),fov:r.camera.fov},
  terrain:r.terraStats,clouds:r.immersiveClouds,profile:r.cinemaProfile,resources:r.cinemaResources,
  renderer:{gpu:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),programs:renderer.info.programs.length,textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,dpr:renderer.getPixelRatio()}};
 });}
async function settleArt(art){
 await page.evaluate(art=>{window.__flyCinemaArt=art;},art);
 await page.waitForTimeout(5500); // Includes the shared sky IBL's 2s cadence + 1.2s blend.
 await page.waitForFunction(()=>!window.__fly.cinemaIBL?.blending,undefined,{timeout:15000});
}
try{
 await page.addInitScript(()=>{
  for(const name of ['getProgramParameter','getProgramInfoLog','getActiveAttrib','getActiveUniform','getUniformLocation','getAttribLocation']){
   const read=WebGL2RenderingContext.prototype[name];
   WebGL2RenderingContext.prototype[name]=function(program,...args){
    const valid=program&&this.isProgram(program),result=read.call(this,program,...args);
    if(!valid)(window.__artProgramMisses??=[]).push({stage:window.__artStage??'boot',name,args,stack:new Error().stack});
    return result;
   };
  }
  localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');localStorage.setItem('fly-quality-tier','high');
  localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-crash-mode','forgiving');
  window.__flyCloudFreeze=true;window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,8,27,17);window.__flyCinemaArt=0;
 });
 await page.goto('http://localhost:3091/?graphicsReview=1',{waitUntil:'domcontentloaded',timeout:120000});
 await enterFlight(page,sites.city,{timeoutMs:180000,waitReveal:true});
 await page.addStyleTag({content:'.cinema-review-dock{display:none!important}'});
 await page.evaluate(()=>{const r=window.__fly;r.__artStep=r.flight.step;r.flight.step=()=>{};r.input.neutralize();window.__flyStore.setState({encountersEnabled:false});});
 for(const [name,site,hour,weather] of [
  ['city-day','city',17,'baseline'],['city-golden','city',22,'baseline'],['city-overcast','city',17,'overcast'],['city-night','city',5,'baseline'],['canyon-day','canyon',20,'baseline']
 ]){
  if(options.cases&&!options.cases.split(',').includes(name))continue;
  await page.evaluate(({geo,hour,weather})=>{window.__flySunOverride=Date.UTC(2026,8,27,hour);window.__flyWeatherOverride=weather;window.__fly.warpToGeo(geo.lat,geo.lon,{altM:geo.altM,headingRad:geo.headingRad,name:null});},{geo:sites[site],hour,weather});
  await page.waitForFunction(()=>!window.__fly.worldLoading,undefined,{timeout:150000});
  await page.waitForFunction(weather=>weather==='overcast'?window.__fly.weather.wx.overcastT>.99:window.__fly.weather.wx.overcastT<.01,weather,{timeout:45000});
  await page.waitForTimeout(9000);
  const row={name};
  for(const art of [0,1]){
   await settleArt(art);
   const arm=art?'after':'before';await page.screenshot({path:`${out}/${name}-${arm}.png`});row[arm]=await snapshot();
  }
  // A settled quaternion can differ by one float64 ULP on the next update.
  // 1e-9 is still far below a pixel; position tolerance is one millimetre.
  for(const field of ['position','quaternion'])assert.ok(row.before.camera[field].every((n,i)=>Math.abs(n-row.after.camera[field][i])<(field==='position'?.001:1e-9)),`${name}: camera ${field} moved`);
  assert.ok(Math.abs(row.before.camera.fov-row.after.camera.fov)<1e-9,`${name}: FOV moved`);
  assert.deepEqual(row.before.sun,row.after.sun,`${name}: sun moved`);
  assert.equal(row.before.profile.name,row.after.profile.name,`${name}: quality changed`);
  report.cases.push(row);console.log(`PASS matched ${name}: ${row.after.profile.name}`);
  fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
 }
 // Warm, identical high-profile scene for rendered-frame interval samples.
 await page.evaluate(geo=>window.__fly.warpToGeo(geo.lat,geo.lon,{altM:geo.altM,headingRad:geo.headingRad,name:null}),sites.city);
 await page.waitForFunction(()=>!window.__fly.worldLoading,undefined,{timeout:150000});
 await page.waitForTimeout(12000);
 for(const art of options.skipPerformance?[]:[0,1,1,0]){
  await settleArt(art);
  const sample=await page.evaluate(()=>new Promise(resolve=>{
   const r=window.__fly,times=[],start=performance.now();let last=start,frame=r.framesRendered;
   function poll(now){if(frame!==r.framesRendered){times.push(now-last);last=now;frame=r.framesRendered;}
    if(now-start<12000)return requestAnimationFrame(poll);
    times.sort((a,b)=>a-b);resolve({frames:times.length,p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],profile:r.cinemaProfile?.name});
   }requestAnimationFrame(poll);
  }));
  report.performance.push({art,...sample});console.log(`TIMING art=${art}: ${sample.p95.toFixed(2)} ms p95 (${sample.profile})`);
 }
 for(const [style,visuals] of [['satellite','classic'],['toy','enhanced']]){
  stage=style+'/'+visuals;
  await page.evaluate(({style,visuals})=>{window.__artStage=style+'/'+visuals;const s=window.__flyStore.getState();s.setMapStyle(style);s.setVisuals(visuals);},{style,visuals});
  await page.waitForTimeout(6000);assert.equal(await page.evaluate(()=>window.__fly.cinemaEnvironment),null);console.log(`PASS ${style}/${visuals} retains separate rendering path`);
 }
 stage='return-enhanced';await page.evaluate(()=>{window.__artStage='return-enhanced';const s=window.__flyStore.getState();s.setMapStyle('satellite');s.setVisuals('enhanced');});
 await page.waitForTimeout(6000);await page.screenshot({path:`${out}/return-to-enhanced.png`});
 report.errors=[...new Set(errors)];assert.equal(report.errors.length,0,'Browser/shader errors');
}catch(error){report.failure=error.stack;report.errors=[...new Set(errors)];console.error(error);process.exitCode=1;}
finally{report.programMisses=await page.evaluate(()=>window.__artProgramMisses??[]).catch(()=>[]);fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
