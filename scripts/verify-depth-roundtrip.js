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
const RAYCAST = ([px, py]) => {
  const THREE = window.__flyThree || null;
  const gl = window.__flyGl;
  const cam = window.__flyCamera || window.__fly?.camera?.cam || null;
  let scene = window.__flyPlayer ?? window.__fly?.engine?.object ?? null;
  while (scene && scene.parent) scene = scene.parent;
  if (!gl || !cam || !scene || !THREE) return null;
  const W = gl.domElement.width;
  const H = gl.domElement.height;
  const ndc = new THREE.Vector2((px / W) * 2 - 1, -(py / H) * 2 + 1);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, cam);
  rc.far = 60000;
  const hits = rc.intersectObject(scene, true).filter((h) => h.distance > 0.5);
  if (!hits.length) return null;
  // view-space Z is the distance along the camera forward axis, not the ray.
  const fwd = new THREE.Vector3();
  cam.getWorldDirection(fwd);
  const v = hits[0].point.clone().sub(cam.getWorldPosition(new THREE.Vector3()));
  return { dist: hits[0].distance, viewZ: -v.dot(fwd), object: hits[0].object.name || '(unnamed)' };
};

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
  page.on('pageerror', (e) => errors.push(String(e)));

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
  }));
  console.log(`  renderer reversedDepth=${state.reversed} · style=${state.style} · tier=${state.tier} · dof=${JSON.stringify(state.dof)}`);
  gate(
    '(0b) THE DoF PASS IS PRESENT — the released term is reachable in this tier',
    state.style === 'toy' && state.tier === 'high',
    `style ${state.style} tier ${state.tier} — the toy DepthOfField pass is the consumer this gate ` +
      'is about; asserting depth with no depth reader would be a green that means nothing'
  );
  if (!hasProbe) {
    console.log(`\n${pass} passed, ${fail} failed${notCalSummary()}`);
    await browser.close();
    process.exit(1);
  }

  // Three pixels: near, mid and far. Chosen by raycast rather than by
  // guesswork, so the gate adapts to whatever the parked frame contains.
  const W = await page.evaluate(() => window.__flyGl.domElement.width);
  const H = await page.evaluate(() => window.__flyGl.domElement.height);
  const candidates = [];
  for (const fy of [0.86, 0.72, 0.6, 0.55, 0.52]) {
    for (const fx of [0.3, 0.5, 0.7]) {
      const px = Math.round(W * fx);
      const py = Math.round(H * fy);
      const r = await page.evaluate(RAYCAST, [px, py]);
      if (r) candidates.push({ px, py, ...r });
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

  gate(
    '(1) THREE PIXELS WITH A KNOWN TRUE DISTANCE WERE FOUND',
    picks.length === 3,
    `${candidates.length} raycast hits; picked ${picks.map(([l, p]) => `${l}=${Math.abs(p.viewZ).toFixed(0)}m`).join(', ')}`
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
    numGate(gate)(
      `(2) ${label}: |reconstructed − true| / true ≤ ${TOL_PCT}%`,
      errPct,
      errPct <= TOL_PCT,
      `${errPct.toFixed(2)}% (true ${trueZ.toFixed(1)}m vs ${gotZ.toFixed(2)}m)`,
      `errPct is ${errPct} (true ${trueZ}, reconstructed ${gotZ}) — the depth read produced no ` +
        'number, so there is nothing to compare against the tolerance'
    );
  }

  // The RED signature, stated exactly as C measured it.
  const allNearNear = rows.length === 3 && rows.every((r) => r.gotZ > 2.4 && r.gotZ < 2.6);
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
  if (Number.isFinite(near?.coc) && Number.isFinite(far?.coc)) {
    numGate(gate)('(3) CoC < 0.02 AT THE FOCUS PLANE', near.coc, near.coc < 0.02, `near coc ${near.coc}`);
    numGate(gate)('(4) CoC > 0.5 AT 4 km', far.coc, far.coc > 0.5, `far coc ${far.coc}`);
  } else {
    notCalibrated(
      '(3)/(4) CoC — DoF separation',
      `the probe returned no finite coc (near ${near?.coc}, far ${far?.coc}); the depth-of-field ` +
        'separation is not asserted by this run'
    );
  }

  gate('(5) NO PAGE ERRORS', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');
  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  console.log(`\n${pass} passed, ${fail} failed${notCalSummary()}`);
  await browser.close();
  process.exit(fail || notCalCount() ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
