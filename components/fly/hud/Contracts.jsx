'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePassportStore } from '@/stores/passport-store';
import { useFlyStore } from '@/stores/fly-store';
import { useFlyAtlasStore } from '@/stores/fly-atlas-store';
import { useFlyContractsStore } from '@/stores/fly-contracts-store';
import {
  CONTRACT_TEMPLATES,
  DAILY_TEMPLATE_IDS,
  contractEligible,
  nightNow,
  spotAdvances,
} from '@/lib/fly/contracts';
import { AirportBuzzDetector } from '@/lib/fly/airport-buzz';
import { mercatorScale } from '@/lib/fly/coords';
import { CONTRACTS_LIVING } from '@/lib/fly/fly-constants';
import {
  loadSnapshot,
  reviveEntry,
  saveSnapshot,
  serializeEntry,
} from '@/lib/fly/contract-progress';
import { dailyNowMs, pickDaily, utcDayKey, utcDayNumber } from '@/lib/fly/daily';
import { buildAtlasList } from '@/lib/fly/poi';
import { getStreakDays } from '@/lib/badges';
import { CARD_THEME } from './inspect/inspect-tokens';

const ACTIVE_COUNT = 3;
const OVERFLY_RANGE_M = 2500;
const COMPLETE_LINGER_MS = 2600;

const TPL_BY_ID = new Map(CONTRACT_TEMPLATES.map((t) => [t.id, t]));

const freshEntry = (tpl) => ({ tpl, progress: 0, done: false, hits: new Set(), stale: 0 });

/**
 * Atlas key → tags, built ONCE and lazily (only when a visit-tag contract sees
 * an actual warp). `recents` carries key/name/kind and nothing else, so the
 * boneyard/factory tags have to be looked up on the full destination list.
 * Module scope: buildAtlasList() already memoises, this just avoids re-walking
 * ~2,050 entries on every warp.
 */
let atlasTagIndex = null;
function atlasTagsFor(key) {
  if (!atlasTagIndex) {
    atlasTagIndex = new Map();
    for (const e of buildAtlasList()) {
      if (e.tags && e.tags.length) atlasTagIndex.set(e.key, e.tags);
    }
  }
  return atlasTagIndex.get(key) ?? null;
}

/**
 * CONTRACTS (round 6, Phase F): a quiet INK+ICE objective panel, top-left.
 * Three active contracts rotate as they complete; lifetime score persists
 * (fly-contracts store). All wiring is discrete — store subscriptions for
 * spots / formation / atlas visits and ONE 1Hz interval for everything that
 * has to be sampled. Color appears only on the completion stamp (taste rule 8).
 *
 * ROUND 17 "Your Wings" adds three things and changes no existing one:
 *
 *  1. PROGRESS SURVIVES A RELOAD. The active set + rotation cursor snapshot
 *     into `fly-contracts-active-v1` (a SIBLING key — `fly-contracts` is a
 *     harness contract and keeps its exact envelope). Saves are debounced and
 *     fire only from event context (advance / rotation / pagehide): the round-6
 *     lesson bans store writes inside React state UPDATERS, and a localStorage
 *     write during render is the same mistake wearing a different hat.
 *
 *  2. LIVING-WORLD CONTRACTS. Nine appended templates read the R16 weather,
 *     sun and POI tags. `contractEligible` keeps a weather/night objective off
 *     the board unless the sky can actually deliver it, and an ACTIVE one that
 *     goes stale for CONTRACTS_LIVING.staleSwapSec rotates out silently — no
 *     stamp, no points. That is what stops "fly 60s in rain" sitting on a
 *     clear-sky panel for an hour.
 *
 *  3. THE DAILY SET. Two extra objectives seeded on the UTC day number
 *     (lib/fly/daily.js), identical for every player, paying double. Drawn
 *     from MECHANICAL templates only, so today's pair is completable in any
 *     weather in any style.
 */
export function Contracts({ runtime }) {
  const totalScore = useFlyContractsStore((s) => s.totalScore);
  const completedCount = useFlyContractsStore((s) => s.completedCount);

  // The live world, as the eligibility rules see it. ONE reused object — this
  // is read once per 1Hz tick and per discrete event, never per frame.
  const ctxRef = useRef({ mapStyle: 'toy', wx: null, sunFrac: null });
  const readCtx = () => {
    const c = ctxRef.current;
    c.mapStyle = useFlyStore.getState().mapStyle;
    c.wx = runtime.weather?.wx ?? null;
    c.sunFrac = runtime.sun?.frac ?? null;
    return c;
  };
  const readCtxRef = useRef(readCtx);
  readCtxRef.current = readCtx;

  // Progress lives in a REF and renders via a tick counter: advance() runs
  // from subscriptions/intervals (event context), so its side effects
  // (score write, audio, rotation timer, snapshot save) must NOT sit inside a
  // React state updater — React executes those during render ("cannot update
  // while rendering" — caught by the Phase F harness).
  const stateRef = useRef(null);
  const dailyRef = useRef(null);
  const poolIdx = useRef(ACTIVE_COUNT);
  if (stateRef.current === null) {
    const snap = loadSnapshot();
    const ctx = readCtx();
    const active = [];
    const used = new Set();
    if (snap && Array.isArray(snap.active)) {
      // Restored session. Rows whose template vanished, or that are already
      // complete (they have paid out and were rotating away), are dropped.
      for (const row of snap.active) {
        if (active.length >= ACTIVE_COUNT) break;
        if (used.has(row?.id)) continue;
        const entry = reviveEntry(row, TPL_BY_ID, { dropDone: true });
        if (!entry) continue;
        used.add(entry.tpl.id);
        active.push(entry);
      }
      if (Number.isInteger(snap.poolIdx) && snap.poolIdx >= 0) poolIdx.current = snap.poolIdx;
    } else {
      // FROZEN CONTRACT: a fresh player always starts on the first three
      // templates, in order. Every harness boots into a fresh context.
      for (const tpl of CONTRACT_TEMPLATES.slice(0, ACTIVE_COUNT)) {
        active.push(freshEntry(tpl));
        used.add(tpl.id);
      }
    }
    // Refill anything the restore dropped, honouring eligibility.
    while (active.length < ACTIVE_COUNT) {
      const tpl = takeFromPool(used, poolIdx, ctx);
      if (!tpl) break;
      used.add(tpl.id);
      active.push(freshEntry(tpl));
    }
    stateRef.current = active;

    // Daily: keep TODAY's snapshot (completed dailies stay stamped until
    // rollover, so `dropDone` is deliberately off); otherwise pick fresh.
    const dayKey = utcDayKey(dailyNowMs());
    const sd = snap?.daily;
    if (sd && sd.dayKey === dayKey && Array.isArray(sd.entries)) {
      dailyRef.current = {
        dayKey,
        entries: sd.entries.map((r) => reviveEntry(r, TPL_BY_ID)).filter(Boolean),
      };
    } else {
      dailyRef.current = { dayKey, entries: pickDailyEntries(dailyNowMs()) };
    }
  }
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const [streakDays, setStreakDays] = useState(0);

  // --- snapshot persistence (debounced, event-context only) ----------------
  const saveTimer = useRef(null);
  const saveNow = () => {
    saveSnapshot({
      poolIdx: poolIdx.current,
      active: stateRef.current.filter((c) => !c.done).map(serializeEntry),
      daily: dailyRef.current
        ? { dayKey: dailyRef.current.dayKey, entries: dailyRef.current.entries.map(serializeEntry) }
        : null,
    });
  };
  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;
  const scheduleSave = () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveNowRef.current(), CONTRACTS_LIVING.saveDebounceMs);
  };
  useEffect(() => {
    // pagehide is the reliable tab-close/refresh signal (the FlyMode
    // last-position pattern); the debounce alone would lose the last ~800ms.
    const flush = () => saveNowRef.current();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      clearTimeout(saveTimer.current);
    };
  }, []);

  // --- rotation ------------------------------------------------------------
  const timersRef = useRef(new Set());
  const rotate = (id, requireDone) => {
    const cur = stateRef.current.find((c) => c.tpl.id === id);
    if (!cur || (requireDone && !cur.done)) return;
    const activeIds = new Set(stateRef.current.map((a) => a.tpl.id));
    const tpl = takeFromPool(activeIds, poolIdx, readCtxRef.current());
    if (!tpl) return; // nothing eligible right now — leave the row as it is
    stateRef.current = stateRef.current.map((cc) =>
      cc.tpl.id === id ? freshEntry(tpl) : cc
    );
    rerender();
    scheduleSave();
  };
  const rotateRef = useRef(rotate);
  rotateRef.current = rotate;

  // Advance helper: bump matching active contracts (and dailies); complete +
  // rotate. `key` dedups per contract (hexes / landmark names / atlas keys).
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
        useFlyContractsStore
          .getState()
          .addCompletion(c.tpl.pts, { id: c.tpl.id, label: c.tpl.label });
        runtime.audio?.spotBlip?.(2);
        const id = c.tpl.id;
        // Rotate in a replacement after the stamp lingers
        const timer = setTimeout(() => {
          timersRef.current.delete(timer);
          rotateRef.current(id, true);
        }, COMPLETE_LINGER_MS);
        timersRef.current.add(timer);
      }
      return { ...c, progress, done };
    });
    // Dailies use the same matchers but never rotate — a finished one stays
    // stamped on the panel until UTC rollover.
    const daily = dailyRef.current;
    if (daily) {
      const mult = CONTRACTS_LIVING.daily.mult;
      for (const e of daily.entries) {
        if (e.done || !matchFn(e.tpl)) continue;
        if (key != null && e.hits.has(key)) continue;
        if (key != null) e.hits.add(key);
        e.progress = Math.min(e.tpl.target, e.progress + 1);
        changed = true;
        if (e.progress >= e.tpl.target) {
          e.done = true;
          useFlyContractsStore
            .getState()
            .addCompletion(e.tpl.pts * mult, { id: e.tpl.id, label: e.tpl.label, daily: true });
          runtime.audio?.spotBlip?.(3);
        }
      }
    }
    if (changed) {
      rerender();
      scheduleSave();
    }
  };
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const active = stateRef.current;
  const daily = dailyRef.current?.entries ?? [];

  // Dev-only store registry. verify-contracts.js has reached for
  // `window.__flyStores` since round 6 (it found undefined and fell back to the
  // product path); the living-contracts harness needs the atlas store to drive
  // a synthetic visit, so the handle is now real. Dev builds only, like
  // window.__fly / window.__flyStore.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return;
    window.__flyStores = {
      usePassportStore,
      useFlyAtlasStore,
      useFlyContractsStore,
      useFlyStore,
    };
  }, []);

  // Passport spots → spot-* contracts (and the streak readout)
  useEffect(() => {
    let lastTs = usePassportStore.getState().spottedAircraft[0]?.timestamp ?? 0;
    setStreakDays(getStreakDays(usePassportStore.getState().stats.spotsByDay));
    return usePassportStore.subscribe((s) => {
      const fresh = [];
      for (const spot of s.spottedAircraft) {
        if (spot.timestamp <= lastTs) break;
        fresh.push(spot);
      }
      if (!fresh.length) return;
      lastTs = s.spottedAircraft[0].timestamp;
      // One ctx read per BATCH — the sky cannot change between two spots that
      // arrived in the same store update.
      const night = nightNow(readCtxRef.current());
      for (const spot of fresh) {
        advanceRef.current((tpl) => spotAdvances(tpl, spot, { night }), spot.hex);
      }
      setStreakDays(getStreakDays(s.stats.spotsByDay));
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

  // Atlas visits → visit-kind + (R17) visit-tag contracts
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
      const tags = atlasTagsFor(head.key);
      if (tags) {
        advanceRef.current(
          (tpl) => tpl.kind === 'visit-tag' && tags.includes(tpl.tag),
          head.key
        );
      }
    });
  }, []);

  // 1Hz: altitude + overflight + airport buzz/touch-and-go + (R17) the living
  // world (weather holds, fog distance, overcast top, night buzz), the daily
  // rollover check, and the stale-eligibility swap.
  const detectorRef = useRef(null);
  const accumRef = useRef({ fogM: 0 });
  useEffect(() => {
    // Pending rotation timers: captured here so the cleanup below clears the
    // SAME set it armed (a completed row's rotation must not fire into an
    // unmounted panel).
    const timers = timersRef.current;
    // Warp teleports must not mint a low pass — hard-reset the detector
    let prevEpoch = useFlyStore.getState().warpEpoch;
    const unsub = useFlyStore.subscribe((s) => {
      if (s.warpEpoch !== prevEpoch) {
        prevEpoch = s.warpEpoch;
        detectorRef.current?.reset();
      }
    });
    const id = setInterval(() => {
      const ctx = readCtxRef.current();

      // --- daily rollover: plain UTC string compare, no Date arithmetic ----
      const dayKey = utcDayKey(dailyNowMs());
      if (dailyRef.current && dailyRef.current.dayKey !== dayKey) {
        dailyRef.current = { dayKey, entries: pickDailyEntries(dailyNowMs()) };
        rerender();
        scheduleSave();
      }

      const f = runtime.flight;
      if (!f) return;
      advanceRef.current((tpl) => tpl.kind === 'altitude' && f.pos.y >= tpl.altM);
      const slots = runtime.poiSlots ?? [];
      for (const p of slots) {
        // R17: hotspots ride the SAME slot snapshot the landmark pass reads —
        // PoiLetters selects them (KIND_ORDER includes 'hotspot', LETTERS.hotspot
        // max 2), so no second POI scan is needed.
        const isLandmark = p.kind === 'landmark';
        const isHotspot = p.kind === 'hotspot';
        if (!isLandmark && !isHotspot) continue;
        const d = Math.hypot(p.wx - f.pos.x, p.wz - f.pos.z);
        if (isLandmark && d < OVERFLY_RANGE_M) {
          advanceRef.current((tpl) => tpl.kind === 'overfly', p.name);
        }
        if (isHotspot && d < CONTRACTS_LIVING.overflyRangeM) {
          advanceRef.current(
            (tpl) => tpl.kind === 'overfly-kind' && tpl.poiKind === 'hotspot',
            p.name
          );
        }
      }

      // --- R17 living world (satellite only; toy has neither wx nor sun) ---
      const wx = ctx.wx;
      const P = CONTRACTS_LIVING.progress;
      if (ctx.mapStyle === 'satellite' && wx && wx.found) {
        if (wx.precip !== 'none' && wx.precipT > P.precipT) {
          advanceRef.current((tpl) => tpl.kind === 'weather-hold' && tpl.wx === 'precip');
        }
        if (wx.fogT > P.fogT) {
          // Distance, not time: the fog leg is 8 km however fast you fly it.
          accumRef.current.fogM += Math.max(0, f.speed);
          while (accumRef.current.fogM >= CONTRACTS_LIVING.fogStepM) {
            accumRef.current.fogM -= CONTRACTS_LIVING.fogStepM;
            advanceRef.current((tpl) => tpl.kind === 'weather-distance' && tpl.wx === 'fog');
          }
        }
        if (Math.hypot(wx.windX, wx.windZ) >= P.windMps && f.agl > P.windAglM) {
          advanceRef.current((tpl) => tpl.kind === 'weather-hold' && tpl.wx === 'wind');
        }
        if (wx.overcastT > P.overcastT && f.pos.y >= P.overcastAltM) {
          advanceRef.current((tpl) => tpl.kind === 'weather-alt' && tpl.wx === 'overcast');
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
        const afterDark = ev.type === 'buzz' && nightNow(ctx);
        advanceRef.current(
          (tpl) => tpl.kind === kind || (afterDark && tpl.kind === 'buzz-night'),
          ev.airport.name
        );
        useFlyStore
          .getState()
          .setBuzz({ airport: ev.airport.name, kind: ev.type, at: Date.now() });
      }

      // --- stale living contracts rotate out, silently ---------------------
      let staleId = null;
      for (const c of stateRef.current) {
        if (c.done || !c.tpl.requires) {
          c.stale = 0;
          continue;
        }
        if (contractEligible(c.tpl, ctx)) {
          c.stale = 0;
          continue;
        }
        c.stale = (c.stale ?? 0) + 1;
        if (c.stale >= CONTRACTS_LIVING.staleSwapSec && staleId === null) staleId = c.tpl.id;
      }
      if (staleId !== null) rotateRef.current(staleId, false);
    }, 1000);
    return () => {
      clearInterval(id);
      unsub();
      for (const t of timers) clearTimeout(t);
      timers.clear();
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
        <div
          className="mb-1.5 font-mono text-[9px] leading-3"
          style={{ color: CARD_THEME.iceFaint }}
          data-testid="contracts-completed"
        >
          ✓ {completedCount} lifetime · 🔥 {streakDays}d
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
        {daily.length > 0 && (
          <div
            className="mt-1 border-t pt-1"
            style={{ borderColor: 'rgba(148, 163, 184, 0.12)' }}
            data-testid="contracts-daily"
          >
            {daily.map((c) => (
              <div
                key={c.tpl.id}
                className="flex items-start justify-between gap-2 py-1"
                // A daily may draw a template that is ALSO active — a distinct
                // testid namespace keeps `contract-<id>` unambiguous.
                data-testid={`contract-daily-${c.tpl.id}`}
                data-done={c.done ? '1' : '0'}
              >
                <span className="font-mono text-[11px] leading-4">
                  <span
                    className="mr-1 text-[8px] uppercase tracking-[0.24em]"
                    style={{ color: CARD_THEME.iceFaint }}
                  >
                    daily
                  </span>
                  <span
                    style={{
                      color: c.done ? 'var(--contract-done, #4ade80)' : CARD_THEME.iceDim,
                      textDecoration: c.done ? 'line-through' : 'none',
                    }}
                  >
                    {c.tpl.label}
                  </span>
                </span>
                <span
                  className="shrink-0 font-mono text-[10px]"
                  style={{ color: c.done ? '#4ade80' : CARD_THEME.iceFaint }}
                >
                  {c.done
                    ? `+${c.tpl.pts * CONTRACTS_LIVING.daily.mult}`
                    : `${c.progress}/${c.tpl.target}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Walk the template pool for the next candidate that is neither already active
 * nor currently ineligible. The cursor advances on EVERY inspection (including
 * skips) — the round-6 behaviour — so the wheel keeps moving instead of
 * re-offering the same blocked template forever.
 */
function takeFromPool(activeIds, poolIdx, ctx) {
  for (let n = 0; n < CONTRACT_TEMPLATES.length; n++) {
    const cand = CONTRACT_TEMPLATES[poolIdx.current % CONTRACT_TEMPLATES.length];
    poolIdx.current += 1;
    if (activeIds.has(cand.id)) continue;
    if (!contractEligible(cand, ctx)) continue;
    return cand;
  }
  return null;
}

/** Today's daily entries, from the UTC-day-seeded pick. */
function pickDailyEntries(nowMs) {
  return pickDaily(utcDayNumber(nowMs), DAILY_TEMPLATE_IDS, CONTRACTS_LIVING.daily.count)
    .map((id) => TPL_BY_ID.get(id))
    .filter(Boolean)
    .map(freshEntry);
}
