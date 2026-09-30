// Fifteen minutes of real input/physics on live geography, with revisits.
// Logical GPU ownership is not physical VRAM; browser rAF is not display tearing.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {enterFlight}=require('./_skip-menus');
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const out=args.output||'.graphics-review/visual-finish/soak',seconds=Number(args.seconds||900);
const routes=[{lat:40.72,lon:-74.02,altM:900,headingRad:.3,hour:17,name:'city-day'},
 {lat:40.72,lon:-74.02,altM:900,headingRad:.3,hour:5,name:'city-night'},
 {lat:46.58,lon:7.94,altM:4200,headingRad:2.3,hour:17,name:'alps-golden'},
 {lat:40.72,lon:-74.02,altM:10500,headingRad:.3,hour:17,name:'coast-cruise'},
 {lat:40.72,lon:-74.02,altM:900,headingRad:.3,hour:17,name:'city-revisit'}];
const poses=args.legs?args.legs.split(',').map(name=>{const pose=routes.find(p=>p.name===name);assert.ok(pose,'Unknown flight leg: '+name);return pose;}):routes;
(async()=>{
 fs.mkdirSync(out,{recursive:true});const report={...require('./graphics-source.cjs')(),seconds,status:'RUNNING',samples:[],errors:[],warnings:[]};
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(!['error','warning'].includes(m.type())||!/shader|WebGLProgram|GL_INVALID|INVALID_OPERATION/.test(m.text()))return;
  if(/warning X4122/.test(m.text())&&!/error X|warning X3595/.test(m.text()))report.warnings.push(m.text().slice(0,500));else report.errors.push(m.text().slice(0,1600));});
 const write=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 try{
  await page.addInitScript(()=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-crash-mode','forgiving');window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,8,27,17);});
  await page.goto((args.url||'http://localhost:3091')+'/?graphicsReview=1',{waitUntil:'domcontentloaded',timeout:90000});
  await enterFlight(page,{...poses[0],name:null},{waitReveal:true});
  if(args['build-id'])report.servedBuild=await require('./ground-build-receipt.cjs')(page,args.url,args['build-id']);
  await page.addStyleTag({content:'.cinema-review-dock{display:none!important}'});
  report.hardware=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return e&&gl.getParameter(e.UNMASKED_RENDERER_WEBGL);});
  assert.ok(report.hardware&&!/SwiftShader|software/i.test(report.hardware));
  await page.evaluate(()=>{
   const r=window.__fly;
   const run=window.__polishSoak={start:performance.now(),poseStart:performance.now(),alt:900,last:performance.now(),frames:[],running:true,maxBank:0,epoch:r.origin.epoch};
   const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
   function tick(now){if(!run.running)return;
    const dt=now-run.last;run.last=now;run.frames.push(dt);const t=(now-run.poseStart)/1000,f=r.flight;
    // Alternating banks and short boost bursts through the actual controls.
    const altitude=Math.max(run.alt,(f.groundElev||0)+500);
    const desiredPitch=clamp((altitude-f.pos.y)*.0012,-.32,.32);
    r.input.setTouchSteer(Math.sin(t*Math.PI/18)*.26,-clamp((desiredPitch-f.pitch)*3,-1,1));
    r.input.setBoost(t%60>35&&t%60<39);run.maxBank=Math.max(run.maxBank,Math.abs(f.bank));
    requestAnimationFrame(tick);
   }requestAnimationFrame(tick);
  });
  let current=-1;
  for(let elapsed=0;elapsed<seconds;elapsed+=10){
   const leg=Math.min(poses.length-1,Math.floor(elapsed/(seconds/poses.length)));
   if(leg!==current){current=leg;const pose=poses[leg];await page.evaluate(p=>{const r=window.__fly;window.__flySunOverride=Date.UTC(2026,8,27,p.hour);r.warpToGeo(p.lat,p.lon,{altM:p.altM,headingRad:p.headingRad,name:null});Object.assign(window.__polishSoak,{poseStart:performance.now(),alt:p.altM});},pose);console.log('LEG '+pose.name);}
   await page.waitForTimeout(Math.min(10,seconds-elapsed)*1000);
   const sample=await page.evaluate(()=>{
    const r=window.__fly,p=window.__polishSoak,gl=document.querySelector('canvas').getContext('webgl2'),frames=p.frames.splice(0).sort((a,b)=>a-b),q=n=>frames[Math.min(frames.length-1,Math.floor(n*frames.length))];
    return {time:(performance.now()-p.start)/1000,legTime:(performance.now()-p.poseStart)/1000,p50:q(.5),p95:q(.95),p99:q(.99),worst:frames.at(-1),frames:frames.length,
     position:{...r.flight.pos},bank:r.flight.bank,epoch:r.origin.epoch,maxBank:p.maxBank,heap:performance.memory?.usedJSHeapSize,draws:window.__graphicsReview?.drawCalls,triangles:window.__graphicsReview?.triangles,
     traffic:r.traffic?.items?.length??0,liveFleet:r.liveFleet,
     profile:r.cinemaProfile,resources:r.cinemaResources,shadows:r.cinemaShadows,clouds:r.immersiveClouds,terrain:r.terraStats,surface:r.earthSurface,fx:window.__flyStats?.fx,error:gl.getError()};
   });
   report.samples.push({leg:poses[leg].name,...sample});write();
   assert.equal(sample.error,0,'WebGL error');assert.ok(sample.fx?.bufferMatchesDrawing,'drawing/composer buffer mismatch');
   assert.ok(sample.clouds?.volumeReady,'cloud volume disappeared');assert.ok(Object.values(sample.position).every(Number.isFinite),'invalid flight pose');
   assert.equal(report.errors.length,0,'page or shader error');
   if((elapsed+10)%60===0){await page.screenshot({path:path.join(out,`flight-${elapsed+10}.png`)});console.log(`${elapsed+10}s ${poses[leg].name}: p95 ${sample.p95.toFixed(1)}ms; ${sample.draws} draws; ${(sample.resources?.combinedBytes/1048576).toFixed(1)} MiB textures/targets`);}
  }
  const settled=report.samples.filter(s=>s.legTime>35),last=report.samples.at(-1);
  assert.ok(last.maxBank>.15,'banks not exercised');
  report.movingRebases=report.samples.reduce((n,s,i)=>i&&s.leg===report.samples[i-1].leg?n+Math.max(0,s.epoch-report.samples[i-1].epoch):n,0);
  assert.ok(report.movingRebases>0,'origin rebases not exercised during flight');
  assert.ok(settled.length>=Math.floor(seconds/20),'insufficient moving samples');
  const over=settled.filter(s=>s.draws>s.profile.draws||s.triangles>s.profile.triangles||s.resources.combinedBytes>s.profile.textureBytes);
  report.budgetOverages=over.map(s=>({time:s.time,leg:s.leg,draws:s.draws,triangles:s.triangles,bytes:s.resources.combinedBytes,profile:s.profile.name}));
  const percentile=(values,q)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))];};
  // Existing soak-fly gates use p95 submissions, not a maximum. Retain every
  // overage above as evidence and keep the texture ceiling a hard maximum.
  report.budgets={p95Triangles:percentile(settled.map(s=>s.triangles),.95),p95Draws:percentile(settled.map(s=>s.draws),.95),
   p95TriangleRatio:percentile(settled.map(s=>s.triangles/s.profile.triangles),.95),p95DrawRatio:percentile(settled.map(s=>s.draws/s.profile.draws),.95),
   peakTextureRatio:Math.max(...settled.map(s=>s.resources.combinedBytes/s.profile.textureBytes))};
  const times=settled.map(s=>s.p95).sort((a,b)=>a-b);report.p95OfTenSecondP95=times[Math.floor(times.length*.95)];
  const heaps=settled.map(s=>s.heap).filter(Number.isFinite),third=Math.max(1,Math.floor(heaps.length/3));
  report.heapFloor={firstMiB:Math.min(...heaps.slice(0,third))/1048576,lastMiB:Math.min(...heaps.slice(-third))/1048576};
  report.heapFloor.climbMiB=report.heapFloor.lastMiB-report.heapFloor.firstMiB;
  assert.ok(report.budgets.p95TriangleRatio<=1&&report.budgets.p95DrawRatio<=1&&report.budgets.peakTextureRatio<=1,'existing profile budget exceeded');
  // Same 60-MiB retained-heap ceiling as soak-fly's satellite gate. Compare
  // floors, not a pair of readings on opposite sides of garbage collection.
  assert.ok(heaps.length>0&&report.heapFloor.climbMiB<60,'retained JS heap climb');
  report.status='PASS';
 }catch(e){report.status='FAIL';report.reason=e.stack;console.error(e);process.exitCode=1;}
 finally{await page.evaluate(()=>{if(window.__polishSoak)window.__polishSoak.running=false;window.__fly?.input.clearTouchSteer();window.__fly?.input.setBoost(false);}).catch(()=>{});await browser.close();write();console.log(report.status);}
})();
