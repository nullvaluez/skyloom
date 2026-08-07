'use client';

/**
 * R22 W0 STUB — C CLUTTER fills this file (ground life: trees2 upgrade lives
 * in SatVegLayer; THIS layer owns parked cars + moving cars + poles/lamps,
 * driven by the protocol-18 worker outputs documented on the CLUTTER block in
 * fly-constants.js, via NEW lib/fly/toy-world/sat-clutter-engine.js).
 *
 * The stub exists so the FlyScene mount line lands in scaffolding (zero merge
 * conflicts for C) and renders NOTHING — the mount is additionally gated on
 * CLUTTER.enabled (false at W0) in FlyScene, so this component mounting at
 * all already means the flag is on.
 */
export function SatClutterLayer() {
  return null;
}
