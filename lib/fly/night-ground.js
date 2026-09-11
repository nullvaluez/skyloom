import {
  AddEquation, BufferAttribute, Color, CustomBlending, InstancedBufferAttribute,
  InstancedBufferGeometry, LinearFilter, MaxEquation, Mesh, NoColorSpace, OneFactor,
  OrthographicCamera, RGBAFormat, Scene, ShaderMaterial, UnsignedByteType, Vector2,
  WebGLRenderTarget,
} from 'three';
import { nearGroundOn } from './near-ground';
import { GROUND_LIGHTING } from './night-lighting-policy';

/** Two independently positioned histories: motion never drags a texture over the world. */
export const nightGroundUniforms = {
  uNGMap: { value: null }, uNGPreviousMap: { value: null },
  uNGOrigin: { value: new Vector2() }, uNGPreviousOrigin: { value: new Vector2() },
  uNGInvSpan: { value: 0 }, uNGPreviousInvSpan: { value: 0 },
  uNGHeightBase: { value: 0 }, uNGPreviousHeightBase: { value: 0 },
  uNGHeightRange: { value: GROUND_LIGHTING.heightRangeM },
  uNGBlend: { value: 1 }, uNGGain: { value: 0 }, uNGNight: { value: 0 },
};
export const nightGroundOn = () => nearGroundOn('lighting');

/** Capture unbent world position at begin_vertex, before any project_vertex bend.
 * The extra light is restricted to ground material types and source elevation;
 * no light, environment, exposure, sky or cloud state is modified.
 */
export function patchNightGroundShader(shader, { weight = '1.0', heightM = 5, coolFill = 0.018 } = {}) {
  if (shader.__groundLightPatched) return;
  shader.__groundLightPatched = true;
  Object.assign(shader.uniforms, nightGroundUniforms);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vNightGroundWorld;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
vec4 ngLightWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
ngLightWorld = instanceMatrix * ngLightWorld;
#endif
vNightGroundWorld = (modelMatrix * ngLightWorld).xyz;`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vNightGroundWorld;
uniform sampler2D uNGMap, uNGPreviousMap;
uniform vec2 uNGOrigin, uNGPreviousOrigin;
uniform float uNGInvSpan, uNGPreviousInvSpan, uNGHeightBase, uNGPreviousHeightBase;
uniform float uNGHeightRange, uNGBlend, uNGGain, uNGNight;
vec3 groundIrradiance(sampler2D image, vec2 center, float invSpan, float baseY) {
  vec2 uv = (vNightGroundWorld.xz - center) * invSpan + 0.5;
  if (invSpan <= 0.0 || any(lessThan(uv,vec2(0.0))) || any(greaterThan(uv,vec2(1.0)))) return vec3(0.0);
  vec4 data = texture2D(image, uv);
  float sourceY = baseY + data.a * uNGHeightRange;
  float heightK = 1.0 - smoothstep(1.5, ${(Math.max(1, heightM) + 1.5).toFixed(3)}, abs(vNightGroundWorld.y-sourceY));
  float edgeK = 1.0-smoothstep(0.37,0.49,max(abs(uv.x-0.5),abs(uv.y-0.5)));
  return data.rgb * heightK * edgeK;
}`).replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
if (uNGNight > 0.0) {
  vec3 ngLight = vec3(0.0);
  if (uNGGain > 0.0) {
    ngLight = mix(groundIrradiance(uNGPreviousMap,uNGPreviousOrigin,uNGPreviousInvSpan,uNGPreviousHeightBase),
      groundIrradiance(uNGMap,uNGOrigin,uNGInvSpan,uNGHeightBase),uNGBlend) * uNGGain;
  }
  // Cool ground-only bounce preserves distant terrain/sky exposure. Urban
  // low-frequency bloom comes from overlapping physical pools, not a sky lobe.
  reflectedLight.indirectDiffuse += (ngLight + vec3(0.52,0.66,1.0)*${Math.max(0, coolFill).toFixed(4)}) * diffuseColor.rgb * uNGNight * (${weight});
}`);
}
export function applyNightGroundReceiver(material, kind = 'ground', options) {
  if (!nightGroundOn() || material.userData.groundLightReceiver) return material;
  material.userData.groundLightReceiver = kind;
  const prev = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => { prev?.(shader, renderer); patchNightGroundShader(shader, options); };
  material.customProgramCacheKey = () => `${key}|ground-light-v2-${kind}`;
  return material;
}

/** RGB adds irradiance; alpha keeps the HIGHEST source surface elevation.
 * Max alpha is intentional: additive/weighted height loses tens of metres of
 * precision at dim RGBA8 values. Where a bridge overlaps a lower road we
 * conservatively reject the lower receiver rather than shine through a deck.
 * Filtered analytical Gaussian splats need no fullscreen blur draws.
 */
export function createNightGroundSplatMaterial() {
  const m = new ShaderMaterial({ depthTest:false, depthWrite:false, transparent:true,
    blending:CustomBlending, blendEquation:AddEquation, blendSrc:OneFactor, blendDst:OneFactor,
    blendEquationAlpha:MaxEquation, blendSrcAlpha:OneFactor, blendDstAlpha:OneFactor, toneMapped:false,
    uniforms:{ uInvSpan:{value:1}, uBaseY:{value:0}, uRangeY:{value:GROUND_LIGHTING.heightRangeM} },
    vertexShader:`attribute vec4 aPool; attribute vec4 aLight;
uniform float uInvSpan, uBaseY, uRangeY;
varying vec2 vPool; varying vec3 vLight; varying float vHeight;
void main(){ vPool=position.xy; vLight=aLight.rgb; vHeight=(aLight.a-uBaseY)/uRangeY;
gl_Position=vec4((aPool.xy+position.xy*aPool.z)*uInvSpan*2.0,0.0,1.0); }`,
    fragmentShader:`varying vec2 vPool; varying vec3 vLight; varying float vHeight;
void main(){ float d=dot(vPool,vPool); if(d>=1.0) discard;
float a=exp(-d*3.5)*(1.0-smoothstep(0.55,1.0,d));
gl_FragColor=vec4(vLight*a,clamp(vHeight,0.003922,1.0)); }`,
  });
  m.customProgramCacheKey = () => 'ground-light-splat-v2';
  return m;
}
export function createNightGroundTarget(size, pool) {
  const opts = {format:RGBAFormat,type:UnsignedByteType,minFilter:LinearFilter,magFilter:LinearFilter,depthBuffer:false,stencilBuffer:false};
  const targets=[new WebGLRenderTarget(size,size,opts),new WebGLRenderTarget(size,size,opts)];
  targets.forEach((t,i)=>{t.texture.colorSpace=NoColorSpace;t.texture.name=`ground-light-${i}`;t.texture.generateMipmaps=false;});
  const geometry=new InstancedBufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,1,0]),3));
  geometry.setIndex([0,1,2,0,2,3]);
  geometry.setAttribute('aPool',new InstancedBufferAttribute(new Float32Array(pool*4),4));
  geometry.setAttribute('aLight',new InstancedBufferAttribute(new Float32Array(pool*4),4));
  geometry.instanceCount=0;
  const material=createNightGroundSplatMaterial(), mesh=new Mesh(geometry,material), scene=new Scene();
  mesh.frustumCulled=false;scene.add(mesh);
  const camera=new OrthographicCamera(-1,1,1,-1,0,1), savedColor=new Color();
  let current=0;
  const frames=[null,null];
  return {
    size,pool,targets,frames,bytes:size*size*8,
    get current(){return current;},
    warm(gl){gl.compile(scene,camera);},
    render(gl,sources,center,span,baseY){
      const dst=1-current, a=geometry.attributes.aPool, b=geometry.attributes.aLight;
      let n=0;
      for(const p of sources){
        if(n===pool)break;
        if(p.y<baseY+1 || p.y>baseY+GROUND_LIGHTING.heightRangeM-1)continue;
        a.setXYZW(n,p.x-center[0],p.z-center[1],p.r,0);
        b.setXYZW(n,p.color[0]*p.gain,p.color[1]*p.gain,p.color[2]*p.gain,p.y);n++;
      }
      geometry.instanceCount=n;a.needsUpdate=b.needsUpdate=true;
      material.uniforms.uInvSpan.value=1/span;material.uniforms.uBaseY.value=baseY;
      const old={target:gl.getRenderTarget(),auto:gl.autoClear,alpha:gl.getClearAlpha(),xr:gl.xr.enabled,shadow:gl.shadowMap.autoUpdate,needs:gl.shadowMap.needsUpdate};
      gl.getClearColor(savedColor);
      try{
        gl.xr.enabled=false;gl.shadowMap.autoUpdate=false;gl.shadowMap.needsUpdate=false;
        gl.autoClear=true;gl.setClearColor(0,0);gl.setRenderTarget(targets[dst]);gl.clear();
        // Empty updates clear the next history, allowing old pools to fade away.
        if(n>0)gl.render(scene,camera);
      }finally{
        gl.setRenderTarget(old.target);gl.setClearColor(savedColor,old.alpha);gl.autoClear=old.auto;
        gl.xr.enabled=old.xr;gl.shadowMap.autoUpdate=old.shadow;gl.shadowMap.needsUpdate=old.needs;
      }
      frames[dst]={x:center[0],z:center[1],span,baseY,count:n};current=dst;
      return n;
    },
    dispose(){targets.forEach(t=>t.dispose());geometry.dispose();material.dispose();},
  };
}

/** Keep renderer globals owned by one rig; also used by lifecycle unit gates. */
export function clearNightGroundUniforms(){
  nightGroundUniforms.uNGGain.value=nightGroundUniforms.uNGNight.value=0;
  nightGroundUniforms.uNGInvSpan.value=nightGroundUniforms.uNGPreviousInvSpan.value=0;
  nightGroundUniforms.uNGMap.value=nightGroundUniforms.uNGPreviousMap.value=null;
}
export function publishGroundLighting(runtime,state){runtime.groundLighting=state;}
export function removeGroundLighting(runtime,state){if(runtime.groundLighting===state)runtime.groundLighting=null;}
