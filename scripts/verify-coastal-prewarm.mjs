import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
registerHooks({resolve(s,c,next){
  if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}
  return next(s,c);
}});
const {Color,Scene,Group,Mesh,BoxGeometry,MeshStandardMaterial,DirectionalLight,PerspectiveCamera,Texture}=await import('three');
const {CoastalReflection,COASTAL_REFLECTION_LAYER}=await import('../lib/fly/coastal-reflection.js');
const {COASTAL_WATER_UNIFORMS:u}=await import('../lib/fly/coastal-water.js');

function fixture(parallel=true){
  const scene=new Scene(),group=new Group(),geometry=new BoxGeometry(),material=new MeshStandardMaterial(),mesh=new Mesh(geometry,material);
  group.add(mesh);scene.add(group,new DirectionalLight());scene.background=new Color('#234567');
  const camera=new PerspectiveCamera();camera.position.set(0,200,0);camera.lookAt(0,0,-1000);
  const runtime={satBuildings:{object:group},flight:{pos:{y:200},groundElev:4},earthSurface:{nearWaterCells:20}};
  const main={name:'main'},cache=new Map();let target=main,alpha=.5,color=new Color('#abcdef'),properties=new WeakMap(),lost=false;
  const gl={domElement:new EventTarget(),autoClear:false,xr:{enabled:true},shadowMap:{enabled:true,type:1,autoUpdate:true,needsUpdate:true},
    outputColorSpace:'srgb',toneMapping:0,info:{autoReset:false,render:{calls:0}},compiles:[],draws:[],clears:0,polls:0,
    extensions:{has:()=>parallel},getContext:()=>({isContextLost:()=>lost}),properties:{get:m=>properties.get(m)},
    getRenderTarget:()=>target,setRenderTarget:v=>{target=v;},getClearAlpha:()=>alpha,getClearColor:v=>v.copy(color),
    setClearColor:(v,a)=>{color.set(v);alpha=a;},clear(){this.clears++;},
    compile(holder,cam,world){
      assert.equal(target,rig.target);assert.equal(cam,rig.camera);assert.equal(world,scene);
      assert.equal(this.shadowMap.autoUpdate,false);assert.equal(this.shadowMap.needsUpdate,false);assert.equal(world.background,null);
      const materials=new Set(),objects=[];let lightCount=0;
      world.traverseVisible(o=>{if(o.isLight&&o.layers.test(cam.layers))lightCount++;});
      holder.traverse(o=>{
        objects.push(o);assert.ok(o.layers.test(cam.layers));
        for(const m of Array.isArray(o.material)?o.material:[o.material]){
          const key=[m.customProgramCacheKey(),m.version,!!o.isInstancedMesh,!!o.isSkinnedMesh,o.receiveShadow,lightCount,world.environment?.id,target.texture.colorSpace].join('/');
          if(!cache.has(key)){
            const p={cacheKey:key,usedTimes:1,ready:false,isReady(){gl.polls++;return this.ready;}};cache.set(key,p);
          }
          const p=cache.get(key),props=properties.get(m)??{programs:new Map()};props.programs.set(key,p);props.currentProgram=p;
          properties.set(m,props);materials.add(m);
        }
      });this.compiles.push(objects);return materials;
    },
    render(world,cam){const objects=[];world.traverseVisible(o=>{if(o.isMesh&&o.layers.test(cam.layers))objects.push(o);});this.draws.push(objects);this.info.render.calls+=objects.length;},
    complete(){for(const p of cache.values())p.ready=true;},
    lose(){lost=true;this.domElement.dispatchEvent(new Event('webglcontextlost'));},
    restore(){lost=false;properties=new WeakMap();cache.clear();this.domElement.dispatchEvent(new Event('webglcontextrestored'));},
  };
  const rig=new CoastalReflection();
  return {gl,rig,scene,group,mesh,material,camera,main,runtime,
    update(){rig.update(gl,scene,camera,runtime,'high',true);},
    restored(){assert.equal(target,main);assert.equal(alpha,.5);assert.equal(color.getHexString(),'abcdef');assert.equal(mesh.layers.mask,1);
      assert.equal(gl.autoClear,false);assert.equal(gl.xr.enabled,true);assert.equal(gl.shadowMap.autoUpdate,true);assert.equal(gl.shadowMap.needsUpdate,true);},
    dispose(){rig.dispose();geometry.dispose();material.dispose();},
  };
}
let count=0;const check=(name,run)=>{run();console.log('PASS '+name);count++;};
check('initial links run under the exact reflection state without clearing or publishing',()=>{
  const f=fixture(),parent=f.mesh.parent;f.update();f.restored();
  assert.equal(f.gl.compiles.length,1);assert.equal(f.gl.clears,0);assert.equal(f.gl.draws.length,0);assert.equal(u.uCoastReady.value,0);
  assert.equal(f.mesh.parent,parent);assert.equal(f.rig.programWarm.status,'compiling');
  for(let i=0;i<10;i++)f.update();assert.equal(f.gl.compiles.length,1);
  f.gl.complete();f.update();f.restored();assert.equal(f.gl.draws.length,1);assert.equal(u.uCoastReady.value,1);
  for(let i=0;i<10;i++)f.update();assert.equal(f.gl.compiles.length,1,'Settled captures do not compile again');f.dispose();
});
check('late geometry waits only in the reflection while existing geometry continues capturing',()=>{
  const f=fixture();f.update();f.gl.complete();f.update();
  const next=new Mesh(f.mesh.geometry,new MeshStandardMaterial());next.material.customProgramCacheKey=()=> 'late-coastal-key';next.layers.enable(3);f.group.add(next);
  f.update();assert.deepEqual(f.gl.draws.at(-1),[f.mesh]);assert.equal(f.rig.programWarm.held,1);assert.equal(next.layers.mask,9);
  assert.equal(f.gl.compiles.at(-1).length,1);f.restored();
  f.gl.complete();f.update();assert.deepEqual(f.gl.draws.at(-1),[f.mesh,next]);assert.equal(next.layers.mask,9);
  next.material.dispose();f.dispose();
});
check('global key changes retain the completed texture and matrix until exact variants finish',()=>{
  const f=fixture();f.update();f.gl.complete();f.update();const captures=f.rig.stats.captures,texture=u.uCoastReflection.value,matrix=u.uCoastMatrix.value.clone();
  f.scene.environment=new Texture();f.camera.position.x+=500;f.update();
  assert.equal(f.rig.stats.captures,captures);assert.equal(u.uCoastReflection.value,texture);assert.deepEqual(u.uCoastMatrix.value.elements,matrix.elements);
  assert.equal(u.uCoastReady.value,1);f.restored();f.gl.complete();f.update();assert.equal(f.rig.stats.captures,captures+1);
  f.scene.environment.dispose();f.dispose();
});
check('context restoration and release cancel old program owners without polling disposed programs',()=>{
  const f=fixture();f.update();f.gl.lose();assert.equal(u.uCoastReady.value,0);f.update();assert.equal(f.gl.draws.length,0);
  f.gl.restore();f.update();assert.equal(f.gl.compiles.length,2);f.gl.complete();f.update();assert.equal(f.gl.draws.length,1);
  f.rig.release();const polls=f.gl.polls;f.gl.restore();assert.equal(f.gl.polls,polls);assert.equal(f.rig._warmRenderer,null);
  assert.equal(f.rig._warmPending.size,0);assert.equal(f.rig.target,null);f.dispose();
});
check('unsupported drivers and failed dispatches retain the original explicit draw fallback',()=>{
  const f=fixture(false);f.update();assert.equal(f.gl.compiles.length,0);assert.equal(f.gl.draws.length,1);f.restored();f.dispose();
  const broken=fixture();broken.gl.compile=()=>{throw Error('reflection-dispatch-failed');};broken.update();
  assert.equal(broken.rig.programWarm.status,'failed');assert.match(broken.rig.programWarm.error,/reflection-dispatch-failed/);
  assert.equal(broken.gl.draws.length,1);broken.restored();broken.dispose();
});
console.log(`COASTAL PREWARM: ${count}/${count}`);
