import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
registerHooks({resolve(s,c,next){
  if(s.startsWith('@/'))s=new URL('../'+s.slice(2),import.meta.url).href;
  if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))s=u.href+'.js';}
  return next(s,c);
}});
const {paintedSample}=await import('../lib/fly/painterly-material-data.js');
const {PAINTERLY,painterlyProfile}=await import('../lib/fly/painterly-policy.js');
const {updatePainterlyProfile,PAINTERLY_UNIFORMS}=await import('../lib/fly/painterly-flight.js');
const {ResidentReliefBackfill}=await import('../lib/fly/relief-backfill.js');
const {buildForestCluster}=await import('../lib/fly/living-forest.js');
const {applyPainterlyAircraft}=await import('../lib/fly/painterly-aircraft.js');
const {MeshPhysicalMaterial,ShaderLib,Texture}=await import('three');
const M=await import('../lib/fly/cinematic-materials.js');
const {EarthSurfaceEngine}=await import('../lib/fly/earth-surface-engine.js');
const {EARTH_CLASS_LAYOUT,makeEarthClassAtlas,makeEarthAtlas}=await import('../lib/fly/earth-surface-material.js');
const G=await import('../lib/fly/r25-ground.js');
const {useFlyStore}=await import('../stores/fly-store.js');
const {r25Uniforms}=await import('../lib/fly/toy-world/world-bend.js');
const {painterlyMaskBlend}=await import('../lib/fly/painterly-mask.js');
const {distributeForest}=await import('../lib/fly/forest-distribution.js');
const {paintedCloudLight}=await import('../lib/fly/painterly-cloud-light.js');
const {releaseBloomTargets}=await import('../lib/fly/release-bloom-targets.js');
let checks=0;
const check=async(name,fn)=>{await fn();checks++;console.log(`PASS ${name}`);};
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const tile=()=>({z:15,model:{visible:true,geometry:{userData:{}}}});
await check('night clouds retain light; daylight keeps the original model chroma',()=>{
  const out=new Float64Array(9);
  paintedCloudLight({day:0,key:[0,0,0],ambient:[0,0,0]},0,out);
  assert.deepEqual([...out],[.92,.96,1,.62,.68,.74,.16,.20,.26]);
  const m={day:1,key:[.9,.7,.5],ambient:[.3,.4,.6]},y=.2126*.3+.7152*.4+.0722*.6;
  paintedCloudLight(m,0,out);
  for(let c=0;c<3;c++){
    assert.ok(Math.abs(out[c]-m.key[c])<1e-12);
    assert.ok(Math.abs(out[c+3]-m.ambient[c]/y*.6716)<1e-12);
    assert.ok(Math.abs(out[c+6]-m.ambient[c]/y*.1961)<1e-12);
  }
  for(let i=0;i<=100;i++){
    paintedCloudLight({day:i/100,key:[0,0,0],ambient:[1e-12,2e-12,4e-12]},0,out);
    assert.ok(out.every(v=>Number.isFinite(v)&&v>.1),'Low solar energy cannot create black/invalid cloud lighting');
  }
});
await check('bloom releases its private buffers immediately while shader materials survive until normal disposal',async()=>{
  const {BloomEffect}=await import('postprocessing');
  const bloom=new BloomEffect({mipmapBlur:true,levels:5}),blur=bloom.mipmapBlurPass;
  const targets=new Set([bloom.renderTarget,bloom.luminancePass.renderTarget,bloom.blurPass.renderTargetA,bloom.blurPass.renderTargetB,blur.renderTarget,...blur.downsamplingMipmaps,...blur.upsamplingMipmaps]);
  let released=0,materials=0;
  for(const target of targets)target.addEventListener('dispose',()=>released++);
  for(const material of [bloom.luminanceMaterial,blur.downsamplingMaterial,blur.upsamplingMaterial])material.addEventListener('dispose',()=>materials++);
  releaseBloomTargets(bloom);
  assert.equal(released,targets.size);assert.equal(materials,0);
  bloom.dispose();assert.ok(materials>0,'Normal ownership teardown still releases materials');
});
await check('cached Enhanced programs keep live uniform bindings after compiling Classic',()=>{
  useFlyStore.getState().setVisuals('enhanced');
  const material=G.buildR25TerrainTwin();
  const compile=()=>{const s={uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};material.onBeforeCompile(s,{});return s;};
  const enhanced=compile(),required=Object.keys(enhanced.uniforms).filter(k=>k.startsWith('uR25'));
  assert.ok(required.includes('uR25GroundValue')&&required.includes('uR25Relief'));
  useFlyStore.getState().setVisuals('classic');
  const classic=compile();
  assert.ok(!classic.fragmentShader.includes('uniform float uR25GroundValue;'),'Classic shader stays unchanged');
  // WebGLRenderer reuses this latest table when returning to a cached program;
  // it does NOT invoke onBeforeCompile again for that material/program pair.
  assert.equal(classic.uniforms,enhanced.uniforms);
  for(const key of required)assert.equal(classic.uniforms[key],enhanced.uniforms[key],key);
  assert.equal(classic.uniforms.uR25GroundValue,r25Uniforms.uR25GroundValue);
  material.map.dispose();material.dispose();
});
await check('forest distribution breaks rows while every rotated crown stays inside accepted occupancy',()=>{
  const size=128,forest=[];
  for(let y=0;y<size;y+=8)for(let x=0;x<size;x+=8){
    // The missing two columns model a protected road/water/airport clearing.
    if(x===56||x===64)continue;
    forest.push((x+4)/size,(y+4)/size,8/size);
  }
  const mask={size,forest:Float32Array.from(forest)},original=mask.forest.slice();
  const a=distributeForest(mask,1499,4311),b=distributeForest(mask,1499,4311);
  assert.deepEqual(a,b);assert.deepEqual(mask.forest,original);assert.equal(a.length,original.length);
  let moved=0,variance=0;
  for(let i=0;i<a.length;i+=3){
    const x=a[i]*size,y=a[i+1]*size,r=a[i+2]*size*.48;
    assert.ok(x-r>=0&&x+r<=size&&y-r>=0&&y+r<=size);
    assert.ok(x+r<=56||x-r>=72,'No crown enters excluded columns at any yaw');
    if(Math.abs(a[i]-original[i])>.005||Math.abs(a[i+1]-original[i+1])>.005)moved++;
    variance+=(a[i+1]-original[i+1])**2;
  }
  assert.ok(moved>a.length/3*.85,'Most stands must leave the original rows');
  assert.ok(Math.sqrt(variance/(a.length/3))*size>1.5,'Rows need material, not cosmetic, displacement');
  assert.notDeepEqual(a,distributeForest(mask,1500,4311),'Adjacent tiles do not repeat a stamp');
});
await check('profile policy excludes Classic and Neon',()=>{
  assert.equal(painterlyProfile('enhanced','satellite'),true);
  for(const [p,s]of [['classic','satellite'],['enhanced','toy'],['classic','toy']])assert.equal(painterlyProfile(p,s),false);
});
await check('painted ground retains relief without allocating the photographic correction atlas',()=>{
  const engine={forEachLoadedTile(){},forEachTileMaterial(){},setR25ReliefPx(){},setR25ResidentCapMiB(){}};
  useFlyStore.getState().setVisuals('enhanced');updatePainterlyProfile('enhanced','satellite');
  G.r25GroundFrame({engine},{style:'satellite',tier:'high'});
  assert.ok(G.__r25GroundInternals._st.pool);assert.equal(G.__r25GroundInternals._st.atlas,null);
  assert.equal(r25Uniforms.uR25RefGain.value,0);assert.equal(r25Uniforms.uR25Ref.value,null);
  // The saved component remains independently testable, including returning
  // from that diagnostic state without retaining its additional allocation.
  updatePainterlyProfile('classic','satellite');G.r25GroundFrame({engine},{style:'satellite',tier:'high'});
  const atlas=G.__r25GroundInternals._st.atlas;assert.ok(atlas);
  let disposed=0;atlas.texture.addEventListener('dispose',()=>disposed++);
  updatePainterlyProfile('enhanced','satellite');G.r25GroundFrame({engine},{style:'satellite',tier:'high'});
  assert.equal(G.__r25GroundInternals._st.atlas,null);assert.equal(disposed,1);
  G.releaseR25Ground(engine);useFlyStore.getState().setVisuals('classic');updatePainterlyProfile('classic','satellite');
});
await check('artwork and derived appearance share one version; Classic assets stay v2',()=>{
  const p=`public/materials/cinematic-v${PAINTERLY.assetVersion}`,manifest=JSON.parse(fs.readFileSync(`${p}/manifest.json`));
  assert.equal(manifest.appearanceKey,PAINTERLY.appearanceKey);assert.equal(manifest.license,'MIT');assert.equal(manifest.thirdPartyAssets.length,0);
  for(const a of manifest.assets){const b=fs.readFileSync(`${p}/${a.file}`);assert.equal(b.length,256*256*8*4);assert.equal(crypto.createHash('sha256').update(b).digest('hex'),a.sha256);}
  const classic=JSON.parse(fs.readFileSync('public/materials/cinematic-v2/manifest.json'));
  for(const a of classic.assets)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(`public/materials/cinematic-v2/${a.file}`)).digest('hex'),a.sha256);
  assert.ok(manifest.gpuBytesWithMips+classic.gpuBytesWithMips<12*1048576);
});
await check('paint marks tile exactly, remain restrained, and use finite normals',()=>{
  for(let l=0;l<8;l++)for(const q of [0,.125,.37,.99]){
    assert.deepEqual(paintedSample(l,0,q),paintedSample(l,1,q));assert.deepEqual(paintedSample(l,q,0),paintedSample(l,q,1));
    const s=paintedSample(l,q,q);assert.ok(s.value>.6&&s.value<.83);assert.ok(s.rough>=.8);assert.ok(s.height>.4&&s.height<.6);
  }
});
await check('packed classification preserves every categorical texel and toroidal slot without resampling',()=>{
  const atlas=makeEarthClassAtlas(EARTH_CLASS_LAYOUT.width,EARTH_CLASS_LAYOUT.height),ctx={classAtlas:atlas};
  const expected=new Uint8Array(atlas.image.data.length);
  for(let i=0;i<3;i++){
    const [ox,oy,width]=EARTH_CLASS_LAYOUT.bands[i],size=width/4;
    const band={i,size,classTexture:makeEarthClassAtlas(width)};
    for(let p=0;p<width*width;p++)band.classTexture.image.data[p]=(p*7+Math.floor(p/width)*3+i)%15;
    for(let slot=0;slot<16;slot++)EarthSurfaceEngine.prototype._packClassSlot.call(ctx,band,slot);
    for(let y=0;y<width;y++)for(let x=0;x<width;x++)expected[(oy+y)*EARTH_CLASS_LAYOUT.width+ox+x]=band.classTexture.image.data[y*width+x];
    band.classTexture.dispose();
  }
  assert.deepEqual(atlas.image.data,expected);assert.equal(atlas.image.data.length,1536*1024);atlas.dispose();
});
await check('WorldCover appearance feather preserves raw geography, roads and continuous tile edges',()=>{
  const make=()=>({size:16,classes:new Uint8Array(256).fill(1),exclusion:new Uint8Array(256),blend:new Uint8Array(256).fill(255)});
  const a=make(),b=make(),before=new Uint8Array(a.classes);
  assert.deepEqual(painterlyMaskBlend(a),a.blend); // no invented tile perimeter
  b.classes.fill(14);
  const edgeA=painterlyMaskBlend(a,{'1,0':b}),edgeB=painterlyMaskBlend(b,{'-1,0':a});
  assert.equal(edgeA[8*16+15],edgeB[8*16]);assert.ok(edgeA[8*16+15]<30);assert.equal(edgeA[8*16+10],255);
  a.exclusion[8*16+8]=255;a.classes[8*16+8]=12;
  a.classes[2*16+2]=0;a.blend[2*16+2]=0;
  const out=painterlyMaskBlend(a);
  assert.equal(out[8*16+8],255);assert.equal(out[2*16+2],0);assert.ok(out[8*16+9]<30);
  assert.deepEqual(b.blend,new Uint8Array(256).fill(255));assert.equal(a.classes[8*16+7],before[8*16+7]);
  for(let i=0;i<256;i++)assert.ok(out[i]<=a.blend[i]); // feather never expands paint
});
await check('Classic appearance atlas restores byte-for-byte after a painterly round trip',()=>{
  const size=256,mask={size,classes:new Uint8Array(size*size).fill(1),exclusion:new Uint8Array(size*size),blend:new Uint8Array(size*size).fill(255)};
  for(let y=0;y<size;y++)mask.classes.fill(14,y*size+128,(y+1)*size);
  const b={i:2,size,texture:makeEarthAtlas(size*4),classTexture:makeEarthClassAtlas(size*4),slots:Array.from({length:16},()=>({mask}))};
  const ctx={paint:false,classAtlas:makeEarthClassAtlas(1024,1536),_packClassSlot:EarthSurfaceEngine.prototype._packClassSlot};
  const write=()=>EarthSurfaceEngine.prototype._writeSlot.call(ctx,b,5,mask);
  write();const classic=new Uint8Array(b.texture.image.data),classes=new Uint8Array(mask.classes),blend=new Uint8Array(mask.blend);
  ctx.paint=true;write();assert.notDeepEqual(b.texture.image.data,classic);
  ctx.paint=false;write();assert.deepEqual(b.texture.image.data,classic);
  assert.deepEqual(mask.classes,classes);assert.deepEqual(mask.blend,blend);
  b.texture.dispose();b.classTexture.dispose();ctx.classAtlas.dispose();
});
await check('painted forest keeps the evidence envelope and triangle budget at both LODs',()=>{
  for(const detail of [true,false]){
    const a=buildForestCluster(detail),b=buildForestCluster(detail,true);
    assert.equal(a.index.count,b.index.count);if(detail)assert.equal(a.attributes.position.count,b.attributes.position.count);
    assert.ok(b.index.count/3<400);
    for(const attr of Object.values(b.attributes))for(const v of attr.array)assert.ok(Number.isFinite(v));
    b.computeBoundingBox();assert.ok(b.boundingBox.max.x<.5&&b.boundingBox.min.x>-.5&&b.boundingBox.max.z<.5&&b.boundingBox.min.z>-.5);
    assert.ok(b.attributes.aForestCoarse&&b.attributes.aForestCoarseNormal);
    a.dispose();b.dispose();
  }
});
await check('Classic-first resident relief fills without replacing visible geometry, one job at a time',async()=>{
  const a=tile(),b=tile(),original=a.model.geometry;let finish,commits=0;
  const q=new ResidentReliefBackfill({concurrency:1});
  const load=()=>new Promise(r=>finish=r),commit=(t,g,data)=>{g.userData.r25Relief=data;commits++;return true;};
  assert.ok(q.request(a,load,commit));assert.equal(q.request(b,load,commit),false);await flush();assert.equal(q.stats.started,1);
  finish(new Uint8Array(128*128*2));await flush();assert.equal(a.model.geometry,original);assert.equal(a.model.visible,true);assert.equal(commits,1);
  assert.ok(original.userData.r25Relief);q.reset();
});
await check('late relief cannot attach after a profile change or a tile replacement',async()=>{
  for(const cancel of [false,true]){
    const t=tile();let finish,commits=0;
    const q=new ResidentReliefBackfill({concurrency:1});q.request(t,()=>new Promise(r=>finish=r),()=>{commits++;return true;});await flush();
    if(cancel)q.reset();else t.model.geometry={userData:{}};
    finish(new Uint8Array(4));await flush();assert.equal(commits,0);assert.equal(t.model.geometry.userData.r25Relief,undefined);
  }
});
await check('DEM failure backs off and recovers without removing the old mesh',async()=>{
  const t=tile(),original=t.model.geometry;let now=0,fail=true;
  const q=new ResidentReliefBackfill({concurrency:1,now:()=>now});
  const load=()=>fail?Promise.reject(Error('outage')):new Uint8Array(4),commit=(t,g,data)=>{g.userData.r25Relief=data;return true;};
  q.request(t,load,commit);await flush();q.request(t,load,commit);assert.equal(q.stats.started,1);assert.equal(t.model.geometry,original);
  now=60001;fail=false;q.request(t,load,commit);await flush();assert.equal(q.stats.completed,1);q.reset();
});
await check('player treatment retains maps and colours, applies equally to all hull sizes and glass',()=>{
  for(const scale of [.01,1,70])for(const glass of [false,true]){
    const m=new MeshPhysicalMaterial({color:0x1b3a51,map:new Texture(),vertexColors:true}),map=m.map,colour=m.color.getHex();
    applyPainterlyAircraft(m,glass,scale);assert.equal(m.map,map);assert.equal(m.color.getHex(),colour);assert.equal(m.vertexColors,true);
    const s={uniforms:{},vertexShader:ShaderLib.physical.vertexShader,fragmentShader:ShaderLib.physical.fragmentShader};m.onBeforeCompile(s,{});
    assert.equal(s.uniforms.uPaintModelScale.value,scale);assert.equal(s.uniforms.uPainterly,PAINTERLY_UNIFORMS.uPainterly);
    assert.match(s.fragmentShader,/if\(uPainterly>\.5\)/);assert.equal((s.fragmentShader.match(/uniform float uPainterly;/g)||[]).length,1);
    m.dispose();map.dispose();
  }
});
const realFetch=globalThis.fetch,calls=[];
globalThis.fetch=async url=>{calls.push(url);const data=fs.readFileSync(`public${url}`);return{ok:true,arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)};};
try{
  await check('Classic allocates no painterly array; Enhanced loads lazily and returns original Classic objects',async()=>{
    updatePainterlyProfile('classic','satellite');M.acquireCinematicMaterials();await flush();M.updateCinematicMaterials(1);
    const classic=M.CINEMATIC_MATERIAL_UNIFORMS.uCinematicColor.value;
    assert.equal(calls.filter(x=>x.includes('v3')).length,0);
    for(let i=0;i<3;i++){
      updatePainterlyProfile('enhanced','satellite');M.updateCinematicMaterials();await flush();M.updateCinematicMaterials();
      const paint=M.CINEMATIC_MATERIAL_UNIFORMS.uCinematicColor.value;assert.notEqual(paint,classic);assert.equal(M.painterlyMaterialStats.state,'ready');
      let disposed=0;paint.addEventListener('dispose',()=>disposed++);
      updatePainterlyProfile('classic','satellite');M.updateCinematicMaterials();assert.equal(M.CINEMATIC_MATERIAL_UNIFORMS.uCinematicColor.value,classic);
      assert.equal(M.painterlyMaterialStats.bytes,0);assert.equal(disposed,1);
    }
    M.releaseCinematicMaterials();
  });
  await check('paint provider failure uses Classic fallback and never marks partial textures ready',async()=>{
    updatePainterlyProfile('classic','satellite');M.acquireCinematicMaterials();await flush();
    const classic=M.CINEMATIC_MATERIAL_UNIFORMS.uCinematicColor.value;
    globalThis.fetch=async()=>({ok:false,status:503});updatePainterlyProfile('enhanced','satellite');M.updateCinematicMaterials();await flush();
    assert.equal(M.painterlyMaterialStats.state,'fallback');assert.equal(M.painterlyMaterialStats.bytes,0);assert.equal(M.CINEMATIC_MATERIAL_UNIFORMS.uCinematicColor.value,classic);
    updatePainterlyProfile('classic','satellite');M.releaseCinematicMaterials();
  });
}finally{globalThis.fetch=realFetch;updatePainterlyProfile('classic','satellite');M.releaseCinematicMaterials();}
console.log(`PAINTERLY FLIGHT: ${checks}/${checks}`);
