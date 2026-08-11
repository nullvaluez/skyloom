/**
 * ROUND 23 (C "NIGHT-CERT") — verify-night-alive: IS THE NIGHT ACTUALLY LIT?
 *
 * The user's report (plan §0): satellite night is "almost silent black — some
 * buildings might have a white glow, some (very few) might show lights in
 * windows". Every gate in the fleet was green while that shipped. This harness
 * exists because of HOW that was possible, and it is built to close each of
 * the three blindness layers by construction:
 *
 *   1. THE FLEET PINS. `scripts/_boot.js` sets `__flyTerraPin` /
 *      `__flySettlePin` / `__flyClutterPin` / `__flyDepthPin` = 1 for the whole
 *      browser fleet, so every legacy harness — verify-sat-night's 33 gates
 *      included — certifies night on the R21 WORLD. This gate un-pins TERRA,
 *      SETTLE and CLUTTER (see the DEPTH note below) and measures the world the
 *      user actually flies.
 *   2. THE FIVE R22 GATES UN-PIN BY DAY. terra/arrival/settle/clutter/depth2
 *      all measure the R22 world in daylight. Nothing had ever measured it at
 *      night. Every leg here is deep night (true elevation <= -12 deg),
 *      asserted as a precondition, not assumed.
 *   3. TIER. verify-sat-night pins quality tier HIGH, and window emissives are
 *      a high-tier-only material swap (`SAT_BUILDINGS.night.enabled &&
 *      atLeastTier(qualityTier, SAT_BUILDINGS.night.minTier)`, minTier 'high').
 *      This gate runs P-MAN and P-POW at BOTH the resolved live tier and pinned
 *      high, and the delta between them is itself an assertion.
 *
 * ---------------------------------------------------------------------------
 * WHY `__flyDepthPin` IS THE ONE PIN THIS GATE DOES NOT TOUCH
 * ---------------------------------------------------------------------------
 * Un-pinning depth would not measure the user's world — it would ARM a feature
 * the user does not have. `lib/fly/depth-pass.js` `depthPassOn()` ships with
 * `DEPTH_PASS.enabled = false` (built-but-off pending R22 checkpoint #3), and
 * R22's W3 fix made the UN-PIN ITSELF the arm: `__r22PinAttempt.__flyDepthPin`
 * exists iff a gate installed the accessor and `_boot.js` wrote through it, and
 * that marker arms the block. So installing the accessor here would have this
 * "measure the shipped world" gate render N8AO, a ground catcher and near-field
 * haze that no user session has. Leaving the fleet pin at 1 hits precedence
 * rule 4 and yields OFF — which is exactly the ship state.
 *
 * That inheritance is a trap the moment DEPTH_PASS ships true, so gate (2)
 * PARSES `DEPTH_PASS.enabled` out of fly-constants.js and fails loudly if it is
 * no longer `false`. The blindness this round exists to kill does not get to
 * reappear silently in the gate that kills it. (Source-fact gate, the
 * verify-depth2 (13) precedent: a fact with no distribution.)
 *
 * ---------------------------------------------------------------------------
 * CALIBRATION STATUS — READ BEFORE QUOTING A NUMBER FROM THIS FILE
 * ---------------------------------------------------------------------------
 * The intended RED calibration was a live run on base `f009263` (= the shipped
 * R22 tree + the R23 scaffolding commit, which adds two `enabled:false`
 * constants blocks and a plan document and changes no behaviour). That run
 * happened — `scripts/r23-c-red-baseline.txt` — and it is NOT a product
 * baseline, because this session's egress policy answers **403 to CONNECT** for
 * `server.arcgisonline.com` (Esri imagery + DEM) and `tiles.openfreemap.org`
 * (every building, road, parcel and landuse polygon). The world never streamed:
 * `r23-c-red-man-pinned-high.png` is a featureless grey field with POI letters
 * and city-glow domes floating over it, and 3 085 off-origin console errors
 * were logged in one run. Freezing a floor off that would freeze a network.
 *
 * So: the ABSOLUTE floors below are ARCHIVE-DERIVED (see the `T` comment and
 * `scripts/r23-c-archive-metrics.js`) and are explicitly PROVISIONAL; the
 * RATIO gates (9)/(10)/(11) need no absolute calibration and are the
 * load-bearing ones; and gate (3b) makes the blocked state impossible to
 * mistake for a pass or for a product red.
 *
 * EXIT CODES:  0 = VERIFY: PASS · 1 = VERIFY: FAIL · 2 = VERIFY: BLOCKED
 * A sweep must read 2 as "not run" — never as green, never as a product red.
 *
 * ---------------------------------------------------------------------------
 * GATES
 *   (0)  PRECONDITION — the un-pin took on the un-pinned pages, and the control
 *        page is genuinely pinned (`__r22PinAttempt` proof, never assumed).
 *   (1)  PRECONDITION — every leg is DEEP NIGHT: skyElDeg <= -12, state 'night'.
 *   (2)  PRECONDITION — `DEPTH_PASS.enabled` is still false in source, so this
 *        harness's un-touched depth pin still represents the ship state.
 *   (3)  PRECONDITION — satellite invariant: `window.__toyWorld` never defined.
 *   (3b) PRECONDITION — THE WORLD ACTUALLY STREAMED. Imagery AND vector tiles
 *        answered, and vector content is resident at P-MAN. If not, the run
 *        exits BLOCKED (2) before any pixel gate is evaluated. This is the gate
 *        that exists because the first run of this file measured a network.
 *   (4)  P-MAN LIT FLOOR — the aggregate night light field exists (S1).
 *   (5)  P-MAN WARM SHARE FLOOR — and it is WARM, i.e. windows/sodium and not
 *        moonlight on roofs (S3).
 *   (6)  P-MAN LUMA BAND — p95 floor (there are bright things) and p50 ceiling
 *        (the night is still night, not a grey wash).
 *   (7)  P-MAN WHITE-GLOW CEILING — no large contiguous unsaturated slab (S2).
 *   (8)  P-POW suburban LIT + WARM floors.
 *   (9)  P-MAN R22-vs-R21 RATIO at matched tier — the regression gate proper.
 *  (10)  P-POW R22-vs-R21 RATIO at matched tier.
 *  (11)  TIER DELTA at P-MAN — the live-tier world may not be a fraction of the
 *        pinned-high world (H1).
 *  (12)  P-OWE DARK CONTROL — lit ceiling, dark floor, draws <= 261 (plan §5.1).
 *  (13)  P-BB low-AGL bridge pose — lit floor. Pose is a FROZEN STAND-IN, see
 *        the P_BB comment.
 *  (14)  zero page/console errors (app-origin; upstream tile noise classified).
 *
 * Run:  FLY_URL=http://localhost:3023 node scripts/verify-night-alive.js
 * Env:  R23_DWELL_MS (default 26000 first pose / 22000 later)
 *       R23_SKIP_CONTROL=1  drop the pinned control page (gates 9/10 SOFT)
 *       R23_BANDS=1         print candidate ground bands per pose and exit-code
 *                           unchanged (calibration aid; never used by a gate)
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly, unpinPins } = require('./_boot');
const {
  nightMetrics,
  decodeRaw,
  fmtMetrics,
  fmtCensus,
  deltaMetrics,
  readCensus,
} = require('./_night-metrics');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const DEV_ORIGIN = (process.env.FLY_URL || 'http://localhost:3000').replace(/\/$/, '');
const OUT = (n) => path.join(__dirname, n);

/* ─────────────────────────────── POSES ───────────────────────────────────
 * Each pose freezes lat/lon/altM(MSL)/heading(rad, 0 = north, clockwise)/pitch
 * AND its ground band. The band is a fixed fraction of frame height and is NOT
 * detected — see the `_night-metrics.js` header for why a horizon detector
 * would be a coin here.
 */

/** P-MAN — verify-sat-night's certified Manhattan night pose, VERBATIM. Using
 *  the fleet's most-measured night pose means an R23 number can be read against
 *  four rounds of history at the same camera. Band 0.55..0.98 is the same
 *  ground crop verify-sat-night's A/B probes use; the x-crop drops the right
 *  rail so a future HUD change cannot move a frozen number. */
const P_MAN = {
  tag: 'P-MAN',
  pose: [40.7075, -74.0113, 792, 2.6, -0.12],
  band: [0.55, 0.98],
  xBand: [0.02, 0.85],
};
/** P-POW — verify-groundlife's POWELL_DOWN pose and CROP, VERBATIM, both.
 *  R19 wrote the reason into that harness and it is the reason here:
 *  "The NIGHT pixel legs look steeply DOWN. Not taste - signal to noise: at a
 *   cruise pitch the crop's top third is sky ... Looking down puts the crop
 *   entirely on the suburb the gate is about."
 *  Measured on R19's own archived A/B pair with exactly this crop
 *  (scripts/r23-c-archive-metrics.js): night sources ON reads litFrac 1.114%
 *  and warm-of-lit 89.1%; OFF reads 0.130% and 8.0%. An 8.6x lit separation and
 *  an 11x warm separation - this is the most discriminating night pose the
 *  fleet owns, and the R23 floors sit between those two states. */
const P_POW = {
  tag: 'P-POW',
  pose: [40.1584, -83.0752, 600, 1.9, -1.15],
  band: [430 / 900, 830 / 900], // = verify-groundlife CROP top/height
  xBand: [260 / 1600, 1340 / 1600], // = verify-groundlife CROP left/width
};
/** P-OWE — the fleet's Owens control pose (verify-terra/clutter/depth2/aerial),
 *  with verify-groundlife's night attitude. THE DARK CONTROL: any feature that
 *  lights this is wrong by construction (plan §5.1). */
const P_OWE = {
  tag: 'P-OWE',
  pose: [36.601, -118.06, 500, 1.5, -0.28],
  band: [0.45, 1.0],
  xBand: [0.02, 0.98],
};
/** P-BB — BEST-EFFORT STAND-IN, and labelled as one everywhere it appears.
 *  The handoff describes "the user's Brooklyn Bridge chase pose" from a
 *  screenshot whose framing is not recoverable from text. This is a low-AGL
 *  stand-in with the same SUBJECT: sitting over the East River south-east of
 *  the bridge at 300 m MSL, heading -0.35 rad (~340 deg, NNW) so the bridge and
 *  Lower Manhattan fill the frame. It is FROZEN here, so it is a valid
 *  regression pose even though it is not the user's exact camera; the round
 *  record must not claim it reproduces the user's screenshot. */
const P_BB = {
  tag: 'P-BB',
  pose: [40.698, -73.993, 300, -0.35, -0.14],
  band: [0.5, 0.98],
  xBand: [0.02, 0.98],
};

const DWELL_1 = +(process.env.R23_DWELL_MS ?? 26000);
const DWELL_N = +(process.env.R23_DWELL_MS ?? 22000);

/* ══════════════════════ THRESHOLDS — ARCHIVE-DERIVED ═══════════════════════
 * READ THIS BEFORE TRUSTING A NUMBER BELOW.
 *
 * These floors were NOT frozen off a live red run, because a live red run is
 * not possible in this session: the egress policy denies CONNECT to
 * `server.arcgisonline.com` (imagery + DEM) and `tiles.openfreemap.org` (every
 * building, road and parcel) with 403. The base-tree run
 * (`scripts/r23-c-red-baseline.txt`) therefore measured a featureless grey
 * field, and a floor frozen off THAT would freeze a network condition, not a
 * product state. Gate (3b) below makes that failure mode impossible to mistake
 * for either a pass or a product red.
 *
 * They are derived instead from the fleet's own ARCHIVED CERTIFIED night frames
 * — see `scripts/r23-c-archive-metrics.js`, which prints the derivation and
 * writes `scripts/r23-c-archive-metrics.json`:
 *
 *   P-MAN, R16 certified (r16-satnight-01/02, the IDENTICAL pose):
 *       litFrac 20.09-20.25% · warm-of-lit 47.7-48.3% · p5/p50/p95 5/10/117-120
 *       (those frames carry the HUD, the POI letters and the player jet, which
 *        INFLATE lit and white and DEFLATE warm — so a floor under them is
 *        conservative in the direction that matters, and this gate parks all
 *        three so a healthy live frame should read warmer, not brighter)
 *   P-POW, R19 A/B at this exact pose+crop:  ON 1.114% lit / 89.1% warm
 *                                            OFF 0.130% lit /  8.0% warm
 *   TODAY, egress-blocked, same P-MAN crop:  0.0% warm at every leg
 *
 * RULE USED: a P-MAN floor is HALF the weakest certified sample (a 2x safety
 * factor absorbing the foreground this gate parks and R22-era content drift); a
 * P-POW floor sits BETWEEN R19's measured ON and OFF states, which is the
 * charter's own instruction applied to the best paired evidence that exists.
 *
 * EVERY ONE OF THESE IS PROVISIONAL AND MUST BE RE-FROZEN ON THE FIRST RUN IN A
 * SESSION THAT CAN REACH BOTH TILE HOSTS. The procedure: run this file on the
 * base tree, take the printed `SUGGEST` block, paste it here, and record the
 * move in `scripts/r23-close-sweep.md` §1. Until then the load-bearing gates
 * are the RATIO gates (9)/(10)/(11), which need no absolute calibration at all:
 * both of their legs are measured in the same session against the same tileset.
 */
const T = {
  // (4) 20.09% certified / 2 — and the R22-blocked leg reads 27% lit with 0%
  //     warm, which is why lit alone is NOT the load-bearing gate here.
  MAN_LIT: +(process.env.R23_MAN_LIT ?? 0.1),
  // (5) 47.7% certified / 2. THE discriminator: 0.0% on every unlit frame
  //     measured this round, 47.7-48.3% on both certified frames.
  MAN_WARM: +(process.env.R23_MAN_WARM ?? 0.24),
  // (6) p95 117 certified / 2 (supporting, not discriminating — a grey wash
  //     also clears it); p50 10 certified, ceiling 4x that to catch the wash.
  MAN_P95: +(process.env.R23_MAN_P95 ?? 58),
  MAN_P50_MAX: +(process.env.R23_MAN_P50_MAX ?? 40),
  // (7) 0.342% of band in the certified frames — but that number IS the POI
  //     letters and the HUD hint row, which this gate parks. Ceiling set under
  //     it, deliberately provisional: re-derive on the first live run.
  MAN_BLOB: +(process.env.R23_MAN_BLOB ?? 0.0025),
  // (8) between R19's ON (1.114% / 89.1%) and OFF (0.130% / 8.0%).
  POW_LIT: +(process.env.R23_POW_LIT ?? 0.005),
  POW_WARM: +(process.env.R23_POW_WARM ?? 0.4),
  // (9)(10) un-pinned / pinned ratio at matched tier. NOT archive-derived and
  //     not environment-sensitive: both legs run in the same session, same
  //     tileset, same tier, differing only in the R22 fleet pins. 0.8 allows a
  //     20% honest streaming difference before it calls a regression.
  RATIO_LIT: +(process.env.R23_RATIO_LIT ?? 0.8),
  RATIO_WARM: +(process.env.R23_RATIO_WARM ?? 0.8),
  // (11) live tier vs pinned-high in the same (un-pinned) world.
  TIER_RATIO: +(process.env.R23_TIER_RATIO ?? 0.8),
  // (12) Owens dark control. NO certified Owens NIGHT frame exists in the
  //     archive, so this is the one floor with no measured ancestor: it is set
  //     from R19's Powell lights-OFF state (0.130% lit) with a wide margin, and
  //     is flagged in the ledger as the weakest number in the file.
  OWE_LIT_MAX: +(process.env.R23_OWE_LIT_MAX ?? 0.02),
  OWE_DARK_MIN: +(process.env.R23_OWE_DARK_MIN ?? 0.5),
  OWE_DRAWS: 261, // plan §5.1, FROZEN — the fleet's most-defended ceiling
  // (13) P-BB stand-in: half the Manhattan floor, since the bridge pose holds
  //     far more water and far less city than the overview.
  BB_LIT: +(process.env.R23_BB_LIT ?? 0.05),
  // (1) deep night
  NIGHT_EL: -12,
};

/* ───────────────────────────── page helpers ───────────────────────────── */

/** Warp + pin the pose IN THE SAME EVALUATE (verify-clutter W3: the flight
 *  model integrates ~2.5 m between a warp and a later freeze, which is enough
 *  to move hash-stable content). verify-sat-night's pinScene, verbatim. */
const pinScene = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  f.heading = heading;
  f.pitch = pitch;
  f.bank = 0;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => {
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
 * Park every actor this gate does not control, then restore. R17 §7.1: a pixel
 * gate must not contain actors it doesn't control.
 *   • the player rig and its nav-light Points  (bobs at 1.9/3.1 Hz)
 *   • the traffic billboard pool and the tracer ribbon, at their ROOTS
 *     (R19 postmortem: the tracer rewrites its position ATTRIBUTE every frame
 *     and never moves its matrixWorld, so no visibility or matrix census can
 *     find it — it is parked by name or not at all)
 *   • the cloud deck and cirrus (drift phase is a function of boot time)
 *   • and the DOM: an element screenshot captures the COMPOSITED page clipped
 *     to the canvas box, so every HUD rail and traffic label lands in the PNG
 *     (verify-dusk's finding; it was the whole residual A/B noise floor there).
 * The ground layers under test are deliberately NOT parked.
 */
function parkForeground(page, v) {
  return page.evaluate((vis) => {
      if (window.__flyPlayer) window.__flyPlayer.visible = vis;
      if (window.__flyClouds) window.__flyClouds.visible = vis;
      if (window.__flyCirrus) window.__flyCirrus.visible = vis;
      if (window.__flyTraffic) window.__flyTraffic.visible = vis;
      if (window.__flyTracers) window.__flyTracers.visible = vis;
      let scene = window.__flyPlayer ?? window.__satRoads?.object ?? null;
      while (scene && scene.parent) scene = scene.parent;
      scene?.traverse((o) => {
        if (o.isInstancedMesh && (o._isModel !== undefined || o._painted !== undefined))
          o.visible = vis;
      });
      // POI LETTERS. They are the single largest white, high-luma, contiguous,
      // LOW-SATURATION object in a night frame — i.e. exactly what the
      // white-glow blob metric is built to find, which would make gate (7) a
      // letter detector. They are also, in the handoff's own words, "UI over
      // the world" and not part of the ground-lighting claim. Parked at the
      // troika Text CHILD, because the letters' frame loop rewrites
      // `group.visible` every frame (the R19 CloudField lesson) — and found by
      // the `popT` userData key that same loop stamps, which is how
      // verify-sat-night's parkE finds them.
      scene?.children?.forEach((g) => {
        if (!g.isGroup || !('popT' in (g.userData ?? {}))) return;
        g.children.forEach((ch) => {
          ch.visible = vis;
          if (ch.material) ch.material.visible = vis;
        });
      });
      const c = document.querySelector('.fixed.inset-0 canvas');
      if (c) {
        const keep = new Set();
        let n = c;
        while (n) {
          keep.add(n);
          n = n.parentElement;
        }
        document.querySelectorAll('body *').forEach((el) => {
          if (!keep.has(el)) el.style.visibility = vis ? '' : 'hidden';
        });
      }
  }, v);
}

/**
 * DEEP NIGHT, PER POSE. `__flySunOverride` is a wall clock; the sun model
 * derives elevation from lon/lat, so ONE UTC timestamp is deep night at NYC
 * and civil twilight at Owens (2.9 h of longitude between them). This returns
 * the UTC instant at which the given longitude is at ~23:00 LOCAL SOLAR time,
 * which is comfortably past astronomical twilight at every R23 latitude. The
 * resulting elevation is ASSERTED per leg by gate (1), so a bad clock cannot
 * silently certify a dusk frame as night (the R18 lesson: a precondition must
 * imply its assertion).
 */
const nightMsFor = (lon) => {
  const base = Date.UTC(2026, 6, 18, 0, 0, 0); // 18 Jul 2026, mid-summer N-hemi
  return base + (23 - lon / 15) * 3600e3;
};

/* ───────────────────────────────── main ──────────────────────────────── */
(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  // ONE context: the R22 persistent raster cache (`fly-raster-v1`) is
  // context-scoped, so the later pages warp into a warm pyramid exactly as a
  // returning user does. That is the shipped condition, and it also keeps the
  // run inside a sane wall time.
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });

  const errs = [];
  const externalBlips = [];
  const fails = [];
  const softs = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const soft = (name, why) => {
    console.log(`SOFT ${name} — ${why}`);
    softs.push(name);
  };
  const info = (s) => console.log(`INFO ${s}`);
  const anchor = (n, d) => console.log(`ANCHOR ${n} — ${d}`);

  /* ── THE WORLD-CONTENT TALLY (gate 3b). ──────────────────────────────────
   * Every number this harness prints is a statement about LIGHT ON GROUND, and
   * the ground is made of two upstream hosts. If either is unreachable there is
   * no ground, and the metrics describe a network, not a product. That is not a
   * hypothetical: the first run of this file, on the base tree, measured a
   * featureless grey field because this session's egress policy answers 403 to
   * CONNECT for both hosts. It looked exactly like a catastrophic product
   * regression, and it was not one.
   *
   * So the run counts them. A gate that cannot tell "the night is unlit" from
   * "the tiles never arrived" is a coin (the R20 lesson), and the third state
   * this needs — BLOCKED, distinct from PASS and from FAIL — is the R22 §1b.6
   * ruling generalised: a red produced by a missing instrument is an instrument
   * artefact, and the environment is an instrument. */
  const net = { img: 0, imgFail: 0, vec: 0, vecFail: 0, hosts: new Set() };
  const classify = (url) =>
    /World_Imagery|Terrain3D|arcgisonline/.test(url)
      ? 'img'
      : /openfreemap|\.pbf(\?|$)/.test(url)
        ? 'vec'
        : null;
  const wireErrors = (p) => {
    p.on('response', (r) => {
      const k = classify(r.url());
      if (!k) return;
      if (r.status() >= 200 && r.status() < 300) net[k] += 1;
      else {
        net[`${k}Fail`] += 1;
        try {
          net.hosts.add(new URL(r.url()).host);
        } catch {}
      }
    });
    p.on('requestfailed', (r) => {
      const k = classify(r.url());
      if (!k) return;
      net[`${k}Fail`] += 1;
      try {
        net.hosts.add(new URL(r.url()).host);
      } catch {}
    });
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => {
      if (m.type() !== 'error') return;
      const url = m.location()?.url ?? '';
      // Upstream Esri/ADS-B noise is CLASSIFIED, never gated (the R22 §1c
      // ruling): gating on it makes every satellite harness red for a reason
      // that has nothing to do with the tree.
      if (url && !url.startsWith(DEV_ORIGIN)) {
        externalBlips.push(`${m.text().slice(0, 90)} @${url.slice(0, 90)}`);
        return;
      }
      errs.push(`console: ${m.text().slice(0, 180)}${url ? ` [${url.slice(0, 90)}]` : ''}`);
    });
  };

  /**
   * A page for one PIN STATE. `unpin` installs the R22 accessor for TERRA /
   * SETTLE / CLUTTER only — see the header for why DEPTH is left alone.
   */
  const newFlyPage = async ({ unpin }) => {
    const p = await context.newPage();
    if (unpin) await p.addInitScript(unpinPins, ['__flyTerraPin', '__flySettlePin', '__flyClutterPin']);
    wireErrors(p);
    await p.bringToFront(); // a background tab runs no rAF — see `leg`
    return p;
  };

  const results = { legs: {}, meta: {} };

  /** One measured leg: pin the sun, warp+pin the pose, dwell, park, shoot. */
  const leg = async (page, legTag, P, { dwell, shot }) => {
    await page.evaluate((t) => {
      window.__flySunOverride = t;
    }, nightMsFor(P.pose[1]));
    await page.evaluate(pinScene, P.pose);
    await page.waitForTimeout(dwell);
    await page.mouse.move(800, 450);
    const census = await readCensus(page);
    await parkForeground(page, false);
    await page.waitForTimeout(700);
    // ONE PAGE IS OPEN AT A TIME (see the page lifecycle below) and it is
    // brought to front before every shot. A backgrounded tab does not run rAF,
    // and Playwright's element screenshot waits for the box to be STABLE across
    // animation frames — so a shot on a background page hangs for the full
    // timeout with no error that says why. Cost me one smoke run; recorded here
    // so it costs nobody else one.
    await page.bringToFront();
    /* …AND `bringToFront()` IS NOT ENOUGH, measured. Two long runs in this
     * session died here, both on their SECOND page, both inside the element
     * screenshot's "waiting for element to be stable" step, after their boot
     * had completed cleanly (verify-night-alive.js:471 reached from :553, and
     * verify-sat-night's own `shot64` in its (E) loop). Playwright's ELEMENT
     * screenshot waits for the bounding box to stop moving across animation
     * frames; a viewport screenshot does not.
     *
     * So the element shot keeps its 20 s try — it stays the fleet idiom and it
     * is what every frozen archive frame was captured with — and a CLIPPED
     * PAGE screenshot is the fallback. At these poses the two are the same
     * rectangle: `.fixed.inset-0` fills the viewport and `parkForeground` has
     * already hidden every non-canvas element, so the fallback's pixels are the
     * element's pixels. Which path produced the frame is PRINTED, never
     * silent — a fallback nobody can see is a measurement nobody can trust. */
    let buf;
    let shotVia = 'element';
    try {
      buf = await page.locator('.fixed.inset-0 canvas').first().screenshot({ timeout: 20000 });
    } catch (e) {
      shotVia = `viewport-fallback (${e.message.split('\n')[0].slice(0, 60)})`;
      buf = await page.screenshot({
        clip: { x: 0, y: 0, width: 1600, height: 900 },
        timeout: 20000,
      });
    }
    if (shotVia !== 'element') console.log(`WARN screenshot path for ${legTag}: ${shotVia}`);
    fs.writeFileSync(OUT(shot), buf);
    await parkForeground(page, true);
    const raw = await decodeRaw(buf);
    const m = nightMetrics(raw, { groundBand: P.band, xBand: P.xBand });
    console.log(fmtCensus(`CENSUS[${legTag}]`, census));
    console.log(fmtMetrics(`METRIC[${legTag}]`, m));
    if (process.env.R23_BANDS) {
      for (const b of [
        [0, 1],
        [0.35, 1],
        [0.45, 1],
        [0.55, 0.98],
        [0.65, 1],
      ]) {
        console.log(
          fmtMetrics(`  band[${legTag}]`, nightMetrics(raw, { groundBand: b, xBand: P.xBand }))
        );
      }
    }
    const row = {
      legTag,
      pose: P.tag,
      band: P.band,
      xBand: P.xBand,
      shot,
      census,
      m: { ...m, hist: undefined },
    };
    results.legs[legTag] = row;
    return row;
  };

  /* ── PRECONDITION (2): the DEPTH pin this gate deliberately leaves alone
   *    still means "off". Parsed from source, not from the runtime — the
   *    runtime is exactly what would be wrong if this were wrong. */
  const constantsSrc = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'fly', 'fly-constants.js'),
    'utf8'
  );
  const depthEnabled = (() => {
    const i = constantsSrc.indexOf('export const DEPTH_PASS');
    if (i < 0) return null;
    const m = constantsSrc.slice(i, i + 400).match(/enabled:\s*(true|false)/);
    return m ? m[1] === 'true' : null;
  })();
  gate(
    'DEPTH_PASS still ships OFF, so this gate\'s untouched depth pin == the ship state',
    depthEnabled === false,
    `source DEPTH_PASS.enabled=${depthEnabled} (if this ever reads true, this harness must un-pin depth — see the header)`
  );

  /* ══════════════════════ PAGE 1 — the USER'S WORLD ══════════════════════
   * Un-pinned, and the quality tier is NOT touched: whatever the app resolves
   * pre-mount is what the user gets, and measuring it is the entire point. */
  const live = await newFlyPage({ unpin: true });
  const bootLive = await bootFly(live, { style: 'satellite', ...BOOT_OPTS });
  info(`live-tier page booted in ${bootLive.ms} ms (tier NOT pinned)`);
  const manLive = await leg(live, 'MAN/unpinned/live', P_MAN, {
    dwell: DWELL_1,
    shot: 'r23-c-red-man-unpinned-live.png',
  });
  const powLive = await leg(live, 'POW/unpinned/live', P_POW, {
    dwell: DWELL_1,
    shot: 'r23-c-red-pow-unpinned-live.png',
  });
  const oweLive = await leg(live, 'OWE/unpinned/live', P_OWE, {
    dwell: DWELL_1,
    shot: 'r23-c-red-owe-unpinned-live.png',
  });
  const bbLive = await leg(live, 'BB/unpinned/live', P_BB, {
    dwell: DWELL_N,
    shot: 'r23-c-red-bb-unpinned-live.png',
  });
  const toyLive = await live.evaluate(() => typeof window.__toyWorld !== 'undefined');
  await live.close(); // ONE PAGE AT A TIME — see the bringToFront note in `leg`

  /* ═════════════════ PAGE 2 — the user's world, tier pinned HIGH ══════════ */
  const high = await newFlyPage({ unpin: true });
  await bootFly(high, { style: 'satellite', ...BOOT_OPTS });
  await high.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await high.waitForTimeout(2500); // material/composer rebuild after a tier write
  const manHigh = await leg(high, 'MAN/unpinned/high', P_MAN, {
    dwell: DWELL_1,
    shot: 'r23-c-red-man-unpinned-high.png',
  });
  const powHigh = await leg(high, 'POW/unpinned/high', P_POW, {
    dwell: DWELL_N,
    shot: 'r23-c-red-pow-unpinned-high.png',
  });
  await high.close();

  /* ══════════ PAGE 3 — THE CONTROL: the R21 world, verify-sat-night's
   * condition exactly (fleet pins intact, tier high). This is the leg that
   * makes gates (9)/(10) a REGRESSION test rather than an absolute-brightness
   * opinion — and it is immune to upstream imagery drift, because both legs of
   * the ratio are measured in the same session against the same tileset (the
   * R21 lesson that a frozen number over a live tileset has a shelf life). */
  let manCtl = null;
  let powCtl = null;
  if (!process.env.R23_SKIP_CONTROL) {
    const ctl = await newFlyPage({ unpin: false });
    await bootFly(ctl, { style: 'satellite', ...BOOT_OPTS });
    await ctl.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
    await ctl.waitForTimeout(2500);
    manCtl = await leg(ctl, 'MAN/pinned/high', P_MAN, {
      dwell: DWELL_1,
      shot: 'r23-c-red-man-pinned-high.png',
    });
    powCtl = await leg(ctl, 'POW/pinned/high', P_POW, {
      dwell: DWELL_N,
      shot: 'r23-c-red-pow-pinned-high.png',
    });
    await ctl.close();
  }

  /* ══════ (3b) THE WORLD-CONTENT PRECONDITION — PASS / FAIL / **BLOCKED** ══
   * See the `net` tally's comment. If the two upstream hosts did not answer,
   * nothing below this line is a statement about the product, so the run exits
   * on a THIRD code (2) with `VERIFY: BLOCKED`. A close sweep must read exit 2
   * as "not run" — never as green, never as a product red. */
  const anyVector =
    (manLive.census.night.roads?.ready ?? 0) > 0 ||
    (manLive.census.night.buildings?.ready ?? 0) > 0 ||
    (manCtl?.census.night.roads?.ready ?? 0) > 0 ||
    (manCtl?.census.night.buildings?.ready ?? 0) > 0;
  const worldOk = net.img > 0 && net.vec > 0 && anyVector;
  /* R23_FORCE_GATES — an EXERCISE lever, not a bypass. Without egress the
   * BLOCKED branch is the only path this file has ever executed, so a crash in
   * the gate block below would lie dormant until the first session that CAN
   * measure — which is the run that can least afford to discover one. This
   * flag walks the gate block on whatever data exists and, by construction,
   * can never produce a green: it pushes a permanent failure. Used once, to
   * prove the gate path runs; recorded in scripts/r23-close-sweep.md §4d. */
  const forceGates = !!process.env.R23_FORCE_GATES && !worldOk;
  if (forceGates) {
    console.log(
      'WARN R23_FORCE_GATES — the world-content precondition is OVERRIDDEN. This run EXERCISES ' +
        'the gate path against a world that never streamed; it is NOT a certification and it ' +
        'cannot pass (a permanent failure is appended below).'
    );
    fails.push('R23_FORCE_GATES (exercise run, never a certification)');
  }
  console.log(
    `WORLD tiles: imagery ${net.img} ok / ${net.imgFail} failed · vector ${net.vec} ok / ${net.vecFail} failed · ` +
      `vector content resident at P-MAN: ${anyVector}` +
      (net.hosts.size ? ` · unreachable hosts: ${[...net.hosts].join(', ')}` : '')
  );
  if (!worldOk && !forceGates) {
    console.log(
      'BLOCKED the world never streamed — imagery and/or vector tiles are unreachable from this ' +
        'session, so every pixel metric above describes the NETWORK, not the product. ' +
        'Diagnose with: curl -sS http://127.0.0.1:38989/__agentproxy/status ' +
        '(this session: 403 CONNECT for server.arcgisonline.com and tiles.openfreemap.org). ' +
        'The measurements above are kept and written to JSON as evidence of the blockade, ' +
        'NOT as a product baseline.'
    );
    results.meta = {
      when: new Date().toISOString(),
      origin: DEV_ORIGIN,
      blocked: true,
      net: { ...net, hosts: [...net.hosts] },
      thresholds: T,
      poses: { P_MAN, P_POW, P_OWE, P_BB },
      depthEnabledInSource: depthEnabled,
    };
    fs.writeFileSync(OUT('r23-c-night-alive.json'), JSON.stringify(results, null, 2));
    console.log('VERIFY: BLOCKED (upstream tile hosts unreachable — gates not evaluated)');
    await browser.close();
    process.exit(2);
  }
  gate(
    'the world actually streamed (imagery + vector tiles reachable, content resident)',
    worldOk,
    `img ${net.img}/${net.imgFail} vec ${net.vec}/${net.vecFail} resident=${anyVector}`
  );

  /* ═════════════════════════════ GATES ═══════════════════════════════════ */

  // (0) the un-pin took, and the control really is pinned. PROVE, never assume
  //     (the R22 `__r22PinAttempt` contract).
  const pinsOf = (r) => r.census.pins;
  const unpinnedOk = (r) => {
    const p = pinsOf(r);
    return (
      p.terra == null &&
      p.settle == null &&
      p.clutter == null &&
      p.attempted?.__flyTerraPin === 1 &&
      p.attempted?.__flySettlePin === 1 &&
      p.attempted?.__flyClutterPin === 1 &&
      p.depth === 1 // deliberately still pinned — see the header
    );
  };
  gate(
    'the un-pin TOOK on both un-pinned pages (terra/settle/clutter live, depth still ship-off)',
    unpinnedOk(manLive) && unpinnedOk(manHigh),
    `live=${JSON.stringify(pinsOf(manLive))} high=${JSON.stringify(pinsOf(manHigh))}`
  );
  if (manCtl)
    gate(
      'the CONTROL page is genuinely fleet-pinned (the R21 world)',
      pinsOf(manCtl).terra === 1 &&
        pinsOf(manCtl).settle === 1 &&
        pinsOf(manCtl).clutter === 1 &&
        pinsOf(manCtl).depth === 1,
      JSON.stringify(pinsOf(manCtl))
    );

  // (1) DEEP NIGHT everywhere.
  const allLegs = Object.values(results.legs);
  const notNight = allLegs.filter(
    (r) => !(r.census.sky.elDeg <= T.NIGHT_EL && r.census.sky.state === 'night')
  );
  gate(
    `every leg is DEEP NIGHT (trueEl <= ${T.NIGHT_EL} deg, sky state 'night')`,
    notNight.length === 0,
    notNight.length
      ? notNight.map((r) => `${r.legTag} el=${r.census.sky.elDeg} state=${r.census.sky.state}`).join(' | ')
      : allLegs.map((r) => `${r.legTag} ${r.census.sky.elDeg}°`).join(' · ')
  );

  // (3) satellite invariant.
  gate('window.__toyWorld NEVER defined in satellite', toyLive === false);

  // (4)(5)(6)(7) P-MAN, the user's world.
  const M = manLive.m;
  gate(
    `P-MAN night has a LIGHT FIELD (litFrac >= ${(T.MAN_LIT * 100).toFixed(2)}%)`,
    M.litFrac >= T.MAN_LIT,
    `${(M.litFrac * 100).toFixed(3)}% · ladder ${JSON.stringify(
      Object.fromEntries(Object.entries(M.litLadder).map(([k, v]) => [k, +(v * 100).toFixed(2)]))
    )}`
  );
  gate(
    `P-MAN light is WARM (warm share of lit >= ${(T.MAN_WARM * 100).toFixed(0)}%)`,
    M.warmLitFrac >= T.MAN_WARM,
    `warm=${(M.warmLitFrac * 100).toFixed(1)}% cool=${(M.coolLitFrac * 100).toFixed(1)}% ofBand=${(M.warmOfBand * 100).toFixed(3)}%`
  );
  gate(
    `P-MAN luma band (p95 >= ${T.MAN_P95}, p50 <= ${T.MAN_P50_MAX})`,
    M.p95 >= T.MAN_P95 && M.p50 <= T.MAN_P50_MAX,
    `p5/p50/p95/p99=${M.p5}/${M.p50}/${M.p95}/${M.p99} mean=${M.mean.toFixed(2)}`
  );
  gate(
    `P-MAN has NO white-glow slab (largest low-sat blob <= ${(T.MAN_BLOB * 100).toFixed(2)}% of band)`,
    M.whiteBlobFrac <= T.MAN_BLOB,
    `blob=${M.whiteBlobPx}px (${(M.whiteBlobFrac * 100).toFixed(4)}%) blobs=${M.whiteBlobs} ` +
      `white=${(M.whiteFrac * 100).toFixed(4)}% box=${JSON.stringify(M.whiteBlobBox)}`
  );

  // (8) P-POW.
  const W = powLive.m;
  gate(
    `P-POW suburban night is lit (litFrac >= ${(T.POW_LIT * 100).toFixed(2)}%)`,
    W.litFrac >= T.POW_LIT,
    `${(W.litFrac * 100).toFixed(3)}% houseLights=${powLive.census.night.houseLights?.placed ?? '—'}`
  );
  gate(
    `P-POW light is WARM (warm share of lit >= ${(T.POW_WARM * 100).toFixed(0)}%)`,
    W.warmLitFrac >= T.POW_WARM,
    `warm=${(W.warmLitFrac * 100).toFixed(1)}% ofBand=${(W.warmOfBand * 100).toFixed(3)}%`
  );

  // (9)(10) THE REGRESSION GATES — R22 world vs R21 world, matched tier.
  const ratioGate = (name, a, b) => {
    if (!b) return soft(name, 'control page skipped (R23_SKIP_CONTROL)');
    const d = deltaMetrics(a.m, b.m);
    const litR = b.m.litFrac > 0 ? a.m.litFrac / b.m.litFrac : null;
    const warmR = b.m.warmOfBand > 0 ? a.m.warmOfBand / b.m.warmOfBand : null;
    gate(
      name,
      litR !== null && litR >= T.RATIO_LIT && warmR !== null && warmR >= T.RATIO_WARM,
      `litFrac ${(a.m.litFrac * 100).toFixed(3)}% (R22) vs ${(b.m.litFrac * 100).toFixed(3)}% (R21) = ${litR === null ? 'n/a' : litR.toFixed(3)}x · ` +
        `warmOfBand ${(a.m.warmOfBand * 100).toFixed(3)}% vs ${(b.m.warmOfBand * 100).toFixed(3)}% = ${warmR === null ? 'n/a' : warmR.toFixed(3)}x · ` +
        `dP50=${d.dP50} dP95=${d.dP95} dMean=${d.dMean.toFixed(2)}`
    );
  };
  ratioGate(
    `P-MAN: the R22 world keeps the R21 night read (>= ${T.RATIO_LIT}x lit AND warm, tier high)`,
    manHigh,
    manCtl
  );
  ratioGate(
    `P-POW: the R22 world keeps the R21 night read (>= ${T.RATIO_LIT}x lit AND warm, tier high)`,
    powHigh,
    powCtl
  );

  // (11) THE TIER CHAIN (plan §2 H1). Same world, same pose; only the tier.
  {
    const litR = manHigh.m.litFrac > 0 ? manLive.m.litFrac / manHigh.m.litFrac : null;
    const warmR = manHigh.m.warmOfBand > 0 ? manLive.m.warmOfBand / manHigh.m.warmOfBand : null;
    gate(
      `P-MAN: the LIVE tier is not a fraction of pinned-high (>= ${T.TIER_RATIO}x lit AND warm)`,
      litR !== null && litR >= T.TIER_RATIO && warmR !== null && warmR >= T.TIER_RATIO,
      `tier live='${manLive.census.tier}' vs pinned='${manHigh.census.tier}' · ` +
        `lit ${(manLive.m.litFrac * 100).toFixed(3)}% / ${(manHigh.m.litFrac * 100).toFixed(3)}% = ${litR === null ? 'n/a' : litR.toFixed(3)}x · ` +
        `warm ${(manLive.m.warmOfBand * 100).toFixed(3)}% / ${(manHigh.m.warmOfBand * 100).toFixed(3)}% = ${warmR === null ? 'n/a' : warmR.toFixed(3)}x`
    );
    if (manLive.census.tier === manHigh.census.tier)
      anchor(
        'tier delta',
        `both legs resolved tier '${manLive.census.tier}' on THIS machine — the gate is ` +
          `vacuous here and is a live tripwire on any machine that resolves lower ` +
          `(the user's does; plan §2 H1). Governor: ${JSON.stringify(manLive.census.governor)}`
      );
  }

  // (12) OWENS — the dark control. Plan §5.1: dark AND cheap.
  const O = oweLive.m;
  gate(
    `P-OWE stays DARK (litFrac <= ${(T.OWE_LIT_MAX * 100).toFixed(2)}%, darkFrac >= ${(T.OWE_DARK_MIN * 100).toFixed(0)}%)`,
    O.litFrac <= T.OWE_LIT_MAX && O.darkFrac >= T.OWE_DARK_MIN,
    `lit=${(O.litFrac * 100).toFixed(3)}% dark=${(O.darkFrac * 100).toFixed(1)}% p50=${O.p50} p95=${O.p95}`
  );
  gate(
    `P-OWE draws <= ${T.OWE_DRAWS} (the fleet's most-defended ceiling)`,
    oweLive.census.scene.draws > 0 && oweLive.census.scene.draws <= T.OWE_DRAWS,
    `draws=${oweLive.census.scene.draws} tris=${oweLive.census.scene.tris} agl=${oweLive.census.pose?.aglM}`
  );

  // (13) P-BB — the stand-in bridge pose.
  gate(
    `P-BB low-AGL bridge pose is lit (litFrac >= ${(T.BB_LIT * 100).toFixed(2)}%) [STAND-IN POSE]`,
    bbLive.m.litFrac >= T.BB_LIT,
    `${(bbLive.m.litFrac * 100).toFixed(3)}% warm=${(bbLive.m.warmLitFrac * 100).toFixed(1)}% agl=${bbLive.census.pose?.aglM}`
  );

  // (14) errors.
  if (externalBlips.length)
    info(`${externalBlips.length} upstream (off-origin) console errors, classified not gated`);
  gate('zero APP page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  /* ─────────────────────── evidence + anchors ─────────────────────────── */
  anchor(
    'emissive audit (plan §2 H3)',
    allLegs
      .map(
        (r) =>
          `${r.legTag}: ${r.census.emissive.meshes} live emissives, ${r.census.emissive.withoutMap} WITHOUT a map`
      )
      .join(' · ')
  );
  for (const r of allLegs) {
    if (r.census.emissive.withoutMap > 0)
      info(`${r.legTag} unmapped emissives: ${JSON.stringify(r.census.emissive.worst.slice(0, 6))}`);
  }

  /* THE R22-vs-R21 STRUCTURAL DIFF, printed whether or not the ratio gates
   * ran. Pixel metrics answer "is it lit"; these answer "is the same world
   * being built". A regression that shows up here is A's, cheaply localised. */
  if (manCtl)
    anchor(
      'P-MAN structural diff (un-pinned R22 vs fleet-pinned R21, tier high)',
      `draws ${manHigh.census.scene.draws} vs ${manCtl.census.scene.draws} · ` +
        `tris ${manHigh.census.scene.tris} vs ${manCtl.census.scene.tris} · ` +
        `roads.ready ${manHigh.census.night.roads?.ready} vs ${manCtl.census.night.roads?.ready} · ` +
        `bldg.ready ${manHigh.census.night.buildings?.ready} vs ${manCtl.census.night.buildings?.ready} · ` +
        `satBldgFade ${manHigh.census.night.bldgFade} vs ${manCtl.census.night.bldgFade} · ` +
        `houseLights ${manHigh.census.night.houseLights?.placed} vs ${manCtl.census.night.houseLights?.placed} · ` +
        `cityGlow ${manHigh.census.night.cityGlow?.placed} vs ${manCtl.census.night.cityGlow?.placed} · ` +
        `live emissives ${manHigh.census.emissive.meshes} vs ${manCtl.census.emissive.meshes}`
    );

  /* THE RE-CALIBRATION BLOCK. Paste into `T` on the first run in a session that
   * can reach both tile hosts, and record the move in the ledger. Printed every
   * run so the archive-derived numbers above can never quietly become folklore. */
  console.log(
    'SUGGEST (live re-calibration, floors at ~50% of measured; see the T comment)\n' +
      `  MAN_LIT ${(manLive.m.litFrac * 0.5).toFixed(4)}  MAN_WARM ${(manLive.m.warmLitFrac * 0.5).toFixed(3)}  ` +
      `MAN_P95 ${Math.floor(manLive.m.p95 / 2)}  MAN_P50_MAX ${Math.max(20, manLive.m.p50 * 4)}  ` +
      `MAN_BLOB ${Math.max(0.001, manLive.m.whiteBlobFrac * 2).toFixed(4)}\n` +
      `  POW_LIT ${(powLive.m.litFrac * 0.5).toFixed(4)}  POW_WARM ${(powLive.m.warmLitFrac * 0.5).toFixed(3)}  ` +
      `OWE_LIT_MAX ${Math.max(0.002, oweLive.m.litFrac * 2).toFixed(4)}  ` +
      `OWE_DARK_MIN ${(oweLive.m.darkFrac * 0.8).toFixed(3)}  BB_LIT ${(bbLive.m.litFrac * 0.5).toFixed(4)}`
  );
  results.meta = {
    when: new Date().toISOString(),
    origin: DEV_ORIGIN,
    thresholds: T,
    poses: { P_MAN, P_POW, P_OWE, P_BB },
    depthEnabledInSource: depthEnabled,
    externalBlips: externalBlips.length,
    errs,
    fails,
    softs,
  };
  fs.writeFileSync(OUT('r23-c-night-alive.json'), JSON.stringify(results, null, 2));
  info('metrics written to scripts/r23-c-night-alive.json');

  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.stack || e.message);
  process.exit(1);
});
