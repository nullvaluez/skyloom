import { M_TO_FT, MPS_TO_KT } from './coords';

/**
 * Round 17 "Your Wings" — ONE shape for "the aircraft we are scoring".
 *
 * Three call sites built this object inline and each built it DIFFERENTLY:
 *
 *   · FlyScene (lock acquired → logSpot)   hex/flight/r/t/category/lat/lon/_classification
 *   · InspectModal (open → logSpot)        the same six, geo possibly undefined
 *   · InspectModal (displayed rarity memo) hex/flight/t/squawk/category/_classification
 *   · SpotToast (SPICY scan)               _classification/t/flight/squawk
 *
 * The consequences were real, not cosmetic:
 *
 *   1. `squawk` never reached logSpot, so `emergency_witness` / `hijack_alert`
 *      / `radio_failure` — three of the passport's 24 badges — could not
 *      unlock, `stats.emergencyCount` stayed 0 forever, and the +80/+70/+90
 *      SQUAWK_RARITY bonuses never applied to a PERSISTED spot.
 *   2. The card SHOWED a rarity computed from one attribute set while the
 *      passport STORED a rarity computed from another, so the logbook could
 *      disagree with the panel the player was looking at.
 *   3. `gs` / `alt_baro` were absent everywhere, so rarity.js's speed and
 *      altitude bands were dead code in the Fly path.
 *
 * Every site now calls this, so persisted rarity ≡ displayed rarity ≡ pinged
 * rarity BY CONSTRUCTION — a future attribute is added once, here.
 *
 * UNITS MATTER: rarity.js thresholds are in the ADS-B feed's units — `gs` in
 * KNOTS (>500 / >600 / >1000) and `alt_baro` in FEET (>45000 / >50000) — while
 * a track carries m/s and meters. The conversion belongs here, once.
 *
 * `dbFlags` is deliberately absent: the Fly worker never forwards it (see the
 * meta shape in lib/workers/aircraft-processor.worker.js), so that branch of
 * calculateRarity stays dormant in this path rather than being faked.
 *
 * @param {Object} track  a TrafficEngine track ({ hex, meta, fix1, ry, … })
 * @param {Object} [geo]  Vector3-ish { x: lon, y: lat } from engine.worldToGeo
 * @returns {Object} aircraft-shaped attrs for calculateRarity / logSpot
 */
export function trackSpotAttrs(track, geo) {
  const meta = track?.meta ?? null;
  const fix = track?.fix1 ?? null;
  return {
    hex: track?.hex ?? null,
    flight: meta?.flight ?? null,
    r: meta?.r ?? null,
    t: meta?.t ?? null,
    category: meta?.category ?? null,
    squawk: meta?.squawk ?? null,
    // The worker names it `iconType`; every scorer reads `_classification`.
    _classification: meta?.iconType ?? 'unknown',
    lat: geo?.y ?? null,
    lon: geo?.x ?? null,
    // Newest fix's ground vector → knots. No fix yet = unknown, never 0.
    gs: fix ? Math.hypot(fix.vE, fix.vN) * MPS_TO_KT : null,
    // Rendered altitude (meters MSL) → feet, the units alt_baro is quoted in.
    alt_baro: Number.isFinite(track?.ry) ? track.ry * M_TO_FT : null,
  };
}
