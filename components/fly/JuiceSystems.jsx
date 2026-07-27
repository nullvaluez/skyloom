'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { COMBO, MUSIC, NEARMISS, SESSION, SHAKE } from '@/lib/fly/fly-constants';
import {
  addTrauma,
  beginRun,
  createNearMissDetector,
  decayTrauma,
  endRun,
  getState,
  resetJuice,
  scoreEvent,
  setBoostMirror,
  tickCombo,
} from '@/lib/fly/juice';
import { MusicDirector } from '@/lib/fly/music-director';
import { useFlyStore } from '@/stores/fly-store';
import { useFlyContractsStore } from '@/stores/fly-contracts-store';
import { usePassportStore } from '@/stores/passport-store';

/**
 * ROUND 18 "Alive & Dangerous" — A4 SHOWTIME: the arcade layer's engine room.
 *
 * Mounted INSIDE the canvas (from FlyCanvas, after FlyScene) so it gets a
 * useFrame at the default priority — i.e. after FlyScene's -50 flight step and
 * after TrafficLayer's -45 `traffic.update()`, which is what makes every
 * item's `.distM` fresh for THIS frame when the near-miss detector reads it.
 *
 * It renders nothing. Its whole job is to turn continuous state into DISCRETE
 * events:
 *   · per frame — trauma decay, near-miss inflection scan, combo-window expiry
 *   · on event  — ONE fly-store write (score/combo), one toast, one sting
 *   · at 2 Hz   — the music director's parameter sweep
 *
 * The fly-store is only ever written when a value CHANGES (the `_wrote` mirror
 * below). A useFrame that calls `set()` unconditionally would re-render every
 * subscriber 60×/s — the round-6 rule this file exists to honour.
 *
 * Cross-agent contract (FlyScene's RUNTIME CONTRACTS (R18) comment):
 * `runtime.juice = { addTrauma, onCrash, onEvent }`. A5 GRAVITY calls
 * `juice?.onCrash()` optional-chained, so either merge order builds.
 */
/**
 * Dev-only A/B lever for verify-juice, in the sanctioned `__flyWeatherOverride`
 * / `__flyMicroOverride` idiom: it lets a harness measure the MUSIC.enabled
 * FALSE branch (zero nodes) against the true branch in one run, without
 * hot-patching a constant mid-session. Production is untouched — the whole
 * expression short-circuits on NODE_ENV.
 */
function musicOff() {
  return (
    process.env.NODE_ENV === 'development' &&
    typeof window !== 'undefined' &&
    window.__flyMusicOverride === 'off'
  );
}

export function JuiceSystems({ runtime }) {
  const detectorRef = useRef(null);
  const musicRef = useRef(null);
  const stateRef = useRef({
    prevSec: 0,
    musicAt: 0,
    nearestDistM: null,
    // Mirror of what we last pushed to the store — the transition gate.
    wroteCombo: 0,
    wroteSession: 0,
    wroteRun: 0,
  });

  // --- Event intake ------------------------------------------------------
  // One place every scoring path funnels through, so trauma, the chain and
  // the store write can never drift apart between sources.
  const fireRef = useRef(null);
  fireRef.current = (kind, basePts, trauma) => {
    const nowSec = performance.now() / 1000;
    const res = scoreEvent(kind, basePts, nowSec);
    if (SHAKE.enabled && trauma) addTrauma(trauma);
    return res;
  };

  // --- Mount: publish the runtime handle, arm the detector/music ---------
  useEffect(() => {
    const S = stateRef.current;
    detectorRef.current = createNearMissDetector();
    resetJuice();
    beginRun(performance.now() / 1000);
    S.wroteCombo = 0;
    S.wroteSession = 0;
    S.wroteRun = 0;

    const store = useFlyStore.getState();
    store.setCombo(0);
    store.setSessionScore(0);
    store.setRunScore(0);

    runtime.juice = {
      addTrauma: (x) => {
        if (SHAKE.enabled) addTrauma(x);
      },
      /** Generic scoring hook for other systems (A5, future rounds). */
      onEvent: (kind, basePts = SESSION.pts.buzz) =>
        fireRef.current(kind, basePts, SHAKE.sources.nearMiss),
      /**
       * A5 GRAVITY's crash sequence calls this. Ends the run: bank the stats,
       * open the summary, wipe the chain. The SESSION score survives.
       */
      onCrash: () => {
        if (SHAKE.enabled) addTrauma(SHAKE.sources.crash);
        if (!SESSION.enabled) return null;
        const stats = endRun(performance.now() / 1000);
        const st = useFlyStore.getState();
        st.setRunStats(stats);
        st.setRunSummaryOpen(true);
        st.setCombo(0);
        st.setRunScore(0);
        stateRef.current.wroteCombo = 0;
        stateRef.current.wroteRun = 0;
        beginRun(performance.now() / 1000);
        detectorRef.current?.reset();
        return stats;
      },
    };

    return () => {
      runtime.juice = null;
      detectorRef.current = null;
      musicRef.current?.dispose();
      musicRef.current = null;
      resetJuice();
    };
  }, [runtime]);

  // --- Discrete store subscriptions -> chain events ----------------------
  useEffect(() => {
    const unsubs = [];

    // Airport buzz / touch-and-go. The store object is { airport, kind, at }
    // (Contracts.jsx is the only writer, at 1 Hz).
    let prevBuzzAt = useFlyStore.getState().buzz?.at ?? 0;
    unsubs.push(
      useFlyStore.subscribe(
        (s) => s.buzz,
        (b) => {
          if (!b || !(b.at > prevBuzzAt)) return;
          prevBuzzAt = b.at;
          const touchGo = b.kind === 'touch-go';
          fireRef.current(
            touchGo ? 'touchGo' : 'buzz',
            touchGo ? SESSION.pts.touchGo : SESSION.pts.buzz,
            SHAKE.sources.buzz
          );
        }
      )
    );

    // Boost engage: the preset TRANSITION into 'boost' is the kick, not the
    // sustained state (a subscription only fires on change, so this is free).
    unsubs.push(
      useFlyStore.subscribe(
        (s) => s.speedPreset,
        (preset, prev) => {
          if (SHAKE.enabled && preset === 'boost' && prev !== 'boost') {
            addTrauma(SHAKE.sources.boostEngage);
          }
        }
      )
    );

    // A warp is a position discontinuity, not a fly-by: every stored previous
    // distance is meaningless on the far side of it.
    unsubs.push(
      useFlyStore.subscribe(
        (s) => s.warpEpoch,
        () => detectorRef.current?.reset()
      )
    );

    // Contract completions. `at` is monotonic by construction, so a strict >
    // cursor never drops the second of two same-tick completions.
    let prevContractAt = useFlyContractsStore.getState().lastCompleted?.at ?? 0;
    unsubs.push(
      useFlyContractsStore.subscribe((s) => {
        const c = s.lastCompleted;
        if (!c || !(c.at > prevContractAt)) return;
        prevContractAt = c.at;
        fireRef.current('contract', SESSION.pts.contract, SHAKE.sources.nearMiss);
      })
    );

    // Rare+ spots. Walk the list rather than reading only the head: a batched
    // multi-spot update would otherwise silently drop chain events (the
    // Contracts.jsx cursor form, not the SpotToast head-only one).
    let prevSpotTs = usePassportStore.getState().spottedAircraft[0]?.timestamp ?? 0;
    unsubs.push(
      usePassportStore.subscribe((s) => {
        const list = s.spottedAircraft;
        if (!list?.length || !(list[0].timestamp > prevSpotTs)) return;
        let rare = 0;
        for (const spot of list) {
          if (!(spot.timestamp > prevSpotTs)) break;
          if ((spot.rarity ?? 0) >= SESSION.spotMinRarity) rare++;
        }
        prevSpotTs = list[0].timestamp;
        for (let i = 0; i < rare; i++) {
          fireRef.current('spot', SESSION.pts.spot, SHAKE.sources.buzz);
        }
      })
    );

    return () => {
      for (const u of unsubs) u();
    };
  }, []);

  // --- The frame loop ----------------------------------------------------
  useFrame(() => {
    const S = stateRef.current;
    const nowSec = performance.now() / 1000;
    const dt = S.prevSec ? Math.min(0.25, nowSec - S.prevSec) : 0;
    S.prevSec = nowSec;
    if (dt <= 0) return;

    if (SHAKE.enabled) decayTrauma(dt);
    // A5 GRAVITY's meter → the HUD, without giving the HUD tree a runtime prop.
    setBoostMirror(runtime.boost);

    // --- Near-miss scan + nearest-contact distance (one pass) ------------
    const items = runtime.traffic?.items;
    let nearest = null;
    if (items && items.length) {
      for (const it of items) {
        if (it.stale === 2) continue;
        if (nearest == null || it.distM < nearest) nearest = it.distM;
      }
      if (NEARMISS.enabled && detectorRef.current) {
        const hits = detectorRef.current.step(items, dt, nowSec);
        for (const hit of hits) {
          const res = fireRef.current('nearMiss', NEARMISS.basePts, SHAKE.sources.nearMiss);
          runtime.audio?.whooshSting?.();
          // The toast rides SpotToast's DEFERRED queue (never evicts a live
          // spot/spicy card) — publishing it as a store-free custom event
          // keeps this frame loop out of React entirely.
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('fly-nearmiss', {
                detail: {
                  callsign: hit.callsign,
                  distM: Math.round(hit.distM),
                  pts: res.pts,
                  mult: res.mult,
                },
              })
            );
          }
        }
      }
    }
    S.nearestDistM = nearest;

    // --- Combo window + store transitions --------------------------------
    if (COMBO.enabled) tickCombo(nowSec);
    const js = getState();
    if (js.combo !== S.wroteCombo) {
      S.wroteCombo = js.combo;
      useFlyStore.getState().setCombo(js.combo);
    }
    if (js.sessionScore !== S.wroteSession) {
      S.wroteSession = js.sessionScore;
      useFlyStore.getState().setSessionScore(js.sessionScore);
    }
    if (js.runScore !== S.wroteRun) {
      S.wroteRun = js.runScore;
      useFlyStore.getState().setRunScore(js.runScore);
    }

    // --- Music: MUSIC.updateHz, never per frame --------------------------
    if (MUSIC.enabled && nowSec - S.musicAt >= 1 / MUSIC.updateHz) {
      S.musicAt = nowSec;
      if (!musicRef.current && !musicOff()) {
        const bus = runtime.audio?.bus?.();
        if (bus) musicRef.current = new MusicDirector(bus);
      }
      const f = runtime.flight;
      if (musicRef.current && f) {
        const st = useFlyStore.getState();
        musicRef.current.update(
          {
            aglM: Number.isFinite(f.agl) ? f.agl : f.pos.y,
            speedMps: f.speed,
            speedPreset: runtime.input?.read()?.speedPreset ?? st.speedPreset,
            nearestDistM: S.nearestDistM,
            sunFrac: runtime.sun?.frac ?? null,
            soundOn: st.soundOn,
          },
          nowSec
        );
      }
    }

    if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
      (window.__flyStats ??= {}).juice = {
        combo: js.combo,
        sessionScore: js.sessionScore,
        runScore: js.runScore,
        nearMisses: js.nearMisses,
        musicLayers: musicRef.current?.activeLayers ?? 0,
        musicNodes: musicRef.current?.nodeCount ?? 0,
        musicPulseRate: musicRef.current?.pulseRate ?? 0,
        tracked: detectorRef.current?.tracked ?? 0,
      };
    }
  });

  return null;
}
