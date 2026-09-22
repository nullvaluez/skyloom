/* Reproduce a wide taxi turn with normal controls. No runtime pose writes. */
const {chromium}=require('playwright');const fs=require('node:fs');
(async()=>{
 const out=process.env.FLY_OPERATIONS_OUTPUT||'.graphics-review/operations/taxi-edge';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
 const page=await browser.newPage({viewport:{width:1280,height:800}}),report={status:'RUNNING',events:[],errors:[]};
 page.on('pageerror',e=>report.errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('fly-controls-seen','1'));
 const state=()=>page.evaluate(()=>{const r=window.__fly,o=r.operations,f=r.flight;return {phase:o.phase,speed:f.speed,position:f.pos,heading:f.heading,warning:o.routeWarning,events:o.events,readiness:r.worldReadiness};});
 const record=async name=>{const s=await state();report.events.push({name,...s});console.log(name+': '+JSON.stringify({phase:s.phase,speed:s.speed,warning:s.warning}));return s;};
 try{
  await page.goto(process.env.FLY_URL||'http://localhost:3027');
  await page.getByTestId('hangar-pick-prop').click({timeout:60000});await page.selectOption('#departure-airport','KOSU');await page.getByTestId('hangar-fly').click({timeout:60000});
  await page.waitForFunction(()=>window.__flyBoot?.pct===100&&!window.__fly.worldLoading&&!window.__fly.worldDegraded&&window.__fly.worldReadiness.ready,undefined,{timeout:90000});
  await page.getByTestId('warp-hold').waitFor({state:'hidden'});await page.waitForTimeout(1600);
  await record('apron');await page.keyboard.press('b');await page.keyboard.press('2');
  // Continue straight beyond the apron instead of making the marked turn.
  await page.waitForFunction(()=>!!window.__fly.operations.routeWarning,undefined,{timeout:90000});
  const edge=await record('crossed-edge');await page.waitForTimeout(4000);const moving=await record('still-moving');
  if(moving.speed<1||Math.hypot(moving.position.x-edge.position.x,moving.position.z-edge.position.z)<5)throw new Error('Pavement edge trapped the aircraft');
  await page.screenshot({path:out+'/off-pavement.png'});
  await page.keyboard.down('d');
  try{await page.waitForFunction(start=>Math.abs(window.__fly.flight.heading-start)>=Math.PI,moving.heading,{timeout:15000});}
  finally{await page.keyboard.up('d');}
  const turned=await record('turned-back');if(Math.abs(turned.heading-moving.heading)<1.5)throw new Error('No useful steering after crossing pavement');
  await page.waitForFunction(()=>!window.__fly.operations.routeWarning,undefined,{timeout:25000});
  await page.keyboard.press('1');await page.keyboard.down(' ');await page.waitForTimeout(3000);await page.keyboard.up(' ');await page.keyboard.press('b');
  const recovered=await record('recovered-on-pavement');if(recovered.phase==='crashed'||recovered.speed>.1)throw new Error('Could not recover and stop');
  await page.screenshot({path:out+'/recovered.png'});
  if(report.errors.some(e=>e!=='Failed to fetch'))throw new Error(report.errors.join('\n'));
  report.status='PASS';console.log('VERIFY: PASS — crossed pavement edge, kept moving, steered back and stopped using normal keyboard controls.');
 }catch(e){report.status='FAIL';report.error=String(e.stack||e);throw e;}
 finally{fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
