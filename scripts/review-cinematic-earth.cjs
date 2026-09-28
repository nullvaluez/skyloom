/* Live GPU review. No fixture masquerades as Earth, and no readiness failure is a pass.
 * --minutes=15 measures ordinary moving flight; --width=3840 --height=2160 for 4K. */
const fs = require('node:fs');
const { chromium } = require('playwright');
const { enterFlight } = require('./_skip-menus');
const groundBuildReceipt = require('./ground-build-receipt.cjs');
const args = Object.fromEntries(process.argv.slice(2).map(s => s.replace(/^--/, '').split('=')));
const out = args.output || '.graphics-review/cinematic-earth/after';
const sites = {
  alps: { lat: 46.58, lon: 7.94, altM: 3500, headingRad: 2.3, day: 12, golden: 17, night: 23 },
  manhattan: { lat: 40.72, lon: -74.02, altM: 900, headingRad: .3, day: 17, golden: 22, night: 5 },
  canyon: { lat: 36.09, lon: -112.1, altM: 2700, headingRad: 2, day: 20, golden: 1, night: 8 },
};
async function run() {
  fs.mkdirSync(out,{recursive:true});
  const report = { ...require('./graphics-source.cjs')(), started:new Date().toISOString(), errors:[], cases:[], timings:[], status:'IN_PROGRESS' };
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist']});
  try {
    const phone=args.phone==='1';
    const page=await browser.newPage({viewport:{width:Number(args.width||(phone?390:1920)),height:Number(args.height||(phone?844:1080))},deviceScaleFactor:phone?2:1,isMobile:phone,hasTouch:phone});
    let stage='boot';
    page.on('pageerror',e=>report.errors.push({stage,message:e.message,stack:e.stack}));
    page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/.test(m.text()))report.errors.push({stage,message:m.text()});});
    const site=sites[args.site||'alps'];
    await page.addInitScript(({site,quality})=>{
      localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-visuals','enhanced');
      localStorage.setItem('fly-quality-tier',quality);localStorage.setItem('fly-sound-on','0');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-crash-mode','forgiving');
      window.__flyWeatherOverride='baseline';window.__flySunOverride=Date.UTC(2026,8,27,site.day);
    },{site,quality:args.quality||(phone?'medium':'ultra')});
    await page.goto(`${args.url||'http://localhost:3063'}/?graphicsReview=1`,{waitUntil:'domcontentloaded',timeout:90000});
    if(args['build-id']){
      report.servedBuild=await groundBuildReceipt(page,args.url,args['build-id']);
      if(report.servedBuild.sourceSha256!==report.sourceSha256)throw Error('Served source differs from the working tree under review');
    }
    await enterFlight(page,site,{timeoutMs:180000,waitReveal:true});
    report.hardware=await page.evaluate(()=>{
      const gl=document.querySelector('canvas')?.getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');
      return {renderer:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),userAgent:navigator.userAgent};
    });
    console.log(JSON.stringify(report.hardware));
    await page.waitForTimeout(12000);
    const capture=async name=>{
      await page.screenshot({path:`${out}/${name}.png`});
      const data=await page.evaluate(()=>({boot:window.__flyBoot,worldLoading:window.__fly.worldLoading,
        sun:window.__fly.sun,quality:window.__flyStore.getState().qualityPreset,tier:window.__flyStore.getState().qualityTier,
        clouds:window.__fly.immersiveClouds,player:window.__flyStats?.player,gear:window.__fly.operations.gear,
        heat:(()=>{const u=window.__flyComposer?.passes.find(p=>p.name==='ImmersiveClouds')?.heat?.uniforms;return u?{power:u.cinemaHeatPower.value,a:u.cinemaHeatA.value.toArray(),b:u.cinemaHeatB.value.toArray()}:null;})(),
        aircraft:window.__fly.flight.aircraftVisual?.id,governor:window.__flyGov?.state(),
        draws:window.__flyStats?.drawCalls,triangles:window.__flyStats?.triangles,
        instruments:(()=>{const r=document.querySelector('[data-testid="flight-stats-strip"]')?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,inBounds:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}:null;})(),
        stats:window.__flyStats?.fx,ground:window.__fly.terraStats?.sharp}));
      report.cases.push({name,...data});console.log(`${name}: ${data.tier}, ground ${data.ground}`);
    };
    stage='day-cruise';await capture(stage);
    stage='day-boost';await page.keyboard.down('Shift');await page.waitForTimeout(2500);await capture(stage);await page.keyboard.up('Shift');
    if(args.minutes){
      stage='lived-flight';
      await page.evaluate(()=>{window.__cinemaFrames=[];let prev=performance.now();function tick(now){if(window.__cinemaFrames.length<120000)window.__cinemaFrames.push(now-prev);prev=now;window.__cinemaFrameId=requestAnimationFrame(tick);}window.__cinemaFrameId=requestAnimationFrame(tick);});
      const end=Date.now()+Number(args.minutes)*60000;let n=0;
      while(Date.now()<end){
        const key=n++%2?'a':'d';await page.keyboard.down(key);await page.waitForTimeout(2500);await page.keyboard.up(key);
        if(n%4===0){await page.keyboard.down('Shift');await page.waitForTimeout(3000);await page.keyboard.up('Shift');}
        await page.waitForTimeout(15000);console.log(`flight ${n}: ${Math.round((end-Date.now())/1000)}s remaining`);
      }
      report.timings=await page.evaluate(()=>{cancelAnimationFrame(window.__cinemaFrameId);return window.__cinemaFrames;});
      const sorted=report.timings.filter(x=>x>0).sort((a,b)=>a-b);
      report.performance={samples:sorted.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],p99:sorted[Math.floor(sorted.length*.99)],over50:sorted.filter(x=>x>50).length};
      await capture('after-flight');
    }
    stage='golden';await page.evaluate(({site})=>{window.__flySunOverride=Date.UTC(2026,8,27,site.golden);window.__fly.warpToGeo(site.lat,site.lon,{altM:site.altM,headingRad:site.headingRad});},{site});
    await page.waitForTimeout(15000);await capture(stage);
    stage='night';await page.evaluate(({site})=>{window.__flySunOverride=Date.UTC(2026,8,27,site.night);window.__fly.warpToGeo(site.lat,site.lon,{altM:site.altM,headingRad:site.headingRad});},{site});
    await page.waitForTimeout(18000);await capture(stage);
    stage='night-boost';await page.keyboard.down('Shift');await page.waitForTimeout(2500);await capture(stage);await page.keyboard.up('Shift');
    if(args.fleet==='1')for(const id of ['military','warbird-jet','warbird-prop','prop','glider','bizjet','airliner','cargo','fighter']){
      stage=`fleet-${id}`;await page.evaluate(id=>window.__flyStore.getState().setAircraftId(id),id);await page.waitForFunction(id=>window.__fly.flight.aircraftVisual?.id===id,id,{timeout:45000});await page.waitForTimeout(1000);await capture(stage);
    }
    stage='low';await page.evaluate(()=>window.__flyStore.getState().setQualityPreset('low'));await page.waitForTimeout(2500);await capture(stage);
    stage='classic';await page.evaluate(()=>window.__flyStore.getState().setVisuals('classic'));await page.waitForTimeout(3500);await capture(stage);
    report.checks={
      hud:report.cases.every(c=>c.instruments?.inBounds),
      ground:report.cases.every(c=>c.ground),
      heat:report.cases.filter(c=>c.name.endsWith('boost')&&c.clouds?.steps===96).every(c=>c.heat?.power>0&&[...c.heat.a,...c.heat.b].every(Number.isFinite)),
    };
    report.status=report.errors.length||!report.checks.hud||!report.checks.heat?'FAIL':!report.checks.ground?'BLOCKED':'REVIEW_REQUIRED';
  }catch(e){report.status='BLOCKED';report.reason=e.stack;console.error(e.message);}
  finally{await browser.close();fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));console.log(`Review ${report.status}`);}
}
run();
