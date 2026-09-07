/**
 * R24 (E CERT) — verify-depth-roundtrip: the composer's depth must survive
 * the trip through the post chain.
 *
 * THE DEFECT (recon L2 / FL-07, and C's DEPTH_FIX). three r185 injects
 * `USE_REVERSED_DEPTH_BUFFER` into every non-raw program because the renderer
 * is created with `reversedDepthBuffer: true`. `postprocessing` 6.39.2 never
 * sets that define for its OWN passes, so its `readDepth` un-reverses under
 * one convention and three's `perspectiveDepthToViewZ` un-reverses again. The
 * two conversions cancel each other into nonsense: every fragment reconstructs
 * to −cameraNear. AerialPerspective happens to be right by accident (it
 * detects `gl.state.buffers.depth.getReversed()` — AerialPerspective.jsx:240
 * is the reference), but the toy DepthOfField is a uniform blur with no
 * tilt-shift band at all, because its circle-of-confusion is the same number
 * everywhere.
 *
 * THE CONTRACT (C, verbatim). Toy style, tier HIGH, Neon NYC, camera parked.
 * Three pixels whose TRUE view distance is known from a raycast — roughly
 * 50 m, 700 m and 4 km.
 *   RED (flag off): reconstructed |viewZ| is 2.50–2.51 m at ALL THREE.
 *   GREEN: |reconstructed − true| / true ≤ 1 % at all three, and the circle of
 *          confusion is < 0.02 at the focus plane and > 0.5 at 4 km.
 * Releases no fleet pin — toy at tier high is the fleet default — but it does
 * require the DoF pass to be PRESENT, so the gate proves that before asserting.
 *
 * THIS GATE NEEDS A HOOK, AND SAYS SO RATHER THAN INVENTING ONE.
 * Reconstructing viewZ requires sampling the composer's depth texture with the
 * same conversion the effects use. Re-implementing that conversion in the
 * harness would be testing the harness's copy of the bug, not the renderer's.
 * So the gate reads a probe the owner of the fix publishes:
 *
 *   window.__flyDepthProbe(x, y) -> { viewZ, coc, raw, reversed }
 *       x, y   pixel coordinates in the DRAWING BUFFER (origin top-left)
 *       viewZ  reconstructed view-space Z in metres (negative in front)
 *       coc    the DoF circle of confusion at that pixel, or null
 *       raw    the raw depth sample, for the ledger
 *       reversed  what `gl.state.buffers.depth.getReversed()` says
 *
 * If the hook is absent the gate FAILS LOUDLY with that signature rather than
 * skipping: a depth gate that quietly passes because it could not read depth
 * is worse than no gate.
 *
 * RUN
 *   FLY_TILE_FIXTURE=1 FLY_URL=http://localhost:3105 \
 *     node -r ./scripts/_pw-shim.js scripts/verify-depth-roundtrip.js
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');
const { settleWorld } = require('./_settle');
const { attachPageErrors } = require('./_pageerrors');

// Neon NYC, parked low over Midtown — the toy pose the fleet already uses.
const POSE = [40.7549, -73.984, 900, 2.6, -0.28];
const SETTLE = Number(process.env.DEPTH_SETTLE_MS || 90000);
const TOL_PCT = Number(process.env.DEPTH_TOL_PCT || 1);

const PIN_POSE = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__depthPin) clearInterval(window.__depthPin);
  window.__depthPin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = heading;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

/**
 * TRUE distance at a pixel, by raycasting the scene from the camera through
 * that pixel. This is the reference the reconstruction is compared against, so
 * it deliberately shares NO code with the depth path.
 */
/**
 * THE TRUTH BELONGS TO THE OWNER, NOT TO THE HARNESS.
 *
 * This gate used to build its own THREE.Raycaster from `window.__flyThree` and
 * `window.__flyCamera`. Neither exists — the re-take's miss table said so on
 * all fifteen probes: "handle absent — THREE false, gl true, cam false, scene
 * true". The page exposes the renderer and the scene and nothing else, so a
 * raycast assembled from OUTSIDE the bundle can never establish a true
 * distance, and an intermediate attempt to borrow r3f's own camera and
 * raycaster off the canvas store was the same mistake wearing better clothes:
 * a harness deciding what the renderer meant.
 *
 * C now publishes it. `window.__flyDepthTruth(x, y)` raycasts IN THE APP,
 * through the composer's active camera, against the world's depth-writing
 * geometry only, and returns `{ hit, distance, viewZ, object, source }` in the
 * SAME UNITS as the probe's viewZ — or `{ hit: false, reason }`. Both numbers
 * this gate compares therefore come from the renderer that produced the frame.
 */
const TRUTH = ([px, py]) =>
  typeof window.__flyDepthTruth === 'function'
    ? window.__flyDepthTruth(px, py)
    : { hit: false, reason: 'window.__flyDepthTruth is not published' };

const { numGate, notCalibrated, notCalCount, notCalSummary } = require('./_notcal');

let pass = 0;
let fail = 0;
const red = [];
function gate(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  if (process.env.FLY_TILE_FIXTURE) await require('./_fixture').attachFixture(context);
  const page = await context.newPage();
  const errors = [];
  const errorsNote = attachPageErrors(page, errors);

  // TOY, tier high — the DoF pass only exists there.
  await bootFly(page, { style: 'toy', timeoutMs: 600000, settleMs: 8000 });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function', undefined, {
    timeout: 120000,
    polling: 250,
  });
  await page.evaluate(PIN_POSE, POSE);
  await page.waitForTimeout(SETTLE);

  const hasProbe = await page.evaluate(() => typeof window.__flyDepthProbe === 'function');
  gate(
    '(0) THE DEPTH PROBE HOOK IS PUBLISHED — window.__flyDepthProbe(x, y)',
    hasProbe,
    hasProbe
      ? 'present'
      : 'ABSENT. This gate cannot reconstruct viewZ without the renderer\'s own conversion — ' +
        're-implementing it in the harness would test the harness\'s copy of the bug. Required ' +
        'signature: __flyDepthProbe(x, y) -> { viewZ, coc, raw, reversed }, x/y in DRAWING BUFFER ' +
        'pixels with a top-left origin. Owner: C (DEPTH_FIX).'
  );
  const state = await page.evaluate(() => ({
    reversed: window.__flyGl?.state?.buffers?.depth?.getReversed?.() ?? null,
    tier: window.__flyStore?.getState?.().qualityTier ?? null,
    style: window.__flyStore?.getState?.().mapStyle ?? null,
    dof: window.__flyStats?.effects?.dof ?? null,
    dofLive: typeof window.__flyDof !== 'undefined' ? window.__flyDof != null : null,
  }));
  console.log(
    `  renderer reversedDepth=${state.reversed} · style=${state.style} · tier=${state.tier} · ` +
      `dof=${JSON.stringify(state.dof)} · __flyDof ${state.dofLive === null ? 'UNPUBLISHED' : state.dofLive}`
  );
  // (0b) USED TO INFER PRESENCE FROM style/tier AND PASSED WHILE PRINTING
  // `dof=null`. "the tier that is supposed to have a DoF pass" is not "a DoF
  // pass": the released CoC term is what this gate's (3)/(4) read, and
  // asserting it from a store field is asserting the configuration, not the
  // renderer. It now reads C's live handle.
  if (state.dofLive === null)
    notCalibrated(
      '(0b) THE DoF PASS IS PRESENT — the released term is reachable in this tier',
      `window.__flyDof is unpublished (style ${state.style}, tier ${state.tier}). Required: ` +
        '`window.__flyDof` = the live DepthOfFieldEffect instance, or null when the chain has none. ' +
        'Owner: C (DEPTH_FIX). Without it this gate can only read the configuration it was asked ' +
        'to verify'
    );
  else
    gate(
      '(0b) THE DoF PASS IS PRESENT — the released term is reachable in this tier',
      state.dofLive === true && state.style === 'toy' && state.tier === 'high',
      `__flyDof ${state.dofLive} · style ${state.style} · tier ${state.tier} — the toy ` +
        'DepthOfField pass is the consumer this gate is about'
    );
  if (!hasProbe) {
    notCalibrated(
      '(1)-(4) THE DEPTH ROUND TRIP',
      'the probe hook is absent, so no pixel was read. This row is NOT RUNNABLE, which is a ' +
        'different thing from RED: nothing about the defect has been measured either way'
    );
    console.log(`\n${pass} passed, ${fail} failed${notCalSummary()}`);
    await browser.close();
    process.exit(1);
  }

  // Three pixels: near, mid and far. Chosen by raycast rather than by
  // guesswork, so the gate adapts to whatever the parked frame contains.
  const W = await page.evaluate(() => window.__flyGl.domElement.width);
  const H = await page.evaluate(() => window.__flyGl.domElement.height);
  const candidates = [];
  const misses = [];
  // (a) THIS IS A SETTLED-POSE PIXEL PROBE, i.e. a content gate by the §1.5
  // table — so it settles on the condition, not on a fixed wait, before it
  // picks anything. The row also needs the finalize budget scaler; without it
  // the toy chunks may simply not be resident at the moment of the pick, and
  // the raycast then reports an empty world as a gate failure.
  const st = await settleWorld(page, { capMs: Number(process.env.DEPTH_SETTLE_CAP_MS || 300000) });
  console.log(
    `  settle: ${st.settled ? 'SETTLED' : `NOT settled — ${st.why}`} in ${(st.ms / 1000).toFixed(0)}s ` +
      `(maxZ ${st.maxZ}, load ${st.load})`
  );
  for (const fy of [0.86, 0.72, 0.6, 0.55, 0.52]) {
    for (const fx of [0.3, 0.5, 0.7]) {
      const px = Math.round(W * fx);
      const py = Math.round(H * fy);
      const t = await page.evaluate(TRUTH, [px, py]);
      if (t && t.hit) candidates.push({ px, py, viewZ: t.viewZ, dist: t.distance, object: t.object, source: t.source });
      else misses.push(`(${px},${py}) ${t?.reason ?? 'no truth returned'}`);
    }
  }
  const pick = (target) =>
    candidates.length
      ? candidates.reduce((a, b) =>
          Math.abs(Math.abs(b.viewZ) - target) < Math.abs(Math.abs(a.viewZ) - target) ? b : a
        )
      : null;
  const picks = [
    ['near ~50 m', pick(50)],
    ['mid ~700 m', pick(700)],
    ['far ~4 km', pick(4000)],
  ].filter(([, p]) => p);

  console.log(
    `  depth truth (${candidates[0]?.source ?? 'n/a'}): ${candidates.length} hits at distances ` +
      `${JSON.stringify(candidates.map((c) => +Math.abs(c.viewZ).toFixed(0)))} on ` +
      `${JSON.stringify([...new Set(candidates.map((c) => c.object))].slice(0, 6))}` +
      (misses.length ? `; ${misses.length} miss(es): ${misses.slice(0, 3).join(' · ')}` : '')
  );
  // (c) FEWER THAN THREE IS NOT CALIBRATED, NOT A FAILURE. The gate needs
  // three pixels whose true distance is known; if the raycast found none, the
  // depth round trip was never exercised and the row measured nothing about it.
  if (picks.length < 3) {
    notCalibrated(
      '(1) THREE PIXELS WITH A KNOWN TRUE DISTANCE WERE FOUND',
      `${candidates.length} truth hits of ${candidates.length + misses.length} probes; picked ` +
        `${picks.length}. Misses: ${misses.slice(0, 4).join(' · ') || 'none recorded'}. Settled: ` +
        `${st.settled} (${st.why || 'ok'})`
    );
  } else
    gate(
      '(1) THREE PIXELS WITH A KNOWN TRUE DISTANCE WERE FOUND',
      true,
      `${candidates.length} truth hits; picked ${picks.map(([l, p]) => `${l}=${Math.abs(p.viewZ).toFixed(0)}m`).join(', ')}`
    );

  const rows = [];
  for (const [label, p] of picks) {
    const probe = await page.evaluate(([x, y]) => window.__flyDepthProbe(x, y), [p.px, p.py]);
    const trueZ = Math.abs(p.viewZ);
    const gotZ = Math.abs(probe?.viewZ ?? NaN);
    const errPct = (100 * Math.abs(gotZ - trueZ)) / trueZ;
    rows.push({ label, px: p.px, py: p.py, trueZ, gotZ, errPct, coc: probe?.coc, raw: probe?.raw, obj: p.object });
    console.log(
      `  ${label.padEnd(11)} px(${p.px},${p.py}) on ${p.obj} · true ${trueZ.toFixed(1)}m · ` +
        `reconstructed ${gotZ.toFixed(2)}m · err ${errPct.toFixed(1)}% · coc ${probe?.coc ?? 'n/a'} · raw ${probe?.raw}`
    );
    // THE HOOK CAN EXIST AND STILL RETURN NOTHING at a given pixel — an
    // out-of-range read, a fragment the depth texture never received, a probe
    // that answers before the first render. Every downstream assertion then
    // reads NOT CALIBRATED and quotes the probe's own reason, rather than
    // turning "no reading" into a percentage.
    if (!probe || !Number.isFinite(probe.viewZ))
      notCalibrated(
        `(2) ${label}: |reconstructed − true| / true ≤ ${TOL_PCT}%`,
        `__flyDepthProbe(${p.px}, ${p.py}) returned ${JSON.stringify(probe)} — viewZ is not a ` +
          `finite number, so nothing was reconstructed at that pixel (true distance ${trueZ.toFixed(1)} m)`
      );
    else
      numGate(gate)(
        `(2) ${label}: |probe.viewZ − truth.viewZ| / truth ≤ ${TOL_PCT}%`,
        errPct,
        errPct <= TOL_PCT,
        `${errPct.toFixed(2)}% (true ${trueZ.toFixed(1)}m vs ${gotZ.toFixed(2)}m)`,
        `errPct is ${errPct} (true ${trueZ}, reconstructed ${gotZ})`
      );
  }

  // The RED signature, stated exactly as C measured it.
  const measured = rows.filter((r) => Number.isFinite(r.gotZ));
  if (measured.length < rows.length)
    notCalibrated(
      'THE RED SIGNATURE (all three collapse to −cameraNear)',
      `${measured.length} of ${rows.length} pixels produced a finite reconstruction; the signature ` +
        'needs all three'
    );
  const allNearNear = measured.length === 3 && measured.every((r) => r.gotZ > 2.4 && r.gotZ < 2.6);
  if (allNearNear)
    console.log(
      '\n  ^^ THE RED SIGNATURE: all three reconstruct to 2.50-2.51 m, i.e. −cameraNear. Every ' +
        'fragment collapsed, which is the double un-reversal. This is the pre-fix state.'
    );
  red.push([
    'L2/FL-07 reversed depth double-converted',
    'verify-depth-roundtrip (2)',
    rows.map((r) => `${r.gotZ.toFixed(2)}m`).join(' / '),
    'within 1% of true',
  ]);

  const near = rows.find((r) => r.label.startsWith('near'));
  const far = rows.find((r) => r.label.startsWith('far'));
  // An INFO line for "the probe returned nothing" reads as a clean run in a
  // sweep table. It is NOT CALIBRATED: two legs did not execute. (And note
  // `near.coc < 0.02` would have passed on a NULL coc, since null numifies
  // to 0 — the guard above is load-bearing, not decorative.)
  // (3)/(4) NAME THE PASS THEY READ. The re-take printed `dof=null` beside
  // `__flyDof true` — two fields disagreeing about whether a DoF pass exists,
  // and a CoC asserted without saying which pass produced it. C now publishes
  // `cocSource`, so the gate reports the pass it actually read and refuses when
  // the coc came from nowhere identifiable.
  const cocSource = await page.evaluate(
    () => window.__flyStats?.effects?.cocSource ?? window.__flyDof?.cocSource ?? null
  );
  console.log(`  coc source: ${JSON.stringify(cocSource)}`);
  if (!cocSource)
    notCalibrated(
      '(3)/(4) CoC — DoF separation',
      `near ${near?.coc} far ${far?.coc}, but no cocSource is published — the gate would be ` +
        'asserting a number without knowing which pass produced it, which is how `dof=null` sat ' +
        'beside `__flyDof true` for two passes'
    );
  else if (Number.isFinite(near?.coc) && Number.isFinite(far?.coc)) {
    numGate(gate)(
      `(3) CoC < 0.02 AT THE FOCUS PLANE (from ${cocSource})`,
      near.coc,
      near.coc < 0.02,
      `near coc ${near.coc}`
    );
    numGate(gate)(
      `(4) CoC > 0.5 AT 4 km (from ${cocSource})`,
      far.coc,
      far.coc > 0.5,
      `far coc ${far.coc}`
    );
  } else {
    notCalibrated(
      '(3)/(4) CoC — DoF separation',
      `the probe returned no finite coc (near ${near?.coc}, far ${far?.coc}); the depth-of-field ` +
        'separation is not asserted by this run'
    );
  }

  gate('(5) NO PAGE ERRORS', errors.length === 0, errorsNote());
  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  console.log(`\n${pass} passed, ${fail} failed${notCalSummary()}`);
  await browser.close();
  process.exit(fail || notCalCount() ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
