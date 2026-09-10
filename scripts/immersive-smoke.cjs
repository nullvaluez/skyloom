/* Integration checks for the opt-in slice. Real GPU/maps; never imports _boot.js. */
const {chromium}=require('playwright');
const fs=require('node:fs');
const out='.graphics-review/immersive-smoke';fs.mkdirSync(out,{recursive:true});
const report={...require('./graphics-source.cjs')(),status:'BLOCKED',errors:[],checks:[],shots:[]};
const check=(name,ok,details)=>{report.checks.push({name,ok:!!ok,details});if(!ok)throw Error(name);};
(async()=>{
 let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--enable-webgl-developer-extensions']});
  const page=await browser.newPage({viewport:{width:2560,height:1440},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|TypeError/.test(m.text()))report.errors.push(m.text().slice(0,1500));});
  await page.addInitScript(()=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','1');window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,6,18,17);});
  await page.goto('http://localhost:3020/?graphics=immersive&graphicsReview=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__flyBoot?.pct===100&&window.__fly?.satBuildings?.stats.ready>0,null,{timeout:90000});
  const gpu=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);});
  if(!gpu||/swiftshader|software/i.test(gpu))throw Error('Hardware GPU unavailable');report.gpu=gpu;
  await page.keyboard.press('Space');
  await page.waitForFunction(()=>window.__fly.immersiveAudio?.status==='ready',null,{timeout:30000});
  check('Audio assets decoded after gesture',true,await page.evaluate(()=>window.__fly.immersiveAudio));
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Reduced motion: Off',exact:true}).click();
  check('Reduced motion persists',await page.evaluate(()=>localStorage.getItem('fly-reduced-motion')==='1'));
  await page.waitForTimeout(500);
  check('Pause mutes audio',await page.evaluate(()=>window.__fly.audio.muted&&window.__fly.immersiveAudio.paused));
  await page.getByRole('button',{name:'Manhattan waterfront',exact:true}).click();
  await page.waitForTimeout(15000);
  check('Review route resumes flight',await page.evaluate(()=>window.__flyStore.getState().phase==='flying'));
  // Find an actual dense cloud rather than treating the whole altitude band as cloud.
  const pure=await import(`data:text/javascript;base64,${fs.readFileSync('lib/fly/immersive.js').toString('base64')}`);
  const p=await page.evaluate(()=>({...window.__fly.flight.pos}));let dense=null,best=.25;
  for(let dx=-4000;dx<=4000;dx+=250)for(let dz=-4000;dz<=4000;dz+=250){const d=pure.cloudDensity(p.x+dx,1850,p.z+dz);if(d>best){best=d;dense={x:p.x+dx,y:1850,z:p.z+dz};}}
  check('Cloud field includes a reachable interior',dense!==null,dense);
  await page.evaluate(p=>{const f=window.__fly.flight;Object.assign(f.pos,p);f.heading=.3;f.pitch=0;f.speed=0;window.__smokePose=setInterval(()=>{Object.assign(f.pos,p);f.speed=0;f.heading=.3;f.pitch=0;},16);window.__fly.chaseCam?.snap?.();},dense);
  await page.waitForTimeout(8000);
  const inside=await page.evaluate(()=>window.__fly.immersiveClouds.inside);
  check('Cloud interior drives immersion state',inside>.05,{inside});
  await page.screenshot({path:`${out}/inside-cloud.png`});report.shots.push('inside-cloud.png');
  await page.evaluate(()=>clearInterval(window.__smokePose));
  for(const tier of ['medium','low','high']){
    await page.evaluate(t=>window.__flyStore.getState().setQualityTier(t),tier);await page.waitForTimeout(3500);
    const state=await page.evaluate(()=>({review:window.__graphicsReview.immersive,fx:window.__flyStats.fx,tier:window.__flyStore.getState().qualityTier}));
    check(`Depth cues survive ${tier}`,state.review.shadows&&state.review.clouds.active,state);
  }
  await page.evaluate(()=>window.__flyStore.getState().setMapStyle('toy'));await page.waitForTimeout(8000);
  check('Neon removes immersive clouds',await page.evaluate(()=>!window.__fly.immersiveClouds));
  await page.evaluate(()=>window.__flyStore.getState().setMapStyle('satellite'));await page.waitForTimeout(10000);
  check('Satellite restores immersive clouds',await page.evaluate(()=>window.__fly.immersiveClouds?.active));
  check('No page or shader errors',report.errors.length===0,report.errors);
  report.status='PASS';
 }catch(error){report.reason=error.message;report.status=report.checks.some(c=>!c.ok)||report.errors.length?'FAIL':'BLOCKED';}
 finally{await browser?.close();fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,reason:report.reason,checks:report.checks.map(c=>[c.name,c.ok]),errors:report.errors}));process.exitCode=report.status==='PASS'?0:report.status==='FAIL'?1:2;}
})();
