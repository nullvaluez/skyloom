/**
 * GATE TO GATE — runtime.airports, the one airport service
 * (contracts.js AirportService). FlyScene creates it next to the operations
 * object and calls update() at useFrame priority −40.
 *
 * W0 ships the service INERT. While OPS_AIRFIELD is off (and until W1 stream
 * A implements planAreas, sites and the area lifecycle) every method answers
 * exactly what the game does today: surfaceAt is the authored registry,
 * nothing is prefetched, no area mounts and no gate exists. Consumers can call
 * the full API now and get the runway-only answers.
 */
import { findAirportSurface } from '../operations-airports.js';
import { opsAirfieldOn } from '../ops-flags.js';

const NONE = Object.freeze({ phase: 'none', progress: 0, hasOsm: false, hasGate: false, error: null });
const EMPTY = Object.freeze([]);

export function createAirportService(runtime) {
  const listeners = new Set();
  const service = {
    /** OPS_AIRFIELD on for the current map style. Read per call (pins and ?flags= win). */
    get enabled() {
      return opsAirfieldOn();
    },
    runtime,
    update() {},
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    snapshot: () => EMPTY,
    area: () => null,
    prefetch: () => Promise.resolve(NONE),
    prefetchState: () => NONE,
    surfaceAt: (x, z) => findAirportSurface(x, z),
    groundAt: () => null,
    departureOptions: () => EMPTY,
    gateFor: () => null,
    gateOptions: () => EMPTY,
    stands: () => EMPTY,
    planDeparture: () => null,
    planArrival: () => null,
    setActiveRoute() {},
    routeState: null,
    papiState: () => null,
    towerPoint: () => null,
    diagram: () => null,
    debugVisible() {},
    dispose() {
      listeners.clear();
    },
  };
  return service;
}
