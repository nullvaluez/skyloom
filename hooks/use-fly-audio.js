'use client';

import { useEffect, useRef } from 'react';
import { FlyAudio } from '@/lib/fly/audio-engine';
import { ImmersiveAudio } from '@/lib/fly/immersive-audio';
import { immersiveOn } from '@/lib/fly/immersive';
import { AUDIO } from '@/lib/fly/fly-constants';
import { resolveAircraft } from '@/lib/fly/player-aircraft';
import { useFlyStore } from '@/stores/fly-store';
import { gameplayLive, lockBlipWanted, quietBed, wakeBed } from '@/lib/fly/front-door';

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
    const immersion = new ImmersiveAudio(audio);
    audioRef.current = audio;
    runtime.audio = audio;
    audio.setMuted(!useFlyStore.getState().soundOn);
    const applyAircraft = (id) => {
      const ac = resolveAircraft(id);
      audio.setProfile(ac.audio, ac.cfg.speeds);
      // R25 A: a 'prop' pick in the hangar builds its tremolo at full depth —
      // silence it before it sounds (constant-true gameplayLive with the flag
      // off: never taken).
      if (!gameplayLive(useFlyStore.getState())) quietBed(audio, true);
    };
    applyAircraft(useFlyStore.getState().aircraftId);

    // R25 A: the first click builds the graph (a 'prop' LFO at full depth);
    // on the title it is silenced in the same task, before it can sound.
    let builtCtx = null;
    const gesture = () => {
      audio.resume();
      if (audio.ctx && audio.ctx !== builtCtx) {
        builtCtx = audio.ctx;
        if (!gameplayLive(useFlyStore.getState())) quietBed(audio, true);
      }
    };
    window.addEventListener('pointerdown', gesture);
    window.addEventListener('keydown', gesture);

    let bedQuiet = false; // R25 A: wakeBed on the quiet -> flight edge only
    const id = setInterval(() => {
      const f = runtime.flight;
      if (!f) return;
      const state=useFlyStore.getState();
      // R25 A (FRONT DOOR): the engine/wind bed is silent while not actually
      // flying (the title's frozen flight and the hangar) — one-shots and UI
      // sounds still play. gameplayLive() is constant true with the flag off,
      // so this is today's call sequence exactly.
      const live=gameplayLive(state);
      if (live) {
        if (bedQuiet) {
          wakeBed(audio);
          bedQuiet = false;
        }
        const cmd = runtime.input?.read();
        audio.update(f.speed, !runtime.operations?.lowSpeed && (!!cmd?.boost || cmd?.speedPreset === 'boost'), runtime.operations);
      } else {
        quietBed(audio);
        bedQuiet = true;
      }
      const active=state.mapStyle==='satellite'&&immersiveOn('audio');
      // Pause gates the shared master too, including synthesized fallback and one-shots.
      audio.setMuted(!state.soundOn || (active && state.phase==='paused'));
      immersion.update(runtime,state,active&&live);
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
          // R25 A: acquisitions on the title / in the hangar are silent.
          if (lockBlipWanted(hex, prev, useFlyStore.getState())) audio.lockBlip();
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
      immersion.dispose();
      delete runtime.immersiveAudio;
      audio.dispose();
    };
  }, [runtime]);
}
