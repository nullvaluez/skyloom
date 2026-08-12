'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CANVAS, PERF_GOVERNOR, SETTLE_CALM } from '@/lib/fly/fly-constants';
import { autoTierCeiling } from '@/lib/fly/fly-settings';
import { settleOn } from '@/lib/fly/settle';
import { requestDpr } from '@/lib/fly/step-safe';
import { useFlyStore } from '@/stores/fly-store';

/**
 * ROUND 21 (A GOVERNOR, S1) — the adaptive-quality controller that replaces
 * drei's <PerformanceMonitor>.
 *
 * WHY drei's monitor could not stay. It is constructed with no `bounds`, no
 * `flipflops` and no `factor`, so it runs on the library defaults:
 * bounds = (refreshrate) => refreshrate > 90 ? [50, 90] : [50, 60] and
 * flipflops = Infinity (i.e. NO latch — the monitor is allowed to oscillate
 * forever). On the overwhelmingly common 60 Hz desktop the upper bound is
 * therefore 60 — which is EXACTLY the vsync-locked steady-state frame rate, so
 * a perfectly healthy machine sits ON the incline boundary and fires onIncline
 * over and over. Each of those callbacks stepped BOTH rungs at once (dpr +
 * qualityTier), and a tier step unmounts satellite layers, evicts city rings
 * and rebuilds the whole post chain. FlyCanvas' own comment named the failure
 * mode a full round before it was diagnosed: "the hitch IS the flap".
 *
 * WHAT THIS DOES DIFFERENTLY.
 *  1. ONE ladder, DPR rungs ABOVE tier rungs. A step is a step — never both
 *     at once. Cheap knob first, structural knob last.
 *  2. Decisions are made on an EMA of frame time with a DWELL requirement
 *     (downHoldSec / upHoldSec*) and a COOLDOWN after each step, so a single
 *     hitch can never move a rung and a step's own cost cannot re-trigger it.
 *  3. Up-steps are far lazier than down-steps (8 s / 30 s dwell vs 1.5 s) —
 *     rescuing frame time is urgent, spending it again is not.
 *  4. SESSION LATCH: if the ladder descends onto a rung it had previously
 *     ascended THROUGH less than latchWindowSec ago, that rung's ceiling
 *     latches for the rest of the session. A first visit never latches, so a
 *     genuinely capable machine that dipped once still walks back up; a
 *     machine that cannot hold the higher rung stops trying. This is the
 *     flip-flop killer and it is the entire reason the class of defect the
 *     user reported ("everything will flash, reappear, disappear") cannot
 *     recur — a flip-flop is by construction a bounded, once-per-rung event.
 *  5. Sampling is SUPPRESSED during boot (until __flyBoot.pct === 100 plus
 *     bootGraceSec) and for warpGraceSec after every warp or style flip. Those
 *     are the three windows where frame time legitimately collapses while the
 *     world streams, and the legacy monitor read them as hardware verdicts.
 *  6. `window.__flyGovPin === 'hold'` freezes the boot DPR + tier outright —
 *     the harness-fleet determinism pin (scripts/_boot.js), same idiom as
 *     __flyWeatherOverride / __flyAerialOverride. Explicit __flyGov.force()
 *     still works so the stability gates can drive steps deliberately.
 *
 * The controller is a plain object (createGovernor) so it is testable without
 * a renderer; <PerfGovernor> is the ~20-line React shell that feeds it dt.
 * PERF_GOVERNOR.enabled:false ⇒ this module never mounts and FlyCanvas renders
 * the R20 <PerformanceMonitor> JSX byte-identically.
 */

const TIERS = ['low', 'medium', 'high'];

/** The boot DPR — identical arithmetic to FlyCanvas' own initialDpr(). */
function bootDpr() {
  if (typeof window === 'undefined') return CANVAS.dprMax;
  return Math.min(CANVAS.dprMax, window.devicePixelRatio || 1);
}

/**
 * Build the ladder for THIS session: DPR rungs from the boot DPR down to
 * CANVAS.dprMin in CANVAS.dprStep increments, then tier rungs from the boot
 * tier down to 'low' at dprMin.
 *
 * Index 0 is the BOOT state and the governor never ascends above it. That is a
 * deliberate (small) departure from the legacy monitor, which on desktop would
 * walk a player who had explicitly picked 'low' all the way back up to 'high'
 * because autoTierCeiling() is unconditionally 'high' off-phone. A ladder
 * anchored at the boot state honours the pre-mount resolution in
 * fly-settings.js — the R11 lesson ("build at the tier the player chose")
 * applied to the up-step direction. autoTierCeiling() is still consulted on
 * every ascent, so the phone ceiling keeps working exactly as before.
 */
function buildLadder(dpr0, tier0) {
  const rungs = [];
  const step = CANVAS.dprStep;
  // ROUND 22 (B SETTLE, plan §5.8) — THE dpr-1 DEGENERACY.
  //
  // On the overwhelmingly common devicePixelRatio-1 display, dpr0 resolves to
  // min(dprMax 1.5, 1) = 1 and CANVAS.dprMin is also 1, so the loop below runs
  // ZERO times and the ladder is [ {1, boot tier}, {1, medium}, {1, low} ]. The
  // governor's whole design — "cheap knob first, structural knob last" — is
  // therefore inoperative on exactly those machines: its FIRST step is a tier
  // step, which unmounts satellite layers, evicts city rings and rebuilds the
  // post chain. That structural step is the visible hitch a few seconds after
  // boot, on a machine whose only real problem was a transient.
  //
  // The fix extends the ladder BELOW native (render scale, not resolution:
  // r3f's setDpr resizes the drawing buffer and the browser upscales) at a
  // finer sub-native step, so at least two render-scale rungs stand between
  // the boot state and the first tier step. Flag off (or pinned) ⇒ the two
  // constants below are CANVAS.dprMin / CANVAS.dprStep and this function is
  // the R21 one line for line.
  const fix = settleOn() && SETTLE_CALM.ladderFix ? SETTLE_CALM.ladderFix : null;
  // R22 SANCTIONED (§5.8): CANVAS.dprMin 1 → 0.75, governor ladder only.
  const dprMin = fix ? Math.min(CANVAS.dprMin, fix.dprMin) : CANVAS.dprMin;
  for (let d = dpr0; d > dprMin + 1e-6; ) {
    rungs.push({ dpr: +d.toFixed(4), tier: tier0 });
    // Below native the rungs get finer: a 1× display would otherwise buy a
    // single 0.75 rung and be back to a tier step immediately.
    d -= fix && d <= 1 + 1e-6 ? fix.subStep : step;
  }
  rungs.push({ dpr: dprMin, tier: tier0 });
  const t0 = Math.max(0, TIERS.indexOf(tier0));
  for (let i = t0 - 1; i >= 0; i--) rungs.push({ dpr: dprMin, tier: TIERS[i] });
  return rungs;
}

/** p95 of an ascending-sortable sample array (the FAST end of the fps spread). */
function p95(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}

/**
 * The controller. Pure logic + two injected effectors (applyDpr / applyTier);
 * `now` is always passed in, so a test can drive it with a synthetic clock.
 */
export function createGovernor({ dpr0, tier0, applyDpr, applyTier, cfg = PERF_GOVERNOR }) {
  const ladder = buildLadder(dpr0, tier0);
  const g = {
    ladder,
    idx: 0,
    ceilingIdx: 0, // latched ceiling: the ladder can never ascend above this
    latched: false,
    emaDt: 0,
    emaFps: 0,
    refresh: 0,
    targetFps: 60,
    dprSteps: 0,
    tierSteps: 0,
    // dwell / cooldown bookkeeping (all seconds on the useFrame clock)
    belowSince: null,
    aboveSince: null,
    cooldownUntil: 0,
    warpUntil: 0,
    graceUntil: null, // resolved once __flyBoot hits 100
    // rung index -> clock time it was last ascended THROUGH (left upward)
    ascendedAt: new Map(),
    samples: [],
    sampled: 0,
  };

  const rung = () => g.ladder[g.idx];

  function apply(nextIdx, clock) {
    const from = g.ladder[g.idx];
    const to = g.ladder[nextIdx];
    if (!to) return false;
    const dprMoved = Math.abs(to.dpr - from.dpr) > 1e-6;
    const tierMoved = to.tier !== from.tier;
    g.idx = nextIdx;
    if (dprMoved) {
      g.dprSteps++;
      applyDpr(to.dpr);
    }
    if (tierMoved) {
      g.tierSteps++;
      applyTier(to.tier);
    }
    g.cooldownUntil = clock + (tierMoved ? cfg.cooldownSecTier : cfg.cooldownSecDpr);
    g.belowSince = null;
    g.aboveSince = null;
    // A step changes the cost of the frame; the EMA must not carry the old
    // regime's verdict into the new rung's dwell window.
    g.emaDt = 0;
    return dprMoved || tierMoved;
  }

  /** Explicit step, used by __flyGov.force() and by the stability harnesses.
   *  Bypasses dwell, cooldown, the pin AND the latch ceiling on purpose — it
   *  is a test command, not a measurement, and it deliberately leaves the
   *  latch bookkeeping untouched so a forced down/up cycle cannot poison the
   *  session it is measuring. */
  g.force = (dir, clock = 0) => {
    const next = Math.min(g.ladder.length - 1, Math.max(0, g.idx + (dir < 0 ? 1 : -1)));
    if (next === g.idx) return false;
    return apply(next, clock);
  };

  g.setWarpGrace = (clock) => {
    g.warpUntil = clock + cfg.warpGraceSec;
    g.belowSince = null;
    g.aboveSince = null;
    g.emaDt = 0;
  };

  /** One frame. dt in seconds, clock = cumulative seconds since mount. */
  g.tick = (dt, clock, opts = {}) => {
    const { pinned = false, bootPct = 0 } = opts;

    // ---- grace windows -------------------------------------------------
    if (g.graceUntil == null) {
      if (bootPct >= 100) g.graceUntil = clock + cfg.bootGraceSec;
      return;
    }
    if (clock < g.graceUntil || clock < g.warpUntil) return;

    // A stall (tab blur, GC monster, a synchronous tile finalize) is not a
    // hardware verdict. Drop the sample AND the dwell timers: sustained
    // slowness shows up as many mediocre frames, never as one enormous one.
    if (!(dt > 0) || dt > cfg.outlierDtSec) {
      g.belowSince = null;
      g.aboveSince = null;
      return;
    }

    // ---- EMA of frame time --------------------------------------------
    const a = 1 - Math.exp(-dt / Math.max(0.05, cfg.emaTauSec));
    g.emaDt = g.emaDt > 0 ? g.emaDt + (dt - g.emaDt) * a : dt;
    g.emaFps = 1 / g.emaDt;

    // ---- one-shot refresh estimate -------------------------------------
    if (g.refresh === 0) {
      g.samples.push(1 / dt);
      if (g.samples.length >= cfg.refreshFrames) {
        const est = p95(g.samples);
        let best = cfg.refreshSnap[0];
        for (const s of cfg.refreshSnap) {
          if (Math.abs(s - est) < Math.abs(best - est)) best = s;
        }
        g.refresh = best;
        g.targetFps = Math.min(60, best);
        g.samples.length = 0;
      }
      return; // never step while the target is still unknown
    }
    g.sampled++;

    if (pinned) return; // __flyGovPin === 'hold'
    if (clock < g.cooldownUntil) return;

    // ---- down ----------------------------------------------------------
    if (g.emaFps < cfg.downFrac * g.targetFps) {
      g.aboveSince = null;
      if (g.belowSince == null) g.belowSince = clock;
      if (clock - g.belowSince >= cfg.downHoldSec && g.idx < g.ladder.length - 1) {
        const next = g.idx + 1;
        // SESSION LATCH: we are descending onto a rung we climbed out of
        // recently. The higher rung is not sustainable on this machine in this
        // scene; stop offering it.
        const left = g.ascendedAt.get(next);
        if (left != null && clock - left <= cfg.latchWindowSec) {
          g.ceilingIdx = Math.max(g.ceilingIdx, next);
          g.latched = true;
        }
        apply(next, clock);
      }
      return;
    }

    // ---- up ------------------------------------------------------------
    if (g.emaFps > cfg.upFrac * g.targetFps) {
      g.belowSince = null;
      if (g.aboveSince == null) g.aboveSince = clock;
      const next = g.idx - 1;
      if (next < g.ceilingIdx) return; // latched (or already at the top)
      const target = g.ladder[next];
      if (!target) return;
      const tierUp = target.tier !== rung().tier;
      const hold = tierUp ? cfg.upHoldSecTier : cfg.upHoldSecDpr;
      if (clock - g.aboveSince < hold) return;
      if (tierUp) {
        const ceil = TIERS.indexOf(autoTierCeiling());
        if (ceil >= 0 && TIERS.indexOf(target.tier) > ceil) return;
      }
      // Record that we are LEAVING g.idx upward, so a re-descent onto it
      // inside latchWindowSec latches.
      g.ascendedAt.set(g.idx, clock);
      apply(next, clock);
      return;
    }

    g.belowSince = null;
    g.aboveSince = null;
  };

  g.state = () => ({
    rung: g.idx,
    rungs: g.ladder.length,
    dpr: rung().dpr,
    tier: rung().tier,
    ceilingIdx: g.ceilingIdx,
    latched: g.latched,
    emaFps: +(g.emaFps || 0).toFixed(2),
    refresh: g.refresh,
    targetFps: g.targetFps,
    dprSteps: g.dprSteps,
    tierSteps: g.tierSteps,
    sampled: g.sampled,
  });

  return g;
}

/**
 * The React shell. Mounted INSIDE <Canvas> by FlyCanvas when
 * PERF_GOVERNOR.enabled. useFrame priority -100: ahead of FlyScene's -50
 * flight step, so `dt` is the raw inter-frame delta of the frame that just
 * presented, and nothing this frame has yet had a chance to hide.
 *
 * Returns null — no JSX in this module on purpose, so it stays importable from
 * a plain .js file and from a node context (createGovernor is pure).
 */
export function PerfGovernor({ setDpr }) {
  const clockRef = useRef(0);
  const govRef = useRef(null);

  const gov = useMemo(() => {
    const g = createGovernor({
      dpr0: bootDpr(),
      tier0: useFlyStore.getState().qualityTier,
      // ROUND 22.1 (A FLASH, STEP_SAFE): writing React state HERE is what put
      // the drawing-buffer realloc in a plain task between animation frames —
      // see the STEP_SAFE block in fly-constants.js for the measured ordering.
      // requestDpr parks the value for <StepSafeRig>, which applies renderer +
      // composer and calls this same setDpr inside the frame that then draws.
      // It returns false when the flag is off (or a harness pins it off), and
      // the R22 line below runs unchanged.
      applyDpr: (d) => {
        if (!requestDpr(d)) setDpr(d);
      },
      applyTier: (t) => {
        const store = useFlyStore.getState();
        if (store.qualityTier !== t) store.setQualityTier(t);
      },
    });
    govRef.current = g;
    return g;
    // setDpr is a useState setter — stable for the life of the canvas.
  }, [setDpr]);

  // Warp + style-flip grace. Both are "the world is about to re-stream"
  // signals; neither is a statement about the hardware.
  useEffect(() => {
    const bump = () => gov.setWarpGrace(clockRef.current);
    const un1 = useFlyStore.subscribe((s) => s.warpEpoch, bump);
    const un2 = useFlyStore.subscribe((s) => s.mapStyle, bump);
    return () => {
      un1();
      un2();
    };
  }, [gov]);

  // The harness/dev contract. Published unconditionally: it is a handful of
  // property writes on a rare event, and the stability gates + both soaks read
  // these names verbatim.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__flyGov = {
      force: (dir) => gov.force(dir, clockRef.current),
      state: () => gov.state(),
    };
    if (process.env.NODE_ENV === 'development') {
      // The controller is pure (createGovernor takes its clock and its two
      // effectors as arguments), so a harness can build a SYNTHETIC governor
      // and drive it with a fake clock to assert the ladder, the dwell, the
      // cooldown and the session latch deterministically — none of which can
      // be observed in real time, since the up-dwells alone are 8 s and 30 s.
      window.__flyGovFactory = createGovernor;
    }
    return () => {
      if (window.__flyGov) delete window.__flyGov;
      if (window.__flyGovFactory) delete window.__flyGovFactory;
    };
  }, [gov]);

  const statsRef = useRef(0);
  useFrame((_, delta) => {
    clockRef.current += delta;
    const clock = clockRef.current;
    const pinned = typeof window !== 'undefined' && window.__flyGovPin === 'hold';
    const bootPct = (typeof window !== 'undefined' && window.__flyBoot?.pct) || 0;
    gov.tick(delta, clock, { pinned, bootPct });
    if (typeof window !== 'undefined' && clock - statsRef.current > 0.25) {
      statsRef.current = clock;
      const s = gov.state();
      (window.__flyStats ??= {}).governor = {
        dprSteps: s.dprSteps,
        tierSteps: s.tierSteps,
        latched: s.latched,
        emaFps: s.emaFps,
        refresh: s.refresh,
        rung: s.rung,
        rungs: s.rungs,
        dpr: s.dpr,
        tier: s.tier,
        pinned,
      };
    }
  }, -100);

  return null;
}
