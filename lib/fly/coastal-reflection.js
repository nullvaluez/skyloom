import { Color, HalfFloatType, LinearFilter, Matrix4, PerspectiveCamera, Vector3, WebGLRenderTarget } from 'three';
import { COASTAL_WATER_UNIFORMS as uniforms, clearCoastalReflection } from './coastal-water';

// 29 belongs to SkyOverlayPass. Sharing it silently captures airborne marks
// as city reflections and draws those marks a second time into the water.
export const COASTAL_REFLECTION_LAYER = 28;
const forward = new Vector3(), up = new Vector3();
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
    this.matrix = new Matrix4();
    this.color = new Color();
    this.target = null;
    this.stats = { active:false, captures:0, draws:0, width:0, height:0, bytes:0 };
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
    let waitingForShadows=false;
    scene.traverse(o=>{if(o.isLight&&o.castShadow&&o.shadow&&(!o.shadow.map||o.shadow.needsUpdate))waitingForShadows=true;});
    if(waitingForShadows){uniforms.uCoastReady.value=0;this.stats.active=false;this.stats.draws=0;return;}
    const changed=[], ranges=[], add=o=>{ if (!o.visible || (!o.isMesh&&!o.isLight)) return; changed.push([o,o.layers.mask]); };
    for(const group of groups) if(group.visible) group.traverse(add);
    // Do not allocate a target every frame while city chunks are still loading.
    if(!changed.some(([o])=>o.isMesh)){this.release();return;}
    const width = profile?.reflection?.[0] ?? (tier === 'high' ? 768 : 384), height = profile?.reflection?.[1] ?? width * 2 / 3;
    if (!this.target || this.target.width !== width || this.target.height!==height) {
      this.release();
      this.target = new WebGLRenderTarget(width,height,{type:HalfFloatType,minFilter:LinearFilter,magFilter:LinearFilter,depthBuffer:true,stencilBuffer:false});
      this.target.texture.name='coastal-city-reflection';
      this.stats.width=width;this.stats.height=height;this.stats.bytes=width*height*12;
      uniforms.uCoastTexel.value.set(1/width,1/height);
    }
    scene.updateMatrixWorld();
    mirrorCoastalCamera(camera,this.camera,this.matrix);
    // Lighting is shared with the main scene. The reflection layer selects
    // geometry only; it does not turn an unlit city into a luminous painting.
    scene.traverse(o=>{if(o.isLight)add(o);});
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
      renderer.clear();
      const callsBefore=renderer.info.autoReset===false?renderer.info.render.calls:0;
      renderer.render(scene,this.camera);
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
    this.target?.dispose();this.target=null;clearCoastalReflection();
    this.stats.active=false;this.stats.width=this.stats.height=this.stats.bytes=this.stats.draws=0;
  }
  dispose(){this.release();}
}
