/**
 * ROUND 22 (D "DEPTH") — INTERLEAVED paired A/B for gpuFrameMs.
 *
 * WHY THIS EXISTS, and it is the round's methodological point for D: the first
 * capture ran each flag leg once, in sequence, at a frozen pose — and measured
 * N8AO as 0.67 ms FASTER than off. The pose was frozen but the WORLD was not:
 * tiles keep refining, the LOD tree keeps settling, and over the ~30 s a
 * six-leg sweep takes, that drift is larger than every effect being measured.
 * A one-shot sequential A/B at a settling pose is a coin (the R18 lesson, in
 * GPU-time clothing).
 *
 * So every number here is a PAIRED difference: off, on, off, on, ... in
 * immediate succession, `repeats` times, and the reported delta is the MEDIAN
 * of the per-cycle (on - off) differences. Drift that is slow compared to one
 * cycle cancels. Each feature additionally gets an A/A control run at the same
 * cadence — the noise floor any claim has to clear.
 *
 * Instrument: EXT_disjoint_timer_query_webgl2 wrapped around composer.render,
 * i.e. the scene render plus every post pass — all of the work a DEPTH_PASS
 * flag can move.
 *
 * Usage: FLY_URL=http://localhost:3223 node scripts/r22-d-ab.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly } = require('./_boot');

if (!process.env.FLY_URL) {
  console.error('FLY_URL is required (never :3000 — the live server)');
  process.exit(2);
}

const SHOT = (n) => path.join(__dirname, `r22-d-${n}.png`);
const OUT = path.join(__dirname, 'r22-d-ab.json');
const NOON = Date.UTC(2026, 6, 17, 19, 30);
const ALLOFF = { catcher: 0, nearReceive: 0, n8ao: 0, aerialNear: 0 };
const results = { poses: {} };

const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--disable-gpu-vsync',
      '--disable-frame-rate-limit',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const glShot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: SHOT(n) });

  const { ms: bootMs } = await bootFly(page, { style: 'satellite' });
  results.bootMs = bootMs;
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.evaluate(() => {
    window.__flyAerialOverride = 1;
    window.__flySatShadow?.set(true);
    window.__flyDepthArm = 1;
    window.__flyDepthSub = { catcher: 0, nearReceive: 0, n8ao: 0, aerialNear: 0 };
  });
  await page.mouse.move(800, 450);

  results.gpuTimer = await page.evaluate(() => {
    if (window.__gpuTimer) return 'already';
    const c = window.__flyComposer;
    if (!c) return 'no-composer';
    const gl = c.renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return 'no-ext';
    const st = { samples: [], collecting: false, pending: null };
    const orig = c.render.bind(c);
    c.render = (dt) => {
      let q = null;
      if (st.collecting && !st.pending) {
        q = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      }
      orig(dt);
      if (q) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        st.pending = q;
      } else if (st.pending) {
        if (gl.getQueryParameter(st.pending, gl.QUERY_RESULT_AVAILABLE)) {
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT))
            st.samples.push(gl.getQueryParameter(st.pending, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(st.pending);
          st.pending = null;
        }
      }
    };
    window.__gpuTimer = st;
    return 'ok';
  });
  console.log('gpu timer:', results.gpuTimer);

  const gpu = (n = 50) =>
    page.evaluate(
      (want) =>
        new Promise((resolve) => {
          const s = window.__gpuTimer;
          s.samples.length = 0;
          s.collecting = true;
          const t0 = performance.now();
          const poll = () => {
            if (s.samples.length >= want || performance.now() - t0 > 9000) {
              s.collecting = false;
              const v = [...s.samples].sort((a, b) => a - b);
              return resolve(
                v.length
                  ? {
                      n: v.length,
                      p50: +v[Math.floor(v.length * 0.5)].toFixed(3),
                      p95: +v[Math.min(v.length - 1, Math.floor(v.length * 0.95))].toFixed(3),
                    }
                  : null
              );
            }
            requestAnimationFrame(poll);
          };
          requestAnimationFrame(poll);
        }),
      n
    );

  const sub = (o) =>
    page.evaluate((x) => {
      window.__flyDepthSub = x;
      window.__flyDepthArm = 1;
      window.__flyN8AO?.refresh?.();
    }, o);
  const draws = () =>
    page.evaluate(() => ({
      draws: window.__flyStats?.drawCalls ?? null,
      tris: window.__flyStats?.triangles ?? null,
      rig: window.__flyStats?.depthRig ?? null,
      aerial: (() => { try { return window.__flyAerial.get(); } catch { return null; } })(),
    }));

  const pose = async (lat, lon, altM, settleMs) => {
    await page.evaluate(
      ([la, lo, al, su]) => {
        const f = window.__fly.flight;
        delete f.step;
        delete f.__frozen;
        window.__flySunOverride = su;
        window.__fly.warpToGeo(la, lo, { altM: al, name: null });
      },
      [lat, lon, altM, NOON]
    );
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const f = window.__fly.flight;
      f.__frozen = true;
      f.step = () => {};
    });
    await page.waitForTimeout(settleMs);
    await page.evaluate(() => {
      if (window.__flyPlayer) window.__flyPlayer.visible = false;
      let s = window.__flyPlayer ?? window.__fly?.engine?.object ?? null;
      while (s && s.parent) s = s.parent;
      s?.traverse((o) => {
        if (o.isInstancedMesh && (o._isModel !== undefined || o._painted !== undefined))
          o.visible = false;
      });
    });
    await page.mouse.move(800, 450);
    await page.waitForTimeout(1500);
  };

  /**
   * `on` and `off` are __flyDepthSub payloads. Returns the median paired delta
   * plus both raw series, so the report can show the spread rather than just
   * the headline.
   */
  const paired = async (label, offCfg, onCfg, repeats = 4) => {
    const offs = [];
    const ons = [];
    const deltas = [];
    for (let i = 0; i < repeats; i++) {
      await sub(offCfg);
      await page.waitForTimeout(900);
      const a = await gpu();
      await sub(onCfg);
      await page.waitForTimeout(900);
      const b = await gpu();
      if (!a || !b) continue;
      offs.push(a.p50);
      ons.push(b.p50);
      deltas.push(+(b.p50 - a.p50).toFixed(3));
    }
    const out = {
      off: offs,
      on: ons,
      deltas,
      medianDelta: med(deltas),
      p95Off: null,
      p95On: null,
    };
    console.log(
      `  ${label.padEnd(22)} off ${JSON.stringify(offs)} on ${JSON.stringify(ons)} ` +
        `-> median dGPU ${out.medianDelta} ms`
    );
    return out;
  };

  const runPose = async (name, lat, lon, altM, settleMs, features, shots = []) => {
    console.log(`\n=== ${name} ===`);
    await sub(ALLOFF);
    await pose(lat, lon, altM, settleMs);
    const block = { agl: null, drawsOff: null, features: {} };
    await sub(ALLOFF);
    await page.waitForTimeout(1600);
    block.drawsOff = await draws();
    block.agl = block.drawsOff.rig?.agl ?? null;
    console.log(`  baseline draws ${block.drawsOff.draws} · agl ${block.agl}`);
    // A/A control at the same cadence — the floor any delta has to clear.
    block.features.AA = await paired('A/A control', ALLOFF, ALLOFF, 3);
    for (const [fname, cfg] of features) {
      block.features[fname] = await paired(fname, ALLOFF, cfg, 4);
      await sub(cfg);
      await page.waitForTimeout(1600);
      block.features[fname].draws = await draws();
      console.log(
        `    draws ${block.features[fname].draws.draws} ` +
          `(delta ${block.features[fname].draws.draws - block.drawsOff.draws}) · ` +
          `rig ${JSON.stringify(block.features[fname].draws.rig)}`
      );
    }
    for (const [shotName, cfg] of shots) {
      await sub(cfg);
      await page.waitForTimeout(2200);
      await glShot(shotName);
    }
    await sub(ALLOFF);
    results.poses[name] = block;
  };

  const ALL = { catcher: 1, nearReceive: 1, n8ao: 1, aerialNear: 1 };
  const F = {
    catcher: [['catcher', { ...ALLOFF, catcher: 1 }]],
    recv: [['nearReceive', { ...ALLOFF, nearReceive: 1 }]],
    n8ao: [['n8ao', { ...ALLOFF, n8ao: 1 }]],
    near: [['aerialNear', { ...ALLOFF, aerialNear: 1 }]],
    all: [['all', ALL]],
  };

  await runPose(
    'P-LEWIS',
    40.2083,
    -83.0701,
    400,
    26000,
    [...F.catcher, ...F.recv, ...F.n8ao, ...F.near, ...F.all],
    [
      ['lewis-01-off', ALLOFF],
      ['lewis-02-catcher', { ...ALLOFF, catcher: 1 }],
      ['lewis-03-n8ao', { ...ALLOFF, n8ao: 1 }],
      ['lewis-04-nearreceive', { ...ALLOFF, nearReceive: 1 }],
      ['lewis-05-aerialnear', { ...ALLOFF, aerialNear: 1 }],
      ['lewis-06-all', ALL],
    ]
  );

  await runPose(
    'OWENS',
    36.601,
    -118.06,
    500,
    24000,
    [...F.catcher, ...F.n8ao, ...F.all],
    [
      ['owens-01-off', ALLOFF],
      ['owens-02-all', ALL],
    ]
  );

  await runPose(
    'RIDGE-SIERRA',
    36.578,
    -118.29,
    3600,
    22000,
    [...F.recv],
    [
      ['ridge-01-off', ALLOFF],
      ['ridge-02-nearreceive', { ...ALLOFF, nearReceive: 1 }],
    ]
  );

  // Manhattan is the N8AO worst case and is measured at DPR 1.5, which is what
  // the quality ladder actually reaches on a retina display.
  console.log('\n--- DPR -> 1.5 ---');
  await page.evaluate(() => {
    const c = window.__flyComposer;
    c.renderer.setPixelRatio(1.5);
    c.setSize(window.innerWidth, window.innerHeight);
  });
  await page.waitForTimeout(2000);
  await runPose(
    'MANHATTAN-DPR1.5',
    40.7549,
    -73.984,
    500,
    26000,
    [...F.n8ao, ...F.recv, ...F.all],
    [
      ['nyc-01-off', ALLOFF],
      ['nyc-02-n8ao', { ...ALLOFF, n8ao: 1 }],
      ['nyc-03-all', ALL],
    ]
  );

  // Caster stand-ins at the same pose (DPR 1.5, dense scene).
  console.log('\n=== CASTER STAND-INS (600) ===');
  await page.evaluate(() => window.__flyCasterStandIn?.('carsParked', 600));
  await page.waitForTimeout(1800);
  const castOff = [];
  const castOn = [];
  const castD = [];
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => (window.__flyDepthCasters = { carsParked: 0 }));
    await page.waitForTimeout(900);
    const a = await gpu();
    await page.evaluate(() => (window.__flyDepthCasters = { carsParked: 1 }));
    await page.waitForTimeout(900);
    const b = await gpu();
    if (a && b) {
      castOff.push(a.p50);
      castOn.push(b.p50);
      castD.push(+(b.p50 - a.p50).toFixed(3));
    }
  }
  const castDraws = await draws();
  await page.evaluate(() => window.__flyCasterStandIn?.(null, 0));
  results.casterStandIn = { off: castOff, on: castOn, deltas: castD, medianDelta: med(castD), draws: castDraws };
  console.log(`  600 boxes: off ${JSON.stringify(castOff)} on ${JSON.stringify(castOn)} -> ${med(castD)} ms`);

  // ---- tier cycle, WITH and WITHOUT n8ao (the control the first run lacked)
  console.log('\n=== TIER CYCLES (program counts) ===');
  await page.evaluate(() => {
    const c = window.__flyComposer;
    c.renderer.setPixelRatio(1);
    c.setSize(window.innerWidth, window.innerHeight);
  });
  const cycle = async (tag, cfg) => {
    await sub(cfg);
    await page.waitForTimeout(3000);
    const seq = await page.evaluate(async () => {
      const gl = window.__flyComposer?.renderer;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const n = () => gl?.info?.programs?.length ?? -1;
      const out = [['high(start)', n()]];
      for (const t of ['medium', 'low', 'high']) {
        window.__flyStore.getState().setQualityTier(t);
        await wait(2600);
        out.push([t, n()]);
      }
      return out;
    });
    console.log(`  ${tag}: ${JSON.stringify(seq)}`);
    return seq;
  };
  results.tierCycleOff = await cycle('n8ao OFF (control)', ALLOFF);
  results.tierCycleOn = await cycle('n8ao ON', { ...ALLOFF, n8ao: 1 });

  results.pageerrors = errs;
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\npageerrors ${errs.length}`);
  if (errs.length) console.log(errs.slice(0, 5).join('\n'));
  await browser.close();
})();
