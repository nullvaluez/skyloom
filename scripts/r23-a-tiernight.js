/**
 * R23 A "NIGHT-TRUTH" — the TIER × NIGHT chain probe (DIAGNOSTIC, not a gate).
 *
 * This probe is deliberately TILE-INDEPENDENT. It measures the STATE of the
 * night light chain — which contributors are armed, which materials carry an
 * emissive map, and how strong the two haze terms are — at each quality tier,
 * at a pinned deep-night clock. None of that needs a single imagery/vector tile
 * to have arrived, which is what makes it the one honest instrument available
 * in an environment whose egress policy blocks both tile hosts (see
 * scripts/r23-a-BLOCKED.md).
 *
 * THE ONE THING THAT MAKES IT THE USER'S WORLD, NOT THE FLEET'S: it un-pins
 * `__flyAerialOverride` as well as the four R22 pins. That override is 0
 * fleet-wide in scripts/_boot.js, and 0 forces BOTH aerial-perspective terms to
 * their identity path. A user machine never sets it. Measuring the night haze
 * with the fleet pin in place measures nothing at all.
 *
 * Usage:
 *   FLY_URL=http://localhost:3021 node scripts/r23-a-tiernight.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const POSE = {
  name: 'P-MAN',
  geo: [40.758, -73.9855],
  altM: 800,
  heading: 200,
  pitch: -18,
  sunUtc: Date.UTC(2026, 6, 28, 5, 0), // ~01:00 EDT — deep night
};
const NOON = Date.UTC(2026, 6, 28, 16, 0); // ~12:00 EDT — the day control

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

/** The night chain, as STATE. Everything here is tile-independent. */
const chain = () => {
  const S = window.__flyStats ?? {};
  const bldg = window.__satBuildings;
  const mat = bldg?.material;
  const haze = window.__flyAerial?.haze?.() ?? null;
  const post = window.__flyAerial?.get?.() ?? null;
  const quilt = window.__flyAerial?.quilt?.() ?? null;
  return {
    tier: window.__flyStore?.getState?.().qualityTier ?? null,
    dpr: window.__flyGl?.getPixelRatio?.() ?? null,
    aerialOverride: window.__flyAerialOverride ?? null, // null/undefined = user condition
    sunFrac: S.sunFactor ?? null,
    hdriBucket: S.hdriBucket ?? null,
    draws: S.drawCalls ?? null,
    // --- the CITY's night contributors -------------------------------------
    windows: bldg
      ? {
          nightEnabled: bldg.nightEnabled ?? null, // SAT_BUILDINGS.night.minTier gate
          emissiveIntensity: mat?.emissiveIntensity ?? null, // the sun ramp
          hasEmissiveMap: !!mat?.emissiveMap, // H3: emissive WITHOUT a map = white glow
          emissive: mat?.emissive
            ? [+mat.emissive.r.toFixed(3), +mat.emissive.g.toFixed(3), +mat.emissive.b.toFixed(3)]
            : null,
          facadeEnabled: bldg.facadeEnabled ?? null,
        }
      : { mounted: false },
    roadsMounted: !!window.__satRoads,
    skylineMounted: !!window.__satSkyline,
    clutterMounted: !!window.__satClutter,
    beacons: S.satBeacons ?? null,
    cityGlowPlaced: S.satCityGlowPlaced ?? null,
    cityGlowNightK: S.satCityGlowNightK ?? null,
    houseLights: S.houseLights ?? null,
    // --- the two DIMMING terms ---------------------------------------------
    contentHaze: haze, // in-shader, sat buildings + skyline; medium/low only
    postAerial: post, // depth post pass; high only
    quilt,
  };
};

async function runCondition(browser, condition, rows) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

  // 'user'  = the four R22 pins AND the R19 aerial pin released — what the
  //           person flying the game actually runs.
  // 'fleet' = the R22 pins released but `__flyAerialOverride` LEFT AT 0, i.e.
  //           exactly what every harness in the fleet sees. The pair is the
  //           proof that the fleet is structurally blind to this term.
  const pins = ['__flyTerraPin', '__flySettlePin', '__flyClutterPin', '__flyDepthPin'];
  if (condition === 'user') pins.push('__flyAerialOverride');
  await page.addInitScript(unpinPins, pins);

  await bootFly(page, { style: 'satellite', settleMs: 3000 });
  await page.evaluate((t) => {
    window.__flySunOverride = t;
  }, POSE.sunUtc);
  await page.evaluate(pinScene, [POSE.geo[0], POSE.geo[1], POSE.altM, POSE.heading, POSE.pitch]);
  await page.waitForTimeout(9000);

  for (const clock of ['night', 'noon']) {
    await page.evaluate((t) => {
      window.__flySunOverride = t;
    }, clock === 'night' ? POSE.sunUtc : NOON);
    // the day cycle republishes on a 60 s cadence; a warp bump re-reads it now
    await page.evaluate(pinScene, [POSE.geo[0], POSE.geo[1], POSE.altM, POSE.heading, POSE.pitch]);
    await page.waitForTimeout(6000);
    for (const tier of ['high', 'medium', 'low']) {
      await page.evaluate((t) => window.__flyStore.getState().setQualityTier(t), tier);
      await page.waitForTimeout(4000);
      const c = await page.evaluate(chain);
      rows.push({ condition, clock, tierAsked: tier, ...c });
      process.stdout.write(
        `${condition.padEnd(5)} ${clock.padEnd(5)} tier=${String(c.tier).padEnd(6)} sunFrac=${String(c.sunFrac).padEnd(6)} ` +
          `nightWin=${String(c.windows?.nightEnabled).padEnd(9)} ei=${String(c.windows?.emissiveIntensity).padEnd(9)} ` +
          `map=${String(c.windows?.hasEmissiveMap).padEnd(9)} | contentHaze=${c.contentHaze?.max} post=${c.postAerial?.strength ?? 'n/a'}\n`
      );
    }
  }
  await ctx.close();
  return errors;
}

(async () => {
  const browser = await chromium.launch();
  const rows = [];
  let errors = [];
  for (const condition of ['user', 'fleet']) {
    process.stdout.write(`\n--- condition: ${condition}\n`);
    errors = errors.concat(await runCondition(browser, condition, rows));
  }
  const dest = path.join(__dirname, 'r23-a-tiernight.json');
  fs.writeFileSync(
    dest,
    JSON.stringify({ generatedAt: new Date().toISOString(), pose: POSE, errors, rows }, null, 2)
  );
  process.stdout.write(`\nwrote ${dest}\nerrors=${errors.length}\n`);
  await browser.close();
})();
