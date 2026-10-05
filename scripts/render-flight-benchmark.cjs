/* Production, live-world comparison. Touch emulation uses the host GPU and is
 * explicitly NOT a phone benchmark. Count rendered frames, not browser rAFs. */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { enterFlight } = require('./_skip-menus');
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const output = path.resolve(args.output || '.graphics-review/render-flight');
fs.mkdirSync(output, { recursive: true });
const cases = (args.cases || 'desktop-enhanced,phone-classic,phone-enhanced').split(',');
const review=args.review!=='0';
const report = { physicalPhone: false, graphicsReview:review, venue: 'Live imagery and geography; production build; host GPU', verdict:'PASS means no runtime/GL errors; frame times are observations, not an FPS certification.', cases: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const percentile = (values, fraction) => [...values].sort((a,b) => a-b)[Math.min(values.length-1, Math.floor(values.length*fraction))] ?? null;
(async () => {
  const browser = await chromium.launch({ channel:'chrome', headless:true, args:['--enable-gpu'] });
  try {
    for (const name of cases) {
      const phone = name.startsWith('phone'), tablet=name.startsWith('tablet'), mobile=phone||tablet, visuals = name.endsWith('classic') ? 'classic' : 'enhanced';
      const page = await browser.newPage({ viewport:phone ? { width:844,height:390 } : tablet ? {width:1024,height:768} : { width:1440,height:900 }, deviceScaleFactor:phone?3:tablet?2:1, isMobile:mobile, hasTouch:mobile });
      let profiler;
      const row = { name, errors: [], samples: [] }; report.cases.push(row); save();
      page.on('pageerror', e => row.errors.push(e.message));
      page.on('console', m => { if(m.type()==='error' && /shader|WebGL|GL_INVALID/.test(m.text()) && row.errors.length<20) row.errors.push(m.text().slice(0,1600)); });
      await page.addInitScript(({visuals,preset}) => {
        localStorage.setItem('fly-map-style-2','satellite'); localStorage.setItem('fly-visuals',visuals);
        if(preset) localStorage.setItem('fly-quality-tier',preset);
        localStorage.setItem('fly-controls-seen','1'); localStorage.setItem('fly-sound-on','0'); localStorage.setItem('fly-crash-mode','forgiving');
        window.__flySunOverride=Date.UTC(2026,8,27,17); window.__flyWeatherOverride='baseline';
      }, { visuals, preset:args.preset || null });
      try {
        await page.goto((args.url || 'http://localhost:3084')+'/?graphicsReview=1',{waitUntil:'domcontentloaded',timeout:90000});
        await enterFlight(page,{lat:40.72,lon:-74.02,altM:900,headingRad:.3,name:null},{timeoutMs:180000,waitReveal:true});
        row.boot = await page.evaluate(() => ({ preset:window.__flyStore.getState().qualityPreset, tier:window.__flyStore.getState().qualityTier, visuals:window.__flyStore.getState().visuals }));
        // Handles are installed at boot. Removing the review query now measures
        // ordinary flight, including the optimization which retires its census.
        if(!review)await page.evaluate(()=>history.replaceState(null,'',location.pathname));
        // Same settling window in both arms, with normal streaming/governor.
        await page.waitForTimeout(Number(args.settle || 15000));
        if(args.cpu==='1'){
          profiler=await page.context().newCDPSession(page);await profiler.send('Profiler.enable');
          await profiler.send('Profiler.setSamplingInterval',{interval:1000});await profiler.send('Profiler.start');
        }
        for(const turn of [0,.35]) {
          const sample = await page.evaluate(async ({turn,duration,review}) => {
            const rt=window.__fly,gl=window.__flyComposer.getRenderer(),ext=gl.getContext().getExtension('WEBGL_debug_renderer_info');
            const original=rt.flight.step,frames=[],draws=[],triangles=[],tiers=new Set();
            rt.flight.step=function(dt,cmd){return original.call(this,dt,{...cmd,turn,pitch:0,speedOverride:90,boost:false});};
            const start=performance.now();let last=start,endedAt=start,rendered=rt.framesRendered;
            await new Promise(resolve=>{
              function sample(){
                // rAF timestamps describe the start of the browser frame and
                // can predate a long render earlier in the same callback batch.
                const now=performance.now();
                if(rt.framesRendered!==rendered){frames.push(now-last);last=now;rendered=rt.framesRendered;
                  draws.push(gl.info.render.calls);triangles.push(gl.info.render.triangles);tiers.add(window.__flyStore.getState().qualityTier);}
                if(now-start<duration)requestAnimationFrame(sample);else{endedAt=now;resolve();}
              }requestAnimationFrame(sample);
            });
            rt.flight.step=original;
            return {turn,frames,draws,triangles,elapsedMs:endedAt-start,tailWaitMs:endedAt-last,renderedFps:frames.length*1000/(endedAt-start),tiers:[...tiers],gpu:ext&&gl.getContext().getParameter(ext.UNMASKED_RENDERER_WEBGL),
              dpr:gl.getPixelRatio(),resolution:[gl.domElement.width,gl.domElement.height],clouds:{...rt.immersiveClouds},
              governor:window.__flyGov.state(),profile:rt.cinemaProfile,shadows:rt.cinemaShadows,
              textures:gl.info.memory.textures,programs:gl.info.programs.length,terrain:rt.terraStats,
              resources:review?rt.cinemaResources:null,position:{...rt.flight.pos}};
          }, {turn,duration:Number(args.duration || 10000),review});
          const { frames,draws,triangles,...rest }=sample;
          // Review mode owns the per-frame render-info reset. Removing that
          // query leaves cumulative counters, which are not frame draw counts.
          row.samples.push({...rest,count:frames.length,p50:percentile(frames,.5),p95:percentile(frames,.95),p99:percentile(frames,.99),maxFrameMs:Math.max(...frames),meanFrameMs:frames.reduce((n,v)=>n+v,0)/frames.length,drawsP95:review?percentile(draws,.95):null,trianglesP95:review?percentile(triangles,.95):null});
          console.log(name,JSON.stringify(row.samples.at(-1)));save();
        }
        if(profiler){
          const {profile}=await profiler.send('Profiler.stop');
          fs.writeFileSync(path.join(output,`${name}.cpuprofile`),JSON.stringify(profile));
          const nodes=new Map(profile.nodes.map(n=>[n.id,n])),times=new Map();
          for(let i=0;i<(profile.samples||[]).length;i++)times.set(profile.samples[i],(times.get(profile.samples[i])||0)+(profile.timeDeltas?.[i]||0));
          row.cpu=Array.from(times,([id,us])=>({ms:us/1000,...nodes.get(id)?.callFrame})).sort((a,b)=>b.ms-a.ms).slice(0,30);
        }
        await page.screenshot({path:path.join(output,`${name}.png`),timeout:20000});
        row.status=row.errors.length?'FAIL':'PASS';
      } catch(error) { row.status='BLOCKED';row.reason=String(error.stack);console.log(name,row.reason); }
      finally {save();await page.close();}
    }
  } finally {save();await browser.close();}
  process.exitCode=report.cases.every(c=>c.status==='PASS')?0:1;
})();
