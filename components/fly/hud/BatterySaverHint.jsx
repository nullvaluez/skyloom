'use client';
import { useEffect } from 'react';
import { useFlyStore } from '@/stores/fly-store';
import { shipPassBlock } from '@/lib/fly/ship-pass';
import { cadenceState, frameCadence } from '@/lib/fly/frame-api';
import { currentNotice, publishNotice, wakeHud } from './calm-hud';

export const BATTERY_SAVER_NOTICE = 'Running warm? Battery saver (30 fps) is in Settings.';

/**
 * SHIP PASS FRAME (FR-9) — suggest Battery saver, once per session, through
 * the calm HUD's existing notice lane (publishNotice / wakeHud; CalmHud is
 * not edited). Two triggers, both on a touch device only (FlyMode mounts this
 * only where deviceFeature('BATTERY_SAVER') allows it, PACE_ADAPT on and the
 * calm HUD on):
 *   - the quality governor latched below its boot rung (it tried the higher
 *     rung, could not hold it, and gave up for the session);
 *   - ten minutes (PACE_ADAPT.suggest.watchMinutes) of "Watch for me" in the
 *     lounge.
 * The lounge has its own HUD and the flight HUD is hidden there, so an armed
 * suggestion waits until the flight HUD is visible (not the title, the
 * lounge or photo mode) and then shows for `showSec`. Never shown when
 * Battery saver is already on. Renders nothing.
 */
let shown = false;

export function BatterySaverHint({ runtime }) {
  useEffect(() => {
    const cfg = { watchMinutes: 10, showSec: 9, onLatch: true, ...(shipPassBlock('PACE_ADAPT')?.suggest ?? {}) };
    let autoSince = null;
    let armed = false;
    let clear = null;
    const id = setInterval(() => {
      if (shown || frameCadence() === '30') return;
      const now = performance.now();
      const auto = !!runtime?.airportWatch?.director?.auto;
      autoSince = auto ? (autoSince ?? now) : null;
      const st = cadenceState();
      if (cfg.onLatch && st.latched && st.rung > 0) armed = true;
      if (autoSince != null && now - autoSince >= cfg.watchMinutes * 60000) armed = true;
      const s = useFlyStore.getState();
      const hudVisible = !s.airportWatch && s.screen === 'flight' && s.cameraMode !== 'photo';
      if (!armed || !hudVisible || currentNotice()) return;
      shown = true;
      publishNotice({ kind: 'battery-saver', text: BATTERY_SAVER_NOTICE });
      wakeHud();
      clear = setTimeout(() => {
        if (currentNotice()?.kind === 'battery-saver') publishNotice(null);
      }, cfg.showSec * 1000);
    }, 5000);
    return () => {
      clearInterval(id);
      if (clear) clearTimeout(clear);
    };
  }, [runtime]);
  return null;
}
