/**
 * ROUND 22.1 (B "STUTTER") — verify-frame-pace: DOES THE WORLD FREEZE AND SNAP?
 *
 * THE DEFECT. The user recorded live flight on the PRODUCTION build
 * (shadowads.netlify.app, R22 code): 1280x720@60, 872 frames, banked low-AGL
 * flight over Powell OH suburbs in satellite style (40.1748, -83.1079, 515 m
 * MSL / 233 m AGL, 350 kt). ffmpeg signalstats (YDIF ~ 0 = a duplicated frame)
 * found FIVE runs of >= 2 consecutive duplicated frames — t=5.500s (3 frames),
 * 5.667s (2), 6.483s (2), 13.283s (3), 13.950s (2) — i.e. 33-50 ms render
 * stalls after which the dt-driven sim snaps forward, plus 22 near-duplicate
 * frames overall: about one stall every two seconds while manoeuvring.
 *
 * WHAT IT WAS. A CDP main-thread sampling profile of a scripted repro
 * (scripts/r22p1-b-probe.js) put 67% of every stalled millisecond inside
 * three-tile's skirt builder — `getBoundaryEdges`, which each DEM tile runs on
 * the MAIN THREAD inside `TerrainLercLoader.doLoad`. It allocates 3·T
 * two-element arrays and sorts them with a JS comparator. R22 is what made it
 * bite: z18 imagery + demMaxZoom 16 + the altitude-keyed LOD curve stream far
 * more DEM tiles at low AGL, and `Tile._loadSubTiles` resolves FOUR children in
 * one microtask drain. Vendored patch #5 (`skirtEdges`, FRAME_PACE) replaces
 * the sort with an open-addressed edge count whose output is identical by
 * construction. See lib/fly/vendor/three-tile/VENDOR.md and
 * scripts/r22p1-b-stutter.md.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BOUNDS ARE RELATIVE, NOT ABSOLUTE MILLISECONDS.
 * This gate runs on whatever machine is free, next to whatever else is running
 * on it — the R22.1 wave itself ran two agents on one box. An absolute "no
 * frame over 40 ms" bound would be a coin flip on a loaded machine and would
 * pass trivially on an idle one. So every timing gate here is a WITHIN-RUN A/B:
 * three arms, OFF / ON / OFF, each in its OWN browser context (a fresh Cache
 * API store, so no arm inherits another's warm tiles), over the SAME path, so
 * both arms see the same machine within ~2 minutes of each other. The claim is
 * a RATIO, and the OFF arms bracket the ON arm in time so a monotone drift in
 * machine load cannot manufacture the result.
 *
 * A stall is defined relative to the run's OWN steady state too:
 * dt >= max(2 x median dt, 28 ms). Headless Chromium here presents at ~240 Hz
 * (median dt 4.2 ms), the user's display at 60 Hz; "two vsyncs of whatever
 * this display is" is the only definition that means the same thing on both.
 * ---------------------------------------------------------------------------
 *
 * WHAT THIS GATE UN-PINS: the four R22 fleet pins (`__flyTerraPin`,
 * `__flySettlePin`, `__flyClutterPin`, `__flyDepthPin`). Production has no
 * pins; a pinned harness measures the R21 world and is structurally blind to an
 * R22 regression. `__flyGovPin` stays 'hold' on purpose — a mid-run tier step
 * rebuilds the composer and would confound every frame time here — and the
 * R16/R18/R19 fleet pins are left exactly as bootFly sets them.
 *
 * FRAME_PACE NEEDS NO FLEET PIN OF ITS OWN. Patch #5's output is identical to
 * upstream's, which is gate (2)'s entire job to prove; no frozen gate can see
 * it, so scripts/_boot.js is untouched by this round.
 *
 * RED CALIBRATION (measured on this tree with FRAME_PACE forced OFF, which is
 * byte-for-byte the shipped R22 behaviour — scripts/r22p1-b-stutter.md §2):
 *   stalls/min  OFF 100.7 / 83.9 / 91.2   ON 2.4 / 2.4 / 0.0
 *   worst frame OFF 95.8 / 79.2 / 87.5 ms ON 29.2 / 33.3 / 20.8 ms
 *   p99 dt      OFF 25.1 / 20.8 / 20.9 ms ON 16.6 / 12.4 / 8.4 ms
 *   skirt JS    OFF 1,107 ms per 30 s window   ON below the profiler's top 14
 * The gate bounds (4x on stalls, 0.6x on the worst frame) sit roughly 9x and 2x
 * inside those measured arms.
 *
 * GATES
 *   (1)  precondition — satellite, tier high, R22 armed, FRAME_PACE armed,
 *        a real Powell pose with streaming tiles
 *   (2)  OUTPUT IDENTITY — flyBoundaryEdgesFast === flyBoundaryEdgesRef on
 *        every live tile index buffer (this is the content-identity claim: the
 *        patch changes nothing else, so if this holds the geometry is
 *        bit-identical and no frozen draw/tris number can move)
 *   (3)  FAST PATH EXERCISED — the flight ran hundreds of tiles through it with
 *        zero bails (a patch that silently bailed would pass (2) vacuously)
 *   (4)  STALLS — the ON arm has at most a quarter of the OFF arms' stall rate
 *        (or <= 2 stalls outright)
 *   (5)  WORST FRAME — the ON arm's worst frame is at most 0.6x the OFF arms'
 *   (6)  CONTENT UNCHANGED — at one frozen pose, a full quadtree reload under
 *        each arm produces the same draw calls and the same triangle total
 *   (7)  zero page/console errors across every arm
 *
 * Run: FLY_URL=http://localhost:3022 node scripts/verify-frame-pace.js
 * Env: PACE_FLY_SEC (default 22) — per-arm measured window
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const FLY_SEC = +(process.env.PACE_FLY_SEC ?? 22);

/** The user's recorded pose. altM is MSL; Powell ground is ~282 m. */
const POSE = { lat: 40.1748, lon: -83.1079, altM: 515, hdgDeg: 155 };
const TARGET_AGL = 233; // 766 ft
const SPEED_MS = 180; // 350 kt
const SETTLE_MS = 15000; // let the arrival finish before the window opens

const STALL_RATIO = 4; // (4) the ON arm must be >= this much better
const STALL_FLOOR = 2; // ...or simply have <= this many stalls
const WORST_RATIO = 0.6; // (5)
const MIN_IDENTITY_BUFFERS = 8; // (2) refuses to pass on a thin corpus...
const MIN_IDENTITY_TRIS = 20000; // ...and refuses to pass on a TRIVIAL one
const MIN_FAST_TILES = 100; // (3)

/* ─────────────────────── the in-page instruments ─────────────────────── */

/** rAF frame-time ring buffer. Init script, so it is running before r3f is. */
const INSTALL_PROBE = () => {
  const P = (window.__paceProbe = { t0: 0, last: 0, dts: [], on: false });
  const raf = (t) => {
    if (P.on) {
      P.dts.push(t - P.last);
      if (P.dts.length > 40000) P.dts.shift();
    }
    P.last = t;
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  P.start = () => {
    P.dts.length = 0;
    P.t0 = performance.now();
    P.last = performance.now();
    P.on = true;
  };
  P.stop = () => {
    P.on = false;
    return P.dts.slice();
  };
};

/** Deterministic aggressive serpentine at a held AGL — the pose the user flew.
 *  Wraps flight.step, so no input plumbing is touched and verify-feel's frozen
 *  envelope is not involved: the model integrates exactly as it always does,
 *  it is only handed a scripted command. */
const DRIVE = ([speed, agl]) => {
  const f = window.__fly.flight;
  if (f.__paceDriven) return false;
  f.__paceDriven = true;
  const orig = f.step.bind(f);
  let t = 0;
  f.step = (dt, cmd) => {
    t += dt;
    const turn = Math.sin((t * 2 * Math.PI) / 7); // full roll reversal every 3.5 s
    const err = f.groundElev + agl - f.pos.y;
    const pitch = Math.max(-0.35, Math.min(0.35, err * 0.0035));
    orig(dt, { ...cmd, turn, pitch, boost: false, speedPreset: 'cruise', speedOverride: speed });
  };
  return true;
};

function stats(dts) {
  if (!dts.length) return null;
  const s = [...dts].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  const median = q(0.5);
  const bound = Math.max(2 * median, 28);
  const stalls = dts.filter((d) => d >= bound);
  const sec = dts.reduce((a, b) => a + b, 0) / 1000;
  return {
    frames: dts.length,
    sec: +sec.toFixed(1),
    median: +median.toFixed(2),
    p95: +q(0.95).toFixed(1),
    p99: +q(0.99).toFixed(1),
    worst: +s[s.length - 1].toFixed(1),
    bound: +bound.toFixed(1),
    stalls: stalls.length,
    perMin: +(stalls.length / (sec / 60)).toFixed(1),
    stalledMs: +stalls.reduce((a, b) => a + b, 0).toFixed(0),
  };
}

const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

/* ───────────────────────────── main ────────────────────────────── */

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const errs = [];
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const info = (s) => console.log(`INFO ${s}`);

  /**
   * One arm: its OWN browser context, so the Cache API raster store is cold and
   * no arm can inherit another arm's warm tiles. Same pose, same scripted
   * flight, only FRAME_PACE differs.
   */
  const arm = async (paceOn, label) => {
    // The user's own capture geometry: 1280x720 at deviceScaleFactor 1.5.
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1.5,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(`${label}: ${e.message}`));
    page.on('console', (m) => {
      // Esri occasionally CORS-rejects an individual imagery tile; that is the
      // network, not this app, and the terrain engine already treats a failed
      // tile as a retry. Everything else counts.
      const t = m.text();
      if (m.type() === 'error' && !/arcgisonline|ERR_FAILED|CORS policy/i.test(t))
        errs.push(`${label}: ${t}`);
    });
    await page.addInitScript(unpinPins, [
      '__flyTerraPin',
      '__flySettlePin',
      '__flyClutterPin',
      '__flyDepthPin',
    ]);
    await page.addInitScript((on) => {
      window.__flyPaceForce = on;
      window.__flySunOverride = Date.UTC(2026, 6, 17, 17, 0); // Powell ~1 pm, fixed
    }, paceOn);
    await page.addInitScript(INSTALL_PROBE);

    await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
    await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
    await page.mouse.move(640, 360);
    await page.evaluate(
      ([la, lo, al, hd]) =>
        window.__fly.warpToGeo(la, lo, { altM: al, headingRad: (hd * Math.PI) / 180, name: null }),
      [POSE.lat, POSE.lon, POSE.altM, POSE.hdgDeg]
    );
    await page.waitForTimeout(SETTLE_MS);

    const pre = await page.evaluate(() => {
      const rt = window.__fly;
      const f = rt.flight;
      const g = rt.engine.worldToGeo(f.pos);
      const st = rt.terraStats ?? rt.engine?.terraStats ?? null;
      return {
        lat: +g.y.toFixed(4),
        lon: +g.x.toFixed(4),
        aglM: Math.round(f.pos.y - f.groundElev),
        tier: window.__flyStore.getState().qualityTier,
        style: window.__flyStore.getState().mapStyle,
        dpr: window.devicePixelRatio,
        camTileZ: st ? st.camTileZ : null,
        terraArmed: !!st,
        pace: window.__flyPace?.get?.() ?? null,
        draws: window.__flyStats?.drawCalls ?? null,
        tris: window.__flyStats?.triangles ?? null,
      };
    });

    await page.evaluate(DRIVE, [SPEED_MS, TARGET_AGL]);
    await page.waitForTimeout(2500); // let the serpentine establish
    await page.evaluate(() => window.__paceProbe.start());
    await page.waitForTimeout(FLY_SEC * 1000);
    const dts = await page.evaluate(() => window.__paceProbe.stop());
    const post = await page.evaluate(() => ({
      pace: window.__flyPace?.get?.() ?? null,
      draws: window.__flyStats?.drawCalls ?? null,
      tris: window.__flyStats?.triangles ?? null,
    }));
    const s = stats(dts);
    console.log(
      `ARM ${label.padEnd(9)} pace=${pre.pace?.on} skirtEdges=${pre.pace?.patch?.skirtEdges} · ` +
        `${s.frames} frames / ${s.sec}s · median ${s.median} ms · p95 ${s.p95} · p99 ${s.p99} · ` +
        `worst ${s.worst} ms · stall bound ${s.bound} ms · ${s.stalls} stalls (${s.perMin}/min, ${s.stalledMs} ms) · ` +
        `skirt ${JSON.stringify(post.pace?.skirt)}`
    );
    return { page, ctx, pre, post, s };
  };

  /* ============ ARMS: OFF, ON, OFF — interleaved in time ================ */
  const a1 = await arm(false, 'OFF-1');
  await a1.page.close();
  await a1.ctx.close();
  const b = await arm(true, 'ON');
  const a2 = await arm(false, 'OFF-2');
  await a2.page.close();
  await a2.ctx.close();

  /* ============ (1) precondition ======================================== */
  gate(
    '(1) precondition — satellite / high / R22 armed / FRAME_PACE armed at the Powell pose',
    b.pre.style === 'satellite' &&
      b.pre.tier === 'high' &&
      b.pre.terraArmed === true &&
      b.pre.pace?.on === true &&
      b.pre.pace?.patch?.skirtEdges === true &&
      a1.pre.pace?.on === false &&
      a1.pre.pace?.patch?.skirtEdges === false &&
      b.pre.aglM > 150 &&
      b.pre.aglM < 340,
    `ON: ${JSON.stringify({ style: b.pre.style, tier: b.pre.tier, agl: b.pre.aglM, camTileZ: b.pre.camTileZ, dpr: b.pre.dpr, terra: b.pre.terraArmed })} · ` +
      `control arm reports pace ${a1.pre.pace?.on}/skirtEdges ${a1.pre.pace?.patch?.skirtEdges}`
  );

  /* ============ (2) OUTPUT IDENTITY on live tile buffers ================ */
  // THE content-identity claim. Patch #5 changes exactly one function; if that
  // function's output is identical on the meshes this session actually built,
  // then every geometry, every draw call and every triangle total is what R22
  // shipped, and no frozen gate can move. Run on the ON page so the corpus is
  // real z16-z18 DEM tiles at the user's pose.
  //
  // THE CORPUS IS CAPTURED, NOT HARVESTED. A first draft read the resident
  // tile geometries and passed on 60 buffers totalling 464 triangles — because
  // demMaxZoom is 16 while imagery reaches z18, so every LEAF at this pose is
  // an imagery-only tile still wearing three-tile's default 4-vertex
  // PlaneGeometry, and the martini meshes that actually cost the 4 ms were
  // unloaded the moment their children arrived. `__flyPace.capture(n)` records
  // the real index buffers as `getBoundaryEdges` is handed them.
  await b.page.evaluate(() => {
    window.__flyPace.capture(24);
    // Drop the quadtree so fresh DEM tiles must be rebuilt into the capture.
    window.__flyPace.engine().map.rootTile.reload(true);
  });
  // Wait for the descent to REACH the deep tiles, not merely to start: the ring
  // holds the last 24 buffers, so the corpus is only representative once the
  // loader has gone quiet at the bottom of the tree.
  await b.page.waitForFunction(
    () => (window.__flyPace.capture().rows.length ?? 0) >= 24 && (window.__fly.engine.downloading ?? 0) === 0,
    undefined,
    { timeout: 90000, polling: 250 }
  );
  await b.page.waitForTimeout(4000);
  const ident = await b.page.evaluate(() => {
    const P = window.__flyPace;
    if (!P) return { ok: false, why: '__flyPace absent (production build?)' };
    // .slice() FIRST: `rows` is the live array, and disarming truncates it in
    // place — reading it after `capture(0)` hands you an empty corpus and a
    // gate that congratulates itself on zero mismatches out of zero buffers.
    const bufs = P.capture().rows.slice();
    P.capture(0);
    if (!bufs.length) return { ok: false, why: 'no boundary-edge inputs captured' };
    let n = 0;
    let fast = 0;
    let mismatch = 0;
    let tris = 0;
    const bad = [];
    for (const idx of bufs) {
      const f = P.edges.fast(idx);
      const r = P.edges.ref(idx);
      n++;
      tris += idx.length / 3;
      if (f === null) continue; // bailed to upstream: identical by definition
      fast++;
      if (f.length !== r.length) {
        mismatch++;
        bad.push(`len ${f.length} vs ${r.length} (${idx.length / 3} tris)`);
        continue;
      }
      for (let i = 0; i < f.length; i++) {
        if (f[i][0] !== r[i][0] || f[i][1] !== r[i][1]) {
          mismatch++;
          bad.push(`edge ${i}: [${f[i]}] vs [${r[i]}]`);
          break;
        }
      }
    }
    return { ok: true, n, fast, mismatch, tris, bad: bad.slice(0, 3) };
  });
  gate(
    '(2) OUTPUT IDENTITY — patch #5 === upstream on the REAL captured DEM index buffers',
    ident.ok &&
      ident.mismatch === 0 &&
      ident.fast >= MIN_IDENTITY_BUFFERS &&
      ident.tris >= MIN_IDENTITY_TRIS,
    ident.ok
      ? `${ident.n} captured buffers, ${Math.round(ident.tris)} triangles (mean ${Math.round(ident.tris / Math.max(1, ident.n))}/tile), ` +
        `${ident.fast} took the fast path, ${ident.mismatch} mismatches` +
        (ident.bad.length ? ` :: ${ident.bad.join(' | ')}` : '')
      : ident.why
  );

  /* ============ (3) the fast path was EXERCISED ========================= */
  const sk = b.post.pace?.skirt ?? {};
  gate(
    '(3) FAST PATH EXERCISED — hundreds of real tiles, zero bails, zero upstream',
    (sk.fast ?? 0) >= MIN_FAST_TILES && (sk.bail ?? 1) === 0 && (sk.upstream ?? 1) === 0,
    `fast ${sk.fast} · bail ${sk.bail} · upstream ${sk.upstream} · ${sk.tris} triangles walked ` +
      `(control arm: ${JSON.stringify(a1.post.pace?.skirt)})`
  );

  /* ============ (4)(5) the A/B ========================================== */
  const offPerMin = med([a1.s.perMin, a2.s.perMin]);
  const offWorst = med([a1.s.worst, a2.s.worst]);
  const offP99 = med([a1.s.p99, a2.s.p99]);
  info(
    `A/B — OFF arms ${a1.s.perMin}/${a2.s.perMin} stalls per min (median ${offPerMin}), ` +
      `worst ${a1.s.worst}/${a2.s.worst} ms (median ${offWorst}), p99 ${a1.s.p99}/${a2.s.p99} (median ${offP99}) ` +
      `| ON ${b.s.perMin} per min, worst ${b.s.worst} ms, p99 ${b.s.p99} ms`
  );
  gate(
    `(4) STALLS — the ON arm is >= ${STALL_RATIO}x better than the OFF arms (or <= ${STALL_FLOOR} stalls)`,
    b.s.stalls <= STALL_FLOOR || b.s.perMin * STALL_RATIO <= offPerMin,
    `ON ${b.s.stalls} stalls = ${b.s.perMin}/min vs OFF median ${offPerMin}/min ` +
      `(ratio ${offPerMin > 0 ? (offPerMin / Math.max(0.01, b.s.perMin)).toFixed(1) : 'n/a'}x) · ` +
      `stalled ms ON ${b.s.stalledMs} vs OFF ${a1.s.stalledMs}/${a2.s.stalledMs} · ` +
      `stall bound ON ${b.s.bound} ms / OFF ${a1.s.bound}/${a2.s.bound} ms`
  );
  gate(
    `(5) WORST FRAME — the ON arm's worst frame is <= ${WORST_RATIO}x the OFF arms'`,
    b.s.worst <= WORST_RATIO * offWorst,
    `ON ${b.s.worst} ms vs OFF median ${offWorst} ms (${(b.s.worst / Math.max(1, offWorst)).toFixed(2)}x); ` +
      `p99 ON ${b.s.p99} vs OFF ${offP99}`
  );

  /* ============ (6) CONTENT UNCHANGED at a frozen pose ================== */
  // The empirical half of gate (2). Park the aircraft, drop the whole quadtree
  // and let it re-stream under EACH arm in turn, on ONE page so the pose is
  // literally identical and the patch switch is the only difference.
  //
  // THE STATISTIC IS PER-TILE, NOT SCENE-TOTAL. A first draft compared
  // window.__flyStats draws/triangles and read 264/623474 vs 263/623870 — a
  // difference produced entirely by which vector CHUNKS (clutter, veg, parcel
  // homes, skyline) happened to be resident on their own 2 s cadences at the
  // moment of the read, not by anything the patch touches. Keying every
  // terrain tile by its own z/x/y and comparing the INTERSECTION isolates the
  // one thing patch #5 could possibly change: the vertex and index counts of a
  // DEM tile's mesh. Tiles resident in only one pass are reported, never
  // silently averaged away.
  await b.page.evaluate(() => {
    const f = window.__fly.flight;
    f.step = () => {};
    f.__frozen = true;
  });
  const reload = async (on) => {
    await b.page.evaluate((v) => {
      window.__flyPace.set(v);
      window.__flyPace.engine().map.rootTile.reload(true);
    }, on);
    await b.page.waitForFunction(
      () => (window.__fly.engine.downloading ?? 0) === 0,
      undefined,
      { timeout: 90000, polling: 250 }
    );
    await b.page.waitForTimeout(8000); // let the descent finish, not just the queue
    return b.page.evaluate(() => ({
      skirtEdges: !!window.__flyPace.get().patch.skirtEdges,
      draws: window.__flyStats?.drawCalls ?? null,
      tris: window.__flyStats?.triangles ?? null,
      tiles: window.__flyPace.tiles().map((t) => ({ key: t.key, n: t.n, verts: t.verts })),
    }));
  };
  let cOff = null;
  let cOn = null;
  try {
    cOff = await reload(false);
    cOn = await reload(true);
  } catch (e) {
    errs.push(`content leg: ${e.message}`);
  }
  let common = 0;
  let differ = [];
  let onlyOff = 0;
  let onlyOn = 0;
  if (cOff && cOn) {
    const m = new Map(cOff.tiles.map((t) => [t.key, t]));
    const seen = new Set();
    for (const t of cOn.tiles) {
      const o = m.get(t.key);
      if (!o) {
        onlyOn++;
        continue;
      }
      seen.add(t.key);
      common++;
      if (o.n !== t.n || o.verts !== t.verts)
        differ.push(`${t.key}: idx ${o.n}->${t.n} verts ${o.verts}->${t.verts}`);
    }
    onlyOff = cOff.tiles.length - seen.size;
  }
  gate(
    '(6) CONTENT UNCHANGED — same frozen pose, full quadtree reload under each arm, every commonly resident tile identical',
    !!cOff && !!cOn && common >= 20 && differ.length === 0,
    cOff && cOn
      ? `${common} tiles resident in BOTH passes, ${differ.length} differ` +
        (differ.length ? ` :: ${differ.slice(0, 4).join(' | ')}` : '') +
        ` · residency drift ${onlyOff} off-only / ${onlyOn} on-only (streaming, not the patch)` +
        ` · scene totals OFF ${cOff.draws} draws / ${cOff.tris} tris vs ON ${cOn.draws} / ${cOn.tris}` +
        ' (INFORMATIONAL: those breathe with the vector chunk cadences)'
      : 'the reload leg did not complete — see errors'
  );
  await b.page
    .locator('.fixed.inset-0 canvas')
    .first()
    .screenshot({ path: path.join(__dirname, 'r22p1-b-pace-powell.png') });

  /* ============ (7) errors ============================================== */
  gate('(7) zero page/console errors', errs.length === 0, errs.slice(0, 5).join(' | ') || 'none');

  await b.page.close();
  await b.ctx.close();
  await browser.close();

  console.log('');
  console.log(fails.length ? `VERIFY FAIL — ${fails.length}: ${fails.join(', ')}` : 'VERIFY PASS');
  process.exit(fails.length ? 1 : 0);
})();
