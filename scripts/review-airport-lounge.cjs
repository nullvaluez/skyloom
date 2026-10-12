const {chromium}=require('playwright');
const fs=require('fs');
const out='.graphics-review/living-airports/lounge';fs.mkdirSync(out,{recursive:true});
const report={checks:[],errors:[],samples:[]};
const check=(name,pass,detail)=>{report.checks.push({name,pass,detail});console.log((pass?'PASS ':'FAIL ')+name);if(!pass)process.exitCode=1;};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/THREE.WebGLProgram/.test(m.text()))report.errors.push(m.text());});
 try{
  await page.addInitScript(()=>{window.__flyVisualsOverride='enhanced';window.__flySunOverride=Date.UTC(2026,9,12,16);localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-sound-on','0');});
  await page.goto(process.env.FLY_URL||'http://localhost:3099/?graphicsReview=1&airports=on&airportArt=on&airportScenery=on');
  await page.waitForFunction(()=>window.__fly?.airportWatch,undefined,{timeout:180000});
  await page.getByTestId('watch-airport').click();await page.getByRole('button',{name:/KCMH Columbus/}).click();
  await page.waitForFunction(()=>window.__fly?.airportWatch?.validated&&window.__flyBoot?.pct===100&&!window.__fly.worldLoading,undefined,{timeout:120000});
  await page.waitForTimeout(12000);
  check('single seated lounge',await page.evaluate(()=>window.__fly.airportWatch.views.length===1&&window.__fly.camera.near===.08));
  check('flight tutorial absent without dismissing it',await page.getByRole('heading',{name:'Welcome to Skyloom'}).count()===0);
  check('traffic drawer starts closed',await page.locator('.airport-activity').count()===0);
  check('no viewpoint selector',await page.locator('.airport-viewpoints').count()===0);
  await page.screenshot({path:out+'/columbus-day.png'});
  await page.getByRole('button',{name:/^Traffic/}).click();check('traffic drawer opens',await page.locator('.airport-activity').isVisible());
  await page.screenshot({path:out+'/traffic.png'});
  report.live=await page.evaluate(()=>({state:window.__fly.trafficStatus,total:window.__fly.traffic.items.length,nearby:window.__fly.airportWatch.snapshot(),wakes:window.__fly.scene?.getObjectsByProperty('name','aircraft-condensation').map(m=>({visible:m.visible,vertices:m.geometry.drawRange.count}))}));
  const row=page.locator('.airport-contact').first();if(await row.count()) {await row.click();check('selection keeps room and exposes actions',await page.locator('.airport-selected').isVisible()&&await page.getByTestId('inspect-card').count()===0);await page.screenshot({path:out+'/tracking.png'});}
  else await page.getByRole('button',{name:'Close traffic',exact:true}).click();
  await page.getByRole('button',{name:'Reset view',exact:true}).click();
  const seat=await page.evaluate(()=>window.__fly.camera.position.toArray());
  await page.locator('.airport-pan').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowUp');
  await page.getByRole('button',{name:'Binoculars',exact:true}).click();await page.waitForFunction(()=>window.__fly.camera.fov<20);check('binoculars narrow the lens without a camera transfer',await page.evaluate(()=>window.__fly.camera.fov<20));
  check('looking never moves the seat',await page.evaluate(seat=>window.__fly.camera.position.toArray().every((v,i)=>Math.abs(v-seat[i])<.001),seat));
  await page.getByRole('button',{name:'Reset view',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Photo',exact:true}).click();await (await download).saveAs(out+'/photo.png');check('lounge photo exports',fs.statSync(out+'/photo.png').size>1000);
  for(const [width,height] of [[1920,1080],[2560,1440],[5120,1440]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(3000);
   const sample=await page.evaluate(async()=>{const frames=[];let prev=performance.now(),start=prev;const countBefore=window.__fly.framesRendered;await new Promise(resolve=>{const next=now=>{frames.push(now-prev);prev=now;if(now-start>=12000)resolve();else requestAnimationFrame(next);};requestAnimationFrame(next);});frames.sort((a,b)=>a-b);const r=window.__fly;return{renderFps:(window.__fly.framesRendered-countBefore)/((performance.now()-start)/1000),size:[innerWidth,innerHeight],p50:frames[Math.floor(frames.length*.5)],p95:frames[Math.floor(frames.length*.95)],p99:frames[Math.floor(frames.length*.99)],over100:frames.filter(n=>n>100).length,quality:window.__flyStore.getState().qualityTier,governor:window.__flyGov.state(),frame:window.__flyStats.frame,live:r.trafficStatus,nearby:r.airportWatch.snapshot().length};});report.samples.push(sample);console.log('FRAME '+JSON.stringify({size:sample.size,p95:sample.p95,p99:sample.p99,over100:sample.over100,quality:sample.quality}));
   check('layout '+width,await page.evaluate(()=>['.airport-watch-header','.airport-camera-bar'].every(sel=>{const r=document.querySelector(sel).getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})));
  }
  await page.setViewportSize({width:1920,height:1080});
  await page.evaluate(()=>{delete window.__flySunOverride;window.__flyStore.getState().setConditionsHour(0);});await page.waitForTimeout(6000);await page.screenshot({path:out+'/columbus-night.png'});
  await page.getByRole('button',{name:'Leave lounge',exact:true}).click();
  check('exit restores flight camera clipping',await page.evaluate(()=>!window.__fly.airportWatch.active&&window.__fly.camera.near===2.5&&window.__flyStore.getState().screen==='title'));
  await page.evaluate(()=>window.__flyStore.getState().setConditionsHour(12));
  for(const airport of ['KJFK','LOWI','YSSY']){
    await page.evaluate(id=>window.__fly.airportWatch.enter(id),airport);
    await page.waitForFunction(()=>window.__fly.airportWatch.validated&&!window.__fly.worldLoading,undefined,{timeout:90000});await page.waitForTimeout(3000);
    check(airport+' seated room validated',await page.evaluate(()=>window.__fly.airportWatch.views.length===1&&window.__fly.camera.near===.08));
    await page.screenshot({path:out+'/'+airport+'.png'});
  }
  check('no runtime or shader errors',report.errors.length===0,report.errors);
 }catch(e){report.failure=e.stack;console.error(e);process.exitCode=1;await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}
 finally{fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
})();
