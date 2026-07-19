/**
 * §8.5.2 soak: 15-minute Fly-mode session on real hardware (GPU-enabled
 * Chrome), sampling frame times, draw calls, triangles, traffic and JS heap
 * every 10s while autonomously flying (turns + periodic boost + a warp).
 * Targets (renegotiated Round 13 — the original <300/<1.5M numbers predate
 * R7 and every round since; judge against the CURRENT harness-enforced
 * budgets): p5 fps ≥55 (gpuFrameMs 12 headroom), draw calls within
 * PERF_BUDGET + composer slack (toy ≤480, satellite ≤350/375 low-AGL),
 * tris < 2.2M (PERF_BUDGET.maxTriangles), heap stable (no monotonic climb).
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly } = require('./_boot');

const MINUTES = parseFloat(process.argv[2] || '15');
const IDLE = process.argv.includes('--idle'); // no inputs/warps: isolates tile churn
const NO_AUDIO = process.argv.includes('--no-audio'); // dispose FlyAudio: leak differential

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await bootFly(page); // R9-3: fly-only boot — waits on the real __flyBoot contract
  await page.mouse.move(800, 450);

  if (NO_AUDIO) {
    await page.evaluate(() => window.__fly?.audio?.dispose());
    console.log('audio disposed for differential');
  }

  // Frame-time collector
  await page.evaluate(() => {
    const s = (window.__soak = { frames: [], last: performance.now() });
    const tick = (t) => {
      s.frames.push(t - s.last);
      s.last = t;
      if (s.frames.length > 200000) s.frames.shift();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const samples = [];
  const t0 = Date.now();
  let phase = 0;
  while (Date.now() - t0 < MINUTES * 60 * 1000) {
    // vary the flight: gentle turns, altitude changes, periodic boost
    phase += 1;
    if (IDLE) {
      // straight and level at cruise — minimal tile streaming
    } else if (phase % 6 === 0) {
      await page.keyboard.down('Shift');
      await page.keyboard.down('a');
      await page.waitForTimeout(4000);
      await page.keyboard.up('a');
      await page.keyboard.up('Shift');
    } else if (phase % 6 === 3) {
      await page.keyboard.down('d');
      await page.waitForTimeout(2500);
      await page.keyboard.up('d');
    } else if (phase % 11 === 5) {
      await page.evaluate(() => {
        const fly = window.__fly;
        const items = [...(fly?.traffic?.items ?? [])].sort((a, b) => a.distM - b.distM);
        if (items[3]) fly.warpTo(items[3].hex);
      });
    } else if (phase % 9 === 4) {
      // Atlas round: open the atlas (2Hz canvas ticks + coastline draw),
      // idle on it, close — the open/closed segments the §8.5.2 soak wants
      await page.keyboard.press('m');
      await page.waitForTimeout(6000);
      await page.keyboard.press('Escape');
    } else if (phase % 17 === 8) {
      // Occasional long-range atlas warp: full cross-region re-stream under
      // load (chunks, DEM, imagery, traffic re-center) — the worst case
      await page.evaluate(() => {
        const cities = [
          [51.5074, -0.1278], // London
          [35.6762, 139.6503], // Tokyo
          [34.0522, -118.2437], // LA
          [40.6892, -74.0445], // back home
        ];
        const c = cities[Math.floor(Math.random() * cities.length)];
        window.__fly.warpToGeo?.(c[0], c[1], { altM: 900, name: null });
      });
    }
    await page.waitForTimeout(10000);

    const s = await page.evaluate(() => {
      const frames = window.__soak.frames.splice(0);
      frames.sort((a, b) => a - b);
      const p = (q) => frames[Math.min(frames.length - 1, Math.floor(q * frames.length))] ?? 0;
      return {
        t: Math.round(performance.now() / 1000),
        frames: frames.length,
        p50: +p(0.5).toFixed(1),
        p95: +p(0.95).toFixed(1),
        p99: +p(0.99).toFixed(1),
        drawCalls: window.__flyStats?.drawCalls ?? null,
        triangles: window.__flyStats?.triangles ?? null,
        traffic: window.__flyStats?.traffic ?? null,
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        rebases: window.__flyStats?.rebases ?? 0,
        maxRebaseMs: window.__flyStats?.maxRebaseMs ?? 0,
      };
    });
    samples.push(s);
    console.log(
      `[${Math.round((Date.now() - t0) / 60000)}m] p50 ${s.p50}ms p95 ${s.p95}ms draws ${s.drawCalls} tris ${s.triangles} traffic ${s.traffic} heap ${s.heapMB}MB`
    );
  }

  // Summary
  const all = samples.flatMap((s) => [s.p95]);
  const fpsP5 = 1000 / Math.max(...all); // worst p95 frame time ≈ p5 fps floor
  const heaps = samples.map((s) => s.heapMB).filter(Boolean);
  const summary = {
    minutes: MINUTES,
    samples: samples.length,
    worstP95ms: Math.max(...all),
    fpsFloorApprox: +fpsP5.toFixed(1),
    maxDrawCalls: Math.max(...samples.map((s) => s.drawCalls ?? 0)),
    maxTriangles: Math.max(...samples.map((s) => s.triangles ?? 0)),
    heapStartMB: heaps[0],
    heapEndMB: heaps[heaps.length - 1],
    maxRebaseMs: Math.max(...samples.map((s) => s.maxRebaseMs)),
    pageErrors: errs.length,
  };
  console.log('SOAK SUMMARY:', JSON.stringify(summary, null, 2));
  fs.writeFileSync(
    path.join(__dirname, 'soak-results.json'),
    JSON.stringify({ summary, samples, errs: errs.slice(0, 20) }, null, 2)
  );
  await browser.close();
})().catch((e) => {
  console.error('SOAK FAILED:', e.message);
  process.exit(1);
});
