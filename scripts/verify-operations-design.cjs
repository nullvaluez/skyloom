/* Real browser UI inputs; no flight pose or controller state is injected. */
const {chromium,devices}=require('playwright');
const fs=require('node:fs');
const {enterHangar}=require('./_title'); // R25 (E, SANCTIONED): reach the hangar through the title when there is one
(async()=>{
 const out=process.env.FLY_OPERATIONS_OUTPUT||'.graphics-review/operations/design';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
 const report={status:'RUNNING',checks:[],errors:[],tiles:0};
 let context,page;
 const check=(condition,message)=>{if(!condition)throw new Error(message);report.checks.push(message);};
 const shot=name=>page.screenshot({path:`${out}/${name}.png`});
 const button=name=>page.getByRole('button',{name,exact:true});
 async function boot(mobile=false){
  await context?.close();
  context=await browser.newContext(mobile?{...devices['Pixel 7'],viewport:{width:390,height:844},deviceScaleFactor:1}:{viewport:{width:1440,height:900}});
  page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  page.on('response',r=>{if(r.url().includes('World_Imagery')&&r.status()===200)report.tiles++;});
  await page.addInitScript(()=>localStorage.setItem('fly-controls-seen','1'));
  await page.goto(process.env.FLY_URL||'http://localhost:3038/?graphicsReview=1');
  await enterHangar(page,'ops');
  await page.getByTestId('hangar').waitFor({timeout:60000});
  await page.waitForFunction(()=>!document.querySelector('[data-testid="hangar-fly"]')?.disabled,undefined,{timeout:60000});
  await page.waitForFunction(()=>document.querySelector('[data-testid="hangar"]')?.dataset.exteriorReady==='true',undefined,{timeout:30000});
  await page.waitForTimeout(1500);
 }
 try{
  await boot();await shot('hangar-skylark');
  const canvas=await page.locator('.ops-bay canvas').elementHandle();
  for(const [id,name] of [['fighter','vector'],['airliner','stratoliner'],['prop','skylark-return']]){
   await page.getByTestId('hangar-pick-'+id).click();
   await page.waitForFunction(()=>!document.querySelector('[data-testid="hangar-fly"]').disabled,undefined,{timeout:30000});
   await page.waitForTimeout(1000);await shot('hangar-'+name);
   check(await canvas.evaluate(node=>node===document.querySelector('.ops-bay canvas')),name+' keeps the preview canvas');
  }
  await page.locator('.ops-start-options label').filter({has:page.locator('input[value="runway"]')}).click();
  await page.getByTestId('hangar-fly').click();
  await page.waitForFunction(()=>window.__flyBoot?.pct===100&&!window.__fly.worldLoading&&!window.__fly.worldDegraded&&window.__fly.worldReadiness.ready,undefined,{timeout:90000});
  await page.getByTestId('warp-hold').waitFor({state:'hidden'});await page.waitForTimeout(600);await shot('departure');
  await button('Begin takeoff').click();
  await page.waitForFunction(()=>window.__fly.flight.speed>=window.__fly.operations.profile.rotate,undefined,{timeout:45000});
  await page.keyboard.down('s');await page.waitForTimeout(600);await page.keyboard.up('s');
  await page.waitForFunction(()=>window.__fly.operations.phase==='airborne',undefined,{timeout:7000});
  await page.waitForFunction(()=>document.querySelector('[data-testid="operations-hud"]').dataset.expanded==='false',undefined,{timeout:10000});
  await page.waitForTimeout(350);await shot('flight-collapsed');
  check(await page.locator('.ops-reveal').evaluate(el=>el.inert&&el.getBoundingClientRect().height<1),'Airborne panel collapses and removes hidden controls from focus');
  await button('Open flight controls').click();await page.waitForTimeout(7500);
  check(await page.getByTestId('operations-hud').getAttribute('data-expanded')==='true','Manually opened controls stay open');
  await page.getByText('Destination and guidance',{exact:true}).click();
  await button('Practice landing').click();
  await page.waitForFunction(()=>window.__fly.operations.phase==='approach'&&!window.__fly.worldLoading,undefined,{timeout:90000});
  await page.waitForTimeout(1200);await shot('arrival');
  await button('Minimize flight controls').click();await page.waitForTimeout(400);
  check(await page.getByTestId('operations-hud').getAttribute('data-expanded')==='false','Manual minimize works on approach');
  await button('Open flight controls').click();await button('Go around').click();await page.waitForTimeout(7000);
  check(await page.getByTestId('operations-hud').getAttribute('data-expanded')==='false','Go-around returns to unobtrusive flight controls');
  await boot(true);await shot('hangar-phone');
  await page.setViewportSize({width:844,height:390});await page.waitForTimeout(1000);await shot('hangar-phone-landscape');
  check(await page.getByTestId('hangar-fly').evaluate(el=>{const b=el.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));}),'Landscape departure action is visible and clickable');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(700);
  const radio=page.locator('.ops-start-options label').filter({has:page.locator('input[value="approach"]')});await radio.tap();
  await page.getByTestId('hangar-fly').tap();
  await page.waitForFunction(()=>window.__flyBoot?.pct===100&&!window.__fly.worldLoading&&!window.__fly.worldDegraded&&window.__fly.worldReadiness.ready,undefined,{timeout:90000});
  await page.getByTestId('warp-hold').waitFor({state:'hidden'});await page.waitForTimeout(500);await shot('arrival-phone');
  await button('Minimize flight controls').tap();await page.waitForTimeout(400);await shot('flight-phone-collapsed');
  check(await page.getByTestId('operations-hud').getAttribute('data-expanded')==='false','Touch can minimize controls');
  await button('Open flight controls').tap();
  check(await page.getByTestId('operations-hud').getAttribute('data-expanded')==='true','Touch can reopen controls');
  check(report.tiles>=9,'Live airport imagery loaded');
  check(report.errors.filter(e=>e!=='Failed to fetch').length===0,'No application exceptions');
  report.status='PASS';console.log('VERIFY: PASS — hangar design, live exterior, takeoff disclosure, arrival and touch controls.');
 }catch(e){report.status='FAIL';report.error=String(e.stack||e);await shot('failure').catch(()=>{});throw e;}
 finally{fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
