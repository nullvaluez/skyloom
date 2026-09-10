/* Compare actual GPU cloud pixels at one absolute pose across a real warp rebase.
 * Only weather/time and the stationary pose are controlled. This is not a flight
 * performance measurement. The volume must be non-empty for the comparison. */
const {chromium}=require('playwright');
const fs=require('node:fs');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const [k,...v]=a.replace(/^--/,'').split('=');return[k,v.join('=')||true];}));
const dir=args.output||'.graphics-review/immersive-cert/rebase';
const r={...require('./graphics-source.cjs')(),status:'BLOCKED',errors:[],checks:[]};
function half(v){const sign=v&32768?-1:1,e=(v>>10)&31,m=v&1023;return sign*(e===0?m*2**-24:e===31?m?NaN:Infinity:(1+m/1024)*2**(e-15));}
const check=(name,pass,detail)=>{r.checks.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'}: ${name}`);};
(async()=>{let b;
 try{
  fs.mkdirSync(dir,{recursive:true});
  b=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
  const p=await b.newPage({viewport:{width:2560,height:1440},deviceScaleFactor:1});
  p.on('pageerror',e=>r.errors.push(e.message));
  p.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|TypeError/.test(m.text()))r.errors.push(m.text().slice(0,2000));});
  await p.addInitScript(()=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-sound-on','0');window.__flyGovPin='hold';window.__flyWeatherOverride='overcast';window.__flySunOverride=Date.UTC(2026,6,18,17);});
  await p.goto(`${args.url||'http://localhost:3020'}/?graphics=immersive&graphicsReview=1`,{waitUntil:'domcontentloaded',timeout:90000});
  await p.waitForFunction(()=>window.__flyBoot?.pct===100&&window.__fly?.camera,null,{timeout:90000});
  r.hardware=await p.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return e&&gl.getParameter(e.UNMASKED_RENDERER_WEBGL);});
  if(!r.hardware||/swiftshader|software/i.test(r.hardware))throw Error('Hardware GPU unavailable');
  await p.evaluate(()=>{
    const rt=window.__fly,f=rt.flight;rt.warpToGeo(40.7028,-74.017,{altM:2050,headingRad:.3,name:null});
    // Remain below the normal 10 km rebase boundary but away from its anchor.
    f.pos.x+=3000;window.__rebasePose=f.pos.clone();
    f.step=()=>{f.pos.copy(window.__rebasePose);f.heading=.3;f.pitch=0;f.bank=0;f.speed=0;};
  });
  await p.waitForFunction(()=>window.__flyComposer.passes.find(p=>p.name==='ImmersiveClouds')?.uniforms.coverage.value>.77,null,{timeout:90000});
  await p.waitForTimeout(12000);
  await p.evaluate(()=>window.__flyStore.getState().setPhase('paused'));
  await p.waitForTimeout(1200);
  const sample=()=>p.evaluate(()=>{
    const rt=window.__fly,c=window.__flyComposer.passes.find(p=>p.name==='ImmersiveClouds'),gl=window.__flyComposer.getRenderer();
    const pixels=new Uint16Array(64*32*4);
    // Above the aircraft: cloud-only crop, away from foreground depth edges.
    gl.readRenderTargetPixels(c.target,Math.floor(c.target.width*.5)-32,Math.floor(c.target.height*.72),64,32,pixels);
    return{pixels:[...pixels],origin:rt.origin.anchor.toArray(),eye:c.uniforms.eye.value.toArray(),phase:c.uniforms.phase.value.toArray(),
      absolute:rt.flight.pos.toArray(),camera:rt.camera.matrixWorld.toArray(),projection:rt.camera.projectionMatrix.toArray(),
      drift:[c.driftX,c.driftZ],coverage:c.uniforms.coverage.value,epoch:rt.origin.epoch,geo:{...rt.geo}};
  });
  r.before=await sample();
  await p.evaluate(()=>{const rt=window.__fly;rt.warpToGeo(rt.geo.y,rt.geo.x,{altM:rt.flight.pos.y,headingRad:.3,name:null});window.__rebasePose.copy(rt.flight.pos);window.__flyStore.getState().setPhase('paused');});
  await p.waitForTimeout(12000);r.after=await sample();
  check('The real origin changed at the same absolute position',Math.abs(r.after.origin[0]-r.before.origin[0])>1000&&Math.hypot(...r.after.absolute.map((v,i)=>v-r.before.absolute[i]))<.05,{before:r.before.origin,after:r.after.origin});
  // Compare linear half-float pixels, not JPEGs or screenshots with UI/traffic.
  const before=r.before.pixels.map(half),after=r.after.pixels.map(half);
  const differences=before.map((v,i)=>Math.abs(v-after[i]));
  const alpha=before.filter((_,i)=>i%4===3),maxDelta=Math.max(...differences),meanDelta=differences.reduce((a,v)=>a+v,0)/differences.length;
  check('A non-empty cloud was measured',alpha.some(v=>v<.95)&&before.every(Number.isFinite)&&after.every(Number.isFinite),{minTransmittance:Math.min(...alpha)});
  check('Cloud pixels remain stable through the rebase',maxDelta<.025&&meanDelta<.002,{maxDelta,meanDelta,linearTolerance:'max 0.025, mean 0.002; allows float32 rebase rounding, not a shifted cloud'});
  check('No page or shader errors',r.errors.length===0,r.errors);
  await p.screenshot({path:`${dir}/after.png`});
  r.status=r.checks.every(c=>c.pass)?'PASS':'FAIL';
 }catch(e){r.reason=e.stack;r.status=r.errors.length||r.checks.some(c=>!c.pass)?'FAIL':'BLOCKED';}
 finally{await b?.close();fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(`${dir}/report.json`,JSON.stringify(r,null,2));console.log(`REBASE: ${r.status}`);process.exitCode=r.status==='PASS'?0:r.status==='FAIL'?1:2;}
})();
