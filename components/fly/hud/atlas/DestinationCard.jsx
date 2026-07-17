'use client';

import { useEffect, useState } from 'react';
import { useFlyAtlasStore } from '@/stores/fly-atlas-store';
import { ATLAS_KIND, CARD_THEME } from './atlas-tokens';

const NM_PER_DEG = 60;

/** Great-circle distance in nautical miles. */
function distNm(lat1, lon1, lat2, lon2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * NM_PER_DEG * (180 / Math.PI);
}

/** Coarse local time from the entry's static tz offset (DST ignored on purpose). */
function localTime(tz) {
  const mins = (((Date.now() / 60000) % 1440) + tz * 60 + 1440) % 1440;
  const h = Math.floor(mins / 60) % 24;
  const m = Math.floor(mins % 60);
  return { h, text: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
}

const rowLabel = { color: CARD_THEME.iceDim, letterSpacing: '0.14em' };

/**
 * The Atlas destination panel: kind badge, curated blurb, tags, distance,
 * coarse local time (+ "try Night style" nudge), visit count, and the WARP
 * button. Pure DOM — INK CODEX tokens throughout.
 */
export function DestinationCard({ entry, runtime, onWarp }) {
  const visits = useFlyAtlasStore((s) => (entry ? (s.visits[entry.key] ?? 0) : 0));
  const isFav = useFlyAtlasStore((s) => (entry ? s.favorites.includes(entry.key) : false));
  const toggleFavorite = useFlyAtlasStore((s) => s.toggleFavorite);

  // Distance re-renders cheaply at 1Hz while a destination is shown
  const [, bump] = useState(0);
  useEffect(() => {
    if (!entry) return undefined;
    const id = setInterval(() => bump((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [entry]);

  if (!entry) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center rounded-lg border p-6 text-center"
        style={{ borderColor: CARD_THEME.edgeSoft, color: CARD_THEME.iceFaint }}
      >
        <div className="text-2xl">◈</div>
        <p className="mt-3 font-mono text-[11px] leading-relaxed">
          Pick a destination —<br />
          click the map or search.
        </p>
      </div>
    );
  }

  const kind = ATLAS_KIND[entry.kind] ?? ATLAS_KIND.city;
  const geo = runtime?.geo;
  const nm = geo ? distNm(geo.y, geo.x, entry.lat, entry.lon) : null;
  const t = localTime(entry.tz ?? 0);
  const night = t.h < 6 || t.h >= 20;
  const offsetSpawn = entry.kind === 'military' || entry.kind === 'hotspot';

  return (
    <div
      className="flex h-full flex-col rounded-lg border p-4"
      style={{ borderColor: CARD_THEME.edgeSoft }}
      data-testid="atlas-card"
    >
      <div className="flex items-center justify-between">
        <span
          className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-[0.2em]"
          style={{ color: kind.color, background: `${kind.color}1a` }}
        >
          {kind.label}
        </span>
        <button
          onClick={() => toggleFavorite(entry.key)}
          className="px-1 text-base leading-none transition-transform hover:scale-125"
          style={{ color: isFav ? '#fbbf24' : CARD_THEME.iceFaint }}
          title={isFav ? 'Unfavorite' : 'Favorite'}
          aria-label="Toggle favorite"
        >
          {isFav ? '★' : '☆'}
        </button>
      </div>

      <h3
        className="mt-2 break-words text-xl uppercase leading-tight"
        style={{ fontFamily: CARD_THEME.fontDisplay, color: CARD_THEME.ice }}
        data-testid="atlas-card-name"
      >
        {entry.name}
      </h3>
      {(entry.sub || entry.icao) && (
        <div className="mt-0.5 font-mono text-[11px]" style={{ color: CARD_THEME.iceDim }}>
          {[entry.sub, entry.kind !== 'military' ? entry.icao : null].filter(Boolean).join(' · ')}
        </div>
      )}

      {entry.blurb && (
        <p className="mt-3 text-[12px] leading-relaxed" style={{ color: CARD_THEME.iceDim }}>
          {entry.blurb}
        </p>
      )}

      {entry.tags && (
        <div className="mt-2 flex flex-wrap gap-1">
          {entry.tags.map((tag) => (
            <span
              key={tag}
              className="rounded px-1.5 py-0.5 font-mono text-[9px]"
              style={{ background: CARD_THEME.panel, color: CARD_THEME.iceDim }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto space-y-1.5 pt-4 font-mono text-[11px]">
        <div className="flex justify-between">
          <span style={rowLabel}>DISTANCE</span>
          <span style={{ color: CARD_THEME.ice }}>
            {nm == null ? '—' : nm < 10 ? `${nm.toFixed(1)}nm` : `${Math.round(nm).toLocaleString()}nm`}
          </span>
        </div>
        <div className="flex justify-between">
          <span style={rowLabel}>LOCAL TIME</span>
          <span style={{ color: night ? '#a5b4fc' : CARD_THEME.ice }}>
            {t.text}
            {night ? ' · dark — try Night style' : ''}
          </span>
        </div>
        {visits > 0 && (
          <div className="flex justify-between">
            <span style={rowLabel}>VISITED</span>
            <span style={{ color: CARD_THEME.ice }}>×{visits}</span>
          </div>
        )}
      </div>

      <button
        onClick={() => onWarp(entry)}
        className="mt-3 w-full rounded-md py-2 text-sm font-bold tracking-[0.24em] transition-transform hover:scale-[1.02] active:scale-[0.98]"
        style={{
          background: CARD_THEME.warpBg,
          color: CARD_THEME.warpText,
          borderBottom: `2px solid ${CARD_THEME.warpEdge}`,
          fontFamily: CARD_THEME.fontDisplay,
        }}
        data-testid="atlas-warp"
      >
        ⚡ WARP
      </button>
      {offsetSpawn && (
        <p className="mt-1.5 text-center font-mono text-[9px]" style={{ color: CARD_THEME.iceFaint }}>
          arrives ~2nm out, nose on the field
        </p>
      )}
    </div>
  );
}
