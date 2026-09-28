// Paired world-only captures: identical pose, time, imagery and quality.
// Aircraft and cloud volume are excluded from BOTH arms, not from gameplay.
const fs=require('node:fs');
const {chromium}=require('playwright');
const {enterFlight}=require('./_skip-menus');
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const sites={
  valley:{lat:46.67,lon:7.87,altM:2200,headingRad:2.65,day:13,night:23},
  canyon:{lat:36.09,lon:-112.1,altM:2700,headingRad:2,day:20,night:8},
  city:{lat:40.72,lon:-74.02,altM:500,headingRad:.30,day:17,night:5},
  harbor:{lat:40.701,lon:-74.036,altM:240,headingRad:.55,day:17,night:5},
  tokyo:{lat:35.6796,lon:139.6432,altM:662,headingRad:5.13,day:4,night:16},
  coast:{lat:31.5139,lon:34.461,altM:552,headingRad:5.74,day:11,night:21},
  jersey:{lat:40.7210,lon:-73.9988,altM:428,headingRad:320*Math.PI/180,day:17,night:5},
};
(async()=>{
 const out=args.output||`.graphics-review/world-art/${args.site||'valley'}`;
 fs.mkdirSync(out,{recursive:true});
 const report={site:args.site||'valley',errors:[],cases:[],status:'IN_PROGRESS',source:require('./graphics-source.cjs')()};
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist']});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
  page.on('pageerror',e=>{report.errors.push(e.stack);console.log(e.message);});
  page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/.test(m.text())){report.errors.push(m.text());console.log(m.text());}});
  const site=sites[report.site];
  await page.addInitScript(({site,tier})=>{
   localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');
   localStorage.setItem('fly-quality-tier',tier);localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-controls-seen','1');
   window.__flyGovPin='hold';
   window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,8,27,site.day);
  },{site,tier:args.tier||'high'});
  await page.goto(`${args.url||'http://localhost:3068'}/?graphicsReview=1`,{waitUntil:'domcontentloaded',timeout:90000});
  report.servedBuild=require('./ground-build-receipt.cjs').documentIdentity(await page.content()).buildId;
  await enterFlight(page,{...site,name:null},{waitReveal:true,timeoutMs:180000});
  await page.evaluate(site=>{
   // Re-seat AFTER reveal and pause in the same JS task. Otherwise the few
   // flying frames between reveal and pause shift separate-build comparisons.
   window.__fly.warpToGeo(site.lat,site.lon,{altM:site.altM,headingRad:site.headingRad,name:null});
   window.__flyStore.getState().setPhase('paused');
  },site);
  await page.waitForTimeout(16000);
  report.gpu=await page.evaluate(()=>{
   const canvas=[...document.querySelectorAll('canvas')].find(c=>c.getContext('webgl2'));
   const gl=canvas?.getContext('webgl2'),debug=gl?.getExtension('WEBGL_debug_renderer_info');
   return gl?{renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),maxFragmentSamplers:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)}:null;
  });
  await page.evaluate(()=>{
   const rt=window.__fly,pass=window.__flyComposer.passes.find(p=>p.name==='ImmersiveClouds');
   // Freeze only the photographic comparison. This never changes saved settings.
   Object.defineProperty(pass.uniforms.cloudMix,'value',{configurable:true,get:()=>0,set:()=>{}});
   window.__worldReviewRemoved=[];
   const renderPass=window.__flyComposer.passes.find(p=>p.name==='RenderPass');
   const scene=renderPass?.mainScene||renderPass?.scene;
   scene?.traverse(o=>{
    if(o.name==='player-engine-exhaust'){
     const root=o.parent?.parent?.parent;
     if(!root||root.isScene)throw Error('Player root could not be isolated');
     window.__worldReviewRemoved.push('player-root');root.visible=false;
     Object.defineProperty(root,'visible',{configurable:true,get:()=>false,set:()=>{}});
    }
   });
   for(const canvas of document.querySelectorAll('canvas')){
    if(canvas.getContext('webgl2'))canvas.dataset.worldCapture='yes';
   }
  });
  // Hide only DOM overlays. The rendered world remains untouched.
  await page.addStyleTag({content:'body *:not(canvas):not(:has(canvas)){visibility:hidden!important} canvas{visibility:hidden!important} canvas[data-world-capture="yes"]{visibility:visible!important}'});
  for(const [time,hour]of [['day',site.day],['night',site.night]]){
   await page.evaluate(hour=>{window.__flySunOverride=Date.UTC(2026,8,27,hour);},hour);
   await page.waitForFunction(time=>time==='night'?window.__fly.sun?.sinEl<-.15:window.__fly.sun?.sinEl>.15,time,{timeout:65000});
   await page.waitForTimeout(10000);
   for(const [arm,flag]of args.fixed?[['after',1]]:[['before',0],['after',1]]){
    await page.evaluate(({flag,urban})=>{window[urban?'__flyUrbanArtOverride':'__flyWorldArtOverride']=flag;},{flag:args.fixed?1:flag,urban:!!args.urban});
    await page.waitForTimeout(2000);
    const data=await page.evaluate(()=>({ground:window.__fly.terraStats?.sharp,loading:window.__fly.worldLoading,
     position:window.__fly.flight.pos.toArray(),camera:window.__fly.camera.matrixWorld.toArray(),
     removed:window.__worldReviewRemoved,earth:window.__fly.earthSurface,
     tier:window.__flyStore.getState().qualityTier,sun:window.__fly.sun,
     reflections:window.__fly.coastalReflection,groundLights:window.__fly.groundLighting}));
    await page.screenshot({path:`${out}/${time}-${arm}.png`});
    report.cases.push({time,arm,...data});console.log(`${time}-${arm} terrain:${data.ground} hidden:${data.removed}`);
   }
  }
  const pairs=args.fixed?[report.cases]:['day','night'].map(time=>report.cases.filter(c=>c.time===time));
  report.checks={
   matched:pairs.every(([a,b])=>a.position.every((v,i)=>Math.abs(v-b.position[i])<1e-5)&&a.camera.every((v,i)=>Math.abs(v-b.camera[i])<1e-5)),
   qualityMatched:pairs.every(([a,b])=>a.tier===b.tier),
   daylight:report.cases.filter(c=>c.time==='day').every(c=>c.sun.sinEl>.15),
   night:report.cases.filter(c=>c.time==='night').every(c=>c.sun.sinEl<-.15),
   playerRemoved:report.cases.every(c=>c.removed.includes('player-root')),
  };
  if(args.lifecycle){
   report.lifecycle=[];
   for(const [visuals,tier,width]of [['enhanced','medium',384],['enhanced','low',0],['enhanced','high',768],['classic','high',0],['enhanced','high',768]]){
    await page.evaluate(({visuals,tier})=>{window.__flyStore.getState().setVisuals(visuals);window.__flyStore.getState().setQualityTier(tier);},{visuals,tier});
    await page.waitForFunction(width=>window.__fly.coastalReflection?.width===width,width,{timeout:30000});
    const reflection=await page.evaluate(()=>window.__fly.coastalReflection);report.lifecycle.push({visuals,tier,...reflection});
   }
   report.checks.reflectionLifecycle=report.lifecycle.every(c=>c.width>0?c.active:c.bytes===0&&!c.active);
  }
  report.comparison=args.fixed?'fixed build capture':args.urban?'urban material/light/water switch; stepped geometry shared in both views':'world art switch';
  report.status=report.errors.length||Object.values(report.checks).some(v=>!v)?'FAIL':report.cases.every(c=>c.ground&&!c.loading)?'REVIEW_REQUIRED':'UNSETTLED';
 }catch(e){report.status='BLOCKED';report.error=e.stack;console.error(e.stack);}
 finally{await browser.close();fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));console.log(report.status);}
})();
