'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePassportStore } from '@/stores/passport-store';
import { useFlyStore } from '@/stores/fly-store';
import { calculateRarity, getRarityTier, RARITY_TIERS } from '@/lib/rarity';
import { getAircraftTypeName } from '@/lib/aircraft-type-names';
import { SPICY } from '@/lib/fly/fly-constants';
import { CARD_THEME } from './inspect/inspect-tokens';

const TOAST_MS = 3500;
const SPICY_TOAST_MS = 4800;
const MAX_STACK = 2;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const MILITARY_ACCENT = '#f87171';

/**
 * ONE toast stack for both spotting reward flavors:
 *
 * - Passport spots: whenever the Spotter's Passport logs a spot (lock
 *   acquire / inspect open), an arcade toast stamps in — "NEW SPOT!" for a
 *   first-ever hex, rarity-tinted, rising two-tone blip. Subscribes to the
 *   persisted store on DISCRETE changes only.
 * - SPICY pings (Atlas round §4.4a): a 2s scan over live traffic for
 *   military or epic+ rarity contacts in range. First sighting of a
 *   qualifying hex → "◆ SPICY" toast with type + bearing, a minimap
 *   attention ring (runtime.spicyPulse) and the tiered blip. Rarity is
 *   computed once per hex and cached; a hex never re-pings this session.
 */
export function SpotToast({ runtime }) {
  const [toasts, setToasts] = useState([]);
  const seenHead = useRef(usePassportStore.getState().spottedAircraft[0]?.timestamp ?? 0);
  const idRef = useRef(0);

  useEffect(() => {
    const unsub = usePassportStore.subscribe((state) => {
      const head = state.spottedAircraft[0];
      if (!head || head.timestamp <= seenHead.current) return;
      seenHead.current = head.timestamp;

      const isNew = !state.spottedAircraft.slice(1).some((s) => s.hex === head.hex);
      const tier = getRarityTier(head.rarity);
      const tierIndex = Object.keys(RARITY_TIERS).indexOf(tier.tier);
      runtime.audio?.spotBlip?.(Math.max(0, tierIndex));

      const toast = {
        id: idRef.current++,
        isNew,
        tier,
        accent: tier.color,
        title: head.flight || head.registration || head.hex.toUpperCase(),
        type: getAircraftTypeName(head.type, null) || head.type || '',
      };
      setToasts((prev) => [toast, ...prev].slice(0, MAX_STACK));
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, TOAST_MS);
    });
    return unsub;
  }, [runtime]);

  // --- Round 7: airport buzz / touch-and-go (fly-store discrete field) ----
  useEffect(() => {
    let prevAt = useFlyStore.getState().buzz?.at ?? 0;
    return useFlyStore.subscribe((s) => {
      const b = s.buzz;
      if (!b || b.at <= prevAt) return;
      prevAt = b.at;
      runtime.audio?.spotBlip?.(2);
      const toast = {
        id: idRef.current++,
        buzz: true,
        accent: '#ffd84d', // PALETTE.accentYellow — arcade stunt stamp
        label: b.kind === 'buzz' ? '⌁ buzzed the tower' : '⌁ touch-and-go',
        title: b.airport,
        type: '',
      };
      setToasts((prev) => [toast, ...prev].slice(0, MAX_STACK));
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, SPICY_TOAST_MS);
    });
  }, [runtime]);

  // --- SPICY scan: military / epic+ contacts, 2s cadence, once per hex ----
  useEffect(() => {
    const seen = new Set();
    const rarityByHex = new Map(); // calculateRarity is pure — cache per hex
    const tierKeys = Object.keys(RARITY_TIERS);
    const minTierIdx = tierKeys.indexOf(SPICY.minTier);

    const id = setInterval(() => {
      const traffic = runtime.traffic;
      const flight = runtime.flight;
      if (!traffic || !flight) return;
      // Collect every fresh qualifier, then ping the NEAREST (round 6): the
      // old first-in-items-order pick let a 34nm contact beat a 5nm one,
      // and on military-heavy evenings the queue ran minutes deep.
      let best = null;
      let bestScore = null;
      let bestMil = false;
      for (const it of traffic.items) {
        if (!it.meta || it.stale === 2 || seen.has(it.hex)) continue;
        const distNm = it.distM / 1852;
        if (distNm > SPICY.maxRangeNm) continue;
        let score = rarityByHex.get(it.hex);
        if (score == null) {
          score = calculateRarity({
            _classification: it.meta.iconType,
            t: it.meta.t,
            flight: it.meta.flight,
            squawk: it.meta.squawk,
          });
          rarityByHex.set(it.hex, score);
        }
        const tier = getRarityTier(score);
        // Military hexes on TRIVIAL GA types (Civil Air Patrol C172s etc.)
        // must clear the rarity gate like anyone else — "SPICY Cessna 172"
        // was the user's exact complaint (round 6).
        const military =
          it.meta.iconType === 'military' && !SPICY.gaTypes.includes(it.meta.t);
        if (!military && tierKeys.indexOf(tier.tier) < minTierIdx) continue;
        if (!best || it.distM < best.distM) {
          best = it;
          bestScore = tier;
          bestMil = military;
        }
      }
      if (!best) return;
      const it = best;
      const tier = bestScore;
      const distNm = it.distM / 1852;
      seen.add(it.hex);
      const brg = Math.atan2(it.rx - flight.pos.x, -(it.rz - flight.pos.z));
      const dir = COMPASS[Math.round((((brg * 180) / Math.PI + 360) % 360) / 45) % 8];
      runtime.spicyPulse = { hex: it.hex, until: performance.now() + SPICY.pulseSec * 1000 };
      runtime.audio?.spotBlip?.(Math.max(2, tierKeys.indexOf(tier.tier)));

      const toast = {
        id: idRef.current++,
        spicy: true,
        tier,
        accent: bestMil ? MILITARY_ACCENT : tier.color,
        title: it.meta.flight || it.meta.r || it.hex.toUpperCase(),
        type: getAircraftTypeName(it.meta.t, null) || it.meta.t || '',
        where: `${distNm < 10 ? distNm.toFixed(1) : Math.round(distNm)}nm ${dir}`,
      };
      setToasts((prev) => [toast, ...prev].slice(0, MAX_STACK));
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, SPICY_TOAST_MS);
      // still at most one fresh ping per scan — no burst on warp arrival
    }, SPICY.scanIntervalMs);

    return () => {
      clearInterval(id);
      runtime.spicyPulse = null;
    };
  }, [runtime]);

  return (
    <div className="pointer-events-none absolute right-4 top-16 z-10 flex flex-col items-end gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 60, scale: 0.85, rotate: 3 }}
            animate={{ opacity: 1, x: 0, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, x: 40, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 380, damping: 24 }}
            className="overflow-hidden rounded-xl border backdrop-blur-md"
            style={{
              // Fixed dark glass — CARD_THEME.bg* went transparent for the
              // round-7 inspect redesign; toasts must stay readable.
              background: 'linear-gradient(180deg, rgba(16, 19, 34, 0.9), rgba(7, 10, 20, 0.94))',
              borderColor: `${t.accent}66`,
              boxShadow: `0 8px 28px rgba(2, 4, 10, 0.6), 0 0 18px ${t.accent}22`,
            }}
            data-testid={t.buzz ? 'buzz-toast' : t.spicy ? 'spicy-toast' : 'spot-toast'}
          >
            <div className="flex items-center gap-2.5 px-3.5 py-2">
              <span
                className="text-[10px] uppercase tracking-[0.18em]"
                style={{ fontFamily: CARD_THEME.fontDisplay, color: t.accent }}
              >
                {t.buzz ? t.label : t.spicy ? '◆ spicy' : t.isNew ? '⟬ new spot! ⟭' : 'spotted'}
              </span>
              <span
                className="font-mono text-[12px] font-bold"
                style={{ color: CARD_THEME.ice }}
              >
                {t.title}
              </span>
              {t.type && (
                <span className="font-mono text-[10px]" style={{ color: CARD_THEME.iceDim }}>
                  {t.type}
                </span>
              )}
              {t.spicy ? (
                <span className="font-mono text-[10px] font-bold" style={{ color: CARD_THEME.ice }}>
                  {t.where}
                </span>
              ) : t.tier ? (
                <span
                  className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                  style={{ color: t.tier.color, background: `${t.tier.color}1a` }}
                >
                  {t.tier.name}
                </span>
              ) : null}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
