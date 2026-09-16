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
}finally{Object.assign(globalThis,saved);delete globalThis.__coverWorker;}
console.log(`WORLD COVER: ${checks}/${checks}`);
