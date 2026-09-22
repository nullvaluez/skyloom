/* Complete assisted training paths through UI controls. Not an unassisted circuit. */
const {chromium,devices}=require('playwright');const fs=require('node:fs');
(async()=>{
 const touch=process.env.FLY_TOUCH==='1',out=process.env.FLY_OPERATIONS_OUTPUT||`.graphics-review/operations/experience-${touch?'touch':'desktop'}`;fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
 const context=await browser.newContext(touch?{...devices['Pixel 7'],viewport:{width:390,height:844},deviceScaleFactor:1}:{viewport:{width:1440,height:900}}),page=await context.newPage();
 const report={status:'RUNNING',input:touch?'touch':'keyboard/pointer',checks:[],states:[],errors:[],limit:'Runway and final-approach starts are explicit product assists, not unassisted circuit evidence.'};
 page.on('pageerror',e=>report.errors.push(e.message));page.on('crash',()=>report.errors.push('Browser target crashed'));
 await page.addInitScript(()=>localStorage.setItem('fly-controls-seen','1'));
 const click=async locator=>touch?locator.tap():locator.click(),button=name=>page.getByRole('button',{name,exact:true});
 const state=()=>page.evaluate(()=>{const r=window.__fly,o=r.operations,f=r.flight;return {phase:o.phase,speed:f.speed,position:f.pos,pitch:f.pitch,agl:f.agl,assisted:o.assisted,events:o.events,contacts:o.contactCount,takeoffs:o.takeoffs,readiness:r.worldReadiness,gear:o.gear,routeIndex:o.routeIndex};});
 const record=async name=>{const s=await state();report.states.push({name,...s});console.log(name+': '+JSON.stringify({phase:s.phase,speed:s.speed,agl:s.agl,contacts:s.contacts,takeoffs:s.takeoffs}));fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));return s;};
 const ready=async()=>{await page.waitForTimeout(600);await page.waitForFunction(()=>window.__flyBoot?.pct===100&&!window.__fly.worldLoading&&!window.__fly.worldDegraded&&window.__fly.worldReadiness.ready,undefined,{timeout:90000});await page.getByTestId('warp-hold').waitFor({state:'hidden'});await page.waitForTimeout(1000);};
 let cdp;
 async function pitch(ms){
  if(!touch){await page.keyboard.down('s');await page.waitForTimeout(ms);await page.keyboard.up('s');return;}
  cdp??=await context.newCDPSession(page);const b=await page.getByTestId('touch-joystick').boundingBox(),x=b.x+b.width/2,y=b.y+b.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-54}]});await page.waitForTimeout(ms);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 }
 try{
  await page.goto(process.env.FLY_URL||'http://localhost:3001/?graphicsReview=1');
  const ids=touch?['prop']:['fighter','military','warbird-jet','warbird-prop','glider','bizjet','airliner','cargo','prop'];
  let hangarCanvas;
  for(const id of ids){
   await click(page.getByTestId('hangar-pick-'+id));await page.waitForFunction(()=>!document.querySelector('[data-testid="hangar-fly"]').disabled,undefined,{timeout:60000});
   if(hangarCanvas&&!await hangarCanvas.evaluate(node=>node===document.querySelector('.ops-bay canvas')))throw new Error('Aircraft selection replaced the hangar canvas');
   hangarCanvas??=await page.locator('.ops-bay canvas').elementHandle();
   await page.waitForTimeout(300);
   for(const view of touch?['Overview']:['Front','Side','Rear','Overview']){await click(button(view));await page.waitForTimeout(250);await page.screenshot({path:`${out}/${id}-${view.toLowerCase()}.png`});}
   console.log('Preview '+id+' ready');
  }
  report.checks.push('all requested fleet views');
  for(const id of ['fighter','prop']){await click(page.getByTestId('hangar-pick-'+id));await page.waitForFunction(()=>!document.querySelector('[data-testid="hangar-fly"]').disabled,undefined,{timeout:15000});}
  report.checks.push('cached aircraft re-selection');
  if(touch){await page.setViewportSize({width:844,height:390});await page.waitForTimeout(400);await page.screenshot({path:out+'/hangar-landscape.png'});await page.setViewportSize({width:390,height:844});}
  if(process.env.FLY_PREVIEW_ONLY==='1'){report.status='PASS';report.limit='Hangar preview and cached selection only; no flight tested in this run.';console.log('VERIFY: PASS — hangar previews and cached aircraft selection.');return;}
  await page.selectOption('#departure-airport','KOSU');await click(page.locator('input[value="runway"]'));await click(page.getByTestId('hangar-fly'));await ready();
  const runway=await record('runway-start');if(runway.phase!=='parked'||runway.speed!==0||!runway.assisted)throw new Error('Runway start was not stationary and assisted');
  await page.screenshot({path:out+'/runway-ready.png'});await click(button('Begin takeoff'));
  await page.waitForFunction(()=>window.__fly.flight.speed>=window.__fly.operations.profile.rotate,undefined,{timeout:45000});
  await pitch(600);await page.waitForFunction(()=>window.__fly.operations.phase==='airborne',undefined,{timeout:7000});
  const airborne=await record('manual-rotation');if(airborne.takeoffs!==1||airborne.contacts!==0)throw new Error('Takeoff attribution incorrect');report.checks.push('runway start','takeoff power','manual rotation');
  await click(page.getByText('Destination and guidance',{exact:true}));await click(button('Practice landing'));await ready();
  await record('first-final');await page.screenshot({path:out+'/approach.png'});
  const before=await state();await click(button('Go around'));await page.waitForTimeout(3500);const after=await record('go-around');
  if(after.position.y<=before.position.y||after.contacts!==0)throw new Error('Go-around failed to arrest descent');report.checks.push('go-around');
  await click(button('Practice landing'));await ready();await record('second-final');
  // Stable final is flown by the ordinary integrator; the only later input
  // is the user's flare command and idle/brakes. No runtime pose/controller writes.
  await page.waitForFunction(()=>{const r=window.__fly;return r.flight.agl<r.operations.profile.clearance+8||r.operations.phase==='crashed';},undefined,{timeout:160000});
  if((await state()).phase==='crashed')throw new Error('Failed before flare');
  await click(button('Idle'));await pitch(touch?180:180);await record('flare');await page.waitForFunction(()=>['landingRoll','taxiIn','crashed'].includes(window.__fly.operations.phase),undefined,{timeout:50000});
  const touchdown=await record('touchdown');if(touchdown.phase==='crashed'||touchdown.contacts!==1)throw new Error('Landing failed or duplicate touchdown');
  await click(button('Idle'));
  if(touch){cdp??=await context.newCDPSession(page);const brakes=button('Hold brakes');await brakes.scrollIntoViewIfNeeded();const b=await brakes.boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});await page.waitForTimeout(7000);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else{await page.keyboard.down(' ');await page.waitForTimeout(7000);await page.keyboard.up(' ');}
  const stopped=await record('stopped');if(stopped.speed>.5||stopped.contacts!==1)throw new Error('Rollout braking failed');report.checks.push('manual flare','single touchdown','rollout braking');
  await page.screenshot({path:out+'/landed.png'});
  if(report.errors.some(e=>e!=='Failed to fetch'))throw new Error(report.errors.join('\n'));
  report.status='PASS';console.log('VERIFY: PASS — fleet preview, assisted runway start, manual takeoff, go-around, assisted final, manual flare and braking.');
 }catch(e){report.status='FAIL';report.error=String(e.stack||e);try{await record('failure');await page.screenshot({path:out+'/failure.png'});}catch{}throw e;}
 finally{fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
