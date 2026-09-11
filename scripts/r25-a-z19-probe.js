/**
 * ROUND 25 (A GROUND) — the z19 MEASUREMENT, and nothing else.
 *
 * `GROUND_DETAIL_R25.z19` ships OFF. The charter's instruction was "BUILD it,
 * MEASURE draws at the fixture Owens pose armed vs not, record the number";
 * this is that measurement, kept out of `verify-ground-bubble` deliberately —
 * a gate asserts a contract, and z19 has no contract yet. It has a number.
 *
 * WHAT IT MEASURES. Two boots at the same fixture Owens pose (36.6 / −118.1,
 * 95 m AGL — inside the bubble, which is the only altitude where the ceiling
 * can bind), satellite, tier high, `__flyTerraPin` UN-PINNED so TERRA_SHARP is
 * live and the baseline is the SHIPPED z18 rather than the fleet-pinned z17.
 * Arm 1 is the tree as it ships; arm 2 adds `z19: { enabled: true }`. It
 * reports the draw census of each and their delta against the frozen 261.
 *
 * WHAT IT CANNOT MEASURE HERE, stated so nobody quotes it as if it could:
 *  · whether Esri actually SERVES z19 World_Imagery anywhere. The fixture
 *    generates imagery procedurally at any z, so a green here says nothing
 *    about the real provider. R22 probed z18 before wiring it
 *    (scripts/r22-a-esri-probe.json) and that probe is the model; the
 *    equivalent z19 probe needs a machine that is not 403-blocked, i.e. the
 *    user's. THAT is the second half of the flip condition.
 *  · any fps, ms, bandwidth or VRAM consequence. SwiftShader at 1–3 fps.
 *
 *   FLY_TILE_FIXTURE=1 FLY_BOOT_SCALE=6 FLY_URL=http://localhost:3130 \
 *     node -r ./scripts/_pw-shim.js scripts/r25-a-z19-probe.js
 */
const { chromium } = require('playwright');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const SCALE = Math.max(1, Number(process.env.FLY_BOOT_SCALE || 1));
const OWENS = [36.6, -118.1, 1.5, -0.28];
const NOON_MS = Date.UTC(2026, 6, 27, 17, 0, 0);

const pinPose = async ([lat, lon, heading, pitch, agl]) => {
  for (let i = 0; i < 200 && !window.__fly?.flight?.pos; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  window.__fly.warpToGeo(lat, lon, { altM: agl + 400, name: null });
  const f = window.__fly.flight;
  window.__gdPin = { agl, heading, pitch, x: f.pos.x, z: f.pos.z };
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => {
    const p = window.__gdPin;
    f.pos.x = p.x;
    f.pos.z = p.z;
    f.pos.y = (f.groundElev ?? 0) + p.agl;
    f.heading = p.heading;
    f.pitch = p.pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

async function arm(browser, z19) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fly-quality-tier', 'high');
    } catch {
      /* storage blocked */
    }
  });
  // UN-PIN TERRA so the baseline is the SHIPPED z18/demZ16, not the fleet's
  // legacy z17 — measuring a +1 step off the wrong baseline measures nothing.
  await page.addInitScript(unpinPins, ['__flyTerraPin']);
  await page.addInitScript(() => {
    (window.__r22Unpinned ??= {}).__flyTerraPin = 0;
  });
  await page.addInitScript((on) => {
    window.__flyGroundBubbleOverride = { enabled: true };
    window.__flyGroundDetailOverride = on
      ? { enabled: true, z19: { enabled: true, aglM: 150, levels: 1 } }
      : { enabled: true };
  }, z19);
  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.evaluate((t) => {
    window.__flySunOverride = t;
  }, NOON_MS);
  await page.evaluate(pinPose, [...OWENS, 95]);
  await page.waitForTimeout(60000 * SCALE);
  const census = [];
  for (let i = 0; i < 10; i++) {
    census.push(
      await page.evaluate(() => ({
        draws: window.__flyStats?.drawCalls ?? -1,
        tris: window.__flyStats?.triangles ?? -1,
        z19: window.__flyGroundDetail?.read?.()?.z19Level ?? null,
        maxLevel: (() => {
          const e = window.__fly?.engine;
          return e?.map?.maxLevel ?? null;
        })(),
        leaf: window.__fly?.terraStats ?? null,
      }))
    );
    await page.waitForTimeout(1500 * SCALE);
  }
  await page.close();
  return { census, errs };
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const off = await arm(browser, false);
  const on = await arm(browser, true);
  const dmax = (r) => Math.max(...r.census.map((c) => c.draws).filter((d) => d > 0));
  const tmax = (r) => Math.max(...r.census.map((c) => c.tris).filter((d) => d > 0));
  console.log('z19 OFF :', JSON.stringify(off.census));
  console.log('z19 ON  :', JSON.stringify(on.census));
  console.log(
    `OWENS 95 m AGL, tier high, TERRA un-pinned:\n` +
      `  draws  OFF max ${dmax(off)}  ON max ${dmax(on)}  delta ${dmax(on) - dmax(off)}  (ceiling 261)\n` +
      `  tris   OFF max ${tmax(off)}  ON max ${tmax(on)}\n` +
      `  ceiling level OFF ${off.census.at(-1).z19} ON ${on.census.at(-1).z19}\n` +
      `  pageerrors OFF ${off.errs.length} ON ${on.errs.length}`
  );
  await browser.close();
})();
