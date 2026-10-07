/* Production shader-link regression: Ultra must actually draw terrain with
 * physical sky, DEM relief, colour reference and all three shadow cascades.
 * The fixture and held governor make this correctness evidence, not FPS proof. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const {attachFixture,fixturePin}=require('./_fixture');
const out='.graphics-review/beta',port=Number(process.env.PORT||3094),base=`http://127.0.0.1:${port}`;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 let server,browser,fixture,page;
 const report={at:new Date().toISOString(),venue:'Production fixture; governor held to exercise each requested profile',stages:[],errors:[]};
 fs.mkdirSync(out,{recursive:true});
 try{
  if(!process.env.BETA_EXTERNAL_SERVER)server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port)],{env:{...process.env,FLY_BUILD_DIR:'.next-explorer',NEXT_TELEMETRY_DISABLED:'1'},stdio:'ignore',windowsHide:true});
  for(let i=0;i<120;i++){try{if((await fetch(base)).ok)break;}catch{}await delay(500);if(i===119)throw Error('Preview did not start');}
  browser=await chromium.launch({args:[...(process.platform==='win32'?['--use-angle=d3d11']:['--use-angle=swiftshader']),'--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  fixture=await attachFixture(context);
  await context.addInitScript(pin=>{
   window.__flyTileFixture=pin;window.__flyGovPin='hold';
   localStorage.setItem('fly-quality-tier','ultra');localStorage.setItem('fly-visuals','enhanced');localStorage.setItem('fly-sound-on','0');
  },fixturePin(fixture.url));
  page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(base+'/?graphicsReview=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__fly?.engine&&window.__flyComposer?.renderer,{},{timeout:90000});
  // Test both a saved-Ultra boot and returning to it after lower presets.
  for(const preset of ['ultra','high','low','ultra']){
   await page.evaluate(value=>window.__flyStore.getState().setQualityPreset(value),preset);
   await page.waitForFunction(value=>window.__fly.cinemaProfile?.name===value,preset,{timeout:30000});
   await page.waitForFunction(()=>{
    const renderer=window.__flyComposer.renderer;let ready=0;
    window.__fly.engine.forEachTileMaterial(m=>{if(m.userData.__r25Ground&&renderer.properties.get(m).currentProgram)ready++;});
    return ready>0;
   },{},{timeout:90000});
   await delay(2000);
   const state=await page.evaluate(()=>{
    const r=window.__fly,renderer=window.__flyComposer.renderer,gl=renderer.getContext();
    const types=[gl.SAMPLER_2D,gl.SAMPLER_2D_ARRAY,gl.SAMPLER_3D,gl.SAMPLER_CUBE,gl.SAMPLER_2D_SHADOW,gl.SAMPLER_CUBE_SHADOW];
    const programs=new Set();r.engine.forEachTileMaterial(m=>{const p=renderer.properties.get(m).currentProgram;if(m.userData.__r25Ground&&p)programs.add(p);});
    return {profile:r.cinemaProfile.name,cascades:r.cinemaShadows.cascades,physicalSky:!!r.physSky,limit:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
     terrain:[...programs].map(p=>{const linked=gl.getProgramParameter(p.program,gl.LINK_STATUS);const samplers=linked?Array.from({length:gl.getProgramParameter(p.program,gl.ACTIVE_UNIFORMS)},(_,i)=>gl.getActiveUniform(p.program,i)).filter(u=>types.includes(u.type)).map(u=>({name:u.name,size:u.size})):[];return {linked,log:gl.getProgramInfoLog(p.program),samplers,count:samplers.reduce((n,u)=>n+u.size,0)};})};
   });
   report.stages.push(state);console.log(JSON.stringify(state));
   assert(state.physicalSky,'Physical atmosphere must be active');
   assert(state.terrain.length>0,'At least one real terrain program must be inspected');
   assert(state.terrain.every(p=>p.linked&&p.count<=state.limit),'Every active terrain program must link within the GPU texture limit');
   if(preset==='ultra'){
    assert.equal(state.cascades,3,'Ultra must retain all three cascades');
    assert(state.terrain.some(p=>['uPskyView','uR25Relief','uR25Ref','uLodFadeMap','uNGMap'].every(name=>p.samplers.some(u=>u.name===name))&&p.samplers.some(u=>u.name==='directionalShadowMap[0]'&&u.size===3)),
     'A linked Ultra terrain program must retain physical sky, relief, colour reference, crossfade, night lighting and three shadow maps');
   }
  }
  assert.equal(report.errors.length,0,'No uncaught page errors');report.ok=true;
 }catch(e){report.ok=false;report.failure=e.stack;console.error(e.message);process.exitCode=1;}
 finally{await browser?.close();await fixture?.close();server?.kill();fs.writeFileSync(out+'/ultra-terrain.json',JSON.stringify(report,null,2));}
})();
