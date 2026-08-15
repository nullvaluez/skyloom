/**
 * ROUND 24 (A "MOTION HOLD") — r24-a-f11: WAS THE GROUND DESTROYED, OR IS THE
 * NODE BRICKED?
 *
 * ===========================================================================
 * THE QUESTION
 * ===========================================================================
 * R22.1 close-ledger **F11**: "a second visit to a pose does not re-refine,
 * with the loader IDLE." Agent D measured it and recorded it honestly as
 * unexplained — returning to P-LEWIS 20 s after leaving left the tile under the
 * camera at z13 with `downloading = 0`, zero DEM requests issued for the whole
 * leg, while `maxLeafZ` stayed 18. D's words: "the tree declined to come back."
 *
 * R24 Wave 1 found TWO mechanisms that both produce exactly that observation,
 * and they need completely different fixes:
 *
 *   CANDIDATE A — IT WAS DESTROYED (patch #6a's defect).
 *     `_getDistRatio` ×5 out of frustum ⇒ the z18 subtree was MERGED away the
 *     moment the probe flew to the other pose, and `unloadSubTiles()` disposed
 *     it. On return the region genuinely is at z13 and must re-descend. The
 *     `maxLeafZ 18` D saw was residue from the *other* pose, not this one.
 *
 *   CANDIDATE B — IT IS BRICKED (patch #7's defect).
 *     A rejection inside `_loadSubTiles` left `_subTiles` set, and LOD()'s
 *     `!this.subTiles` guard then means that node can NEVER refine again for
 *     the life of the session — permanently, silently, with the loader idle and
 *     no requests issued, which is word-for-word D's observation.
 *
 * ===========================================================================
 * ONE COUNTER SEPARATES THEM, AND IT NEEDS NO VENDORED EDIT
 * ===========================================================================
 * three-tile dispatches `tile-unload` on the root tile and re-dispatches on the
 * map. So: tally unloads, FILTERED TO THE FIRST POSE'S TILE FOOTPRINT, during
 * the detour.
 *
 *   unloads inside the footprint > 0  ⇒ CANDIDATE A. The tree threw it away.
 *                                       Fixed by TILE_HOLD.mergeDwellMs.
 *   unloads inside the footprint == 0
 *     and the region will not descend  ⇒ CANDIDATE B. Corroborated by
 *                                       `__flyStats.tileHold.hold.rejectLoad`
 *                                       and by an unhandledrejection count,
 *                                       both of which patch #7 makes visible
 *                                       for the first time.
 *
 * Note what this design refuses to do: it does not try to distinguish them by
 * how BLURRY the result looks, because both look identical. The distinction is
 * a lifecycle fact, and the library already publishes it.
 *
 * ===========================================================================
 * WHY THE ARMED ARM IS ALSO RUN
 * ===========================================================================
 * If F11 is candidate A, then `TILE_HOLD` should make it mostly disappear for
 * short detours (the subtree survives the dwell) and merely soften it for long
 * ones (a 20 s detour is ten times a 2 s dwell — the merge is DELAYED, never
 * cancelled, which is exactly the property that keeps the frozen fleet green).
 * So a green armed arm here is NOT expected on D's original 20 s detour, and
 * this probe therefore runs BOTH a short detour (inside the dwell) and a long
 * one (past it). Reporting "R24 fixed F11" off the short detour alone would be
 * the kind of claim this round exists to stop making.
 *
 * EXIT CODES: 0 = PASS · 1 = FAIL · 2 = BLOCKED. On the machine this round was
 * built on it is BLOCKED: both Esri hosts and OpenFreeMap answer 403 to
 * CONNECT, so no tile lifecycle exists to count.
 *
 * RUN: node scripts/r24-a-f11.js [--off]          (dev server on :3019)
 *
 * ⚠ STATUS: UNEXERCISED — never run, not even to its BLOCKED path (no
 * playwright on the build machine; both tile hosts 403 at CONNECT). node
 * --check clean, page-side API verified against source. R20 §5: a brand-new
 * harness is itself a red until it has run. Expect to debug it first.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly, unpinPins } = require('./_boot');

let W = null;
try {
  W = require('./_world-precondition');
} catch {
  /* pre-commit fallback below */
}

const OFF_LEG = process.argv.includes('--off');
/** D's own pose pair (r22p1-close.md §3.1): P-LEWIS, and Powell as the detour. */
const P_LEWIS = [40.1937, -83.0299, 400];
const POWELL = [40.1592, -83.0752, 400];
const OUT = path.resolve(__dirname, `.probe-r24-a-f11${OFF_LEG ? '-off' : ''}.json`);

/**
 * Tally unloads, keyed by tile, so the tally can afterwards be FILTERED to the
 * footprint of the pose we care about. Filtering after the fact rather than
 * during means the footprint can be computed from what was actually resident at
 * the first visit rather than from a guessed bounding box.
 */
const ARM = () => {
  const m = window.__fly.engine.map;
  if (m.__r24f11) return;
  m.__r24f11 = { unloads: [], loads: [] };
  m.addEventListener('tile-unload', (e) => {
    const t = e.tile;
    if (t) m.__r24f11.unloads.push({ z: t.z, x: t.x, y: t.y, t: performance.now() });
  });
  m.addEventListener('tile-loaded', (e) => {
    const t = e.tile;
    if (t) m.__r24f11.loads.push({ z: t.z, x: t.x, y: t.y, t: performance.now() });
  });
  window.__r24rejections = 0;
  window.addEventListener('unhandledrejection', () => window.__r24rejections++);
};

/** Every resident leaf, as z/x/y — the footprint the detour will be judged on. */
const FOOTPRINT = () => {
  const out = [];
  window.__fly.engine.map.traverse((o) => {
    if (o.isTile && o.children.length <= 1) out.push(`${o.z}/${o.x}/${o.y}`);
  });
  return out;
};

const SNAP = () => {
  const rt = window.__fly;
  const eng = rt.engine;
  const g = rt.geo;
  const ga = g ? eng.getGroundAt(g.x, g.y) : null;
  const m = eng.map;
  return {
    t: performance.now(),
    noseZ: ga ? ga.tileZ : null,
    downloading: eng.downloading,
    census: window.__flyTileHold?.census?.() ?? null,
    hold: window.__flyStats?.tileHold?.hold
      ? { ...window.__flyStats.tileHold.hold }
      : null,
    raster: window.__flyStats?.raster ? { ...window.__flyStats.raster } : null,
    rejections: window.__r24rejections ?? 0,
    unloads: m.__r24f11 ? m.__r24f11.unloads.length : 0,
    loads: m.__r24f11 ? m.__r24f11.loads.length : 0,
  };
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  // ONE context for the whole run: the Cache API is context-scoped, and the
  // entire point of a SECOND VISIT is that the tiles are already in
  // `fly-raster-v1`. A fresh context would make the leg a first visit and the
  // probe vacuous — verify-terra gate (9) learned this the same way.
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const net = W
    ? W.wireWorldTally(page)
    : { img: 0, imgFail: 0, vec: 0, vecFail: 0, hosts: new Set() };
  const reqs = { img: 0, dem: 0 };
  page.on('request', (r) => {
    const u = r.url();
    if (/World_Imagery/.test(u)) reqs.img++;
    else if (/Terrain3D|elevation3d/.test(u)) reqs.dem++;
  });

  await page.addInitScript(unpinPins, ['__flyTerraPin', '__flySettlePin', '__flyClutterPin']);
  await page.addInitScript(() => {
    window.__r22Unpinned = { __flyTerraPin: 0, __flySettlePin: 0, __flyClutterPin: 0 };
    window.__flyGovPin = 'hold';
    window.__flyWeatherOverride = 'baseline';
  });
  await bootFly(page, { style: 'satellite' });
  await page.evaluate((v) => window.__flyTileHold.set(v), !OFF_LEG);
  await page.evaluate(ARM);

  const warp = async (p) => {
    await page.evaluate(
      ([lat, lon, altM]) => window.__fly.warpToGeo(lat, lon, { altM, name: null }),
      p
    );
    await page.waitForTimeout(12000); // settle: the descent, then quiet
  };

  const rounds = [];
  /**
   * One visit/detour/return cycle. `detourMs` is the whole experiment: short is
   * inside `mergeDwellMs` (the subtree should survive), long is far past it
   * (the merge is delayed, not cancelled — so it should NOT survive, and saying
   * so is the honest half of this probe).
   */
  const cycle = async (label, detourMs) => {
    await warp(P_LEWIS);
    const first = await page.evaluate(SNAP);
    const footprint = await page.evaluate(FOOTPRINT);
    const markUnloads = first.unloads;
    const markImg = reqs.img;
    const markDem = reqs.dem;

    await page.evaluate(
      ([lat, lon, altM]) => window.__fly.warpToGeo(lat, lon, { altM, name: null }),
      POWELL
    );
    await page.waitForTimeout(detourMs);

    // Back, and this time count what the RETURN leg costs.
    const beforeReturn = { img: reqs.img, dem: reqs.dem };
    await warp(P_LEWIS);
    const second = await page.evaluate(SNAP);

    const all = await page.evaluate(() => window.__fly.engine.map.__r24f11.unloads);
    const fp = new Set(footprint);
    const inFootprint = all
      .slice(markUnloads)
      .filter((u) => fp.has(`${u.z}/${u.x}/${u.y}`));

    const row = {
      label,
      detourMs,
      firstNoseZ: first.noseZ,
      secondNoseZ: second.noseZ,
      footprintTiles: footprint.length,
      unloadsInFootprintDuringDetour: inFootprint.length,
      returnLegRequests: { img: reqs.img - beforeReturn.img, dem: reqs.dem - beforeReturn.dem },
      wholeCycleRequests: { img: reqs.img - markImg, dem: reqs.dem - markDem },
      downloadingAtSecond: second.downloading,
      rejections: second.rejections,
      rejectLoad: second.hold?.rejectLoad ?? null,
      rejectMerge: second.hold?.rejectMerge ?? null,
      raster: second.raster,
      verdict: null,
    };
    // THE ADJUDICATION, stated by the probe rather than left to a reader.
    if (row.secondNoseZ != null && row.firstNoseZ != null && row.secondNoseZ >= row.firstNoseZ)
      row.verdict = 'NO F11 — the region came back to its first-visit zoom';
    else if (row.unloadsInFootprintDuringDetour > 0)
      row.verdict = 'CANDIDATE A — the tree DESTROYED it (TILE_HOLD.mergeDwellMs is the fix)';
    else if ((row.rejectLoad ?? 0) > 0 || row.rejections > 0)
      row.verdict = 'CANDIDATE B — a rejection BRICKED a node (TILE_HOLD.unlockOnReject is the fix)';
    else
      row.verdict =
        'NEITHER — nothing was unloaded and nothing rejected, yet it did not descend. ' +
        'This is a THIRD mechanism and it is unowned: capture and escalate.';
    rounds.push(row);
    console.log(
      `\n${label} (detour ${detourMs} ms)\n` +
        `  first visit noseZ ${row.firstNoseZ} → second visit noseZ ${row.secondNoseZ}\n` +
        `  footprint ${row.footprintTiles} leaves · unloaded from it during the detour: ` +
        `${row.unloadsInFootprintDuringDetour}\n` +
        `  return leg requests img ${row.returnLegRequests.img} / dem ${row.returnLegRequests.dem} · ` +
        `downloading at settle ${row.downloadingAtSecond}\n` +
        `  rejectLoad ${row.rejectLoad} · unhandledrejection ${row.rejections}\n` +
        `  VERDICT: ${row.verdict}`
    );
    return row;
  };

  const short = await cycle('SHORT detour (inside mergeDwellMs)', 1500);
  const long = await cycle("LONG detour (D's original, past the dwell)", 20000);

  const resident = (short.footprintTiles ?? 0) > 0;
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      { arm: OFF_LEG ? 'TILE_HOLD OFF (red leg)' : 'TILE_HOLD ON', rounds, net: { ...net, hosts: [...net.hosts] } },
      null,
      2
    )
  );
  console.log(`\nevidence → ${OUT}`);

  const world = W
    ? W.checkWorldContent(net, { resident })
    : { ok: resident, report: `WORLD img=${net.img} vec=${net.vec} resident=${resident}` };
  if (!world.ok) {
    if (W) return W.exitBlocked(world.report, { browser, label: 'tile hosts unreachable' });
    console.log(world.report + '\nVERIFY: BLOCKED (tile hosts unreachable)');
    await browser.close();
    process.exit(2);
  }

  const fails = [];
  const gate = (n, ok, d) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} (${n}) ${d}`);
    if (!ok) fails.push(n);
  };
  gate(1, short.footprintTiles > 0 && short.firstNoseZ != null, `THE FIRST VISIT IS REAL — ${short.footprintTiles} leaves, noseZ ${short.firstNoseZ}`);
  gate(
    2,
    OFF_LEG || short.unloadsInFootprintDuringDetour === 0,
    `SHORT DETOUR SURVIVES with TILE_HOLD armed — ${short.unloadsInFootprintDuringDetour} footprint tiles unloaded (bound 0)`
  );
  gate(
    3,
    short.verdict != null && long.verdict != null,
    `F11 IS ADJUDICATED, both detours — short: ${short.verdict.split('—')[0].trim()} · long: ${long.verdict.split('—')[0].trim()}`
  );
  gate(
    4,
    (short.rejectLoad ?? 0) === 0 && (long.rejectLoad ?? 0) === 0 && short.rejections === 0,
    `NO NODE WAS BRICKED — rejectLoad ${short.rejectLoad}/${long.rejectLoad}, unhandledrejection ${short.rejections}`
  );
  console.log(
    '\nNOTE the LONG detour is NOT expected to be clean with TILE_HOLD armed: the\n' +
      'dwell DELAYS a merge, it never cancels one, and 20 s is ten dwells. That is\n' +
      'the same property that keeps every frozen gate green, so it is a design\n' +
      'consequence and not a shortfall — but it does mean F11 on a long absence is\n' +
      'only softened by this round, not closed. Closing it is frustumPenalty (a\n' +
      'shallower collapse) or an explicit LRU park, and both are R25.'
  );

  await browser.close();
  console.log(fails.length ? 'VERIFY: FAIL' : 'VERIFY: PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('VERIFY: FAIL — probe threw:', e);
  process.exit(1);
});
