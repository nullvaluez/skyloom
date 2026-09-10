import assert from 'node:assert/strict';
import fs from 'node:fs';
const sourceURL = file => {
  let text=fs.readFileSync(new URL('../lib/fly/'+file,import.meta.url),'utf8');
  text=text.replace(/from '\.\/immersive'/g,`from '${sourceURLLeaf('immersive.js')}'`);
  return `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
};
const sourceURLLeaf=file=>`data:text/javascript;base64,${fs.readFileSync(new URL('../lib/fly/'+file,import.meta.url)).toString('base64')}`;
const pure = async file => import(sourceURL(file));
const {inferBuildingStyle,buildingHash,buildingStyleVertex,buildingClassificationHeight,architecturalColor,BUILDING_PROFILES} = await pure('building-profiles.js');
const {physicalBendCoefficient,metricDirection} = await pure('render-scale.js');
const {resolveSatelliteVisuals,satelliteVisualProfile,satelliteEffectTier} = await pure('satellite-visuals.js');
const {resolveSatelliteAtmosphere} = await pure('satellite-atmosphere.js');
for (const [tags,height,expected] of [['house',8,0],['apartment',18,1],['',20,2],['office',40,3],['glass',120,4],['warehouse',12,5]]) {
  // Family selection must distinguish all six, while variation is revisit-stable.
  const args={tags,height,id:123,areaM2:400,density:900};
  assert.equal(inferBuildingStyle(args).family,expected);
  assert.deepEqual(inferBuildingStyle(args),inferBuildingStyle(args));
}
assert.equal(BUILDING_PROFILES.length,6);
// A tower's height cannot certify its cladding. Require real variety without
// freezing artistic percentages, and preserve deterministic revisit/LOD identity.
const towerFamilies=new Set();
for(let id=0;id<512;id++) {
  const source={id,height:95+id%360,areaM2:600+id%1000,aspect:1.3,density:900};
  const first=inferBuildingStyle(source),again=inferBuildingStyle({...source});
  assert.deepEqual(first,again);towerFamilies.add(first.family);
}
for(const family of [1,2,3,4])assert.ok(towerFamilies.has(family),'Untagged towers include residential, masonry, concrete and glass');
for(const [tags,family] of [['apartment',1],['stone',2],['office',3],['glass',4]]) {
  assert.equal(inferBuildingStyle({id:23,height:260,areaM2:800,landuse:'residential',tags}).family,family,'Explicit source hint precedes height/context');
}
const glassColors=BUILDING_PROFILES[4].walls.map(architecturalColor);
assert.ok(glassColors.some(([r,g,b])=>r-b>0.05),'Glass includes a bronze variant');
assert.ok(glassColors.some(c=>Math.max(...c)-Math.min(...c)<0.05),'Glass includes neutral glazing');
assert.ok(glassColors.some(c=>Math.max(...c)<0.2),'Glass includes charcoal glazing');
assert.ok(glassColors.some(([r,g,b])=>b-r>0.05) && glassColors.some(([r,g,b])=>r>=b),'Blue is available without covering every glass variant');
assert.equal(buildingClassificationHeight(541,2000,1),541,'Supplied height retained for identity');
assert.equal(buildingClassificationHeight(null,200,2),buildingClassificationHeight(undefined,200,2),'Missing height fallback independent of display LOD');
assert.ok(new Set(Array.from({length:64},(_,id)=>buildingHash(id))).size > 60);
assert.equal(buildingStyleVertex(inferBuildingStyle(),false)[2],0,'Roof light mask');
assert.equal(buildingStyleVertex(inferBuildingStyle(),true)[2],1,'Wall light mask');
for (const tier of ['high','medium','low']) {
  assert.ok(satelliteVisualProfile(tier).buildingChunks>0,'Every tier retains buildings');
  assert.ok(satelliteVisualProfile(tier).skylineChunks>0,'Every tier retains skyline');
}
assert.equal(resolveSatelliteVisuals({query:'cinematic'}),true);
assert.equal(resolveSatelliteVisuals({query:'cinematic',arm:0}),false);
assert.equal(resolveSatelliteVisuals({query:'legacy',arm:1}),true);
assert.equal(resolveSatelliteVisuals(),true,'Approved cinematic treatment is the default');
assert.equal(resolveSatelliteVisuals({query:'legacy'}),false,'Explicit legacy rollback remains available');
// Walk the actual sub-native DPR ladder while keeping all high scenery.
assert.deepEqual([1,.875,.75,.875,1].map(dpr=>satelliteEffectTier('high',dpr)),
  ['high','medium','low','medium','high'],'Effects reduce and recover before scene detail changes');
assert.equal(satelliteEffectTier('medium',1.5),'medium','DPR cannot upgrade a chosen tier');
assert.equal(satelliteEffectTier('low',1.5),'low');
for (const lat of [0,40,60]) {
  const k=1/Math.cos(lat*Math.PI/180),d=10000*k;
  assert.ok(Math.abs(d*d*physicalBendCoefficient(1e6,k)-50)<1e-8,'Physical curvature independent of latitude');
  assert.equal(metricDirection({x:0,y:1,z:0},100,k).y,100,'Vertical metres never get Mercator magnification');
}
const day=resolveSatelliteAtmosphere({sinEl:0.7}),night=resolveSatelliteAtmosphere({sinEl:-0.4});
assert.equal(day.night,0); assert.equal(night.night,1); assert.ok(night.bloomThreshold>0.8);
assert.equal(resolveSatelliteAtmosphere({el:0.15,sinEl:-0.4}).day,0,'True elevation beats clamped hillshade');
assert.ok(resolveSatelliteAtmosphere({sinEl:0.7},{overcastT:1}).environment<day.environment);
for(const f of ['sat-building','sat-skyline','sat-road','sat-veg','sat-clutter','toy-world']) {
  assert.match(fs.readFileSync(new URL('../lib/fly/toy-world/'+f+'-engine.js',import.meta.url),'utf8'), /EXPECTED_WORKER_PROTOCOL = 19/);
}
assert.match(fs.readFileSync(new URL('../lib/fly/toy-world/vector-tile.worker.js',import.meta.url),'utf8'), /WORKER_PROTOCOL = 19/);
// Exercise the real near/far handover uniforms through a quality step and a rebase.
const dataURL = file => `data:text/javascript;base64,${fs.readFileSync(new URL('../lib/fly/'+file,import.meta.url)).toString('base64')}`;
const materialSource = fs.readFileSync(new URL('../lib/fly/satellite-architecture-material.js',import.meta.url),'utf8')
  .replace("'./immersive'",JSON.stringify(dataURL('immersive.js')))
  .replace("'three'",JSON.stringify(import.meta.resolve('three')))
  .replace("'./building-profiles'",JSON.stringify(dataURL('building-profiles.js')))
  .replace("'./toy-world/world-bend'",JSON.stringify(dataURL('toy-world/world-bend.js')));
const {createSatelliteArchitectureMaterial,setSatelliteArchitectureCoverage} = await import(`data:text/javascript;base64,${Buffer.from(materialSource).toString('base64')}`);
for(const distant of [false,true]) {
  const material=createSatelliteArchitectureMaterial({distant});
  const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <color_fragment>\n#include <emissivemap_fragment>'};
  material.onBeforeCompile(shader);
  assert.match(shader.fragmentShader,/vec3 style = floor\(vBuildingStyle \+ 0\.5\)/,'Night seed precision guard survives');
  assert.match(shader.fragmentShader,/mix\(vec3\(0\.32\), diffuseColor\.rgb, 0\.35\)/,'Glazing reads the existing material variant albedo');
  assert.doesNotMatch(shader.fragmentShader,/vec3\(0\.40,0\.54,0\.61\)/,'Universal cyan glazing is retired');
  assert.match(material.customProgramCacheKey(),/cinematic-architecture-v3-/);
  material.dispose();
}
const far = createSatelliteArchitectureMaterial({distant:true});
const chunks = new Map(Array.from({length:16},(_,i)=>[i,{state:'ready',tile:{z:14},mesh:{visible:true,position:{x:i*2500,z:0}}}]));
const buildings = {object:{visible:true},chunks};
const u = far.userData.architecture.uniforms;
setSatelliteArchitectureCoverage(far,buildings,{x:0,z:0},1);
assert.equal(u.uArchitectureTileCount.value,16);
const left = u.uArchitectureTiles.value[0].x;
for(let i=5;i<16;i++)chunks.delete(i);
setSatelliteArchitectureCoverage(far,buildings,{x:1200,z:700},0.4);
assert.equal(u.uArchitectureTileCount.value,5,'Evicted detailed tiles expose the distant representation');
assert.equal(u.uArchitectureTiles.value[0].x,left-1200,'Coverage follows the floating origin');
assert.equal(u.uArchitectureNearFade.value,0.4,'Coverage follows the detailed altitude/birth fade');
buildings.object.visible=false;
setSatelliteArchitectureCoverage(far,buildings,{x:0,z:0},1);
assert.equal(u.uArchitectureTileCount.value,0,'An invisible layer cannot leave a skyline hole');
far.dispose();
console.log('GRAPHICS UNIT: PASS (six families, masks, stable variation, quality continuity, latitude, atmosphere, protocol)');
