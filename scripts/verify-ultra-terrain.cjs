/* Production shader-link regression: Ultra must actually draw terrain with
 * physical sky, DEM relief, colour reference and all three shadow cascades.
 * The fixture and held governor make this correctness evidence, not FPS proof. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const {attachFixture,fixturePin}=require('./_fixture');
const out='.graphics-review/beta',port=Number(process.env.PORT||3094),base=`http://127.0.0.1:${port}`;
const cityPreview=process.argv.includes('--city-continuity');
const name=cityPreview?'ultra-terrain-city':'ultra-terrain';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 let server,browser,fixture,page;
 const report={at:new Date().toISOString(),venue:'Production fixture; governor held to exercise each requested profile',stages:[],errors:[],shaderErrors:[]};
 fs.mkdirSync(out,{recursive:true});
 try{
  if(!process.env.BETA_EXTERNAL_SERVER)server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port)],{env:{...process.env,FLY_BUILD_DIR:'.next-explorer',NEXT_TELEMETRY_DISABLED:'1'},stdio:'ignore',windowsHide:true});
  for(let i=0;i<120;i++){try{if((await fetch(base)).ok)break;}catch{}await delay(500);if(i===119)throw Error('Preview did not start');}
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||undefined,args:[...(process.platform==='win32'?['--use-angle=d3d11']:['--use-angle=swiftshader']),'--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  fixture=await attachFixture(context);
  await context.addInitScript(pin=>{
   window.__flyTileFixture=pin;window.__flyGovPin='hold';
   // Software CI otherwise refuses TERRAIN_SHADOW and silently omits the
   // sampler that breaks real desktop Ultra. Exercise the desktop policy.
   window.__flyLightDeviceClass='dgpu';
   localStorage.setItem('fly-quality-tier','ultra');localStorage.setItem('fly-visuals','enhanced');localStorage.setItem('fly-sound-on','0');
  },fixturePin(fixture.url));
  page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/WebGLProgram|shader error|too many.*texture|MAX_TEXTURE_IMAGE_UNITS/i.test(m.text()))report.shaderErrors.push(m.text());});
  const url=new URL('/',base);
  url.searchParams.set('graphicsReview','1');
  if(cityPreview)url.searchParams.set('flags','CITY_CONTINUITY,FLIGHT_RELIEF,FLIGHT_CLARITY,F35_COCKPIT');
  await page.goto(url.href,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__fly?.engine&&window.__flyComposer?.renderer,{},{timeout:90000,polling:1000});
  // Test both a saved-Ultra boot and returning to it after lower presets.
  for(const preset of ['ultra','high','medium','low','ultra']){
   await page.evaluate(value=>window.__flyStore.getState().setQualityPreset(value),preset);
   // Interval polling, not rAF: on software GL a heavy Ultra frame can starve
   // rAF for longer than the old 30 s while the profile is already resolved
   // (measured: the probe read the target profile at once, the rAF poll timed out).
   await page.waitForFunction(value=>window.__fly.cinemaProfile?.name===value,preset,{timeout:90000,polling:1000});
   await page.waitForFunction(()=>{
    const renderer=window.__flyComposer.renderer;let ready=0;
    window.__fly.engine.forEachTileMaterial(m=>{if(m.userData.__r25Ground&&renderer.properties.get(m).currentProgram)ready++;});
    return ready>0;
   },{},{timeout:90000,polling:1000});
   await delay(2000);
   const state=await page.evaluate(()=>{
    const r=window.__fly,renderer=window.__flyComposer.renderer,gl=renderer.getContext();
    const types=[gl.SAMPLER_2D,gl.SAMPLER_2D_ARRAY,gl.SAMPLER_3D,gl.SAMPLER_CUBE,gl.SAMPLER_2D_SHADOW,gl.SAMPLER_CUBE_SHADOW];
    const programs=new Set();r.engine.forEachTileMaterial(m=>{const p=renderer.properties.get(m).currentProgram;if(m.userData.__r25Ground&&p)programs.add(p);});
    const debug=gl.getExtension('WEBGL_debug_renderer_info');
    return {profile:r.cinemaProfile.name,cascades:r.cinemaShadows.cascades,physicalSky:!!r.physSky,limit:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),gpu:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
     terrain: [...programs].map(({ program }) => {
       const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
       const active = linked ? gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) : 0;
       const uniforms = Array.from({ length: active }, (_, i) => gl.getActiveUniform(program, i));
       const samplers = uniforms.filter(u => types.includes(u.type)).map(({ name, size }) => ({ name, size }));
       return { linked, log: gl.getProgramInfoLog(program), samplers,
         count: samplers.reduce((total, u) => total + u.size, 0),
         cityRelief: uniforms.some(u => u.name === 'uCityGrid'),
         dfgUniforms: uniforms.find(u => u.name === 'uEarthDfg[0]')?.size ?? 0 };
     }) };
   });
   report.stages.push(state);console.log(JSON.stringify(state));
   if(cityPreview)assert(await page.evaluate(()=>!!window.__fly.cityContinuity),'City relief must be active on this run');
   assert(state.physicalSky,'Physical atmosphere must be active');
   assert(state.terrain.length>0,'At least one real terrain program must be inspected');
   assert(state.terrain.every(p=>p.linked&&p.count<=Math.min(16,state.limit)),'Every active terrain program must link within the portable 16-texture limit, even when the test GPU exposes more');
   if(preset==='ultra'){
    assert.equal(state.cascades,3,'Ultra must retain all three cascades');
    const required = ['map','uEarthAppearance','uCoastReflection','uPskyView','uR25Relief','uR25Ref','uLodFadeMap','uNGMap','uTsMap'];
    assert(state.terrain.some(p => (!cityPreview || p.cityRelief) && p.dfgUniforms === 64 &&
      required.every(name => p.samplers.some(u => u.name === name)) &&
      p.samplers.some(u => u.name === 'directionalShadowMap[0]' && u.size === 3)),
      'The same Ultra shader must retain the imagery, water, lighting, shadows, and requested city relief');
   }
  }
  assert.equal(report.errors.length,0,'No uncaught page errors');
  assert.equal(report.shaderErrors.length,0,'No shader errors, including transient prewarm programs');
  await page.screenshot({path:out+'/'+name+'.png',timeout:60000});report.ok=true;
 }catch(e){report.ok=false;report.failure=e.stack;console.error(e.message);process.exitCode=1;}
 finally{await browser?.close();await fixture?.close();server?.kill();fs.writeFileSync(out+'/'+name+'.json',JSON.stringify(report,null,2));}
})();
