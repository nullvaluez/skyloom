'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useFlyStore } from '@/stores/fly-store';
import { usePassportStore } from '@/stores/passport-store';
import { useSheetLayout } from '@/hooks/use-sheet-layout';
import { LOGBOOK } from '@/lib/fly/fly-constants';
import { EXACT_TYPE_CODES } from '@/lib/aircraft-type-tables';
import { getAircraftTypeName } from '@/lib/aircraft-type-names';
import { getBadgesByTier, getStreakDays } from '@/lib/badges';
import { getRarityTier } from '@/lib/rarity';
import { CARD_THEME } from './inspect/inspect-tokens';
import { Odometer } from './inspect/card-bits';
import {
  ActivityStrip,
  BadgeCard,
  Chip,
  GhostLine,
  SpotRow,
  StatTile,
  TabButton,
  placeLabel,
  timeLabel,
} from './logbook/logbook-bits';

/**
 * THE PILOT LOGBOOK (round 16 §A3).
 *
 * The Spotter's Passport has persisted up to 1000 spots, 24 badges and a full
 * stats block since long before Fly Mode — and rendered exactly ONE number
 * (the HUD's "Spots" cell). Badges unlocked in total silence. This is that
 * data's surface.
 *
 * Shape: an Atlas-precedent FULL-SCREEN overlay, not a dock — the panel is
 * something you open, read and close, so it gets the whole screen and the
 * world keeps flying behind it (FlyScene neutralizes the stick on
 * `logbookOpen`, exactly like inspect/atlas). The desktop scrim stops short of
 * the bottom strip so the required Esri/OSM attribution is never covered; the
 * phone takes the full 100svh (the attribution rides under the sheet the same
 * way the inspect sheet covers it).
 *
 * Cost: ZERO per-frame work. Everything derives in useMemo from two discrete
 * zustand selectors; there is no interval, no rAF, no runtime read. The panel
 * only exists while open (the store gate below unmounts the whole body), so a
 * closed logbook costs one boolean subscription.
 *
 * Keys: L toggles and Esc closes — BOTH handled in FlyMode's single window
 * keydown listener, deliberately. The Atlas's private 'm' listener taught us
 * that a second window listener races the first on mount order; and 1/2/3 stay
 * speed presets even with the overlay up, so the tabs are click/tap only.
 */
export function Logbook() {
  const open = useFlyStore((s) => s.logbookOpen);
  return open ? <LogbookBody /> : null;
}

const TABS = [
  ['log', 'Log'],
  ['badges', 'Badges'],
  ['stats', 'Stats'],
];
const SCOPES = [
  ['unique', 'Unique'],
  ['all', 'All'],
];
const SORTS = [
  ['recent', 'Recent'],
  ['rarest', 'Rarest'],
  ['type', 'Type'],
];
const KINDS = [
  ['all', 'All'],
  ['mil', 'Mil'],
  ['heli', 'Heli'],
  ['epic', 'Epic+'],
];
const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum'];
const EPIC_MIN = 70; // RARITY_TIERS.epic.min — "the good stuff" filter
const DAY_MS = 86400000;

function LogbookBody() {
  const isSheet = useSheetLayout();
  const spots = usePassportStore((s) => s.spottedAircraft);
  const badges = usePassportStore((s) => s.badges);
  const stats = usePassportStore((s) => s.stats);

  const [tab, setTab] = useState('log');
  const [scope, setScope] = useState('unique');
  const [sort, setSort] = useState('recent');
  const [kind, setKind] = useState('all');
  const [page, setPage] = useState(1);

  const close = () => useFlyStore.getState().setLogbookOpen(false);

  // Any change to what the list SHOWS restarts the window — otherwise a
  // 600-row page survives a filter switch that leaves 4 matches.
  useEffect(() => setPage(1), [scope, sort, kind, tab]);

  // ---- LOG: filter → sort → window ---------------------------------------
  const rows = useMemo(() => {
    // spottedAircraft is newest-first (logSpot prepends), so "first seen in
    // this array" is the MOST RECENT sighting of that hex — the right one to
    // keep for the unique view.
    let list = spots;
    if (scope === 'unique') {
      const seen = new Set();
      list = list.filter((s) => {
        if (seen.has(s.hex)) return false;
        seen.add(s.hex);
        return true;
      });
    }
    if (kind === 'mil') list = list.filter((s) => s.classification === 'military');
    else if (kind === 'heli') list = list.filter((s) => s.classification === 'helicopter');
    else if (kind === 'epic') list = list.filter((s) => (s.rarity ?? 0) >= EPIC_MIN);

    if (sort === 'rarest') {
      list = [...list].sort(
        (a, b) => (b.rarity ?? 0) - (a.rarity ?? 0) || b.timestamp - a.timestamp
      );
    } else if (sort === 'type') {
      list = [...list].sort(
        (a, b) =>
          // untyped tails sort last, not first ('~' > any designator)
          String(a.type || '~~~~').localeCompare(String(b.type || '~~~~')) ||
          b.timestamp - a.timestamp
      );
    }
    return list;
  }, [spots, scope, sort, kind]);

  const visible = rows.slice(0, page * LOGBOOK.pageSize);
  const hasMore = visible.length < rows.length;

  // Windowed growth WITHOUT a virtualization dependency: a sentinel below the
  // last rendered row grows the window when it scrolls into the list's own
  // scroll container. No scroll handler, so no per-scroll-event React.
  const scrollRef = useRef(null);
  const sentinelRef = useRef(null);
  useEffect(() => {
    if (tab !== 'log' || !hasMore) return undefined;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setPage((p) => p + 1);
      },
      { root: scrollRef.current, rootMargin: '240px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [tab, hasMore, page]);

  // ---- STATS -------------------------------------------------------------
  const summary = useMemo(() => {
    const uniq = stats.uniqueTypes ?? new Set();
    // "Types collected" counts the ones the classifier actually KNOWS (the
    // R15 audited table) — a garbled ADS-B designator shouldn't inflate a
    // collection score. The raw count rides underneath, honestly labelled.
    let known = 0;
    for (const t of uniq) {
      if (t && EXACT_TYPE_CODES.has(String(t).toUpperCase())) known += 1;
    }
    const now = Date.now();
    const days = [];
    for (let i = LOGBOOK.activityDays - 1; i >= 0; i--) {
      const key = new Date(now - i * DAY_MS).toISOString().split('T')[0];
      days.push({ key, count: stats.spotsByDay?.[key] ?? 0 });
    }
    const rarest = stats.rarestFind ?? null;
    const rarestSpot = rarest ? spots.find((s) => s.hex === rarest.hex) ?? null : null;
    const weekAgo = now - 7 * DAY_MS;
    // Computed HERE, not read from the persisted weeklyRareFinds: that array
    // is only rewritten when a spot is logged, so a week without flying leaves
    // it showing finds that have aged out.
    const topWeek = spots
      .filter((s) => s.timestamp > weekAgo)
      .slice()
      .sort((a, b) => (b.rarity ?? 0) - (a.rarity ?? 0))
      .slice(0, 5);
    return {
      known,
      seen: uniq.size ?? 0,
      days,
      rarest,
      rarestSpot,
      topWeek,
      streak: getStreakDays(stats.spotsByDay, now),
    };
  }, [spots, stats]);

  // ---- BADGES (24 cards — cheap enough to build inline every render) ------
  const grouped = getBadgesByTier();
  const earnedById = new Map(badges.map((b) => [b.id, b]));
  const progressOf = usePassportStore.getState().getBadgeProgress;
  const earnedCount = badges.length;
  const badgeTotal = TIER_ORDER.reduce((n, t) => n + (grouped[t]?.length ?? 0), 0);

  const tall = isSheet;

  return (
    <div
      className="absolute inset-x-0 top-0 z-20 flex items-center justify-center"
      style={{ background: CARD_THEME.scrim, bottom: isSheet ? 0 : '2rem' }}
      data-testid="logbook"
    >
      <motion.div
        initial={isSheet ? { y: 40, opacity: 0.5 } : { scale: 0.985, opacity: 0.4 }}
        animate={isSheet ? { y: 0, opacity: 1 } : { scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className={`pointer-events-auto flex flex-col border shadow-2xl backdrop-blur-md ${
          isSheet ? 'px-3 pb-2 pt-2' : 'rounded-xl p-4'
        }`}
        style={{
          background: `linear-gradient(180deg, ${CARD_THEME.bgTop}, ${CARD_THEME.bgBottom})`,
          borderColor: CARD_THEME.edge,
          width: isSheet ? '100%' : `min(94%, ${LOGBOOK.panelW}px)`,
          height: isSheet ? '100svh' : 'min(92%, 720px)',
          // Phone: clear the notch at the top and the gesture bar at the
          // bottom — the sheet owns the whole viewport.
          paddingTop: isSheet ? 'max(0.5rem, env(safe-area-inset-top))' : undefined,
          paddingBottom: isSheet ? 'max(0.5rem, env(safe-area-inset-bottom))' : undefined,
        }}
      >
        {/* ---- Header: title · total · tabs · close ---- */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h2
            className="text-lg uppercase tracking-[0.3em] max-sm:text-sm max-sm:tracking-[0.2em]"
            style={{ fontFamily: CARD_THEME.fontDisplay, color: CARD_THEME.ice }}
          >
            Pilot Logbook
          </h2>
          <span
            className="font-mono text-[11px] uppercase tracking-[0.2em]"
            style={{ color: CARD_THEME.iceDim }}
            data-testid="logbook-total"
          >
            <Odometer
              value={stats.totalSpotted ?? 0}
              format={(v) => `${Math.round(v).toLocaleString()} spots`}
              style={{ color: CARD_THEME.ice }}
            />
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {TABS.map(([id, label]) => (
              <TabButton
                key={id}
                label={label}
                active={tab === id}
                onClick={() => setTab(id)}
                tall={tall}
              />
            ))}
            <span
              className="ml-1 font-mono text-[10px] max-sm:hidden"
              style={{ color: CARD_THEME.iceFaint }}
            >
              esc / L close
            </span>
            <button
              onClick={close}
              className="rounded-md border px-2 py-1 font-mono text-xs transition-colors hover:bg-white/10"
              style={{
                borderColor: CARD_THEME.edgeSoft,
                color: CARD_THEME.iceDim,
                minHeight: tall ? 50 : undefined,
                minWidth: tall ? 50 : undefined,
              }}
              aria-label="Close logbook"
              data-testid="logbook-close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* ---- LOG ---- */}
        {tab === 'log' && (
          <div className="mt-3 flex min-h-0 flex-1 flex-col" data-testid="logbook-log">
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {SCOPES.map(([id, label]) => (
                <Chip
                  key={id}
                  label={label}
                  active={scope === id}
                  onClick={() => setScope(id)}
                  tall={tall}
                />
              ))}
              <span className="mx-1 opacity-30" style={{ color: CARD_THEME.iceFaint }}>
                |
              </span>
              {SORTS.map(([id, label]) => (
                <Chip
                  key={id}
                  label={label}
                  active={sort === id}
                  onClick={() => setSort(id)}
                  tall={tall}
                />
              ))}
              <span className="mx-1 opacity-30" style={{ color: CARD_THEME.iceFaint }}>
                |
              </span>
              {KINDS.map(([id, label]) => (
                <Chip
                  key={id}
                  label={label}
                  active={kind === id}
                  onClick={() => setKind(id)}
                  tall={tall}
                />
              ))}
              <span
                className="ml-auto font-mono text-[10px]"
                style={{ color: CARD_THEME.iceFaint }}
                data-testid="logbook-count"
              >
                {rows.length.toLocaleString()} shown
              </span>
            </div>

            <div ref={scrollRef} className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
              {visible.length === 0 ? (
                <GhostLine testid="logbook-empty">
                  nothing logged here yet — lock a plane (F) or click one to inspect it
                </GhostLine>
              ) : (
                <>
                  {visible.map((s) => (
                    <SpotRow key={`${s.hex}-${s.timestamp}`} spot={s} tall={tall} />
                  ))}
                  {hasMore && (
                    <div
                      ref={sentinelRef}
                      data-testid="logbook-more-sentinel"
                      className="py-4 text-center font-mono text-[10px] uppercase tracking-[0.3em]"
                      style={{ color: CARD_THEME.iceFaint }}
                    >
                      loading {(rows.length - visible.length).toLocaleString()} more…
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ---- BADGES ---- */}
        {tab === 'badges' && (
          <div
            className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1"
            data-testid="logbook-badges"
          >
            <div
              className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em]"
              style={{ color: CARD_THEME.iceDim }}
            >
              {earnedCount} / {badgeTotal} earned
            </div>
            {TIER_ORDER.map((tier) => (
              <div key={tier} className="mb-3">
                <div
                  className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.3em]"
                  style={{ color: CARD_THEME.iceFaint }}
                >
                  {tier}
                </div>
                <div className="grid grid-cols-4 gap-2 max-sm:grid-cols-2">
                  {(grouped[tier] ?? []).map((b) => (
                    <BadgeCard
                      key={b.id}
                      badge={b}
                      earnedAt={earnedById.get(b.id)?.earnedAt ?? null}
                      progress={progressOf(b.id)}
                      tall={tall}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ---- STATS ---- */}
        {tab === 'stats' && (
          <div
            className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
            data-testid="logbook-stats"
          >
            <div className="grid grid-cols-4 gap-2 max-sm:grid-cols-2">
              <StatTile label="total spots">
                <Odometer value={stats.totalSpotted ?? 0} />
              </StatTile>
              <StatTile
                label="types collected"
                sub={`${summary.seen.toLocaleString()} designators seen`}
                testid="logbook-types"
              >
                <Odometer value={summary.known} />
                <span style={{ color: CARD_THEME.iceDim }}>/{EXACT_TYPE_CODES.size}</span>
              </StatTile>
              <StatTile label="military">
                <Odometer value={stats.militaryCount ?? 0} />
              </StatTile>
              <StatTile label="helicopters">
                <Odometer value={stats.helicopterCount ?? 0} />
              </StatTile>
              <StatTile label="emergencies">
                <Odometer value={stats.emergencyCount ?? 0} />
              </StatTile>
              <StatTile
                label="first spot"
                sub={
                  stats.lastSpotDate ? `last ${timeLabel(stats.lastSpotDate)}` : undefined
                }
              >
                {stats.firstSpotDate
                  ? new Date(stats.firstSpotDate).toLocaleDateString()
                  : '—'}
              </StatTile>
              <StatTile
                label="rarest find"
                sub={
                  summary.rarestSpot
                    ? getAircraftTypeName(summary.rarestSpot.type, null) ||
                      summary.rarestSpot.type ||
                      (summary.rarest?.hex ?? '').toUpperCase()
                    : undefined
                }
                testid="logbook-rarest"
              >
                {summary.rarest ? (
                  <span style={{ color: getRarityTier(summary.rarest.rarity).color }}>
                    {getRarityTier(summary.rarest.rarity).name}
                  </span>
                ) : (
                  '—'
                )}
              </StatTile>
              <StatTile
                label="day streak"
                sub={summary.streak >= 2 ? 'consecutive days flying' : undefined}
                testid="logbook-streak"
              >
                {summary.streak >= 2 ? `🔥 ${summary.streak}` : summary.streak}
              </StatTile>
            </div>

            <div className="rounded-xl px-3 py-2.5" style={{ background: CARD_THEME.panel }}>
              <div
                className="mb-2 font-mono text-[9px] uppercase tracking-[0.22em]"
                style={{ color: CARD_THEME.iceFaint }}
              >
                last {LOGBOOK.activityDays} days
              </div>
              <ActivityStrip days={summary.days} />
            </div>

            <div className="rounded-xl px-3 py-2.5" style={{ background: CARD_THEME.panel }}>
              <div
                className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.22em]"
                style={{ color: CARD_THEME.iceFaint }}
              >
                this week&apos;s best finds
              </div>
              {summary.topWeek.length === 0 ? (
                <div
                  className="py-1 font-mono text-[10px] uppercase tracking-[0.25em]"
                  style={{ color: CARD_THEME.iceFaint }}
                >
                  nothing logged in the last 7 days
                </div>
              ) : (
                summary.topWeek.map((s) => {
                  const tier = getRarityTier(s.rarity ?? 0);
                  return (
                    <div
                      key={`${s.hex}-${s.timestamp}`}
                      className="flex items-baseline gap-2 py-0.5 font-mono text-[11px]"
                      data-testid="logbook-week-find"
                    >
                      <span className="shrink-0" style={{ color: tier.color }}>
                        ◆
                      </span>
                      <span className="shrink-0" style={{ color: CARD_THEME.ice }}>
                        {s.flight || s.registration || (s.hex || '').toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate" style={{ color: CARD_THEME.iceDim }}>
                        {getAircraftTypeName(s.type, null) || s.type || ''}
                      </span>
                      <span className="shrink-0 max-sm:hidden" style={{ color: CARD_THEME.iceFaint }}>
                        {placeLabel(s.location)}
                      </span>
                      <span className="shrink-0" style={{ color: CARD_THEME.iceDim }}>
                        {timeLabel(s.timestamp)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
