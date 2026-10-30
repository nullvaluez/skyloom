/**
 * SHIP PASS FRAME (FR-13; a DEVICE_POLICY sub-switch) — the dynamic near
 * plane, for renderers WITHOUT reversed depth.
 *
 * WHY. The camera spans 2.5 m to 600 km (CANVAS). With reversed depth
 * (`gl.capabilities.reversedDepthBuffer`, EXT_clip_control) a float depth
 * buffer holds that range comfortably; without it, a 24-bit buffer z-fights
 * on a runway seen from 2 km (D-09). Safari's support is unknown until the
 * owner's iPhone report (W0.6 `gpu.reversedDepth`), so the fallback is built
 * and gated on the RUNTIME capability: it runs only where the renderer
 * reports no reversed depth, and only with DEVICE_POLICY on
 * (`DEVICE_POLICY.dynamicNear`). Every renderer that has reversed depth —
 * the RTX 5080, desktop Chrome — never runs it, so desktop is byte-identical
 * whatever the flags say.
 *
 * near = clamp(k · AGL, minM, maxM), k = 0.02, 2.5 m … 60 m
 * (lib/fly/device-policy.js DYNAMIC_NEAR budget). Written only when it moves
 * by more than 5 %, so the projection is not rebuilt every frame. The airport
 * lounge owns the camera's near plane while it is open (it sets and restores
 * its own), so the lounge is skipped.
 */
import { shipPassBlock, shipPassOn } from './ship-pass';
import { deviceFeature } from './device-policy';

/** The near plane for an AGL (pure). */
export function dynamicNearFor(aglM, budget = { k: 0.02, minM: 2.5, maxM: 60 }) {
  const agl = Number.isFinite(aglM) ? Math.max(0, aglM) : 0;
  return Math.min(budget.maxM, Math.max(budget.minM, budget.k * agl));
}

/**
 * Is the fallback live on this renderer? Pure when every argument is passed
 * (the node gate). Resolved once per renderer by the FlyScene caller.
 */
export function dynamicNearBudget({ reversedDepth, flagOn = shipPassOn('DEVICE_POLICY'), sub = shipPassBlock('DEVICE_POLICY')?.dynamicNear !== false, cls } = {}) {
  if (!flagOn || !sub || reversedDepth !== false) return null;
  const f = deviceFeature('DYNAMIC_NEAR', { reversedDepth, ...(cls ? { cls } : {}) });
  return f.allowed ? f.budget : null;
}

const resolved = new WeakMap();

/**
 * Apply from FlyScene's SHIP PASS FRAME frame block. A no-op (one WeakMap
 * read) unless the renderer has no reversed depth and the switch is on.
 */
export function applyDynamicNear(gl, camera, aglM, inLounge) {
  if (!gl || !camera) return false;
  let budget = resolved.get(gl);
  if (budget === undefined) {
    budget = dynamicNearBudget({ reversedDepth: gl.capabilities?.reversedDepthBuffer === true });
    resolved.set(gl, budget);
  }
  if (!budget || inLounge) return false;
  const near = dynamicNearFor(aglM, budget);
  if (Math.abs(camera.near - near) <= 0.05 * near) return false;
  camera.near = near;
  camera.updateProjectionMatrix();
  return true;
}
