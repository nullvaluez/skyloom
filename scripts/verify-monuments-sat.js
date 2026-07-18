/**
 * Round 11: landmark monuments in SATELLITE (they were toy-only — the Day
 * default had zero landmarks). Slim satellite twin of verify-monuments,
 * anchored at CHRIST THE REDEEMER: Corcovado sits ~700m up, so the raw-DEM
 * ground gate actually discriminates — a toy-style drawn ground
 * (elev × 1.7 + lift ≈ 1190m) would fail loudly, where the sea-level statue
 * (elev ≈ 0, lift 2.5m) never could.
 * Gates: (1) the 9 archetype pools + halo mount in satellite; (2) a
 * landmark-statue instance places ≤ 300m of the landmark; (3) the instance
 * stands on RAW DEM (no toy exaggeration); (4) height plausible
 * (38m × 1.35 ≈ 51); (5) the layer draws measurably and within budget via
 * the visibility toggle (Δ 1–15); (6) the POI letter floats above the
 * monument top (satellite letters lift now — round 11); (7) draws ≤ 480,
 * zero page/console errors. ALWAYS eyeball the screenshots.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

// Scene probe — verify-monuments' probe, parameterized for this landmark.
const LM = { name: 'Christ the Redeemer', lat: -22.9519, lon: -43.2105 };
const monumentProbe = (lm) => {
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
    if (letterY === null && typeof o.text === 'string' && o.text === lm.name.toUpperCase()) {
      o.updateWorldMatrix(true, false);
      letterY = o.matrixWorld.elements[13];
    }
  });
  const expected = f.engine.geoToWorld(lm.lon, lm.lat, 0);
  const placed = [];
  if (statue) {
    const a = statue.instanceMatrix.array;
    for (let i = 0; i < statue.count; i++) {
      const sx = a[i * 16];
      if (Math.abs(sx) < 0.001) continue; // zero-scale = parked pool slot
      placed.push({
        x: a[i * 16 + 12] + f.origin.anchor.x,
        y: a[i * 16 + 13], // groundY (bend applies in-shader, not baked)
        z: a[i * 16 + 14] + f.origin.anchor.z,
        sy: a[i * 16 + 5],
      });
    }
  }
  let best = null;
  for (const p of placed) {
    const d = Math.hypot(p.x - expected.x, p.z - expected.z);
    if (!best || d < best.d) best = { ...p, d };
  }
  const distM = best ? Math.hypot(best.x - f.flight.pos.x, best.z - f.flight.pos.z) : 0;
  const ground = f.engine.getGroundAt?.(lm.lon, lm.lat);
  return {
    meshes,
    placedCount: placed.length,
    best,
    letterY,
    bendK: window.__flyStats?.bendK ?? 0,
    distM,
    demElev: ground ? ground.elev : null,
    slots: (f.poiSlots ?? []).map((p) => p.name),
  };
};

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
  const glShot = (n) =>
    page
      .locator('.fixed.inset-0 canvas')
      .first()
      .screenshot({ path: path.join(__dirname, `monuments-sat-${n}-gl.png`) });

  await bootFly(page, { style: 'satellite' });
  await page.mouse.move(800, 450);
  // Pin high: halo is medium/high, and hillshade/aniso are tier-aware (R11)
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.waitForTimeout(1200);

  // Warp ~1.7km south of Corcovado at 1100m — the statue (ground ~700m +
  // ~50m figure) sits ahead/below. Pin the pose (verify-monuments recipe).
  await page.evaluate((lm) => {
    window.__fly.warpToGeo(lm.lat - 0.0153, lm.lon, { altM: 1100, name: null });
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
  }, LM);
  // Satellite has no chunk engine to poll — dwell for the imagery/DEM
  // stream (verify-sat-depth's warp dwell), then let a 2s placement tick +
  // DEM-dependent re-place land.
  await page.waitForTimeout(22000);
  await page.mouse.move(800, 450);

  const p1 = await page.evaluate(monumentProbe, LM);
  console.log('probe:', JSON.stringify({ ...p1, slots: p1.slots.slice(0, 8) }));
  gate('landmark archetype pools mounted in satellite (9 + halo)', p1.meshes.length >= 9, p1.meshes.join(','));
  gate('halo mounted at high tier', p1.meshes.includes('landmark-halo'), p1.meshes.join(','));
  gate('statue instance placed', p1.placedCount >= 1, `placed=${p1.placedCount}`);
  gate(
    'placed at the landmark coords (≤ 300m)',
    p1.best !== null && p1.best.d <= 300,
    `d=${p1.best?.d?.toFixed(0)}m`
  );
  // THE round-11 gate: satellite monuments stand on RAW DEM. Corcovado's
  // ~700m summit makes toy exaggeration unmissable (×1.7 ≈ +490m). DEM may
  // still be coarse right at the peak — allow generous absolute slack, but
  // stay far below the exaggerated value.
  const rawOk =
    p1.best !== null &&
    p1.demElev !== null &&
    p1.demElev > 300 && // sanity: the mountain streamed in at all
    Math.abs(p1.best.y - p1.demElev) <= Math.max(40, p1.demElev * 0.15) &&
    p1.best.y < p1.demElev * 1.45; // toy drawn ground would be ×1.7
  gate(
    'monument stands on raw DEM (no toy exaggeration)',
    rawOk,
    `y=${p1.best?.y?.toFixed(0)} vs dem=${p1.demElev?.toFixed(0)}`
  );
  gate(
    'monument height plausible (30–200m)',
    p1.best !== null && p1.best.sy > 30 && p1.best.sy < 200,
    `sy=${p1.best?.sy?.toFixed(0)}`
  );
  // Letter floats above the monument (satellite letters lift in R11). Same
  // CPU-bendDrop re-add as the toy harness.
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
  await glShot('01-redeemer');

  // Layer cost via the visibility toggle (verify-monuments recipe)
  const before = await page.evaluate(() => window.__flyStats?.drawCalls ?? 0);
  await page.evaluate(() => {
    let root = window.__fly.engine.object;
    while (root.parent) root = root.parent;
    root.traverse((o) => {
      if (o.isInstancedMesh && /^landmark-/.test(o.name)) o.visible = false;
    });
  });
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => window.__flyStats?.drawCalls ?? 0);
  await page.evaluate(() => {
    let root = window.__fly.engine.object;
    while (root.parent) root = root.parent;
    root.traverse((o) => {
      if (o.isInstancedMesh && /^landmark-/.test(o.name)) o.visible = true;
    });
  });
  const delta = before - after;
  console.log(`monument draw cost (satellite): ${before} → ${after} (Δ ${delta})`);
  gate('monument layer draws measurably, within budget', delta >= 1 && delta <= 15, `Δ=${delta}`);

  const s = await page.evaluate(() => ({
    draws: window.__flyStats?.drawCalls,
    heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
  }));
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
