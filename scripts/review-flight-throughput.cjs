// Run against a local production build. The same real flight pipeline flies
// a timed route after the local tiles have settled, with a fixed quality rung.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const [origin, label, preset='high', kind='timing'] = process.argv.slice(2);
assert.ok(/^[\w-]+$/.test(label) && ['ultra','high'].includes(preset) && ['timing','profile','pixels','adaptive','player'].includes(kind));
const out=path.resolve('.graphics-review/flight-throughput',label,preset,kind);
fs.mkdirSync(out,{recursive:true});
function setup({preset,kind,playerProfile,playerHold}){
  if(kind!=='player')localStorage.setItem('fly-quality-tier',preset);
  localStorage.setItem('fly-controls-seen','1');
  localStorage.setItem('fly-sound-on','0');
  localStorage.setItem('fly-explorer-preferences-v1',JSON.stringify({version:1,settings:{tutorial:'done'}}));
  if(kind!=='adaptive'&&kind!=='player'||playerHold)window.__flyGovPin='hold';
  if(kind==='pixels')window.__flyCloudFreeze=true;
  const s=window.__throughput={phase:'warm',since:0,times:[],passes:{},rows:[],errors:[]};
  if(playerProfile){
    // Identify the r3f animation callback by the world frame it submits.
    // Only that callback owns the timer, including shadows, post and cockpit.
    const raf=window.requestAnimationFrame.bind(window),known=new WeakSet(),pending=[];
    let sequence=0,lastGl,timer;
    s.work=[];
    window.requestAnimationFrame=fn=>raf(time=>{
      const renderer=window.__flyComposer?.renderer,gl=renderer?.getContext();
      if(gl!==lastGl){
        lastGl=gl;timer=gl?.getExtension('EXT_disjoint_timer_query_webgl2');
        s.playerGpuTimer=!!timer;
      }
      const main=renderer?.__flyMainDraw,before=main?.frames,start=performance.now();
      const measured=known.has(fn)&&s.phase!=='warm'&&s.phase!=='done';
      let item;
      if(measured&&timer){
        while(pending.length&&gl.getQueryParameter(pending[0].query,gl.QUERY_RESULT_AVAILABLE)){
          const prior=pending.shift();
          if(!gl.getParameter(timer.GPU_DISJOINT_EXT))prior.row.gpuMs=gl.getQueryParameter(prior.query,gl.QUERY_RESULT)/1e6;
          gl.deleteQuery(prior.query);
        }
        if(++sequence%12===0&&pending.length<4&&!gl.getQuery(timer.TIME_ELAPSED_EXT,gl.CURRENT_QUERY)){
          item={query:gl.createQuery(),row:{t:start,dpr:renderer.getPixelRatio(),phase:s.phase}};
          gl.beginQuery(timer.TIME_ELAPSED_EXT,item.query);
        }
      }
      try{fn(time);}finally{
        if(item){gl.endQuery(timer.TIME_ELAPSED_EXT);pending.push(item);}
        if(main?.frames>before){
          known.add(fn);
          if(measured){
            const row=item?.row??{t:start,dpr:renderer.getPixelRatio(),phase:s.phase};
            row.cpuMs=performance.now()-start;s.work.push(row);
          }
        }
      }
    });
  }
  if(kind==='pixels'){
    s.dem={decoded:0,workerSkirts:0};
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker {
      constructor(...args){
        super(...args);
        this.addEventListener('message',({data})=>{
          if(!data?.attributes?.position?.value||!data.indices)return;
          s.dem.decoded++;
          if(data.r24Skirted)s.dem.workerSkirts++;
        });
      }
    };
  }
  const x=6378137*2.246*Math.PI/180,z=-6378137*Math.asinh(Math.tan(48.889*Math.PI/180));
  const heading=37*Math.PI/180,k=1/Math.cos(48.889*Math.PI/180);
  let flight,composer,previousRow=0,frame=0;
  function monitor(){
    const r=window.__fly, c=window.__flyComposer;
    if(r?.flight && flight!==r.flight && window.__flyStore?.getState().screen==='flight'){
      flight=r.flight;
      const step=flight.step.bind(flight);
      flight.step=(dt,controls)=>{
        step(dt,controls);
        const distance=s.phase==='moving' ? Math.max(0,performance.now()-s.since)*.001*399/1.94384449 : 0;
        flight.pos.set(x+distance*k*Math.sin(heading),2072*.3048,z-distance*k*Math.cos(heading));
        flight.heading=heading;flight.pitch=-9*Math.PI/180;
        flight.bank=0;flight.turnRate=0;flight.pitchRate=0;flight.speed=399/1.94384449;
      };
    }
    if(c && c!==composer){
      composer=c;
      const renderer=c.renderer, gl=renderer.getContext(), device=gl.getExtension('WEBGL_debug_renderer_info');
      s.gpu=gl.getParameter(device.UNMASKED_RENDERER_WEBGL);
      const timer=kind==='profile'&&gl.getExtension('EXT_disjoint_timer_query_webgl2');
      s.timer=!!timer;
      const pending=[],wrapped=new WeakSet();
      let active=false,current='outside';
      function measured(key,fn){
        const sample=s.phase!=='warm' && s.phase!=='done';
        const bucket=s.passes[s.phase+'/'+key]??=( {cpu:[],gpu:[]} );
        let query=null;
        if(timer && sample && !active && frame%8===0 && !gl.getQuery(timer.TIME_ELAPSED_EXT,gl.CURRENT_QUERY)){
          query=gl.createQuery();gl.beginQuery(timer.TIME_ELAPSED_EXT,query);active=true;
        }
        const start=performance.now();
        try{return fn();}finally{
          if(query){gl.endQuery(timer.TIME_ELAPSED_EXT);active=false;pending.push({query,bucket});}
          if(sample)bucket.cpu.push(performance.now()-start);
        }
      }
      if(kind==='profile'){
        s.emptyCityDraws={count:0,ms:0};
        const submit=renderer.renderBufferDirect;
        renderer.renderBufferDirect=function(camera,scene,g,material,object,group){
          if(s.phase==='warm'||s.phase==='done'||g.drawRange.count!==0||!Number.isInteger(g.userData.auxiliaryIndexCount)){
            return submit.call(this,camera,scene,g,material,object,group);
          }
          const start=performance.now();
          try{return submit.call(this,camera,scene,g,material,object,group);}
          finally{s.emptyCityDraws.count++;s.emptyCityDraws.ms+=performance.now()-start;}
        };
        const render=renderer.render;
        renderer.render=function(scene,cam){
          const name=scene.name||scene.children.find(o=>o.isMesh)?.material?.name||'scene';
          const key=current+'/'+name;
          return measured(key,()=>render.call(this,scene,cam));
        };
      }
      const draw=c.render;
      c.render=function(...args){
        frame++;
        if(kind==='profile'){
          for(const p of this.passes)if(!wrapped.has(p)){
            wrapped.add(p);
            const original=p.render;
            p.render=function(...pargs){
              current=this.name||this.constructor.name;
              try{return original.apply(this,pargs);}finally{current='outside';}
            };
          }
          if(pending.length && gl.getQueryParameter(pending[0].query,gl.QUERY_RESULT_AVAILABLE)){
            const disjoint=gl.getParameter(timer.GPU_DISJOINT_EXT);
            while(pending.length && gl.getQueryParameter(pending[0].query,gl.QUERY_RESULT_AVAILABLE)){
              const {query,bucket}=pending.shift();
              if(!disjoint)bucket.gpu.push(gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6);
              gl.deleteQuery(query);
            }
          }
        }
        const result=draw.apply(this,args), now=performance.now();
        if(s.phase!=='warm'&&s.phase!=='done')s.times.push([s.phase,now]);
        if(now-previousRow>=950){
          const b=r?.satBuildings?.stats,sky=r?.satSkyline?.stats;
          const sh=r?.cinemaShadows,gov=window.__flyGov?.state?.();
          s.rows.push({phase:s.phase,t:now,columns:b?.columns,near:b?.ready,far:sky?.ready,
            photos:r?.satSkyline?._photos?.stat?.fetched,dpr:renderer.getPixelRatio(),
            lights:sh?.cascades,shadowSize:sh?.size,governor:gov?.rung,
            target:gov?.targetFps,refresh:gov?.refresh,emaFps:gov?.emaFps,longFrac:gov?.longFrac,
            cadence:window.__flyFrame?.cadenceState?.(),
            calls:renderer.info.autoReset?undefined:renderer.info.render.calls,
            triangles:renderer.info.autoReset?undefined:renderer.info.render.triangles});
          previousRow=now;
        }
        return result;
      };
    }
    requestAnimationFrame(monitor);
  }
  requestAnimationFrame(monitor);
}
(async()=>{
  const args=['--use-angle=d3d11','--ignore-gpu-blocklist'];
  // Use the same production code paths as a player. Skyloom explicitly
  // installs an extra per-draw diagnostic census in WebDriver sessions.
  if(kind==='player')args.push('--disable-blink-features=AutomationControlled');
  const browser=await chromium.launch({channel:'chrome',args});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
    const errors=[],traffic=[];
    page.on('pageerror',e=>errors.push(String(e)));
    page.on('console',m=>{if(m.type()==='error'&&/WebGLProgram|shader error|context lost/i.test(m.text()))errors.push(m.text());});
    await page.addInitScript(setup,{preset,kind,playerProfile:kind==='player'&&process.env.FLY_PLAYER_PROFILE==='1',
      playerHold:kind==='player'&&process.env.FLY_PLAYER_HOLD==='1'});
    if(kind==='player'){
      page.on('response',async response=>{
        if(new URL(response.url()).pathname!=='/api/aircraft')return;
        try{
          const body=await response.json();
          traffic.push({count:(body.ac??body.aircraft??[]).length,source:response.headers()['x-adsb-source']});
        }catch{}
      });
    }else{
      await page.route('**/api/aircraft?*',route=>route.fulfill({json:{ac:[],now:1782046800}}));
    }
    const query=kind==='player'?'':'graphicsReview=1&';
    await page.goto(origin+'/?'+query+'at=48.889,2.246,2072&aircraft=airliner&sunUtc=2026-06-21T13:00:00Z&weather=baseline',{waitUntil:'domcontentloaded',timeout:100000});
    if(kind==='player'){
      await page.waitForFunction(()=>window.__flyBoot?.pct===100&&window.__flyDeepLink?.state==='launched'&&
        document.querySelector('[data-testid="flight-stats-strip"]')&&!document.querySelector('[data-testid="warp-hold"]')&&
        window.__flyComposer?.renderer.__flyMainDraw?.frames>5,null,{timeout:120000});
      assert.equal(await page.evaluate(()=>!!window.__fly||!!navigator.webdriver),false);
    }else{
      await page.waitForFunction(()=>{const r=window.__fly;return window.__flyStore?.getState().screen==='flight' && !r.worldLoading && r.criticalTerrain?.status==='ready' && r.cockpitPreparation?.status==='ready' && r.satBuildings?.stats?.ready>=16 && r.satSkyline?._photos?.stat?.fetched>=23;},null,{timeout:120000});
    }
    await page.waitForTimeout(3500);
    let cdp;
    if(kind==='profile'){
      cdp=await page.context().newCDPSession(page);
      await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval',{interval:700});await cdp.send('Profiler.start');
    }
    const phases=kind==='player'?['entry','moving']:['stationary','moving'];
    for(const phase of phases){
      await page.evaluate(phase=>{const s=window.__throughput;s.phase=phase;s.since=performance.now();},phase);
      await page.waitForTimeout(phase==='moving'?24000:11000);
      if(kind==='pixels' && phase==='stationary'){
        await page.screenshot({path:path.join(out,'cockpit.png')});
        const geometry=await page.evaluate(async()=>{
          const r=window.__fly, tiles=[];
          r.engine.map.rootTile.traverse(tile=>{
            const g=tile.model?.geometry;
            if(tile.isTile&&g)tiles.push([tile.z+'/'+tile.x+'/'+tile.y,g]);
          });
          const rows=await Promise.all(tiles.map(async([key,g])=>{
            const arrays=[g.index,g.attributes.position,g.attributes.normal,g.attributes.uv];
            const digest=await Promise.all(arrays.map(async attr=>{
              const hash=await crypto.subtle.digest('SHA-256',attr.array);
              return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');
            }));
            return [key,digest];
          }));
          return Object.fromEntries(rows);
        });
        fs.writeFileSync(path.join(out,'terrain.json'),JSON.stringify(geometry));
      }
    }
    await page.evaluate(()=>window.__throughput.phase='done');
    if(cdp){const data=await cdp.send('Profiler.stop');fs.writeFileSync(path.join(out,'cpu.json'),JSON.stringify(data.profile));}
    const data=await page.evaluate(()=>window.__throughput);
    const summary={};
    for(const phase of phases){
      const times=data.times.filter(row=>row[0]===phase).map(row=>row[1]);
      assert.ok(times.length>40,'No flight draws in '+phase);
      const dt=times.slice(1).map((t,i)=>t-times[i]).sort((a,b)=>a-b);
      summary[phase]={fps:+((times.length-1)*1000/(times.at(-1)-times[0])).toFixed(2),
        p50:dt[Math.floor(dt.length*.5)],p95:dt[Math.floor(dt.length*.95)],p99:dt[Math.floor(dt.length*.99)],
        over50:dt.filter(t=>t>50).length,draws:times.length};
    }
    assert.deepEqual(errors,[]);
    if(kind!=='adaptive'&&kind!=='player')assert.ok(data.rows.filter(x=>x.phase==='stationary'||x.phase==='moving').every(x=>x.governor===0));
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({...data,summary,errors,traffic}));
    console.log(JSON.stringify({label,preset,kind,summary,gpu:data.gpu,timer:data.timer}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
