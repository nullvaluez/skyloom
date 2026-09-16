import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import fixture from './r24-b-fixture.js';
registerHooks({resolve(s,c,n){
  if(s==='comlink')return{url:'data:text/javascript,export const expose=api=>globalThis.__livingWorker=api;export const transfer=value=>value;',shortCircuit:true};
  if(s.startsWith('@/'))s=new URL('../'+s.slice(2),import.meta.url).href;
  if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return n(u.href+'.js',c);}
  return n(s,c);
}});
const {LIVE_AIRCRAFT,resolveLiveAircraft,liveGearDown}=await import('../lib/fly/live-aircraft.js');
const {buildLiveAirframe}=await import('../lib/fly/live-aircraft-geometry.js');
const {buildForestCluster,LivingForest}=await import('../lib/fly/living-forest.js');
const {deriveWorldContent}=await import('../lib/fly/world-content.js');
const {architectureRegion}=await import('../lib/fly/living-regions.js');
const {inferBuildingStyle}=await import('../lib/fly/building-profiles.js');
const {localRingReadiness,worldReadiness}=await import('../lib/fly/world-readiness.js');
const {steppedBuildingLevels,emitSteppedBuilding}=await import('../lib/fly/living-architecture.js');
const {buildRoadsideInfill}=await import('../lib/fly/settlement-infill.js');
const {buildAirportSurfaces}=await import('../lib/fly/airport-surfaces.js');
const {LivingAirports}=await import('../lib/fly/living-airports.js');
const {DetailedTraffic}=await import('../lib/fly/detailed-traffic.js');
const {GroundSupportView}=await import('../lib/fly/ground-support-view.js');
const {PerspectiveCamera}=await import('three');
const {Tile}=await import('../lib/fly/vendor/three-tile/index.js');
const {livingSkyPalette}=await import('../lib/fly/living-sky.js');
const {immersiveLighting}=await import('../lib/fly/immersive.js');
const {livingAirProfile,livingAirTransmission}=await import('../lib/fly/living-atmosphere.js');
const {VectorTile}=await import('@mapbox/vector-tile');const {PbfReader}=await import('pbf');
const decode=layers=>new VectorTile(new PbfReader(fixture.encodeTile(layers)));
let checks=0;const check=(name,fn)=>{fn();checks++;console.log(`PASS ${name}`);};
check('atmospheric depth protects the foreground and separates distant terrain across weather and latitude',()=>{
  const clear=livingAirProfile(),fog=livingAirProfile({fogT:1});
  assert.equal(livingAirTransmission(250,100,0,clear),1,'Nearby detail remains clear');
  const near=livingAirTransmission(1000,100,0,clear),far=livingAirTransmission(6000,100,0,clear);
  assert.ok(near>.9&&far<.55,'The landscape has real distance separation');
  assert.ok(livingAirTransmission(6000,2000,2000,clear)>far,'High terrain emerges from the denser low air');
  assert.ok(livingAirTransmission(6000,100,0,fog)<far,'Reported fog thickens the same depth law');
  for(const latitude of [0,40,60,85]){
    const profile=livingAirProfile({},latitude),mapDistance=6000*profile.metricScale;
    assert.ok(Math.abs(livingAirTransmission(mapDistance/profile.metricScale,100,0,profile)-far)<1e-12);
    assert.ok(Number.isFinite(profile.metricScale));
  }
});
check('sky and surface light respond continuously to the same weather without changing night illumination',()=>{
  const sun={sinEl:.7},clearLight=immersiveLighting(sun,{overcastT:0}),cloudLight=immersiveLighting(sun,{overcastT:1});
  const clear=livingSkyPalette(clearLight),cloud=livingSkyPalette(cloudLight);
  const chroma=color=>Math.max(...color)-Math.min(...color);
  assert.ok(cloudLight.sun<clearLight.sun*.25,'Overcast loses the directional key');
  assert.ok(chroma(cloud.zenith)<chroma(clear.zenith)*.3,'Its background must also lose the clear blue sky');
  assert.equal(cloud.sunVisibility,0,'A solid overcast does not expose the solar disc');
  assert.equal(livingSkyPalette(clearLight,{fogT:1}).sunVisibility,0);
  let previous=clear;
  for(let i=0;i<=100;i++){
    const sky=livingSkyPalette(immersiveLighting(sun,{overcastT:i/100}));
    for(const name of ['horizon','zenith'])for(let c=0;c<3;c++){
      assert.ok(Number.isFinite(sky[name][c])&&sky[name][c]>=0&&sky[name][c]<=1);
      assert.ok(Math.abs(sky[name][c]-previous[name][c])<.01,'Weather reports cannot switch sky buckets');
    }
    previous=sky;
  }
  const night=immersiveLighting({sinEl:-.4});
  assert.equal(night.day,0);assert.equal(night.sun,.09);assert.equal(night.fill,.10);assert.equal(night.environment,.14);
});
check('arrival terrain refinement is local, bounded in zoom, wraps longitude and retires cleanly',()=>{
  const world=40075016.68557849,span=world/2**14,root={flyArrivalGround:{x:span/2,z:span/2,radius:1000,zoom:15}};
  const tile={_root:root,x:8192,y:8192,z:14};
  assert.equal(Tile.prototype._arrivalGroundRequired.call(tile),true);
  assert.equal(Tile.prototype._arrivalGroundRequired.call({...tile,x:8100}),false);
  assert.equal(Tile.prototype._arrivalGroundRequired.call({...tile,z:15,x:16384,y:16384}),false);
  root.flyArrivalGround.x=world/2-1;
  assert.equal(Tile.prototype._arrivalGroundRequired.call({...tile,x:0}),true);
  root.flyArrivalGround=null;assert.equal(Tile.prototype._arrivalGroundRequired.call(tile),false);
});
check('arrival support waits for visible terrain with normal and reversed depth, including rebases',()=>{
  for(const reversed of [false,true]){
    const camera=new PerspectiveCamera(60,16/9,.1,600000);camera._reversedDepth=reversed;camera.updateProjectionMatrix();
    camera.position.set(0,300,0);camera.lookAt(0,0,-1000);camera.updateMatrixWorld();
    const anchor={x:-9138624,z:-5039936},view=new GroundSupportView();view.update({camera,origin:{anchor}});
    assert.equal(view.visible(anchor.x,anchor.z-600,0,80),true);
    assert.equal(view.visible(anchor.x,anchor.z+600,0,80),false,'Unrefined terrain behind camera must not deadlock entry');
    assert.equal(view.visible(anchor.x,anchor.z-600,-200,80),true);
    const point={x:anchor.x,z:anchor.z-600};anchor.x+=1200;anchor.z-=2400;camera.position.x-=1200;camera.position.z+=2400;camera.updateMatrixWorld();view.update({camera,origin:{anchor}});
    assert.equal(view.visible(point.x,point.z,0,80),true);
  }
});
check('type-code resolver differentiates narrowbody, widebody, regional and prop families',()=>{
  assert.notEqual(resolveLiveAircraft({t:'A320'},0),resolveLiveAircraft({t:'B738'},0));
  assert.notEqual(resolveLiveAircraft({t:'CRJ9'},1),resolveLiveAircraft({t:'E190'},0));
  assert.notEqual(resolveLiveAircraft({t:'AT76'},2),resolveLiveAircraft({t:'DH8D'},2));
  assert.equal(resolveLiveAircraft({t:'ZZZZ'},8),null);assert.equal(resolveLiveAircraft({},3),15);
  assert.equal(liveGearDown({flags:1}),true);assert.equal(liveGearDown({flags:0}),false);
});
check('all 19 family models have finite geometry, navigation lights and a cheaper matching distant model',()=>{
  assert.equal(LIVE_AIRCRAFT.length,19);
  const signatures=new Set();
  for(const f of LIVE_AIRCRAFT){const m=buildLiveAirframe(f);
    for(const g of [m.hull,m.gear]){
      for(const attr of Object.values(g.attributes))for(const n of attr.array)assert.ok(Number.isFinite(n),f.id);
      assert.equal(g.attributes.uv.count,g.attributes.position.count);assert.equal(g.attributes.aSurfaceRole.count,g.attributes.position.count);
      assert.ok(g.attributes.position.count/3<12000,f.id);
    }
    const far=buildLiveAirframe(f,false);assert.ok(far.hull.attributes.position.count<=m.hull.attributes.position.count);
    assert.ok(m.hull.attributes.aEmissive.array.some(n=>n>1));
    assert.ok(Math.abs(m.hull.boundingBox.max.x-m.hull.boundingBox.min.x-f.span)<f.span*.18||f.helicopter,'Span remains type specific');
    far.hull.dispose();far.gear.dispose();
    const p=m.hull.attributes.position.array;signatures.add(`${p.length}:${Array.from(p.subarray(0,90)).join(',')}`);
    assert.ok(m.groundOffset>0);m.hull.dispose();m.gear.dispose();
  }
  assert.equal(signatures.size,19);
});
check('forest occupancy preserves exclusion holes and is deterministic',()=>{
  const mask=()=>({size:128,classes:new Uint8Array(128*128).fill(2),exclusion:new Uint8Array(128*128)});
  const a=mask();for(let y=0;y<128;y++)a.exclusion[y*128+64]=255;
  const result=deriveWorldContent({layers:{}},a);assert.ok(result.forest.length>0);
  for(let i=0;i<result.forest.length;i+=3){const x=result.forest[i]*128,w=result.forest[i+2]*128;assert.ok(!(x-w/2<=64&&x+w/2>64));}
  assert.deepEqual(result.forest,deriveWorldContent({layers:{}},a).forest);
  const bare=mask();bare.classes.fill(5);assert.equal(deriveWorldContent({layers:{}},bare).forest.length,0);
});
check('forest cluster geometry is finite and under 400 triangles',()=>{
  for(const detail of [true,false]){
    const g=buildForestCluster(detail);assert.ok(g.index.count/3<=400);
    for(const n of g.attributes.normal.array)assert.ok(Number.isFinite(n));
    const p=g.attributes.position;
    for(let i=0;i<p.count;i++)assert.ok(Math.hypot(p.getX(i),p.getZ(i))+.025<.5,'Rotated and jittered crowns remain inside known forest');
    assert.equal(g.attributes.uv.count,p.count);assert.equal(g.attributes.aForestLeaf.count,p.count);
    assert.ok(g.attributes.aForestLeaf.array.some(v=>v===1));if(detail)assert.ok(g.attributes.aForestLeaf.array.some(v=>v===0));g.dispose();
  }
});
check('forest render subdivisions preserve every source stand and absolute position through rebases',()=>{
  const span=40075016.68557849/16384,points=Float32Array.from([.125,.125,.03,.625,.125,.03,.125,.625,.03,.625,.625,.03]);
  const surface={bands:[null,null,{span,slots:[{key:'14/8192/8192',state:'ready',mask:{forest:points}}]}],stats:{commits:1}};
  const rt={flight:{latDeg:0,pos:{x:0,y:100,z:0},groundElev:0},origin:{anchor:{x:0,z:0}},engine:{getGroundAt:()=>({elev:12,tileZ:16})}};
  const layer=new LivingForest();for(let i=0;i<8;i++)layer.update(surface,rt,i/60);
  const coordinates=()=>[...layer.tiles.values()].flatMap(t=>t.rows.map(r=>[r.x,r.z])).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const expected=Array.from({length:4},(_,i)=>[points[i*3]*span,points[i*3+1]*span]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  assert.deepEqual(coordinates(),expected);assert.equal(layer.stats.patches,4);
  rt.origin.anchor={x:5000,z:-5000};layer.update(surface,rt,1);assert.deepEqual(coordinates(),expected);layer.dispose();
});
check('regional context follows country geography and source tags remain authoritative',()=>{
  assert.equal(architectureRegion(35.68,139.76).style,'east-asia');assert.equal(architectureRegion(-8.65,115.22).style,'tropical-asia');
  assert.equal(architectureRegion(40.14,-83.08).country,'USA');assert.equal(architectureRegion(-37.68,144.58).style,'oceania');
  const ohio=inferBuildingStyle({id:9,height:8,region:'temperate'}),bali=inferBuildingStyle({id:9,height:8,region:'tropical-asia'});
  assert.notDeepEqual(ohio.roofs,bali.roofs);assert.equal(inferBuildingStyle({tags:'airport terminal',region:'east-asia'}).family,7);
  assert.equal(inferBuildingStyle({tags:'rowhouse',region:'east-asia'}).family,6);
});
check('stepped massing preserves source envelope and rejects concave courtyards',()=>{
  const p={outer:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}],holes:[]};
  const levels=steppedBuildingLevels(p,96,{family:3,seed:4,floor:4});assert.equal(levels.at(-1).top,96);
  const vertices=[],mesh={idx:[]},vertex=(x,z,y)=>{vertices.push([x,y,z]);return vertices.length-1;};
  emitSteppedBuilding(mesh,vertex,p,levels,-2,[.2,.2,.2],[.4,.4,.4],[.3,.3,.3],1,26.4,27.2);
  for(const [x,y,z]of vertices){assert.ok(x>=0&&x<=100&&z>=0&&z<=100);assert.ok(y>=-2&&y<=96);}
  assert.ok(vertices.some(([x,y])=>y===96&&x>0&&x<100));
  assert.equal(steppedBuildingLevels({...p,holes:[p.outer]},96,{family:3,seed:4,floor:4}),null);
});
check('readiness covers missing neighbouring tiles and rejects provider failure as empty land',()=>{
  const chunks=new Map(),flight={latDeg:0,pos:{x:0,z:0,y:300}};
  for(const x of [8191,8192])for(const y of [8191,8192])chunks.set(`14/${x}/${y}`,{state:'empty',reason:'zero'});
  assert.equal(localRingReadiness({chunks},flight).ready,true);
  chunks.get('14/8192/8192').reason='no-data';assert.equal(localRingReadiness({chunks},flight).ready,false);
  chunks.delete('14/8192/8192');assert.equal(localRingReadiness({chunks},flight).total,4);assert.equal(localRingReadiness({chunks},flight).ready,false);
  const missing=worldReadiness({flight});assert.equal(missing.ready,false);assert.ok(missing.missing.includes('surfaces'));assert.ok(missing.missing.includes('fleet'));
});
const roadLayer={extent:4096,features:[{id:31,type:2,props:{class:'minor'},rings:[[{x:0,y:2048},{x:4096,y:2048}]]}]};
check('infill requires settlement and roads, and never fills an airfield or unclassified desert',()=>{
  const vt=decode({transportation:roadLayer}),cover=new Uint8Array(65536).fill(50);
  const a=buildRoadsideInfill(vt,cover,2446);assert.ok(a.length>20);assert.deepEqual(a,buildRoadsideInfill(vt,cover,2446));
  assert.equal(buildRoadsideInfill(vt,null,2446).length,0);
  assert.equal(buildRoadsideInfill(decode({}),cover,2446).length,0);
  const airport=decode({transportation:roadLayer,aeroway:{features:[{type:3,props:{class:'apron'},rings:[fixture.rect(0,0,4096,4096,false)]}]}});
  assert.equal(buildRoadsideInfill(airport,cover,2446).length,0);
  cover.fill(80);assert.equal(buildRoadsideInfill(vt,cover,2446).length,0);
});
check('mapped pavement has physical metre UVs, deterministic widths and no zero-area faces',()=>{
  const vt=decode({aeroway:{features:[{type:2,props:{class:'runway',width:50},rings:[[{x:100,y:2048},{x:3996,y:2048}]]}]} });
  const p=buildAirportSurfaces(vt,2446,1);assert.equal(p.evidence.mappedWidths,1);assert.ok(p.pos.length>0);
  assert.equal(Math.max(...p.uv.filter((_,i)=>i%2===0)),25);
  for(let i=0;i<p.pos.length;i+=9){const a=p.pos.subarray(i,i+3),b=p.pos.subarray(i+3,i+6),c=p.pos.subarray(i+6,i+9);assert.ok(Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))>0);}
});
check('pavement can reveal supported triangles without drawing missing terrain at sea level',()=>{
  const p=buildAirportSurfaces(decode({aeroway:{features:[{type:2,props:{class:'taxiway'},rings:[[{x:0,y:0},{x:200,y:0}]]}]}}),2446,1);
  const surface={bands:[null,null,{span:2446,slots:[{key:'14/8192/8192',state:'ready',mask:{airport:p}}]}],stats:{commits:1}};
  const rt={flight:{latDeg:0,pos:{x:0,z:0}},engine:{getGroundAt:()=>null}};const layer=new LivingAirports();layer.update(surface,rt);assert.equal(layer.stats.draws,0);
  rt.engine.getGroundAt=()=>({elev:-12,tileZ:16});for(let i=0;i<15;i++)layer.update(surface,rt);assert.equal(layer.stats.draws,1);
  for(const t of layer.tiles.values()){
    const geometry=t.mesh.geometry;assert.ok(geometry.attributes.position.array.filter((_,i)=>i%3===1).every(y=>y<0));
    assert.ok(t.supports.length<geometry.attributes.position.count,'Shared triangle edges reuse a terrain query');
    assert.equal(t.indices,geometry.attributes.position.count,'All supported triangles are emitted exactly once');
    assert.ok(geometry.attributes.position.updateRanges.length>0,'Drape uploads identify only changed values');
  }
  layer.dispose();
});
check('typed live rendering preserves fixes, hysteresis and true height during a rebase',()=>{
  const renderer=new DetailedTraffic();while(!renderer.prepare()){}
  const item={hex:'abc123',meta:{t:'A320'},archetype:0,opacity:1,distM:700,flags:1,rx:1000,rz:2000,ryd:82,scaleK:1.3,yaw:0,bank:0,fix1:{vE:0,vN:0,vUp:0}};
  const before=JSON.stringify(item.fix1),flight={pos:{x:1000,z:2000}},origin={anchor:{x:1000,z:2000}};
  renderer.update([item],flight,origin,'high',null,true,0);assert.equal(item.livingDetailed,true);assert.equal(renderer.stats.near,1);
  item.distM=1000;renderer.update([item],flight,origin,'high',null,true,1);assert.equal(renderer.stats.near,1);
  item.distM=1300;renderer.update([item],flight,origin,'high',null,true,2);assert.equal(renderer.stats.near,0);assert.equal(renderer.stats.displayed,1);
  assert.equal(JSON.stringify(item.fix1),before);assert.ok(renderer.stats.geometryBytes<32*1024*1024);renderer.dispose();
});
// Real production worker, synthetic data: deliberately > the former 500-body cap.
const buildings={features:Array.from({length:625},(_,i)=>({id:i+1,type:3,props:{render_height:9},rings:[fixture.rect(40+(i%25)*150,40+Math.floor(i/25)*150,30,30,false)]}))};
const restore=fixture.installFetchStub(()=>fixture.encodeTile({building:buildings}));
try{
  await import('../lib/fly/toy-world/vector-tile.worker.js');
  const result=await globalThis.__livingWorker.buildTile(14,7000,7000,'sat-buildings',{visuals:true});
  check('actual worker retains every mapped body after the detailed-building budget fills',()=>{assert.equal(result.v,22);assert.equal(result.satBuilding.meta.kept,625);assert.ok(result.satBuilding.meta.provenance.detailedBodies<625);assert.ok(result.satBuilding.meta.provenance.reliefBodies<=160);assert.ok(result.satBuilding.meta.provenance.detailedBodies>result.satBuilding.meta.provenance.reliefBodies,'Roof variety survives the smaller facade-relief budget');assert.ok(result.satBuilding.pos.length<625*400*3);});
}finally{restore();}
console.log(`Living Earth: ${checks} checks passed`);
