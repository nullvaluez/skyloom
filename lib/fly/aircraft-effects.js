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
};
export function playerEngineOffsets(id) { return PLAYER_ENGINES[id] ?? []; }

// The procedural live model and its wake use the very same engine stations.
export function liveEngineStations(f) {
  if (f.helicopter) return [];
  return Array.from({ length: f.engines }, (_, e) => {
    const side = f.engines === 1 ? 0 : e % 2 === 0 ? -1 : 1, rank = Math.floor(e / 2);
    const x = f.rearEngines ? side * f.radius * 1.35 : side * f.span * (rank ? .32 : .18);
    const y = f.engines === 1 ? 0 : f.rearEngines ? f.radius * .3 : f.highWing ? f.radius * .5 : -f.radius * .95;
    const z = f.rearEngines ? f.length * .29 : f.engines === 1 ? -f.length * .46 : -f.length * .035 + Math.abs(x) * f.sweep;
    return { x, y, z, radius: f.prop ? f.radius * .43 : f.radius * .63, length: f.radius * (f.prop ? 2.7 : 3.2) };
  });
}
export function liveEngineOffsets(f) {
  return f.prop || f.helicopter ? [] : liveEngineStations(f).map(e => [e.x, e.y, e.z + e.length * .5]);
}
export function wingVaporStrength(flight) {
  if (flight.operations?.grounded || flight.operations?.phase === 'hangar') return 0;
  // Bank alone is insufficient: a parked or slow banked airframe has no wake.
  return smoothBand(.34, .95, Math.abs(flight.bank)) * smoothBand(105, 210, flight.speed) *
    (1 - smoothBand(6500, 10000, flight.pos.y));
}
