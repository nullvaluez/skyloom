/**
 * GATE TO GATE — the lounge ↔ flight bridge (LOUNGE_BRIDGE; W4-0 contracts,
 * W4 stream P). connectFlightOperations connects it next to the airport
 * watch and releases it with the flight operations.
 *
 * W4 registers the runtime actions flyFromGate({aircraftId, standIndex,
 * runwayId?, runwayEnd?}), watchFromLounge({airportId?}) and exitLounge()
 * through runtime-bus.js, only while LOUNGE_BRIDGE is on. The debrief's
 * 'Watch from the lounge' calls getRuntimeAction('watchFromLounge') and
 * hides when it is null.
 *
 * W0 slot: registers nothing.
 */
export function connectLoungeBridge(runtime) {
  if (!runtime) return () => {};
  return () => {};
}
