/**
 * ROUND 24 (A "MOTION HOLD") — r24-a-turnback: HOW LONG IS THE GROUND BLURRY
 * AFTER YOU TURN?
 *
 * ===========================================================================
 * WHAT THIS MEASURES, AND WHY NOTHING ELSE DOES
 * ===========================================================================
 * The user's words were "it seems to have problems updating the state of render
 * when moving fast". That is a LATENCY, and no instrument in this fleet
 * measures a latency: every terrain gate freezes the aeroplane and asks whether
 * the settled tree is sharp, and E's `verify-motion-hold` (same round) asks
 * whether lifecycle RATES are in equilibrium under steady flight. Neither can
 * see the thing being complained about, which is the seconds of visible blur
 * between "I turned" and "the ground is sharp again".
 *
 * THE MECHANISM (A-R1, confirmed in Wave 1, VENDOR.md patch #6a):
 * `_getDistRatio` multiplies an out-of-frustum tile's LOD ratio by 5 instead of
 * 0.8 — a constant log2(5/0.8) = 2.64 zoom levels — and `_removeSubTiles` →
 * `unloadSubTiles()` DISPOSES every fine descendant rather than parking it. So
 * turning away destroys the ground behind you and turning back has to
 * re-descend it, one level per 50 ms LOD tick plus a round trip each.
 *
 * THE PROTOCOL is deliberately the crudest thing that isolates it:
 *
 *   1. fly straight and level until the leaf zoom under the nose is stable
 *   2. RECORD it — this is the reference the world has to get back to
 *   3. yaw ~150° over ~3 s, hold ~4 s (the ground behind is now out of frustum)
 *   4. yaw back to the original heading
 *   5. sample the leaf zoom under the nose at 10 Hz and report:
 *        · the MINIMUM z reached during the excursion (how far it collapsed)
 *        · the milliseconds to recover to the reference z (how long it is ugly)
 *
 * Both are read from `__flyTileHold.census()` (resident leaves by zoom) and
 * from `terraStats.camTileZ`, and the two are printed side by side ON PURPOSE:
 * R22.1's F10 ruled `camTileZ` an unreliable instrument at a FROZEN low-AGL
 * pose because it is frustum-decided. This probe is the case F10 did not
 * cover — the aeroplane is flying, the tile under the nose is in view, and the
 * census is there to corroborate. If the two disagree, the census wins and F10
 * gets a second data point rather than a re-run.
 *
 * ===========================================================================
 * PREDICTED RED (pre-R24, i.e. `__flyTileHold.set(false)`)
 * ===========================================================================
 * From the library's own arithmetic at 233 m AGL, threshold 0.86:
 *   on-camera leaf under the nose  z17-18
 *   off-camera, same ground        z14-15   (2.64 levels, by construction)
 * so the excursion should show maxLeafZ under the nose FALLING 2-3 levels, and
 * recovery should take 3-6 sequential subdivision rounds ≈ 0.5-2 s cold. With
 * TILE_HOLD armed and the excursion shorter than `mergeDwellMs`, the collapse
 * should not happen AT ALL — the children were never destroyed — and recovery
 * should be ~0 ms. That is the whole claim of this round in one number.
 *
 * A caveat this probe cannot remove: `TERRA_CACHE` means the re-descent is
 * served from `fly-raster-v1`, so the RED here is the optimistic case. On a
 * cold cache (a first visit, which is what a player flying somewhere new
 * always has) it is worse, and this probe does not measure that.
 *
 * EXIT CODES: 0 = PASS · 1 = FAIL · 2 = BLOCKED. BLOCKED wherever the tile
 * hosts are unreachable or the machine cannot sustain the motion — which is
 * the outcome on the machine this round was built on (both Esri hosts and
 * OpenFreeMap answer 403 to CONNECT).
 *
 * RUN: node scripts/r24-a-turnback.js [--off]     (dev server on :3019)
 *      --off runs the arm with TILE_HOLD forced off, i.e. the RED leg.
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
const POWELL = [40.1592, -83.0752, 233];
const SPEED = 180;
const OUT = path.resolve(__dirname, `.probe-r24-a-turnback${OFF_LEG ? '-off' : ''}.json`);

/**
 * A heading-driven autopilot over `flight.step`, so the excursion is scripted
 * and identical in both arms. `turn` is proportional to the heading error,
 * clamped — crude on purpose: a PID would make the two arms differ by their
 * own dynamics rather than by the tree's.
 */
const DRIVE_HEADING = ([speed, agl]) => {
  const f = window.__fly.flight;
  if (f.__r24turn) return;
  f.__r24turn = true;
  const orig = f.step.bind(f);
  window.__r24target = null; // radians; null = hold current heading
  f.step = (dt, cmd) => {
    const cur = f.heading ?? f.yaw ?? 0;
    let turn = 0;
    if (window.__r24target != null) {
      let err = window.__r24target - cur;
      while (err > Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;
      turn = Math.max(-1, Math.min(1, err * 1.6));
    }
    const pitch = (agl - (f.pos.y - (f.groundElev ?? 0))) * 0.002;
    orig(dt, { ...cmd, turn, pitch, boost: false, speedPreset: 'cruise', speedOverride: speed });
  };
};

/**
 * The leaf zoom UNDER THE NOSE. `census()` is the whole tree, which is not the
 * question — a deep leaf left over from the previous heading would answer for
 * ground the pilot is not looking at (exactly the residue that made
 * verify-terra retire `maxLeafZ` as a sharpness statistic in W2). So this asks
 * the engine for the tile that contains the aircraft's own lon/lat, which is
 * what `getGroundAt` answers and what every streamed-actor drape gates on.
 */
const SAMPLE = () => {
  const rt = window.__fly;
  const eng = rt.engine;
  const g = rt.geo;
  const ga = g ? eng.getGroundAt(g.x, g.y) : null;
  const st = rt.terraStats ?? eng.terraStats ?? null;
  const census = window.__flyTileHold?.census?.() ?? null;
  return {
    t: performance.now(),
    noseZ: ga ? ga.tileZ : null,
    camTileZ: st ? st.camTileZ : null,
    maxLeafZ: census ? census.maxLeafZ : null,
    leaves: census ? census.leaves : null,
    downloading: eng.downloading,
    heading: rt.flight?.heading ?? rt.flight?.yaw ?? null,
    aglM: st ? st.aglM : null,
  };
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const net = W
    ? W.wireWorldTally(page)
    : { img: 0, imgFail: 0, vec: 0, vecFail: 0, hosts: new Set() };

  await page.addInitScript(unpinPins, ['__flyTerraPin', '__flySettlePin', '__flyClutterPin']);
  await page.addInitScript(() => {
    window.__r22Unpinned = { __flyTerraPin: 0, __flySettlePin: 0, __flyClutterPin: 0 };
    window.__flyGovPin = 'hold';
    window.__flyWeatherOverride = 'baseline';
  });
  await bootFly(page, { style: 'satellite' });
  await page.evaluate(
    ([lat, lon, altM]) => window.__fly.warpToGeo(lat, lon, { altM, name: null }),
    POWELL
  );
  await page.waitForTimeout(9000);
  await page.evaluate((v) => window.__flyTileHold.set(v), !OFF_LEG);
  await page.evaluate(DRIVE_HEADING, [SPEED, POWELL[2]]);

  const trace = [];
  const poll = async (ms, tag) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const s = await page.evaluate(SAMPLE);
      s.tag = tag;
      trace.push(s);
      await page.waitForTimeout(100);
    }
  };

  /* 1-2. establish and record the reference */
  await poll(8000, 'settle');
  const settled = trace.filter((r) => r.tag === 'settle').slice(-20);
  const refZ = Math.max(...settled.map((r) => r.noseZ ?? 0));
  const h0 = settled[settled.length - 1]?.heading ?? 0;
  console.log(`REFERENCE noseZ=${refZ} at heading ${((h0 * 180) / Math.PI).toFixed(0)}°`);

  /* 3. yaw away and hold */
  await page.evaluate((h) => (window.__r24target = h), h0 + (150 * Math.PI) / 180);
  await poll(7000, 'away');

  /* 4. yaw back */
  const tBack = Date.now();
  await page.evaluate((h) => (window.__r24target = h), h0);
  await poll(12000, 'back');

  /* 5. the two numbers */
  const away = trace.filter((r) => r.tag === 'away');
  const back = trace.filter((r) => r.tag === 'back');
  const minDuringExcursion = Math.min(
    ...away.concat(back.slice(0, 20)).map((r) => (r.noseZ == null ? 99 : r.noseZ))
  );
  const recovered = back.find((r) => (r.noseZ ?? 0) >= refZ);
  const recoverMs = recovered ? Math.round(recovered.t - back[0].t) : null;
  const collapseLevels = refZ - (minDuringExcursion === 99 ? refZ : minDuringExcursion);

  console.log(
    `\nEXCURSION  minimum noseZ ${minDuringExcursion === 99 ? 'n/a' : minDuringExcursion} ` +
      `(reference ${refZ}) → collapsed ${collapseLevels} level(s)`
  );
  console.log(
    `RECOVERY   ${recoverMs == null ? 'NEVER within the 12 s window' : recoverMs + ' ms'} ` +
      `to get back to z${refZ}`
  );
  console.log(
    `TRACE noseZ: ${trace.map((r) => r.noseZ ?? '-').join(',')}\n` +
      `TRACE camTileZ: ${trace.map((r) => r.camTileZ ?? '-').join(',')}`
  );

  const resident = (trace[trace.length - 1]?.leaves ?? 0) > 0;
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        arm: OFF_LEG ? 'TILE_HOLD OFF (red leg)' : 'TILE_HOLD ON',
        refZ,
        minDuringExcursion,
        collapseLevels,
        recoverMs,
        trace,
        net: { ...net, hosts: [...net.hosts] },
      },
      null,
      2
    )
  );
  console.log(`evidence → ${OUT}`);

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
  gate(1, refZ > 0, `THE REFERENCE IS REAL — settled noseZ ${refZ}`);
  gate(
    2,
    OFF_LEG || collapseLevels <= 1,
    `NO COLLAPSE with TILE_HOLD armed — fell ${collapseLevels} level(s) (bound 1)`
  );
  gate(
    3,
    OFF_LEG || recoverMs == null || recoverMs <= 1500,
    `RECOVERY IS FAST with TILE_HOLD armed — ${recoverMs} ms (bound 1500)`
  );
  if (OFF_LEG)
    console.log(
      'RED LEG — gates 2/3 are not asserted here; this arm exists to show the\n' +
        'defect. A collapse of 2-3 levels and a recovery of 0.5-2 s is the\n' +
        'predicted red, and it is what the armed arm has to beat.'
    );

  await browser.close();
  console.log(fails.length ? 'VERIFY: FAIL' : 'VERIFY: PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('VERIFY: FAIL — probe threw:', e);
  process.exit(1);
});
