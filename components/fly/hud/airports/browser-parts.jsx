'use client';
import { ArrowRight, Binoculars, Clock3, Moon, PlaneLanding, PlaneTakeoff, Sun, Sunrise, Sunset } from 'lucide-react';
import { runwayIndex } from '@/lib/fly/runway-catalog';
import { localClockAt, majorAirports, shortAirportName, sunStateAt } from '@/lib/fly/airport-watch-sky.mjs';
import { AIRPORTS } from '@/lib/airports';
import { CITIES } from '@/lib/fly/poi/cities';
// SHIP PASS RL-4 (DEEP_LINKS): Copy link on the featured cards (renders the card alone with the flag off).
import { CardWithLink } from '../CopyLink';

/*
 * Airport browser parts: the golden-hour pool, the sun chip and the three
 * row kinds of the "Watch an airport" browser (../AirportExperience.jsx),
 * shared with the hangar's airport chooser (FLY_GATE_TO_GATE_PLAN.md W3 L).
 * The markup is the browser's own, unchanged. Test ids:
 * airport-featured-<id>, golden-hour-<ident>, airport-result-<id>.
 */

/** The sun clock: a harness pin (window.__flySunOverride) or now. */
export const sunNow = () => (typeof window !== 'undefined' && Number.isFinite(window.__flySunOverride) ? window.__flySunOverride : Date.now());

// The golden-hour pool: busy hubs (lib/airports.js) that the runway catalog
// can open, then every other large airport — those serving a known city
// (lib/fly/poi/cities.js, within 35 km) ahead of remote fields, since a
// sunset is better with traffic in it. Built once per session.
let goldenPool = null;
function servesCity(a, grid) {
  for (let la = Math.floor(a.lat) - 1; la <= Math.floor(a.lat) + 1; la++) {
    for (let lo = Math.floor(a.lon) - 1; lo <= Math.floor(a.lon) + 1; lo++) {
      for (const c of grid.get(`${la}|${lo}`) || []) {
        const dy = (c[1] - a.lat) * 111.32, dx = (c[2] - a.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
        if (dx * dx + dy * dy < 35 * 35) return true;
      }
    }
  }
  return false;
}
export async function goldenAirports() {
  if (goldenPool) return goldenPool;
  const major = majorAirports(await runwayIndex());
  const byIdent = new Map(major.map((a) => [a.ident, a]));
  const hubs = Object.values(AIRPORTS)
    .filter((h) => byIdent.has(h.icao))
    .map((h) => ({ ...byIdent.get(h.icao), name: h.name, city: h.city, priority: 3 }));
  const hubIds = new Set(hubs.map((h) => h.ident));
  const grid = new Map();
  for (const c of CITIES) {
    const key = `${Math.floor(c[1])}|${Math.floor(c[2])}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(c);
  }
  const rest = major.filter((a) => !hubIds.has(a.ident)).map((a) => (servesCity(a, grid) ? { ...a, priority: 1.5 } : a));
  goldenPool = [...hubs, ...rest];
  return goldenPool;
}

export function SunChip({ sun }) {
  if (!sun) return null;
  const Icon = sun.kind === 'night' ? Moon : sun.kind === 'day' ? Sun : sun.rising ? Sunrise : Sunset;
  return (
    <span className="ab-sun" data-sun={sun.kind}>
      <Icon size={12} aria-hidden="true" />
      {sun.label}
    </span>
  );
}

/** A featured lounge card: code, name, tag, local clock and sun. `onChoose(id)`. */
export function FeaturedAirportCard({ airport: a, now, busy, onChoose }) {
  const clock = localClockAt(a.lat, a.lon, now);
  const sun = sunStateAt(a.lat, a.lon, sunNow());
  return (
    <CardWithLink link={{ kind: 'watch', airportId: a.id, ident: a.id }} testid={`copy-link-airport-${a.id}`}>
    <button type="button" disabled={busy} onClick={() => onChoose(a.id)} data-testid={`airport-featured-${a.id}`} data-sun={sun.kind}>
      <small>{a.id}</small>
      <strong>{a.name}</strong>
      <span>{a.tag}</span>
      <span className="ab-meta">
        <Clock3 size={12} aria-hidden="true" />
        {clock.text}
        <SunChip sun={sun} />
      </span>
    </button>
    </CardWithLink>
  );
}

/** A "Golden hour now" row (an entry of goldenHourNow()). `onChoose(ident)`. */
export function GoldenHourRow({ entry: g, busy, onChoose }) {
  return (
    <button type="button" disabled={busy} onClick={() => onChoose(g.ident)} data-testid={`golden-hour-${g.ident}`} data-rising={g.rising ? '1' : '0'}>
      {g.rising ? <Sunrise size={18} aria-hidden="true" /> : <Sunset size={18} aria-hidden="true" />}
      <span className="ab-golden-text">
        <strong title={g.name}>{shortAirportName(g.name)}</strong>
        <small>
          {g.ident} · {g.clock.text} {g.clock.zone === 'solar' ? 'solar' : 'local'}
        </small>
      </span>
      <em>{g.label}</em>
      <ArrowRight size={15} aria-hidden="true" />
    </button>
  );
}

/** A search result row (a searchRunways() row): watch it, or start on its runway or approach. `onChoose(id, start?)`. */
export function AirportResultRow({ airport: a, busy, onChoose }) {
  return (
    <div className="ab-result" data-testid={`airport-result-${a.id}`}>
      <button type="button" className="ab-result-main" disabled={busy} onClick={() => onChoose(a.id)}>
        <strong>{a.name}</strong>
        <span>
          {a.ident} · Runway {a.runway}
        </span>
      </button>
      <button type="button" className="ab-watch" disabled={busy} onClick={() => onChoose(a.id)} aria-label={`Watch ${a.name}`}>
        <Binoculars size={14} aria-hidden="true" />
        Watch
      </button>
      <button type="button" className="ab-alt" disabled={busy} onClick={() => onChoose(a.id, 'runway')}>
        <PlaneTakeoff size={14} aria-hidden="true" />
        Runway start
      </button>
      <button type="button" className="ab-alt" disabled={busy} onClick={() => onChoose(a.id, 'approach')}>
        <PlaneLanding size={14} aria-hidden="true" />
        Approach
      </button>
    </div>
  );
}
