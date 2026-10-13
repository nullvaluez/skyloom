import { airframeLayout, engineStyle } from './fleet-layout.js';

// Presentation tuning, in aircraft-local metres (nose -Z). The cold band is
// an artistic approximation: the weather feed does not measure upper-air ice
// saturation. No contrails on props/gliders, or on grounded traffic.
export const AIRCRAFT_EFFECTS = Object.freeze({
  minAltM: 5800, fullAltM: 9200, lifeSec: 38, points: 192,
  spacingM: 28, sampleSec: .22, maxTraffic: { high: 48, medium: 28, low: 12 },
  jumpM: 2500, nearStartM: 35, nearEndM: 150,
  widthM: 1.4, spreadMps: .85, opacity: .52,
  vaporLifeSec: 3.5, vaporWidthM: .18, vaporSpreadMps: .65,
});
export const clamp01 = n => Math.max(0, Math.min(1, n));
export const smoothBand = (a, b, n) => { const t = clamp01((n - a) / (b - a)); return t * t * (3 - 2 * t); };
export function contrailStrength(altitude, speed, grounded = false) {
  return grounded || !Number.isFinite(altitude) || !Number.isFinite(speed) ? 0 :
    smoothBand(AIRCRAFT_EFFECTS.minAltM, AIRCRAFT_EFFECTS.fullAltM, altitude) * smoothBand(55, 115, speed);
}

// GLB-relative exhaust stations. Heavy jets emit at their wing engines rather
// than behind the tail; the 747's four nacelles each own a separate wake.
const PLAYER_ENGINES = {
  fighter: [[-1.7, -.35, 7.8], [1.7, -.35, 7.8]],
  military: [[0, -.25, 7.6]],
  'warbird-jet': [[0, -.2, 5.4]],
  bizjet: [[-1.5, 0, 7.3], [1.5, 0, 7.3]],
  airliner: [[-10.3, -2.2, -1.8], [10.3, -2.2, -1.8]],
  cargo: [[-11.6, -3.1, 0], [11.6, -3.1, 0], [-20.6, -2.2, 5.8], [20.6, -2.2, 5.8]],
  // Umbra: the two flat exhaust slots ahead of the trailing edge (FLEET_PRESENTATION).
  'flying-wing': [[-5.1, .1, 4.22], [5.1, .1, 4.22]],
};
export function playerEngineOffsets(id) { return PLAYER_ENGINES[id] ?? []; }

// The procedural live model and its wake use the very same engine stations
// (lib/fly/fleet-layout.js): nacelle centres for the family's base engine
// option, in model metres.
export function liveEngineStations(f, variant = f.variants?.base ?? 0) {
  if (f.helicopter) return [];
  const layout = airframeLayout(f);
  const bit = engineStyle(f, variant)?.bit ?? 0;
  return layout.engines.filter((e) => e.variant === bit).map((e) => ({ x: e.x, y: e.y, z: e.z, radius: e.d / 2, length: e.len }));
}
export function liveEngineOffsets(f, variant) {
  return f.prop || f.helicopter ? [] : liveEngineStations(f, variant).map(e => [e.x, e.y, e.z + e.length * .5]);
}
export function wingVaporStrength(flight) {
  if (flight.operations?.grounded || flight.operations?.phase === 'hangar') return 0;
  // Bank alone is insufficient: a parked or slow banked airframe has no wake.
  return smoothBand(.34, .95, Math.abs(flight.bank)) * smoothBand(105, 210, flight.speed) *
    (1 - smoothBand(6500, 10000, flight.pos.y));
}
