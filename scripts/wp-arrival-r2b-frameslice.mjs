/** WORLD PASS B r2b: lib/fly/toy-world/wp-frame-slice.js, the one finalize allowance a frame
 * shared by ARRIVAL's slices and a finalize that cannot be sliced (REACH's stand-in group).
 * Simulated frames with a fake document.timeline:
 *  (1) never both in one frame, in either order of the two engines in a frame;
 *  (2) neither starves while both always have work;
 *  (3) against a model of the shared R24 brake (finalize-pace.js mayFinalize, owner path: a FIFO of
 *      refused owners forgotten after two frames, at most two admissions a frame, random refusals
 *      for other engines' work), both still get admitted (no livelock); RED check: the round-2b first
 *      version (strict alternation) livelocks in the same model;
 *  (4) permissive without a timeline.
 *   node scripts/wp-arrival-r2b-frameslice.mjs
 */
import { wpSliceMayRun, wpSliceSpend, wpWholeFinalize, resetWpFrameSlice } from '../lib/fly/toy-world/wp-frame-slice.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
ok(wpSliceMayRun() && wpWholeFinalize() && wpWholeFinalize(), 'permissive without a timeline');
globalThis.document = { timeline: { currentTime: 0 } };

// The strict alternation the first round-2b build shipped (kept here as the RED calibration).
function strictAlternation() {
  let frame = null, n = 0, spent = 0, whole = false, sliceWantAt = -2, wholeWantAt = -2;
  const roll = () => { const f = document.timeline.currentTime; if (f !== frame) { frame = f; n++; spent = 0; whole = false; } };
  return {
    may() { roll(); if (whole || (wholeWantAt === n - 1 && spent === 0 && sliceWantAt !== n - 1)) { sliceWantAt = n; return false; } return true; },
    spend(ms) { roll(); spent += ms; },
    whole() { roll(); if (whole || spent > 0 || sliceWantAt === n - 1) { if (!whole) wholeWantAt = n; return false; } whole = true; return true; },
  };
}
const shipped = { may: wpSliceMayRun, spend: wpSliceSpend, whole: wpWholeFinalize };

// A model of the shared brake's owner path (finalize-pace.js mayFinalize / noteFinalizeFrame).
function brake(seed) {
  let frameId = 0, admitted = 0, s = seed;
  const waiting = new Map();
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  return {
    note() { frameId++; admitted = 0; for (const [o, seen] of waiting) if (frameId - seen > 1) waiting.delete(o); if (rnd() < 0.3 && this.may('sat-veg')) {} },
    may(owner) {
      const first = waiting.keys().next().value;
      const overBudget = admitted > 0 && rnd() < 0.5;
      if (admitted >= 2 || (first && first !== owner) || overBudget) { waiting.set(owner, frameId); return false; }
      waiting.delete(owner); admitted++; return true;
    },
  };
}

function run(M, order, B, frames = 4000) {
  M === shipped && resetWpFrameSlice();
  let both = 0, bSlices = 0, sGrants = 0, bCommits = 0, sAdmits = 0, prepped = 0, lastB = 0, lastS = 0, gapB = 0, gapS = 0, t = 1e6 * Math.random();
  for (let f = 1; f <= frames; f++) {
    document.timeline.currentTime = t += 16.7;
    B?.note();
    let b = false, s = false;
    const runB = () => {
      if (!M.may()) return;
      b = true; bSlices++;
      if (prepped >= 3 && (!B || B.may('sat-building'))) { prepped = 0; bCommits++; lastB = f; } else if (prepped < 3) prepped++;
      M.spend(2.5);
    };
    const runS = () => { if (!M.whole()) return; s = true; sGrants++; if (!B || B.may('sat-skyline')) { sAdmits++; lastS = f; } };
    if (order === 'b-first') { runB(); runS(); } else { runS(); runB(); }
    if (b && s) both++;
    gapB = Math.max(gapB, f - lastB); gapS = Math.max(gapS, f - lastS);
  }
  return { both, bSlices, sGrants, bCommits, sAdmits, gapB, gapS };
}

for (const order of ['b-first', 's-first']) {
  const r = run(shipped, order, null, 1000);
  ok(r.both === 0, `${order}: both in one frame ${r.both}`);
  ok(r.bSlices >= 200 && r.sGrants >= 200, `${order}: starvation, slice frames ${r.bSlices}, whole frames ${r.sGrants}`);
  console.log(`${order}: 1000 frames, both ${r.both}, slice frames ${r.bSlices}, whole frames ${r.sGrants}`);
  let worst = null;
  for (let seed = 1; seed <= 20; seed++) {
    const q = run(shipped, order, brake(seed));
    if (!worst || Math.max(q.gapB, q.gapS) > Math.max(worst.gapB, worst.gapS)) worst = q;
  }
  ok(worst.both === 0 && worst.gapB < 200 && worst.gapS < 200, `${order} with the brake model: longest wait without an admission ${worst.gapB} (building) / ${worst.gapS} (skyline) frames`);
  console.log(`${order} with the brake model, 20 seeds x 4000 frames: longest wait without an admission ${worst.gapB} (building) / ${worst.gapS} (skyline) frames; commits ${worst.bCommits}, skyline admissions ${worst.sAdmits}`);
  let red = 0;
  for (let seed = 1; seed <= 20; seed++) { const q = run(strictAlternation(), order, brake(seed)); red = Math.max(red, q.gapB, q.gapS); }
  console.log(`  RED (round-2b first build, strict alternation): longest wait ${red} frames ${red >= 1000 ? '(livelock reproduced)' : '(NOT reproduced)'}`);
  ok(red >= 1000, `${order}: the RED calibration did not reproduce the livelock (${red})`);
}
console.log(fails ? `FAIL ${fails}` : 'PASS wp-frame-slice');
process.exit(fails ? 1 : 0);
