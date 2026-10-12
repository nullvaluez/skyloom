const {chromium}=require('playwright');
const fs=require('fs');
const output='.graphics-review/living-airports';fs.mkdirSync(output,{recursive:true});
const report={errors:[],checks:[],views:[],note:'Local headless Chrome on owner hardware. Functional evidence, not physical midrange certification.'};
const check=(name,pass,detail)=>{report.checks.push({name,pass,detail});if(!pass)process.exitCode=1;console.log(`${pass?'PASS':'FAIL'} ${name}`);};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
 const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
 const page=await context.newPage();
 page.on('crash',()=>{report.errors.push('Renderer process crashed');browser.close();});page.on('pageerror',e=>{report.errors.push(e.message);console.log('PAGEERROR '+e.message);});
 page.on('console',m=>{if(m.type()==='error'&&/THREE.WebGLProgram|ReferenceError/.test(m.text()))report.errors.push(m.text());});
 try{
  await page.addInitScript(()=>{window.__flyVisualsOverride='enhanced';localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');});
  console.log('BOOT');await page.goto('http://localhost:3097/?graphicsReview=1&airports=on&airportArt=on&airportScenery=on',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__fly?.airportWatch,{timeout:180000});
  console.log('OPEN SEARCH');await page.getByTestId('watch-airport').click();
  console.log('SELECT COLUMBUS');await page.getByRole('button',{name:/KCMH Columbus/}).click();
  await page.waitForFunction(()=>!!window.__flyStore.getState().airportWatch,{timeout:60000});
  console.log('WAIT REVEAL');await page.waitForFunction(()=>window.__flyBoot?.pct===100||[...document.querySelectorAll('button')].some(b=>b.textContent==='Continue with reduced detail'),undefined,{timeout:65000}).catch(()=>{});
  const reduced=page.getByRole('button',{name:'Continue with reduced detail',exact:true});if(await reduced.isVisible()){report.reducedDetailEntry=await page.evaluate(()=>window.__fly.worldReadiness);await reduced.click();}await page.waitForTimeout(3000);
  check('Columbus observation opens',await page.getByTestId('airport-observation').isVisible());
  check('observer flight is held',await page.evaluate(async()=>{const f=window.__fly.flight,p=f.pos.clone();await new Promise(r=>setTimeout(r,1100));return p.distanceTo(f.pos)<.01;}));
  check('viewpoint terrain validated',await page.evaluate(()=>window.__fly.airportWatch.validated));
  for(const label of ['Terminal overview','Elevated approach','Runway-side'])await page.getByRole('button',{name:label,exact:true}).click();
  await page.screenshot({path:`${output}/columbus-observation.png`,timeout:30000});
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Photo',exact:true}).click();const photo=await download;await photo.saveAs(`${output}/observation-photo.png`);check('photo exported',fs.statSync(`${output}/observation-photo.png`).size>1000);
  const contact=page.locator('.airport-contact').first();
  if(await contact.count()){await contact.click();check('dossier opens',await page.getByTestId('inspect-card').isVisible());await page.getByTestId('inspect-warp').click();const tracking=await page.evaluate(()=>{const w=window.__fly.airportWatch;return {active:w.active,tracking:w.tracking,notice:w.notice,stale:window.__fly.traffic.tracks.get(w.selected)?.stale};});check('camera tracking keeps observation or explains contact loss',tracking.active&&(tracking.tracking||tracking.notice==='Contact lost. Returned to the airport view.'),tracking);}
  for(const [id,name] of [['KJFK','jfk'],['LOWI','innsbruck'],['YSSY','sydney']]){
    console.log('TRANSFER '+id);await page.evaluate(id=>{window.__airportTransferError=null;window.__fly.airportWatch.enter(id).catch(e=>{window.__airportTransferError=e.message;});},id);await page.waitForFunction(id=>window.__fly.airportWatch.airport?.id.startsWith(id)||window.__airportTransferError,id,{timeout:60000});const transferError=await page.evaluate(()=>window.__airportTransferError);if(transferError)throw Error(transferError);await page.getByTestId('warp-hold').waitFor({state:'hidden',timeout:90000});await page.waitForTimeout(3000);check(`${id} arrival reveals`,!await page.getByTestId('warp-hold').isVisible());
    report.views.push(await page.evaluate(()=>({id:window.__fly.airportWatch.airport.id,views:window.__fly.airportWatch.views.length,validated:window.__fly.airportWatch.validated,geo:window.__fly.geo,traffic:window.__fly.trafficStatus,stats:window.__flyStats?.render})));
    await page.screenshot({path:`${output}/${name}-observation.png`,timeout:30000});
    check(`${id} has three viewpoints`,await page.evaluate(()=>window.__fly.airportWatch.views.length===3));await page.getByRole('button',{name:'Terminal overview',exact:true}).click();await page.waitForTimeout(1500);await page.screenshot({path:`${output}/${name}-terminal.png`,timeout:30000});
  }
  for(const [width,height] of [[1920,1080],[2560,1440],[5120,1440]]){await page.setViewportSize({width,height});check(`layout ${width}x${height}`,await page.evaluate(()=>{const selectors=['.airport-watch-header','.airport-activity','.airport-camera-bar'];return selectors.every(s=>{const r=document.querySelector(s).getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;});}));}
  report.runtime=await page.evaluate(()=>{const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2'),debug=gl?.getExtension('WEBGL_debug_renderer_info');return {gpu:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,store:window.__flyStore.getState(),stats:window.__flyStats};});
  await page.getByRole('button',{name:/Exit observation/}).click();check('exit returns to title',await page.evaluate(()=>window.__flyStore.getState().screen==='title'&&!window.__fly.airportWatch.active));
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const phone=await mobile.newPage();
  await phone.goto('http://localhost:3097/?graphicsReview=1&airports=on&airportArt=on&airportScenery=on');await phone.waitForTimeout(6000);check('mobile airport entry stays absent',await phone.getByTestId('watch-airport').count()===0);await mobile.close();
  check('no runtime or shader errors',report.errors.length===0,report.errors);
 }catch(e){report.failure=e.stack;report.loading=await page.evaluate(()=>({boot:window.__flyBoot,readiness:window.__fly?.worldReadiness,terra:window.__fly?.terraStats})).catch(()=>null);console.error(e);process.exitCode=1;await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});}
 finally{fs.writeFileSync(`${output}/functional-report.json`,JSON.stringify(report,null,2));await browser.close();}
})();
