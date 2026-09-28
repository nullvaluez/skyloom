// Short visual flight recording, not an unattended performance certification.
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const {enterFlight}=require('./_skip-menus');
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('=')));
const out=args.output||'.graphics-review/surface-correction/flight';fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
 const report={errors:[],samples:[],status:'BLOCKED',source:require('./graphics-source.cjs')()};
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/.test(m.text()))report.errors.push(m.text());});
  await page.addInitScript(()=>{
   localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');localStorage.setItem('fly-quality-tier','medium');
   localStorage.setItem('fly-aircraft','fighter');localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-controls-seen','1');
   window.__flyGovPin='hold';window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,8,27,17);
  });
  await page.goto((args.url||'http://localhost:3072')+'/?graphicsReview=1',{waitUntil:'domcontentloaded',timeout:90000});
  await enterFlight(page,{lat:40.721,lon:-73.9988,altM:428,headingRad:320*Math.PI/180,name:null},{waitReveal:true,timeoutMs:180000});
  await page.evaluate(()=>window.__flyStore.getState().setPhase('paused'));await page.waitForTimeout(16000);
  await page.evaluate(()=>{
   const rt=window.__fly,f=rt.flight;rt.autopilot.disengage();let elapsed=0;const step=f.step.bind(f);
   const review=window.__surfaceFlight={running:true,start:f.pos.toArray(),frames:[],simSeconds:0};let last=performance.now();
   f.step=(dt,cmd)=>{elapsed+=dt;review.simSeconds=elapsed;step(dt,{...cmd,turn:elapsed<6?0:Math.sin((elapsed-6)/6)*.12,
    pitch:Math.max(-.2,Math.min(.2,(428-f.pos.y)*.002)),speedOverride:180,boost:false,speedPreset:'cruise'});};
   f.speed=180;window.__flyStore.getState().setPhase('flying');
   const canvas=[...document.querySelectorAll('canvas')].find(c=>c.getContext('webgl2'));
   const stream=canvas.captureStream(30),chunks=[],recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:8000000});
   review.video=new Promise(resolve=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}));};});
   review.stop=()=>{review.running=false;recorder.stop();};recorder.start(1000);
   const frame=now=>{if(!review.running)return;review.frames.push(now-last);last=now;requestAnimationFrame(frame);};requestAnimationFrame(frame);
  });
  for(let i=0;i<6;i++){
   await page.waitForTimeout(4000);
   report.samples.push(await page.evaluate(()=>({position:window.__fly.flight.pos.toArray(),tier:window.__flyStore.getState().qualityTier,
    reflections:window.__fly.coastalReflection,terrain:window.__fly.terraStats?.sharp,simSeconds:window.__surfaceFlight.simSeconds})));
   await page.screenshot({path:path.join(out,`flight-${(i+1)*4}.png`)});
  }
  const video=await page.evaluate(async()=>{window.__surfaceFlight.stop();return await window.__surfaceFlight.video;});
  fs.writeFileSync(path.join(out,'flight.webm'),Buffer.from(video,'base64'));
  report.motion=await page.evaluate(()=>{const r=window.__surfaceFlight,sorted=r.frames.slice().sort((a,b)=>a-b),p=window.__fly.flight.pos;
   return{frames:sorted.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],simSeconds:r.simSeconds,
    distance:Math.hypot(p.x-r.start[0],p.z-r.start[2])*Math.cos(window.__fly.flight.latDeg*Math.PI/180)};});
  report.status=report.errors.length||report.motion.distance<200||!report.samples.every(s=>s.tier==='medium')?'FAIL':'CAPTURED';
 }catch(e){report.error=e.stack;}finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})().catch(e=>{console.error(e);process.exitCode=1;});
