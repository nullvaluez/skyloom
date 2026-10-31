const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const {enterHangar}=require('./_title');
const out='.graphics-review/commercial-liberty';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist']});
 const defaults=process.env.FLY_SHIPPED_DEFAULTS==='1';
 const report={errors:[],runs:[],shippedDefaults:defaults,pins:{governor:'hold',quality:'high',sun:'2026-07-18T17:00:00Z'}};
 try{
  for(const phone of [false,true]){
   const page=await browser.newPage({viewport:phone?{width:390,height:844}:{width:1600,height:1000},isMobile:phone,hasTouch:phone});
   page.on('pageerror',e=>report.errors.push(e.message));
   page.on('console',m=>{if(m.type()==='error'&&/shader|GL_INVALID|WebGLProgram/.test(m.text()))report.errors.push(m.text());});
   await page.addInitScript(()=>{localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-quality-tier','high');window.__flyGovPin='hold';window.__flySunOverride=Date.UTC(2026,6,18,17);});
   const url=(process.env.FLY_URL||'http://localhost:3161')+'/?graphicsReview=1'+(defaults?'':'&flags=COMMERCIAL_PAINT,LIBERTY_DETAIL,OPERATOR_LIVERIES');
   await page.goto(url);await enterHangar(page,'ops',{timeoutMs:180000,tap:phone});
   await page.getByTestId('hangar-pick-airliner').click();await page.getByTestId('hangar-customize').click();
   await page.getByRole('searchbox',{name:'Find a livery'}).fill('does-not-exist');
   await page.getByText('No matching finishes. Try another airline.').waitFor();
   await page.getByRole('searchbox',{name:'Find a livery'}).fill('United');
   await page.getByTestId('skin-commercial-united').click();
   assert.equal(await page.getByTestId('skin-commercial-united').getAttribute('aria-checked'),'true');
   await page.getByRole('searchbox',{name:'Find a livery'}).fill('');
   await page.getByTestId('skin-commercial-united').scrollIntoViewIfNeeded();
   const layout=await page.locator('.skin-choices').evaluate(el=>{
    const rect=el.getBoundingClientRect(),rows=[...el.querySelectorAll('button')];
    return {scrolls:el.scrollHeight>el.clientHeight,overlap:rows.some(b=>{const r=b.getBoundingClientRect(),copy=b.querySelector('.skin-copy').getBoundingClientRect();return copy.bottom>r.bottom+1;}),minHeight:Math.min(...rows.map(b=>b.getBoundingClientRect().height)),panel:document.querySelector('.aircraft-customization').getBoundingClientRect().toJSON(),scroll:rect.toJSON()};
   });
   assert.equal(layout.overlap,false,'livery copy must stay inside its row');assert.ok(layout.minHeight>=44);assert.ok(layout.scrolls);
   if(phone)assert.ok(layout.panel.y>300,'phone preview stays visible');
   await page.screenshot({path:`${out}/hangar-${phone?'phone':'desktop'}.png`});
   await page.getByRole('button',{name:'Done',exact:true}).click();
   await page.reload();await enterHangar(page,'ops',{timeoutMs:180000,tap:phone});
   await page.getByTestId('hangar-pick-airliner').click();await page.getByTestId('hangar-customize').click();
   assert.equal(await page.getByTestId('skin-commercial-united').getAttribute('aria-checked'),'true');
   await page.getByTestId('skin-commercial-united').focus();await page.keyboard.press('End');
   assert.equal(await page.getByTestId('skin-sunward').getAttribute('aria-checked'),'true');
   await page.keyboard.press('Home');assert.equal(await page.getByTestId('skin-standard').getAttribute('aria-checked'),'true');
   await page.getByRole('searchbox',{name:'Find a livery'}).fill('United');await page.getByTestId('skin-commercial-united').click();
   await page.getByRole('button',{name:'Done',exact:true}).click();
   console.log(`PASS ${phone?'phone':'desktop'} livery picker, persistence and keyboard`);
   if(!phone){
    await page.getByRole('radio',{name:'Approach',exact:true}).check();await page.getByTestId('hangar-fly').click();
    await page.waitForFunction(()=>window.__fly?.flight?.aircraftVisual?.id==='airliner'&&window.__flyBoot?.pct===100,undefined,{timeout:120000});
    const painted=await page.evaluate(()=>{const states=[];window.__fly.flight.playerRig.traverse(o=>{if(o.userData.fleetPaint)states.push(o.userData.fleetPaint.skinId)});return states;});
    assert.deepEqual(painted,['commercial-united']);
    await page.evaluate(()=>{
      const r=window.__fly,f=r.flight;window.__flyStore.getState().setQualityTier('high');r.warpToGeo(40.6892,-74.0445,{offsetM:500,offsetBearingRad:Math.PI,altM:130});r.autopilot.disengage();
      const pos=f.pos.clone(),step=f.step.bind(f);f.step=(dt,cmd)=>{step(dt,{...cmd,speedOverride:0,turn:0,pitch:0,boost:false});f.pos.copy(pos);f.speed=0;f.heading=0;f.pitch=0;f.bank=0;};
    });
    try{await page.waitForFunction(()=>window.__flyMonuments?.placed?.some(p=>p.name==='Statue of Liberty'&&p.detail!=='far'),undefined,{timeout:90000});}
    catch(e){report.libertyFailure=await page.evaluate(()=>({tier:window.__flyStore.getState().qualityTier,monuments:window.__flyMonuments,stats:window.__flyStats?.monuments,urlFlags:window.__flyUrlFlags}));throw e;}
    const statue=await page.evaluate(()=>window.__flyMonuments.placed.find(p=>p.name==='Statue of Liberty'));
    assert.ok(Math.abs(statue.topY-statue.groundY-93*1.35*1.4)<.01);
    await page.getByTestId('warp-hold').waitFor({state:'hidden',timeout:60000});
    await page.screenshot({path:`${out}/liberty-world.png`});report.runs.push({phone,layout,painted,statue});
   }else report.runs.push({phone,layout});
   await page.close();console.log(`PASS ${phone?'phone':'desktop'} search, row bounds, saved selection, keyboard${phone?'':', flight paint and world Liberty'}`);
  }
  assert.equal(report.errors.length,0);report.status='PASS';
 }catch(e){report.status='FAIL';report.failure=String(e.stack||e);throw e;}
 finally{fs.writeFileSync(`${out}/browser-report.json`,JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
