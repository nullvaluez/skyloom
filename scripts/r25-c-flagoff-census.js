/**
 * ROUND 25 (C LIGHT) — the FLAG-OFF CENSUS. Not a gate: an A/B instrument.
 *
 * The claim it exists to test is "with `LIGHT_BUBBLE_R25.enabled:false` the
 * tree is byte-identical to the base". `scripts/verify-moon-light.mjs` proves
 * that for the pure arithmetic (400 elevations, `Object.is`); this walks the
 * other half — the values that actually reach the LIGHT OBJECTS, the shadow
 * camera, the AO pass and the grade — in a running browser, at a pinned pose
 * and a pinned sun, and prints them as JSON.
 *
 * WHY A NUMBER CENSUS AND NOT A PIXEL A/B. This venue renders through
 * SwiftShader at 1–3 fps while tiles stream: two boots of the same pose do not
 * produce the same PNG, so a pixel difference here would measure the streamer,
 * not the feature (the R24 lesson about a within-run floor against a cross-boot
 * floor). Every quantity C can move is enumerated below instead — if all of
 * them are identical across the two trees, no pixel can differ for a reason
 * that belongs to C.
 *
 * USE
 *   # 1. on this tree, flag off (no arming init-script at all)
 *   FLY_TILE_FIXTURE=1 FLY_BOOT_SCALE=6 FLY_URL=http://localhost:3132 \
 *     node -r ./scripts/_pw-shim.js scripts/r25-c-flagoff-census.js > A.json
 *   # 2. check the five touched source files out at the base commit, let the
 *   #    dev server recompile, run it again > B.json
 *   # 3. diff A.json B.json
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const POWELL = [40.1578, -83.0752];
const AGL = 300;

const pinAgl = ([lat, lon, aglM]) => {
  window.__fly.warpToGeo(lat, lon, { altM: (window.__fly.flight.groundElev ?? 0) + aglM, name: null });
  const f = window.__fly.flight;
  window.__pinAgl = aglM;
  const p = { x: f.pos.x, z: f.pos.z };
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.z = p.z;
    f.pos.y = (f.groundElev ?? 0) + window.__pinAgl;
    f.heading = 1.9;
    f.pitch = 0;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

/** Every quantity C's five mechanisms could move, read off the live objects. */
const census = () => {
  const r = window.__fly;
  const hemi = [];
  const dir = [];
  // FIND THE SCENE WITHOUT THE BUS. `runtime.sunLight` is C's own publication
  // and does NOT exist on the base tree, so a census that reached the lights
  // through it would report an empty light list for exactly the arm it is
  // supposed to compare against — an instrument that cannot see the control.
  // Three fallbacks, in order: C's bus, the composer's RenderPass scene, and a
  // walk up the parent chain from any object the runtime already owns.
  const findScene = () => {
    if (r?.sunLight?.parent) return r.sunLight.parent;
    for (const p of window.__flyComposer?.passes ?? []) {
      if (p?.scene?.isScene) return p.scene;
      if (p?.mainScene?.isScene) return p.mainScene;
    }
    let o = r?.satBuildings?.object ?? r?.satRoads?.object ?? r?.satSkyline?.object ?? null;
    while (o?.parent) o = o.parent;
    return o?.isScene ? o : null;
  };
  const scene = findScene();
  const kids = scene ? scene.children : [];
  for (const o of kids) {
    if (o.isHemisphereLight) hemi.push({ color: `#${o.color.getHexString()}`, ground: `#${o.groundColor.getHexString()}`, intensity: +o.intensity.toFixed(9) });
    if (o.isDirectionalLight) {
      dir.push({
        color: `#${o.color.getHexString()}`,
        intensity: +o.intensity.toFixed(9),
        castShadow: o.castShadow,
        cam: o.shadow
          ? { left: o.shadow.camera.left, right: o.shadow.camera.right, top: o.shadow.camera.top, bottom: o.shadow.camera.bottom, near: o.shadow.camera.near, far: o.shadow.camera.far }
          : null,
        mapSize: o.shadow?.mapSize?.x ?? null,
        bias: o.shadow?.bias ?? null,
        normalBias: o.shadow?.normalBias ?? null,
      });
    }
  }
  const L = r?.immersiveLighting ?? null;
  return {
    sun: r?.sun ? { frac: +r.sun.frac.toFixed(9), az: +r.sun.az.toFixed(9), el: +r.sun.el.toFixed(9), sinEl: +r.sun.sinEl.toFixed(9), moon: r.sun.moon ?? null, grade: r.sun.grade ?? null, hazeNightFloor: r.sun.hazeNightFloor ?? null } : null,
    lighting: L ? { day: +L.day.toFixed(9), night: +L.night.toFixed(9), sun: +L.sun.toFixed(9), fill: +L.fill.toFixed(9), environment: +L.environment.toFixed(9), haze: +L.haze.toFixed(9), moon: L.moon ?? null } : null,
    dir,
    hemi,
    shadowRadiusM: r?.shadowRadiusM ?? null,
    ao: r?.aoPass?.configuration ? { radius: r.aoPass.configuration.aoRadius, intensity: r.aoPass.configuration.intensity } : null,
    bloom: window.__flyStats?.bloom ?? null,
    grade: window.__flyStats?.gradeBalance ?? null,
    shadowStats: window.__flyStats?.shadow ?? null,
    bubble: window.__flyStats?.groundBubble ? { k: window.__flyStats.groundBubble.k } : null,
    draws: window.__flyGl?.info?.render?.calls ?? null,
    programs: window.__flyGl?.info?.programs?.length ?? null,
    sceneFound: !!scene,
  };
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 900, height: 520 } });
  if (process.env.FLY_TILE_FIXTURE) await require('./_fixture').attachFixture(context);
  const page = await context.newPage();
  // NO arming init-script: this is the flag-off census, and the whole point is
  // that the R25 blocks are exactly as they ship.
  await bootFly(page, { style: 'satellite', timeoutMs: 600000, settleMs: 8000, ...BOOT_OPTS });
  await page.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function', undefined, { timeout: 180000, polling: 250 });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.evaluate(() => window.__flySatShadow?.set(true));
  await page.evaluate(() => {
    window.__flyDepthArm = 1;
  });
  const { findSunTime } = await import('./_sun-time.mjs');
  const out = {};
  for (const [label, elDeg] of [
    ['noon', 55],
    ['night', -20],
  ]) {
    const want = findSunTime(POWELL[1], POWELL[0], elDeg, { dayMs: Date.UTC(2026, 6, 1) });
    await page.evaluate((t) => {
      window.__flySunOverride = t;
    }, want.tMs);
    await page.evaluate(pinAgl, [...POWELL, AGL]);
    await page
      .waitForFunction(
        ([w]) => {
          const s = window.__fly?.sun?.sinEl;
          return Number.isFinite(s) && Math.abs((Math.asin(Math.max(-1, Math.min(1, s))) * 180) / Math.PI - w) < 0.5;
        },
        [elDeg],
        { timeout: 180000, polling: 500 }
      )
      .catch(() => {});
    await page.waitForTimeout(8000);
    out[label] = await page.evaluate(census);
  }
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch((e) => {
  console.error('census threw:', e);
  process.exit(1);
});
