/**
 * GATE TO GATE — the sim hold (runtime.simHold).
 *
 * A set of named reasons that freeze the flight simulation without opening a
 * menu: while any reason is held, FlyScene passes `held` to
 * operations.advance and treats the frame as paused (input neutralised), so
 * flight.pos does not move. Each owner adds and removes only its own reason,
 * so two holders never release each other.
 *
 * Reasons (add new ones here, with the owner):
 *   'review'  scripts/review-operations-airfield.cjs poses (dev only,
 *             lib/fly/airport-service/review-poses.js)
 *   'intro'   CAMERA_DIRECTOR airport intros (W2 F)
 *   'lounge'  LOUNGE_BRIDGE glide and handoff (W4 P)
 *   'replay'  REPLAY playback (W5)
 */
export const SIM_HOLD_REASONS = Object.freeze(['review', 'intro', 'lounge', 'replay']);

export function createSimHold() {
  const reasons = new Set();
  const known = (reason) => {
    if (!SIM_HOLD_REASONS.includes(reason)) throw new Error(`simHold: unknown reason '${reason}'`);
    return reason;
  };
  return {
    add(reason) {
      reasons.add(known(reason));
    },
    remove(reason) {
      reasons.delete(known(reason));
    },
    set(reason, on) {
      if (on) reasons.add(known(reason));
      else reasons.delete(known(reason));
    },
    has(reason) {
      return reasons.has(reason);
    },
    any() {
      return reasons.size > 0;
    },
    list() {
      return [...reasons];
    },
    clear() {
      reasons.clear();
    },
  };
}
