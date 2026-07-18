import { TRAFFIC } from './fly-constants';
import { DEG2RAD, expApproachAngle, mercatorScale, wrapAngle } from './coords';

// Mirrors the worker's packed-row contract (aircraft-processor.worker.js).
const STRIDE = 9; // [x, y(altM), z, vE, vUp, vN, tFix, archetypeIdx, flags]
const FLAG_GROUNDED = 1;
const FLAG_EMERGENCY = 2;

const EARTH_R = 6378137;

// Scratch for the clock-jump re-baseline (fix objects can alias per track)
const _seenFixes = new Set();

/** Inverse of the worker's mercZ: world Z → latitude radians. */
function latRadFromZ(z) {
  return 2 * Math.atan(Math.exp(-z / EARTH_R)) - Math.PI / 2;
}

/**
 * lon/lat → absolute world X/Z with the exact formula the worker uses.
 * Must agree with TerrainEngine.geoToWorld (asserted in dev at spawn).
 */
export function mercatorWorldXZ(lon, lat) {
  return {
    x: EARTH_R * lon * DEG2RAD,
    z: -EARTH_R * Math.log(Math.tan(Math.PI / 4 + (lat * DEG2RAD) / 2)),
  };
}

/**
 * Pure dead-reckoning traffic simulation — the thing that makes Fly-mode
 * aircraft move CONTINUOUSLY between 2s polls instead of teleporting.
 *
 * Frames: ingest() receives worker rows relative to the worker's fixed
 * spawn origin and converts them to ABSOLUTE world units (float64 from
 * here on). update() advances every track to `nowSec` (server timebase),
 * writing renderable state (absolute position, yaw/bank, opacity, scale
 * factor) onto each track; TrafficLayer turns those into instance
 * matrices (rebased) and LabelCanvas/targeting read the same objects.
 *
 * Motion model per track:
 * - renderPos = fix + v·age (horizontal × mercatorScale — velocities are
 *   true m/s, the world is mercator-stretched), with arc extrapolation
 *   when the last two fixes show a turn > arcTrackThresholdDeg.
 * - New fix within blendMaxErrorM → projective velocity blending: render
 *   both the old and new projections and lerp between them over
 *   blendDurationSec (altitude over altBlendDurationSec). Beyond the
 *   error bound → snap with a short opacity dip.
 * - Stale ladder by fix age: >staleDimSec zero climb + dim,
 *   >staleFreezeSec freeze + fade to 30%, >staleRemoveSec shrink out.
 */
export class TrafficEngine {
  constructor() {
    this.tracks = new Map(); // hex -> track
    this.items = []; // update() output: live tracks, reused array
    this._originX = 0; // worker origin (spawn), absolute world units
    this._originZ = 0;
    this._hasOrigin = false;
    this._skewSec = null; // client-seconds minus server-seconds (EMA)
    this._elevationAt = null; // (lon, lat) => meters | null
    this._renderLiftAt = null; // (lon, lat) => drawnGround − trueGround | null
  }

  /** The worker packs positions relative to this absolute world origin. */
  setOrigin(x, z) {
    this._originX = x;
    this._originZ = z;
    this._hasOrigin = true;
  }

  /**
   * Inject the ground sampler for grounded-aircraft pinning. May return
   * null (DEM not streamed at adequate zoom yet) — the pin is retried on
   * the next fix instead of caching a garbage elevation.
   */
  setElevationSampler(fn) {
    this._elevationAt = fn;
  }

  /**
   * Round 8.5 (H1): inject the render-frame lift sampler. Returns the
   * vertical offset between the DRAWN ground and the TRUE ground under a
   * point (toy: elev×(exaggeration−1)+groundLift; satellite: 0), or null
   * while DEM hasn't streamed (retried on the refresh cadence). update()
   * adds the smoothed lift to each airborne track's render Y (track.ryd) —
   * track.ry stays the TRUE altitude for data readouts.
   */
  setRenderLiftSampler(fn) {
    this._renderLiftAt = fn;
  }

  /** Drop every cached ground pin (the sampler's frame changed, e.g. the
   *  toy style's exaggerated ground vs true DEM) — resampled on next fix.
   *  Also hard-resets the render-frame lift (same frame change; the world
   *  visibly rebuilds on a style switch anyway, no pop to hide). */
  clearGroundCache() {
    for (const track of this.tracks.values()) {
      track.groundElev = null;
      track.renderLift = 0;
      track._liftTarget = 0;
      track._liftSampledT = null;
    }
  }

  /** Server-timebase "now" for the given client seconds (performance-based). */
  serverNow(clientSec) {
    return this._skewSec == null ? null : clientSec - this._skewSec;
  }

  /**
   * Merge one worker batch. clientSec is the caller's monotonic seconds
   * (performance.now()/1000) captured at receipt.
   */
  ingest({ buffer, count, hexes, meta, serverNow }, clientSec) {
    if (!this._hasOrigin) return;

    // Clock skew, NTP-style: every observed skew includes that response's
    // transport delay, so the MINIMUM ever seen is the best estimate of the
    // true clock offset — an average would lag by the mean latency and
    // clamp every fresh fix's age to zero (frozen dead reckoning). The
    // slow +25ms/poll creep re-adapts if the clocks genuinely drift apart.
    //
    // EXCEPT across upstream rotations: the multi-source failover's
    // aggregators disagree by tens of seconds, and under a pure min() rule
    // one rotated batch made every track age ~60s in a single frame — the
    // stale ladder mass-deleted the sky (tracks ~330 → ~60 every ~29s; the
    // "intermittent contrails" root cause). A skew sample far outside the
    // estimate is a clock DISCONTINUITY: adopt it and shift every stored
    // timestamp by the jump so track ages stay continuous.
    const skew = clientSec - serverNow;
    if (this._skewSec == null) {
      this._skewSec = skew;
    } else if (Math.abs(skew - this._skewSec) > TRAFFIC.clockJumpSec) {
      const delta = skew - this._skewSec; // serverNow(clientSec) moves by -delta
      for (const track of this.tracks.values()) {
        // blendFix1/blendFix0 can ALIAS fix1/fix0 (assignment shares the
        // object) — shift each unique fix object exactly once.
        const seen = _seenFixes;
        seen.clear();
        for (const f of [track.fix1, track.fix0, track.blendFix1, track.blendFix0]) {
          if (f && !seen.has(f)) {
            seen.add(f);
            f.t -= delta;
          }
        }
        track.blendStart -= delta;
        if (track.altBlendStart != null) track.altBlendStart -= delta;
        if (track.snapDipUntil != null) track.snapDipUntil -= delta;
        if (track._liftSampledT != null) track._liftSampledT -= delta;
        track.lastPollServer -= delta;
      }
      this._skewSec = skew;
      if (
        typeof window !== 'undefined' &&
        process.env.NODE_ENV === 'development' &&
        window.__flyStats
      ) {
        window.__flyStats.clockJumps = (window.__flyStats.clockJumps ?? 0) + 1;
      }
    } else {
      this._skewSec = Math.min(this._skewSec + 0.025, skew);
    }

    for (const m of meta) {
      let track = this.tracks.get(m.hex);
      if (!track) {
        track = this._createTrack(m.hex);
        this.tracks.set(m.hex, track);
      }
      track.meta = m;
    }

    const rows = new Float32Array(buffer);
    const nowServer = serverNow;
    for (let i = 0; i < count; i++) {
      const o = i * STRIDE;
      const hex = hexes[i];
      let track = this.tracks.get(hex);
      if (!track) {
        track = this._createTrack(hex);
        this.tracks.set(hex, track);
      }

      // Reconstruct the fix epoch in float64 from the float32-safe age.
      const tFix = nowServer - rows[o + 6];
      // Proxy caches 3s while we poll at 2s → identical payloads are
      // routine. Same (hex, tFix) must not reset blend state.
      if (track.fix1 && Math.abs(tFix - track.fix1.t) < 0.25) {
        track.lastPollServer = nowServer;
        continue;
      }
      if (process.env.NODE_ENV === 'development') {
        const age = rows[o + 6];
        if (age < -1 || age > 300) {
          console.warn(`[fly-traffic] implausible fix age ${age.toFixed(1)}s for ${hex}`);
        }
      }

      const x = rows[o] + this._originX;
      const y = rows[o + 1];
      const z = rows[o + 2] + this._originZ;
      const flags = rows[o + 8];

      let alt = y;
      const grounded = (flags & FLAG_GROUNDED) !== 0;
      if (grounded && this._elevationAt) {
        if (track.groundElev == null) {
          const lonDeg = (x / EARTH_R) / DEG2RAD;
          const latDeg = latRadFromZ(z) / DEG2RAD;
          const elev = this._elevationAt(lonDeg, latDeg);
          if (elev != null) track.groundElev = elev;
        }
        if (track.groundElev != null) alt = track.groundElev + 2;
      }

      const fix = {
        t: tFix,
        x,
        y: alt,
        z,
        vE: rows[o + 3],
        vUp: grounded ? 0 : rows[o + 4],
        vN: rows[o + 5],
        latRad: latRadFromZ(z),
      };

      if (track.fix1) {
        // Start a correction blend from the OLD projection to the new one.
        const nowT = this.serverNow(clientSec) ?? nowServer;
        this._project(track.fix1, track.fix0, nowT, _oldPos);
        this._project(fix, track.fix1, nowT, _newPos);
        const dx = _oldPos.x - _newPos.x;
        const dz = _oldPos.z - _newPos.z;
        const k = mercatorScale(fix.latRad / DEG2RAD);
        const horizErrM = Math.hypot(dx / k, dz / k);
        if (horizErrM <= TRAFFIC.blendMaxErrorM) {
          track.blendFix1 = track.fix1;
          track.blendFix0 = track.fix0;
          track.blendStart = nowT;
        } else {
          // Teleport-grade error: snap with an opacity dip instead.
          track.blendFix1 = null;
          track.blendFix0 = null;
          track.snapDipUntil = nowT + TRAFFIC.snapOpacityDipMs / 1000;
        }
        track.altBlendFrom = _oldPos.y;
        track.altBlendStart = nowT;
      }

      const firstFix = !track.fix1;
      track.fix0 = track.fix1;
      track.fix1 = fix;
      track.archetype = rows[o + 7] | 0;
      track.flags = flags;
      track.lastPollServer = nowServer;
      if (firstFix && Math.hypot(fix.vE, fix.vN) > 3) {
        track.yaw = Math.atan2(fix.vE, fix.vN); // no slerp-in on first sight
      }
    }
  }

  /**
   * Advance all tracks to clientSec. Returns this.items — live tracks with
   * render state written (absolute pos in .rx/.ry/.rz, .yaw, .bank,
   * .opacity, .scaleK shrink factor, .distM to playerPos, .stale level).
   * .ryd is the DRAWN-frame render Y (round 8.5 H1): visual consumers
   * (instances, tracers, labels/stems, aim points) read .ryd; .ry stays
   * the TRUE altitude for data readouts. Identical outside toy.
   */
  update(clientSec, playerPos) {
    const now = this.serverNow(clientSec);
    this.items.length = 0;
    if (now == null) return this.items;

    for (const track of this.tracks.values()) {
      const fix = track.fix1;
      if (!fix) continue;
      const age = now - fix.t;

      // --- Stale ladder -------------------------------------------------
      let opacity = 1;
      let effectiveNow = now;
      if (age > TRAFFIC.staleRemoveSec + TRAFFIC.removeFadeSec) {
        this.tracks.delete(track.hex);
        continue;
      } else if (age > TRAFFIC.staleRemoveSec) {
        effectiveNow = fix.t + TRAFFIC.staleFreezeSec;
        opacity = 0.3 * (1 - (age - TRAFFIC.staleRemoveSec) / TRAFFIC.removeFadeSec);
      } else if (age > TRAFFIC.staleFreezeSec) {
        effectiveNow = fix.t + TRAFFIC.staleFreezeSec; // freeze
        opacity = 0.3;
      } else if (age > TRAFFIC.staleDimSec) {
        opacity = 0.6;
      }
      const frozen = age > TRAFFIC.staleFreezeSec;
      const noClimb = age > TRAFFIC.staleDimSec;

      // --- Position: projection (+ correction blend) ---------------------
      this._project(fix, track.fix0, effectiveNow, _newPos, noClimb);
      let px = _newPos.x;
      let py = _newPos.y;
      let pz = _newPos.z;
      let yawTarget = _newPos.yaw;
      let turnRate = _newPos.turnRate;

      if (track.blendFix1) {
        const u = (now - track.blendStart) / TRAFFIC.blendDurationSec;
        if (u >= 1) {
          track.blendFix1 = null;
          track.blendFix0 = null;
        } else {
          this._project(track.blendFix1, track.blendFix0, effectiveNow, _oldPos, noClimb);
          const w = 1 - u;
          px = px * u + _oldPos.x * w;
          pz = pz * u + _oldPos.z * w;
        }
      }
      if (track.altBlendStart != null) {
        const ua = (now - track.altBlendStart) / TRAFFIC.altBlendDurationSec;
        if (ua >= 1) {
          track.altBlendStart = null;
        } else {
          py = py * ua + track.altBlendFrom * (1 - ua);
        }
      }

      // --- Orientation ----------------------------------------------------
      const firstUpdate = track._lastUpdate == null;
      const dt = firstUpdate ? 0.016 : Math.min(0.1, clientSec - track._lastUpdate);
      track._lastUpdate = clientSec;
      if (!frozen && Number.isFinite(yawTarget)) {
        track.yaw = expApproachAngle(track.yaw, yawTarget, TRAFFIC.yawLambda, dt);
      }
      const speed = Math.hypot(fix.vE, fix.vN);
      const bankTarget = frozen
        ? 0
        : Math.max(
            -TRAFFIC.fakeBankMaxDeg * DEG2RAD,
            Math.min(TRAFFIC.fakeBankMaxDeg * DEG2RAD, Math.atan((speed * turnRate) / 9.81))
          );
      track.bank = track.bank + (bankTarget - track.bank) * Math.min(1, 3 * dt);

      // --- Render-frame lift (round 8.5 H1) --------------------------------
      // track.ry is the TRUE altitude (data readouts, spot logging). The
      // DRAWN toy ground sits at elev×exaggeration+lift, so every VISUAL
      // consumer reads track.ryd = ry + (drawnGround − trueGround) instead:
      // yDrawn = drawnGround + (ryTrue − trueGround). Grounded pins are
      // ALREADY drawn-frame (the elevation sampler exaggerates in toy) →
      // their lift target is 0. The sampled target is eased per frame so a
      // plane crossing relief never pops vertically; the very first
      // successful sample snaps (the track hasn't been drawn yet).
      if (this._renderLiftAt) {
        const pinned = (track.flags & FLAG_GROUNDED) !== 0 && track.groundElev != null;
        if (pinned) {
          track._liftTarget = 0;
        } else if (
          track._liftSampledT == null ||
          now - track._liftSampledT > TRAFFIC.renderLiftRefreshSec
        ) {
          track._liftSampledT = now; // null result: retry on the cadence, not per frame
          const lonDeg = px / EARTH_R / DEG2RAD;
          const latDeg = latRadFromZ(pz) / DEG2RAD;
          const lift = this._renderLiftAt(lonDeg, latDeg);
          if (lift != null) {
            track._liftTarget = lift;
            if (firstUpdate) track.renderLift = lift; // no glide-in on first sight
          }
        }
      } else {
        track._liftTarget = 0;
      }
      // Injected/synthetic tracks (dev harnesses) may predate the H1 fields —
      // a non-finite renderLift would NaN ryd, autopilot aim, and audio params.
      if (!Number.isFinite(track.renderLift)) track.renderLift = track._liftTarget || 0;
      track.renderLift +=
        (track._liftTarget - track.renderLift) * Math.min(1, TRAFFIC.renderLiftLambda * dt);

      // --- Output ----------------------------------------------------------
      if (track.snapDipUntil != null) {
        if (now < track.snapDipUntil) opacity = Math.min(opacity, 0.25);
        else track.snapDipUntil = null;
      }
      track.rx = px;
      track.ry = py;
      track.ryd = py + track.renderLift; // RENDER Y (drawn frame; = ry in satellite)
      track.rz = pz;
      track.opacity = opacity;
      track.scaleK =
        age > TRAFFIC.staleRemoveSec
          ? Math.max(0.001, 1 - (age - TRAFFIC.staleRemoveSec) / TRAFFIC.removeFadeSec)
          : 1;
      track.stale = frozen ? 2 : noClimb ? 1 : 0;
      if (playerPos) {
        const k = mercatorScale(fix.latRad / DEG2RAD);
        track.distM = Math.hypot(
          (px - playerPos.x) / k,
          py - playerPos.y,
          (pz - playerPos.z) / k
        );
      }
      this.items.push(track);
    }
    return this.items;
  }

  /** n nearest live tracks to playerPos (call after update()). */
  getNearest(n, _playerPos) {
    return [...this.items].sort((a, b) => a.distM - b.distM).slice(0, n);
  }

  get size() {
    return this.tracks.size;
  }

  dispose() {
    this.tracks.clear();
    this.items.length = 0;
  }

  _createTrack(hex) {
    return {
      hex,
      meta: null,
      archetype: 8, // unknown
      flags: 0,
      fix0: null,
      fix1: null,
      groundElev: null,
      blendFix1: null,
      blendFix0: null,
      blendStart: 0,
      altBlendFrom: 0,
      altBlendStart: null,
      snapDipUntil: null,
      yaw: 0,
      bank: 0,
      rx: 0,
      ry: 0,
      ryd: 0, // render Y, drawn frame (round 8.5 H1) — ry + renderLift
      rz: 0,
      renderLift: 0,
      _liftTarget: 0,
      _liftSampledT: null,
      distM: Infinity,
      opacity: 1,
      scaleK: 1,
      stale: 0,
      lastPollServer: 0,
      _lastUpdate: null,
    };
  }

  /**
   * Project a fix to time t into `out` {x,y,z,yaw,turnRate}. Straight-line
   * DR by default; if prevFix shows a turn > arcTrackThresholdDeg, follow
   * the circular arc (turnRate = Δheading/Δt). Horizontal velocity is true
   * m/s → world displacement × mercatorScale(lat of fix).
   */
  _project(fix, prevFix, t, out, noClimb = false) {
    const age = Math.max(0, t - fix.t);
    const k = mercatorScale(fix.latRad / DEG2RAD);
    const speed = Math.hypot(fix.vE, fix.vN);
    const hdg = Math.atan2(fix.vE, fix.vN); // 0 = north, cw+

    let turnRate = 0;
    if (prevFix && fix.t > prevFix.t + 0.5) {
      const prevHdg = Math.atan2(prevFix.vE, prevFix.vN);
      const dHdg = wrapAngle(hdg - prevHdg);
      if (Math.abs(dHdg) > TRAFFIC.arcTrackThresholdDeg * DEG2RAD && speed > 20) {
        turnRate = dHdg / (fix.t - prevFix.t);
      }
    }

    let east;
    let north;
    if (turnRate !== 0) {
      // Circular-arc extrapolation from the fix heading at constant speed.
      const r = speed / turnRate;
      const h1 = hdg + turnRate * age;
      east = r * (Math.cos(hdg) - Math.cos(h1));
      north = r * (Math.sin(h1) - Math.sin(hdg));
      out.yaw = h1;
    } else {
      east = fix.vE * age;
      north = fix.vN * age;
      out.yaw = speed > 3 ? hdg : NaN; // parked/hovering: hold last yaw
    }

    out.x = fix.x + east * k;
    out.z = fix.z - north * k; // world -Z is north
    out.y = fix.y + (noClimb ? 0 : fix.vUp * age);
    out.turnRate = turnRate;
    return out;
  }
}

const _oldPos = { x: 0, y: 0, z: 0, yaw: 0, turnRate: 0 };
const _newPos = { x: 0, y: 0, z: 0, yaw: 0, turnRate: 0 };
