'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import { estimateDisplayHz, markFrameEnd } from '@/lib/fly/pace-adapt';
import { cadenceState, frameCadence, governorHolds, noteCadence, setFrameCadence, subscribeFrameCadence } from '@/lib/fly/frame-api';
import { setCinemaEffectFloor } from '@/lib/fly/cinema-policy';
import { deviceFeature } from '@/lib/fly/device-policy';
import { shipPassBlock } from '@/lib/fly/ship-pass';
import { useFlyStore } from '@/stores/fly-store';

/**
 * SHIP PASS FRAME (FR-5, FR-9; PACE_ADAPT) — mounted by FlyCanvas only with
 * the flag on. Renders nothing and draws nothing.
 *  - stamps the END of each frame's work after the composer (priority 1000),
 *    for the governor's cadence-lock detector;
 *  - probes the display's rAF rate at mount and whenever the page comes back
 *    from hidden (lib/fly/pace-adapt.js estimateDisplayHz) and publishes it as
 *    cadenceState().displayHz, which FlyCanvas's presentation cadence reads;
 *  - applies Battery saver's phone-lean floor where deviceFeature('BATTERY_SAVER')
 *    allows it (touch devices), and mirrors the mode into the store.
 */
export function PaceClock() {
  const mode = useSyncExternalStore(subscribeFrameCadence, frameCadence, () => '60');
  useFrame(() => markFrameEnd(), 1000);

  // The owner's console and the harnesses: window.__flyFrame (PACE_ADAPT on only).
  useEffect(() => {
    window.__flyFrame = { setFrameCadence, frameCadence, cadenceState, governorHolds };
    return () => {
      delete window.__flyFrame;
    };
  }, []);

  useEffect(() => {
    const block = shipPassBlock('PACE_ADAPT') ?? {};
    let live = true;
    const probe = () => {
      estimateDisplayHz(block.refreshSnap ?? [30, 48, 50, 60, 90, 120, 144], block.displayProbeMs ?? 1000).then((hz) => {
        if (live && hz) noteCadence({ displayHz: hz });
      });
    };
    probe();
    const onVis = () => {
      if (!document.hidden) probe();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  useEffect(() => {
    // The store mirrors the persisted mode (fly-store FRAME fields).
    useFlyStore.getState().setFrameRateMode?.(mode);
    const saver = deviceFeature('BATTERY_SAVER');
    setCinemaEffectFloor(mode === '30' && saver.allowed ? saver.budget.effectFloor ?? shipPassBlock('PACE_ADAPT')?.batterySaverEffects ?? 3 : 0);
    return () => setCinemaEffectFloor(0);
  }, [mode]);

  return null;
}
