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
// W3: default is the SHIP STATE — see verify-terra's TERRA_MODE comment.
/* W3, THIRD CORRECTION — AND THE DEFAULT IS `on`.
 * The W1/W2 default forced TERRA OFF (always re-measure the red). The first W3
 * fix changed it to "ship state = no override, the constants decide" — which
 * was ALSO wrong, and wrong in a way that reads like a product failure:
 * `scripts/_boot.js` pins `__flyTerraPin = 1` fleet-wide, and
 * `terraSharpOn()` is `enabled && !terraPinned()`. With no override the pin
 * wins, so a "ship state" run measured the FLEET-PINNED legacy world and
 * reported every TERRA feature as inert on a tree where all three are ON.
 * The pin exists so LEGACY harnesses keep measuring the R21 world; the five
 * R22 gates are the ones that un-pin. So this gate arms by default.
 *   (bare)         -> ARMED (certifies what ships)
 *   R22_TERRA=off  -> forced CONTROL (re-measure the frozen red)
 *   R22_TERRA=ship -> no override at all (diagnostic: shows the pin's effect)
 * Gate (0) below asserts the arm actually took, so this class of error cannot
 * pass silently again. */
const TERRA_MODE = process.env.R22_TERRA ?? 'on';
const TERRA_ARMED = TERRA_MODE === 'on';
const TERRA_FORCED = TERRA_MODE !== 'ship';
const LOCAL_DEFICIT = 2; // ARRIVAL_GATE.localHold.localHoldDeficit
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
    let leaf = null;
    let agl = null;
    let dl = null;
    let sharpReason = null;
    if (f && eng) {
      try {
        const g = eng.worldToGeo(f.pos);
        const lon = +g.x;
        const lat = +g.y;
        const ga = eng.getGroundAt(lon, lat);
        z = ga ? ga.tileZ : null;
        agl = Math.round(f.pos.y - f.groundElev);
        dl = eng.downloading ?? null;
        // W2 RE-BASE: the deepest resident leaf ANYWHERE (A TERRA's
        // instrument, scripts/r22-a-measure.js). `z` above is the leaf under
        // the AIRCRAFT and is frustum-capped at cruise BY DESIGN — see the
        // header. `leaf` is the reference every FL300 assertion now uses.
        leaf = 0;
        eng.object.traverse((o) => {
          if (o.isTile && o.children.length <= 1 && o.z > leaf) leaf = o.z;
        });
        const ts = rt.terraStats ?? rt.engine?.terraStats ?? null;
        sharpReason = ts ? (ts.sharp ? ts.sharpReason ?? 'true' : null) : undefined;
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
      leaf,
      sharpReason,
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
  let maxLeafZ = 0;
  try {
    eng.object.traverse((o) => {
      if (o.isTile && o.children.length <= 1 && o.z > maxLeafZ) maxLeafZ = o.z;
    });
  } catch {
    maxLeafZ = null;
  }
  return {
    camTileZ: ga ? ga.tileZ : null,
    maxLeafZ,
    aglM: Math.round(f.pos.y - f.groundElev),
    downloading: eng.downloading ?? null,
    tier: window.__flyStore?.getState?.().qualityTier ?? null,
    arrivalStats: rt.arrivalStats ?? null, // B's instrument (optional)
    // Fable's arbitration commit 6095e9c: FlyScene calls engine.attachRuntime,
    // so this is the canonical read for A's contract.
    terraStats: rt.terraStats ?? rt.engine?.terraStats ?? null,
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
    // SETTLE stays on the shared fleet-pin accessor (B's family has no
    // per-family override). TERRA is armed through A's own
    // `__flyTerraForce` — the fleet pin is never touched here (W2).
    /* `__flyTerraPin` IS UN-PINNED HERE (W3 correction, B's proof).
     * The local-hold decision reads a tileZ DEFICIT out of `terraStats`, and
     * terraStats is published only when TERRA is armed. Under the fleet pin the
     * deficit is `null`, the hold correctly takes the legacy no-signal path, and
     * my (9b) red was measuring the PIN rather than the feature: B measured
     * pinned = 0 ms hold, un-pinned = deficit 6 with a 1322 ms hold, capped
     * false. An instrument that cannot observe a state reads it as zero. */
    await p.addInitScript(unpinPins, ['__flySettlePin', '__flyTerraPin']);
    await p.addInitScript(([forced, on]) => {
      if (!forced) return; // ship state — the constants and the fleet pin decide
      window.__flyTerraForce = { sharp: on, pipe: on, cache: on };
    }, [TERRA_FORCED, TERRA_ARMED]);
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
    `boot reveal cam ${bootReveal?.z} / leaf ${bootReveal?.leaf} -> settles cam ${bootSettled?.z} / leaf ${bootSettled?.leaf}`,
    `>= ${REVEAL_Z_FLOOR}`,
  ]);
  // B SETTLE ships ARRIVAL_GATE.bootTerms:false — the boot content terms cost
  // +2.6 s against a boot envelope plan section 4 FREEZES, so B deliberately
  // did NOT consume a boot hold. This leg therefore expects the boot reveal to
  // be UNCHANGED in both arms, and its number is a RECORD for R23 rather than
  // a defect R22 closes. Stated here so a later reader does not mistake a
  // deliberate non-fix for a missed one.
  console.log(
    'INFO (11)/(12): the BOOT reveal is out of scope BY DECISION — ARRIVAL_GATE.bootTerms ships false ' +
      '(B measured +2.6 s against the frozen boot envelope). These numbers should be identical armed and unarmed.'
  );
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
  console.log(
    `SETTLE un-pinned: ${pinState.settle} (fleet attempted ${JSON.stringify(pinState.attempted)}) · ` +
      `TERRA ${TERRA_FORCED ? (TERRA_ARMED ? 'FORCED ARMED' : 'FORCED CONTROL') : 'SHIP STATE'} via __flyTerraForce, fleet pin untouched at ${pinState.terra}`
  );

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
  /* W2 RE-BASE — every FL300 zoom assertion below reads `leaf` (maxLeafZ), not
   * `z` (camTileZ). A TERRA measured, and Fable ratified, that the tile under
   * the aircraft at cruise is outside the view frustum and three-tile refuses
   * to subdivide it: camTileZ saturates near z10 with the loader idle, BY
   * DESIGN, and nothing in this round can move it. My W1 reds ("reveal z10 vs
   * departure z12", "settled z10") measured that saturation at BOTH ends —
   * they are retired in close-sweep 1 (struck through, never erased) and
   * replaced by the numbers this run prints. camTileZ is still recorded, and
   * still gated at LOW AGL where it is a valid statistic. */
  const settledZ = Math.max(...afterReveal.map((r) => r.leaf ?? 0), 0);
  const revealZ = revealRow?.leaf ?? 0;
  const revealCamZ = revealRow?.z ?? 0;
  const minAfter = afterReveal.length ? Math.min(...afterReveal.map((r) => r.leaf ?? 0)) : 0;
  const departZ = before.maxLeafZ ?? 0;
  /* B SETTLE's real contract (r22/b): runtime.arrivalStats = {gateArmed, kind,
   * epoch, holdStartAt, revealAt, holdCapMs, holdMs, reason, terms}, published
   * armed in-flight AND again at reveal, with legacy:true when terraStats is
   * absent. The cap is READ from it rather than inferred — an inferred cap
   * would call a correctly-armed 6500 ms hold a failure. */
  const armed = await page.evaluate(() => window.__fly?.arrivalStats ?? null);
  const gateArmed = armed?.gateArmed === true;
  const holdCap = armed?.holdCapMs ?? (gateArmed ? HOLD_MAX_GATED : HOLD_MAX_LEGACY);
  if (!armed)
    soft('ARRIVAL_GATE state (runtime.arrivalStats)', 'B', `assuming the legacy ${HOLD_MAX_LEGACY} ms cap`);
  else
    console.log(
      `ARRIVAL_GATE: armed=${gateArmed} kind=${armed.kind} cap=${armed.holdCapMs} hold=${armed.holdMs} ` +
        `reason=${armed.reason} legacy=${armed.legacy ?? false} terms=${JSON.stringify(armed.terms)}`
    );

  console.log(
    `FAR WARP trace (${farRows.length} @100ms): stages ${JSON.stringify([...new Set(farRows.map((r) => r.stage))])} · ` +
      `reveal @${revealMs} ms · maxLeafZ departure ${departZ} → AT REVEAL ${revealZ} → settled ${settledZ} · ` +
      `camTileZ at reveal ${revealCamZ} (frustum-capped at cruise, informational) · downloading ${revealRow?.dl} · ` +
      `sharpReason ${revealRow?.sharpReason ?? 'n/a'}`
  );
  console.log(
    `  leaf/cam timeline: ${farRows
      .filter((_, i) => i % 3 === 0)
      .map((r) => `${r.t}:${r.stage ?? '-'}/L${r.leaf}c${r.z}`)
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
    '(4) CONTENT AT REVEAL — maxLeafZ at reveal >= the departure pose settled maxLeafZ - 1',
    revealZ >= departZ - 1,
    `reveal leaf z${revealZ} vs departure leaf z${departZ} at the same FL300 altitude (deficit ${departZ - revealZ} levels) · destination settles to leaf z${settledZ}`
  );
  /* NOT RED-CALIBRATED AFTER THE RE-BASE, and that is the finding.
   * On `maxLeafZ` the FL300 reveal measures z12 against a departure of z13 —
   * a deficit of ONE, inside the bound — and the destination settles to 13.
   * So the "blurry arrival" deficit my W1 run reported (reveal z10 vs
   * departure z12) was ENTIRELY the camTileZ frustum cap at both ends, and on
   * the honest instrument there is no FL300 content-at-reveal defect to close.
   * The gate STAYS — it is the right invariant and it is cheap, and it is what
   * would catch a future reveal that fires two levels early — but the round
   * record must not claim R22 closed a defect here. Where the content-at-
   * reveal defect IS real is LOW AGL, where camTileZ is a valid statistic and
   * the local-warp path has no hold at all: see gate (9b). */
  red.push([
    'T8 reveal fires on downloading<3, not on content (RE-BASED W2 -> NOT RED, see the gate)',
    'verify-arrival (4)',
    `reveal leaf z${revealZ} vs departure leaf z${departZ} (deficit ${departZ - revealZ}) — INSIDE the bound`,
    'deficit <= 1',
  ]);
  gate(
    '(4b) the destination eventually reaches the departure\'s zoom (the descent is not stalled)',
    /* ±1 TOLERANCE, and it is measured, not granted. `maxLeafZ` at FL300 is a
     * 12-13 quantity in BOTH arms: A read 13 control / 12 armed
     * (r22-a-dublin-prof-*.json); I read 12 (W2 control), 13 (W2 armed), 12
     * (W3). Asserting exact equality on a quantity with a ±1 spread is a coin
     * that flips per run — the thing this sweep has retired five times. What
     * the gate still catches is a real STALL: the W1 red was a THREE-level gap
     * (settled 10 vs departure 13) with the loader idle. */
    settledZ >= departZ - 1,
    `settled leaf z${settledZ} vs departure leaf z${departZ} (±1 tolerance: a 12-13 quantity in both arms) after ${((SETTLE_MS + 6000) / 1000).toFixed(0)} s · ` +
      `downloading at reveal ${revealRow?.dl}. NOTE camTileZ is NOT the statistic here: at FL300 it is capped by ` +
      `three-tile own out-of-frustum LOD rule, so "camTileZ stalled" is the library being correct, not the pipeline being slow.`
  );
  red.push([
    'T5b far-warp descent stalls at FL300 (RE-BASED W2 -> NOT RED: the stall was the frustum rule)',
    'verify-arrival (4b)',
    `settled leaf z${settledZ} vs departure leaf z${departZ}`,
    'settled >= departure',
  ]);
  gate(
    `(5) maxLeafZ at reveal clears the FL300 floor (>= ${REVEAL_Z_FLOOR})`,
    revealZ >= REVEAL_Z_FLOOR,
    `leaf z${revealZ} (camTileZ ${revealCamZ}, frustum-capped) at ${revealRow?.agl} m AGL`
  );
  // "Content-driven" means the reveal did NOT land on the time cap. A reveal
  // that fires at holdMax every single time is a timer wearing a gate's name.
  const timeCapped = revealMs != null && revealMs >= holdCap - 400;
  /* sharpReason 'stalled' IS A LEGITIMATE REVEAL REASON AT CRUISE (Fable's
   * ratification of A's sharp = settled && (atTarget || stalled)). At FL300
   * the atTarget term is false forever — targetZ is a pure function of AGL and
   * does not know about the frustum rule — so a gate demanding 'target' would
   * force every cruise arrival onto the time cap and then report the time cap
   * as the defect. 'stalled' asserts the honest thing: the resident zoom
   * stopped improving AND the loader went quiet. */
  const revealReason = revealRow?.sharpReason ?? null;
  const stalledOk = revealReason === 'stalled' || revealReason === 'target';
  gate(
    '(6) the reveal was CONTENT-driven, not time-capped',
    !timeCapped || revealZ >= settledZ - 1 || stalledOk,
    timeCapped
      ? `reveal landed on the ${holdCap} ms cap with leaf z${revealZ}/${settledZ} and sharpReason=${revealReason ?? 'n/a'} ` +
        `(a 'stalled' or 'target' reason would make this a content reveal)`
      : `reveal at ${revealMs} ms, ${holdCap - revealMs} ms before the cap · sharpReason=${revealReason ?? 'n/a'}`
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
  let local = { kind: null, holdMs: null, skipped: true, reason: null, terraSeen: null };
  if (localOut) {
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelector('[data-testid="inspect-warp"]')?.click());
    await page.waitForTimeout(4000);
    const rows = await page.evaluate(READ_TRACE, 'local');
    // B's local hold now renders `data-stage="hold"` — before this it was
    // invisible to the trace, so a hold could not have been SEEN even when it
    // happened. The 250 ms local-flash contract is untouched (verify-warp-arrival
    // still passes); this only makes the hold observable.
    const holdRows = rows.filter((r) => r.stage === 'hold' || r.stage === 'streak');
    const st = await page.evaluate(() => window.__fly?.arrivalStats ?? null);
    local = {
      kind: await page.evaluate(() => window.__flyStore.getState().warpKind),
      holdMs: holdRows.length ? Math.round((holdRows[holdRows.length - 1].t - holdRows[0].t) * 1000) : 0,
      zBefore: rows[0]?.z ?? null,
      zAfter: rows[rows.length - 1]?.z ?? null,
      // B's self-describing contract: 'no-deficit-signal' | 'flash' | 'content'.
      reason: st?.reason ?? st?.note?.reason ?? null,
      terraSeen: st?.terraSeen ?? st?.note?.terraSeen ?? null,
      statHoldMs: st?.holdMs ?? null,
      capped: st?.capped ?? null,
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
      `camTileZ ${local.zBefore} → ${local.zAfter} (deficit ${(local.zAfter ?? 0) - (local.zBefore ?? 0)} levels; ARRIVAL_GATE holds only when the deficit exceeds ${LOCAL_DEFICIT})`
    );
    /* ── WHERE THE CONTENT-AT-REVEAL DEFECT ACTUALLY LIVES (W2) ────────────
     * The FL300 legs above stopped being red once camTileZ was replaced by
     * maxLeafZ: at cruise the reveal really does show content within one level
     * of the settled state. The LOCAL warp is a different story, and here
     * camTileZ is a VALID statistic because the destination is low and the
     * ground under the camera is in frustum:
     *
     *   measured, control tree: camTileZ 10 -> 17, a SEVEN-level deficit,
     *   with a 900 ms flash and NO readiness poll of any kind.
     *
     * That is the user's "post-warp terrain stays blurry" at the altitude
     * where it is visible, and `ARRIVAL_GATE.localHold` exists precisely for
     * it (a bounded hold, <= 1500 ms, only when the deficit exceeds
     * localHoldDeficit). This gate is red today and greenable by that feature,
     * which is what the FL300 gates are not. */
    const deficit = (local.zAfter ?? 0) - (local.zBefore ?? 0);
    /* THE ASSERTION IS ON `reason`, NOT ON THE RAW DEFICIT (W3, B's contract).
     * Three states are legitimate and only one is a defect:
     *   'content'            a real deficit was seen and a bounded hold ran
     *   'flash'              the deficit was small — the 250 ms flash is right
     *   'no-deficit-signal'  terraStats absent, so no deficit could be COMPUTED
     * The third is the one my W1/W3 reds were actually measuring, and with
     * `__flyTerraPin` un-pinned it must not occur: a signal-absent reveal on an
     * armed tree means the gate is measuring its own pin again. */
    const okReason =
      local.reason === 'content'
        ? local.holdMs > 0 && local.holdMs <= 1500
        : local.reason === 'flash'
          ? deficit <= LOCAL_DEFICIT
          : false;
    gate(
      `(9b) LOCAL WARP CONTENT — the reveal reason is self-describing and correct for the deficit`,
      okReason,
      `reason=${local.reason} terraSeen=${local.terraSeen} · deficit ${deficit} levels (camTileZ ${local.zBefore} → ${local.zAfter}) · ` +
        `hold ${local.holdMs} ms (arrivalStats says ${local.statHoldMs}, capped=${local.capped}) · ` +
        `'no-deficit-signal' on an ARMED tree means the harness is measuring a pin, not the feature`
    );
    red.push([
      'T9 a local warp reveals a 7-level deficit with no readiness poll',
      'verify-arrival (9b)',
      `deficit ${deficit} levels, hold ${local.holdMs} ms`,
      `<= ${LOCAL_DEFICIT} levels, or a hold <= 1500 ms`,
    ]);
  }

  gate(
    `(14) the hold overlay never outlives its cap by more than one poll (${POLL_SLACK_MS} ms)`,
    revealMs == null || revealMs <= holdCap + POLL_SLACK_MS,
    `${revealMs} ms vs ${holdCap} + ${POLL_SLACK_MS}`
  );
  // Upstream tile-network noise is classified, not gated — see verify-terra
  // gate (17) for the full reasoning and the W1 evidence.
  /* Two classes of noise, both upstream, neither an app defect:
   *  · off-origin (Esri tiles) — see verify-terra gate (17).
   *  · SAME-ORIGIN /api/aircraft/... 404s. Those are the app's own proxy
   *    answering honestly that adsb.lol/adsbdb has no route or registry row
   *    for a live aircraft this run happened to pick. The W2 run failed on
   *    exactly one of these (`/api/aircraft/a804a7/route`) — a gate red caused
   *    by which aeroplane was overhead, which is a coin, not a regression. */
  const netErrs = errs.filter(
    (e) =>
      /arcgisonline|arcgis\.com|ERR_FAILED|Access to fetch/i.test(e) ||
      /\/api\/aircraft\/[^ ]*(route|info|photo)/i.test(e) ||
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
