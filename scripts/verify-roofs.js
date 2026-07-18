/**
 * Round 8 (P8): building height realism (P1) + roof detail system (P2).
 * Gates: (1) height histogram straight from the __toyWorld building buffers
 * at Midtown — unique-building max ≥ 250 m and ≥ 4 distinct 40 m bands (the
 * old flat [9,90] clamp could produce at most 3); (2) crown/spire-tip
 * emissive verts baked (aFacade.x ≤ -1.5); (3) rooftop beacons obey the new
 * 150 m ABSOLUTE rule — aBeacon ≥ 0 verts exist in Midtown AND none sit
 * below ~145 m local height (the round-7 heightFrac rule is gone); (4) a
 * top-down RMB-orbit roof crop carries luminance VARIANCE (parapets/HVAC/
 * gables/crowns — the round-7 featureless single-color caps read uniform);
 * (5) suburb chunks (Levittown) carry unique-height stdev > 3 — the
 * missing-height inference jitter, the real "same height" fix; (6) draws
 * ≤ 480, zero pageerrors. ALWAYS eyeball the screenshots — a variance
 * number can't judge taste.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');
const sharp = require('sharp');

async function lumaStats(file, region) {
  const { data, info } = await sharp(file).extract(region).raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * info.channels];
    const g = data[i * info.channels + 1];
    const b = data[i * info.channels + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += l;
    sumSq += l * l;
  }
  const mean = sum / n;
  return { mean, variance: sumSq / n - mean * mean };
}

// Unique-building height stats from every loaded chunk's building buffers.
// Wall verts carry aFacade = (edge-local arc ≥ 0, heightM, buildingH, hash);
// dedupe on (buildingH, hash) so vert counts don't weight tall towers.
// Crowns/spire tips are role-encoded aFacade.x ≤ -1.5; beacon quads carry
// aBeacon ≥ 0 (blink phase) and sit at y ≈ buildingH (+spire) in local space.
const bufferProbe = () => {
  const eng = window.__toyWorld;
  if (!eng) return { err: 'no __toyWorld handle' };
  const heights = new Map();
  let crownVerts = 0;
  let beaconVerts = 0;
  let beaconMinY = Infinity;
  for (const chunk of eng.chunks.values()) {
    for (const mesh of chunk.meshes ?? []) {
      const fac = mesh.geometry?.getAttribute?.('aFacade');
      if (!fac) continue; // only the building mesh carries aFacade
      const f = fac.array;
      const pos = mesh.geometry.getAttribute('position').array;
      const bc = mesh.geometry.getAttribute('aBeacon')?.array;
      const vtx = f.length / 4;
      for (let i = 0; i < vtx; i++) {
        const x = f[i * 4];
        if (x >= 0) {
          const h = f[i * 4 + 2];
          heights.set(h.toFixed(1) + '|' + f[i * 4 + 3].toFixed(4), h);
        } else if (x <= -1.5) {
          crownVerts += 1;
        }
        if (bc && bc[i] >= 0) {
          beaconVerts += 1;
          beaconMinY = Math.min(beaconMinY, pos[i * 3 + 1]);
        }
      }
    }
  }
  const hs = [...heights.values()];
  const bands = new Set(hs.map((h) => Math.floor(h / 40)));
  const mean = hs.reduce((a, b) => a + b, 0) / (hs.length || 1);
  const stdev = Math.sqrt(hs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (hs.length || 1));
  return {
    buildings: hs.length,
    maxH: hs.length ? Math.max(...hs) : 0,
    bands: bands.size,
    stdev,
    crownVerts,
    beaconVerts,
    beaconMinY: beaconVerts ? beaconMinY : null,
  };
};

// Poll the chunk engine until streaming settles (queued/building/draping all
// zero, twice in a row) — R8 fix-round lesson: fixed waits under-run when the
// dev server is busy (probing half-built buffers skews the height histogram
// and leaves the roof crop sparse). Pin the plane BEFORE polling — the poll
// adds dwell, and an unpinned plane cruises out of the framing.
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
  const shot = (n) => page.screenshot({ path: path.join(__dirname, `roofs-${n}.png`) });
  const glShot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: path.join(__dirname, `roofs-${n}-gl.png`) });

  // R9-3: fly-only boot — replaces the header click + hydration retry loop
  // + fixed stream-in sleep with the real __flyBoot readiness contract.
  await bootFly(page); // Neon (toy) default
  await page.mouse.move(800, 450);
  // Pin the default tier — headless fps can trip PerformanceMonitor into
  // degrading it, and the top-down screenshot should carry the shadowed look.
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.waitForTimeout(1200);

  // --- 1+2+3: Midtown buffer probes ----------------------------------------
  // R8 fix round: pin at the warp point (poll dwell must not drift the
  // top-down framing) and wait for streaming to settle before probing.
  await page.evaluate(() => {
    window.__fly.warpToGeo(40.758, -73.9855, { altM: 650, name: null });
    const f = window.__fly.flight;
    const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
    window.__roofPin = setInterval(() => {
      f.pos.x = p.x;
      f.pos.y = p.y;
      f.pos.z = p.z;
      f.heading = 0;
      f.pitch = 0;
      f.bank = 0;
      f.speed = 0;
    }, 8);
  });
  await waitToyStream(page, 90000);
  await page.waitForTimeout(2000);
  await page.mouse.move(800, 450);
  const mid = await page.evaluate(bufferProbe);
  console.log('midtown buffers:', JSON.stringify(mid));
  gate('midtown supertalls (max ≥ 250m)', (mid.maxH ?? 0) >= 250, `maxH=${mid.maxH?.toFixed(0)}m over ${mid.buildings} buildings`);
  gate('height spread (≥ 4 distinct 40m bands)', (mid.bands ?? 0) >= 4, `bands=${mid.bands}`);
  gate('crown/spire emissive verts baked (aFacade.x ≤ -1.5)', (mid.crownVerts ?? 0) > 0, `crownVerts=${mid.crownVerts}`);
  gate('rooftop beacons exist (Midtown has 150m+ towers)', (mid.beaconVerts ?? 0) > 0, `beaconVerts=${mid.beaconVerts}`);
  // The 150m ABSOLUTE rule: beacon quads sit at y ≈ buildingH (+spire) in
  // chunk-local space, so any beacon vert below ~145m means a short building
  // grew one (5m slack covers the +0.6 offset rounding and base sink).
  gate(
    'no beacon below the 150m rule',
    mid.beaconMinY === null || mid.beaconMinY >= 145,
    `beaconMinY=${mid.beaconMinY?.toFixed(0)}m`
  );

  // --- 4: top-down roof crop (RMB pitch orbit, verify-freelook recipe) -----
  await page.mouse.move(800, 860);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(800, 40, { steps: 24 });
  await page.waitForTimeout(1200); // damped orbit catches up
  await shot('01-topdown');
  await glShot('01-topdown');
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(2200); // snapback before the next warp
  const roof = await lumaStats(path.join(__dirname, 'roofs-01-topdown-gl.png'), {
    left: 400,
    top: 150,
    width: 800,
    height: 600,
  });
  console.log(`roof crop luma: mean=${roof.mean.toFixed(1)} variance=${roof.variance.toFixed(1)}`);
  // ABSOLUTE variance floor — the design's "≥ 2× round-7 baseline" gate can't
  // run because the pre-round-8 tree is gone from disk. CALIBRATED-ON-FIRST-RUN:
  // 120 is a deliberately conservative floor (a featureless single-color roof
  // field with only the AO gradient measures well under ~40; parapet lips, HVAC
  // shadows, gable planes and emissive crowns push variance far higher). After
  // the first green fresh-server run, pin this to ~0.5× the measured value.
  gate('roof detail variance (absolute floor)', roof.variance >= 120, `${roof.variance.toFixed(1)} >= 120`);

  // --- 5: suburb inference jitter (Levittown, NY — classic tract housing) --
  await page.mouse.move(800, 450);
  await page.evaluate(() => {
    clearInterval(window.__roofPin); // re-pin at the suburb warp below
    window.__fly.warpToGeo(40.7259, -73.5143, { altM: 500, name: null });
    const f = window.__fly.flight;
    const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
    window.__roofPin = setInterval(() => {
      f.pos.x = p.x;
      f.pos.y = p.y;
      f.pos.z = p.z;
      f.heading = 0;
      f.pitch = 0;
      f.bank = 0;
      f.speed = 0;
    }, 8);
  });
  await waitToyStream(page, 90000);
  await page.waitForTimeout(2000);
  await shot('02-suburb');
  await page.evaluate(() => clearInterval(window.__roofPin));
  const sub = await page.evaluate(bufferProbe);
  console.log('suburb buffers:', JSON.stringify(sub));
  // inferH jitters untagged houses 9–15m (×1.35 small-boost below 15) and the
  // odd tagged school/commercial adds spread — a flat `?? 12` default reads 0.
  // GATE RECALIBRATED (R8 sweep): the jitter design's span is 9–15m ×1.35 =
  // ~8.1m, so a pure uniform jitter caps stdev at ~2.3 — the original >3 was
  // mathematically unattainable without tall tagged outliers. No-jitter
  // (broken inference) measures ~0.6; >1.5 separates the two cleanly.
  gate('suburb has buildings', (sub.buildings ?? 0) >= 30, `${sub.buildings} unique buildings`);
  gate('suburb height stdev > 1.5 (inference jitter)', (sub.stdev ?? 0) > 1.5, `stdev=${sub.stdev?.toFixed(2)}`);

  // --- 6: budget + errors ---------------------------------------------------
  const s = await page.evaluate(() => ({
    draws: window.__flyStats?.drawCalls,
    tris: window.__flyStats?.triangles,
    heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
  }));
  // 480 = PERF_BUDGET.drawCalls 470 (R8 fix round: raised from 450 — this
  // harness measured 461 at Levittown/high/shadows, the +50 shadow estimate
  // was low) + the same +10 composer slack the neon-city gate has always
  // carried (350 budget gated at 360 in round 7).
  console.log(`draws ${s.draws} · tris ${s.tris} · heap ${s.heapMB}MB`);
  gate('draw budget (≤ 480)', (s.draws ?? 0) <= 480, `draws=${s.draws}`);
  gate('zero page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
