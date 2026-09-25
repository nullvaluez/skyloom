// Production profile round trips on real geography. The saved R25 ground
// component's independent fixture round trip failed; this checks the actual
// painted profile without its diagnostic overrides or fixture providers.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
const {enterFlight}=require('./_skip-menus');
const L=require('./_r25-luma');
const out=path.resolve(process.env.ROUNDTRIP_OUT||'.graphics-review/painterly/roundtrip-r5');
const crop={left:.05,top:.69,width:.90,height:.24};
const sites=[{name:'ohio',lat:40.20403,lon:-83.0896,altM:380,agl:100,headingRad:3.9,hour:18},
  {name:'nevada',lat:36.9174,lon:-116.094,altM:1767,agl:192,headingRad:79*Math.PI/180,hour:20}];
const report={status:'IN_PROGRESS',source:require('./graphics-source.cjs')(),checks:[],errors:[]};
fs.mkdirSync(out,{recursive:true});
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
(async()=>{let browser;try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(()=>{
    localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');
    localStorage.setItem('fly-aircraft','prop');localStorage.setItem('fly-quality-tier','high');
    localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');
    window.__flyTitleBypass=true;window.__flyGovPin='hold';window.__flyCloudFreeze=1;
    window.__flyWeatherOverride='clear';window.__flySunOverride=Date.UTC(2026,6,18,18);
  });
  await page.goto(`${process.env.FLY_URL||'http://localhost:3040'}/?graphicsReview=1`,{waitUntil:'domcontentloaded',timeout:90000});
  await enterFlight(page,{...sites[0],name:null},{timeoutMs:90000,waitReveal:true});
  const capture=async name=>{
    const bytes=await page.locator('canvas[data-engine]').screenshot();
    fs.writeFileSync(path.join(out,name+'.png'),bytes);
    return L.loadRegion(bytes,crop);
  };
  for(const site of sites){
    await page.evaluate(site=>{
      const rt=window.__fly,f=rt.flight;rt.autopilot.disengage();f.step=()=>{};
      rt.warpToGeo(site.lat,site.lon,{altM:site.altM,headingRad:site.headingRad,name:null});
      f.heading=site.headingRad;f.pitch=-.04;f.bank=0;f.speed=0;
      window.__flySunOverride=Date.UTC(2026,6,18,site.hour);
    },site);
    await page.waitForTimeout(18000);
    await page.evaluate(agl=>{const f=window.__fly.flight;f.pos.y=f.groundElev+agl;f.agl=agl;window.__fly.chaseCam?.snap?.();},site.agl);
    await page.waitForFunction(()=>window.__fly.worldReadiness?.ready&&window.__graphicsReview?.terrain?.sharp&&window.__fly.earthSurface?.materials?.painterly?.state==='ready',null,{timeout:60000});
    await page.waitForTimeout(8000);
    const first=await capture(site.name+'-enhanced');
    await page.waitForTimeout(1000);
    const floor=L.diffCensus(first,await capture(site.name+'-enhanced-floor'));
    await page.evaluate(()=>window.__flyStore.getState().setVisuals('classic'));
    await page.waitForTimeout(6000);await capture(site.name+'-classic');
    await page.evaluate(()=>window.__flyStore.getState().setVisuals('enhanced'));
    await page.waitForFunction(()=>window.__fly.earthSurface?.materials?.painterly?.state==='ready',null,{timeout:45000});
    await page.waitForTimeout(10000);
    const diff=L.diffCensus(first,await capture(site.name+'-enhanced-return'));
    const status=floor.mean>.5||floor.p99>2?'BLOCKED':diff.mean<=floor.mean+.5&&diff.p99<=Math.max(2,floor.p99+1)?'PASS':'FAIL';
    report.checks.push({site:site.name,status,crop,floor,diff});console.log(site.name,status,JSON.stringify({floor,diff}));save();
  }
  report.status=report.errors.length||report.checks.some(c=>c.status==='FAIL')?'FAIL':report.checks.some(c=>c.status==='BLOCKED')?'BLOCKED':'PASS';
}catch(e){report.status='BLOCKED';report.reason=e.stack;console.error(e.message);}finally{
  await browser?.close();save();console.log('PAINTERLY ROUNDTRIP: '+report.status);process.exitCode=report.status==='PASS'?0:report.status==='FAIL'?1:2;
}})();
