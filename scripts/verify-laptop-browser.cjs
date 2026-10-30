/* Real production UI and input; emulated viewports/SwiftShader, not laptop FPS. */
const { chromium } = require('playwright');
const { mkdirSync, writeFileSync } = require('node:fs');
const { attachFixture, fixturePin } = require('./_fixture');
const base = process.env.LAPTOP_URL || 'http://localhost:3095';
const out = '.graphics-review/laptop';
mkdirSync(out, { recursive: true });
const report = { venue: 'Chromium, software WebGL, offline scenery, emulated viewports; no hardware-performance claim', rows: [], errors: [] };
const save = () => writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
function check(name, pass, detail) {
  report.rows.push({ name, pass: !!pass, detail }); save();
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : ' ' + JSON.stringify(detail)}`);
}
async function reachable(locator) {
  return locator.evaluate(e => {
    const b = e.getBoundingClientRect();
    const hit = document.elementFromPoint(b.x+b.width/2, b.y+b.height/2);
    return { ok: b.x>=0 && b.y>=0 && b.right<=innerWidth && b.bottom<=innerHeight && e.contains(hit), rect: {x:b.x,y:b.y,w:b.width,h:b.height} };
  });
}
async function focusLoop(page, dialog, label) {
  const result = await dialog.evaluate(e => {
    const list = [...e.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(n => n.tabIndex>=0 && !n.disabled && n.getClientRects().length && getComputedStyle(n).visibility!=='hidden');
    list[0].focus();
    return list.length;
  });
  await page.keyboard.press('Shift+Tab');
  check(`${label}: Shift+Tab stays in the menu`, await dialog.evaluate(e => e.contains(document.activeElement)));
  await page.keyboard.press('Tab');
  check(`${label}: Tab wraps to the first action`, await dialog.evaluate(e => e.querySelector('button')===document.activeElement), result);
}
async function worldFrames(page, mode) {
  // Layout/focus checks do not need repeated world rendering in SwiftShader.
  // Restore the real frame loop before exercising flight controls.
  return page.evaluate(mode => {
    let scene = window.__fly?.engine?.map;
    while (scene?.parent) scene = scene.parent;
    const root = scene?.__r3f?.root;
    const state = root?.getState();
    if (!state) throw Error('World frame-loop handle unavailable');
    window.__laptopPauseWorld = mode === 'never';
    if(!window.__laptopFrameUnsubscribe)window.__laptopFrameUnsubscribe=root.subscribe(s=>{
      if(window.__laptopPauseWorld&&s.frameloop!=='never')s.setFrameloop('never');
    });
    state.setFrameloop(mode);
    return true;
  }, mode);
}
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let fixture;
  try {
    const context = await browser.newContext({ viewport: {width:1366,height:650}, reducedMotion:'reduce' });
    fixture = await attachFixture(context);
    await context.addInitScript(pin => {
      window.__flyTileFixture = pin;
      localStorage.setItem('fly-quality-tier','low');
      localStorage.setItem('fly-sound-on','0');
      localStorage.setItem('fly-crash-mode','forgiving');
      if(!localStorage.getItem('fly-explorer-preferences-v1'))localStorage.setItem('fly-explorer-preferences-v1',JSON.stringify({version:1,settings:{tutorial:'skipped'}}));
    }, fixturePin(fixture.url));
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.on('pageerror', e => { report.errors.push(e.stack); save(); console.error('PAGE ERROR '+e.stack); });
    await page.goto(base+'/?graphicsReview=1',{waitUntil:'domcontentloaded'});
    await page.getByTestId('title-screen').waitFor({timeout:90000});
    await page.waitForFunction(()=>window.__fly?.engine?.map,undefined,{timeout:90000});
    await worldFrames(page,'never');
    for (const size of [{width:1280,height:600},{width:1024,height:600},{width:900,height:540}]) {
      const label = `${size.width}x${size.height}`;
      await page.setViewportSize(size);
      await worldFrames(page,'never');
      const actions=await page.evaluate(()=>['title-explore','title-takeoff-landing','title-settings','title-logbook'].map(id=>{
        const e=document.querySelector(`[data-testid="${id}"]`),b=e.getBoundingClientRect();
        return {id,ok:b.x>=0&&b.y>=0&&b.right<=innerWidth&&b.bottom<=innerHeight&&e.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)),rect:{x:b.x,y:b.y,w:b.width,h:b.height}};
      }));
      for(const r of actions)check(`${label}: ${r.id} reachable`,r.ok,r.rect);
      if(size.width===900)await page.screenshot({path:`${out}/title-900.png`,timeout:20000});
      await page.getByTestId('title-settings').click();
      const dialog = page.getByTestId('settings-sheet');
      await focusLoop(page,dialog,`${label} settings`);
      const steering = page.getByLabel('Steering input',{exact:true});
      await steering.selectOption('keyboard');
      check(`${label}: keyboard steering saved`,await page.evaluate(()=>JSON.parse(localStorage.getItem('fly-explorer-preferences-v1')).settings.steeringInput==='keyboard'));
      await steering.focus(); await page.keyboard.press('l');
      check(`${label}: select keys do not open a game overlay`,await page.evaluate(()=>!window.__flyStore?.getState().logbookOpen));
      if(size.width===1280)await page.screenshot({path:`${out}/settings-1280.png`,timeout:20000});
      const body = dialog.locator('.lg-drawer-body');
      const box = await body.boundingBox();
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,2400);
      await page.waitForFunction(()=>document.querySelector('.lg-drawer-body').scrollTop>0);
      const last = dialog.getByRole('button').last();await last.scrollIntoViewIfNeeded();
      const end = await reachable(last);check(`${label}: bottom settings reachable by scroll`,end.ok,end.rect);
      const close = await reachable(page.getByTestId('settings-close'));check(`${label}: Close stays reachable while scrolling`,close.ok,close.rect);
      await page.getByTestId('settings-close').click();
      check(`${label}: focus returns to Settings`,await page.getByTestId('title-settings').evaluate(e=>e===document.activeElement));
    }
    await page.setViewportSize({width:1280,height:600});
    await page.getByTestId('title-explore').click();await page.getByTestId('hangar').waitFor();
    await worldFrames(page,'never');
    await page.screenshot({path:`${out}/hangar-1280.png`,timeout:20000});
    const railGap=await page.evaluate(()=>{
      const p=document.querySelector('.ops-dispatch').getBoundingClientRect(),f=document.querySelector('.ops-fleet').getBoundingClientRect();
      return {bottom:p.bottom,railTop:f.top,gap:f.top-p.bottom};
    });
    check('laptop departure panel stays clear of the aircraft rail',railGap.gap>=8,railGap);
    const launch = page.getByTestId('hangar-fly');
    await launch.waitFor();
    await page.waitForFunction(()=>!document.querySelector('[data-testid="hangar-fly"]').disabled,{},{timeout:90000});
    await launch.click();
    await worldFrames(page,'always');
    await page.waitForFunction(()=>window.__flyStore?.getState().screen==='flight'&&window.__flyBoot?.pct===100&&window.__fly?.worldLoading!==true,{},{timeout:150000});
    const input = () => page.evaluate(()=>{const c=window.__fly.input.read();return {turn:c.turn,pitch:c.pitch,look:c.freeLook.active};});
    await page.mouse.move(1050,260);check('moving a trackpad cannot steer in keyboard mode',(await input()).turn===0);
    await page.keyboard.down('ArrowRight');check('arrow key steers without a mouse',(await input()).turn===1);
    await page.keyboard.up('ArrowRight');check('releasing the arrow returns to neutral',(await input()).turn===0);
    await page.mouse.move(680,270);await page.mouse.down();await page.mouse.move(740,300,{steps:4});
    check('plain trackpad drag looks around',(await input()).look===true);
    await page.mouse.up();check('release ends trackpad look',(await input()).look===false);
    await page.keyboard.press('Escape');
    await worldFrames(page,'never');
    for(const size of [{width:1280,height:600},{width:1024,height:600}]){
      await page.setViewportSize(size);
      const dialog=page.getByRole('dialog',{name:'Paused',exact:true});await dialog.waitFor();
      await focusLoop(page,dialog,`${size.width} pause`);
      const bottom=dialog.getByRole('button',{name:'Nearby invitations: On',exact:true});
      if(await bottom.count())await bottom.scrollIntoViewIfNeeded();
      const resume=dialog.getByRole('button',{name:'Resume',exact:true});
      const r=await reachable(resume);check(`${size.width}: Resume remains on screen while the menu scrolls`,r.ok,r.rect);
      if(size.width===1024)await page.screenshot({path:`${out}/pause-1024.png`,timeout:20000});
    }
    await page.getByRole('button',{name:'Resume',exact:true}).click();
    await page.reload({waitUntil:'domcontentloaded'});await page.getByTestId('title-screen').waitFor({timeout:90000});
    await page.waitForFunction(()=>window.__fly?.engine?.map,undefined,{timeout:90000});
    await worldFrames(page,'never');
    await page.getByTestId('title-settings').click();
    check('keyboard preference survives reload',await page.getByLabel('Steering input',{exact:true}).inputValue()==='keyboard');
    await context.close();
    for(const size of [{width:390,height:844},{width:844,height:390}]){
      const phone=await browser.newContext({viewport:size,hasTouch:true,isMobile:true,reducedMotion:'reduce'});
      await attachFixture(phone);
      await phone.addInitScript(pin=>{window.__flyTileFixture=pin;localStorage.setItem('fly-quality-tier','low');},fixturePin(fixture.url));
      const p=await phone.newPage();p.setDefaultTimeout(30000);p.on('pageerror',e=>report.errors.push(e.stack));
      await p.goto(base+'/?graphicsReview=1',{waitUntil:'domcontentloaded'});await p.getByTestId('title-screen').waitFor({timeout:90000});
      await p.waitForFunction(()=>window.__fly?.engine?.map,undefined,{timeout:90000});
      await worldFrames(p,'never');
      await p.getByTestId('title-settings').click();
      check(`${size.width} phone: touch retains its own controls`,await p.getByLabel('Steering input',{exact:true}).count()===0);
      const r=await reachable(p.getByTestId('settings-close'));check(`${size.width} phone: Close remains reachable`,r.ok,r.rect);
      if(size.width===390)await p.screenshot({path:`${out}/phone-390.png`,timeout:20000});
      await phone.close();
    }
  } catch(e) {check('browser flow completed',false,e.stack);}
  finally {await browser.close();await fixture?.close();check('no uncaught browser errors',report.errors.length===0,report.errors);save();if(report.rows.some(r=>!r.pass))process.exitCode=1;}
})();
