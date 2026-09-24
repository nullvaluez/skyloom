/**
 * R25 (E CERT) — the PRODUCT-BOOT VERDICT (plan "E — CERT": product boot to
 * the title, median of 3 <= W0 x 1.05; "if red, B swaps the default spot").
 *
 * Pure arithmetic over the rows scripts/r25-e-baseline.cjs records, split out
 * so it can be checked in node without a browser. A row is
 *   { arm, worldMs, spot:{lat,lon}|null, scene, error? }.
 *
 * The verdict refuses to read a coin (peer review, fix pass):
 *   NOT CALIBRATED  there is no w0 arm AND an integration arm; an arm has
 *                   fewer than 3 valid runs; an arm's OWN spread
 *                   (max-min)/median exceeds the bound's 5 % (the venue then
 *                   cannot resolve a 5 % difference — MEASURED, a satellite
 *                   boot here moved by minutes with the load average); or an
 *                   arm revealed different spots across its runs (the title
 *                   spot is clock-dependent: the recorder pins the clock, and
 *                   this catches a pin that did not take).
 *   PASS / FAIL     integration median <= w0 median x 1.05.
 * The W0 arm's spot is KOSU (today's first world, prop / apron) and the
 * integration arm's is B's title spot BY DESIGN — the plan compares "time to
 * a live world" across the two front doors, not two identical scenes. Each
 * arm must only agree WITH ITSELF.
 *
 * `node scripts/_r25-product-boot.js` — self-check on synthetic rows. It is
 * RED-first: the first cases are the coins the review named (a single arm, an
 * 11 % W0 spread, a spot that moved between runs) and must NOT read PASS or
 * FAIL; then one PASS and one FAIL.
 */

const PRODUCT_BOUND_K = 1.05;
const PRODUCT_MIN_RUNS = 3;

/** xs sorted ascending; n=3 -> the middle; even n -> the upper middle. */
const median = (xs) => (xs.length ? xs[Math.floor(xs.length / 2)] : null);

const spotKey = (r) => `${r.scene ?? '?'}@${r.spot ? `${r.spot.lat.toFixed(2)},${r.spot.lon.toFixed(2)}` : '?'}`;

function productVerdict(rows, arms, { boundK = PRODUCT_BOUND_K, minRuns = PRODUCT_MIN_RUNS, sunPinMs = null } = {}) {
  const per = {};
  for (const a of arms) {
    const rs = rows.filter((r) => r.arm === a.tag);
    const ws = rs.map((r) => r.worldMs).filter(Number.isFinite).sort((x, y) => x - y);
    const med = median(ws);
    const spots = [...new Set(rs.filter((r) => !r.error).map(spotKey))];
    per[a.tag] = {
      url: a.url,
      runs: rs.length,
      valid: ws.length,
      worldMs: ws,
      medianMs: med,
      spread: med ? +((ws[ws.length - 1] - ws[0]) / med).toFixed(4) : null,
      spots,
    };
  }
  const w0 = per.w0;
  const intTag = arms.map((a) => a.tag).find((t) => t !== 'w0');
  const it = intTag ? per[intTag] : null;
  const out = { boundK, arms: per, sunPinMs };
  const why = [];
  if (!w0 || !it) why.push('needs a w0 arm and an integration arm interleaved in one session (R25_BASELINE_PRODUCT_ARMS)');
  for (const [tag, a] of Object.entries(per)) {
    if (a.valid < minRuns) why.push(`${tag}: ${a.valid} valid runs < ${minRuns}`);
    else if (a.spread > boundK - 1)
      why.push(`${tag}: own spread ${(a.spread * 100).toFixed(1)} % > the ${((boundK - 1) * 100).toFixed(0)} % bound — the venue cannot resolve it`);
    if (a.spots.length > 1) why.push(`${tag}: revealed ${a.spots.length} different spots (${a.spots.join(' | ')})`);
  }
  if (why.length) return { ...out, verdict: 'NOT CALIBRATED', why };
  const ok = it.medianMs <= w0.medianMs * boundK;
  return {
    ...out,
    verdict: ok ? 'PASS' : 'FAIL',
    ratio: +(it.medianMs / w0.medianMs).toFixed(4),
    why: [`${intTag} median ${it.medianMs} ms vs w0 ${w0.medianMs} ms x ${boundK} = ${Math.round(w0.medianMs * boundK)} ms`],
  };
}

module.exports = { productVerdict, median, PRODUCT_BOUND_K, PRODUCT_MIN_RUNS };

if (require.main === module) {
  const KOSU = { lat: 40.0798, lon: -83.073 };
  const GC = { lat: 36.0544, lon: -112.1401 };
  const rows = (arm, ms, spot, scene) => ms.map((worldMs) => ({ arm, worldMs, spot, scene }));
  const ARMS = [{ tag: 'w0' }, { tag: 'int' }];
  const cases = [
    // --- the coins: must NOT produce PASS/FAIL -------------------------------
    { name: 'single arm (the pre-fix recorder) -> NOT CALIBRATED', arms: [{ tag: 'int' }],
      rows: rows('int', [100000, 101000, 102000], GC, 'rural'), want: 'NOT CALIBRATED' },
    { name: 'W0 spread 11.3 % > 5 % -> NOT CALIBRATED', arms: ARMS,
      rows: [...rows('w0', [100000, 106000, 112000], KOSU, 'powell'), ...rows('int', [100000, 101000, 102000], GC, 'rural')], want: 'NOT CALIBRATED' },
    { name: 'int spot moved between runs (clock pin did not take) -> NOT CALIBRATED', arms: ARMS,
      rows: [...rows('w0', [100000, 101000, 102000], KOSU, 'powell'), ...rows('int', [100000, 101000], GC, 'rural'),
        { arm: 'int', worldMs: 101500, spot: { lat: 40.7128, lon: -74.006 }, scene: 'manhattan' }], want: 'NOT CALIBRATED' },
    { name: 'two valid int runs (one errored) -> NOT CALIBRATED', arms: ARMS,
      rows: [...rows('w0', [100000, 101000, 102000], KOSU, 'powell'), ...rows('int', [100000, 101000], GC, 'rural'),
        { arm: 'int', error: 'timeout' }], want: 'NOT CALIBRATED' },
    // --- the readable cases ----------------------------------------------------
    { name: 'int median 104 s vs w0 101 s x 1.05 -> PASS', arms: ARMS,
      rows: [...rows('w0', [100000, 101000, 102000], KOSU, 'powell'), ...rows('int', [103000, 104000, 105000], GC, 'rural')], want: 'PASS' },
    { name: 'int median 110 s vs w0 101 s x 1.05 -> FAIL', arms: ARMS,
      rows: [...rows('w0', [100000, 101000, 102000], KOSU, 'powell'), ...rows('int', [109000, 110000, 111000], GC, 'rural')], want: 'FAIL' },
  ];
  let bad = 0;
  for (const c of cases) {
    const v = productVerdict(c.rows, c.arms);
    const ok = v.verdict === c.want;
    if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  — read ${v.verdict}: ${v.why.join('; ')}`);
  }
  console.log(`\n_r25-product-boot self-check: ${cases.length - bad}/${cases.length}`);
  process.exit(bad ? 1 : 0);
}
