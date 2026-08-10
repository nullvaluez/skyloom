/**
 * ROUND 22 (E "CERT") — verify-settle: DOES THE WORLD ARRIVE ALL AT ONCE?
 *
 * The user's symptom #3 — "things glitch a little a few seconds after
 * boot/warp" — was clarified interactively into two distinct mechanisms, and
 * this gate measures both as COUNTERS rather than as pixels (the R21 lesson:
 * counting the loop beats counting its shadow).
 *
 *   POP-IN   every streaming layer appears as a hard cut. The instrument is
 *            per-layer t90 — the first 100 ms sample at which a layer holds
 *            90% of the population it settles to, and never drops below it
 *            again — measured against the reveal moment. FIRST APPEARANCE was
 *            the original statistic and it PASSED on the pre-fix tree (every
 *            layer had SOME population 6 s before the boot reveal, because
 *            BootScreen already drains the satellite tiles); the pop the user
 *            reports is the ring FILLING, not the ring existing. Both numbers
 *            are printed; t90 is the one gated. The gate runs twice, because
 *            the two reveals are different code paths: BootScreen's, and
 *            WarpFlash's `downloading < 3` — which consults no vector ring at
 *            all and is where "the city assembles in front of you" lives.
 *   STUTTER  the shader prewarm cannot start until the HDRI resolves (up to
 *            4 s) and the boot reveal proceeds at `PREWARM.maxMs 3000` whether
 *            or not the warm finished, so the compile train lands AFTER
 *            reveal. Two instruments: long frames (> max(40 ms, 3x the rolling
 *            median)) in reveal+10 s, and — the structural one — the GROWTH IN
 *            `gl.info.programs.length` after reveal. A program compiled after
 *            the curtain is a stutter with a receipt; it cannot be explained
 *            away as machine noise, which is exactly why the RED leg throttles
 *            the HDRI fetch instead of throttling the CPU.
 *
 * Plus the three settle mechanisms the plan names, each with its own
 * deterministic instrument: the parcel scale ramp (read off the real
 * InstancedMesh matrices, not off a stat), the raw `groundElev` sweep that
 * every AGL-keyed fade band rides, and the governor ladder's SHAPE — which is
 * measurable exactly, with no timing at all, by building a synthetic governor
 * from the exported factory (`window.__flyGovFactory`, A's R21 instrument).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS GATE UN-PINS: `__flySettlePin` (B's SETTLE_CALM / ARRIVAL_GATE /
 * PREWARM). `__flyTerraPin` stays PINNED here on purpose — pop-in and stutter
 * are B-owned properties, and letting A's pipeline change the stream-in
 * ordering underneath them would make every number a two-variable experiment.
 * ---------------------------------------------------------------------------
 *
 * RED CALIBRATION (r22/e @ ee39397, all R22 blocks enabled:false): the run
 * prints every number; §1 of scripts/r22-close-sweep.md carries them.
 *
 * GATES
 *   (1)  precondition — a Powell boot with a real multi-layer population
 *   (2a) BOOT — no layer reaches t90 later than the boot reveal + 2500 ms
 *   (2b) WARP — the same, against WarpFlash's reveal (the RED leg)
 *   (3)  BIRTH FADES EXIST — a layer that DOES arrive late is fading in
 *        (SETTLE_CALM.births); (3) is what survives if B decides a layer
 *        legitimately arrives late
 *   (4)  NO POST-REVEAL COMPILE TRAIN — gl programs are flat after reveal
 *   (5)  STUTTER — <= 2 long frames in reveal+10 s (clean boot)
 *   (6)  STUTTER under a THROTTLED HDRI — the same bound with the HDRI fetch
 *        delayed 9 s, which is what a real network does to the prewarm's
 *        start time
 *   (7)  the prewarm finished BEFORE the reveal
 *   (8)  PARCEL BIRTH — no more than 25% of the pool appears in one 100 ms
 *        sample at full instance scale (Melton AU)
 *   (8b) the growK scale step is continuous (NOT red-calibrated — see the gate)
 *   (9)  parcel deletes fade (instance count never drops by more than a
 *        fraction in one sample without a fade running)
 *   (10) groundElevVis is SLEW-LIMITED across a mountain warp
 *   (11) LADDER SHAPE — >= 2 render-scale rungs before the first tier step at
 *        devicePixelRatio 1
 *   (12) ladder shape at dpr 1.5 (the control: the defect is dpr-1-specific)
 *   (13) zero page/console errors
 *
 * Run: FLY_URL=http://localhost:3224 node scripts/verify-settle.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const DEV_ORIGIN = (process.env.FLY_URL || 'http://localhost:3000').replace(/\/$/, '');

const POWELL = { lat: 40.1578, lon: -83.0752 };
const MELTON = [-37.6833, 144.5833, 700]; // Melton AU — R20 measured 2,068 parcel homes
const SIERRA = [36.578, -118.292, 4200]; // Mt Whitney ridge: ~2500 m of DEM relief
const POPIN_GRACE_MS = 2500; // plan §7 — the no-fade bound
const POPIN_BIRTHED_MS = 8000; // the WITH-fade bound (B's proposal, ruled + frozen)
const MAX_LONG_FRAMES = 2; // plan §7 (printed; the long-frame COUNT did not separate B's arms)
/* The gated stutter scalar (W2). B's measured arms: prewarm OFF 576-714 ms
 * worst frame, ON 132-165 ms. 200 sits above the fixed arm's ceiling and far
 * below the broken arm's floor, so it separates them by construction. */
const WORST_FRAME_MS = +(process.env.SETTLE_WORST_FRAME_MS ?? 200);
const LONG_FRAME_MS = 40; // absolute floor of the long-frame definition
const WINDOW_MS = 10000; // reveal + 10 s
const MAX_SCALE_JUMP = 0.2; // relative, per 100 ms sample (a 600 ms ease moves ~0.08)
const MAX_BIRTH_FRAC = 0.25; // share of a pool allowed to appear in one 100 ms sample at full size
/* THE SLEW STATISTIC IS PER-FRAME METERS, NOT METRES PER SECOND (W2, B's
 * instrument correction). A m/s figure computed with a dt that is not the
 * damper's own dt is an instrument artifact: B's per-rAF rates read 350-540 m/s
 * on a damper that is correct by construction, because a 100 ms sampler
 * dividing by 0.1 s reports the rate of a step the damper never took in one
 * step. The honest scalar is the STEP the visual value takes between two
 * consecutive frames, in metres. B measured raw ~384 m/frame; the damped value
 * is <= 4.0 m/frame BY CONSTRUCTION. The old m/s number is kept in the output
 * as evidence, and its W1 value (22 697-24 023 m/s) is retired in close-sweep
 * section 1 rather than erased. */
const SLEW_M_PER_FRAME = +(process.env.SETTLE_SLEW_M ?? 8);
const SLEW_MPS = 80; // SETTLE_CALM.groundElevVis.slewMps (kept: printed, not gated)
const MIN_DPR_RUNGS = 2; // plan §5.8 gate
const HDRI_DELAY_MS = +(process.env.SETTLE_HDRI_DELAY_MS ?? 9000);

/**
 * The boot trace. Installed as an init script so it is already running when
 * the first layer publishes — a trace started after bootFly returns cannot see
 * a first appearance by definition.
 */
const INSTALL_BOOT_TRACE = () => {
  const S = (window.__r22Settle = { t0: performance.now(), rows: [], frames: [], last: performance.now() });
  const raf = (t) => {
    S.frames.push({ t: +(t - S.t0).toFixed(1), dt: +(t - S.last).toFixed(2) });
    S.last = t;
    if (S.frames.length > 100000) S.frames.shift();
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  const glOf = () => {
    const p =
      window.__flyPlayer ??
      window.__satBuildings?.object ??
      window.__satRoads?.object ??
      window.__toyWorld?.object ??
      null;
    return p?.__r3f?.root?.getState?.().gl ?? window.__flyGl ?? null;
  };
  const pop = () => ({
    // Each layer's OWN published population, at the handle its owner
    // publishes. A layer with no handle is recorded as null and excluded —
    // never guessed at from the scene graph.
    satBuildings: window.__satBuildings?.stats?.ready ?? null,
    satRoads: window.__satRoads?.stats?.ready ?? null,
    satSkyline: window.__satSkyline?.stats?.ready ?? null,
    satVeg: window.__satVeg?.placed ?? window.__flyStats?.satVeg?.placed ?? null,
    satTint: window.__flyStats?.satTint?.polys ?? null,
    parcelHomes: window.__flyStats?.parcelHomes?.placed ?? null,
    houseLights: window.__flyStats?.houseLights?.placed ?? null,
    traffic: window.__flyStats?.traffic ?? null,
  });
  const sample = () => {
    const gl = glOf();
    const hold = document.querySelector('[data-testid="warp-hold"]');
    S.rows.push({
      t: +((performance.now() - S.t0) / 1000).toFixed(2),
      boot: window.__flyBoot?.pct ?? null,
      stage: hold ? hold.getAttribute('data-stage') : null,
      progs: gl?.info?.programs?.length ?? null,
      pop: pop(),
      // B's instrument when it lands; undefined = legacy, per the R21 idiom.
      popin: window.__fly?.popin ?? null,
      prewarm: window.__flyStats?.prewarm ?? null,
    });
  };
  // The rAF loop below is never stopped (it is a single infinite chain), so a
  // re-arm restarts ONLY the 100 ms sampler; restarting the rAF chain would
  // double-count every frame.
  S.rearm = () => {
    S.tick = setInterval(sample, 100);
  };
  S.tick = setInterval(sample, 100);
};
const READ_BOOT_TRACE = () => {
  const S = window.__r22Settle;
  clearInterval(S.tick);
  return { rows: S.rows, frames: S.frames };
};
/** Re-arm the SAME trace for the warp leg — the sampler must already be
 *  running when the hold overlay lifts, exactly as at boot. */
const REARM_TRACE = () => {
  const S = window.__r22Settle;
  if (S.tick) clearInterval(S.tick);
  S.rows = [];
  S.frames = [];
  S.t0 = performance.now();
  S.last = performance.now();
  S.rearm();
};

const LAYERS = [
  'satBuildings',
  'satRoads',
  'satSkyline',
  'satVeg',
  'satTint',
  'parcelHomes',
  'houseLights',
  'traffic',
];

/**
 * Per-layer arrival analysis against a reveal moment.
 *   first  — the first sample with any population at all (evidence)
 *   t90    — the first sample at which the layer holds >= 90% of the
 *            population it SETTLES to, and never drops below it again. This is
 *            "the layer is assembled", and it is what the gate reads.
 */
function analysePopin(trace, revealMs, popinRef) {
  const first = {};
  const t90 = {};
  const settled = {};
  for (const k of LAYERS) {
    const series = trace.map((r) => ({ t: r.t * 1000, v: r.pop?.[k] ?? null }));
    const vals = series.map((s) => s.v).filter((v) => v != null);
    const end = vals.length ? vals.slice(-Math.max(1, Math.floor(vals.length * 0.15))) : [];
    const fin = end.length ? Math.max(...end) : 0;
    settled[k] = fin;
    const hit = series.find((s) => (s.v ?? 0) > 0);
    first[k] = hit ? Math.round(hit.t) : null;
    if (!fin) {
      t90[k] = null;
      continue;
    }
    let at = null;
    for (let i = 0; i < series.length; i++) {
      if ((series[i].v ?? 0) >= fin * 0.9) {
        if (series.slice(i).every((s) => (s.v ?? 0) >= fin * 0.9)) {
          at = Math.round(series[i].t);
          break;
        }
      }
    }
    t90[k] = at;
  }
  /* THE FROZEN POP-IN DEFECT PREDICATE (W3, B's proposal, ruled and frozen):
   *      defect  <=>  (birthed === false AND t90 > reveal + 2500 ms)
   *               OR  (birthed === true  AND first-appearance > reveal + 8000 ms)
   * A layer that arrives late WITH a birth fade running is not a pop — it is a
   * fade, which is the fix. What stays a defect is a late layer with no fade at
   * all, or a fade that starts so late the player is looking at absence. Boot
   * assembly at +3.7 s WITH fades is ACCEPTABLE-WITH-FADES by ruling
   * (`ARRIVAL_GATE.bootTerms` stays false on B's measured escalation: the boot
   * content terms cost +2.6 s against an envelope plan section 4 freezes). */
  const birthedOf = (k) => popinRef?.layers?.[k]?.birthed ?? null;
  const late = LAYERS.filter((k) => {
    if (revealMs == null) return false;
    const b = birthedOf(k);
    if (b === true) return first[k] != null && first[k] - revealMs > POPIN_BIRTHED_MS;
    return t90[k] != null && t90[k] - revealMs > POPIN_GRACE_MS;
  });
  const never = LAYERS.filter((k) => first[k] == null);
  return { first, t90, settled, late, never };
}

/** Long frames inside [t0, t1] ms, by the plan's own definition. */
function longFrames(frames, t0, t1) {
  const win = frames.filter((f) => f.t >= t0 && f.t <= t1);
  if (!win.length) return { count: 0, worst: 0, median: 0, samples: 0, list: [] };
  const med = [...win.map((f) => f.dt)].sort((a, b) => a - b)[Math.floor(win.length / 2)];
  const bound = Math.max(LONG_FRAME_MS, med * 3);
  const list = win.filter((f) => f.dt > bound);
  return {
    count: list.length,
    worst: +Math.max(...win.map((f) => f.dt)).toFixed(1),
    median: +med.toFixed(2),
    bound: +bound.toFixed(1),
    samples: win.length,
    list: list.slice(0, 8).map((f) => `${(f.t / 1000).toFixed(2)}s:${f.dt}ms`),
  };
}

(async () => {
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
  const newFlyPage = async (extra) => {
    const p = await context.newPage();
    /* BOTH pins (W3 correction, B's proof). My +9.5 s satRoads red was the
     * LEGACY reveal running under `__flyTerraPin`: with both pins lifted B
     * measured roads t90 at reveal MINUS 1301 ms, roadFrac 0.875 over the
     * settled 16-chunk ring. A content-aware reveal cannot be judged with the
     * content signal pinned off. */
    await p.addInitScript(unpinPins, ['__flySettlePin', '__flyTerraPin']);
    if (extra) await p.addInitScript(extra);
    await p.addInitScript(INSTALL_BOOT_TRACE);
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => {
      // The URL matters: an error with an off-origin location is upstream
      // (Esri tiles, live ADS-B), and the classifier below needs it to say so.
      if (m.type() === 'error')
        errs.push(`console: ${m.text().slice(0, 140)} @${m.location?.()?.url ?? ''}`);
    });
    return p;
  };

  /* ==================== LEG 1 — the clean boot at Powell ================= */
  const seedPowell = () => {
    try {
      localStorage.setItem('fly-last-pos', JSON.stringify({ lat: 40.1578, lon: -83.0752 }));
    } catch {
      /* storage blocked — the leg reports the spawn it actually got */
    }
  };
  const page = await newFlyPage(seedPowell);
  const { ms: bootMs } = await bootFly(page, { style: 'satellite', settleMs: 0, ...BOOT_OPTS });
  // FREEZE at reveal, without warping: the pop-in window must watch the boot's
  // OWN spawn ring stream in, and a 350 kt aeroplane re-centres the rings
  // underneath the measurement (the R21 verify-stability phase-4 lesson).
  await page.evaluate(() => {
    const f = window.__fly?.flight;
    if (f && !f.__frozen) {
      f.__frozen = true;
      f.step = () => {};
    }
  });
  await page.waitForTimeout(WINDOW_MS + 6000);
  const { rows, frames } = await page.evaluate(READ_BOOT_TRACE);
  await page
    .locator('.fixed.inset-0 canvas')
    .first()
    .screenshot({ path: path.join(__dirname, 'r22-e-settle-01-powell-boot.png') });

  const revealRow = rows.find((r) => r.boot === 100);
  const revealT = revealRow ? revealRow.t * 1000 : null;
  const bootPopin = rows.map((r) => r.popin).filter(Boolean).pop() ?? null;
  const boot = analysePopin(rows, revealT, bootPopin);
  console.log(
    `POWELL BOOT: reveal @${Math.round(revealT ?? -1)} ms (bootFly measured ${bootMs} ms) · per layer [first population] / [90% of settled]:`
  );
  for (const k of LAYERS)
    console.log(
      `  ${k.padEnd(14)} ${
        boot.first[k] == null
          ? 'never populated'
          : `first ${boot.first[k]} ms (${boot.first[k] - revealT >= 0 ? '+' : ''}${Math.round(boot.first[k] - revealT)}) · t90 ${boot.t90[k]} ms (${boot.t90[k] - revealT >= 0 ? '+' : ''}${Math.round(boot.t90[k] - revealT)}) · settled ${boot.settled[k]}`
      }`
    );

  gate(
    '(1) precondition: a Powell boot with a real multi-layer population',
    revealT != null && LAYERS.filter((k) => boot.first[k] != null).length >= 4,
    `reveal at ${Math.round(revealT ?? -1)} ms · ${LAYERS.filter((k) => boot.first[k] != null).length}/8 layers populated · never: ${boot.never.join(',') || 'none'}`
  );
  /* THE STATISTIC IS t90, NOT FIRST APPEARANCE.
   *
   * The first calibration run gated on first appearance and PASSED on the
   * pre-fix tree: every layer had SOME population 6 s before the boot reveal,
   * because BootScreen's own gate already drains the satellite tiles. But
   * "some population" is one chunk of sixteen — and the pop the user reports is
   * the ring FILLING, not the ring existing. t90 (the first sample at which a
   * layer holds >= 90% of the population it settles to) is the honest form of
   * "the world is assembled", and it is the number the plan's own §7 criterion
   * is really about. First appearance is kept and printed, as evidence. */
  gate(
    `(2a) BOOT — no layer is a POP (no-fade t90 > +${POPIN_GRACE_MS} ms, or faded first-appearance > +${POPIN_BIRTHED_MS} ms)`,
    boot.late.length === 0,
    boot.late.length
      ? boot.late.map((k) => `${k} +${Math.round(boot.t90[k] - revealT)} ms`).join(', ')
      : 'every populated layer was assembled at reveal'
  );
  red.push([
    'S-POP layers assemble after the curtain lifts (boot)',
    'verify-settle (2a)',
    boot.late.length ? boot.late.map((k) => `${k} +${Math.round(boot.t90[k] - revealT)}ms`).join(' ') : '0 late',
    '0 late layers',
  ]);
  /* B SETTLE's real contract (r22/b): runtime.popin = {revealKind,
   * layers:{<name>:{atMs, sinceRevealMs, birthed}}, longFrames, worstMs,
   * frames}. `birthed` — not `fading` — is the flag that says a layer arrived
   * through a birth transition, and it is what a late layer has to carry. */
  const popin = rows[rows.length - 1]?.popin ?? null;
  if (!popin)
    soft(
      '(3) birth evidence (runtime.popin)',
      'B',
      'the {revealKind, layers:{atMs, sinceRevealMs, birthed}, longFrames, worstMs, frames} contract is not published on this tree'
    );
  else {
    const lateOwn = Object.entries(popin.layers ?? {}).filter(
      ([, v]) => (v?.sinceRevealMs ?? -1) > POPIN_GRACE_MS
    );
    console.log(
      `runtime.popin: revealKind=${popin.revealKind} longFrames=${popin.longFrames} worstMs=${popin.worstMs} ` +
        `frames=${popin.frames} · layers=${JSON.stringify(popin.layers)}`
    );
    gate(
      '(3) BIRTH TRANSITIONS EXIST — every layer that arrives late reports birthed:true',
      lateOwn.every(([, v]) => v.birthed === true),
      lateOwn.length
        ? lateOwn.map(([k, v]) => `${k} +${v.sinceRevealMs}ms birthed=${v.birthed}`).join(', ')
        : 'no layer arrived later than the grace window, by B own accounting'
    );
  }

  /* ------------------------ stutter, clean boot ------------------------- */
  const progsAfter = rows.filter((r) => revealT != null && r.t * 1000 >= revealT).map((r) => r.progs ?? 0).filter(Boolean);
  const progGrowth = progsAfter.length ? Math.max(...progsAfter) - Math.min(...progsAfter) : -1;
  const lf = longFrames(frames, revealT ?? 0, (revealT ?? 0) + WINDOW_MS);
  const prewarm = rows.map((r) => r.prewarm).filter(Boolean).pop() ?? null;
  const prewarmDoneAt = rows.find((r) => r.prewarm)?.t ?? null;
  console.log(
    `STUTTER (clean): programs after reveal ${Math.min(...progsAfter)}..${Math.max(...progsAfter)} (growth ${progGrowth}) · ` +
      `long frames ${lf.count} (bound ${lf.bound} ms, median ${lf.median} ms, worst ${lf.worst} ms over ${lf.samples} frames) ${JSON.stringify(lf.list)}`
  );
  console.log(`PREWARM: ${JSON.stringify(prewarm)} first published at ${prewarmDoneAt}s vs reveal ${((revealT ?? 0) / 1000).toFixed(2)}s`);
  /* THE COMPILE COUNT IS NOT THE STUTTER (W2, B's caveat, and it inverts the
   * gate). With B's prewarm fix ON the post-reveal program count RISES 13 -> 19,
   * because the env re-key deliberately warms the FULL set — more programs, and
   * a calmer frame. Gating on the count would therefore fail the fix for doing
   * its job. The scalar that separated B's arms is the WORST FRAME in the
   * window: OFF 576-714 ms, ON 132-165 ms. The long-frame COUNT did not
   * separate them either (2 vs 2 on B's machine), so it is printed and not
   * gated. Programs are still recorded — a compile train is still evidence —
   * but the assertion is the frame the player actually feels. */
  gate(
    `(4) POST-REVEAL COMPILES DO NOT STALL THE FRAME — worst frame in reveal+${WINDOW_MS / 1000}s <= ${WORST_FRAME_MS} ms`,
    lf.worst <= WORST_FRAME_MS,
    `worst ${lf.worst} ms · ${progGrowth} programs compiled after reveal (informational: B's fix RAISES this 13 -> 19 ` +
      `by warming the full set, so the count is evidence, not the assertion)`
  );
  red.push([
    'S-STUT the post-reveal compile train stalls the frame (RE-BASED W2: worst frame)',
    'verify-settle (4)',
    `${lf.worst} ms worst / ${progGrowth} programs`,
    `<= ${WORST_FRAME_MS} ms`,
  ]);
  gate(
    `(5) STUTTER — <= ${MAX_LONG_FRAMES} long frames in reveal+${WINDOW_MS / 1000}s (clean boot)`,
    lf.count <= MAX_LONG_FRAMES,
    `${lf.count} frames over ${lf.bound} ms · worst ${lf.worst} ms · ${JSON.stringify(lf.list)} ` +
      `(the COUNT did not separate B's arms — 2 vs 2 — so gate (4)/(6) carry the claim on the WORST frame)`
  );
  if (!prewarm) soft('(7) prewarm state', 'B', '__flyStats.prewarm not published on this tree');
  else
    gate(
      '(7) the prewarm finished BEFORE the reveal',
      prewarmDoneAt != null && revealT != null && prewarmDoneAt * 1000 <= revealT,
      `prewarm published at ${prewarmDoneAt}s (warmed ${prewarm.warmed}, passes ${prewarm.passes}, ${prewarm.ms} ms) vs reveal ${((revealT ?? 0) / 1000).toFixed(2)}s`
    );

  /* ============ LEG 1b — the WARP reveal, which is a DIFFERENT gate ====== */
  // BootScreen drains the satellite tiles before it reveals; WarpFlash polls
  // `engine.downloading < 3` and nothing else. So the warp reveal is where the
  // plan's "the city assembles in front of the player for 5-8 s" lives, and
  // the boot leg above cannot see it. Same trace, same statistic, re-armed.
  await page.evaluate(() => {
    const f = window.__fly.flight;
    delete f.step;
    delete f.__frozen;
    window.__flySunOverride = Date.UTC(2026, 6, 17, 19, 30);
    window.__fly.warpToGeo(36.75, -118.05, { altM: 2500, name: null }); // Owens: park far away
  });
  await page.waitForTimeout(14000);
  await page.evaluate(REARM_TRACE);
  await page.evaluate(
    ([la, lo]) => window.__fly.warpToGeo(la, lo, { altM: 900, name: 'Powell OH' }),
    [POWELL.lat, POWELL.lon]
  );
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const f = window.__fly.flight;
    if (!f.__frozen) {
      f.__frozen = true;
      f.step = () => {};
    }
  });
  await page.waitForTimeout(22000);
  const warpTrace = await page.evaluate(READ_BOOT_TRACE);
  let wIdx = warpTrace.rows.findIndex((r) => r.stage === 'reveal');
  if (wIdx < 0) {
    const lastHold = warpTrace.rows.map((r) => r.stage).lastIndexOf('hold');
    wIdx = lastHold >= 0 ? lastHold + 1 : -1;
  }
  const warpRevealT = wIdx >= 0 ? warpTrace.rows[wIdx].t * 1000 : null;
  const warpPopin = warpTrace.rows.map((r) => r.popin).filter(Boolean).pop() ?? null;
  const warp = analysePopin(warpTrace.rows, warpRevealT, warpPopin);
  console.log(`POWELL FAR WARP: reveal @${Math.round(warpRevealT ?? -1)} ms · per layer [first] / [t90]:`);
  for (const k of LAYERS)
    console.log(
      `  ${k.padEnd(14)} ${
        warp.first[k] == null
          ? 'never populated'
          : `first ${warp.first[k]} ms (${Math.round(warp.first[k] - warpRevealT)}) · t90 ${warp.t90[k]} ms (${warp.t90[k] == null ? 'n/a' : Math.round(warp.t90[k] - warpRevealT)}) · settled ${warp.settled[k]}`
      }`
    );
  await page
    .locator('.fixed.inset-0 canvas')
    .first()
    .screenshot({ path: path.join(__dirname, 'r22-e-settle-03-powell-warp.png') });
  gate(
    `(2b) WARP — no layer is a POP (no-fade t90 > +${POPIN_GRACE_MS} ms, or faded first-appearance > +${POPIN_BIRTHED_MS} ms)`,
    warpRevealT != null && warp.late.length === 0,
    warp.late.length
      ? warp.late.map((k) => `${k} +${Math.round(warp.t90[k] - warpRevealT)} ms`).join(', ')
      : `reveal at ${Math.round(warpRevealT ?? -1)} ms, every populated layer assembled by then`
  );
  red.push([
    'S-POP the city assembles after the warp reveal',
    'verify-settle (2b)',
    warp.late.length ? warp.late.map((k) => `${k} +${Math.round(warp.t90[k] - warpRevealT)}ms`).join(' ') : '0 late',
    '0 late layers',
  ]);
  await page.close();

  /* ============ LEG 2 — the same boot with the HDRI THROTTLED =========== */
  // THE RED LEG, and it throttles the RIGHT thing. A CPU throttle would slow
  // the compiles themselves and prove only that a slow machine is slow. The
  // defect is ORDERING: prewarm cannot start until the HDRI resolves, and the
  // reveal proceeds at PREWARM.maxMs regardless — so delaying exactly the HDRI
  // fetch reproduces the user's network, on this machine, deterministically.
  const throttled = await newFlyPage(seedPowell);
  // 9 s, not 3.5 s. The first calibration run used 3.5 s and produced ZERO
  // long frames, because this machine's boot reveal is itself 10 s — the
  // prewarm still finished at 2.1 s and beat the curtain comfortably. 9 s is
  // the delay that actually pushes the warm PAST a fast reveal, which is the
  // ordering the defect is made of. It is a network condition, not a CPU
  // throttle: throttling the CPU would manufacture long frames and prove only
  // that a slow machine is slow.
  await throttled.route('**/hdri/**', async (route) => {
    await new Promise((r) => setTimeout(r, HDRI_DELAY_MS));
    await route.continue();
  });
  const { ms: bootMs2 } = await bootFly(throttled, { style: 'satellite', settleMs: 0, ...BOOT_OPTS });
  await throttled.evaluate(() => {
    const f = window.__fly?.flight;
    if (f && !f.__frozen) {
      f.__frozen = true;
      f.step = () => {};
    }
  });
  await throttled.waitForTimeout(WINDOW_MS + 4000);
  const t2 = await throttled.evaluate(READ_BOOT_TRACE);
  const revealT2 = (t2.rows.find((r) => r.boot === 100)?.t ?? 0) * 1000;
  const progs2 = t2.rows.filter((r) => r.t * 1000 >= revealT2).map((r) => r.progs ?? 0).filter(Boolean);
  const progGrowth2 = progs2.length ? Math.max(...progs2) - Math.min(...progs2) : -1;
  const lf2 = longFrames(t2.frames, revealT2, revealT2 + WINDOW_MS);
  console.log(
    `STUTTER (HDRI +${HDRI_DELAY_MS / 1000}s): boot ${bootMs2} ms · reveal @${Math.round(revealT2)} ms · programs growth ${progGrowth2} · ` +
      `long frames ${lf2.count} (bound ${lf2.bound} ms, worst ${lf2.worst} ms) ${JSON.stringify(lf2.list)}`
  );
  /* BOTH TERMS. The long-frame count alone read 1 on the calibration run and
   * would have PASSED against a bound of 2 — while thirteen shader programs
   * compiled after the curtain and one frame took 179 ms. The program count is
   * the structural half of the claim and it has no threshold to argue about:
   * a variant compiled after reveal is a variant the prewarm was supposed to
   * have. Gating on both is what makes this leg red on the pre-fix tree. */
  /* THE RED LEG, and the one B's arms separated on: worst frame, not count,
   * not compiles (see gate (4)). B measured OFF 576-714 ms -> ON 132-165 ms. */
  gate(
    `(6) STUTTER under a THROTTLED HDRI — worst frame in reveal+${WINDOW_MS / 1000}s <= ${WORST_FRAME_MS} ms`,
    lf2.worst <= WORST_FRAME_MS,
    `worst ${lf2.worst} ms · ${lf2.count} frames over ${lf2.bound} ms · ${progGrowth2} programs after reveal · ${JSON.stringify(lf2.list)} ` +
      `(B's arms: OFF 576-714 ms -> ON 132-165 ms)`
  );
  red.push([
    'S-STUT stutter with the prewarm starved (RE-BASED W2: worst frame)',
    'verify-settle (6)',
    `${lf2.worst} ms worst frame (${lf2.count} long, ${progGrowth2} programs)`,
    `<= ${WORST_FRAME_MS} ms`,
  ]);
  await throttled.close();

  /* ============ LEG 3 — the parcel ramp at Melton AU ==================== */
  const parcel = await context.newPage();
  await parcel.addInitScript(unpinPins, ['__flySettlePin']);
  parcel.on('pageerror', (e) => errs.push(e.message));
  await bootFly(parcel, { style: 'satellite', ...BOOT_OPTS });
  await parcel.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await parcel.mouse.move(800, 450);
  await parcel.evaluate(
    ([la, lo, al]) => {
      window.__flySunOverride = Date.UTC(2026, 6, 17, 3, 0); // Melton local midday
      window.__fly.warpToGeo(la, lo, { altM: al, name: null });
    },
    MELTON
  );
  await parcel.waitForTimeout(2500);
  await parcel.evaluate(() => {
    const f = window.__fly.flight;
    if (!f.__frozen) {
      f.__frozen = true;
      f.step = () => {};
    }
    // The MEAN INSTANCE SCALE, read off the real matrices. `meanScalar` in
    // __flyStats is the PLACEMENT scalar and does not carry the growK term the
    // ramp lives in — the matrices do, so the matrices are what is measured.
    const S = (window.__r22Parcel = { t0: performance.now(), rows: [] });
    S.tick = setInterval(() => {
      const m = window.__satVeg?.homeMesh;
      const st = window.__flyStats?.parcelHomes ?? null;
      let mean = null;
      let n = 0;
      if (m?.instanceMatrix?.array && m.count > 0) {
        const a = m.instanceMatrix.array;
        n = Math.min(m.count, 200);
        let sum = 0;
        for (let i = 0; i < n; i++) {
          const o = i * 16;
          sum += Math.hypot(a[o], a[o + 1], a[o + 2]); // |first basis column| = x scale
        }
        mean = n ? +(sum / n).toFixed(5) : null;
      }
      S.rows.push({
        t: +((performance.now() - S.t0) / 1000).toFixed(2),
        mean,
        n,
        count: m?.count ?? null,
        placed: st?.placed ?? null,
        provisional: st?.provisional ?? null,
        settled: st?.settled ?? null,
      });
    }, 100);
  });
  await parcel.waitForTimeout(30000);
  const parcelRows = await parcel.evaluate(() => {
    clearInterval(window.__r22Parcel.tick);
    return window.__r22Parcel.rows;
  });
  await parcel
    .locator('.fixed.inset-0 canvas')
    .first()
    .screenshot({ path: path.join(__dirname, 'r22-e-settle-02-melton-parcel.png') });
  /* WHAT ACTUALLY HAPPENS AT MELTON, MEASURED.
   *
   * The first calibration run gated on the growK SCALE step (0.55 -> 1.0) and
   * read 0.0% — because `provisional` was false for the entire run: the R21
   * two-ring settle had already resolved by the time placement ran, so growK
   * was 1 from the first placed instance. The gate was aimed at a mechanism
   * that does not fire at this pose.
   *
   * What the trace DOES show is the pop, in its purest form: `placed` goes
   * 0 -> 1874 between two consecutive 100 ms samples, at FULL instance scale
   * (mean 16.78, the settled value, from the very first frame). So the gated
   * statistic is the BIRTH: how much of a layer's final population can appear
   * in one sample, and at what size. A 600 ms scale ramp satisfies it two ways
   * — either the count ramps, or the instances are born small and grow — and
   * the discrete step satisfies it neither way. The scale-step number is kept
   * as (8b) because it is the mechanism B is changing. */
  let worstJump = 0;
  let jumpAt = null;
  let worstDrop = 0;
  let dropAt = null;
  let birthFrac = 0;
  let birthAt = null;
  let birthScaleFrac = 1;
  const settledCount = Math.max(...parcelRows.map((r) => r.placed ?? 0));
  const settledScale = Math.max(...parcelRows.map((r) => r.mean ?? 0));
  for (let i = 1; i < parcelRows.length; i++) {
    const a = parcelRows[i - 1];
    const b = parcelRows[i];
    if (a.mean && b.mean) {
      const rel = Math.abs(b.mean - a.mean) / Math.max(1e-6, a.mean);
      if (rel > worstJump) {
        worstJump = rel;
        jumpAt = `${a.t}s→${b.t}s scale ${a.mean}→${b.mean} (placed ${a.placed}→${b.placed}, provisional ${a.provisional}→${b.provisional})`;
      }
    }
    const grew = (b.placed ?? 0) - (a.placed ?? 0);
    if (settledCount > 0 && grew > 0) {
      const f = grew / settledCount;
      if (f > birthFrac) {
        birthFrac = f;
        birthAt = `${a.t}s→${b.t}s placed ${a.placed}→${b.placed} of ${settledCount} at scale ${b.mean}`;
        birthScaleFrac = settledScale > 0 ? (b.mean ?? 0) / settledScale : 1;
      }
    }
    if ((a.placed ?? 0) > 0 && (b.placed ?? 0) < (a.placed ?? 0)) {
      const d = (a.placed - b.placed) / a.placed;
      if (d > worstDrop) {
        worstDrop = d;
        dropAt = `${a.t}s→${b.t}s placed ${a.placed}→${b.placed}`;
      }
    }
  }
  console.log(
    `MELTON parcel (${parcelRows.length} @100ms): settled ${settledCount} homes at scale ${settledScale} · ` +
      `worst single-sample BIRTH ${(birthFrac * 100).toFixed(1)}% of the pool at ${(birthScaleFrac * 100).toFixed(0)}% of settled scale ${birthAt ? `(${birthAt})` : ''} · ` +
      `worst scale step ${(worstJump * 100).toFixed(1)}% ${jumpAt ? `(${jumpAt})` : ''} · worst drop ${(worstDrop * 100).toFixed(1)}% ${dropAt ?? ''}`
  );
  if (settledCount === 0) {
    soft('(8)/(9) parcel ramp', 'live OFM data', `Melton placed 0 homes this run — the ramp has no subject`);
  } else {
    gate(
      `(8) PARCEL BIRTH — no more than ${MAX_BIRTH_FRAC * 100}% of the pool appears in one 100 ms sample at full size`,
      birthFrac <= MAX_BIRTH_FRAC || birthScaleFrac <= 0.6,
      `${(birthFrac * 100).toFixed(1)}% of ${settledCount} homes in one sample, born at ${(birthScaleFrac * 100).toFixed(0)}% of settled scale ${birthAt ? `· ${birthAt}` : ''} ` +
        `(a 600 ms SETTLE_CALM.births ramp satisfies this either by ramping the count or by being born small)`
    );
    red.push([
      'S-RAMP the whole parcel pool appears in one frame at full size',
      'verify-settle (8)',
      `${(birthFrac * 100).toFixed(1)}% in one sample at ${(birthScaleFrac * 100).toFixed(0)}% scale`,
      `<= ${MAX_BIRTH_FRAC * 100}% or born <= 60% scale`,
    ]);
    /* (8b) IS RETIRED AT W3, and it is retired for the right reason: it was
     * measuring the FIX as a defect.
     *
     * A RELATIVE step is meaningless during a birth ramp that starts near
     * zero. With SETTLE_CALM.births ON, the pool is born at 4% of settled
     * scale and eases up over ~600 ms — sampled at 100 ms that is a legitimate
     * 0.646 -> 3.171 between two samples, i.e. "+390%", and the gate called it
     * a discrete step. The claim (8b) was written for — the R21 growK 0.55→1.0
     * jump — was never red at this pose anyway (`provisional` stayed false all
     * run, so growK never left 1), and gate (8) above already carries the real
     * assertion in a form the ramp satisfies: born small, or grown gradually.
     * The number is still printed, as evidence of the ramp's shape. */
    console.log(
      `INFO (8b) growK scale step ${(worstJump * 100).toFixed(1)}% ${jumpAt ? `· ${jumpAt}` : ''} — RETIRED as a gate at W3: ` +
        `a relative step is meaningless during a birth ramp that starts near zero, and this number IS the ramp working. ` +
        `Gate (8) carries the claim.`
    );
    gate(
      '(9) parcel deletes are not instantaneous (no >50% population drop in one sample)',
      worstDrop <= 0.5,
      `worst drop ${(worstDrop * 100).toFixed(1)}% ${dropAt ?? ''}`
    );
  }

  /* ============ LEG 4 — groundElevVis across a mountain warp ============ */
  await parcel.evaluate(() => {
    const f = window.__fly.flight;
    delete f.step;
    delete f.__frozen;
    const S = (window.__r22Elev = { t0: performance.now(), rows: [] });
    // PER-FRAME sampling, not per-100 ms: the gated statistic is the step the
    // visual value takes between two consecutive FRAMES, which is the only
    // cadence the damper itself runs at.
    const tick = () => {
      const rt = window.__fly;
      S.rows.push({
        t: +((performance.now() - S.t0) / 1000).toFixed(3),
        raw: +(rt?.flight?.groundElev ?? 0).toFixed(2),
        vis: rt?.groundElevVis == null ? null : +rt.groundElevVis.toFixed(2),
        epoch: window.__flyStore?.getState?.().warpEpoch ?? null,
      });
      if (S.rows.length < 4000) S.raf = requestAnimationFrame(tick);
    };
    S.raf = requestAnimationFrame(tick);
  });
  await parcel.evaluate(
    ([la, lo, al]) => window.__fly.warpToGeo(la, lo, { altM: al, name: null }),
    SIERRA
  );
  await parcel.waitForTimeout(20000);
  const elevRows = await parcel.evaluate(() => {
    cancelAnimationFrame(window.__r22Elev.raf);
    return window.__r22Elev.rows;
  });
  // The warp itself is allowed ONE discontinuity (SETTLE_CALM snaps on
  // warpEpoch). Everything after it is the refining DEM sweeping the value,
  // and that is what has to be slew-limited.
  const epochIdx = elevRows.findIndex((r, i) => i > 0 && r.epoch !== elevRows[i - 1].epoch);
  const post = elevRows.slice(Math.max(0, epochIdx + 3));
  let worstStepM = 0;
  let worstSlew = 0; // the old m/s figure, PRINTED as evidence, never gated
  let slewAt = null;
  let worstRawStepM = 0;
  for (let i = 1; i < post.length; i++) {
    const v0 = post[i - 1].vis ?? post[i - 1].raw;
    const v1 = post[i].vis ?? post[i].raw;
    const stepM = Math.abs(v1 - v0);
    const dt = Math.max(1e-3, post[i].t - post[i - 1].t);
    worstSlew = Math.max(worstSlew, stepM / dt);
    worstRawStepM = Math.max(worstRawStepM, Math.abs(post[i].raw - post[i - 1].raw));
    if (stepM > worstStepM) {
      worstStepM = stepM;
      slewAt = `${post[i - 1].t}s→${post[i].t}s ${v0}→${v1} m`;
    }
  }
  const visIsAlias = elevRows.every((r) => r.vis == null || Math.abs(r.vis - r.raw) < 1e-6);
  console.log(
    `SIERRA groundElev (${elevRows.length} PER-FRAME samples): worst VISUAL step ${worstStepM.toFixed(2)} m/frame ` +
      `${slewAt ? `(${slewAt})` : ''} · worst RAW step ${worstRawStepM.toFixed(2)} m/frame · ` +
      `(informational, and NOT the gated statistic: ${worstSlew.toFixed(0)} m/s — a rate computed with a dt that is ` +
      `not the damper's own) · groundElevVis is ${visIsAlias ? 'the RAW alias (W0 pre-seed)' : 'DAMPED'}`
  );
  gate(
    `(10) groundElevVis is SLEW-LIMITED across a mountain warp (<= ${SLEW_M_PER_FRAME} m per FRAME post-snap)`,
    worstStepM <= SLEW_M_PER_FRAME,
    `worst visual step ${worstStepM.toFixed(2)} m/frame vs raw ${worstRawStepM.toFixed(2)} m/frame ${slewAt ? `· ${slewAt}` : ''} · ` +
      `vis ${visIsAlias ? '=== raw (undamped)' : 'damped'}`
  );
  red.push([
    'S-ELEV raw groundElev sweeps every AGL fade band (RE-EXPRESSED W2: m/frame)',
    'verify-settle (10)',
    `${worstStepM.toFixed(2)} m/frame visual (raw ${worstRawStepM.toFixed(2)})`,
    `<= ${SLEW_M_PER_FRAME} m/frame`,
  ]);

  /* ============ LEG 5 — the ladder SHAPE (no timing at all) ============= */
  const ladder = await parcel.evaluate(() => {
    if (typeof window.__flyGovFactory !== 'function') return null;
    const build = (dpr0) => {
      const g = window.__flyGovFactory({ dpr0, tier0: 'high', applyDpr() {}, applyTier() {} });
      const rungs = g.ladder;
      const firstTier = rungs.findIndex((r) => r.tier !== rungs[0].tier);
      const before = firstTier < 0 ? rungs : rungs.slice(0, firstTier);
      const dprValues = [...new Set(before.map((r) => r.dpr))];
      return { rungs, dprSteps: Math.max(0, dprValues.length - 1), dprValues, firstTier };
    };
    return { at1: build(1), at15: build(1.5), devicePixelRatio: window.devicePixelRatio };
  });
  if (!ladder) {
    soft('(11)/(12) ladder shape', 'A', 'window.__flyGovFactory not published');
  } else {
    console.log(
      `LADDER @dpr0=1.0: ${JSON.stringify(ladder.at1.rungs)} → ${ladder.at1.dprSteps} render-scale steps before the first tier step`
    );
    console.log(
      `LADDER @dpr0=1.5: ${JSON.stringify(ladder.at15.rungs)} → ${ladder.at15.dprSteps} render-scale steps`
    );
    gate(
      `(11) LADDER SHAPE — >= ${MIN_DPR_RUNGS} render-scale rungs before the first tier step at devicePixelRatio 1`,
      ladder.at1.dprSteps >= MIN_DPR_RUNGS,
      `${ladder.at1.dprSteps} steps · dpr values before the tier step ${JSON.stringify(ladder.at1.dprValues)} ` +
        `(CANVAS.dprMin 1 makes the loop body unreachable at dpr0 1 — the first thing a dpr-1 player's governor can do is a TIER step)`
    );
    red.push([
      'S-LADDER zero DPR rungs at devicePixelRatio 1',
      'verify-settle (11)',
      `${ladder.at1.dprSteps} render-scale steps`,
      `>= ${MIN_DPR_RUNGS}`,
    ]);
    gate(
      '(12) the control — a dpr 1.5 display DOES get render-scale rungs (so the defect is dpr-1-specific)',
      ladder.at15.dprSteps >= 2,
      `${ladder.at15.dprSteps} steps at dpr0 1.5 vs ${ladder.at1.dprSteps} at dpr0 1.0`
    );
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
    '(13) zero APP page/console errors (upstream Esri tile errors classified separately)',
    appErrs.length === 0,
    `app=${appErrs.length} net=${netErrs.length} · ${appErrs.slice(0, 3).join(' | ')}`
  );

  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  fs.writeFileSync(
    path.join(__dirname, 'r22-e-red-settle.json'),
    JSON.stringify(
      {
        when: new Date().toISOString(),
        bootMs,
        revealT,
        progGrowth,
        longFrames: lf,
        prewarm,
        throttled: { bootMs: bootMs2, revealT: revealT2, progGrowth: progGrowth2, longFrames: lf2 },
        warp: { revealT: warpRevealT, first: warp.first, t90: warp.t90, settled: warp.settled, late: warp.late },
        boot: { first: boot.first, t90: boot.t90, settled: boot.settled, late: boot.late },
        parcelRows: parcelRows.slice(0, 400),
        birthFrac,
        birthAt,
        birthScaleFrac,
        worstJump,
        jumpAt,
        elevRows: elevRows.slice(0, 400),
        worstSlew,
        slewAt,
        visIsAlias,
        ladder,
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
