import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
registerHooks({
  resolve(s,c,next) {
    if(s==='comlink')return {url:'data:text/javascript,export const expose=()=>{};export const transfer=v=>v;',shortCircuit:true};
    if(s.startsWith('@/'))s=new URL('../'+s.slice(2),import.meta.url).href;
    if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}
    return next(s,c);
  },
  load(u,c,next){const r=next(u,c);if(u.endsWith('/toy-world/vector-tile.worker.js'))return {...r,source:r.source.toString()+'\nexport { buildSatBuildings };'};return r;},
});
const {buildAirfieldTile}=await import('../lib/fly/airfield/airfield-tile.js');
const {mergeAirfieldTiles,loadAirfieldFeatures,peekAirfieldFeatures,clearAirfieldCache}=await import('../lib/fly/airfield/airfield-data.js');
const {renderedBuildingBound}=await import('../lib/fly/airfield/rendered-building-bound.js');
const {buildSatBuildings}=await import('../lib/fly/toy-world/vector-tile.worker.js');
const {airfieldRaster,assessPierRearOpening}=await import('../lib/fly/lounge-seat.js');
const {registerAirport}=await import('../lib/fly/operations-airports.js');
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
const rect=(x,z,w,d)=>[{x,y:z},{x:x+w,y:z},{x:x+w,y:z+d},{x,y:z+d},{x,y:z}];
const feature=(id,properties,rings)=>({id,type:3,properties,loadGeometry:()=>rings});
const layer=features=>({extent:4096,length:features.length,feature:i=>features[i]});
const tile={z:14,x:15071,y:9835},world=40075016.68557849,span=world/2**14;
const x0=-world/2+tile.x*span,z0=-world/2+tile.y*span,k=Math.cosh((z0+span/2)/6378137);
const geometry=[rect(1200,1200,100,100),rect(1600,1200,180,140),rect(2200,1200,200,200)];
const vt={layers:{aeroway:layer([feature(1,{class:'aerodrome'},[rect(1000,1000,450,450)])]),building:layer([
  feature(177806520,{render_height:5,render_min_height:0},geometry),
  feature(42,{render_height:44,height:44},[rect(2500,1800,100,100)]),
  feature(43,{render_height:62,height:62},[rect(2800,1800,100,100)]),
])}};
const classic=buildAirfieldTile(vt,tile),enriched=buildAirfieldTile(vt,tile,null,{occluders:true});
check('occluders preserve raw tags, split multipart buildings and include outside-boundary bodies',()=>{
  assert.equal(classic.occluders,undefined);assert.equal(classic.buildings.length,1);
  assert.deepEqual(classic.buildings,enriched.buildings);
  assert.equal(enriched.occluders.length,5);
  assert.equal(enriched.occluders.filter(o=>o.id===177806520).length,3);
  for(const o of enriched.occluders.filter(o=>o.id===177806520)){assert.equal(o.sourceHeight,5);assert.equal(o.inferred,true);assert.ok(o.top>30);}
  assert.equal(enriched.occluders.at(-2).sourceHeight,44);assert.equal(enriched.occluders.at(-2).inferred,false);
});
check('conservative bounds contain actual production worker body and roof vertices for both area modes',()=>{
  for(const trueAreas of [false,true])for(const visuals of [false,true]){
    const result=buildSatBuildings(vt,{tileSpan:span,mercX0:x0,mercYTop:-z0,cx:x0+span/2,cz:z0+span/2,k,t0:performance.now(),trueAreas,visuals});
    const mesh=result.satBuilding;assert.ok(mesh?.pos?.length,'worker emits real geometry');
    let maximum=0;
    for(let i=0;i<mesh.pos.length;i+=3){
      const ax=x0+span/2+mesh.anchor[i/3*2],az=z0+span/2+mesh.anchor[i/3*2+1];
      const o=enriched.occluders.find(b=>{const r=b.rings[0];return ax>=Math.min(...r.filter((_,i)=>i%2===0))-.01&&ax<=Math.max(...r.filter((_,i)=>i%2===0))+.01&&az>=Math.min(...r.filter((_,i)=>i%2===1))-.01&&az<=Math.max(...r.filter((_,i)=>i%2===1))+.01;});
      assert.ok(o,'every rendered anchor has a distinct occluder');
      assert.ok(mesh.pos[i+1]<=o.top+.001,`body/roof ${mesh.pos[i+1]} <= ${o.top}`);maximum=Math.max(maximum,mesh.pos[i+1]);
    }
    assert.ok(maximum>40,'fixture exercises roofs above the source five-metre placeholder');
  }
  assert.ok(renderedBuildingBound({render_height:5,height:5},200,1).bodyTop<10,'a genuinely mapped five is distinct');
});
check('proven sparse-tile context bounds the same worker inference without false tall terminal walls',()=>{
  const sparse={layers:{...vt.layers,building:layer([feature(177806520,{render_height:5},geometry)])}};
  const facts=buildAirfieldTile(sparse,tile,null,{occluders:true});
  assert.ok(facts.occluders.every(o=>o.bodyBasis==='bounded-suburban'&&o.bodyTop===14&&o.top<24));
  for(const trueAreas of [false,true]){
    const result=buildSatBuildings(sparse,{tileSpan:span,mercX0:x0,mercYTop:-z0,cx:x0+span/2,cz:z0+span/2,k,t0:performance.now(),trueAreas,visuals:true});
    assert.ok(result.satBuilding?.pos.length);
    for(let i=1;i<result.satBuilding.pos.length;i+=3)assert.ok(result.satBuilding.pos[i]<24,'production roofs remain below observation floor');
  }
  assert.ok(enriched.occluders.filter(o=>o.inferred).every(o=>o.bodyBasis==='bounded-legacy'&&o.top>40),'mapped-tall context keeps the larger bound');
});
const ring=(x0,x1,z0,z1)=>[x0,z0,x1,z0,x1,z1,x0,z1];
const frame={x:0,z:0,k:1,heading:0};
const field={k:1,bounds:{minX:-1600,maxX:1600,minZ:-1600,maxZ:1600},occluderRevision:1,occluders:[],buildings:[],gates:[]};
check('rear gate requires a contiguous sector at all seven eyes, not isolated clear rays or high aircraft',()=>{
  let r=airfieldRaster(field,[]);assert.equal(r.occlusionHeight,undefined,'classic stays source-only');
  const raster=o=>airfieldRaster({...field,occluders:o},[],8,{occluders:true});
  const open=assessPierRearOpening(raster([]),frame,24);assert.equal(open.safe,true);assert.equal(open.samples.length,7);
  assert.ok(open.samples.every(s=>s.clearDeg>=70));
  assert.equal(open.samples[3].clearDeg,70,'farther route eye is clipped to its real glazing aperture');
  const offWindow=assessPierRearOpening(raster([{top:60,rings:[ring(-400,0,80,200)]}]),frame,24);
  assert.equal(offWindow.safe,false,'right-hand open sky behind a solid rear wall cannot extend the usable aperture');
  assert.ok(offWindow.samples[3].clearDeg<40);
  assert.ok(offWindow.samples[3].rays.filter(r=>r.angle>35||r.angle< -35).every(r=>r.evidence===null));
  const wall=[{top:60,rings:[ring(-400,400,80,100)]}];
  assert.equal(assessPierRearOpening(raster(wall),frame,24).safe,false);
  const slit=[{top:60,rings:[ring(-400,-8,80,100)]},{top:60,rings:[ring(8,400,80,100)]}];
  assert.equal(assessPierRearOpening(raster(slit),frame,24).safe,false);
  const lowerBlocked=assessPierRearOpening(raster([{top:28,rings:[ring(-400,400,80,100)]}]),frame,24);
  assert.equal(lowerBlocked.safe,false);assert.ok(lowerBlocked.samples.slice(4).every(s=>s.clearDeg===100),'upper clarity cannot excuse a blocked lower window');
  assert.equal(assessPierRearOpening(r,frame,24).reason,'missing-rendered-occluders');
});
check('nearer real apron remains usable with distant buildings behind it',()=>{
  const base={...field,occluders:[{top:70,rings:[ring(-900,900,700,740)]}]};
  const closed=airfieldRaster(base,[],8,{occluders:true});assert.equal(assessPierRearOpening(closed,frame,24).safe,false);
  const apron={...base,pavements:[{cls:'apron',rings:[ring(-350,350,80,300)]}]};
  const result=assessPierRearOpening(airfieldRaster(apron,[],8,{occluders:true}),frame,24);
  assert.equal(result.safe,true);assert.ok(result.samples.every(s=>s.rays.some(r=>r.evidence?.kind==='airport-pavement')));
});
const rw=registerAirport({id:'ZZOC:09-27',name:'Occlusion cache test',width:45,a:{lat:-33.94,lon:151.16,elevation:5},b:{lat:-33.94,lon:151.19,elevation:5}});
clearAirfieldCache();let calls=[];
const api={buildTile:async(z,x,y,detail,options)=>{calls.push(options?.occluders===true);return {airfield:buildAirfieldTile(vt,{z,x,y},null,options)};}};
const baseLoad=await loadAirfieldFeatures(rw,{api});const firstCalls=calls.length;
assert.equal(peekAirfieldFeatures('ZZOC',{occluders:true}),null,'base-only cache has no proven rendered occluders');
assert.equal(peekAirfieldFeatures('ZZOC'),baseLoad,'default selector retains source-ground behavior');
const enrichedLoad=await loadAirfieldFeatures(rw,{api,occluders:true});
check('a completed ground-only cache cannot satisfy an enriched visibility request',()=>{
  assert.ok(firstCalls>0);assert.ok(calls.length>firstCalls);assert.ok(calls.slice(firstCalls).every(Boolean));
  assert.equal(enrichedLoad.occluderRevision,1);assert.ok(enrichedLoad.occluders.length>0);
  assert.equal(peekAirfieldFeatures('ZZOC',{occluders:true}),enrichedLoad,'enriched selector survives a base cache entry');
  assert.equal(peekAirfieldFeatures('ZZOC'),baseLoad,'default source selector remains unchanged');
  assert.deepEqual(mergeAirfieldTiles([enriched],{bounds:enriched.bounds}).occluders,enriched.occluders);
});
clearAirfieldCache();
console.log('PASS lounge rendered occlusion: '+count+' checks');
