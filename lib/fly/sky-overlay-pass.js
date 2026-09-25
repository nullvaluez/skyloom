import { Pass } from 'postprocessing';
import { Scene } from 'three';
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
    this.compiled = new WeakSet();
    this.stats = { drawn: 0, compiled: 0, gate: false };
  }

  render(renderer, inputBuffer) {
    const holder = this.holder;
    const cam = this.flightCamera;
    const scene = this.flyScene;
    const kids = holder.children;
    kids.length = 0;
    const autoClear = renderer.autoClear;
    const shadowAuto = renderer.shadowMap.autoUpdate;
    const mask = cam.layers.mask;
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    cam.layers.set(SKY_OVERLAY_LAYER);
    renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer);
    holder.fog = scene.fog;
    for (const o of overlays) {
      // Compile with the target bound, so tone-mapping/colour-space keys match
      // the draw; invisible overlays too, so their first appearance is free.
      if (!this.compiled.has(o) && mountedIn(o, scene)) {
        renderer.compile(o, cam, holder);
        this.compiled.add(o);
        this.stats.compiled += 1;
      }
      if (shownIn(o, scene)) kids.push(o);
    }
    this.stats.drawn = kids.length;
    const gate = !!this.clouds && overlayCloudGateOn();
    this.stats.gate = gate;
    if (gate) setOverlayGate(this.clouds, inputBuffer.width, inputBuffer.height);
    if (kids.length) renderer.render(holder, cam);
    clearOverlayGate(); // identity for every other draw in the frame
    kids.length = 0;
    holder.fog = null;
    cam.layers.mask = mask;
    renderer.autoClear = autoClear;
    renderer.shadowMap.autoUpdate = shadowAuto;
    if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
      (window.__flyStats ??= {}).skyOverlays = { ...this.stats, registered: overlays.size };
    }
  }
}
