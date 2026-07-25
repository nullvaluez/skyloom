'use client';

import { AIRCRAFT_SILHOUETTES, getBestSilhouette } from '@/lib/aircraft-silhouettes';
import { getAircraftTypeName } from '@/lib/aircraft-type-names';
import { getRarityTier } from '@/lib/rarity';
import { BADGE_TIERS } from '@/lib/badges';
import { CARD_THEME } from '../inspect/inspect-tokens';
import { RarityChip } from '../inspect/card-bits';

/**
 * Pilot Logbook atoms (round 16 §A3). Same INK+ICE voice as the inspect card
 * — near-black glass, ice text, and colour ONLY on the two saturated voices
 * the codex already owns: rarity tier and badge tier. Everything here is a
 * pure presentational component: the Logbook shell owns all derivation, these
 * just draw.
 *
 * TOUCH: every interactive atom takes `tall`, which the shell wires to the
 * shared phone-sheet breakpoint (hooks/use-sheet-layout). 50px is the same
 * floor the inspect sheet's WARP/CHASE buttons use.
 */

const TOUCH_H = 50;

// --- formatting -------------------------------------------------------------

/** Compact stamp: today reads as a clock, older days as a short date. */
export function timeLabel(ts) {
  if (!Number.isFinite(ts)) return '—';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  try {
    return sameDay
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

/** Where it was seen — one degree of precision is plenty at a glance. */
export function placeLabel(location) {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) {
    return '—';
  }
  const ns = location.lat >= 0 ? 'N' : 'S';
  const ew = location.lon >= 0 ? 'E' : 'W';
  return `${Math.abs(location.lat).toFixed(1)}°${ns} ${Math.abs(location.lon).toFixed(1)}°${ew}`;
}

// --- controls ---------------------------------------------------------------

/** LOG / BADGES / STATS. Click (or tap) only — 1/2/3 are speed presets. */
export function TabButton({ label, active, onClick, tall = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] transition-colors"
      style={{
        fontFamily: CARD_THEME.fontDisplay,
        color: active ? CARD_THEME.ice : CARD_THEME.iceDim,
        borderColor: active ? CARD_THEME.edge : 'transparent',
        background: active ? CARD_THEME.panelHover : 'transparent',
        minHeight: tall ? TOUCH_H : undefined,
        minWidth: tall ? 84 : undefined,
      }}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

/** Filter/sort pill. */
export function Chip({ label, active, onClick, tall = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-opacity"
      style={{
        color: active ? CARD_THEME.ice : CARD_THEME.iceDim,
        background: active ? CARD_THEME.panelHover : CARD_THEME.panel,
        opacity: active ? 1 : 0.6,
        minHeight: tall ? TOUCH_H : undefined,
        minWidth: tall ? 56 : undefined,
      }}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

/** Small ghost line for an empty tab/filter — never a blank rectangle. */
export function GhostLine({ children, testid }) {
  return (
    <div
      className="rounded-xl px-3 py-6 text-center font-mono text-[10px] uppercase tracking-[0.3em]"
      style={{ background: CARD_THEME.panel, color: CARD_THEME.iceFaint }}
      data-testid={testid}
    >
      {children}
    </div>
  );
}

// --- LOG tab ----------------------------------------------------------------

/**
 * The type's silhouette, tinted by the spot's rarity tier. Same lookup the
 * inspect turntable's badge uses (getBestSilhouette → AIRCRAFT_SILHOUETTES),
 * so a type that has a real shape in the card has the same shape here.
 */
export function Silhouette({ type, classification, color, size = 28 }) {
  const key = getBestSilhouette({ t: type }, classification || 'airliner');
  const def = AIRCRAFT_SILHOUETTES[key] ?? AIRCRAFT_SILHOUETTES.unknown;
  if (!def) return <span style={{ width: size, height: size }} />;
  return (
    <svg
      viewBox={def.viewBox}
      width={size}
      height={size}
      className="shrink-0"
      aria-hidden="true"
    >
      {def.paths.map((p, i) => (
        <path key={i} d={p.d} fill={color} opacity={0.9} />
      ))}
    </svg>
  );
}

/** One logged sighting. */
export function SpotRow({ spot, tall = false }) {
  const tier = getRarityTier(spot.rarity ?? 0);
  const title = spot.flight || spot.registration || (spot.hex || '').toUpperCase();
  const typeName = getAircraftTypeName(spot.type, null) || spot.type || 'unknown type';
  return (
    <div
      className="flex items-center gap-3 border-b px-1 py-1.5"
      style={{ borderColor: CARD_THEME.edgeSoft, minHeight: tall ? TOUCH_H : undefined }}
      data-testid="logbook-entry"
      data-hex={spot.hex}
      data-rarity={spot.rarity ?? 0}
    >
      <Silhouette type={spot.type} classification={spot.classification} color={tier.color} />
      <div className="min-w-0 flex-1">
        <div
          className="truncate font-mono text-[12px] font-bold"
          style={{ color: CARD_THEME.ice }}
          title={title}
        >
          {title}
        </div>
        <div
          className="truncate text-[10.5px]"
          style={{ color: CARD_THEME.iceDim }}
          title={typeName}
        >
          {typeName}
        </div>
      </div>
      <div className="shrink-0">
        <RarityChip tier={tier} />
      </div>
      <div
        className="w-14 shrink-0 text-right font-mono text-[10px]"
        style={{ color: CARD_THEME.iceDim }}
      >
        {timeLabel(spot.timestamp)}
      </div>
      <div
        className="w-28 shrink-0 text-right font-mono text-[10px] max-sm:hidden"
        style={{ color: CARD_THEME.iceFaint }}
      >
        {placeLabel(spot.location)}
      </div>
    </div>
  );
}

// --- BADGES tab -------------------------------------------------------------

/**
 * One achievement card. Locked cards keep their shape but lose their colour
 * (greyscale icon, dimmed plate) and show the progress they DO have — the
 * point of the tab is "here is what is left", not "here is a wall of grey".
 */
export function BadgeCard({ badge, earnedAt, progress, tall = false }) {
  const tier = BADGE_TIERS[badge.tier] ?? BADGE_TIERS.bronze;
  const earned = !!earnedAt;
  const target = Math.max(1, progress?.target ?? 1);
  const pct = earned ? 1 : Math.max(0, Math.min(1, (progress?.progress ?? 0) / target));
  return (
    <div
      className="flex flex-col gap-1.5 rounded-xl border px-2.5 py-2"
      style={{
        background: earned ? tier.bgColor : CARD_THEME.panel,
        borderColor: earned ? tier.borderColor : CARD_THEME.edgeSoft,
        minHeight: tall ? 96 : undefined,
      }}
      data-testid="logbook-badge"
      data-badge-id={badge.id}
      data-earned={earned ? '1' : '0'}
    >
      <div className="flex items-start gap-2">
        <span
          className="shrink-0 text-[20px] leading-none"
          style={{ filter: earned ? 'none' : 'grayscale(1)', opacity: earned ? 1 : 0.4 }}
          aria-hidden="true"
        >
          {badge.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[11.5px] font-semibold"
            style={{ color: earned ? tier.color : CARD_THEME.iceDim }}
            title={badge.name}
          >
            {badge.name}
          </div>
          <div
            className="text-[9.5px] leading-tight"
            style={{ color: CARD_THEME.iceFaint }}
          >
            {badge.description}
          </div>
        </div>
      </div>
      <div className="mt-auto">
        <div
          className="relative h-[3px] overflow-hidden rounded-full"
          style={{ background: 'rgba(207, 238, 248, 0.12)' }}
          data-testid="logbook-badge-progress"
          data-pct={pct.toFixed(3)}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${(pct * 100).toFixed(1)}%`,
              background: tier.color,
              opacity: earned ? 0.9 : 0.5,
            }}
          />
        </div>
        <div
          className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.18em]"
          style={{ color: CARD_THEME.iceFaint }}
        >
          {earned
            ? `earned ${timeLabel(earnedAt)}`
            : `${Math.round(progress?.progress ?? 0)} / ${target}`}
        </div>
      </div>
    </div>
  );
}

// --- STATS tab --------------------------------------------------------------

/** One headline number with its label (and an optional footnote line). */
export function StatTile({ label, children, sub, testid }) {
  return (
    <div
      className="rounded-xl px-3 py-2"
      style={{ background: CARD_THEME.panel }}
      data-testid={testid}
    >
      <div
        className="font-mono text-[9px] uppercase tracking-[0.22em]"
        style={{ color: CARD_THEME.iceFaint }}
      >
        {label}
      </div>
      <div
        className="mt-0.5 truncate text-[19px] leading-tight"
        style={{ fontFamily: CARD_THEME.fontDisplay, color: CARD_THEME.ice }}
      >
        {children}
      </div>
      {sub && (
        <div
          className="truncate font-mono text-[9.5px]"
          style={{ color: CARD_THEME.iceDim }}
          title={typeof sub === 'string' ? sub : undefined}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

/**
 * 28-day spotting habit strip. One cell per UTC day (the same key logSpot
 * writes), oldest → today; intensity is a 4-step ramp so a 40-spot day and a
 * 2-spot day don't look the same but the strip never becomes a chart.
 */
export function ActivityStrip({ days }) {
  const peak = Math.max(1, ...days.map((d) => d.count));
  return (
    <div className="flex flex-wrap gap-[3px]" data-testid="logbook-activity">
      {days.map((d) => {
        const k = d.count === 0 ? 0 : Math.min(1, 0.25 + (0.75 * d.count) / peak);
        return (
          <span
            key={d.key}
            className="h-3.5 w-3.5 rounded-[3px]"
            data-day={d.key}
            data-count={d.count}
            title={`${d.key} · ${d.count} spot${d.count === 1 ? '' : 's'}`}
            style={{
              background:
                k === 0
                  ? 'rgba(207, 238, 248, 0.06)'
                  : `color-mix(in srgb, ${CARD_THEME.ice} ${Math.round(k * 78)}%, transparent)`,
            }}
          />
        );
      })}
    </div>
  );
}
