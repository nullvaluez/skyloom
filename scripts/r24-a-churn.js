/**
 * ROUND 24 (A "MOTION HOLD") — r24-a-churn: THE DWELL/PENALTY SWEEP PROBE.
 *
 * ===========================================================================
 * THIS IS A PROBE, NOT A GATE — AND IT DELIBERATELY DOES NOT DUPLICATE E
 * ===========================================================================
 * `scripts/verify-motion-hold.js` (E CERT, same round) is the VERDICT-BEARING
 * churn gate: it owns the tile-lifecycle rates, the re-entry census, the
 * content-presence series and the Owens control, and it is what a close sweep
 * reads. Nothing here competes with it. If you want to know whether the world
 * holds, run E's gate.
 *
 * This file answers the two questions E's gate cannot, because a gate is
 * pass/fail at ONE configuration and both of these are curves:
 *
 *   (A) HOW MUCH DWELL IS ENOUGH?  `TILE_HOLD.mergeDwellMs` shipped at 2000 ms
 *       on an argument (a roll reversal is 3.5 s, so 2 s spans the sweep) and
 *       not on a measurement. This probe walks it 0 / 500 / 2000 / 5000 in one
 *       session at one pose and prints churn against each.
 *
 *   (B) WHAT DOES `frustumPenalty` ACTUALLY COST?  Patch #6b ships at 5, i.e.
 *       byte-equivalent to upstream, precisely because nobody has measured the
 *       trade. R24 defers the sweep; THIS is the instrument that un-defers it,
 *       and the reason it is a separate file from E's gate is that the sweep
 *       moves the SETTLED tree and therefore has to be read against the budget
 *       it actually spends. Which is not the one people reach for:
 *
 *         An out-of-frustum tile issues ZERO DRAW CALLS — three culls it. So
 *         the Owens 261 draw ceiling is nearly BLIND to this knob. The binding
 *         budget is verify-aerial's TEXTURE BYTES gate (300 MB; R22.1 measured
 *         61 MB, so there is ~5x headroom) plus resident triangles and
 *         gpuFrameMs. A sweep graded on draws would report "free" and ship a
 *         memory regression.
 *
 * THE MEASUREMENT THAT MAKES BOTH LEGIBLE is the LEAF-ZOOM CENSUS —
 * `__flyTileHold.census()`, which counts resident LEAVES by zoom. That is the
 * one read where the defect is directly visible rather than inferred: the
 * frustum rule holds off-camera ground a constant log2(5/0.8) = 2.64 levels
 * coarser than on-camera ground, so a collapsing tree shows a histogram whose
 * mass slides down two-to-three z-levels during a turn and climbs back after.
 *
 * ===========================================================================
 * PREDICTED REDS (what this SHOULD print on the pre-R24 tree)
 * ===========================================================================
 * From `scripts/r22p1-b-stutter.md` §2.3 (2,123 DEM builds / 22 s serpentine)
 * and `scripts/r22p1-close.md` §1.2 gate (6) (223 resident tiles):
 *
 *     leg          tile unloads/s     DEM builds/s     expectation
 *     frozen              ~0                ~0         nothing moves
 *     straight            5-10             5-10        transport-limited
 *     serpentine        >> 20            90-100        THE DEFECT
 *
 * The serpentine/straight RATIO is the statistic, not either number alone: it
 * is machine-independent in a way neither absolute is, and it is what a fix has
 * to move. Dwell 0 reproduces the R22.1 tree exactly.
 *
 * ===========================================================================
 * EXIT CODES: 0 = PASS · 1 = FAIL · 2 = BLOCKED
 * ===========================================================================
 * BLOCKED is the honest outcome anywhere the tile hosts are unreachable or the
 * renderer cannot sustain the fps floor — and it is the outcome on the machine
 * this round was built on, where both Esri hosts and OpenFreeMap answer 403 to
 * CONNECT. A sweep script must read exit 2 as NOT RUN, never as green. The
 * grading here is deliberately weak (this is a probe): it asserts only that the
 * instruments MOVED and that the armed arm is not WORSE than the off arm. The
 * numbers are the deliverable; a human reads the table.
 *
 * RUN: node scripts/r24-a-churn.js          (needs the dev server on :3019)
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly, unpinPins } = require('./_boot');

let W = null;
try {
  W = require('./_world-precondition');
} catch {
  /* E's helper may not be committed yet — the inline fallback below covers it */
}

/** The user's recorded pose (r22p1-b-stutter.md §2.1): Powell OH, low, fast. */
const POWELL = [40.1592, -83.0752, 233];
const SPEED = 180; // m/s — the b-stutter DRIVE speed, kept identical
const LEG_MS = 25000;
const OUT = path.resolve(__dirname, '.probe-r24-a-churn.json');

/* ── the serpentine, lifted verbatim from verify-frame-pace's DRIVE ───────────
 * Wrapping `flight.step` rather than plumbing input keeps verify-feel's frozen
 * input contract untouched, and it is the pose the defect was recorded on. */
const DRIVE = ([speed, agl]) => {
  const f = window.__fly.flight;
  if (f.__r24drive) return;
  f.__r24drive = true;
  const orig = f.step.bind(f);
  let t = 0;
  f.step = (dt, cmd) => {
    t += dt;
    const turn = Math.sin((t * 2 * Math.PI) / 7); // full roll reversal every 3.5 s
    const pitch = (agl - (f.pos.y - (f.groundElev ?? 0))) * 0.002;
    orig(dt, { ...cmd, turn, pitch, boost: false, speedPreset: 'cruise', speedOverride: speed });
  };
};
const STRAIGHT = ([speed, agl]) => {
  const f = window.__fly.flight;
  if (f.__r24drive) return;
  f.__r24drive = true;
  const orig = f.step.bind(f);
  f.step = (dt, cmd) => {
    const pitch = (agl - (f.pos.y - (f.groundElev ?? 0))) * 0.002;
    orig(dt, { ...cmd, turn: 0, pitch, boost: false, speedPreset: 'cruise', speedOverride: speed });
  };
};
const UNDRIVE = () => {
  const f = window.__fly.flight;
  delete f.step;
  delete f.__r24drive;
};
const FREEZE = () => {
  const f = window.__fly.flight;
  f.__frozen = true;
  f.step = () => {};
};

/**
 * The lifecycle counter. three-tile dispatches `tile-loaded` / `tile-unload` on
 * the root tile and re-dispatches on the map (index.js `attachEvent`), so this
 * needs NO vendored edit — it is the library's own vocabulary.
 */
const ARM_COUNTERS = () => {
  const m = window.__fly.engine.map;
  if (m.__r24armed) {
    Object.assign(m.__r24counts, { load: 0, unload: 0, t0: performance.now() });
    return;
  }
  m.__r24armed = true;
  m.__r24counts = { load: 0, unload: 0, t0: performance.now() };
  m.addEventListener('tile-loaded', () => m.__r24counts.load++);
  m.addEventListener('tile-unload', () => m.__r24counts.unload++);
  // A frame counter of our own. `__flyStats` publishes draws and triangles but
  // NOT a frame count (FlyScene.jsx:2428 samples every 60th frame and never
  // exports the tally), and E's `checkMachineHonesty` needs frames — without
  // this the fps term is 0 and every run BLOCKS, including a good one.
  window.__r24frames = 0;
  const tick = () => {
    window.__r24frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const SAMPLE = () => {
  const rt = window.__fly;
  const m = rt.engine.map;
  const c = m.__r24counts;
  const secs = Math.max(0.001, (performance.now() - c.t0) / 1000);
  const census = window.__flyTileHold?.census?.() ?? null;
  const skirt = window.__flyStats?.pace?.skirt ?? null;
  const hold = window.__flyStats?.tileHold ?? null;
  return {
    secs: +secs.toFixed(2),
    loadsPerSec: +(c.load / secs).toFixed(2),
    unloadsPerSec: +(c.unload / secs).toFixed(2),
    demBuilds: skirt ? skirt.fast + skirt.bail + skirt.upstream : null,
    census,
    dwellHeld: hold?.hold?.dwellHeld ?? null,
    dwellFired: hold?.hold?.dwellFired ?? null,
    frames: window.__r24frames ?? 0,
    draws: window.__flyStats?.drawCalls ?? null,
    tris: window.__flyStats?.triangles ?? null,
    // Texture BYTES are deliberately not read here: this app publishes no
    // renderer handle on the runtime, and the fleet already owns that
    // instrument in `verify-aerial` (the 300 MB gate). A frustumPenalty sweep
    // is graded THERE, not from a second, worse copy of the measurement.
    pos: rt.flight ? { x: Math.round(rt.flight.pos.x), z: Math.round(rt.flight.pos.z) } : null,
    on: hold?.on ?? null,
    mergeDwellMs: hold?.mergeDwellMs ?? null,
    frustumPenalty: hold?.frustumPenalty ?? null,
  };
};

(async () => {
  const rows = [];
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const net = W ? W.wireWorldTally(page) : { img: 0, imgFail: 0, vec: 0, vecFail: 0, hosts: new Set() };
  if (!W) {
    // Inline fallback, same classification as E's helper, so this file can run
    // before that helper lands. Behaviour identical; the prose lives there.
    page.on('response', (r) => {
      const u = r.url();
      const k = /World_Imagery|Terrain3D|arcgisonline|elevation3d/.test(u)
        ? 'img'
        : /openfreemap|\.pbf(\?|$)/.test(u)
          ? 'vec'
          : null;
      if (!k) return;
      r.status() >= 200 && r.status() < 300 ? net[k]++ : net[`${k}Fail`]++;
    });
    page.on('requestfailed', (r) => {
      const u = r.url();
      if (/World_Imagery|Terrain3D|arcgisonline|elevation3d/.test(u)) net.imgFail++;
      else if (/openfreemap|\.pbf(\?|$)/.test(u)) net.vecFail++;
      try {
        net.hosts.add(new URL(u).host);
      } catch {
        /* the count is what matters */
      }
    });
  }

  // Un-pin the terra family (TILE_HOLD rides `__flyTerraPin` — see
  // tileHoldOn()) plus the governor, so a mid-run tier step cannot rebuild the
  // world underneath a churn measurement.
  await page.addInitScript(unpinPins, ['__flyTerraPin', '__flySettlePin', '__flyClutterPin']);
  await page.addInitScript(() => {
    window.__r22Unpinned = { __flyTerraPin: 0, __flySettlePin: 0, __flyClutterPin: 0 };
    window.__flyGovPin = 'hold';
    window.__flyWeatherOverride = 'baseline';
  });
  await bootFly(page, { style: 'satellite' });
  await page.evaluate(([lat, lon, altM]) => window.__fly.warpToGeo(lat, lon, { altM, name: null }), POWELL);
  await page.waitForTimeout(9000); // let the destination descend before measuring

  /** One arm: set the knobs, re-arm the counters, drive, sample. */
  const leg = async (label, { dwell, penalty, mode }) => {
    await page.evaluate(UNDRIVE);
    await page.evaluate(
      ([d, p]) => {
        window.__flyTileHold.set(true);
        window.__flyTileHold.dwell(d);
        if (p != null) window.__flyPenaltyRequested = p;
      },
      [dwell, penalty]
    );
    // frustumPenalty has no live setter by design (it is not a taste knob), so
    // an arm that asks for a non-default value is reported as REQUESTED and
    // skipped rather than silently measured at 5. Sweeping it means editing
    // TILE_HOLD.frustumPenalty and re-running — which is the point: a knob that
    // moves the settled tree should not be flippable from a probe.
    await page.evaluate(ARM_COUNTERS);
    await page.evaluate(mode === 'serpentine' ? DRIVE : mode === 'straight' ? STRAIGHT : FREEZE, [
      SPEED,
      POWELL[2],
    ]);
    const t0 = Date.now();
    const p0 = await page.evaluate(SAMPLE);
    await page.waitForTimeout(LEG_MS);
    const s = await page.evaluate(SAMPLE);
    s.label = label;
    s.mode = mode;
    s.wallMs = Date.now() - t0;
    // Per-leg deltas: the counters are cumulative from arm time, and E's
    // machine-honesty check is about THIS leg's frames, not the session's.
    s.framesDelta = (s.frames ?? 0) - (p0.frames ?? 0);
    s.distanceM =
      p0.pos && s.pos ? Math.hypot(s.pos.x - p0.pos.x, s.pos.z - p0.pos.z) : 0;
    s.penaltyRequested = penalty ?? null;
    rows.push(s);
    console.log(
      `LEG ${label.padEnd(22)} unloads/s ${String(s.unloadsPerSec).padStart(7)} · ` +
        `loads/s ${String(s.loadsPerSec).padStart(7)} · maxLeafZ ${s.census?.maxLeafZ} · ` +
        `leaves ${s.census?.leaves} · dwellHeld ${s.dwellHeld} · ` +
        `moved ${Math.round(s.distanceM)} m`
    );
    if (s.census) console.log(`     leaves by z: ${JSON.stringify(s.census.byZ)}`);
    return s;
  };

  const frozen = await leg('frozen (control)', { dwell: 2000, mode: 'frozen' });
  await page.evaluate(UNDRIVE);
  await page.evaluate(() => {
    const f = window.__fly.flight;
    delete f.__frozen;
  });

  const straightOff = await leg('straight dwell=0', { dwell: 0, mode: 'straight' });
  const serpOff = await leg('serpentine dwell=0', { dwell: 0, mode: 'serpentine' });
  const serp500 = await leg('serpentine dwell=500', { dwell: 500, mode: 'serpentine' });
  const serp2000 = await leg('serpentine dwell=2000', { dwell: 2000, mode: 'serpentine' });
  const serp5000 = await leg('serpentine dwell=5000', { dwell: 5000, mode: 'serpentine' });

  /* ── preconditions, AFTER the run so the numbers are on record either way ── */
  const resident = (frozen.census?.leaves ?? 0) > 0;
  const world = W
    ? W.checkWorldContent(net, { resident })
    : { ok: resident || (net.img > 0 && net.vec > 0), report: `WORLD img=${net.img} vec=${net.vec} resident=${resident}` };
  fs.writeFileSync(OUT, JSON.stringify({ rows, net: { ...net, hosts: [...net.hosts] } }, null, 2));
  console.log(`\nevidence → ${OUT}`);

  if (!world.ok) {
    if (W) return W.exitBlocked(world.report, { browser, label: 'tile hosts unreachable' });
    console.log(world.report);
    console.log('VERIFY: BLOCKED (tile hosts unreachable — gates not evaluated)');
    await browser.close();
    process.exit(2);
  }
  const machine = W
    ? W.checkMachineHonesty({
        frames: serpOff.framesDelta ?? 0,
        wallMs: serpOff.wallMs,
        distanceM: serpOff.distanceM,
        speedMs: SPEED,
      })
    : { ok: serpOff.distanceM >= 3000, report: `MACHINE moved ${Math.round(serpOff.distanceM)} m` };
  if (!machine.ok) {
    if (W) return W.exitBlocked(machine.report, { browser, label: 'machine cannot grade a motion leg' });
    console.log(machine.report);
    console.log('VERIFY: BLOCKED (machine cannot grade a motion leg)');
    await browser.close();
    process.exit(2);
  }

  /* ── the (weak, deliberate) grading ─────────────────────────────────────── */
  const fails = [];
  const gate = (n, ok, d) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} (${n}) ${d}`);
    if (!ok) fails.push(n);
  };
  const ratio = straightOff.unloadsPerSec > 0 ? serpOff.unloadsPerSec / straightOff.unloadsPerSec : 0;
  gate(
    1,
    frozen.unloadsPerSec < 1,
    `FROZEN CONTROL — a still camera churns nothing: ${frozen.unloadsPerSec}/s`
  );
  gate(
    2,
    serpOff.unloadsPerSec > 0 || straightOff.unloadsPerSec > 0,
    `THE INSTRUMENT MOVED — straight ${straightOff.unloadsPerSec}/s, serpentine ${serpOff.unloadsPerSec}/s (ratio ${ratio.toFixed(2)}x)`
  );
  gate(
    3,
    serp2000.dwellHeld > 0,
    `THE DWELL WAS EXERCISED, not merely armed — dwellHeld ${serp2000.dwellHeld}, dwellFired ${serp2000.dwellFired}`
  );
  gate(
    4,
    serp2000.unloadsPerSec <= serpOff.unloadsPerSec * 1.05,
    `ARMED IS NOT WORSE — dwell 2000 ${serp2000.unloadsPerSec}/s vs dwell 0 ${serpOff.unloadsPerSec}/s`
  );

  console.log('\nSWEEP (the deliverable — a human reads this table):');
  console.log('  dwell(ms)   unloads/s   loads/s   maxLeafZ   leaves   held');
  for (const r of [serpOff, serp500, serp2000, serp5000])
    console.log(
      `  ${String(r.mergeDwellMs).padStart(8)}   ${String(r.unloadsPerSec).padStart(9)}   ` +
        `${String(r.loadsPerSec).padStart(7)}   ${String(r.census?.maxLeafZ).padStart(8)}   ` +
        `${String(r.census?.leaves).padStart(6)}   ${String(r.dwellHeld).padStart(4)}`
    );
  console.log(
    '\nfrustumPenalty is NOT swept from here by design — it moves the settled\n' +
      'tree, so it is swept by editing TILE_HOLD.frustumPenalty (5 → 3 → 2 → 1.6)\n' +
      'and re-running, read against verify-aerial texture bytes + gpuFrameMs and\n' +
      'NOT against the Owens draw ceiling, which an out-of-frustum tile does not\n' +
      'touch. Requested-but-not-applied this run: ' +
      JSON.stringify(rows.map((r) => r.penaltyRequested).filter(Boolean))
  );

  await browser.close();
  console.log(fails.length ? 'VERIFY: FAIL' : 'VERIFY: PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('VERIFY: FAIL — probe threw:', e);
  process.exit(1);
});
