/* Artistic sample, not a frame benchmark. Stills hold the camera while real
 * geographic layers settle. Clips restore ordinary flight; no world fixture. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {enterFlight}=require('./_skip-menus');
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const url=args.url||'http://localhost:3076',look=args.look||'cinematic',siteKey=args.site||'manhattan';
const sites={manhattan:{lat:40.72,lon:-74.02,altM:900,headingRad:.3,day:17,golden:22,night:5},alps:{lat:46.58,lon:7.94,altM:3500,headingRad:2.3,day:12,golden:17,night:23},canyon:{lat:36.09,lon:-112.1,altM:2700,headingRad:2,day:20,golden:1,night:8}};
const site=sites[siteKey],phone=args.phone==='1',out=args.output||`.graphics-review/cinema-overhaul/sample/${look}-${siteKey}${phone?'-phone':''}`;
async function main(){
 fs.mkdirSync(out,{recursive:true});
 const report={...require('./graphics-source.cjs')(),look,site:siteKey,stills:'Fixed pose; flight.step held only for settling and still captures.',clips:'Canvas-only WebM; ordinary flight restored. HUD is visible in stills.',errors:[],assetRequests:[],cases:[],status:'IN_PROGRESS',physicalPhone:false};let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--enable-webgl-developer-extensions']});
  const page=await browser.newPage({viewport:phone?{width:390,height:844}:{width:1920,height:1080},deviceScaleFactor:phone?2:1,isMobile:phone,hasTouch:phone});
  page.on('request',r=>{if(r.url().includes('/materials/cinema-v1/'))report.assetRequests.push(new URL(r.url()).pathname);});
  let stage='boot';
  await page.addInitScript(()=>{
   const original=WebGL2RenderingContext.prototype.getProgramInfoLog;
   WebGL2RenderingContext.prototype.getProgramInfoLog=function(program){
    const log=original.call(this,program);
    if(log&&/X3595|error/i.test(log)){
     const shaders=this.getAttachedShaders(program).map(s=>({type:this.getShaderParameter(s,this.SHADER_TYPE),source:this.getShaderSource(s)}));
     (window.__sampleShaderLogs??=[]).push({log,shaders});
    }return log;
   };
  });
  if(args.gl==='1')await page.addInitScript(()=>{
   const proto=WebGL2RenderingContext.prototype,ids=new WeakMap();let serial=0;
   const identity=texture=>{if(!texture)return null;if(!ids.has(texture))ids.set(texture,++serial);return ids.get(texture);};
   for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){
    const draw=proto[name];proto[name]=function(...args){
     draw.apply(this,args);if(!window.__sampleDrawAudit||this.isContextLost())return;
     const error=this.getError();if(!error)return;window.__sampleDrawAudit=false;
     const program=this.getParameter(this.CURRENT_PROGRAM),active=this.getParameter(this.ACTIVE_TEXTURE),samplers=[];if(!program)return;
     const types=[this.SAMPLER_2D,this.SAMPLER_3D,this.SAMPLER_CUBE,this.SAMPLER_2D_SHADOW,this.SAMPLER_2D_ARRAY,this.SAMPLER_2D_ARRAY_SHADOW];
     for(let i=0;i<this.getProgramParameter(program,this.ACTIVE_UNIFORMS);i++){
      const u=this.getActiveUniform(program,i);if(!types.includes(u.type))continue;
      const units=this.getUniform(program,this.getUniformLocation(program,u.name)),bindings=[];
      for(const unit of typeof units==='number'?[units]:units){
       this.activeTexture(this.TEXTURE0+unit);const textures={};
       for(const [target,binding]of [[this.TEXTURE_2D,this.TEXTURE_BINDING_2D],[this.TEXTURE_3D,this.TEXTURE_BINDING_3D],[this.TEXTURE_CUBE_MAP,this.TEXTURE_BINDING_CUBE_MAP],[this.TEXTURE_2D_ARRAY,this.TEXTURE_BINDING_2D_ARRAY]]){
        const texture=this.getParameter(binding);if(texture)textures[target]={id:identity(texture),compare:this.getTexParameter(target,this.TEXTURE_COMPARE_MODE)};
       }bindings.push({unit,textures});
      }samplers.push({...u,name:u.name,type:u.type,size:u.size,bindings});
     }this.activeTexture(active);
     (window.__sampleBadDraws??=[]).push({error,name,samplers,shaders:this.getAttachedShaders(program).map(s=>this.getShaderSource(s))});
    };
   }
  });
  if(args.gl==='2')await page.addInitScript(require('./cinema-sampler-audit.cjs'));
  page.on('pageerror',e=>{if(report.errors.length<12)report.errors.push({stage,message:e.message,stack:e.stack});});page.on('console',m=>{
   if(!['error','warning'].includes(m.type())||!/shader|WebGLProgram|GL_INVALID|INVALID_OPERATION/.test(m.text()))return;
   const entry={stage,message:m.text().slice(0,3000)};
   // ANGLE's constant-folding precision notice is informational; retain it.
   // Invalid operations, compile failures and divergent derivatives still fail.
   if(m.type()==='warning'&&/Program Info Log/.test(m.text())&&m.text().split('\n').every(line=>!line.trim()||/warning X4122:/.test(line))){(report.warnings??=[]).push(entry);return;}
   if(report.errors.length<12)report.errors.push(entry);
  });
  await page.addInitScript(({site,phone})=>{
   try{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');localStorage.setItem('fly-quality-tier',phone?'medium':'ultra');
   localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-crash-mode','forgiving');}catch{/* Defaults must also boot. */}
   window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,8,27,site.day);
  },{site,phone});
  if(args.storage==='blocked')await page.addInitScript(()=>{Storage.prototype.getItem=Storage.prototype.setItem=()=>{throw new DOMException('Review: blocked storage','SecurityError');};});
  if(args.format==='rgba')await page.addInitScript(()=>{const get=WebGL2RenderingContext.prototype.getExtension;WebGL2RenderingContext.prototype.getExtension=function(name){return /compressed_texture_s3tc/.test(name)?null:get.call(this,name);};});
  if(args.audit==='1')await page.addInitScript(require('./ground-texture-audit.cjs').installGroundTextureAudit);
  await page.goto(`${url}/?graphicsReview=1&earthLook=${look}`,{waitUntil:'domcontentloaded',timeout:90000});
  if(args['build-id'])report.servedBuild=await require('./ground-build-receipt.cjs')(page,url,args['build-id']);
  await enterFlight(page,{...site,name:null},{timeoutMs:180000,waitReveal:true});
  const help=page.getByRole('button',{name:/Got it.*fly/});if(await help.isVisible())await help.click();
  report.hardware=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),samplers:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),resolution:[gl.drawingBufferWidth,gl.drawingBufferHeight]};});
  await page.addStyleTag({content:'.cinema-review-dock{display:none!important}'});
  const snapshot=()=>page.evaluate(()=>{
   const r=window.__fly,f=r.flight,gl=document.querySelector('canvas').getContext('webgl2');
   return {solarDate:new Date(window.__flySunOverride).toISOString(),sun:r.sun,weather:r.weather?.wx,position:{...f.pos},origin:{...r.origin.anchor},terrain:r.terraStats,buildings:r.satBuildings?.stats,
    profile:r.cinemaProfile,environment:r.cinemaEnvironment,shadows:r.cinemaShadows,ibl:r.cinemaIBL,resources:r.cinemaResources,contextResources:r.cinemaContextResources,assets:r.earthSurface?.materials,
    clouds:r.immersiveClouds,governor:window.__flyGov?.state(),resolution:[gl.drawingBufferWidth,gl.drawingBufferHeight],fx:window.__flyStats?.fx,draws:window.__graphicsReview?.drawCalls,triangles:window.__graphicsReview?.triangles,
    audit:window.__groundTextureAudit?.snapshot({topLimit:10}),hud:(()=>{const a=document.querySelector('[data-testid="flight-stats-strip"]')?.getBoundingClientRect();return a?{inBounds:a.x>=0&&a.y>=0&&a.right<=innerWidth&&a.bottom<=innerHeight}:null;})()};
  });
  for(const condition of (args.conditions?args.conditions.split(','):['day','golden','overcast','night'])){
   stage=condition;
   await page.evaluate(({site,condition})=>{
    const r=window.__fly;window.__sampleStep??=r.flight.step;r.flight.step=()=>{};
    window.__flySunOverride=Date.UTC(2026,8,27,site[condition==='overcast'?'day':condition]);window.__flyWeatherOverride=condition==='overcast'?'overcast':'baseline';
    r.warpToGeo(site.lat,site.lon,{altM:site.altM,headingRad:site.headingRad,name:null});
   },{site,condition});
   await page.waitForTimeout(condition==='overcast'?23000:14000);
   if(condition==='overcast')await page.waitForFunction(()=>window.__fly.weather?.wx?.overcastT>.9,null,{timeout:30000});
   if(condition==='night')await page.waitForFunction(()=>window.__fly.weather?.wx?.overcastT<.1,null,{timeout:30000});
   await page.screenshot({path:path.join(out,condition+'.png')});
   const state=await snapshot();report.cases.push({condition,...state});
   assert.equal(!!state.environment,look==='cinematic','The intended visual path must be active');assert.ok(state.hud?.inBounds,'HUD outside viewport');
   if(look==='cinematic')assert.ok(state.clouds?.densityModel==='cellular-v2'&&state.clouds.volumeReady,'The replacement cloud volume must be loaded and active');
   if(phone)assert.ok(state.profile?.targetFps===30&&state.profile.cascades<=1&&state.profile.materialSize<=256,'Phone allocated desktop profile');
   if(args.video==='1'&&['day','night'].includes(condition)){
    const encoded=await page.evaluate(async()=>{
     const r=window.__fly;r.flight.step=window.__sampleStep;
     const canvas=document.querySelector('canvas'),stream=canvas.captureStream(30),chunks=[];
     const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:9000000});
     recorder.ondataavailable=e=>chunks.push(e.data);
     const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
     await new Promise(resolve=>setTimeout(resolve,2500));r.input?.setBoost(true);
     await new Promise(resolve=>setTimeout(resolve,1500));r.input?.setBoost(false);
     await new Promise(resolve=>setTimeout(resolve,4000));recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());
     const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);
    });
    fs.writeFileSync(path.join(out,condition+'.webm'),Buffer.from(encoded,'base64'));
   }
   console.log(`${look} ${siteKey} ${condition}: ${state.profile?.name??'current'}, ${state.draws} draws, ${state.resources?.combinedBytes??0} logical bytes`);
   fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  }
  await page.evaluate(()=>{window.__fly.flight.step=window.__sampleStep;});
  if(args.motion==='1'){
   stage='cloud-motion';
   // This real Jersey City approach intersects an existing bank on the fixed
   // September review field. Manhattan's first route climbed through a gap.
   report.motionStart={lat:40.6876,lon:-74.055,altM:900,headingRad:0};
   await page.evaluate(({site,start})=>{
    window.__flySunOverride=Date.UTC(2026,8,27,site.day);window.__flyWeatherOverride='overcast';
    const r=window.__fly;r.flight.step=()=>{};r.input.neutralize();
    r.warpToGeo(start.lat,start.lon,{altM:start.altM,headingRad:start.headingRad,name:null});
   },{site,start:report.motionStart});
   await page.waitForTimeout(23000);
   await page.evaluate(()=>{
    const r=window.__fly,canvas=document.querySelector('canvas'),stream=canvas.captureStream(30),chunks=[];r.input.neutralize();r.flight.step=window.__sampleStep;
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:6000000});
    const run=window.__cloudMotion={start:performance.now(),trace:[],recorder,stream,chunks,finished:false};
    recorder.ondataavailable=e=>chunks.push(e.data);run.done=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
    const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
    function tick(now){
     const t=(now-run.start)/1000,f=r.flight,phase=Math.min(1,t/90),target=900+3600*(.5-.5*Math.cos(phase*Math.PI*2));
     // Ordinary input/physics and chase camera; altitude feedback exercises
     // clouds with a climb and descent, plus sustained left/right banks.
     const vertical=3600*Math.PI/90*Math.sin(phase*Math.PI*2)+(target-f.pos.y)*.3;
     const pitch=Math.asin(clamp(vertical/Math.max(1,f.speed),-.8,.8));
     const turn=t>30&&t<38?.28:t>38&&t<46?-.28:t>62&&t<70?-.25:t>70&&t<78?.25:0;
     r.input.setTouchSteer(turn,-clamp((pitch-f.pitch)*3,-1,1));r.input.setBoost(t>8&&t<11);
     if(!run.last||now-run.last>200){run.last=now;run.trace.push({t,altitude:f.pos.y,x:f.pos.x,z:f.pos.z,bank:f.bank,pitch:f.pitch,inside:r.immersiveClouds?.inside,epoch:r.origin.epoch,clouds:{...r.immersiveClouds},profile:r.cinemaProfile?.name});}
     if(t<90)requestAnimationFrame(tick);else{r.input.clearTouchSteer();r.input.setBoost(false);recorder.stop();run.finished=true;}
    }requestAnimationFrame(tick);
   });
   for(let i=1;i<=6;i++){await page.waitForTimeout(15000);await page.screenshot({path:path.join(out,`motion-${i}.png`)});}
   await page.waitForFunction(()=>window.__cloudMotion.finished);
   const motion=await page.evaluate(async()=>{
    const r=window.__cloudMotion;await r.done;r.stream.getTracks().forEach(t=>t.stop());
    const bytes=new Uint8Array(await new Blob(r.chunks).arrayBuffer());let b='';for(let i=0;i<bytes.length;i+=32768)b+=String.fromCharCode(...bytes.subarray(i,i+32768));
    return{trace:r.trace,encoded:btoa(b)};
   });
   fs.writeFileSync(path.join(out,'cloud-motion.webm'),Buffer.from(motion.encoded,'base64'));delete motion.encoded;
   motion.maxInside=Math.max(...motion.trace.map(r=>r.inside??0));motion.minAltitude=Math.min(...motion.trace.map(r=>r.altitude));motion.maxAltitude=Math.max(...motion.trace.map(r=>r.altitude));
   motion.rebases=motion.trace.at(-1).epoch-motion.trace[0].epoch;report.motion=motion;
   assert.ok(motion.maxInside>.05&&motion.maxAltitude>4000&&motion.minAltitude<1200,'Motion probe must actually enter clouds and cross their vertical layer');
   assert.ok(motion.rebases>0,'Cloud motion probe must exercise a real origin rebase');
  }
  if(args.lifecycle==='1'){
   report.lifecycle=[];
   for(const preset of ['low','medium','high','ultra']){
    stage='preset-'+preset;
    await page.evaluate(({preset,audit})=>{window.__sampleDrawAudit=audit;window.__flyStore.getState().setQualityPreset(preset);},{preset,audit:!!args.gl});await page.waitForTimeout(5000);
    report.lifecycle.push({preset,...await snapshot()});
   }
   stage='resize';await page.setViewportSize({width:1280,height:720});await page.waitForTimeout(2000);report.resize=await snapshot();
   stage='context-restore';
   await page.evaluate(()=>{const canvas=document.querySelector('canvas');window.__sampleRestore=new Promise(resolve=>canvas.addEventListener('webglcontextrestored',resolve,{once:true}));const ext=canvas.getContext('webgl2').getExtension('WEBGL_lose_context');ext.loseContext();setTimeout(()=>ext.restoreContext(),500);});
   await page.evaluate(()=>window.__sampleRestore);await page.waitForTimeout(8000);report.restored=await snapshot();
   assert.ok(report.restored.ibl?.width&&report.restored.environment,'Environment did not restore');
   if(look==='cinematic')assert.ok(report.restored.clouds?.volumeReady,'Cloud volume did not restore');
   await page.screenshot({path:path.join(out,'restored.png')});
  }
  if(phone)assert.ok(report.assetRequests.every(p=>!/(512|1024)\./.test(p)),'Phone fetched a desktop material variant');
  const shaders=await page.evaluate(()=>window.__sampleShaderLogs??[]);if(shaders.length)fs.writeFileSync(path.join(out,'shader-logs.json'),JSON.stringify(shaders,null,2));
  const badDraws=await page.evaluate(()=>window.__sampleBadDraws??[]);if(badDraws.length)fs.writeFileSync(path.join(out,'bad-draws.json'),JSON.stringify(badDraws,null,2));
  assert.equal(report.errors.length,0,JSON.stringify(report.errors[0]));report.status='REVIEW_REQUIRED';
 }catch(error){report.status='FAIL';report.reason=error.stack;console.error(error.message);}
 finally{await browser?.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(report.status);process.exitCode=report.status==='FAIL'?1:0;}
}
main();
