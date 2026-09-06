#!/usr/bin/env node
/**
 * verify-frame-step — Round 24 (A PACE), recon FL-04.
 *
 *   node scripts/verify-frame-step.mjs [--report]
 *
 * The accumulator is pure — no three, no React — so the whole contract is
 * node-testable, and this is the probe plan §3 A.5 asks for:
 *
 *   "a probe that proves the render pose equals the sim pose at every substep
 *    boundary and that flag-off is byte-identical."
 *
 * Both halves are here. The FIRST is gate 5: at a boundary alpha is 0 and the
 * interpolated pose is the sim pose, exactly (`Object.is`, not a tolerance).
 * The SECOND is gate 1 + the FlyScene source check: with the flag off no
 * accumulator is created and the -50 block runs `flight.step(dt, cmd)`
 * verbatim.
 *
 * It also pins the two properties a fixed step exists for: identical inputs
 * produce identical trajectories at any frame rate, and a stall CATCHES UP
 * rather than dilating time — bounded, with the unrecoverable remainder
 * counted rather than silently carried.
 */
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = process.argv.includes('--report');
const out = path.join(root, 'scripts/r24-out');
mkdirSync(out, { recursive: true });
const src = readFileSync(path.join(root, 'lib/fly/frame-step.js'), 'utf8');
const shim = path.join(out, `.fs-${process.pid}.mjs`);
writeFileSync(
  shim,
  src
    .replace("import { FRAME_STEP } from './fly-constants';", 'const FRAME_STEP = { enabled: true, hz: 120, maxSubsteps: 4 };')
    .replace("import { pinned } from './fly-pins';", 'const pinned = (b) => b;')
);
const fs_ = await import(pathToFileURL(shim).href);
rmSync(shim, { force: true });

let pass = 0;
let fail = 0;
const rows = [];
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('verify-frame-step — the fixed-timestep accumulator and the render pose (FL-04)\n');

// ------------------------------------------------------------ 1. flag off
const flyScene = readFileSync(path.join(root, 'components/fly/FlyScene.jsx'), 'utf8');
gate('1 flag off: the -50 block still calls flight.step(dt, cmd) verbatim',
  /\} else \{\n\s+flight\.step\(dt, apCmd \?\? cmd\);\n\s+\}/.test(flyScene));
gate('2 flag off: no accumulator is created at all',
  /return cfg\.enabled \? createFrameStep\(cfg\) : null;/.test(flyScene));
gate('3 the sim state is never replaced — the render pose is a NEW field',
  /flight\.renderPos = renderPose;/.test(flyScene) &&
    !/flight\.pos = /.test(flyScene),
  'flight.pos is never assigned');

// --------------------------------------------- 4-6. the accumulator itself
const acc = fs_.createFrameStep({ enabled: true, hz: 120, maxSubsteps: 4 });
const r60 = acc.advance(1 / 60);
gate('4 a 60 fps frame runs exactly two 120 Hz substeps',
  r60.steps === 2 && Math.abs(r60.alpha) < 1e-9, `steps ${r60.steps}, alpha ${r60.alpha}`);

// The identity the plan asks for, at an exact boundary: alpha 0 means the
// interpolated pose IS the sim pose, bit for bit.
const prev = { x: 100, y: 200, z: 300 };
const cur = { x: 140, y: 260, z: 380 };
const at0 = fs_.lerpPose({ x: 0, y: 0, z: 0 }, prev, cur, 0);
const at1 = fs_.lerpPose({ x: 0, y: 0, z: 0 }, prev, cur, 1);
gate('5 THE PROBE: at a substep boundary (alpha 0) the render pose IS the sim pose',
  Object.is(at0.x, prev.x) && Object.is(at0.y, prev.y) && Object.is(at0.z, prev.z) &&
    Object.is(at1.x, cur.x) && Object.is(at1.y, cur.y) && Object.is(at1.z, cur.z),
  `alpha 0 -> ${at0.x},${at0.y},${at0.z}; alpha 1 -> ${at1.x},${at1.y},${at1.z}`);

// Attitude interpolation must take the SHORT arc, or a heading crossing pi
// spins the model the long way round for one frame.
const shortArc = fs_.lerpAngle(3.10, -3.10, 0.5);
gate('6 heading interpolation takes the short arc across the pi wrap',
  Math.abs(Math.abs(shortArc) - Math.PI) < 0.05,
  `lerp(3.10, -3.10, 0.5) = ${shortArc.toFixed(4)} (the long way would be ~0)`);

// ------------------------------------- 7-9. frame-rate independence + stalls
/** Integrate a trivial model with the accumulator at a given frame pattern. */
function run(dtPlan, frames) {
  const a = fs_.createFrameStep({ enabled: true, hz: 120, maxSubsteps: 4 });
  let x = 0;
  for (let i = 0; i < frames; i++) {
    const { steps } = a.advance(dtPlan(i));
    for (let s = 0; s < steps; s++) x += 10 * a.fixed; // 10 units/second
  }
  return { x, stats: a.stats() };
}
const at60 = run(() => 1 / 60, 600); // 10 s
const at144 = run(() => 1 / 144, 1440); // 10 s
const jittery = run((i) => (i % 7 === 0 ? 1 / 20 : 1 / 90), 900);
// Frame-rate independence for an ACCUMULATOR is "the same to within the step
// that has not been taken yet", not "bit-identical". 10 s at 144 fps ends with
// a partial step still in the accumulator (144 does not divide 120), and that
// residual is exactly the difference. Asserting equality outright would be
// asserting something false and would have to be silenced later with a fudged
// tolerance; asserting the residual EXPLAINS the difference is the real claim.
const travel = (r) => r.x + 10 * r.stats.acc;
rows.push(
  `  distance after 10 s: 60 fps ${at60.x.toFixed(6)} · 144 fps ${at144.x.toFixed(6)}` +
    ` (residual in the accumulator: ${(10 * at144.stats.acc).toFixed(6)})`
);
gate('7 identical inputs travel the same distance at 60 and 144 fps, to within the unspent step',
  Math.abs(at60.x - at144.x) <= 10 * at60.stats.fixed + 1e-9 &&
    Math.abs(travel(at60) - travel(at144)) < 1e-9,
  `${at60.x.toFixed(6)} vs ${at144.x.toFixed(6)}; with the residual ${travel(at60).toFixed(9)} vs ${travel(at144).toFixed(9)}`);
gate('8 a jittery frame pattern does not lose or invent time',
  Math.abs(jittery.x - 10 * (jittery.stats.steps * jittery.stats.fixed)) < 1e-9);

// A stall longer than maxSubsteps * fixed cannot be caught up without
// spiralling. The remainder is DROPPED and COUNTED, never carried.
const stalled = fs_.createFrameStep({ enabled: true, hz: 120, maxSubsteps: 4 });
const big = stalled.advance(0.5); // a 500 ms stall = 60 fixed steps' worth
rows.push(`  500 ms stall: ${big.steps} substeps run, ${stalled.stats().dropped} dropped`);
gate('9 a 500 ms stall runs at most maxSubsteps and COUNTS what it dropped',
  big.steps === 4 && stalled.stats().dropped > 50,
  `steps ${big.steps} (cap 4), dropped ${stalled.stats().dropped}`);
gate('10 …and the accumulator does not carry a spiral into the next frame',
  stalled.stats().acc < stalled.stats().fixed, `acc ${stalled.stats().acc.toFixed(6)} s`);

if (REPORT) console.log('\n' + rows.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
