/* Production integration/appearance checks. Mobile layout uses the desktop GPU. */
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {enterFlight}=require('./_skip-menus');
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const out=path.resolve(args.output||'.graphics-review/render-flight/review');fs.mkdirSync(out,{recursive:true});
const report={physicalPhone:false,checks:[],errors:[],views:[]};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const check=(name,ok,data)=>{report.checks.push({name,pass:!!ok,data});save();assert.ok(ok,name);console.log('PASS '+name);};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
 try{
  for(const device of (args.devices||'desktop,phone,tablet').split(',')){
   const mobile=device!=='desktop',phone=device==='phone';let phase='boot';
   const page=await browser.newPage({viewport:phone?{width:390,height:844}:mobile?{width:1024,height:768}:{width:1440,height:900},hasTouch:mobile,isMobile:mobile,deviceScaleFactor:phone?3:mobile?2:1});
   page.on('pageerror',e=>report.errors.push({device,phase,message:e.message}));
   page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|GL_INVALID/.test(m.text()))report.errors.push({device,phase,message:m.text().slice(0,1400)});});
   await page.addInitScript(()=>{
    localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');
    localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-crash-mode','forgiving');
    window.__flySunOverride=Date.UTC(2026,8,27,17);window.__flyWeatherOverride='baseline';
   });
   await page.goto((args.url||'http://localhost:3086')+'/?graphicsReview=1',{waitUntil:'domcontentloaded'});
   await enterFlight(page,{lat:40.72,lon:-74.02,altM:900,headingRad:.3,name:null},{timeoutMs:180000,waitReveal:true});
   await page.evaluate(()=>{
    window.__renderSavedStep=window.__fly.flight.step;window.__fly.flight.step=function(){};
    window.__renderShaderErrors=[];
    window.__flyComposer.getRenderer().debug.onShaderError=(gl,program,vertex,fragment)=>{
     window.__renderShaderErrors.push({message:gl.getProgramInfoLog(program),fragment:gl.getShaderSource(fragment)});
     console.error('WebGL program failed: '+gl.getProgramInfoLog(program));
    };
   });
   await page.waitForTimeout(12000);
   const snapshot=()=>page.evaluate(()=>{
    const rt=window.__fly,composer=window.__flyComposer,gl=composer.getRenderer();let scene=rt.engine.map;while(scene.parent)scene=scene.parent;
    const shadows=[],domes=[];scene.traverse(o=>{if(o.name==='cinema-cascade')shadows.push({format:o.shadow.map?.texture.format,depth:!!o.shadow.map?.depthTexture,size:o.shadow.map?.width});if(o.geometry?.parameters?.radius===450000)domes.push(o.visible);});
    return {preset:window.__flyStore.getState().qualityPreset,tier:window.__flyStore.getState().qualityTier,profile:rt.cinemaProfile,
      governor:window.__flyGov.state(),clouds:rt.immersiveClouds,shadows,domes,programs:gl.info.programs.length,
      canvas:[gl.domElement.width,gl.domElement.height],composer:[composer.inputBuffer.width,composer.inputBuffer.height],contextLost:gl.getContext().isContextLost(),
      ibl:rt.cinemaIBL,environment:rt.cinemaEnvironment,resources:rt.cinemaResources};
   });
   let state=await snapshot();
   check(`${device}: High scenery boots with independent effects`,state.preset==='high'&&state.profile&&(mobile?state.profile.cascades<=1:state.profile.cascades===2),state);
   check(`${device}: no drawing-buffer/composer mismatch`,JSON.stringify(state.canvas)===JSON.stringify(state.composer));
   check(`${device}: shadow depth retained with R8 color attachments`,state.shadows.length>0&&state.shadows.every(s=>s.depth&&s.format===1028),state.shadows);
   check(`${device}: discarded sky draw is hidden`,state.domes.length===1&&state.domes[0]===false);
   // Explicit quality choices, profile changes, and returning from Neon must
   // restore the renderer without orphaned uniforms or stale dimensions.
   for(const preset of ['medium','low','high',...(mobile?[]:['ultra','high'])]){
    phase=preset;
    await page.evaluate(p=>window.__flyStore.getState().setQualityPreset(p),preset);await page.waitForTimeout(1800);state=await snapshot();
    check(`${device}: ${preset} buffers agree and context remains live`,JSON.stringify(state.canvas)===JSON.stringify(state.composer)&&!state.contextLost);
   }
   if(mobile){
    phase='adaptive-effects';
    for(let i=0;i<3;i++){await page.evaluate(()=>window.__flyGov.force(-1));await page.waitForTimeout(800);}
    state=await snapshot();
    check(`${device}: atmospheric fallback retains shadows and material detail`,state.profile.name==='phone-lean'&&state.profile.materialSize===256&&state.shadows.length===1&&state.shadows[0].size===512&&state.shadows[0].depth,state);
   }
   for(const visuals of ['classic','enhanced','classic','enhanced']){
    phase=visuals;
    await page.evaluate(v=>window.__flyStore.getState().setVisuals(v),visuals);await page.waitForTimeout(2400);state=await snapshot();
    check(`${device}: ${visuals} restores sky ownership`,state.domes[0]===(visuals==='classic')&&!state.contextLost);
   }
   phase='toy';await page.evaluate(()=>window.__flyStore.getState().setMapStyle('toy'));await page.waitForTimeout(3500);
   check(`${device}: Neon releases cinematic sky`,await page.evaluate(()=>!window.__fly.cinemaEnvironment&&!window.__fly.immersiveClouds));
   phase='satellite';await page.evaluate(()=>window.__flyStore.getState().setMapStyle('satellite'));await page.waitForTimeout(6000);
   for(const [condition,hour]of [['day',17],['golden',22],['night',5]]){
    phase=condition;
    await page.evaluate(hour=>{window.__flySunOverride=Date.UTC(2026,8,27,hour);window.__flyStore.getState().bumpWarpEpoch();},hour);
    await page.waitForTimeout(6000);state=await snapshot();
    check(`${device}: ${condition} atmosphere is finite`,!!state.environment&&[...state.environment.horizon,...state.environment.keyDir,state.environment.extinction].every(Number.isFinite));
    const file=`${device}-${condition}.png`;await page.screenshot({path:path.join(out,file),timeout:20000});report.views.push({device,condition,file,state});save();
   }
   const shaderErrors=await page.evaluate(()=>window.__renderShaderErrors);
   for(const [i,error]of shaderErrors.entries())fs.writeFileSync(path.join(out,`${device}-shader-${i}.glsl`),error.message+'\n'+error.fragment);
   check(`${device}: no shader/runtime errors`,!report.errors.some(e=>e.device===device),report.errors);
   await page.close();
  }
  report.status='PASS';
 }catch(error){report.status='FAIL';report.reason=String(error.stack);console.error(error);process.exitCode=1;}
 finally{save();await browser.close();console.log(report.status);}
})();
