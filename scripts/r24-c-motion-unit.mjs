/**
 * R24 "MOTION HOLD" — C MOTION-STATE's node-level unit gate (NO browser, NO
 * dev server, NO network). Runnable RIGHT NOW, which is the entire point: this
 * environment cannot render (SwiftShader ~1 fps) and cannot reach either tile
 * host (403 CONNECT for server.arcgisonline.com and tiles.openfreemap.org), so
 * every pixel and frame-time claim in this round is BLOCKED. Arithmetic is not.
 *
 * WHAT IT PROVES
 *
 *  (1) THE BYTE-NOOP PROOF. `MOTION_R24.elevSlew` and `MOTION_R24.paceBySpeed`
 *      ship OFF, and this gate proves "off" means what the round says it means
 *      by running a SWEPT GRID of inputs through the shipped functions and
 *      through a verbatim transcription of the PRE-R24 expressions, comparing
 *      with `Object.is` (so -0 and NaN are caught, not smoothed). 576 slew
 *      samples (8 branch-chosen elevation sequences x 12 dt values x 6 steps)
 *      and 126 cadence samples, zero tolerance. The grid is sized for BRANCH
 *      coverage, not for a big number: every dt straddles the 0.05 clamp, the
 *      91 ms R22.1 stutter frame and the degenerate 0/-1/NaN, and every
 *      sequence straddles `stepSnapM` from both sides.
 *  (2) THE GATE IS NOT VACUOUS. A control arm runs the same comparator against
 *      a DELIBERATELY MUTATED reference and asserts it REPORTS A MISMATCH. An
 *      equality gate that cannot go red certifies nothing (R22.1 §0).
 *  (3) THE ARMED SEMANTICS. With the flags forced on, the elevSlew state
 *      machine snaps on a discontinuity and NOT on a refinement, and
 *      `paceCadenceSec` is the identity at and below `refMps`, monotone
 *      non-increasing above it, and floored — with the two headline numbers
 *      (180 m/s and 750 m/s) asserted explicitly.
 *  (4) ARMING elevSlew AT ITS SHIPPED DEFAULTS CHANGES EXACTLY ONE THING.
 *      `dtFloorSec` defaults to 0.05, which is the value the pre-R24 expression
 *      hard-coded, so the ONLY behavioural delta at defaults is the snap. That
 *      is asserted rather than asserted-in-prose.
 *  (5) THE CALL SITES ARE WHERE THE ROUND SAYS THEY ARE — source-parsed, the
 *      verify-warbirds idiom, so the gate reads the checked-in reality instead
 *      of a re-derived model. Includes B's `aglTruth` call sites (see below).
 *
 * ── A NOTE ON GATE (f), THE aglTruth CALL SITES ────────────────────────────
 * `SatVegLayer.jsx` and `SatClutterLayer.jsx` are B's files this round; C owns
 * the SPEC and the helper, B owns the edit. Gate (f) is therefore RED-BY-
 * CONSTRUCTION until B lands, and that is deliberate: it is the RED
 * calibration for B's change, taken on the tree before the fix exists. A green
 * (f) means the four raw-`groundElev` reads C measured in Wave 1 are gone.
 *
 * EXIT CODES: 0 = VERIFY: PASS · 1 = VERIFY: FAIL. There is no BLOCKED path —
 * this gate has no runtime preconditions at all, which is why it is the one
 * piece of R24 evidence that is not conditional on somebody else's machine.
 *
 * Usage: node scripts/r24-c-motion-unit.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/* -- loader hook: teach node the repo's `@/` alias (jsconfig paths "@/*" ->
 *    "./*") and its extensionless relative imports. Same idiom as
 *    verify-seam.js, which imports the vector-tile worker straight into node. */
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) {
      const abs = path.join(ROOT, spec.slice(2));
      for (const cand of [abs, abs + '.js', abs + '.mjs', path.join(abs, 'index.js')]) {
        if (existsSync(cand)) return { url: pathToFileURL(cand).href, shortCircuit: true };
      }
    }
    if (/^\.{1,2}\//.test(spec) && !/\.[a-z]+$/i.test(spec) && ctx.parentURL?.startsWith('file:')) {
      for (const ext of ['.js', '.mjs', '/index.js']) {
        try {
          if (existsSync(fileURLToPath(new URL(spec + ext, ctx.parentURL)))) return next(spec + ext, ctx);
        } catch {
          /* not this candidate */
        }
      }
    }
    return next(spec, ctx);
  },
});

const { MOTION_R24, SETTLE_CALM, SAT_VEG, CLUTTER } = await import('@/lib/fly/fly-constants');
const settle = await import('@/lib/fly/settle');
const { groundElevVisStep, paceCadenceSec, motionOn, motionSubOn } = settle;

let fails = 0;
const gate = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails++;
};

// ───────────────────────────────────────────────────────────────────────────
// The PRE-R24 expressions, transcribed VERBATIM from the shipped R22 source.
// These are the reference the byte-noop proof compares against. If anyone ever
// edits the live functions' flag-off path, these stop matching and this gate
// goes red — which is exactly the contract "enabled:false is a one-line
// revert" means.
// ───────────────────────────────────────────────────────────────────────────

/** lib/fly/settle.js @ R22 — groundElevVisStep, damped branch, verbatim. */
function refGroundElevVisStep(st, raw, dtSec, epoch) {
  if (st.v == null || epoch !== st.epoch) {
    st.v = raw;
    st.epoch = epoch;
    return raw;
  }
  const max = SETTLE_CALM.groundElevVis.slewMps * Math.max(0, Math.min(0.05, dtSec));
  const d = raw - st.v;
  st.v += Math.abs(d) <= max ? d : Math.sign(d) * max;
  return st.v;
}

/** The pre-R24 cadence: there was none. A layer used its constant, full stop. */
const refPaceCadenceSec = (baseSec) => baseSec;

// ───────────────────────────────────────────────────────────────────────────
// The swept grid
// ───────────────────────────────────────────────────────────────────────────

// Elevation sequences chosen to exercise every branch: a settled refinement
// walk, the R22-measured ~384 m/frame raw step, a plateau edge, a sign flip, a
// sub-slew crawl, and a run that straddles `stepSnapM` from both sides.
const ELEV_SEQS = [
  [0, 0, 0, 0, 0, 0],
  [0, 1, 2, 3, 4, 5],
  [0, 384, 384, 384, 0, 0], // the R22 S-ELEV measurement, there and back
  [120, 121, 119, 240, 239, 480],
  [800, 400, 800, 400, 800, 400], // canyon rim, repeatedly
  [0, 119.9, 239.8, 120.1, 0.5, -0.5], // straddles stepSnapM 120 from both sides
  [1000, 1000.0001, 999.9999, 1000, 1000, 1000],
  [-50, -50, 50, 50, -50, 50], // below sea level (Death Valley / Dead Sea)
];
// dt values: 240 Hz headless, 144, 120, 60, 30, the 0.05 clamp edge itself,
// a 91 ms R22.1 stutter frame, a 500 ms outlier, and the degenerate ones.
const DTS = [
  0.0041667, 0.0069444, 0.0083333, 0.0166667, 0.0333333, 0.05, 0.0501, 0.091, 0.5, 0, -1,
  Number.NaN,
];

// ───────────────────────────────────────────────────────────────────────────
// (a) BYTE-NOOP — groundElevVisStep, elevSlew OFF (the SHIPPED state)
// ───────────────────────────────────────────────────────────────────────────
function sweepSlew(compare) {
  let n = 0;
  const bad = [];
  let epoch = 1000;
  for (const seq of ELEV_SEQS) {
    for (const dt of DTS) {
      epoch += 1; // a fresh epoch reseeds BOTH state machines identically
      const refSt = { v: null, epoch: -1 };
      for (const raw of seq) {
        const got = groundElevVisStep(raw, dt, epoch);
        const want = compare(refSt, raw, dt, epoch);
        n += 1;
        if (!Object.is(got, want) && bad.length < 8) {
          bad.push(`seq[${seq.join(',')}] dt=${dt} raw=${raw}: got ${got} want ${want}`);
        }
      }
    }
  }
  return { n, bad };
}

const shippedOff = { ...MOTION_R24 };
gate(
  'elevSlew ships OFF (the round\'s stated ship set)',
  MOTION_R24.enabled === true &&
    MOTION_R24.aglTruth.enabled === true &&
    MOTION_R24.grades.enabled === true &&
    MOTION_R24.elevGate.enabled === false &&
    MOTION_R24.elevSlew.enabled === false &&
    MOTION_R24.paceBySpeed.enabled === false,
  `enabled=${MOTION_R24.enabled} aglTruth=${MOTION_R24.aglTruth.enabled} grades=${MOTION_R24.grades.enabled} ` +
    `elevGate=${MOTION_R24.elevGate.enabled} elevSlew=${MOTION_R24.elevSlew.enabled} paceBySpeed=${MOTION_R24.paceBySpeed.enabled}`
);
void shippedOff;

const offSweep = sweepSlew(refGroundElevVisStep);
gate(
  '(a) BYTE-NOOP groundElevVisStep — flag-off is bit-identical to the pre-R24 expression',
  offSweep.bad.length === 0,
  `${offSweep.n} samples over ${ELEV_SEQS.length} sequences x ${DTS.length} dt, ` +
    `${offSweep.bad.length} mismatches` + (offSweep.bad.length ? `\n      ${offSweep.bad.join('\n      ')}` : '')
);

// ───────────────────────────────────────────────────────────────────────────
// (b) THE COMPARATOR CAN GO RED — the control arm
// ───────────────────────────────────────────────────────────────────────────
// Same sweep, against a reference whose slew rate is deliberately wrong. If
// this does NOT report mismatches, gate (a)'s green is vacuous.
const mutatedSweep = sweepSlew((st, raw, dtSec, epoch) => {
  if (st.v == null || epoch !== st.epoch) {
    st.v = raw;
    st.epoch = epoch;
    return raw;
  }
  const max = (SETTLE_CALM.groundElevVis.slewMps + 1) * Math.max(0, Math.min(0.05, dtSec));
  const d = raw - st.v;
  st.v += Math.abs(d) <= max ? d : Math.sign(d) * max;
  return st.v;
});
gate(
  '(b) the byte-noop comparator is NOT vacuous — a mutated reference is caught',
  mutatedSweep.bad.length > 0,
  `${mutatedSweep.bad.length} mismatches against a slewMps+1 reference (expected > 0)`
);

// ───────────────────────────────────────────────────────────────────────────
// (c) BYTE-NOOP — paceCadenceSec, paceBySpeed OFF (the SHIPPED state)
// ───────────────────────────────────────────────────────────────────────────
const BASES = [0.15, 0.6, 1, 2, 3, 60, 0, -1, Number.NaN];
const SPEEDS = [
  0, 1, 60, 119, 120, 121, 180, 235, 400, 750, 1000, -180, Number.NaN, Number.POSITIVE_INFINITY,
];
function sweepPace(expect) {
  let n = 0;
  const bad = [];
  for (const b of BASES) {
    for (const s of SPEEDS) {
      const got = paceCadenceSec(b, s);
      const want = expect(b, s);
      n += 1;
      if (!Object.is(got, want) && bad.length < 8) bad.push(`base=${b} speed=${s}: got ${got} want ${want}`);
    }
  }
  return { n, bad };
}
const paceOff = sweepPace(refPaceCadenceSec);
gate(
  '(c) BYTE-NOOP paceCadenceSec — flag-off returns baseSec bit-identically',
  paceOff.bad.length === 0,
  `${paceOff.n} samples over ${BASES.length} bases x ${SPEEDS.length} speeds, ${paceOff.bad.length} mismatches` +
    (paceOff.bad.length ? `\n      ${paceOff.bad.join('\n      ')}` : '')
);

// ───────────────────────────────────────────────────────────────────────────
// (d) ARMED SEMANTICS — elevSlew
// ───────────────────────────────────────────────────────────────────────────
// The flags are plain object properties on a module singleton, so arming them
// in-process is the same lever `window.__flyMotion.set()` pulls in the browser.
// Restored at the end of the block so nothing downstream inherits an armed
// constant (and asserted restored, so a future edit cannot leak one).
const ES = MOTION_R24.elevSlew;
const armedResults = {};
{
  ES.enabled = true;
  const E = 5000;
  const DT60 = 1 / 60;

  // (d1) a REFINEMENT (below stepSnapM) still glides at slewMps.
  groundElevVisStep(0, DT60, E); // seed
  const oneStep = groundElevVisStep(100, DT60, E);
  const expectedGlide = MOTION_R24.elevSlew.slewMps * DT60;
  armedResults.glide = oneStep;
  gate(
    '(d1) armed: a sub-snap refinement still GLIDES at slewMps (the R22 contract holds)',
    Math.abs(oneStep - expectedGlide) < 1e-9,
    `100 m step, one 60 Hz frame -> ${oneStep.toFixed(6)} m (expected ${expectedGlide.toFixed(6)})`
  );

  // (d2) a DISCONTINUITY (above stepSnapM) snaps in ONE frame.
  const E2 = 5001;
  groundElevVisStep(0, DT60, E2); // seed
  const snapped = groundElevVisStep(400, DT60, E2);
  armedResults.snap = snapped;
  gate(
    '(d2) armed: a 400 m discontinuity SNAPS in one frame',
    Object.is(snapped, 400),
    `-> ${snapped} (stepSnapM ${MOTION_R24.elevSlew.stepSnapM})`
  );

  // (d3) …and OFF it takes the measured 5 s. This is the delta the round buys.
  ES.enabled = false;
  const E3 = 5002;
  groundElevVisStep(0, DT60, E3);
  let frames = 0;
  let v = 0;
  while (v < 399.999 && frames < 100000) {
    v = groundElevVisStep(400, DT60, E3);
    frames += 1;
  }
  armedResults.framesOff = frames;
  gate(
    '(d3) OFF: the same 400 m discontinuity takes ~5 s to converge (the defect, quantified)',
    frames >= 290 && frames <= 310,
    `${frames} frames at 60 Hz = ${(frames / 60).toFixed(2)} s (400 m / 80 m/s = 5.00 s)`
  );

  // (d4) arming at SHIPPED DEFAULTS changes exactly one thing: the snap.
  // Same sweep as (a), but with elevSlew ARMED — every sample whose step is
  // <= stepSnapM must still be bit-identical to the pre-R24 expression,
  // because dtFloorSec's default 0.05 IS the hard-coded pre-R24 clamp.
  ES.enabled = true;
  let subSnapN = 0;
  const subSnapBad = [];
  let epoch = 7000;
  for (const seq of ELEV_SEQS) {
    for (const dt of DTS) {
      epoch += 1;
      const refSt = { v: null, epoch: -1 };
      let diverged = false;
      for (const raw of seq) {
        const prevRef = refSt.v;
        const got = groundElevVisStep(raw, dt, epoch);
        const want = refGroundElevVisStep(refSt, raw, dt, epoch);
        // Once a snap has fired the two machines legitimately differ forever;
        // only samples BEFORE the first discontinuity are comparable.
        if (prevRef != null && Math.abs(raw - prevRef) > ES.stepSnapM) diverged = true;
        if (diverged) continue;
        subSnapN += 1;
        if (!Object.is(got, want) && subSnapBad.length < 8) {
          subSnapBad.push(`seq[${seq.join(',')}] dt=${dt} raw=${raw}: got ${got} want ${want}`);
        }
      }
    }
  }
  gate(
    '(d4) armed at shipped defaults: every SUB-SNAP sample is still bit-identical (dtFloorSec 0.05 == the pre-R24 clamp)',
    subSnapBad.length === 0,
    `${subSnapN} sub-snap samples, ${subSnapBad.length} mismatches` +
      (subSnapBad.length ? `\n      ${subSnapBad.join('\n      ')}` : '')
  );

  ES.enabled = false;
}
gate(
  '(d5) the armed-arm restored the shipped flag state',
  MOTION_R24.elevSlew.enabled === false,
  `elevSlew.enabled=${MOTION_R24.elevSlew.enabled}`
);

// ───────────────────────────────────────────────────────────────────────────
// (e) ARMED SEMANTICS — paceCadenceSec, and the arithmetic the round cites
// ───────────────────────────────────────────────────────────────────────────
{
  const P = MOTION_R24.paceBySpeed;
  P.enabled = true;
  const base = SAT_VEG.placeCadenceSec; // 2 s — the real shipped cadence

  const idOk = [0, 1, 60, 119, 120].every((s) => Object.is(paceCadenceSec(base, s), base));
  gate(
    '(e1) armed: identity at and below refMps (cruise-and-below is untouched by construction)',
    idOk,
    `refMps ${P.refMps}; base ${base} s returned unchanged at 0/1/60/119/120 m/s`
  );

  const at180 = paceCadenceSec(base, 180);
  const at750 = paceCadenceSec(base, 750);
  const want180 = base / (180 / P.refMps);
  gate(
    '(e2) armed: the two headline speeds',
    Math.abs(at180 - want180) < 1e-12 && Math.abs(at750 - P.minCadenceSec) < 1e-12,
    `180 m/s -> ${at180.toFixed(4)} s (2 s / 1.5) · 750 m/s -> ${at750.toFixed(4)} s (floored at minCadenceSec ${P.minCadenceSec})`
  );

  let mono = true;
  let prev = Number.POSITIVE_INFINITY;
  for (let s = 0; s <= 1200; s += 5) {
    const c = paceCadenceSec(base, s);
    if (c > prev + 1e-12) mono = false;
    if (!(c > 0) || !Number.isFinite(c)) mono = false;
    prev = c;
  }
  gate(
    '(e3) armed: monotone non-increasing in speed, always finite and > 0, never below the floor',
    mono && paceCadenceSec(base, 1e9) >= P.minCadenceSec - 1e-12,
    `swept 0..1200 m/s in 5 m/s steps; at 1e9 m/s -> ${paceCadenceSec(base, 1e9)}`
  );

  // The defect, restated as the number this helper exists to move. World units
  // are true metres x 1/cos(lat); at Powell OH (40.17 deg) SAT_VEG's
  // distFade 1800->2400 wu band is 600 * cos(40.17) = 458 true metres.
  const bandTrueM = (SAT_VEG.distFade.endM - SAT_VEG.distFade.startM) * Math.cos((40.17 * Math.PI) / 180);
  const crossOff = (750 * base) / bandTrueM;
  const crossOn = (750 * paceCadenceSec(base, 750)) / bandTrueM;
  gate(
    '(e4) armed: the boost-speed per-tick fade-band crossing drops below 1.0 (no instantaneous 1->0)',
    crossOff > 3 && crossOn < 1,
    `band ${bandTrueM.toFixed(0)} m true · OFF ${(crossOff * 100).toFixed(0)}% of the band per tick · ` +
      `ON ${(crossOn * 100).toFixed(0)}%`
  );

  P.enabled = false;
}
gate(
  '(e5) the armed-arm restored the shipped flag state',
  MOTION_R24.paceBySpeed.enabled === false,
  `paceBySpeed.enabled=${MOTION_R24.paceBySpeed.enabled}`
);

// (e6) THE aglTruth JUSTIFICATION, as arithmetic rather than as prose. R22's
// S-ELEV row measured the RAW groundElev sweeping ~384 m/frame as the DEM
// refines under the aircraft. Assert that this step is larger than the
// NARROWEST altitude fade band in the two layers that still read it raw — i.e.
// that a single raw sample can take an actor from fully visible to fully gone.
// This is why aglTruth ships ON while everything else in R24 ships off: it is
// the one family whose defect is provable without a GPU.
{
  const RAW_STEP_M = 384; // FLY_ROUND22.md §3, row S-ELEV
  const bands = [
    ['SAT_VEG.altFade', SAT_VEG.altFade.offM - SAT_VEG.altFade.onM],
    ['CLUTTER.cars.parked.altFade', CLUTTER.cars.parked.altFade.offM - CLUTTER.cars.parked.altFade.onM],
    ['CLUTTER.cars.moving.altFade', CLUTTER.cars.moving.altFade.offM - CLUTTER.cars.moving.altFade.onM],
    ['CLUTTER.poles.altFade', CLUTTER.poles.altFade.offM - CLUTTER.poles.altFade.onM],
  ];
  const narrowest = bands.reduce((a, b) => (b[1] < a[1] ? b : a));
  gate(
    '(e6) aglTruth is justified by arithmetic: the measured raw DEM step exceeds the narrowest fade band it drives',
    RAW_STEP_M > narrowest[1],
    `raw step ${RAW_STEP_M} m/frame vs ${bands.map(([n, w]) => `${n} ${w} m`).join(' · ')} ` +
      `-> narrowest ${narrowest[0]} ${narrowest[1]} m (${(RAW_STEP_M / narrowest[1]).toFixed(1)}x the whole band)`
  );
}

// ───────────────────────────────────────────────────────────────────────────
// (f) THE CALL SITES — source-parsed (the verify-warbirds idiom)
// ───────────────────────────────────────────────────────────────────────────
const flyScene = read('components/fly/FlyScene.jsx');
const settleSrc = read('lib/fly/settle.js');

gate(
  '(f1) FlyScene: the two GROUND-PLANE grades read the damped eyeAglVis',
  /\(eyeAglVis - SAT_QUILT\.inAglM\)/.test(flyScene) &&
    /\(eyeAglVis - mc\.inAglM\)/.test(flyScene),
  'SAT_QUILT + HILLSHADE.micro'
);
gate(
  '(f2) FlyScene: the three terms C did NOT re-point still read the RAW eyeAgl',
  /\(eyeAgl - aa\.aglStartM\)/.test(flyScene) && // SKY.altAtmo (already damped downstream)
    /const rimDrop = dipStartM \* dipStartM \* bendK \+ eyeAgl;/.test(flyScene) && // sky dip
    /setBendEye\(flight\.pos\.y, flight\.groundElev\)/.test(flyScene), // the bend's eye
  'altAtmo / setSkyDip / setBendEye — blast radius is exactly the adjudicated two'
);
gate(
  '(f3) FlyScene: the crash-floor input is untouched — flight.groundElev is still assigned RAW on BOTH elevGate arms',
  (flyScene.match(/flight\.groundElev = /g) || []).length >= 2 &&
    /flight\.groundElev = s\.elev; \/\/ RAW/.test(flyScene) &&
    /if \(elev != null\) flight\.groundElev = elev;/.test(flyScene),
  'safety never reads a damped or a gated signal'
);
gate(
  '(f4) settle.js: paceCadenceSec + groundElevVis are exported for B\'s call sites',
  /export function paceCadenceSec\(/.test(settleSrc) && /export function groundElevVis\(/.test(settleSrc),
  ''
);

// --- B's aglTruth call sites. RED until B lands; see the header. ------------
const vegSrc = existsSync(path.join(ROOT, 'components/fly/SatVegLayer.jsx'))
  ? read('components/fly/SatVegLayer.jsx')
  : '';
const clutterSrc = existsSync(path.join(ROOT, 'components/fly/SatClutterLayer.jsx'))
  ? read('components/fly/SatClutterLayer.jsx')
  : '';
const rawReads = (s) => (s.match(/flight\.pos\.y - flight\.groundElev/g) || []).length;
const vegRaw = rawReads(vegSrc);
const clutterRaw = rawReads(clutterSrc);
gate(
  '(f5) aglTruth: SatVegLayer + SatClutterLayer no longer take eyeAgl from the RAW groundElev [B implements C\'s spec — RED until B lands]',
  vegRaw === 0 && clutterRaw === 0,
  `SatVegLayer ${vegRaw} raw read(s) (Wave-1 baseline 1), SatClutterLayer ${clutterRaw} (Wave-1 baseline 3)`
);
gate(
  '(f6) aglTruth: both layers import groundElevVis from settle',
  /groundElevVis/.test(vegSrc) && /groundElevVis/.test(clutterSrc),
  `veg=${/groundElevVis/.test(vegSrc)} clutter=${/groundElevVis/.test(clutterSrc)}`
);

// ───────────────────────────────────────────────────────────────────────────
// (g) the flag resolution itself
// ───────────────────────────────────────────────────────────────────────────
gate(
  '(g1) motionOn/motionSubOn agree with the constants in a window-less context',
  motionOn() === true &&
    motionSubOn('aglTruth') === true &&
    motionSubOn('grades') === true &&
    motionSubOn('elevGate') === false &&
    motionSubOn('elevSlew') === false &&
    motionSubOn('paceBySpeed') === false,
  ''
);
{
  MOTION_R24.enabled = false;
  const allOff =
    !motionOn() &&
    !motionSubOn('aglTruth') &&
    !motionSubOn('grades') &&
    !motionSubOn('elevGate') &&
    !motionSubOn('elevSlew') &&
    !motionSubOn('paceBySpeed');
  // …and with the master off, both helpers are the identity again.
  MOTION_R24.elevSlew.enabled = true;
  MOTION_R24.paceBySpeed.enabled = true;
  const stillIdentity =
    Object.is(paceCadenceSec(2, 750), 2) && sweepSlew(refGroundElevVisStep).bad.length === 0;
  MOTION_R24.elevSlew.enabled = false;
  MOTION_R24.paceBySpeed.enabled = false;
  MOTION_R24.enabled = true;
  gate(
    '(g2) MOTION_R24.enabled:false is a TRUE one-line revert — it overrides every armed sub-flag',
    allOff && stillIdentity,
    'master off + both sub-flags forced ON -> byte-identical to pre-R24'
  );
}
gate(
  '(g3) the gate restored the shipped constants',
  MOTION_R24.enabled === true &&
    MOTION_R24.elevSlew.enabled === false &&
    MOTION_R24.paceBySpeed.enabled === false,
  ''
);

console.log('');
console.log(
  `VERIFY: ${fails === 0 ? 'PASS' : 'FAIL'}${fails ? ` (${fails} gate${fails > 1 ? 's' : ''})` : ''}`
);
process.exit(fails === 0 ? 0 : 1);
