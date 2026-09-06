/**
 * §8.5.2 soak: 15-minute Fly-mode session on real hardware (GPU-enabled
 * Chrome), sampling frame times, draw calls, triangles, traffic and JS heap
 * every 10s while autonomously flying (turns + periodic boost + a warp).
 * Targets (renegotiated Round 13 — the original <300/<1.5M numbers predate
 * R7 and every round since; judge against the CURRENT harness-enforced
 * budgets): p5 fps ≥55 (gpuFrameMs 12 headroom), draw calls within
 * PERF_BUDGET + composer slack (toy ≤480, satellite ≤350/375 low-AGL),
 * tris < 2.2M (PERF_BUDGET.maxTriangles), heap stable (no monotonic climb).
 *
 * ---------------------------------------------------------------------------
 * ROUND 21 (E "CERT") — SATELLITE MODE (`--style=satellite`), SANCTIONED EDIT
 * (FLY_ROUND21_PLAN.md §5.4 — the R20 close ruling's own re-spec, implemented)
 * ---------------------------------------------------------------------------
 * The R20 certification soaked TOY. Satellite — the app's DEFAULT style since
 * R10, and the style the user's two symptoms were reported in — had never been
 * soaked at all, under a live PerformanceMonitor or otherwise. This mode adds:
 *   · `--style=satellite`: boots satellite and flies a THREE-LEG ROUTE
 *     (NYC city → warp Powell OH suburb → rural Union County OH), because the
 *     three defect families live in different terrain: dense-city cost, the
 *     parcel-home/veg suburb races, and the empty-tile retry loops.
 *   · the perf governor UN-PINNED (scripts/_boot.js pins `__flyGovPin='hold'`
 *     fleet-wide; the soak is one of the four places that must let the ladder
 *     run) and every tier/DPR transition counted.
 *   · p50 / p95 / max for every series, not just max. The R20 close ruling
 *     DEMOTED scene-total max-tris after proving it cannot resolve a feature
 *     delta from same-config spread, and specified p95 as the statistic future
 *     soaks assert. That is what the BLOCKING gates below use.
 * BLOCKING (satellite mode only; exit code 1 on any breach):
 *     p95 triangles <= 2,200,000 · p95 draw calls <= 375 · heap does not climb
 *     · governor steps <= 4 over the run · zero pageerrors
 * The TOY path is byte-unchanged: without `--style` nothing below behaves
 * differently, including the exit code (the toy soak still reports and exits 0).
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly } = require('./_boot');

const MINUTES = parseFloat(process.argv[2] || '15');
const IDLE = process.argv.includes('--idle'); // no inputs/warps: isolates tile churn
const NO_AUDIO = process.argv.includes('--no-audio'); // dispose FlyAudio: leak differential
// Round 21: opt-in satellite mode. Absent ⇒ every line below runs exactly as
// it did in R20 (the flag is read once here and gates each new block).
const STYLE = (process.argv.find((a) => a.startsWith('--style=')) ?? '').split('=')[1] || null;
const SAT = STYLE === 'satellite';
const SAT_MAX_P95_TRIS = 2200000; // §4 frozen (the R20 close ruling's statistic)
const SAT_MAX_P95_DRAWS = 375; // the satellite draw ceiling
const SAT_MAX_GOV_STEPS = 4; // a 15-minute route may legitimately settle once
const BOOT_URL_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};

/** The three-leg satellite route: [minute, lat, lon, altM, label]. */
const SAT_ROUTE = [
  [0, 40.7549, -73.984, 900, 'nyc-city'],
  [5, 40.1578, -83.0752, 900, 'powell-suburb'],
  [10, 40.3, -83.3, 1500, 'union-rural'],
];

/** Un-pin the fleet governor pin from before the app mounts (E's idiom). */
const UNPIN_GOVERNOR = () => {
  try {
    Object.defineProperty(window, '__flyGovPin', {
      configurable: true,
      get: () => window.__r21GovUnpinned,
      set: (v) => {
        window.__r21GovPinAttempt = v;
      },
    });
  } catch {
    /* the run reports the pin state it actually got */
  }
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

  if (SAT) await page.addInitScript(UNPIN_GOVERNOR);
  // R9-3: fly-only boot — waits on the real __flyBoot contract. Round 21: the
  // satellite mode boots satellite; the no-flag call is unchanged.
  await bootFly(page, SAT ? { style: 'satellite', ...BOOT_URL_OPTS } : BOOT_URL_OPTS);
  await page.mouse.move(800, 450);

  if (SAT) {
    // Count every tier/DPR transition for the whole run, at 500 ms — a step
    // that reverts between two 10 s samples is exactly the flap this round
    // exists to kill, and an endpoint read cannot see it.
    await page.evaluate(() => {
      const s = (window.__soakGov = { tier: null, dpr: null, steps: 0, log: [], t0: performance.now() });
      const glOf = () => {
        const p = window.__flyPlayer ?? window.__satBuildings?.object ?? window.__satRoads?.object;
        return p?.__r3f?.root?.getState?.().gl ?? null;
      };
      s.tick = setInterval(() => {
        const tier = window.__flyStore?.getState?.().qualityTier ?? null;
        const dpr = glOf()?.getPixelRatio?.() ?? null;
        const t = Math.round((performance.now() - s.t0) / 1000);
        if (s.tier !== null && tier !== s.tier) {
          s.steps += 1;
          s.log.push(`tier ${s.tier}->${tier}@${t}s`);
        }
        if (s.dpr !== null && dpr !== s.dpr) {
          s.steps += 1;
          s.log.push(`dpr ${s.dpr}->${dpr}@${t}s`);
        }
        s.tier = tier;
        s.dpr = dpr;
      }, 500);
    });
    const pin = await page.evaluate(() => ({
      pin: window.__flyGovPin ?? null,
      attempted: window.__r21GovPinAttempt ?? null,
      gov: typeof window.__flyGov,
      tier: window.__flyStore?.getState?.().qualityTier ?? null,
    }));
    console.log(`SATELLITE soak: governor pin=${pin.pin} (fleet attempted ${pin.attempted}) ` +
      `__flyGov=${pin.gov} tier=${pin.tier}`);
  }

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
  let lastLeg = null; // round 21: satellite route bookkeeping (unused in toy)
  while (Date.now() - t0 < MINUTES * 60 * 1000) {
    // vary the flight: gentle turns, altitude changes, periodic boost
    phase += 1;
    if (SAT) {
      // The three-leg route: warp on schedule, gentle turns in between, and a
      // boost run each minute so the sampler sees the loaded case too.
      const mins = (Date.now() - t0) / 60000;
      const leg = [...SAT_ROUTE].reverse().find((r) => mins >= r[0]);
      if (leg && leg[4] !== lastLeg) {
        lastLeg = leg[4];
        console.log(`[leg] ${leg[4]} @${mins.toFixed(1)}m`);
        await page.evaluate(
          ([lat, lon, altM]) => window.__fly.warpToGeo?.(lat, lon, { altM, name: null }),
          [leg[1], leg[2], leg[3]]
        );
        await page.waitForTimeout(4000);
      } else if (phase % 4 === 0) {
        await page.keyboard.down('d');
        await page.waitForTimeout(3000);
        await page.keyboard.up('d');
      } else if (phase % 4 === 2) {
        await page.keyboard.down('Shift');
        await page.waitForTimeout(4000);
        await page.keyboard.up('Shift');
      }
    } else if (IDLE) {
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

    const s = await page.evaluate((sat) => {
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
        // Round 24 (E CERT): the in-app instrument, when FRAME_STATS is on.
        // The private `window.__soak` rAF collector above STAYS — it is the
        // fallback, it is what every R20/R21 number was measured with, and
        // the R21 quartet must stay green with the flag off. This key is
        // simply absent (null) then, so soak-results.json keeps its key set
        // shape and no existing assertion can see a difference.
        frame: window.__flyStats?.frame?.sample
          ? (() => {
              const f = window.__flyStats.frame.sample();
              const out = {
                p50: +f.p50.toFixed(2),
                p95: +f.p95.toFixed(2),
                p99: +f.p99.toFixed(2),
                worstDt: +f.worstDt.toFixed(1),
                long33PerMin: f.long33PerMin,
                long100PerMin: f.long100PerMin,
                stallsPerMin: f.stallsPerMin,
                stallThresholdMs: +f.stallThresholdMs.toFixed(1),
                longtasks: f.longtasks,
                programs: f.programs,
                programsDelta: f.programsDelta,
                lastStall: f.lastStall,
              };
              window.__flyStats.frame.reset();
              return out;
            })()
          : null,
        // Round 21: satellite-mode telemetry ONLY. Spread in under the flag so
        // the toy sample object — and therefore soak-results.json — keeps
        // exactly the R20 key set.
        ...(sat
          ? {
              tier: window.__flyStore?.getState?.().qualityTier ?? null,
              govSteps: window.__soakGov?.steps ?? null,
              govFromStats: window.__flyStats?.governor
                ? {
                    dprSteps: window.__flyStats.governor.dprSteps,
                    tierSteps: window.__flyStats.governor.tierSteps,
                    latched: window.__flyStats.governor.latched,
                    emaFps: window.__flyStats.governor.emaFps,
                  }
                : null,
              fxRebuilds: window.__flyStats?.fx?.rebuilds ?? null,
              sb: window.__satBuildings?.stats
                ? {
                    chunks: window.__satBuildings.stats.chunks,
                    ready: window.__satBuildings.stats.ready,
                  }
                : null,
              parcel: window.__flyStats?.parcelHomes?.placed ?? null,
            }
          : {}),
      };
    }, SAT);
    samples.push(s);
    console.log(
      `[${Math.round((Date.now() - t0) / 60000)}m] p50 ${s.p50}ms p95 ${s.p95}ms draws ${s.drawCalls} tris ${s.triangles} traffic ${s.traffic} heap ${s.heapMB}MB` +
        (SAT ? ` tier ${s.tier} gov ${s.govSteps} sb ${s.sb?.ready}/${s.sb?.chunks}` : '') +
        (s.frame
          ? ` | FRAME p99 ${s.frame.p99}ms worst ${s.frame.worstDt}ms stalls/min ${s.frame.stallsPerMin} long100/min ${s.frame.long100PerMin} prog+${s.frame.programsDelta}`
          : '')
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
  // ------------------------------------------------------------------ R21 --
  // Satellite mode: percentile statistics + the BLOCKING gates. Everything in
  // this block is skipped without --style=satellite, so the toy summary, its
  // output file and its exit code are unchanged.
  let satFails = [];
  if (SAT) {
    const pct = (arr, q) => {
      const a = [...arr].filter((v) => v !== null && v !== undefined).sort((x, y) => x - y);
      return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : null;
    };
    const tris = samples.map((s) => s.triangles);
    const draws = samples.map((s) => s.drawCalls);
    const frame = samples.map((s) => s.p95);
    const gov = await page.evaluate(() => {
      const s = window.__soakGov;
      if (s?.tick) clearInterval(s.tick);
      return { steps: s?.steps ?? null, log: s?.log ?? [], stats: window.__flyStats?.governor ?? null };
    });
    // Heap climb: the LAST third's floor versus the FIRST third's floor. A
    // start-to-end delta reads the GC sawtooth, not retention.
    const third = Math.max(1, Math.floor(heaps.length / 3));
    const floor0 = Math.min(...heaps.slice(0, third));
    const floor1 = Math.min(...heaps.slice(-third));
    Object.assign(summary, {
      style: 'satellite',
      route: SAT_ROUTE.map((r) => r[4]),
      p50Triangles: pct(tris, 0.5),
      p95Triangles: pct(tris, 0.95),
      p50DrawCalls: pct(draws, 0.5),
      p95DrawCalls: pct(draws, 0.95),
      p50FrameMs: pct(frame, 0.5),
      p95FrameMs: pct(frame, 0.95),
      governorSteps: gov.steps,
      governorLog: gov.log,
      governorStats: gov.stats,
      heapFloorStartMB: floor0,
      heapFloorEndMB: floor1,
      heapFloorClimbMB: floor1 - floor0,
      tiersSeen: [...new Set(samples.map((s) => s.tier))],
    });
    const g = (name, ok, detail) => {
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
      if (!ok) satFails.push(name);
    };
    console.log('\nSATELLITE SOAK GATES (BLOCKING)');
    g(
      `p95 triangles <= ${SAT_MAX_P95_TRIS}`,
      (summary.p95Triangles ?? Infinity) <= SAT_MAX_P95_TRIS,
      `p50=${summary.p50Triangles} p95=${summary.p95Triangles} max=${summary.maxTriangles}`
    );
    g(
      `p95 draw calls <= ${SAT_MAX_P95_DRAWS}`,
      (summary.p95DrawCalls ?? Infinity) <= SAT_MAX_P95_DRAWS,
      `p50=${summary.p50DrawCalls} p95=${summary.p95DrawCalls} max=${summary.maxDrawCalls}`
    );
    g(
      'heap does not climb (last third floor vs first third floor < 60 MB)',
      floor1 - floor0 < 60,
      `${floor0} -> ${floor1} MB (+${floor1 - floor0})`
    );
    g(
      `governor steps <= ${SAT_MAX_GOV_STEPS} over the run`,
      (gov.steps ?? 0) <= SAT_MAX_GOV_STEPS,
      `${gov.steps} · ${JSON.stringify(gov.log.slice(0, 8))}`
    );
    g('zero pageerrors', errs.length === 0, `${errs.length}${errs[0] ? ` · ${errs[0].slice(0, 120)}` : ''}`);
  }

  console.log('SOAK SUMMARY:', JSON.stringify(summary, null, 2));
  fs.writeFileSync(
    path.join(__dirname, SAT ? 'soak-results-satellite.json' : 'soak-results.json'),
    JSON.stringify({ summary, samples, errs: errs.slice(0, 20) }, null, 2)
  );
  await browser.close();
  if (SAT) {
    console.log(satFails.length ? `SOAK: FAIL (${satFails.join(', ')})` : 'SOAK: PASS');
    process.exit(satFails.length ? 1 : 0);
  }
})().catch((e) => {
  console.error('SOAK FAILED:', e.message);
  process.exit(1);
});
