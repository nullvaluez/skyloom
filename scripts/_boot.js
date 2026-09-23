/**
 * R9-3 shared boot helper. The fly-only app (Round 9) boots itself — there
 * is no header and no Fly Mode entry button anymore — so every harness
 * boots through this instead of the old goto → header wait → button click
 * → fixed 22s stream-in sleep. Readiness is the REAL contract published by
 * BootScreen: window.__flyBoot.pct === 100 exactly when the world reveals
 * (ring-0 toy chunks finalized / satellite tiles drained, fleet GLBs
 * resolved, shaders warmed). This also retires the round-8 hydration-click
 * retry loop wholesale — with no button to click, a pre-hydration click can
 * no longer be swallowed.
 *
 * localStorage is seeded BEFORE the app mounts (PauseMenu reads
 * fly-controls-seen + fly-map-style-2 on mount) via addInitScript; if the
 * page had somehow already navigated (init scripts only apply from the next
 * navigation), the keys are written post-load and the page reloaded once.
 *
 * Usage:
 *   const { bootFly } = require('./_boot');
 *   await bootFly(page);                        // Neon (toy) — SEEDS 'toy' (app default is now satellite, round 10)
 *   await bootFly(page, { style: 'satellite' }); // Day
 *   await bootFly(page, { style: 'night' });     // raw seed (legacy-migration tests)
 *   await bootFly(page, { skipMenus: false });   // R25: pins + fixture, no airborne skip
 *
 * Returns { ms } — goto → pct 100 wall time.
 */

// Round 19 (SANCTIONED harness edit): the target defaults to :3000 exactly as
// before, but FLY_URL overrides it fleet-wide — the R19 field study found
// :3000/3001 occupied by an UNRELATED app on this machine and the user's live
// dev server on :3002. Harness runs must never assume :3000 and must NEVER
// point at the user's live server: run your own dev server from your own
// worktree (its own .next) on a free port and pass FLY_URL.
const BOOT_URL = process.env.FLY_URL || 'http://localhost:3000';

// Round 24 (E CERT, SANCTIONED harness edit — the ONE env-guarded branch this
// file gains). With FLY_TILE_FIXTURE set, every gate boots against the OFFLINE
// WORLD FIXTURE (scripts/r24-fixture/) instead of Esri + OpenFreeMap + adsb,
// which this container 403-blocks (recon HARN-ENV-2, measured). With the env
// UNSET this file behaves byte-identically to R21 — the require is lazy and
// nothing below runs.
const { attachFixture, fixtureEnabled, fixturePin } = require('./_fixture');
// Round 25 (E CERT): the airborne skip below lives in ONE place now, shared
// with the direct-goto harnesses (graphics-flight / graphics-capture).
const { enterFlight } = require('./_skip-menus');

/**
 * Round 25 (E CERT, SANCTIONED harness edit) — THE SATELLITE TERRA UN-PIN.
 *
 * MEASURED RED on r25-w0 (scripts/r25-e-cert.md §1, probe
 * scripts/r25-e-sat-probe.cjs): a pinned satellite bootFly NEVER REVEALS.
 * Since the Living Earth commit (7b83514) the satellite reveal is the content
 * contract lib/fly/world-readiness.js, whose `terrain` part is
 * `runtime.terraStats?.sharp === true && ...`. `terraStats` is published by
 * TerrainEngine._tick ONLY when terraSharpOn() || terraPipeOn(), and the R22
 * fleet pin `__flyTerraPin = 1` forces both false — so under the pin
 * `terraStats` is never written, `terrain` is false forever, and `__flyBoot`
 * sits at pct 93 ("world") until bootFly's timeout. Probe: 168 s pinned,
 * `terra=null`, missing [terrain, buildings, roads]; un-pinned the same boot
 * publishes terraStats and descends (camTileZ 3 -> 14 by 334 s).
 *
 * So a SATELLITE boot leaves `__flyTerraPin` unset (both legs), and the
 * satellite fleet measures the SHIPPED terrain (TERRA_SHARP/PIPE/CACHE and
 * TILE_HOLD as they ship ON) — which is also what the R24 D scaffold note
 * said the pin had been hiding. No frozen satellite number can move by this:
 * on r25-w0 no pinned satellite gate could boot at all. TOY boots keep the
 * pin exactly as before (the toy reveal reads toyStats, never terraStats).
 * FLY_TERRA_PIN_SAT=1 restores the pin for a satellite boot (it will not
 * reveal on this tree; that is the RED, kept reproducible).
 */
function terraPinFor(style) {
  if (style !== 'satellite') return 1;
  return process.env.FLY_TERRA_PIN_SAT === '1' ? 1 : undefined;
}

async function bootFly(
  page,
  { style = null, url = BOOT_URL, timeoutMs = 180000, settleMs = 2500, skipMenus = true } = {}
) {
  // Round 24 (E CERT): the fixture, when asked for. attachFixture installs the
  // Playwright routes for OpenFreeMap / Esri imagery / /api/aircraft /
  // /api/weather; the init script below hands the app the DEM source
  // (lib/fly/tile-sources.js reads window.__flyTileFixture, weather-model
  // idiom). Both are no-ops without the env var.
  if (fixtureEnabled()) {
    const fx = await attachFixture(page);
    await page.addInitScript((pin) => {
      window.__flyTileFixture = pin;
    }, fixturePin(fx.url, Number(process.env.FLY_FIXTURE_DEM_MAXZOOM || 15)));
    // Round 24 (E CERT), inside the SAME env-guarded branch: the finalize
    // budget scaler (lib/fly/harness-budget.js). Opt-in per RUN, never
    // fleet-wide — MEASURED here, a Powell satellite building chunk needs ~400
    // full-quadtree raycasts and the 1.0 ms/frame drape budget cannot get
    // through them at 1-3 fps, so after six minutes `ready` was still 0 with
    // the terrain fully settled. A content gate exports FLY_FINALIZE_BUDGET_K;
    // a PACING gate must not, and none of E's do.
    //
    // Round 25 (E CERT, same branch): a SATELLITE fixture boot defaults the
    // scaler to 40 when the run did not choose. Since Living Earth the
    // satellite reveal WAITS for the 1 km building + road rings to land
    // (lib/fly/world-readiness.js), so without it a satellite fixture boot
    // cannot reveal at all — MEASURED on r25-w0: all 16 building chunks
    // still `draping` after 334 s. That makes it a precondition of the
    // reveal, not a pacing choice. A pacing gate that boots satellite opts
    // OUT explicitly with FLY_FINALIZE_BUDGET_K=1 (and then must tolerate a
    // boot that does not reveal here). Toy boots are unchanged.
    const kEnv = process.env.FLY_FINALIZE_BUDGET_K;
    const k = Number(kEnv != null && kEnv !== '' ? kEnv : style === 'satellite' ? 40 : 0);
    if (k > 1)
      await page.addInitScript((v) => {
        window.__flyFinalizeBudgetK = v;
      }, k);
  }
  const terraPin = terraPinFor(style);
  await page.addInitScript(({ s, terraPin }) => {
    // Round 16 (SANCTIONED harness edit): pin the LIVE WEATHER off for the
    // whole browser fleet. Every satellite harness now flies under a real sky
    // fetched from open-meteo/METAR — an overcast Tuesday would grey the rim,
    // thicken the fog and add a precipitation draw under gates calibrated on a
    // clear one. 'baseline' is weather-model's exactly-neutral state (every
    // multiplier the IEEE identity), so a pinned harness sees precisely the
    // R15 sky. Set OUTSIDE the try below: localStorage can throw, and this
    // determinism pin must land even then. verify-weather is the ONE harness
    // that overrides it (per-state, deliberately).
    window.__flyWeatherOverride = 'baseline';
    // Round 18 (SANCTIONED harness edit, the round-16 weather-pin idiom):
    // unlimited boost for the whole browser fleet. R18's BOOST_METER empties
    // after 6 s of boost and coerces the plane back to cruise — under gates
    // calibrated on unlimited 750 m/s runs (verify-edge-fx holds boost for
    // 40 s across 3 rebases). With the pin the meter never drains — the
    // pre-R18 speed envelope exactly. verify-crash is the ONE harness that
    // clears it (per-state, deliberately) to certify the meter itself.
    window.__flyBoostInfinite = true;
    // Round 19 (SANCTIONED harness edit, the same idiom): pin the two new
    // ship-state satellite visuals NEUTRAL for the whole browser fleet —
    // depth-based aerial perspective and satellite content shadows would
    // otherwise shift every frozen satellite pixel gate (sat-depth's
    // hillshade crops, roof-variety's luminance band, sat-night). 0 is the
    // exact pre-R19 frame. verify-aerial is the ONE harness that un-pins
    // them (per-gate, deliberately).
    window.__flyAerialOverride = 0;
    window.__flySatShadowOverride = 0;
    // Round 21 (SANCTIONED harness edit, the same idiom): pin the perf
    // governor to 'hold' for the whole browser fleet. R21's governor steps
    // DPR/quality-tier from LIVE frame timing — on a busy CI GPU that would
    // make every frozen pixel/draw gate nondeterministic (a mid-run tier step
    // rebuilds the composer and re-streams satellite water). 'hold' freezes
    // the boot DPR + tier exactly as the R20 fleet saw them. Inert while
    // PERF_GOVERNOR.enabled is false (the legacy PerformanceMonitor ignores
    // it — status quo). The R21 stability gates (verify-stability /
    // verify-tier-step / both soaks) are the ONLY harnesses that un-pin it
    // (per-gate, deliberately).
    window.__flyGovPin = 'hold';
    // Round 22 (SANCTIONED harness edit, the same idiom): pin the four R22
    // feature families to LEGACY behavior fleet-wide so every frozen gate
    // keeps measuring the R21 world. 1 = legacy: TERRA (altitude LOD curve /
    // z18 / vendored pipeline patches read the R21 values), SETTLE (birth
    // fades + content-aware reveals + ladder fix disabled), CLUTTER (clock
    // frozen at 0 AND pools empty), DEPTH (catcher/N8AO/nearReceive off).
    // Inert while the R22 blocks are enabled:false (W0 state). ONLY the new
    // R22 gates (verify-terra / verify-arrival / verify-settle /
    // verify-clutter / verify-depth2) un-pin, per-gate, deliberately.
    // Round 25 (E): satellite leaves the TERRA pin unset — see terraPinFor.
    if (terraPin === 1) window.__flyTerraPin = 1;
    window.__flySettlePin = 1;
    window.__flyClutterPin = 1;
    window.__flyDepthPin = 1;
    // Round 25 (SANCTIONED harness edit, the same idiom): the legacy fleet
    // skips the new title screen (boots into today's mandatory hangar, which
    // the airborne skip below closes) and runs the CLASSIC visuals profile —
    // exactly the flag-off tree, so no frozen pixel/draw number can move
    // under an R25 Enhanced default. Only the R25 gates un-pin these
    // (unpinPins(['__flyTitleBypass']) / (['__flyVisualsOverride'])).
    window.__flyTitleBypass = true;
    window.__flyVisualsOverride = 'classic';
    try {
      localStorage.setItem('fly-controls-seen', '1');
      // Round 10: the APP default is now satellite (PauseMenu defaults an
      // unsaved player to 'satellite'). Harnesses want the Neon world unless
      // they ask otherwise, so a no-style boot SEEDS 'toy' explicitly — this
      // also matches the store literal default, so the scene mounts toy with
      // no mid-boot hot-swap (which would let the boot gate reveal early).
      localStorage.setItem('fly-map-style-2', s || 'toy');
      window.__flyBootSeeded = true;
    } catch {
      /* storage blocked — the app boots on defaults */
    }
  }, { s: style, terraPin });

  // Round 24 (E CERT), SANCTIONED and still inside the fixture guard: the two
  // FIXED 30 s post-reveal waits below are a GPU-machine assumption. Under the
  // build container's SwiftShader renderer and five agents sharing four cores,
  // `__flyBoot.pct` reaches 100 and then the canvas selector or the
  // boot-screen unmount takes longer than 30 s — measured, and it threw a
  // TimeoutError from this file for two agents on the same afternoon. Scaling
  // them is not a weaker contract: the contract is `pct === 100`, which has
  // already passed by then. FLY_BOOT_SCALE defaults to 1, and outside the
  // fixture branch it is FORCED to 1, so every non-fixture run is
  // byte-identical arithmetic.
  const bootScale = fixtureEnabled() ? Math.max(1, Number(process.env.FLY_BOOT_SCALE || 1)) : 1;

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

  // Safety net for pages that navigated before bootFly was called: seed
  // post-load and reload once so the app re-mounts with the keys in place.
  const seeded = await page.evaluate(() => window.__flyBootSeeded === true);
  if (!seeded) {
    await page.evaluate(({ s, terraPin }) => {
      window.__flyWeatherOverride = 'baseline'; // round 16: same determinism pin
      window.__flyAerialOverride = 0; // round 19: same idiom, reload leg
      window.__flySatShadowOverride = 0;
      window.__flyGovPin = 'hold'; // round 21: same idiom, reload leg
      if (terraPin === 1) window.__flyTerraPin = 1; // round 22 (R25: toy only), reload leg
      window.__flySettlePin = 1;
      window.__flyClutterPin = 1;
      window.__flyDepthPin = 1;
      // Round 18's boost pin was missing from this reload leg (every other
      // pin is mirrored here) — added with the R25 pins below.
      window.__flyBoostInfinite = true;
      window.__flyTitleBypass = true; // round 25: same idiom, reload leg
      window.__flyVisualsOverride = 'classic';
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-map-style-2', s || 'toy'); // round 10: default toy for harnesses
    }, { s: style, terraPin });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs });
  }

  // Legacy airborne regression setup is explicit. These gates test rendering,
  // formation, etc., NOT the new departure flow. The independent unpinned
  // verify-operations-browser.cjs never calls this helper and starts via UI.
  // Round 25 (E): `skipMenus: false` is the PRODUCT boot — every determinism
  // pin and the fixture exactly as above, but no airborne skip and no reveal
  // wait: the page is left on whatever screen the app opens on (the R25
  // title when a gate un-pins `__flyTitleBypass`, else today's hangar, which
  // runs the canvas on 'demand' — MEASURED, a satellite fixture boot had not
  // revealed behind it after 62 s, while toy with blocked hosts reaches pct
  // 100 behind it through the Neon ceiling; so never wait on pct there).
  // Returns once the runtime is mounted. The R25 flow gates use this.
  if (!skipMenus) {
    await page.waitForFunction(() => !!window.__fly && !!window.__flyStore, undefined, { timeout: timeoutMs });
    return { ms: null, t0 };
  }

  // Preserve the old NYC airborne fixture; choosing Ohio as the product's
  // home airport must not silently change historical screenshot baselines.
  // Round 25 (E): the sequence is scripts/_skip-menus.js enterFlight, verbatim
  // (phase 'airborne', profile null, operations.warp, setHangarOpen(false),
  // warpToGeo 40.6892,-74.0445 @800 m hdg 0) — one copy for every harness.
  await enterFlight(page, undefined, { timeoutMs });

  // The harness contract: pct hits 100 exactly at reveal and stays there.
  // Round 11 fix: options are waitForFunction's THIRD parameter (second is
  // `arg`) — the old two-arg call silently fell back to the 30s default,
  // which every toy harness tripped the first time a boot ran >30s.
  await page.waitForFunction(() => window.__flyBoot?.pct === 100, undefined, {
    timeout: timeoutMs,
    polling: 250,
  });
  const ms = Date.now() - t0;

  // Reveal fade unmounts the overlay; the GL canvas is up underneath it.
  await page.waitForSelector('.fixed.inset-0 canvas', { timeout: 30000 * bootScale });
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="boot-screen"]'),
    { timeout: 30000 * bootScale }
  );
  // Small settle: first post-reveal frames, labels, HUD.
  await page.waitForTimeout(settleMs * bootScale);
  return { ms };
}

/**
 * Round 22 (SANCTIONED harness edit — E CERT, plan §2): the shared PER-GATE
 * UN-PIN accessor. R21 had ONE fleet pin (`__flyGovPin`) and three gates that
 * un-pinned it, so each gate carried its own copy of the accessor. R22 adds
 * FOUR pins (`__flyTerraPin` / `__flySettlePin` / `__flyClutterPin` /
 * `__flyDepthPin`) and FIVE gates that un-pin them in different combinations —
 * twenty copies of the same eight lines, each free to drift. This is that
 * accessor, once.
 *
 * MECHANISM (the verify-tier-step / soak-fly idiom, verbatim): an accessor
 * installed BEFORE the app mounts swallows the fleet write bootFly performs.
 * The pin's getter then reads `window.__r22Unpinned[name]`, which is
 * `undefined` until the gate sets it — and `undefined` is precisely what "not
 * pinned" means to every R22 consumer (the TERRA_SHARP contract's own
 * "consumers treat undefined as legacy" rule, applied to the pins). The
 * swallowed write is preserved on `window.__r22PinAttempt[name]` so a gate can
 * PROVE it un-pinned rather than assume it.
 *
 * ADDITIVE ONLY: nothing above this line changed, so every existing harness
 * still boots fully pinned. A gate opts in with
 *   await page.addInitScript(unpinPins, ['__flyTerraPin', '__flySettlePin']);
 * and can later drive the flag from the page with
 *   (window.__r22Unpinned ??= {}).__flyClutterPin = 0;
 *
 * @param {string[]} names — pin globals to un-pin for this page.
 */
function unpinPins(names) {
  for (const n of names || []) {
    try {
      Object.defineProperty(window, n, {
        configurable: true,
        get: () => window.__r22Unpinned?.[n],
        set: (v) => {
          (window.__r22PinAttempt ??= {})[n] = v;
        },
      });
    } catch {
      /* reported by the gate that installed it, never silently assumed */
    }
  }
}

module.exports = { bootFly, BOOT_URL, unpinPins };
