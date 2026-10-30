import { CSM } from 'three/addons/csm/CSM.js';
import { CSMShader } from 'three/addons/csm/CSMShader.js';
import { lightActive, lightBlock, lightFeature, shipPassOn } from './ship-light';
// Three retains programs per material but only one current uniform dictionary.
// Re-entering a cached cascade variant does not call onBeforeCompile again.
// Keep its uniform cells stable across rig replacement and rebind on adoption.
const materialBindings=new WeakMap();

/**
 * Three's stable frustum fitting, with material-local shader composition.
 * Never installs the example's global ShaderChunk override, and never erases
 * the world-bend/depth/terrain hooks which were attached before this owner.
 */
export class CinemaShadows extends CSM {
  _injectInclude() {}
  _initCascades(){
    this.mainFrustum.zNear=this.camera.reversedDepth?1:-1;
    this.mainFrustum.zFar=this.camera.reversedDepth?0:1;
    super._initCascades();
  }
  constructor(camera,scene,profile){
    super({camera,parent:scene,cascades:profile.cascades,shadowMapSize:profile.shadowSize,
      maxFar:profile.shadowRangeM,mode:'practical',lightNear:1,lightFar:14000,
      lightMargin:4000,shadowBias:-.000035});
    // SHIP PASS LIGHT (AIRFRAME_SHADOW): the cascade-0 break in view metres
    // while the airframe fit is applied, else null (the practical split).
    this.airframeBreakM=null;
    this.owned=new Map();this.fade=true;this.updateFrustums();
    this.registerObject=object=>{
      const material=object.material;
      if(Array.isArray(material)){for(const item of material)this.setupMaterial(item);}
      else if(material)this.setupMaterial(material);
    };
    for(const light of this.lights){
      light.name='cinema-cascade';light.shadow.normalBias=.65;light.shadow.radius=1.4;
    }
  }
  setupMaterial(material){
    if(this.owned.has(material)||!(material.isMeshStandardMaterial||material.isMeshLambertMaterial||material.isMeshPhongMaterial||material.isMeshToonMaterial))return;
    const previous=material.onBeforeCompile,key=material.customProgramCacheKey;
    const defines={...material.defines};
    let binding=materialBindings.get(material);
    if(!binding){binding={uniforms:{CSM_cascades:{value:[]},cameraNear:{value:0},shadowFar:{value:0}},renderer:null};materialBindings.set(material,binding);}
    this._getExtendedBreaks(binding.uniforms.CSM_cascades.value);
    binding.uniforms.cameraNear.value=this.camera.near;binding.uniforms.shadowFar.value=Math.min(this.camera.far,this.maxFar);
    const properties=binding.renderer?.properties.get(material);
    if(properties?.uniforms){Object.assign(properties.uniforms,binding.uniforms);properties.uniformsList=null;}
    super.setupMaterial(material);
    const install=material.onBeforeCompile;
    material.onBeforeCompile=(shader,renderer)=>{
      previous.call(material,shader,renderer);install(shader);
      binding.renderer=renderer;Object.assign(shader.uniforms,binding.uniforms);
      for(const token of ['lights_pars_begin','lights_fragment_begin']){
        const anchor=`#include <${token}>`;
        if(!shader.fragmentShader.includes(anchor))throw Error(`Cinema shadow hook missing: ${token}`);
        shader.fragmentShader=shader.fragmentShader.replace(anchor,CSMShader[token]);
      }
    };
    material.customProgramCacheKey=()=>`${key.call(material)}|cinema-csm-${this.cascades}`;
    const onDispose=()=>{
      // A disposed material may be re-used after Suspense/StrictMode or an
      // aircraft swap. Removing only the registry entry leaves this wrapper
      // installed; re-adoption then applies CSM twice to the same shader.
      material.onBeforeCompile=previous;material.customProgramCacheKey=key;material.defines=defines;
      this.owned.delete(material);this.shaders.delete(material);material.removeEventListener('dispose',onDispose);
    };
    this.owned.set(material,{previous,key,defines,onDispose,binding});material.addEventListener('dispose',onDispose);
    material.needsUpdate=true;
  }
  _updateUniforms(){
    super._updateUniforms();
    for(const {binding} of this.owned?.values()??[]){
      this._getExtendedBreaks(binding.uniforms.CSM_cascades.value);
      binding.uniforms.cameraNear.value=this.camera.near;binding.uniforms.shadowFar.value=Math.min(this.camera.far,this.maxFar);
    }
  }
  /**
   * SHIP PASS LIGHT (AIRFRAME_SHADOW, LT-4): end cascade 0 at `breakM` view
   * metres (null restores the practical split). The breaks and cascade-0's
   * normal bias are uniforms: no program changes either way. With more than
   * one cascade only; a single cascade is the whole range already.
   */
  setAirframeFit(breakM,{normalBiasTexels=1.5,minNormalBias=.02,maxNormalBias=.65}={}){
    const want=this.cascades>1&&Number.isFinite(breakM)&&breakM>0?breakM:null;
    if(want===this.airframeBreakM)return false;
    this.airframeBreakM=want;
    if(want===null){this.mode='practical';this.customSplitsCallback=undefined;}
    else{this.mode='custom';this.customSplitsCallback=(n,near,far,target)=>airframeSplits(n,near,far,want,target);}
    this.updateFrustums();
    const light=this.lights[0],cam=light?.shadow?.camera;
    if(light)light.shadow.normalBias=want===null||!cam?.right?.65
      :airframeNormalBias((cam.right-cam.left)/this.shadowMapSize,{normalBiasTexels,minNormalBias,maxNormalBias});
    return true;
  }
  setMapSize(size){
    if(this.shadowMapSize===size)return;
    this.shadowMapSize=size;
    for(const light of this.lights){
      const shadow=light.shadow;
      shadow.mapSize.set(size,size);
      // Preserve lights, material hooks and their compiled CSM programs. A
      // resolution change needs new target storage, not a whole-scene rebind.
      shadow.map?.setSize(size,size);
      shadow.mapPass?.setSize(size,size);
      shadow.needsUpdate=true;
    }
  }
  dispose(){
    for(const [material,saved] of this.owned){
      material.onBeforeCompile=saved.previous;material.customProgramCacheKey=saved.key;
      material.defines=saved.defines;material.removeEventListener('dispose',saved.onDispose);material.needsUpdate=true;
    }
    this.owned.clear();this.shaders.clear();
    for(const light of this.lights)light.shadow.dispose();
    this.remove();
  }
}

/*
 * SHIP PASS LIGHT (FLY_SHIP_PASS.md 5.4). Pure helpers for the rig, gated by
 * scripts/verify-ship-light.mjs. Each reads its flag through ship-light.js
 * (ship-pass.js) and its device gate through deviceFeature().
 */

/**
 * The practical split, but with the first break pinned at `firstM` view
 * metres and the remaining cascades split practically over [firstM, far].
 * Breaks are fractions of `far`, ending at 1 (the CSM contract).
 */
export function airframeSplits(n,near,far,firstM,target=[]){
  target.length=0;
  if(n<=1||!(far>near)){target.push(1);return target;}
  const first=Math.min(far*.95,Math.max(near*2,firstM));
  target.push(first/far);
  const m=n-1;
  for(let i=1;i<m;i++){
    const uniform=first+(far-first)*i/m,log=first*(far/first)**(i/m);
    target.push((uniform+(log-uniform)*.5)/far);
  }
  target.push(1);
  return target;
}

/** Cascade-0 normal bias (scene units) in its own texels, clamped. */
export function airframeNormalBias(texel,{normalBiasTexels=1.5,minNormalBias=.02,maxNormalBias=.65}={}){
  if(!(texel>0))return maxNormalBias;
  return Math.min(maxNormalBias,Math.max(minNormalBias,texel*normalBiasTexels));
}

/**
 * Where cascade 0 should end for the player's airframe: the camera distance
 * plus fitPad x the airframe's half-length, clamped. null when the fit does
 * not apply (flag off, policy refuses, not a chase/photo view, no airframe).
 */
export function airframeShadowBreak({distM,lengthM,rangeM,cameraMode,cascades},config=lightBlock('AIRFRAME_SHADOW')){
  if(cascades<2||(cameraMode!=='chase'&&cameraMode!=='photo'))return null;
  if(!(distM>=0)||!(lengthM>0)||!(rangeM>0))return null;
  const b=distM+(config.fitPad??1.6)*lengthM*.5;
  return Math.min(rangeM*(config.maxFitFrac??.35),Math.max(config.minFitM??40,b));
}

/** Refit only when the wanted break moves past the hysteresis band. */
export function airframeRefit(current,wanted,refitFrac=.12){
  if(current===null||wanted===null)return current!==wanted;
  return Math.abs(wanted-current)>current*refitFrac;
}

/**
 * AIRFRAME_SHADOW (LT-4): the player receives the cascades on High/Ultra.
 * state: the fly store snapshot. Enhanced satellite only (the cascades exist
 * only there).
 */
export function airframeShadowOn(state){
  if(!shipPassOn('AIRFRAME_SHADOW')||!state)return false;
  if(state.mapStyle!=='satellite'||state.visuals!=='enhanced')return false;
  return lightActive('AIRFRAME_SHADOW',{tier:state.qualityTier,preset:state.qualityPreset});
}

/**
 * SHADOW_REACH (LT-5): on Medium desktops the cascade range follows AGL with
 * MOBILE_ENHANCED's rule and this block's tunables. Returns the config to
 * feed mobileShadowRange / stepMobileShadowRange, or null (off).
 */
export function shadowReachConfig(state){
  if(!shipPassOn('SHADOW_REACH')||!state)return null;
  if(state.mapStyle!=='satellite'||state.visuals!=='enhanced')return null;
  const policy=lightFeature('SHADOW_REACH',{tier:state.qualityTier,preset:state.qualityPreset});
  if(!policy.allowed)return null;
  const block=lightBlock('SHADOW_REACH');
  const cap=Number.isFinite(policy.budget?.maxRangeM)?Math.min(block.shadowMaxRangeM,policy.budget.maxRangeM):block.shadowMaxRangeM;
  return {...block,shadowMaxRangeM:cap};
}

/*
 * SHIP PASS LIGHT — PROVIDES requestShadowCasters() (FLY_SHIP_PASS.md 5.4):
 * the one door for a later stream to put its own objects into the cinema
 * cascades without editing CinemaShadowRig. A request is a named, bounded set
 * of Object3Ds; each frame the rig turns castShadow on for up to `max` of them
 * that are in the scene while the cascades exist, and off otherwise. Releasing
 * the request restores each object's own castShadow. No request (today: no
 * caller) = an empty map walked once per frame, nothing changes.
 *
 *   const release = requestShadowCasters('my-feature', [meshA, meshB], { max: 2 });
 *   ... release();
 *
 * Casters render through their own customDepthMaterial when they carry one
 * (bend-aware depth is the caller's job, as for the fleet, traffic-shadows.js).
 */
const casterRequests=new Map();
const CAST_PREV='shipCastPrev';
export function requestShadowCasters(key,objects,{max=8}={}){
  casterRequests.get(key)?.release();
  const entry={objects:[...(objects??[])].filter(Boolean),max:Math.max(0,max|0),armed:new Set()};
  entry.release=()=>{
    for(const o of entry.armed)restoreCast(o);
    entry.armed.clear();
    if(casterRequests.get(key)===entry)casterRequests.delete(key);
  };
  casterRequests.set(key,entry);
  return entry.release;
}
function restoreCast(o){
  if(o.userData[CAST_PREV]===undefined)return;
  o.castShadow=o.userData[CAST_PREV];
  delete o.userData[CAST_PREV];
}
/** CinemaShadowRig, every frame: `active` = the cascades exist. Returns the casters on. */
export function applyShadowCasterRequests(active){
  let on=0;
  for(const entry of casterRequests.values()){
    let n=0;
    for(const o of entry.objects){
      const cast=active&&n<entry.max&&!!o.parent;
      if(cast){
        n++;
        if(o.userData[CAST_PREV]===undefined)o.userData[CAST_PREV]=o.castShadow;
        o.castShadow=true;entry.armed.add(o);
      }else if(entry.armed.has(o)){restoreCast(o);entry.armed.delete(o);}
    }
    on+=n;
  }
  return on;
}
