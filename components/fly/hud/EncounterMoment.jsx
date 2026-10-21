'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import { useFlyStore } from '@/stores/fly-store';
import { useEncounterStore } from '@/stores/encounter-store';
import { PAYOFF } from '@/lib/fly/escort-shot';
import { getAircraftTypeName } from '@/lib/aircraft-type-names';
import { zoneClass } from '../LayoutRoot';
import './target-ui.css';
import './play-encounters.css';

/**
 * PLAY PASS — ENCOUNTERS (ENCOUNTER_FEEL): the flight-memory lower third.
 *
 * Thirty seconds alongside a real aircraft is the headline of free flight; it
 * used to end in an 8 s line of toast text. Now the escort camera eases onto
 * its best angle, the shutter keeps that frame, and this card shows it — a
 * print developing in a frame — with what you flew beside, while the escort
 * lets go and you fly on. Mounted in FlyMode's PLAY PASS ENCOUNTERS block;
 * it reads `moment` from the encounter store (set by encounter-runtime.js,
 * its thumbnail by EncounterFeelRig) and clears it after PAYOFF.momentSec
 * past the shutter. It sits in the lock card's slot (the escort card has
 * stood aside for the beat).
 */
export function EncounterMoment() {
  const moment = useEncounterStore((s) => s.moment);
  const cinema = useFlyStore((s) => s.cameraMode === 'cinema');
  const hidden = useFlyStore((s) => s.cameraMode === 'photo' || s.screen !== 'flight' || s.phase !== 'flying');
  const id = moment?.id ?? null;

  useEffect(() => {
    if (!id) return undefined;
    const t = setTimeout(
      () => {
        if (useEncounterStore.getState().moment?.id === id) useEncounterStore.setState({ moment: null });
      },
      (PAYOFF.shutterSec + PAYOFF.momentSec) * 1000
    );
    return () => clearTimeout(t);
  }, [id]);

  const type = moment ? getAircraftTypeName(moment.type) || moment.type : null;
  return (
    <div className={`${zoneClass('info-dock')} tgt-ec-wrap`} data-cinematic={cinema ? '1' : '0'}>
      <AnimatePresence>
        {moment && !hidden && (
          <motion.section
            key={moment.id}
            className="tgt tgt-moment"
            data-testid="encounter-moment"
            role="status"
            initial={{ opacity: 0, x: -36 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          >
            <div className="tgt-moment-photo" aria-hidden={!moment.thumb}>
              {moment.thumb && (
                // eslint-disable-next-line @next/next/no-img-element -- a local in-memory thumbnail of this frame.
                <img src={moment.thumb} alt={`Your shot with ${moment.name}`} />
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="tgt-moment-kicker">
                <CheckCircle2 size={14} aria-hidden="true" />
                Flight memory saved
              </div>
              <div className="tgt-moment-name">{moment.name}</div>
              <div className="tgt-moment-sub">
                {[type, moment.registration && moment.registration !== moment.name ? moment.registration : null, 'in your logbook']
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
