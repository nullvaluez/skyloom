/**
 * R25 (E CERT) — the CROSS-BOOT and TOGGLE-APPLICABILITY rules of
 * scripts/verify-r25-visuals.cjs, as pure functions so they can be checked in
 * node without a browser (the _r25-product-boot.js idiom).
 *
 * crossBootVerdict(d, xf) — leg (6), "Classic == the flag-off tree".
 *   d   the integration-vs-flag-off diff census at a pose ({mean, p99, ...},
 *       _r25-luma.js diffCensus, full frame);
 *   xf  the VENUE's cross-boot floor at that pose: flag-off vs flag-off across
 *       two boots (an R25_VISUALS_XFLOOR run, xfloor.json), or null.
 *   PASS            inside the identity bound (mean <= 0.5/255, p99 <= 2/255);
 *   NOT CALIBRATED  outside it, but the venue's own floor ALSO breaks the
 *                   bound and the pair is no worse than that floor (two boots
 *                   of the SAME flag-off tree differ at least as much — the
 *                   venue cannot resolve the bound there);
 *   FAIL            anything else — including a pair outside the bound with
 *                   no floor recorded (never excused by an argument).
 *   MEASURED (R25 E2 close, fixture, SwiftShader): Owens int-vs-w0 0.124/2
 *   against a floor of 0.531/11 (PASS); Manhattan 0.552/10 against 2.031/33
 *   (NOT CALIBRATED). The floor is a clock-driven sky cloud pass, steam
 *   plumes and facade shimmer that no park reaches.
 *
 * toggleLegsApply({ skyOn, groundOn }) — legs (1)-(4), (5b), (7a) measure a
 *   Visuals switch. With NO R25 visual block ON, r25On() is false everywhere,
 *   so the "Enhanced" capture IS Classic and any difference is the venue
 *   moving between captures: those legs are NOT CALIBRATED by construction.
 *   MEASURED (same run): at Manhattan the plumes + facade shimmer over a
 *   10-minute toggle cycle tripped the motion detector on a Classic/Classic
 *   pair and (4c) FAILED on seam 14.70 vs 14.70.
 *
 * `node scripts/_r25-xboot.js` — self-check, RED first: the first cases are
 * the ones the rules exist to refuse (a pair outside the bound with no floor,
 * a pair worse than its floor, a floor that is itself inside the bound).
 */

const BOUND = { mean: 0.5, p99: 2 };

const inside = (d) => !!d && d.mean <= BOUND.mean && d.p99 <= BOUND.p99;

function crossBootVerdict(d, xf = null) {
  if (!d || !Number.isFinite(d.mean) || !Number.isFinite(d.p99)) return { verdict: 'NOT CALIBRATED', why: 'no pair' };
  if (inside(d)) return { verdict: 'PASS', why: 'inside the identity bound' };
  if (xf && Number.isFinite(xf.mean) && Number.isFinite(xf.p99) && !inside(xf) && d.mean <= xf.mean && d.p99 <= xf.p99)
    return { verdict: 'NOT CALIBRATED', why: "inside the venue's own flag-off vs flag-off cross-boot floor, which itself exceeds the bound" };
  return { verdict: 'FAIL', why: xf ? 'outside the bound and worse than the venue cross-boot floor (or the floor resolves the bound)' : 'outside the bound, no cross-boot floor recorded' };
}

function toggleLegsApply({ skyOn = false, groundOn = false } = {}) {
  return !!(skyOn || groundOn);
}

module.exports = { crossBootVerdict, toggleLegsApply, XBOOT_BOUND: BOUND };

if (require.main === module) {
  let pass = 0, fail = 0;
  const check = (name, got, want) => {
    const ok = got === want;
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — got ${got}, want ${want}`);
  };
  const v = (d, xf) => crossBootVerdict(d, xf).verdict;
  // RED first: the cases the rule must refuse.
  check('outside the bound, no floor -> FAIL (never excused)', v({ mean: 0.552, p99: 10 }, null), 'FAIL');
  check('worse than the floor -> FAIL', v({ mean: 2.5, p99: 40 }, { mean: 2.031, p99: 33 }), 'FAIL');
  check('p99 worse than the floor (mean inside it) -> FAIL', v({ mean: 1.0, p99: 34 }, { mean: 2.031, p99: 33 }), 'FAIL');
  check('the floor itself resolves the bound -> FAIL', v({ mean: 0.6, p99: 3 }, { mean: 0.4, p99: 2 }), 'FAIL');
  check('a missing pair -> NOT CALIBRATED', v(null, null), 'NOT CALIBRATED');
  // The measured rows.
  check('Owens (measured 0.124/2 vs floor 0.531/11) -> PASS', v({ mean: 0.124, p99: 2 }, { mean: 0.531, p99: 11 }), 'PASS');
  check('Manhattan (measured 0.552/10 vs floor 2.031/33) -> NOT CALIBRATED', v({ mean: 0.552, p99: 10 }, { mean: 2.031, p99: 33 }), 'NOT CALIBRATED');
  check('toggle legs with no visual block ON -> do not apply', toggleLegsApply({ skyOn: false, groundOn: false }), false);
  check('toggle legs with R25_SKY ON -> apply', toggleLegsApply({ skyOn: true, groundOn: false }), true);
  check('toggle legs with R25_GROUND ON -> apply', toggleLegsApply({ skyOn: false, groundOn: true }), true);
  console.log(`\n_r25-xboot self-check: ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
}
