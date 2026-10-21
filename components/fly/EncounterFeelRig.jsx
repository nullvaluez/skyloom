'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PHOTO } from '@/lib/fly/fly-constants';
import { escortShotState, PAYOFF } from '@/lib/fly/escort-shot';
import { FEEL } from '@/lib/fly/encounter-feel';
import { releaseEscort } from '@/lib/fly/escort';
import { saveMemoryPhoto } from '@/lib/fly/encounter-photo';
import { useFlyStore } from '@/stores/fly-store';
import { useEncounterStore } from '@/stores/encounter-store';

/**
 * PLAY PASS — ENCOUNTERS (ENCOUNTER_FEEL): the scene half of "fly alongside
 * that pays off". Mounted in FlyScene's PLAY PASS ENCOUNTERS block; renders
 * nothing.
 *
 *  · publishes the TRUE sun direction to the escort shot (it films from the
 *    sunlit side);
 *  · marks the document while the photo ship holds the frame
 *    (`data-escort-shot`: traffic labels and the lock reticle fade, the
 *    subject is the aircraft) and while the payoff beat runs
 *    (`data-escort-beat`: the escort card steps aside for the lower third);
 *  · ticks the payoff beat, takes its shutter frame and lets the escort go
 *    when the beat is over.
 *
 * The shutter reads the graded canvas in a useFrame AFTER the composer, the
 * same task as the draw (PhotoCapture's rule: no preserveDrawingBuffer), into
 * a small 2D canvas, so the thumbnail is the frame the player saw. It is a
 * local thumbnail for the logbook (saveMemoryPhoto keeps 24), never a file.
 */
export function EncounterFeelRig({ runtime }) {
  const gl = useThree((s) => s.gl);
  const shutter = useRef(false);
  const marks = useRef({ shot: false, beat: false, frame: -1 });
  const url = useRef(null);

  useEffect(() => {
    // Scopes play-encounters.css's clean-frame fade to a flag-on page.
    document.documentElement.dataset.escortFeel = '1';
    return () => {
      const root = document.documentElement;
      delete root.dataset.escortFeel;
      delete root.dataset.escortShot;
      delete root.dataset.escortBeat;
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);

  useFrame((_, delta) => {
    const st = escortShotState;
    const e = runtime.cinemaEnvironment;
    if (e?.sunDir) {
      st.sun.x = e.sunDir[0];
      st.sun.y = e.sunDir[1];
      st.sun.z = e.sunDir[2];
    } else if (runtime.sun) {
      const s = Math.max(-1, Math.min(1, runtime.sun.sinEl ?? 1)), c = Math.sqrt(1 - s * s), az = runtime.sun.az || 0;
      st.sun.x = -Math.sin(az) * c;
      st.sun.y = s;
      st.sun.z = Math.cos(az) * c;
    }

    // Clean frame / beat marks (DOM writes only on change).
    const cinema = useFlyStore.getState().cameraMode === 'cinema';
    const live = cinema && st.frame !== marks.current.frame;
    marks.current.frame = st.frame;
    const shot = live && st.photo >= FEEL.cleanFrame;
    const payoff = runtime.encounters?.payoff;
    const beat = !!payoff?.live?.cinematic;
    const root = document.documentElement;
    if (shot !== marks.current.shot) {
      marks.current.shot = shot;
      if (shot) root.dataset.escortShot = '1';
      else delete root.dataset.escortShot;
    }
    if (beat !== marks.current.beat) {
      marks.current.beat = beat;
      if (beat) root.dataset.escortBeat = '1';
      else delete root.dataset.escortBeat;
    }

    if (!payoff?.live) return;
    const step = payoff.tick(Math.min(delta, 0.1));
    if (step === 'shutter') shutter.current = true;
    else if (step === 'release' && PAYOFF.release) {
      const hex = payoff.live?.memory?.traffic?.hex;
      if (hex && runtime.escort?.hex === hex) releaseEscort(runtime);
    }
  });

  // The shutter: after the composer has drawn this frame (PHOTO.capturePriority
  // is the photo mode's own read; one later so both may share a frame).
  useFrame(() => {
    if (!shutter.current) return;
    shutter.current = false;
    const memory = runtime.encounters?.payoff?.live?.memory;
    if (!memory) return;
    try {
      const src = gl.domElement;
      if (!src.width || !src.height) return;
      const w = Math.min(PAYOFF.thumbPx, src.width);
      const h = Math.round((src.height / src.width) * w);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      out.getContext('2d').drawImage(src, 0, 0, w, h);
      const s = useFlyStore.getState();
      if (s.soundOn) runtime.audio?.click?.();
      out.toBlob(
        (blob) => {
          if (!blob) return;
          if (url.current) URL.revokeObjectURL(url.current);
          url.current = URL.createObjectURL(blob);
          const store = useEncounterStore.getState();
          if (store.moment?.id === memory.id) useEncounterStore.setState({ moment: { ...store.moment, thumb: url.current } });
          saveMemoryPhoto(blob)
            .then((ref) => ref && useEncounterStore.getState().attachPhoto(memory.id, ref))
            .catch(() => {});
        },
        'image/jpeg',
        0.86
      );
    } catch {
      /* a lost context or a tainted canvas: the memory stands without its photo */
    }
  }, PHOTO.capturePriority + 1);

  return null;
}
