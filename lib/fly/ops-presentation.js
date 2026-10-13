/**
 * GATE TO GATE — flight.presentation, the drawn aircraft's state, and the one
 * operations event fan-out.
 *
 * FlyScene calls presentation.update(dt, flight, ops) right after
 * operations.advance in its −50 block. It writes flight.presentation:
 *
 *   pitchOffset, heaveM, rollOffset   visual angle of attack, oleo heave (OPS_FX)
 *   oleo [l,r,n], wheelSpin [l,r,n], noseSteerRad, flaps, spoilers, reverse,
 *   n1, burner, heat, propRpm, engineRunning                     (OPS_FX)
 *   lights {nav, beacon, strobe, landing, taxi, logo, turnoff}   ALWAYS computed
 *   eye {x,y,z}  the pilot eye, absolute scene (PAPI, nose shot)
 *
 * With OPS_FX off every field but `lights` equals PRESENTATION_DEFAULT
 * (verify-ops-presentation). The fan-out drains the one event cursor
 * (lib/fly/ops-events.js) once per frame and hands each event to every
 * subscriber, then to runtime.playerFx (the touchdown smoke queue TrafficLayer
 * drains, W2 E). Subscribers never build their own cursors.
 */
import { createOpsEventCursor } from './ops-events.js';
import { createLightState, playerLightState } from './player-external-lights.js';
import { appendHistoryV1 } from './flight-history.mjs';

export const PRESENTATION_DEFAULT = Object.freeze({
  pitchOffset: 0,
  heaveM: 0,
  rollOffset: 0,
  oleo: Object.freeze([0, 0, 0]),
  wheelSpin: Object.freeze([0, 0, 0]),
  noseSteerRad: 0,
  flaps: 0,
  spoilers: 0,
  reverse: 0,
  n1: 0,
  burner: 0,
  heat: 0,
  propRpm: 0,
  engineRunning: true,
  lights: Object.freeze(createLightState()),
  eye: Object.freeze({ x: 0, y: 0, z: 0 }),
});

function createPresentation() {
  return {
    ...PRESENTATION_DEFAULT,
    oleo: [0, 0, 0],
    wheelSpin: [0, 0, 0],
    lights: createLightState(),
    eye: { x: 0, y: 0, z: 0 },
  };
}

/**
 * The per-scene presentation and fan-out. getOps returns the live operations
 * object (FlyScene's), so a remount re-attaches the cursor.
 */
export function createOpsPresentation({ runtime, getOps }) {
  const cursor = createOpsEventCursor(getOps);
  const subscribers = new Set();
  const state = createPresentation();
  const deliver = (event) => {
    // The v1 logbook row (moved from OperationsHUD's 100 ms poll; identical rows).
    if (event.type === 'completed') {
      const ops = getOps();
      if (ops?.summary && !ops.saved) {
        ops.markSaved();
        appendHistoryV1(ops.summary);
      }
    }
    for (const fn of subscribers) fn(event);
    runtime?.playerFx?.event?.(event);
  };
  return {
    state,
    /** Receive every operations event once (returns the release function). */
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    update(dt, flight, ops) {
      playerLightState(ops, flight, state.lights);
      flight.presentation = state;
      cursor.drain(deliver);
    },
    dispose() {
      cursor.release();
      subscribers.clear();
    },
  };
}
