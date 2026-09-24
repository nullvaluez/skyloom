/* Real-GPU integration and moving-flight check; no fleet governor/terrain pins.
 * This does not replace the R25 appearance gates. Their outstanding failures
 * remain separate in CLEAR_SKY_VISUALS.md and in their original reports.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { enterFlight } = require('./_skip-menus');
const { sunTimeMs, isolateCanvas, holdStill } = require('./_r25-poses');
const { installGroundTextureAudit } = require('./ground-texture-audit.cjs');
const { makeCanvasShot } = require('./_canvasshot');
const out = path.resolve('.graphics-review/r25-resume/' + (process.env.R25_RUNTIME_DIAG === '1' ? 'runtime-diag' : 'runtime'));
fs.mkdirSync(out, { recursive: true });
const percentile = (v, p) => [...v].sort((a,b) => a-b)[Math.min(v.length - 1, Math.floor(v.length*p))];
const report = { checks: [], errors: [], shaderErrors: [], flights: [], views: [] };
const check = (name, pass, data) => {
  report.checks.push({ name, pass, data }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(data || '')}`);
};
const save = () => fs.writeFileSync(path.join(out,'report.json'), JSON.stringify(report,null,2));
(async () => {
 const browser = await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
 try {
  const page = await browser.newPage({viewport:{width:1280,height:720}});
  page.on('pageerror',e=>report.errors.push(e.stack));
  page.on('console',m=>{if(m.type()==='error' && /shader|WebGL|GL_INVALID/i.test(m.text()))report.shaderErrors.push(m.text().slice(0,1000));});
  const P = { lat:36.6,lon:-118.1,altM:2300 };
  const noon = (await sunTimeMs(P,'noon')).tMs;
  await page.addInitScript(installGroundTextureAudit);
  await page.addInitScript(t=>{
    localStorage.setItem('fly-map-style-2','satellite');
    localStorage.setItem('fly-quality-tier','high');
    localStorage.setItem('fly-visuals','classic');
    localStorage.setItem('fly-sound-on','0');
    localStorage.setItem('fly-controls-seen','1');
    window.__flySunOverride=t; window.__flyWeatherOverride='baseline';
  },noon);
  await page.goto((process.env.FLY_URL||'http://localhost:3020')+'/?graphicsReview=1');
  await enterFlight(page,{...P,headingRad:0},{timeoutMs:120000,waitReveal:true});
  await page.waitForFunction(()=>window.__fly.worldReadiness?.ready && !window.__fly.worldLoading,null,{timeout:90000});
  await holdStill(page,true);
  await page.waitForTimeout(2000);
  report.renderer = await page.evaluate(()=>{const g=window.__flyGl.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return e&&g.getParameter(e.UNMASKED_RENDERER_WEBGL);});
  check('hardware GPU available', !!report.renderer && !/swiftshader|llvmpipe|software/i.test(report.renderer),report.renderer);
  check('shipped governor and terrain settings',await page.evaluate(()=>window.__flyGovPin==null && window.__flyTerraPin==null));
  await page.evaluate(()=>{
    window.__r25ResidentBefore = new Map();
    window.__fly.engine.forEachLoadedTile(t=>{window.__r25ResidentBefore.set(t,t.model.geometry);});
  });
  const enhanced = async () => {
    await page.evaluate(()=>window.__flyStore.getState().setVisuals('enhanced'));
    await page.waitForFunction(()=>window.__fly.r25Ground?.live && window.__fly.r25Ground.pool?.resident>0 && (!window.__fly.r25Ground.atlas || window.__fly.r25Ground.atlas.pending===0),null,{timeout:60000});
    await page.waitForTimeout(1500);
  };
  await enhanced();
  const backfill = await page.evaluate(()=>{
    let same=0,filled=0;
    for(const [t,g] of window.__r25ResidentBefore) if(t.model?.geometry===g){same++;if(g.userData.r25Relief)filled++;}
    return {same,filled,backfill:{...window.__fly.r25Ground.backfill},bytes:window.__fly.r25Ground.textureBytes};
  });
  check('Classic resident tiles gain relief without replacing geometry',backfill.same>0 && backfill.filled>0 && backfill.backfill.completed>0,backfill);
  check('relief decodes remain bounded to two',backfill.backfill.peak<=2,backfill.backfill);
  if(process.env.R25_RUNTIME_DIAG==='1') {
    report.diagnostic=await page.evaluate(()=>{
      const gl=window.__flyGl,rows=[];
      window.__fly.engine.forEachLoadedTile(t=>{
        if(!t.model.visible)return;
        for(const m of (Array.isArray(t.model.material)?t.model.material:[t.model.material])){
          const p=gl.properties.get(m),h=m.userData.__r25Ground;
          rows.push({z:t.z,key:m.customProgramCacheKey(),v:m.version,gv:p.__version,program:p.currentProgram?.id,
            keys:p.programs?[...p.programs.keys()].map(k=>k.slice(-150)):null,
            holder:!!h,uniforms:Object.keys(p.uniforms||{}).filter(k=>k.startsWith('uR25')),
            hasRelief:h?.uR25HasRelief.value,uploaded:!!(h?.uR25Relief.value&&gl.properties.get(h.uR25Relief.value).__webglTexture)});
        }
      });return {rows,style:window.__flyStore.getState().mapStyle,phase:window.__flyStore.getState().phase,
        screen:window.__flyStore.getState().screen,toggles:window.__fly.r25Ground.toggles,frames:window.__fly.framesRendered,
        render:gl.info.render,rendererSame:gl===window.__flyComposer.getRenderer()};
    });
    await page.screenshot({path:path.join(out,'diagnostic.png')});report.status='DIAG';return;
  }

  for(let i=0;i<3;i++) {
    const before = await page.evaluate(()=>{
      const gl=window.__flyGl;
      window.__r25Textures = window.__fly.r25Ground.textures().map(t=>gl.properties.get(t)?.__webglTexture).filter(Boolean);
      return { uploaded:window.__r25Textures.length, bytes:window.__fly.r25Ground.textureBytes };
    });
    await page.evaluate(()=>window.__flyStore.getState().setVisuals('classic'));
    await page.waitForTimeout(400);
    const released = await page.evaluate(()=>({
      retained:window.__r25Textures.filter(t=>window.__groundTextureAudit.describeTexture(t)!=null).length,
      live:window.__fly.r25Ground.live,bytes:window.__fly.r25Ground.textureBytes,
    }));
    check(`toggle ${i+1}: every owned GPU texture released`,before.uploaded>0 && released.retained===0 && !released.live && released.bytes===0,{before,released});
    await enhanced();
    const uploaded = await page.evaluate(()=>window.__fly.r25Ground.textures().filter(t=>window.__flyGl.properties.get(t)?.__webglTexture).length);
    check(`toggle ${i+1}: cached Enhanced shader uploads its restored textures`,uploaded>0,{uploaded});
  }
  for(const tier of ['medium','low','high']) {
    await page.evaluate(t=>window.__flyStore.getState().setQualityTier(t),tier);
    await page.waitForTimeout(1800);
    check(`quality ${tier} keeps bounded resources`,await page.evaluate(()=>window.__fly.r25Ground.textureBytes<=5.5*1048576));
  }
  await page.evaluate(()=>window.__flyStore.getState().setMapStyle('toy'));
  await page.waitForFunction(()=>!window.__fly.r25Ground?.live,null,{timeout:20000});
  check('Neon style releases Enhanced terrain textures',await page.evaluate(()=>window.__fly.r25Ground.textureBytes===0));
  await page.evaluate(()=>window.__flyStore.getState().setMapStyle('satellite'));
  await enhanced();
  check('return to satellite restores terrain detail',await page.evaluate(()=>window.__fly.r25Ground.pool.resident>0));
  save();

  // Same real moving approach C/E/C, with the runtime's own flight integrator.
  // Only pilot commands are scripted. LOD, governor, time step and terrain run.
  for(const profile of ['classic','enhanced','classic']) {
    await holdStill(page,false);
    await page.evaluate(({P,profile})=>{
      const r=window.__fly; window.__flyStore.getState().setVisuals(profile);
      r.warpToGeo(P.lat,P.lon,{altM:P.altM,headingRad:0});r.autopilot.disengage();
      r.flight.heading=0;r.flight.pitch=0;r.flight.bank=0;
    },{P,profile});
    await page.waitForFunction(()=>!window.__fly.worldLoading && window.__fly.worldReadiness.ready,null,{timeout:60000});
    await page.waitForTimeout(5000);
    await page.evaluate(P=>{const r=window.__fly;r.warpToGeo(P.lat,P.lon,{altM:P.altM,headingRad:0});r.flight.pitch=0;},P);
    await page.waitForFunction(()=>!window.__fly.worldLoading,null,{timeout:30000});
    const result = await page.evaluate(async ()=>{
      const r=window.__fly,f=r.flight,step=f.step,gl=window.__flyGl;
      const frames=[],draws=[],tris=[],tiers=new Set();let distance=0,last=0;
      let prev={x:f.pos.x,z:f.pos.z};const start=performance.now(),heapStart=performance.memory?.usedJSHeapSize;
      f.step=function(dt,cmd){return step.call(this,dt,{...cmd,speedOverride:100,turn:0,pitch:0,boost:false});};
      await new Promise(resolve=>{
        const sample=t=>{
          if(last)frames.push(t-last);last=t;
          draws.push(gl.info.render.calls);tris.push(gl.info.render.triangles);
          distance+=Math.hypot(f.pos.x-prev.x,f.pos.z-prev.z)*Math.cos(f.latDeg*Math.PI/180);
          prev={x:f.pos.x,z:f.pos.z};tiers.add(window.__flyStore.getState().qualityTier);
          if(t-start<20000)requestAnimationFrame(sample);else resolve();
        };requestAnimationFrame(sample);
      });
      f.step=step;
      return {frames,draws,tris,distance,tiers:[...tiers],heapStart,heapEnd:performance.memory?.usedJSHeapSize,
        textures:gl.info.memory.textures,programs:gl.info.programs.length,r25Bytes:r.r25Ground.textureBytes,
        pins:{governor:window.__flyGovPin??null,terrain:window.__flyTerraPin??null},
        texMiB:window.__groundTextureAudit.snapshot().currentBytes/1048576};
    });
    const row={profile,distance:result.distance,p50:percentile(result.frames,.5),p95:percentile(result.frames,.95),max:Math.max(...result.frames),
      drawsP95:percentile(result.draws,.95),trisP95:percentile(result.tris,.95),tiers:result.tiers,heapStart:result.heapStart,heapEnd:result.heapEnd,
      textures:result.textures,programs:result.programs,r25Bytes:result.r25Bytes,texMiB:result.texMiB,pins:result.pins};
    report.flights.push(row);console.log('FLIGHT',JSON.stringify(row));save();
  }
  const [c,e,c2]=report.flights;
  check('actual movement exceeds 1.5 km in every 20-second leg',report.flights.every(r=>r.distance>1500));
  check('moving-flight p95 stays within 10% of both Classic controls',e.p95<=c.p95*1.1 && e.p95<=c2.p95*1.1,{classic:c.p95,enhanced:e.p95,classic2:c2.p95});
  check('matched quality tiers across moving comparisons',JSON.stringify(c.tiers)===JSON.stringify(e.tiers) && JSON.stringify(c2.tiers)===JSON.stringify(e.tiers));
  check('texture working set below 300 MiB',report.flights.every(r=>r.texMiB<=300));

  // Reviewable combined views, real mountains at a safe altitude.
  const S={lat:36.578,lon:-118.29,altM:5000};
  await page.evaluate(S=>window.__fly.warpToGeo(S.lat,S.lon,{altM:S.altM,headingRad:Math.PI*1.5}),S);
  await page.waitForFunction(()=>!window.__fly.worldLoading && window.__fly.worldReadiness.ready,null,{timeout:60000});
  await holdStill(page,true);
  await page.evaluate(()=>{window.__flyCloudFreeze=1;window.__fly.flight.pitch=-.10;});
  const sn=(await sunTimeMs(S,'noon')).tMs,sd=(await sunTimeMs(S,'dusk')).tMs;
  const shot=makeCanvasShot(page).shot;
  for(const [name,time] of [['day',sn],['dusk',sd],['night',sd+7200000]]) {
    await page.evaluate(t=>{window.__flySunOverride=t;window.__flyStore.getState().bumpWarpEpoch();},time);
    await page.waitForTimeout(4500);
    for(const profile of ['classic','enhanced']) {
      await page.evaluate(p=>window.__flyStore.getState().setVisuals(p),profile);
      await page.waitForTimeout(3000);
      await isolateCanvas(page,true);const buf=await shot();await isolateCanvas(page,false);
      const file=`sierra-${name}-${profile}.png`;fs.writeFileSync(path.join(out,file),buf);
      report.views.push({name,profile,file,time});
    }
  }
  check('no runtime or shader errors',!report.errors.length && !report.shaderErrors.length,{pageErrors:report.errors.length,shaderErrors:report.shaderErrors.length});
  report.status=report.checks.every(c=>c.pass)?'PASS':'FAIL';
 } catch(e){report.status='BLOCKED';report.reason=String(e.stack||e);console.error(e);}
 finally{save();await browser.close();process.exitCode=['PASS','DIAG'].includes(report.status)?0:report.status==='BLOCKED'?2:1;console.log(report.status);}
})();
