/**
 * Operations telemetry (ops.telemetry): data the presentation, deck, grade,
 * debrief and replay read. Captured inside the fixed step with every flag off;
 * it never feeds back into the motion (verify-ops-golden stays identical).
 *
 *   n1, thrustFrac   engine output 0..1 (= throttle until OPS_FEEL adds spool)
 *   brake            wheel-brake command 0..1 this step
 *   autobrake, spoilers, reverse   OPS_FEEL decel state (0 until W1)
 *   surface          kind under the wheels, or null
 *   onGround         [left main, right main, nose] contact 0/1
 *   timeScale        auto-taxi compression (1 until GATE_TO_GATE)
 *   clock            step clock, seconds since begin()
 *   flareTrace       ring of [t, h, vy] at 20 Hz for the last 8 s airborne below 30 m
 *   rollout          { maxCrossM, remainingM } since the last touchdown, or null
 *   routeXZ          ring of [x, z] scene points every 10 s (15 min)
 *   rollStart        { x, z } where the current takeoff roll began, or null
 *   failure          OPS_FEEL settling failure state (null until W1)
 *   prevPose, renderAlpha   OPS_FEEL render interpolation (null / 1 until W1)
 */
import { airportFrame, airportLocal } from '../operations-airports.js';

export const FLARE_HZ = 20;
export const FLARE_SEC = 8;
export const FLARE_MAX_H = 30;
export const ROUTE_EVERY_SEC = 10;
export const ROUTE_POINTS = 90;
const FLARE_SAMPLES = FLARE_HZ * FLARE_SEC;

export function createTelemetry() {
  return {
    n1: 0,
    thrustFrac: 0,
    brake: 0,
    autobrake: 0,
    spoilers: 0,
    reverse: 0,
    surface: null,
    onGround: [1, 1, 1],
    timeScale: 1,
    clock: 0,
    flareTrace: new Float32Array(FLARE_SAMPLES * 3),
    flareHead: 0,
    flareCount: 0,
    flareNext: 0,
    rollout: null,
    routeXZ: new Float64Array(ROUTE_POINTS * 2),
    routeHead: 0,
    routeCount: 0,
    routeNext: 0,
    rollStart: null,
    failure: null,
    prevPose: null,
    renderAlpha: 1,
  };
}

/** Clear a telemetry record in place (begin()). */
export function resetTelemetry(t) {
  Object.assign(t, createTelemetry());
}

/** The flare trace in time order: [{t, h, vy}] (oldest first). */
export function flareSamples(t) {
  const out = [];
  const start = (t.flareHead - t.flareCount + FLARE_SAMPLES) % FLARE_SAMPLES;
  for (let i = 0; i < t.flareCount; i++) {
    const j = ((start + i) % FLARE_SAMPLES) * 3;
    out.push({ t: t.flareTrace[j], h: t.flareTrace[j + 1], vy: t.flareTrace[j + 2] });
  }
  return out;
}

/** The recorded route in time order: [[x, z]] scene coordinates (oldest first). */
export function routeSamples(t) {
  const out = [];
  const start = (t.routeHead - t.routeCount + ROUTE_POINTS) % ROUTE_POINTS;
  for (let i = 0; i < t.routeCount; i++) {
    const j = ((start + i) % ROUTE_POINTS) * 2;
    out.push([t.routeXZ[j], t.routeXZ[j + 1]]);
  }
  return out;
}

/**
 * Once per fixed step, after the step's state changes. Reads only; writes only
 * ops.telemetry.
 */
export function recordStep(ops, f, cmd, dt, contact, groundAfter) {
  const t = ops.telemetry;
  const p = ops.profile;
  t.clock += dt;
  t.n1 = ops.throttle;
  t.thrustFrac = ops.throttle;
  t.brake = Math.max(0, Math.min(1, cmd.brake || 0));
  t.surface = contact?.kind ?? null;
  const ground = ops.grounded ? 1 : 0;
  t.onGround[0] = ground;
  t.onGround[1] = ground;
  t.onGround[2] = ground;
  const h = f.pos.y - groundAfter - p.clearance;
  if (!ops.grounded && h < FLARE_MAX_H && t.clock >= t.flareNext) {
    const j = t.flareHead * 3;
    t.flareTrace[j] = t.clock;
    t.flareTrace[j + 1] = h;
    t.flareTrace[j + 2] = ops.vy;
    t.flareHead = (t.flareHead + 1) % FLARE_SAMPLES;
    t.flareCount = Math.min(FLARE_SAMPLES, t.flareCount + 1);
    t.flareNext = t.clock + 1 / FLARE_HZ - 1e-9;
  }
  if (t.clock >= t.routeNext) {
    const j = t.routeHead * 2;
    t.routeXZ[j] = f.pos.x;
    t.routeXZ[j + 1] = f.pos.z;
    t.routeHead = (t.routeHead + 1) % ROUTE_POINTS;
    t.routeCount = Math.min(ROUTE_POINTS, t.routeCount + 1);
    t.routeNext = t.clock + ROUTE_EVERY_SEC - 1e-9;
  }
  if (ops.phase === 'takeoffRoll') t.rollStart ??= { x: f.pos.x, z: f.pos.z };
  else if (ops.grounded) t.rollStart = null;
  if (ops.phase === 'landingRoll' && t.rollout && ops.airport) {
    const local = airportLocal(ops.airport, f.pos.x, f.pos.z);
    const length = airportFrame(ops.airport).length;
    t.rollout.maxCrossM = Math.max(t.rollout.maxCrossM, Math.abs(local.cross));
    t.rollout.remainingM = ops.reverse ? local.along : length - local.along;
  }
}

/** Start the rollout record at a touchdown. */
export function startRollout(ops) {
  ops.telemetry.rollout = { maxCrossM: 0, remainingM: null };
}

/**
 * The two main-gear contact points in absolute scene coordinates, from the
 * profile's gearPoints rotated by the sim attitude (YXZ: pitch, -heading,
 * -bank, as the drawn aircraft) with the horizontal Mercator scale k.
 */
export function mainsWorld(f, profile, k) {
  const ch = Math.cos(-f.heading);
  const sh = Math.sin(-f.heading);
  const cp = Math.cos(f.pitch);
  const sp = Math.sin(f.pitch);
  const cb = Math.cos(-f.bank);
  const sb = Math.sin(-f.bank);
  return profile.gearPoints.slice(0, 2).map(([x, y, z]) => {
    // Rz(-bank), then Rx(pitch), then Ry(-heading) (three's YXZ order).
    const x1 = x * cb - y * sb;
    const y1 = x * sb + y * cb;
    const y2 = y1 * cp - z * sp;
    const z2 = y1 * sp + z * cp;
    const x3 = x1 * ch + z2 * sh;
    const z3 = -x1 * sh + z2 * ch;
    return [f.pos.x + x3 * k, f.pos.y + y2, f.pos.z + z3 * k];
  });
}
