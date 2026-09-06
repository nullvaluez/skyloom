'use client';

/**
 * ROUND 24 (E CERT) — FRAME_STATS, the in-app frame-pace instrument.
 *
 * THE GAP IT CLOSES (recon HARN-GAP-4). Nothing in this tree measures
 * presentation timing. The app publishes scene totals every 60 frames
 * (FlyScene.jsx:1737) and the governor publishes an EMA of fps
 * (perf-governor.js:193); every temporal instrument that has ever run is
 * HARNESS-PRIVATE and sampled — soak-fly.js:118 installs its own rAF
 * collector, verify-stability.js:188 patches the WebGL draw prototypes. So
 * the user's "stutter", "freeze-and-snap" and "tearing" reports have never
 * had a number attached to them, and a gate cannot be RED-calibrated against
 * a symptom nobody measured.
 *
 * WHAT IT PUBLISHES — `window.__flyStats.frame`:
 *   count, lastDt, worstDt, worstDtRecent        (ms; the ring's worst)
 *   p50, p95, p99                                 over the ring
 *   long33PerMin, long100PerMin                   rolling 60 s rates
 *   long33, long100                               session totals
 *   stalls, stallsPerMin, stallThresholdMs        dt >= max(2*median, 28)
 *   longtasks, longtaskMs                         PerformanceObserver('longtask')
 *   programs, programsDelta, programsGrewAt       gl.info.programs.length
 *   geometries, textures                          gl.info.memory
 *   lastStall { dtMs, atMs, phase, phases[] }     attribution
 *   sample()                                      recompute + return a plain object
 *   reset()                                       zero everything
 *   ring()                                        a copy of the dt ring, oldest first
 *
 * ATTRIBUTION. Any other subsystem can tag what it is doing with the exported
 * `markPhase('finalize:sat-building')` — a single string assignment into a
 * reused 16-slot buffer, no allocation. When a frame stalls, the tags seen
 * during it are copied into `lastStall.phases`, so "the world froze for 40 ms"
 * becomes "the world froze for 40 ms during a skirt build". B and D can call
 * it from their finalize paths; A from the LOD walk.
 *
 * COST. Per frame: one subtraction, one ring store, ~6 comparisons and two
 * counter increments — measured budget ~0.01 ms. Percentiles are NOT computed
 * per frame; they are recomputed every `publishEveryFrames` (and on demand via
 * `sample()`), which amortises one 600-element sort to well under a
 * microsecond per frame.
 *
 * FLAG-OFF IS BYTE-IDENTICAL. `FRAME_STATS.enabled:false` means `FrameStatsRig`
 * is never mounted (FlyCanvas guards it), no ring is allocated, no observer is
 * registered, and `window.__flyStats.frame` never exists. `markPhase` compiles
 * to a no-op branch on a module boolean.
 *
 * WHAT IT CANNOT SEE, EVER. Tearing. Tearing is a compositor/vsync property:
 * the GPU scanning out a buffer mid-update. No JS timer and no screenshot can
 * observe it. What a gate CAN assert is the MECHANISM that produces it — that
 * no canvas realloc / composer resize / DPR commit happens outside a rAF, and
 * that the composer's buffers match the drawing buffer every frame. That is
 * verify-step-clean's and verify-frame-pace's "tear mechanism" leg; the tear
 * LINE itself is user-machine-only and is reported as such.
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { FRAME_STATS } from './fly-constants';

const LONG_A = 33; // > 33 ms: a dropped frame at 30 Hz
const LONG_B = 100; // > 100 ms: a visible freeze
const STALL_FLOOR = 28; // the R22.1 stutter definition: dt >= max(2*median, 28)
const PHASE_SLOTS = 16;
const LONG_EVENTS = 512;

let live = null; // the published object, or null when the flag is off
let ring = null;
let ringN = 0;
let ringLen = 0;
const phaseBuf = new Array(PHASE_SLOTS).fill(null);
let phaseN = 0;
const longAt = new Float64Array(LONG_EVENTS); // timestamps of >33 ms frames
const long100At = new Float64Array(LONG_EVENTS);
const stallAt = new Float64Array(LONG_EVENTS);
let longI = 0;
let long100I = 0;
let stallI = 0;

/**
 * Tag what the frame is doing. A no-op when the flag is off, so call sites may
 * be unconditional. Keep tags SHORT and stable — they are read by gates.
 */
export function markPhase(tag) {
  if (!live) return;
  phaseBuf[phaseN++ & (PHASE_SLOTS - 1)] = tag;
}

function ratePerMin(buf, i, now) {
  let n = 0;
  for (let k = 0; k < LONG_EVENTS; k++) {
    const t = buf[k];
    if (t > 0 && now - t <= 60000) n++;
  }
  // The buffer holds at most LONG_EVENTS events; a saturated window is
  // reported at its cap rather than silently under-counted.
  return n;
}

function percentiles(o) {
  if (!ringLen) return;
  const a = Float32Array.prototype.slice.call(ring, 0, ringLen);
  a.sort();
  const at = (q) => a[Math.min(ringLen - 1, Math.floor(q * ringLen))];
  o.p50 = at(0.5);
  o.p95 = at(0.95);
  o.p99 = at(0.99);
  o.worstDtRecent = a[ringLen - 1];
  o.stallThresholdMs = Math.max(2 * o.p50, STALL_FLOOR);
}

function makeLive(size) {
  ring = new Float32Array(size);
  ringN = 0;
  ringLen = 0;
  longI = long100I = stallI = 0;
  longAt.fill(0);
  long100At.fill(0);
  stallAt.fill(0);
  const o = {
    enabled: true,
    count: 0,
    lastDt: 0,
    worstDt: 0,
    worstDtRecent: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    long33: 0,
    long100: 0,
    long33PerMin: 0,
    long100PerMin: 0,
    stalls: 0,
    stallsPerMin: 0,
    stallThresholdMs: STALL_FLOOR,
    longtasks: 0,
    longtaskMs: 0,
    programs: 0,
    programsDelta: 0,
    programsGrewAt: 0,
    geometries: 0,
    textures: 0,
    lastStall: null,
    startedAt: 0,
    sample() {
      percentiles(o);
      const now = performance.now();
      o.long33PerMin = ratePerMin(longAt, longI, now);
      o.long100PerMin = ratePerMin(long100At, long100I, now);
      o.stallsPerMin = ratePerMin(stallAt, stallI, now);
      // A plain, structured-clone-safe copy: page.evaluate must be able to
      // return it, and functions do not survive the bridge.
      const out = {};
      for (const k of Object.keys(o)) if (typeof o[k] !== 'function') out[k] = o[k];
      return out;
    },
    ring() {
      const out = new Array(ringLen);
      for (let i = 0; i < ringLen; i++) out[i] = ring[(ringN - ringLen + i + ring.length) % ring.length];
      return out;
    },
    reset() {
      ringN = ringLen = 0;
      longI = long100I = stallI = 0;
      longAt.fill(0);
      long100At.fill(0);
      stallAt.fill(0);
      o.count = o.long33 = o.long100 = o.stalls = 0;
      o.worstDt = o.worstDtRecent = o.lastDt = 0;
      o.longtasks = o.longtaskMs = 0;
      o.programsDelta = 0;
      o.lastStall = null;
      o.startedAt = performance.now();
    },
  };
  o.startedAt = performance.now();
  return o;
}

/**
 * Mounted by FlyCanvas at priority -101 — AHEAD of the perf governor (-100)
 * and of A's STEP_SAFE rig (-99), so `dt` is the raw inter-frame delta of the
 * frame that just presented and nothing this frame has had a chance to hide.
 */
export function FrameStatsRig() {
  const gl = useThree((s) => s.gl);
  const lastT = useRef(0);
  const pubRef = useRef(0);
  const progRef = useRef(-1);

  useEffect(() => {
    live = makeLive(FRAME_STATS.ringSize | 0 || 600);
    const stats = (window.__flyStats ??= {});
    stats.frame = live;
    let obs = null;
    try {
      obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          live.longtasks++;
          live.longtaskMs += e.duration;
        }
      });
      obs.observe({ entryTypes: ['longtask'] });
    } catch {
      /* not supported — the count simply stays 0 */
    }
    return () => {
      try {
        obs?.disconnect();
      } catch {
        /* ignore */
      }
      if (window.__flyStats?.frame === live) delete window.__flyStats.frame;
      live = null;
      ring = null;
    };
  }, []);

  useFrame(() => {
    const o = live;
    if (!o) return;
    const now = performance.now();
    const prev = lastT.current;
    lastT.current = now;
    if (!prev) return; // the first frame has no delta
    const dt = now - prev;

    ring[ringN % ring.length] = dt;
    ringN++;
    if (ringLen < ring.length) ringLen++;
    o.count++;
    o.lastDt = dt;
    if (dt > o.worstDt) o.worstDt = dt;
    if (dt > LONG_A) {
      o.long33++;
      longAt[longI++ % LONG_EVENTS] = now;
    }
    if (dt > LONG_B) {
      o.long100++;
      long100At[long100I++ % LONG_EVENTS] = now;
    }
    if (dt >= o.stallThresholdMs) {
      o.stalls++;
      stallAt[stallI++ % LONG_EVENTS] = now;
      const phases = [];
      for (let i = 0; i < PHASE_SLOTS; i++) {
        const t = phaseBuf[(phaseN - PHASE_SLOTS + i + PHASE_SLOTS * 2) % PHASE_SLOTS];
        if (t) phases.push(t);
      }
      o.lastStall = { dtMs: dt, atMs: now, phase: phases[phases.length - 1] ?? null, phases };
    }
    phaseN = 0;
    phaseBuf.fill(null);

    // Program-count growth is the ONLY honest signal for a mid-flight
    // recompile storm (recon WB-4) and for a composer rebuild that abandons
    // its passes (R21 S2). Reading `.length` is free; the array is three's.
    const info = gl.info;
    const np = info?.programs?.length ?? 0;
    if (progRef.current < 0) progRef.current = np;
    if (np !== progRef.current) {
      o.programsDelta += np - progRef.current;
      o.programsGrewAt = now;
      progRef.current = np;
    }
    o.programs = np;

    if (o.count - pubRef.current >= (FRAME_STATS.publishEveryFrames | 0 || 30)) {
      pubRef.current = o.count;
      percentiles(o);
      o.long33PerMin = ratePerMin(longAt, longI, now);
      o.long100PerMin = ratePerMin(long100At, long100I, now);
      o.stallsPerMin = ratePerMin(stallAt, stallI, now);
      o.geometries = info?.memory?.geometries ?? 0;
      o.textures = info?.memory?.textures ?? 0;
    }
  }, -101);

  return null;
}
