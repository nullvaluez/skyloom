'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePassportStore } from '@/stores/passport-store';
import { useFlyStore } from '@/stores/fly-store';
import { useFlyContractsStore } from '@/stores/fly-contracts-store';
import { calculateRarity, getRarityTier, RARITY_TIERS } from '@/lib/rarity';
import { getAircraftTypeName } from '@/lib/aircraft-type-names';
import { BADGES, BADGE_TIERS } from '@/lib/badges';
import { MOBILE_UI, NEARMISS, SPICY } from '@/lib/fly/fly-constants';
import { trackSpotAttrs } from '@/lib/fly/spot-attrs';
import { gameplayLive } from '@/lib/fly/front-door';
import { mpAvailable } from '@/lib/fly/mp/mp-flag';
import { Zone } from '../LayoutRoot';
import { useDeviceLayout } from '@/hooks/use-device-layout';
import { CARD_THEME } from './inspect/inspect-tokens';

const TOAST_MS = 3500;
const SPICY_TOAST_MS = 4800;
// Badges are rarer and carry more text (name + description) — they need a
// beat longer on screen than a spot stamp.
const BADGE_TOAST_MS = 5200;
// A contract stamp is short (label + points) — it does not need the badge dwell.
const CONTRACT_TOAST_MS = 4200;
const MAX_STACK = 2;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const MILITARY_ACCENT = '#f87171';
// PALETTE.accentGreen — the same "objective cleared" green the Contracts panel
// stamps a completed row with (var(--contract-done)).
const CONTRACT_ACCENT = '#4ade80';
// MULTIPLAYER (MULTIPLAYER.md §8): another pilot's quick signal. ONE pending
// entry at most — later signals merge into it — and an entry that waited
// longer than this in the queue is dropped instead of shown late.
const SIGNAL_STALE_MS = 3000;
// A visible signal card absorbs a newcomer only while it has this long left
// on screen, so a merged sender is never shown for a blink.
const SIGNAL_MERGE_LEFT_MS = 1500;
const SIGNAL_GLYPH = { wave: '👋', follow: '➜', nice: '👍' };
const SIGNAL_VERB = {
  wave: ['waves', 'wave'],
  follow: ['says follow me', 'say follow me'],
  nice: ['says nice', 'say nice'],
};
const SIGNAL_ACCENT = '#c084fc';
// Read once (installUrlFlags runs before the lazy FlyMode import): flag off,
// the listener below is never added.
const MP_SIGNALS = mpAvailable();

/** Fold one 'fly-mp-signal' detail into a signal toast entry (in place). */
function mergeSignal(entry, d, now) {
  if (!entry.senders.size) {
    entry.first = d.callsign || 'A pilot';
    entry.accent = d.color || SIGNAL_ACCENT;
  }
  entry.senders.set(d.id ?? d.callsign, d.code);
  entry.at = now;
  const n = entry.senders.size;
  const codes = new Set(entry.senders.values());
  const code = n === 1 || codes.size === 1 ? d.code : null;
  entry.label = `${code ? SIGNAL_GLYPH[code] : '✦'} ${n === 1 ? 'pilot' : 'pilots'}`;
  entry.title = n === 1 ? entry.first : `${entry.first} + ${n - 1} other${n > 2 ? 's' : ''}`;
  if (n === 1) {
    const nm = (d.distM ?? 0) / 1852;
    const where = `${nm < 10 ? nm.toFixed(1) : Math.round(nm)} nm${d.clock ? ` ${d.clock} o'clock` : ''}`;
    entry.type = `${SIGNAL_VERB[code][0]} · ${where}`;
  } else {
    entry.type = code ? SIGNAL_VERB[code][1] : 'signal';
  }
  return entry;
}

/**
 * Route one 'fly-mp-signal' detail: into the live card while it has
 * SIGNAL_MERGE_LEFT_MS left, else into the ONE pending entry (restarted if it
 * already went stale), else a new pending entry — returns true for a new one.
 * `liveRef` is the drain's private mirror of the card on screen, merged into
 * SYNCHRONOUSLY: the session dispatches a whole relay batch in one task, so a
 * copy of committed state would hand two same-batch senders the same stale
 * card and the second write would drop the first.
 */
function routeSignal(d, now, liveRef, pendingRef, idRef, setToasts) {
  const live = liveRef.current;
  if (live && live.shownAt + live.ms - now >= SIGNAL_MERGE_LEFT_MS) {
    mergeSignal(live, d, now);
    const snap = { ...live, senders: new Map(live.senders) };
    setToasts((prev) => prev.map((t) => (t.id === snap.id ? snap : t)));
    return false;
  }
  const pending = pendingRef.current.find((p) => p.signal);
  if (pending) {
    // Stale = the drain would drop it: start over rather than headline it.
    if (now - pending.at > SIGNAL_STALE_MS) pending.senders.clear();
    mergeSignal(pending, d, now);
    return false;
  }
  pendingRef.current.push(mergeSignal({ id: idRef.current++, signal: true, ms: TOAST_MS, senders: new Map() }, d, now));
  return true;
}

/** The drain admits a signal entry: stamp it and mirror it as the live card. */
function showSignal(next, now, liveRef) {
  next.shownAt = now;
  liveRef.current = { ...next, senders: new Map(next.senders) };
}

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
 * - Badge unlocks (round 16): the passport's achievements have unlocked in
 *   TOTAL SILENCE since they shipped. A new badge now stamps in with its icon,
 *   name, description and tier chip.
 * - Contract completions (round 17): a cleared objective + its payout, riding
 *   the same deferred queue as badges.
 *
 * Round-16 queueing note: badges — and ONLY badges — defer instead of
 * evicting. The three existing push paths are byte-preserved (verify-spicy and
 * verify-airport-buzz gate their behavior), so a badge that arrives while two
 * toasts are up waits in pendingRef and is drained by the effect below when a
 * slot frees, rather than shoving a live SPICY ping off the stack.
 */
export function SpotToast({ runtime }) {
  const [toasts, setToasts] = useState([]);
  // Round 17: layout ONLY. Not one line of the queueing/eviction machinery
  // below reads this — the push paths, MAX_STACK, pendingRef and the drain
  // effect are byte-identical to R16, because verify-spicy and
  // verify-airport-buzz gate their exact behavior.
  const { isPhone, orientation } = useDeviceLayout();
  const seenHead = useRef(usePassportStore.getState().spottedAircraft[0]?.timestamp ?? 0);
  const idRef = useRef(0);
  const pendingRef = useRef([]); // badge toasts waiting for a free slot
  const [pendingTick, setPendingTick] = useState(0); // nudges the drain effect

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
      // R25 A (FRONT DOOR): no SPICY ping from the title's frozen flight or the
      // hangar — no blip, no minimap pulse, no toast queued behind the hidden
      // HUD, and no hex spent from the once-per-session `seen` set. Constant
      // true with the flag off.
      if (!gameplayLive(useFlyStore.getState())) return;
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
        // MULTIPLAYER: another pilot is never a SPICY contact (fighters would always ping).
        if (!it.meta || it.remote === true || it.stale === 2 || seen.has(it.hex)) continue;
        const distNm = it.distM / 1852;
        if (distNm > SPICY.maxRangeNm) continue;
        let score = rarityByHex.get(it.hex);
        if (score == null) {
          // R17: the shared builder (lib/fly/spot-attrs.js) — the ping now
          // scores the SAME attribute set the card shows and the passport
          // stores, so a contact can't ping at one tier and log at another.
          score = calculateRarity(trackSpotAttrs(it));
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

  // --- Round 16: badge unlocks (queued, never evicting) -------------------
  useEffect(() => {
    // Closure cursor read from getState() AT SUBSCRIBE TIME: StrictMode's
    // subscribe → unsubscribe → subscribe re-reads the live count, so a dev
    // remount can never replay badges that already toasted. (A ref would
    // survive the remount too, but this also self-heals if the store is
    // rehydrated or cleared underneath us.)
    let seenCount = usePassportStore.getState().badges.length;
    return usePassportStore.subscribe((state) => {
      const n = state.badges.length;
      if (n <= seenCount) {
        seenCount = n; // clearAll() shrinks the list — re-arm, never replay
        return;
      }
      const fresh = state.badges.slice(seenCount);
      seenCount = n;
      for (const b of fresh) {
        const def = BADGES[b.id];
        const tier = BADGE_TIERS[def?.tier] ?? BADGE_TIERS.bronze;
        pendingRef.current.push({
          id: idRef.current++,
          badge: true,
          accent: tier.color,
          icon: b.icon || def?.icon || '⬢',
          title: b.name || b.id,
          type: b.description || def?.description || '',
          // Shaped like a rarity tier so the EXISTING chip markup renders it
          // with no extra branch in the JSX.
          tier: { color: tier.color, name: def?.tier ?? 'bronze' },
        });
      }
      setPendingTick((t) => t + 1);
    });
  }, []);

  // --- Round 17: contract completions (SAME deferred queue as badges) ------
  // Completing a contract used to be announced by nothing but a 2.6s
  // strikethrough in a 10rem panel in the corner. It rides the R16 pendingRef
  // path for exactly the R16 reason: the spot / SPICY / buzz push paths are
  // gated by verify-spicy and verify-airport-buzz and stay byte-identical, so
  // a completion waits for a slot instead of evicting a live ping.
  useEffect(() => {
    let prevAt = useFlyContractsStore.getState().lastCompleted?.at ?? 0;
    return useFlyContractsStore.subscribe((state) => {
      const c = state.lastCompleted;
      if (!c || !(c.at > prevAt)) return;
      prevAt = c.at;
      pendingRef.current.push({
        id: idRef.current++,
        contract: true,
        ms: CONTRACT_TOAST_MS,
        accent: CONTRACT_ACCENT,
        label: c.daily ? '◈ daily complete' : '◈ contract complete',
        title: c.label || 'contract',
        type: '',
        pts: c.pts,
      });
      setPendingTick((t) => t + 1);
    });
  }, []);

  // --- Round 18 (A4 SHOWTIME): near-miss bonus ---------------------------
  // JuiceSystems detects the closest-approach inflection inside the canvas
  // frame loop and dispatches a window CustomEvent. A DOM event rather than a
  // store field on purpose: a near miss is a fire-and-forget PING with no
  // state to hold, and routing it through zustand would make a per-frame
  // detector a per-frame store writer. Same deferred queue as badges and
  // contracts, so the spot / SPICY / buzz push paths stay byte-identical.
  useEffect(() => {
    const onNearMiss = (e) => {
      const d = e.detail || {};
      pendingRef.current.push({
        id: idRef.current++,
        nearmiss: true,
        ms: NEARMISS.toastMs,
        accent: NEARMISS.accent,
        label: '⌁ near miss',
        title: d.callsign || '—',
        type: `${d.distM ?? '?'} m`,
        pts: d.pts,
        mult: d.mult,
      });
      setPendingTick((t) => t + 1);
    };
    window.addEventListener('fly-nearmiss', onNearMiss);
    return () => window.removeEventListener('fly-nearmiss', onNearMiss);
  }, []);

  // --- MULTIPLAYER: pilot signals (wave / follow me / nice) ---------------
  // lib/fly/mp/session.js dispatches 'fly-mp-signal' (already range-gated and
  // rate-limited per sender). Same deferred queue as the near miss, with one
  // difference: signals COALESCE. A newcomer merges into the visible signal
  // card while it has time left, else into the ONE pending signal entry, so
  // three pilots waving at once is one "HERON 27 + 2 others wave" card, not
  // three cards burying a badge. Never fires with the flag off.
  const liveSignalRef = useRef(null); // the signal card on screen (routeSignal)
  useEffect(() => {
    if (!MP_SIGNALS) return undefined;
    const onSignal = (e) => {
      const d = e.detail || {};
      if (!SIGNAL_GLYPH[d.code]) return;
      if (routeSignal(d, performance.now(), liveSignalRef, pendingRef, idRef, setToasts)) {
        setPendingTick((t) => t + 1);
      }
    };
    window.addEventListener('fly-mp-signal', onSignal);
    return () => window.removeEventListener('fly-mp-signal', onSignal);
  }, []);
  // A spot / SPICY / buzz push can evict the live signal card: once it has
  // been on screen and is gone, newcomers queue instead of merging into it.
  useEffect(() => {
    const live = liveSignalRef.current;
    if (!live) return;
    if (toasts.some((t) => t.id === live.id)) live.seen = true;
    else if (live.seen) liveSignalRef.current = null;
  }, [toasts]);

  // Dev telemetry: the LIVE stack length. The DOM can transiently hold more
  // badge-toast nodes than MAX_STACK while AnimatePresence plays exit springs
  // (an expiring card + its admitted replacement coexist for ~400ms) — the
  // stack DISCIPLINE lives in this state, and verify-logbook gates on it.
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
      (window.__flyStats ??= {}).toastCount = toasts.length;
    }
  }, [toasts]);

  // Drain the badge queue whenever there is room. The toast stack IS the
  // clock: every existing path ends in a setToasts (push or expiry), so this
  // effect re-runs on its own — no interval, no polling, and crucially no edit
  // to the spot/spicy/buzz push paths.
  useEffect(() => {
    if (toasts.length >= MAX_STACK) return;
    let next = pendingRef.current.shift();
    // MULTIPLAYER: a pilot signal is news only while fresh — one that waited
    // out SIGNAL_STALE_MS behind full slots is dropped, not shown late.
    while (next?.signal && performance.now() - next.at > SIGNAL_STALE_MS) next = pendingRef.current.shift();
    if (!next) return;
    if (next.signal) showSignal(next, performance.now(), liveSignalRef);
    // Round 18: the near-miss flavor brings its own sting (audio.whooshSting,
    // fired at DETECTION so the sound lands with the fly-by, not with the
    // card). Every other flavor keeps the round-16 blip byte-for-byte.
    if (!next.nearmiss) runtime.audio?.spotBlip?.(3); // blip when it APPEARS, not when it queued
    setToasts((prev) => [next, ...prev].slice(0, MAX_STACK));
    setTimeout(() => {
      if (liveSignalRef.current?.id === next.id) liveSignalRef.current = null;
      setToasts((prev) => prev.filter((t) => t.id !== next.id));
    }, next.ms ?? BADGE_TOAST_MS); // badges push no `ms` → unchanged dwell
  }, [toasts, pendingTick, runtime]);

  // A phone card is TWO lines. One line of "label · CALLSIGN · type · tier"
  // measures ~430px; a 375px iPhone SE clipped the tier chip clean off and a
  // badge description ran ~180px past the right edge. Splitting it is a
  // MARKUP change only — same spans, same styles, same testids, regrouped.
  const phone = isPhone;
  const land = phone && orientation === 'landscape';

  return (
    <Zone
      name="toasts"
      className={`flex flex-col items-end gap-2 phone-port:items-stretch phone-land:items-center`}
    >
      <AnimatePresence>
        {toasts.map((t) => {
          const labelEl = (
            <span
              // `truncate` (with min-w-0, which it needs to bite) ONLY on the
              // phone: "⬢ 🐋 badge earned" at 0.18em tracking is ~130px and
              // WRAPPED inside a 262px card, turning the two-line design into
              // three lines and pushing the stack down into the contracts
              // panel. Clipping a label is fine; growing the card is not.
              className={`text-[10px] uppercase tracking-[0.18em] ${
                phone ? 'min-w-0 truncate' : ''
              }`}
              style={{ fontFamily: CARD_THEME.fontDisplay, color: t.accent }}
            >
              {t.nearmiss || t.signal
                ? t.label
                : t.contract
                  ? t.label
                  : t.badge
                    ? `⬢ ${t.icon} badge earned`
                    : t.buzz
                      ? t.label
                      : t.spicy
                        ? '◆ spicy'
                        : t.isNew
                          ? '⟬ new spot! ⟭'
                          : 'spotted'}
            </span>
          );
          const titleEl = (
            <span
              className={`font-mono text-[12px] font-bold ${
                phone ? 'shrink-0 whitespace-nowrap' : ''
              }`}
              style={{ color: CARD_THEME.ice }}
            >
              {t.title}
            </span>
          );
          const typeEl = t.type ? (
            <span
              // Badge descriptions are full sentences — cap them so a
              // toast can never run off the right edge of the screen.
              // On a phone the card is full-width, so the cap becomes
              // "whatever is left on this line" instead of a magic 240px.
              className={`font-mono text-[10px] ${
                phone
                  ? 'min-w-0 flex-1 truncate whitespace-nowrap'
                  : t.badge
                    ? 'max-w-[240px] truncate'
                    : ''
              }`}
              style={{ color: CARD_THEME.iceDim }}
            >
              {t.type}
            </span>
          ) : null;
          const trailEl = t.nearmiss ? (
            <span className="font-mono text-[11px] font-bold" style={{ color: t.accent }}>
              +{t.pts}
              {t.mult > 1 ? ` ×${t.mult}` : ''}
            </span>
          ) : t.contract ? (
            <span className="font-mono text-[11px] font-bold" style={{ color: t.accent }}>
              +{t.pts}
            </span>
          ) : t.spicy ? (
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
          ) : null;

          return (
            <motion.div
              key={t.id}
              // Desktop keeps the exact round-16 spring and offsets. A
              // full-width phone card cannot slide in from "off the right
              // edge" — there is no right edge left — so it drops in.
              initial={
                phone
                  ? { opacity: 0, y: -14, scale: 0.96 }
                  : { opacity: 0, x: 60, scale: 0.85, rotate: 3 }
              }
              animate={
                phone
                  ? { opacity: 1, y: 0, scale: 1 }
                  : { opacity: 1, x: 0, scale: 1, rotate: 0 }
              }
              exit={phone ? { opacity: 0, y: -10, scale: 0.97 } : { opacity: 0, x: 40, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 380, damping: 24 }}
              className="hud-flat-phone overflow-hidden rounded-xl border backdrop-blur-md"
              style={{
                // Fixed dark glass — CARD_THEME.bg* went transparent for the
                // round-7 inspect redesign; toasts must stay readable.
                background: 'linear-gradient(180deg, rgba(16, 19, 34, 0.9), rgba(7, 10, 20, 0.94))',
                borderColor: `${t.accent}66`,
                boxShadow: `0 8px 28px rgba(2, 4, 10, 0.6), 0 0 18px ${t.accent}22`,
                // Landscape: bounded and centred under the strip, so an 844px
                // phone does not get a 6cm-wide banner.
                width: land ? MOBILE_UI.toast.landWidth : undefined,
              }}
              data-testid={
                t.signal
                  ? 'signal-toast'
                  : t.nearmiss
                    ? 'nearmiss-toast'
                    : t.contract
                      ? 'contract-toast'
                      : t.badge
                        ? 'badge-toast'
                        : t.buzz
                          ? 'buzz-toast'
                          : t.spicy
                            ? 'spicy-toast'
                            : 'spot-toast'
              }
            >
              {phone ? (
                <div className="px-3 py-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    {labelEl}
                    {titleEl}
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between gap-2">
                    {typeEl ?? <span />}
                    {trailEl}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2.5 px-3.5 py-2">
                  {labelEl}
                  {titleEl}
                  {typeEl}
                  {trailEl}
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </Zone>
  );
}
