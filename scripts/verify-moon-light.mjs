#!/usr/bin/env node
/**
 * ROUND 25 (C LIGHT) — verify-moon-light: THE MOON IS A LIGHT, AND DAYLIGHT
 * DOES NOT MOVE. A NODE gate: pure arithmetic, no renderer, no GPU, no network,
 * so it means exactly the same thing in this container and on the user's
 * machine (which is more than any pixel gate here can say).
 *
 * ---------------------------------------------------------------------------
 * THE RED IT IS CALIBRATED AGAINST (r25/c base 6bf628e, LIGHT_BUBBLE_R25 off)
 * ---------------------------------------------------------------------------
 * `immersiveLighting()` (lib/fly/immersive.js:19-38) returns a night key of
 * EXACTLY 0.09 at every phase of the moon, every night of the year, forever —
 * recon L2/L4. R24's ONE_SUN blends the key DIRECTION toward `moonDirFromSun`
 * below the horizon and explicitly leaves intensity and colour alone
 * (fly-constants.js:5269-5281), so a full moon and a new moon light the world
 * identically and "moonlit" is a colour, not a quantity. Clause (4) below is
 * that RED as a number: on the flag-off tree the key at illum 0 and the key at
 * illum 1 differ by 0.000.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE ORACLE IS
 * ---------------------------------------------------------------------------
 * A VERBATIM copy of the R24 function lives in this file (R24_LIGHTING below).
 * Not a re-derivation and not an import: the whole point is to compare the
 * shipping function against a frozen transcript of the one it replaces, so a
 * later edit to the shipping file cannot quietly move the thing the gate is
 * comparing to. The two cloud constants are read from the module's own
 * IMMERSIVE block, because those are not C's numbers and a future clouds
 * change must not read as a moon defect — everything else is literal.
 *
 * THE IDENTITY CLAIM, stated precisely, because "daytime" is not a bound:
 *   the moon terms are DELTAS scaled by `w = (1 - day) * up`, and
 *     · `up` = smooth(-8, 0, -elevation) is EXACTLY 0 at elevation >= 8 deg
 *     · `1 - day` is EXACTLY 0 at elevation >= 16 deg
 *   so at 8 deg and above the flag cannot move a single bit, WITH the moon
 *   payload attached. That is what clause (1) samples 200 times, and clause
 *   (2) is the tighter `day === 1` leg the charter names.
 *
 * GATES
 *   (0) the phase math: new/full/quarter/periodicity/negative clocks
 *   (1) 200 elevations in [8, 90] deg: flag ON === R24, bit for bit
 *   (2) `day === 1` identity, at full moon, new moon and every overcast
 *   (3) 400 elevations in [-90, 90]: flag OFF === R24, bit for bit
 *   (4) AT NIGHT THE KEY VARIES WITH illum (the RED) and with `up`
 *   (5) the NEW-MOON FLOOR: a moonless night is darker than R24, not black
 *   (6) env and fill follow, and every number stays finite everywhere
 *   (7) monotone in illum, and the full-moon key is the block's keyFull + 0.02
 *   (8) the RUNG QUANTISER: 8 rungs, endpoints exact, hysteresis holds
 *
 * Run: node scripts/verify-moon-light.mjs
 */
import fs from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');

let pass = 0;
let fail = 0;
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// --- the module under test, loaded the way immersive-unit.mjs loads it ------
// (a `data:` URL — which is also the reason lib/fly/immersive.js may never
// grow an import: a relative specifier cannot resolve from a data URL at all.)
const dataUrl = (file) =>
  `data:text/javascript;base64,${fs.readFileSync(new URL('lib/fly/' + file, ROOT)).toString('base64')}`;
const { IMMERSIVE, immersiveLighting, moonIllum } = await import(dataUrl('immersive.js'));

gate(
  '(pre) lib/fly/immersive.js is still IMPORT-FREE',
  !/^\s*import\s/m.test(read('lib/fly/immersive.js')),
  'scripts/immersive-unit.mjs and this gate both load it as a data: URL, where a relative specifier cannot resolve'
);

// --- light-bubble.js, whose imports ARE stripped (the verify-shadow-calm idiom).
// It is loaded DEFENSIVELY: on the flag-off tree this file does not exist, and
// the RED calibration run must report that as a failing clause rather than as
// an uncaught ENOENT that takes every other clause's verdict with it.
let lb = null;
try {
  const LB_SRC = read('lib/fly/light-bubble.js')
    .replace(/^import .*?;$/gm, '')
    .replace(/\bexport\s+(function|const)\b/g, '$1');
  lb = new Function(
    'moonIllum',
    'r25Block',
    'r25On',
    `${LB_SRC}\nreturn { stepShadowRadius, createShadowRungState, shadowTexelM, moonPayload, hemiGroundFor, moonDiscBrightness };`
  )(moonIllum, () => ({}), () => false);
} catch (e) {
  gate('(pre-b) lib/fly/light-bubble.js LOADS', false, `${e.message} — on the flag-off tree this module does not exist yet`);
}

// --- the constants block, read as SOURCE (no bundler here) -----------------
const CONST_SRC = read('lib/fly/fly-constants.js');
const constBlock = (name, tail) => {
  const t = CONST_SRC.slice(CONST_SRC.indexOf(`export const ${name}`));
  return new Function(`return ${t.slice(t.indexOf('{'), t.indexOf(tail) + 1)}`)();
};
const LIGHT_BUBBLE_R25 = constBlock('LIGHT_BUBBLE_R25', '}; // owner C');
const GROUND_BUBBLE = constBlock('GROUND_BUBBLE', '}; // owner Fable (shared)');
// The SHARED substrate's own filter — the pipeline k really comes out of.
const { createBubbleState, stepBubble } = await import(dataUrl('ground-bubble.js'));

/* ===========================================================================
 * THE ORACLE — lib/fly/immersive.js @ R24 (main f0cd81e), verbatim.
 * =========================================================================== */
const clamp01_R24 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const smooth_R24 = (a, b, v) => {
  const t = clamp01_R24((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
function R24_LIGHTING(sun = {}, weather = {}) {
  const elevation = (Math.asin(Math.min(1, Math.max(-1, sun.sinEl ?? 1))) * 180) / Math.PI;
  const day = smooth_R24(-6, 16, elevation);
  const night = 1 - smooth_R24(-12, -2, elevation);
  const overcast = clamp01_R24(weather.overcastT);
  const presence = clamp01_R24(weather.presenceFrac ?? 1);
  const golden = smooth_R24(-5, 1, elevation) * (1 - smooth_R24(8, 25, elevation)) * (1 - overcast);
  return {
    day,
    night,
    golden,
    overcast,
    sun: (0.09 + 2.5 * day) * (1 - 0.83 * overcast),
    fill: (0.1 + 0.34 * day) * (1 + 0.42 * overcast),
    environment: (0.14 + 0.38 * day) * (1 + 0.15 * overcast),
    cloudCoverage: 0.26 + 0.17 * presence + 0.35 * overcast,
    cloudBase: IMMERSIVE.clouds.baseM, // not C's number — see the header
    cloudThickness: IMMERSIVE.clouds.thicknessM * (1 + 0.5 * overcast),
    haze: 0.28 + 0.72 * day,
  };
}
const R24_KEYS = Object.keys(R24_LIGHTING({ sinEl: 1 }));

const sinElOf = (deg) => Math.sin((deg * Math.PI) / 180);
const MOON_CFG = LIGHT_BUBBLE_R25.moon;
// The payload the rig publishes on runtime.sun. With light-bubble.js absent
// (the flag-off tree) it is built here from the same block, so the moon clauses
// still MEASURE the shipping function instead of skipping.
const payload = (illum, extra = {}) =>
  lb
    ? lb.moonPayload({ ...MOON_CFG, illumOverride: illum, ...extra }, 0, {})
    : { illum, up: extra.upOverride, keyNew: MOON_CFG.keyNew, keyFull: MOON_CFG.keyFull, envNew: MOON_CFG.envNew, envFull: MOON_CFG.envFull, fillGain: MOON_CFG.fillGain };

/** Compare every R24 key with Object.is; report the first disagreement. */
function diffR24(got, want) {
  for (const k of R24_KEYS) {
    if (!Object.is(got[k], want[k])) {
      return `${k}: ${got[k]} !== ${want[k]} (Δ ${got[k] - want[k]})`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// (0) the phase math
// ---------------------------------------------------------------------------
if (typeof moonIllum !== 'function') {
  // The flag-off tree: lib/fly/immersive.js exports no phase at all, which is
  // the FIRST half of the RED (the second is clause 4's 0.0000 key delta).
  gate('(0) SYNODIC PHASE', false, 'lib/fly/immersive.js exports no `moonIllum` — there is no moon phase anywhere in the app');
  gate('(0b) THE MODEL IS A MEAN LUNATION, DECLARED', false, 'no `moonIllum` to measure');
} else {
  const E = MOON_CFG.epochNewMoonMs;
  const P = MOON_CFG.synodicDays * 86400000;
  const at = (ms) => moonIllum(ms, E, P / 86400000);
  const near = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol;
  const newMoon = at(E).illum;
  const full = at(E + P / 2).illum;
  const q1 = at(E + P / 4).illum;
  const wrapped = at(E + P * 37.5).illum;
  const negative = at(E - P / 2).illum;
  gate(
    '(0) SYNODIC PHASE — new 0, full 1, quarter 0.5, periodic, and correct BEFORE the epoch',
    near(newMoon, 0) && near(full, 1) && near(q1, 0.5) && near(wrapped, 1, 1e-9) && near(negative, 1, 1e-9),
    `new ${newMoon.toExponential(2)} · full ${full.toFixed(12)} · Q1 ${q1.toFixed(12)} · +37.5 lunations ${wrapped.toFixed(9)} · −0.5 ${negative.toFixed(9)}`
  );
  // A mean lunation is not an ephemeris, and the gate says so with a number:
  // over 26 years the phase of a named date drifts by this much of a cycle.
  const drift = Math.abs(at(Date.UTC(2026, 8, 11)).phase - at(Date.UTC(2026, 8, 11) + 1000 * 60 * 60 * 14).phase);
  gate(
    '(0b) THE MODEL IS A MEAN LUNATION, DECLARED — 14 h of phase error is < 2 % of a cycle',
    drift < 0.02,
    `14 h = ${(drift * 100).toFixed(2)} % of a synodic month; plan §8 rules out an ephemeris this round`
  );
}

// ---------------------------------------------------------------------------
// (1) 200 daytime elevations, flag ON, bit for bit
// ---------------------------------------------------------------------------
{
  let worst = null;
  let checked = 0;
  for (let i = 0; i < 200; i++) {
    const el = 8 + (82 * i) / 199; // [8, 90]
    for (const illum of [0, 0.5, 1]) {
      for (const wx of [{}, { overcastT: 1 }, { overcastT: 0.37, presenceFrac: 0.2 }]) {
        const sun = { sinEl: sinElOf(el), moon: payload(illum) };
        const d = diffR24(immersiveLighting(sun, wx), R24_LIGHTING(sun, wx));
        checked++;
        if (d && !worst) worst = `el ${el.toFixed(3)}° illum ${illum} — ${d}`;
      }
    }
  }
  gate(
    '(1) FLAG ON, SUN AT OR ABOVE 8° — every R24 number bit for bit',
    worst == null,
    worst ?? `${checked} comparisons across 200 elevations × 3 phases × 3 weathers, all Object.is-equal`
  );
  // The extra key is allowed and its WEIGHT must be exactly zero: that is the
  // property the identity rests on, so it is asserted rather than inferred.
  const noon = immersiveLighting({ sinEl: 1, moon: payload(1) });
  const extra = Object.keys(noon).filter((k) => !R24_KEYS.includes(k));
  gate(
    '(1b) THE ONLY ADDED KEY IS `moon`, AND ITS WEIGHT IS EXACTLY 0 IN DAYLIGHT',
    extra.length === 1 && extra[0] === 'moon' && Object.is(noon.moon.k, 0) && Object.is(noon.moon.up, 0),
    `extra keys ${JSON.stringify(extra)} · k ${noon.moon?.k} · up ${noon.moon?.up}`
  );
}

// ---------------------------------------------------------------------------
// (2) day === 1 identity
// ---------------------------------------------------------------------------
{
  const fails = [];
  for (const el of [16, 16.0001, 23, 45, 66.5, 89.999, 90]) {
    for (const illum of [0, 0.25, 1]) {
      for (const wx of [{}, { overcastT: 1 }, { overcastT: 0.5 }]) {
        const sun = { sinEl: sinElOf(el), moon: payload(illum, { upOverride: 1 }) };
        const got = immersiveLighting(sun, wx);
        if (!Object.is(got.day, 1)) fails.push(`el ${el} day=${got.day}`);
        const d = diffR24(got, R24_LIGHTING(sun, wx));
        if (d) fails.push(`el ${el} illum ${illum} — ${d}`);
      }
    }
  }
  gate(
    '(2) day === 1 ⇒ THE R24 EXPRESSION, even with `up` FORCED to 1',
    fails.length === 0,
    fails[0] ?? 'the (1 − day) factor is exactly 0, so no moon term can reach a noon frame at all'
  );
}

// ---------------------------------------------------------------------------
// (3) flag OFF, everywhere
// ---------------------------------------------------------------------------
{
  let bad = null;
  for (let i = 0; i < 400; i++) {
    const el = -90 + (180 * i) / 399;
    for (const wx of [{}, { overcastT: 1 }, { overcastT: 0.2, presenceFrac: 0.05 }]) {
      const sun = { sinEl: sinElOf(el) }; // no `moon` — exactly what the rig publishes when off
      const d = diffR24(immersiveLighting(sun, wx), R24_LIGHTING(sun, wx));
      if (d && !bad) bad = `el ${el.toFixed(3)}° — ${d}`;
    }
  }
  const offKeys = Object.keys(immersiveLighting({ sinEl: -1 }));
  gate(
    '(3) FLAG OFF — 400 elevations from −90° to +90°, bit for bit, and NO `moon` key at all',
    bad == null && offKeys.length === R24_KEYS.length,
    bad ?? `keys ${offKeys.length} === R24's ${R24_KEYS.length}; with the rig unmounted there is no sun.moon to read`
  );
}

// ---------------------------------------------------------------------------
// (4) THE RED: at night the key varies with illum and with `up`
// ---------------------------------------------------------------------------
{
  const night = (illum, up) => immersiveLighting({ sinEl: sinElOf(-20), moon: payload(illum, { upOverride: up }) });
  const kNew = night(0, 1).sun;
  const kFull = night(1, 1).sun;
  const kDown = night(1, 0).sun;
  const r24Night = R24_LIGHTING({ sinEl: sinElOf(-20) }).sun;
  gate(
    '(4) THE RED — the night key MOVES with the phase of the moon',
    kFull - kNew > 0.1,
    `new ${kNew.toFixed(4)} → full ${kFull.toFixed(4)} (Δ ${(kFull - kNew).toFixed(4)}); R24 is ${r24Night.toFixed(4)} at BOTH — that 0.0000 is the defect`
  );
  gate(
    '(4b) A MOON BELOW THE HORIZON IS NOT A LIGHT — up 0 returns the R24 key exactly',
    Object.is(kDown, r24Night),
    `up=0 ⇒ ${kDown} === R24 ${r24Night}`
  );
  gate(
    '(4c) FULL MOON IS BRIGHTER THAN R24 NIGHT, NEW MOON IS DARKER',
    kFull > r24Night && kNew < r24Night,
    `new ${kNew.toFixed(4)} < R24 ${r24Night.toFixed(4)} < full ${kFull.toFixed(4)}`
  );
}

// ---------------------------------------------------------------------------
// (5) the new-moon floor
// ---------------------------------------------------------------------------
{
  const deep = immersiveLighting({ sinEl: sinElOf(-40), moon: payload(0, { upOverride: 1 }) });
  const want = MOON_CFG.keyNew + 0.02;
  gate(
    '(5) THE NEW-MOON FLOOR — a moonless night is keyNew + 0.02, never zero',
    Math.abs(deep.sun - want) < 1e-12 && deep.sun > 0 && deep.environment > 0,
    `key ${deep.sun.toFixed(6)} (want ${want}) · env ${deep.environment.toFixed(6)} · fill ${deep.fill.toFixed(6)}`
  );
}

// ---------------------------------------------------------------------------
// (6) env + fill follow, and nothing is ever NaN
// ---------------------------------------------------------------------------
{
  const n0 = immersiveLighting({ sinEl: sinElOf(-20), moon: payload(0, { upOverride: 1 }) });
  const n1 = immersiveLighting({ sinEl: sinElOf(-20), moon: payload(1, { upOverride: 1 }) });
  let finite = true;
  for (let el = -90; el <= 90; el += 0.25) {
    for (const illum of [0, 0.31, 1]) {
      const s = immersiveLighting({ sinEl: sinElOf(el), moon: payload(illum) }, { overcastT: 0.5 });
      for (const k of R24_KEYS) if (!Number.isFinite(s[k])) finite = false;
      if (s.moon && (!Number.isFinite(s.moon.k) || !Number.isFinite(s.moon.up))) finite = false;
    }
  }
  gate(
    '(6) ENVIRONMENT AND FILL FOLLOW THE MOON TOO, and every number is finite at every elevation',
    n1.environment > n0.environment && n1.fill > n0.fill && finite,
    `env ${n0.environment.toFixed(4)} → ${n1.environment.toFixed(4)} · fill ${n0.fill.toFixed(4)} → ${n1.fill.toFixed(4)} · 2,163 finite checks`
  );
}

// ---------------------------------------------------------------------------
// (7) monotone, and the full-moon endpoint is the block's number
// ---------------------------------------------------------------------------
{
  let mono = true;
  let prev = -Infinity;
  for (let i = 0; i <= 40; i++) {
    const v = immersiveLighting({ sinEl: sinElOf(-30), moon: payload(i / 40, { upOverride: 1 }) }).sun;
    if (v < prev) mono = false;
    prev = v;
  }
  const full = immersiveLighting({ sinEl: sinElOf(-30), moon: payload(1, { upOverride: 1 }) }).sun;
  gate(
    '(7) MONOTONE IN illum, and full moon === keyFull + 0.02',
    mono && Math.abs(full - (MOON_CFG.keyFull + 0.02)) < 1e-12,
    `41 samples monotone ${mono} · full ${full.toFixed(6)} vs ${(MOON_CFG.keyFull + 0.02).toFixed(6)}`
  );
}

// ---------------------------------------------------------------------------
// (8) the rung quantiser (the browser gate measures it LIVE; this proves the math)
// ---------------------------------------------------------------------------
if (!lb) {
  gate('(8) RUNGS', false, 'lib/fly/light-bubble.js absent — the quantiser does not exist on this tree');
  gate('(8b) HYSTERESIS', false, 'lib/fly/light-bubble.js absent');
  gate('(8c) THE RUNG DEADBAND', false, 'lib/fly/light-bubble.js absent');
} else {
  const cfg = LIGHT_BUBBLE_R25.shadow;
  const s = lb.createShadowRungState();
  const at = (k) => lb.stepShadowRadius(s, k, cfg).radiusM;
  const hi = at(0);
  const lo = at(1);
  const rungs = new Set();
  const fresh = lb.createShadowRungState();
  for (let i = 0; i <= 1000; i++) rungs.add(lb.stepShadowRadius(fresh, i / 1000, cfg).radiusM);
  gate(
    '(8) RUNGS — the radius is one of steps+1 values, exact at both ends',
    hi === cfg.radiusHighM && lo === cfg.radiusLowM && rungs.size === cfg.steps + 1,
    `k=0 → ${hi} m · k=1 → ${lo} m · ${rungs.size} distinct radii over 1001 samples (want ${cfg.steps + 1}) · ` +
      `texel at 2048: ${lb.shadowTexelM(hi, 2048).toFixed(3)} → ${lb.shadowTexelM(lo, 2048).toFixed(3)} m`
  );
  // (8b) THE WHOLE PIPELINE, in the units the user flies. TWO deadbands are in
  // series and the gate must exercise both: GROUND_BUBBLE's 60 m deadband on
  // the INPUT AGL (lib/fly/ground-bubble.js — the one signal A, C and F share)
  // and this module's `hysteresisM` on the OUTPUT rung. The browser gate flies
  // the aeroplane through the same sweep; this proves the arithmetic underneath
  // it in a place with no renderer.
  const h = lb.createShadowRungState();
  const bs = createBubbleState();
  const seen = [];
  for (const agl of [480, 500, 520, 540, 560, 540, 520, 500, 480]) {
    const k = stepBubble(bs, agl, 1 / 60, GROUND_BUBBLE, 1);
    seen.push(lb.stepShadowRadius(h, k, cfg).rung);
  }
  const changes = seen.filter((v, i) => i > 0 && v !== seen[i - 1]).length;
  gate(
    '(8b) HYSTERESIS — a 480 → 560 → 480 m sweep changes the rung at most once',
    changes <= 1,
    `rungs ${seen.join(' → ')} (${changes} change${changes === 1 ? '' : 's'}) — GROUND_BUBBLE's ${GROUND_BUBBLE.hysteresisM} m input deadband ` +
      `plus this block's ${cfg.hysteresisM} m rung deadband`
  );
  // (8c) WHAT THE RUNG DEADBAND ITSELF BUYS, measured rather than assumed: it
  // is HALF A RUNG or less (a rung is (1500−350)/8 = 143.75 m), so it cannot
  // hold a large excursion — that is the input deadband's job — and what it
  // does hold is jitter sitting ON a rung boundary, which is where a
  // quantiser flaps. Both halves are asserted, so neither is folklore.
  const edgeK = (7 + 0.5) / cfg.steps; // the 7↔8 boundary
  const j = lb.createShadowRungState();
  lb.stepShadowRadius(j, edgeK - 0.02, cfg);
  const jitter = [];
  for (let i = 0; i < 24; i++) jitter.push(lb.stepShadowRadius(j, edgeK + 0.01 * Math.sin(i), cfg).rung);
  const jitterChanges = jitter.filter((v, i) => i > 0 && v !== jitter[i - 1]).length;
  const t = lb.createShadowRungState();
  const traverse = new Set();
  for (let i = 0; i <= 8; i++) traverse.add(lb.stepShadowRadius(t, i / 8, cfg).rung);
  gate(
    '(8c) THE RUNG DEADBAND HOLDS BOUNDARY JITTER — and is not a lock',
    jitterChanges === 0 && traverse.size === cfg.steps + 1,
    `24 samples of ±0.01 k on the 7↔8 boundary: ${jitterChanges} changes (±0.01 k = ${(0.01 * (cfg.radiusHighM - cfg.radiusLowM)).toFixed(1)} m < ` +
      `${cfg.hysteresisM} m) · a real 0→1 traverse still reaches all ${traverse.size} rungs`
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
