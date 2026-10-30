// Live-traffic airframe resolution: which first-party family (fleet-types.js)
// draws a track, and with which per-airframe options. Paint is resolved
// separately by operator-liveries; dimensions describe the reported type.
// Live positions are never altered.
import { FLEET_FAMILIES, FAMILY_INDEX, airframeSpec, familyForCategory, familyForCode } from './fleet-types.js';

/** The family list (index order is a contract: see fleet-types.js). */
export const LIVE_AIRCRAFT = FLEET_FAMILIES;

// Broad classification fallbacks for types we do not know by code. These are
// stand-ins of the right size class, not fabricated type data: an unknown
// "airliner" draws as the most common narrow-body, never as a 57 m 787.
const ARCHETYPE_FALLBACK = { 0: 'a320', 1: 'business', 2: 'piston', 3: 'helicopter', 5: 'b767' };

/** Family index for a track's metadata/archetype, or null (the archetype GLB draws it). */
export function resolveLiveAircraft(meta, archetype) {
  const exact = familyForCode(meta?.t);
  if (exact != null) return exact;
  // ADS-B emitter category gives the size class when the type is unknown.
  if (!meta?.t && archetype !== 4 && archetype !== 6 && archetype !== 7) {
    const byCategory = familyForCategory(meta?.category);
    if (byCategory != null) return byCategory;
  }
  const id = ARCHETYPE_FALLBACK[archetype];
  return id ? FAMILY_INDEX[id] : null;
}

/**
 * Family + per-airframe options (plugs, scale, variant bits, paint seed) for
 * a track, cached on the track until its metadata changes.
 */
export function resolveLiveType(track) {
  const cache = track.fleetType;
  if (cache && cache.meta === track.meta && cache.archetype === track.archetype) return cache.spec;
  const family = resolveLiveAircraft(track.meta, track.archetype);
  const spec = family == null ? null : airframeSpec(family, track.meta, track.hex);
  track.fleetType = { meta: track.meta, archetype: track.archetype, spec };
  return spec;
}

export function liveGearDown(track) {
  return !!(track.flags & 1);
}

/** Near-detail rule for flight mode (hysteresis on the way out). */
export function liveModelLod(distanceM, selected = false, wasNear = false, detailM = 900) {
  return (selected && distanceM < 8000) || distanceM < detailM * (wasNear ? 1.25 : 1);
}
