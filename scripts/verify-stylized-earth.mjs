import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root=path.resolve('lib/fly'),modules=new Map();
function sourceURL(file){
  const absolute=path.resolve(file);
  if(modules.has(absolute))return modules.get(absolute);
  let source=fs.readFileSync(absolute,'utf8');
  source=source.replace(/from ['"]([^'"]+)['"]/g,(all,spec)=>{
    if(spec==='three')return `from '${pathToFileURL(path.resolve('node_modules/three/build/three.module.js')).href}'`;
    if(spec.startsWith('.'))return `from '${sourceURL(path.resolve(path.dirname(absolute),spec.endsWith('.js')?spec:spec+'.js'))}'`;
    return all;
  });
  const url='data:text/javascript;base64,'+Buffer.from(source).toString('base64');modules.set(absolute,url);return url;
}
const config=await import(sourceURL(path.join(root,'stylized-earth.js')));
const workerProtocol=Number(fs.readFileSync(path.join(root,'toy-world/vector-tile.worker.js'),'utf8').match(/const WORKER_PROTOCOL = (\d+)/)[1]);
const {paintSurfacePolygon,buildEarthSurfaceMask}=await import(sourceURL(path.join(root,'earth-surface-mask.js')));
const {EarthSurfaceEngine}=await import(sourceURL(path.join(root,'earth-surface-engine.js')));
const {resizeEarthHdr}=await import(sourceURL(path.join(root,'earth-hdr.js')));
const {DataUtils}=await import('three');
let checks=0;
function check(name,fn){fn();checks++;console.log(`PASS ${name}`);}
const ring=(a,b,c,d)=>[{x:a,y:b},{x:c,y:b},{x:c,y:d},{x:a,y:d},{x:a,y:b}];
check('administrative parks never manufacture grass',()=>assert.equal(config.surfaceClass('park',{class:'national_scenic_area'}),0));
check('accepted Satellite is the default even with old review bookmarks',()=>{
  assert.equal(config.stylizedEarthOn(),true);
  for(const search of ['', '?earth=stylized', '?earth=legacy', '?graphics=legacy']){
    globalThis.window={location:{search}};assert.equal(config.stylizedEarthOn(),true);
  }
  delete globalThis.window;
});
check('provider park subclasses do not imply grass or trees',()=>{
  for(const subclass of ['park','national_park','nature_reserve']) assert.equal(config.surfaceClass('landcover',{class:'grass',subclass}),0);
});
check('scrub, tundra and wetlands preserve distinct surface identities',()=>{
  for(const subclass of ['scrub','heath','fell','tundra','shrubbery']) assert.equal(config.surfaceClass('landcover',{class:'grass',subclass}),config.EARTH_SURFACE.scrub);
  for(const subclass of ['bog','marsh','swamp','mangrove']) assert.equal(config.surfaceClass('landcover',{class:'wetland',subclass}),config.EARTH_SURFACE.wetland);
  for(const subclass of ['tidalflat','saltern']) assert.equal(config.surfaceClass('landcover',{class:'wetland',subclass}),config.EARTH_SURFACE.tidal);
});
check('real landcover and all seven surface families',()=>{
  for(const [layer,cls,result] of [['landcover','wood',2],['landcover','grass',1],['landuse','farmland',3],['landcover','rock',4],['landcover','sand',5],['landcover','ice',6],['landuse','residential',7],['water','lake',8]])assert.equal(config.surfaceClass(layer,{class:cls}),result);
});
check('polygon holes survive both windings and closed rings',()=>{
  const a=new Uint8Array(64),b=new Uint8Array(64),outer=ring(0,0,8,8),hole=ring(2,2,6,6);
  paintSurfacePolygon(a,8,[outer,hole],8,1);paintSurfacePolygon(b,8,[outer.toReversed(),hole.toReversed()],8,1);
  assert.deepEqual(a,b);assert.equal(a.reduce((n,v)=>n+v,0),48);assert.equal(a[3*8+3],0);assert.equal(a[0],1);
});
check('polygons outside a tile cannot corrupt other rows',()=>{
  const a=new Uint8Array(64);paintSurfacePolygon(a,8,[ring(20,0,30,8)],8,1);assert.equal(a.some(Boolean),false);
});
const feature=(cls,geometry,type=3)=>({type,properties:{class:cls},loadGeometry:()=>geometry});
const layer=(...features)=>({extent:128,length:features.length,feature:i=>features[i]});
const waterMask=buildEarthSurfaceMask({layers:{landcover:layer(feature('grass',[ring(0,0,128,128)])),water:layer(feature('lake',[ring(64,0,128,128)]))}},128);
check('water edges and land retain geographic alignment',()=>{
  assert.equal(waterMask.waterCells,8192);assert.equal(waterMask.classes[0],1);assert.equal(waterMask.classes[127],8);
  assert.equal(waterMask.waterEdges.slice(128,256).every(v=>v===1),true);assert.equal(waterMask.waterEdges.slice(384).some(Boolean),false);
});
check('roads and footprints are explicit exclusions',()=>{
  const mask=buildEarthSurfaceMask({layers:{building:layer(feature('house',[ring(20,20,30,30)])),transportation:layer(feature('primary',[[{x:0,y:50},{x:128,y:50}]],2))}},128);
  assert.equal(mask.exclusion[25*128+25],255);assert.equal(mask.exclusion[50*128+70],255);assert.equal(mask.exclusion[10],0);
});
check('wetlands and seasonal water exclude props without erasing roads',()=>{
  const seasonal={...feature('lake',[ring(0,0,10,10)]),properties:{class:'lake',intermittent:1}};
  const mask=buildEarthSurfaceMask({layers:{landcover:layer(feature('wetland',[ring(0,0,128,128)])),water:layer(seasonal),transportation:layer(feature('primary',[[{x:0,y:50},{x:128,y:50}]],2))}},128);
  // Revision 6 adds Living Earth occupancy/pavement metadata; mask layout stays fixed.
  assert.equal(mask.revision,6);assert.equal(mask.exclusion[25*128+25],128);
  assert.equal(mask.exclusion[50*128+70],255);assert.equal(mask.exclusion[5*128+5],255);
  assert.equal(mask.classes[25*128+25],config.EARTH_SURFACE.wetland);assert.equal(mask.waterCells,0);
});
check('missing data is unknown, never invented ocean',()=>{
  const mask=buildEarthSurfaceMask({layers:{}},128);assert.equal(mask.classes.some(Boolean),false);assert.equal(mask.waterCells,0);
});
check('all spatial phases survive negative origins and whole-period rebases',()=>{
  for(const origin of [-131072,-8193,-1,0,8191,8192,53687091])for(const shift of [-65536,-8192,8192,65536]) {
    assert.equal(config.earthPatternPhase(origin),config.earthPatternPhase(origin+shift));
    const physical=origin+317.25, first=(physical-origin+config.earthPatternPhase(origin))*Math.PI*2/8192;
    const second=(physical-origin-shift+config.earthPatternPhase(origin+shift))*Math.PI*2/8192;
    for(const frequency of [419,317,157,463,93,2239,1717])assert.ok(Math.abs(Math.sin(first*frequency)-Math.sin(second*frequency))<1e-9);
  }
  for(const origin of [-131071.25,-1,53687091])for(const shift of [-3277.5,1,4096,12345.25]){
    const physical=origin+317.25;
    const a=(physical-origin+config.earthPatternPhase(origin))*Math.PI*2/8192;
    const b=(physical-origin-shift+config.earthPatternPhase(origin+shift))*Math.PI*2/8192;
    for(const frequency of [419,317,157,463,93,2239,1717])assert.ok(Math.abs(Math.sin(a*frequency)-Math.sin(b*frequency))<1e-9);
  }
});
check('HDR resize averages radiance, not half-float encodings',()=>{
  const values=new Uint16Array(4*2*4);
  for(let i=0;i<8;i++)for(let c=0;c<4;c++)values[i*4+c]=DataUtils.toHalfFloat(c===3?1:i%2===0?0:4);
  const texture={image:{width:4,height:2,data:values}};
  resizeEarthHdr(texture,2);assert.equal(texture.image.width,2);assert.equal(texture.image.height,1);
  assert.equal(DataUtils.fromHalfFloat(texture.image.data[0]),2);assert.equal(DataUtils.fromHalfFloat(texture.image.data[3]),1);
  assert.equal(texture.needsUpdate,true);
});
const promises=[];
const api={buildTile:()=>new Promise(resolve=>promises.push(resolve))};
const engine=new EarthSurfaceEngine(api);
const runtime={flight:{pos:{x:0,z:0},latDeg:0},origin:{anchor:{x:0,z:0}},sun:{sinEl:1,az:0}};
engine.update(runtime,0);
check('48 resident slots and exactly 6 MiB of GPU mask storage',()=>{
  assert.equal(engine.bands.reduce((n,b)=>n+b.slots.length,0),48);assert.equal(engine.stats.maskBytes,6*1024*1024);
});
check('at most two worker requests and no geometry draws',()=>{assert.equal(promises.length,2);assert.equal(engine.stats.draws,0);});
runtime.flight.pos.x+=1000000;engine.update(runtime,1);
for(const resolve of promises)resolve({v:workerProtocol,surface:waterMask});
await new Promise(resolve=>setTimeout(resolve,0));
engine.update(runtime,2);engine.update(runtime,2.02);
check('late results cannot repaint recycled slots after travel',()=>assert.equal(engine.stats.staleDropped,2));
check('finer unclassified land retires coarse water without inventing a surface',()=>{
  const b=engine.bands[0],slot=b.slots[0];slot.key='9/0/0';slot.generation++;
  engine._commit({b,index:0,key:slot.key,generation:slot.generation,result:{surface:buildEarthSurfaceMask({layers:{}},b.size)}},3);
  assert.equal(b.texture.image.data[3],64);assert.equal(b.texture.image.data[0],0);
  assert.equal(slot.mask.classes.some(Boolean),false);
});
engine.dispose();
check('disposal releases the pending work and leaves the engine inactive',()=>{assert.equal(engine.disposed,true);assert.equal(engine.queue.length,0);assert.equal(engine.pending.length,0);});
const oldMasks=new EarthSurfaceEngine({buildTile:async()=>({v:workerProtocol,surface:{...waterMask,revision:2}})});
oldMasks.update(runtime,0);await new Promise(resolve=>setTimeout(resolve,0));
check('old derived-mask revisions are rejected even when the worker protocol matches',()=>{
  assert.equal(oldMasks.stats.failed,2);assert.equal(oldMasks.stats.commits,0);assert.equal(oldMasks.pending.length,0);
});
oldMasks.dispose();
// Match the producer's actual version, not the consumer's expectation: the
// ground-operations bump omitted this seventh consumer and boot hung at 93%.
const currentMasks=new EarthSurfaceEngine({buildTile:async(z,x,y,detail,{size})=>({v:workerProtocol,surface:buildEarthSurfaceMask({layers:{}},size)})});
for(let frame=0;frame<64;frame++){
  currentMasks.update(runtime,frame/60);
  await new Promise(resolve=>setTimeout(resolve,0));
}
check('current worker surface results commit and satisfy the local boot ring',()=>{
  assert.equal(currentMasks.stats.failed,0);
  assert.equal(currentMasks.stats.ready,48);
  assert.equal(currentMasks.stats.near.ready,true);
});
currentMasks.dispose();
check('hydrology keeps imagery dominant and mapped roads remain photographic',()=>{
  const e=new EarthSurfaceEngine(api),b=e.bands[0],slot=b.slots[0];slot.key='wet';slot.generation=1;
  const wet=buildEarthSurfaceMask({layers:{landcover:layer(feature('wetland',[ring(0,0,128,128)])),transportation:layer(feature('primary',[[{x:0,y:50},{x:128,y:50}]],2))}},128);
  e._commit({b,index:0,key:'wet',generation:1,result:{surface:wet}},0);
  const width=b.size*4;assert.equal(b.texture.image.data[(25*width+25)*4+3],90);assert.equal(b.texture.image.data[(50*width+25)*4+3],64);e.dispose();
});
check('all worker consumers agree on protocol 23',()=>{
  assert.equal(config.STYLIZED_EARTH.protocol,workerProtocol,'EarthSurfaceEngine must accept the worker protocol');
  for(const name of ['sat-building','sat-clutter','sat-road','sat-skyline','sat-veg','toy-world'])assert.match(fs.readFileSync(path.join(root,`toy-world/${name}-engine.js`),'utf8'),/EXPECTED_WORKER_PROTOCOL = 23/);
  assert.match(fs.readFileSync(path.join(root,'toy-world/vector-tile.worker.js'),'utf8'),/WORKER_PROTOCOL = 23/);
});
console.log(`STYLIZED EARTH: PASS ${checks}/${checks}`);
