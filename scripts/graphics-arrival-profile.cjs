/* Diagnostic, not a performance gate: JS sampling and timed GL calls identify
 * the work around a cold geographic arrival. Run alone on the GPU. */
const { chromium } = require('playwright');
const fs = require('node:fs');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k,...v]=a.replace(/^--/,'').split('='); return [k,v.join('=')||true]; }));
const stage=args.stage||'immersive',dir=args.output||`.graphics-review/immersive-cert/arrival-${stage}`;
(async()=>{let browser;
 const r={...require('./graphics-source.cjs')(),status:'BLOCKED',stage,errors:[],purpose:'Profiling overhead present; use for attribution, not frame-time certification'};
 try{
  fs.mkdirSync(dir,{recursive:true});
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
  const page=await browser.newPage({viewport:{width:2560,height:1440},deviceScaleFactor:1});
  page.on('pageerror',e=>r.errors.push(e.message));
  await page.addInitScript(()=>{
   localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');
   window.__flySunOverride=Date.UTC(2026,6,18,17);window.__flyWeatherOverride='baseline';
   const trace=window.__arrivalGL={active:false,calls:[],frames:[],governor:[],last:0};
   const proto=WebGL2RenderingContext.prototype,source=new WeakMap(),programs=new WeakMap(),current=new WeakMap();
   const shaderSource=proto.shaderSource;proto.shaderSource=function(s,text){source.set(s,{name:text.match(/#define SHADER_NAME (\S+)/)?.[1]||text.slice(0,70),features:['vLeafCard','uCanopyTime','uArchitecture','uHomeVariant','noiseVolume','textureCubeUV','uHillDir'].filter(v=>text.includes(v))});return shaderSource.call(this,s,text);};
   const attach=proto.attachShader;proto.attachShader=function(p,s){const names=programs.get(p)||[];names.push(source.get(s));programs.set(p,names);return attach.call(this,p,s);};
   const use=proto.useProgram;proto.useProgram=function(p){current.set(this,p);return use.call(this,p);};
   for(const name of ['compileShader','linkProgram','getProgramParameter','getProgramInfoLog','getShaderInfoLog','texImage2D','texSubImage2D','generateMipmap','drawElements','drawElementsInstanced','drawArrays','drawArraysInstanced']){
    const original=proto[name];proto[name]=function(...a){const t=performance.now();try{return original.apply(this,a);}finally{const ms=performance.now()-t;if(trace.active&&ms>2&&trace.calls.length<2000)trace.calls.push({t,ms,name,shader:name==='compileShader'||name==='getShaderInfoLog'?source.get(a[0]):programs.get(name==='linkProgram'||name.startsWith('getProgram')?a[0]:current.get(this))});}};
   }
   function tick(t){if(trace.active){if(trace.last)trace.frames.push({t,dt:t-trace.last});trace.last=t;}requestAnimationFrame(tick);}requestAnimationFrame(tick);
  });
  await page.goto(`${args.url||'http://localhost:3020'}/?graphics=${stage}&graphicsReview=1`,{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>window.__flyBoot?.pct===100&&window.__fly?.engine,null,{timeout:90000});
  await page.evaluate(()=>window.__fly.warpToGeo(40.7028,-74.017,{altM:500,name:null}));
  await page.waitForTimeout(35000);
  r.hardware=await page.evaluate(()=>{const gl=window.__flyComposer.getRenderer().getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);});
  if(!r.hardware||/software|swiftshader/i.test(r.hardware))throw Error('Hardware GPU unavailable');
  const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});await cdp.send('Profiler.start');
  await page.evaluate(()=>{window.__arrivalGL.active=true;window.__arrivalGL.start=performance.now();window.__fly.warpToGeo(-37.683,144.582,{altM:500,name:null});});
  for(let i=0;i<35;i++){
   await page.waitForTimeout(1000);
   await page.evaluate(()=>window.__arrivalGL.governor.push({t:performance.now(),gov:window.__flyGov.state(),review:window.__graphicsReview,
    prewarm:window.__fly.prewarm,downloads:window.__fly.engine.downloading,buildingWork:window.__fly.satBuildings.stats}));
  }
  const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync(`${dir}/cpu.cpuprofile`,JSON.stringify(profile));
  r.trace=await page.evaluate(()=>{window.__arrivalGL.active=false;return window.__arrivalGL;});
  const nodes=new Map(profile.nodes.map(n=>[n.id,n])),totals=new Map();
  for(let i=0;i<(profile.samples||[]).length;i++)totals.set(profile.samples[i],(totals.get(profile.samples[i])||0)+(profile.timeDeltas?.[i]||0));
  r.cpu=Array.from(totals,([id,us])=>({ms:us/1000,...nodes.get(id)?.callFrame})).sort((a,b)=>b.ms-a.ms).slice(0,40);
  r.slowGL=[...r.trace.calls].sort((a,b)=>b.ms-a.ms).slice(0,40);
  r.status=r.errors.length?'FAIL':'RECORDED';
 }catch(e){r.reason=e.stack;}
 finally{await browser?.close();fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(`${dir}/report.json`,JSON.stringify(r,null,2));console.log(JSON.stringify({status:r.status,reason:r.reason,topGL:r.slowGL?.slice(0,8),topCPU:r.cpu?.slice(0,8)},null,2));process.exitCode=r.status==='RECORDED'?0:r.status==='FAIL'?1:2;}
})();
