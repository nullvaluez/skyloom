import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import fixture from './r24-b-fixture.js';
registerHooks({resolve(specifier,context,next){
  if(specifier==='comlink')return {url:'data:text/javascript,export const expose=api=>globalThis.__coverWorker=api;export const transfer=value=>value;',shortCircuit:true};
  if(specifier.startsWith('@/'))specifier=new URL('../'+specifier.slice(2),import.meta.url).href;
  if(specifier.startsWith('.')||specifier.startsWith('file:')){
    const url=new URL(specifier,context.parentURL);
    if(fs.existsSync(fileURLToPath(url)+'.js'))return next(url.href+'.js',context);
  }return next(specifier,context);
}});
const {WORLD_COVER,decodeWorldCover,worldCoverURL,loadWorldCover,worldCoverAt,combineWorldCover}=await import('../lib/fly/world-cover.js');
const {buildEarthSurfaceMask}=await import('../lib/fly/earth-surface-mask.js');
const {EARTH_SURFACE:S}=await import('../lib/fly/stylized-earth.js');
const {surfaceMaterialId}=await import('../lib/fly/cinematic-material-data.js');
let checks=0;const check=async(name,fn)=>{await fn();checks++;console.log(`PASS ${name}`);};
const rgba=new Uint8ClampedArray(256*256*4);
const paint=(hex)=>{for(let i=0;i<rgba.length;i+=4){rgba[i]=hex>>16;rgba[i+1]=hex>>8&255;rgba[i+2]=hex&255;rgba[i+3]=255;}};
await check('published categories decode exactly; transparency and blended colors remain unknown',()=>{
  const samples=[[0x006400,10],[0xffbb22,20],[0xffff4c,30],[0xf096ff,40],[0xfa0000,50],[0xb4b4b4,60],[0xf0f0f0,70],[0x0064c8,80],[0x0096a0,90],[0x00cf75,95],[0xfae6a0,100]];
  for(const [hex,code] of samples){paint(hex);assert.equal(decodeWorldCover(rgba)[120],code);}
  rgba[3]=0;rgba[4]=1;const decoded=decodeWorldCover(rgba);assert.equal(decoded[0],0);assert.equal(decoded[1],0);
  assert.throws(()=>decodeWorldCover(rgba,512,128));
});
await check('global tile coordinates wrap at the dateline and reject unavailable polar coverage',()=>{
  assert.equal(worldCoverURL(14,-1,8192),worldCoverURL(14,16383,8192));
  for(const args of [[15,1,1],[5,1,1],[14,0,-1],[14,0,0],[14,0,16383]])assert.equal(worldCoverURL(...args),null);
  const c=new Uint8Array(65536);c[255]=70;assert.equal(worldCoverAt(c,127.9,0,128),70);assert.equal(worldCoverAt(c,128,0,128),0);
});
await check('raster fills only unknown or broad developed land, preserving mapped surfaces and exclusions',()=>{
  const mask=buildEarthSurfaceMask({layers:{}},128),cover=new Uint8Array(65536).fill(10);
  mask.classes[0]=S.concrete;mask.classes[1]=S.water;mask.classes[2]=S.grass;mask.classes[3]=S.developed;mask.exclusion[4]=255;
  combineWorldCover(mask,cover);
  assert.deepEqual([...mask.classes.slice(0,5)],[S.concrete,S.water,S.grass,S.wood,S.unknown]);
  assert.equal(mask.worldCover.added,128*128-4);assert.equal(mask.worldCover.available,true);
  assert.equal(mask.waterCells,1);assert.equal(mask.waterEdges[1],1);
  for(const [code,cls,excluded] of [[80,S.water,255],[90,S.wetland,128],[60,S.bare,0],[50,S.developed,128]]){
    const m=combineWorldCover(buildEarthSurfaceMask({layers:{}},128),new Uint8Array(65536).fill(code));
    assert.equal(m.classes[0],cls);assert.equal(m.exclusion[0],excluded);
  }
  assert.equal(surfaceMaterialId(S.bare),5);
  const original=buildEarthSurfaceMask({layers:{}},128);combineWorldCover(original,null);assert.equal(original.worldCover.available,false);assert.equal(original.classifiedCells,0);
});
const saved={fetch:globalThis.fetch,OffscreenCanvas:globalThis.OffscreenCanvas,createImageBitmap:globalThis.createImageBitmap,caches:globalThis.caches};
let closed=0,calls=0,active=0,peak=0,fail=false;
globalThis.OffscreenCanvas=class{getContext(){return {drawImage(){},getImageData(){return {data:rgba};}};}};
globalThis.createImageBitmap=async()=>({width:256,height:256,close(){closed++;}});
globalThis.caches=undefined;
const fetchCover=async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;return new Response(new Uint8Array([1,2,3]),{status:fail?503:200,headers:{'content-type':'image/png'}});};
globalThis.fetch=fetchCover;paint(0x006400);
try{
  await check('vector worker shares TileJSON initialization, limits full body downloads and recovers a stalled body',async()=>{
    const {TILE_PIPELINE}=await import('../lib/fly/fly-constants.js');
    const timeout=TILE_PIPELINE.fetchTimeoutMs;
    const source=globalThis.fetch;
    try {
      await import('../lib/fly/toy-world/vector-tile.worker.js?stream-scheduling');
      const worker=globalThis.__coverWorker;
      let manifests=0;
      globalThis.fetch=async()=>{ manifests++; return new Response(null,{status:503}); };
      const failed=await Promise.allSettled([worker.init(),worker.init(),worker.init()]);
      assert.ok(failed.every(r=>r.status==='rejected'));assert.equal(manifests,1);
      globalThis.fetch=async()=>{ manifests++; return Response.json({tiles:['https://fixture/{z}/{x}/{y}.pbf']}); };
      await Promise.all([worker.init(),worker.init()]);assert.equal(manifests,2);
      const slots=TILE_PIPELINE.maxConcurrentFetches;
      let transfers=0,peak=0,requests=0;
      globalThis.fetch=async()=>({
        ok:true,status:200,arrayBuffer:async()=>{
          requests++;peak=Math.max(peak,++transfers);
          await new Promise(resolve=>setTimeout(resolve,3));transfers--;
          return new ArrayBuffer(0);
        }
      });
      const build=x=>worker.buildTile(14,x,6500,'sat-roads');
      await Promise.all([...Array.from({length:slots*3},(_,i)=>build(i)),build(0)]);
      assert.equal(peak,slots);assert.equal(requests,slots*3);
      TILE_PIPELINE.fetchTimeoutMs=20;
      globalThis.fetch=async(_url,{signal})=>({
        ok:true,status:200,arrayBuffer:()=>new Promise((_resolve,reject)=>{
          signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
        })
      });
      // Keep a broken deadline from hanging this regression indefinitely.
      let guard;
      try {
        await assert.rejects(Promise.race([build(89),new Promise((_,reject)=>{
          guard=setTimeout(()=>reject(Error('worker deadline missing')),500);
        })]),/http-timeout/);
      } finally {clearTimeout(guard);}
      globalThis.fetch=async()=>new Response(null,{status:404});
      assert.equal((await build(89)).empty,true);
    } finally { TILE_PIPELINE.fetchTimeoutMs=timeout;globalThis.fetch=source; }
  });
  await check('requests coalesce, concurrency stays at two, decoded memory has an LRU bound',async()=>{
    const [a,b]=await Promise.all([loadWorldCover(14,7000,7000),loadWorldCover(14,7000,7000)]);
    assert.equal(calls,1);assert.equal(a,b);assert.equal(a[0],10);
    await Promise.all(Array.from({length:WORLD_COVER.memoryTiles+2},(_,i)=>loadWorldCover(14,7100+i,7000)));
    assert.equal(peak,2);const before=calls;await loadWorldCover(14,7000,7000);assert.equal(calls,before+1);assert.equal(closed,calls);
  });
  await check('provider errors keep a bounded retry fallback and corrupt cache entries are removed',async()=>{
    fail=true;assert.equal(await loadWorldCover(14,7800,7000),null);const before=calls;
    assert.equal(await loadWorldCover(14,7800,7000),null);assert.equal(calls,before);fail=false;
    let removed=0;globalThis.caches={open:async()=>({match:async()=>new Response('bad',{headers:{'content-type':'text/plain'}}),delete:async()=>{removed++;}})};
    assert.equal(await loadWorldCover(14,7801,7000),null);assert.equal(removed,1);globalThis.caches=undefined;
  });
  await check('actual worker fills unmapped forest with deterministic capped trees and protects runways',async()=>{
    const land={extent:4096,features:[{type:3,props:{class:'unknown'},rings:[fixture.rect(0,0,4096,4096,false)]}]};
    const airport=fixture.encodeTile({landcover:land,aeroway:{extent:4096,features:[{type:2,props:{class:'runway'},rings:[[{x:0,y:2048},{x:4096,y:2048}]]}]}});
    const restore=fixture.installFetchStub(()=>airport),vectorFetch=globalThis.fetch;
    globalThis.fetch=(url,options)=>String(url).includes('wmts.terrascope.be')?fetchCover(url,options):vectorFetch(url,options);
    try{
      await import('../lib/fly/toy-world/vector-tile.worker.js');
      const a=await globalThis.__coverWorker.buildTile(14,8000,6500,'sat-veg');
      const b=await globalThis.__coverWorker.buildTile(14,8000,6500,'sat-veg');
      assert.ok(a.satVeg.length>=400&&a.satVeg.length<=1600);assert.deepEqual(a.satVeg,b.satVeg);
      const radii=Array.from({length:a.satVeg.length/4},(_,i)=>a.satVeg[i*4+2]);
      const mean=radii.reduce((n,v)=>n+v,0)/radii.length;
      assert.ok(mean>4.8&&mean<6.2&&Math.max(...radii)-Math.min(...radii)>3,'Admission order must not select almost exclusively small trees');
      const span=40075016.68557849/2**14,cz=-(40075016.68557849/2-6500.5*span),k=Math.cosh(cz/6378137);
      for(let i=0;i<a.satVeg.length;i+=4)assert.ok(Math.abs(a.satVeg[i+1])/k>=48);
      const surface=await globalThis.__coverWorker.buildTile(14,8000,6500,'earth-surface',{size:128});
      assert.ok(surface.surface.worldCover.added>0);assert.equal(surface.surface.worldCover.available,true);
    }finally{restore();}
  });
  await check('unknown raster pixels retain trees supported by existing woodland polygons',async()=>{
    paint(0xffffff);
    const wood=fixture.encodeTile({landcover:{extent:4096,features:[{type:3,props:{class:'wood'},rings:[fixture.rect(0,0,4096,4096,false)]}]}});
    const restore=fixture.installFetchStub(()=>wood),vectorFetch=globalThis.fetch;
    globalThis.fetch=(url,options)=>String(url).includes('wmts.terrascope.be')?fetchCover(url,options):vectorFetch(url,options);
    try{const result=await globalThis.__coverWorker.buildTile(14,8200,6500,'sat-veg');assert.ok(result.satVeg.length>0);}
    finally{restore();}
  });
  await check('resident roof photos recover after outages and complementary partial mosaics',async()=>{
    const {WORLD_LOOK}=await import('../lib/fly/fly-constants.js');
    const {requestLookRoofPatch,pumpLookRoofRetries,cancelLookRoofPatch,disposeLookRoofPatches}=await import('../lib/fly/look-roof-patch.js');
    const {lookRoofState}=await import('../lib/fly/toy-world/worker/look-roofs.js');
    const worker=globalThis.__coverWorker, x=6500,y=6500,key=`14/${x}/${y}`;
    const req={any:true,v:1,key:'roof-retry-fixture',tier:'ultra',truth:{},arrival:{},reach:{},ground:{},
      look:{on:true,roofPhoto:true,walls:true,authority:true,structures:true,worker:{...WORLD_LOOK.worker,
        photo:{...WORLD_LOOK.worker.photo,zoom:15,refZoom:14,retries:0}}}};
    const restore=fixture.installFetchStub(()=>fixture.encodeTile(fixture.scene('suburb')));
    const vectorFetch=globalThis.fetch,clock=globalThis.performance;
    const chunk={state:'draping'},engine={chunks:new Map([[key,chunk]]),pendingFinalize:[]};
    const doneBefore=lookRoofState().done;
    const seen=[0,0,0,0],answers=[];
    let stage=0,time=100;
    const api={async lookRoofPatch(...args){const patch=await worker.lookRoofPatch(...args);answers.push(patch);return patch;}};
    try {
      Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>time}});
      paint(0x998877);
      globalThis.fetch=async(url,opts)=>{
        const match=String(url).match(/\/tile\/15\/(\d+)\/(\d+)/);
        if(!match)return vectorFetch(url,opts);
        const i=(Number(match[1])-2*y)*2+Number(match[2])-2*x;seen[i]++;
        const status=i===3?404:stage===0||stage===1&&i===1||stage===2&&i===0?503:200;
        return new Response(status===200?new Uint8Array(3000):null,{status});
      };
      const result=await worker.buildTile(14,x,y,'sat-buildings',{visuals:true,worldPass:req});
      assert.ok(result.lookPatch);
      engine.pendingFinalize.push({key,result});
      requestLookRoofPatch(engine,api,key,result);
      const wait=async n=>{
        for(let i=0;i<100&&answers.length<n;i++)await new Promise(r=>setImmediate(r));
        assert.equal(answers.length,n);
      };
      await wait(1);
      assert.equal(answers[0].retry,true);assert.equal(answers[0].verts,null);
      time+=4900;pumpLookRoofRetries(engine);assert.equal(answers.length,1);
      for(stage=1;stage<=3;stage++){
        time+=60000;pumpLookRoofRetries(engine);await wait(stage+1);
        assert.equal(answers[stage].retry,stage<3);
        assert.ok(answers[stage].counts.photo>0);
        if(stage>1)assert.ok(answers[stage].counts.photo>=answers[stage-1].counts.photo);
        assert.equal(lookRoofState().done,doneBefore+Number(stage===3));
      }
      assert.deepEqual(seen,[4,4,4,1]);assert.equal(engine._lookRoofJobs.size,0);
      const next=await worker.buildTile(14,x,y,'sat-buildings',{visuals:true,worldPass:req});
      assert.equal(next.lookPatch,undefined);assert.equal(next.lookRoofs.cached,1);
      const regionalRequest={...req,key:'roof-regional-fixture',look:{...req.look,worker:{...req.look.worker,
        photo:{...req.look.worker.photo,zoom:16,refZoom:11}}}};
      const savedCanvas=globalThis.OffscreenCanvas,savedBitmap=globalThis.createImageBitmap;
      try {
        let regionalStatus=503,regionalCalls=0,localCalls=0;
        globalThis.fetch=async(url,opts)=>{
          const m=String(url).match(/\/tile\/(11|16)\/(\d+)\/(\d+)/);
          if(!m)return vectorFetch(url,opts);
          if(m[1]==='11'){
            regionalCalls++;
            return new Response(regionalStatus===200?new Uint8Array(4001):null,{status:regionalStatus});
          }
          localCalls++;return new Response(new Uint8Array(4000));
        };
        globalThis.createImageBitmap=async blob=>({shade:blob.size===4001?160:100,close(){}});
        globalThis.OffscreenCanvas=class {
          constructor(w,h){this.w=w;this.h=h;}
          getContext(){let shade=0;return {drawImage(b){shade=b.shade;},getImageData:()=>({data:new Uint8ClampedArray(this.w*this.h*4).fill(shade)})};}
        };
        const near=await worker.buildTile(14,x+32,y,'sat-buildings',{visuals:true,worldPass:regionalRequest});
        const provisional=await worker.lookRoofPatch(near.lookPatch);
        assert.equal(provisional.photoTiles,16);assert.equal(provisional.retry,true);
        const waiting=await worker.lookRoofPatch(near.lookPatch);
        assert.equal(waiting.retry,true);assert.equal(localCalls,16);
        time+=16000;regionalStatus=200;
        const balanced=await worker.lookRoofPatch(near.lookPatch);
        assert.equal(balanced.retry,false);assert.equal(balanced.counts.photo,provisional.counts.photo);
        assert.ok(balanced.wallVerts>0);
        const old=new Map(Array.from(provisional.verts,(v,i)=>[v,provisional.col[i*3]]));
        assert.ok(balanced.verts.some((v,i)=>old.has(v)&&balanced.col[i*3]>old.get(v)),'same roof source must acquire the brighter regional exposure');
        assert.equal(regionalCalls,2);
        regionalStatus=404;
        const absent=await worker.buildTile(14,x+96,y,'sat-buildings',{visuals:true,worldPass:regionalRequest});
        assert.equal((await worker.lookRoofPatch(absent.lookPatch)).retry,false);
        time+=65000;
        const neighbour=await worker.buildTile(14,x+97,y,'sat-buildings',{visuals:true,worldPass:regionalRequest});
        assert.equal((await worker.lookRoofPatch(neighbour.lookPatch)).retry,false);
        assert.equal(regionalCalls,3,'same terminal regional miss must be shared across neighbouring buildings');
      } finally {globalThis.OffscreenCanvas=savedCanvas;globalThis.createImageBitmap=savedBitmap;}
      // A stale reply to the same coordinates must never reach a replacement.
      let reply;
      const oldColor=result.satBuilding.col.slice();
      const delayed={lookRoofPatch:(_id,action)=>action==='cancel'?null:new Promise(r=>{reply=r;})};
      requestLookRoofPatch(engine,delayed,key,result);await Promise.resolve();
      cancelLookRoofPatch(engine,key);
      engine.chunks.set(key,{state:'draping'});
      reply({verts:new Uint32Array([0]),col:new Uint8Array([255,0,255]),retry:true});
      await new Promise(r=>setImmediate(r));
      assert.deepEqual(result.satBuilding.col,oldColor);assert.equal(engine._lookRoofJobs.size,0);
    } finally {
      disposeLookRoofPatches(engine);restore();
      Object.defineProperty(globalThis,'performance',{configurable:true,value:clock});
    }
  });
}finally{Object.assign(globalThis,saved);delete globalThis.__coverWorker;}
console.log(`WORLD COVER: ${checks}/${checks}`);
