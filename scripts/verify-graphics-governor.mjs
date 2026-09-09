// Actual controller and STEP_SAFE module, simulated clock/store/React; no GPU claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as constants from '../lib/fly/fly-constants.js';

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
    useFlyStore: { getState: () => state, subscribe: () => () => {} },
    useMemo: fn => fn(), useRef: current => ({ current }),
    useEffect: fn => { const stop = fn(); if (stop) cleanups.push(stop); },
    useFrame: (fn, priority) => frames.push({ fn, priority }),
    autoTierCeiling: () => 'high', settleOn: () => true,
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
  assert.deepEqual(Array.from(cinematic.g.ladder, r => `${r.dpr}/${r.tier}`),
    ['1/high', '0.875/high', '0.75/high', '0.75/medium', '0.75/low']);
});
cinematic.run(8);
check('cinematic satellite estimates144 Hz but targets60 fps', () => {
  assert.equal(cinematic.g.refresh, 144); assert.equal(cinematic.g.targetFps, 60);
});
for (const options of [{ cinematic: false }, { cinematic: true, style: 'toy' }]) {
  const s = session(environment(options)); s.run(8);
  check(`${options.style ?? 'legacy satellite'} retains144 fps native target`, () => {
    assert.equal(s.g.refresh, 144); assert.equal(s.g.targetFps, 144);
  });
}
cinematic.run(65, 1 / 30);
check('sustained slow frames reduce DPR before medium/low, with one effect per step', () => {
  assert.deepEqual(cinematic.events.map(e => `${e.kind}:${e.value}`),
    ['dpr:0.875', 'dpr:0.75', 'tier:medium', 'tier:low']);
  assert.equal(new Set(cinematic.events.map(e => e.clock)).size, 4);
  assert.equal(cinematic.g.state().tier, 'low');
});
cinematic.run(160);
check('healthy frames recover tiers then DPR to the exact boot state', () => {
  assert.deepEqual(cinematic.events.slice(4).map(e => `${e.kind}:${e.value}`),
    ['tier:medium', 'tier:high', 'dpr:0.875', 'dpr:1']);
  assert.equal(cinematic.g.idx, 0);
});
cinematic.run(20, 1 / 30);
check('a quick repeat decline latches an unstable recovered rung', () => assert.equal(cinematic.g.latched, true));
cinematic.run(Math.max(0, cinematic.g.latchReleaseAt - cinematic.clock - 1));
check('cinematic latch holds before its recovery deadline', () => assert.equal(cinematic.g.latched, true));
cinematic.run(160);
check('cinematic latch eventually releases under sustained healthy frames', () => {
  assert.equal(cinematic.g.latched, false); assert.equal(cinematic.g.idx, 0);
});

const pinned = session(environment()); pinned.run(8); pinned.run(65, 1 / 30, true);
check('governor hold pin suppresses automatic changes while explicit force remains available', () => {
  assert.equal(pinned.events.length, 0); assert.equal(pinned.g.force(-1, pinned.clock), true);
  assert.equal(pinned.events[0].value, 0.875);
});

const shell = environment(), immediate = [];
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
