/* Matched cloud GPU timing and live rendering checks. Touch emulation uses
 * the host GPU: it is NOT evidence of physical-phone frame rate. */
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {enterFlight}=require('./_skip-menus');
const args=Object.fromEntries(process.argv.slice(2).map(v=>v.replace(/^--/,'').split('=')));
const out=path.resolve(args.output||'.graphics-review/graphics-repair/clouds');
fs.mkdirSync(out,{recursive:true});
const report={physicalPhone:false,errors:[],samples:[]};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const percentile=(a,p)=>[...a].sort((a,b)=>a-b)[Math.floor((a.length-1)*p)];
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
 try{
  for(const device of (args.devices||'desktop,phone').split(',')){
   const phone=device==='phone';
   const page=await browser.newPage({viewport:phone?{width:844,height:390}:{width:1440,height:900},deviceScaleFactor:phone?3:1,hasTouch:phone,isMobile:phone});
   page.on('pageerror',e=>report.errors.push({device,message:e.message}));
   page.on('console',m=>{if(/shader error|VALIDATE_STATUS false|GL_INVALID|INVALID_OPERATION/i.test(m.text()))report.errors.push({device,message:m.text().slice(0,1600)});});
   await page.addInitScript(()=>{
    localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');localStorage.setItem('fly-quality-tier','high');
    localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-crash-mode','forgiving');
    localStorage.setItem('fly-encounters','0');window.__flyGovPin='hold';
    window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,8,27,20);
   });
   await page.goto((args.url||'http://localhost:3097')+'/?graphicsReview=1',{waitUntil:'domcontentloaded',timeout:90000});
   // Stop simulation BEFORE entering flight. Freezing after boot lets each
   // build travel a different number of metres while the reveal settles.
   await page.waitForFunction(()=>window.__fly?.operations&&window.__flyStore,undefined,{timeout:120000});
   await page.evaluate(()=>{window.__fly.flight.step=()=>{};window.__fly.input.neutralize();});
   await enterFlight(page,{lat:36.09,lon:-112.1,altM:2700,headingRad:2,name:null},{waitReveal:true});
   await page.waitForFunction(()=>!window.__fly.worldLoading,undefined,{timeout:120000});
   await page.waitForTimeout(6000);
   await page.evaluate(()=>{
    const pass=window.__flyComposer.passes.find(p=>p.name==='ImmersiveClouds');
    if(!pass)throw Error('Cloud pass missing');window.__repairCloud=pass;
    const render=pass.render;
    pass.render=function(renderer,input,output){this.driftX=0;this.driftZ=0;this.uniforms.cinemaNoiseReady.value=1;this.mix=1;return render.call(this,renderer,input,output,0);};
   });
   // All tiers use the same geographic field and held pose; production switches
   // remain authoritative and every shader actually draws before measurement.
   for(const preset of (args.presets||'high,medium,low').split(',')){
    await page.evaluate(p=>window.__flyStore.getState().setQualityPreset(p),preset);await page.waitForTimeout(4500);
    const measurement=await page.evaluate(async()=>{
     const pass=window.__repairCloud,renderer=window.__flyComposer.getRenderer(),gl=renderer.getContext();
     const timer=gl.getExtension('EXT_disjoint_timer_query_webgl2'),debug=gl.getExtension('WEBGL_debug_renderer_info');
     const queries=[],milliseconds=[];let frame=0;const render=pass.render;
     pass.render=function(...params){
      const sample=timer&&frame++%3===0&&!gl.getQuery(timer.TIME_ELAPSED_EXT,gl.CURRENT_QUERY);
      const query=sample?gl.createQuery():null;if(query)gl.beginQuery(timer.TIME_ELAPSED_EXT,query);
      try{return render.apply(this,params);}finally{if(query){gl.endQuery(timer.TIME_ELAPSED_EXT);queries.push(query);}}
     };
     await new Promise(resolve=>{
      const start=performance.now();function tick(){
       const disjoint=timer&&gl.getParameter(timer.GPU_DISJOINT_EXT);
       for(let i=queries.length-1;i>=0;i--)if(gl.getQueryParameter(queries[i],gl.QUERY_RESULT_AVAILABLE)){
        const query=queries.splice(i,1)[0];if(!disjoint)milliseconds.push(gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6);gl.deleteQuery(query);
       }
       if(milliseconds.length<60&&performance.now()-start<8000)requestAnimationFrame(tick);else resolve();
      }requestAnimationFrame(tick);
     });
     pass.render=render;for(const query of queries)gl.deleteQuery(query);
     const rt=window.__fly,cam=rt.camera;
     return {gpu:debug&&gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),milliseconds,profile:rt.cinemaProfile,clouds:{...rt.immersiveClouds},
      camera:{position:cam.position.toArray(),quaternion:cam.quaternion.toArray()},resolution:[gl.drawingBufferWidth,gl.drawingBufferHeight],
      buffers:[window.__flyComposer.inputBuffer.width,window.__flyComposer.inputBuffer.height],
      base:pass.uniforms.base.value,thickness:pass.uniforms.thickness.value,mipmaps:pass.cinemaNoise.generateMipmaps,
      buildings:rt.satBuildings?.stats,skyline:rt.satSkyline?.stats,terrain:rt.terraStats,glError:gl.getError()};
    });
    const {milliseconds,...rest}=measurement;
    const row={device,preset,...rest,gpuSamples:milliseconds.length,cloudGpuMedianMs:percentile(milliseconds,.5),cloudGpuP95Ms:percentile(milliseconds,.95)};
    report.samples.push(row);save();
    assert.deepEqual(row.resolution,row.buffers,'drawing buffers disagree');assert.equal(row.glError,0);
    assert.ok(row.clouds.volumeReady,'density volume did not load');assert.ok(row.clouds.width>1&&row.clouds.height>1);
    assert.ok(row.gpuSamples>=30,'GPU timing not calibrated');
    await page.screenshot({path:path.join(out,`${device}-${preset}.png`),timeout:20000});
    console.log(JSON.stringify({device,preset,cloudGpuMedianMs:row.cloudGpuMedianMs,profile:row.profile.name}));
   }
   await page.close();
  }
  assert.equal(report.errors.length,0,'runtime/shader errors');report.status='PASS';
 }catch(error){report.status='FAIL';report.reason=error.stack;process.exitCode=1;console.error(error);}
 finally{save();await browser.close();}
})();
