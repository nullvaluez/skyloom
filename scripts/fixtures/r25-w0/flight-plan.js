// SHIP PASS RL-1 FIXTURE: `r25-w0:lib/fly/flight-plan.js` for shallow clones (CI checks out
// depth 1, and neither ref is fetched there). r25-w0 is commit
// db78bdf768756a3dd3b31c4fb64c7309adb07869 ("R25 W0: scaffold the front door,
// flight plan and visuals profile", CLEAR_SKY_VISUALS.md).
// Fetched 2026-10-30 from origin with the GitHub contents API at that ref; git blob c57b5c14cde59fb8d99945e448314722daddaa06.
// Everything after the marker line below is that blob byte for byte;
// scripts/_r25-w0-baseline.mjs re-hashes it before any gate uses it.
// ---- r25-w0 blob below ----
'use client';

// R25 B FLIGHT PLAN — Free Flight vs Takeoff & Landing, featured destinations,
// last setup + Continue. W0 STUBS: signatures are the contract; B fills them.
// With FLIGHT_PLAN.enabled false the spawn is today's KOSU literal.

import { airportById } from './operations-airports';

/** Curated Free Flight destinations (B: lib/fly/destinations.js feeds this). */
export const FEATURED_DESTINATIONS = [];

/**
 * Pre-mount spawn. W0: today's hard-coded KOSU (FlyMode.jsx), no altM so
 * FlyScene keeps SPAWN_ALT_M. B: bypass → KOSU; last setup; daylight featured.
 */
export function resolveInitialSpawn() {
  const a = airportById('KOSU').a;
  return { lat: a.lat, lon: a.lon };
}

/** Validated last setup or null (B). */
export function readLastSetup() {
  return null;
}

/** Persist the setup that just launched (B). */
export function saveLastSetup(_setup) {}

/** Human-readable Continue label, or null (B). */
export function describeSetup(_setup) {
  return null;
}

/** Destination search over featured + POI DB (B). */
export function searchDestinations(_query, _max) {
  return [];
}
