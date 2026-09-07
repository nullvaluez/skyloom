/**
 * R24 (E CERT) — NOT CALIBRATED: the third verdict.
 *
 * WHY THIS FILE EXISTS. Pass-1 produced a gate that printed
 *
 *     PASS  (5) high/noon WATER READS THE SAME DIRECTIONAL AS KEY  — Δ undefined°
 *
 * six times in one run. The comparison was `angleBetween(key, water) < 1e-4`,
 * and `angleBetween` returns NULL when either vector is missing or zero-length.
 * **`null < 1e-4` is TRUE in JavaScript** — null numifies to 0 — so the gate
 * certified a reading that did not exist, and said so in its own detail string
 * while doing it.
 *
 * The asymmetry is what makes this a trap rather than a typo:
 *
 *   - `undefined` in a comparison yields NaN, and every NaN comparison is
 *     FALSE. So `x < tol` fails loudly (good) and `!(x > tol)` passes silently
 *     (bad).
 *   - `null` numifies to 0. So `x < tol` PASSES silently (bad) and `x > tol`
 *     fails loudly (good).
 *
 * Which means there is no way to write comparisons "the safe way round": the
 * safe direction for one absent value is the lethal direction for the other.
 * The only durable fix is to assert that the operand IS a finite number before
 * comparing it, and to report the absence as its own verdict.
 *
 * NOT CALIBRATED is that verdict. It is not a pass (nothing was measured) and
 * not a failure of the thing under test (the world may be fine). It counts
 * toward a NON-ZERO EXIT, because this fleet's charter is that a green means
 * something, and a leg that measured nothing has certified nothing.
 *
 * USAGE
 *   const { numGate, notCalCount } = require('./_notcal');
 *   const gateNum = numGate(gate);          // wrap the file's own gate()
 *   gateNum(name, value, value < tol, detail, whyItMightBeAbsent);
 *   ...
 *   process.exit(fail || notCalCount() ? 1 : 0);
 */

let count = 0;

/** Print the third verdict and count it. */
function notCalibrated(name, why) {
  count++;
  console.log(`NOTCAL  ${name}  — ${why}`);
}

/** How many legs measured nothing this run. */
function notCalCount() {
  return count;
}

/** A one-line summary fragment for the verdict line ('' when everything measured). */
function notCalSummary() {
  return count ? `, ${count} NOT CALIBRATED (legs that measured nothing — see NOTCAL above)` : '';
}

/**
 * Wrap a harness's own `gate(name, ok, detail)` into a threshold-comparison
 * gate that refuses to judge an absent operand.
 *
 * `value` is the NUMBER the comparison rests on (the delta, the count, the
 * percentage). If it is not finite the leg reads NOT CALIBRATED with `why`,
 * and `ok` — which may well be `true` for the wrong reason — is never
 * consulted.
 */
function numGate(gate) {
  return function gateNum(name, value, ok, detail, why) {
    if (!Number.isFinite(value)) {
      notCalibrated(name, why || `the measured value is ${value} — nothing was compared`);
      return;
    }
    gate(name, ok, detail);
  };
}

/**
 * For the `v == null || v <= CEILING` shape, which reads "an absent number is
 * under the ceiling". It is not: it is an absent number. Returns true only for
 * a finite value at or under the ceiling; callers pair it with a presence
 * check so absence lands in NOT CALIBRATED rather than in PASS.
 */
function underCeiling(v, ceiling) {
  return Number.isFinite(v) && v <= ceiling;
}

module.exports = { notCalibrated, notCalCount, notCalSummary, numGate, underCeiling };
