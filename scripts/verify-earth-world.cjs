/* Worldwide fixed-pose correctness/allocation evidence. Natural biomes need
 * terrain + parsed masks, not an invented building. Existing urban gates remain. */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path');
const fixtures=require('./earth-world-fixtures.cjs');
const {captureStreamersSettled,captureSceneCensus}=require('./graphics-capture-census.cjs');
const {captureBudgetChecks}=require('./graphics-capture-budget.cjs');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const[k,...v]=a.replace(/^--/,'').split('=');return[k,v.join('=')||true];}));
const url=args.url||'http://localhost:3033',output=args.output||'.graphics-review/stylized-earth/world/biomes';
(async()=>{
  const report={status:'BLOCKED',purpose:'Geographic, allocation and visual evidence; no frame-time certification',errors:[],shots:[]};let browser;
  try{
    fs.mkdirSync(output,{recursive:true});
    browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
    const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
    page.on('pageerror',e=>report.errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|TypeError|ReferenceError/.test(m.text()))report.errors.push(m.text().slice(0,2000));});
    await page.addInitScript(require('./ground-texture-audit.cjs').installGroundTextureAudit);
    await page.addInitScript(()=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,6,18,12);});
    await page.goto(`${url}/?graphicsReview=1`,{waitUntil:'domcontentloaded',timeout:90000});
    report.servedBuild=await require('./ground-build-receipt.cjs')(page,url,args['build-id']);
    await page.waitForFunction(()=>window.__flyBoot?.pct===100&&window.__fly?.earthSurface,null,{timeout:120000});
    report.hardware=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return{renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};});
    for(const name of String(args.sites||Object.keys(fixtures).join(',')).split(',')){
      const site=fixtures[name];if(!site)throw Error(`Unknown fixture ${name}`);
      for(const time of String(args.times||'noon').split(',')){
        const feet=Number(args.feet||1000);
        await page.evaluate(({site,time,feet})=>{
          const rt=window.__fly,f=rt.flight;rt.autopilot.disengage();
          window.__flySunOverride=Date.UTC(2026,6,18)+(site[time]??site.noon)*3600000;
          window.__flyWeatherOverride=time==='overcast'?'overcast':'baseline';
          rt.warpToGeo(site.lat,site.lon,{altM:site.ground+feet*.3048,name:null});f.heading=site.heading*Math.PI/180;f.pitch=-.08;f.bank=0;
          // Hold through the real integrator so its AGL/HUD/contact state keeps
          // updating. Replacing step() with a no-op left the displayed AGL stale.
          window.__earthWorldStep ??= f.step.bind(f);
          f.step=(dt,cmd)=>window.__earthWorldStep(dt,{...cmd,speedOverride:0,turn:0,pitch:0,boost:false});rt.chaseCam?.snap?.();
        },{site,time,feet});
        await page.waitForTimeout(16000);
        await page.waitForFunction(()=>window.__graphicsReview?.terrain?.sharp&&window.__fly?.earthSurface?.ready>=16&&window.__fly.earthSurface.pending===0,null,{timeout:90000});
        await page.waitForFunction(captureStreamersSettled,null,{timeout:45000,polling:500});
        await page.evaluate(feet=>{const rt=window.__fly;rt.flight.pos.y=rt.flight.groundElev+feet*.3048;rt.chaseCam?.snap?.();},feet);
        await page.waitForTimeout(4000);
        const row=await page.evaluate(({site})=>{
          const rt=window.__fly;let terrain=0,invalidBounds=0,failedImagery=0,invalidDem=0,parentDemTiles=0;
          rt.engine.map.traverse(o=>{if(!o.isTile||o.model?.parent!==o)return;terrain++;if(o.BBox?.isEmpty())invalidBounds++;const g=o.model.geometry;if(Math.abs(g.userData.surfaceMinZ??0)>20000||!g.attributes.position.array.every(Number.isFinite)||!g.attributes.normal.array.every(Number.isFinite))invalidDem++;if(g.userData.demSourceLevel<Math.min(o.z,rt.engine.map.demSource.maxLevel))parentDemTiles++;for(const m of(Array.isArray(o.model.material)?o.model.material:[o.model.material]))if(m?.userData?.flyError||m?.map?.userData?.flyError)failedImagery++;});
          const ground=rt.engine.getGroundAt(site.lon,site.lat);
          return{review:window.__graphicsReview,earthSurface:rt.earthSurface,terrain,invalidBounds,invalidDem,parentDemTiles,failedImagery,ground,agl:rt.flight.pos.y-rt.flight.groundElev,sun:rt.sun?.sinEl,
            textureAudit:window.__groundTextureAudit.snapshot(),pins:['__flyTerraPin','__flyGovPin','__flyDepthPin'].map(k=>window[k]??null)};
        },{site});
        const file=`${name}-${time}-${feet}.png`,sceneCensus=await page.evaluate(captureSceneCensus);
        await page.screenshot({path:path.join(output,file)});
        const urban=['tokyo','melton'].includes(name);
        const correctness=row.terrain>=20&&!row.invalidBounds&&!row.invalidDem&&!row.failedImagery&&row.pins.every(p=>p===null)&&row.earthSurface.revision===2&&row.earthSurface.maskBytes===6*1024*1024&&row.earthSurface.ready<=48&&Number.isFinite(row.ground?.elev)&&Math.abs(row.ground.elev)<20000&&Math.abs(row.agl-feet*.3048)<5&&(!urban||row.review?.buildings?.ready>0);
        const shot={name,site,time,file,sceneCensus,correctness,...row};report.shots.push(shot);
        console.log(`${name} ${time}: ${correctness?'READY':'FAIL'}, draws ${row.review?.drawCalls}, texture peak ${(row.textureAudit.peakBytes/1048576).toFixed(1)} MiB`);
        fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({...report,status:'IN_PROGRESS'},null,2));
      }
    }
    report.budgetChecks=captureBudgetChecks(report.shots,true);
    report.status=/software|swiftshader|llvmpipe/i.test(report.hardware.renderer)?'BLOCKED':report.errors.length||report.shots.some(s=>!s.correctness)||report.budgetChecks.some(b=>!b.pass)?'FAIL':'PASS';
    report.note='All warps share one browser context and its peak allocation history. Terrain and quality management remain active. Screenshot review is separate from correctness and allocation gates.';
  }catch(error){report.reason=error.stack;}
  finally{await browser?.close();fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(`EARTH WORLD: ${report.status}`);process.exitCode=report.status==='PASS'?0:report.status==='FAIL'?1:2;}
})();
