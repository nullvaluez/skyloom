import { Pass } from 'postprocessing';
import { DoubleSide, Scene } from 'three';
import { SKY_OVERLAYS } from '@/lib/fly/fly-constants';
import { clearOverlayGate, setOverlayGate } from '@/lib/fly/overlay-gate';

/**
 * SKY OVERLAYS — depth-less airborne marks drawn AFTER the cloud composite.
 *
 * The immersive cloud composite (lib/fly/immersive-cloud-pass.js) treats every
 * pixel whose scene depth was never written as SKY and replaces it with the
 * analytic sky: `scene = mix(scene, sky, day)`. That is what removes the
 * photographed HDRI cloud silhouettes by day — and it also removed, exactly,
 * everything transparent that sits against the sky: traffic tracers, far
 * traffic billboards, engine plumes and the player's own contrail (all
 * depthWrite:false). mix(x, y, 1) = y, so a sky-backed trail contributed 0 at
 * any sun above ~16°, and the pass runs before bloom, so nothing glowed back.
 * The same actors over terrain were hazed by the distance of the terrain
 * BEHIND them (the aerial pass reads the only depth there is).
 *
 * Fix: overlays registered here move to their own render layer while the
 * cloud pass is in the chain, so the main RenderPass skips them, and
 * SkyOverlayPass draws them into the composited buffer right after the clouds
 * and before bloom. The composer re-attaches the real scene depth texture to
 * every pass's input buffer (postprocessing EffectComposer.render), so the
 * hardware depth test against terrain, hulls and buildings still works. Draw
 * totals are unchanged (the same draws move between passes; gl.info is
 * accumulated per frame), and nothing else in the frame is touched.
 *
 * Deliberate consequences, all of them for depth-less marks only:
 *  - no aerial haze, no cloud shadow and no Enhanced pre-curve exposure on
 *    them (the trails carry their own day haze and range fade, authored in
 *    this buffer's units);
 *  - clouds IN FRONT of an overlay are restored analytically by the overlay
 *    cloud gate (lib/fly/overlay-gate.js), armed from this frame's cloud march
 *    for this draw only: lines are fully occluded, point marks keep a floor.
 *
 * Toy (Neon) never mounts the cloud pass, so nothing is deferred there and
 * every overlay stays on layer 0 — the pre-existing frame.
 *
 * Three traps this file handles (recorded so nobody "simplifies" them away):
 *  1. autoClear. FlyEffectComposer runs composer.render with gl.autoClear on,
 *     and three clears inside background.render even with a null background —
 *     that would wipe the frame AND the scene depth. Forced off for the draw.
 *  2. Light-state thrash. Re-rendering the MAIN scene with a layer mask flips
 *     its shared WebGLRenderState light hash every frame, which makes every
 *     lit material re-resolve its program. So a small holder Scene BORROWS the
 *     overlay objects by reference (children array, never add(): parents and
 *     R3F ownership stay untouched).
 *  3. Program keys. three keys even MeshBasicMaterial programs on the scene's
 *     light counts, and the lightless holder differs from the lit scene the
 *     prewarm compiles against. Each overlay is compiled once against the
 *     holder the first time the pass sees it (normally during boot, before the
 *     reveal), including overlays that are not visible yet.
 *
 * Borrowing bypasses PARENT visibility (three never looks at a borrowed
 * object's real ancestors), so the fill walks the ancestor chain itself —
 * that is what keeps the harness park handles (`__flyTracers`,
 * `__flyTraffic`: `.visible = false` on a root) hiding what they always hid.
 */
export const SKY_OVERLAY_LAYER = 29;

const overlays = new Set();
let deferred = false;

function place(object) {
  const layer = deferred ? SKY_OVERLAY_LAYER : 0;
  object.traverse((o) => o.layers.set(layer));
}

/**
 * Register a depth-less airborne mark (and its subtree). Returns the
 * unregister function — call it from the same effect's cleanup.
 */
export function registerSkyOverlay(object) {
  if (!object) return () => {};
  overlays.add(object);
  place(object);
  return () => {
    overlays.delete(object);
    object.traverse((o) => o.layers.set(0));
  };
}

/** Effects.jsx flips this in the same commit that adds/removes the pass. */
export function setSkyOverlayDeferred(on) {
  const next = !!on;
  if (next === deferred) return;
  deferred = next;
  for (const o of overlays) place(o);
}

export function skyOverlaysDeferred() {
  return deferred;
}

/** Visible all the way up, and actually mounted under `scene`. */
function shownIn(object, scene) {
  for (let p = object; ; p = p.parent) {
    if (!p.visible) return false;
    if (!p.parent) return p === scene;
  }
}

function mountedIn(object, scene) {
  let p = object;
  while (p.parent) p = p.parent;
  return p === scene;
}

function overlayFeatures(object){
  const a=object.geometry.attributes;
  return (!!a.position)|((!!a.normal)<<1)|((!!a.tangent)<<2)|((a.color?.itemSize===4)<<3)|
    ((!!a.uv)<<4)|((!!object.isInstancedMesh)<<5)|((!!object.instanceColor)<<6)|((!!object.morphTexture)<<7)|
    ((!!object.isSkinnedMesh)<<8)|((!!object.isBatchedMesh)<<9)|((!!object._colorsTexture)<<10)|((!!object.receiveShadow)<<11);
}
const overlayMaterials=object=>Array.isArray(object.material)?object.material:object.material?[object.material]:[];
function overlayChanged(record,root){
  let dirty=false,count=0;const epoch=++record.epoch;
  root.traverse(object=>{
    if(!object.geometry||!object.material)return;
    count++;
    const geometry=object.geometry,morph=geometry.morphAttributes,flags=overlayFeatures(object),saved=record.objects.get(object);
    const multiple=Array.isArray(object.material),materialCount=multiple?object.material.length:1;
    let matches=!!saved&&saved.geometry===geometry&&saved.flags===flags&&saved.position===(morph.position?.length??-1)&&
      saved.normal===(morph.normal?.length??-1)&&saved.color===(morph.color?.length??-1)&&saved.materials.length===materialCount;
    if(matches)for(let i=0;i<materialCount;i++){
      const m=multiple?object.material[i]:object.material,s=saved.materials[i];
      if(s.material!==m||s.version!==m.version||s.side!==m.side||s.transparent!==m.transparent||s.single!==m.forceSinglePass||
        s.map!==m.map||s.alphaMap!==m.alphaMap||s.envMap!==m.envMap){matches=false;break;}
    }
    if(matches)saved.seen=epoch;
    else{
      dirty=true;record.objects.set(object,{geometry,flags,position:morph.position?.length??-1,normal:morph.normal?.length??-1,
        color:morph.color?.length??-1,seen:epoch,materials:overlayMaterials(object).map(material=>({material,version:material.version,
        side:material.side,transparent:material.transparent,single:material.forceSinglePass,map:material.map,alphaMap:material.alphaMap,envMap:material.envMap}))});
    }
  });
  if(record.objects.size!==count)for(const[object,saved]of record.objects)if(saved.seen!==epoch){record.objects.delete(object);dirty=true;}
  if(dirty){
    record.drawVersions.clear();
    for(const saved of record.objects.values())for(const m of saved.materials)if(m.transparent&&m.side===DoubleSide&&!m.single)record.drawVersions.add(m);
  }
  return dirty;
}

/** SKY_OVERLAYS.cloudGate, and the dev A/B pin `__flyOverlayGatePin = false` (its ONE reader). */
export function overlayCloudGateOn() {
  if (!SKY_OVERLAYS.cloudGate.enabled) return false;
  return !(process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && window.__flyOverlayGatePin === false);
}

export class SkyOverlayPass extends Pass {
  constructor(scene, camera, clouds = null) {
    super('SkyOverlayPass');
    // NOT `mainScene`/`mainCamera`: postprocessing's Pass defines those as
    // write-only setters (the composer pushes its own scene/camera through
    // them), so a read returns undefined.
    this.flyScene = scene;
    this.flightCamera = camera;
    this.clouds = clouds; // the ImmersiveCloudPass whose march feeds the cloud gate
    // Draw INTO the composited buffer; the next pass (bloom) reads it.
    this.needsSwap = false;
    // The composer only attaches scene depth when some pass asks for it. The
    // cloud pass always does, but this pass is wrong without it, so it asks too.
    this.needsDepthTexture = true;
    this.holder = new Scene();
    this.holder.matrixWorldAutoUpdate = false; // the main render already did it
    this.records=new Map();this.pending=new Set();this.ready=new WeakSet();this.programKeys=new Set();
    this.programWarm={required:false,status:'waiting',pending:0,held:0,failed:0,error:null,programKeys:[]};
    this.stats = { drawn: 0, compiled: 0, gate: false,programWarm:this.programWarm };
    this.warmLost=()=>{this.resetWarm();this.contextLost=true;this.stats.drawn=0;};
    this.warmRestored=()=>{this.resetWarm();this.contextLost=false;};
  }

  resetWarm(){
    this.records.clear();this.pending.clear();this.ready=new WeakSet();this.programKeys.clear();this.warmKey=null;
    Object.assign(this.programWarm,{status:'waiting',pending:0,held:0,failed:0,error:null,programKeys:[]});
  }

  bindWarm(renderer){
    if(this.warmRenderer===renderer)return;
    this.detachWarm();this.resetWarm();this.warmRenderer=renderer;
    renderer.domElement?.addEventListener('webglcontextlost',this.warmLost);
    renderer.domElement?.addEventListener('webglcontextrestored',this.warmRestored);
  }

  detachWarm(){
    this.warmRenderer?.domElement?.removeEventListener('webglcontextlost',this.warmLost);
    this.warmRenderer?.domElement?.removeEventListener('webglcontextrestored',this.warmRestored);
    this.warmRenderer=null;this.contextLost=false;
  }

  render(renderer, inputBuffer) {
    const holder = this.holder;
    const cam = this.flightCamera;
    const scene = this.flyScene;
    const kids = holder.children;
    kids.length = 0;
    this.bindWarm(renderer);
    if(this.contextLost||renderer.getContext?.().isContextLost())return;
    const autoClear = renderer.autoClear;
    const shadowAuto = renderer.shadowMap.autoUpdate;
    const mask = cam.layers.mask;
    const target=renderer.getRenderTarget();
    try{
      renderer.autoClear = false;
      renderer.shadowMap.autoUpdate = false;
      cam.layers.set(SKY_OVERLAY_LAYER);
      renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer);
      holder.fog = scene.fog;
      const state=this.programWarm;
      state.required=!!renderer.extensions?.has?.('KHR_parallel_shader_compile');
      const key=[!!holder.fog,!!holder.fog?.isFogExp2,this.renderToScreen,renderer.outputColorSpace,renderer.toneMapping,
        renderer.shadowMap.enabled,renderer.shadowMap.type].join('/');
      const rekey=key!==this.warmKey;this.warmKey=key;
      for(const[o]of this.records)if(!overlays.has(o)||!mountedIn(o,scene))this.records.delete(o);
      for(const o of overlays){
        if(!mountedIn(o,scene))continue;
        let record=this.records.get(o);
        if(!record){record={objects:new Map(),programs:new Set(),drawVersions:new Set(),epoch:0};this.records.set(o,record);}
        const changed=overlayChanged(record,o);
        if(rekey||changed){
          record.failed=false;record.programs.clear();
          try{
            const materials=renderer.compile(o,cam,holder);this.stats.compiled++;
            if(state.required)for(const material of materials){
              const props=renderer.properties.get(material);
              for(const program of props.programs?.values?.()??[props.currentProgram]){
                if(!program)throw Error('Sky overlay preparation produced no program');
                record.programs.add(program);this.programKeys.add(program.cacheKey);
                if(!this.ready.has(program))this.pending.add(program);
              }
            }
          }catch(error){record.failed=true;state.error=String(error?.message??error);}
          // compile itself bumps transparent DoubleSide versions.
          for(const saved of record.objects.values())for(const m of saved.materials)m.version=m.material.version;
          state.programKeys=[...this.programKeys];
        }
      }
      for(const program of this.pending){
        try{if(program.usedTimes===0||program.isReady()){this.pending.delete(program);this.ready.add(program);}}
        catch(error){
          this.pending.delete(program);state.error=String(error?.message??error);
          for(const record of this.records.values())if(record.programs.has(program))record.failed=true;
        }
      }
      let held=0,failed=0;
      for(const[o,record]of this.records){
        let ready=true;
        if(record.failed)failed++;
        if(!record.failed)for(const program of record.programs)if(program.usedTimes!==0&&!this.ready.has(program)){ready=false;break;}
        if(!ready){held++;continue;}
        if(shownIn(o,scene))kids.push(o);
      }
      state.pending=this.pending.size;state.held=held;state.failed=failed;
      state.status=held?'compiling':failed?'failed':state.required?'ready':'unsupported';
      this.stats.drawn = kids.length;
      const gate = !!this.clouds && overlayCloudGateOn();
      this.stats.gate = gate;
      if (gate) setOverlayGate(this.clouds, inputBuffer.width, inputBuffer.height);
      if (kids.length) renderer.render(holder, cam);
      // These objects live on layer29, so only this draw performs Three's
      // transparent side-version bumps; acknowledge them after the draw.
      for(const o of kids)for(const m of this.records.get(o).drawVersions)m.version=m.material.version;
    }finally{
      clearOverlayGate(); // identity for every other draw, including failures
      kids.length = 0;
      holder.fog = null;
      cam.layers.mask = mask;
      renderer.setRenderTarget(target);
      renderer.autoClear = autoClear;
      renderer.shadowMap.autoUpdate = shadowAuto;
    }
    if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
      (window.__flyStats ??= {}).skyOverlays = { ...this.stats, registered: overlays.size };
    }
  }

  dispose(){this.detachWarm();this.resetWarm();this.programWarm.status='disposed';this.stats.drawn=0;super.dispose();}
}
