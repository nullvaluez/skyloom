/**
 * ROUND 22 (E "CERT") — verify-depth2: DOES LIGHT LAND ON THE WORLD?
 *
 * The user's symptom #1 ("the world feels flat") has a mechanical cause that
 * the R19 round record already names without quite saying out loud: the
 * satellite shadow rig is ON (2048² map, high tier) but the terrain tiles are
 * deliberately excluded from the receive set, and the ground-catcher disc that
 * exists to fix that ships `SAT_SHADOWS.catcher.enabled:false`. So every
 * building and tree shadow in the app is cast onto NOTHING. There is also zero
 * ambient occlusion anywhere (n8ao is installed as a transitive dependency and
 * never imported), and nothing atmospheric touches the first 800 m.
 *
 * This gate measures those four claims, and — because D's whole charter is
 * "fully measured, ships built-but-OFF pending the user checkpoint" — it is
 * built to certify BOTH states. The load-bearing instrument is not a pixel
 * difference: it is a CENSUS of the receive set plus a FROZEN-POSE FRAME-TIME
 * ledger, because the R13 rejection of near-ring receiveShadow was a FILL-RATE
 * objection and fill rate is invisible to every draw-count gate in the fleet.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS GATE UN-PINS, AND WHAT IT DELIBERATELY DOES NOT
 * ---------------------------------------------------------------------------
 * UN-PINS: `__flyDepthPin` (D's DEPTH_PASS family), through the shared
 * `unpinPins` accessor.
 * DOES NOT un-pin: `__flySatShadowOverride` / `__flyAerialOverride`.
 * verify-aerial is the ONE harness that un-pins the R19 ship-state visuals and
 * that ruling stands. Where this gate needs the shadow rig live it drives the
 * IMPERATIVE handle the app already publishes — `window.__flySatShadow.set()`,
 * which is exactly what verify-aerial itself uses for its A/B — so the fleet
 * pin is never redefined and no other gate's frozen pixels can move.
 *
 * ---------------------------------------------------------------------------
 * RED CALIBRATION (r22/e @ ee39397, all R22 blocks enabled:false)
 * ---------------------------------------------------------------------------
 *   (3) the terrain receive-set census reads ZERO leaf tiles inside the ortho
 *       radius, with N caster meshes armed a few metres away — "shadows land
 *       on nothing", as a count.
 *   (4) the catcher is not mounted anywhere, at any AGL.
 *   (7) no N8AO pass exists in the composer.
 * The N8AO reversed-depth leg is a VACUOUS SKIP today by construction (there is
 * no pass to validate), so it is gated on D's flag and its PRECONDITION — that
 * the renderer really does run reversed depth, which is the R19 trap — IS
 * asserted today, because that fact is what makes the later validation
 * meaningful.
 *
 * GATES
 *   (1)  precondition — Manhattan settled, high tier, real caster geometry
 *   (2)  the shadow rig is armed and uses the frozen SAT_SHADOWS frustum
 *   (3)  RECEIVE SET — leaf terrain tiles inside orthoRadiusM receive shadows
 *   (4)  CATCHER GATING — mounted when casters are in the ortho frustum and
 *        AGL is inside the band
 *   (5)  CATCHER AT OWENS — NOT mounted (+0 draws) where there are no casters
 *   (6)  the AGL band edges behave (mounted below maxAglM, gone above it)
 *   (7)  N8AO is present in the pass list on the high tier
 *   (8)  REVERSED DEPTH — the renderer runs it (the R19 trap N8AO must be
 *        validated against) and the AO pass declares it
 *   (9)  N8AO LUMA SANITY — AO darkens creases, not the sky
 *   (10) N8AO frame-time budget — Owens <= +1.5 ms, Manhattan <= +2.5 ms
 *   (11) RECEIVE-SET frame-time budget — <= +1.0 ms or it ships off
 *   (12) near-field atmosphere — AERIAL_PERSPECTIVE.startM band is non-zero
 *   (13) MEDIUM-TIER CONTENT HAZE — present at medium when armed
 *   (14) HIGH TIER IS NOT DOUBLE-HAZED — content haze stays off at high
 *   (15) draw ceilings hold with everything armed (Owens <= 261)
 *   (16) zero APP page/console errors
 *
 * Run: FLY_URL=http://localhost:3224 node scripts/verify-depth2.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly, unpinPins } = require('./_boot');
const sharp = require('sharp');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const DEV_ORIGIN = (process.env.FLY_URL || 'http://localhost:3000').replace(/\/$/, '');
/* W3: DEPTH_PASS ships `enabled:false` pending user checkpoint #3, and the plan
 * requires it CERTIFIED IN BOTH STATES. `window.__flyDepthArm` is D's master
 * un-pinner (lib/fly/depth-pass.js `depthPassOn`), written before mount so the
 * pass list resolves armed at the first commit rather than through a rebuild.
 *   node scripts/verify-depth2.js            -> SHIP STATE (off)
 *   R22_DEPTH=on node scripts/verify-depth2.js -> ARMED
 * The gates below read the arm state and assert the state they are IN: with
 * DEPTH off, "no AO pass" is the correct answer and is asserted as such, not
 * reported as a failure. A gate that fails a correctly-shipped OFF state would
 * make the ship decision unrecordable. */
const DEPTH_ARMED = process.env.R22_DEPTH === 'on';

const MANHATTAN = [40.7549, -73.984, 700];
const OWENS = [36.601, -118.06, 500];
const P_LEWIS = [40.2083, -83.0701, 400];
const MORNING = Date.UTC(2026, 6, 17, 11, 30); // ~07:30 EDT — sun ~25°, real shadows
const NOON = Date.UTC(2026, 6, 17, 19, 30);
const ORTHO_RADIUS_M = 1500; // SAT_SHADOWS.orthoRadiusM (frozen)
const CATCHER_MAX_AGL = 2200; // DEPTH_PASS.catcher.maxAglM
const N8AO_MS_OWENS = 1.5; // plan §6 D budget
const N8AO_MS_MANHATTAN = 2.5;
const RECEIVE_MS = 1.0;
const OWENS_DRAW_CEILING = 261;
const FRAME_SAMPLE_MS = 6000;

const SHOT = (n) => path.join(__dirname, `r22-e-depth2-${n}.png`);

/**
 * FRAME-TIME LEDGER. Two instruments, both reported, neither guessed at:
 *  · EXT_disjoint_timer_query_webgl2 when the driver exposes it — a real GPU
 *    time, which is the number the plan's budgets are written in.
 *  · the p95 rAF interval at a FROZEN pose as the always-available fallback.
 *    At a frozen pose the CPU side is idle (the flight integrator is a no-op,
 *    nothing streams once settled), so the frame interval is GPU-bound and the
 *    A/B DELTA is meaningful even though the absolute number is not a pure GPU
 *    time. The run states which one produced each figure — a budget quoted
 *    from the wrong instrument is worse than no budget.
 */
const FRAME_SAMPLER = (ms) =>
  new Promise((resolve) => {
    const S = { dt: [], gpu: [], last: performance.now(), t0: performance.now() };
    const gl = window.__flyGl;
    const ctx = gl?.getContext?.() ?? null;
    let ext = null;
    let q = null;
    try {
      ext = ctx?.getExtension?.('EXT_disjoint_timer_query_webgl2') ?? null;
    } catch {
      ext = null;
    }
    const tick = (t) => {
      S.dt.push(t - S.last);
      S.last = t;
      if (ext && ctx) {
        if (q) {
          const avail = ctx.getQueryParameter(q, ctx.QUERY_RESULT_AVAILABLE);
          const disjoint = ctx.getParameter(ext.GPU_DISJOINT_EXT);
          if (avail && !disjoint) S.gpu.push(ctx.getQueryParameter(q, ctx.QUERY_RESULT) / 1e6);
          if (avail || disjoint) {
            ctx.deleteQuery(q);
            q = null;
          }
        }
        if (!q) {
          q = ctx.createQuery();
          ctx.beginQuery(ext.TIME_ELAPSED_EXT, q);
          requestAnimationFrame(() => {
            try {
              ctx.endQuery(ext.TIME_ELAPSED_EXT);
            } catch {
              /* the query was cancelled by a context event */
            }
          });
        }
      }
      if (performance.now() - S.t0 < ms) requestAnimationFrame(tick);
      else {
        const p = (a, k) => {
          const s = [...a].sort((x, y) => x - y);
          return s.length ? +s[Math.min(s.length - 1, Math.floor(k * s.length))].toFixed(3) : null;
        };
        resolve({
          frames: S.dt.length,
          p50: p(S.dt, 0.5),
          p95: p(S.dt, 0.95),
          gpuSamples: S.gpu.length,
          gpuP50: p(S.gpu, 0.5),
          gpuP95: p(S.gpu, 0.95),
          instrument: S.gpu.length > 10 ? 'EXT_disjoint_timer_query_webgl2' : 'rAF interval (frozen pose)',
        });
      }
    };
    requestAnimationFrame(tick);
  });

/** The receive-set + caster census, off the real scene graph. */
const SHADOW_CENSUS = (radius) => {
  const rt = window.__fly;
  const f = rt?.flight;
  const eng = rt?.engine;
  if (!f || !eng) return { err: 'no-runtime' };
  let scene = eng.object;
  while (scene.parent) scene = scene.parent;
  const px = f.pos.x;
  const pz = f.pos.z;
  const anchor = rt.origin?.anchor ?? { x: 0, z: 0 };
  let tilesTotal = 0;
  let tilesNear = 0;
  let tilesNearReceiving = 0;
  let tilesReceivingAny = 0;
  let casters = 0;
  let castersNear = 0;
  let receivers = 0;
  let catcher = 0;
  // Tiles live inside worldRoot (rebased), so their world matrix already
  // carries -anchor; comparing in the REBASED frame is the only correct
  // comparison and is what the shadow camera itself sees. The position is read
  // straight off matrixWorld.elements[12]/[14] — `getWorldPosition` needs a
  // real Vector3 target and a page-side literal is not one (the first
  // calibration run died on exactly that).
  const rx = px - anchor.x;
  const rz = pz - anchor.z;
  eng.object.traverse((o) => {
    if (!o.isMesh) return;
    tilesTotal++;
    // A LEAF tile is one with no tile children — the only ones that draw.
    const isLeaf = !(o.parent?.children ?? []).some((c) => c !== o && c.isTile);
    const d = Math.hypot((o.matrixWorld?.elements?.[12] ?? 0) - rx, (o.matrixWorld?.elements?.[14] ?? 0) - rz);
    if (o.receiveShadow) tilesReceivingAny++;
    if (d <= radius && isLeaf) {
      tilesNear++;
      if (o.receiveShadow) tilesNearReceiving++;
    }
  });
  scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    if (o.castShadow) {
      casters++;
      const d = Math.hypot((o.matrixWorld?.elements?.[12] ?? 0) - rx, (o.matrixWorld?.elements?.[14] ?? 0) - rz);
      if (d <= radius) castersNear++;
    }
    if (o.receiveShadow) receivers++;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (m?.type === 'ShadowMaterial') catcher++;
  });
  return {
    tilesTotal,
    tilesNear,
    tilesNearReceiving,
    tilesReceivingAny,
    casters,
    castersNear,
    receivers,
    catcherMeshes: catcher,
    aglM: Math.round(f.pos.y - f.groundElev),
    draws: window.__flyStats?.drawCalls ?? null,
    tris: window.__flyStats?.triangles ?? null,
    tier: window.__flyStore?.getState?.().qualityTier ?? null,
  };
};

/** Composer pass census + the reversed-depth fact N8AO must respect. */
const FX_CENSUS = () => {
  const c = window.__flyComposer ?? null;
  const gl = window.__flyGl ?? null;
  const passes = c?.passes
    ? c.passes.map((p) => ({
        name: p.name ?? p.constructor?.name ?? '?',
        effects: (p.effects ?? []).map((e) => e.name ?? e.constructor?.name ?? '?'),
      }))
    : null;
  return {
    passes,
    reversedDepth: gl?.capabilities?.reversedDepthBuffer === true,
    // three exposes the define the postprocessing library needs; the R19 trap
    // was that it is NEVER set, so raw depth arrives reversed.
    /* D's N8AO pass is constructed as a bare `Pass` with no `name`, so a
     * name-scan reads the armed chain as un-armed (the first W3 armed run read
     * `["RenderPass","Pass","EffectPass",...]` and called it absent). The
     * owner-published handle is the authority. */
    n8ao: (() => {
      try {
        const h = window.__flyN8AO?.get?.();
        if (h) return !!(h.inChain ?? h.wanted ?? h.mounted ?? h.enabled);
      } catch {
        /* fall through to the structural check */
      }
      return passes
        ? passes.some((p) => /n8ao/i.test(p.name) || p.effects.some((e) => /n8ao/i.test(e)))
        : null;
    })(),
    n8aoState: (() => {
      try {
        return window.__flyN8AO?.get?.() ?? null;
      } catch {
        return null;
      }
    })(),
    aerial: (() => {
      try {
        return window.__flyAerial.get();
      } catch {
        return null;
      }
    })(),
  };
};

async function lumaMean(file, region) {
  const { data, info } = await sharp(file).extract(region).raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const o = i * info.channels;
    sum += 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
  }
  return sum / n;
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
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
  const anchorLogD = anchor;

  await page.addInitScript(unpinPins, ['__flyDepthPin']);
  await page.addInitScript((on) => {
    window.__flyDepthArm = on ? 1 : 0;
  }, DEPTH_ARMED);
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(`console: ${m.text().slice(0, 140)} @${m.location?.()?.url ?? ''}`);
  });

  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(800, 450);
  const pinState = await page.evaluate(() => ({
    pin: window.__flyDepthPin ?? null,
    attempted: window.__r22PinAttempt?.__flyDepthPin ?? null,
  }));
  console.log(
    `DEPTH ${DEPTH_ARMED ? 'ARMED (__flyDepthArm=1)' : 'SHIP STATE (__flyDepthArm=0, DEPTH_PASS.enabled false)'} · ` +
      `fleet pin un-pinned: value=${pinState.pin} (fleet attempted ${pinState.attempted})`
  );

  const pose = async ([lat, lon, altM], sunUTC, settleMs = 20000) => {
    await page.evaluate(() => {
      const f = window.__fly.flight;
      delete f.step;
      delete f.__frozen;
    });
    await page.evaluate(
      ([la, lo, al, su]) => {
        window.__flySunOverride = su;
        window.__fly.warpToGeo(la, lo, { altM: al, name: null });
      },
      [lat, lon, altM, sunUTC]
    );
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const f = window.__fly.flight;
      if (!f.__frozen) {
        f.__frozen = true;
        f.step = () => {};
      }
    });
    await page.waitForTimeout(settleMs);
    await page.mouse.move(800, 450);
  };
  const glShot = (n) => page.locator('.fixed.inset-0 canvas').first().screenshot({ path: SHOT(n) });
  const setShadows = (v) => page.evaluate((x) => window.__flySatShadow?.set(x), v);

  /* ===================== MANHATTAN — the caster field ==================== */
  await pose(MANHATTAN, MORNING, 26000);
  // Arm the casters exactly as verify-aerial does: the same flags on the same
  // real meshes, so the rig is driven over real geometry even on a tree where
  // the source-side castShadow lines have not landed.
  const armed = await page.evaluate(() => {
    let scene = window.__fly.engine.object;
    while (scene.parent) scene = scene.parent;
    let already = 0;
    let armedN = 0;
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m?.userData?.__worldBend !== 'anchor-sat') return;
      if (o.castShadow) already++;
      else {
        o.castShadow = true;
        armedN++;
      }
    });
    return { already, armed: armedN, total: already + armedN };
  });
  await setShadows(true);
  await page.waitForTimeout(2500);
  const manh = await page.evaluate(SHADOW_CENSUS, ORTHO_RADIUS_M);
  const fx = await page.evaluate(FX_CENSUS);
  const depthRig = await page.evaluate(() => window.__flyStats?.depthRig ?? null);
  console.log(`depthRig: ${JSON.stringify(depthRig)}`);
  console.log(`MANHATTAN census: ${JSON.stringify(manh)}`);
  console.log(`CASTERS: ${JSON.stringify(armed)}`);
  console.log(`FX: reversedDepth=${fx.reversedDepth} n8ao=${fx.n8ao} passes=${JSON.stringify(fx.passes)}`);
  await glShot('01-manhattan-shadows');

  gate(
    '(1) precondition: Manhattan settled on the high tier with a real caster field',
    !manh.err && manh.tier === 'high' && (manh.casters ?? 0) > 0 && (manh.tilesNear ?? 0) > 0,
    `tier=${manh.tier} casters=${manh.casters} (near ${manh.castersNear}) leaf tiles near=${manh.tilesNear} draws=${manh.draws}`
  );
  const rig = await page.evaluate(() => {
    let scene = window.__fly.engine.object;
    while (scene.parent) scene = scene.parent;
    let L = null;
    scene.traverse((o) => {
      if (o.isDirectionalLight) L = o;
    });
    return L
      ? { castShadow: L.castShadow, mapSize: L.shadow.mapSize.width, right: L.shadow.camera.right, left: L.shadow.camera.left }
      : null;
  });
  gate(
    '(2) the shadow rig is armed and uses the frozen SAT_SHADOWS ortho frustum',
    !!rig && rig.castShadow === true && rig.mapSize === 2048 && rig.right === ORTHO_RADIUS_M,
    JSON.stringify(rig)
  );
  /* THE SUBJECT IS D'S RECEIVE SET, NOT MY OWN "NEAR LEAF" SUBSET.
   * The first W3 armed run read 0 of 4 and would have reported D's feature as
   * broken. It is not: D walks the quadtree with the library's own `t.isLeaf`
   * flag and marks `t.model` inside `orthoRadiusM + padM + the tile's own
   * half-extent`, capped at `maxTiles`. My census's "near leaf" rule is a
   * DIFFERENT subset — a stricter distance test with no half-extent term and a
   * hand-rolled leaf rule — so it can read zero while D's set is populated.
   * A gate must assert the thing its owner promised, so the assertion is the
   * COUNT OF RECEIVING TERRAIN MESHES; the near-subset numbers ride along as
   * evidence. (The R19 lesson, again: an instrument can indict an actor it
   * merely failed to include.) */
  /* (3) READS D'S OWN SWEEP TELEMETRY (W3 correction).
   * D publishes `__flyStats.depthRig.sweep.{walked, leaves, near, live}` where
   * `live.flagged` counts enlisted objects that STILL read receiveShadow true
   * and still have a parent — the difference between "the sweep selected 22"
   * and "22 tiles are receiving". The claim is that the sweep's own near count
   * is fully flagged; my external traverse used a different leaf rule and a
   * different distance test and so could not adjudicate D's set at all.
   * (The mechanism behind the earlier zero: the library re-asserts tile state
   * every frame, so the flags have to be RE-STAMPED, not flipped once.) */
  const sweep = depthRig?.sweep ?? null;
  const flagged = sweep?.live?.flagged ?? null;
  const nearD = sweep?.near ?? null;
  gate(
    DEPTH_ARMED
      ? '(3) RECEIVE SET — every near leaf D enlists is still flagged (live.flagged === sweep.near)'
      : '(3) RECEIVE SET is OFF in the ship state — nothing enlisted, nothing flagged',
    DEPTH_ARMED
      ? flagged != null && nearD != null && flagged === nearD && flagged > 0
      : (flagged ?? 0) === 0,
    `sweep ${JSON.stringify(sweep)} · my independent traverse: ${manh.tilesReceivingAny} receiving of ${manh.tilesTotal} ` +
      `(informational — a different leaf rule and distance test from D's)`
  );
  red.push([
    'D1 shadows land on nothing (terrain excluded from the receive set)',
    'verify-depth2 (3)',
    `${manh.tilesNearReceiving}/${manh.tilesNear} near leaf tiles receive`,
    '> 0',
  ]);
  gate(
    DEPTH_ARMED
      ? '(4) CATCHER GATING — mounted where casters are in frustum and AGL is inside the band'
      : '(4) CATCHER is OFF in the ship state — not mounted anywhere (the R19 behaviour, unchanged)',
    DEPTH_ARMED
      ? (manh.catcherMeshes ?? 0) > 0 && manh.aglM <= CATCHER_MAX_AGL
      : (manh.catcherMeshes ?? 0) === 0,
    `catcher meshes=${manh.catcherMeshes} at ${manh.aglM} m AGL (SAT_SHADOWS.catcher.enabled is false on this tree)`
  );
  red.push([
    'D2 the ground catcher ships off — open ground catches nothing',
    'verify-depth2 (4)',
    `${manh.catcherMeshes} catcher meshes with ${manh.castersNear} casters in frustum`,
    '> 0',
  ]);
  gate(
    '(8) REVERSED DEPTH — the renderer runs it (the R19 trap any AO pass must be validated against)',
    fx.reversedDepth === true,
    `gl.capabilities.reversedDepthBuffer=${fx.reversedDepth} · postprocessing's USE_REVERSED_DEPTH_BUFFER define is never set, so a naive depth read arrives REVERSED`
  );
  gate(
    DEPTH_ARMED
      ? '(7) N8AO is present in the composer pass list on the high tier'
      : '(7) N8AO is ABSENT in the ship state (built-but-off — the pass costs nothing until checkpoint #3)',
    DEPTH_ARMED ? fx.n8ao === true : fx.n8ao === false,
    `passes ${JSON.stringify(fx.passes?.map((p) => p.name))} (D named it 'N8AOPass' at W3) · __flyN8AO.get() ${JSON.stringify(fx.n8aoState)} ` +
      `(the pass is an unnamed \`Pass\`, so the owner handle is the authority — a name-scan is not)`
  );
  red.push(['D3 zero ambient occlusion anywhere', 'verify-depth2 (7)', `n8ao in pass list: ${fx.n8ao}`, 'true']);

  /* ---------------- (9)/(10) the N8AO A/B, gated on its existence ------- */
  const MANH_CROP = { left: 420, top: 380, width: 760, height: 380 };
  const SKY_CROP = { left: 420, top: 60, width: 760, height: 180 };
  const manhBase = await page.evaluate(FRAME_SAMPLER, FRAME_SAMPLE_MS);
  console.log(`MANHATTAN frame ledger (baseline): ${JSON.stringify(manhBase)}`);
  anchor('Manhattan frame baseline', `${manhBase.instrument} p95 ${manhBase.gpuP95 ?? manhBase.p95} ms`);
  if (fx.n8ao !== true) {
    soft(
      '(9) N8AO luma sanity',
      'D',
      'no AO pass in the composer — asserting an AO A/B against a tree with no AO would be a VACUOUS pass, which the R20 close ruling demoted'
    );
    soft('(10) N8AO frame-time budget', 'D', `baseline recorded: Manhattan p95 ${manhBase.gpuP95 ?? manhBase.p95} ms`);
  } else {
    await page.evaluate(() => window.__flyN8AO?.set(false));
    await page.waitForTimeout(2500);
    await page.waitForTimeout(1200);
    await glShot('02-ao-off');
    const off = await page.evaluate(FRAME_SAMPLER, FRAME_SAMPLE_MS);
    await page.evaluate(() => window.__flyN8AO?.set(true));
    await page.waitForTimeout(1200);
    await glShot('03-ao-on');
    const on = await page.evaluate(FRAME_SAMPLER, FRAME_SAMPLE_MS);
    const lOff = await lumaMean(SHOT('02-ao-off'), MANH_CROP);
    const lOn = await lumaMean(SHOT('03-ao-on'), MANH_CROP);
    const sOff = await lumaMean(SHOT('02-ao-off'), SKY_CROP);
    const sOn = await lumaMean(SHOT('03-ao-on'), SKY_CROP);
    console.log(`N8AO luma: creases ${lOff.toFixed(2)}→${lOn.toFixed(2)} · sky ${sOff.toFixed(2)}→${sOn.toFixed(2)}`);
    gate(
      '(9) N8AO LUMA SANITY — AO darkens the building creases and leaves the sky alone',
      lOff - lOn >= 0.5 && Math.abs(sOff - sOn) <= 0.3,
      `creases darkened ${(lOff - lOn).toFixed(2)} · sky moved ${(sOn - sOff).toFixed(2)} (a reversed-depth read inverts this: sky darkens, creases do not)`
    );
    const d = (on.gpuP95 ?? on.p95) - (off.gpuP95 ?? off.p95);
    gate(
      `(10) N8AO frame-time budget at Manhattan <= +${N8AO_MS_MANHATTAN} ms`,
      d <= N8AO_MS_MANHATTAN,
      `+${d.toFixed(2)} ms (${on.instrument}) off ${JSON.stringify(off)} on ${JSON.stringify(on)}`
    );
  }

  /* -------------- (11) the receive-set frame-time experiment ------------ */
  // Measurable TODAY, and it is the number the R13 rejection was really about.
  // The probe sets receiveShadow on the SAME near leaf tiles D's flag would,
  // measures, and puts them back — the real fill-rate cost of the experiment,
  // on real geometry, before anyone writes the feature.
  /* (11) A/Bs D'S OWN SUB-FLAG (W3 correction).
   * My probe set `receiveShadow` on tiles it selected itself and measured the
   * delta — vacuous now that the feature already enlists them: the "on" arm and
   * the "off" arm were the same world. `__flyDepthSub.nearReceive` is the real
   * switch, and D's sweep re-stamps on its own cadence, so each arm is given
   * time to take effect before the frame ledger runs. */
  const setSub = async (v) => {
    await page.evaluate((x) => {
      (window.__flyDepthSub ??= {}).nearReceive = x;
      window.__flyN8AO?.refresh?.();
    }, v);
    await page.waitForTimeout(3000);
  };
  await setSub(1);
  const recvOn = await page.evaluate(FRAME_SAMPLER, FRAME_SAMPLE_MS);
  const recvFlaggedOn = await page.evaluate(
    () => window.__flyStats?.depthRig?.sweep?.live?.flagged ?? null
  );
  await setSub(0);
  const recvOff = await page.evaluate(FRAME_SAMPLER, FRAME_SAMPLE_MS);
  const recvFlaggedOff = await page.evaluate(
    () => window.__flyStats?.depthRig?.sweep?.live?.flagged ?? null
  );
  await page.evaluate(() => {
    if (window.__flyDepthSub) delete window.__flyDepthSub.nearReceive;
    window.__flyN8AO?.refresh?.();
  });
  const recv = { touched: recvFlaggedOn, off: recvFlaggedOff };
  const recvDelta = (recvOn.gpuP95 ?? recvOn.p95) - (recvOff.gpuP95 ?? recvOff.p95);
  console.log(
    `RECEIVE-SET A/B via __flyDepthSub.nearReceive: flagged on=${recvFlaggedOn} off=${recvFlaggedOff} · ` +
      `on ${JSON.stringify(recvOn)} · off ${JSON.stringify(recvOff)} · Δ ${recvDelta.toFixed(2)} ms`
  );
  gate(
    `(11) RECEIVE-SET frame-time budget <= +${RECEIVE_MS} ms (or the feature ships off — plan §6 D)`,
    recvDelta <= RECEIVE_MS,
    `+${recvDelta.toFixed(2)} ms with ${recvFlaggedOn} tiles flagged vs ${recvFlaggedOff} off (${recvOn.instrument}) — ` +
      `the R13 FILL-RATE objection, measured through D's own switch instead of a probe that re-created the feature`
  );
  anchorLogD('receive-set cost', `+${recvDelta.toFixed(2)} ms for ${recvFlaggedOn} tiles at Manhattan 700 m`);

  /* ================= near-field atmosphere + haze scoping ================ */
  await pose(P_LEWIS, NOON, 18000);
  /* `AERIAL_PERSPECTIVE.startM` DOES NOT MOVE, and it was never supposed to.
   * D's near band is a NEW uniform pair (`uNear` = nearStartM, nearMaxMix) laid
   * under the existing 800 m start, not a change to it — the first W3 armed run
   * read `startM 800`, concluded the feature was inert, and was wrong. The
   * observable is `nearStartM`.
   * It is also gated on `strength > 0`, and the FLEET PIN holds
   * `__flyAerialOverride = 0`, so the field reads 0 while pinned regardless of
   * the flag. This leg therefore lifts the override for a UNIFORM READ ONLY —
   * no screenshot, no pixel assertion, restored immediately, and the page is
   * closed before any frozen-pixel gate could see it. verify-aerial keeps sole
   * ownership of the PIXEL un-pin. */
  /* The override must be held across FRAMES, not across statements (W3 fix).
   * `__flyAerial.get()` returns `_state`, which the frame loop recomputes — so
   * lifting the pin and reading in the same `evaluate` returns the PREVIOUS
   * frame's values and `nearStartM` reads 0 no matter what is armed. Lift,
   * let the loop run, read, restore. Still a UNIFORM READ only: no screenshot,
   * no pixel assertion, restored immediately; verify-aerial keeps sole
   * ownership of the pixel un-pin. */
  await page.evaluate(() => {
    window.__r22PrevAerial = window.__flyAerialOverride;
    window.__flyAerialOverride = 1;
  });
  await page.waitForTimeout(1200);
  const near = await page.evaluate(() => {
    try {
      const a = window.__flyAerial.get();
      const q = window.__flyAerial.quilt();
      return { ...a, quilt: q };
    } catch (e) {
      return { err: String(e).slice(0, 80) };
    }
  });
  await page.evaluate(() => {
    window.__flyAerialOverride = window.__r22PrevAerial ?? 0;
    delete window.__r22PrevAerial;
  });
  console.log(`P-LEWIS aerial: ${JSON.stringify(near)}`);
  gate(
    DEPTH_ARMED
      ? '(12) near-field atmosphere — the 0..startM band carries a near term (nearStartM > 0)'
      : '(12) near-field atmosphere is OFF in the ship state — nearStartM identically 0',
    DEPTH_ARMED ? (near.nearStartM ?? 0) > 0 : (near.nearStartM ?? 0) === 0,
    `nearStartM ${near.nearStartM} · nearMaxMix ${near.nearMaxMix} · startM ${near.startM} (unchanged BY DESIGN — the near band ` +
      `is a separate uniform laid under the R19 800 m start, not a move of it) · strength ${near.strength} ` +
      `(read with __flyAerialOverride lifted across frames for the uniform read only, then restored)`
  );
  red.push([
    'D4 nothing atmospheric touches the first 800 m',
    'verify-depth2 (12)',
    `nearStartM ${near.nearStartM} (startM ${near.startM}, unchanged by design)`,
    '> 0',
  ]);

  // MEDIUM TIER. The content-haze flip (plan §5.4) is the R19 §5b-named right
  // fix for medium/low, where no post pass runs at all. The instrument is the
  // world-bend uniform the sat-building fragment reads, not a pixel guess.
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('medium'));
  await page.waitForTimeout(6000);
  const med = await page.evaluate(() => {
    let scene = window.__fly.engine.object;
    while (scene.parent) scene = scene.parent;
    let found = null;
    scene.traverse((o) => {
      if (found || !o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m?.userData?.__worldBend === 'anchor-sat') {
        const u = m.userData.__bendUniforms ?? m.userData.uniforms ?? null;
        found = {
          bend: m.userData.__worldBend,
          uniforms: u ? Object.keys(u).filter((k) => /haze/i.test(k)).map((k) => [k, u[k]?.value]) : null,
        };
      }
    });
    return {
      tier: window.__flyStore.getState().qualityTier,
      material: found,
      passes: (window.__flyComposer?.passes ?? []).map((p) => p.name ?? p.constructor?.name),
    };
  });
  console.log(`MEDIUM tier: ${JSON.stringify(med)}`);
  /* THE INSTRUMENT IS THE SOURCE, because the uniform is not reachable.
   *
   * `satHazeUniforms` in world-bend.js is a MODULE-PRIVATE object injected into
   * the shader by `onBeforeCompile`; the material's userData does not carry it
   * and world-bend exports no getter for it (it does for the sibling
   * `getSatBldgFade`). The first calibration run therefore read
   * `uniforms: null` and "failed" — which would have been a red produced by a
   * missing instrument rather than by the defect, the exact thing the R19
   * postmortem calls an instrument artifact.
   *
   * So the gated fact is the SOURCE fact, parsed from fly-constants.js:
   * `AERIAL_PERSPECTIVE.content.enabled` and `.minTier`. That is a fact with no
   * distribution — the same standing verify-flicker's polygonOffset gate rests
   * on — and it is exactly what plan §5.4's one-line flip changes. The runtime
   * uniform is ALSO asserted when it becomes reachable; the ask for a getter is
   * in close-sweep §1e, owned by D. */
  const constSrc = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'fly', 'fly-constants.js'),
    'utf8'
  );
  const contentBlock = constSrc.slice(
    constSrc.indexOf('export const AERIAL_PERSPECTIVE'),
    constSrc.indexOf('export const AERIAL_PERSPECTIVE') + 2600
  );
  const cIdx = contentBlock.indexOf('content: {');
  const cTail = cIdx >= 0 ? contentBlock.slice(cIdx, cIdx + 320) : '';
  const contentEnabled = /enabled:\s*true/.test(cTail);
  const contentMinTier = (cTail.match(/minTier:\s*'(\w+)'/) ?? [])[1] ?? null;
  const hazeUniforms = med.material?.uniforms ?? [];
  const hazeArmed = hazeUniforms.some((u) => (u[1] ?? 0) > 0);
  console.log(
    `AERIAL_PERSPECTIVE.content (source): enabled=${contentEnabled} minTier=${contentMinTier} · runtime uniforms reachable: ${hazeUniforms.length > 0}`
  );
  /* §5.4 IS CONSUMED AT W3 AND IS INDEPENDENT OF `DEPTH_PASS`. The content
   * haze is a fly-constants flip plus the W2 arbitration mechanism (the term
   * carries its OWN tier gate, armed at/below `content.minTier` where the post
   * pass is NOT running). So this gate asserts the same thing in both DEPTH
   * states — it is not part of the built-but-off decision. */
  gate(
    '(13) MEDIUM-TIER CONTENT HAZE — armed, and scoped down to medium (plan §5.4, CONSUMED)',
    contentEnabled && (contentMinTier === 'medium' || contentMinTier === 'low'),
    `AERIAL_PERSPECTIVE.content.enabled=${contentEnabled} minTier=${contentMinTier} · composer passes at medium ${JSON.stringify(med.passes)} ` +
      `(no post pass runs at medium, so content there is an un-atmosphered cut-out standing on hazed ground — the R19 §5b-named right fix)`
  );
  red.push([
    'D5 medium/low content is an un-atmosphered cut-out',
    'verify-depth2 (13)',
    `content.enabled=${contentEnabled} minTier=${contentMinTier}`,
    'enabled + minTier medium',
  ]);
  if (hazeUniforms.length)
    gate(
      '(13b) the medium-tier haze uniform actually carries a value',
      hazeArmed,
      `uniforms ${JSON.stringify(hazeUniforms)}`
    );
  else
    soft(
      '(13b) runtime haze uniform',
      'D',
      'world-bend exports no getter for satHazeUniforms (it does for getSatBldgFade) — see close-sweep §1e'
    );
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.waitForTimeout(6000);
  const high = await page.evaluate(() => {
    let scene = window.__fly.engine.object;
    while (scene.parent) scene = scene.parent;
    let found = null;
    scene.traverse((o) => {
      if (found || !o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m?.userData?.__worldBend === 'anchor-sat') {
        const u = m.userData.__bendUniforms ?? m.userData.uniforms ?? null;
        found = u ? Object.keys(u).filter((k) => /haze/i.test(k)).map((k) => [k, u[k]?.value]) : null;
      }
    });
    return found;
  });
  gate(
    '(14) HIGH TIER IS NOT DOUBLE-HAZED — the in-shader content haze stays off where the post pass runs',
    (!high || !high.some((u) => (u[1] ?? 0) > 0)) &&
      (!contentEnabled || contentMinTier === 'medium' || contentMinTier === 'low'),
    `high-tier haze uniforms ${JSON.stringify(high)} · source minTier=${contentMinTier} ` +
      `(the R19 ruling: at high the depth post pass already hazes these fragments by the SAME distance law, so both = double haze). ` +
      `NOTE this gate passes on the pre-R22 tree too, because the term is off everywhere — it exists to stop §5.4 being applied at the WRONG tier.`
  );

  /* =========================== OWENS — +0 by construction =============== */
  await pose(OWENS, NOON, 22000);
  await setShadows(true);
  await page.waitForTimeout(3000);
  const owens = await page.evaluate(SHADOW_CENSUS, ORTHO_RADIUS_M);
  const owensFrame = await page.evaluate(FRAME_SAMPLER, FRAME_SAMPLE_MS);
  console.log(`OWENS census: ${JSON.stringify(owens)} · frame ${JSON.stringify(owensFrame)}`);
  await glShot('04-owens');
  anchor('Owens frame baseline', `${owensFrame.instrument} p95 ${owensFrame.gpuP95 ?? owensFrame.p95} ms · draws ${owens.draws}`);
  /* OWENS IS NOT CASTER-FREE, AND THE FIRST DRAFT SAID IT WAS.
   *
   * The draft asserted `castersNear === 0` at Owens and measured 4 — because
   * Owens has real vegetation (R18 measured 952 tree stands in that valley) and
   * SatVegLayer arms `castShadow` with the rig. The claim the plan actually
   * makes is about COST, not about emptiness: "mounts only when casters are
   * inside the ortho frustum and AGL < band ⇒ Owens +0 BY CONSTRUCTION", where
   * the +0 is a DRAW count against the tightest ceiling in the app. So the
   * gate asserts the catcher is not mounted at the empty control, and prints
   * the caster count as evidence rather than asserting it away. */
  /* SUPERSEDED BY FABLE'S W2 ARBITRATION (`0efe415`), and the ruling is the
   * right one: "Owens +0 by construction" was FALSE — Lone Pine has 949
   * building columns inside the ortho frustum, so the caster-presence gate
   * legitimately mounts the catcher there and it costs +1 draw. The claim that
   * survives is the CEILING, which is the frozen number: Owens must stay
   * <= 261 with everything armed. The mount count is recorded, not forbidden. */
  gate(
    `(5) CATCHER AT OWENS — the ${OWENS_DRAW_CEILING} ceiling holds with the catcher mounted (Fable ruling 0efe415)`,
    (owens.draws ?? Infinity) <= OWENS_DRAW_CEILING,
    `catcher meshes=${owens.catcherMeshes} · casters near=${owens.castersNear} · draws=${owens.draws} <= ${OWENS_DRAW_CEILING} ` +
      `("+0 by construction" was retracted at W2: Lone Pine has 949 columns in the ortho frustum)`
  );
  gate(
    `(15) OWENS draws <= ${OWENS_DRAW_CEILING} with the shadow rig armed`,
    (owens.draws ?? Infinity) <= OWENS_DRAW_CEILING,
    `draws ${owens.draws} tris ${owens.tris}`
  );

  /* -------------------- (6) the AGL band edges -------------------------- */
  await pose([OWENS[0], OWENS[1], 4000], NOON, 14000);
  const aboveBand = await page.evaluate(SHADOW_CENSUS, ORTHO_RADIUS_M);
  console.log(`ABOVE THE CATCHER BAND (${aboveBand.aglM} m AGL): catcher meshes=${aboveBand.catcherMeshes}`);
  gate(
    `(6) the AGL band edge holds — no catcher above maxAglM (${CATCHER_MAX_AGL} m)`,
    aboveBand.aglM > CATCHER_MAX_AGL ? (aboveBand.catcherMeshes ?? 0) === 0 : true,
    `${aboveBand.catcherMeshes} catcher meshes at ${aboveBand.aglM} m AGL`
  );

  const netErrs = errs.filter(
    (e) =>
      /arcgisonline|arcgis\.com|ERR_FAILED|Access to fetch/i.test(e) ||
      (/@https?:\/\//.test(e) && !e.includes(DEV_ORIGIN))
  );
  const appErrs = errs.filter((e) => !netErrs.includes(e));
  gate(
    '(16) zero APP page/console errors (upstream Esri tile errors classified separately)',
    appErrs.length === 0,
    `app=${appErrs.length} net=${netErrs.length} · ${appErrs.slice(0, 3).join(' | ')}`
  );

  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  fs.writeFileSync(
    path.join(__dirname, 'r22-e-red-depth2.json'),
    JSON.stringify(
      {
        when: new Date().toISOString(),
        manh,
        armed,
        rig,
        fx,
        manhBase,
        recv,
        recvOn,
        recvOff,
        recvDelta,
        near,
        med,
        high,
        owens,
        owensFrame,
        aboveBand,
        red,
        fails,
        softs,
      },
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
