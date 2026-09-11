/**
 * R25 (Fable, W0) — verify-ground-bubble-k: the GROUND_BUBBLE math, in node.
 *
 * Proves the three properties every R25 reader relies on before any browser
 * gate exists: (1) the band endpoints are exact; (2) the input deadband makes
 * a DEM-refinement-sized wobble invisible and a 480→560→480 m sweep moves k
 * ONCE; (3) the settle is frame-rate independent and reaches its target
 * exactly; (4) a warp snaps. No constants import — the config is the plan's
 * shipped shape, spelled here so a knob move in fly-constants.js is a
 * deliberate re-baseline, not a silent one.
 *
 * RUN: node scripts/verify-ground-bubble-k.mjs
 */
import { createBubbleState, stepBubble, bubbleTarget } from '../lib/fly/ground-bubble.js';

const cfg = { enabled: true, aglInM: 500, aglOutM: 700, hysteresisM: 60, smoothSec: 0.6 };
let pass = 0, fail = 0;
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const settle = (s, agl, epoch = 1, frames = 600, dt = 1 / 60) => {
  let k = 0;
  for (let i = 0; i < frames; i++) k = stepBubble(s, agl, dt, cfg, epoch);
  return k;
};

// (1) endpoints
gate('(1a) k = 1 at and below aglInM', bubbleTarget(500, cfg) === 1 && bubbleTarget(80, cfg) === 1);
gate('(1b) k = 0 at and above aglOutM', bubbleTarget(700, cfg) === 0 && bubbleTarget(3500 / 3.281, cfg) === 0);
gate('(1c) k = 0.5 at the band midpoint', Math.abs(bubbleTarget(600, cfg) - 0.5) < 1e-12);

// (2) deadband: a wobble smaller than the band never moves k
{
  const s = createBubbleState();
  const k0 = settle(s, 600);
  let moved = false;
  for (let i = 0; i < 300; i++) {
    const wobble = 600 + 40 * Math.sin(i / 7); // ±40 m, inside the 60 m band
    const k = stepBubble(s, wobble, 1 / 60, cfg, 1);
    if (k !== k0) moved = true;
  }
  gate('(2a) a ±40 m DEM wobble inside the 60 m band moves k by exactly 0', !moved, `k held at ${k0.toFixed(4)}`);
  // the plan's sweep: 480 → 560 → 480 with h = 60 moves the filtered AGL once (to 500)
  const t = createBubbleState();
  settle(t, 480);
  const kA = t.k;
  settle(t, 560);
  const kB = t.k;
  settle(t, 480);
  const kC = t.k;
  gate(
    '(2b) 480 → 560 → 480 m moves k ONCE (filtered AGL 480 → 500, then holds)',
    kA === 1 && kB === bubbleTarget(500, cfg) && kC === kB && t.aglH === 500,
    `k ${kA} → ${kB.toFixed(4)} → ${kC.toFixed(4)}, aglH ${t.aglH}`
  );
}

// (3) settle: frame-rate independent, reaches the target exactly
{
  const a = createBubbleState();
  const b = createBubbleState();
  settle(a, 3000); settle(b, 3000);
  // descend to 80 m: 60 Hz vs 30 Hz over the same 1.2 s
  let ka = 0, kb = 0;
  for (let i = 0; i < 72; i++) ka = stepBubble(a, 80, 1 / 60, cfg, 1);
  for (let i = 0; i < 36; i++) kb = stepBubble(b, 80, 1 / 30, cfg, 1);
  gate('(3a) 60 Hz and 30 Hz agree within 0.02 after 1.2 s of descent', Math.abs(ka - kb) < 0.02, `${ka.toFixed(4)} vs ${kb.toFixed(4)}`);
  gate('(3b) ~2 time constants reach ≥ 0.85', ka > 0.85, ka.toFixed(4));
  const kEnd = settle(a, 80);
  gate('(3c) the settled k is EXACTLY 1, not an asymptote', kEnd === 1);
  const kUp = settle(a, 900);
  gate('(3d) the settled k above the band is EXACTLY 0', kUp === 0);
}

// (4) warp snaps
{
  const s = createBubbleState();
  settle(s, 3000, 1);
  const k = stepBubble(s, 80, 1 / 60, cfg, 2); // epoch change
  gate('(4) an epoch change snaps k to the target in one frame', k === 1, String(k));
}

console.log(`\nverify-ground-bubble-k: ${pass} passed, ${fail} failed`);
console.log(fail === 0 ? 'VERIFY: PASS' : 'VERIFY: FAIL');
process.exit(fail === 0 ? 0 : 1);
