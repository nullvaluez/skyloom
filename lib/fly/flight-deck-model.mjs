/**
 * GATE TO GATE — the flight deck view model (FLIGHT_DECK, W1 D).
 *
 * deckModel(ops, flight, ctx) is a pure function of the operations and flight
 * state; FlightDeck and PhoneFlightDeck render it, harnesses read
 * runtime.deckStats. Shape:
 *   { owns, step, steps[], speedKt, vrKt, vrefKt, trendKt,
 *     aglFt (agl − clearance: the ONLY AGL anywhere), altFt, vsFpm,
 *     throttle, n1, detent, gear, flaps, spoilers, reverse, autobrake,
 *     parkingBrake, prompts:[{id, label, key, action, primary}],
 *     nav:{code, name, runway, distNm, bearingDeg, relDeg, etaMin, armed},
 *     approach:{locDots, gsDots, distNm, flare}, landHere, recovery:{context, actions} }
 *
 * W0: the enums, the phase → step mapping and a model that says it does not
 * own the deck (the current OperationsHUD keeps rendering).
 */
export const DECK_STEPS = Object.freeze(['gate', 'pushback', 'taxi', 'lineup', 'takeoff', 'climb', 'cruise', 'approach', 'landing', 'taxiIn', 'parked']);

/** The stepper position for an operations phase (null = no deck). */
export function deckStep(ops, flight) {
  switch (ops?.phase) {
    case 'atGate':
      return 'gate';
    case 'pushback':
      return 'pushback';
    case 'parked':
      return 'lineup';
    case 'taxiOut':
      return 'taxi';
    case 'takeoffRoll':
      return 'takeoff';
    case 'airborne':
      return flight && ops.profile && flight.pos.y - (flight.groundElev ?? 0) < 900 ? 'climb' : 'cruise';
    case 'approach':
      return 'approach';
    case 'landingRoll':
      return 'landing';
    case 'taxiIn':
      return 'taxiIn';
    case 'completed':
      return 'parked';
    default:
      return null;
  }
}

/** The deck view model. W0: owns nothing; W1 D fills in every field. */
export function deckModel(ops, flight) {
  return { owns: false, step: deckStep(ops, flight), steps: DECK_STEPS };
}
