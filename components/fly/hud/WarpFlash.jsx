'use client';

import { useEffect, useRef, useState } from 'react';
import { ARRIVAL_GATE, MOBILE_UI, WARP } from '@/lib/fly/fly-constants';
import { useDeviceLayout } from '@/hooks/use-device-layout';
import { arrivalOn, arrivalTerms, markReveal } from '@/lib/fly/settle';
import { useFlyStore } from '@/stores/fly-store';

/**
 * Warp arrival treatment, keyed on fly-store.warpEpoch.
 *
 * Local warps (target warp / short hop): the original 900ms white flash +
 * ring + "WARP" stamp. Pure DOM/CSS — nothing per-frame.
 *
 * Far warps (round 6, warpKind 'far'): streak → hold → reveal. The hold
 * keeps an ink overlay up while the destination streams in, polling world
 * readiness at 4Hz (toy chunk counts via runtime.toyStats, tile downloads
 * via runtime.engine.downloading in the raster styles), bounded by
 * WARP.far.holdMinMs/holdMaxMs so a slow network can never trap the
 * player. The destination name rides the hold in Archivo Black.
 */
export function WarpFlash({ runtime }) {
  const warpEpoch = useFlyStore((s) => s.warpEpoch);
  // Round 17: layout/particle budget only — no stage or timing logic reads it.
  const { isPhone: phone } = useDeviceLayout();
  const [stage, setStage] = useState(null); // 'flash' | 'streak' | 'hold' | 'reveal'
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  useEffect(() => {
    if (warpEpoch === 0) return undefined;
    const kind = useFlyStore.getState().warpKind;
    let cancelled = false;
    const timers = [];
    const t0 = performance.now();
    const gate = arrivalOn();
    // R22 (B ↔ E CONTRACT): `runtime.arrivalStats` tells a gate WHICH cap is in
    // force for THIS warp before it judges the hold — without it a correct
    // 6500 ms content-held reveal is indistinguishable from a runaway one, and
    // verify-arrival would call the fix a failure. `undefined` (never
    // published, or gateArmed false) = the legacy 3500 ms world.
    const stats = (row) => {
      if (!runtimeRef.current) return;
      runtimeRef.current.arrivalStats = {
        gateArmed: gate,
        kind,
        epoch: warpEpoch,
        holdStartAt: t0,
        revealAt: null,
        reason: null,
        ...row,
      };
    };
    /** The ledger row this warp writes, read by verify-arrival and the soak. */
    const note = (row) => {
      const holdMs = Math.round(performance.now() - t0);
      stats({
        holdCapMs: row.holdMax ?? row.capMs ?? null,
        revealAt: performance.now(),
        holdMs,
        reason: row.reason ?? (row.capped ? 'cap' : 'content'),
        terms: row.terms ?? null,
      });
      if (typeof window === 'undefined') return;
      (window.__flyStats ??= {}).warpGate = {
        kind,
        epoch: warpEpoch,
        gate,
        holdMs,
        ...row,
      };
    };
    if (kind !== 'far') {
      setStage('flash');
      // ROUND 22 (B SETTLE) — LOCAL WARPS GOT NO POLL AT ALL. A 900 ms flash,
      // then whatever the tile tree happened to have. That is fine for a
      // 5 km target hop and wrong for a 90 km one, which is still 'local'.
      //
      // The hold is BOUNDED and CONDITIONAL: it arms only when the camera's
      // resident leaf is more than `localHoldDeficit` zoom levels short of
      // what the LOD math wants (i.e. the ground really is coarse), and it can
      // never exceed localHold.maxMs. With no terraStats (A not merged, toy
      // style, flag off) the deficit is unknowable and this is the R21 flash,
      // to the millisecond.
      const L = ARRIVAL_GATE.localHold;
      const deficitOf = () => {
        const ts = runtimeRef.current?.terraStats;
        if (!ts || !Number.isFinite(ts.camTileZ) || !Number.isFinite(ts.targetZ)) return null;
        return ts.targetZ - ts.camTileZ;
      };
      // W3 FIX (verify-arrival 9b was RED: deficit 3 revealed with a 0 ms
      // hold). TWO defects, both in this branch, both found by E's instrument:
      //
      //  (i)  THE DEFICIT WAS SAMPLED AT WARP DISPATCH. At that instant
      //       `terraStats.camTileZ` is still the leaf under the DEPARTURE
      //       pose — the camera has been teleported but the quadtree has not
      //       re-evaluated and the stats publish at 2 Hz — so the deficit read
      //       ~0 and the hold could never arm. The destination's coarseness
      //       only becomes a fact after the flash, which is exactly where E
      //       measures it (camTileZ before vs after). So the deficit is now
      //       evaluated AT FLASH-END and re-polled, never at dispatch.
      //  (ii) THE HOLD HAD NO OBSERVABLE STAGE. The local branch renders the
      //       flash markup, which carries no `data-testid="warp-hold"` — so a
      //       hold of any length measured 0 ms, because E's trace (and the
      //       player) had nothing to see. The extension now renders a real,
      //       brief veil carrying the testid and `data-stage="hold"`.
      //
      // THE 250 ms CONTRACT: verify-warp-arrival asserts `local warp → plain
      // flash (no hold)` sampled 250 ms after the click, and that gate is
      // FROZEN. The extension begins at WARP.flashMs (900 ms) and the flash
      // stage is left exactly as it was, testid and all — so the common case
      // (deficit <= localHoldDeficit, or no terraStats at all) is the R21
      // 900 ms flash to the millisecond, and the frozen gate never sees a
      // hold because at 250 ms there is none to see.
      const endFlash = () => {
        if (cancelled) return;
        // `gate &&` is load-bearing, not defensive: without it the hold arms
        // with ARRIVAL_GATE disabled, which breaks the block's flag-off
        // byte-identity contract. (Caught by the control arm of
        // scripts/r22-b-localwarp.js holding 1468 ms with the flag off.)
        const d = gate ? deficitOf() : null;
        if (d == null || d <= L.localHoldDeficit) {
          markReveal('warp');
          // `terraSeen` makes the no-hold case SELF-DESCRIBING: a gate that
          // finds holdMs 0 needs to know whether the deficit was genuinely
          // small (feature working) or unknowable because A's terraStats was
          // absent (fleet pin / TERRA off ⇒ the documented legacy path). Those
          // are opposite verdicts and they looked identical before.
          note({
            localHeld: false,
            deficit: d,
            terraSeen: !!runtimeRef.current?.terraStats,
            reason: d == null ? 'no-deficit-signal' : 'flash',
          });
          setStage(null);
          return;
        }
        // Genuinely coarse ground: a bounded veil while it sharpens.
        setStage('localhold');
        stats({ holdCapMs: WARP.flashMs + L.maxMs, deficit: d });
        const poll = setInterval(() => {
          const el = performance.now() - t0;
          const dd = deficitOf();
          const capped = el >= WARP.flashMs + L.maxMs;
          if (!((dd != null && dd <= L.localHoldDeficit) || capped)) return;
          clearInterval(poll);
          if (cancelled) return;
          markReveal('warp');
          note({ localHeld: true, deficit: dd, capped, reason: capped ? 'cap' : 'content' });
          setStage(null);
        }, 120);
        timers.push({ _i: poll });
      };
      stats({ holdCapMs: WARP.flashMs }); // armed; raised if the extension fires
      timers.push(setTimeout(endFlash, WARP.flashMs));
    } else {
      setStage('streak');
      timers.push(setTimeout(() => !cancelled && setStage('hold'), WARP.flashMs));
      // R22 SANCTIONED (plan §5.1): WARP.far.holdMaxMs 3500 → 6500, consumed
      // ONLY through ARRIVAL_GATE.holdMaxMs and only with the flag on. The
      // WARP block itself is untouched, and the TIME CAP ALWAYS WINS — a slow
      // network can never trap the player behind the overlay (the R6 charter).
      const holdMax = gate ? ARRIVAL_GATE.holdMaxMs : WARP.far.holdMaxMs;
      stats({ holdCapMs: holdMax }); // armed, in flight — readable DURING the hold
      const poll = setInterval(() => {
        const el = performance.now() - t0;
        if (el < WARP.far.holdMinMs) return;
        const rt = runtimeRef.current;
        const ts = rt?.toyStats;
        let ready;
        let terms = null;
        if (ts) {
          // TOY is unchanged: its chunk counts ARE a content test already.
          ready =
            ts.ready >= WARP.far.readyChunks ||
            (ts.chunks > 0 && ts.ready / ts.chunks >= WARP.far.readyFrac);
        } else if (gate) {
          // SATELLITE, "hold until sharp" (user decision 2026-08-07). The old
          // test was `engine.downloading < 3` — an INSTANTANEOUS in-flight
          // count with no content in it at all, which is why an FL300 warp to
          // Dublin revealed low-zoom ground: at that moment nothing was
          // downloading because nothing had been ASKED for yet.
          const aglM = Math.max(0, (rt?.geo?.z ?? 0) - (rt?.groundElevVis ?? 0));
          terms = arrivalTerms(rt, aglM);
          ready = terms.ready;
        } else {
          ready = (rt?.engine?.downloading ?? 0) < WARP.far.readyDownloads;
        }
        const capped = el >= holdMax;
        if (ready || capped) {
          clearInterval(poll);
          if (cancelled) return;
          markReveal('warp');
          note({ capped, ready, terms, holdMax });
          setStage('reveal');
          timers.push(setTimeout(() => !cancelled && setStage(null), WARP.far.revealMs));
        }
      }, 250);
      timers.push({ _i: poll });
    }
    return () => {
      cancelled = true;
      for (const t of timers) (t?._i != null ? clearInterval(t._i) : clearTimeout(t));
    };
  }, [warpEpoch]);

  if (!stage) return null;

  if (stage === 'flash') {
    return (
      <div key={warpEpoch} className="pointer-events-none absolute inset-0 z-30">
        <style>{`
          @keyframes fly-warp-flash {
            0% { opacity: 1; }
            55% { opacity: 0.55; }
            100% { opacity: 0; }
          }
          @keyframes fly-warp-ring {
            0% { transform: translate(-50%, -50%) scale(0.05); opacity: 0.9; }
            100% { transform: translate(-50%, -50%) scale(3.2); opacity: 0; }
          }
          @keyframes fly-warp-text {
            0% { transform: translate(-50%, -50%) scale(1.6); opacity: 0; letter-spacing: 1.2em; }
            25% { opacity: 1; }
            100% { transform: translate(-50%, -50%) scale(0.9); opacity: 0; letter-spacing: 0.4em; }
          }
        `}</style>
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.95) 0%, rgba(199,222,255,0.65) 35%, rgba(120,170,255,0.15) 70%, transparent 100%)',
            animation: `fly-warp-flash ${WARP.flashMs}ms ease-out forwards`,
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 h-64 w-64 rounded-full border-2 border-white/80 phone:h-[min(16rem,60vw)] phone:w-[min(16rem,60vw)]"
          style={{ animation: `fly-warp-ring ${WARP.flashMs}ms cubic-bezier(0.16, 1, 0.3, 1) forwards` }}
        />
        <div
          className="fly-display-lg absolute left-1/2 top-1/2 max-w-[92vw] font-mono font-bold uppercase text-white"
          style={{ animation: `fly-warp-text ${WARP.flashMs}ms ease-out forwards` }}
        >
          Warp
        </div>
      </div>
    );
  }

  // --- local warp: the bounded post-flash veil (R22 W3) -------------------
  // Deliberately NOT the far-warp ink curtain: a short hop that blacked the
  // screen out would be a worse experience than the blur it is hiding. This is
  // the tail of the flash held at a low constant value for at most
  // localHold.maxMs, which is enough to keep a 3-levels-coarse ground off the
  // screen while it sharpens and little enough to read as the flash settling.
  // It carries the warp-hold testid so the hold is MEASURABLE — the 9b defect
  // was as much "no instrument" as "no hold".
  if (stage === 'localhold') {
    return (
      <div
        key={warpEpoch}
        className="pointer-events-none absolute inset-0 z-30"
        data-testid="warp-hold"
        data-stage="hold"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.42) 0%, rgba(199,222,255,0.28) 40%, rgba(120,170,255,0.08) 75%, transparent 100%)',
          transition: 'opacity 220ms ease-out',
        }}
      />
    );
  }

  // --- far warp: streak / hold / reveal ---------------------------------
  const arrival = useFlyStore.getState().arrival;
  const revealing = stage === 'reveal';
  return (
    <div
      key={warpEpoch}
      className="pointer-events-none absolute inset-0 z-30"
      data-testid="warp-hold"
      data-stage={stage}
      style={{
        opacity: revealing ? 0 : stage === 'streak' ? 1 : 0.92,
        transition: `opacity ${revealing ? WARP.far.revealMs : 250}ms ease-${revealing ? 'in' : 'out'}`,
        background: '#04060f',
      }}
    >
      <style>{`
        @keyframes fly-hyper-streak {
          0% { transform: translate(-50%, -50%) scaleY(0.1); opacity: 0; }
          30% { opacity: 0.9; }
          100% { transform: translate(-50%, -50%) scaleY(60); opacity: 0; }
        }
        @keyframes fly-hold-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
      {/* streak tunnel: a handful of radial lines racing outward */}
      {[...Array(phone ? MOBILE_UI.boot.phoneStreaks : 9)].map((_, i) => (
        <div
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          className="absolute left-1/2 top-1/2 h-2 w-px bg-white/80"
          style={{
            rotate: `${i * 40}deg`,
            translate: `${Math.sin(i * 2.1) * 260}px ${Math.cos(i * 1.7) * 150}px`,
            animation: `fly-hyper-streak 1100ms cubic-bezier(0.5, 0, 0.9, 0.4) ${i * 90}ms infinite`,
          }}
        />
      ))}
      <div
        className="absolute left-1/2 top-1/2 w-[92vw] -translate-x-1/2 -translate-y-1/2 text-center"
        style={{ fontFamily: "'Archivo Black', ui-sans-serif" }}
      >
        <div className="fly-display-xl max-w-[92vw] break-words uppercase text-white" style={{ letterSpacing: phone ? '0.08em' : '0.3em' }}>
          {arrival?.name ?? 'warping'}
        </div>
        <div
          className="mt-3 font-mono text-[11px] uppercase tracking-[0.5em] text-white/60"
          style={{ animation: 'fly-hold-pulse 1.4s ease-in-out infinite' }}
        >
          {stage === 'reveal' ? 'arrived' : 'streaming world'}
        </div>
      </div>
    </div>
  );
}
