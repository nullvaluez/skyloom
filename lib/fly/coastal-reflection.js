import { Color, DoubleSide, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, Matrix4, PerspectiveCamera, Vector3, WebGLRenderTarget } from 'three';
import { COASTAL_WATER_UNIFORMS as uniforms, clearCoastalReflection } from './coastal-water';
import { installTrueScaleCamera } from './true-scale';

// 29 belongs to SkyOverlayPass. Sharing it silently captures airborne marks
// as city reflections and draws those marks a second time into the water.
export const COASTAL_REFLECTION_LAYER = 28;
const forward = new Vector3(), up = new Vector3();
const visibleInTree = object => { for(let at=object;at;at=at.parent)if(!at.visible)return false;return true; };
const materialsOf = object => Array.isArray(object.material)?object.material:object.material?[object.material]:[];
const reflectionMaterialVisible=object=>{
  if(!Array.isArray(object.material))return !!object.material?.visible;
  for(const material of object.material)if(material?.visible)return true;
  return false;
};
function reflectionFeatures(object){
  const a=object.geometry.attributes;
  return (!!a.position)|((!!a.normal)<<1)|((!!a.tangent)<<2)|((a.color?.itemSize===4)<<3)|
    ((!!a.uv)<<4)|((!!a.uv1)<<5)|((!!a.uv2)<<6)|((!!a.uv3)<<7)|((!!object.isInstancedMesh)<<8)|
    ((!!object.instanceColor)<<9)|((!!object.morphTexture)<<10)|((!!object.isSkinnedMesh)<<11)|
    ((!!object.isBatchedMesh)<<12)|((!!object._colorsTexture)<<13)|((!!object.receiveShadow)<<14);
}
function sameReflectionMaterial(saved,material){
  return saved?.material===material&&saved.version===material.version&&saved.side===material.side&&
    saved.transparent===material.transparent&&saved.single===material.forceSinglePass&&saved.map===material.map&&
    saved.alphaMap===material.alphaMap&&saved.alphaTest===material.alphaTest&&saved.envMap===material.envMap;
}
function sameReflectionMaterials(saved,object){
  const material=object.material;
  if(!saved)return false;
  if(!Array.isArray(material))return saved.length===1&&sameReflectionMaterial(saved[0],material);
  if(saved.length!==material.length)return false;
  for(let i=0;i<material.length;i++)if(!sameReflectionMaterial(saved[i],material[i]))return false;
  return true;
}
const reflectionMaterialSnapshot=object=>materialsOf(object).map(material=>({material,version:material.version,side:material.side,
  transparent:material.transparent,single:material.forceSinglePass,map:material.map,alphaMap:material.alphaMap,
  alphaTest:material.alphaTest,envMap:material.envMap}));
export function publishCoastalReflection(runtime,stats){runtime.coastalReflection=stats;}
export function removeCoastalReflection(runtime,stats){if(runtime.coastalReflection===stats)delete runtime.coastalReflection;}
/** Mirror the camera around sea level. The ordinary projection is copied intact,
 * including reverse-Z. Only above-water urban geometry is submitted, so no
 * oblique near-plane rewrite (and no incompatible reverse-depth conversion). */
export function mirrorCoastalCamera(source, target, matrix) {
  source.updateMatrixWorld();
  forward.set(0, 0, -1).transformDirection(source.matrixWorld);
  up.set(0, 1, 0).transformDirection(source.matrixWorld);
  target.copy(source, false);
  target.position.setFromMatrixPosition(source.matrixWorld);
  target.position.y *= -1;
  forward.y *= -1;
  up.y *= -1;
  target.up.copy(up);
  target.lookAt(forward.add(target.position));
  target.updateMatrixWorld();
  target.layers.set(COASTAL_REFLECTION_LAYER);
  matrix.set(.5,0,0,.5, 0,.5,0,.5, 0,0,.5,.5, 0,0,0,1)
    .multiply(target.projectionMatrix).multiply(target.matrixWorldInverse);
}

/** Coastal architecture capture. Reuses the live meshes/materials, including
 * their actual window emission. No terrain, water, aircraft or second shadow
 * render. The texture is released when the style/tier/venue stops using it. */
export class CoastalReflection {
  constructor() {
    this.camera = new PerspectiveCamera();
    // TRUE_SCALE: S commutes with the sea-level mirror, so the mirrored view
    // is the same anisotropic camera at the mirrored pose. No-op when off.
    installTrueScaleCamera(this.camera);
    this.matrix = new Matrix4();
    this.color = new Color();
    this.target = null;
    this.programWarm={required:false,status:'waiting',pending:0,held:0,dispatches:0,skippedCaptures:0,error:null,programKeys:[]};
    this.stats = { active:false, captures:0, draws:0, width:0, height:0, bytes:0,programWarm:this.programWarm };
    this._warmRecords=new Map();this._warmPending=new Set();this._warmGlobal=new Set();this._warmKeys=new Set();this._warmDrawVersions=new Set();
    this._warmReady=new WeakSet();this._warmHeld=[];this._warmEpoch=0;this._warmKey=null;this._hasCapture=false;
    this._warmLost=()=>{this._resetWarm();this._contextLost=true;clearCoastalReflection();this.stats.active=false;};
    this._warmRestored=()=>{this._resetWarm();this._contextLost=false;};
  }

  _resetWarm(){
    // Polling belongs to update(), so clearing captured owners cancels every
    // pending batch without timers or callbacks surviving release/restoration.
    this._warmRecords.clear();this._warmPending.clear();this._warmGlobal.clear();this._warmKeys.clear();
    this._warmDrawVersions.clear();
    this._warmReady=new WeakSet();this._warmHeld.length=0;this._warmKey=null;this._hasCapture=false;
    Object.assign(this.programWarm,{status:'waiting',pending:0,held:0,error:null,programKeys:[]});
  }

  _preparePrograms(renderer,scene,changed){
    const state=this.programWarm;
    if(this._warmRenderer!==renderer){
      this._detachWarm();this._resetWarm();this._warmRenderer=renderer;
      renderer.domElement?.addEventListener('webglcontextlost',this._warmLost);
      renderer.domElement?.addEventListener('webglcontextrestored',this._warmRestored);
    }
    if(this._contextLost||renderer.getContext?.().isContextLost())return false;
    state.required=!!renderer.extensions?.has?.('KHR_parallel_shader_compile');
    if(!state.required){state.status='unsupported';return true;}
    if(state.status==='failed')return true;
    try{
      const env=scene.environment;
      let lights='';
      for(const[o]of changed)if(o.isLight&&visibleInTree(o))lights+=`${o.id}:${o.castShadow}:${!!o.map},`;
      const key=[env?.id,env?.mapping,env?.image?.height,!!scene.fog,!!scene.fog?.isFogExp2,lights,
        renderer.shadowMap.enabled,renderer.shadowMap.type,renderer.toneMapping,renderer.outputColorSpace,this.target.texture.colorSpace].join('/');
      const rekey=key!==this._warmKey;this._warmKey=key;
      const epoch=++this._warmEpoch;let batch;
      for(const[object]of changed){
        if(!object.isMesh||!visibleInTree(object)||!reflectionMaterialVisible(object))continue;
        let record=this._warmRecords.get(object);
        if(record?.seen===epoch)continue;
        if(!record){record={object,programs:new Set()};this._warmRecords.set(object,record);}
        record.seen=epoch;
        const geometry=object.geometry,morph=geometry.morphAttributes,features=reflectionFeatures(object);
        if(!rekey&&record.geometry===geometry&&record.features===features&&record.morphPosition===(morph.position?.length??-1)&&
          record.morphNormal===(morph.normal?.length??-1)&&record.morphColor===(morph.color?.length??-1)&&sameReflectionMaterials(record.materials,object))continue;
        record.geometry=geometry;record.features=features;record.morphPosition=morph.position?.length??-1;
        record.morphNormal=morph.normal?.length??-1;record.morphColor=morph.color?.length??-1;
        (batch??=[]).push(record);
      }
      for(const record of this._warmRecords.values())if(record.seen!==epoch){
        for(const saved of record.materials??[])this._warmDrawVersions.delete(saved);
        this._warmRecords.delete(record.object);
      }
      if(batch){
        // The actual reflection target, mirror camera, temporary geometry/light
        // layers, environment and shadow state are already bound by update().
        // Traversal holders preserve the live object features without parenting
        // or cloning geometry, and targetScene supplies the exact visible lights.
        const holder={traverse:visit=>{for(const record of batch)visit(record.object);},traverseVisible:()=>{}};
        renderer.compile(holder,this.camera,scene);state.dispatches++;
        for(const record of batch){
          for(const saved of record.materials??[])this._warmDrawVersions.delete(saved);
          record.materials=reflectionMaterialSnapshot(record.object);record.programs.clear();
          for(const saved of record.materials){
            if(saved.transparent&&saved.side===DoubleSide&&!saved.single)this._warmDrawVersions.add(saved);
            const properties=renderer.properties.get(saved.material);
            // Include both sides of transparent DoubleSide materials, not
            // merely the last currentProgram returned by Three.compile.
            for(const program of properties.programs?.values?.()??[properties.currentProgram]){
              if(!program)throw Error('Reflection shader preparation produced no program');
              record.programs.add(program);this._warmKeys.add(program.cacheKey);
              if(!this._warmReady.has(program))this._warmPending.add(program);
            }
          }
        }
        state.programKeys=[...this._warmKeys];
      }
      for(const program of this._warmPending)if(program.usedTimes===0||program.isReady()){
        this._warmPending.delete(program);this._warmReady.add(program);
      }
      if(rekey&&this._hasCapture){this._warmGlobal.clear();for(const program of this._warmPending)this._warmGlobal.add(program);}
      for(const program of this._warmGlobal)if(program.usedTimes===0||this._warmReady.has(program))this._warmGlobal.delete(program);
      this._warmHeld.length=0;
      if(this._warmPending.size)for(const record of this._warmRecords.values())for(const program of record.programs){
        if(program.usedTimes!==0&&!this._warmReady.has(program)){this._warmHeld.push(record.object);break;}
      }
      state.pending=this._warmPending.size;state.held=this._warmHeld.length;
      if((!this._hasCapture&&state.pending)||this._warmGlobal.size){state.status='compiling';state.skippedCaptures++;this.stats.draws=0;return false;}
      state.status=state.held?'streaming':'ready';return true;
    }catch(error){
      // Explicit renderer fallback, not a timeout that first-uses a slow link.
      state.status='failed';state.error=String(error?.message??error);this._warmHeld.length=0;return true;
    }
  }

  _detachWarm(){
    this._warmRenderer?.domElement?.removeEventListener('webglcontextlost',this._warmLost);
    this._warmRenderer?.domElement?.removeEventListener('webglcontextrestored',this._warmRestored);
    this._warmRenderer=null;this._contextLost=false;
  }
  update(renderer, scene, camera, runtime, tier, enabled, profile=null) {
    const groups = [runtime.satBuildings?.object, runtime.satSkyline?.object].filter(Boolean);
    const elevation = runtime.flight?.pos?.y;
    const nearSea = Number.isFinite(elevation) && elevation < 2200 && (runtime.flight?.groundElev ?? Infinity) < 150
      && (runtime.earthSurface?.nearWaterCells ?? 0) > 0;
    if (!enabled || tier === 'low' || (profile&&!profile.reflection) || !nearSea || !groups.length) { this.release(); return; }
    // A profile change creates fresh cascade lights before this auxiliary pass.
    // Their depth maps are allocated by the main shadow render later this frame.
    // Rendering a reflection first would bind the ordinary empty texture to a
    // sampler2DShadow and reject the draw. Keep sky water for this one frame.
    // One scene walk finds both the lights the capture shares and any shadow
    // map not yet allocated (it used to be two full walks per frame).
    let waitingForShadows=false;const lights=this._lights??=[];lights.length=0;
    scene.traverse(o=>{if(!o.isLight)return;if(o.castShadow&&o.shadow&&(!o.shadow.map||o.shadow.needsUpdate))waitingForShadows=true;if(o.visible)lights.push(o);});
    if(waitingForShadows){uniforms.uCoastReady.value=0;this.stats.active=false;this.stats.draws=0;return;}
    const changed=[], ranges=[], add=o=>{ if (!o.visible || (!o.isMesh&&!o.isLight)) return; changed.push([o,o.layers.mask]); };
    for(const group of groups) if(group.visible) group.traverse(add);
    // Do not allocate a target every frame while city chunks are still loading.
    if(!changed.some(([o])=>o.isMesh)){this.release();return;}
    const width = profile?.reflection?.[0] ?? (tier === 'high' ? 768 : 384), height = profile?.reflection?.[1] ?? width * 2 / 3;
    if (!this.target || this.target.width !== width || this.target.height!==height) {
      this.release();
      // The water's roughness kernel needs area samples, not isolated base-level
      // texels. Resolve subpixel building edges before generating the mip chain.
      const samples = Math.min(4, renderer.capabilities?.maxSamples ?? 0);
      this.target = new WebGLRenderTarget(width,height,{type:HalfFloatType,minFilter:LinearMipmapLinearFilter,magFilter:LinearFilter,
        generateMipmaps:true,samples,depthBuffer:true,stencilBuffer:false});
      this.target.texture.name='coastal-city-reflection';
      this.stats.width=width;this.stats.height=height;
      this.stats.bytes=Math.ceil(width*height*(8*4/3+4+samples*12));
      uniforms.uCoastTexel.value.set(1/width,1/height);
    }
    scene.updateMatrixWorld();
    mirrorCoastalCamera(camera,this.camera,this.matrix);
    // Lighting is shared with the main scene. The reflection layer selects
    // geometry only; it does not turn an unlit city into a luminous painting.
    for(const light of lights)add(light);
    const old={target:renderer.getRenderTarget(),auto:renderer.autoClear,alpha:renderer.getClearAlpha(),xr:renderer.xr.enabled,
      shadow:renderer.shadowMap.autoUpdate,shadowNeeds:renderer.shadowMap.needsUpdate,background:scene.background};
    renderer.getClearColor(this.color);
    try {
      for(const[o]of changed)o.layers.enable(COASTAL_REFLECTION_LAYER);
      for(const[o]of changed){
        const geometry=o.geometry,count=geometry?.userData.auxiliaryIndexCount;
        if(Number.isInteger(count)){
          ranges.push([geometry,geometry.drawRange.start,geometry.drawRange.count]);
          geometry.setDrawRange(0,count);
        }
      }
      renderer.xr.enabled=false;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
      scene.background=null;renderer.autoClear=true;renderer.setRenderTarget(this.target);renderer.setClearColor(0,0);
      if(!this._preparePrograms(renderer,scene,changed))return;
      // Only newly linking geometry waits after the first capture. Mask its
      // reflection layer for this draw; the finally block restores every live
      // layer before the main world renders later in the same frame.
      for(const object of this._warmHeld)object.layers.disable(COASTAL_REFLECTION_LAYER);
      renderer.clear();
      const callsBefore=renderer.info.autoReset===false?renderer.info.render.calls:0;
      renderer.render(scene,this.camera);
      this._hasCapture=true;
      for(const saved of this._warmDrawVersions)saved.version=saved.material.version;
      uniforms.uCoastReflection.value=this.target.texture;uniforms.uCoastMatrix.value.copy(this.matrix);uniforms.uCoastReady.value=1;
      this.stats.active=true;this.stats.captures++;this.stats.draws=renderer.info.render.calls-callsBefore;
    } finally {
      for(const[geometry,start,count]of ranges)geometry.setDrawRange(start,count);
      for(const[o,mask]of changed)o.layers.mask=mask;
      scene.background=old.background;renderer.setRenderTarget(old.target);renderer.setClearColor(this.color,old.alpha);
      renderer.autoClear=old.auto;renderer.xr.enabled=old.xr;renderer.shadowMap.autoUpdate=old.shadow;renderer.shadowMap.needsUpdate=old.shadowNeeds;
    }
  }
  release(){
    this._detachWarm();this._resetWarm();
    this.target?.dispose();this.target=null;clearCoastalReflection();
    this.stats.active=false;this.stats.width=this.stats.height=this.stats.bytes=this.stats.draws=0;
  }
  dispose(){this.release();}
}
