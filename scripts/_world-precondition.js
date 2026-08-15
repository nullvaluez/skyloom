/**
 * R24 (E "CERT") — THE SHARED PRECONDITION HELPER.
 *
 * Two questions every browser gate in this fleet should ask before it believes
 * its own numbers, and until now exactly ONE gate asked either of them.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS — the R24 Wave-1 certification finding, in one measured
 * example.
 * ---------------------------------------------------------------------------
 * `verify-flicker` is the fleet's flagship anti-flicker gate. Run on 2026-08-15
 * in an environment whose egress policy answers 403 to CONNECT for both tile
 * hosts, it reported:
 *
 *     scene={"sb":0,"chunks":16,"sky":0,"veg":0,"parcel":0,"lights":0}
 *     PASS (2) URBAN FLICKER — p99 ... 0.287   (bound 12)
 *     PASS (3) SUBURB FLICKER — p99 ... 0.184  (bound 12)
 *
 * Zero buildings, zero skyline, zero vegetation, zero parcel homes, zero house
 * lights — a blank grey field — and every substantive gate GREEN, by a factor
 * of 42. The only thing that stopped a clean `VERIFY: PASS` was an incidental
 * console-error gate tripping on `net::ERR_TUNNEL_CONNECTION_FAILED`. Had that
 * gate filtered network noise the way `verify-flash-guard` deliberately does,
 * the fleet would have certified an empty world as flicker-free.
 *
 * `verify-night-alive` (R23 C) already solved half of this with a world-content
 * precondition and a THIRD exit code. That mechanism was trapped inside one
 * file. This is it, lifted, plus the half R24 Wave 1 added.
 *
 * ---------------------------------------------------------------------------
 * THE SECOND HALF — MACHINE HONESTY, and the arithmetic that forced it.
 * ---------------------------------------------------------------------------
 * A gate that says "fly fast for 60 seconds" is asserting about WALL CLOCK.
 * The app is not.  `components/fly/FlyScene.jsx` clamps the simulation step:
 *
 *     const dt = Math.min(delta, 0.05);      // FlyScene.jsx:1538
 *
 * So each rendered frame advances the world by AT MOST 50 ms of simulated
 * time, no matter how long the frame actually took. On a machine rendering at
 * ~1 fps the simulation therefore runs at 0.05 / 1.33 ≈ 3.8 % of real time, and
 * a "sustained fast leg" traverses almost no ground while reporting green.
 *
 * MEASURED, twice, on the R24 Wave-1 machine (SwiftShader, no GPU):
 *
 *   run 1   52 frames /  69 s   speed 182→265 m/s   distance  615 m
 *           predicted 52 × 0.05 × ~235 m/s = 611 m      → within 1 %
 *   run 2  104 frames /  81 s   speed 182→333 m/s   distance 1287 m
 *           predicted 104 × 0.05 × ~250 m/s = 1300 m     → within 1 %
 *
 * Two independent runs, both matching the clamp arithmetic to 1 %. The lesson
 * is not "that machine is slow"; it is that **distance covered is a function of
 * FRAME COUNT, not of elapsed seconds**, so a motion gate must assert on metres
 * of ground crossed and refuse to grade itself below an fps floor. R22.1 §7.2.4
 * (F15) already caught four instruments being load-decided; this is the same
 * lesson with a number attached.
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT
 * ---------------------------------------------------------------------------
 * Exit codes, matching verify-night-alive and scripts/r23-c-preflight.js so a
 * sweep script can treat all three identically:
 *
 *     0 = VERIFY: PASS      1 = VERIFY: FAIL      2 = VERIFY: BLOCKED
 *
 * A close sweep must read exit 2 as "NOT RUN" — never as green, never as a
 * product red.
 *
 * The two checks are exported SEPARATELY and compose freely: a frozen-pose gate
 * wants only the world check; a motion gate wants both.
 *
 *   const W = require('./_world-precondition');
 *   const net = W.wireWorldTally(page);          // before any navigation
 *   ...
 *   const world = W.checkWorldContent(net, { resident: scene.chunks > 0 });
 *   if (!world.ok) W.exitBlocked(world.report, { browser });
 *
 *   const machine = W.checkMachineHonesty({ frames, wallMs, distanceM });
 *   if (!machine.ok) W.exitBlocked(machine.report, { browser });
 */

/** Default floors. Deliberately loose — these mark "not measurable", not "bad". */
const DEFAULTS = {
  /** Below this the dt clamp dominates and a timed leg tests almost nothing. */
  minFps: 10,
  /** A motion leg that crossed less ground than this never left its tile. */
  minDistanceM: 3000,
  /** The app's own simulation clamp (FlyScene.jsx:1538). Not a knob — a fact. */
  dtClampS: 0.05,
};

/* ══════════════════════════════ CHECK 1 — THE WORLD ══════════════════════ */

/**
 * Attach an upstream-tile tally to a Playwright page. Call BEFORE navigation.
 * Lifted from verify-night-alive's `wireErrors`, unchanged in behaviour.
 *
 * @param {import('playwright').Page} page
 * @param {object} [net] existing tally to accumulate into (multi-page gates)
 * @returns {{img:number,imgFail:number,vec:number,vecFail:number,hosts:Set<string>}}
 */
function wireWorldTally(page, net) {
  const t = net ?? { img: 0, imgFail: 0, vec: 0, vecFail: 0, hosts: new Set() };
  const classify = (url) =>
    /World_Imagery|Terrain3D|arcgisonline|elevation3d/.test(url)
      ? 'img'
      : /openfreemap|\.pbf(\?|$)/.test(url)
        ? 'vec'
        : null;
  page.on('response', (r) => {
    const k = classify(r.url());
    if (!k) return;
    if (r.status() >= 200 && r.status() < 300) t[k] += 1;
    else {
      t[`${k}Fail`] += 1;
      try {
        t.hosts.add(new URL(r.url()).host);
      } catch {
        /* unparseable url — the count is what matters */
      }
    }
  });
  page.on('requestfailed', (r) => {
    const k = classify(r.url());
    if (!k) return;
    t[`${k}Fail`] += 1;
    try {
      t.hosts.add(new URL(r.url()).host);
    } catch {
      /* as above */
    }
  });
  return t;
}

/**
 * Did the world actually stream?
 *
 * `resident` is the caller's own in-scene evidence — a chunk/ready count read
 * off the engines. It is REQUIRED as a separate term rather than inferred from
 * the network tally because a 200 is not content: R19's `d5076d0` postmortem is
 * the standing precedent that an upstream can fail INSIDE a 200, and a warm
 * Cache API hit is content with no network at all (`caches.match()` is not a
 * fetch, so Playwright sees no request — verify-seam's own §8b note).
 * So: content is present if the engines hold some, OR if both hosts answered.
 *
 * @param {object} net tally from wireWorldTally
 * @param {{resident?:boolean, requireBoth?:boolean}} [opts]
 *        resident      — caller's in-scene evidence that content exists
 *        requireBoth   — demand imagery AND vector (default true; a
 *                        vector-only gate may relax it, and must say so)
 */
function checkWorldContent(net, opts = {}) {
  const { resident = false, requireBoth = true } = opts;
  const gotImg = net.img > 0;
  const gotVec = net.vec > 0;
  const network = requireBoth ? gotImg && gotVec : gotImg || gotVec;
  const ok = resident || network;
  const hosts = [...(net.hosts ?? [])];
  const line =
    `WORLD tiles: imagery ${net.img} ok / ${net.imgFail} failed · ` +
    `vector ${net.vec} ok / ${net.vecFail} failed · content resident: ${resident}` +
    (hosts.length ? ` · unreachable hosts: ${hosts.join(', ')}` : '');
  const report = ok
    ? line
    : line +
      '\nBLOCKED the world never streamed — imagery and/or vector tiles are unreachable from ' +
      'this session, so every metric above describes the NETWORK, not the product. ' +
      'Diagnose with: node scripts/r23-c-preflight.js (10 s, no browser), or ' +
      'curl -sS "$HTTPS_PROXY/__agentproxy/status" — a 403 to CONNECT is an egress policy ' +
      'denial: report the blocked host, do not route around it. Measurements taken under a ' +
      'blockade are evidence of the blockade, NOT a product baseline.';
  return { ok, kind: 'world', net, resident, line, report };
}

/* ═════════════════════════ CHECK 2 — THE MACHINE ═════════════════════════ */

/**
 * The distance a leg CAN cover on this machine, given the dt clamp.
 * Exposed so a gate can print the prediction beside the measurement (the two
 * matched to 1 % across both R24 Wave-1 runs — see the header).
 */
function predictedDistanceM(frames, speedMs, dtClampS = DEFAULTS.dtClampS) {
  return frames * dtClampS * speedMs;
}

/**
 * Is this machine fast enough for a TIMED motion leg to mean anything?
 *
 * Both terms matter and neither implies the other: a machine can clear the fps
 * floor and still cover no ground (a gate that forgot to set a speed), and a
 * short slow leg can cover distance if the speed is high enough. A gate that
 * only flies a fixed pose should not call this at all.
 *
 * @param {{frames:number, wallMs:number, distanceM:number, speedMs?:number}} m
 * @param {{minFps?:number, minDistanceM?:number, dtClampS?:number}} [opts]
 */
function checkMachineHonesty(m, opts = {}) {
  const minFps = opts.minFps ?? DEFAULTS.minFps;
  const minDistanceM = opts.minDistanceM ?? DEFAULTS.minDistanceM;
  const dtClampS = opts.dtClampS ?? DEFAULTS.dtClampS;
  const fps = m.wallMs > 0 ? (m.frames * 1000) / m.wallMs : 0;
  const okFps = fps >= minFps;
  const okDist = m.distanceM >= minDistanceM;
  const ok = okFps && okDist;
  const pred =
    m.speedMs != null ? predictedDistanceM(m.frames, m.speedMs, dtClampS) : null;
  const line =
    `MACHINE: ${m.frames} frames / ${(m.wallMs / 1000).toFixed(1)} s = ` +
    `${fps.toFixed(2)} fps (floor ${minFps}) · ground covered ` +
    `${Math.round(m.distanceM)} m (floor ${minDistanceM})` +
    (pred != null ? ` · dt-clamp prediction ${Math.round(pred)} m` : '');
  const why = [];
  if (!okFps) why.push(`fps ${fps.toFixed(2)} < ${minFps}`);
  if (!okDist) why.push(`distance ${Math.round(m.distanceM)} m < ${minDistanceM} m`);
  const report = ok
    ? line
    : line +
      `\nBLOCKED this machine cannot grade a timed motion leg (${why.join('; ')}). ` +
      `The app clamps its simulation step to ${dtClampS} s per rendered frame ` +
      '(FlyScene.jsx:1538), so ground covered is a function of FRAME COUNT, not of ' +
      'elapsed seconds: at ~1 fps a 60 s "fast leg" crosses about a kilometre and ' +
      'exercises almost no streaming. Measured twice on the R24 Wave-1 machine — ' +
      '615 m in 69 s and 1287 m in 81 s, both within 1 % of the clamp prediction. ' +
      'A green here would be a statement about the renderer, not about the world.';
  return { ok, kind: 'machine', fps, distanceM: m.distanceM, predictedM: pred, line, report };
}

/* ═══════════════════════════════ EXIT PATH ═══════════════════════════════ */

/**
 * Print the BLOCKED report and leave with code 2. Closes the browser if given.
 * Never throws: a precondition must not turn into the failure it is preventing.
 *
 * ---------------------------------------------------------------------------
 * GATE-OUTPUT HYGIENE — why any JSON written here is STAMPED.
 * ---------------------------------------------------------------------------
 * Harness artifacts under `scripts/` are TRACKED (750 .json/.png at R24), and
 * a gate rewrites them in place on every run. So a run under a blockade
 * silently REPLACES a previous round's recorded evidence with network noise
 * that looks exactly like it: the R24 Wave-1 sweep overwrote
 * `scripts/r23-c-night-alive.json` (R23's own blockade record) and
 * `scripts/r21-e-red-flicker.json` (R21's frozen red) before the tree was
 * restored with `git checkout -- scripts/`.
 *
 * `.gitignore` is NOT the fix — these paths are already tracked, so ignoring
 * them changes nothing without an untrack, and restructuring output dirs is
 * explicitly deferred (R23's per-round-output-dirs follow-up stays a seed).
 * The cheap honest fix is that a blockade-era artifact must SAY SO in its own
 * bytes, so a reader — or a future `git diff` — can tell evidence from noise
 * without consulting a ledger. Every JSON written on this path carries
 * `_blockade`. Anything holding that key is NOT a product baseline.
 *
 * The standing advice for a blocked session remains: run
 * `node scripts/r23-c-preflight.js` FIRST (10 s, no browser), and if it says
 * NO-GO, restore the tree afterwards rather than committing the churn.
 */
async function exitBlocked(report, opts = {}) {
  const { browser = null, json = null, label = '' } = opts;
  console.log(report);
  if (json) {
    try {
      const stamped = {
        _blockade: {
          note:
            'WRITTEN UNDER A PRECONDITION BLOCKADE — this file is evidence of the ' +
            'blockade, NOT a product baseline. Do not commit it over a previous ' +
            "round's recorded evidence; restore with: git checkout -- scripts/",
          when: new Date().toISOString(),
          label: label || null,
        },
        ...json.data,
      };
      require('fs').writeFileSync(json.path, JSON.stringify(stamped, null, 2));
    } catch {
      /* evidence is best-effort; the exit code is the contract */
    }
  }
  if (browser) {
    try {
      await browser.close();
    } catch {
      /* as above */
    }
  }
  console.log(
    `VERIFY: BLOCKED${label ? ` (${label})` : ' (precondition not met — gates not evaluated)'}`
  );
  process.exit(2);
}

module.exports = {
  DEFAULTS,
  wireWorldTally,
  checkWorldContent,
  checkMachineHonesty,
  predictedDistanceM,
  exitBlocked,
};
