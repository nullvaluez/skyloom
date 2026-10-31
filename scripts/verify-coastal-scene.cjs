/* Real-provider GPU regression for the Rio title view. Run against a local
 * production build or FLY_URL=https://shadowads.netlify.app. Holds quality, not
 * the camera; observes actual reflection submissions during the live orbit. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const base=process.env.FLY_URL||'http://localhost:3182';
const out='.graphics-review/reflection-flicker',label=process.env.FLY_REPORT_NAME||'coastal-scene';
(async()=>{
 const report={base,errors:[],shaderErrors:[],stages:[]};fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||undefined,args:process.platform==='win32'?['--use-angle=d3d11']:[]});
 const page=await browser.newPage({viewport:{width:1662,height:1251}});
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/WebGL|shader/i.test(m.text()))report.shaderErrors.push(m.text());});
 try{
  await page.addInitScript(()=>{localStorage.setItem('fly-quality-tier','ultra');localStorage.setItem('fly-sound-on','0');window.__flyGovPin='hold';window.__flySunOverride=Date.UTC(2026,9,31,20,18);});
  await page.goto(base+'/?graphicsReview=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__flyBoot?.pct===100&&window.__fly?.stageDestination,null,{timeout:150000,polling:1000});
  assert.equal(await page.evaluate(()=>window.__fly.stageDestination('rio')),true);
  for(const preset of ['ultra','medium','low','high','ultra']){
   await page.evaluate(p=>window.__flyStore.getState().setQualityPreset(p),preset);
   await page.waitForFunction(p=>{
    const r=window.__fly,b=r.satBuildings?.stats,s=r.satSkyline?.stats;
    if(r.cinemaProfile?.name!==p)return false;
    if(p==='low')return !r.coastalReflection?.active;
    return r.coastalReflection?.active&&b?.ready>0&&s?.ready>0&&!b.building&&!b.queued&&!b.draping&&!b.births&&!s.building&&!s.draping&&!s.births;
   },preset,{timeout:150000,polling:1000});
   const row=await page.evaluate(async(p)=>{
    const r=window.__fly,renderer=window.__flyComposer.renderer;
    const start=r.titleCam.stats.angleDeg,frames=[],captures=[];
    const original=renderer.render;
    renderer.render=function(scene,camera){
     const target=this.getRenderTarget(),coast=target?.texture?.name==='coastal-city-reflection';
     const result=original.call(this,scene,camera);
     if(coast)captures.push({mips:target.texture.generateMipmaps,samples:target.samples,filter:target.texture.minFilter,draws:r.coastalReflection.draws});
     return result;
    };
    try{await new Promise(resolve=>{const tick=()=>{frames.push({...r.coastalReflection});if(frames.length<180)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});}
    finally{renderer.render=original;}
    const city=[];
    if(p!=='low')for(const [name,e]of [['buildings',r.satBuildings],['skyline',r.satSkyline]]){
     let triangles=0,duplicates=0;
     for(const chunk of e.chunks.values()){
      const g=chunk.mesh?.geometry;if(!g)continue;
      const pos=g.attributes.position.array,anchor=g.attributes.aBendAnchor.array,index=g.index.array,vertices=new Map(),faces=new Set(),ids=new Uint32Array(pos.length/3);
      for(let v=0;v<ids.length;v++){const key=[pos[v*3],pos[v*3+1],pos[v*3+2],anchor[v*2],anchor[v*2+1]].join(',');if(!vertices.has(key))vertices.set(key,vertices.size);ids[v]=vertices.get(key);}
      for(let i=0;i<index.length;i+=3){const key=[ids[index[i]],ids[index[i+1]],ids[index[i+2]]].sort((a,b)=>a-b).join(',');if(faces.has(key))duplicates++;else faces.add(key);triangles++;}
     }
     city.push({name,triangles,duplicates,ready:e.stats.ready,columns:e.stats.columns});
    }
    const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
    return {preset:p,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,frames:frames.length,inactive:frames.filter(f=>!f.active).length,captures:captures.length,target:captures[0],reflection:r.coastalReflection,city,angleDelta:r.titleCam.stats.angleDeg-start,water:r.earthSurface?.waterCells};
   },preset);
   report.stages.push(row);
   if(preset==='low'){assert.equal(row.captures,0);assert.equal(row.reflection.bytes,0);}
   else{assert.equal(row.inactive,0,JSON.stringify(row));assert.ok(row.captures>=170);assert.ok(row.target.mips);assert.ok(row.angleDelta>0);for(const city of row.city){assert.ok(city.triangles>0);assert.equal(city.duplicates,0,JSON.stringify(city));}}
   console.log(`PASS ${preset}: ${row.captures} reflection captures, ${row.city.reduce((n,c)=>n+c.duplicates,0)} duplicate faces`);
  }
  await page.screenshot({path:`${out}/${label}.png`});
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.shaderErrors,[]);
 }catch(error){report.failure=error.stack;throw error;}
 finally{fs.writeFileSync(`${out}/${label}.json`,JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
