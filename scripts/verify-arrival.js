/**
 * ROUND 22 (E "CERT") — verify-arrival: WHAT IS ON SCREEN WHEN THE CURTAIN
 * LIFTS?
 *
 * The user's symptom #2 is a warp to Dublin OH at FL300 that revealed low-zoom
 * ground and never properly sharpened. The existing gate for this,
 * `verify-warp-arrival.js:114`, asserts `revealAt <= 5600` — ELAPSED TIME and
 * nothing else. It cannot fail on a blurry reveal; it can only fail on a slow
 * one. The satellite reveal itself is no better: `WarpFlash.jsx:43-50` polls
 * `engine.downloading < 3`, an INSTANTANEOUS in-flight download count with no
 * content check at all, and a count of zero is exactly what a quadtree that
 * has not started descending looks like.
 *
 * So this gate measures the thing the product promises: the zoom of the tile
 * resident under the camera AT THE MOMENT the overlay clears, against the zoom
 * that same pose settles to fifteen seconds later. The comparison is
 * SELF-CALIBRATING — it needs no target-zoom table and no agreement about what
 * "sharp" means at FL300, because the scene itself supplies both numbers. If
 * the reveal fires two levels short of where the scene lands, the player
 * watched the world sharpen after being told it was ready. That is the defect,
 * stated as an inequality.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS GATE UN-PINS
 * ---------------------------------------------------------------------------
 * `__flySettlePin` (B's ARRIVAL_GATE / SETTLE_CALM) AND `__flyTerraPin` (A's
 * terrain pipeline) — the content-aware gate reads `runtime.terraStats`, so
 * certifying B's reveal against A's pinned legacy terrain would certify a
 * combination that never ships. Both are un-pinned through the shared
 * `unpinPins` accessor in scripts/_boot.js.
 *
 * NOT un-pinned: `__flyAerialOverride`. verify-aerial is the ONE harness that
 * un-pins the R19 ship-state visuals, and that ruling is not reopened here —
 * the SAT_QUILT arrival evidence below is a UNIFORM READ at the arrival pose
 * plus a screenshot, never a pin write.
 *
 * ---------------------------------------------------------------------------
 * RED CALIBRATION (r22/e @ ee39397, all R22 blocks enabled:false)
 * ---------------------------------------------------------------------------
 * Gate (4) is RED BY CONSTRUCTION on this tree: nothing in the reveal path
 * consults content. The run prints the measured deficit (revealZ vs settledZ)
 * and it lands in scripts/r22-close-sweep.md §1.
 *
 * GATES
 *   (1)  precondition — the far warp registered (warpKind 'far' + hold overlay)
 *   (2)  the hold respects holdMin (>= 2200 ms — the R6 cinematic floor)
 *   (3)  the hold respects its cap (3500 legacy / 6500 with ARRIVAL_GATE)
 *   (4)  CONTENT AT REVEAL — camTileZ at reveal >= settled camTileZ - 1
 *   (5)  camTileZ at reveal clears the absolute floor for a FL300 arrival
 *   (6)  the reveal was CONTENT-driven, not time-capped
 *   (7)  no reveal-then-blur — camTileZ never drops below its reveal value in
 *        the 15 s after the curtain lifts
 *   (8)  the legacy criterion is recorded: `downloading` at reveal
 *   (9)  local warp — kind 'local', and its hold stays inside localHold.maxMs
 *   (10) local warp tileZ deficit recorded (the localHoldDeficit input)
 *   (11) BOOT REVEAL — camTileZ at the boot reveal clears the same floor
 *   (12) boot time did NOT lengthen (BOOT.maxBootMs frozen — plan §4)
 *   (13) SAT_QUILT strength at the arrival pose (checkpoint #6 evidence)
 *   (14) the hold overlay never outlives its own cap by more than one poll
 *   (15) zero page/console errors
 *
 * Run: FLY_URL=http://localhost:3224 node scripts/verify-arrival.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const DEV_ORIGIN = (process.env.FLY_URL || 'http://localhost:3000').replace(/\/$/, '');

const P_DUBLIN = [40.0992, -83.1141, 9144]; // FL300 over Dublin OH
const FAR_START = [36.75, -118.05, 9144]; // Owens Valley — >3000 km away
const HOLD_MIN_MS = 2200; // WARP.far.holdMinMs (frozen)
const HOLD_MAX_LEGACY = 3500; // WARP.far.holdMaxMs today
const HOLD_MAX_GATED = 6500; // ARRIVAL_GATE.holdMaxMs (sanction §5.1)
const POLL_SLACK_MS = 1400; // one 250 ms poll + the reveal transition + rAF slop
/* The absolute floor for a FL300 arrival. Chosen from the LOD math, not from
 * taste: at ~9 km AGL three-tile's screen-space error wants roughly z12-13
 * under the camera, so a reveal at z11 or below is showing a tile magnified at
 * least 4x. Gate (4) is the load-bearing one; this is the sanity companion
 * that would still fail if a future change made the scene settle badly too. */
const REVEAL_Z_FLOOR = 12;
const SETTLE_MS = 15000;

/** Rows: [t, stage, camTileZ, downloading, aglM]. Installed in-page so the
 *  sample cadence is not a Node round-trip (the reveal is a ~250 ms event). */
const INSTALL_TRACE = (tag) => {
  const S = (window.__r22Arr ??= {});
  const s = (S[tag] = { t0: performance.now(), rows: [] });
  const probe = () => {
    const rt = window.__fly;
    const f = rt?.flight;
    const eng = rt?.engine;
    let z = null;
    let agl = null;
    let dl = null;
    if (f && eng) {
      try {
        const g = eng.worldToGeo(f.pos);
        const lon = +g.x;
        const lat = +g.y;
        const ga = eng.getGroundAt(lon, lat);
        z = ga ? ga.tileZ : null;
        agl = Math.round(f.pos.y - f.groundElev);
        dl = eng.downloading ?? null;
      } catch {
        /* mid-warp the quadtree can be between roots — recorded as null */
      }
    }
    const el = document.querySelector('[data-testid="warp-hold"]');
    s.rows.push({
      t: +((performance.now() - s.t0) / 1000).toFixed(2),
      stage: el ? el.getAttribute('data-stage') : null,
      boot: window.__flyBoot?.pct ?? null,
      z,
      dl,
      agl,
      draws: window.__flyStats?.drawCalls ?? null,
    });
  };
  probe();
  s.tick = setInterval(probe, 100);
};
const READ_TRACE = (tag) => {
  const s = window.__r22Arr?.[tag];
  if (!s) return [];
  clearInterval(s.tick);
  return s.rows;
};

const PROBE = () => {
  const rt = window.__fly;
  const f = rt?.flight;
  const eng = rt?.engine;
  if (!f || !eng) return { err: 'no-runtime' };
  const g = eng.worldToGeo(f.pos);
  const lon = +g.x;
  const lat = +g.y;
  const ga = eng.getGroundAt(lon, lat);
  return {
    camTileZ: ga ? ga.tileZ : null,
    aglM: Math.round(f.pos.y - f.groundElev),
    downloading: eng.downloading ?? null,
    tier: window.__flyStore?.getState?.().qualityTier ?? null,
    arrivalStats: rt.arrivalStats ?? null, // B's instrument (optional)
    terraStats: rt.terraStats ?? null, // A's instrument (optional)
  };
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  const fails = [];
  const softs = [];
  const red = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const soft = (name, owner, detail = '') => {
    console.log(`SOFT ${name} — instrument missing (owner ${owner})${detail ? ' · ' + detail : ''}`);
    softs.push(name);
  };
  const newFlyPage = async (extra) => {
    const p = await context.newPage();
    await p.addInitScript(unpinPins, ['__flySettlePin', '__flyTerraPin']);
    if (extra) await p.addInitScript(extra);
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => {
      // The URL matters: an error with an off-origin location is upstream
      // (Esri tiles, live ADS-B), and the classifier below needs it to say so.
      if (m.type() === 'error')
        errs.push(`console: ${m.text().slice(0, 140)} @${m.location?.()?.url ?? ''}`);
    });
    return p;
  };

  /* ================= LEG C first: the BOOT reveal at P-DUBLIN ============ */
  // Done FIRST because it needs a virgin page: the trace must be armed before
  // the app mounts, and `fly-last-pos` makes the boot spawn AT the pose rather
  // than warp to it (BootScreen's gate is a different code path from
  // WarpFlash's, and the user reported both).
  const bootPage = await newFlyPage(() => {
    try {
      localStorage.setItem('fly-last-pos', JSON.stringify({ lat: 40.0992, lon: -83.1141 }));
    } catch {
      /* storage blocked — the leg reports the spawn it actually got */
    }
  });
  await bootPage.addInitScript(INSTALL_TRACE, 'boot');
  const { ms: bootMs } = await bootFly(bootPage, { style: 'satellite', settleMs: 0, ...BOOT_OPTS });
  await bootPage.waitForTimeout(SETTLE_MS);
  const bootRows = await bootPage.evaluate(READ_TRACE, 'boot');
  const bootRevealIdx = bootRows.findIndex((r) => r.boot === 100);
  const bootReveal = bootRevealIdx >= 0 ? bootRows[bootRevealIdx] : null;
  const bootSettled = bootRows[bootRows.length - 1];
  console.log(
    `BOOT at P-DUBLIN: ${(bootMs / 1000).toFixed(1)}s to pct100 · camTileZ at reveal ` +
      `${bootReveal?.z} → settled ${bootSettled?.z} (AGL ${bootSettled?.agl} m)`
  );
  await bootPage
    .locator('.fixed.inset-0 canvas')
    .first()
    .screenshot({ path: path.join(__dirname, 'r22-e-arrival-03-boot-settled.png') });
  gate(
    `(11) BOOT REVEAL — camTileZ at the boot reveal >= ${REVEAL_Z_FLOOR}`,
    (bootReveal?.z ?? 0) >= REVEAL_Z_FLOOR,
    `camTileZ ${bootReveal?.z} at reveal, settles to ${bootSettled?.z}`
  );
  red.push([
    'B1 boot reveals over an undescended pyramid',
    'verify-arrival (11)',
    `boot reveal camTileZ ${bootReveal?.z} → settles ${bootSettled?.z}`,
    `>= ${REVEAL_Z_FLOOR}`,
  ]);
  gate(
    '(12) boot time did not lengthen (<= 28.8 s, verify-aerial\'s satellite cap)',
    bootMs <= 28800,
    `${(bootMs / 1000).toFixed(1)}s (plan §4: BOOT.maxBootMs and boot-reveal timing may NOT lengthen)`
  );
  await bootPage.close();

  /* ================= LEG A: the far warp to P-DUBLIN ===================== */
  const page = await newFlyPage();
  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(800, 450);
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 19, 30);
  });
  const pinState = await page.evaluate(() => ({
    settle: window.__flySettlePin ?? null,
    terra: window.__flyTerraPin ?? null,
    attempted: window.__r22PinAttempt ?? null,
  }));
  console.log(`pins un-pinned: settle=${pinState.settle} terra=${pinState.terra} (fleet attempted ${JSON.stringify(pinState.attempted)})`);

  // Park at Owens first so the destination pyramid is genuinely cold.
  await page.evaluate(
    ([la, lo, al]) => window.__fly.warpToGeo(la, lo, { altM: al, name: null }),
    FAR_START
  );
  await page.waitForTimeout(12000);
  const before = await page.evaluate(PROBE);

  // THE WARP. `warpToGeo` with a >100 km delta sets warpKind 'far' in the
  // store, which is what WarpFlash keys its streak→hold→reveal machine on.
  await page.evaluate(INSTALL_TRACE, 'far');
  await page.evaluate(
    ([la, lo, al]) => window.__fly.warpToGeo(la, lo, { altM: al, name: 'Dublin OH' }),
    P_DUBLIN
  );
  await page.waitForTimeout(600);
  const kind = await page.evaluate(() => window.__flyStore.getState().warpKind);
  await page.waitForTimeout(1200);
  await page
    .locator('.fixed.inset-0 canvas')
    .first()
    .screenshot({ path: path.join(__dirname, 'r22-e-arrival-01-hold.png') });
  await page.waitForTimeout(SETTLE_MS + 6000);
  const farRows = await page.evaluate(READ_TRACE, 'far');
  await page
    .locator('.fixed.inset-0 canvas')
    .first()
    .screenshot({ path: path.join(__dirname, 'r22-e-arrival-02-settled.png') });

  const sawHold = farRows.some((r) => r.stage === 'hold' || r.stage === 'streak');
  // The reveal MOMENT: the first row whose stage is 'reveal' (WarpFlash keeps
  // the node mounted at opacity 0 for revealMs), or failing that the first row
  // with no overlay after one was seen.
  let revealIdx = farRows.findIndex((r) => r.stage === 'reveal');
  if (revealIdx < 0) {
    const lastHold = farRows.map((r) => r.stage).lastIndexOf('hold');
    revealIdx = lastHold >= 0 ? lastHold + 1 : -1;
  }
  const revealRow = revealIdx >= 0 ? farRows[revealIdx] : null;
  const revealMs = revealRow ? Math.round(revealRow.t * 1000) : null;
  const afterReveal = revealIdx >= 0 ? farRows.slice(revealIdx) : [];
  const settledZ = Math.max(...afterReveal.map((r) => r.z ?? 0), 0);
  const revealZ = revealRow?.z ?? 0;
  const minAfter = afterReveal.length ? Math.min(...afterReveal.map((r) => r.z ?? 0)) : 0;
  const armed = await page.evaluate(() => window.__fly?.arrivalStats ?? null);
  const holdCap = armed ? HOLD_MAX_GATED : HOLD_MAX_LEGACY;
  if (!armed) soft('ARRIVAL_GATE state (runtime.arrivalStats)', 'B', `assuming the legacy ${HOLD_MAX_LEGACY} ms cap`);

  console.log(
    `FAR WARP trace (${farRows.length} @100ms): stages ${JSON.stringify([...new Set(farRows.map((r) => r.stage))])} · ` +
      `reveal @${revealMs} ms · camTileZ before ${before.camTileZ} → AT REVEAL ${revealZ} → settled ${settledZ} · ` +
      `downloading at reveal ${revealRow?.dl}`
  );
  console.log(
    `  z timeline: ${farRows
      .filter((_, i) => i % 3 === 0)
      .map((r) => `${r.t}:${r.stage ?? '-'}/z${r.z}`)
      .join(' ')}`
  );

  gate(
    '(1) precondition: the far warp registered (warpKind far + hold overlay)',
    kind === 'far' && sawHold,
    `warpKind=${kind} sawHold=${sawHold}`
  );
  gate(
    `(2) the hold respects holdMin (>= ${HOLD_MIN_MS} ms)`,
    revealMs != null && revealMs >= HOLD_MIN_MS,
    `${revealMs} ms`
  );
  gate(
    `(3) the hold respects its cap (<= ${holdCap} + ${POLL_SLACK_MS} ms slack)${armed ? ' — ARRIVAL_GATE armed, §5.1 consumed' : ' — legacy'}`,
    revealMs != null && revealMs <= holdCap + POLL_SLACK_MS,
    `${revealMs} ms vs cap ${holdCap}`
  );
  /* THE REFERENCE IS THE DEPARTURE, NOT THE DESTINATION'S OWN LATER SELF.
   *
   * The first calibration run shipped this gate as `revealZ >= settledZ - 1`
   * and it PASSED on the pre-fix tree — reveal z10, settled z10, deficit 0 —
   * because the destination pyramid never descends at all after a far warp at
   * FL300 (the same stall verify-terra (7) measures: 40 s at z10 with
   * `downloading` flat at 0). A self-calibrating gate whose two numbers share
   * the defect is a coin, and the R20 close ruling demoted exactly that.
   *
   * The honest reference is the DEPARTURE POSE at the SAME ALTITUDE: same
   * engine, same tier, same LOD math, twelve seconds of settle. If the arrival
   * reveals two levels coarser than the ground the aeroplane just left, the
   * player sees a blur — and that inequality is red today (10 vs 12) while
   * being trivially satisfiable by any working descent. `settledZ` rides along
   * as evidence, and (4b) states the stall directly. */
  gate(
    '(4) CONTENT AT REVEAL — camTileZ at reveal >= the departure pose\'s settled camTileZ - 1',
    revealZ >= (before.camTileZ ?? 0) - 1,
    `reveal z${revealZ} vs departure z${before.camTileZ} at the same FL300 altitude (deficit ${(before.camTileZ ?? 0) - revealZ} levels) · destination settled to z${settledZ}`
  );
  red.push([
    'T8 reveal fires on downloading<3, not on content',
    'verify-arrival (4)',
    `reveal z${revealZ} vs departure z${before.camTileZ} (deficit ${(before.camTileZ ?? 0) - revealZ})`,
    'deficit <= 1',
  ]);
  gate(
    '(4b) the destination eventually reaches the departure\'s zoom (the descent is not stalled)',
    settledZ >= (before.camTileZ ?? 0),
    `settled z${settledZ} vs departure z${before.camTileZ} after ${((SETTLE_MS + 6000) / 1000).toFixed(0)} s · ` +
      `downloading stayed at ${revealRow?.dl} — a quadtree that is not downloading and not descending is STALLED, not slow`
  );
  red.push([
    'T5b far-warp descent stalls at FL300',
    'verify-arrival (4b)',
    `settled z${settledZ} vs departure z${before.camTileZ}`,
    'settled >= departure',
  ]);
  gate(
    `(5) camTileZ at reveal clears the FL300 floor (>= ${REVEAL_Z_FLOOR})`,
    revealZ >= REVEAL_Z_FLOOR,
    `z${revealZ} at ${revealRow?.agl} m AGL`
  );
  // "Content-driven" means the reveal did NOT land on the time cap. A reveal
  // that fires at holdMax every single time is a timer wearing a gate's name.
  const timeCapped = revealMs != null && revealMs >= holdCap - 400;
  gate(
    '(6) the reveal was CONTENT-driven, not time-capped',
    !timeCapped || revealZ >= settledZ - 1,
    timeCapped
      ? `reveal landed on the ${holdCap} ms cap with z${revealZ}/${settledZ} — the content gate did not resolve`
      : `reveal at ${revealMs} ms, ${holdCap - revealMs} ms before the cap`
  );
  gate(
    '(7) no reveal-then-blur — camTileZ never drops below its reveal value afterwards',
    minAfter >= revealZ,
    `min camTileZ after reveal ${minAfter} vs reveal ${revealZ}`
  );
  gate(
    '(8) the legacy criterion is recorded — `downloading` at reveal',
    revealRow != null,
    `downloading=${revealRow?.dl} at reveal (WarpFlash reveals at < 3; a quadtree that has not STARTED descending also reads 0 — that is the defect, restated)`
  );

  /* -------------------- (13) SAT_QUILT at the arrival pose --------------- */
  const quilt = await page.evaluate(() => {
    try {
      return { ...window.__flyAerial.quilt(), aerial: window.__flyAerial.get() };
    } catch (e) {
      return { err: String(e).slice(0, 80) };
    }
  });
  console.log(`SAT_QUILT at the FL300 arrival pose: ${JSON.stringify(quilt)}`);
  gate(
    '(13) SAT_QUILT strength at the arrival pose is recorded (checkpoint #6 evidence)',
    !quilt.err,
    `desat ${quilt.desat} flatten ${quilt.flatten} — the fleet pin holds __flyAerialOverride at 0, so this is the SHIP-STATE uniform, not the pinned frame. The pixel A/B belongs to verify-aerial, which owns that un-pin.`
  );

  /* ================= LEG B: the local warp ============================== */
  await page.evaluate(INSTALL_TRACE, 'local');
  const localOut = await page.evaluate(() => {
    const fly = window.__fly;
    const t = fly.traffic.getNearest(6, fly.flight.pos).find((i) => i.fix1);
    if (t) {
      window.__flyStore.getState().setInspectHex(t.hex);
      return { hex: t.hex, distM: Math.round(t.distM ?? -1) };
    }
    return null;
  });
  let local = { kind: null, holdMs: null, skipped: true };
  if (localOut) {
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelector('[data-testid="inspect-warp"]')?.click());
    await page.waitForTimeout(4000);
    const rows = await page.evaluate(READ_TRACE, 'local');
    const holdRows = rows.filter((r) => r.stage === 'hold' || r.stage === 'streak');
    local = {
      kind: await page.evaluate(() => window.__flyStore.getState().warpKind),
      holdMs: holdRows.length ? Math.round((holdRows[holdRows.length - 1].t - holdRows[0].t) * 1000) : 0,
      zBefore: rows[0]?.z ?? null,
      zAfter: rows[rows.length - 1]?.z ?? null,
      skipped: false,
    };
  } else {
    await page.evaluate(READ_TRACE, 'local');
    soft('local-warp leg', 'live traffic', 'no positioned aircraft within reach of the arrival pose');
  }
  console.log(`LOCAL WARP: ${JSON.stringify(local)} target ${JSON.stringify(localOut)}`);
  if (!local.skipped) {
    gate(
      '(9) local warp — kind local, and any hold stays inside ARRIVAL_GATE.localHold.maxMs (1500)',
      local.kind === 'local' && local.holdMs <= 1500,
      `kind=${local.kind} hold=${local.holdMs} ms`
    );
    gate(
      '(10) local warp tileZ deficit recorded (the localHoldDeficit input)',
      true,
      `camTileZ ${local.zBefore} → ${local.zAfter} (deficit ${(local.zAfter ?? 0) - (local.zBefore ?? 0)} levels; ARRIVAL_GATE holds only when the deficit exceeds 2)`
    );
  }

  gate(
    `(14) the hold overlay never outlives its cap by more than one poll (${POLL_SLACK_MS} ms)`,
    revealMs == null || revealMs <= holdCap + POLL_SLACK_MS,
    `${revealMs} ms vs ${holdCap} + ${POLL_SLACK_MS}`
  );
  // Upstream tile-network noise is classified, not gated — see verify-terra
  // gate (17) for the full reasoning and the W1 evidence.
  const netErrs = errs.filter(
    (e) =>
      /arcgisonline|arcgis\.com|ERR_FAILED|Access to fetch/i.test(e) ||
      (/@https?:\/\//.test(e) && !e.includes(DEV_ORIGIN))
  );
  const appErrs = errs.filter((e) => !netErrs.includes(e));
  gate(
    '(15) zero APP page/console errors (upstream Esri tile errors classified separately)',
    appErrs.length === 0,
    `app=${appErrs.length} net=${netErrs.length} · ${appErrs.slice(0, 3).join(' | ')}`
  );

  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  fs.writeFileSync(
    path.join(__dirname, 'r22-e-red-arrival.json'),
    JSON.stringify(
      {
        when: new Date().toISOString(),
        bootMs,
        bootRows,
        bootReveal,
        bootSettled,
        before,
        farRows,
        revealMs,
        revealZ,
        settledZ,
        minAfter,
        armed,
        quilt,
        local,
        localOut,
        red,
        fails,
        softs,
      },
      null,
      1
    )
  );
  if (softs.length) console.log(`SOFT (instruments missing): ${softs.join(', ')}`);
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
