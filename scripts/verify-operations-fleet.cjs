/* Real UI fleet/lifecycle coverage. No poses, pins, or automatic flights. */
const {chromium}=require('playwright');
const fs=require('node:fs');
const {enterHangar}=require('./_title'); // R25 (E, SANCTIONED): reach the hangar through the title when there is one
(async()=>{
 const out=process.env.FLY_OPERATIONS_OUTPUT||'.graphics-review/operations/fleet';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
 const report={status:'RUNNING',cases:[],errors:[],limits:'Preview and full-detail stationary departures; not circuits or a GPU leak certification.'};
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('fly-controls-seen','1'));
 const snapshot=()=>page.evaluate(()=>{const r=window.__fly,g=window.__graphicsReview;return {phase:r.operations.phase,speed:r.flight.speed,position:r.flight.pos,ground:r.flight.groundElev,clearance:r.operations.profile?.clearance,brake:r.operations.parkingBrake,readiness:r.worldReadiness,degraded:r.worldDegraded,resources:g&&{textures:g.textures,geometries:g.geometries,programs:g.programs,tier:g.tier},canvases:document.querySelectorAll('canvas').length,hangarCanvases:document.querySelectorAll('.ops-bay canvas').length};});
 async function hangar(){await page.keyboard.press('Escape');await page.getByTestId('pause-hangar').click();await page.getByRole('button',{name:'End flight and open hangar',exact:true}).click();}
 try{
  await page.goto(process.env.FLY_URL||'http://localhost:3027/?graphicsReview=1');
  await enterHangar(page,'ops');
  for(const [id,airport] of [['prop','KOSU'],['fighter','KCMH'],['military','KLCK'],['warbird-jet','KCMH'],['warbird-prop','KOSU'],['bizjet','KLCK'],['airliner','KCMH'],['cargo','KLCK'],['glider',null],['prop','KOSU']]){
   console.log('Checking '+id+' preview');
   await page.getByTestId('hangar-pick-'+id).click({timeout:60000});
   await page.waitForFunction(()=>!document.querySelector('[data-testid="hangar-fly"]').disabled,undefined,{timeout:60000});
   await page.waitForTimeout(600);
   for(const view of ['Front','Side','Rear','Overview']){
    await page.getByRole('button',{name:view,exact:true}).click();await page.waitForTimeout(250);
    await page.screenshot({path:`${out}/${id}-hangar-${view.toLowerCase()}.png`});
   }
   if(airport)await page.selectOption('#departure-airport',airport);
   await page.getByTestId('hangar-fly').click();const start=Date.now();
   try{await page.waitForFunction(()=>window.__flyBoot?.pct===100&&!window.__fly.worldLoading&&!window.__fly.worldDegraded&&window.__fly.worldReadiness.ready,undefined,{timeout:90000});}
   catch{report.status='BLOCKED';report.cases.push({id,airport,state:await snapshot()});process.exitCode=2;console.log('VERIFY: BLOCKED '+id+' '+airport);return;}
   await page.getByTestId('warp-hold').waitFor({state:'hidden'});await page.waitForTimeout(1500);
   const state=await snapshot();
   if(airport&&(state.phase!=='parked'||state.speed!==0||!state.brake||Math.abs(state.position.y-state.ground-state.clearance)>.01))throw new Error('Invalid apron contact for '+id);
   if(!airport&&(state.phase!=='airborne'||state.speed<=0))throw new Error('Glider practice did not launch airborne');
   // The world, label overlay and minimap all legitimately own canvases.
   if(state.hangarCanvases!==0)throw new Error('Hangar canvas retained after departure');
   await page.screenshot({path:`${out}/${id}-world.png`});
   report.cases.push({id,airport,readyMs:Date.now()-start,state});fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));
   console.log('PASS '+id+' '+(airport||'airborne practice')+' '+JSON.stringify(state.resources));
   if(airport&&process.env.FLY_TEST_TAKEOFF==='1'){
    // This explicitly exercises the product's assisted shortcut, not a
    // taxi/circuit certificate. All acceleration and rotation use controls.
    await page.getByRole('button',{name:'Line up on runway',exact:true}).click();await page.waitForTimeout(600);
    await page.waitForFunction(()=>!window.__fly.worldLoading&&window.__fly.worldReadiness.ready,undefined,{timeout:90000});
    await page.getByTestId('warp-hold').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Begin takeoff',exact:true}).click();
    await page.waitForFunction(()=>window.__fly.flight.speed>=window.__fly.operations.profile.rotate,undefined,{timeout:45000});
    await page.keyboard.down('s');
    try{await page.waitForFunction(()=>window.__fly.operations.phase==='airborne',undefined,{timeout:10000});}finally{await page.keyboard.up('s');}
    const takeoff=await page.evaluate(()=>{const o=window.__fly.operations;return {assisted:o.assisted,takeoffs:o.takeoffs,contacts:o.contactCount,agl:window.__fly.flight.agl};});
    if(!takeoff.assisted||takeoff.takeoffs!==1||takeoff.contacts!==0)throw new Error('Incorrect assisted takeoff attribution for '+id);
    report.cases.at(-1).takeoff=takeoff;console.log('PASS '+id+' assisted runway start and manual rotation');
   }
   await hangar();
  }
  if(report.errors.some(e=>e!=='Failed to fetch'))throw new Error(report.errors.join('\n'));
  report.status='PASS';console.log('VERIFY: PASS — all nine previews, eight powered departures, glider practice and repeat departure. Circuits not tested.');
 }catch(e){report.status='FAIL';report.error=String(e.stack||e);throw e;}
 finally{fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
