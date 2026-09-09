/* Bounded water visibility diagnosis; intentionally no FPS measurements. */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve('.graphics-review/water-probe');
(async () => {
  if (!fs.existsSync('.graphics-review/production-cinematic/report.json')) throw Error('Wait for production capture to finish before probing.');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu'] });
  const report = { purpose: 'water visibility diagnosis', errors: [], failedRequests: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('requestfailed', r => { if(report.failedRequests.length<20) report.failedRequests.push({url:r.url(),error:r.failure()?.errorText}); });
    page.on('response', r => { if(r.status()>=400 && report.failedRequests.length<20) report.failedRequests.push({url:r.url(),status:r.status()}); });
    page.on('console', m => { if(m.type()==='error' && /shader|WebGL|TypeError|ReferenceError/.test(m.text())) report.errors.push(m.text()); });
    await page.addInitScript((nightMode) => {
      localStorage.setItem('fly-map-style-2','satellite');
      localStorage.setItem('fly-quality-tier','high');
      localStorage.setItem('fly-controls-seen','1');
      localStorage.setItem('fly-sound-on','0');
      window.__flyWeatherOverride='baseline';
      window.__flySunOverride=Date.UTC(2026,6,18,nightMode?4:17);
      window.__flyGovPin='hold';
    },process.argv.includes('--road-order'));
    await page.goto('http://localhost:3010/?graphics=cinematic&graphicsReview=1',{waitUntil:'domcontentloaded',timeout:90000});
    await page.waitForFunction(()=>window.__flyBoot?.pct===100&&window.__fly,null,{timeout:90000});
    await page.evaluate(()=>{
      const rt=window.__fly;window.__flyStore.getState().setQualityTier('high');
      rt.warpToGeo(40.7028,-74.017,{altM:305,name:null});
      const f=rt.flight,p={...f.pos};
      window.__waterPose=setInterval(()=>{Object.assign(f.pos,p);f.speed=0;f.heading=.3;f.pitch=-.08;f.bank=0;},16);
      rt.chaseCam?.snap?.();
    });
    await page.waitForTimeout(25000);
    await page.waitForFunction(()=>window.__fly.satBuildings?.waterMaterial && window.__fly.satBuildings?.stats.waterReady>0,null,{timeout:45000}).catch(e=>report.errors.push(e.message));
    if(process.argv.includes('--road-order')) {
      await page.waitForFunction(()=>window.__fly.satRoads?.stats.ready>0,null,{timeout:15000});
      report.roadBefore=await page.evaluate(()=>{const r=window.__fly;return{sun:r.sun,stats:r.satRoads.stats,meshes:[...r.satRoads.chunks.values()].filter(c=>c.mesh).map(c=>({order:c.mesh.renderOrder,vertices:c.mesh.geometry.getAttribute('position').count}))}});
      await page.screenshot({path:path.join(output,'roads-before.png')});
      await page.evaluate(()=>{for(const c of window.__fly.satRoads.chunks.values())if(c.mesh)c.mesh.renderOrder=-4;});
      await page.waitForTimeout(700);
      await page.screenshot({path:path.join(output,'roads-after.png')});
      report.roadAfter=await page.evaluate(()=>{const r=window.__fly;return{sun:r.sun,stats:r.satRoads.stats,meshes:[...r.satRoads.chunks.values()].filter(c=>c.mesh).map(c=>({order:c.mesh.renderOrder,vertices:c.mesh.geometry.getAttribute('position').count}))}});
      report.status=report.errors.length?'FAIL':'CAPTURED';
      fs.writeFileSync(path.join(output,'roads.json'),JSON.stringify(report,null,2));
      console.log(JSON.stringify({status:report.status,before:report.roadBefore,after:report.roadAfter}));
      return;
    }
    if(process.argv.includes('--projection')) {
      await page.evaluate(()=>{
        const e=window.__fly.satBuildings;window.__waterGPU=[];
        for(const [key,c] of e.chunks)if(c.water)c.water.onAfterRender=(r,s,camera,geometry,m)=>{
          window.__waterRenderer=r;
          if(window.__waterGPU.some(x=>x.key===key))return;
          const gl=r.getContext(),program=gl.getParameter(gl.CURRENT_PROGRAM),attrs=r.properties.get(m).currentProgram?.getAttributes();
          const loc=gl.getAttribLocation(program,'position'),buf=gl.getVertexAttrib(loc,gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),prev=gl.getParameter(gl.ARRAY_BUFFER_BINDING),floats=new Float32Array(9);
          if(buf){gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.getBufferSubData(gl.ARRAY_BUFFER,0,floats);gl.bindBuffer(gl.ARRAY_BUFFER,prev);}
          const get=n=>{const l=gl.getUniformLocation(program,n);const v=l?gl.getUniform(program,l):null;return ArrayBuffer.isView(v)?Array.from(v):v;};
          window.__waterGPU.push({key,positionLocation:loc,positionSize:gl.getVertexAttrib(loc,gl.VERTEX_ATTRIB_ARRAY_SIZE),bufferFirst:Array.from(floats),sourceFirst:Array.from(geometry.getAttribute('position').array.slice(0,9)),gpu:{enabled:get('uWaterEnabled'),bend:get('uBendK'),center:get('uBendCenter'),model:get('modelMatrix'),camera:get('cameraPosition')}});
        }
      });
      await page.waitForTimeout(500);
      report.projection=await page.evaluate(()=>{
        const rt=window.__fly,e=rt.satBuildings,cam=rt.camera,V=cam.position.constructor,r=window.__waterRenderer,u=r.properties.get(e.waterMaterial).uniforms;
        const k=u.uBendK.value,bc=u.uBendCenter.value;
        const pixels=[[200,750],[350,850],[400,650],[200,1000],[700,540]],hits=pixels.map(pixel=>({pixel,hits:[]})),chunks=[];
        const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
        for(const [key,c] of e.chunks){
          const m=c.water;if(!m)continue;
          const p=m.geometry.getAttribute('position'),idx=m.geometry.index,sh=m.geometry.getAttribute('aWaterShore'),verts=[];
          let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
          for(let i=0;i<p.count;i++){
            const v=new V(p.getX(i),p.getY(i),p.getZ(i)).applyMatrix4(m.matrixWorld);minX=Math.min(minX,v.x);maxX=Math.max(maxX,v.x);minZ=Math.min(minZ,v.z);maxZ=Math.max(maxZ,v.z);
            const dx=v.x-bc.x,dz=v.z-bc.y;v.y-=k*(dx*dx+dz*dz);
            const view=v.clone().applyMatrix4(cam.matrixWorldInverse),ndc=v.clone().project(cam);
            verts.push({screen:[(ndc.x+1)*960,(1-ndc.y)*540],world:v.toArray(),behind:view.z>=0,invW:1/-view.z,shore:sh?[sh.getX(i),sh.getY(i),sh.getZ(i)]:[10000,10000,10000]});
          }
          const count=idx?idx.count:p.count,vi=i=>idx?idx.getX(i):i;
          for(let i=0;i+2<count;i+=3){
            const ids=[vi(i),vi(i+1),vi(i+2)],vs=ids.map(j=>verts[j]);if(vs.some(v=>v.behind))continue;
            const [a,b,d]=vs.map(v=>v.screen),area=cross(a,b,d);if(Math.abs(area)<1e-7)continue;
            for(const h of hits){const p=h.pixel,w=[cross(b,d,p)/area,cross(d,a,p)/area,cross(a,b,p)/area];if(w.some(x=>x<0))continue;
              const corrected=w.map((x,j)=>x*vs[j].invW),sum=corrected.reduce((a,b)=>a+b,0),shore=[0,1,2].map(j=>corrected.reduce((a,x,i)=>a+x*vs[i].shore[j],0)/sum);
              h.hits.push({key,triangle:i/3,world:vs.map(v=>v.world),screen:vs.map(v=>v.screen),shore,visible:m.visible});}
          }
          chunks.push({key,indexed:!!idx,vertices:p.count,indexCount:idx?.count??0,bounds:[minX,minZ,maxX,maxZ]});
        }
        return{camera:cam.position.toArray(),bend:k,center:[bc.x,bc.y],hits,chunks,gpu:window.__waterGPU};
      });
      await page.screenshot({path:path.join(output,'projection-baseline.png')});
      report.drawOrder=await page.evaluate(()=>{
        const rt=window.__fly,r=window.__waterRenderer,trace=[],restore=[];
        const hook=(o,type)=>{if(!o.isMesh)return;const old=o.onBeforeRender;restore.push([o,old]);o.onBeforeRender=function(...args){old?.apply(this,args);if(trace.length<1200){let p=o.parent,groups=[];while(p){if(p.isGroup)groups.push(p.renderOrder);p=p.parent;}trace.push({type,name:o.name,id:o.id,order:o.renderOrder,groups,transparent:args[4]?.transparent,depthWrite:args[4]?.depthWrite,depthTest:args[4]?.depthTest});}};};
        rt.engine.map.traverse(o=>hook(o,'terrain'));
        for(const c of rt.satBuildings.chunks.values())if(c.water)hook(c.water,'water');
        let scene=rt.engine.map;while(scene.parent)scene=scene.parent;
        const prev=r.getRenderTarget();r.setRenderTarget(null);r.render(scene,rt.camera);r.setRenderTarget(prev);
        for(const[o,old]of restore)o.onBeforeRender=old;
        return trace;
      });
      await page.evaluate(()=>{
        const rt=window.__fly,m=rt.satBuildings.waterMaterial,prev=m.onBeforeCompile,key=m.customProgramCacheKey();
        m.onBeforeCompile=(s,r)=>{prev(s,r);s.fragmentShader=s.fragmentShader.replace('#include <opaque_fragment>','gl_FragColor=vec4(1.0,0.0,1.0,1.0);');};
        m.customProgramCacheKey=()=>key+'-coverage';m.needsUpdate=true;
        rt.engine.map.visible=false;
      });
      await page.waitForTimeout(800);
      await page.screenshot({path:path.join(output,'terrain-hidden.png')});
      fs.writeFileSync(path.join(output,'projection.json'),JSON.stringify(report,null,2));
      console.log(JSON.stringify({hits:report.projection.hits.map(h=>({pixel:h.pixel,count:h.hits.length,hit:h.hits[0]})),gpu:report.projection.gpu.slice(0,2)},null,2));
      return;
    }
    report.initial=await page.evaluate(()=>{
      const rt=window.__fly,e=rt.satBuildings,m=e?.waterMaterial;
      const list=[];
      for(const [key,c] of e.chunks){
        if(!c.water)continue;
        const mesh=c.water,p=mesh.geometry.getAttribute('position'),n=mesh.geometry.getAttribute('normal'),sh=mesh.geometry.getAttribute('aWaterShore');
        let up=0,down=0,zero=0,min=Infinity,max=-Infinity,shoreZero=0;
        for(let i=0;i<n.count;i++){const y=n.getY(i);if(y>.1)up++;else if(y<-.1)down++;else zero++;min=Math.min(min,y);max=Math.max(max,y);}
        if(sh)for(let i=0;i<sh.count;i++)if(Math.min(sh.getX(i),sh.getY(i),sh.getZ(i))===0)shoreZero++;
        const parents=[];let o=mesh;while(o){parents.push({type:o.type,visible:o.visible,position:o.position.toArray(),scale:o.scale.toArray()});o=o.parent;}
        const samples=(c.waterSamples||[]).map(p=>{const lon=(c.cx+p.x)/6378137*180/Math.PI,lat=(2*Math.atan(Math.exp(-(c.cz+p.z)/6378137))-Math.PI/2)*180/Math.PI;return{...p,ground:rt.engine.getGroundAt(lon,lat)}});
        list.push({key,waterY:c.waterY,resolved:c.waterResolved,synth:c.waterSynth,vertices:p.count,normal:{up,down,zero,min,max},shoreZero,parents,samples});
      }
      return {runtimeKeys:Object.keys(rt),flight:{...rt.flight.pos},stats:e.stats,material:m&&{name:m.name,type:m.type,side:m.side,opacity:m.opacity,transparent:m.transparent,depthTest:m.depthTest,depthWrite:m.depthWrite,key:m.customProgramCacheKey(),uniforms:Object.fromEntries(Object.entries(m.userData.satelliteWaterUniforms||{}).map(([k,u])=>[k,u.value?.toArray?u.value.toArray():Array.isArray(u.value)?u.value.map(v=>v.toArray?v.toArray():v):u.value]))},meshes:list};
    });
    await page.screenshot({path:path.join(output,'baseline.png')});
    if(!report.initial.material){report.status='BLOCKED';report.reason='Water material/residency unavailable';process.exitCode=2;return;}
    await page.evaluate(()=>{const m=window.__fly.satBuildings.waterMaterial;m.side=2;m.needsUpdate=true;});
    await page.waitForTimeout(1500);
    await page.screenshot({path:path.join(output,'double-side.png')});
    await page.evaluate(()=>{const m=window.__fly.satBuildings.waterMaterial;m.depthTest=false;m.opacity=1;});
    await page.waitForTimeout(1000);
    await page.screenshot({path:path.join(output,'no-depth.png')});
    await page.evaluate(()=>{
      const e=window.__fly.satBuildings,m=e.waterMaterial;
      window.__waterDraws=0;
      for(const c of e.chunks.values())if(c.water){c.water.frustumCulled=false;c.water.onBeforeRender=r=>{window.__waterDraws++;window.__waterRenderer=r;};}
      const prev=m.onBeforeCompile,key=m.customProgramCacheKey();
      m.onBeforeCompile=(s,r)=>{prev(s,r);window.__waterCompiled={vertex:s.vertexShader,fragment:s.fragmentShader};s.fragmentShader=s.fragmentShader.replace('#include <opaque_fragment>','gl_FragColor=vec4(1.0,0.0,1.0,1.0);');};
      m.customProgramCacheKey=()=>key+'-diagnostic';m.colorWrite=true;m.needsUpdate=true;
    });
    await page.waitForTimeout(1500);
    await page.screenshot({path:path.join(output,'magenta.png')});
    report.compilation=await page.evaluate(()=>({draws:window.__waterDraws,shader:window.__waterCompiled}));
    report.order=await page.evaluate(()=>{
      const rt=window.__fly,ancestors=[];let o=rt.engine.map;
      while(o){ancestors.push({type:o.type,renderOrder:o.renderOrder});o=o.parent;}
      const water=rt.satBuildings;
      water.object.renderOrder=1000;
      for(const c of water.chunks.values())if(c.water)c.water.renderOrder=1000;
      return{terrainAncestors:ancestors};
    });
    await page.waitForTimeout(1000);
    await page.screenshot({path:path.join(output,'water-last.png')});
    await page.evaluate(()=>window.__flyStore.getState().setQualityTier('medium'));
    await page.waitForTimeout(2500);
    await page.screenshot({path:path.join(output,'medium-magenta.png')});
    await page.evaluate(()=>{
      const rt=window.__fly,r=window.__waterRenderer;let scene=rt.engine.map;while(scene.parent)scene=scene.parent;
      const render=()=>{r.setRenderTarget(null);r.render(scene,rt.camera);window.__waterRawRaf=requestAnimationFrame(render);};
      window.__waterRawRaf=requestAnimationFrame(render);
    });
    await page.waitForTimeout(1500);
    await page.screenshot({path:path.join(output,'raw-magenta.png')});
    report.status=report.errors.length?'FAIL':'CAPTURED';
    console.log(JSON.stringify({status:report.status,material:report.initial.material.name,enabled:report.initial.material.uniforms.uWaterEnabled,meshes:report.initial.meshes.length,draws:report.compilation.draws,errors:report.errors}));
  } finally {
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
    await browser.close();
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
