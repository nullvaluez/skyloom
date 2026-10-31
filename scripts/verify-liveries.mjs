import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {register} from 'node:module';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ShaderLib,UniformsUtils} from 'three';
register('./_node-resolve.mjs',import.meta.url);
const {PRESET_LIVERIES,presetLivery}=await import('../lib/fly/aircraft-liveries.mjs');
const {PLAYER_AIRCRAFT,resolveAircraft}=await import('../lib/fly/player-aircraft.js');
const {aircraftPresentation}=await import('../lib/fly/cinematic-earth.js');
const {applyFleetLivery,fleetAnimator,disposeFleetGeometry}=await import('../lib/fly/fleet-animation.js');
const {emptyProgress,validateProgress,AdventureController}=await import('../lib/fly/adventure-controller.mjs');
const {ADVENTURES,LIVERIES}=await import('../lib/fly/adventures.mjs');
const {useAdventureStore}=await import('../stores/adventure-store.js');
const {createBackup,parseBackup,restoreBackup}=await import('../lib/fly/save-backup.mjs');
const {liveryMaterialRole}=await import('../lib/fly/livery-paint.js');
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};};

test('each plane keeps its three originals and commercial additions have stable unique IDs',()=>{
  assert.deepEqual(Object.keys(PRESET_LIVERIES).sort(),PLAYER_AIRCRAFT.map(a=>a.id).sort());
  for(const [id,skins]of Object.entries(PRESET_LIVERIES)){
    assert.equal(skins.filter(s=>!s.operator).length,3);assert.equal(new Set(skins.map(s=>s.id)).size,skins.length);
    for(const skin of skins){assert.ok(skin.name&&skin.description&&skin.marking&&skin.code);assert.match(skin.id,/^[a-z0-9-]+$/);for(const key of ['hull','trim','accent'])assert.match(skin[key],/^#[0-9a-f]{6}$/);assert.equal(presetLivery(id,skin.id),skin);}
  }
  assert.equal(presetLivery('__proto__','anything'),null);assert.equal(presetLivery('f35','pelagic'),null);
});

test('every original and commercial choice survives validation, journey updates and backup restore',()=>{
  for(let index=0;index<Math.max(...Object.values(PRESET_LIVERIES).map(s=>s.length));index++){
    const progress=emptyProgress();for(const [id,rows]of Object.entries(PRESET_LIVERIES))progress.liveries[id]=rows[index%rows.length].id;
    const validated=validateProgress(progress);assert.deepEqual(validated.liveries,progress.liveries);
    const controller=new AdventureController(validated);controller.start(ADVENTURES[0].id,{aircraftId:'f35',conditions:'live'});controller.pause();
    assert.deepEqual(controller.progress.liveries,progress.liveries);
    const source=storage(),target=storage();source.setItem('fly-adventures-v1',JSON.stringify({version:2,progress:controller.progress}));
    restoreBackup(target,parseBackup(JSON.stringify(createBackup(source))));
    assert.deepEqual(JSON.parse(target.getItem('fly-adventures-v1')).progress.liveries,progress.liveries);
  }
  assert.deepEqual(validateProgress({...emptyProgress(),liveries:{f35:'earned',airliner:'ghost-11',prop:'unknown',constructor:'earned'}}).liveries,{});
  const earned=emptyProgress();earned.completed[ADVENTURES[0].id]={medal:1,at:123};earned.liveries[ADVENTURES[0].reward]='earned';
  assert.equal(validateProgress(earned).liveries[ADVENTURES[0].reward],'earned');
});

test('store saves per-plane picks, rejects forged choices and reports unavailable storage',()=>{
  const original=globalThis.localStorage;globalThis.localStorage=storage();
  const previous=useAdventureStore.getState();
  try{
    useAdventureStore.setState({progress:emptyProgress(),ready:false});useAdventureStore.getState().hydrate();
    assert.equal(useAdventureStore.getState().equip('f35','viper-22'),true);
    assert.equal(useAdventureStore.getState().equip('airliner','pelagic'),true);
    assert.equal(useAdventureStore.getState().equip('f35','pelagic'),false);
    assert.equal(useAdventureStore.getState().equip('f35',true),false);
    const saved=JSON.parse(localStorage.getItem('fly-adventures-v1')).progress.liveries;
    assert.deepEqual(saved,{f35:'viper-22',airliner:'pelagic'});
    useAdventureStore.setState({ready:false,progress:emptyProgress()});useAdventureStore.getState().hydrate();
    assert.deepEqual(useAdventureStore.getState().progress.liveries,saved);
    assert.equal(useAdventureStore.getState().equip('f35',false),true);
    assert.equal(useAdventureStore.getState().progress.liveries.f35,'standard');
    globalThis.localStorage={setItem(){throw Error('Storage full');}};
    assert.equal(useAdventureStore.getState().equip('f35','arctic-07'),true);
    assert.equal(useAdventureStore.getState().sessionOnly,true);
    assert.equal(useAdventureStore.getState().progress.liveries.f35,'arctic-07');
  }finally{globalThis.localStorage=original;useAdventureStore.setState(previous,true);}
});

for(const aircraft of PLAYER_AIRCRAFT)for(const phone of [false,true])test(`${aircraft.id}/${phone?'mobile':'hero'}: paint owns its resources and follows real control geometry`,async()=>{
  const priorWindow=globalThis.window;
  globalThis.window={...priorWindow,__flyCommercialPaintOverride:{enabled:true}};
  const resolved=resolveAircraft(aircraft.id),entry=aircraftPresentation(resolved,phone,{mapStyle:'satellite',visuals:'enhanced'});
  const bytes=fs.readFileSync(new URL(`../public${entry.url}`,import.meta.url));
  const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const clone=scene.clone(true),originals=new Map(),baseColors=new Map(),unpainted=[];
  clone.traverse(o=>{if(o.isMesh){originals.set(o,o.geometry);o.material=o.material.clone();baseColors.set(o,o.material.color.clone());if(!liveryMaterialRole(o.material,o))unpainted.push([o,o.material.color.clone(),o.geometry]);}});
  const before=[];scene.traverse(o=>{if(o.isMesh)before.push([o,o.geometry,o.material.color.clone()]);});
  const skins=PRESET_LIVERIES[aircraft.id],keys=[];
  for(const skin of skins){
    applyFleetLivery(clone,aircraft.id,skin.id);
    const state=clone.userData.fleetPaint;assert.equal(state.uniforms.uFleetPaintOn.value,1);
    assert.equal(state.skinId,skin.id);assert.ok(state.uniforms.uFleetPattern.value>0);
    clone.traverse(o=>{if(!o.isMesh||!liveryMaterialRole(o.material,o))return;
      assert.notEqual(o.geometry,originals.get(o));assert.equal(originals.get(o).attributes.aFleetPaint,undefined);
      const coords=o.geometry.attributes.aFleetPaint;assert.equal(coords.count,o.geometry.attributes.position.count);for(const v of coords.array)assert.ok(Number.isFinite(v));
      // The patch must compile alongside actual Three material shader anchors.
      const shader={vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader,uniforms:UniformsUtils.clone(ShaderLib.standard.uniforms)};
      o.material.onBeforeCompile(shader);assert.ok(shader.vertexShader.includes('vFleetPaint=aFleetPaint;'));assert.ok(shader.fragmentShader.includes('diffuseColor.rgb=base;'));assert.ok(shader.fragmentShader.includes('diffuseColor.rgb*=vColor.rgb;'),'livery keeps authored occlusion and coating colours');
      assert.equal(shader.uniforms.uFleetPattern,state.uniforms.uFleetPattern);
    });
    keys.push([...originals.keys()].map(o=>o.material.customProgramCacheKey()).join('|'));
  }
  assert.equal(new Set(keys).size,1,'skin switches do not create shader variants');
  for(const [o,g,c]of before){assert.equal(o.geometry,g);assert.equal(g.attributes.aFleetPaint,undefined);assert.ok(o.material.color.equals(c));}
  for(const [o,c,g]of unpainted){assert.ok(o.material.color.equals(c),'glass, windows, intake and metal keep their finish');assert.equal(o.geometry,g);}
  const paintCoordinates=new Map();clone.traverse(o=>{if(o.geometry?.attributes.aFleetPaint)paintCoordinates.set(o,Array.from(o.geometry.attributes.aFleetPaint.array));});
  fleetAnimator(clone,entry.parts)({bank:.3,pitch:.2,speed:100},1/60);
  for(const [o,coords]of paintCoordinates)assert.deepEqual(Array.from(o.geometry.attributes.aFleetPaint.array),coords,'control motion must not slide the paint');
  applyFleetLivery(clone,aircraft.id,'standard');assert.equal(clone.userData.fleetPaint.uniforms.uFleetPaintOn.value,0);
  for(const [o,c]of baseColors)assert.ok(o.material.color.equals(c),'house colors restore every source color');
  if(LIVERIES[aircraft.id]){applyFleetLivery(clone,aircraft.id,true);assert.equal(clone.userData.fleetPaint.uniforms.uFleetPaintOn.value,0);}
  let disposed=0;for(const o of paintCoordinates.keys())o.geometry.addEventListener('dispose',()=>disposed++);
  disposeFleetGeometry(clone);assert.equal(disposed,paintCoordinates.size);
  globalThis.window=priorWindow;
});
