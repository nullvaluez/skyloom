/**
 * ROUND 21 — B STREAMKEEPER's own measurement probe (NOT a gate; it prints
 * numbers and writes JSON so the same run can be repeated with
 * STREAM_KEEPER.enabled false and true and the two compared).
 *
 * Sections (all run by default; pass one or more of `orbit heal skyline` to
 * pick):
 *
 *   orbit  — P1, the bend-blind bounding sphere. A FIXED pose in Neon at
 *            cruise (the z12 'far' + z10 'ultra' rings armed, where the shader
 *            drop is ~39% and ~89% of a chunk's sphere radius), then the camera
 *            is yawed through 360° in 24 steps. At each heading it counts the
 *            chunk meshes three actually SUBMITTED (an onBeforeRender tap —
 *            three calls it only for objects that survived frustum culling)
 *            against the number the engine is holding. The gap between the two
 *            IS the culling decision; comparing the gap flag-off vs flag-on
 *            measures exactly how many on-screen chunks the unpadded sphere was
 *            dropping. Screenshots at each heading let the pixel consequence be
 *            differenced too.
 *
 *   heal   — P6, the heal-evict loop. Sits still in satellite over a DEM-seam
 *            city for 90 s and samples the sat-building engine's `heals` and
 *            `evictions` counters (both UNFLAGGED, so the R20 churn rate is
 *            directly measurable with the flag off).
 *
 *   skyline— P2, the permanent group hole. Aborts ONE z14 tile of a NYC skyline
 *            group at the network layer, lets the group finalize around the
 *            hole, then REMOVES the abort and watches `stats.tris`. Flag off the
 *            group is holed forever; flag on it rebuilds after the backoff.
 *
 *   overdraw— P1 again, decided inside ONE session (see the block comment).
 *            MEASURED VERDICT: underpowered in Neon. The same-state noise pair
 *            moves 5.4-7.7% of the frame all by itself (road pulses, beacon
 *            blink, foam scroll, town glow, cloud deck and the hero all animate
 *            in the crop) while the false-cull signal is 3.7-4.5% — so this
 *            pair CANNOT decide P1 and is reported as the coin it is. The
 *            load-bearing P1 evidence is the `orbit` section's submitted-mesh
 *            count, which is deterministic per heading and whose SIGN is a
 *            theorem (a larger sphere can only ever add submitted chunks).
 *
 * Honours FLY_URL. Writes scripts/r21b-<section>.json + r21b-*.png.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly } = require('./_boot');

const URL_BASE = process.env.FLY_URL || 'http://localhost:3000';
const TAG = process.env.R21B_TAG || 'run'; // e.g. 'off' / 'on'
const want = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const runs = (name) => want.length === 0 || want.includes(name);

const out = (n) => path.join(__dirname, `r21b-${TAG}-${n}`);

const pinScene = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  f.heading = heading;
  f.pitch = pitch;
  f.bank = 0;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  window.__pinH = heading;
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = window.__pinH;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

/**
 * Tap every CULLED chunk mesh of an engine group. three invokes onBeforeRender
 * only for objects that made it into the render list, so this counts submitted
 * draws per frame with no renderer patching at all.
 */
const installTap = (globalName) => {
  const eng = window[globalName];
  if (!eng?.object) return 0;
  window.__r21tap = window.__r21tap || {};
  // ONE state object per engine for the whole run: re-creating it would leave
  // previously-tapped meshes incrementing an orphaned counter (and would start
  // a second rAF loop), which is the same class of instrument bug as an
  // untapped mesh reading as culled.
  const st = (window.__r21tap[globalName] =
    window.__r21tap[globalName] || { n: 0, samples: [] });
  let tapped = 0;
  eng.object.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    if (!o.frustumCulled) return; // scatter instancers opt out of culling
    if (o.__r21tapped) return;
    o.__r21tapped = true;
    o.onBeforeRender = () => {
      st.n += 1;
    };
    tapped += 1;
  });
  if (!st.loop) {
    st.loop = true;
    const step = () => {
      st.samples.push(st.n);
      if (st.samples.length > 240) st.samples.shift();
      st.n = 0;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  return tapped;
};

const readTap = (globalName) => {
  const st = window.__r21tap?.[globalName];
  const s = (st?.samples ?? []).slice(-30).filter((v) => v > 0);
  const eng = window[globalName];
  let culledMeshes = 0;
  eng?.object?.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && o.frustumCulled) culledMeshes += 1;
  });
  return {
    drawnMin: s.length ? Math.min(...s) : 0,
    drawnMax: s.length ? Math.max(...s) : 0,
    drawnAvg: s.length ? +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2) : 0,
    held: culledMeshes,
    frames: s.length,
  };
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('fly-quality-tier', 'high');
    } catch {
      /* storage blocked */
    }
  });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const report = {};

  const shot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: `${out(n)}.png` });

  // ======================================================================
  // (1) ORBIT SWEEP — P1
  // ======================================================================
  if (runs('orbit')) {
    await bootFly(page, { style: 'toy', url: URL_BASE });
    report.orbit = {};
    // Two altitudes over Powell OH. 4,200 m: the z12 'far' ring dominates
    // (ultraArmed false — measured). 7,925 m (FL260, verify-neon-alt's own
    // cruise pose): the fade band passes ultraRing.onEndM, the z14 'full' ring
    // shrinks to 4000 and the z10 'ultra' ring arms — the ring whose shader
    // drop is ~89% of its own sphere radius.
    for (const [label, altM] of [
      ['far', 4200],
      ['ultra', 7925],
    ]) {
      await page.evaluate(pinScene, [40.1578, -83.0752, altM, 0, -0.12]);
      await page.waitForTimeout(label === 'far' ? 30000 : 34000);
      const tapped = await page.evaluate(installTap, '__toyWorld');
      await page.waitForTimeout(1500);
      const headings = [];
      let row0 = tapped;
      for (let i = 0; i < 24; i++) {
        const h = (i * Math.PI) / 12;
        await page.evaluate((hh) => {
          window.__pinH = hh;
        }, h);
        // RE-INSTALL the tap every step: a chunk that evicted and rebuilt since
        // the last heading is a NEW mesh with no onBeforeRender hook, and an
        // untapped mesh is indistinguishable from a culled one. (Caught in the
        // first control run, where the count collapsed to 0 and stayed there —
        // the R19 lesson about instruments indicting what they merely failed to
        // observe.) installTap is idempotent per mesh.
        row0 = await page.evaluate(installTap, '__toyWorld');
        await page.waitForTimeout(700);
        const row = await page.evaluate(readTap, '__toyWorld');
        row.tappedNow = row0;
        row.deg = Math.round((i * 15) % 360);
        row.stats = await page.evaluate(() => window.__toyWorld?.stats ?? null);
        row.draws = await page.evaluate(() => window.__flyStats?.drawCalls ?? null);
        headings.push(row);
        if (i % 6 === 0) await shot(`orbit-${label}-${row.deg}`);
      }
      report.orbit[label] = {
        altM,
        tapped,
        heldMax: Math.max(...headings.map((r) => r.held)),
        perHeading: headings.map((r) => ({
          deg: r.deg,
          drawn: r.drawnAvg,
          min: r.drawnMin,
          max: r.drawnMax,
          held: r.held,
          newlyTapped: r.tappedNow,
          draws: r.draws,
        })),
        drawnAvgOverSweep: +(
          headings.reduce((a, r) => a + r.drawnAvg, 0) / headings.length
        ).toFixed(2),
        culledAvgOverSweep: +(
          headings.reduce((a, r) => a + (r.held - r.drawnAvg), 0) / headings.length
        ).toFixed(2),
        sceneDrawsMax: Math.max(...headings.map((r) => r.draws ?? 0)),
        toyStatsLast: headings[headings.length - 1].stats,
      };
      console.log(`ORBIT ${label}:`, JSON.stringify(report.orbit[label], null, 1));
    }
  }

  // ======================================================================
  // (1b) FALSE-CULL A/B — P1, decided INSIDE one session.
  //
  // Cross-session screenshot differencing is a coin here: a same-config control
  // (two flag-off runs) moved 4-32% of the lower frame all by itself, which is
  // MORE than the flag flip did. So this measures the thing directly instead.
  //
  //   A = the frame as shipped.
  //   B = the same frame with `frustumCulled = false` on every chunk mesh, i.e.
  //       GROUND TRUTH — nothing the culler could wrongly drop is dropped.
  //   C = back to A (the same-state noise pair, with MORE time between it and A
  //       than B had — a conservative floor, the R18 skyline idiom).
  //
  // changed(A,B) is exactly the pixels the frustum culler is eating. Flag off it
  // should be large; flag on it should collapse toward changed(A,C).
  // ======================================================================
  if (runs('overdraw')) {
    if (!runs('orbit')) await bootFly(page, { style: 'toy', url: URL_BASE });
    const setCull = (v) => {
      let n = 0;
      window.__toyWorld?.object?.traverse((o) => {
        if (o.isMesh && !o.isInstancedMesh) {
          if (v === false && o.frustumCulled === false) return; // scatter opts out anyway
          if (o.__cullWas === undefined) o.__cullWas = o.frustumCulled;
          o.frustumCulled = v === null ? o.__cullWas : v;
          n += 1;
        }
      });
      return n;
    };
    report.overdraw = {};
    for (const [label, altM, heading] of [
      ['far', 4200, Math.PI],
      ['ultra', 7925, Math.PI],
    ]) {
      await page.evaluate(pinScene, [40.1578, -83.0752, altM, heading, -0.12]);
      await page.waitForTimeout(label === 'far' ? 30000 : 34000);
      await shot(`cull-${label}-A`);
      const touched = await page.evaluate(setCull, false);
      await page.waitForTimeout(700);
      await shot(`cull-${label}-B`);
      await page.evaluate(setCull, null);
      await page.waitForTimeout(1400); // C sits FURTHER from A than B did
      await shot(`cull-${label}-C`);
      report.overdraw[label] = { altM, meshesTouched: touched };
      console.log(`OVERDRAW ${label}: ${touched} meshes un-culled for the B frame`);
    }
  }

  // ======================================================================
  // (2) HEAL LOOP — P6
  // ======================================================================
  if (runs('heal')) {
    await page.evaluate(() => {
      if (window.__pin) clearInterval(window.__pin);
    });
    await bootFly(page, { style: 'satellite', url: URL_BASE });
    // SF Nob Hill: the R19 comment's own repro pose — steep relief, so the DEM
    // refinement path and the coarse path both fire.
    await page.evaluate(pinScene, [37.7924, -122.4102, 900, 1.1, -0.25]);
    await page.waitForTimeout(25000);
    const t0 = await page.evaluate(() => window.__satBuildings?.stats ?? null);
    await page.waitForTimeout(90000);
    const t1 = await page.evaluate(() => window.__satBuildings?.stats ?? null);
    report.heal = {
      t0: t0 && { heals: t0.heals, evictions: t0.evictions, ready: t0.ready, chunks: t0.chunks },
      t1: t1 && { heals: t1.heals, evictions: t1.evictions, ready: t1.ready, chunks: t1.chunks },
      healsIn90s: (t1?.heals ?? 0) - (t0?.heals ?? 0),
      evictionsIn90s: (t1?.evictions ?? 0) - (t0?.evictions ?? 0),
    };
    await shot('heal-sf');
    console.log('HEAL:', JSON.stringify(report.heal, null, 1));
  }

  // ======================================================================
  // (3) SKYLINE GROUP HOLE — P2
  // ======================================================================
  if (runs('skyline')) {
    // Abort ONE z14 tile that belongs to a NYC skyline group. The engine's
    // group is a 2x2 block of z14 tiles, so this removes a quarter of a merged
    // city block — the exact defect shape.
    let aborted = 0;
    const doomed = /\/14\/4824\/6157(\.pbf|\?|$)/;
    // NOTE: the predicate is held in a variable — page.unroute matches by
    // FUNCTION IDENTITY, so an inline arrow could never be removed again.
    const doomedUrl = (u) => doomed.test(typeof u === 'string' ? u : u.pathname);
    // CONTEXT-level, not page-level: every tile fetch happens inside a module
    // Worker, and page.route does not see worker requests (measured: 0 aborts).
    await context.route(doomedUrl, (route) => {
      aborted += 1;
      route.abort('failed');
    });
    await page.evaluate(() => {
      if (window.__pin) clearInterval(window.__pin);
    });
    await bootFly(page, { style: 'satellite', url: URL_BASE });
    await page.evaluate(pinScene, [40.7075, -74.0113, 5200, 2.6, -0.2]);
    await page.waitForTimeout(35000);
    const holed = await page.evaluate(() => window.__satSkyline?.stats ?? null);
    await shot('skyline-holed');
    await context.unroute(doomedUrl).catch(() => {});
    await page.waitForTimeout(75000); // past the capped backoff
    const healedS = await page.evaluate(() => window.__satSkyline?.stats ?? null);
    await shot('skyline-healed');
    report.skyline = {
      abortedRequests: aborted,
      holed: holed && { ready: holed.ready, tris: holed.tris, empty: holed.empty, errorRetries: holed.errorRetries },
      after: healedS && {
        ready: healedS.ready,
        tris: healedS.tris,
        empty: healedS.empty,
        errorRetries: healedS.errorRetries,
      },
      trisRecovered: (healedS?.tris ?? 0) - (holed?.tris ?? 0),
    };
    console.log('SKYLINE:', JSON.stringify(report.skyline, null, 1));
  }

  report.pageErrors = errs;
  fs.writeFileSync(`${out('summary')}.json`, JSON.stringify(report, null, 2));
  console.log(`\nwrote ${out('summary')}.json  pageerrors=${errs.length}`);
  await browser.close();
})();
