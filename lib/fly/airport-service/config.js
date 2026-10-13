/**
 * GATE TO GATE — airport service tunables (flight areas). The OPS_AIRFIELD
 * flag block only gates; the numbers live here. W1 stream A owns this file.
 */
export const AIRPORT_SERVICE = Object.freeze({
  // planAreas at 2 Hz: at most this many areas, chosen by purpose
  // (lounge > player within 6 km > destination > departure > nearby).
  planHz: 2,
  maxAreas: Object.freeze({ desktop: 3, phone: 1 }),
  // An area unmounts only after this many consecutive plans without it.
  unmountPlans: 2,
  // Mount and unmount distances by purpose (km, hysteresis between them).
  mountKm: Object.freeze({ player: 6, departure: 25, destination: 40, nearby: 12 }),
  unmountKm: Object.freeze({ player: 8, departure: 30, destination: 50, nearby: 16 }),
  // Staged mounting: ground within mountKm, the terminal set within this.
  structuresKm: 8,
  // Prefetch: within this distance of a choice point, and the area cache size.
  prefetchKm: 40,
  areaLru: 4,
  // The 'airfield' readiness part never blocks longer than this.
  readinessCapMs: 12000,
  // Focus radii of the paint/grass detail (origin and each runway end), metres.
  focus: Object.freeze({ originM: 2800, runwayEndM: 1500 }),
  // Phone registry grid and lite grass budget.
  phoneGrid: Object.freeze({ stepM: 24, maxNodes: 40000 }),
  liteGrass: 25000,
  // GlowPoints light caps (full / lite).
  lightsCap: Object.freeze({ full: 6144, lite: 1500 }),
  // Height-field rebuild policy: grounded / airborne low / airborne high (ms).
  rebuildMs: Object.freeze({ grounded: 0, low: 500, high: 2000 }),
  // The ground composite swaps only while airborne or after this long parked.
  groundLatchParkedSec: 2,
  // Route lights (follow-the-greens) and stop bars.
  routeLights: Object.freeze({ aheadM: 420, spacingM: 15, dayFloor: 0.55 }),
  // Clearance: a real arrival on short final holds the bar (GATE_TO_GATE.maxHoldSec caps it).
  clearance: Object.freeze({ finalNm: 4, finalEtaSec: 100, heldSec: 2, conflictFreeSec: 3, staleFixSec: 15 }),
  // The analytic landing/taxi light pool (PLAYER_GLOW_LIGHTS.pool).
  spot: Object.freeze({ maxLamps: 4, landingConeDeg: 11, taxiConeDeg: 28, rangeM: 450 }),
  // Per-area budgets (High tier): draws, triangles, texture MiB.
  areaBudget: Object.freeze({ draws: 20, triangles: 650000, textureMiB: 40 }),
  registryBudget: Object.freeze({ draws: 3, triangles: 15000, textureMiB: 1.2 }),
});
