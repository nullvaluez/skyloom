/**
 * SHIP PASS (FLY_SHIP_PASS.md RL-2, D2, section 6) — the Challenge layer
 * state. RELEASE owns this file.
 *
 * FROZEN API (W0; a change is a contract change recorded in section 6):
 *   CHALLENGE_KEY          'fly-challenge-v1'
 *   challengeOn() → bool   true when the arcade systems (crashes, combos,
 *                          near-miss, its shake, the run summary, buzz
 *                          contracts) are on for this player.
 *
 * W0 STUB: today's behaviour — every arcade system is present, so true.
 */
export const CHALLENGE_KEY = 'fly-challenge-v1';

export function challengeOn() {
  return true;
}
