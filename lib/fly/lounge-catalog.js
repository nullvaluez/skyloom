// Lounge-only discovery and preparation. The flight/hangar runway chooser
// keeps its own catalog rules; watching never applies aircraft runway minima.
import { LOUNGE_AIRPORTS, searchLoungeAirports } from './lounge-airports.mjs';
import { ensureAirport, runwayIndex } from './runway-catalog.js';
import { AUTHORED_AIRPORT_IDS, OPERATIONS_AIRPORTS } from './operations-airports.js';

const normalize = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Search curated destinations plus the shipped worldwide runway snapshot.
 * Each airport appears once, even when it has many parallel runways. */
export async function searchLoungeCatalog(query) {
  const curated = searchLoungeAirports(LOUNGE_AIRPORTS, query);
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return curated;
  const byIdent = new Map(curated.map((a) => [a.ident, a]));
  const matches = new Map();
  const authored = OPERATIONS_AIRPORTS.filter((a) => AUTHORED_AIRPORT_IDS.has(a.id))
    .map((a) => ({ id: a.id, ident: a.id, name: a.name, lat: a.a.lat, lon: a.a.lon }));
  for (const r of [...authored, ...await runwayIndex()]) {
    if (byIdent.has(r.ident) || !tokens.every((t) => normalize(`${r.ident} ${r.name}`).includes(t))) continue;
    const previous = matches.get(r.ident);
    if (!previous || r.length > previous.length) matches.set(r.ident, r);
  }
  const q = normalize(query).trim();
  const other = [...matches.values()].sort((a, b) =>
    Number(normalize(b.ident) === q) - Number(normalize(a.ident) === q) || a.name.localeCompare(b.name));
  return [...curated, ...other.map((r) => ({ id: r.ident, ident: r.ident, name: r.name, lat: r.lat, lon: r.lon }))];
}

/** Load every runway of the observed airport before resolving its seat.
 * Nearby discovery is capped at eight rows, which can omit a stored seat's
 * runway at a large hub. The caller protects this ident during preparation
 * (protectRunwayIdent) until placeSeat installs the observation pin. */
export async function ensureLoungeAirport(id, { cancelled = () => false } = {}) {
  const airport = await ensureAirport(id);
  if (!airport || cancelled()) return null;
  if (airport.authored !== false) return airport;
  const index = await runwayIndex();
  const ident = airport.ident || airport.id.split(':')[0];
  for (const row of index.filter((r) => r.ident === ident)) {
    if (cancelled()) return null;
    if (!await ensureAirport(row.id)) throw Error('This airport’s runway data is incomplete. Try again.');
  }
  // Preloading siblings also touches the optional last-runway cache. Keep
  // the chosen airport's original row there, rather than the final sibling.
  return cancelled() ? null : ensureAirport(airport.id);
}
