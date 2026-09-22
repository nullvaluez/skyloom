/* Touch departure/control check against the real world. No airborne fixture. */
const {chromium,devices}=require('playwright');
const fs=require('node:fs');
(async()=>{
  const out='.graphics-review/operations/touch';fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
  const context=await browser.newContext({...devices['Pixel 7'],viewport:{width:390,height:844},deviceScaleFactor:1});
  const page=await context.newPage(),errors=[],report={status:'RUNNING',checks:[],errors};
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('fly-controls-seen','1'));
  const state=()=>page.evaluate(()=>{const r=window.__fly;return {phase:r.operations.phase,speed:r.flight.speed,heading:r.flight.heading,throttle:r.operations.throttle,brake:r.operations.parkingBrake,readiness:r.worldReadiness};});
  const tap=name=>page.getByRole('button',{name,exact:true}).tap();
  try{
    await page.goto(process.env.FLY_URL||'http://localhost:3027');
    await page.getByTestId('hangar').waitFor({timeout:60000});
    await page.evaluate(()=>history.back());await page.waitForTimeout(500);
    if(!await page.getByTestId('hangar').isVisible())throw new Error('Back dismissed mandatory aircraft selection');
    report.checks.push('mandatory selection survives Back');
    await page.getByTestId('hangar-pick-prop').tap({timeout:60000});
    await page.getByTestId('hangar-fly').tap({timeout:60000});
    try{await page.waitForFunction(()=>window.__flyBoot?.pct===100&&!window.__fly.worldLoading&&window.__fly.worldReadiness.ready,undefined,{timeout:90000});}
    catch{report.status='BLOCKED';report.evidence=await state();process.exitCode=2;console.log('VERIFY: BLOCKED — touch full-detail startup');return;}
    await page.getByTestId('warp-hold').waitFor({state:'hidden'});
    await page.waitForTimeout(1500);
    await page.screenshot({path:out+'/apron-portrait.png'});
    await tap('Parking brake on');
    await page.getByTestId('touch-fab').tap();await page.getByTestId('touch-throttle-cruise').tap();
    await page.getByTestId('touch-fab').tap();await page.waitForTimeout(4000);
    const before=await state();if(before.speed<=0)throw new Error('Touch taxi preset did not move aircraft');
    const cdp=await context.newCDPSession(page),stick=await page.getByTestId('touch-joystick').boundingBox();
    const x=stick.x+stick.width/2,y=stick.y+stick.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+45,y}]});
    await page.waitForTimeout(1500);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    if(Math.abs((await state()).heading-before.heading)<.05)throw new Error('Touch stick did not steer');
    report.checks.push('taxi power','touch steering');
    await page.getByTestId('touch-fab').tap();await page.getByTestId('touch-throttle-slow').tap();await page.getByTestId('touch-fab').tap();
    const brake=page.getByRole('button',{name:'Hold brakes',exact:true});await brake.scrollIntoViewIfNeeded();
    const box=await brake.boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
    await page.waitForTimeout(2000);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    if((await state()).speed>.5)throw new Error('Touch wheel braking did not stop aircraft');
    await tap('Parking brake off');report.checks.push('idle','held wheel brake','parking brake');
    await page.setViewportSize({width:844,height:390});await page.waitForTimeout(500);
    await page.screenshot({path:out+'/apron-landscape.png'});
    for(const id of ['touch-joystick','touch-fab']){
      const b=await page.getByTestId(id).boundingBox();if(!b||b.x<0||b.y<0||b.x+b.width>844||b.y+b.height>390)throw new Error(`${id} outside landscape viewport`);
      const hit=await page.evaluate(({x,y,id})=>document.elementFromPoint(x,y)?.closest(`[data-testid="${id}"]`)!=null,{x:b.x+b.width/2,y:b.y+b.height/2,id});
      if(!hit)throw new Error(`${id} is covered by another panel in landscape`);
    }
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Horizontal overflow');
    if(errors.some(e=>e!=='Failed to fetch'))throw new Error(errors.join('\n'));
    report.status='PASS';console.log('VERIFY: PASS — touch full-detail departure, taxi, steering, brakes and portrait/landscape controls. Touch circuit not tested.');
  }catch(e){report.status='FAIL';report.error=String(e.stack||e);throw e;}
  finally{report.evidence=await state().catch(()=>null);fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
