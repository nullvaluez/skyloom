#!/usr/bin/env node
/**
 * verify-finalize-pace — Round 24 (A PACE), recon WB-3 + A9 + WB-10.
 *
 *   node scripts/verify-finalize-pace.mjs [--report]
 *
 * The brake is pure logic with an injected clock, so it is testable in node.
 * What this gate asserts is the SHAPE of the rule, not a frame time:
 *
 *   1. flag off  -> `mayFinalize` always true, i.e. every engine behaves
 *      exactly as it does today (byte-identical control flow).
 *   2. rule 1    -> after a frame longer than `longFrameMs`, the FIRST chunk
 *      of every engine is deferred. Today the toy engine's guard is
 *      `done > 0 &&`, so the first chunk always lands no matter how late the
 *      frame already is — which is how a hitch train sustains itself.
 *   3. rule 2    -> the budget is SHARED and counted from the start of the
 *      frame, so four engines cannot each spend their own allowance.
 *   4. nothing starves: a deferred chunk is retried, never dropped.
 *
 * It also checks the two structural companions by source inspection, because
 * they are one-line facts that a future edit could silently undo: every chunk
 * engine calls the shared brake, and the toy index build is a typed array.
 */
import { mkdirSync, copyFileSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = process.argv.includes('--report');
const out = path.join(root, 'scripts/r24-out');
mkdirSync(out, { recursive: true });

// finalize-pace.js is ESM in a CommonJS package and imports two app modules;
// copy it with those imports inlined so node can load it as-is otherwise.
const src = readFileSync(path.join(root, 'lib/fly/finalize-pace.js'), 'utf8');
const shim = path.join(out, `.fp-${process.pid}.mjs`);
writeFileSync(
  shim,
  src
    // `pinned` reads the LIVE global rather than a captured object: the module
    // memoises its config on first use, so an arm that reassigns the constants
    // after import would otherwise silently test the previous arm.
    .replace("import { FINALIZE_PACE } from './fly-constants';", 'const FINALIZE_PACE = null;')
    .replace("import { pinned } from './fly-pins';", 'const pinned = () => globalThis.__fpCfg;')
);
globalThis.__fpCfg = { enabled: true, budgetMs: 3, longFrameMs: 24, vegPerFrame: 1 };
const fp = await import(pathToFileURL(shim).href);
rmSync(shim, { force: true });

let pass = 0;
let fail = 0;
const rows = [];
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('verify-finalize-pace — the shared per-frame finalize brake (WB-3 / A9 / WB-10)\n');

// ---------------------------------------------------------- 1. flag off
globalThis.__fpCfg = { enabled: false, budgetMs: 3, longFrameMs: 24, vegPerFrame: 1 };
fp.resetFinalizePace();
fp.noteFinalizeFrame(0.2); // a 200 ms frame: as bad as it gets
gate('1 flag off: the brake never defers anything (control flow unchanged)',
  fp.mayFinalize(0) === true && fp.mayFinalize(5) === true && fp.finalizePaceOn() === false);

// ------------------------------------------------- 2. rule 1, the first chunk
globalThis.__fpCfg = { enabled: true, budgetMs: 3, longFrameMs: 24, vegPerFrame: 1 };
fp.resetFinalizePace();
fp.noteFinalizeFrame(0.05); // 50 ms — the previous frame overran
const afterLong = fp.mayFinalize(0);
fp.resetFinalizePace();
globalThis.__fpCfg = { enabled: true, budgetMs: 3, longFrameMs: 24, vegPerFrame: 1 };
fp.noteFinalizeFrame(0.0167); // a healthy frame
const afterGood = fp.mayFinalize(0);
rows.push(`  first chunk after a 50 ms frame: ${afterLong} · after a 16.7 ms frame: ${afterGood}`);
gate('2 RED-shape: after a long frame the FIRST chunk is deferred', afterLong === false);
gate('3 …and after a healthy frame it is not', afterGood === true);

// ------------------------------------------------- 4. rule 2, a shared budget
fp.resetFinalizePace();
globalThis.__fpCfg = { enabled: true, budgetMs: 3, longFrameMs: 24, vegPerFrame: 1 };
fp.noteFinalizeFrame(0.0167);
const spin = (ms) => {
  const t = performance.now();
  while (performance.now() - t < ms);
};
const left0 = fp.budgetLeftMs();
spin(4); // one engine burns more than the whole allowance
const left1 = fp.budgetLeftMs();
const secondEngine = fp.mayFinalize(1);
rows.push(`  budget left: ${left0.toFixed(2)} ms at frame start, ${left1.toFixed(2)} ms after 4 ms of work`);
gate('4 the budget is counted from the START OF THE FRAME, not per engine',
  left0 > 2.5 && left1 < 0, `${left0.toFixed(2)} -> ${left1.toFixed(2)} ms`);
gate('5 a second chunk is refused once the SHARED budget is gone',
  secondEngine === false);
fp.resetFinalizePace();
fp.noteFinalizeFrame(0.0167);
gate('6 …and a fresh frame restores it', fp.mayFinalize(1) === true);

// --------------------------------------- 7-10. the structural companions
const engines = {
  'sat-building-engine.js': 'lib/fly/toy-world/sat-building-engine.js',
  'sat-skyline-engine.js': 'lib/fly/toy-world/sat-skyline-engine.js',
  'sat-road-engine.js': 'lib/fly/toy-world/sat-road-engine.js',
  'toy-world-engine.js': 'lib/fly/toy-world/toy-world-engine.js',
};
const missing = [];
for (const [name, rel] of Object.entries(engines)) {
  const txt = readFileSync(path.join(root, rel), 'utf8');
  if (!/if \(!mayFinalize\(done\)\) break;/.test(txt)) missing.push(name);
}
gate('7 every chunk engine calls the shared brake in its finalize loop',
  missing.length === 0, missing.join(', '));

const toy = readFileSync(path.join(root, 'lib/fly/toy-world/toy-world-engine.js'), 'utf8');
gate('8 the toy merged index is built into a typed array when armed (WB-10)',
  /idx = new Uint32Array\(base \+ extra\)/.test(toy));
gate('9 …and the upstream spread survives verbatim on the flag-off branch',
  /idx = data\n\s+\? \[\.\.\.groundIdx, \.\.\.Array\.from\(data\.idx, \(v\) => v \+ w \* w\)\]\n\s+: groundIdx;/.test(toy));

const veg = readFileSync(path.join(root, 'lib/fly/toy-world/sat-veg-engine.js'), 'utf8');
gate('10 the veg commit is capped per frame (A9)',
  /committed < cap/.test(veg) && /finalizePaceOn\(\) \? Math\.max\(1, FINALIZE_PACE\.vegPerFrame\)/.test(veg));

// The brake must be a SEPARATE statement, not folded into the loop bound: E's
// harness budget multiplier sits on that expression, and two owners editing one
// expression is how a merge silently drops one of them.
const bounds = Object.values(engines)
  .map((rel) => readFileSync(path.join(root, rel), 'utf8'))
  .filter((t) => /&& done < [^;]*mayFinalize/.test(t));
gate('11 the brake is a separate guard, never folded into the loop bound',
  bounds.length === 0, `${bounds.length} engines fold it in`);

if (REPORT) console.log('\n' + rows.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
