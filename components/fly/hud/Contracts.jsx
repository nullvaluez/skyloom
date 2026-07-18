'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePassportStore } from '@/stores/passport-store';
import { useFlyStore } from '@/stores/fly-store';
import { useFlyAtlasStore } from '@/stores/fly-atlas-store';
import { useFlyContractsStore } from '@/stores/fly-contracts-store';
import { CONTRACT_TEMPLATES, spotAdvances } from '@/lib/fly/contracts';
import { AirportBuzzDetector } from '@/lib/fly/airport-buzz';
import { mercatorScale } from '@/lib/fly/coords';
import { CARD_THEME } from './inspect/inspect-tokens';

const ACTIVE_COUNT = 3;
const OVERFLY_RANGE_M = 2500;
const COMPLETE_LINGER_MS = 2600;

/**
 * CONTRACTS (round 6, Phase F): a quiet INK+ICE objective panel, top-left.
 * Three active contracts rotate as they complete; lifetime score persists
 * (fly-contracts store), the active set is session-scoped. All wiring is
 * discrete — store subscriptions for spots / formation / atlas visits and
 * ONE 1Hz interval for altitude + landmark overflight. Color appears only
 * on the completion stamp (taste rule 8).
 */
export function Contracts({ runtime }) {
  const totalScore = useFlyContractsStore((s) => s.totalScore);
  // Progress lives in a REF and renders via a tick counter: advance() runs
  // from subscriptions/intervals (event context), so its side effects
  // (score write, audio, rotation timer) must NOT sit inside a React state
  // updater — React executes those during render ("cannot update while
  // rendering" — caught by the Phase F harness).
  const stateRef = useRef(null);
  if (stateRef.current === null) {
    stateRef.current = CONTRACT_TEMPLATES.slice(0, ACTIVE_COUNT).map((tpl) => ({
      tpl,
      progress: 0,
      done: false,
      hits: new Set(), // dedup keys (hexes / landmark names)
    }));
  }
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const poolIdx = useRef(ACTIVE_COUNT);

  // Advance helper: bump matching active contracts; complete + rotate.
  const advance = (matchFn, key = null) => {
    let changed = false;
    stateRef.current = stateRef.current.map((c) => {
      if (c.done || !matchFn(c.tpl)) return c;
      if (key != null && c.hits.has(key)) return c;
      if (key != null) c.hits.add(key);
      const progress = Math.min(c.tpl.target, c.progress + 1);
      const done = progress >= c.tpl.target;
      changed = true;
      if (done) {
        useFlyContractsStore.getState().addCompletion(c.tpl.pts);
        runtime.audio?.spotBlip?.(2);
        const id = c.tpl.id;
        // Rotate in a replacement after the stamp lingers
        setTimeout(() => {
          const activeIds = new Set(stateRef.current.map((a) => a.tpl.id));
          let tpl = null;
          for (let n = 0; n < CONTRACT_TEMPLATES.length; n++) {
            const cand = CONTRACT_TEMPLATES[poolIdx.current % CONTRACT_TEMPLATES.length];
            poolIdx.current += 1;
            if (!activeIds.has(cand.id)) {
              tpl = cand;
              break;
            }
          }
          stateRef.current = stateRef.current.map((cc) =>
            cc.tpl.id === id && cc.done && tpl
              ? { tpl, progress: 0, done: false, hits: new Set() }
              : cc
          );
          rerender();
        }, COMPLETE_LINGER_MS);
      }
      return { ...c, progress, done };
    });
    if (changed) rerender();
  };
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const active = stateRef.current;

  // Passport spots → spot-* contracts
  useEffect(() => {
    let lastTs = usePassportStore.getState().spottedAircraft[0]?.timestamp ?? 0;
    return usePassportStore.subscribe((s) => {
      const fresh = [];
      for (const spot of s.spottedAircraft) {
        if (spot.timestamp <= lastTs) break;
        fresh.push(spot);
      }
      if (!fresh.length) return;
      lastTs = s.spottedAircraft[0].timestamp;
      for (const spot of fresh) {
        advanceRef.current((tpl) => spotAdvances(tpl, spot), spot.hex);
      }
    });
  }, []);

  // Formation lock → chase contract
  useEffect(() => {
    let prev = useFlyStore.getState().lockState;
    return useFlyStore.subscribe((s) => {
      if (s.lockState !== prev) {
        const was = prev;
        prev = s.lockState;
        if (s.lockState === 'formation' && was !== 'formation') {
          advanceRef.current((tpl) => tpl.kind === 'formation');
        }
      }
    });
  }, []);

  // Atlas visits → visit-kind contracts
  useEffect(() => {
    let prevAt = useFlyAtlasStore.getState().recents[0]?.at ?? 0;
    return useFlyAtlasStore.subscribe((s) => {
      const head = s.recents[0];
      if (!head || head.at <= prevAt) return;
      prevAt = head.at;
      advanceRef.current(
        (tpl) => tpl.kind === 'visit-kind' && head.kind === tpl.poiKind,
        head.key
      );
    });
  }, []);

  // 1Hz: altitude + landmark overflight + airport buzz/touch-and-go
  const detectorRef = useRef(null);
  useEffect(() => {
    // Warp teleports must not mint a low pass — hard-reset the detector
    let prevEpoch = useFlyStore.getState().warpEpoch;
    const unsub = useFlyStore.subscribe((s) => {
      if (s.warpEpoch !== prevEpoch) {
        prevEpoch = s.warpEpoch;
        detectorRef.current?.reset();
      }
    });
    const id = setInterval(() => {
      const f = runtime.flight;
      if (!f) return;
      advanceRef.current((tpl) => tpl.kind === 'altitude' && f.pos.y >= tpl.altM);
      const slots = runtime.poiSlots ?? [];
      for (const p of slots) {
        if (p.kind !== 'landmark') continue;
        const d = Math.hypot(p.wx - f.pos.x, p.wz - f.pos.z);
        if (d < OVERFLY_RANGE_M) {
          advanceRef.current((tpl) => tpl.kind === 'overfly', p.name);
        }
      }
      // Round 7: airport interaction (lib/fly/airport-buzz.js — 1Hz, bbox
      // pre-filtered, elevation lazily cached; a discrete store write from
      // an interval is legal — lesson 4 bans writes inside state UPDATERS)
      detectorRef.current ??= new AirportBuzzDetector();
      const ev = detectorRef.current.update(
        performance.now() / 1000,
        f,
        runtime.engine,
        mercatorScale(f.latDeg)
      );
      if (ev) {
        const kind = ev.type === 'buzz' ? 'airport-buzz' : 'touch-go';
        advanceRef.current((tpl) => tpl.kind === kind, ev.airport.name);
        useFlyStore
          .getState()
          .setBuzz({ airport: ev.airport.name, kind: ev.type, at: Date.now() });
      }
    }, 1000);
    return () => {
      clearInterval(id);
      unsub();
    };
  }, [runtime]);

  return (
    <div
      className="pointer-events-none absolute left-4 top-24 z-10 w-60 select-none max-sm:left-2 max-sm:top-[calc(env(safe-area-inset-top)+8.25rem)] max-sm:w-[10.5rem]"
      data-testid="contracts-panel"
    >
      <div
        className="rounded-xl border px-3 py-2.5 backdrop-blur-sm max-sm:px-2 max-sm:py-2"
        style={{
          background: 'rgba(6, 9, 18, 0.62)',
          borderColor: 'rgba(148, 163, 184, 0.16)',
        }}
      >
        <div className="mb-1.5 flex items-baseline justify-between">
          <span
            className="text-[9px] uppercase tracking-[0.3em]"
            style={{ color: CARD_THEME.iceDim }}
          >
            contracts
          </span>
          <span
            className="font-mono text-[11px]"
            style={{ color: CARD_THEME.ice }}
            data-testid="contracts-score"
          >
            {totalScore.toLocaleString()} pts
          </span>
        </div>
        <AnimatePresence initial={false}>
          {active.map((c) => (
            <motion.div
              key={c.tpl.id}
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 14 }}
              className="flex items-center justify-between gap-2 py-1"
              data-testid={`contract-${c.tpl.id}`}
              data-done={c.done ? '1' : '0'}
            >
              <span
                className="font-mono text-[11px] leading-4"
                style={{
                  color: c.done ? 'var(--contract-done, #4ade80)' : CARD_THEME.iceDim,
                  textDecoration: c.done ? 'line-through' : 'none',
                }}
              >
                {c.tpl.label}
              </span>
              <span
                className="shrink-0 font-mono text-[10px]"
                style={{ color: c.done ? '#4ade80' : CARD_THEME.iceFaint }}
              >
                {c.done ? `+${c.tpl.pts}` : `${c.progress}/${c.tpl.target}`}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
