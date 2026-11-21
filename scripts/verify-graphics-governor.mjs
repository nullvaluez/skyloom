// Actual controller and STEP_SAFE module, simulated clock/store/React; no GPU claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { register } from 'node:module';
import * as constants from '../lib/fly/fly-constants.js';
// SHIP PASS FRAME (FR-5): the governor imports more modules than when this
// gate was written (cinema policy, render resolution, the Ship Pass pacing
// and frame API). Real implementations where they are pure, stubs where they
// would read a browser; the gate was red on "initialRenderDpr is not defined".
register('./_node-resolve.mjs', import.meta.url);
const { resolveCinemaProfile } = await import('../lib/fly/cinema-profile.js');
const { ladderOrderOn } = await import('../lib/fly/device-tiers.js');
const paceAdapt = await import('../lib/fly/pace-adapt.js');
const frameApi = await import('../lib/fly/frame-api.js');

const read = name => fs.readFileSync(new URL(`../lib/fly/${name}.js`, import.meta.url), 'utf8');
const plain = source => source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
let passed = 0;
function check(name, test) { test(); passed++; console.log(`PASS ${name}`); }

function environment({ cinematic = true, style = 'satellite' } = {}) {
  const frames = [], cleanups = [], state = { mapStyle: style, qualityTier: 'high', screen: 'flight' };
  state.setQualityTier = tier => { state.qualityTier = tier; };
  const window = { location: { search: cinematic ? '?graphics=cinematic' : '?graphics=legacy' },
    devicePixelRatio: 1, __flyBoot: { pct: 100 } };
  const ctx = vm.createContext({ ...constants, window, URLSearchParams, performance,
    process: { env: { NODE_ENV: 'production' } },
    // A hook-callable store stub (the shell reads selectors since the gate was written).
    useFlyStore: Object.assign((sel) => (typeof sel === 'function' ? sel(state) : state), { getState: () => state, subscribe: () => () => {} }),
    useMemo: fn => fn(), useRef: current => ({ current }),
    useEffect: fn => { const stop = fn(); if (stop) cleanups.push(stop); },
    useFrame: (fn, priority) => frames.push({ fn, priority }),
    autoTierCeiling: () => 'high', settleOn: () => true,
    // Imports added since the gate was written (stubs read no browser).
    cinemaOn: () => cinematic && state.mapStyle === 'satellite', cinemaProfile: () => ({ targetFps: 60 }),
    setCinemaEffectLevel: () => {}, resolveCinemaProfile, ladderOrderOn, isMobileGraphicsClass: () => false,
    initialRenderDpr: () => 1, ultraSupersampleScale: () => null,
    menuOpen: s => !!s.hangarOpen || s.screen === 'title',
    shipPassOn: () => false, shipPassBlock: () => null, deviceFeature: () => ({ allowed: false, budget: {} }),
    ...paceAdapt, ...frameApi,
  });
  for (const name of ['satellite-visuals', 'step-safe', 'perf-governor'])
    vm.runInContext(plain(read(name)), ctx, { filename: `${name}.js` });
  return { ctx, state, window, frames, cleanups };
}

function session(env) {
  const events = [];
  let clock = 0;
  const g = env.ctx.createGovernor({ dpr0: 1, tier0: 'high',
    applyDpr: value => events.push({ kind: 'dpr', value, clock }),
    applyTier: value => events.push({ kind: 'tier', value, clock }) });
  const run = (seconds, dt = 1 / 144, pinned = false) => {
    const end = clock + seconds;
    while (clock < end) { clock += dt; g.tick(dt, clock, { bootPct: 100, pinned }); }
  };
  return { g, events, run, get clock() { return clock; } };
}

const cinematic = session(environment());
check('native1 DPR ladder has two reductions before tier changes, with no duplicate rungs', () => {
  // Since the gate was written the cinematic ladder gained EFFECT rungs
  // (lighter clouds first, cascade drops after render scale is spent:
  // DEVICE_TIERS.ladderOrder). The contract is unchanged: every rung is
  // distinct, and render scale is spent before the first tier step.
  const keys = Array.from(cinematic.g.ladder, r => `${r.dpr}/${r.tier}/fx${r.effects ?? 0}`);
  assert.equal(new Set(keys).size, keys.length, keys.join(' '));
  const firstTier = cinematic.g.ladder.findIndex(r => r.tier !== 'high');
  const dprs = Array.from(cinematic.g.ladder.slice(0, firstTier), r => r.dpr);
  assert.ok(dprs.includes(0.875) && dprs.includes(0.75), keys.join(' '));
  assert.deepEqual(Array.from(cinematic.g.ladder.slice(firstTier), r => r.tier), ['medium', 'low']);
});
cinematic.run(8);
check('cinematic satellite estimates144 Hz but targets60 fps', () => {
  assert.equal(cinematic.g.refresh, 144); assert.equal(cinematic.g.targetFps, 60);
});
// The legacy satellite renderer is gone (lib/fly/satellite-visuals.js: "old
// query parameters and preview switches cannot fall back"), so every
// satellite session is the 60 fps profile; Neon keeps the native target.
for (const options of [{ cinematic: false, style: 'toy' }, { cinematic: true, style: 'toy' }]) {
  const s = session(environment(options)); s.run(8);
  check(`Neon (${options.cinematic ? 'cinematic' : 'plain'} build) retains144 fps native target`, () => {
    assert.equal(s.g.refresh, 144); assert.equal(s.g.targetFps, 144);
  });
}
{
  const s = session(environment({ cinematic: false })); s.run(8);
  check('satellite without the cinema policy still targets60 fps (no legacy satellite renderer remains)', () => {
    assert.equal(s.g.refresh, 144); assert.equal(s.g.targetFps, 60);
  });
}
cinematic.run(65, 1 / 30);
check('sustained slow frames reduce DPR before medium/low, with one effect per step', () => {
  assert.deepEqual(Array.from(cinematic.events, e => `${e.kind}:${e.value}`),
    ['dpr:0.875', 'dpr:0.75', 'tier:medium', 'tier:low']);
  assert.equal(new Set(cinematic.events.map(e => e.clock)).size, 4);
  assert.equal(cinematic.g.state().tier, 'low');
});
// More rungs than when this gate was written (effect rungs): recover until
// the boot state is reached, so the latch check below starts right after it.
for (let i = 0; i < 160 && cinematic.g.idx !== 0; i++) cinematic.run(5);
check('healthy frames recover tiers then DPR to the exact boot state', () => {
  assert.deepEqual(Array.from(cinematic.events.slice(4), e => `${e.kind}:${e.value}`),
    ['tier:medium', 'tier:high', 'dpr:0.875', 'dpr:1']);
  assert.equal(cinematic.g.idx, 0);
});
cinematic.run(20, 1 / 30);
check('a quick repeat decline latches an unstable recovered rung', () => assert.equal(cinematic.g.latched, true));
// The latch no longer times out (perf-governor.js: "Keep the session latch
// until an explicit preset/profile change builds a new governor. Releasing
// it after two minutes recreated the same expensive quality cycle").
cinematic.run(400);
check('the cinematic latch holds for the session under sustained healthy frames', () => {
  assert.equal(cinematic.g.latched, true); assert.ok(cinematic.g.idx >= cinematic.g.ceilingIdx && cinematic.g.ceilingIdx > 0);
});

const pinned = session(environment()); pinned.run(8); pinned.run(65, 1 / 30, true);
check('governor hold pin suppresses automatic changes while explicit force remains available', () => {
  assert.equal(pinned.events.length, 0); assert.equal(pinned.g.force(-1, pinned.clock), true);
  // The first rung is now the lightest EFFECT rung (no DPR event); the one
  // after the effect rungs is the 0.875 render scale.
  assert.equal(pinned.g.idx, 1);
  while (!pinned.events.length && pinned.g.force(-1, pinned.clock));
  assert.equal(pinned.events[0].value, 0.875);
});

// Neon: a ladder with no effect rungs, so force(-1) is a DPR step.
const shell = environment({ style: 'toy' }), immediate = [];
shell.ctx.PerfGovernor({ setDpr: d => immediate.push(d) });
check('actual React shell parks DPR through STEP_SAFE at the governor frame priority', () => {
  assert.equal(shell.frames[0].priority, -100);
  shell.window.__flyGov.force(-1);
  assert.equal(immediate.length, 0); assert.equal(shell.ctx.takeDpr(), 0.875);
  assert.equal(shell.ctx.takeDpr(), null);
});
check('legacy STEP_SAFE pin alias and explicit override retain their precedence', () => {
  shell.window.__flyStepSafePin = 0;
  shell.window.__flyGov.force(-1);
  assert.deepEqual(immediate, [0.75]); assert.equal(shell.ctx.peekDpr(), null);
  shell.window.__flyStepSafeOverride = { enabled: true };
  shell.window.__flyGov.force(1);
  assert.equal(shell.ctx.takeDpr(), 0.875); assert.equal(immediate.length, 1);
});
shell.cleanups.forEach(fn => fn());

check('hidden tabs, the title and the hangar cannot drive an automatic quality change', () => {
  const env = environment();
  const document = new EventTarget();
  document.hidden = false;
  env.ctx.document = document;
  env.ctx.PerfGovernor({ setDpr() {} });
  env.ctx.takeDpr();
  const tick = env.frames.find(frame => frame.priority === -100).fn;
  const run = (frames, dt) => { for (let i = 0; i < frames; i++) tick({}, dt); };
  run(900, 1 / 60);
  const initial = env.window.__flyGov.state();
  assert.ok(initial.sampled > 0);
  document.hidden = true;
  run(400, .1);
  document.hidden = false;
  env.state.screen = 'title';
  run(400, .1);
  env.state.screen = 'hangar'; env.state.hangarOpen = true;
  run(400, .1);
  assert.equal(env.window.__flyGov.state().sampled, initial.sampled);
  assert.equal(env.window.__flyGov.state().rung, initial.rung);
  assert.equal(env.ctx.takeDpr(), null);
  env.state.screen = 'flight'; env.state.hangarOpen = false;
  tick({}, 2); // the first RAF may include the hidden-tab gap
  assert.equal(env.window.__flyGov.state().rung, initial.rung);
  run(120, .1);
  assert.ok(env.window.__flyGov.state().rung > initial.rung, 'genuinely slow visible flight still reduces work');
  env.cleanups.forEach(fn => fn());
});

check('held pictures cannot drive a recovery and a streaming frame still counts', () => {
  const env = environment();
  env.ctx.PerfGovernor({ setDpr() {} });
  const main = { enabled: true, frames: 0 };
  const frameState = { gl: { __flyMainDraw: main } };
  const tick = env.frames.find(frame => frame.priority === -100).fn;
  const run = (count, draw) => {
    for (let i = 0; i < count; i++) {
      tick(frameState, 1 / 144);
      if (draw) main.frames++;
    }
  };
  run(1440, true);
  assert.equal(env.window.__flyGov.force(-1), true);
  const lowered = env.window.__flyGov.state().rung;
  run(720, true);
  assert.equal(env.window.__flyGov.state().rung, lowered);
  const last = env.window.__flyGov.state().sampled;
  run(1, false); // the preceding frame drew
  const beforeHold = env.window.__flyGov.state().sampled;
  assert.equal(beforeHold, last + 1);
  run(2160, false);
  const held = env.window.__flyGov.state();
  assert.equal(held.sampled, beforeHold);
  assert.equal(held.rung, lowered);
  assert.equal(held.emaFps, 0);
  env.window.__flyStats.composerWarm = { holdReason: 'local', heldObjects: 8 };
  run(3, true);
  assert.equal(env.window.__flyGov.state().sampled, beforeHold + 1, 'resume frame excluded, following streaming sample accepted');
  run(3 * 144, true);
  assert.equal(env.window.__flyGov.state().rung, lowered, 'dwell before the hold cannot carry over');
  run(10 * 144, true);
  assert.equal(env.window.__flyGov.state().rung, lowered - 1, 'fresh visible frames can recover');
  env.cleanups.forEach(fn => fn());
});

check('interrupting a cadence window preserves an existing lock and discards unfinished evidence', () => {
  const lock = paceAdapt.createCadenceLock({ windowFrames: 10 });
  for (let i = 0; i < 9; i++) lock.step(1000 / 30, 4);
  lock.interrupt();
  assert.equal(lock.step(1000 / 30, 4), null);
  for (let i = 0; i < 9; i++) lock.step(1000 / 30, 4);
  assert.equal(lock.locked, 30);
  lock.interrupt();
  assert.equal(lock.locked, 30);
});

check('a queued DPR waits past the valve until the visible composer can draw', () => {
  const rig = environment(), writes = [], size = { width: 800, height: 450 };
  let ratio = 1, now = 0, valve;
  const gl = {
    domElement: { width: 800, height: 450, style: { width: '800px', height: '450px' } },
    setPixelRatio(dpr) { ratio = dpr; writes.push(['dpr', dpr]); },
    getPixelRatio: () => ratio,
    getSize: scratch => scratch.set(size.width, size.height),
    setSize(width, height) {
      this.domElement.width = width * ratio;
      this.domElement.height = height * ratio;
      writes.push(['canvas', width, height]);
    },
    setViewport() {},
  };
  const composer = { setSize: (w, h) => writes.push(['composer', w, h]) };
  rig.ctx.performance = { now: () => now };
  rig.ctx.document = { hidden: false };
  rig.ctx.setInterval = fn => { valve = fn; };
  rig.ctx.clearInterval = () => {};
  rig.ctx.useThree = select => select({ gl });
  const source = fs.readFileSync(new URL('../components/fly/StepSafeRig.jsx', import.meta.url), 'utf8');
  vm.runInContext(plain(source), rig.ctx, { filename: 'StepSafeRig.jsx' });
  rig.ctx.registerComposer(composer);
  gl.__flyMainDraw = { owner: composer, enabled: true };
  rig.ctx.StepSafeRig({ setDpr: value => writes.push(['state', value]) });
  rig.ctx.parkDpr(.75);
  rig.frames[0].fn({ gl, size });
  now = 1100;
  valve();
  assert.equal(rig.ctx.peekDpr(), .75);
  assert.deepEqual(writes, [], 'A pending render must keep the current drawing buffer');
  gl.__flyMainDraw.applyDpr();
  assert.deepEqual(writes, [['dpr', .75], ['canvas', 800, 450], ['composer', 800, 450], ['state', .75]]);
  assert.equal(rig.ctx.peekDpr(), null);
  assert.equal(gl.domElement.width, 600);

  rig.ctx.document.hidden = true;
  rig.ctx.parkDpr(1);
  now = 2200;
  valve();
  assert.equal(rig.ctx.peekDpr(), null, 'A hidden tab still has the existing valve');
  assert.deepEqual(writes.at(-1), ['state', 1]);
  rig.cleanups.forEach(fn => fn());
});

const changingEnv = environment({ style: 'toy' }), changing = session(changingEnv);
changing.run(8);
changingEnv.state.mapStyle = 'satellite'; changing.g.setWarpGrace(changing.clock); changing.run(8);
check('style switch applies the cinematic60 fps policy after Neon144 without remeasuring refresh', () => {
  assert.equal(changing.g.refresh, 144); assert.equal(changing.g.targetFps, 60);
});
changingEnv.state.mapStyle = 'toy'; changing.g.setWarpGrace(changing.clock); changing.run(8);
check('switching back to Neon restores the native144 fps target', () => {
  assert.equal(changing.g.refresh, 144); assert.equal(changing.g.targetFps, 144);
});

console.log(`VERIFY: PASS (${passed} governor/STEP_SAFE checks; simulated timing, no presentation or GPU claim)`);
