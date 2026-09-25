/* Live-provider compatibility. Uses the dev diagnostics for fleet dimensions;
 * performance and allocation are measured separately against production. */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path');
const {enterFlight}=require('./_skip-menus');
const args=Object.fromEntries(process.argv.slice(2).map(s=>{const[k,...v]=s.replace(/^--/,'').split('=');return[k,v.join('=')||true];}));
const out=path.resolve(args.output||'.graphics-review/painterly/compatibility');fs.mkdirSync(out,{recursive:true});
const report={status:'IN_PROGRESS',source:require('./graphics-source.cjs')(),checks:[],errors:[],fleet:[]};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const check=(name,ok,detail)=>{report.checks.push({name,status:ok?'PASS':'FAIL',detail});console.log(`${ok?'PASS':'FAIL'} ${name}`);save();};
(async()=>{let browser;try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|TypeError|ReferenceError/.test(m.text()))report.errors.push(m.text().slice(0,3000));});
  await page.addInitScript(()=>{
    localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');localStorage.setItem('fly-aircraft','prop');
    localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-quality-tier','high');
    window.__flyTitleBypass=true;window.__flyGovPin='hold';window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,6,18,18);
  });
  await page.goto(`${args.url||'http://localhost:3039'}/?graphicsReview=1`,{waitUntil:'domcontentloaded',timeout:90000});
  await enterFlight(page,{lat:40.20403,lon:-83.0896,altM:400,headingRad:3.9,name:null},{timeoutMs:90000,waitReveal:true});
  await page.evaluate(()=>{window.__fly.flight.step=()=>{};});
  await page.waitForFunction(()=>window.__fly.earthSurface?.materials?.painterly?.state==='ready'&&window.__fly.r25Ground?.pool?.resident>0,null,{timeout:45000});
  report.boot=await page.evaluate(()=>({profile:window.__flyStore.getState().visuals,relief:window.__fly.r25Ground?.pool,materials:window.__fly.earthSurface?.materials}));
  check('fresh Enhanced boot loads paint and relief lazily',report.boot.profile==='enhanced'&&report.boot.relief.resident>0,report.boot);
  const fleet=[['fighter',20,'player-jet'],['military',17,'traffic-military'],['warbird-jet',12,'traffic-warbird-jet'],['warbird-prop',10,'traffic-warbird-prop'],['prop',9,'traffic-prop'],['glider',8,'traffic-glider'],['bizjet',20,'traffic-jet'],['airliner',57,'traffic-airliner'],['cargo',70,'traffic-cargo']];
  for(const[id,length,file]of fleet){
    await page.evaluate(id=>window.__flyStore.getState().setAircraftId(id),id);
    await page.waitForFunction(file=>window.__flyStats?.player?.url===`/models/${file}.glb`,file,{timeout:30000});await page.waitForTimeout(1200);
    const player=await page.evaluate(()=>window.__flyStats.player);report.fleet.push({id,...player});
    check(`${id}: actual model, dimensions and livery`,player.meshes>0&&Math.abs(player.lenM-length)<.01&&player.vertexColored>=player.withColorAttr,player);
    if(id==='prop'||id==='military')await page.screenshot({path:path.join(out,`${id}-enhanced.png`)});
  }
  await page.evaluate(()=>window.__flyStore.getState().setAircraftId('prop'));
  // Fail real imagery requests outside the loaded near region; no cache or API
  // is edited. Keep the coarse visible world, then allow the provider to retry.
  let intercepted=0;
  const pattern='**/World_Imagery/MapServer/tile/**';
  await page.context().route(pattern,r=>{intercepted++;return r.fulfill({status:503,body:'Controlled imagery outage'});});
  await page.evaluate(()=>window.__fly.warpToGeo(40.295,-83.31,{altM:450,headingRad:1.2,name:null}));await page.waitForTimeout(9000);
  report.outage=await page.evaluate(()=>{let n=0;window.__fly.engine.forEachLoadedTile(()=>n++);return{resident:n,readiness:window.__fly.worldReadiness};});
  check('imagery outage preserves resident geometry',intercepted>0&&report.outage.resident>0,{intercepted,...report.outage});
  await page.context().unroute(pattern);
  // Revisit an already seen region, then request the interrupted destination.
  await page.evaluate(()=>window.__fly.warpToGeo(40.20403,-83.0896,{altM:400,headingRad:3.9,name:null}));await page.waitForTimeout(6000);
  await page.evaluate(()=>window.__fly.warpToGeo(40.295,-83.31,{altM:450,headingRad:1.2,name:null}));
  await page.waitForFunction(()=>window.__fly.worldReadiness?.ready&&window.__graphicsReview?.terrain?.sharp,null,{timeout:60000}).catch(()=>{});
  report.recovery=await page.evaluate(()=>({ready:window.__fly.worldReadiness,terrain:window.__graphicsReview?.terrain,paint:window.__fly.earthSurface?.materials?.painterly}));
  check('imagery provider recovers on streamed revisit',report.recovery.ready?.ready&&report.recovery.terrain?.sharp&&report.recovery.paint?.state==='ready',report.recovery);
  check('no fleet or provider runtime/shader errors',report.errors.length===0,report.errors);
  report.status=report.checks.every(c=>c.status==='PASS')?'PASS':'FAIL';
}catch(e){report.status='BLOCKED';report.reason=e.stack;console.error(e.message);}finally{await browser?.close();save();console.log(`PAINTERLY COMPATIBILITY: ${report.status}`);process.exitCode=report.status==='PASS'?0:report.status==='FAIL'?1:2;}})();
