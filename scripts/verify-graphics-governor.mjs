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
  const frames = [], cleanups = [], state = { mapStyle: style, qualityTier: 'high' };
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
    initialRenderDpr: () => 1, ultraSupersampleScale: () => null, menuOpen: () => false,
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
