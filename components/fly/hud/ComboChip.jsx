'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { COMBO } from '@/lib/fly/fly-constants';
import { useFlyStore } from '@/stores/fly-store';
import { CARD_THEME } from './inspect/inspect-tokens';

/**
 * ROUND 18 (A4 SHOWTIME) — the combo chip.
 *
 * Shows only from a chain of 2, because a ×1 "combo" is just an event and a
 * chip that is always on stops reading as a reward. Subscribes to two
 * TRANSITION-written store fields (JuiceSystems is the only writer and only
 * writes them on change), so this component re-renders a handful of times per
 * chain rather than per frame.
 *
 * `pointer-events-none` throughout: it sits in the desktop right column above
 * the minimap and, on phones, above the contracts chip — neither may lose a
 * tap to a decoration, and the 44 px mobile gate only measures interactive
 * elements.
 */
export function ComboChip() {
  const combo = useFlyStore((s) => s.combo);
  const runScore = useFlyStore((s) => s.runScore);

  const show = combo >= 2;
  const mult = Math.min(COMBO.multCap, 1 + COMBO.multStep * (combo - 1));

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          data-testid="combo-chip"
          initial={{ opacity: 0, y: 8, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 420, damping: 26 }}
          className="hud-flat-phone pointer-events-none flex items-center gap-2 rounded-xl border px-2.5 py-1.5 backdrop-blur-sm"
          style={{
            background: 'rgba(6, 9, 18, 0.62)',
            borderColor: 'rgba(251, 191, 36, 0.30)',
            boxShadow: '0 6px 20px rgba(2, 4, 10, 0.5), 0 0 16px rgba(251,191,36,0.13)',
          }}
        >
          {/* The multiplier is the hero number — it is what the next event pays */}
          <motion.span
            // Re-keying on `combo` replays the pop, so every link in the chain
            // has a visible beat instead of a number quietly ticking over.
            key={combo}
            initial={{ scale: 1.35 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 18 }}
            className="font-mono text-base font-bold leading-none"
            style={{ color: '#fbbf24' }}
          >
            &times;{mult % 1 === 0 ? mult : mult.toFixed(2).replace(/0$/, '')}
          </motion.span>
          <span className="flex flex-col leading-none">
            <span
              className="text-[8px] uppercase tracking-[0.28em]"
              style={{ color: CARD_THEME.iceDim }}
            >
              combo {combo}
            </span>
            <span className="mt-0.5 font-mono text-[10px]" style={{ color: CARD_THEME.ice }}>
              {runScore.toLocaleString()}
            </span>
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
