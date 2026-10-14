/**
 * GATE TO GATE — the lounge ↔ flight bridge (LOUNGE_BRIDGE; W4-0 contracts,
 * W4 stream P). connectFlightOperations connects it next to the airport
 * watch and releases it with the flight operations.
 *
 * W4 registers the runtime actions flyFromGate({aircraftId, standIndex,
 * runwayId?, runwayEnd?}), watchFromLounge({airportId?}) and
 * exitLounge({origin, entry}) through runtime-bus.js, only while
 * LOUNGE_BRIDGE is on. The debrief's 'Watch from the lounge' calls
 * getRuntimeAction('watchFromLounge') and hides when it is null; the lounge's
 * Leave and Esc (watch.exit(), lib/fly/airport-watch-runtime.js) hand any
 * origin but the title to exitLounge.
 *
 * The lounge side of the contract is already in place (W4-0): enter(id,
 * {origin, keepFlight, seat, faceStand, site}), watch.origin / watch.entry,
 * watch.playerParked, watch.cinematic, watch.handoff(), and the LoungeHeader
 * Leave label from leaveLabelFor() below.
 *
 * W0/W4-0 slot: registers nothing; the helpers below are documented stubs
 * with their final signatures (FLY_GATE_TO_GATE.md, "Lounge bridge API").
 */
export function connectLoungeBridge(runtime) {
  if (!runtime) return () => {};
  return () => {};
}

/** The Leave button's wording for where the lounge was entered from (watch.origin.kind). */
export function leaveLabelFor(origin) {
  const kind = typeof origin === 'string' ? origin : origin?.kind;
  if (kind === 'flight') return 'Back to your flight';
  if (kind === 'gate') return 'Back to your aircraft';
  return 'Leave lounge';
}

/**
 * Where an entry into the lounge comes from right now:
 * { kind: 'title' | 'flight' | 'gate' | 'confirm', message?, bookmark? }
 * ('confirm': a ground-moving phase that would end the flight). Stub: 'title'.
 */
export function entryContext() {
  return { kind: 'title' };
}

/** A restorable snapshot of the current flight (ops.snapshot() + pose), or null. Stub: null. */
export function bookmarkFlight() {
  return null;
}

/** Put a bookmarked flight back. Resolves true when it was restored. Stub: false. */
export async function restoreFlight() {
  return false;
}

/**
 * The departure runway end for "Fly from here": the faced runway unless the
 * crosswind there exceeds 15 kt. { runway, end, reason } or null. Stub: null.
 */
export function preferredDepartureRunway() {
  return null;
}

/**
 * The stands the player could depart from, for the "Fly from here" sheet:
 * [{ index, side, cls, label, visible, fits, dock: 'bridge' | 'stairs' }]. Stub: [].
 */
export function gateOptions() {
  return [];
}
