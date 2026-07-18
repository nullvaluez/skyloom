import { TARGETING } from './fly-constants';
import { mercatorScale, wrapAngle } from './coords';

/**
 * Soft-lock state machine (Phase 5). Pure module — evaluated once per frame
 * against the traffic engine's live items; emits to the fly-store only on
 * TRANSITIONS (never per frame).
 *
 * Acquire: best-scored target < acquireRangeM AND < acquireConeDeg off the
 * nose (score = angErr·(1 + dist/acquireRange); lowest wins). Release with
 * hysteresis at releaseConeDeg/releaseRangeM, min hold minHoldSec. The
 * locked target object (a TrafficEngine track) is exposed on .target for
 * the reticle/intercept/info card.
 */
export class Targeting {
  constructor() {
    this.lockedHex = null;
    this.target = null; // live track reference while locked
    this._lockT = 0;
  }

  /**
   * @param nowSec monotonic seconds
   * @param flight FlightModel (absolute pos, heading/pitch)
   * @param items TrafficEngine.items (post-update, .distM populated)
   * @param holding true while the autopilot owns the target — intercept
   *   geometry and the formation slot put the target far off the nose by
   *   DESIGN, so the release cone must not apply (range/stale still do)
   * @returns {'acquired'|'released'|null} transition (null = no change)
   */
  update(nowSec, flight, items, holding = false) {
    const k = mercatorScale(flight.latDeg);
    const fwd = flight.forward();

    // Angle off the nose for a track (true-meter space). ryd (round 8.5
    // H1): the cone tests the RENDERED altitude — you lock what the nose
    // is visually pointed at, not the true-frame position under it.
    const angleTo = (it) => {
      const dx = (it.rx - flight.pos.x) / k;
      const dy = it.ryd - flight.pos.y;
      const dz = (it.rz - flight.pos.z) / k;
      const len = Math.hypot(dx, dy, dz) || 1;
      // fwd is unit in the same axis convention (x east, y up, z south)
      const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / len;
      return Math.acos(Math.max(-1, Math.min(1, dot)));
    };

    // --- Holding a lock: check release conditions ------------------------
    if (this.lockedHex) {
      const current = items.find((it) => it.hex === this.lockedHex) || null;
      this.target = current;
      const held = nowSec - this._lockT;
      let release = false;
      if (!current) release = true;
      else if (held >= TARGETING.minHoldSec) {
        // While the autopilot holds the target, range AND cone release are
        // suspended (formation slots sit far off the nose by design, and the
        // inspect modal can order an intercept from any distance) — only a
        // lost or fully-stale track drops the lock.
        const ang = angleTo(current);
        if (
          (!holding &&
            (current.distM > TARGETING.releaseRangeM ||
              ang > TARGETING.releaseConeDeg * (Math.PI / 180))) ||
          current.stale === 2
        ) {
          release = true;
        }
      }
      if (release) {
        this.lockedHex = null;
        this.target = null;
        return 'released';
      }
      return null;
    }

    // --- No lock: scan for the best candidate ----------------------------
    let best = null;
    let bestScore = Infinity;
    const cone = TARGETING.acquireConeDeg * (Math.PI / 180);
    for (const it of items) {
      if (it.stale === 2 || it.distM > TARGETING.acquireRangeM) continue;
      const ang = angleTo(it);
      if (ang > cone) continue;
      const score = ang * (1 + it.distM / TARGETING.acquireRangeM);
      if (score < bestScore) {
        bestScore = score;
        best = it;
      }
    }
    if (best) {
      this.lockedHex = best.hex;
      this.target = best;
      this._lockT = nowSec;
      return 'acquired';
    }
    return null;
  }

  /** Bearing error (rad) from the player's heading to the target, for HUD. */
  bearingError(flight, it) {
    const brg = Math.atan2(it.rx - flight.pos.x, -(it.rz - flight.pos.z));
    return wrapAngle(brg - flight.heading);
  }
}
