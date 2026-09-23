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
