/**
 * ROUND 21 (E "CERT") — verify-tier-step: what a quality-tier step COSTS.
 *
 * verify-stability asserts the ladder does not step at a steady pose. This
 * gate asserts the other half: when a step DOES happen — and on a real
 * machine it will, on a warp, a weather change, a window resize — it must not
 * detonate the world. Today it does, and every piece of that detonation is
 * measured here on the pre-fix tree:
 *
 *   S3  a tier step re-keys SatBuildingLayer/SatVegLayer material and coverage
 *       resolution, which evicts and re-streams chunks: the world empties and
 *       refills. Gate (3) counts the chunks across the step.
 *   S4  the composer is re-created rather than resized. postprocessing's
 *       EffectComposer sizes its render targets from the RENDER size, while a
 *       DPR change resizes the DRAWING BUFFER — so after a DPR step the passes
 *       render into buffers of the wrong size (the stretched frame), and the
 *       library's removePass never disposes, so the old targets leak. Gates
 *       (4) and (6) measure the buffer agreement and the leak.
 *   S2  every material variant recompiles on first draw after the step because
 *       nothing is retained or pre-warmed. Gate (5) asserts the program count
 *       is FLAT after the first cycle — that is the prewarm/retention proof.
 *
 * ---------------------------------------------------------------------------
 * HOW THE STEP IS DRIVEN
 * ---------------------------------------------------------------------------
 * Preferred: `window.__flyGov.force(dir)` (A's instrument) — the real ladder,
 * including whatever A does to DPR. Fallback on a tree where A has not merged:
 * `useFlyStore.getState().setQualityTier(t)` through `window.__flyStore`, which
 * is the exact same store write the drei PerformanceMonitor performs today, so
 * the fallback measures the REAL R20 cost and is a valid RED calibration. The
 * fallback is announced in the run output; W3 certification requires the
 * __flyGov path.
 *
 * The fleet governor pin (`__flyGovPin='hold'`, scripts/_boot.js) is un-pinned
 * here by the verify-stability idiom: an accessor defined before the app mounts
 * swallows the fleet write. This gate FORCES steps, so it must also make sure
 * the live ladder cannot step underneath it — it drives from a settled, pinned
 * pose and reports any step it did not ask for.
 *
 * ---------------------------------------------------------------------------
 * RED CALIBRATION (r21/e @ e1077f8 — R20 behaviour) — see the RED table the
 * run prints, and the round record. Thresholds carry their basis inline.
 * ---------------------------------------------------------------------------
 *
 * GATES
 *  (1) precondition: a settled satellite scene with a real chunk population
 *  (2) the step actually happened (tier changed both ways, 3 cycles)
 *  (3) CHUNKS SURVIVE — satBuildings chunk count across high<->medium is
 *      unchanged within WATER_SLACK; the ring is not re-streamed (evictions
 *      delta 0 where the counter exists, else `ready` recovers within 2 s)
 *  (4) COMPOSER BUFFER === DRAWING BUFFER after every step
 *  (5) PROGRAMS FLAT after cycle 1 (the prewarm/retention proof)
 *  (6) GEOMETRIES + TEXTURES FLAT across cycles 2-3 (the dispose proof)
 *  (7) THE WORLD NEVER VANISHES — draw calls never hit 0, and never drop below
 *      half the settled level, at any point during the cycles
 *  (8) zero pageerrors
 *
 * Run: FLY_URL=http://localhost:3124 node scripts/verify-tier-step.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const CYCLES = +(process.env.TIER_CYCLES ?? 3);
const DWELL_MS = +(process.env.TIER_DWELL_MS ?? 3000);

/* THE READY FRACTION. `chunks` is the ring SIZE and it legitimately moves with
 * the tier (SAT_COVERAGE is high-tier-only: the ring measures 16 chunks at high
 * and 12 at medium), so a gate on the raw count is vacuous — the first
 * calibration run read chunks 16/16/16 as a clean PASS while the geometry
 * inside them collapsed from 16 ready to 0. What must survive a re-key is the
 * geometry of the chunks that stay IN the ring, i.e. ready/chunks.
 * Settled = 1.00. The only legitimate dip is the up-step, where the coverage
 * widen adds 4 previously-uncovered chunks to a ring of 16 and they stream from
 * scratch: 12/16 = 0.75. The floor is set one chunk below that. */
const READY_FRAC_MIN = 0.7;
/* Growth slack for the memory floors. A tier step legitimately changes WHICH
 * textures exist (the facade/night atlases are high-tier only), so the leak
 * signature is not a spread — it is a FLOOR THAT RISES cycle over cycle. */
const MEM_FLOOR_SLACK = 6;
const DRAW_FLOOR_FRAC = 0.5; // gate (7): never below half the settled level

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
    /* reported by the gate below */
  }
};

/** Per-frame GL draw counter (see verify-stability for the rationale). */
const INSTALL_DRAW_COUNTER = () => {
  const S = (window.__r21Draws = { cur: 0, series: [] });
  const patch = (proto) => {
    if (!proto) return;
    for (const m of [
      'drawElements',
      'drawArrays',
      'drawElementsInstanced',
      'drawArraysInstanced',
      'drawRangeElements',
    ]) {
      const fn = proto[m];
      if (typeof fn !== 'function') continue;
      proto[m] = function patched(...a) {
        S.cur += 1;
        return fn.apply(this, a);
      };
    }
  };
  patch(window.WebGLRenderingContext?.prototype);
  patch(window.WebGL2RenderingContext?.prototype);
  const tick = () => {
    S.series.push(S.cur);
    S.cur = 0;
    if (S.series.length > 200000) S.series.shift();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

/**
 * One renderer census. The WebGLRenderer is reached through R3F's own local
 * state on any Object3D it manages (`obj.__r3f.root.getState()`) — the app
 * exposes no `gl` handle and this gate must not require one to be added.
 * `composer` is found by walking the scene's userData/EffectComposer handle if
 * one is published, else the composer's buffer size is inferred from the
 * render targets three currently knows about — reported as null when neither
 * is reachable so the gate SOFT-fails instead of guessing.
 */
const CENSUS = () => {
  const probe =
    window.__flyPlayer ??
    window.__satBuildings?.object ??
    window.__satRoads?.object ??
    window.__toyWorld?.object ??
    null;
  const st = probe?.__r3f?.root?.getState?.() ?? null;
  const gl = st?.gl ?? null;
  if (!gl) return { err: 'no-renderer' };
  const dbSize = gl.getDrawingBufferSize({
    set(x, y) {
      this.x = x;
      this.y = y;
      return this;
    },
    floor() {
      this.x = Math.floor(this.x);
      this.y = Math.floor(this.y);
      return this;
    },
  });
  // The composer: FlyScene/Effects publish none, so it is found through the
  // R3F store's own frame-loop subscribers is not portable — instead read the
  // handle A's FlyEffectComposer publishes when it exists, and fall back to
  // the postprocessing composer three keeps on the renderer when the library
  // version stores one. Either way a MISSING composer is reported, not faked.
  const comp = window.__flyComposer ?? window.__flyStats?.fx?.composer ?? null;
  const cw = comp?.inputBuffer?.width ?? comp?.renderTarget1?.width ?? null;
  const ch = comp?.inputBuffer?.height ?? comp?.renderTarget1?.height ?? null;
  return {
    tier: window.__flyStore?.getState?.().qualityTier ?? null,
    dpr: gl.getPixelRatio?.() ?? null,
    viewportDpr: st.viewport?.dpr ?? null,
    canvas: [gl.domElement.width, gl.domElement.height],
    drawingBuffer: [dbSize.x, dbSize.y],
    composer: cw ? [cw, ch] : null,
    programs: gl.info?.programs?.length ?? -1,
    geometries: gl.info?.memory?.geometries ?? -1,
    textures: gl.info?.memory?.textures ?? -1,
    sb: window.__satBuildings?.stats
      ? {
          chunks: window.__satBuildings.stats.chunks,
          ready: window.__satBuildings.stats.ready,
          columns: window.__satBuildings.stats.columns,
          evictions: window.__satBuildings.stats.evictions ?? null,
          heals: window.__satBuildings.stats.heals ?? null,
        }
      : null,
    sky: window.__satSkyline?.stats
      ? { chunks: window.__satSkyline.stats.chunks, ready: window.__satSkyline.stats.ready }
      : null,
    veg: window.__flyStats?.satVeg?.ready ?? null,
    fx: window.__flyStats?.fx?.rebuilds ?? null,
    draws: window.__flyStats?.drawCalls ?? -1,
  };
};

const PIN_POSE = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  f.heading = heading;
  f.pitch = pitch;
  f.bank = 0;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__r21Pin) clearInterval(window.__r21Pin);
  window.__r21Pin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = heading;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
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
    if (m.type() === 'error') errs.push(`console: ${m.text().slice(0, 160)}`);
  });
  const fails = [];
  const softs = [];
  const red = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const soft = (name, owner, detail = '') => {
    console.log(`SOFT ${name} — instrument missing (owner ${owner})${detail ? ' · ' + detail : ''}`);
    softs.push(name);
  };

  await page.addInitScript(UNPIN_GOVERNOR);
  await page.addInitScript(INSTALL_DRAW_COUNTER);
  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.mouse.move(800, 450);
  // Manhattan at 900 m: buildings, skyline, roads, water and veg all populated,
  // so a re-stream has something to lose. Sun pinned to the R18/R20 satellite
  // hour so the night-window atlas state cannot vary between cycles.
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 27, 17, 0, 0);
  });
  await page.evaluate(PIN_POSE, [40.7549, -73.984, 900, 2.6, -0.28]);
  await page.waitForTimeout(28000);

  const usingGov = await page.evaluate(() => typeof window.__flyGov?.force === 'function');
  if (!usingGov)
    soft(
      'window.__flyGov.force',
      'A',
      'falling back to the store write the drei PerformanceMonitor performs today'
    );
  const setTier = (t) =>
    page.evaluate(
      ([tier, useGov, dir]) => {
        if (useGov) return window.__flyGov.force(dir);
        return window.__flyStore.getState().setQualityTier(tier);
      },
      [t, usingGov, t === 'medium' ? -1 : +1]
    );

  const base = await page.evaluate(CENSUS);
  console.log('SETTLED:', JSON.stringify(base));
  gate(
    '(1) settled satellite scene with a real chunk population',
    !base.err && (base.sb?.ready ?? 0) >= 6 && base.draws > 50,
    `tier=${base.tier} sbReady=${base.sb?.ready}/${base.sb?.chunks} sky=${base.sky?.ready} draws=${base.draws}`
  );
  if (base.composer === null)
    soft('(4) composer buffer size', 'A', 'no composer handle published (window.__flyComposer)');

  // A 100 ms trace: the first calibration run read tier='high' at BOTH ends of
  // every cycle and would have called the step a no-op — the drei
  // PerformanceMonitor's onIncline had already reverted the forced 'medium'
  // inside the 3 s dwell (the R16 §7 lesson, live). The step had absolutely
  // happened: satBuildings.ready collapsed 16 -> 5 underneath it. An endpoint
  // sample cannot see a step that reverts; the trace can.
  await page.evaluate(() => {
    const s = (window.__r21Trace = { t0: performance.now(), rows: [] });
    const glOf = () => {
      const p = window.__flyPlayer ?? window.__satBuildings?.object ?? window.__satRoads?.object;
      return p?.__r3f?.root?.getState?.().gl ?? null;
    };
    s.tick = setInterval(() => {
      const gl = glOf();
      s.rows.push({
        t: +((performance.now() - s.t0) / 1000).toFixed(2),
        tier: window.__flyStore?.getState?.().qualityTier ?? null,
        dpr: gl?.getPixelRatio?.() ?? null,
        ready: window.__satBuildings?.stats?.ready ?? null,
        chunks: window.__satBuildings?.stats?.chunks ?? null,
        sky: window.__satSkyline?.stats?.ready ?? null,
        skyChunks: window.__satSkyline?.stats?.chunks ?? null,
        progs: gl?.info?.programs?.length ?? null,
        geo: gl?.info?.memory?.geometries ?? null,
        tex: gl?.info?.memory?.textures ?? null,
      });
    }, 100);
  });
  // HOLD the forced tier for the dwell. Without this the fallback path
  // measures a flap rather than a step (see the trace note above); __flyGov's
  // own force() is expected to latch, so the hold is a no-op under A's path.
  const hold = (t) =>
    page.evaluate((tier) => {
      if (window.__r21Hold) clearInterval(window.__r21Hold);
      window.__r21Hold = setInterval(() => {
        const s = window.__flyStore?.getState?.();
        if (s && s.qualityTier !== tier) s.setQualityTier(tier);
      }, 200);
    }, t);
  const unhold = () => page.evaluate(() => clearInterval(window.__r21Hold));

  const cycles = [];
  const drawIdx0 = await page.evaluate(() => window.__r21Draws.series.length);
  for (let c = 0; c < CYCLES; c++) {
    await setTier('medium');
    if (!usingGov) await hold('medium');
    await page.waitForTimeout(DWELL_MS);
    const down = await page.evaluate(CENSUS);
    if (!usingGov) await unhold();
    await setTier('high');
    if (!usingGov) await hold('high');
    await page.waitForTimeout(DWELL_MS);
    const up = await page.evaluate(CENSUS);
    if (!usingGov) await unhold();
    cycles.push({ down, up });
    console.log(
      `CYCLE ${c + 1}: down[tier=${down.tier} dpr=${down.dpr} chunks=${down.sb?.chunks} ` +
        `ready=${down.sb?.ready} progs=${down.programs} geo=${down.geometries} tex=${down.textures} ` +
        `db=${down.drawingBuffer} comp=${down.composer}] · up[tier=${up.tier} dpr=${up.dpr} ` +
        `chunks=${up.sb?.chunks} ready=${up.sb?.ready} progs=${up.programs} geo=${up.geometries} ` +
        `tex=${up.textures} db=${up.drawingBuffer} comp=${up.composer}]`
    );
  }
  const series = await page.evaluate((i) => window.__r21Draws.series.slice(i), drawIdx0);
  const trace = await page.evaluate(() => {
    clearInterval(window.__r21Trace.tick);
    return window.__r21Trace.rows;
  });
  const tiersSeen = [...new Set(trace.map((r) => r.tier))];
  const dprSeen = [...new Set(trace.map((r) => r.dpr))];
  const minReady = Math.min(...trace.map((r) => r.ready ?? 0));
  const minSky = Math.min(...trace.map((r) => r.sky ?? 0));
  const fracs = trace
    .filter((r) => (r.chunks ?? 0) > 0)
    .map((r) => (r.ready ?? 0) / r.chunks);
  const minFrac = fracs.length ? Math.min(...fracs) : -1;
  const skyFracs = trace.filter((r) => (r.skyChunks ?? 0) > 0).map((r) => (r.sky ?? 0) / r.skyChunks);
  const minSkyFrac = skyFracs.length ? Math.min(...skyFracs) : -1;
  console.log(
    `TRACE (${trace.length} samples @100ms): tiers=${JSON.stringify(tiersSeen)} ` +
      `dpr=${JSON.stringify(dprSeen)} · satBuildings.ready ${base.sb?.ready} -> min ${minReady} · ` +
      `skyline.ready ${base.sky?.ready} -> min ${minSky} · programs ` +
      `${Math.min(...trace.map((r) => r.progs ?? 0))}..${Math.max(...trace.map((r) => r.progs ?? 0))}`
  );
  await page
    .locator('.fixed.inset-0 canvas')
    .first()
    .screenshot({ path: path.join(__dirname, 'r21-e-tierstep-01-after-cycles.png') });

  // --- (2) the steps happened ---------------------------------------------
  const stepped = tiersSeen.includes('medium') && tiersSeen.includes('high');
  gate(
    `(2) ${CYCLES} forced high<->medium cycles actually landed (read off the trace)`,
    stepped,
    `tiers seen=${JSON.stringify(tiersSeen)} · endpoint samples=${cycles
      .map((c) => `${c.down.tier}/${c.up.tier}`)
      .join(' ')}`
  );

  // --- (3) chunks survive ---------------------------------------------------
  // READY, not `chunks`. The ring SIZE is a coverage constant that does not
  // move with the tier; what a re-key destroys is the geometry inside it, and
  // that is `ready`. The first calibration run read chunks 16/16/16 (a clean
  // PASS) while ready collapsed 16 -> 5 in the same window — a gate on `chunks`
  // alone is exactly the kind of vacuous pass the R20 close ruling demoted.
  gate(
    `(3) CHUNK GEOMETRY SURVIVES the step (ready/chunks never below ${READY_FRAC_MIN}; settled 1.00)`,
    minFrac >= READY_FRAC_MIN,
    `min ready/chunks=${minFrac.toFixed(2)} (ready floor ${minReady}) · ` +
      `chunks=${JSON.stringify(cycles.flatMap((c) => [c.down.sb?.chunks, c.up.sb?.chunks]))} ` +
      `ready=${JSON.stringify(cycles.flatMap((c) => [c.down.sb?.ready, c.up.sb?.ready]))}`
  );
  red.push([
    'S3 tier step re-streams the ring',
    'verify-tier-step (3)',
    minFrac.toFixed(2),
    `>= ${READY_FRAC_MIN}`,
  ]);
  gate(
    `(3a) the SKYLINE ring survives the step too (ready/chunks >= ${READY_FRAC_MIN})`,
    minSkyFrac >= READY_FRAC_MIN,
    `min ready/chunks=${minSkyFrac.toFixed(2)} (settled ${base.sky?.ready}/${base.sky?.chunks}, floor ${minSky})`
  );
  const ev = cycles[cycles.length - 1].up.sb?.evictions;
  if (ev === null || ev === undefined)
    soft('(3b) eviction counter', 'B', 'chunk-count survival is the standing proxy');
  else
    gate(
      '(3b) the step evicted nothing',
      ev - (base.sb?.evictions ?? 0) === 0,
      `evictions ${base.sb?.evictions}->${ev}`
    );

  // --- (4) composer buffer === drawing buffer ------------------------------
  const bufMismatch = cycles
    .flatMap((c) => [c.down, c.up])
    .filter((s) => s.composer && (s.composer[0] !== s.drawingBuffer[0] || s.composer[1] !== s.drawingBuffer[1]));
  if (cycles.some((c) => c.up.composer))
    gate(
      '(4) COMPOSER BUFFER === DRAWING BUFFER after every step',
      bufMismatch.length === 0,
      bufMismatch.length
        ? `${bufMismatch.length} mismatched: e.g. composer ${bufMismatch[0].composer} vs drawing ${bufMismatch[0].drawingBuffer}`
        : 'agreed at every sample'
    );

  // --- (5) programs flat after cycle 1 -------------------------------------
  // Off the TRACE, not the endpoints: a program compiled and dropped inside a
  // dwell is exactly the cost this gate exists to see.
  const progs = trace.map((r) => r.progs ?? 0).filter(Boolean);
  const cyclePoint = Math.floor(progs.length / CYCLES);
  const afterC1 = progs.slice(cyclePoint);
  const progGrowth = afterC1.length ? Math.max(...afterC1) - Math.min(...afterC1) : 0;
  gate(
    '(5) PROGRAMS FLAT after cycle 1 (prewarm + retention)',
    progGrowth === 0,
    `base=${base.programs} trace ${Math.min(...progs)}..${Math.max(...progs)} · ` +
      `growth after cycle 1 = ${progGrowth}`
  );
  red.push(['S2 recompile on every step', 'verify-tier-step (5)', progGrowth, '0']);

  // --- (6) geometries + textures flat across cycles 2-3 --------------------
  // PER-CYCLE FLOORS. Each cycle's minimum is the "everything transient has
  // been released" reading; a leak is that floor rising cycle over cycle. A
  // spread would indict the legitimate high-tier-only atlases/water meshes
  // appearing and disappearing with the tier — which is not a leak.
  const seg = (arr, i) => arr.slice(Math.floor((i * arr.length) / CYCLES), Math.floor(((i + 1) * arr.length) / CYCLES));
  const geoAll = trace.map((r) => r.geo ?? 0).filter(Boolean);
  const texAll = trace.map((r) => r.tex ?? 0).filter(Boolean);
  const geoFloors = [];
  const texFloors = [];
  for (let i = 0; i < CYCLES; i++) {
    const g = seg(geoAll, i);
    const t = seg(texAll, i);
    if (g.length) geoFloors.push(Math.min(...g));
    if (t.length) texFloors.push(Math.min(...t));
  }
  const geoRise = geoFloors.length > 1 ? geoFloors[geoFloors.length - 1] - geoFloors[0] : 0;
  const texRise = texFloors.length > 1 ? texFloors[texFloors.length - 1] - texFloors[0] : 0;
  gate(
    `(6) NOTHING LEAKS ACROSS CYCLES — the per-cycle geometry/texture FLOOR does not rise (<= ${MEM_FLOOR_SLACK})`,
    geoRise <= MEM_FLOOR_SLACK && texRise <= MEM_FLOOR_SLACK,
    `geometry floors ${JSON.stringify(geoFloors)} (rise ${geoRise}) · ` +
      `texture floors ${JSON.stringify(texFloors)} (rise ${texRise})`
  );
  red.push([
    'S4 composer/material leak',
    'verify-tier-step (6)',
    `${geoRise}/${texRise}`,
    `<= ${MEM_FLOOR_SLACK}`,
  ]);

  // --- (7) the world never vanishes ---------------------------------------
  const settledDraws = series.length ? [...series].sort((a, b) => a - b)[Math.floor(series.length / 2)] : 0;
  const minDraws = series.length ? Math.min(...series) : -1;
  const zeros = series.filter((v) => v === 0).length;
  gate(
    `(7) THE WORLD NEVER VANISHES — draws never 0 and never below ${DRAW_FLOOR_FRAC}x the median`,
    zeros === 0 && minDraws >= settledDraws * DRAW_FLOOR_FRAC,
    `median=${settledDraws} min=${minDraws} zeroFrames=${zeros} over ${series.length} frames`
  );
  red.push(['S3 world empties during the step', 'verify-tier-step (7)', `min ${minDraws}/${settledDraws}`, `>= ${DRAW_FLOOR_FRAC}x`]);

  gate('(8) zero page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  fs.writeFileSync(
    path.join(__dirname, 'r21-e-red-tierstep.json'),
    JSON.stringify(
      { when: new Date().toISOString(), usingGov, base, cycles, trace, drawSeries: series, red, fails, softs },
      null,
      1
    )
  );
  if (softs.length) console.log(`SOFT (instruments missing): ${softs.join(', ')}`);
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
