// Live Chrome review. FLY_PHONE=1 tests the phone layout; FLY_SKINS_ALL=1 visits every preset.
const {chromium}=require('playwright');
const fs=require('node:fs');
const {enterHangar}=require('./_title');
(async()=>{
  const {PRESET_LIVERIES}=await import('../lib/fly/aircraft-liveries.mjs');
  const phone=process.env.FLY_PHONE==='1',folder=`.graphics-review/liveries/${phone?'phone':'desktop'}`;
  fs.mkdirSync(folder,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist']});
  const page=await browser.newPage({viewport:phone?{width:390,height:844}:{width:1600,height:1000},deviceScaleFactor:1,isMobile:phone,hasTouch:phone});
  const report={status:'RUNNING',phone,errors:[],cases:[]};
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/shader|GL_INVALID|WebGLProgram/i.test(m.text()))report.errors.push(m.text());});
  await page.addInitScript(()=>{localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-aircraft','fighter');});
  try{
    await page.goto(process.env.FLY_URL||'http://localhost:3161/?graphicsReview=1',{timeout:240000});
    await enterHangar(page,'ops',{timeoutMs:180000,tap:phone});
    const ids=process.env.FLY_SKIN_IDS?.split(',')||(process.env.FLY_SKINS_ALL==='1'?Object.keys(PRESET_LIVERIES):['f35','airliner','c17','concorde']);
    for(const id of ids){
      await page.getByTestId(`hangar-pick-${id}`).click();
      await page.waitForFunction(()=>!document.querySelector('.ops-preview-loading'),undefined,{timeout:90000});
      if(!await page.getByTestId('aircraft-customization').count())await page.getByTestId('hangar-customize').click();
      const options=page.getByRole('radiogroup',{name:'Aircraft livery'});
      if(await options.getByRole('radio').count()<4)throw Error(`Missing presets for ${id}`);
      for(const skin of PRESET_LIVERIES[id]){
        await page.getByTestId(`skin-${skin.id}`).click();await page.waitForTimeout(700);
        if(await page.getByTestId(`skin-${skin.id}`).getAttribute('aria-checked')!=='true')throw Error(`Not selected: ${id}/${skin.id}`);
        const saved=await page.evaluate(id=>JSON.parse(localStorage.getItem('fly-adventures-v1')).progress.liveries[id],id);
        if(saved!==skin.id)throw Error(`Not saved: ${id}/${skin.id}`);
        const layout=await page.getByTestId('aircraft-customization').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,overflow:document.documentElement.scrollWidth>innerWidth+1,bottom:r.bottom<=innerHeight,top:r.top>=0};});
        if(layout.overflow||!layout.bottom||!layout.top)throw Error(`Offscreen panel ${id}: ${JSON.stringify(layout)}`);
        await page.screenshot({path:`${folder}/${id}-${skin.id}.png`});
        report.cases.push({id,skin:skin.id,saved,layout});
      }
      // Closing returns focus to Customize, and reopening keeps the selection.
      await page.getByRole('button',{name:'Done',exact:true}).click();
      await page.waitForTimeout(50);
      if(!await page.getByTestId('hangar-customize').evaluate(el=>el===document.activeElement))throw Error('Focus did not return to Customize');
      console.log(`PASS ${id}: three rendered, selected and saved presets`);
    }
    // Persistence across a real reload and fresh store hydration.
    const id=ids.at(-1),last=PRESET_LIVERIES[id].at(-1).id;
    await page.reload({timeout:180000});await enterHangar(page,'ops',{timeoutMs:180000,tap:phone});
    await page.getByTestId(`hangar-pick-${id}`).click();await page.getByTestId('hangar-customize').click();
    if(await page.getByTestId(`skin-${last}`).getAttribute('aria-checked')!=='true')throw Error('Reload lost skin');
    await page.keyboard.press('Home');
    if(await page.getByTestId('skin-standard').getAttribute('aria-checked')!=='true')throw Error('Keyboard Home did not select house colors');
    await page.keyboard.press('ArrowDown');
    if(await page.getByTestId(`skin-${PRESET_LIVERIES[id][0].id}`).getAttribute('aria-checked')!=='true')throw Error('Keyboard selection failed');
    await page.keyboard.press('Escape');
    if(await page.getByTestId('aircraft-customization').count())throw Error('Escape did not close Customize');
    if(!await page.getByTestId('hangar').count())throw Error('Escape closed the entire hangar');
    if(process.env.FLY_SKIN_FLIGHT==='1')for(const id of ['f35','airliner']){
      const skin=PRESET_LIVERIES[id][1];
      await page.getByTestId(`hangar-pick-${id}`).click();await page.getByTestId('hangar-customize').click();
      await page.getByTestId(`skin-${skin.id}`).click();await page.getByRole('button',{name:'Done',exact:true}).click();
      await page.getByRole('radio',{name:'Approach',exact:true}).check();
      await page.getByTestId('hangar-fly').click({timeout:120000});
      await page.waitForFunction(id=>window.__fly?.flight?.aircraftVisual?.id===id,id,{timeout:60000});
      await page.waitForFunction(()=>window.__flyBoot?.pct===100&&!window.__fly.worldLoading&&window.__fly.worldReadiness?.ready,undefined,{timeout:120000});
      await page.getByTestId('warp-hold').waitFor({state:'hidden',timeout:30000});await page.waitForTimeout(1000);
      const painted=await page.evaluate(()=>{const states=[];window.__fly.flight.playerRig.traverse(o=>{const s=o.userData.fleetPaint;if(s)states.push({skin:s.skinId,enabled:s.uniforms.uFleetPaintOn.value,texture:s.texture?.name,size:[s.texture?.image.width,s.texture?.image.height]});});return states;});
      if(painted.length!==1||painted[0].skin!==skin.id||painted[0].enabled!==1||painted[0].texture!==`livery-${skin.id}`)throw Error(`Flight paint mismatch ${id}: ${JSON.stringify(painted)}`);
      await page.screenshot({path:`${folder}/${id}-flight.png`});report.cases.push({id,flightPaint:painted[0]});
      await page.keyboard.press('Escape');await page.getByTestId('pause-hangar').click();
      await page.getByRole('button',{name:'End flight and open hangar',exact:true}).click();
      console.log(`PASS ${id}: selected paint reached the flying aircraft`);
    }
    if(report.errors.length)throw Error(report.errors.join('\n'));
    report.status='PASS';
  }catch(e){report.status='FAIL';report.error=String(e.stack||e);await page.screenshot({path:`${folder}/failure.png`}).catch(()=>{});throw e;}
  finally{fs.writeFileSync(`${folder}/report.json`,JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
