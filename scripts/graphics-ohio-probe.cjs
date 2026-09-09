/* Focused production Ohio residency/drape probe. No graphics pins except governor. */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const out = path.resolve('.graphics-review/ohio-probe');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel:'chrome', headless:true, args:['--enable-gpu'] });
  const page = await browser.newPage({ viewport:{width:1920,height:1080} });
  const errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  page.on('requestfailed',r=>{ if(errors.length<20) errors.push(r.url()+': '+r.failure()?.errorText); });
  await page.addInitScript(() => {
    localStorage.setItem('fly-map-style-2','satellite'); localStorage.setItem('fly-controls-seen','1');
    localStorage.setItem('fly-quality-tier','high'); localStorage.setItem('fly-sound-on','0');
    window.__flyGovPin='hold'; window.__flyWeatherOverride='baseline';
    window.__flySunOverride=Date.UTC(2026,6,18,18);
  });
  try {
    await page.goto('http://localhost:3010/?graphics=cinematic&graphicsReview=1',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__flyBoot?.pct===100 && window.__fly,null,{timeout:90000});
    await page.evaluate(()=>{
      const fly=window.__fly; fly.warpToGeo(40.2083,-83.0701,{altM:380,name:null});
      window.__flyStore.getState().setQualityTier('high');
      const f=fly.flight, pin={...f.pos};
      window.__ohioPoseTimer=setInterval(()=>{Object.assign(f.pos,pin); f.heading=1.9; f.pitch=-0.08; f.bank=0; f.speed=0;},16);
      fly.chaseCam?.snap?.();
    });
    await page.waitForTimeout(25000);
    await page.waitForFunction(() => window.__fly.satBuildings.stats.ready > 0 && window.__fly.engine.getGroundAt(-83.0701,40.2083)?.tileZ >= 14,null,{timeout:30000}).catch(()=>{});
    const result=await page.evaluate(async()=>{
      const f=window.__fly, pos=f.flight.pos;
      const nearest=[];
      const chunks=[...f.satBuildings.chunks.entries()].map(([key,c])=>{
        const mesh=c.mesh, p=mesh?.geometry.attributes.position, a=mesh?.geometry.attributes.aBendAnchor;
        let ymin=Infinity,ymax=-Infinity, dmin=Infinity;
        const seen=new Set();
        if(p) for(let i=0;i<p.count;i++) {
          ymin=Math.min(ymin,p.getY(i));ymax=Math.max(ymax,p.getY(i));
          if(!a)continue;
          const x=a.getX(i)+c.cx,z=a.getY(i)+c.cz, id=x+','+z;
          if(seen.has(id))continue; seen.add(id);
          const d=Math.hypot(x-pos.x,z-pos.z); dmin=Math.min(dmin,d);
          const lon=x/6378137*180/Math.PI,lat=(2*Math.atan(Math.exp(-z/6378137))-Math.PI/2)*180/Math.PI;
          if(d<2200)nearest.push({key,x,z,d,vertexY:p.getY(i),ground:f.engine.getGroundAt(lon,lat),visible:mesh.visible});
        }
        return {key,state:c.state,center:[c.cx,c.cz],visible:mesh?.visible,parentVisible:mesh?.parent?.visible,worldY:mesh?.matrixWorld.elements[13],vertexY:[ymin,ymax],nearest:dmin,buildings:seen.size,coarse:c.coarse,badFrac:c.badFrac,meta:c.meta};
      });
      nearest.sort((a,b)=>a.d-b.d);
      const meshes=[], root=f.satBuildings.object.parent, matrix=root.matrixWorld.clone();
      const playerX=pos.x+f.satBuildings.object.matrixWorld.elements[12],playerZ=pos.z+f.satBuildings.object.matrixWorld.elements[14];
      root.traverse(o=>{if(o.isInstancedMesh){let nearest=Infinity; for(let i=0;i<o.count;i++){o.getMatrixAt(i,matrix);nearest=Math.min(nearest,Math.hypot(matrix.elements[12]+o.matrixWorld.elements[12]-playerX,matrix.elements[14]+o.matrixWorld.elements[14]-playerZ));} meshes.push({name:o.name,visible:o.visible,parentVisible:o.parent?.visible,count:o.count,nearest});}});
      const shader={uniforms:{},vertexShader:'',fragmentShader:''};f.satBuildings.material.onBeforeCompile(shader);
      const parcels=[];
      const parcelChunks=[];
      for(let tx=4410;tx<=4412;tx++)for(let ty=6189;ty<=6191;ty++){
        const r=await f.satBuildings.worker.buildTile(14,tx,ty,'sat-veg');
        const span=2*Math.PI*6378137/16384;
        parcelChunks.push({cx:-Math.PI*6378137+(tx+0.5)*span,cz:-Math.PI*6378137+(ty+0.5)*span,parcel:r.satParcel});
      }
      for(const c of parcelChunks)for(let i=0;i<(c.parcel?.length??0);i+=2){const x=c.cx+c.parcel[i],z=c.cz+c.parcel[i+1],d=Math.hypot(x-pos.x,z-pos.z);if(d<=2400)parcels.push({x,z,d,columns600:f.satBuildings.queryColumns(x,z,600).length});}
      parcels.sort((a,b)=>a.d-b.d);
      return {keys:Object.keys(f),flight:{pos:{...pos},ground:f.flight.groundElev,heading:f.flight.heading},ground:f.engine.getGroundAt(-83.0701,40.2083),buildings:f.satBuildings.stats,fade:shader.uniforms.uSatBldgFade?.value,vegetation:f.satVeg?.stats,parcels,regionalColumns:f.satBuildings.queryColumns(pos.x,pos.z,2400).length,nearest:nearest.slice(0,20),chunks,meshes,review:window.__graphicsReview,stats:window.__flyStats};
    });
    const raw=await page.evaluate(async()=>{
      const planet=await fetch('https://tiles.openfreemap.org/planet').then(r=>r.json());
      return Promise.all([6190,6189].map(async y=>({y,bytes:Array.from(new Uint8Array(await fetch(planet.tiles[0].replace('{z}','14').replace('{x}','4411').replace('{y}',String(y))).then(r=>r.arrayBuffer())))})));
    });
    const { VectorTile }=await import('@mapbox/vector-tile');
    const { PbfReader }=await import('pbf');
    result.rawSource=raw.map(({y,bytes})=>{
      const vt=new VectorTile(new PbfReader(new Uint8Array(bytes))),b=vt.layers.building,span=2*Math.PI*6378137/16384;
      const wx0=-Math.PI*6378137+4411*span,wz0=-Math.PI*6378137+y*span,items=[];
      for(let i=0;i<b.length;i++){const f=b.feature(i);if(f.type!==3)continue;for(const ring of f.loadGeometry()){const cx=ring.reduce((a,p)=>a+p.x,0)/ring.length,cz=ring.reduce((a,p)=>a+p.y,0)/ring.length;const d=Math.hypot(wx0+cx/b.extent*span-result.flight.pos.x,wz0+cz/b.extent*span-result.flight.pos.z);items.push({d,properties:f.properties,vertices:ring.length});}}
      items.sort((a,b)=>a.d-b.d);return {tile:`14/4411/${y}`,features:b.length,rawPolygonsWithin1000:items.filter(x=>x.d<1000).length,nearest:items.slice(0,4)};
    });
    result.errors=errors;
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));
    await page.screenshot({path:path.join(out,'powell.png')});
    console.log(JSON.stringify({ground:result.ground,flight:result.flight,buildings:result.buildings,fade:result.fade,vegetation:result.vegetation,parcelCount:result.parcels.length,nearestParcels:result.parcels.slice(0,10),regionalColumns:result.regionalColumns,nearest:result.nearest.slice(0,3),rawSource:result.rawSource,meshes:result.meshes,errors},null,2));
  } finally {await browser.close();}
})();
