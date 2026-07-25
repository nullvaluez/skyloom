'use client';

import { useEffect, useRef } from 'react';
import { FlyAudio } from '@/lib/fly/audio-engine';
import { AUDIO } from '@/lib/fly/fly-constants';
import { resolveAircraft } from '@/lib/fly/player-aircraft';
import { useFlyStore } from '@/stores/fly-store';

/**
 * Owns the FlyAudio instance for a Fly-mode session: resumes on the first
 * user gesture, chases the continuous wind/engine bed from runtime.flight,
 * and fires one-shots on store transitions (lock acquired, warp). The
 * instance is also published on runtime.audio for ad-hoc UI clicks.
 *
 * Round 17: the aircraft's voice is installed on mount and on every hangar
 * pick — a DISCRETE store subscription, exactly like the sound toggle beside
 * it. The fighter's profile is the identity profile, so the default session
 * runs the round-16 DSP graph unchanged.
 */
export function useFlyAudio(runtime) {
  const audioRef = useRef(null);

  useEffect(() => {
    const audio = new FlyAudio();
    audioRef.current = audio;
    runtime.audio = audio;
    audio.setMuted(!useFlyStore.getState().soundOn);
    const applyAircraft = (id) => {
      const ac = resolveAircraft(id);
      audio.setProfile(ac.audio, ac.cfg.speeds);
    };
    applyAircraft(useFlyStore.getState().aircraftId);

    const gesture = () => audio.resume();
    window.addEventListener('pointerdown', gesture);
    window.addEventListener('keydown', gesture);

    const id = setInterval(() => {
      const f = runtime.flight;
      if (!f) return;
      const cmd = runtime.input?.read();
      audio.update(f.speed, !!cmd?.boost || cmd?.speedPreset === 'boost');
    }, 1000 / AUDIO.updateHz);

    const unsubs = [
      useFlyStore.subscribe(
        (s) => s.soundOn,
        (soundOn) => audio.setMuted(!soundOn)
      ),
      useFlyStore.subscribe((s) => s.aircraftId, applyAircraft),
      useFlyStore.subscribe(
        (s) => s.lockedHex,
        (hex, prev) => {
          if (hex && !prev) audio.lockBlip();
        }
      ),
      useFlyStore.subscribe(
        (s) => s.warpEpoch,
        (epoch) => {
          if (epoch > 0) audio.warpSweep();
        }
      ),
      useFlyStore.subscribe(
        (s) => s.inspectHex,
        (hex) => {
          if (hex) audio.cardFanfare();
        }
      ),
    ];

    return () => {
      clearInterval(id);
      window.removeEventListener('pointerdown', gesture);
      window.removeEventListener('keydown', gesture);
      for (const unsub of unsubs) unsub();
      runtime.audio = null;
      audio.dispose();
    };
  }, [runtime]);
}
