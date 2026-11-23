/**
 * STREAM PACE (FLY_HORIZON_FILL.md, "Third round"): the ONLY reader of the
 * STREAM_PACE block at the end of lib/fly/fly-constants.js, and the one scale
 * every streaming allowance shares.
 *
 * Resolved once when this module is first imported (the world-clarity.js
 * idiom). A worker has no pins and never imports this module.
 *
 *   STREAM_PACE_ON            the flag, with its pin
 *   streamPaceOn('flight')    a sub-switch (on only while the flag is)
 *   STREAM_PACE_ACTIVE        the resolved block, for tunables
 *   paceK()                   the scale this frame; exactly 1 while the flag is off
 *   createPaceLaw(cfg)        the law, pure (the gate drives it with synthetic frames)
 *   stepStreamPace(input)     the live law, once a frame (components/fly/StreamPaceRig.jsx)
 *   streamPaceStats()         what it did (window.__flyStats.streamPace)
 *
 * HOW THE SCALE REACHES THE ALLOWANCES. Every streaming allowance in the
 * engines is already `allowance x budgetK()` (lib/fly/harness-budget.js), and
 * the shared finalize allowance is `budgetMs x budgetK() x turn`
 * (lib/fly/finalize-pace.js). This module pushes k into harness-budget with
 * setStreamPaceK(), so budgetK() = the harness factor x k. harness-budget.js
 * imports nothing (scripts/verify-finalize-pace.mjs loads a copy of it on its
 * own), which is why the scale is pushed rather than pulled. With the flag
 * off nothing here ever runs a step, setStreamPaceK is never called, and
 * budgetK() is the harness factor times exactly 1.
 *
 * The law and its numbers are documented beside them, in the stream P section
 * of STREAM_PACE.
 */
import { pinned } from './fly-pins.js';
import { PERF_GOVERNOR, STREAM_PACE } from './fly-constants.js';
import { setStreamPaceK } from './harness-budget.js';
import { setTurnFloor } from './finalize-pace.js';

/** Sub-switches a caller may ask about. */
export const STREAM_PACE_SUBS = Object.freeze(['flight', 'curtain']);

export const STREAM_PACE_ACTIVE = pinned(STREAM_PACE, '__flyStreamPaceOverride');
export const STREAM_PACE_ON = STREAM_PACE_ACTIVE.enabled === true;

/** streamPaceOn() or streamPaceOn('flight' | 'curtain'). */
export function streamPaceOn(sub) {
  if (sub === undefined) return STREAM_PACE_ON;
  if (!STREAM_PACE_SUBS.includes(sub)) throw new Error(`stream-pace: unknown switch "${sub}"`);
  return STREAM_PACE_ON && STREAM_PACE_ACTIVE[sub] !== false;
}

/** The law's configuration from a resolved block (pure; defaults are the shipped numbers). */
export function paceLawConfig(block = STREAM_PACE_ACTIVE, gov = PERF_GOVERNOR) {
  return {
    flightOn: block.enabled === true && block.flight !== false,
    curtainOn: block.enabled === true && block.curtain !== false,
    flight: { ...STREAM_PACE.flightLaw, ...(block.flightLaw ?? {}) },
    curtain: { ...STREAM_PACE.curtainLaw, ...(block.curtainLaw ?? {}) },
    gov: {
      downFrac: gov?.downFrac ?? 0.85,
      bootGraceSec: gov?.bootGraceSec ?? 5,
      warpGraceSec: gov?.warpGraceSec ?? 3,
    },
  };
}

/**
 * The law. Pure: no clock, no globals; time is the sum of the intervals it is
 * given. step(input) once a frame returns k:
 *
 *   dtMs      the frame interval (the r3f delta, ms)
 *   workMs    the frame's own main-thread work (ms), or undefined if unknown
 *   targetMs  the display interval the governor aims at (1000 / targetFps), or null
 *   sample    false for a frame the governor does not sample either (a menu,
 *             a hidden page): nothing is folded and k holds
 *   curtain   true while the loading curtain is up (runtime.worldLoading)
 *   epoch     the warp epoch (any change is a warp: k = 1 for holdSec)
 *   bootDone  __flyBoot has reached 100 (the governor's boot grace starts)
 *
 * Allocation-free per step.
 */
export function createPaceLaw(cfg = paceLawConfig()) {
  const F = cfg.flight;
  const C = cfg.curtain;
  const st = {
    k: 1,
    clock: 0,
    // flight
    flightK: 1,
    emaDt: 0,
    emaWork: 0,
    workKnown: false,
    pressSince: -1, // seconds of late frames in the current pressure run (-1 = none)
    freeSince: -1,
    falling: false,
    ceilK: 1,
    ceilAt: -1,
    ceilUntil: -1,
    holdUntil: -1,
    // curtain
    wasCurtain: false,
    curtainK: 1,
    emaCurtain: 0,
    revealAt: -1,
    rampFrom: 1,
    // grace clocks for the governor
    epoch: null,
    epochAt: -1e9,
    bootDoneAt: -1,
    // the record since the last reveal (StreamPaceRig publishes it)
    stats: {
      sinceRevealSec: 0,
      min: 1,
      meanNum: 0, // integral of k dt since the reveal
      floorSec: 0,
      curtainK: 0, // the curtain factor used (time-weighted mean over the last curtain)
      curtainSec: 0,
      curtainNum: 0,
      falls: 0, // falls begun since the reveal
      reveals: 0,
    },
  };

  const startHold = () => {
    st.holdUntil = st.clock + F.holdSec;
    st.flightK = 1;
    st.emaDt = 0;
    st.emaWork = 0;
    st.workKnown = false;
    st.pressSince = -1;
    st.freeSince = -1;
    st.falling = false;
    st.ceilK = 1;
    st.ceilAt = -1;
    st.ceilUntil = -1;
  };

  st.step = (inp) => {
    const dtMs = inp.dtMs;
    if (!(dtMs > 0) || !Number.isFinite(dtMs)) return st.k;
    // A hidden tab's resume delta is not elapsed time worth simulating.
    const dt = Math.min(dtMs, 1000) / 1000;
    st.clock += dt;
    const S = st.stats;

    if (inp.bootDone && st.bootDoneAt < 0) st.bootDoneAt = st.clock;
    if (inp.epoch !== undefined && inp.epoch !== st.epoch) {
      const first = st.epoch === null;
      st.epoch = inp.epoch;
      if (!first) {
        st.epochAt = st.clock;
        startHold();
      }
    }

    const curtain = inp.curtain === true;
    const targetMs = inp.targetMs > 0 ? inp.targetMs : null;

    // ---- the curtain ------------------------------------------------------
    if (curtain) {
      if (!st.wasCurtain) {
        st.wasCurtain = true;
        st.curtainK = cfg.curtainOn ? C.k : 1;
        st.emaCurtain = 0;
        S.curtainSec = 0;
        S.curtainNum = 0;
      }
      if (cfg.curtainOn) {
        if (dtMs <= C.stallMs) {
          const a = 1 - Math.exp(-dt / Math.max(0.02, C.tauSec));
          st.emaCurtain = st.emaCurtain > 0 ? st.emaCurtain + (dtMs - st.emaCurtain) * a : dtMs;
        }
        const govLive =
          st.bootDoneAt >= 0 &&
          st.clock >= st.bootDoneAt + cfg.gov.bootGraceSec &&
          st.clock >= st.epochAt + cfg.gov.warpGraceSec;
        const ceiling = govLive && targetMs ? Math.min(C.maxFrameMs, (C.govMargin * targetMs) / cfg.gov.downFrac) : C.maxFrameMs;
        if (st.emaCurtain > ceiling) st.curtainK = Math.max(1, st.curtainK - C.fallPerSec * dt);
        else if (st.emaCurtain > 0 && st.emaCurtain < C.riseFrac * ceiling) st.curtainK = Math.min(C.k, st.curtainK + C.risePerSec * dt);
      }
      // Flight smoothing restarts at the reveal; the curtain owns k.
      st.flightK = 1;
      st.k = st.curtainK;
      S.curtainSec += dt;
      S.curtainNum += st.k * dt;
      S.curtainK = S.curtainSec > 0 ? S.curtainNum / S.curtainSec : 1;
      return st.k;
    }

    if (st.wasCurtain) {
      // The reveal: drop to min(k, rampFromK) and ramp to 1; flight held at 1.
      st.wasCurtain = false;
      st.revealAt = st.clock;
      st.rampFrom = Math.min(st.curtainK, C.rampFromK);
      startHold();
      S.sinceRevealSec = 0;
      S.min = 1;
      S.meanNum = 0;
      S.floorSec = 0;
      S.falls = 0;
      S.reveals++;
    }

    let k;
    const sinceReveal = st.revealAt >= 0 ? st.clock - st.revealAt : Infinity;
    if (sinceReveal < C.rampSec && st.rampFrom > 1) {
      k = 1 + (st.rampFrom - 1) * (1 - sinceReveal / C.rampSec);
    } else if (!cfg.flightOn || st.clock < st.holdUntil) {
      k = 1;
    } else {
      if (inp.sample !== false && targetMs) {
        const stall = Math.max(F.stallMs, F.stallK * targetMs);
        if (dtMs <= stall) {
          const a = 1 - Math.exp(-dt / Math.max(0.02, F.tauSec));
          const clip = F.clipK * targetMs;
          const d = Math.min(dtMs, clip);
          st.emaDt = st.emaDt > 0 ? st.emaDt + (d - st.emaDt) * a : d;
          const w = inp.workMs;
          if (Number.isFinite(w) && w >= 0) {
            const wc = Math.min(w, clip);
            st.emaWork = st.workKnown ? st.emaWork + (wc - st.emaWork) * a : wc;
            st.workKnown = true;
          }
          const late = st.emaDt / targetMs;
          const busy = st.workKnown ? st.emaWork / targetMs : null;
          const pressure = late > F.enterLate && (busy == null || busy > F.enterBusy);
          const headroom = late < F.exitLate || (busy != null && busy < F.exitBusy);
          if (pressure) {
            st.freeSince = -1;
            // The dwell counts LATE frames only, not the smoothed tail a short
            // burst leaves behind: three 45 ms frames are 0.135 s of dwell and
            // never a fall, while a run of late frames is.
            if (st.pressSince < 0) st.pressSince = 0;
            if (dtMs > F.enterLate * targetMs) st.pressSince += dt;
            if (st.pressSince >= F.downHoldSec) {
              if (!st.falling) {
                st.falling = true;
                st.ceilK = Math.max(F.floor, st.flightK - F.ceilMargin);
                st.ceilAt = st.clock;
                st.ceilUntil = st.clock + F.memoryHoldSec + F.memorySec;
                S.falls++;
              }
              // Fall only on a frame that is itself late: the smoothed interval
              // lags, and falling through its tail overshoots past the k that
              // already cured the frame.
              if (dtMs > F.enterLate * targetMs) st.flightK = Math.max(F.floor, st.flightK - F.fallPerSec * dt);
            }
          } else if (headroom) {
            st.pressSince = -1;
            st.falling = false;
            if (st.freeSince < 0) st.freeSince = st.clock;
            if (st.clock - st.freeSince >= F.upHoldSec) {
              // The memory: a cap ceilMargin under where the last fall began,
              // held for memoryHoldSec and then relaxed linearly back to 1 over
              // memorySec, so a backlog at the edge is probed again only slowly
              // and an emptied one (parked, nothing left to stream) is not held
              // at the floor for long.
              const since = st.clock - st.ceilAt;
              const cap =
                st.clock >= st.ceilUntil ? 1 : since < F.memoryHoldSec ? st.ceilK : st.ceilK + ((1 - st.ceilK) * (since - F.memoryHoldSec)) / F.memorySec;
              if (st.flightK < cap) st.flightK = Math.min(cap, st.flightK + F.risePerSec * dt);
            }
          } else {
            st.pressSince = -1;
            st.freeSince = -1;
            st.falling = false;
          }
        }
      }
      k = st.flightK;
    }
    st.k = k;
    if (st.revealAt >= 0 || S.reveals === 0) {
      S.sinceRevealSec += dt;
      S.meanNum += k * dt;
      if (k < S.min) S.min = k;
      if (k <= F.floor + 1e-9) S.floorSec += dt;
    }
    return k;
  };

  /** Time-weighted mean of k since the last reveal (1 before any frame). */
  st.mean = () => (st.stats.sinceRevealSec > 0 ? st.stats.meanNum / st.stats.sinceRevealSec : 1);
  return st;
}

// --- the live instance ------------------------------------------------------
let live = null;

/** The live law (created on first use, only while the flag is on). */
function law() {
  if (!live) live = createPaceLaw(paceLawConfig());
  return live;
}

/**
 * One frame of the live law (StreamPaceRig, before the engines run). Pushes k
 * into budgetK() and keeps the turn budget from taking the shared finalize
 * allowance below the floor. A no-op returning 1 with the flag off.
 */
export function stepStreamPace(input) {
  if (!STREAM_PACE_ON) return 1;
  const L = law();
  const k = L.step(input);
  setStreamPaceK(k);
  const floor = STREAM_PACE_ACTIVE.flightLaw?.floor ?? STREAM_PACE.flightLaw.floor;
  setTurnFloor(k < 1 ? Math.min(1, floor / k) : 0);
  return k;
}

/** The shared allowance scale for this frame. Exactly 1 while the flag is off. */
export function paceK() {
  return STREAM_PACE_ON && live ? live.k : 1;
}

/** What the law did (null with the flag off). Writes into `out` when given (no allocation). */
export function streamPaceStats(out) {
  if (!STREAM_PACE_ON || !live) return null;
  const s = live.stats;
  const o = out ?? {};
  o.k = +live.k.toFixed(3);
  o.min = +s.min.toFixed(3);
  o.mean = +live.mean().toFixed(3);
  o.floorSec = +s.floorSec.toFixed(2);
  o.sinceRevealSec = +s.sinceRevealSec.toFixed(1);
  o.falls = s.falls;
  o.curtainK = +(s.curtainK || 0).toFixed(2);
  o.curtainSec = +s.curtainSec.toFixed(1);
  o.reveals = s.reveals;
  o.curtain = live.wasCurtain;
  return o;
}

/** Test seam: forget the live law and put k back to 1. */
export function resetStreamPace() {
  live = null;
  setStreamPaceK(1);
  setTurnFloor(0);
}
