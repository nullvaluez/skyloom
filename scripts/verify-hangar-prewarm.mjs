import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Scene, Mesh, BoxGeometry, MeshStandardMaterial, MeshDepthMaterial, ShaderMaterial, PerspectiveCamera, OrthographicCamera,
  DirectionalLight, WebGLRenderTarget, DataTexture, EquirectangularReflectionMapping, FloatType, RGBAFormat, WebGLCoordinateSystem,
  PCFShadowMap, PCFSoftShadowMap, CubeUVReflectionMapping, Fog, Texture } from 'three';
import { WebGLPrograms } from 'three/src/renderers/webgl/WebGLPrograms.js';
import { WebGLShadowMap } from 'three/src/renderers/webgl/WebGLShadowMap.js';
import { MeshReflectorMaterial } from '@react-three/drei/materials/MeshReflectorMaterial.js';
import { createHangarPrewarm } from '../lib/fly/hangar-prewarm.js';
import { createHangarFrameGate } from '../lib/fly/hangar-frame-gate.js';

function fiberLoopFixture() {
  const directory=new URL('../node_modules/@react-three/fiber/dist/',import.meta.url);
  const file=fs.readdirSync(directory).find(name=>/^events-.*\.esm\.js$/.test(name));
  const source=fs.readFileSync(new URL(file,directory),'utf8');
  const extract=name=>{const start=source.indexOf(`function ${name}(`);assert.ok(start>=0);return source.slice(start,source.indexOf('\n}',start)+2);};
  const roots=new Map();let globalEffects=0;
  const loop=vm.runInNewContext(`let subscribers,subscription,running=false,useFrameInProgress=false,repeat,frame,state;
    ${['update','loop','invalidate','advance'].map(extract).join('\n')}
    ({loop,invalidate,advance})`,{_roots:roots,requestAnimationFrame:()=>1,cancelAnimationFrame(){},flushGlobalEffects(){globalEffects++;}});
  const root=()=>{
    let state,draws=0,callbacks=0,delta=null;const listeners=new Set();
    const store={getState:()=>state,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}};
    state={frameloop:'always',clock:{elapsedTime:12,getDelta:()=>.016},scene:{},camera:{},
      gl:{xr:{isPresenting:false},render(){draws++;}},internal:{active:true,frames:0,priority:0,subscribers:[]},
      setFrameloop(frameloop){state={...state,frameloop};listeners.forEach(listener=>listener(state));}};
    state.internal.subscribers.push({store,ref:{current(_state,dt){callbacks++;delta=dt;}}});
    roots.set(store,{store});
    return {store,draws:()=>draws,callbacks:()=>callbacks,delta:()=>delta};
  };
  return {loop,root,globalEffects:()=>globalEffects};
}

function fixture({hdr=false,parallel=true}={}) {
  const scene=new Scene(),camera=new PerspectiveCamera(),mirror=new PerspectiveCamera(),shadowCamera=new OrthographicCamera();
  const geometry=new BoxGeometry(),material=new MeshStandardMaterial(),mesh=new Mesh(geometry,material);mesh.castShadow=true;scene.add(mesh);
  const light=new DirectionalLight();light.castShadow=true;scene.add(light);
  const reflected=new WebGLRenderTarget(4,4),blurTarget=new WebGLRenderTarget(4,4),contact=new WebGLRenderTarget(4,4),contactBlur=new WebGLRenderTarget(4,4);
  const blurScene=new Scene(),quad=new Mesh(new BoxGeometry(),new ShaderMaterial());blurScene.add(quad);
  const depth=new MeshDepthMaterial(),hBlur=new ShaderMaterial(),vBlur=new ShaderMaterial(),contactPlane=new Mesh(new BoxGeometry(),hBlur);
  depth.onBeforeCompile=shader=>{shader.fragmentShader+='// actual contact depth hook';};
  if(hdr){scene.environment=new DataTexture(new Float32Array(64*32*4),64,32,RGBAFormat,FloatType);scene.environment.mapping=EquirectangularReflectionMapping;scene.background=scene.environment;}
  let target=null,face=0,mip=0,lost=false,properties=new WeakMap(),cache=new Map(),contactCount=0,frames=Infinity;
  const allMaterials=new Set(),disposedMaterials=new Set();
  const gl={isWebGLRenderer:true,coordinateSystem:WebGLCoordinateSystem,autoClear:true,toneMapping:4,outputColorSpace:'srgb',
    xr:{enabled:true},shadowMap:{enabled:true,type:1,autoUpdate:true,needsUpdate:true},state:{buffers:{depth:{getReversed:()=>false}}},
    extensions:{has:()=>parallel},getContext:()=>({isContextLost:()=>lost}),properties:{get:material=>properties.get(material)},
    getRenderTarget:()=>target,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,
    setRenderTarget(value,nextFace=0,nextMip=0){target=value;face=nextFace;mip=nextMip;},
    draws:[],compiles:[],clears:0,screenClears:0,advances:[],nested:false,
    clear(){this.clears++;if(target===null)this.screenClears++;},clearColor(){this.clear();},clearDepth(){this.clear();},clearStencil(){this.clear();},
    render(source,cam){this.draws.push({source,cam,target,override:source.overrideMaterial});this.clear();},
    compile(source,cam,world=source){
      const objects=[],materials=new Set();let lights=0;world.traverseVisible(o=>{if(o.isLight)lights++;});
      source.traverse(o=>{if(o.material)objects.push(o);});
      if(this.nested&&world.environment&&objects.some(o=>o.material?.isMeshStandardMaterial)){
        this.nested=false;const previous=target;this.setRenderTarget(blurTarget);this.render(blurScene,shadowCamera);this.setRenderTarget(previous);
      }
      for(const o of objects)for(const m of Array.isArray(o.material)?o.material:[o.material]){
        const key=[m.type,m.vertexShader,m.fragmentShader,m.customProgramCacheKey(),JSON.stringify(m.defines),m.side,lights,
          !!world.fog,!!world.environment,target===null?'screen':'linear',!!o.isSkinnedMesh,!!o.isInstancedMesh].join('/');
        let program=cache.get(key);if(!program){program={cacheKey:key,usedTimes:0,ready:false,isReady(){return this.ready;}};cache.set(key,program);}
        const props=properties.get(m)??{programs:new Map()};
        if(!props.programs.has(key)){props.programs.set(key,program);program.usedTimes++;}
        props.currentProgram=program;properties.set(m,props);materials.add(m);
        if(!allMaterials.has(m)){allMaterials.add(m);m.addEventListener('dispose',()=>{disposedMaterials.add(m);for(const p of props.programs.values())p.usedTimes--;});}
      }
      this.compiles.push({objects,world,cam,target,materials});return materials;
    },
    complete(){for(const p of cache.values())p.ready=true;},
    restore(){properties=new WeakMap();cache=new Map();lost=false;},lose(){lost=true;},
  };
  const methods=Object.fromEntries(['render','clear','clearColor','clearDepth','clearStencil'].map(k=>[k,gl[k]]));
  const advance=(timestamp,globalEffects)=>{
    gl.advances.push([timestamp,globalEffects]);
    mesh.visible=false;gl.xr.enabled=false;gl.shadowMap.autoUpdate=false;
    gl.setRenderTarget(reflected);gl.clear();gl.render(scene,mirror);
    gl.setRenderTarget(blurTarget);gl.render(blurScene,shadowCamera);
    gl.xr.enabled=true;gl.shadowMap.autoUpdate=true;mesh.visible=true;gl.setRenderTarget(null);
    if(frames===Infinity||contactCount<frames){
      contactCount++;const background=scene.background;scene.background=null;scene.overrideMaterial=depth;
      gl.setRenderTarget(contact);gl.render(scene,shadowCamera);
      contactPlane.material=hBlur;gl.setRenderTarget(contactBlur);gl.render(contactPlane,shadowCamera);
      contactPlane.material=vBlur;gl.setRenderTarget(contact);gl.render(contactPlane,shadowCamera);
      scene.overrideMaterial=null;scene.background=background;gl.setRenderTarget(null);
    }
    gl.render(scene,camera);
  };
  const warm=createHangarPrewarm(gl,scene,camera,advance);
  return {scene,camera,mesh,material,gl,warm,reflected,depth,hBlur,vBlur,methods,disposedMaterials,allMaterials,advance,
    live(){frames=1;contactCount=0;},contactCount:()=>contactCount,
    restored(){for(const[name,method]of Object.entries(methods))assert.equal(gl[name],method);assert.equal(target,null);
      assert.equal(gl.xr.enabled,true);assert.equal(gl.shadowMap.autoUpdate,true);assert.equal(gl.shadowMap.needsUpdate,true);
      assert.equal(scene.overrideMaterial,null);assert.equal(mesh.visible,true);},
    dispose(){warm.dispose();scene.environment?.dispose();for(const t of [reflected,blurTarget,contact,contactBlur])t.dispose();
      for(const m of [material,quad.material,depth,hBlur,vBlur])m.dispose();for(const g of [geometry,quad.geometry,contactPlane.geometry])g.dispose();},
  };
}
let count=0;const check=(name,run)=>{run();console.log('PASS '+name);count++;};
check('actual frame calls prepare screen, reflected, contact override and blur keys without drawing or clearing',()=>{
  const f=fixture();assert.equal(f.warm.prepare(),false);f.restored();assert.deepEqual(f.gl.advances,[[0,false]]);
  assert.equal(f.gl.draws.length,0);assert.equal(f.gl.clears,0);assert.equal(f.gl.screenClears,0);
  assert.ok(f.gl.compiles.some(c=>c.target===null&&c.cam===f.camera));
  assert.ok(f.gl.compiles.some(c=>c.target===f.reflected&&c.cam!==f.camera));
  for(const m of [f.depth,f.hBlur,f.vBlur])assert.ok(f.gl.compiles.some(c=>c.materials.has(m)));
  for(let i=0;i<5;i++)assert.equal(f.warm.prepare(),false);assert.equal(f.gl.advances.length,1);
  f.gl.complete();assert.equal(f.warm.prepare(),true);f.live();f.advance(0,false);f.advance(0,false);assert.equal(f.contactCount(),1);
  f.dispose();
});
check('missing model/HDR can prepare the available bay and later work never clears its presented canvas',()=>{
  const f=fixture();f.warm.prepare();f.gl.complete();assert.equal(f.warm.prepare(),true);
  f.warm.invalidate();const before=f.gl.screenClears;f.mesh.material.needsUpdate=true;f.warm.prepare();
  assert.equal(f.gl.screenClears,before);f.restored();f.dispose();
});
check('installed HDR PMREM and cube conversions finish before the root-local capture, with safe nested real draws',()=>{
  const f=fixture({hdr:true});assert.equal(f.warm.prepare(),false);assert.equal(f.gl.advances.length,0);assert.equal(f.gl.draws.length,0);f.restored();
  assert.ok(f.gl.compiles.some(c=>[...c.materials].some(m=>m.name==='CubemapFromEquirect')));
  f.gl.complete();f.gl.nested=true;assert.equal(f.warm.prepare(),false);assert.equal(f.gl.advances.length,1);
  assert.equal(f.gl.draws.length,1,'Nested PMREM-style draws execute instead of caching an empty result');assert.equal(f.gl.screenClears,0);
  const backgrounds=f.gl.compiles.filter(c=>[...c.materials].some(m=>m.name==='BackgroundCubeMaterial'));
  assert.ok(backgrounds.some(c=>c.target===null));assert.ok(backgrounds.some(c=>c.target===f.reflected));
  f.gl.complete();assert.equal(f.warm.prepare(),true);f.restored();f.dispose();
});
check('failure restores every patch and does not dispose borrowed Drei resources',()=>{
  const f=fixture();let borrowedDisposed=0;for(const value of [f.reflected,f.mesh.geometry,f.material,f.depth,f.hBlur,f.vBlur])value.addEventListener('dispose',()=>borrowedDisposed++);
  const compile=f.gl.compile;f.gl.compile=()=>{throw Error('capture-failed');};assert.equal(f.warm.prepare(),true);assert.match(f.warm.state.error,/capture-failed/);
  f.restored();f.warm.dispose();assert.equal(borrowedDisposed,0);f.gl.compile=compile;f.dispose();
});
check('HDR dispatch failure releases retained PMREM materials and restores renderer methods',()=>{
  const f=fixture({hdr:true}),compile=f.gl.compile;f.gl.compile=function(...args){const result=compile.apply(this,args);throw Error('HDR-dispatch-failed');};
  assert.equal(f.warm.prepare(),true);assert.match(f.warm.state.error,/HDR-dispatch-failed/);f.restored();
  assert.ok(f.disposedMaterials.size>0,'Failed generators release material owners');f.dispose();
});
check('context restore re-arms captured owners and unsupported drivers retain the original render path',()=>{
  const f=fixture();f.warm.prepare();f.gl.lose();assert.equal(f.warm.prepare(),false);f.warm.invalidate(true);f.gl.restore();
  assert.equal(f.warm.prepare(),false);f.gl.complete();assert.equal(f.warm.prepare(),true);f.dispose();
  const unsupported=fixture({parallel:false});assert.equal(unsupported.warm.prepare(),true);assert.equal(unsupported.gl.compiles.length,0);unsupported.dispose();
});
check('React integration preserves one-shot contact callbacks and re-arm uses stored root elapsed time',()=>{
  const scene=fs.readFileSync(new URL('../components/fly/hud/HangarScene.jsx',import.meta.url),'utf8');
  const rig=fs.readFileSync(new URL('../components/fly/hud/HangarPrewarm.jsx',import.meta.url),'utf8');
  const contact=fs.readFileSync(new URL('../node_modules/@react-three/drei/core/ContactShadows.js',import.meta.url),'utf8');
  assert.equal((scene.match(/frames=\{preparing\?Infinity:1\}/g)??[]).length,2);
  assert.match(contact,/let count = 0/);assert.match(contact,/count\+\+/);assert.match(rig,/advance\(clock\.elapsedTime, effects\)/);
  assert.match(scene,/frameloop=\{prepared\?'always':'never'\}/);assert.match(rig,/controller\.current\?\.resume\(\)/);
});
check('installed R3F queued-frame escape reproduces, then the gate stops both callbacks and main draws',()=>{
  const f=fiberLoopFixture(),hangar=f.root(),flight=f.root();
  f.loop.invalidate(hangar.store.getState());hangar.store.getState().setFrameloop('never');
  f.loop.loop(1000);
  assert.equal(hangar.callbacks(),1,'Red calibration: never alone still executes Drei callbacks');
  assert.equal(hangar.draws(),1,'Red calibration: never alone still draws a queued main frame');
  hangar.store.getState().setFrameloop('always');f.loop.invalidate(hangar.store.getState());
  const gate=createHangarFrameGate(hangar.store);gate.hold();
  f.loop.loop(2000);
  assert.equal(hangar.callbacks(),1);assert.equal(hangar.draws(),1);assert.equal(flight.draws(),2);
  assert.equal(hangar.store.getState().internal.frames,0);assert.ok(gate.state.drainedFrames>0);
  f.loop.invalidate(hangar.store.getState());f.loop.loop(3000);
  assert.equal(hangar.draws(),1,'Invalidation while held cannot queue another shared frame');
  gate.dispose();
});
check('stale Canvas and ready commits cannot reopen a newer preparation generation',()=>{
  const f=fiberLoopFixture(),hangar=f.root(),gate=createHangarFrameGate(hangar.store);
  const oldReady=gate.hold();gate.hold();
  hangar.store.getState().setFrameloop('always');
  assert.equal(hangar.store.getState().frameloop,'never');assert.equal(gate.release(oldReady),false);
  f.loop.loop(1000);assert.equal(hangar.draws(),0);assert.equal(hangar.callbacks(),0);
  assert.equal(gate.release(gate.state.generation),true);
  f.loop.loop(2000);assert.equal(hangar.draws(),1);assert.equal(hangar.callbacks(),1);
  gate.dispose();
});
check('held root-local advance preserves zero delta and leaves other roots/global effects untouched',()=>{
  const f=fiberLoopFixture(),hangar=f.root(),flight=f.root(),gate=createHangarFrameGate(hangar.store);
  gate.hold();f.loop.advance(hangar.store.getState().clock.elapsedTime,false,hangar.store.getState());
  assert.equal(hangar.callbacks(),1);assert.equal(hangar.delta(),0);assert.equal(flight.callbacks(),0);assert.equal(f.globalEffects(),0);
  gate.dispose();gate.dispose();const replay=createHangarFrameGate(hangar.store);replay.hold();
  hangar.store.getState().setFrameloop('always');f.loop.loop(1000);
  assert.equal(hangar.callbacks(),1,'StrictMode replacement owner retains the hold');
  replay.dispose();
});
check('installed r185 shadow setup reproduces the nine native misses and explicit PCF keeps their exact keys',()=>{
  const source=fs.readFileSync(new URL('../components/fly/hud/HangarScene.jsx',import.meta.url),'utf8');
  const directory=new URL('../node_modules/@react-three/fiber/dist/',import.meta.url);
  const fiber=fs.readFileSync(new URL(fs.readdirSync(directory).find(name=>/^events-.*\.esm\.js$/.test(name)),directory),'utf8');
  assert.match(source,/<Canvas shadows="percentage"/);
  assert.match(fiber,/if \(is\.boo\(shadows\)\) \{\s*gl\.shadowMap\.type = THREE\.PCFSoftShadowMap/);
  assert.match(fiber,/percentage: THREE\.PCFShadowMap/);
  const scene=new Scene(),geometry=new BoxGeometry(),camera=new PerspectiveCamera();
  scene.fog=new Fog(0xa6bbc6,900,4000);scene.environment=new Texture({height:2048});scene.environment.mapping=CubeUVReflectionMapping;
  let target=null;const stop=Error('stop before GPU allocation'),warnings=[];
  const renderer={getRenderTarget:()=>target,outputColorSpace:'srgb',toneMapping:4,state:{buffers:{depth:{getReversed:()=>false}}}};
  const shadow=new WebGLShadowMap({getRenderTarget(){throw stop;}},{},{maxTextureSize:4096});renderer.shadowMap=shadow;shadow.enabled=true;
  const programs=WebGLPrograms(renderer,{get:texture=>texture},{has:()=>true},{precision:'highp',logarithmicDepthBuffer:false},null,{numPlanes:0,numIntersection:0});
  const lights={directional:[{},{}],point:[],spot:[{},{},{},{}],spotLightMap:[],hemi:[{}],rectArea:[],
    directionalShadowMap:[{}],pointShadowMap:[],spotShadowMap:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};
  const materials=[['Painted pearl alloy',true,false,0,'|lw-panels-v1'],['Exposed titanium nozzle',true,false,0,''],
    ['Intake interior',false,false,0,''],['Canopy glass',false,true,1,'|lw-glass-v1']].map(([name,vertexColors,transparent,clearcoat,suffix])=>{
      const m=new MeshStandardMaterial({name,vertexColors,transparent});m.clearcoat=clearcoat;m.customProgramCacheKey=()=>`native-hook${suffix}`;return m;
    });
  const floor=new MeshReflectorMaterial();floor.defines={...floor.defines,USE_BLUR:'',USE_DEPTH:'',USE_UV:''};floor.customProgramCacheKey=()=> 'native-reflector-hook';materials.push(floor);
  const offscreen=new WebGLRenderTarget(1024,1024),light=new DirectionalLight();light.castShadow=true;
  const makeKey=material=>programs.getProgramCacheKey(programs.getParameters(material,lights,[light],scene,new Mesh(geometry,material),[]));
  const firstShadowSetup=()=>{
    const warn=console.warn;console.warn=message=>warnings.push(message);
    try{assert.throws(()=>shadow.render([light],scene,camera),error=>error===stop);}finally{console.warn=warn;}
  };
  for(const output of [offscreen,null]){
    target=output;
    for(const material of materials){
      if(output&&material===floor)continue; // The reflector itself is hidden in its reflected camera.
      shadow.type=PCFSoftShadowMap;const oldPrepared=makeKey(material);
      firstShadowSetup();assert.equal(shadow.type,PCFShadowMap);const firstDraw=makeKey(material);
      assert.notEqual(oldPrepared,firstDraw,`${material.name||'reflector'}: old preflight misses the first draw`);
      const before=oldPrepared.split(','),after=firstDraw.split(',');
      const differences=before.map((value,index)=>value===after[index]?null:[value,after[index]]).filter(Boolean);
      assert.deepEqual(differences,[[String(PCFSoftShadowMap),String(PCFShadowMap)]],'Only the shadow-type key field changes');
      shadow.type=PCFShadowMap;const prepared=makeKey(material);firstShadowSetup();assert.equal(makeKey(material),prepared);
      // Recorded native prefixes: HDR cube-UV height, live light counts, fog,
      // opacity/vertex-color/clearcoat bits and output target all agree.
      const opaque=material.transparent?8389635:8520707,flags=material.clearcoat?8388752:material.vertexColors?8389648:8388624;
      const defines=material===floor?'STANDARD,,USE_BLUR,,USE_DEPTH,,USE_UV,':'STANDARD,';
      const expected=`physical,${defines},highp,${output?'srgb-linear':'srgb'},306,2048,${Array(23).fill('false').join(',')},,,false,0,,2,0,4,0,1,0,1,0,0,0,0,1,${output?0:4},0,0,0,${flags},${opaque},srgb,`;
      assert.equal(prepared,expected+material.customProgramCacheKey());
    }
  }
  assert.equal(warnings.length,9,'All nine old variants undergo the same installed renderer fallback');
  programs.dispose();offscreen.dispose();scene.environment.dispose();geometry.dispose();for(const material of materials)material.dispose();
});
console.log(`HANGAR PREWARM: ${count}/${count}`);
