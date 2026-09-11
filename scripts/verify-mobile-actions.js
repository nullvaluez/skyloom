/**
 * Touch panel acceptance: real hit testing, compact screens, two-thumb input,
 * cancellation and Back. This gate claims UI behavior, never world/GPU quality.
 * FLY_URL may point to a dev server or a production graphics-review URL.
 * FLY_MOBILE_HARDWARE=1 uses hardware; otherwise the existing mobile fixture
 * launcher is used. No external tile payload is needed for these UI assertions.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { bootMobile, openActions, closeActions, MOBILE_CTX, LAUNCH_ARGS } = require('./_mobile-boot');
const OUT = process.env.MOBILE_ACTIONS_OUT || path.join(__dirname, 'ground-night-out', 'mobile-actions');
const sizes = [[320,568],[360,640],[390,844],[430,932],[568,320],[640,360],[844,390],[932,430],[768,1024],[1024,768]];
let gates = 0;
const report={startedAt:new Date().toISOString(),url:process.env.FLY_URL||'http://localhost:3000',expectedBuildId:process.env.FLY_BUILD_ID||null,
  receipt:null,status:'running',gates:[],errors:[],notes:['Chromium touch emulation; not a real Safari/device certification.']};
function saveReport(){
  fs.mkdirSync(OUT,{recursive:true});
  fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify({...report,finishedAt:new Date().toISOString()},null,2));
}
function gate(name, condition, detail) {
  report.gates.push({name,ok:!!condition,...(detail===undefined?{}:{detail})});
  assert.ok(condition, `${name}${detail ? `: ${JSON.stringify(detail)}` : ''}`);
  gates++; console.log(`PASS ${name}`);
}
async function pointer(page, id, type, pointerId = 1, dx = 0) {
  const element = page.getByTestId(id);
  const box = await element.boundingBox();
  await element.dispatchEvent(type, { pointerType: 'touch', pointerId, button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    clientX: box.x + box.width / 2 + dx, clientY: box.y + box.height / 2 });
}
async function state(page) {
  return page.evaluate(() => ({ open: !!document.querySelector('[data-testid="touch-actions"]'),
    boost: window.__fly.input.touchBoost, steer: window.__fly.input.touch.active,
    look: window.__fly.input.freeLook.active, phase: window.__flyStore.getState().phase,
    url: location.href }));
}
async function closed(page, label) {
  const result = await page.evaluate(() => {
    const root = document.querySelector('[data-fly-root]');
    const visible = (el) => { const r=el.getBoundingClientRect(); return r.width>0 && r.height>0 && getComputedStyle(el).visibility !== 'hidden'; };
    return { ids: [...root.querySelectorAll('button:not(:disabled)')].filter(visible).map((el) => el.dataset.testid || el.getAttribute('aria-label')),
      stick: !!root.querySelector('[data-testid="touch-joystick"]'),
      hidden: !root.querySelector('[data-testid="touch-boost"], [data-testid="touch-throttle"], [data-testid="touch-actions"]') };
  });
  gate(`${label}: closed HUD has only joystick and one gameplay button`, result.stick && result.hidden && result.ids.length === 1 && result.ids[0] === 'touch-fab', result);
}
async function geometry(page, label) {
  const rects = await page.evaluate(() => {
    const rect=(selector)=>{ const r=document.querySelector(selector)?.getBoundingClientRect(); return r && {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height}; };
    return { panel:rect('[data-touch-surface]'),stick:rect('[data-testid="touch-joystick"]'),fab:rect('[data-testid="touch-fab"]'),vw:innerWidth,vh:innerHeight };
  });
  const hit=(a,b)=>a.x<b.right && b.x<a.right && a.y<b.bottom && b.y<a.bottom;
  const {panel,stick,fab,vw,vh}=rects;
  gate(`${label}: panel is bounded and clears both controls`, panel && panel.x>=0 && panel.y>=0 && panel.right<=vw+1 && panel.bottom<=vh+1 && !hit(panel,stick) && !hit(panel,fab), rects);
  const buttons = page.locator('[data-testid="touch-actions"] button');
  for (let i=0; i<await buttons.count(); i++) {
    const button=buttons.nth(i);
    await button.scrollIntoViewIfNeeded();
    const accessible=await button.evaluate((el)=>{
      const r=el.getBoundingClientRect(), top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return {ok:r.width>=44 && r.height>=44 && !!top && (top===el || el.contains(top)),id:el.dataset.testid,w:r.width,h:r.height};
    });
    gate(`${label}: ${accessible.id} is reachable at 44px`, accessible.ok, accessible);
  }
}
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  if(process.env.FLY_BUILD_ID){
    const receiptUrl=new URL(`/_next/static/${encodeURIComponent(process.env.FLY_BUILD_ID)}/ground-source.json`,new URL(report.url).origin);
    const response=await fetch(receiptUrl);
    gate('Expected build receipt is served',response.ok,{url:receiptUrl.href,status:response.status});
    report.receipt=await response.json();
    gate('Served receipt matches requested build',report.receipt.buildId===process.env.FLY_BUILD_ID && /^[a-f0-9]{64}$/.test(report.receipt.sourceSha256),report.receipt);
    console.log('BUILD RECEIPT',JSON.stringify(report.receipt));
  }
  const hardware=process.env.FLY_MOBILE_HARDWARE==='1';
  const browser=await chromium.launch({headless:true,...(hardware ? {channel:'chrome'} : {}),args:hardware ? ['--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'] : LAUNCH_ARGS});
  try {
    const context=await browser.newContext({...MOBILE_CTX,deviceScaleFactor:1,reducedMotion:'reduce'});
    const page=await context.newPage();
    const errors=report.errors;
    page.on('pageerror',error=>errors.push(error.message));
    await bootMobile(page,{style:'satellite'});
    await page.getByTestId('touch-fab').waitFor();
    await page.waitForTimeout(300);
    for (const style of ['satellite','toy']) {
      await page.evaluate((s)=>window.__flyStore.getState().setMapStyle(s),style);
      for (const [width,height] of sizes) {
        await closeActions(page);
        await page.setViewportSize({width,height});
        await page.waitForTimeout(160);
        const label=`${style} ${width}x${height}`;
        await closed(page,label);
        await openActions(page);
        await page.waitForTimeout(180);
        await geometry(page,label);
        gate(`${label}: opening actions keeps flight live`,(await state(page)).phase==='flying');
        if (width===320 || width===844) await page.screenshot({path:path.join(OUT,`${style}-${width}x${height}.png`)});
      }
    }
    await closeActions(page);
    await page.setViewportSize({width:390,height:844});
    await openActions(page);
    // Simulated insets use the same CSS variables whose defaults read env().
    await page.evaluate(()=>{const root=document.querySelector('[data-fly-root]'); for(const [edge,value] of Object.entries({top:47,bottom:34,left:0,right:0}))root.style.setProperty(`--touch-safe-${edge}`,`${value}px`);});
    await geometry(page,'portrait with safe-area reserves');
    await page.evaluate(()=>document.querySelector('[data-fly-root]').removeAttribute('style'));
    await page.getByTestId('touch-throttle-slow').click();
    gate('Slow is a preset and keeps menu open', (await page.evaluate(()=>window.__fly.input.read().speedPreset))==='slow' && (await state(page)).open);
    await page.getByTestId('touch-throttle-boost').click();
    gate('Fast is distinct from held Boost', (await page.evaluate(()=>window.__fly.input.read().speedPreset))==='boost' && !(await state(page)).boost);
    await page.getByTestId('touch-throttle-cruise').click();
    await page.getByTestId('touch-boost').scrollIntoViewIfNeeded();
    // Browser-dispatched, hit-tested simultaneous touches exercise pointer
    // capture, unlike dispatchEvent. This is Chromium emulation, not Safari.
    const cdp=await context.newCDPSession(page);
    await page.evaluate(()=>{
      window.__touchReleaseEvents=[];
      window.__touchReleaseListener=(event)=>window.__touchReleaseEvents.push({type:event.type,id:event.pointerId,target:event.target.dataset?.testid});
      for(const type of ['pointerup','lostpointercapture'])window.addEventListener(type,window.__touchReleaseListener,true);
    });
    const stickBox=await page.getByTestId('touch-joystick').boundingBox();
    const boostBox=await page.getByTestId('touch-boost').boundingBox();
    const finger=(id,box,offset=0)=>({id,x:box.x+box.width/2+offset,y:box.y+box.height/2,radiusX:8,radiusY:8,force:1});
    const first=finger(0,stickBox), second=finger(1,boostBox), moved=finger(0,stickBox,38);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[first]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[first,second]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[moved,second]});
    gate('Real Chromium multi-touch preserves steering and held Boost',(await state(page)).open && (await state(page)).steer && (await state(page)).boost);
    // Chrome's partial-end form names the contact BEING RELEASED, not the
    // contacts left down. A prior [moved] command actually released the stick;
    // native pointerup/capture evidence below guards against that instrument bug.
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[second]});
    const boostRelease=await page.evaluate(()=>window.__touchReleaseEvents.splice(0));
    report.partialTouchRelease=boostRelease;
    gate('Partial CDP release reaches Boost and not joystick',boostRelease.some(e=>e.type==='pointerup'&&e.target==='touch-boost') && !boostRelease.some(e=>e.target==='touch-joystick'),boostRelease);
    gate('Releasing Boost thumb keeps the joystick active',!(await state(page)).boost && (await state(page)).steer);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    gate('Releasing the final thumb leaves neutral input',!(await state(page)).boost && !(await state(page)).steer);
    report.finalTouchRelease=await page.evaluate(()=>{
      for(const type of ['pointerup','lostpointercapture'])window.removeEventListener(type,window.__touchReleaseListener,true);
      return window.__touchReleaseEvents.splice(0);
    });
    await cdp.detach();
    await pointer(page,'touch-joystick','pointerdown',11,45);
    await pointer(page,'touch-boost','pointerdown',22);
    let current=await state(page);
    gate('Two thumbs steer and hold Boost while menu stays open',current.open && current.steer && current.boost,current);
    await pointer(page,'touch-boost','pointercancel',33);
    gate('Unrelated pointer cannot release held Boost',(await state(page)).boost);
    await pointer(page,'touch-boost','pointercancel',22);
    gate('Boost cancellation releases only Boost',!(await state(page)).boost && (await state(page)).steer);
    await pointer(page,'touch-joystick','lostpointercapture',11);
    gate('Lost joystick capture clears steering',!(await state(page)).steer);
    await page.getByTestId('touch-look').click();
    gate('Free look is active without closing actions',(await state(page)).look && (await state(page)).open);
    await pointer(page,'touch-boost','pointerdown',24);
    await page.getByTestId('touch-fab').click();
    current=await state(page);
    gate('Closing releases Boost, steering, and look immediately',!current.open && !current.boost && !current.steer && !current.look,current);
    gate('Closing restores focus to persistent button',await page.evaluate(()=>document.activeElement?.dataset.testid==='touch-fab'));
    await openActions(page);
    await pointer(page,'touch-boost','pointerdown',25);
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    gate('Window blur closes panel and releases controls',!(await state(page)).open && !(await state(page)).boost);
    await openActions(page);
    await page.keyboard.press('Escape');
    gate('Escape closes disclosure without pausing',!(await state(page)).open && (await state(page)).phase==='flying');
    await openActions(page);
    const url=page.url();
    await page.evaluate(()=>history.back());
    await page.waitForTimeout(160);
    gate('Back closes actions without navigating',!(await state(page)).open && page.url()===url);
    await openActions(page);
    await page.getByTestId('touch-pause').click();
    gate('Pause opens settings and covers flight controls',(await state(page)).phase==='paused' && !(await page.getByTestId('touch-fab').count()));
    await page.evaluate(()=>history.back());
    await page.waitForTimeout(160);
    gate('Back from Pause resumes instead of leaving',(await state(page)).phase==='flying' && page.url()===url);
    for(const [id,selector,close] of [
      ['atlas','atlas',()=>window.__flyStore.getState().setAtlasOpen(false)],
      ['logbook','logbook',()=>window.__flyStore.getState().setLogbookOpen(false)],
      ['hangar','hangar',()=>window.__flyStore.getState().setHangarOpen(false)],
    ]) {
      await openActions(page); await page.getByTestId(`touch-${id}`).click();
      gate(`${id} is reachable and closes actions`,!(await page.getByTestId('touch-actions').count()) && !(await page.getByTestId('touch-joystick').count()));
      await page.evaluate(close); await page.getByTestId('touch-fab').waitFor();
    }
    await openActions(page); await page.getByTestId('touch-contracts').click();
    gate('Contracts opens from the disclosure',!!(await page.locator('[data-touch-surface="contracts"]').count()) && !(await page.getByTestId('touch-actions').count()));
    await page.getByTestId('contracts-collapse').click();
    await closed(page,'after Contracts');
    await openActions(page); await page.getByTestId('touch-photo').click();
    await page.getByTestId('photo-exit').waitFor();
    gate('Photo is reachable and hides flight controls',!(await page.getByTestId('touch-joystick').count()));
    await page.getByTestId('photo-exit').click(); await page.getByTestId('touch-fab').waitFor();
    // A fixed target fixture isolates HUD availability from live ADS-B traffic.
    // Autopilot computation is parked; action dispatch and lock-state mirroring
    // still run through FlyScene's real input state machines.
    await page.evaluate(()=>{
      const rt=window.__fly, f=rt.flight;
      const track={hex:'c0ffee',meta:{flight:'UITEST',r:'N25UI',t:'C172',color:'#22d3ee'},
        rx:f.pos.x,ry:f.pos.y,ryd:f.pos.y,rz:f.pos.z-100,yaw:0,distM:1000,stale:0,horizonFade:1};
      rt.targeting.update=()=>null; rt.targeting.lockedHex=track.hex; rt.targeting.target=track;
      rt.autopilot.update=()=>null; rt.autopilot.disengage();
      rt.traffic.tracks.set(track.hex,track);
      window.__touchTargetFixture=setInterval(()=>rt.traffic.tracks.set(track.hex,track),100);
    });
    await openActions(page); await page.getByTestId('touch-inspect').waitFor();
    gate('A soft lock exposes Inspect and Intercept, without Cinema',!!(await page.getByTestId('touch-intercept').count()) && !(await page.getByTestId('touch-cinema').count()));
    await page.waitForFunction(()=>!!window.__flyStore.getState().infoCardHex);
    await page.getByTestId('touch-dismiss-info').click();
    await page.waitForTimeout(450);
    gate('Hide aircraft info retains the suppression interval',!await page.evaluate(()=>window.__flyStore.getState().infoCardHex));
    await page.getByTestId('touch-inspect').click();
    gate('Inspect action opens the selected contact',await page.evaluate(()=>window.__flyStore.getState().inspectHex==='c0ffee'));
    await page.evaluate(()=>window.__flyStore.getState().setInspectHex(null));
    await page.getByTestId('touch-fab').waitFor(); await openActions(page);
    await page.getByTestId('touch-intercept').click(); await page.getByTestId('touch-cinema').waitFor();
    gate('Intercept uses the existing autopilot state machine',await page.evaluate(()=>window.__fly.autopilot.mode==='intercept'));
    await page.getByTestId('touch-cinema').click();
    await page.waitForFunction(()=>window.__flyStore.getState().cameraMode==='cinema');
    gate('Cinema action enters cinematic follow',true);
    await page.getByTestId('touch-cinema').click();
    await page.waitForFunction(()=>window.__flyStore.getState().cameraMode==='chase');
    await page.evaluate(()=>{
      const rt=window.__fly; clearInterval(window.__touchTargetFixture);
      delete rt.targeting.update; delete rt.autopilot.update; rt.autopilot.disengage();
      rt.targeting.lockedHex=null; rt.targeting.target=null; rt.traffic.tracks.delete('c0ffee');
      window.__flyStore.getState().clearLock();
    });
    await openActions(page);
    const animation=await page.getByTestId('touch-actions').evaluate(el=>getComputedStyle(el).animationName);
    gate('Reduced motion disables panel animation',animation==='none',animation);
    await closeActions(page);
    // No fallback success for runtime errors; environmental failures remain explicit.
    gate('No pageerrors',errors.length===0,errors.slice(0,8));
    await context.close();
    report.status='pass';
    console.log(`VERIFY: PASS (${gates} gates; build ${report.receipt?.buildId??'unbound'})`);
  } finally {await browser.close();saveReport();}
})().catch(error=>{
  report.status='fail';report.failure=error.stack||String(error);saveReport();
  console.error(`VERIFY: FAIL (${gates} passed; build ${report.receipt?.buildId??'unbound'})`,report.failure);
  process.exitCode=1;
});
