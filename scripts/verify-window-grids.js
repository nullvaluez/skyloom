/**
 * Round 8 (P8): structured facade window grids (P3) replacing the round-7
 * random dots. Gates: (1) the Midtown skyline stays lit-but-not-white
 * (0.3–14%, same pinned framing + warm-window crop/metric as
 * verify-neon-city — see its header for the R8 fix-round derivation: round-8
 * windows top out near luma 130, so the old luma>170 rule measured only
 * roads/HUD noise and sat flaky at 0.27–0.56% across runs); (2) per-row
 * lit-pixel CLUSTERING on a low-altitude facade crop: max-row / mean-row
 * ≥ 3 — random dots spread lit pixels evenly across rows (ratio ~1.5–2),
 * contiguous lit FLOORS spike whole rows; (3) two-frame WINDOW flicker with
 * the plane pinned, every mover hidden, the 2D overlay canvases (moving
 * traffic labels + minimap) visibility-hidden and the LAND material
 * colorWrite-masked (worker-baked road pulses sweep every street — 158% on
 * the sweep run, and pulses ride distant bridges ABOVE the ground line too,
 * so no crop dodges them): changed warm-window fraction ≤ 30%. That ceiling
 * is DERIVED, not aspirational: flick phase slides at BEACONS.rate ×
 * 0.13 = 0.0234/s across a ±flickerFrac window, toggling ≈ 4.7%·Δt of all
 * cells ≈ 8–12%/s of LIT pixels (lit ≈ 0.40–0.55) — at the ~1.0–1.6s
 * two-shot gap that is ~12–19% BY DESIGN; runaway strobing (the round-7
 * complaint) measures 60–160%; (4) draws ≤ 480, zero pageerrors. ALWAYS
 * eyeball the screenshots — the grid look (pitch, lit fractions) is the #1
 * taste item and no ratio judges it.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');
const sharp = require('sharp');

async function cropLuma(file, region) {
  const { data, info } = await sharp(file).extract(region).raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const luma = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    luma[i] =
      0.2126 * data[i * info.channels] +
      0.7152 * data[i * info.channels + 1] +
      0.0722 * data[i * info.channels + 2];
  }
  return { luma, width: info.width, height: info.height };
}

// Luma + warm-window mask (R8 fix round; same rule as verify-neon-city):
// lit windows are sodium-warm (windowWarm #ffb46b) at luma ~30–130
// (measured p50 73 in the pinned crop); every other bright toy-night
// surface (ICE streets, white letters, grey labels, minimap dots) is cool
// or white — warm-in-band isolates the attribute-driven window light
// (black-world false-positive floor: 0.003% vs ~0.4% streamed, 135× apart).
async function cropPix(file, region) {
  const { data, info } = await sharp(file).extract(region).raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const luma = new Float32Array(n);
  const warm = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * info.channels];
    const g = data[i * info.channels + 1];
    const b = data[i * info.channels + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luma[i] = l;
    if (r > b + 10 && l > 28 && l < 140) warm[i] = 1;
  }
  return { luma, warm, width: info.width, height: info.height };
}

// Poll the chunk engine until streaming settles (queued/building/draping all
// zero, twice in a row) — R8 fix-round lesson: fixed waits under-run when the
// dev server is busy (near-field buildings unbuilt → the skyline crop reads
// bare streets). Pin the plane BEFORE polling — the poll adds dwell, and an
// unpinned plane cruises out of the framing.
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
  const glShot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: path.join(__dirname, `grids-${n}-gl.png`) });

  // R9-3: fly-only boot — replaces the header click + hydration retry loop
  // + fixed stream-in sleep with the real __flyBoot readiness contract.
  await bootFly(page); // Neon (toy) default
  await page.mouse.move(800, 450);
  // Pin the default tier — headless fps can trip PerformanceMonitor into
  // degrading it; the skyline/facade shots should carry the default look.
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.waitForTimeout(1200);

  // --- 1: skyline band (verify-neon-city pinned crop, bloom-retune check) --
  // R8 fix round: PIN at the warp point (verify-monuments __monPin recipe) —
  // 16s of cruise used to drift the frame out over the Hudson, and the old
  // crop landed on black harbor water while the lit city sat at the edges.
  // Union Square looking NORTH = near Flatiron/Chelsea mid-rises + the
  // Midtown wall (a Times Square pin aims at dark Central Park instead).
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
  await glShot('01-skyline');
  // Lower-center city band — below the top HUD/contracts panel, above the
  // hint bar (y 845+), left of the minimap circle (x 1410+, y 685+).
  // In-band POI letters (CENTRAL PARK) are white → the warm test skips them.
  const skyCrop = { left: 350, top: 480, width: 1040, height: 360 };
  const sky = await cropPix(path.join(__dirname, 'grids-01-skyline-gl.png'), skyCrop);
  let lit = 0;
  let over170 = 0;
  for (let i = 0; i < sky.luma.length; i++) {
    if (sky.warm[i]) lit += 1;
    if (sky.luma[i] > 170) over170 += 1;
  }
  const skyFrac = lit / sky.luma.length;
  const whiteFrac = over170 / sky.luma.length;
  console.log(
    `skyline warm-window fraction: ${(skyFrac * 100).toFixed(2)}% · luma>170: ${(whiteFrac * 100).toFixed(2)}%`
  );
  // R8.5 recalibration (mirrors verify-neon-city): F5 roof-cap palette lift
  // + moonlight/parity pass shifted warm-pixel distribution (0.27% measured
  // on a visually fully-lit skyline). Trap floor ~0.003% stays ~65x below.
  gate('skyline lit (grids exist)', skyFrac > 0.002, `${(skyFrac * 100).toFixed(2)}% > 0.2%`);
  gate(
    'skyline not white-out',
    skyFrac < 0.14 && whiteFrac < 0.14,
    `warm ${(skyFrac * 100).toFixed(2)}% & bright ${(whiteFrac * 100).toFixed(2)}% < 14%`
  );

  // --- 2: low-altitude facade row clustering -------------------------------
  // Unpin, then re-warp in at 380m so the nearest towers fill the frame
  // (floors read as rows).
  await page.evaluate(() => {
    clearInterval(window.__skyPin);
    window.__fly.warpToGeo(40.758, -73.9855, { altM: 380, name: null });
  });
  await page.waitForTimeout(6000);
  await glShot('02-facades');
  const fac = await cropLuma(path.join(__dirname, 'grids-02-facades-gl.png'), {
    left: 500,
    top: 250,
    width: 600,
    height: 400,
  });
  const rows = new Float32Array(fac.height);
  let totalLit = 0;
  for (let y = 0; y < fac.height; y++) {
    for (let x = 0; x < fac.width; x++) {
      if (fac.luma[y * fac.width + x] > 150) rows[y] += 1;
    }
    totalLit += rows[y];
  }
  const rowMean = totalLit / fac.height;
  const rowMax = Math.max(...rows);
  const spiky = rowMean > 0 ? rowMax / rowMean : 0;
  console.log(`facade rows: totalLit=${totalLit} rowMax=${rowMax} rowMean=${rowMean.toFixed(1)} ratio=${spiky.toFixed(2)}`);
  gate('facade crop carries lit pixels', totalLit >= 300, `totalLit=${totalLit}`);
  gate('lit rows spiky (floors, not dots): max/mean ≥ 3', spiky >= 3, `${spiky.toFixed(2)} >= 3`);

  // --- 3: two-frame flicker ------------------------------------------------
  // The plane must NOT move between frames (parallax would swamp the gate):
  // pin position/attitude every 8ms — flight.step keeps running but each
  // integration drifts <1cm before the next re-pin. Then hide every MOVER
  // with colorWrite=false (round-6 lesson 3: some re-arm `visible` per
  // frame): additive FX (tracers/contrail/halos/domes/bursts/strobes),
  // traffic models + far billboards (a plane crossing the crop flips
  // pixels). R8 fix round, two more movers the sweep run exposed (158%
  // measured flicker): (a) the LAND material — worker-baked road pulses
  // sweep every street AND distant bridges/causeways ABOVE the ground line,
  // so no crop dodges them; colorWrite-mask the whole land layer (depth
  // writes stay on, occlusion intact, the void floor behind it is static);
  // (b) the 2D overlay canvases (LabelCanvas traffic labels + minimap) —
  // the GL "canvas screenshot" is a page clip, and moving label text /
  // minimap dots ride on top of it. Building windows/crowns/beacons ride
  // the CHUNK building material and stay measured — beacons blinking IS
  // part of the surface (rare + tiny).
  await page.evaluate(() => {
    const f = window.__fly.flight;
    const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z, hdg: f.heading, pitch: f.pitch };
    window.__gridPin = setInterval(() => {
      f.pos.x = p.x;
      f.pos.y = p.y;
      f.pos.z = p.z;
      f.heading = p.hdg;
      f.pitch = p.pitch;
      f.bank = 0;
      f.speed = 0;
    }, 8);
    let root = window.__fly.engine.object;
    while (root.parent) root = root.parent;
    const hidden = (window.__gridHiddenMats = []);
    root.traverse((o) => {
      const m = o.material;
      if (!m || Array.isArray(m)) return;
      const mover =
        m.blending === 2 || // THREE.AdditiveBlending
        m.userData?.__navLights === true ||
        m.userData?.__worldBend === 'air-anchor';
      if (mover && m.colorWrite !== false) {
        m.colorWrite = false;
        hidden.push(m);
      }
    });
    const land = window.__toyWorld?.materials.land;
    if (land && land.colorWrite !== false) {
      land.colorWrite = false;
      hidden.push(land);
    }
    // 2D overlay canvases: the GL canvas already owns a webgl context, so
    // getContext('2d') is null there and truthy on the label/minimap layers.
    const dimmed = (window.__gridHiddenCanvases = []);
    for (const c of document.querySelectorAll('canvas')) {
      let ctx2d = null;
      try {
        ctx2d = c.getContext('2d');
      } catch (e) {
        ctx2d = null;
      }
      if (ctx2d && c.style.visibility !== 'hidden') {
        c.style.visibility = 'hidden';
        dimmed.push(c);
      }
    }
    return hidden.length + dimmed.length;
  });
  // R8 sweep fix: 2.5s was NOT enough — the damped chase cam was still easing
  // onto the pinned pose, and the ~10px/s residual scene shift parallaxed
  // every lit window into a "changed" pixel (measured 98–117% flicker).
  // 9s of exponential damping leaves sub-pixel residual between the frames.
  await page.waitForTimeout(9000);
  const tShotA = Date.now();
  await glShot('03-flicker-a');
  await page.waitForTimeout(1000);
  const tShotB = Date.now();
  await glShot('03-flicker-b');
  await page.evaluate(() => {
    clearInterval(window.__gridPin);
    for (const m of window.__gridHiddenMats ?? []) m.colorWrite = true;
    window.__gridHiddenMats = [];
    for (const c of window.__gridHiddenCanvases ?? []) c.style.visibility = '';
    window.__gridHiddenCanvases = [];
  });
  // R8 fix round: measure WARM-WINDOW pixels (see cropPix — the old >150
  // luma rule never saw a single window pixel; round-8 windows top out near
  // 130, so litA was road pulses and the gate measured the wrong surface).
  // City band below the horizon; labels/minimap/land are masked so the crop
  // can be generous.
  const flickCrop = { left: 350, top: 430, width: 1040, height: 410 };
  const a = await cropPix(path.join(__dirname, 'grids-03-flicker-a-gl.png'), flickCrop);
  const b = await cropPix(path.join(__dirname, 'grids-03-flicker-b-gl.png'), flickCrop);
  // The toy style runs an ANIMATED film-grain pass (TOY.grainOpacity 0.06 ≈
  // ±15 luma, worst-case double swing ~30) — count only swings >40 luma
  // (a window cell actually toggling swings 40–80) on warm-window pixels.
  let litA = 0;
  let changed = 0;
  for (let i = 0; i < a.luma.length; i++) {
    if (a.warm[i]) litA += 1;
    if ((a.warm[i] || b.warm[i]) && Math.abs(a.luma[i] - b.luma[i]) > 40) changed += 1;
  }
  const flickFrac = changed / Math.max(1, litA);
  const dtS = (tShotB - tShotA) / 1000;
  console.log(
    `flicker: litA=${litA} changed=${changed} fraction=${(flickFrac * 100).toFixed(2)}% (Δt≈${dtS.toFixed(2)}s)`
  );
  // ≤30% is DERIVED from the design constants, not a taste call: the flick
  // phase (world-bend.js :722) slides at BEACONS.rate × 0.13 = 0.0234/s
  // across a ±WINDOW_GRID.flickerFrac window → ~4.7%·Δt of ALL cells toggle,
  // ≈ 8–12%/s of LIT pixels (lit ≈ 0.40–0.55 by litFloorFrac×litCellFrac×
  // litBias). At the ~1.0–1.6s two-shot gap that is ~12–19% BY DESIGN;
  // 30% gives 1.6× headroom while runaway strobing (the round-7 "blinking
  // dots" complaint / an unmasked mover) measures 60–160%.
  gate('two-frame window flicker ≤ 30%', flickFrac <= 0.3, `${(flickFrac * 100).toFixed(2)}% <= 30% (Δt ${dtS.toFixed(2)}s)`);
  gate('flicker gate saw lit windows', litA >= 500, `litA=${litA}`);

  // --- 4: budget + errors --------------------------------------------------
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
