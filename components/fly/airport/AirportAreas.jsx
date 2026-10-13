'use client';
/**
 * GATE TO GATE — the airfield areas in flight (OPS_AIRFIELD, W1 stream A).
 *
 * Mounted by FlyScene inside worldRoot next to ObservationWorld (satellite
 * only). It renders one area per runtime.airports.snapshot() entry (the
 * airfield ground and lights, and with OPS_APRON the terminal set and parked
 * fleet), keyed by AreaView.key so the lounge → flight handoff never remounts.
 *
 * W0 stub: the service is inert and mounts no area, so this renders nothing.
 */
export function AirportAreas() {
  return null;
}
