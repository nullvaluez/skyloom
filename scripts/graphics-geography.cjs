/* Production geography/motion QA. No _boot.js, governor/terrain/depth pins, or
 * fabricated traffic. Static visits freeze pose; the final pass releases X/Z
 * to the real flight model. Unsupported contracts are BLOCKED, never PASS. */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k,v] = a.replace(/^--/,'').split('='); return [k,v ?? true]; }));
const output = path.resolve(args.output || '.graphics-review/geography');
const sites = {
  manhattan: {lat:40.7028,lon:-74.017,ground:0,heading:0.3,noon:17},
  ohio: {lat:40.20403,lon:-83.0896,ground:280,heading:3.9,noon:18},
  melton: {lat:-37.683,lon:144.582,ground:135,heading:1.9,noon:2},
  paris: {lat:48.8579,lon:2.301,ground:35,heading:2.6,noon:12},
  owens: {lat:36.601,lon:-118.06,ground:1150,heading:1.9,noon:20},
};

(async () => {
  const report = {...require('./graphics-source.cjs')(),status:'BLOCKED',checks:[],visits:[],errors:[],
    resolution:[Number(args.width||1920),Number(args.height||1080)],stage:args.stage||'cinematic',purpose:'Geographic and lifecycle correctness; not a visual or performance certification'};
  const check = (name,status,detail) => report.checks.push({name,status,detail});
  const save = () => { fs.mkdirSync(output,{recursive:true}); fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)); };
  let browser;
  try {
    report.status='IN_PROGRESS';save();
    browser = await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
    const page = await browser.newPage({viewport:{width:report.resolution[0],height:report.resolution[1]},deviceScaleFactor:1});
    page.on('pageerror',e => report.errors.push(e.message));
    page.on('console',m => { if(m.type()==='error' && /shader|WebGL|ReferenceError|TypeError/.test(m.text())) report.errors.push(m.text().slice(0,1500)); });
    await page.addInitScript(() => {
      localStorage.setItem('fly-map-style-2','satellite'); localStorage.setItem('fly-quality-tier','high');
      localStorage.setItem('fly-sound-on','0'); localStorage.setItem('fly-controls-seen','1');
      window.__flyWeatherOverride='baseline'; window.__flySunOverride=Date.UTC(2026,6,18,17);
      // Observe actual drawn labels, without duplicating projection/picking math.
      // This records Canvas output only; selection still uses real pointer events.
      const fillText=CanvasRenderingContext2D.prototype.fillText;
      window.__geographyLabels=new Map();
      CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest) {
        if(this.canvas.clientWidth>1000 && / · .* · [\d.]+nm$/.test(text)) {
          const labels=window.__geographyLabels;
          if(labels.size>200)labels.clear();
          labels.set(String(text),{text:String(text),x,y:y-5,at:performance.now()});
        }
        return fillText.call(this,text,x,y,...rest);
      };
    });
    await page.goto(`${args.url || 'http://localhost:3010'}/?graphics=${encodeURIComponent(report.stage)}&graphicsReview=1`,{waitUntil:'domcontentloaded',timeout:90000});
    await page.waitForFunction(() => window.__flyBoot?.pct===100 && window.__fly?.engine && window.__flyStore,null,{timeout:90000});
    report.hardware = await page.evaluate(() => {
      const gl=document.createElement('canvas').getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');
      return {webgl2:!!gl,renderer:ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)};
    });
    if(!report.hardware.renderer || /swiftshader|software|llvmpipe/i.test(report.hardware.renderer)) throw Error('Hardware WebGL renderer unavailable');
    check('hardware','PASS',report.hardware);
    const pins = await page.evaluate(() => Object.fromEntries(['__flyTerraPin','__flyGovPin','__flyDepthPin','__flyAerialOverride'].map(k=>[k,window[k] ?? null])));
    check('shipped subsystem controls',Object.values(pins).every(v=>v===null)?'PASS':'BLOCKED',pins);

    for(const name of (args.sites ? args.sites.split(',') : ['manhattan','ohio','melton','paris','owens','manhattan','ohio'])) {
      const site=sites[name],label=`${report.visits.length+1}-${name}`;
      const warp = await page.evaluate(site => {
        const rt=window.__fly,f=rt.flight,engine=rt.engine;
        clearInterval(window.__geographyHold);
        const before=engine.geoToWorld(site.lon,site.lat,site.ground+110).clone(),epoch=rt.origin.epoch;
        window.__flySunOverride=Date.UTC(2026,6,18,site.noon);
        const accepted=rt.warpToGeo(site.lat,site.lon,{altM:site.ground+110,headingRad:site.heading,name:null});
        const after=engine.geoToWorld(site.lon,site.lat,site.ground+110).clone();
        const pose=window.__geographyPose=f.pos.clone();
        window.__geographyHold=setInterval(()=>{f.pos.copy(pose);f.heading=site.heading;f.pitch=0;f.bank=0;f.speed=0;},16);
        return {accepted,epochBefore:epoch,epochAfter:rt.origin.epoch,absoluteCoordinateDrift:before.distanceTo(after)};
      },site);
      check(`${label} warp/rebase`,warp.accepted && warp.epochAfter>warp.epochBefore && warp.absoluteCoordinateDrift<0.001?'PASS':'FAIL',warp);
      let ready=true;
      try {
        // Let frame-owned streaming consume the warp. Old ready chunks/stats can
        // briefly outlive it; require nearby geometry at the actual destination.
        await page.waitForTimeout(1500);
        await page.waitForFunction(() => {
          const rt=window.__fly,f=rt.flight;
          const s=rt.satBuildings.stats;
          return window.__graphicsReview?.terrain?.sharp && s.draping===0 && s.building===0 && s.queued===0 && [...rt.satBuildings.chunks.values()].some(c=>
            c.state==='ready' && Math.hypot(c.cx-f.pos.x,c.cz-f.pos.z)<4000);
        },null,{timeout:Number(args.settle || 45000)});
      } catch { ready=false; }
      if(report.visits.length===0) {
        const heights=ready ? await require('./graphics-height-check.cjs')(page) : {status:'BLOCKED',reason:'Destination not ready'};
        check('supplied mapped heights',heights.status,heights);
      }
      const visit = await page.evaluate(({site,ready}) => {
        const rt=window.__fly,f=rt.flight,e=rt.engine,b=rt.satBuildings,o=rt.origin.anchor;
        const checks=[],add=(name,status,detail)=>checks.push({name,status,detail});
        const samples=[0,91.44,914.4].map(alt=>{
          const p=e.geoToWorld(site.lon,site.lat,alt),geo=e.worldToGeo(p);
          return {alt,lonError:geo.x-site.lon,latError:geo.y-site.lat,altError:geo.z-alt};
        });
        add('coordinate roundtrips',samples.every(s=>Math.abs(s.lonError)<1e-7 && Math.abs(s.latError)<1e-7 && Math.abs(s.altError)<0.001)?'PASS':'FAIL',samples);
        add('real imagery/buildings ready',ready && b?.visuals && window.__flyStore.getState().mapStyle==='satellite'?'PASS':'BLOCKED',
          {terrain:window.__graphicsReview?.terrain,buildings:b?.stats,tier:window.__flyStore.getState().qualityTier});
        const ground=e.getGroundAt(site.lon,site.lat);
        if(ground?.tileZ>=14) window.__geographyPose.y=ground.elev+110;
        const rows=[];
        for(const c of b?.chunks.values() ?? []) {
          if(c.state!=='ready' || !c.mesh?.visible || c.coarse) continue;
          const p=c.mesh.geometry.attributes.position,a=c.mesh.geometry.attributes.aBendAnchor;
          if(!p || !a)continue;
          // FLASH_GUARD can remove triangles without compacting attributes.
          // Only vertices still referenced by a draw describe rendered contact.
          const index=c.mesh.geometry.index;
          const referenced=index ? new Set(index.array) : null;
          let row=null,lastX=NaN,lastZ=NaN;
          for(let i=0;i<p.count;i++) {
            if(referenced && !referenced.has(i))continue;
            const x=a.getX(i),z=a.getY(i);
            if(x!==lastX || z!==lastZ) {
              row={x:x+c.cx,z:z+c.cz,base:Infinity,top:-Infinity};
              row.distance=Math.hypot(row.x-f.pos.x,row.z-f.pos.z);rows.push(row);lastX=x;lastZ=z;
            }
            row.base=Math.min(row.base,p.getY(i)+c.mesh.position.y);row.top=Math.max(row.top,p.getY(i)+c.mesh.position.y);
          }
        }
        rows.sort((a,b)=>a.distance-b.distance);
        const contact=rows.slice(0,3).map(r=>{
          const geo=e.worldToGeo(f.pos.clone().set(r.x,0,r.z)),g=e.getGroundAt(geo.x,geo.y);
          return {...r,ground:g,baseOffset:g?r.base-g.elev:null};
        });
        // Satellite walls deliberately sink 6m. Elevated min_height is not
        // retained, so positive bases cannot be labelled erroneous from this data.
        add('near building contact',!ready || !contact.length || contact.some(r=>!(r.ground?.tileZ>=14) || r.baseOffset>1.5)?'BLOCKED':
          contact.every(r=>r.baseOffset>=-8 && r.baseOffset<=1.5)?'PASS':'FAIL',contact);
        const columns=b?.queryColumns(f.pos.x,f.pos.z,2500) ?? [];
        const valid=columns.every(c=>[c.x,c.z,c.topY,c.r].every(Number.isFinite) && c.r>0);
        const lookup=columns.slice(0,3).every(c=>b.queryColumns(c.x,c.z,0).some(q=>q.x===c.x && q.z===c.z && q.topY===c.topY));
        add('collision columns',!columns.length || !ready?'BLOCKED':valid && lookup?'PASS':'FAIL',
          {count:columns.length,finitePositive:valid,centerQueriesFindColumns:lookup,sample:columns.slice(0,3)});
        const rendered=[];
        for(const c of b?.chunks.values() ?? []) if(c.state==='ready' && c.mesh?.visible) {
          const m=c.mesh.matrixWorld.elements;
          rendered.push(Math.hypot(m[12]+o.x-c.mesh.position.x,m[14]+o.z-c.mesh.position.z));
        }
        add('rendered origin alignment',!ready || !rendered.length?'BLOCKED':Math.max(...rendered)<0.01?'PASS':'FAIL',{maxError:rendered.length?Math.max(...rendered):null});
        return {checks,origin:{...o},epoch:rt.origin.epoch,ground};
      },{site,ready});
      await page.waitForTimeout(2000);
      const clearance = await page.evaluate(() => {
        const rt=window.__fly,p=rt.camera.position.clone();p.x+=rt.origin.anchor.x;p.z+=rt.origin.anchor.z;
        const geo=rt.engine.worldToGeo(p),ground=rt.engine.getGroundAt(geo.x,geo.y);
        return {ground,cameraY:p.y,clearance:ground?p.y-ground.elev:null};
      });
      check(`${label} camera clearance`,!ready || !(clearance.ground?.tileZ>=14)?'BLOCKED':clearance.clearance>1?'PASS':'FAIL',clearance);
      for(const c of visit.checks)check(`${label} ${c.name}`,c.status,c.detail);
      report.visits.push({name,warp,...visit});
      await page.screenshot({path:path.join(output,`${label}.png`)});
      console.log(`Geography ${label}: ${ready?'resident':'BLOCKED residency'}`);save();
    }

    // Real X/Z integration: steer a level Ohio pass for long enough to cross
    // the normal 10km Mercator rebase threshold. Never call rebase privately.
    await page.evaluate(() => {
      clearInterval(window.__geographyHold);
      const rt=window.__fly,f=rt.flight;
      rt.autopilot.disengage();window.__flyStore.getState().setSpeedPreset('cruise');
      const run=window.__geographyRun={start:performance.now(),samples:[],rebases:[],running:true};
      let last=null;
      function tick(now) {
        if(!run.running)return;
        const t=(now-run.start)/1000,k=1/Math.cos(f.latDeg*Math.PI/180),o=rt.origin.anchor;
        f.heading=1.57+0.12*Math.sin(t/8);f.pitch=0;f.pos.y=f.groundElev+110;
        const hit=rt.engine.getGroundInfoAtWorld(f.pos),material=hit?.object?.material;
        const materials=Array.isArray(material)?material:[material];
        const imagery=!!hit && materials.length>0 && materials.every(m=>m?.map?.image && !m.userData.flyError);
        const sample={time:now,x:f.pos.x,y:f.pos.y,z:f.pos.z,k,epoch:rt.origin.epoch,
          camera:[rt.camera.position.x+o.x,rt.camera.position.y,rt.camera.position.z+o.z],
          sharp:!!window.__graphicsReview?.terrain?.sharp,imagery,ready:rt.satBuildings?.stats?.ready ?? 0};
        if(last && sample.epoch!==last.epoch) {
          const worldStep=Math.hypot(sample.x-last.x,sample.y-last.y,sample.z-last.z);
          const cameraStep=Math.hypot(...sample.camera.map((v,i)=>v-last.camera[i]));
          run.rebases.push({worldStep,cameraStep,intervalMs:now-last.time,epoch:sample.epoch});
        }
        run.samples.push(sample);last=sample;run.raf=requestAnimationFrame(tick);
      }
      run.raf=requestAnimationFrame(tick);
    });
    const seconds=Math.max(20,Number(args.seconds || 65));
    for(let elapsed=0;elapsed<seconds;elapsed+=10) { await page.waitForTimeout(Math.min(10,seconds-elapsed)*1000);console.log(`Low pass ${Math.min(seconds,elapsed+10)}/${seconds}s`); }
    const motion=await page.evaluate(() => { const r=window.__geographyRun;r.running=false;cancelAnimationFrame(r.raf);return {samples:r.samples,rebases:r.rebases}; });
    let distance=0;for(let i=1;i<motion.samples.length;i++)distance+=Math.hypot(motion.samples[i].x-motion.samples[i-1].x,motion.samples[i].z-motion.samples[i-1].z)/motion.samples[i].k;
    report.motion={distanceM:distance,seconds,samples:motion.samples.filter((_,i)=>i%60===0),rebases:motion.rebases};
    check('translating low pass',distance>=3000?'PASS':'BLOCKED',{distanceM:distance,seconds});
    check('moving content readiness',motion.samples.length && motion.samples.every(s=>s.ready>0 && s.imagery)?'PASS':'BLOCKED',{
      samples:motion.samples.length,missingImageryFrames:motion.samples.filter(s=>!s.imagery).length,
      absentBuildingFrames:motion.samples.filter(s=>!s.ready).length,refiningFrames:motion.samples.filter(s=>!s.sharp).length,
      contract:'Every observed frame retains real terrain imagery and buildings. Refining a resident parent tile is reported separately from missing imagery; fixed-pose captures still require target sharpness.'});
    check('natural rebase camera continuity',!motion.rebases.length?'BLOCKED':motion.rebases.every(r=>r.cameraStep<=Math.max(150,r.worldStep*4+20))?'PASS':'FAIL',motion.rebases);

    let picked=null;
    for(let attempt=0;attempt<3 && !picked;attempt++) {
      const label=await page.evaluate(() => {
        const rt=window.__fly;
        return [...window.__geographyLabels.values()].filter(l=>performance.now()-l.at<100 && l.x>150 && l.x<1750 && l.y>160 && l.y<900)
          .map(l=>({...l,hex:[...rt.traffic.tracks].find(([hex,t])=>l.text.startsWith(`${t.meta?.flight || t.meta?.r || hex.toUpperCase()} · `))?.[0]})).find(l=>l.hex) ?? null;
      });
      if(!label){await page.waitForTimeout(1000);continue;}
      await page.mouse.move(label.x,label.y);
      try {
        await page.waitForFunction(hex=>window.__fly.hoverHex===hex,label.hex,{timeout:800});
        await page.mouse.click(label.x,label.y);
        await page.getByTestId('inspect-card').waitFor({state:'visible',timeout:1500});
        picked={...label,selected:await page.evaluate(()=>window.__flyStore.getState().inspectHex)};
        await page.getByRole('button',{name:'esc / close',exact:true}).click();
      } catch { /* Moving targets can leave the observed point; resample. */ }
    }
    check('pointer picking',!picked?'BLOCKED':picked.selected===picked.hex?'PASS':'FAIL',picked ?? 'No live rendered label remained under the pointer long enough to inspect.');

    const target=await page.evaluate(() => {
      const rt=window.__fly;
      const entry=[...rt.traffic.tracks].find(([,t])=>t.stale!==2 && t.fix1 && [t.rx,t.ry,t.rz].every(Number.isFinite));
      return entry?{hex:entry[0],accepted:rt.interceptHex(entry[0])}:null;
    });
    if(!target?.accepted)check('live target lock/inspect access','BLOCKED','No fresh live track accepted by runtime.interceptHex.');
    else {
      try {
        await page.waitForFunction(hex=>window.__fly.targeting.lockedHex===hex && window.__flyStore.getState().lockedHex===hex,target.hex,{timeout:4000});
        await page.keyboard.press('t');
        await page.getByTestId('inspect-card').waitFor({state:'visible',timeout:4000});
        const selected=await page.evaluate(()=>window.__flyStore.getState().inspectHex);
        check('live target lock/inspect access',selected===target.hex?'PASS':'FAIL',{...target,selected,method:'real intercept action, store lock, keyboard T, visible inspect close control'});
        await page.getByRole('button',{name:'esc / close',exact:true}).click();
      } catch(e) {
        const stillLocked=await page.evaluate(hex=>window.__fly.targeting.lockedHex===hex && window.__fly.traffic.tracks.get(hex)?.stale!==2,target.hex);
        const state=await page.evaluate(()=>{const s=window.__flyStore.getState();return {phase:s.phase,inspectHex:s.inspectHex,atlasOpen:s.atlasOpen};});
        check('live target lock/inspect access',stillLocked?'FAIL':'BLOCKED',{...target,reason:e.message,state});
      }
    }
    report.status=report.errors.length || report.checks.some(c=>c.status==='FAIL')?'FAIL':report.checks.some(c=>c.status==='BLOCKED')?'BLOCKED':'PASS';
  } catch(e) { report.reason=e.message;report.status=report.errors.length?'FAIL':'BLOCKED'; }
  finally {
    await browser?.close();
    report.summary=Object.fromEntries(['PASS','FAIL','BLOCKED'].map(s=>[s,report.checks.filter(c=>c.status===s).length]));
    save();console.log(`GEOGRAPHY: ${report.status} (${output})`);
    process.exitCode=report.status==='PASS'?0:report.status==='BLOCKED'?2:1;
  }
})();
