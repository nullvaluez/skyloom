/**
 * ROUND 22 (D "DEPTH") — the ONE gate every DEPTH_PASS consumer reads.
 *
 * Four files ask "is the depth pass armed?" (Effects.jsx for N8AO, FlyScene's
 * rig region for the catcher / receive set / caster flips, AerialPerspective
 * for the near band, N8AO.jsx for its own stats), and the answer has three
 * inputs that must never disagree between them:
 *
 *   1. `DEPTH_PASS.enabled` — the shipped default. FALSE for R22: everything
 *      here is built-but-off pending user checkpoint #3 (plan §9.3).
 *   2. `window.__flyDepthPin === 1` — the fleet pin. scripts/_boot.js writes it
 *      on BOTH legs, so all 30-odd existing harnesses see legacy behavior no
 *      matter what the constant says. This is the R19 `__flySatShadowOverride`
 *      idiom: the pin is how a whole new visual subsystem lands without
 *      re-baselining a single frozen pixel gate.
 *   3. `window.__flyDepthArm` — the un-pinner, and the ONLY way an A/B gets
 *      both legs in one session. 1 = force on (beats the pin), 0 = force off
 *      (beats the constant). E's verify-depth2 owns it; the capture scripts in
 *      scripts/r22-d-*.js use it for every measured pair in the D report.
 *
 * Read live, never cached: an A/B leg flips it between two page.evaluate calls
 * and the very next frame has to obey.
 */
import { DEPTH_PASS } from './fly-constants';

/** Master arm. */
export function depthPassOn() {
  if (typeof window !== 'undefined') {
    const arm = window.__flyDepthArm;
    if (arm === 1) return true;
    if (arm === 0) return false;
    if (window.__flyDepthPin === 1) return false;
  }
  return DEPTH_PASS.enabled === true;
}

/**
 * Sub-flag arm. `key` is a DEPTH_PASS sub-block name ('catcher' |
 * 'nearReceive' | 'n8ao' | 'aerialNear'); each carries its own `enabled` so a
 * checkpoint can land three of the four.
 */
export function depthSubOn(key) {
  if (!depthPassOn()) return false;
  // Per-feature override. The four sub-features have INDEPENDENT costs and the
  // §7 protocol grades them independently (N8AO by gpuFrameMs, the receive set
  // by gpuFrameMs, the catcher by draws, the near band by pixels), so a single
  // master arm cannot produce the four A/B pairs the report needs. Same
  // precedence as the master: an explicit 0/1 wins over the constant.
  if (typeof window !== 'undefined') {
    const sub = window.__flyDepthSub?.[key];
    if (sub === 1) return true;
    if (sub === 0) return false;
  }
  return DEPTH_PASS[key]?.enabled === true;
}

/**
 * Caster-kind arm for the C CLUTTER seam. C ships every clutter mesh
 * `castShadow:false`; D flips them per kind with its own gpuFrameMs number, so
 * a kind that does not pay for itself can be dropped without touching C's code.
 */
export function depthCasterOn(kind) {
  if (!depthPassOn()) return false;
  if (typeof window !== 'undefined') {
    const c = window.__flyDepthCasters?.[kind];
    if (c === 1) return true;
    if (c === 0) return false;
  }
  return DEPTH_PASS.casters?.[kind] === true;
}
