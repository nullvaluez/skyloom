// Exercise a production flight, including the optical camera and a hot hangar
// swap. Pass an optional directory to keep one actual cockpit image per aircraft.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { attachFixture, fixtureEnabled, fixturePin } = require('./_fixture');

const airframes = ['fighter','military','warbird-jet','warbird-prop','prop','glider','bizjet','airliner','cargo','flying-wing','f35','c17','concorde'];

async function runFlight(browser, base, out, mobile) {
  const viewport = mobile ? {width:844,height:390} : {width:1400,height:840};
  const context = await browser.newContext({viewport,hasTouch:mobile,isMobile:mobile,deviceScaleFactor:1});
  const errors = [];
  let driverWarnings = 0;
  try {
    if (fixtureEnabled()) {
      const fixture = await attachFixture(context);
      await context.addInitScript(pin=>{window.__flyTileFixture=pin;},fixturePin(fixture.url));
    }
    await context.addInitScript(()=>{
      localStorage.setItem('fly-controls-seen','1');
      localStorage.setItem('fly-sound-on','0');
      localStorage.setItem('fly-explorer-preferences-v1',JSON.stringify({version:1,settings:{tutorial:'done'}}));
    });
    const page = await context.newPage();
    page.on('pageerror',err=>{errors.push(err.message); console.error(err.message);});
    page.on('console',msg=>{
      const detail=msg.text();
      // Chrome/D3D11 also emits this driver warning with both cockpit flags
      // disabled. Keep its count visible alongside the actual shader failures.
      if (msg.type()==='warning' && detail.includes('GL_INVALID_VALUE: glGetProgramiv: Program object expected.')) driverWarnings++;
      else if (/Shader Error|GL_INVALID|error in program/i.test(detail)) errors.push(detail);
    });
    const url = new URL(base);
    url.searchParams.set('graphicsReview','1');
    url.searchParams.set('at','48.835,2.305,4920');
    url.searchParams.set('sunUtc','2026-06-21T14:00:00Z');
    url.searchParams.set('weather','baseline');
    url.searchParams.set('aircraft',mobile?'concorde':'fighter');
    const launch = async () => {
      await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:150000});
      await page.waitForFunction(id=>
        window.__flyBoot?.pct===100 && window.__flyStore?.getState().screen==='flight' &&
        window.__fly?.lastLaunch?.aircraftId===id && window.__fly.flight.aircraftVisual?.id===id,
      url.searchParams.get('aircraft'),{timeout:180000});
    };
    await launch();
    const seat = desired => page.waitForFunction(on=>{
      const s=window.__flyStore.getState();
      return s.f35PilotSeat === on && window.__fly.input?.pilotLook === on && !window.__fly.worldLoading;
    },desired,{timeout:90000});
    await seat(true);
    if (mobile) {
      for (const desired of [false,true]) {
        await page.getByTestId('touch-fab').tap();
        await page.getByTestId('touch-seat').tap();
        await seat(desired);
      }
      if (out) await page.screenshot({path:path.join(out,'touch-concorde.png')});
      await page.setViewportSize({width:390,height:844});
      await page.getByTestId('touch-fab').tap();
      await page.getByTestId('touch-seat').tap();
      await seat(false);
      await launch();
      await seat(false);
      await page.getByTestId('touch-fab').tap();
      await page.getByTestId('touch-seat').tap();
      await seat(true);
      if (out) await page.screenshot({path:path.join(out,'touch-portrait.png')});
      console.log('Portrait touch controls and saved outside view passed');
      console.log('Touch panel switched the camera both ways');
    } else {
      const toggle = page.getByTestId('switch-f35-view');
      await toggle.click();
      await seat(false);
      await toggle.click();
      await seat(true);
      // The terrain reveal and airborne warp can briefly hold simulation after
      // the camera is ready. Wait for movement before sending flight hotkeys.
      const start = await page.evaluate(()=>window.__fly.flight.pos.toArray());
      await page.waitForFunction(([x,y,z])=>window.__fly.flight.pos.distanceTo({x,y,z})>10,start);
      console.log('Desktop button switched the camera both ways');
      for (const id of airframes) {
        await page.evaluate(id=>window.__flyStore.getState().setAircraftId(id),id);
        await page.waitForFunction(id=>window.__fly.flight.aircraftVisual?.id===id,id);
        await seat(true);
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        if(out) await page.screenshot({path:path.join(out,id+'.png')});
        await page.keyboard.press('4'); await seat(false);
        await page.keyboard.press('4'); await seat(true);
        console.log(id+' cockpit → outside → cockpit');
      }
      await page.keyboard.press('p');
      await page.waitForFunction(()=>window.__flyStore.getState().cameraMode==='photo' && !window.__fly.input.pilotLook);
      await page.keyboard.press('p'); await seat(true);
      console.log('Photo mode returned to the cockpit');
    }
    assert.deepEqual([...new Set(errors)],[]);
    if (driverWarnings) console.log('Chrome glGetProgramiv driver warnings: '+driverWarnings);
  } finally { await context.close(); }
}

async function main() {
  const base = process.argv[2] || 'http://localhost:3000';
  const out = process.argv[3];
  if (out) fs.mkdirSync(out,{recursive:true});
  const browser = await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--ignore-gpu-blocklist']});
  try {
    await runFlight(browser,base,out,false);
    await runFlight(browser,base,out,true);
  } finally { await browser.close(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
