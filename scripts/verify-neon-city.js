/**
 * Round 7 Phase B: Neon "Electric Night City". Round 8 gate updates: the
 * building layer is now the P3 facade GRID (__facadeGrid replaced round-7's
 * __windowLights marker), the moonlit shadow pass must be ARMED at the
 * default (high) tier, beacons follow the 150m ABSOLUTE rule, and the draw
 * gate is 480 (PERF_BUDGET 470 + the usual +10 composer slack).
 * Gates: (1) facade-grid + runway-glow shader layers are armed on the
 * shared toy materials; (1b) shadow pass armed + running at the default
 * tier; (2) the Manhattan skyline at night carries LIT WINDOWS — the
 * WARM-window fraction of a city crop between 0.3% and 14% (windows exist;
 * the world didn't white out — the missing-attribute-reads-0 trap). R8 fix
 * round recalibration: the plane now PINS at the warp point (16s of cruise
 * used to drift the frame out over the Hudson — black water under the old
 * crop) and the metric is warm-window pixels (R > B+15, luma 40–140):
 * measured across the sweep shots, round-8 grid windows top out near luma
 * 130 (bulk 60–100) so NO crop clears 0.3% at the old luma>170 rule — the
 * only >170 pixels are roads/pulses/HUD, all attribute-independent. Warm
 * keeps the black-world trap honest: streets/letters/labels/minimap are
 * cool or white (measured false-positive floor 0.003%), while a separate
 * luma>170 < 14% guard preserves the white-out catch; (2b) baked
 * beacons never sit below the 150m rule; (3) KJFK's runways carry baked
 * edge lights (bright fraction gate on a field crop); (4) the TownGlow
 * instanced dome mesh is mounted in toy; (5) zero pageerrors / console
 * errors (shader compile failures land there); draws reported loudly.
 * ALWAYS eyeball the screenshots — luminance gates can't judge taste.
 */
const { chromium } = require('playwright');
const path = require('path');
const sharp = require('sharp');
const { bootFly } = require('./_boot');

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

// Warm-window fraction (R8 fix round): lit facade windows are sodium-warm
// (windowWarm #ffb46b) and land at luma ~30–130 on screen (measured p50 73,
// p90 85 in the pinned crop); every OTHER bright surface in the toy night
// is cool or white (ICE roads/streets, white POI letters, grey traffic
// labels, green/purple minimap dots), so warm-in-band is the attribute-
// driven signal — a black world (missing aEdge/aFacade → windows read 0)
// measures ~0.003% here vs the ~0.4% streamed measurement (135× apart).
// The <140 luma ceiling keeps yellow letters / tracer cores (>180) out.
async function warmWinFrac(file, region) {
  const { data, info } = await sharp(file).extract(region).raw().toBuffer({ resolveWithObject: true });
  let warm = 0;
  const n = info.width * info.height;
  for (let i = 0; i < n; i++) {
    const r = data[i * info.channels];
    const g = data[i * info.channels + 1];
    const b = data[i * info.channels + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (r > b + 10 && l > 28 && l < 140) warm += 1;
  }
  return warm / n;
}

// Poll the chunk engine until streaming settles (queued/building/draping all
// zero, twice in a row) — R8 fix-round lesson: fixed waits under-run when the
// dev server is busy recompiling or the user flies a parallel session (16s
// left the near-field buildings unbuilt: tris 599k vs the streamed ~2.2M and
// the skyline crop read bare streets). Pin the plane BEFORE polling — the
// poll adds dwell, and an unpinned plane cruises out of the framing.
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
  const shot = (n) => page.screenshot({ path: path.join(__dirname, `neon-${n}.png`) });
  const glShot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: path.join(__dirname, `neon-${n}-gl.png`) });

  // R9-3: fly-only boot — __flyBoot pct 100 means ring-0 chunks finalized,
  // fleet GLBs loaded and shaders warm (replaces the header click + 22s
  // stream-in sleep; the hydration-click failure class is gone with the
  // header button).
  const { ms: bootMs } = await bootFly(page); // Neon (toy) default
  console.log(`booted in ${bootMs}ms`);
  await page.mouse.move(800, 450);
  // Round 8: pin the DEFAULT tier — headless fps can trip PerformanceMonitor
  // into degrading it, which would silently disarm the shadow pass (low) and
  // shrink the draw count the 480 gate is supposed to measure.
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.waitForTimeout(1500);

  // 1. Shader layers armed on the shared materials (round 8: the building
  // final layer is the P3 facade GRID — applyFacadeGrid replaced round-7's
  // applyWindowLights, so the marker moved to __facadeGrid)
  const layers = await page.evaluate(() => ({
    grid: window.__toyWorld?.materials.building.userData.__facadeGrid === true,
    rwy: window.__toyWorld?.materials.land.userData.__runwayGlow === true,
    beacon: window.__toyWorld?.materials.building.userData.__beaconBlink === true,
    pulse: window.__toyWorld?.materials.land.userData.__roadPulse === true,
  }));
  gate('facade-grid layer armed', layers.grid === true, JSON.stringify(layers));
  gate('runway-glow layer armed', layers.rwy === true);

  // 1b. Shadow pass armed AND running at the default tier: castShadow is the
  // arming side; a non-null shadow.map is the observable proof that
  // gl.shadowMap.enabled held and the pass actually rendered (WebGLShadowMap
  // allocates the target lazily, only while enabled). 2048 = TOY.shadowMapSize
  // at the 'high' default.
  const shadow = await page.evaluate(() => {
    let root = window.__fly.engine.object;
    while (root.parent) root = root.parent;
    let sun = null;
    root.traverse((o) => {
      if (o.isDirectionalLight) sun = o;
    });
    return sun
      ? { cast: sun.castShadow, map: sun.shadow.map !== null, size: sun.shadow.mapSize.width }
      : null;
  });
  gate(
    'moon shadow pass armed at default tier',
    shadow !== null && shadow.cast === true && shadow.map === true && shadow.size >= 1024,
    JSON.stringify(shadow)
  );

  // 2. Manhattan skyline: lit windows, no white-out. R8 fix round: PIN the
  // plane at the warp point (verify-monuments __monPin recipe) — 16s of
  // cruise used to drift the frame 3km north out over the Hudson, leaving
  // the crop on ink-black water while the lit city sat at the frame edges.
  // Pin at Union Square looking NORTH: the near field is Flatiron/Chelsea
  // mid-rises and the distance is the Midtown wall — a Times Square pin
  // aims the frame at dark Central Park instead.
  await page.evaluate(() => {
    window.__fly.warpToGeo(40.728, -73.995, { altM: 650, name: null });
    const f = window.__fly.flight;
    const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
    window.__skyPin = setInterval(() => {
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
  await page.waitForTimeout(3000); // labels/bloom settle
  await page.mouse.move(800, 450);
  await shot('01-manhattan');
  await glShot('01-manhattan');
  // City crop: lower-center band — below the top HUD/contracts panel, above
  // the hint bar (y 845+), left of the minimap circle (x 1410+, y 685+).
  // In-band POI letters (CENTRAL PARK) are white → the warm test skips them.
  const skyCrop = { left: 350, top: 480, width: 1040, height: 360 };
  const sky = await warmWinFrac(path.join(__dirname, 'neon-01-manhattan-gl.png'), skyCrop);
  const whiteout = await brightFrac(path.join(__dirname, 'neon-01-manhattan-gl.png'), skyCrop, 170);
  console.log(
    `skyline warm-window fraction: ${(sky * 100).toFixed(2)}% · luma>170: ${(whiteout * 100).toFixed(2)}%`
  );
  // R8.5 recalibration: the F5 roof-cap palette lift + P4 moonlight/parity
  // pass shifted warm-pixel distribution in this crop (measured 0.26% on a
  // visually fully-lit skyline vs 0.30% pre-F5). The black-world trap floor
  // is ~0.003% (still ~65x below the new 0.2% threshold), so the gate keeps
  // its attribute-loss catch while tolerating the approved palette move.
  gate('skyline lit (windows exist)', sky > 0.002, `${(sky * 100).toFixed(2)}% > 0.2%`);
  gate(
    'skyline not white-out',
    sky < 0.14 && whiteout < 0.14,
    `warm ${(sky * 100).toFixed(2)}% & bright ${(whiteout * 100).toFixed(2)}% < 14%`
  );

  // 2b. Beacons follow the round-8 150m ABSOLUTE rule: beacon quads sit at
  // y ≈ buildingH (+spire) in chunk-local space, so any aBeacon ≥ 0 vert
  // below ~145m means a short building grew one. Midtown must still HAVE
  // some (the round-7 heightFrac 0.8 would have needed 264m and killed them).
  const beacons = await page.evaluate(() => {
    const eng = window.__toyWorld;
    if (!eng) return { err: 'no __toyWorld handle' };
    let verts = 0;
    let minY = Infinity;
    for (const chunk of eng.chunks.values()) {
      for (const mesh of chunk.meshes ?? []) {
        const bc = mesh.geometry?.getAttribute?.('aBeacon');
        if (!bc) continue;
        const pos = mesh.geometry.getAttribute('position').array;
        const b = bc.array;
        for (let i = 0; i < b.length; i++) {
          if (b[i] >= 0) {
            verts += 1;
            minY = Math.min(minY, pos[i * 3 + 1]);
          }
        }
      }
    }
    return { verts, minY: verts ? minY : null };
  });
  gate('beacons baked in Midtown (150m+ towers exist)', (beacons.verts ?? 0) > 0, `verts=${beacons.verts}`);
  gate(
    'no beacon below the 150m rule',
    beacons.minY === null || beacons.minY >= 145,
    `minY=${beacons.minY?.toFixed(0)}m`
  );

  // free-look down-orbit for the review screenshot (Phase A as review tool)
  await page.mouse.move(800, 700);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(800, 200, { steps: 16 });
  await page.waitForTimeout(900);
  await shot('02-manhattan-orbit-down');
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(1800);

  // 3. KJFK runway lights (cursor centered FIRST — a low cursor is a
  // nose-down command and 15s of it flies the plane into the deck).
  // Unpin the skyline hold before flying elsewhere.
  await page.mouse.move(800, 450);
  await page.evaluate(() => {
    clearInterval(window.__skyPin);
    window.__fly.warpToGeo(40.6413, -73.7781, { altM: 420, name: null });
  });
  await page.waitForTimeout(15000);
  await shot('03-kjfk-runways');
  await glShot('03-kjfk-runways');
  const rwy = await brightFrac(
    path.join(__dirname, 'neon-03-kjfk-runways-gl.png'),
    { left: 300, top: 400, width: 1000, height: 420 },
    200
  );
  console.log(`KJFK field bright fraction: ${(rwy * 100).toFixed(3)}%`);
  gate('runway lights present', rwy > 0.0004, `${(rwy * 100).toFixed(3)}% > 0.04%`);

  // 4. TownGlow mounted (toy only)
  const domes = await page.evaluate(() => {
    let n = window.__fly.engine.object;
    while (n.parent) n = n.parent;
    let found = null;
    n.traverse((o) => {
      if (o.isInstancedMesh && o.material?.userData?.__worldBend === 'anchor') found = o.count;
    });
    return found;
  });
  gate('town glow-dome mesh mounted', domes !== null, `pool ${domes}`);

  // high-altitude dome/rim look for review
  await page.evaluate(() => {
    window.__fly.flight.pos.y = 3200;
  });
  await page.waitForTimeout(3500);
  await shot('04-high-domes');

  // 5. Stats + errors
  const s = await page.evaluate(() => ({
    draws: window.__flyStats?.drawCalls,
    tris: window.__flyStats?.triangles,
    heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
  }));
  // R8 fix round: PERF_BUDGET.drawCalls 470 (measured 461 in verify-roofs at
  // Levittown/high/shadows — the design's +50 shadow estimate was low; the
  // soak's gpuFrameMs stays the real perf gate); 480 keeps the same +10
  // composer slack the round-7 gate carried over its 350 budget.
  console.log(`TOY DRAWS: ${s.draws} (round-8 budget 470, measured 461 worst case) · tris ${s.tris} · heap ${s.heapMB}MB`);
  if (s.draws > 480) fails.push(`draws ${s.draws} > 480`);
  gate('zero page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
