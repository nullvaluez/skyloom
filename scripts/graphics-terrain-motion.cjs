/* Regression evidence: real translating flight, attached terrain coverage and LOD churn.
 * No fleet boot helpers or terrain/governor pins. CAPTURED is evidence, not certification. */
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
const args=Object.fromEntries(process.argv.slice(2).map(s=>{const[k,v]=s.replace(/^--/,'').split('=');return[k,v??true]}));
const output=args.output||'.graphics-review/terrain-before', seconds=Number(args.seconds||45);
const site=args.site==='lima'?{lat:40.6398,lon:-84.0952,alt:37829*.3048,agl:36881*.3048,heading:318,speed:146*.514444}:{lat:41.2207,lon:-85.0009,alt:533,agl:957*.3048,heading:260,speed:311*.514444};
(async()=>{
 const report={...require('./graphics-source.cjs')(),status:'BLOCKED',stage:args.stage||'legacy',site,errors:[],samples:[]}; let browser;
 try{
  fs.mkdirSync(output,{recursive:true});
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu']});
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('fly-map-style-2','satellite');localStorage.setItem('fly-quality-tier','high');localStorage.setItem('fly-controls-seen','1');localStorage.setItem('fly-sound-on','0');window.__flySunOverride=Date.UTC(2026,6,18,18);window.__flyWeatherOverride='baseline';});
  await page.goto(`${args.url||'http://localhost:3010'}/?graphics=${report.stage}&graphicsReview=1`,{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>window.__flyBoot?.pct===100&&window.__fly,null,{timeout:90000});
  if(args['orientation-control'])await page.evaluate(()=>{
    window.__orientationConversions=0;
    window.__fly.engine.onTileMaterial(material=>{
      const tex=material.map,im=tex?.image;
      if(!im||!(im instanceof ImageBitmap))return;
      const canvas=new OffscreenCanvas(im.width,im.height);
      canvas.getContext('2d').drawImage(im,0,0);tex.image=canvas;tex.needsUpdate=true;
      window.__orientationConversions++;
    });
  });
  await page.evaluate(p=>{
    const r=window.__fly,f=r.flight;r.warpToGeo(p.lat,p.lon,{altM:p.alt,name:null});
    f.heading=p.heading*Math.PI/180;f.speed=p.speed;f.pitch=0;f.bank=0;f.step=()=>{};
  },site);
  await page.waitForTimeout(22000);
  await page.evaluate(p=>{const f=window.__fly.flight;f.pos.y=f.groundElev+p.agl;f.agl=p.agl;},site);
  await page.waitForTimeout(3000);
  await page.screenshot({path:path.join(output,'start.png')});
  report.hardware=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return e&&gl.getParameter(e.UNMASKED_RENDERER_WEBGL);});
  report.orientationControl=!!args['orientation-control'];
  await page.evaluate(site=>{
    const rt=window.__fly,f=rt.flight,m=rt.engine.map,root=m.rootTile;
    const p=window.__terrainMotion={t0:performance.now(),loads:0,unloads:0,frames:0,overlapFrames:0,maxOverlap:0,events:[],draws:[],running:true};
    const key=t=>`${t.z}/${t.x}/${t.y}`;
    m.addEventListener('tile-loaded',e=>{p.loads++;if(p.events.length<6000)p.events.push({t:performance.now()-p.t0,kind:'load',key:key(e.tile)});});
    m.addEventListener('tile-unload',e=>{p.unloads++;if(p.events.length<6000)p.events.push({t:performance.now()-p.t0,kind:'unload',key:key(e.tile)});});
    // Real integrator translation at the reported 311kt. A gentle reversing
    // turn exposes return-to-view replacements without teleporting the world.
    delete f.step;const original=f.step.bind(f);let elapsed=0;
    f.step=(dt,cmd)=>{elapsed+=dt;original(dt,{...cmd,turn:elapsed<12?0:Math.sin((elapsed-12)*Math.PI/8)*.7,pitch:(site.agl-(f.pos.y-f.groundElev))*.002,boost:false,speedOverride:site.speed,speedPreset:'cruise'});};
    p.sample=()=>{
      const leaves=[],overlaps=[],byZoom={};let orphanParents=0;
      const walk=(t,ancestors)=>{
        const attached=t.model?.parent===t;
        if(attached){leaves.push(key(t));byZoom[t.z]=(byZoom[t.z]||0)+1;if(ancestors.length)overlaps.push([key(t),...ancestors]);}
        const kids=t.children.filter(c=>c.isTile);
        if(kids.length&&!t.subTiles&&t.loadState!=='loading')orphanParents++;
        for(const c of kids)walk(c,attached?[...ancestors,key(t)]:ancestors);
      };walk(root,[]);
      return{ms:performance.now()-p.t0,geo:rt.geo,pos:{...f.pos},speed:f.speed,agl:f.pos.y-f.groundElev,heading:f.heading,loads:p.loads,unloads:p.unloads,byZoom,leaves,overlaps,orphanParents,terrain:rt.terraStats,review:window.__graphicsReview};
    };
    const tick=()=>{if(!p.running)return;p.frames++;const s=p.sample();if(s.overlaps.length)p.overlapFrames++;p.maxOverlap=Math.max(p.maxOverlap,s.overlaps.length);requestAnimationFrame(tick);};requestAnimationFrame(tick);
  },site);
  for(let sec=0;sec<seconds;sec++){
    await page.waitForTimeout(1000);report.samples.push(await page.evaluate(()=>window.__terrainMotion.sample()));
    if((sec+1)%10===0){await page.screenshot({path:path.join(output,`flight-${sec+1}.png`)});console.log(`Terrain ${sec+1}s, leaves ${report.samples.at(-1).leaves.length}, loads ${report.samples.at(-1).loads}, overlaps ${report.samples.at(-1).overlaps.length}`);}
  }
  report.motion=await page.evaluate(()=>{const p=window.__terrainMotion;p.running=false;return{frames:p.frames,overlapFrames:p.overlapFrames,maxOverlap:p.maxOverlap,events:p.events};});
  const valid=report.samples.every(s=>s.leaves.length>20)&&!/swiftshader|software/i.test(report.hardware||'');
  report.status=report.errors.length?'FAIL':valid?'CAPTURED':'BLOCKED';
 }catch(e){report.reason=e.stack;}
 finally{await browser?.close();fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,reason:report.reason,frames:report.motion?.frames,overlapFrames:report.motion?.overlapFrames,errors:report.errors}));process.exitCode=report.status==='BLOCKED'?2:report.status==='FAIL'?1:0;}
})();
