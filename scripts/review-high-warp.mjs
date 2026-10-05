import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {enterFlight}=createRequire(import.meta.url)('./_skip-menus.js');
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const out=args.output??'.graphics-review/high-warp/before';fs.mkdirSync(out,{recursive:true});
const report={errors:[],samples:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
const page=await browser.newPage({viewport:{width:1650,height:1186},deviceScaleFactor:1});
page.on('pageerror',e=>report.errors.push(e.message));
page.on('console',m=>{if(/shader error|VALIDATE_STATUS false|GL_INVALID|INVALID_OPERATION/i.test(m.text()))report.errors.push(m.text());});
try{
 await page.addInitScript(()=>{
  localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');localStorage.setItem('fly-quality-tier','ultra');
  localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-crash-mode','forgiving');
  window.__flyCloudFreeze=true;window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,9,5,18);
 });
 await page.goto('http://localhost:3091/?graphicsReview=1',{waitUntil:'domcontentloaded',timeout:120000});
 await enterFlight(page,{lat:39.4175,lon:-83.4768,altM:32548*.3048,headingRad:35*Math.PI/180,name:null},{waitReveal:true});
 await page.evaluate(()=>{const r=window.__fly;r.flight.step=()=>{};r.input.neutralize();window.__flyStore.setState({encountersEnabled:false});});
 for(const seconds of [0,10,30]){
  if(seconds)await page.waitForTimeout((seconds-(report.samples.at(-1)?.seconds??0))*1000);
  const sample=await page.evaluate(()=>{
   const r=window.__fly,tiles=[];
   r.engine.map.rootTile.traverse(t=>{if(t.isTile&&t.model)tiles.push({key:`${t.z}/${t.x}/${t.y}`,z:t.z,x:t.x,y:t.y,visible:t.model.visible,frustum:t.inFrustum,leaf:t.isLeaf,state:t.loadState,ratio:t._getDistRatio(),size:t._sizeInWorld,pos:t.position.toArray(),scale:t.scale.toArray(),maps:t.model.material?.map(m=>({uuid:m.map?.uuid,url:m.map?.image?.src,width:m.map?.image?.width,height:m.map?.image?.height}))});});
   return{loading:r.worldLoading,terrain:r.terraStats,ground:r.r25Ground,flight:{pos:r.flight.pos,ground:r.flight.groundElev},camera:r.camera.position.toArray(),profile:r.cinemaProfile,tiles};
  });
  report.samples.push({seconds,...sample});await page.screenshot({path:`${out}/high-${seconds}.png`});
  fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));console.log(`High warp ${seconds}s: ${sample.tiles.length} tiles, ${sample.terrain?.downloading} downloading`);
 }
 for(const ref of [0,1]){
  await page.evaluate(ref=>{window.__flyCruiseRef=ref;},ref);await page.waitForTimeout(1500);
  await page.screenshot({path:`${out}/reference-${ref}.png`});
 }
 if(args.cycles){
  report.cycles=[];
  for(const pose of [
   {name:'ohio-descent',lat:39.4175,lon:-83.4768,altM:1200,headingRad:.61},
   {name:'ohio-climb-turn',lat:39.4175,lon:-83.4768,altM:12000,headingRad:2.1},
   {name:'canyon-cruise',lat:36.09,lon:-112.1,altM:10000,headingRad:2},
  ]){
   await page.evaluate(p=>window.__fly.warpToGeo(p.lat,p.lon,{altM:p.altM,headingRad:p.headingRad,name:null}),pose);
   await page.waitForFunction(()=>!window.__fly.worldLoading,undefined,{timeout:150000});await page.waitForTimeout(10000);
   const state=await page.evaluate(()=>({ground:window.__fly.r25Ground,terrain:window.__fly.terraStats,profile:window.__fly.cinemaProfile}));
   await page.screenshot({path:`${out}/${pose.name}.png`});report.cycles.push({pose,...state});
   assert.equal(state.ground.colorRefGain,pose.altM<2500?0:1,'altitude color gain');
   assert.equal(state.ground.atlas.pending,0,'reference did not settle');console.log('PASS',pose.name);
  }
 }
 assert.equal(report.errors.length,0,'browser/shader errors');
}catch(e){report.failure=e.stack;process.exitCode=1;console.error(e);}
finally{fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
