// Timing runs never read pixels. Pixel runs inspect both composer output and
// sampled browser presentations, including changes outside the composer draw.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const [origin, label, mode = 'timing', durationArg] = process.argv.slice(2);
const durationMs = durationArg === undefined ? 45000 : Number(durationArg) * 1000;
assert.ok(Number.isFinite(durationMs) && durationMs >= 10000 && durationMs <= 180000);
const preset=process.env.FLY_REVIEW_PRESET||'high';
assert.ok(['low','medium','high','ultra'].includes(preset));
assert.ok(origin && /^[\w-]+$/.test(label) && ['timing','pixels','cruise','cruise-pixels','profile','stills','entry-pixels','hangar'].includes(mode));
const out = path.resolve('.graphics-review/argenteuil-loading',label,mode);
const comparison = origin === 'compare';
const url = comparison ? new URL('http://localhost/') : new URL(origin);
Object.entries({...(mode==='hangar'?{}:{at:'48.889,2.246,2072',aircraft:'airliner'}),graphicsReview:'1',
  sunUtc:'2026-06-21T13:00:00Z',weather:'baseline'}).forEach(([k,v])=>url.searchParams.set(k,v));
fs.mkdirSync(out,{recursive:true});

async function compare() {
  if(mode==='cruise'){
    const reference=path.resolve('.graphics-review/argenteuil-loading/cadence-before',mode);
    const reports=[reference,out].map(arm=>JSON.parse(fs.readFileSync(path.join(arm,'report.json'))));
    const width=900, height=235, left=145, span=725, seconds=45;
    const elements=[];
    const caption=(x,y,size,value,color='#eaeff4')=>elements.push(
      '<text font-family="Arial, sans-serif" x="'+x+'" y="'+y+'" font-size="'+size+'" fill="'+color+'">'+value+'</text>');
    caption(16,32,23,'Did the world keep drawing during flight?');
    caption(16,55,14,'Completed world draws per second along the same 399 kt route. Dark cells indicate no completed draw.','#b4c1cc');
    for(const [i,report] of reports.entries()){
      const bins=Array(seconds).fill(0);
      for(const t of report.drawTimes){
        const bin=Math.floor((t-report.reveal)/1000);
        if(bin>=0 && bin<seconds)bins[bin]++;
      }
      const y=78+i*49;
      caption(16,y+18,15,i?'Corrected defaults':'Previous build');
      for(const [s,n] of bins.entries()){
        const color=n===0?'#242b36':n<5?'#886941':n<15?'#568e8b':n<25?'#75b9b1':'#a6e1d2';
        elements.push('<rect x="'+(left+s*span/seconds)+'" y="'+y+'" width="'+(span/seconds-1)+'" height="26" fill="'+color+'"/>');
      }
    }
    for(const t of [0,10,20,30,40,45])caption(left+t*span/seconds-4,179,12,t+' s','#c1cdd4');
    const worst=reports.map(r=>(r.summary.renderWorst/1000).toFixed(2));
    caption(16,211,15,'Longest interval between draws     '+worst[0]+' s previous     /     '+worst[1]+' s corrected');
    const svg='<svg width="'+width+'" height="'+height+'" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#141b23"/>'+elements.join('')+'</svg>';
    await sharp(Buffer.from(svg)).webp({lossless:true}).toFile(path.resolve('docs/reviews/building-approach/argenteuil-motion.webp'));
    return;
  }
  if(mode==='entry-pixels'){
    const prior=path.resolve('.graphics-review/argenteuil-loading/optical',mode);
    const layers=[];
    for(const [i,dir] of [prior,out].entries()){
      for(const [j,seconds] of [1,8].entries()){
        layers.push({input:await sharp(path.join(dir,'entry-'+seconds+'s.jpg')).resize(360,225).png().toBuffer(),
          left:12+i*366,top:74+j*255});
      }
    }
    const type='<svg width="750" height="600" xmlns="http://www.w3.org/2000/svg"><g font-family="Arial, sans-serif" fill="#f1f4f6">'+
      '<text x="12" y="29" font-size="21">The first seconds over the Seine</text>'+
      '<text x="12" y="58" font-size="16">Without the interim terrain material · +1 s</text>'+
      '<text x="378" y="58" font-size="16">Corrected build · +1 s</text>'+
      '<text x="12" y="319" font-size="15">+8 s</text><text x="378" y="319" font-size="15">+8 s</text>'+
      '<text x="12" y="579" font-size="10">Chrome screen samples · Esri, Maxar, Earthstar Geographics · ESA WorldCover · © OpenStreetMap contributors, OpenMapTiles / OpenFreeMap</text></g></svg>';
    layers.push({input:Buffer.from(type),left:0,top:0});
    await sharp({create:{width:750,height:600,channels:3,background:'#141b23'}}).composite(layers)
      .webp({quality:94}).toFile(path.resolve('docs/reviews/building-approach/argenteuil-entry.webp'));
    return;
  }
  const reference=path.resolve('.graphics-review/argenteuil-loading/before',mode==='timing'?'stills':mode);
  const records=[reference,out].map(dir=>JSON.parse(fs.readFileSync(path.join(dir,'report.json'))));
  for(const prop of ['eye','rotation','position','fov']) assert.deepEqual(records[0][prop],records[1][prop],prop);
  if(mode==='stills'||mode==='timing'){
    assert.equal(records[0].rows.at(-1).dpr,records[1].rows.at(-1).dpr);
    assert.equal(records[0].rows.at(-1).columns,records[1].rows.at(-1).columns);
    assert.equal(records[0].rows.at(-1).photo,records[1].rows.at(-1).photo);
    assert.equal(records[0].rows.at(-1).final,records[1].rows.at(-1).final);
    if(mode==='timing') assert.equal(records[1].rows.at(-1).governor?.rung,0);
  }
  const crop={left:472,top:192,width:600,height:140};
  const width=1220,height=502, layers=[];
  const label=(message,x,y,size,color='#eff3f5') =>
    '<text x="'+x+'" y="'+y+'" font-family="Arial, sans-serif" font-size="'+size+'" fill="'+color+'">'+message+'</text>';
  let type=label('Argenteuil approach',12,32,24)+label('Same camera · 2,072 ft MSL · heading 037°',288,32,17,'#b3c3cc');
  for(const [i,dir] of [reference,out].entries()){
    const x=10+i*605, f=path.join(dir,'flight.png');
    type+=label(i?'Corrected defaults':'Previous build',x,65,18);
    layers.push({input:await sharp(f).extract({left:0,top:65,width:1440,height:440}).resize(600,183).png().toBuffer(),left:x,top:75});
    layers.push({input:await sharp(f).extract(crop).png().toBuffer(),left:x,top:286});
    const median=i?'#b9b5a8':'#d4c8b1';
    type+='<rect x="'+x+'" y="438" width="35" height="19" fill="'+median+'"/>';
    type+=label('Median wall color · '+(i?'31.5%':'98.3%')+' of facades pale warm',x+45,453,15);
  }
  type+=label('City through the center windshield, native resolution',10,278,15,'#c4d0d8');
  type+=label('Material colors from 1,895 mapped buildings on the approach. Imagery © Esri, Maxar, Earthstar Geographics · ESA WorldCover · © OpenStreetMap contributors, OpenMapTiles / OpenFreeMap',10,486,12,'#b3c3cc');
  layers.push({input:Buffer.from('<svg width="'+width+'" height="'+height+'" xmlns="http://www.w3.org/2000/svg">'+type+'</svg>'),left:0,top:0});
  await sharp({create:{width,height,channels:3,background:'#141b23'}}).composite(layers)
    .webp({quality:95}).toFile(path.resolve('docs/reviews/building-approach/argenteuil-facades.webp'));
}

function observe({mode,preset}) {
  if(mode==='stills') window.__flyGovPin='hold';
  localStorage.setItem('fly-quality-tier',preset);
  localStorage.setItem('fly-controls-seen','1');
  localStorage.setItem('fly-sound-on','0');
  localStorage.setItem('fly-explorer-preferences-v1',JSON.stringify({version:1,settings:{tutorial:'done'}}));
  const s = window.__argenteuil = {rows:[],frames:[],drawTimes:[],terrainChanges:[],long:[],black:0,flashMax:0,read:0,composed:0,missed:0};
  new PerformanceObserver(list => list.getEntries().forEach(e => s.long.push([e.startTime,e.duration])))
    .observe({type:'longtask',buffered:true});
  const canvas = document.createElement('canvas');
  canvas.width=64; canvas.height=48;
  const ctx=mode.endsWith('pixels') ? canvas.getContext('2d',{willReadFrequently:true}) : null;
  let twoAgo, prev, previousTime, lastReport=-1000, flight, composer, lastDraw=0, lastTerrainCount;
  function inspect(glCanvas) {
    ctx.drawImage(glCanvas,0,0,64,48);
    const rgb=ctx.getImageData(0,0,64,48).data;
    const now=new Uint8Array(64*48);
    let dark=0, flash=0;
    for(let i=0;i<now.length;i++) {
      now[i]=Math.max(rgb[4*i],rgb[4*i+1],rgb[4*i+2]);
      if(now[i]<5) dark++;
      if(twoAgo && prev[i]<24 && twoAgo[i]-prev[i]>45 && now[i]-prev[i]>45) flash++;
    }
    s.read++;
    if(dark>now.length*.98) s.black++;
    s.flashMax=Math.max(s.flashMax,flash);
    twoAgo=prev; prev=now;
  }
  function tick(t) {
    const r=window.__fly, store=window.__flyStore?.getState(), c=window.__flyComposer;
    if (c && c!==composer) {
      composer=c;
      const render=c.render;
      c.render=function(...args){
        const value=render.apply(this,args);
        s.composed++;
        if(s.reveal) s.drawTimes.push(performance.now());
        if (ctx && s.reveal) inspect(c.renderer.domElement);
        return value;
      };
    }
    if(mode!=='hangar' && r?.flight && flight!==r.flight && store?.screen==='flight'){
      flight=r.flight;
      const step=flight.step.bind(flight);
      const x=6378137*2.246*Math.PI/180, z=-6378137*Math.asinh(Math.tan(48.889*Math.PI/180));
      flight.step=(dt,controls)=>{
        step(dt,controls);
        const distance=mode.startsWith('cruise') && s.reveal ? Math.max(0,performance.now()-s.reveal)*.001*399/1.94384449 : 0;
        const scale=1/Math.cos(48.889*Math.PI/180), head=37*Math.PI/180;
        flight.pos.set(x+distance*scale*Math.sin(head),2072*.3048,z-distance*scale*Math.cos(head));
        flight.heading=37*Math.PI/180; flight.pitch=-9*Math.PI/180;
        flight.bank=0; flight.turnRate=0; flight.pitchRate=0; flight.speed=399/1.94384449;
      };
    }
    if(!s.reveal && window.__flyBoot?.pct===100 && store?.screen==='flight' && !r.worldLoading) s.reveal=t;
    const terrainCount=r?.criticalTerrain?.previews;
    if(s.reveal && Number.isFinite(terrainCount) && terrainCount!==lastTerrainCount){
      s.terrainChanges.push([t,terrainCount,r.criticalTerrain.status]);
      lastTerrainCount=terrainCount;
    }
    if (s.reveal && r && !r.worldLoading && !document.hidden && nowInFlight() && previousTime) {
      s.frames.push([t,t-previousTime]);
      if(lastDraw===s.composed) s.missed++;
    }
    lastDraw=s.composed;
    previousTime=t;
    if(r && t-lastReport>=250) {
      lastReport=t;
      const b=r.satBuildings?.stats, f=r.satSkyline?.stats, p=r.prewarm, a=r.satBuildings?._wp;
      const preflight=window.__flyStats?.composerWarm, scene=c?.passes[0]?.scene;
      let lights=[];
      if(scene?.isScene) scene.traverseVisible(o=>{if(o.isLight) lights.push([o.type,o.id,o.castShadow,o.name]);});
      s.rows.push({t,screen:store?.screen,boot:window.__flyBoot,load:r.worldLoading,
        drawGate:preflight?.holdReason,pendingPrograms:preflight?.pending,sceneLights:lights,env:scene?.environment?.id,
        shadowTaps:r.cinemaShadows?.cascades,shadowSize:r.cinemaShadows?.size,shadowPaused:r.cinemaShadows?.paused,
        shadowMap:c?.renderer.shadowMap.enabled,preset:store?.qualityPreset,
        missing:r.worldReadiness?.blocking,cam:r.terraStats?.camTileZ,terrain:r.terraStats?.sharp,
        final:b?.ready,columns:b?.columns,nearPending:b && b.queued+b.building+b.draping,
        far:f?.ready,farPending:f && f.queued+f.building+f.draping,fullRing:a?.fullRingSec,
        photo:r.satSkyline?._photos?.stat?.fetched,warm:p?.done,critical:r.criticalTerrain?.status,
        terrainPreviews:r.criticalTerrain?.previews,
        profiles:p?.worldProfiles?.status,profileError:p?.worldProfiles?.error,epoch:store?.warpEpoch,
        cockpit:r.cockpitPreparation?.status,dpr:c?.renderer.getPixelRatio(),governor:window.__flyGov?.state?.(),
        pending:p?.pending,forest:window.__wpCanopy?.stats?.held,
        rendererPrograms:c?.renderer.info.programs?.length,draws:c?.renderer.info.render.calls,
        tier:store?.qualityTier});
    }
    requestAnimationFrame(tick);
    function nowInFlight(){return store?.screen==='flight';}
  }
  requestAnimationFrame(tick);
}

(async()=>{
  if(comparison) return compare();
  const errors=[];
  const browser=await chromium.launch({channel:'chrome',args:['--use-angle=d3d11','--ignore-gpu-blocklist']});
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  try{
    let profiler;
    if(mode==='profile'){
      profiler=await page.context().newCDPSession(page);
      await profiler.send('Profiler.enable');
      await profiler.send('Profiler.setSamplingInterval',{interval:1000});
      await profiler.send('Profiler.start');
    }
    await page.addInitScript(observe,{mode,preset});
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error' && /WebGLProgram|shader error|context lost/i.test(m.text()))errors.push(m.text());});
    await page.route('**/api/aircraft?*',route=>route.fulfill({json:{ac:[],now:1782046800}}));
    await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:100000});
    if(mode==='hangar'){
      const state=()=>page.evaluate(()=>({aircraft:window.__flyStore.getState().aircraftId,screen:window.__flyStore.getState().screen,
        cockpit:window.__fly.cockpitPreparations?.airliner,loading:window.__fly.worldLoading}));
      const pick=async()=>{
        await page.getByTestId('title-explore').click({timeout:30000});
        await page.getByTestId('hangar-pick-airliner').click({timeout:30000});
        await page.waitForFunction(()=>window.__fly?.cockpitPreparations?.airliner?.status==='ready',null,{timeout:55000});
        const seen=await state();
        assert.equal(seen.screen,'hangar');
        assert.notEqual(seen.aircraft,'airliner');
        return seen;
      };
      await page.waitForFunction(()=>window.__flyBoot?.pct===100 && window.__fly?.operations,null,{timeout:125000});
      const start=await state();
      assert.notEqual(start.aircraft,'airliner');
      const first=await pick();
      await page.getByTestId('hangar-back').click();
      await page.waitForFunction(()=>window.__flyStore.getState().screen==='title'&&!window.__fly.cockpitPreparations?.airliner);
      const cancelled=await state();
      assert.equal(cancelled.aircraft,start.aircraft);
      const staged=await pick();
      await page.getByTestId('hangar-fly').click({timeout:30000});
      await page.waitForFunction(()=>window.__flyStore.getState().screen==='flight'&&!window.__fly.worldLoading,null,{timeout:60000});
      const launched=await state();
      assert.equal(launched.aircraft,'airliner');
      assert.equal(launched.cockpit.status,'ready');
      assert.equal(staged.cockpit.started,launched.cockpit.started,'The staged optical scene should survive the commitment');
      assert.deepEqual(errors,[]);
      fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({start,first,cancelled,staged,launched,errors}));
      console.log('PASS normal hangar selected, canceled, reselected and launched the already prepared cockpit.');
      return;
    }
    await page.waitForFunction(()=>window.__argenteuil?.reveal,null,{timeout:125000});
    if(profiler){
      await page.waitForTimeout(8000);
      await page.waitForFunction(()=>window.__fly?.criticalTerrain?.status==='ready',null,{timeout:65000});
      await page.waitForTimeout(1300);
      const clocks=await page.evaluate(()=>({pageNow:performance.now(),origin:performance.timeOrigin}));
      const {profile}=await profiler.send('Profiler.stop');
      fs.writeFileSync(path.join(out,'cpu.cpuprofile'),JSON.stringify({profile,clocks}));
    }
    const presentations=[], displayedAt=[];
    const checkpoints=[0,1,3,5,8];
    let screenStart;
    let cdp;
    if(mode.endsWith('pixels')){
      cdp=await page.context().newCDPSession(page);
      cdp.on('Page.screencastFrame',({data,sessionId,metadata})=>{
        const frame=Buffer.from(data,'base64');
        presentations.push(frame);
        displayedAt.push(metadata.timestamp*1000);
        screenStart ??= metadata.timestamp;
        if(checkpoints.length && metadata.timestamp-screenStart>=checkpoints[0])
          fs.writeFileSync(path.join(out,'entry-'+checkpoints.shift()+'s.jpg'),frame);
        cdp.send('Page.screencastFrameAck',{sessionId}).catch(()=>{});
      });
      await cdp.send('Page.startScreencast',{format:'jpeg',quality:70,maxWidth:240,maxHeight:150,everyNthFrame:1});
    }
    await page.waitForTimeout(mode==='entry-pixels'?10000:durationMs);
    if(cdp) await cdp.send('Page.stopScreencast');
    if(label==='final' && mode==='entry-pixels'){
      await page.waitForFunction(()=>window.__fly.criticalTerrain?.status==='ready',null,{timeout:45000});
    }
    const result=await page.evaluate((durationMs)=>{
      const s=window.__argenteuil,r=window.__fly,c=window.__flyComposer,gl=c.renderer.getContext();
      const percentile=(a,q)=>a.sort((x,y)=>x-y)[Math.floor((a.length-1)*q)];
      const motion=s.frames.filter(([t])=>t-s.reveal<=durationMs).map(([,dt])=>dt);
      const draws=s.drawTimes.filter(t=>t<=s.reveal+durationMs);
      const present=draws.map((t,i)=>t-(i?draws[i-1]:s.reveal));
      const observedUntil=Math.min(performance.now(),s.reveal+durationMs);
      const sinceLastDraw=observedUntil-(draws.at(-1)??s.reveal);
      const milestone=test=>s.rows.find(test)?.t;
      const summary={reveal:s.reveal, nearFirst:milestone(v=>v.final>0),near12:milestone(v=>v.final>=12),
        far10:milestone(v=>v.far>=10),fullRing:milestone(v=>v.fullRing!=null),terrain:milestone(v=>v.terrain),
        p95:percentile([...motion],.95),p99:percentile([...motion],.99),over100:motion.filter(x=>x>=100).length,
        renderCount:present.length,renderP95:percentile([...present],.95),renderP99:percentile([...present],.99),
        renderOver100:present.filter(ms=>ms>=100).length,renderWorst:Math.max(sinceLastDraw,...present),
        black:s.black,sampled:s.read,flashMax:s.flashMax,missed:s.missed,composed:s.composed};
      return {...s,summary,timeOrigin:performance.timeOrigin,pins:window.__flyUrlFlags,gpu:gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),
        position:r.flight.pos.toArray(), heading:r.flight.heading, fov:r.camera.fov, eye:r.camera.position.toArray(), rotation:r.camera.quaternion.toArray(),
        worldWarm:r.prewarm?.worldProfiles,terrainWarm:r.criticalTerrain,cockpitWarm:r.cockpitPreparation,
        arrival:r.arrivalStats,
        warmError:r.prewarm?.error, programFirstUse:window.__flyStats?.census?.programs,
        flags:window.__flyStats?.worldPass?.key};
    },durationMs);
    await page.screenshot({path:path.join(out,'flight.png'),timeout:20000});
    if(cdp){
      let black=0;
      for(const jpg of presentations){
        // Region above the instrument panel includes both the horizon and the city.
        const pixels=await sharp(jpg).resize(80,50).extract({left:10,top:8,width:60,height:16})
          .removeAlpha().raw().toBuffer();
        let dark=0;
        for(let i=0;i<pixels.length;i+=3) if(Math.max(pixels[i],pixels[i+1],pixels[i+2])<12) dark++;
        if(dark>.95*pixels.length/3) black++;
      }
      result.summary.screenSamples=presentations.length;
      result.summary.screenDark=black;
      assert.ok(presentations.length>20,'browser presentation sampling did not start');
      const last=result.terrainChanges.findLastIndex(([,n])=>n>0);
      if(last>=0 && result.terrainChanges[last+1]){
        const stop=result.terrainChanges[last+1][0];
        for(const offset of [-600,-300,0,300]){
          const ix=displayedAt.findIndex(t=>t>=result.timeOrigin+stop+offset);
          if(ix>=0)fs.writeFileSync(path.join(out,'lighting-'+offset+'ms.jpg'),presentations[ix]);
        }
      }
    }
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({...result,errors}));
    console.log(result.gpu,JSON.stringify(result.summary),JSON.stringify(errors));
    assert.ok(result.rows.at(-1).final>0 && result.rows.at(-1).far>0 && result.frames.length>60);
    if(mode.endsWith('pixels')) assert.ok(result.read>60);
    assert.deepEqual(errors,[]);
    const release=label==='release'||label.startsWith('release-');
    if(label==='final'||release){
      assert.equal(result.worldWarm.status,'ready');
      assert.equal(result.worldWarm.identityVerified,true);
      assert.equal(result.terrainWarm.status,'ready');
      assert.ok(result.rows.some(row=>row.terrainPreviews>0),'Resident terrain should be visible during linking');
      assert.equal(result.terrainWarm.previews,0);
      assert.equal(result.cockpitWarm.status,'ready');
      assert.equal(result.rows.at(-1).epoch,0);
      assert.equal(result.programFirstUse.linkFailures,0);
      if(mode.endsWith('pixels')){
        assert.equal(result.black,0);
        assert.equal(result.summary.screenDark,0);
      }
      if(release && mode.startsWith('cruise')){
        const flightRows=result.rows.filter(row=>row.t>=result.reveal);
        assert.ok(flightRows.some(row=>row.governor?.effects>=2),'Drive the adaptive shadow rung during the measured flight');
        assert.ok(!flightRows.some(row=>row.drawGate==='global'),'A graphics reduction must keep the moving world visible');
        assert.ok(result.summary.renderWorst<1000,'A completed world draw is required in every second of the approach');
      }
    }
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
