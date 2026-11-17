import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath,pathToFileURL } from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
registerHooks({resolve(s,c,next){
  if(s.startsWith('@/'))s=pathToFileURL(path.join(project,s.slice(2))).href;
  if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}
  return next(s,c);
}});
const {Scene,Group,Mesh,BoxGeometry,MeshBasicMaterial,PerspectiveCamera,WebGLRenderTarget,Fog,DoubleSide}=await import('three');
const {SkyOverlayPass,registerSkyOverlay,setSkyOverlayDeferred,SKY_OVERLAY_LAYER}=await import('../lib/fly/sky-overlay-pass.js');
const {OVERLAY_GATE_UNIFORMS}=await import('../lib/fly/overlay-gate.js');
function fixture(parallel=true){
  const scene=new Scene(),camera=new PerspectiveCamera(),group=new Group(),geometry=new BoxGeometry(),material=new MeshBasicMaterial(),object=new Mesh(geometry,material);
  group.add(object);scene.add(group);scene.fog=new Fog(0,1,1000);setSkyOverlayDeferred(true);const unregister=registerSkyOverlay(group);
  const pass=new SkyOverlayPass(scene,camera),input=new WebGLRenderTarget(2,2),original={name:'previous'},cache=new Map();let target=original,lost=false,properties=new WeakMap();
  const gl={domElement:new EventTarget(),autoClear:true,shadowMap:{enabled:true,type:1,autoUpdate:true},outputColorSpace:'srgb',toneMapping:0,
    compiles:[],draws:[],polls:0,extensions:{has:()=>parallel},getContext:()=>({isContextLost:()=>lost}),
    getRenderTarget:()=>target,setRenderTarget:value=>{target=value;},properties:{get:m=>properties.get(m)},
    compile(root,cam,holder){
      assert.equal(target,input);assert.equal(cam.layers.mask,1<<SKY_OVERLAY_LAYER);assert.equal(holder,pass.holder);
      assert.equal(holder.fog,scene.fog);assert.equal(holder.environment,null);assert.equal(this.autoClear,false);
      const materials=new Set();root.traverse(o=>{if(!o.material)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){
        const key=[m.customProgramCacheKey(),m.version,m.side,!!holder.fog,holder.fog?.isFogExp2,target.texture.colorSpace].join('/');
        if(!cache.has(key)){const p={cacheKey:key,usedTimes:1,ready:false,isReady(){gl.polls++;return this.ready;}};cache.set(key,p);}
        const props=properties.get(m)??{programs:new Map()},p=cache.get(key);props.currentProgram=p;props.programs.set(key,p);properties.set(m,props);materials.add(m);
      }});this.compiles.push(root);return materials;
    },
    render(holder){this.draws.push([...holder.children]);if(this.throwDraw)throw Error('overlay-draw-failed');},
    complete(){for(const p of cache.values())p.ready=true;},
    lose(){lost=true;this.domElement.dispatchEvent(new Event('webglcontextlost'));},
    restore(){lost=false;cache.clear();properties=new WeakMap();this.domElement.dispatchEvent(new Event('webglcontextrestored'));},
  };
  return {scene,camera,group,object,material,gl,pass,input,
    render(){pass.render(gl,input);},restored(){assert.equal(target,original);assert.equal(camera.layers.mask,1);assert.equal(gl.autoClear,true);
      assert.equal(gl.shadowMap.autoUpdate,true);assert.equal(pass.holder.children.length,0);assert.equal(pass.holder.fog,null);assert.equal(group.parent,scene);},
    dispose(){unregister();pass.dispose();setSkyOverlayDeferred(false);geometry.dispose();material.dispose();input.dispose();},
  };
}
let count=0;const check=(name,run)=>{run();console.log('PASS '+name);count++;};
check('pending overlay programs cannot first-use and compilation matches holder/layer/target',()=>{
  const f=fixture();f.render();f.restored();assert.equal(f.gl.draws.length,0);assert.equal(f.pass.programWarm.held,1);
  for(let i=0;i<10;i++)f.render();assert.equal(f.gl.compiles.length,1);
  f.gl.complete();f.render();assert.deepEqual(f.gl.draws.at(-1),[f.group]);assert.equal(f.pass.programWarm.held,0);
  for(let i=0;i<10;i++)f.render();assert.equal(f.gl.compiles.length,1);f.restored();f.dispose();
});
check('new overlay links hold locally while prepared marks keep drawing',()=>{
  const f=fixture();f.render();f.gl.complete();f.render();
  const next=new Mesh(f.object.geometry,new MeshBasicMaterial());next.material.customProgramCacheKey=()=> 'new-overlay';f.scene.add(next);const unregister=registerSkyOverlay(next);
  f.render();assert.deepEqual(f.gl.draws.at(-1),[f.group]);assert.equal(f.pass.programWarm.held,1);
  f.gl.complete();f.render();assert.deepEqual(f.gl.draws.at(-1),[f.group,next]);
  f.group.visible=false;f.render();assert.deepEqual(f.gl.draws.at(-1),[next]);f.group.visible=true;
  unregister();next.material.dispose();f.dispose();
});
check('new children, material versions and fog keys re-arm readiness',()=>{
  const f=fixture();f.render();f.gl.complete();f.render();let before=f.gl.compiles.length;
  f.material.needsUpdate=true;f.render();assert.equal(f.gl.compiles.length,before+1);assert.equal(f.pass.programWarm.held,1);
  f.gl.complete();f.render();before=f.gl.compiles.length;
  const next=new Mesh(f.object.geometry,new MeshBasicMaterial());next.material.customProgramCacheKey=()=> 'new-overlay-child';f.group.add(next);
  f.render();assert.equal(f.gl.compiles.length,before+1);f.gl.complete();f.render();
  before=f.gl.compiles.length;f.scene.fog=null;f.render();assert.equal(f.gl.compiles.length,before+1);
  next.material.dispose();f.dispose();
});
check('transparent side-version bumps never cause repeated overlay compilation',()=>{
  const f=fixture();f.material.transparent=true;f.material.side=DoubleSide;
  const compile=f.gl.compile.bind(f.gl),render=f.gl.render.bind(f.gl);
  f.gl.compile=(...args)=>{f.material.needsUpdate=true;f.material.needsUpdate=true;return compile(...args);};
  f.gl.render=(...args)=>{f.material.needsUpdate=true;f.material.needsUpdate=true;return render(...args);};
  f.render();f.gl.complete();f.render();const before=f.gl.compiles.length;
  for(let i=0;i<10;i++)f.render();assert.equal(f.gl.compiles.length,before);
  f.material.needsUpdate=true;f.render();assert.equal(f.gl.compiles.length,before+1);f.dispose();
});
check('render exceptions always clear the cloud gate and restore borrowed scene state',()=>{
  const f=fixture();f.render();f.gl.complete();f.gl.throwDraw=true;OVERLAY_GATE_UNIFORMS.uOvEye.value.w=1;
  assert.throws(()=>f.render(),/overlay-draw-failed/);assert.equal(OVERLAY_GATE_UNIFORMS.uOvEye.value.w,0);f.restored();f.dispose();
});
check('context restore and disposal cancel captured owners and listener lifetime',()=>{
  const f=fixture();f.render();f.gl.lose();f.render();assert.equal(f.gl.draws.length,0);
  f.gl.restore();f.render();assert.equal(f.gl.compiles.length,2);f.gl.complete();f.render();assert.equal(f.gl.draws.length,1);
  f.dispose();const polls=f.gl.polls;f.gl.restore();assert.equal(f.gl.polls,polls);assert.equal(f.pass.warmRenderer,null);assert.equal(f.pass.pending.size,0);
});
check('unsupported and failed preparation keep the explicit normal renderer fallback',()=>{
  const f=fixture(false);f.render();assert.equal(f.gl.draws.length,1);assert.equal(f.pass.programWarm.status,'unsupported');f.restored();f.dispose();
  const broken=fixture();broken.gl.compile=()=>{throw Error('overlay-compile-failed');};broken.render();assert.equal(broken.gl.draws.length,1);
  assert.match(broken.pass.programWarm.error,/overlay-compile-failed/);broken.restored();broken.dispose();
});
console.log(`SKY OVERLAY PREWARM: ${count}/${count}`);
