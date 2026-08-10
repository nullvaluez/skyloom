/**
 * Round 6 Phase D: far-warp arrival — streaming speed + held cinematic.
 * - atlas warp to London (far) → warp-hold overlay appears, holds ≥ holdMin,
 *   reveals ≤ holdMax + 1.2s, and toy chunks are meaningfully ready at reveal
 * - logs the chunk-ready timeline (compare against the pre-round baseline:
 *   ready 40/120 at +3s, 118/120 at +8s with maxThreads 5)
 * - satellite-style far warp exercises the raster (tile-download) readiness
 *   path (round 7: Night retired — same code path, Esri provider)
 * - local warp (target warp) still shows the plain 900ms flash
 * Run: npm run dev (:3000), then `node scripts/verify-warp-arrival.js`.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

/* ===========================================================================
 * R22 SANCTIONED - PENDING FABLE SIGN-OFF  (plan §5.1)
 * ===========================================================================
 * The sanction: `WARP.far.holdMaxMs` 3500 -> 6500 for satellite far warps when
 * `ARRIVAL_GATE.enabled`, and THIS harness's satellite bound 5600 -> 7400 to
 * match. The sanction's own condition is that the bound moves "WITH the new
 * content assertion", never alone — a longer hold that still reveals over an
 * undescended pyramid is a worse product, not a better one, and a bound raised
 * without the content term would certify exactly that.
 *
 * PREPARED, NOT CONSUMED. Everything below is inert until
 * `R22_ARRIVAL_SANCTION=1` is set, so an unflagged run of this file is
 * byte-identical in behaviour to the R6 original: same 5600 ms bound, same
 * assertions, same exit code. Fable arms it at the W2 merge of B SETTLE, at
 * which point the two legs marked `R22` below become live and the 5600 bound
 * is replaced by 7400 + the content assertion, together.
 *
 * The content instrument is the same one verify-arrival uses:
 * `engine.getGroundAt(camera lon/lat).tileZ` at the reveal moment, compared
 * against the DEPARTURE pose's settled zoom at the same altitude (verify-
 * arrival's §1 note explains why the destination's own later self is not a
 * valid reference — on the pre-R22 tree it shares the defect).
 * ======================================================================== */
const R22_SANCTION = process.env.R22_ARRIVAL_SANCTION === '1';
const SAT_HOLD_BOUND_MS = R22_SANCTION ? 7400 : 5600; // §5.1: 5600 -> 7400 WITH the content term
const R22_CAM_TILE_Z = () => {
  const rt = window.__fly;
  const f = rt?.flight;
  const eng = rt?.engine;
  if (!f || !eng) return null;
  try {
    const g = eng.worldToGeo(f.pos);
    const ga = eng.getGroundAt(+g.x, +g.y);
    return ga ? ga.tileZ : null;
  } catch {
    return null;
  }
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  // R22 SANCTIONED - PENDING FABLE SIGN-OFF: the §5.1 content assertion reads a
  // tile zoom that only means something when TERRA is armed. Under the fleet
  // pin `__flyTerraPin=1` the reveal takes the LEGACY path and the assertion
  // measures the pin, not the feature — the W3 run read "camTileZ at reveal 13
  // vs departure 15" for exactly that reason (B proved the same shape for
  // verify-arrival (9b): an instrument that cannot observe a state reads it as
  // zero). The un-pin is scoped to the sanction leg, so an unflagged run of
  // this file is byte-identical in behaviour to R6's.
  if (R22_SANCTION) await page.addInitScript(unpinPins, ['__flyTerraPin', '__flySettlePin']);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const shot = (n) => page.screenshot({ path: path.join(__dirname, `warp-${n}.png`) });

  await bootFly(page); // R9-3: fly-only boot — waits on the real __flyBoot contract

  // --- far warp (toy readiness path) -------------------------------------
  await page.keyboard.press('m');
  await page.waitForTimeout(800);
  await page.keyboard.type('London', { delay: 40 });
  await page.waitForTimeout(600);
  const t0 = Date.now();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const holdVisible = await page
    .locator('[data-testid="warp-hold"]')
    .isVisible()
    .catch(() => false);
  const kind = await page.evaluate(() => window.__flyStore.getState().warpKind);
  gate('far warp → hold overlay + warpKind far', holdVisible && kind === 'far', `kind ${kind}`);
  await page.waitForTimeout(1500);
  await shot('01-hold');

  // wait for the overlay to resolve, sampling chunk readiness
  let revealAt = null;
  const timeline = [];
  for (let i = 0; i < 30; i++) {
    const s = await page.evaluate(() => ({
      hold: !!document.querySelector('[data-testid="warp-hold"]'),
      toy: window.__fly?.toyStats ?? null,
    }));
    timeline.push({ t: Math.round((Date.now() - t0) / 100) / 10, ...s });
    if (!s.hold && revealAt == null) {
      revealAt = Date.now() - t0;
      break;
    }
    await page.waitForTimeout(400);
  }
  console.log(
    'timeline:',
    timeline.map((s) => `${s.t}s ready ${s.toy ? s.toy.ready + '/' + s.toy.chunks : '-'} hold ${s.hold ? 1 : 0}`).join(' | ')
  );
  gate(
    'hold resolves within bounds',
    revealAt != null && revealAt >= 2000 && revealAt <= 5600,
    `${revealAt}ms`
  );
  const atReveal = timeline[timeline.length - 1]?.toy;
  gate(
    'chunks meaningfully ready at reveal',
    !!atReveal && (atReveal.ready >= 12 || atReveal.ready / Math.max(1, atReveal.chunks) >= 0.3),
    atReveal ? `${atReveal.ready}/${atReveal.chunks}` : 'no stats'
  );
  await page.waitForTimeout(1200);
  await shot('02-after-reveal');

  // ready-speed check: by +8s from warp, most chunks should be in
  await page.waitForTimeout(Math.max(0, 8000 - (Date.now() - t0)));
  const at8 = await page.evaluate(() => window.__fly?.toyStats ?? null);
  console.log('ready at +8s:', at8 ? `${at8.ready}/${at8.chunks}` : 'n/a');
  gate('streaming not slower than baseline', !!at8 && at8.ready >= 60, `${at8?.ready}`);

  // --- satellite far warp (raster readiness path) -------------------------
  await page.evaluate(() => window.__flyStore.getState().setMapStyle('satellite'));
  await page.waitForTimeout(4000);
  // R22 SANCTIONED - PENDING FABLE SIGN-OFF: the DEPARTURE reference for the
  // content assertion below. Inert (a plain read) unless the sanction is armed.
  const departZ = R22_SANCTION ? await page.evaluate(R22_CAM_TILE_Z) : null;
  await page.keyboard.press('m');
  await page.waitForTimeout(800);
  await page.keyboard.type('Tokyo', { delay: 40 });
  await page.waitForTimeout(600);
  const t1 = Date.now();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const holdNight = await page
    .locator('[data-testid="warp-hold"]')
    .isVisible()
    .catch(() => false);
  gate('satellite far warp → hold overlay', holdNight);
  let nightReveal = null;
  let revealZ = null;
  for (let i = 0; i < 30; i++) {
    const hold = await page.evaluate(() => !!document.querySelector('[data-testid="warp-hold"]'));
    if (!hold) {
      nightReveal = Date.now() - t1;
      if (R22_SANCTION) revealZ = await page.evaluate(R22_CAM_TILE_Z);
      break;
    }
    await page.waitForTimeout(400);
  }
  // R22 W3 (Fable-signed instrument fix): the wall-clock read is DOUBLY
  // quantized — WarpFlash polls readiness at 250 ms and this loop polls the
  // overlay at 400 ms — so a hold that capped correctly at 6500 measured
  // 7405 against the 7400 bound (5 ms over = click-dispatch latency after
  // both quantizations consumed the 900 ms grace). The authoritative clock
  // is B's runtime.arrivalStats.holdMs (stamped inside WarpFlash itself);
  // the wall clock stays as the fallback with ONE harness poll (400 ms) of
  // explicit additional grace, derivation stated. The cap semantics did not
  // move: ARRIVAL_GATE.holdMaxMs 6500 + revealMs 650 + one WarpFlash poll.
  const holdStats = R22_SANCTION
    ? await page.evaluate(() => {
        const a = window.__fly?.runtime?.arrivalStats ?? null;
        return a && a.kind === 'far' ? { holdMs: a.holdMs, capped: a.reason === 'capped' } : null;
      })
    : null;
  const holdMeasured = holdStats?.holdMs ?? nightReveal;
  const holdBound = holdStats ? 6500 + 650 : SAT_HOLD_BOUND_MS + (R22_SANCTION ? 400 : 0);
  gate(
    `satellite hold resolves within bounds${R22_SANCTION ? ' (R22 §5.1 CONSUMED: 5600 → 7400)' : ''}`,
    holdMeasured != null && holdMeasured <= holdBound,
    `${holdMeasured}ms vs ${holdBound}${holdStats ? ' (arrivalStats clock)' : ' (wall clock)'}`
  );
  // R22 SANCTIONED - PENDING FABLE SIGN-OFF: the assertion the bound move is
  // conditional on. Skipped entirely when the sanction is not armed.
  if (R22_SANCTION)
    gate(
      'R22 §5.1 — the satellite reveal shows CONTENT, not just elapsed time',
      revealZ != null && departZ != null && revealZ >= departZ - 1,
      `camTileZ at reveal ${revealZ} vs departure ${departZ} (deficit ${(departZ ?? 0) - (revealZ ?? 0)})`
    );
  await page.waitForTimeout(2500);
  await shot('03-sat-tokyo');

  // --- local warp still plain flash --------------------------------------
  await page.evaluate(() => {
    const fly = window.__fly;
    const t = fly.traffic.getNearest(5, fly.flight.pos).find((i) => i.fix1);
    if (t) window.__flyStore.getState().setInspectHex(t.hex);
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('[data-testid="inspect-warp"]')?.click());
  await page.waitForTimeout(250);
  const local = await page.evaluate(() => ({
    kind: window.__flyStore.getState().warpKind,
    hold: !!document.querySelector('[data-testid="warp-hold"]'),
  }));
  gate('local warp → plain flash (no hold)', local.kind === 'local' && !local.hold, JSON.stringify(local));

  gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
