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

/**
 * Master arm.
 *
 * ── W3 FIX: AN UN-PIN MUST BE ABLE TO ARM A BUILT-BUT-OFF BLOCK ──────────
 * The other four R22 blocks ship `enabled: true`, so E's shared un-pin idiom
 * (`addInitScript(unpinPins, ['__flyXPin'])`, which replaces the global with a
 * getter that reads `__r22Unpinned` and swallows _boot's write into
 * `__r22PinAttempt`) is enough for them: remove the pin, the constant carries
 * the rest. DEPTH_PASS is the ONE block that ships `enabled: false` — built-
 * but-off pending user checkpoint #3 — so removing the pin left it falling
 * through to a false constant and verify-depth2 censused an unarmed world:
 * 0 of 167 terrain meshes receiving, with no error anywhere to say why. The
 * pin-shaped contract I handed E could only be satisfied by
 * `__flyN8AO.set()`, which the harness calls much later and only for the AO
 * A/B leg.
 *
 * So the un-pin ITSELF now arms this block. `__r22PinAttempt.__flyDepthPin`
 * exists if and only if two things both happened: a gate installed the un-pin
 * accessor, AND scripts/_boot.js then tried to write the pin through it. Both
 * are harness-only — a real session runs no `_boot.js` and defines no
 * `__r22PinAttempt` — so this can never arm on a user's machine, which is what
 * "built-but-off pending a checkpoint" has to keep meaning.
 *
 * Precedence, highest first:
 *   1. `__flyDepthArm` 1/0 — the explicit A/B lever (capture scripts,
 *      `__flyN8AO.set()`, `__flyCatcher.set()`).
 *   2. `__r22Unpinned.__flyDepthPin === 1` — a gate re-pinning mid-run, which
 *      is exactly the "drive the flag from the page" contract _boot documents.
 *   3. the un-pin marker above — armed.
 *   4. `__flyDepthPin === 1` — fleet pin intact, legacy world.
 *   5. the shipped constant.
 */
export function depthPassOn() {
  if (typeof window !== 'undefined') {
    const arm = window.__flyDepthArm;
    if (arm === 1) return true;
    if (arm === 0) return false;
    if (window.__r22Unpinned?.__flyDepthPin === 1) return false;
    const attempt = window.__r22PinAttempt;
    if (attempt && Object.prototype.hasOwnProperty.call(attempt, '__flyDepthPin')) return true;
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
