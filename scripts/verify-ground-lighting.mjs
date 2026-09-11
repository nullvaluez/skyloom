import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
registerHooks({resolve(specifier,context,next){
  if(specifier.startsWith('@/'))specifier=pathToFileURL(path.join(root,specifier.slice(2))).href;
  if(specifier.startsWith('.')||specifier.startsWith('file:')){
    const url=new URL(specifier,context.parentURL);
    if(existsSync(fileURLToPath(url)+'.js'))return next(url.href+'.js',context);
  }
  return next(specifier,context);
}});
const {BufferAttribute,BufferGeometry,Color,InstancedBufferAttribute,InstancedMesh,Matrix4,Mesh,MeshBasicMaterial,OrthographicCamera,Scene,ShaderLib,MaxEquation}=await import('three');
const policy=await import('../lib/fly/night-lighting-policy.js');
const ground=await import('../lib/fly/night-ground.js');
const {createNightSourceCollector}=await import('../lib/fly/night-ground-sources.js');
const {SAT_ROADS,SUBURB_NIGHT}=await import('../lib/fly/fly-constants.js');
function finishSources(collector){
  let step,steps=0,work=0;
  do{step=collector.step({budgetMs:Infinity,maxWork:128});assert(step.work<=128);work+=step.work;assert(++steps<100000);}while(step.pending);
  return {...step.result,steps,work};
}
function collectNightSources(...args){const collector=createNightSourceCollector();collector.start(...args);return finishSources(collector);}
const shade=await import('../lib/fly/light-bubble.js');
let passes=0;
function check(name,fn){fn();passes++;console.log(`PASS ${name}`);}
check('all three tiers retain a bounded two-history map',()=>{
  for(const [tier,size,span] of [['high',1024,2048],['medium',512,1024],['low',256,512]]){
    const p=policy.groundLightProfile(tier);assert.equal(p.size,size);assert.equal(p.spanM,span);assert(p.sources>0);
  }
});
check('night weight is dark at noon and continuous at dusk',()=>{
  assert.equal(policy.nightWeight(1),0);assert.equal(policy.nightWeight(0),1);
  assert(policy.nightWeight(.2)>policy.nightWeight(.3));
});
check('AGL envelope strengthens low flight without extinguishing low-tier city light',()=>{
  assert.equal(policy.groundLightingStrength(0),.25);assert.equal(policy.groundLightingStrength(1),1);
  assert.equal(policy.groundLightingStrength(NaN),.25);
});
check('ground height rejects bridge decks and unrelated roofs',()=>{
  assert.equal(policy.sourceHeightWeight(100,100),1);assert.equal(policy.sourceHeightWeight(120,100),0);assert.equal(policy.sourceHeightWeight(80,100),0);
});
check('source/emission use identical discrete building decisions',()=>{
  for(let seed=0;seed<256;seed++){
    const e=policy.buildingEmission(seed,.7,.5);assert.equal(e.lit,(seed*.173-Math.floor(seed*.173))>=.13);
    assert(e.gain>=.3&&e.gain<.74);assert(e.color.every(c=>c>0&&c<=1));
  }
});
check('stationary porch signature follows completed support repairs without count changes',()=>{
  const veg={chunks:16,ready:16,clsChunks:16,vegPts:2000,heals:0,sampling:0};
  const b={chunks:16,ready:16,columns:1500,contactHeals:0,healsInPlace:0,heals:0};
  const first=policy.houseLightPlacementSignature(veg,b,1);
  for(const key of ['contactHeals','healsInPlace','heals'])assert.notEqual(policy.houseLightPlacementSignature(veg,{...b,[key]:1},1),first);
  const queued=policy.houseLightPlacementSignature({...veg,heals:1,sampling:1},b,1);
  const committed=policy.houseLightPlacementSignature({...veg,heals:1,sampling:0},b,1);
  assert.notEqual(queued,first);assert.notEqual(committed,queued);
});
check('frequent support repairs cannot bypass the existing porch placement cadence',()=>{
  let last=-Infinity,placements=0;const placedAt=[];
  for(let frame=0;frame<1000;frame++){
    const now=frame/100;
    // Even a new contact heal every frame can cause placement only at the
    // component's outer cadence gate, never a new per-frame matrix rewrite.
    if(policy.houseLightPlacementDue(now,last,2)){last=now;placements++;placedAt.push(now);}
  }
  assert.equal(placements,5);assert.deepEqual(placedAt,[0,2,4,6,8]);
});
const scene=new Scene(),runtime={flight:{latDeg:0},satBuildings:{chunks:new Map()},satRoads:{chunks:new Map()}};
const parcelGeometry=new BufferGeometry();parcelGeometry.setAttribute('aHomeVariant',new InstancedBufferAttribute(new Float32Array([1,7]),1));
const parcels=new InstancedMesh(parcelGeometry,new MeshBasicMaterial(),2);parcels.userData.__parcelInit=true;
parcels.setMatrixAt(0,new Matrix4().makeTranslation(10,100,20));parcels.setMatrixAt(1,new Matrix4().makeTranslation(30,100,40));scene.add(parcels);
check('procedural parcels light without collision columns; dark variant stays dark',()=>{
  const c=collectNightSources(runtime,scene,0,0,512,768);assert.equal(c.counts.homes,1);assert.equal(c.sources[0].y,100);
});
check('visibility and zero-scale birth keep absent houses dark',()=>{
  parcels.visible=false;assert.equal(collectNightSources(runtime,scene,0,0,512,768).sources.length,0);parcels.visible=true;
  parcels.setMatrixAt(0,new Matrix4().makeScale(0,0,0));assert.equal(collectNightSources(runtime,scene,0,0,512,768).sources.length,0);
  parcels.setMatrixAt(0,new Matrix4().makeTranslation(10,100,20));
});
const porch=new InstancedMesh(new BufferGeometry(),new MeshBasicMaterial(),1);porch.userData.__houseInit=true;porch.setMatrixAt(0,new Matrix4().makeTranslation(5,100+SUBURB_NIGHT.houseLights.liftM,5));scene.add(porch);
check('visible residential fallback porch sources survive missing mapped homes',()=>{
  const c=collectNightSources(runtime,scene,0,0,512,768);assert.equal(c.counts.porches,1);
  const source=c.sources.find(s=>s.id.startsWith('p'));assert.equal(source.y,100);assert.equal(policy.sourceHeightWeight(100,source.y),1);
});
const roads=new BufferGeometry();
roads.setAttribute('position',new BufferAttribute(new Float32Array([-2,130,0,2,130,0,-2,130,84,2,130,84]),3));
roads.setAttribute('aRoadArc',new BufferAttribute(new Float32Array([0,0,84,84]),1));
roads.setAttribute('aRoadCls',new BufferAttribute(new Float32Array([5,5,5,5]),1));
runtime.satRoads.chunks.set('r',{state:'ready',mesh:new Mesh(roads,new MeshBasicMaterial())});
check('road sources follow the visible 42m phase and retain deck elevation',()=>{
  const c=collectNightSources(runtime,scene,0,0,512,768);assert.equal(c.counts.lamps,2);
  assert(c.sources.filter(s=>s.id.startsWith('l')).every(s=>s.y===130-SAT_ROADS.liftM));
  assert.equal(policy.sourceHeightWeight(130-SAT_ROADS.liftM,c.sources.find(s=>s.id.startsWith('l')).y),1);
  assert.equal(policy.sourceHeightWeight(100,c.sources.find(s=>s.id.startsWith('l')).y),0);
});
check('source caps share slots between road and settlement families',()=>{
  const c=collectNightSources(runtime,scene,0,0,512,3);assert.equal(c.sources.length,3);assert(c.counts.homes||c.counts.porches);
});
check('in-place source height changes invalidate otherwise same-count map',()=>{
  const first=collectNightSources(runtime,scene,0,0,512,768).signature;
  parcels.setMatrixAt(0,new Matrix4().makeTranslation(10,104,20));
  assert.notEqual(collectNightSources(runtime,scene,0,0,512,768).signature,first);
});
function buildingFixture({bottom=-6,groundY=100,roofVertices=1,metadata=true}={}){
  const n=roofVertices+2,p=new Float32Array(n*3),a=new Float32Array(n*2),s=new Float32Array(n*3),uv=new Float32Array(n*2);
  for(let i=0;i<n;i++){
    const wall=i>=roofVertices,localY=i===roofVertices?bottom:30;
    p.set([i%2?5:-5,groundY+localY,0],i*3);s.set([0,1,wall?1:0],i*3);uv.set([0,wall?localY/27.2:.25],i*2);
  }
  const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(p,3));g.setAttribute('aBendAnchor',new BufferAttribute(a,2));
  g.setAttribute('aBuildingStyle',new BufferAttribute(s,3));g.setAttribute('uv',new BufferAttribute(uv,2));
  const chunk={state:'ready',mesh:new Mesh(g,new MeshBasicMaterial())};
  if(metadata){chunk.drapeRuns=[{start:0,end:n,ground:groundY,column:0}];chunk.columns={data:new Float32Array([0,0,groundY+30,5])};}
  return {chunk,g,runtime:{flight:{latDeg:0},satBuildings:{chunks:new Map([['b',chunk]])}}};
}
check('sunken wall support lights terrain while genuine elevated min_height stays elevated',()=>{
  for(const metadata of [true,false])for(const bottom of [-6,12]){
    const f=buildingFixture({bottom,metadata}),c=collectNightSources(f.runtime,new Scene(),0,0,512,768);
    assert.equal(c.counts.buildings,1);const y=c.sources[0].y;
    assert(Math.abs(y-(100+Math.max(0,bottom)))<.00001);
    assert.equal(policy.sourceHeightWeight(100,y),bottom<0?1:0);
    assert.equal(policy.sourceHeightWeight(100+Math.max(0,bottom),y),1);
  }
});
check('late nearest sources win capped selection independent of insertion order',()=>{
  const g=new BufferGeometry(),m=new InstancedMesh(g,new MeshBasicMaterial(),40);m.userData.__parcelInit=true;
  const sc=new Scene();sc.add(m);
  for(let i=0;i<40;i++)m.setMatrixAt(i,new Matrix4().makeTranslation(100-i*2,100,0));
  const first=collectNightSources({flight:{latDeg:0}},sc,0,0,512,3).sources.map(s=>s.x);
  assert.deepEqual(first,[22,24,26]);
  for(let i=0;i<40;i++)m.setMatrixAt(i,new Matrix4().makeTranslation(22+i*2,100,0));
  assert.deepEqual(collectNightSources({flight:{latDeg:0}},sc,0,0,512,3).sources.map(s=>s.x),first);
});
check('cold decode is bounded and complete sources remain while a dense update is pending',()=>{
  const f=buildingFixture({roofVertices:120000}),collector=createNightSourceCollector(),sc=new Scene();
  collector.start(runtime,scene,0,0,512,768);const old=finishSources(collector);
  collector.start(f.runtime,sc,0,0,512,768);
  const first=collector.step({budgetMs:Infinity,maxWork:64});assert(first.pending);assert.equal(first.work,64);assert.equal(first.result.signature,old.signature);
  const dense=finishSources(collector);assert.equal(dense.counts.buildings,1);assert(dense.steps>900);
  // A real DEM repair translates Y and increments position.version. Cached
  // wall topology reads that fresh Y without rescanning the 120k roof vertices.
  const position=f.g.attributes.position;for(let i=0;i<position.count;i++)position.setY(i,position.getY(i)+20);position.needsUpdate=true;
  collector.start(f.runtime,sc,0,0,512,768);const healed=finishSources(collector);
  assert(healed.work<64);assert(Math.abs(healed.sources[0].y-120)<.00001);assert.notEqual(healed.signature,dense.signature);
});
check('elapsed time budget and reset stop in-flight source work without partial publish',()=>{
  const f=buildingFixture({roofVertices:1000}),collector=createNightSourceCollector();collector.start(f.runtime,new Scene(),0,0,512,768);
  let now=0;const first=collector.step({clock:()=>now+=.1,budgetMs:.75,maxWork:1024});
  assert(first.pending);assert(first.work<=7);assert.equal(first.result.sources.length,0);
  collector.reset();assert.equal(collector.pending,false);assert.equal(collector.step().result.sources.length,0);
});
check('continuous chunk arrivals cannot extend an active scan indefinitely',()=>{
  const f=buildingFixture(),collector=createNightSourceCollector();collector.start(f.runtime,new Scene(),0,0,512,768);
  let step,n=0;
  do{
    step=collector.step({budgetMs:Infinity,maxWork:1});
    // Real Map iterators visit keys appended after iteration has started.
    f.runtime.satBuildings.chunks.set(`new${n++}`,{state:'queued'});
    assert(n<100,'scan must finish against its original ring membership');
  }while(step.pending);
  assert.equal(step.result.counts.buildings,1);
});
check('far road chunks reject before vertex decoding; cached road support follows a slope heal',()=>{
  const sc=new Scene(),g=roads.clone(),m=new Mesh(g,new MeshBasicMaterial());m.position.x=100000;
  const rt={flight:{latDeg:0},satRoads:{chunks:new Map([['r',{state:'ready',tile:{z:14},mesh:m}]])}},collector=createNightSourceCollector();
  collector.start(rt,sc,0,0,512,768);assert(finishSources(collector).work<16);
  m.position.x=0;collector.start(rt,sc,0,0,512,768);const first=finishSources(collector);
  const pos=g.attributes.position;pos.setY(2,150);pos.setY(3,150);pos.needsUpdate=true;
  collector.start(rt,sc,0,0,512,768);const next=finishSources(collector);
  assert.equal(next.counts.lamps,2);assert(next.sources.some(s=>s.id.startsWith('l')&&s.y===135));
  assert.notEqual(next.signature,first.signature);
});
check('receiver shader coexists with ground material position and handles both histories',()=>{
  const s={uniforms:{},vertexShader:ShaderLib.standard.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvec4 ngWorld=vec4(transformed,1.0);'),fragmentShader:ShaderLib.standard.fragmentShader};
  ground.patchNightGroundShader(s);assert(s.vertexShader.includes('ngLightWorld'));assert(s.fragmentShader.includes('uNGPreviousMap'));
  assert(s.fragmentShader.includes('abs(vNightGroundWorld.y-sourceY)'));assert(s.fragmentShader.includes('reflectedLight.indirectDiffuse +='));
  const text=s.fragmentShader;ground.patchNightGroundShader(s);assert.equal(s.fragmentShader,text);
});
check('encoded elevation is not attenuated by dim source energy',()=>{
  const m=ground.createNightGroundSplatMaterial();assert.equal(m.blendEquationAlpha,MaxEquation);assert(m.fragmentShader.includes('vec4(vLight*a,clamp(vHeight'));m.dispose();
});
const camera=new OrthographicCamera(-1500,1500,1500,-1500,1,6000),shadow={camera,mapSize:{x:2048}},ao={configuration:{aoRadius:24,intensity:5}};
const rt={sunLight:{shadow},aoPass:ao,groundImmersion:{k:1,epoch:0}},state=shade.createShadingState();
check('low pass tightens existing shadow/AO and leaves the light unchanged',()=>{
  const s=shade.stepGroundShading(rt,state);assert.equal(s.radiusM,350);assert.equal(s.aoRadiusM,5);assert.equal(s.aoIntensity,3.5);assert.equal(rt.sunLight.shadow,shadow);
});
check('shadow rung hysteresis holds boundary jitter',()=>{
  const s=shade.createGroundShadowState();let prev=shade.groundShadowRadius(s,.9375),changes=0;
  for(let i=0;i<100;i++){const next=shade.groundShadowRadius(s,.9375+(i%2?.006:-.006));if(next!==prev)changes++;prev=next;}
  assert.equal(changes,0);
});
check('style/flag teardown restores owned camera and AO properties',()=>{
  shade.restoreGroundShading(rt,state);assert.equal(camera.right,1500);assert.equal(ao.configuration.aoRadius,24);assert.equal(rt.shadowRadiusM,undefined);
});
check('RGBA8 histories are bounded and empty update adds no splat draw',()=>{
  const target=ground.createNightGroundTarget(256,3);assert.equal(target.bytes,256*256*8);
  let current=null,draws=0,alpha=1;const color=new Color(0x123456);
  const gl={autoClear:false,xr:{enabled:true},shadowMap:{autoUpdate:true,needsUpdate:true},getRenderTarget:()=>current,setRenderTarget:t=>{current=t;},getClearAlpha:()=>alpha,
    getClearColor:c=>c.copy(color),setClearColor:(c,a)=>{color.set(c);alpha=a;},clear(){},render(){draws++;},compile(){}};
  target.render(gl,[{x:0,y:100,z:0,r:10,gain:.1,color:[1,.7,.4]}],[0,0],512,0);assert.equal(draws,1);
  target.render(gl,[],[0,0],512,0);assert.equal(draws,1);assert.equal(current,null);assert.equal(gl.autoClear,false);assert.equal(gl.xr.enabled,true);assert.equal(gl.shadowMap.needsUpdate,true);target.dispose();
});
console.log(`ground lighting: ${passes}/${passes} passed; GPU/pixel appearance requires browser certification`);
