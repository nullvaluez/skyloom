/* Unpinned real-browser check. Full readiness is mandatory by default.
 * FLY_ALLOW_REDUCED=1 reports fallback controls separately, still exit 2.
 * This is startup/control coverage, not a flight circuit. */
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const out=process.env.FLY_OPERATIONS_OUTPUT||'.graphics-review/operations/browser';
const timeout=Number(process.env.FLY_READY_TIMEOUT_MS)||90000;
const snapshot=page=>page.evaluate(()=>{
  const r=window.__fly;
  return {boot:window.__flyBoot,worldLoading:r?.worldLoading,degraded:r?.worldDegraded,
    readiness:r?.worldReadiness,terrain:r?.terraStats,surface:r?.earthSurface,
    phase:r?.operations?.phase,speed:r?.flight?.speed,position:r?.flight?.pos,
    ground:r?.flight?.groundElev,arrival:r?.arrivalStats};
});
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const report={status:'RUNNING',cases:[],errors:[],failedRequests:[],httpErrors:[]};
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('requestfailed',r=>report.failedRequests.push({url:r.url(),error:r.failure()?.errorText}));
  page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()});});
  await page.addInitScript(()=>localStorage.setItem('fly-controls-seen','1'));
  async function departure(name){
    await page.getByTestId('hangar-pick-prop').click({timeout:60000});
    await page.selectOption('#departure-airport','KOSU');
    await page.getByTestId('hangar-fly').click({timeout:60000});
    const started=Date.now();
    await page.getByTestId('hangar').waitFor({state:'hidden'});
    let full=true;
    try{
      await page.waitForFunction(()=>window.__flyBoot?.pct===100 && window.__fly?.worldLoading===false &&
        window.__fly?.worldDegraded===false && window.__fly?.worldReadiness?.ready===true,
        undefined,{timeout});
    }catch{full=false;}
    const evidence=await snapshot(page);
    report.cases.push({name,full,elapsedMs:Date.now()-started,evidence});
    console.log(`${name}: ${full?'FULL_DETAIL':'BLOCKED'} ${JSON.stringify(evidence.readiness)}`);
    if(!full){
      await page.screenshot({path:path.join(out,`${name}-blocked.png`)});
      if(process.env.FLY_ALLOW_REDUCED!=='1')return false;
      const reduced=page.getByRole('button',{name:'Continue with reduced detail'});
      for(let i=0;i<2 && await reduced.count();i++){
        await reduced.last().click();await page.waitForTimeout(1500);
      }
      await page.waitForFunction(()=>window.__flyBoot?.pct===100&&!window.__fly?.worldLoading,undefined,{timeout:5000});
    }
    await page.getByTestId('warp-hold').waitFor({state:'hidden',timeout:5000});
    await page.waitForTimeout(1500);
    await page.screenshot({path:path.join(out,`${name}-apron.png`)});
    const before=await snapshot(page);
    if(before.phase!=='parked'||before.speed!==0)throw new Error('Departure did not start stationary with parking brake');
    await page.waitForTimeout(1000);
    const after=await snapshot(page);
    if(Math.hypot(after.position.x-before.position.x,after.position.z-before.position.z)>.01)throw new Error('Parked aircraft drifted');
    return full;
  }
  async function controls(){
    await page.keyboard.press('b');await page.keyboard.press('2');await page.waitForTimeout(3000);
    if(!await page.evaluate(()=>window.__fly.flight.speed>0))throw new Error('Taxi power did not move the aircraft');
    await page.keyboard.down(' ');await page.keyboard.press('1');await page.waitForTimeout(3000);await page.keyboard.up(' ');
    if(await page.evaluate(()=>window.__fly.flight.speed>.5))throw new Error('Wheel braking did not stop the aircraft');
  }
  try{
    await page.goto(process.env.FLY_URL||'http://localhost:3027');
    const full=await departure('fresh');
    if(!full){
      if(process.env.FLY_ALLOW_REDUCED==='1'){await controls();report.fallbackControls='PASS';}
      report.status='BLOCKED';process.exitCode=2;
      console.log(`VERIFY: BLOCKED — full detail unavailable${report.fallbackControls?'; FALLBACK_CONTROLS: PASS':''}`);return;
    }
    await controls();
    await page.getByText('Destination and guidance',{exact:true}).click();
    await page.getByRole('button',{name:'Return to hangar…',exact:true}).click();
    await page.getByRole('button',{name:'End flight and open hangar',exact:true}).click();
    if(!await departure('second')){report.status='BLOCKED';process.exitCode=2;console.log('VERIFY: BLOCKED — second departure');return;}
    await page.reload();
    if(!await departure('reload')){report.status='BLOCKED';process.exitCode=2;console.log('VERIFY: BLOCKED — reload departure');return;}
    if(report.errors.some(e=>e!=='Failed to fetch'))throw new Error(report.errors.join('\n'));
    report.status='FULL_DETAIL_PASS';
    console.log('VERIFY: PASS — FULL_DETAIL: fresh, second departure, reload; stationary apron, taxi and braking. Circuit not tested.');
  }catch(error){report.status='FAIL';report.error=String(error.stack||error);throw error;}
  finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
