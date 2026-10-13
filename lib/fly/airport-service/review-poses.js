/**
 * GATE TO GATE — the review pose hook (development only).
 *
 * installReviewPoses({ runtime, flight, operations }) installs
 * runtime.reviewOps for scripts/review-operations-airfield.cjs and returns a
 * release function. FlyScene calls it only when NODE_ENV === 'development'.
 * Certification harnesses never use it.
 *
 * Contract (filled in by the W0 harness work, gate poses by W3):
 *   runtime.reviewOps = {
 *     poses: string[],
 *     pose(name, { aircraftId }) -> { ok, name, airportId, runway, reason? },
 *     hold(bool),            // runtime.simHold reason 'review'
 *     camera('chase'|'side'|'tower'),
 *   }
 * Runway poses: lineup, roll40, rotate, final3nm, final1nm, flare, rollout.
 * Gate poses (W3): stand, pushback, hold, taxiin, docked.
 */
export function installReviewPoses({ runtime }) {
  if (!runtime) return () => {};
  return () => {};
}
