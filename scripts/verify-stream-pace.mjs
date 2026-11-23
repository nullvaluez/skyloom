/**
 * STREAM PACE (FLY_HORIZON_FILL.md "Third round", stream P) gate.
 *
 *   node scripts/verify-stream-pace.mjs            (parts 1, 2 and the fixture leg of 3)
 *   node scripts/verify-stream-pace.mjs --owner    (also the owner's leg, from the local tile cache)
 *   node scripts/verify-stream-pace.mjs --no-bench (parts 1 and 2 only)
 *
 * No GPU, no network. Three parts:
 *
 *  1. THE LAW as a pure function (lib/fly/stream-pace.js createPaceLaw) under
 *     synthetic frame streams: steady 60 Hz with headroom stays at exactly 1;
 *     sustained late frames fall to the floor and no lower; recovery; a single
 *     stall is ignored; a GPU-bound late frame (little CPU work) does not move
 *     it; no oscillation against a stepping quality-governor model; the hold
 *     after a reveal and after a warp; the curtain factor, its frame ceiling
 *     and its ramp; never above 1 in flight; the sub-switches.
 *  2. OFF IS A NO-OP: the block ships `enabled:false`; with the flag off
 *     paceK() and budgetK() are exactly 1 (and exactly the harness factor
 *     under a harness) and a step does nothing; the rig mounts only behind
 *     streamPaceOn(). With the flag on (a child process, the pin set before
 *     import): budgetK() = harness factor x k, the harness clamp keeps its
 *     meaning, the shared finalize allowance follows, and the turn budget
 *     cannot take it below the floor.
 *  3. THE REAL ENGINES, flown by scripts/bench-flight-cpu.mjs in a child
 *     process per arm with the same instrument in both: a synthetic render
 *     cost (STREAM_PACE_RENDER_MS, 15 ms) is added to each frame's measured
 *     main-thread work, the sum is the frame's work and its vsync interval
 *     (display 60 Hz), and that is fed to the live law once a frame, before
 *     the engines step. The settle phase is under the curtain, the flight and
 *     the tail after the reveal.
 *     a. The committed Powell pack, the leg scripts/verify-flight-cpu.mjs
 *        flies, on the virtual clock (`--exact`): every chunk still arrives
 *        and the final state is byte-identical to the off arm. (Little
 *        streams in this leg's flight; it is the identity leg.)
 *     b. --owner: the owner's Argenteuil leg, every engine, full rings, from
 *        the local tile cache. Virtual clock: chunk counts, and identity
 *        engine by engine against a control arm (a constant x2 scale, no
 *        law) that shows which engines' settled state depends on pacing at
 *        all. Real clock: frames over the display interval fall with the
 *        scale on (asserted with a quarter's margin), and the table says how
 *        much later things arrive.
 *
 * WHAT PART 3 DOES AND DOES NOT SHOW. The bench's virtual time advances one
 * 60 Hz frame per frame whatever the modelled interval is, so worker results
 * do not arrive later when a frame is late: arrival is counted in FRAMES, and
 * "frames over the display interval" is the modelled count, not a browser's.
 * On the virtual clock a frame's work is the engines' virtual time (4 us per
 * performance.now() call), so it measures how much of each allowance a frame
 * spends, not what that costs on a real CPU. No GPU, no upload, no draw.
 *
 * Prints PASS / FAIL lines and the table; exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { spawnSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const PACK = 'scripts/fixtures/horizon-fill/flight-powell.pack.gz';
const DISPLAY_MS = 1000 / 60;
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// Extensionless and @/ specifiers (the app's modules), as the other node gates do.
const probe = (base) => {
  for (const ext of ['', '.js', '.mjs', '/index.js']) {
    const p = base + ext;
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return pathToFileURL(p).href;
    } catch {
      /* next */
    }
  }
  return null;
};
const installHooks = () =>
  registerHooks({
    resolve(spec, ctx, next) {
      if (spec.startsWith('@/')) {
        const u = probe(path.join(ROOT, spec.slice(2)));
        if (u) return { url: u, shortCircuit: true };
      }
      if (/^\.{1,2}\//.test(spec) && ctx.parentURL?.startsWith('file:')) {
        const base = fileURLToPath(new URL(spec, ctx.parentURL));
        if (!(fs.existsSync(base) && fs.statSync(base).isFile())) {
          const u = probe(base);
          if (u) return { url: u, shortCircuit: true };
        }
      }
      return next(spec, ctx);
    },
  });

const mode = process.argv[2];

// ============================================================================
// CHILD: the flag-on module contract (part 2b)
// ============================================================================
if (mode === '--child-on') {
  installHooks();
  globalThis.window = { __flyStreamPaceOverride: { enabled: true }, location: { search: '' } };
  const sp = await imp('lib/fly/stream-pace.js');
  const hb = await imp('lib/fly/harness-budget.js');
  const fp = await imp('lib/fly/finalize-pace.js');
  const out = { on: sp.STREAM_PACE_ON, flight: sp.streamPaceOn('flight'), curtain: sp.streamPaceOn('curtain') };
  const step = (n, inp) => {
    for (let i = 0; i < n; i++) sp.stepStreamPace(inp);
  };
  // drive k to the floor: late, busy frames after the post-start hold
  step(600, { dtMs: 33.4, workMs: 20, targetMs: DISPLAY_MS, sample: true, curtain: false, epoch: 0, bootDone: true });
  out.kFloor = sp.paceK();
  out.budgetKFloor = hb.budgetK();
  window.__flyFinalizeBudgetK = 40;
  out.budgetKFloorH40 = hb.budgetK();
  window.__flyFinalizeBudgetK = 0.5; // a harness may not tighten: reads as 1
  out.budgetKFloorHHalf = hb.budgetK();
  delete window.__flyFinalizeBudgetK;
  fp.resetFinalizePace();
  // resetFinalizePace clears the turn floor; the next pace step sets it again
  sp.stepStreamPace({ dtMs: 33.4, workMs: 20, targetMs: DISPLAY_MS, sample: true, curtain: false, epoch: 0, bootDone: true });
  fp.noteFinalizeFrame(1 / 60);
  out.finalizeLeft = fp.budgetLeftMs();
  fp.setTurnBudgetK(0.5);
  out.finalizeLeftTurn = fp.budgetLeftMs();
  fp.setTurnBudgetK(1);
  // the curtain
  // A warp curtain (epoch 1) on frames under every ceiling: the full factor.
  step(120, { dtMs: DISPLAY_MS, workMs: 10, targetMs: DISPLAY_MS, sample: true, curtain: true, epoch: 1, bootDone: true });
  out.kCurtain = sp.paceK();
  out.budgetKCurtain = hb.budgetK();
  out.stats = sp.streamPaceStats();
  sp.resetStreamPace();
  out.kAfterReset = sp.paceK();
  out.budgetKAfterReset = hb.budgetK();
  console.log(`@@${JSON.stringify(out)}`);
  process.exit(0);
}

// ============================================================================
// CHILD: one bench arm (part 3)
// ============================================================================
if (mode === '--bench') {
  const arm = process.argv[3]; // 'off' | 'on' | 'k<scale>' (a constant scale, flag off: a control for history dependence)
  const constK = /^k[\d.]+$/.test(arm) ? Number(arm.slice(1)) : null;
  const exact = process.argv[4] === 'exact';
  const renderMs = Number(process.argv[5]);
  const leg = process.argv[6] ?? 'fixture'; // 'fixture' (the committed pack) | 'owner' (the cached tiles)
  const label = `stream-pace-${leg}-${exact ? 'x' : 't'}-${arm}`;
  process.env.FLIGHT_CPU_LIB = '1';
  const benchMod = await imp('scripts/bench-flight-cpu.mjs'); // installs its own module hooks
  // The pin must be in place before stream-pace is first imported (it latches),
  // and runFlight replaces window afterwards (the module has already latched).
  globalThis.window = { location: { search: '' } };
  if (arm === 'on') globalThis.window.__flyStreamPaceOverride = { enabled: true };
  else globalThis.window.__flyStreamPaceOverride = { enabled: false };
  const sp = await imp('lib/fly/stream-pace.js');
  const hbc = await imp('lib/fly/harness-budget.js');

  // Phase, from the bench's own log line (the flight starts right after it).
  let phase = 'settle';
  let flightFrames = 0;
  const SECONDS = leg === 'owner' ? 20 : 12;
  const realLog = console.log;
  console.log = (...a) => {
    if (typeof a[0] === 'string' && a[0].startsWith('settled the start')) phase = 'flight';
  };

  // Frame boundaries: the bench reads v8.getHeapStatistics() exactly twice a
  // frame, at its start (before f0) and at its end (after the frame's work).
  const perf = globalThis.performance;
  const orig = perf.now.bind(perf);
  let cur = orig;
  let patched = false;
  let first = null;
  let last = 0;
  const wrapper = () => {
    const v = cur();
    last = v;
    if (first === null) first = v;
    return v;
  };
  // --exact assigns performance.now; read the virtual work off it without calling it.
  Object.defineProperty(perf, 'now', {
    configurable: true,
    get: () => (patched ? wrapper : orig),
    set: (fn) => {
      cur = fn;
      patched = true;
    },
  });
  const origHeap = v8.getHeapStatistics;
  let calls = 0;
  let t0 = 0;
  let prevWork = null;
  const frames = []; // per frame: phase, work, total, k
  const inp = { dtMs: DISPLAY_MS, workMs: undefined, targetMs: DISPLAY_MS, sample: true, curtain: true, epoch: 0, bootDone: false };
  let curPhase = 'settle';
  let curK = 1;
  v8.getHeapStatistics = function heapHook() {
    const odd = calls++ % 2 === 0;
    if (odd) {
      // frame start: feed the law the PREVIOUS frame, before this frame's engines step
      if (phase === 'flight') {
        flightFrames++;
        if (flightFrames > SECONDS * 60) phase = 'tail';
      }
      curPhase = phase;
      if (prevWork != null) {
        const total = prevWork + renderMs;
        inp.dtMs = total <= DISPLAY_MS ? DISPLAY_MS : Math.ceil(total / DISPLAY_MS - 1e-9) * DISPLAY_MS;
        inp.workMs = total;
      }
      inp.curtain = curPhase === 'settle';
      inp.bootDone = curPhase !== 'settle';
      curK = sp.stepStreamPace(inp);
      if (constK != null) {
        hbc.setStreamPaceK(constK);
        curK = constK;
      }
      first = null;
      t0 = orig();
    } else {
      const work = patched ? (first === null ? 0 : last - first) : orig() - t0;
      prevWork = work;
      frames.push({ ph: curPhase[0], w: +work.toFixed(4), k: +curK.toFixed(4) });
    }
    return origHeap.call(v8);
  };

  // Both arms pin the settle rules on (they ship off; STREAM_PACE turns them
  // on in the app): with them the settled world does not depend on the pace.
  const report = await benchMod.runFlight(
    leg === 'owner'
      ? // the bench's own default: the owner's Argenteuil leg, every engine, full rings
        { arm: 'on', label, route: 'owner', seconds: SECONDS, settleMax: 90, tailMax: 90, tailMin: 15, offline: true, pack: null, threads: 4,
          engines: ['buildings', 'skyline', 'veg', 'roads', 'clutter'], quiet: false, exact, groundUs: 2, settle: 'on' }
      : // scripts/verify-flight-cpu.mjs's leg on the committed pack
        { arm: 'on', label, route: 'fixture', seconds: SECONDS, settleMax: 40, tailMax: 90, tailMin: 6, offline: true, pack: PACK, threads: 4,
          engines: ['buildings', 'skyline'], quiet: false, exact, groundUs: 2, buildingChunks: 4, skylineChunks: 2, settle: 'on' }
  );
  console.log = realLog;
  const summary = {
    arm,
    exact,
    renderMs,
    on: sp.STREAM_PACE_ON,
    settleSec: report.settleSec,
    tailSec: report.tailSec,
    settledEnd: report.settledEnd,
    final: { hash: report.final.hash, per: Object.fromEntries(Object.entries(report.final.per).map(([k, v]) => [k, { hash: v.hash, chunks: v.chunks, meshes: v.meshes }])) },
    engines: report.engines,
    ready: report.series.map((f) => f.r),
    frames,
    stats: sp.streamPaceStats(),
  };
  fs.writeFileSync(path.join(ROOT, '.graphics-review/flight-cpu', label, 'stream-pace.json'), JSON.stringify(summary));
  realLog(`@@${label}`);
  process.exit(0);
}

// ============================================================================
// PARENT
// ============================================================================
installHooks();
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : x);

const { STREAM_PACE, PERF_GOVERNOR } = await imp('lib/fly/fly-constants.js');
const sp = await imp('lib/fly/stream-pace.js');
const hb = await imp('lib/fly/harness-budget.js');
const F = STREAM_PACE.flightLaw;
const C = STREAM_PACE.curtainLaw;
const onCfg = (extra = {}) => sp.paceLawConfig({ ...STREAM_PACE, enabled: true, ...extra }, PERF_GOVERNOR);

console.log('verify-stream-pace: one shared scale on every streaming allowance (STREAM_PACE, ships off)\n');

// --- 1. the law ------------------------------------------------------------------
/** Run a law over `sec` seconds of frames from gen(t) -> {dtMs, workMs, ...}; returns the k trace. */
const run = (law, sec, gen, base = {}) => {
  const ks = [];
  let t = 0;
  while (t < sec) {
    const f = gen(t);
    const inp = { targetMs: DISPLAY_MS, sample: true, curtain: false, epoch: 0, bootDone: true, ...base, ...f };
    const k = law.step(inp);
    ks.push({ t, k, dt: inp.dtMs });
    t += inp.dtMs / 1000;
  }
  return ks;
};
const minK = (ks) => Math.min(...ks.map((x) => x.k));
const maxK = (ks) => Math.max(...ks.map((x) => x.k));
const steady = () => ({ dtMs: DISPLAY_MS, workMs: 6 });
const late = () => ({ dtMs: 2 * DISPLAY_MS, workMs: 20 });

{
  const law = sp.createPaceLaw(onCfg());
  const ks = run(law, 60, steady);
  check('steady 60 Hz with headroom stays at exactly 1', ks.every((x) => x.k === 1), `60 s, min ${minK(ks)}`);
}
{
  // Busy but on time (work 14 ms of 16.7, vsync-locked): not late, no pressure.
  const law = sp.createPaceLaw(onCfg());
  const ks = run(law, 30, () => ({ dtMs: DISPLAY_MS, workMs: 14 }));
  check('a busy frame that is on time does not move it', ks.every((x) => x.k === 1), `work 14 ms at 60 Hz, min ${minK(ks)}`);
}
let tFloor = null;
{
  const law = sp.createPaceLaw(onCfg());
  const ks = run(law, 30, late);
  const reach = ks.find((x) => x.k <= F.floor + 1e-12);
  tFloor = reach?.t;
  check('sustained late frames fall to the floor and no lower', minK(ks) === F.floor && ks.at(-1).k === F.floor && ks.every((x) => x.k >= F.floor),
    `30 Hz with 20 ms of work: floor ${F.floor} reached after ${r3(reach?.t)} s, min ${minK(ks)}`);
  check('the fall begins only after the pressure dwell', ks.filter((x) => x.t + x.dt / 1000 < F.downHoldSec - 1e-6).every((x) => x.k === 1), `k = 1 for the first ${F.downHoldSec} s`);
}
{
  const law = sp.createPaceLaw(onCfg());
  run(law, 10, late);
  const rec = run(law, 40, steady);
  const r09 = rec.find((x) => x.k >= 1 - F.ceilMargin - 1e-9);
  const r1 = rec.find((x) => x.k === 1);
  check('recovery: headroom brings it back to 1', r1 != null && rec.at(-1).k === 1, `to ${1 - F.ceilMargin} after ${r3(r09?.t)} s, to 1 after ${r3(r1?.t)} s (memory ${F.memorySec} s)`);
  check('the rise is rate limited', rec.every((x, i) => i === 0 || x.k - rec[i - 1].k <= F.risePerSec * (x.dt / 1000) + 1e-12), `<= ${F.risePerSec} per second`);
}
{
  // One 300 ms hitch, one 60 ms frame, and a burst of three 45 ms frames, amid steady frames.
  const law = sp.createPaceLaw(onCfg());
  let n = 0;
  const ks = run(law, 20, () => {
    n++;
    if (n === 300) return { dtMs: 300, workMs: 280 };
    if (n === 600) return { dtMs: 60, workMs: 50 };
    if (n >= 900 && n < 903) return { dtMs: 45, workMs: 30 };
    return steady();
  });
  check('a single stall is not a trend (300 ms, 60 ms, three 45 ms frames)', ks.every((x) => x.k === 1), `min ${minK(ks)}`);
}
{
  const law = sp.createPaceLaw(onCfg());
  const ks = run(law, 30, () => ({ dtMs: 2 * DISPLAY_MS, workMs: 4 }));
  check('a GPU-bound late frame (4 ms of work) does not move it', ks.every((x) => x.k === 1), `min ${minK(ks)}`);
  const law2 = sp.createPaceLaw(onCfg());
  const ks2 = run(law2, 10, () => ({ dtMs: 2 * DISPLAY_MS, workMs: undefined }));
  check('with no work measurement (PACE_ADAPT off) the interval alone decides', minK(ks2) === F.floor, `min ${minK(ks2)}`);
}
{
  const law = sp.createPaceLaw(onCfg());
  let n = 0;
  const ks = run(law, 20, () => (++n % 2 ? late() : steady()), {});
  check('never above 1 in flight', maxK(ks) <= 1, `max ${maxK(ks)}`);
  const menu = sp.createPaceLaw(onCfg());
  const km = run(menu, 20, late, { sample: false });
  check('a frame the governor does not sample (a menu, a hidden page) does not move it', km.every((x) => x.k === 1), `min ${minK(km)}`);
  // A menu opened while the scale is at the floor: it recovers during the
  // pause instead of holding the floor until the menu closes.
  const paused = sp.createPaceLaw(onCfg());
  const down = run(paused, 12, late, {});
  const during = run(paused, 12, late, { sample: false });
  check('a scale at the floor recovers while a menu is open, and late frames in the menu cannot lower it', minK(down) === F.floor && during.at(-1).k === 1 && during.every((x, i) => i === 0 || x.k >= during[i - 1].k), `floor ${minK(down)}, after the pause ${during.at(-1).k}`);
}

// Against a stepping quality governor. CPU and GPU are pipelined: the
// interval is the slower of the two, on vsync. The CPU frame is 4 ms plus a
// streaming backlog of 9 ms x k; the GPU cost falls one rung per governor
// step (24, 20, 15, 12 ms) and rises back on a step up. The governor model is
// PERF_GOVERNOR's own rule: EMA fps (tau emaTauSec) under downFrac x 60 for
// downHoldSec steps down, over upFrac x 60 for upHoldSecDpr steps up,
// cooldownSecDpr between steps, and its session latch (a re-descent within
// latchWindowSec of an ascent stops further ascents).
const govSim = (paceOn, sec, gpu = [24, 20, 15, 12], cpuBase = 4, stream = 9) => {
  const law = paceOn ? sp.createPaceLaw(onCfg()) : null;
  const G = PERF_GOVERNOR;
  let rung = 0;
  let ema = 0;
  let below = null;
  let above = null;
  let lastStep = -1e9;
  let lastUp = -1e9;
  let latched = false;
  let t = 0;
  let k = 1;
  let steps = 0;
  let over = 0;
  let frames = 0;
  let falls = 0;
  let prevDir = 0;
  let reversals = 0;
  const trace = [];
  while (t < sec) {
    const cpu = cpuBase + stream * k;
    const g = gpu[rung];
    const total = Math.max(cpu, g);
    const dtMs = total <= DISPLAY_MS ? DISPLAY_MS : Math.ceil(total / DISPLAY_MS - 1e-9) * DISPLAY_MS;
    const dt = dtMs / 1000;
    t += dt;
    frames++;
    if (total > DISPLAY_MS) over++;
    const a = 1 - Math.exp(-dt / G.emaTauSec);
    ema = ema > 0 ? ema + (dt - ema) * a : dt;
    const fps = 1 / ema;
    if (t - lastStep >= G.cooldownSecDpr) {
      if (fps < G.downFrac * 60) {
        above = null;
        below ??= t;
        if (t - below >= G.downHoldSec && rung < gpu.length - 1) {
          rung++;
          steps++;
          if (t - lastUp < G.latchWindowSec) latched = true;
          lastStep = t;
          below = null;
        }
      } else if (fps > G.upFrac * 60) {
        below = null;
        above ??= t;
        if (t - above >= G.upHoldSecDpr && rung > 0 && !latched) {
          rung--;
          steps++;
          lastUp = t;
          lastStep = t;
          above = null;
        }
      } else {
        below = null;
        above = null;
      }
    }
    if (law) {
      const before = k;
      k = law.step({ dtMs, workMs: cpu, targetMs: DISPLAY_MS, sample: true, curtain: false, epoch: 0, bootDone: true });
      const dir = Math.sign(k - before);
      if (dir !== 0 && prevDir !== 0 && dir !== prevDir) reversals++;
      if (dir !== 0) prevDir = dir;
    }
    trace.push({ t, k });
  }
  if (law) falls = law.stats.falls;
  // The steady state: k's range over the last two thirds of the run.
  const tail = trace.filter((x) => x.t > sec / 3).map((x) => x.k);
  return { steps, over, frames, falls, reversals, rung, k, minK: Math.min(...trace.map((x) => x.k)), range: Math.max(...tail) - Math.min(...tail) };
};
let govRows = [];
{
  const SEC = 180;
  const off = govSim(false, SEC);
  const on = govSim(true, SEC);
  govRows = [off, on];
  // No oscillation: at most one fall per memory hold (the probe), a steady
  // state that moves within two ceiling margins (plus the rate step), and no
  // more governor steps than without the scale.
  const fallsBound = Math.floor(SEC / F.memoryHoldSec);
  const rangeBound = 2 * F.ceilMargin + 0.05;
  check('no oscillation against a stepping governor model (GPU-heavy start)',
    on.falls <= fallsBound && on.range <= rangeBound && on.steps <= off.steps,
    `${SEC} s: falls ${on.falls} (bound ${fallsBound}), steady k range ${r3(on.range)} (bound ${r3(rangeBound)}), governor steps off ${off.steps} / on ${on.steps}, frames over 16.7 ms off ${off.over} of ${off.frames} / on ${on.over} of ${on.frames}`);
  // CPU-bound: a backlog the governor cannot cure (its rungs only move GPU time).
  const offC = govSim(false, SEC, [10, 9, 8, 7], 6, 14);
  const onC = govSim(true, SEC, [10, 9, 8, 7], 6, 14);
  govRows.push(offC, onC);
  check('a CPU-bound backlog: the scale relieves the frame, the governor does not walk its ladder for it',
    onC.steps <= offC.steps && onC.over < offC.over && onC.falls <= fallsBound && onC.range <= rangeBound,
    `governor steps off ${offC.steps} / on ${onC.steps}, frames over 16.7 ms off ${offC.over} of ${offC.frames} / on ${onC.over} of ${onC.frames}, falls ${onC.falls} (bound ${fallsBound}), steady k range ${r3(onC.range)}`);
}

// The hold after a reveal, after a warp; the curtain and its ramp.
{
  const law = sp.createPaceLaw(onCfg());
  const cur = run(law, 5, () => ({ dtMs: 25, workMs: 20 }), { curtain: true, bootDone: false });
  check('under the curtain the allowances rise to the curtain factor', cur.at(-1).k === C.k && maxK(cur) === C.k, `k ${cur.at(-1).k} (curtainLaw.k ${C.k}) at 40 fps`);
  const after = run(law, 8, late, { curtain: false, bootDone: true });
  const rampEnd = after.findIndex((x) => x.t >= C.rampSec + 0.05);
  const ramp = after.slice(0, rampEnd);
  const mono = ramp.every((x, i) => i === 0 || x.k <= ramp[i - 1].k + 1e-12);
  check('at the reveal it drops to rampFromK and ramps down to 1 (the first visible frames are not the heaviest)',
    after[0].k <= C.rampFromK && after[0].k < C.k && mono && after[rampEnd].k === 1,
    `first visible frame k ${r3(after[0].k)}, 1 after ${C.rampSec} s, monotone ${mono}`);
  const hold = after.filter((x) => x.t < F.holdSec - 0.05 && x.t >= C.rampSec + 0.05);
  const later = after.filter((x) => x.t > F.holdSec + F.downHoldSec + 1);
  check('held at 1 after the reveal, then the flight law acts', hold.every((x) => x.k === 1) && later.length && minK(later) < 1,
    `k = 1 to ${F.holdSec} s on late frames, then ${r3(minK(later))}`);
  check('never above 1 after the ramp', after.filter((x) => x.t >= C.rampSec + 0.05).every((x) => x.k <= 1));
}
{
  const law = sp.createPaceLaw(onCfg());
  run(law, 10, late, { epoch: 0 });
  const w = run(law, 6, late, { epoch: 1 });
  check('held at exactly 1 for holdSec after a warp', w.filter((x) => x.t < F.holdSec - 0.05).every((x) => x.k === 1) && minK(w.filter((x) => x.t > F.holdSec + 1)) < 1,
    `k at the warp ${w[0].k}, ${F.holdSec} s at 1, then ${r3(minK(w.filter((x) => x.t > F.holdSec + 1)))}`);
}
{
  // The curtain's frame ceiling: frames too slow under the curtain back it toward 1, never below.
  const law = sp.createPaceLaw(onCfg());
  const slow = run(law, 5, () => ({ dtMs: 70, workMs: 60 }), { curtain: true, bootDone: false });
  check('the curtain backs off toward 1 (never below) when frames exceed its ceiling', slow.at(-1).k === 1 && minK(slow) >= 1,
    `70 ms curtain frames (ceiling ${C.maxFrameMs} ms): k ${slow.at(-1).k}`);
  // While the governor samples (a warp after its grace), the ceiling is under its step-down interval.
  const law2 = sp.createPaceLaw(onCfg());
  run(law2, PERF_GOVERNOR.bootGraceSec + 1, steady, { bootDone: true, epoch: 0 });
  run(law2, PERF_GOVERNOR.warpGraceSec + 1, () => ({ dtMs: 25, workMs: 20 }), { curtain: true, bootDone: true, epoch: 1 });
  const live = run(law2, 5, () => ({ dtMs: 25, workMs: 20 }), { curtain: true, bootDone: true, epoch: 1 });
  const govMs = (C.govMargin * DISPLAY_MS) / PERF_GOVERNOR.downFrac;
  check('under a warp curtain the governor samples, the factor stays under its step-down interval', live.at(-1).k === 1,
    `25 ms frames against a ceiling of ${r3(govMs)} ms: k ${live.at(-1).k}`);
  const law3 = sp.createPaceLaw(onCfg());
  run(law3, PERF_GOVERNOR.bootGraceSec + 1, steady, { bootDone: true, epoch: 0 });
  run(law3, 1, steady, { curtain: true, bootDone: true, epoch: 1 });
  const fast = run(law3, 5, () => ({ dtMs: DISPLAY_MS, workMs: 8 }), { curtain: true, bootDone: true, epoch: 1 });
  check('...and keeps the full factor while frames stay under it', fast.at(-1).k === C.k, `16.7 ms frames: k ${fast.at(-1).k}`);
}
{
  const noCurtain = sp.createPaceLaw(onCfg({ curtain: false }));
  const c = run(noCurtain, 5, () => ({ dtMs: 25, workMs: 20 }), { curtain: true, bootDone: false });
  const noFlight = sp.createPaceLaw(onCfg({ flight: false }));
  const f = run(noFlight, 20, late);
  check('the sub-switches: curtain off stays 1 under the curtain, flight off stays 1 in flight', c.every((x) => x.k === 1) && f.every((x) => x.k === 1));
  const offLaw = sp.createPaceLaw(sp.paceLawConfig({ ...STREAM_PACE, enabled: false }, PERF_GOVERNOR));
  const o1 = run(offLaw, 10, late);
  const o2 = run(offLaw, 5, () => ({ dtMs: 25, workMs: 20 }), { curtain: true });
  check('a law built from the block with enabled:false is the constant 1', o1.every((x) => x.k === 1) && o2.every((x) => x.k === 1));
}

// --- 2. off is a no-op; on composes ---------------------------------------------
check('the block ships off', STREAM_PACE.enabled === false && sp.STREAM_PACE_ON === false, `STREAM_PACE.enabled ${STREAM_PACE.enabled}`);
{
  const before = [sp.paceK(), hb.budgetK()];
  const ret = sp.stepStreamPace({ dtMs: 50, workMs: 40, targetMs: DISPLAY_MS, sample: true, curtain: false, epoch: 0, bootDone: true });
  for (let i = 0; i < 600; i++) sp.stepStreamPace({ dtMs: 50, workMs: 40, targetMs: DISPLAY_MS, curtain: i < 300, bootDone: true });
  const after = [sp.paceK(), hb.budgetK(), sp.streamPaceStats(), hb.streamPaceK()];
  globalThis.window = { __flyFinalizeBudgetK: 40 };
  const h40 = hb.budgetK();
  globalThis.window = {};
  const h0 = hb.budgetK();
  delete globalThis.window;
  check('flag off: paceK() and budgetK() are exactly 1 and a step does nothing', before[0] === 1 && before[1] === 1 && ret === 1 && after[0] === 1 && after[1] === 1 && after[2] === null && after[3] === 1,
    `paceK ${after[0]}, budgetK ${after[1]}, stats ${after[2]}`);
  check('flag off: budgetK() is exactly the harness factor (40 under a harness, 1 with none)', h40 === 40 && h0 === 1, `${h40}, ${h0}`);
}
{
  const src = fs.readFileSync(path.join(ROOT, 'components/fly/FlyCanvas.jsx'), 'utf8');
  const mounts = src.match(/<StreamPaceRig\b[^>]*>/g) ?? [];
  const guarded = /\{\s*streamPaceOn\(\)\s*&&\s*<StreamPaceRig runtime=\{runtime\}[^>]*\/>\s*\}/.test(src);
  check('the rig is mounted once, only behind streamPaceOn()', mounts.length === 1 && guarded, `${mounts.length} mount(s), guarded ${guarded}`);
  const rig = fs.readFileSync(path.join(ROOT, 'components/fly/StreamPaceRig.jsx'), 'utf8');
  const frameBody = rig.slice(rig.indexOf('useFrame(('), rig.indexOf('}, -98)'));
  // (`??= {}` creates window.__flyStats once, when it is absent: not per frame)
  const allocs = frameBody.match(/\bnew\s+\w|\[\s*\]|(?<!\?\?)=\s*\{\s*\}|\.map\(|\.filter\(|\.slice\(|=>\s*\(\{/g) ?? [];
  check('the rig allocates nothing per frame and runs before the engines (priority -98)', allocs.length === 0 && /\}, -98\);/.test(rig), allocs.length ? allocs.join(' ') : 'no allocation in the frame callback');
}
{
  const r = spawnSync(process.execPath, ['--no-warnings', SELF, '--child-on'], { cwd: ROOT, encoding: 'utf8' });
  const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('@@'));
  const o = line ? JSON.parse(line.slice(2)) : null;
  if (!o) {
    console.log(r.stdout?.slice(-1500), r.stderr?.slice(-1500));
    check('flag on: the child ran', false);
  } else {
    check('flag on: the pin turns it on with both sub-switches', o.on && o.flight && o.curtain);
    check('flag on: budgetK() = harness factor x k (k at the floor)', o.kFloor === F.floor && o.budgetKFloor === F.floor && Math.abs(o.budgetKFloorH40 - 40 * F.floor) < 1e-12,
      `k ${o.kFloor}, budgetK ${o.budgetKFloor}, under a x40 harness ${o.budgetKFloorH40}`);
    check('flag on: the harness clamp keeps its meaning (a harness factor under 1 reads as 1)', o.budgetKFloorHHalf === F.floor, `harness 0.5 -> budgetK ${o.budgetKFloorHHalf}`);
    const fpBudget = 3; // FINALIZE_PACE.budgetMs
    check('flag on: the shared finalize allowance follows the scale', o.finalizeLeft <= fpBudget * F.floor + 1e-6 && o.finalizeLeft > fpBudget * F.floor - 0.5,
      `${r3(o.finalizeLeft)} ms of ${fpBudget} x ${F.floor}`);
    check('flag on: the turn budget cannot take it below the floor', Math.abs(o.finalizeLeftTurn - o.finalizeLeft) < 0.5 && o.finalizeLeftTurn > fpBudget * F.floor * 0.5 + 0.1,
      `with a 0.5 turn budget ${r3(o.finalizeLeftTurn)} ms (product would be ${r3(fpBudget * F.floor * 0.5)})`);
    check('flag on: under the curtain budgetK() = the curtain factor', o.kCurtain === C.k && o.budgetKCurtain === C.k, `k ${o.kCurtain}, budgetK ${o.budgetKCurtain}`);
    check('flag on: the stats publish what it did', o.stats && o.stats.min === F.floor && o.stats.curtainK === C.k && o.stats.floorSec > 0, JSON.stringify(o.stats));
    check('flag on: a reset puts k and budgetK() back to exactly 1', o.kAfterReset === 1 && o.budgetKAfterReset === 1);
  }
}

// --- 3. the real engines ---------------------------------------------------------
const benchArm = (arm, exact, renderMs, leg) => {
  const label = `stream-pace-${leg}-${exact ? 'x' : 't'}-${arm}`;
  const file = path.join(ROOT, '.graphics-review/flight-cpu', label, 'stream-pace.json');
  fs.rmSync(file, { force: true });
  const r = spawnSync(process.execPath, ['--no-warnings', SELF, '--bench', arm, exact ? 'exact' : 'real', String(renderMs), leg], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0 || !fs.existsSync(file)) {
    console.log(r.stdout?.slice(-1500), r.stderr?.slice(-1500));
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
/** Per-arm numbers: frames over the display interval by phase, arrival per engine. */
const summarize = (s) => {
  const ph = (p) => s.frames.filter((f) => f.ph === p);
  const over = (fs_) => fs_.filter((f) => f.w + s.renderMs > DISPLAY_MS).length;
  const fl = ph('f');
  const tl = ph('t');
  const st = ph('s');
  // Arrival in frames from the start of the run (the boot): per engine, the
  // frame each drawn-chunk count is first reached. From the run's start, not
  // the flight's, because the curtain shortens the settle and so moves the
  // flight's start.
  const reach = s.engines.map((_, e) => {
    const m = new Map();
    for (let i = 0; i < s.ready.length; i++) {
      const v = s.ready[i][e];
      if (!m.has(v)) m.set(v, i);
    }
    return m;
  });
  const rampN = Math.ceil(C.rampSec * 60);
  const sorted = (x) => [...x].sort((p, q) => p - q);
  const tot = sorted(fl.map((f) => f.w + s.renderMs));
  const afterRamp = fl.slice(Math.ceil(C.rampSec * 60) + 1).concat(tl);
  return {
    settleFrames: st.length,
    overFlight: over(fl),
    overRamp: over(fl.slice(0, rampN)),
    overTail: over(tl),
    flightFrames: fl.length,
    tailFrames: tl.length,
    p95Flight: tot[Math.floor(0.95 * (tot.length - 1))],
    kMinFlight: Math.min(...afterRamp.map((f) => f.k)),
    kMaxFlight: Math.max(...afterRamp.map((f) => f.k)),
    kMeanFlight: fl.reduce((x, f) => x + f.k, 0) / Math.max(1, fl.length),
    kMeanTail: tl.reduce((x, f) => x + f.k, 0) / Math.max(1, tl.length),
    kSettle: st.length ? st.reduce((x, f) => x + f.k, 0) / st.length : 1,
    workMeanSettle: st.reduce((x, f) => x + f.w, 0) / Math.max(1, st.length),
    workMeanFlight: fl.reduce((x, f) => x + f.w, 0) / Math.max(1, fl.length),
    reach,
    lastArrival: s.engines.map((_, e) => reach[e].get(s.ready.at(-1)[e]) ?? null),
  };
};
/** Largest and mean frame shift to first reach each drawn-chunk count (B later = +), from the flight start. */
const shift = (A, B) =>
  A.reach.map((ra, e) => {
    const rb = B.reach[e];
    let worst = 0;
    let sum = 0;
    let n = 0;
    for (const [k, i] of ra) {
      if (!rb.has(k)) continue;
      const d = rb.get(k) - i;
      worst = Math.max(worst, d);
      sum += d;
      n++;
    }
    return { worst, mean: n ? sum / n : 0 };
  });

const table = [];
const tableRow = (name, x, y) => table.push(`  ${name.padEnd(46)} ${String(x).padStart(12)} ${String(y).padStart(12)}`);
const tableArms = (title, so, sn, a, b) => {
  const sh = shift(a, b);
  tableRow(title, 'off', 'on');
  tableRow('settle frames (under the curtain)', a.settleFrames, b.settleFrames);
  tableRow('  mean engine work under the curtain, ms', r3(a.workMeanSettle), r3(b.workMeanSettle));
  tableRow('  mean k under the curtain', r3(a.kSettle), r3(b.kSettle));
  tableRow('flight frames over 16.7 ms (work + render)', `${a.overFlight}/${a.flightFrames}`, `${b.overFlight}/${b.flightFrames}`);
  tableRow(`  of which in the first ${C.rampSec} s (the reveal ramp)`, a.overRamp, b.overRamp);
  tableRow('tail (parked) frames over 16.7 ms', `${a.overTail}/${a.tailFrames}`, `${b.overTail}/${b.tailFrames}`);
  tableRow('flight frame p95 (work + render), ms', r3(a.p95Flight), r3(b.p95Flight));
  tableRow('  mean engine work in flight, ms', r3(a.workMeanFlight), r3(b.workMeanFlight));
  tableRow('  k: flight mean / min after the ramp / tail mean', '1 / 1 / 1', `${r3(b.kMeanFlight)} / ${r3(b.kMinFlight)} / ${r3(b.kMeanTail)}`);
  so.engines.forEach((en, e) => {
    tableRow(`${en}: last arrival, frames from boot`, a.lastArrival[e], b.lastArrival[e]);
    tableRow(`${en}: each count reached later by (worst / mean), frames`, '', `${sh[e].worst} / ${r3(sh[e].mean)}`);
  });
  const per = Object.keys(so.final.per).map((k) => `${k} ${so.final.per[k].hash === sn.final.per[k]?.hash ? '=' : 'DIFF'}`).join(' ');
  tableRow('final state, engine by engine', '', per);
};
const RENDER = Number(process.env.STREAM_PACE_RENDER_MS ?? 15);
const OWNER_TILES = path.join(ROOT, '.graphics-review/flight-cpu/tiles');
const ownerLeg = process.argv.includes('--owner');
if (process.argv.includes('--no-bench')) {
  console.log('(part 3 skipped: --no-bench)');
} else if (!fs.existsSync(path.join(ROOT, PACK))) {
  check('the committed tile pack exists', false, PACK);
} else {
  // 3a. The committed fixture leg (verify-flight-cpu's), virtual clock: identity.
  const xo = benchArm('off', true, RENDER, 'fixture');
  const xn = benchArm('on', true, RENDER, 'fixture');
  if (xo && xn) {
    const a = summarize(xo);
    const b = summarize(xn);
    const engines = Object.keys(xo.final.per);
    const diff = engines.filter((k) => xo.final.per[k].hash !== xn.final.per[k]?.hash);
    check('fixture leg, real engines, virtual clock: the arms resolve as pinned', xo.on === false && xn.on === true);
    check('fixture leg: the final state is byte-identical with the scale on, engine by engine', diff.length === 0 && xo.final.hash === xn.final.hash,
      diff.length ? `differs: ${diff.join(', ')}` : engines.map((k) => `${k} ${xo.final.per[k].chunks} chunks / ${xo.final.per[k].meshes} meshes`).join(', '));
    check('fixture leg: every chunk still arrives (both settled, the same counts, not empty)',
      xo.settledEnd && xn.settledEnd && engines.every((k) => xo.final.per[k].meshes > 0 && xo.final.per[k].meshes === xn.final.per[k].meshes && xo.final.per[k].chunks === xn.final.per[k].chunks),
      engines.map((k) => `${k} ${xo.final.per[k].meshes}/${xn.final.per[k].meshes}`).join(', '));
    check('fixture leg: the scale rose under the curtain and stayed in [floor, 1] after the ramp', b.kSettle > 1 && b.kMinFlight >= F.floor && b.kMaxFlight <= 1,
      `curtain mean ${r3(b.kSettle)}, after the ramp ${r3(b.kMinFlight)}..${r3(b.kMaxFlight)}`);
    tableArms(`fixture leg, virtual clock, render ${RENDER} ms`, xo, xn, a, b);
  } else check('the fixture-leg flights ran', false);

  // 3b. The owner's Argenteuil leg (every engine, full rings) from the local
  // tile cache (git-ignored; `node scripts/bench-flight-cpu.mjs` fills it).
  if (ownerLeg && !(fs.existsSync(OWNER_TILES) && fs.readdirSync(OWNER_TILES).length)) {
    check('--owner: the local tile cache exists', false, OWNER_TILES);
  } else if (ownerLeg) {
    const oo = benchArm('off', true, RENDER, 'owner');
    const on = benchArm('on', true, RENDER, 'owner');
    const oc = benchArm('k2', true, RENDER, 'owner'); // control: a constant x2 scale, no law
    if (oo && on && oc) {
      const a = summarize(oo);
      const b = summarize(on);
      const engines = Object.keys(oo.final.per);
      const paced = engines.filter((k) => oc.final.per[k].hash !== oo.final.per[k].hash);
      const same = engines.filter((k) => !paced.includes(k));
      const diffSame = same.filter((k) => on.final.per[k].hash !== oo.final.per[k].hash);
      const diffPaced = paced.filter((k) => on.final.per[k].hash !== oo.final.per[k].hash);
      check('owner leg: every chunk still arrives (both settled, the same chunk and mesh counts)',
        oo.settledEnd && on.settledEnd && engines.every((k) => oo.final.per[k].meshes === on.final.per[k].meshes && oo.final.per[k].chunks === on.final.per[k].chunks),
        engines.map((k) => `${k} ${oo.final.per[k].chunks}c/${oo.final.per[k].meshes}m`).join(', '));
      check('owner leg: every engine whose settled state does not depend on pacing is byte-identical with the scale on', diffSame.length === 0,
        `identical: ${same.join(', ') || 'none'}${diffSame.length ? `; DIFFER: ${diffSame.join(', ')}` : ''}`);
      check('owner leg: the final state is byte-identical with the scale on, engine by engine', diffPaced.length === 0 && diffSame.length === 0,
        diffPaced.length
          ? `NOT MET: ${diffPaced.join(', ')} differ, and a constant x2 scale with no law changes ${paced.join(', ')} the same way: their settled geometry depends on allowance pacing (an engine property, so any scale moves it)`
          : 'all engines identical');
      tableArms(`owner leg, virtual clock, render ${RENDER} ms`, oo, on, a, b);
    } else check('the owner-leg virtual-clock flights ran', false);
    const to = benchArm('off', false, RENDER, 'owner');
    const tn = benchArm('on', false, RENDER, 'owner');
    if (to && tn) {
      const a = summarize(to);
      const b = summarize(tn);
      tableArms(`owner leg, REAL clock (node), render ${RENDER} ms`, to, tn, a, b);
      check('owner leg, real clock: both arms ran and settled', to.settledEnd && tn.settledEnd);
      // Node's real clock on a shared container is noisy (the bench's own
      // repeatability note: 5 to 30 %), so the margin is a quarter.
      check('owner leg, real clock: frames over the display interval fall by at least a quarter with the scale on',
        b.overFlight + b.overTail <= 0.75 * (a.overFlight + a.overTail),
        `flight ${a.overFlight} -> ${b.overFlight} of ${a.flightFrames}, tail ${a.overTail} -> ${b.overTail} of ${a.tailFrames}`);
    } else check('the owner-leg real-clock flights ran', false);
  }
}

console.log('\nthe governor model (180 s; off / on):');
if (govRows.length) {
  const [o, n, oc, nc] = govRows;
  console.log(`  GPU-heavy start: governor steps ${o.steps} / ${n.steps}, frames over 16.7 ms ${o.over} / ${n.over}, final rung ${o.rung} / ${n.rung}, k falls ${n.falls}, k final ${r3(n.k)} (min ${r3(n.minK)}, steady range ${r3(n.range)})`);
  console.log(`  CPU-bound backlog: governor steps ${oc.steps} / ${nc.steps}, frames over 16.7 ms ${oc.over} / ${nc.over}, final rung ${oc.rung} / ${nc.rung}, k falls ${nc.falls}, k final ${r3(nc.k)} (min ${r3(nc.minK)}, steady range ${r3(nc.range)})`);
}
if (tFloor != null) console.log(`  floor reached ${r3(tFloor)} s into sustained 30 Hz frames`);
if (table.length) console.log(`\nthe real engines (scripts/bench-flight-cpu.mjs):\n${table.join('\n')}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
