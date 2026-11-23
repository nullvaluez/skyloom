/**
 * WORLD PASS E (GROUND): the arrival hold.
 *
 * Measured with WORLD_GROUND on (scripts/world-pass-budget.cjs, before this
 * hold): the building ring arrived later than with the flag off (Powell first
 * tile 40 s against 15.6 s, full ring 76 s against 57 s), while the settled
 * scene was identical in both arms. The canopy's extra work (photo looks, the
 * exact per-crown ground samples, the in-place re-grids, the wider ring) and
 * the bridge rebuilds all compete with the arrival for the main thread and the
 * network. Ground detail is the last thing a player needs on arrival, so it
 * waits:
 *   - while the scene says the world is loading (`runtime.worldLoading`), and
 *   - while the satellite building ring is armed and has not yet resolved
 *     every desired tile after an arm or warp (B's W0 arrival clock,
 *     `_wp.fullRingSec` on the building engine, read only), for at most
 *     `maxHoldSec` after the hold began, so a ring that never completes can
 *     never starve the ground. Flying away from the arrival point also ends
 *     the hold for that arm, even when the moving ring never fully settles.
 * Read only by the WORLD_GROUND layers, which mount only with the flag on.
 */

import { oneRevealOn } from './one-reveal.js';

const MAX_HOLD_SEC = 75;
// ONE REVEAL (gate): the curtain waits for the final picture, so ground
// detail is part of what it reveals. Under the curtain, once the local
// terrain, surfaces and near buildings are in, it builds (after them, not
// against them), and this arm's arrival hold is over.
const REVEAL_GATE = oneRevealOn('gate');
const holds = new WeakMap();

/** True while ground detail should wait for the arrival. `nowSec` is any monotonic clock in seconds. */
export function groundArrivalHeld(runtime, nowSec) {
  if (!runtime) return false;
  const sb = runtime.satBuildings;
  const W = sb?._wp;
  if (runtime.worldLoading === true) {
    const parts = REVEAL_GATE ? runtime.worldReadiness?.parts : null;
    if (!parts?.terrain || !parts.surfaces || !parts.buildings) return true;
    if (sb && W) holds.set(sb, { armAt: W.armAt, since: nowSec, x: runtime.flight?.pos?.x, z: runtime.flight?.pos?.z, departed: true });
    return false;
  }
  if (!sb || !W || !sb._ringOn) return false;
  let h = holds.get(sb);
  if (W.fullRingSec != null) return false;
  // A new arm or warp restarts the hold.
  const pos = runtime.flight?.pos;
  if (!h || !Object.is(h.armAt, W.armAt)) {
    h = { armAt: W.armAt, since: nowSec, x: pos?.x, z: pos?.z, departed: false };
    holds.set(sb, h);
  }
  // Half a kilometre on the ground is already a new approach at jet speed.
  const halfKm = 500 * Math.cosh((pos?.z ?? 0) / 6378137);
  if (pos && (pos.x - h.x) ** 2 + (pos.z - h.z) ** 2 >= halfKm ** 2) h.departed = true;
  return !h.departed && nowSec - h.since < MAX_HOLD_SEC;
}
