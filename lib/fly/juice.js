import { COMBO, NEARMISS, SESSION, SHAKE } from './fly-constants';

/**
 * ROUND 18 "Alive & Dangerous" — A4 SHOWTIME.
 *
 * The arcade layer's STATE, with zero React and zero three.js: trauma
 * (screen-shake energy), the combo chain, the near-miss closest-approach
 * detector, and the session/run tallies. Everything here is per-frame or
 * per-event mutable state, which is exactly why it must NOT live in a store
 * — `components/fly/JuiceSystems.jsx` drives this module from one useFrame
 * and writes the fly-store only when a value TRANSITIONS (the round-6 rule:
 * no per-frame data through React/zustand).
 *
 * Module scope (not a class) because there is exactly one flight session at
 * a time and two very different consumers need the same accumulator without
 * threading an instance through: `lib/fly/chase-camera.js` imports
 * getTrauma() inside its update loop, and JuiceSystems owns the decay. A
 * StrictMode double-mount re-runs reset() rather than doubling the state.
 *
 * Every read is gated by its own `enabled` flag at the CALL SITE, so with
 * the R18 flags false this module is inert: nothing calls in, nothing
 * accumulates, and the chase camera never multiplies a quaternion.
 */

// ---------------------------------------------------------------------------
// Trauma — the shake accumulator
// ---------------------------------------------------------------------------

let _trauma = 0;

/**
 * Add shake energy (0..1, clamped). Squared at the camera, so 0.35 reads as
 * a bump and 1.0 as a hit — see SHAKE.sources for the per-event doses.
 */
export function addTrauma(amount) {
  if (!(amount > 0)) return;
  _trauma = Math.min(1, _trauma + amount);
}

/** Read by chase-camera.update() — hot path, so no clamping work here. */
export function getTrauma() {
  return _trauma;
}

/** Linear decay toward 0. Driven once per frame by JuiceSystems. */
export function decayTrauma(dt) {
  if (_trauma <= 0) return;
  _trauma = Math.max(0, _trauma - SHAKE.traumaDecayPerSec * dt);
}

// ---------------------------------------------------------------------------
// Boost-meter mirror
// ---------------------------------------------------------------------------

/**
 * A5 GRAVITY publishes `runtime.boost = {frac, armed}` from the cmd-assembly
 * meter. JuiceSystems — which already holds `runtime` — samples it once a
 * frame into this stable object, and the BoostBar HUD polls it at 10 Hz.
 *
 * Why the indirection instead of handing `runtime` to the HUD: FlyMode's
 * children are all fed `runtimeRef.current` during render, which the
 * react-hooks/refs rule flags; the arcade layer had no reason to add a
 * seventeenth instance of that. It also keeps the whole HUD tree free of any
 * dependency on A5's merge landing first.
 *
 * `present` stays false until A5's field actually exists, which is what makes
 * BoostBar render nothing on a pre-merge tree.
 */
const _boost = { present: false, frac: 0, armed: true };

export function setBoostMirror(b) {
  const have = !!b && typeof b.frac === 'number';
  _boost.present = have;
  if (have) {
    _boost.frac = b.frac;
    _boost.armed = b.armed !== false;
  }
}

export function getBoostMirror() {
  return _boost;
}

// ---------------------------------------------------------------------------
// Combo chain + session/run score
// ---------------------------------------------------------------------------

const _state = {
  combo: 0,
  comboUntil: 0, // monotonic seconds; combo expires past this
  bestCombo: 0,
  sessionScore: 0, // mount → unmount, survives crashes
  runScore: 0, // since the last crash
  runStartSec: 0,
  nearMisses: 0,
  buzzes: 0,
  contracts: 0,
  spots: 0,
};

/** Live snapshot for HUD/telemetry reads (never mutate the returned object). */
export function getState() {
  return _state;
}

/** Multiplier for a chain of length `combo` (1-based). */
export function comboMult(combo) {
  if (combo <= 1) return 1;
  return Math.min(COMBO.multCap, 1 + COMBO.multStep * (combo - 1));
}

/**
 * Score one arcade event. `kind` is bookkeeping only ('nearMiss' | 'buzz' |
 * 'touchGo' | 'contract' | 'spot'); the caller passes basePts so the near-miss
 * path can keep its own NEARMISS.basePts knob.
 *
 * The chain advances FIRST and the multiplier is read from the new length —
 * so the first event of a chain always banks at ×1 and the arcade "×2.5" the
 * chip shows is the multiplier that was actually paid.
 */
export function scoreEvent(kind, basePts, nowSec) {
  if (COMBO.enabled) {
    // An expired window is a fresh chain, not a continuation: settle it here
    // rather than relying on the frame tick having run this instant.
    if (_state.combo > 0 && nowSec > _state.comboUntil) _state.combo = 0;
    _state.combo = Math.min(COMBO.max, _state.combo + 1);
    _state.comboUntil = nowSec + COMBO.windowSec;
    if (_state.combo > _state.bestCombo) _state.bestCombo = _state.combo;
  }

  const mult = COMBO.enabled ? comboMult(_state.combo) : 1;
  const pts = Math.round(basePts * mult);
  if (SESSION.enabled) {
    _state.sessionScore += pts;
    _state.runScore += pts;
  }

  if (kind === 'nearMiss') _state.nearMisses++;
  else if (kind === 'buzz' || kind === 'touchGo') _state.buzzes++;
  else if (kind === 'contract') _state.contracts++;
  else if (kind === 'spot') _state.spots++;

  return { kind, pts, mult, combo: _state.combo };
}

/**
 * Expire the chain if its window has closed. Returns true on the frame the
 * combo actually dropped — the caller turns that into ONE store write.
 */
export function tickCombo(nowSec) {
  if (_state.combo > 0 && nowSec > _state.comboUntil) {
    _state.combo = 0;
    return true;
  }
  return false;
}

/** Start (or restart) the run clock. Called on mount and after every respawn. */
export function beginRun(nowSec) {
  _state.runScore = 0;
  _state.runStartSec = nowSec;
  _state.combo = 0;
  _state.comboUntil = 0;
  _state.bestCombo = 0;
  _state.nearMisses = 0;
  _state.buzzes = 0;
  _state.contracts = 0;
  _state.spots = 0;
}

/**
 * Close the run and hand back the summary row. The SESSION score is
 * deliberately untouched — a crash costs you the run, not the session.
 */
export function endRun(nowSec) {
  const stats = {
    score: _state.runScore,
    nearMisses: _state.nearMisses,
    buzzes: _state.buzzes,
    bestCombo: _state.bestCombo,
    contracts: _state.contracts,
    spots: _state.spots,
    durationSec: Math.max(0, Math.round(nowSec - _state.runStartSec)),
  };
  _state.combo = 0;
  _state.comboUntil = 0;
  return stats;
}

/** Full teardown — session score included. JuiceSystems' unmount path. */
export function resetJuice() {
  _trauma = 0;
  _state.sessionScore = 0;
  beginRun(0);
}

// ---------------------------------------------------------------------------
// Near-miss detector
// ---------------------------------------------------------------------------

/**
 * Closest-approach INFLECTION detector over the traffic engine's live items.
 *
 * A distance threshold alone fires every frame you spend inside the bubble
 * and rewards loitering; the arcade read we want is "something went past
 * you". So we watch each track's distM derivative and fire on the frame it
 * flips from closing to opening — that sample IS the closest approach — then
 * gate on how close it got and how fast it was closing AT the minimum (a
 * slow taxi drifting past 100 m is not a near miss).
 *
 * The prev-distance Map is bounded two ways: entries are only created for
 * tracks inside NEARMISS.trackRangeM, and a periodic mark-and-sweep drops
 * hexes that stopped appearing in items (traffic churn would otherwise leak
 * one entry per aircraft ever seen).
 */
const SWEEP_FRAMES = 120;

export function createNearMissDetector() {
  const prev = new Map(); // hex → { d, rate, seen }
  const cooldown = new Map(); // hex → monotonic sec the hex re-arms at
  const fires = []; // monotonic sec of recent fires (rate cap window)
  let frame = 0;
  const out = [];

  return {
    /**
     * @param items TrafficEngine.items (post-update, .distM in true metres)
     * @param dt seconds since the previous step
     * @param nowSec monotonic seconds
     * @returns array of { hex, distM, closingMps, callsign } — reused, copy it
     */
    step(items, dt, nowSec) {
      out.length = 0;
      if (!items || !items.length || !(dt > 0)) return out;
      frame++;

      // Rate cap window: drop fires older than a minute.
      while (fires.length && nowSec - fires[0] > 60) fires.shift();

      for (const it of items) {
        const d = it.distM;
        if (!(d < NEARMISS.trackRangeM)) {
          if (prev.size) prev.delete(it.hex);
          continue;
        }
        const p = prev.get(it.hex);
        if (!p) {
          prev.set(it.hex, { d, rate: 0, maxRate: 0, minD: d, seen: frame });
          continue;
        }
        const rate = (p.d - d) / dt; // >0 closing, <=0 opening
        const wasClosing = p.rate > 0;
        if (rate > 0) {
          // Accumulate the approach. The closing speed we gate on is the PEAK
          // of the run-in, NOT the rate at the inflection: range rate goes
          // smoothly to zero AT the closest point of approach by definition,
          // so reading it there would gate every real fly-by out at ~0 m/s.
          if (rate > p.maxRate) p.maxRate = rate;
          if (d < p.minD) p.minD = d;
        } else {
          if (wasClosing) {
            const minD = Math.min(p.minD, p.d); // p.d was the closest sample
            if (
              minD < NEARMISS.distM &&
              p.maxRate > NEARMISS.closingMps &&
              fires.length < NEARMISS.maxPerMin &&
              !(cooldown.get(it.hex) > nowSec)
            ) {
              cooldown.set(it.hex, nowSec + NEARMISS.cooldownSec);
              fires.push(nowSec);
              out.push({
                hex: it.hex,
                distM: minD,
                closingMps: p.maxRate,
                callsign: (it.meta?.flight || '').trim() || it.hex.toUpperCase(),
              });
            }
          }
          // Opening: arm a fresh approach so the next run-in is measured on
          // its own merits instead of inheriting this pass's peak.
          p.maxRate = 0;
          p.minD = d;
        }
        p.d = d;
        p.rate = rate;
        p.seen = frame;
      }

      if (frame % SWEEP_FRAMES === 0) {
        for (const [hex, p] of prev) {
          if (frame - p.seen > SWEEP_FRAMES) prev.delete(hex);
        }
        for (const [hex, until] of cooldown) {
          if (until <= nowSec) cooldown.delete(hex);
        }
      }
      return out;
    },

    /** Post-warp/respawn: the position discontinuity is not a fly-by. */
    reset() {
      prev.clear();
      out.length = 0;
    },

    get tracked() {
      return prev.size;
    },
  };
}
