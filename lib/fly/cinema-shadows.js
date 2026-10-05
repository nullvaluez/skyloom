import { CSM } from 'three/addons/csm/CSM.js';
import { CSMShader } from 'three/addons/csm/CSMShader.js';
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
