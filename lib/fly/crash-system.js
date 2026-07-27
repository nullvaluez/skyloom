import { CRASH } from './fly-constants';
import { DEG2RAD } from './coords';

/**
 * Round 18 "Alive & Dangerous" (A5 GRAVITY) — crash DETECTION.
 *
 * Pure module: no React, no three-tile, no store. It is handed the flight
 * model and a few cheap scalars once per frame and answers one question —
 * "did that count as a crash?" — returning `{ kind }` exactly once. The
 * SEQUENCE (tumble, flash, respawn) belongs to the caller (FlyScene); this
 * file only decides.
 *
 * ── THE ARM GATE (the fleet-safety invariant) ──────────────────────────────
 * Detection is dead for CRASH.armDelaySec after the scene mounts, after every
 * fly-store warpEpoch bump, and after every respawn. That is not politeness,
 * it is the contract that keeps thirty-odd existing harnesses green without
 * touching one of them: every harness pose in scripts/ is placed by
 * `warpTo`/`warpToGeo` (or a `pinScene` built on one), which bumps warpEpoch,
 * which disarms. A warp into an Alpine wall, a boot probe whose DEM has not
 * streamed, a pinScene sitting inside a tower — none of them can crash. The
 * player, who has been flying for minutes, is armed the whole time.
 *
 * ── THE RULES ──────────────────────────────────────────────────────────────
 * TERRAIN — only on real ground CONTACT (flight.floorContact, written by the
 * flight model in the same frame), and only if you flew it in:
 *     sink < -CRASH.terrain.sinkMps          (you drove it at the ground)
 *  OR speed > diveSpeedMps AND pitch < -diveDeg   (a committed dive)
 * Everything gentler keeps the round-6 slide untouched. Note what is NOT a
 * crash: LEVEL flight into rising terrain. That is deliberate — the terrain
 * rule judges how you flew, not what the DEM did, and a rule that fired on
 * "the ground moved" would fire on every coarse tile that streams in late.
 *
 * BUILDING — satellite only, and only at CRASH.building.minSpeedMps or above.
 * Below that, threading between the towers is the intended playground. The
 * collision volumes come from A1's sat-building engine via the optional
 * `queryColumns(px, pz, r)` handle; when that engine is absent (toy style,
 * low tier, SAT_BUILDINGS off, or simply not merged yet) building crashes
 * silently do not exist.
 */

/** Column contract (lib/fly/sat-building-engine.js `queryColumns`):
 *  { x, z, topY, r } — x/z in ABSOLUTE world units (the frame flight.pos
 *  lives in, mercator-stretched horizontally); topY and r in TRUE METERS.
 *  The horizontal test below converts the world-unit delta back to true
 *  meters with the caller's mercator scale before comparing against r. */

export class CrashSystem {
  constructor() {
    this.armT = 0; // seconds since the last disarm
    this.lastKind = null; // dev/harness introspection only
  }

  /** Mount / warp / respawn: restart the arm delay. */
  disarm() {
    this.armT = 0;
  }

  /** True once the arm delay has elapsed (the harnesses read this). */
  get armed() {
    return this.armT >= CRASH.armDelaySec;
  }

  /**
   * One frame of detection.
   *
   * @param dt      seconds (already clamped by the caller)
   * @param ctx     {
   *                  enabled: boolean — CRASH.enabled AND the player's
   *                           "Flight stakes" setting. False still advances
   *                           the arm clock, so flipping the toggle mid-flight
   *                           does not hand out a free five seconds.
   *                  flight, satellite, satBuildings, mercK
   *                }
   * @returns {null | {kind: 'terrain'|'building'}}
   */
  update(dt, ctx) {
    this.armT += dt;
    if (!ctx.enabled || this.armT < CRASH.armDelaySec) return null;

    const flight = ctx.flight;
    if (!flight) return null;

    // --- terrain -----------------------------------------------------------
    const hit = flight.floorContact;
    if (hit) {
      const T = CRASH.terrain;
      if (
        hit.vy < -T.sinkMps ||
        (hit.speed > T.diveSpeedMps && flight.pitch < -T.diveDeg * DEG2RAD)
      ) {
        this.lastKind = 'terrain';
        return { kind: 'terrain' };
      }
    }

    // --- buildings (satellite only) ----------------------------------------
    // `?.` twice on purpose: the layer may not be mounted (toy / low tier /
    // SAT_BUILDINGS.enabled false) and the engine may not carry the handle at
    // all. Either way this whole branch evaporates.
    if (ctx.satellite && flight.speed >= CRASH.building.minSpeedMps) {
      const cols = ctx.satBuildings?.queryColumns?.(
        flight.pos.x,
        flight.pos.z,
        CRASH.building.queryRadiusM
      );
      if (cols && cols.length) {
        const k = ctx.mercK || 1;
        for (let i = 0; i < cols.length; i++) {
          const c = cols[i];
          if (!c || flight.pos.y >= c.topY) continue;
          // World units -> true metres before the radius comparison.
          const dx = (flight.pos.x - c.x) / k;
          const dz = (flight.pos.z - c.z) / k;
          if (dx * dx + dz * dz < c.r * c.r) {
            this.lastKind = 'building';
            return { kind: 'building' };
          }
        }
      }
    }

    return null;
  }
}

/**
 * Where the aircraft comes back. `backM` TRUE metres back along the track it
 * was flying WHEN IT HIT (the caller captures that at crash entry, before the
 * tumble scrambles heading and position), at ground + `aglM`.
 *
 * Pure: it takes the ground elevation the caller sampled at the respawn point
 * and returns a pose. Horizontal offsets convert to world units with the
 * caller's mercator scale — the same `k` warpTo uses for WARP.behindM.
 *
 * @param track {x, z, heading} the pose at impact
 * @returns {{x, y, z}}
 */
export function respawnPose(track, groundElev, mercK) {
  const back = CRASH.respawn.backM * (mercK || 1);
  return {
    // forward is (+sin, -cos); backwards is its negation
    x: track.x - Math.sin(track.heading) * back,
    z: track.z + Math.cos(track.heading) * back,
    y: groundElev + CRASH.respawn.aglM,
  };
}
