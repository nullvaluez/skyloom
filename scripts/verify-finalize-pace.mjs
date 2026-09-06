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
import { checkShip } from './_r24a-ship-state.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = process.argv.includes('--report');
const out = path.join(root, 'scripts/r24-out');
mkdirSync(out, { recursive: true });

// finalize-pace.js is ESM in a CommonJS package and imports three app modules;
// copy it with the two config imports inlined so node can load it as-is.
//
// harness-budget.js is NOT inlined: it is copied beside the shim and imported
// FOR REAL, so gates 12-13 exercise E's actual clamp and its actual
// `typeof window === 'undefined'` branch rather than a stand-in that agrees
// with my reading of it. Under node with no `window`, budgetK() returns 1 —
// which is exactly why the K arm below has to define one.
const hb = path.join(out, `.hb-${process.pid}.mjs`);
writeFileSync(hb, readFileSync(path.join(root, 'lib/fly/harness-budget.js'), 'utf8'));
const src = readFileSync(path.join(root, 'lib/fly/finalize-pace.js'), 'utf8');
const shim = path.join(out, `.fp-${process.pid}.mjs`);
writeFileSync(
  shim,
  src
    .replace(
      "import { budgetK } from './harness-budget';",
      `import { budgetK } from './${path.basename(hb)}';`
    )
    // `pinned` reads the LIVE global rather than a captured object: the module
    // memoises its config on first use, so an arm that reassigns the constants
    // after import would otherwise silently test the previous arm.
    .replace("import { FINALIZE_PACE } from './fly-constants';", 'const FINALIZE_PACE = null;')
    .replace("import { pinned } from './fly-pins';", 'const pinned = () => globalThis.__fpCfg;')
);
globalThis.__fpCfg = { enabled: true, budgetMs: 3, longFrameMs: 24, spikeK: 2, maxRefuseFrames: 3, vegPerFrame: 1 };
const fp = await import(pathToFileURL(shim).href);
rmSync(shim, { force: true });
rmSync(hb, { force: true });

let pass = 0;
let fail = 0;
const rows = [];
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('verify-finalize-pace — the shared per-frame finalize brake (WB-3 / A9 / WB-10)\n');

// ------------------------------------------------------ 0. the SHIP state
// Two separate claims, so two separate gates. This one is "the build actually
// carries the ruled flag"; every gate below is "the code behaves correctly
// under each state", which is why they force the state themselves. A silent
// revert would leave the behaviour gates green and only this one red.
const shipFP = checkShip('FINALIZE_PACE');
gate('0 FINALIZE_PACE ships in the ruled state', shipFP.ok, shipFP.detail);

// ---------------------------------------------------------- 1. flag off
// FORCED off, not observed off: the property is "with the brake off the
// engines run the R21 arithmetic", and that must stay provable now that the
// shipped default is ON.
globalThis.__fpCfg = { enabled: false, budgetMs: 3, longFrameMs: 24, spikeK: 2, maxRefuseFrames: 3, vegPerFrame: 1 };
fp.resetFinalizePace();
fp.noteFinalizeFrame(0.2); // a 200 ms frame: as bad as it gets
gate('1 forced OFF: the brake never defers anything (control flow unchanged)',
  fp.mayFinalize(0) === true && fp.mayFinalize(5) === true && fp.finalizePaceOn() === false);

// ------------------------------------------------- 2. rule 1, the first chunk
// The EMA is seeded at longFrameMs (24 ms) on reset, so a cold 50 ms frame is
// 2.08x its baseline and IS a spike, while a cold 16.7 ms frame is not long at
// all. Both assertions therefore read exactly as they did before rule 1 became
// a spike test — which is the point: the fix did not move the hitch behaviour.
globalThis.__fpCfg = { enabled: true, budgetMs: 3, longFrameMs: 24, spikeK: 2, maxRefuseFrames: 3, vegPerFrame: 1 };
fp.resetFinalizePace();
fp.noteFinalizeFrame(0.05); // 50 ms — the previous frame overran
const afterLong = fp.mayFinalize(0);
fp.resetFinalizePace();
globalThis.__fpCfg = { enabled: true, budgetMs: 3, longFrameMs: 24, spikeK: 2, maxRefuseFrames: 3, vegPerFrame: 1 };
fp.noteFinalizeFrame(0.0167); // a healthy frame
const afterGood = fp.mayFinalize(0);
rows.push(`  first chunk after a 50 ms frame: ${afterLong} · after a 16.7 ms frame: ${afterGood}`);
gate('2 RED-shape: after a long frame the FIRST chunk is deferred', afterLong === false);
gate('3 …and after a healthy frame it is not', afterGood === true);

// ------------------------------------------------- 4. rule 2, a shared budget
fp.resetFinalizePace();
globalThis.__fpCfg = { enabled: true, budgetMs: 3, longFrameMs: 24, spikeK: 2, maxRefuseFrames: 3, vegPerFrame: 1 };
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

// ------------------- 12-16. THE SHIPPED DEFECT: rule 1 tested a LEVEL
// As shipped, rule 1 was `lastDtMs <= longFrameMs` against a fixed 24 ms. Any
// machine steadily below ~41 fps has EVERY frame "long", so the first finalize
// of every frame was refused forever and no chunk ever landed — buildings never
// appear. 30 fps is 33 ms; 20 fps is 50 ms. The build container (300-1000 ms
// frames) only made a graded failure absolute: pass 2's flash-guard census read
// 0 meshes / 0 tris at Powell AND Manhattan after the same 60 s settle that gave
// 31,576 / 126,116 tris in pass 1.
//
// These four rows are the RED. Run them against the shipped rule and 14 fails
// (steady-slow never finalizes) and 16 fails (the train never admits).
const feed = (dts) => {
  fp.resetFinalizePace();
  globalThis.__fpCfg = { enabled: true, budgetMs: 3, longFrameMs: 24, spikeK: 2, maxRefuseFrames: 3, vegPerFrame: 1 };
  const admits = [];
  for (const ms of dts) {
    fp.noteFinalizeFrame(ms / 1000);
    admits.push(fp.mayFinalize(0));
  }
  return admits;
};

// (a) STEADY SLOW — a 30 fps laptop. Every frame is over longFrameMs, and none
//     of them is a spike, so every frame must finalize.
const steady = feed(Array(40).fill(33));
gate('14 steady-slow (33 ms every frame, ~30 fps) finalizes on EVERY frame',
  steady.every((v) => v === true),
  `${steady.filter((v) => v).length}/${steady.length} frames admitted`);

// The same machine one notch slower, and the venue itself. These two do refuse
// a few frames at the very start, and that is the cap doing its job rather than
// a flaw worth hiding: the EMA is seeded at longFrameMs (24 ms), which is 20x
// below the venue's true frame time, so the baseline needs a handful of frames
// to climb to where 500 ms is no longer 2x it. maxRefuseFrames bounds the
// damage to three-in-a-row while it climbs. So assert the SHAPE that matters —
// bounded runs, and permanent admission once converged — not an arbitrary
// frame index.
const worstRunOf = (a) => {
  let r = 0;
  let w = 0;
  for (const ok of a) {
    r = ok ? 0 : r + 1;
    w = Math.max(w, r);
  }
  return w;
};
const steady20 = feed(Array(40).fill(50));
const venue = feed(Array(40).fill(500));
const converged = (a) => a.slice(-20).every((v) => v === true);
gate('15 …and so do 20 fps (50 ms) and the 1 fps fixture venue (500 ms), once the EMA has converged',
  converged(steady20) && converged(venue) && worstRunOf(steady20) <= 3 && worstRunOf(venue) <= 3,
  `20 fps ${steady20.filter((v) => v).length}/40 (worst run ${worstRunOf(steady20)}) · ` +
    `venue ${venue.filter((v) => v).length}/40 (worst run ${worstRunOf(venue)}) — ` +
    'cold-seed refusals only, capped at 3 in a row');

// (b) A REAL HITCH — one 40 ms frame amid 16.7 ms frames. Refused, and ONLY
//     that frame: rule 1 still does the job it was written for.
const hitch = feed([...Array(30).fill(16.7), 40, ...Array(5).fill(16.7)]);
const hitchIdx = hitch.indexOf(false);
gate('16 a single 40 ms hitch amid 16.7 ms frames is refused, and only that frame',
  hitchIdx === 30 && hitch.filter((v) => v === false).length === 1,
  `refused at frame ${hitchIdx} (expect 30), ${hitch.filter((v) => v === false).length} refusal(s)`);

// (c) A HITCH TRAIN — the starvation cap. However bad it gets, one frame in
//     every maxRefuseFrames+1 must land, or the world never streams in.
const train = feed([...Array(30).fill(16.7), ...Array(20).fill(200)]);
const tail = train.slice(30);
let run = 0;
let worstRun = 0;
for (const ok of tail) {
  run = ok ? 0 : run + 1;
  worstRun = Math.max(worstRun, run);
}
gate('17 a hitch TRAIN never defers more than maxRefuseFrames in a row',
  worstRun <= 3 && tail.some((v) => v === true),
  `worst consecutive refusals ${worstRun} (cap 3), ${tail.filter((v) => v).length}/20 admitted`);

// ------------------------- 18. the harness budget scaler (K) on rule 2
// Rule 1 needs no K seam: on a steady venue the EMA makes it a no-op by
// construction (gate 15), which is the proof the fix is the product's. What K
// still does is multiply rule 2's SHARED allowance, matching the five engine
// sites where E already scales the count budgets.
// THE DEFECT THIS PINS. FINALIZE_PACE shipped ON, and on the fixture venue
// every frame is 300-1000 ms against a 24 ms longFrameMs — so rule 1 refused
// the first finalize of EVERY frame and nothing ever finalized. Pass 2's
// flash-guard census read 0 meshes / 0 tris at Powell AND Manhattan after the
// same 60 s settle that gave 31,576 / 126,116 tris in pass 1. E's budgetK()
// scaled the COUNT budgets, but those sit behind this wall-clock rule.
//
// Both arms drive a 200 ms frame — worse than longFrameMs by 8x — so the only
// thing separating them is K. Gate 12 is today's shipped behaviour and must
// not move; gate 13 is the fix.
const hadWindow = 'window' in globalThis;
globalThis.__fpCfg = { enabled: true, budgetMs: 3, longFrameMs: 24, spikeK: 2, maxRefuseFrames: 3, vegPerFrame: 1 };

// K = 1: production, and every harness that does not set the global.
globalThis.window = { __flyFinalizeBudgetK: undefined };
fp.resetFinalizePace();
fp.noteFinalizeFrame(0.0167);
const k1Budget = fp.budgetLeftMs();

// K = 40: what E's content gates set.
globalThis.window = { __flyFinalizeBudgetK: 40 };
fp.resetFinalizePace();
fp.noteFinalizeFrame(0.0167);
const k40Budget = fp.budgetLeftMs();
if (!hadWindow) delete globalThis.window;

rows.push(`  shared budget — K=1 ${k1Budget.toFixed(1)} ms · K=40 ${k40Budget.toFixed(1)} ms`);
gate('18 the shared budget is budgetMs x budgetK(): unscaled at K=1, 3 x 40 ms at K=40',
  k1Budget > 2.5 && k1Budget <= 3 && k40Budget > 119 && k40Budget <= 120,
  `K=1 ${k1Budget.toFixed(2)} ms, K=40 ${k40Budget.toFixed(2)} ms`);

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
// The typed container is still the WB-10 win; gate 20 pins WHICH width and
// gate 19 pins that it reaches three wrapped. This row only says the boxed
// plain array is gone from the armed path.
gate('8 the toy merged index is built into a typed array when armed (WB-10)',
  /const merged = new \(needs32 \? Uint32Array : Uint16Array\)\(base \+ extra\);/.test(toy) &&
    /merged\.set\(groundIdx, 0\);/.test(toy));
gate('9 …and the upstream spread survives verbatim on the flag-off branch',
  /idx = data\n\s+\? \[\.\.\.groundIdx, \.\.\.Array\.from\(data\.idx, \(v\) => v \+ w \* w\)\]\n\s+: groundIdx;/.test(toy));

// ------------- 19-22. WB-10's index buffer: WRAPPED, and the RIGHT WIDTH
// THE DEFECT. `BufferGeometry.setIndex(x)` wraps x in a BufferAttribute ONLY
// when `Array.isArray(x)` (three r185, three.core.js:18404). A TYPED array is
// assigned RAW as `geometry.index`, so it has no `.array` and WebGLAttributes
// throws on `attribute.array.byteLength` at first upload. WB-10 changed the
// merged land index from a plain array to a Uint32Array and kept the bare
// `setIndex(idx)`, so the flag-ON path broke every land mesh — the pass-2b
// toy-boot pageerror (x31 ladder-fix, x3 ladder-red, both arms), attributed by
// B's headless attribute census (r24-b-attr-proof): FINALIZE_PACE ON = 80
// broken LAND meshes, OFF = 0. The flag-OFF branch is a plain array, which
// three wraps — which is why pass 1 was clean and pass 2b was not.
gate('19 the merged land index is WRAPPED in a BufferAttribute, never passed raw',
  /idx = new BufferAttribute\(merged, 1\);/.test(toy) && !/geo\.setIndex\(new Uint/.test(toy));

// And the width must MIRROR three's own choice, or the ON path silently
// doubles every toy land index buffer — the opposite of what WB-10 is for.
gate('20 the container width mirrors three’s arrayNeedsUint32 rather than defaulting to 32-bit',
  /new \(needs32 \? Uint32Array : Uint16Array\)\(base \+ extra\)/.test(toy) &&
    /const INDEX_U32_MIN = 65535;/.test(toy));

// three's threshold is >= 65535, NOT > 65535 (PRIMITIVE_RESTART_FIXED_INDEX,
// three #24565). Read it out of three's real source so a future three bump
// that moves it fails here instead of silently desynchronising the two paths.
const threeSrc = readFileSync(path.join(root, 'node_modules/three/build/three.core.js'), 'utf8');
const needs32Src = threeSrc.slice(
  threeSrc.indexOf('function arrayNeedsUint32'),
  threeSrc.indexOf('function arrayNeedsUint32') + 500
);
const threeBound = /array\[ i \] >= (\d+)/.exec(needs32Src)?.[1];
gate('21 …and that threshold is still the number three actually uses',
  threeBound === '65535', `three says >= ${threeBound}, we say >= 65535`);

// The DECISION itself, executed — not restated. The two declarations are
// module-level and import nothing, so they can be lifted verbatim and run.
const decl = [
  /const INDEX_U32_MIN = \d+;/.exec(toy)?.[0],
  /function anyAtLeast\(arr, min\) \{[\s\S]*?\n\}/.exec(toy)?.[0],
].filter(Boolean);
let widthRows = [];
if (decl.length === 2) {
  const dshim = path.join(out, `.wb10-${process.pid}.mjs`);
  writeFileSync(dshim, `${decl.join('\n')}\nexport { INDEX_U32_MIN, anyAtLeast };\n`);
  const wb = await import(pathToFileURL(dshim).href);
  rmSync(dshim, { force: true });
  // three's own predicate, over the array the flag-OFF branch actually builds.
  const threeWants32 = (arr) => {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] >= 65535) return true;
    return false;
  };
  // ON's decomposition: ground values, plus overlay values shifted by off.
  const mine32 = (ground, overlay, off) =>
    wb.anyAtLeast(ground, wb.INDEX_U32_MIN) ||
    (overlay.length > 0 && wb.anyAtLeast(overlay, wb.INDEX_U32_MIN - off));
  const cases = [
    ['a small chunk', [0, 5, 900], [0, 3], 1024],
    ['exactly at the bound (65535 must be 32-bit — three #24565)', [65535], [], 4096],
    ['one below the bound', [65534], [], 4096],
    ['the OVERLAY is what crosses it', [10, 20], [1000], 65000],
    ['the overlay crosses it exactly', [10], [535], 65000],
    ['no overlay at all', [4, 4095], [], 4096],
    ['an empty overlay array with a huge offset', [7], [], 70000],
  ];
  const bad = [];
  for (const [name, ground, overlay, off] of cases) {
    const merged = [...ground, ...overlay.map((v) => v + off)];
    const want = threeWants32(merged);
    const got = mine32(ground, overlay, off);
    widthRows.push(`  ${want === got ? 'ok  ' : 'BAD '} ${name}: three ${want ? 'u32' : 'u16'} · ours ${got ? 'u32' : 'u16'}`);
    if (want !== got) bad.push(name);
  }
  gate('22 the ON width decision equals three’s answer on the OFF array, case by case',
    bad.length === 0, bad.length ? bad.join(' · ') : `${cases.length} cases agree`);
} else {
  gate('22 the ON width decision equals three’s answer on the OFF array, case by case',
    false, 'could not lift INDEX_U32_MIN / anyAtLeast from the engine source');
}
rows.push(...widthRows);

const veg = readFileSync(path.join(root, 'lib/fly/toy-world/sat-veg-engine.js'), 'utf8');
// E (pass 2b): the cap now carries the harness scaler, at A's request — this
// was the ONE budget site of six that budgetK() missed, so at ~1 fps the venue
// committed one veg chunk per second and any veg reading was partly populated.
// `budgetK()` is exactly 1 without FLY_FINALIZE_BUDGET_K, so the production
// arithmetic is unchanged; the assertion moves with the expression it pins,
// and gains the scaler as a REQUIREMENT rather than merely tolerating it.
gate('10 the veg commit is capped per frame (A9), and the cap carries the harness scaler',
  /committed < cap/.test(veg) &&
    /finalizePaceOn\(\) \? Math\.max\(1, FINALIZE_PACE\.vegPerFrame \* budgetK\(\)\)/.test(veg) &&
    /from '\.\.\/harness-budget'/.test(veg));

// ------------------------- 23. the SEVENTH harness-budget site
// E CERT (pass 2b) attributed the pass's longest stall — 3660 ms under
// [finalize:sat-roads x16] — to sat-road-engine.js's finalize bound being a
// bare module const that budgetK() never touched. At K=40/200 every other
// engine speeds up and roads does not, so the road ring starves and the stall
// concentrates exactly where markPhase pointed. Same idiom as the veg site.
const road = readFileSync(path.join(root, 'lib/fly/toy-world/sat-road-engine.js'), 'utf8');
gate('23 the sat-road finalize bound carries the harness scaler (E CERT’s seventh site)',
  /const perFrame = Math\.max\(1, FINALIZE_PER_FRAME \* budgetK\(\)\);/.test(road) &&
    /done < perFrame;/.test(road) &&
    /from '\.\.\/harness-budget'/.test(road));

// INFO, not a gate, and deliberately so: five of the seven budget sites do not
// exist on this branch — they are E's, and they arrive at the merge. A census
// that asserted "all seven carry the scaler" would be red here and green only
// after integration, which is a gate that measures the branch rather than the
// code. Promote it to a gate on the merged tree.
{
  const SITES = [
    ['sat-building finalize', 'lib/fly/toy-world/sat-building-engine.js', /finalizePerFrame \* budgetK\(\)/],
    ['sat-building drape', 'lib/fly/toy-world/sat-building-engine.js', /drapeBudgetMs \* budgetK\(\)/],
    ['sat-skyline finalize', 'lib/fly/toy-world/sat-skyline-engine.js', /finalizePerFrame \* budgetK\(\)/],
    ['sat-skyline drape', 'lib/fly/toy-world/sat-skyline-engine.js', /drapeBudgetMs \* budgetK\(\)/],
    ['toy-world finalize', 'lib/fly/toy-world/toy-world-engine.js', /finalizePerFrame \* budgetK\(\)/],
    ['toy-world drape', 'lib/fly/toy-world/toy-world-engine.js', /drapeBudgetMs \* budgetK\(\)/],
    ['sat-road drape', 'lib/fly/toy-world/sat-road-engine.js', /drapeBudgetMs \* budgetK\(\)/],
    ['sat-veg commit', 'lib/fly/toy-world/sat-veg-engine.js', /vegPerFrame \* budgetK\(\)/],
    ['sat-road finalize', 'lib/fly/toy-world/sat-road-engine.js', /FINALIZE_PER_FRAME \* budgetK\(\)/],
  ];
  const have = SITES.filter(([, rel, re]) => re.test(readFileSync(path.join(root, rel), 'utf8')));
  rows.push(
    `  harness-budget sites carrying budgetK() on THIS branch: ${have.length}/${SITES.length}` +
      ` — ${have.map(([n]) => n).join(', ') || 'none'}`
  );
  console.log(
    `INFO  budget-site census: ${have.length}/${SITES.length} carry budgetK() here` +
      ' (five are E’s and land at the merge; promote to a gate on the merged tree)'
  );
}

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
