'use client';

import { useEffect, useState } from 'react';
import { M_TO_FT } from '@/lib/fly/coords';
import { ATLAS_KIND, CARD_THEME } from './atlas-tokens';

const NM_PER_DEG = 60;
const ARRIVE_OFFSET_M = 3000; // spawn this far out, nose on the group

/** Great-circle distance in nautical miles (DestinationCard's formula). */
function distNm(lat1, lon1, lat2, lon2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * NM_PER_DEG * (180 / Math.PI);
}

/**
 * MULTIPLAYER: one where-summary cluster (mp-store.clusters) as an Atlas map
 * entry. Keyed by its relay cell, so a refresh updates the entry in place and
 * never retargets the selection; the dot grows with the head count.
 */
export function pilotEntry(c) {
  return {
    key: c.key,
    kind: 'pilots',
    name: `${c.n} pilot${c.n === 1 ? '' : 's'}`,
    lat: c.lat,
    lon: c.lon,
    altM: c.altM,
    n: c.n,
    dot: ATLAS_KIND.pilots.dot + Math.log2(c.n),
  };
}

/** warpToGeo options for "Fly there": 3 km out on a random bearing, facing the group. */
export function pilotsWarpOpts(entry, rand = Math.random) {
  return {
    altM: Math.max(800, Math.min(6000, Number.isFinite(entry.altM) ? entry.altM : 0)),
    offsetM: ARRIVE_OFFSET_M,
    offsetBearingRad: rand() * Math.PI * 2,
    name: entry.name,
    kind: 'pilots',
  };
}

const rowLabel = { color: CARD_THEME.iceDim, letterSpacing: '0.14em' };

/**
 * The Atlas card for a pilots cluster, in place of DestinationCard: count,
 * distance, typical altitude and FLY THERE. No favourite, no visit count —
 * a cluster is live data, so nothing about it is written to the Atlas store.
 */
export function PilotsCard({ entry, runtime, onFly }) {
  // Distance re-renders cheaply at 1Hz while the card is shown
  const [, bump] = useState(0);
  useEffect(() => {
    const id = setInterval(() => bump((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const kind = ATLAS_KIND.pilots;
  const geo = runtime?.geo;
  const nm = geo ? distNm(geo.y, geo.x, entry.lat, entry.lon) : null;
  const ft = entry.altM > 0 ? Math.round((entry.altM * M_TO_FT) / 100) * 100 : null;

  return (
    <div
      className="flex h-full flex-col rounded-lg border p-4"
      style={{ borderColor: CARD_THEME.edgeSoft }}
      data-testid="atlas-pilots-card"
    >
      <div className="flex items-center justify-between">
        <span
          className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-[0.2em]"
          style={{ color: kind.color, background: `${kind.color}1a` }}
        >
          {kind.label}
        </span>
        <span className="font-mono text-[9px] tracking-[0.2em]" style={{ color: CARD_THEME.iceFaint }}>
          LIVE
        </span>
      </div>

      <h3
        className="mt-2 break-words text-xl uppercase leading-tight"
        style={{ fontFamily: CARD_THEME.fontDisplay, color: CARD_THEME.ice }}
      >
        {entry.name}
      </h3>
      <p className="mt-3 text-[12px] leading-relaxed" style={{ color: CARD_THEME.iceDim }}>
        Other Free Flight pilots are flying around here right now. Join them — they will see you
        arrive.
      </p>

      <div className="mt-auto space-y-1.5 pt-4 font-mono text-[11px]">
        <div className="flex justify-between">
          <span style={rowLabel}>DISTANCE</span>
          <span style={{ color: CARD_THEME.ice }}>
            {nm == null ? '—' : nm < 10 ? `${nm.toFixed(1)}nm` : `${Math.round(nm).toLocaleString()}nm`}
          </span>
        </div>
        <div className="flex justify-between">
          <span style={rowLabel}>ALTITUDE</span>
          <span style={{ color: CARD_THEME.ice }}>{ft == null ? '—' : `~${ft.toLocaleString()} ft`}</span>
        </div>
      </div>

      <button
        onClick={() => onFly(entry)}
        className="mt-3 w-full rounded-md py-2 text-sm font-bold tracking-[0.24em] transition-transform hover:scale-[1.02] active:scale-[0.98]"
        style={{
          background: CARD_THEME.warpBg,
          color: CARD_THEME.warpText,
          borderBottom: `2px solid ${CARD_THEME.warpEdge}`,
          fontFamily: CARD_THEME.fontDisplay,
        }}
        data-testid="atlas-pilots-fly"
      >
        ✈ FLY THERE
      </button>
      <p className="mt-1.5 text-center font-mono text-[9px]" style={{ color: CARD_THEME.iceFaint }}>
        arrives ~{(ARRIVE_OFFSET_M / 1852).toFixed(1)}nm out, nose on the group
      </p>
    </div>
  );
}
