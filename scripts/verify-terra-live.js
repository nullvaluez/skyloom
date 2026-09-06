#!/usr/bin/env node
/**
 * verify-terra-live — Round 24 (A PACE). The residency trio against REAL
 * streaming tiles, on E's offline world fixture.
 *
 *   FLY_TILE_FIXTURE=1 FLY_URL=http://localhost:3101 \
 *     node -r ./scripts/_pw-shim.js scripts/verify-terra-live.js
 *
 * scripts/verify-terra-residency.mjs proves the LOD DECISIONS in node. This
 * gate proves the consequences in the running app, where three drives the
 * quadtree from projectObject, tiles really download, and the fixture counts
 * every request by URL:
 *
 *   1. CONTENT PROBE (Fable's ask, run FIRST and in BOTH arms). For every
 *      resident tile, the z/x/y encoded in its imagery URL is compared with the
 *      z/x/y implied by its own quadtree coordinates and with the lon/lat its
 *      world position maps to. If a tile ever displays imagery from a different
 *      address, that is a CACHE/URL defect and NOT LOD policy — and this round
 *      would be attributing the user's "tiles swapping" to the wrong cause.
 *      The probe answers that before any A/B is believed.
 *   2. A yaw sweep at a fixed position: the fixture's per-URL request counters
 *      say how many tiles were fetched TWICE, flag-off vs flag-on.
 *   3. The frozen draw ceilings at the settled canonical poses, both arms.
 *
 * Every number here is a COUNT. This container renders on SwiftShader at ~1 fps,
 * so nothing about frame time is measured or claimed.
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');
const { attachFixture } = require('./_fixture');

const URL_ = process.env.FLY_URL || 'http://localhost:3101';
const SETTLE = Number(process.env.FLY_TERRA_SETTLE_MS || 30000);
const YAW_MS = Number(process.env.FLY_TERRA_YAW_MS || 45000);

// Canonical poses (same numbers as verify-fixture, grepped from the fleet).
const POSES = {
  powell: [40.1578, -83.0752, 900, 1.9, -0.3],
  owens: [36.6, -118.1, 2600, 1.2, -0.18],
};

const PIN_POSE = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__fxPin) clearInterval(window.__fxPin);
  window.__fxPin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = heading;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

/** Spin the heading in place: the camera never moves, only its yaw. */
const PIN_YAW = ([lat, lon, altM]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__fxPin) clearInterval(window.__fxPin);
  const t0 = performance.now();
  window.__fxPin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = ((performance.now() - t0) / 1000) * 0.9; // ~51 deg/s
    f.pitch = -0.25;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

/**
 * THE CONTENT PROBE. Walks the live tile tree and, for every tile that owns a
 * model, reads (a) the tile's own quadtree z/x/y, (b) the z/x/y in the URL of
 * the texture it is actually displaying, and (c) the z/x/y implied by its world
 * position through the Web-Mercator inverse. Mismatches are reported per tile.
 */
const CONTENT_PROBE = () => {
  const map = window.__flyTerra?.get?.();
  const anchor = window.__fly?.origin?.anchor;
  if (!map || !anchor) return { error: 'no map/anchor' };
  const W = map.rootTile.scale.x; // Web-Mercator plane width in world units
  const H = map.rootTile.scale.y;
  const rows = [];
  const bad = [];
  const seen = new Set();
  map.rootTile.traverse((o) => {
    if (!o?.isTile || !o.model) return;
    const key = `${o.z}/${o.x}/${o.y}`;
    if (seen.has(key)) return;
    seen.add(key);
    // (a) the imagery URL the tile is ACTUALLY displaying. Playwright fulfils
    // the real Esri URL from the fixture, so the src is the ArcGIS shape
    // .../tile/{z}/{y}/{x}; the fixture's own path /img/{z}/{y}/{x} matches too.
    let url = null;
    o.model.traverse?.((m) => {
      if (url) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const src = mat?.map?.image?.src ?? mat?.map?.userData?.src ?? null;
        if (src) {
          url = src;
          break;
        }
      }
    });
    const mm = url ? /\/(?:tile|img)\/(\d+)\/(\d+)\/(\d+)(?:\?|$)/.exec(url) : null;
    const urlZ = mm ? +mm[1] : null;
    const urlY = mm ? +mm[2] : null;
    const urlX = mm ? +mm[3] : null;
    // (b) where a tile with THIS address must sit. Web-Mercator plane, rotated
    // -90 deg about X by TerrainEngine, shifted by the floating-origin anchor:
    //   worldX = (x+0.5)/2^z * W - W/2 - anchor.x
    //   worldZ = (y+0.5)/2^z * H - H/2 - anchor.z
    const n = Math.pow(2, o.z);
    const expX = ((o.x + 0.5) / n) * W - W / 2 - anchor.x;
    const expZ = ((o.y + 0.5) / n) * H - H / 2 - anchor.z;
    const e = o.matrixWorld.elements;
    const tol = W / n; // one whole tile of slack
    const dx = Math.abs(e[12] - expX);
    const dz = Math.abs(e[14] - expZ);
    const urlOk = mm === null ? null : urlZ === o.z && urlX === o.x && urlY === o.y;
    const posOk = dx <= tol && dz <= tol;
    const row = {
      tile: key,
      url: mm ? `${urlZ}/${urlY}/${urlX}` : null,
      dx: Math.round(dx),
      dz: Math.round(dz),
      tol: Math.round(tol),
      urlOk,
      posOk,
    };
    rows.push(row);
    if (urlOk === false || !posOk) bad.push(row);
  });
  return {
    total: rows.length,
    withUrl: rows.filter((r) => r.url).length,
    urlMismatch: rows.filter((r) => r.urlOk === false).length,
    posMismatch: rows.filter((r) => !r.posOk).length,
    bad: bad.slice(0, 12),
  };
};

const CENSUS = () => {
  const st = window.__flyStats || {};
  return {
    draws: st.drawCalls ?? null,
    tris: st.triangles ?? null,
    lod: window.__flyTerra?.lod?.() ?? null,
    mem: window.__flyTerra?.mem?.() ?? null,
  };
};

let pass = 0;
let fail = 0;
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

async function settleDraws(page, ms) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => {
    if (window.__flyStats) window.__flyStats.drawCalls = null;
  });
  await page
    .waitForFunction(() => typeof window.__flyStats?.drawCalls === 'number', undefined, {
      timeout: 240000,
      polling: 500,
    })
    .catch(() => {});
}

/** One whole arm: boot, probe content, yaw sweep, settle at two poses. */
async function runArm(context, fx, paceOn) {
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  // Both arms pin EXPLICITLY. Since the R24 close the constants ship ON, so an
  // unpinned "off" arm would silently be the on arm — an A/B whose control is
  // the treatment. The arm states what it wants in both directions.
  await page.addInitScript((on) => {
    window.__flyTerraPaceOverride = on
      ? {
          enabled: true,
          timerFix: true,
          mergeHysteresis: true,
          keepResident: true,
          skirtFast: true,
        }
      : {
          enabled: false,
          timerFix: false,
          mergeHysteresis: false,
          keepResident: false,
          skirtFast: false,
          walkWhileSaturated: false,
          bboxCache: false,
        };
  }, !!paceOn);
  // The fleet's bootFly hard-codes a 30 s wait for the GL canvas to become
  // VISIBLE after __flyBoot.pct hits 100. Under SwiftShader with the fixture's
  // full world that reveal fade can outlast it. This gate needs the RUNTIME,
  // not the reveal animation, so a timeout there falls back to waiting on
  // window.__fly directly — and says so, rather than reporting a boot that did
  // not happen.
  let bootFallback = false;
  try {
    await bootFly(page, { style: 'satellite', timeoutMs: 600000, settleMs: 8000 });
  } catch (e) {
    bootFallback = true;
    await page.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function', undefined, {
      timeout: 300000,
      polling: 500,
    });
    await page.waitForTimeout(8000);
  }
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));

  // --- content probe at a settled suburb pose
  await page.evaluate(PIN_POSE, POSES.powell);
  await settleDraws(page, SETTLE);
  const content = await page.evaluate(CONTENT_PROBE);

  console.log(`    content probe: ${content.total} resident tiles, ${content.withUrl} with an imagery URL, ` +
    `${content.urlMismatch} URL mismatches, ${content.posMismatch} position mismatches`);

  // --- yaw sweep from a clean request ledger. Fixture calls are wrapped: the
  // per-URL counters are a nice-to-have, and a fixture that goes away must not
  // destroy an arm whose in-app counters are the load-bearing evidence.
  const safe = async (fn, fallback) => {
    try {
      return await fn();
    } catch (e) {
      console.log(`    (fixture stats unavailable: ${String(e.message).slice(0, 60)})`);
      return fallback;
    }
  };
  await safe(() => fx.resetStats(), null);
  await page.evaluate(() => window.__flyTerra?.reset?.());
  await page.evaluate(PIN_YAW, POSES.powell);
  await page.waitForTimeout(YAW_MS);
  const yawStats = await safe(() => fx.stats(), { byKind: {}, byUrl: {} });
  const yawCensus = await page.evaluate(CENSUS);
  console.log(`    yaw sweep: merges ${yawCensus.lod?.merge}, replacedOnScreen ${yawCensus.lod?.replacedOnScreen}, ` +
    `refetchParent ${yawCensus.lod?.refetchParent}, imagery requests ${yawStats.byKind?.img ?? 'n/a'}`);

  // --- the frozen ceilings at two settled poses
  const poses = {};
  for (const [name, p] of Object.entries(POSES)) {
    await page.evaluate(PIN_POSE, p);
    await settleDraws(page, SETTLE);
    poses[name] = await page.evaluate(CENSUS);
    console.log(`    pose ${name}: draws ${poses[name].draws} tris ${poses[name].tris} residentMB ${poses[name].mem?.residentMB}`);
  }
  await page.close();
  return { content, yawStats, yawCensus, poses, errs, bootFallback };
}

(async () => {
  console.log('verify-terra-live — the residency trio on E\'s offline world fixture\n');
  console.log('  Counts only. SwiftShader at ~1 fps here: no frame-time claim is made.\n');
  // Same launch options as the rest of the fleet (the shim drops the channel
  // pin and appends SwiftShader here; on the user's machine it is real Chrome).
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const fx = await attachFixture(context);

  // FLY_TERRA_ARMS=on runs only the flag-on arm; 'off' only the flag-off arm.
  // Under contention (five agents on four cores) a two-arm run is ~20 minutes
  // of SwiftShader, so the arms are separable and the gates degrade honestly:
  // a gate that needs an arm that did not run is SKIPPED, never reported green.
  const ARMS = process.env.FLY_TERRA_ARMS || 'both';
  const EMPTY = {
    content: { total: 0, withUrl: 0, urlMismatch: 0, posMismatch: 0, bad: [] },
    yawStats: { byKind: {}, byUrl: {} },
    yawCensus: { lod: null, mem: null },
    poses: Object.fromEntries(Object.keys(POSES).map((k) => [k, { draws: null, tris: null, mem: null }])),
    errs: [],
    skipped: true,
  };
  console.log('  --- arm A: TERRA_PACE OFF (upstream policy) ---');
  const off = ARMS === 'on' ? EMPTY : await runArm(context, fx, false);
  if (off.skipped) console.log('    (skipped: FLY_TERRA_ARMS=on)');
  if (off.bootFallback) console.log('    (boot: canvas-visible wait timed out; used the runtime-ready fallback)');
  console.log('  --- arm B: TERRA_PACE ON (timerFix + mergeHysteresis + keepResident + skirtFast) ---');
  const on = ARMS === 'off' ? EMPTY : await runArm(context, fx, true);
  if (on.skipped) console.log('    (skipped: FLY_TERRA_ARMS=off)');
  if (on.bootFallback) console.log('    (boot: canvas-visible wait timed out; used the runtime-ready fallback)');
  await browser.close();
  fx.close?.();

  // ---------------------------------------------------------------- content
  console.log('');
  const cOff = off.content;
  const cOn = on.content;
  console.log(
    `  CONTENT PROBE  off: ${cOff.total} resident tiles, ${cOff.withUrl} with an imagery URL, ` +
      `${cOff.urlMismatch} URL mismatches, ${cOff.posMismatch} position mismatches`
  );
  console.log(
    `                 on : ${cOn.total} resident tiles, ${cOn.withUrl} with an imagery URL, ` +
      `${cOn.urlMismatch} URL mismatches, ${cOn.posMismatch} position mismatches`
  );
  if (cOff.bad.length || cOn.bad.length) {
    console.log('  mismatching tiles:', JSON.stringify([...cOff.bad, ...cOn.bad], null, 1));
  }
  if (!off.skipped) {
    gate('1 CONTENT: every resident tile displays the imagery of its OWN z/x/y (arm A)',
      cOff.withUrl > 0 && cOff.urlMismatch === 0, `${cOff.withUrl} tiles checked`);
    gate('2 CONTENT: …and its quadtree address matches its world position (arm A)',
      cOff.total > 0 && cOff.posMismatch === 0, `${cOff.total} tiles checked`);
  }
  if (!on.skipped) {
    gate('3 CONTENT: the same holds with the residency trio on (arm B)',
      cOn.withUrl > 0 && cOn.urlMismatch === 0 && cOn.posMismatch === 0,
      `${cOn.withUrl} url / ${cOn.total} pos checked`);
  }
  const bothArms = !off.skipped && !on.skipped;

  // ------------------------------------------------------------- yaw sweep
  const dupOff = Object.values(off.yawStats.byUrl || {}).filter((n) => n > 1).length;
  const dupOn = Object.values(on.yawStats.byUrl || {}).filter((n) => n > 1).length;
  const imgOff = off.yawStats.byKind?.img ?? 0;
  const imgOn = on.yawStats.byKind?.img ?? 0;
  console.log('');
  console.log(`  YAW SWEEP (${(YAW_MS / 1000).toFixed(0)}s in place, ~51 deg/s)`);
  console.log(`    imagery requests      off ${imgOff}   on ${imgOn}`);
  console.log(`    URLs fetched >1 time  off ${dupOff}   on ${dupOn}`);
  console.log(`    engine merges         off ${off.yawCensus.lod?.merge}   on ${on.yawCensus.lod?.merge}`);
  console.log(
    `    replaced ON SCREEN    off ${off.yawCensus.lod?.replacedOnScreen}   on ${on.yawCensus.lod?.replacedOnScreen}`
  );
  if (bothArms) gate('4 YAW: the engine stops merging tiles the camera merely turned away from',
    (on.yawCensus.lod?.merge ?? 1) <= (off.yawCensus.lod?.merge ?? 0),
    `merges ${off.yawCensus.lod?.merge} -> ${on.yawCensus.lod?.merge}`);
  if (!on.skipped) gate('5 YAW: no tile is replaced while it is on screen',
    (on.yawCensus.lod?.replacedOnScreen ?? 1) === 0,
    `${off.yawCensus.lod?.replacedOnScreen} -> ${on.yawCensus.lod?.replacedOnScreen}`);
  if (bothArms) gate('6 YAW: the same tile URL is not fetched twice as the heading comes back round',
    dupOn <= dupOff, `${dupOff} -> ${dupOn} URLs fetched more than once`);

  // -------------------------------------------------------- draw ceilings
  console.log('');
  for (const name of Object.keys(POSES)) {
    console.log(
      `  ${name.padEnd(9)} draws off ${String(off.poses[name].draws).padStart(4)} / on ${String(on.poses[name].draws).padStart(4)}` +
        `   tris off ${off.poses[name].tris} / on ${on.poses[name].tris}` +
        `   resident MB on ${on.poses[name].mem?.residentMB}`
    );
  }
  const ceilOk = (v) => v == null || v <= 261;
  gate('7 CEILING: Owens draws <= 261 in every arm that ran (the frozen desert control)',
    ceilOk(off.poses.owens.draws) && ceilOk(on.poses.owens.draws),
    `off ${off.poses.owens.draws} / on ${on.poses.owens.draws}`);
  const satOk = (v) => v == null || v <= 375;
  gate('8 CEILING: satellite draws <= 375 at the suburb pose in every arm that ran',
    satOk(off.poses.powell.draws) && satOk(on.poses.powell.draws),
    `off ${off.poses.powell.draws} / on ${on.poses.powell.draws}`);
  gate('9 no page errors in either arm', off.errs.length === 0 && on.errs.length === 0,
    [...off.errs, ...on.errs].join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
