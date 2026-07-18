/**
 * Round 8 (P8): procedural landmark monuments (P5).
 * Gates: (1) the landmark-* InstancedMesh pools are mounted in toy (9
 * archetypes since the round-8.5 'church' + halo on medium/high); (2)
 * warping to the Statue of Liberty places a `landmark-statue` instance AT
 * the landmark's world position (placed = non-zero instance scale); (3) the
 * POI letter floats ABOVE the monument top (letters bake the CPU bendDrop,
 * monuments drop in-shader at the same anchor — compare after adding
 * d²·bendK back); (4) a center-crop bright gate (lit monument + additive
 * halo); (5) the monuments COST what the design says (≤ +13): ≤ 10
 * landmark-* meshes structurally, and hiding them measurably drops draws
 * (1–15, churn-noise ceiling);
 * (6) rebase round-trip — warp ~300km out and back, the statue re-places;
 * (7) draws ≤ 480, zero pageerrors. ALWAYS eyeball the screenshots.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');
const sharp = require('sharp');

async function brightFrac(file, region, lumaMin) {
  const { data, info } = await sharp(file).extract(region).raw().toBuffer({ resolveWithObject: true });
  let bright = 0;
  const n = info.width * info.height;
  for (let i = 0; i < n; i++) {
    const r = data[i * info.channels];
    const g = data[i * info.channels + 1];
    const b = data[i * info.channels + 2];
    if (0.2126 * r + 0.7152 * g + 0.0722 * b > lumaMin) bright += 1;
  }
  return bright / n;
}

// Scene probe: landmark meshes + the statue's placed instances + its letter.
const monumentProbe = () => {
  const f = window.__fly;
  let root = f.engine.object;
  while (root.parent) root = root.parent;
  const meshes = [];
  let statue = null;
  let letterY = null;
  root.traverse((o) => {
    if (o.isInstancedMesh && /^landmark-/.test(o.name)) {
      meshes.push(o.name);
      if (o.name === 'landmark-statue') statue = o;
    }
    // drei <Text> renders a troika mesh whose `.text` is the string
    if (letterY === null && typeof o.text === 'string' && o.text === 'STATUE OF LIBERTY') {
      o.updateWorldMatrix(true, false);
      letterY = o.matrixWorld.elements[13];
    }
  });
  const expected = f.engine.geoToWorld(-74.0445, 40.6892, 0); // statue lon/lat
  const placed = [];
  if (statue) {
    const a = statue.instanceMatrix.array;
    for (let i = 0; i < statue.count; i++) {
      const sx = a[i * 16]; // m11 — instance x scale (yaw-only rotation)
      if (Math.abs(sx) < 0.001) continue; // zero-scale = parked pool slot
      placed.push({
        x: a[i * 16 + 12] + f.origin.anchor.x, // rebased → absolute mercator
        y: a[i * 16 + 13], // groundY (bend is applied in-shader, not baked)
        z: a[i * 16 + 14] + f.origin.anchor.z,
        sy: a[i * 16 + 5], // m22 — world height of the unit-height archetype
      });
    }
  }
  let best = null;
  for (const p of placed) {
    const d = Math.hypot(p.x - expected.x, p.z - expected.z);
    if (!best || d < best.d) best = { ...p, d };
  }
  const distM = best
    ? Math.hypot(best.x - f.flight.pos.x, best.z - f.flight.pos.z)
    : 0;
  return {
    meshes,
    placedCount: placed.length,
    best,
    letterY,
    bendK: window.__flyStats?.bendK ?? 0,
    distM,
    slots: (f.poiSlots ?? []).map((p) => p.name),
  };
};

// Poll the chunk engine until streaming settles (queued/building/draping all
// zero, twice in a row) — R8 fix-round lesson: fixed waits under-run when
// the dev server is busy; the statue crop should carry the streamed harbor
// backdrop. The statue hold below is already pinned, so dwell is safe.
async function waitToyStream(page, capMs = 90000) {
  const t0 = Date.now();
  let settled = 0;
  let s = null;
  await page.waitForTimeout(2000); // let the post-warp refresh queue first
  while (Date.now() - t0 < capMs) {
    s = await page.evaluate(() => window.__toyWorld?.stats ?? null);
    settled = s && s.ready > 0 && s.queued === 0 && s.building === 0 && s.draping === 0 ? settled + 1 : 0;
    if (settled >= 2) break;
    await page.waitForTimeout(1000);
  }
  console.log(`toy stream ${settled >= 2 ? 'settled' : 'CAP HIT'}: ${JSON.stringify(s)}`);
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(`console: ${m.text().slice(0, 200)}`);
  });
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const shot = (n) => page.screenshot({ path: path.join(__dirname, `monuments-${n}.png`) });
  const glShot = (n) =>
    page
      .locator('.fixed.inset-0 canvas')
      .first()
      .screenshot({ path: path.join(__dirname, `monuments-${n}-gl.png`) });

  // R9-3: fly-only boot — replaces the header click + hydration retry loop
  // + fixed stream-in sleep with the real __flyBoot readiness contract.
  await bootFly(page); // Neon (toy) default
  await page.mouse.move(800, 450);
  // Headless fps can trip PerformanceMonitor into degrading the tier — the
  // halo (and the shadow pass) are medium/high surfaces, so pin 'high'.
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.waitForTimeout(1200);

  // --- 2+3+4: Statue of Liberty --------------------------------------------
  // Warp ~1.7km SOUTH of the statue, nose north (heading 0) — the monument
  // sits dead ahead for the center-crop gate instead of underneath us. PIN
  // the plane (re-set pose every 8ms; each flight.step drifts <1cm between
  // re-pins) or 12s of cruise would overfly the landmark before the probe.
  await page.evaluate(() => {
    window.__fly.warpToGeo(40.674, -74.0445, { altM: 400, name: null });
    const f = window.__fly.flight;
    f.heading = 0;
    f.pitch = 0;
    f.bank = 0;
    const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
    window.__monPin = setInterval(() => {
      f.pos.x = p.x;
      f.pos.y = p.y;
      f.pos.z = p.z;
      f.heading = 0;
      f.pitch = 0;
      f.bank = 0;
      f.speed = 0;
    }, 8);
  });
  await waitToyStream(page, 90000); // pinned — dwell can't drift the framing
  // R9 boot is fast enough that the stream can settle INSIDE the ~11s window
  // where the warp-tick's prio-0 hold keeps EMPIRE STATE BUILDING in the
  // second landmark slot (the statue swaps in when the hold expires — traced
  // 2026-07-18: ESB out / statue in at t+11s, stable through t+75s). Poll for
  // the statue's slot membership instead of a fixed 4s dwell; the cap keeps a
  // REAL suppression regression loud.
  await page
    .waitForFunction(
      () => (window.__fly.poiSlots ?? []).some((p) => p.name === 'Statue of Liberty'),
      { timeout: 30000, polling: 500 }
    )
    .catch(() => {}); // gate below still fails loudly if it never arrived
  await page.waitForTimeout(2000); // pop-in spring + troika text sync
  await page.mouse.move(800, 450);
  const p1 = await page.evaluate(monumentProbe);
  console.log('probe:', JSON.stringify({ ...p1, slots: p1.slots.slice(0, 8) }));
  gate('landmark archetype pools mounted (9 + halo)', p1.meshes.length >= 9, p1.meshes.join(','));
  gate('halo mounted at high tier', p1.meshes.includes('landmark-halo'), p1.meshes.join(','));
  gate('statue instance placed', p1.placedCount >= 1, `placed=${p1.placedCount}`);
  gate(
    'placed at the landmark coords (≤ 300m)',
    p1.best !== null && p1.best.d <= 300,
    `d=${p1.best?.d?.toFixed(0)}m`
  );
  // Monument height sanity: 93m × scaleBoost 1.35 ≈ 126 (LANDMARKS_3D taste
  // knob — keep the gate loose so live-tuning doesn't false-fail it)
  gate('monument height plausible (60–400m)', p1.best !== null && p1.best.sy > 60 && p1.best.sy < 400, `sy=${p1.best?.sy?.toFixed(0)}`);
  // Letter floats ABOVE the monument top. The letter group bakes -bendDrop
  // (CPU) while the monument drops in-shader at the SAME anchor — add the
  // drop back (d² · effective bendK from __flyStats) before comparing.
  const letterOk =
    p1.letterY !== null &&
    p1.best !== null &&
    p1.letterY + p1.distM * p1.distM * p1.bendK >= p1.best.y + p1.best.sy - 5;
  gate(
    'letter floats above the monument',
    letterOk,
    p1.letterY === null
      ? `letter not mounted (slots: ${p1.slots.join(',') || 'none'})`
      : `letterY=${p1.letterY?.toFixed(0)} + drop vs top=${(p1.best.y + p1.best.sy).toFixed(0)}`
  );
  await shot('01-statue');
  await glShot('01-statue');
  // Center-lower crop: 400m alt, 1.7km out → the statue sits just under the
  // horizon line. Loose floor — the lit accents + additive halo only need to
  // register, taste is the screenshot's job. Calibrate up after first run.
  const bright = await brightFrac(
    path.join(__dirname, 'monuments-01-statue-gl.png'),
    { left: 600, top: 330, width: 400, height: 380 },
    110
  );
  console.log(`statue crop bright fraction: ${(bright * 100).toFixed(3)}%`);
  gate('monument reads in the frame', bright > 0.0008, `${(bright * 100).toFixed(3)}% > 0.08%`);

  // --- 5: draw cost of the monument layer (design: ≤ +13) ------------------
  // Structural half: each landmark-* InstancedMesh is exactly ONE draw
  // (frustumCulled=false, no castShadow), so ≤ 10 meshes ⇒ layer cost ≤ 13.
  gate('monument layer ≤ 10 meshes (≤ +13 draws structurally)', p1.meshes.length <= 10, `${p1.meshes.length} meshes`);
  // Measured half via visibility toggle — LandmarkMonuments never rewrites
  // `visible` per frame (round-6 lesson 3 applies to tracers/contrails), so
  // a plain toggle holds. Traffic/chunk churn between the two 2s-apart
  // samples adds a few draws of noise, hence the 15 ceiling on the DIFF.
  const before = await page.evaluate(() => window.__flyStats?.drawCalls ?? 0);
  await page.evaluate(() => {
    let root = window.__fly.engine.object;
    while (root.parent) root = root.parent;
    root.traverse((o) => {
      if (o.isInstancedMesh && /^landmark-/.test(o.name)) o.visible = false;
    });
  });
  await page.waitForTimeout(2000); // __flyStats.drawCalls refreshes every 60 frames
  const after = await page.evaluate(() => window.__flyStats?.drawCalls ?? 0);
  await page.evaluate(() => {
    let root = window.__fly.engine.object;
    while (root.parent) root = root.parent;
    root.traverse((o) => {
      if (o.isInstancedMesh && /^landmark-/.test(o.name)) o.visible = true;
    });
  });
  const delta = before - after;
  console.log(`monument draw cost: ${before} → ${after} (Δ ${delta})`);
  gate('monument layer draws measurably, within budget', delta >= 1 && delta <= 15, `Δ=${delta}`);

  // --- 6: rebase round-trip -------------------------------------------------
  await page.evaluate(() => {
    clearInterval(window.__monPin); // unpin before flying elsewhere
    window.__fly.warpToGeo(42.36, -71.06, { altM: 600, name: null }); // Boston
  });
  await page.waitForTimeout(9000);
  await page.evaluate(() => {
    window.__fly.warpToGeo(40.674, -74.0445, { altM: 400, name: null });
    window.__fly.flight.heading = 0;
  });
  await page.waitForTimeout(9000);
  const p2 = await page.evaluate(monumentProbe);
  gate(
    'statue re-placed after the rebase round-trip',
    p2.placedCount >= 1 && p2.best !== null && p2.best.d <= 300,
    `placed=${p2.placedCount} d=${p2.best?.d?.toFixed(0)}m`
  );
  await shot('02-after-roundtrip');

  // --- 7: budget + errors ---------------------------------------------------
  const s = await page.evaluate(() => ({
    draws: window.__flyStats?.drawCalls,
    heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
  }));
  // 480 = PERF_BUDGET.drawCalls 470 (R8 fix round: measured 461 in
  // verify-roofs) + the neon-city harness's +10 composer slack
  console.log(`draws ${s.draws} · heap ${s.heapMB}MB`);
  gate('draw budget (≤ 480)', (s.draws ?? 0) <= 480, `draws=${s.draws}`);
  gate('zero page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
