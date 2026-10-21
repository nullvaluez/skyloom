'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Crosshair } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { useEncounterStore } from '@/stores/encounter-store';
import { PAYOFF } from '@/lib/fly/escort-shot';
import { encounterPhotoFrame, readMemoryPhoto } from '@/lib/fly/encounter-photo';
import { viewfinderStatus } from '@/lib/fly/encounter-feel';
import { getAircraftTypeName } from '@/lib/aircraft-type-names';
import { zoneClass } from '../LayoutRoot';
import './target-ui.css';
import './play-encounters.css';

/**
 * PLAY PASS — ENCOUNTERS (ENCOUNTER_FEEL): the moment a memory is earned, and
 * the viewfinder that helps you earn a photo one. Mounted in FlyMode's PLAY
 * PASS ENCOUNTERS block.
 *
 * THE LOWER THIRD. Thirty seconds alongside a real aircraft, a discovery's
 * last gate or its photo used to end in an 8 s line of toast text. Now the
 * memory shows as a print developing in a frame — the escort's shutter frame,
 * the discovery's own photo, or the frame you crossed the last gate on —
 * with what it was, while you fly on. It reads `moment` from the encounter
 * store (encounter-runtime.js; its thumbnail from EncounterFeelRig or the
 * memory's stored photo) and clears it PAYOFF.momentSec after it was first
 * seen. It sits in the lock card's slot (the escort card stands aside).
 *
 * THE VIEWFINDER. In photo mode the flying HUD is hidden, so a photo
 * discovery ("Frame the Midtown skyline") left you guessing whether the shot
 * would count. While one is active (or a crossing), a chip at the top says
 * what the shutter will see — in frame and in range, or which way to turn,
 * or how much closer — from the same encounterPhotoFrame the shutter uses.
 */
export function EncounterMoment({ runtime }) {
  return (
    <>
      <MomentCard />
      <Viewfinder runtime={runtime} />
    </>
  );
}

function MomentCard() {
  const moment = useEncounterStore((s) => s.moment);
  const cinema = useFlyStore((s) => s.cameraMode === 'cinema');
  const hidden = useFlyStore((s) => s.screen !== 'flight' || s.phase !== 'flying' || s.atlasOpen || s.logbookOpen || s.hangarOpen);
  const id = moment?.id ?? null;
  const shown = !!moment && !hidden;

  // The memory's own photo (a discovery shot) when the shutter did not run.
  const [stored, setStored] = useState(null);
  const photoRef = moment?.thumb ? null : (moment?.photoRef ?? null);
  useEffect(() => {
    if (!photoRef) return undefined;
    let live = true, url = null;
    readMemoryPhoto(photoRef).then((blob) => {
      if (live && blob) {
        url = URL.createObjectURL(blob);
        setStored({ photoRef, url });
      }
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [photoRef]);

  // Its clock starts when it is first on screen (a photo taken in photo mode
  // lands while the player is still composing).
  const seenAt = useRef(null);
  useEffect(() => {
    seenAt.current = null;
  }, [id]);
  useEffect(() => {
    if (!shown || !id) return undefined;
    seenAt.current ??= Date.now();
    const left = Math.max(800, (moment.thumb || moment.photoRef ? 0 : PAYOFF.shutterSec * 1000) + PAYOFF.momentSec * 1000 - (Date.now() - seenAt.current));
    const t = setTimeout(() => {
      if (useEncounterStore.getState().moment?.id === id) useEncounterStore.setState({ moment: null });
    }, left);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, id]);

  const thumb = moment?.thumb || (stored && stored.photoRef === moment?.photoRef ? stored.url : null);
  const traffic = moment?.kind === 'traffic' || moment?.type != null;
  const type = moment?.type ? getAircraftTypeName(moment.type) || moment.type : null;
  const sub = moment
    ? (traffic
        ? [type, moment.registration && moment.registration !== moment.name ? moment.registration : null]
        : [moment.place && moment.place !== moment.name ? moment.place : null]
      )
        .concat('in your logbook')
        .filter(Boolean)
        .join(' · ')
    : '';
  return (
    <div className={`${zoneClass('info-dock')} tgt-ec-wrap`} data-letterbox={cinema ? '1' : '0'}>
      <AnimatePresence>
        {shown && (
          <motion.section
            key={moment.id}
            className="tgt tgt-moment"
            data-testid="encounter-moment"
            data-kind={moment.kind ?? 'traffic'}
            role="status"
            initial={{ opacity: 0, x: -36 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          >
            <div className="tgt-moment-photo" aria-hidden={!thumb}>
              {thumb && (
                // eslint-disable-next-line @next/next/no-img-element -- a local in-memory thumbnail of this frame.
                <img src={thumb} alt={`Your view: ${moment.name}`} />
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="tgt-moment-kicker">
                <CheckCircle2 size={14} aria-hidden="true" />
                Flight memory saved
              </div>
              <div className="tgt-moment-name">{moment.name}</div>
              <div className="tgt-moment-sub">{sub}</div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

function Viewfinder({ runtime }) {
  const photo = useFlyStore((s) => s.cameraMode === 'photo' && s.screen === 'flight');
  const active = useEncounterStore((s) => s.active);
  const [status, setStatus] = useState(null);
  const want = photo && (active?.kind === 'photo' || active?.kind === 'traffic');
  useEffect(() => {
    if (!want) return undefined;
    const read = () => {
      const a = runtime?.encounters?.controller?.active;
      const frame = a ? encounterPhotoFrame(runtime, useFlyStore.getState().warpEpoch) : null;
      const range = a?.kind === 'traffic' ? 1500 : (a?.course?.photoRangeM ?? 1500);
      const next = a ? { ...viewfinderStatus(frame, a, range), id: a.id } : null;
      setStatus((prev) => (prev?.text === next?.text && prev?.ok === next?.ok && prev?.id === next?.id ? prev : next));
    };
    const first = setTimeout(read, 0);
    const t = setInterval(read, 250);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [want, runtime]);
  return (
    <AnimatePresence>
      {want && status?.text && status.id === active?.id && (
        <motion.div
          key="viewfinder"
          className="tgt tgt-viewfinder"
          data-testid="encounter-viewfinder"
          data-ok={status.ok ? '1' : '0'}
          data-dir={status.dir ?? undefined}
          role="status"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
        >
          {status.ok ? <CheckCircle2 size={16} aria-hidden="true" /> : <Crosshair size={16} aria-hidden="true" />}
          <span>{status.text}</span>
          {status.dir && <i aria-hidden="true" />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
