/* Touch departure/control check against the real world. No airborne fixture. */
const {chromium,devices}=require('playwright');
const fs=require('node:fs');
const {enterHangar,waitTitleReady}=require('./_title'); // R25 (E, SANCTIONED)
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
    // R25 (E, SANCTIONED): the rule is now "BACK NEVER REVEALS AN UNSTARTED
    // WORLD". With A's title screen, Back on the title root is a no-op and
    // Back in the pre-flight hangar returns to the title (plan UX table) —
    // either way a menu must still cover the world and the flight must not
    // have started. Without a title (r25-w0 / flag off / bypass pin) this is
    // today's assertion exactly: the mandatory hangar survives Back.
    const unstarted=async where=>{
      const s=await page.evaluate(()=>{const st=window.__flyStore?.getState?.();return {screen:st?.screen??null,hangarOpen:st?.hangarOpen??null};});
      const title=await page.locator('[data-testid="title-screen"]').count()>0&&await page.locator('[data-testid="title-screen"]').first().isVisible();
      const hangar=await page.getByTestId('hangar').isVisible();
      if(!(title||hangar)||s.screen==='flight')throw new Error(`Back revealed an unstarted world (${where}): ${JSON.stringify({...s,title,hangar})}`);
      return title?'title':'hangar';
    };
    const t=await waitTitleReady(page,{timeoutMs:60000});
    if(t.title){
      await page.evaluate(()=>history.back());await page.waitForTimeout(500);
      // At the app ROOT the browser's own Back may leave the page (about:blank
      // in a fresh tab) unless the title pushes a history entry — A's call.
      // Leaving is not revealing a world; re-enter and carry on.
      if(!page.url().startsWith(new URL(process.env.FLY_URL||'http://localhost:3027').origin)){
        report.checks.push('Back on the title root leaves the page (browser default at the app root)');
        await page.goto(process.env.FLY_URL||'http://localhost:3027');await waitTitleReady(page,{timeoutMs:60000});
      }else report.checks.push(`Back on the title keeps the ${await unstarted('title root')}`);
    }
    await enterHangar(page,'ops',{tap:true,timeoutMs:60000});
    await page.evaluate(()=>history.back());await page.waitForTimeout(500);
    const afterBack=await unstarted('pre-flight hangar');
    if(!t.title&&afterBack!=='hangar')throw new Error('Back dismissed mandatory aircraft selection');
    report.checks.push(t.title?`Back in the pre-flight hangar lands on the ${afterBack}`:'mandatory selection survives Back');
    if(afterBack!=='hangar')await enterHangar(page,'ops',{tap:true,timeoutMs:60000});
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
