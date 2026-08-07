/**
 * ROUND 22 (E "CERT") — verify-clutter: GROUND LIFE, AND THE OWENS LOCK.
 *
 * C CLUTTER adds trees with trunks, parked and moving cars, and street
 * furniture. Every one of those is a pooled InstancedMesh, and the R18/R20
 * history says exactly how such a thing goes wrong: a pool that issues a draw
 * when it is empty, a scatter that lands on top of a building because it never
 * asked the collision index, a mover whose phase comes from wall-clock time and
 * therefore makes every frozen-pose pixel gate in the fleet nondeterministic,
 * and — the one the round record cares about most — content appearing in the
 * empty control scene, where R20 proved by BIT-IDENTICAL TRIANGLE TOTALS that
 * nothing may be placed.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS GATE CAN AND CANNOT SEE ON THE PRE-R22 TREE (read this first)
 * ---------------------------------------------------------------------------
 * `CLUTTER.enabled` is false and NOTHING reads `__flyClutterPin` yet, so a
 * "flip" today is a no-op and any equality assertion across it would PASS
 * VACUOUSLY. The R20 close ruling demoted exactly that kind of gate. So this
 * file splits its gates into three honest classes:
 *
 *   MEASURABLE NOW — the trees-are-spheres red (the existing SatVegLayer
 *     geometry is a 42-triangle sphere with no trunk, and that is a source
 *     fact this gate reads off the live InstancedMesh), the flicker floor at
 *     P-LEWIS before any mover exists, and the collision-index query API C's
 *     anti-duplication depends on.
 *   ANCHORED NOW — the Owens and P-LEWIS flag-off draw/triangle totals, frozen
 *     here as the CONTROL the W2 flip has to reproduce bit-exactly. An anchor
 *     is not a red; it is the thing that makes the later equality mean
 *     something, and it is recorded in §1 of the close sweep as such.
 *   SKIP PENDING C — everything that needs `window.__flyClutter` /
 *     `__flyStats.clutter` to exist. These print `SOFT … (owner C)` and do not
 *     set the exit code. W3 certification requires ZERO soft lines.
 *
 * WHAT THIS GATE UN-PINS: `__flyClutterPin` (C's determinism pin — pinned
 * fleet-wide so the movers cannot move under any other harness's frozen pose).
 *
 * GATES
 *   (1)  precondition — satellite settled at P-LEWIS on the high tier
 *   (2)  TREES READ AS TREES — the veg instance geometry carries a trunk
 *        (tri count above the 42-tri sphere, at or under the 96-tri budget)
 *   (3)  the veg pool is still ONE draw (the frozen SAT_VEG invariant)
 *   (4)  veg pool triangles <= 320k (plan §5.9)
 *   (5)  the collision-column index is queryable (C's anti-dup input)
 *   (6)  OWENS ANCHOR — draws + triangles at the empty control, flag-off
 *   (7)  OWENS LOCK — zero clutter instances and +0 draws at Owens (SOFT
 *        pending C; the anchor above is what it is compared against)
 *   (8)  OWENS BIT-IDENTICAL TOTALS across the flag flip (the R20 instrument)
 *   (9)  P-LEWIS ANCHOR — draws + triangles where clutter SHOULD appear
 *   (10) EXACT +N DRAWS at P-LEWIS (parked +1, moving +1, poles +1)
 *   (11) parked-car pool <= 1500 and <= 48k triangles
 *   (12) moving-car pool <= 300 and <= 12k triangles
 *   (13) pole pool <= 900 and <= 20k triangles
 *   (14) ANTI-DUP — no parked car sits inside a collision column
 *   (15) DETERMINISM — two boots under __flyClutterPin produce identical
 *        instance-matrix hashes
 *   (16) the pin FREEZES the movers (pinned clock ⇒ matrices identical across
 *        4 s at a frozen pose)
 *   (17) MOVER FLICKER, five-control protocol — the frozen-pose flicker
 *        statistic with movers pinned must not exceed the pre-clutter floor
 *   (18) zero APP page/console errors
 *
 * Run: FLY_URL=http://localhost:3224 node scripts/verify-clutter.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const DEV_ORIGIN = (process.env.FLY_URL || 'http://localhost:3000').replace(/\/$/, '');

const P_LEWIS = [40.2083, -83.0701, 400];
const OWENS = [36.601, -118.06, 500];
const SPHERE_TRIS = 42; // SphereGeometry(1, 7, 4) — today's canopy blob
const MAX_TRIS_PER_INSTANCE = 96; // CLUTTER.trees2.maxTrisPerInstance
const VEG_POOL_TRI_CAP = 320000; // plan §5.9
const POOL_CAPS = { parked: [1500, 48000], moving: [300, 12000], poles: [900, 20000] };
const FLICK_FRAMES = 10;
const FLICK_FRAME_MS = 250;
/* The flicker floor. verify-flicker's own bound is p99 <= 12 at a Manhattan
 * pose; P-LEWIS is a different (much quieter) scene, so the floor for THIS
 * pose is measured here on the pre-clutter tree and frozen, and the mover
 * legs are judged against it rather than against a borrowed number. */
const FLICK_P99_MAX = +(process.env.CLUTTER_P99 ?? 12);
/* W1 MEASURED FLOOR at P-LEWIS, pre-clutter, hero+traffic parked: p99 9.00.
 * The headroom to the bound is therefore only 1.33x — thin, and honestly so:
 * P-LEWIS at ~160 m AGL is still refining its tiles during the sample window,
 * which is real movement the crop can see. That is exactly why the W2 leg must
 * run PINNED and UN-PINNED and read the DELTA between them: the pin's own
 * effect is the signal, and this absolute number is only the sanity bound. */
const FLICK_FLOOR_W1 = 9.0;

const PROBE = () => {
  const rt = window.__fly;
  const f = rt?.flight;
  const eng = rt?.engine;
  if (!f || !eng) return { err: 'no-runtime' };
  const g = eng.worldToGeo(f.pos);
  const ga = eng.getGroundAt(+g.x, +g.y);
  return {
    draws: window.__flyStats?.drawCalls ?? null,
    tris: window.__flyStats?.triangles ?? null,
    camTileZ: ga ? ga.tileZ : null,
    aglM: Math.round(f.pos.y - f.groundElev),
    tier: window.__flyStore?.getState?.().qualityTier ?? null,
    veg: window.__flyStats?.satVeg ?? null,
    // C's contract when it lands (CLUTTER block header). undefined = absent.
    clutter: window.__flyStats?.clutter ?? null,
  };
};

/** The veg instance geometry, read off the live mesh (not off a constant). */
const VEG_GEOMETRY = () => {
  const m = window.__satVeg?.mesh;
  if (!m?.geometry) return null;
  const g = m.geometry;
  const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  g.computeBoundingBox?.();
  const bb = g.boundingBox;
  return {
    tris,
    verts: g.attributes.position.count,
    groups: g.groups?.length ?? 0,
    bbox: bb ? [+bb.min.y.toFixed(3), +bb.max.y.toFixed(3)] : null,
    count: m.count,
    instances: m.instanceMatrix?.count ?? null,
    materials: Array.isArray(m.material) ? m.material.length : 1,
  };
};

/** Stable hash of an instance-matrix buffer (FNV-1a over rounded floats). */
const MATRIX_HASH = (handleNames) => {
  const out = {};
  for (const name of handleNames) {
    const m = window[name] ?? window.__flyClutter?.[name.replace('__flyClutter', '').toLowerCase()] ?? null;
    const mesh = m?.isInstancedMesh ? m : m?.mesh;
    if (!mesh?.instanceMatrix?.array) {
      out[name] = null;
      continue;
    }
    const a = mesh.instanceMatrix.array;
    const n = Math.min(a.length, mesh.count * 16);
    let h = 2166136261;
    for (let i = 0; i < n; i++) {
      // Quantise to millimetres: a float that differs in its last bit is not
      // the nondeterminism this gate is looking for.
      const v = Math.round(a[i] * 1000);
      h ^= v & 0xff;
      h = Math.imul(h, 16777619);
      h ^= (v >> 8) & 0xff;
      h = Math.imul(h, 16777619);
      h ^= (v >> 16) & 0xff;
      h = Math.imul(h, 16777619);
    }
    out[name] = { count: mesh.count, hash: (h >>> 0).toString(16) };
  }
  return out;
};

(async () => {
  const sharp = require('sharp');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const errs = [];
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
  const anchor = (name, detail) => console.log(`ANCHOR ${name} — ${detail}`);

  const newFlyPage = async () => {
    const p = await context.newPage();
    await p.addInitScript(unpinPins, ['__flyClutterPin']);
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => {
      // The URL matters: an error with an off-origin location is upstream
      // (Esri tiles, live ADS-B), and the classifier below needs it to say so.
      if (m.type() === 'error')
        errs.push(`console: ${m.text().slice(0, 140)} @${m.location?.()?.url ?? ''}`);
    });
    return p;
  };
  const settleAt = async (p, pose, ms = 16000) => {
    await p.evaluate(() => {
      const f = window.__fly.flight;
      delete f.step;
      delete f.__frozen;
    });
    await p.evaluate(
      ([la, lo, al]) => window.__fly.warpToGeo(la, lo, { altM: al, name: null }),
      pose
    );
    await p.waitForTimeout(2500);
    await p.evaluate(() => {
      const f = window.__fly.flight;
      if (!f.__frozen) {
        f.__frozen = true;
        f.step = () => {};
      }
    });
    await p.waitForTimeout(ms);
  };

  const page = await newFlyPage();
  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(800, 450);
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 19, 30);
  });
  const pinState = await page.evaluate(() => ({
    pin: window.__flyClutterPin ?? null,
    attempted: window.__r22PinAttempt?.__flyClutterPin ?? null,
  }));
  console.log(`CLUTTER pin un-pinned: value=${pinState.pin} (fleet attempted ${pinState.attempted})`);

  /* ======================= P-LEWIS: the clutter pose ===================== */
  await settleAt(page, P_LEWIS);
  const lewis = await page.evaluate(PROBE);
  const veg = await page.evaluate(VEG_GEOMETRY);
  console.log(`P-LEWIS: ${JSON.stringify(lewis)}`);
  console.log(`VEG GEOMETRY: ${JSON.stringify(veg)}`);
  await page
    .locator('.fixed.inset-0 canvas')
    .first()
    .screenshot({ path: path.join(__dirname, 'r22-e-clutter-01-lewis.png') });

  gate(
    '(1) precondition: satellite settled at P-LEWIS on the high tier',
    !lewis.err && lewis.tier === 'high' && lewis.aglM > 40 && lewis.aglM < 400 && (lewis.draws ?? 0) > 50,
    `tier=${lewis.tier} AGL=${lewis.aglM} camTileZ=${lewis.camTileZ} draws=${lewis.draws} tris=${lewis.tris}`
  );

  if (!veg) {
    soft('(2)/(3)/(4) veg geometry', 'C', 'window.__satVeg.mesh not published at this pose');
  } else {
    gate(
      `(2) TREES READ AS TREES — the canopy instance carries a trunk (${SPHERE_TRIS} < tris <= ${MAX_TRIS_PER_INSTANCE})`,
      veg.tris > SPHERE_TRIS && veg.tris <= MAX_TRIS_PER_INSTANCE,
      `${veg.tris} triangles/instance, bbox Y ${JSON.stringify(veg.bbox)} — SphereGeometry(1,7,4) is exactly ${SPHERE_TRIS} and has no trunk; a merged trunk+crown must exceed it`
    );
    red.push([
      'C1 trees are untextured 42-tri spheres with no trunk',
      'verify-clutter (2)',
      `${veg.tris} tris/instance`,
      `${SPHERE_TRIS + 1}..${MAX_TRIS_PER_INSTANCE}`,
    ]);
    gate(
      '(3) the veg pool is still ONE draw — merged geometry, not a second geometry',
      veg.materials === 1 && veg.groups <= 1,
      `materials=${veg.materials} geometry groups=${veg.groups} (a second GROUP is a second draw; the R18 objection was to a second geometry, not to merged geometry)`
    );
    gate(
      `(4) veg pool triangles <= ${VEG_POOL_TRI_CAP} (plan §5.9)`,
      veg.tris * (veg.count ?? 0) <= VEG_POOL_TRI_CAP,
      `${veg.tris} tris x ${veg.count} instances = ${veg.tris * (veg.count ?? 0)}`
    );
  }

  /* --------------- (5) the collision index C anti-dups against ----------- */
  const colIndex = await page.evaluate(() => {
    const sb = window.__satBuildings;
    if (typeof sb?.queryColumns !== 'function') return { api: false };
    const f = window.__fly.flight;
    const cols = sb.queryColumns(f.pos.x, f.pos.z, 1500);
    return {
      api: true,
      near: Array.isArray(cols) ? cols.length : -1,
      sample: Array.isArray(cols) && cols[0] ? Object.keys(cols[0]) : null,
      stats: sb.stats ? { chunks: sb.stats.chunks, ready: sb.stats.ready, columns: sb.stats.columns } : null,
    };
  });
  console.log(`COLLISION INDEX: ${JSON.stringify(colIndex)}`);
  gate(
    '(5) the collision-column index is queryable (the R18 production API C anti-dups against)',
    colIndex.api === true,
    `queryColumns returned ${colIndex.near} columns within 1500 m · index ${JSON.stringify(colIndex.stats)}`
  );

  /* --------------------- (9)/(10) the P-LEWIS anchors -------------------- */
  anchor(
    'P-LEWIS flag-off',
    `draws ${lewis.draws} · tris ${lewis.tris} — the control every "+N draws" claim is measured against`
  );
  if (!lewis.clutter) {
    soft(
      '(10) exact +N draws at P-LEWIS',
      'C',
      `__flyStats.clutter absent; anchor frozen at draws ${lewis.draws} / tris ${lewis.tris}`
    );
    soft('(11)/(12)/(13) pool budgets', 'C', 'no clutter pools exist yet');
    soft('(14) anti-dup census', 'C', 'no parked-car anchors to test against queryColumns');
  } else {
    const c = lewis.clutter;
    const expectDraws = (c.parked?.count > 0 ? 1 : 0) + (c.moving?.count > 0 ? 1 : 0) + (c.poles?.count > 0 ? 1 : 0);
    gate(
      '(10) EXACT +N DRAWS at P-LEWIS — one draw per NON-EMPTY pool, zero for empty ones',
      (lewis.draws ?? 0) - (c.baseDraws ?? lewis.draws) === expectDraws,
      `draws ${lewis.draws} · pools ${JSON.stringify({ parked: c.parked?.count, moving: c.moving?.count, poles: c.poles?.count })} · expected +${expectDraws}`
    );
    for (const [k, [maxPool, maxTris]] of Object.entries(POOL_CAPS)) {
      const p = c[k];
      gate(
        `(${k === 'parked' ? 11 : k === 'moving' ? 12 : 13}) ${k} pool <= ${maxPool} instances and <= ${maxTris} triangles`,
        p != null && (p.count ?? 0) <= maxPool && (p.tris ?? 0) <= maxTris,
        `count ${p?.count} tris ${p?.tris}`
      );
    }
    const dup = await page.evaluate(() => {
      const sb = window.__satBuildings;
      const anchors = window.__flyStats?.clutter?.parked?.anchors ?? null;
      if (!sb?.queryColumns || !anchors) return null;
      let inside = 0;
      const bad = [];
      for (let i = 0; i + 1 < anchors.length; i += 2) {
        const cols = sb.queryColumns(anchors[i], anchors[i + 1], 0) ?? [];
        if (cols.length) {
          inside++;
          if (bad.length < 5) bad.push([anchors[i], anchors[i + 1]]);
        }
      }
      return { tested: anchors.length / 2, inside, bad };
    });
    if (!dup) soft('(14) anti-dup census', 'C', 'clutter.parked.anchors not published');
    else
      gate(
        '(14) ANTI-DUP — no parked car sits inside a collision column',
        dup.inside === 0,
        `${dup.inside} of ${dup.tested} anchors inside a building column ${JSON.stringify(dup.bad)}`
      );
  }

  /* ================== (17) the mover flicker floor ====================== */
  // The five-control protocol needs a FLOOR measured before any mover exists.
  // Same statistic as verify-flicker (per-pixel temporal stddev over N frames
  // of a frozen scene, gated on p99 rather than the mean) at THIS pose, with
  // the hero and traffic parked at their owner-published roots.
  await page.evaluate(() => {
    if (window.__flyPlayer) window.__flyPlayer.visible = false;
    let scene = window.__flyPlayer ?? window.__fly?.engine?.object ?? null;
    while (scene && scene.parent) scene = scene.parent;
    scene?.traverse((o) => {
      if (o.isInstancedMesh && (o._isModel !== undefined || o._painted !== undefined)) o.visible = false;
    });
  });
  await page.mouse.move(800, 450);
  await page.waitForTimeout(1500);
  const shots = [];
  for (let i = 0; i < FLICK_FRAMES; i++) {
    const p = path.join(__dirname, `r22-e-clutter-flick-${i}.png`);
    await page.locator('.fixed.inset-0 canvas').first().screenshot({ path: p });
    shots.push(p);
    await page.waitForTimeout(FLICK_FRAME_MS);
  }
  // Ground crop only, starting below the horizon (verify-flicker's W3
  // correction: sub-pixel aliasing on the smoothed edge-fade band is not a
  // layer blinking).
  const CROP = { left: 0, top: 540, width: 1600, height: 340 };
  const bufs = [];
  for (const s of shots) {
    const { data } = await sharp(s).extract(CROP).raw().toBuffer({ resolveWithObject: true });
    bufs.push(data);
  }
  const n = Math.min(...bufs.map((b) => b.length));
  const sds = [];
  for (let i = 0; i < n; i += 4) {
    let sum = 0;
    for (const b of bufs) sum += 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
    const mean = sum / bufs.length;
    let v = 0;
    for (const b of bufs) {
      const l = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
      v += (l - mean) ** 2;
    }
    sds.push(Math.sqrt(v / bufs.length));
  }
  sds.sort((a, b) => a - b);
  const p99 = sds[Math.floor(sds.length * 0.99)];
  for (const s of shots) fs.rmSync(s, { force: true });
  console.log(
    `FLICKER FLOOR at P-LEWIS (pre-clutter, ${FLICK_FRAMES} frames @${FLICK_FRAME_MS}ms): p99 ${p99.toFixed(2)} over ${sds.length} pixels`
  );
  anchor('P-LEWIS flicker floor', `p99 ${p99.toFixed(2)} with NO movers in the scene`);
  gate(
    `(17) MOVER FLICKER — the frozen-pose p99 at P-LEWIS stays <= ${FLICK_P99_MAX} with the clutter pin engaged`,
    p99 <= FLICK_P99_MAX,
    `p99 ${p99.toFixed(2)} vs the W1 pre-clutter floor ${FLICK_FLOOR_W1} (headroom to the bound ${(FLICK_P99_MAX / FLICK_FLOOR_W1).toFixed(2)}x; with C merged this leg re-runs pinned AND un-pinned, and the five controls are: hero parked, traffic parked, movers pinned, movers un-pinned, and this floor)`
  );

  /* ======================= OWENS: the empty control ===================== */
  await settleAt(page, OWENS, 18000);
  const owens = await page.evaluate(PROBE);
  console.log(`OWENS: ${JSON.stringify(owens)}`);
  await page
    .locator('.fixed.inset-0 canvas')
    .first()
    .screenshot({ path: path.join(__dirname, 'r22-e-clutter-02-owens.png') });
  anchor(
    'OWENS flag-off',
    `draws ${owens.draws} · tris ${owens.tris} — the R20 bit-identical-totals instrument's baseline`
  );
  gate(
    '(6) OWENS ANCHOR — the empty control has a real, recorded scene',
    (owens.draws ?? 0) > 50 && (owens.tris ?? 0) > 1000,
    `draws ${owens.draws} tris ${owens.tris} camTileZ ${owens.camTileZ} AGL ${owens.aglM}`
  );
  if (!owens.clutter) {
    soft(
      '(7) OWENS LOCK (zero instances / +0 draws)',
      'C',
      `anchor frozen at draws ${owens.draws} / tris ${owens.tris}`
    );
    soft('(8) OWENS bit-identical totals across the flip', 'C', 'the flip is a no-op on this tree — asserting it would pass VACUOUSLY, which the R20 close ruling demoted');
  } else {
    const c = owens.clutter;
    const total = (c.parked?.count ?? 0) + (c.moving?.count ?? 0) + (c.poles?.count ?? 0);
    gate(
      '(7) OWENS LOCK — zero clutter instances AND +0 draws, BY CONSTRUCTION',
      total === 0,
      `instances ${JSON.stringify({ parked: c.parked?.count, moving: c.moving?.count, poles: c.poles?.count })}`
    );
    // The R20 instrument: flip the pin and compare TOTALS bit-exactly. An
    // empty pool that issues no draw and no triangle is the only thing that
    // can survive this.
    await page.evaluate(() => ((window.__r22Unpinned ??= {}).__flyClutterPin = 0));
    await page.waitForTimeout(4000);
    const off = await page.evaluate(PROBE);
    await page.evaluate(() => ((window.__r22Unpinned ??= {}).__flyClutterPin = 1));
    await page.waitForTimeout(4000);
    const on = await page.evaluate(PROBE);
    gate(
      '(8) OWENS BIT-IDENTICAL TOTALS across the clutter flip (the R20 instrument)',
      off.draws === on.draws && off.tris === on.tris,
      `off ${off.draws}/${off.tris} vs on ${on.draws}/${on.tris}`
    );
  }

  /* ================= (15)/(16) determinism under the pin ================ */
  const HANDLES = ['__flyClutterParked', '__flyClutterMoving', '__flyClutterPoles'];
  const hasClutter = await page.evaluate((h) => h.some((n) => window[n] != null) || window.__flyClutter != null, HANDLES);
  if (!hasClutter) {
    soft('(15) two-boot determinism', 'C', `no clutter mesh handles (${HANDLES.join(' / ')} or window.__flyClutter)`);
    soft('(16) the pin freezes the movers', 'C', 'no mover pool exists');
  } else {
    await settleAt(page, P_LEWIS);
    const h1 = await page.evaluate(MATRIX_HASH, HANDLES);
    await page.waitForTimeout(4000);
    const h1b = await page.evaluate(MATRIX_HASH, HANDLES);
    gate(
      '(16) the pin FREEZES the movers — matrices identical across 4 s at a frozen pose',
      JSON.stringify(h1) === JSON.stringify(h1b),
      `${JSON.stringify(h1)} vs ${JSON.stringify(h1b)}`
    );
    const page2 = await newFlyPage();
    await bootFly(page2, { style: 'satellite', ...BOOT_OPTS });
    await page2.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
    await page2.evaluate(() => {
      window.__flySunOverride = Date.UTC(2026, 6, 17, 19, 30);
    });
    await settleAt(page2, P_LEWIS);
    const h2 = await page2.evaluate(MATRIX_HASH, HANDLES);
    gate(
      '(15) DETERMINISM — two independent boots under __flyClutterPin produce identical matrix hashes',
      JSON.stringify(h1) === JSON.stringify(h2),
      `boot A ${JSON.stringify(h1)} · boot B ${JSON.stringify(h2)}`
    );
    await page2.close();
  }

  // Upstream tile-network noise is classified, not gated — see verify-terra
  // gate (17) for the full reasoning and the W1 evidence.
  const netErrs = errs.filter(
    (e) =>
      /arcgisonline|arcgis\.com|ERR_FAILED|Access to fetch/i.test(e) ||
      (/@https?:\/\//.test(e) && !e.includes(DEV_ORIGIN))
  );
  const appErrs = errs.filter((e) => !netErrs.includes(e));
  gate(
    '(18) zero APP page/console errors (upstream Esri tile errors classified separately)',
    appErrs.length === 0,
    `app=${appErrs.length} net=${netErrs.length} · ${appErrs.slice(0, 3).join(' | ')}`
  );

  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  fs.writeFileSync(
    path.join(__dirname, 'r22-e-red-clutter.json'),
    JSON.stringify(
      { when: new Date().toISOString(), lewis, veg, colIndex, p99, owens, red, fails, softs, netErrs: netErrs.length },
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
