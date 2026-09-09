#!/usr/bin/env node
/**
 * R24 (B STREAM) — verify-ringhold: THE RING-SELECTION SIM, RED-CALIBRATED.
 *
 * ── WHAT THIS IS ───────────────────────────────────────────────────────────
 * The defect R24 B fixes is a property of a PURE FUNCTION. Given a player
 * track, each streaming engine's `_refreshDesired` decides which chunks are
 * resident; the defect is that the decision THRASHES under motion. That
 * function touches no GPU, no network and no tile bytes, so it can be
 * re-implemented exactly and exercised in milliseconds — which matters here,
 * because this machine 403-blocks both tile hosts and renders on SwiftShader at
 * ~1 fps. A browser gate here would measure the blockade, not the product.
 *
 * ⚠️ THIS IS NOT A SUBSTITUTE FOR A LIVE GATE, and must never be reported as
 * one. It certifies that the SELECTION ARITHMETIC changed as intended and that
 * the bounds hold. It cannot certify that a user stops seeing buildings blink.
 * That needs scripts/r24-b-probe-live.js on a machine with egress.
 *
 * ── THE WAVE-1 NUMBER WAS OVER-CLAIMED, AND THIS GATE IS WHERE IT WAS CAUGHT ─
 * B's Wave-1 report headlined "17 evict→rebuild round-trips per 40 s at cruise
 * in a turn, 52 on boost" and described them as chunks vanishing and returning.
 * Gates (1)(2) reproduce those integers exactly — but gates (3)-(6) show most of
 * them are NOT the defect. A 15°/s turn at 200 m/s has a radius of ~760 m, i.e.
 * well inside ONE z14 tile, so the aircraft orbits over the same nine tiles and
 * legitimately re-enters them. A ring that follows it is a ring working.
 *
 * The defect is the subset where a chunk was DROPPED WHILE IT WAS STILL NEARBY
 * AND CAME STRAIGHT BACK. That is `thrash` below: a chunk that was drawing, was
 * evicted while within `nearMul × ringR` of the player, and re-entered the keep
 * set within `winSec`. On the shipped tree it is 121 events for the building
 * ring across the 20-leg matrix — a real defect, an order of magnitude smaller
 * than the headline. Recording the correction rather than quietly re-pointing
 * the metric, because R19 §5 already cost this project a round on an instrument
 * that indicted actors it had merely failed to exclude.
 *
 * ── WHAT MAKES IT EVIDENCE RATHER THAN AGREEMENT WITH ITSELF ───────────────
 *  1. IT READS THE SHIPPED CONSTANTS — never a private copy (R22 lesson 4).
 *     Moving a shipped value moves this gate.
 *  2. IT IS RED-CALIBRATED AND THE RED IS EXACT. The sim has no RNG, so every
 *     RED is asserted to the unit; selection drift shows up as a RED that no
 *     longer reproduces, not as a quietly widened bound.
 *  3. IT VALIDATES AGAINST THE WORLD IT DID NOT CHANGE. Gate (10) re-derives
 *     the lead-free coverage guarantee and checks it against two invariants
 *     earlier rounds wrote down in prose. A model that cannot reproduce the
 *     UN-LED world is not evidence about the led one.
 *  4. ITS OWN PARAMETERS ARE SWEPT, NOT TUNED. Gates (8)(9) re-run the verdict
 *     across the build-latency model parameter and across nine (winSec,
 *     nearMul) instrument settings; the direction must never flip.
 *
 * USAGE
 *   node scripts/r24-b-ringhold.mjs            the gate (exit 0 = PASS)
 *   node scripts/r24-b-ringhold.mjs --derive   the LEAD_SAFE bisection table
 *   node scripts/r24-b-ringhold.mjs --verbose  + per-ring attribution
 */

import {
  CLUTTER,
  LEAD_SAFE,
  RING_HOLD,
  SAT_BUILDINGS,
  SAT_COVERAGE,
  SAT_ROADS,
  SAT_VEG,
  STREAM_KEEPER,
} from '../lib/fly/fly-constants.js';

const EARTH_R = 6378137;
const WORLD_SIZE = 2 * Math.PI * EARTH_R;
const MERC_K = 1 / Math.cos((40 * Math.PI) / 180); // lat 40 — Powell OH / P-LEWIS
const ARGS = new Set(process.argv.slice(2));

const results = [];
const gate = (n, ok, msg) => {
  results.push({ n, ok, msg });
  console.log(`${ok ? 'PASS' : 'FAIL'} (${n}) ${msg}`);
};

/* ══════════ the shipped selection code, re-implemented line-for-line ═══════
 * Mirrors lib/fly/toy-world/sat-*-engine.js. If one of those changes shape,
 * THIS has to change with it — the gate is a second opinion, not a second copy
 * of the same edit.
 * ═══════════════════════════════════════════════════════════════════════════ */

function leadCapM(name, ringR, on) {
  const base = STREAM_KEEPER.lookahead.maxLeadFrac * ringR;
  if (!on) return base;
  const cap = LEAD_SAFE.capByEngine?.[name];
  return typeof cap === 'number' ? Math.min(base, cap) : base;
}

function ringHoldKeep(desired, maxChunks, chunks, keyOf, isLive, on) {
  const kept = desired.slice(0, maxChunks);
  if (!on) return kept;
  const H = RING_HOLD.keepHysteresis;
  if (!(H > 0) || desired.length <= maxChunks) return kept;
  let w = kept.length - 1;
  const end = Math.min(desired.length, maxChunks + H);
  let swapped = false;
  for (let i = maxChunks; i < end; i++) {
    const e = desired[i];
    const c = chunks.get(keyOf(e));
    if (!c || !isLive(c)) continue;
    while (w >= 0 && chunks.has(keyOf(kept[w]))) w -= 1;
    if (w < 0) break;
    kept[w] = e;
    w -= 1;
    swapped = true;
  }
  if (swapped) kept.sort((a, b) => a.distSq - b.distSq);
  return kept;
}

function residencyHeld(chunks, keep, nowSec, cx, cz, ringR, on) {
  const out = new Set();
  if (!on) return out;
  const H = RING_HOLD.keepHysteresis;
  const T = RING_HOLD.minResidencySec;
  if (!(H > 0) || !(T > 0)) return out;
  const farR2 = (ringR * 1.25) ** 2;
  let cand = null;
  for (const [key, chunk] of chunks) {
    if (keep.has(key)) continue;
    const born = chunk.readyAt;
    if (born === undefined || nowSec - born >= T) continue;
    if (chunk.cx === undefined || chunk.cz === undefined) continue;
    const dx = chunk.cx - cx;
    const dz = chunk.cz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > farR2) continue;
    (cand ??= []).push([d2, key]);
  }
  if (!cand) return out;
  cand.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < cand.length && i < H; i++) out.add(cand[i][1]);
  return out;
}

/** The desired-set arithmetic, identical in all five engines. */
function desiredSet(cx, cz, z, r) {
  const span = WORLD_SIZE / 2 ** z;
  const half = WORLD_SIZE / 2;
  const n = 2 ** z;
  const a = Math.floor((cx - r + half) / span);
  const b = Math.floor((cx + r + half) / span);
  const c = Math.floor((cz - r + half) / span);
  const d = Math.floor((cz + r + half) / span);
  const out = [];
  for (let ty = Math.max(0, c); ty <= Math.min(n - 1, d); ty++)
    for (let tx = Math.max(0, a); tx <= Math.min(n - 1, b); tx++) {
      const minX = -half + tx * span;
      const minZ = -(half - ty * span);
      const dx = Math.max(minX - cx, 0, cx - (minX + span));
      const dz = Math.max(minZ - cz, 0, cz - (minZ + span));
      if (dx * dx + dz * dz > r * r) continue;
      const ccx = minX + span / 2;
      const ccz = minZ + span / 2;
      out.push({
        key: `${z}/${tx}/${ty}`,
        cx: ccx,
        cz: ccz,
        distSq: (ccx - cx) ** 2 + (ccz - cz) ** 2,
      });
    }
  out.sort((p, q) => p.distSq - q.distSq);
  return out;
}

/* ═══════════════════════════ the flight + the engine ═══════════════════════ */

/**
 * `buildSec` (how long a queued chunk takes to become drawable), `winSec` and
 * `nearMul` are INSTRUMENT parameters, not product constants. All three are
 * swept in gates (8)(9) rather than chosen.
 */
function run({
  z, r, maxChunks, engineName, refreshMoveM, refreshSec,
  speedMps, turnDegPerSec, secs = 40, dt = 1 / 60,
  ringHoldOn, leadSafeOn, buildSec = 0.8, winSec = 6, nearMul = 1.25,
}) {
  const L = STREAM_KEEPER.lookahead;
  const speedU = speedMps * MERC_K;
  let px = 1e6 + 137.7;
  let pz = -4.5e6 + 91.3;
  let hdg = 0;
  let vx = 0, vz = 0, velT, velPx, velPz;
  let lastX = Infinity, lastZ = Infinity, lastT = 0;
  const chunks = new Map();
  const evictedAt = new Map();
  const seenInKeep = new Map();
  let prevKeep = null;
  let thrash = 0, evictions = 0, maxKept = 0, maxResident = 0, maxCand = 0;
  let refreshes = 0, legacyMismatch = 0;

  for (let t = 0; t < secs; t += dt) {
    hdg += ((turnDegPerSec * Math.PI) / 180) * dt;
    px += Math.cos(hdg) * speedU * dt;
    pz += Math.sin(hdg) * speedU * dt;

    const d = t - (velT ?? t); // _trackVel, verbatim
    velT = t;
    if (velPx === undefined) { velPx = px; velPz = pz; }
    else {
      const ax = px - velPx, az = pz - velPz;
      velPx = px; velPz = pz;
      if (d > 1e-4 && d <= 0.5) {
        const al = Math.min(1, d / L.tauSec);
        vx += (ax / d - vx) * al;
        vz += (az / d - vz) * al;
      }
    }
    for (const c of chunks.values())
      if (c.state === 'building' && t - c.queuedAt >= buildSec) { c.state = 'ready'; c.readyAt = t; }

    if ((px - lastX) ** 2 + (pz - lastZ) ** 2 > refreshMoveM ** 2 || t - lastT > refreshSec) {
      lastX = px; lastZ = pz; lastT = t; refreshes += 1;

      let cx = px, cz = pz; // _leadCenter, verbatim, with LEAD_SAFE
      const sp = Math.hypot(vx, vz);
      if (sp >= 1) {
        const lead = Math.min(sp * L.leadSec, leadCapM(engineName, r, leadSafeOn));
        cx = px + (vx / sp) * lead;
        cz = pz + (vz / sp) * lead;
      }

      const desired = desiredSet(cx, cz, z, r);
      if (desired.length > maxCand) maxCand = desired.length;
      const keyOf = (e) => e.key;
      const kept = ringHoldKeep(desired, maxChunks, chunks, keyOf, (c) => c.state === 'ready', ringHoldOn);
      const keep = new Set(kept.map(keyOf));
      if (kept.length > maxKept) maxKept = kept.length;

      if (!ringHoldOn && !leadSafeOn) {
        const legacy = new Set(desired.slice(0, maxChunks).map(keyOf));
        if (legacy.size !== keep.size || [...legacy].some((k) => !keep.has(k))) legacyMismatch += 1;
      }

      const held = residencyHeld(chunks, keep, t, px, pz, r, ringHoldOn);
      for (const [key, c] of [...chunks]) {
        if (keep.has(key) || held.has(key)) continue;
        chunks.delete(key);
        evictions += 1;
        evictedAt.set(key, { t, d: Math.hypot(c.cx - px, c.cz - pz), wasReady: c.state === 'ready' });
      }
      for (const e of kept)
        if (!chunks.has(e.key))
          chunks.set(e.key, { key: e.key, state: 'building', queuedAt: t, cx: e.cx, cz: e.cz });
      if (chunks.size > maxResident) maxResident = chunks.size;

      for (const k of keep) {
        if (prevKeep && prevKeep.has(k)) continue;
        seenInKeep.set(k, (seenInKeep.get(k) ?? 0) + 1);
        // THE DEFECT: it was drawing, we dropped it while it was still nearby,
        // and it came straight back. Everything else is the ring following the
        // aeroplane, which is the ring working.
        const le = evictedAt.get(k);
        if (le && le.wasReady && t - le.t <= winSec && le.d <= r * nearMul) thrash += 1;
      }
      prevKeep = keep;
    }
  }
  let membershipReentries = 0;
  for (const v of seenInKeep.values()) if (v > 1) membershipReentries += v - 1;
  return { refreshes, maxCand, evictions, membershipReentries, thrash, maxKept, maxResident, legacyMismatch };
}

/* ═══════════════════════════════ the rings ════════════════════════════════ */

const RINGS = {
  buildings: {
    engineName: 'satBuildings', z: SAT_BUILDINGS.ring.z,
    r: SAT_COVERAGE.enabled ? SAT_COVERAGE.high.ringM : SAT_BUILDINGS.ring.r,
    maxChunks: SAT_COVERAGE.enabled ? SAT_COVERAGE.high.maxChunks : SAT_BUILDINGS.maxChunks,
    refreshMoveM: SAT_BUILDINGS.refreshMoveM, refreshSec: SAT_BUILDINGS.refreshSec,
  },
  veg: {
    engineName: 'satVeg', z: SAT_VEG.ring.z, r: SAT_VEG.ring.r,
    maxChunks: SAT_VEG.maxChunksByTier.high,
    refreshMoveM: SAT_VEG.refreshMoveM, refreshSec: SAT_VEG.refreshSec,
  },
  clutter: {
    engineName: 'satClutter', z: CLUTTER.ring.z, r: CLUTTER.ring.r,
    maxChunks: CLUTTER.maxChunks,
    refreshMoveM: CLUTTER.refreshMoveM, refreshSec: CLUTTER.refreshSec,
  },
  roads: {
    engineName: 'satRoads', z: SAT_ROADS.ring.z, r: SAT_ROADS.ring.r,
    maxChunks: SAT_ROADS.maxChunks,
    refreshMoveM: SAT_ROADS.refreshMoveM, refreshSec: SAT_ROADS.refreshSec,
  },
};

/** 20 legs: five speeds (slow → the shipped boost ceiling) × four turn rates. */
const MATRIX = [];
for (const s of [120, 200, 300, 500, 750]) for (const tr of [0, 5, 15, 30]) MATRIX.push([s, tr]);

function sweepRing(R, ringHoldOn, leadSafeOn, extra = {}) {
  let thrash = 0, membershipReentries = 0, maxKept = 0, maxResident = 0, evictions = 0;
  let legacyMismatch = 0, refreshes = 0, maxCand = 0;
  for (const [speedMps, turnDegPerSec] of MATRIX) {
    const o = run({ ...R, speedMps, turnDegPerSec, ringHoldOn, leadSafeOn, ...extra });
    thrash += o.thrash;
    membershipReentries += o.membershipReentries;
    evictions += o.evictions;
    legacyMismatch += o.legacyMismatch;
    refreshes += o.refreshes;
    maxKept = Math.max(maxKept, o.maxKept);
    maxResident = Math.max(maxResident, o.maxResident);
    maxCand = Math.max(maxCand, o.maxCand);
  }
  return { thrash, membershipReentries, evictions, legacyMismatch, refreshes, maxKept, maxResident, maxCand };
}

/* ══════════════════════════════ THE GATES ═════════════════════════════════ */

console.log('R24 B — verify-ringhold (SELECTION SIM; NOT a live gate — read the header)\n');
console.log(
  `constants read from source: RING_HOLD ${JSON.stringify(RING_HOLD)} · LEAD_SAFE.enabled ` +
    `${LEAD_SAFE.enabled} · caps ${JSON.stringify(LEAD_SAFE.capByEngine)} · maxLeadFrac ` +
    `${STREAM_KEEPER.lookahead.maxLeadFrac}\n`
);

const CRUISE = 200, BOOST = 750, TURN = 15;
const B = RINGS.buildings;

// ---- (1)(2) the Wave-1 integers reproduce, and are labelled honestly --------
const w1c = run({ ...B, speedMps: CRUISE, turnDegPerSec: TURN, ringHoldOn: false, leadSafeOn: false });
const w1b = run({ ...B, speedMps: BOOST, turnDegPerSec: TURN, ringHoldOn: false, leadSafeOn: false });
gate(
  1,
  w1c.membershipReentries === 17,
  `WAVE-1 REPRO cruise ${CRUISE} m/s / ${TURN}°/s — keep-set re-entries ${w1c.membershipReentries} (Wave-1: 17). ` +
    `NOT the defect count: only ${w1c.thrash} of them were dropped while still nearby (see the header).`
);
gate(
  2,
  w1b.membershipReentries === 52,
  `WAVE-1 REPRO boost ${BOOST} m/s / ${TURN}°/s — keep-set re-entries ${w1b.membershipReentries} (Wave-1: 52), ` +
    `of which ${w1b.thrash} are thrash. A 15°/s turn re-flies its own tiles; that is the ring working.`
);

// ---- (3)-(6) THE DEFECT METRIC, RED exact and GREEN exact ------------------
const RED = {}, GRN = {};
for (const [nm, R] of Object.entries(RINGS)) {
  RED[nm] = sweepRing(R, false, false);
  GRN[nm] = sweepRing(R, true, true);
}
const EXPECT_RED = { buildings: 121, veg: 48, clutter: 0, roads: 88 };
const EXPECT_GRN = { buildings: 69, veg: 1, clutter: 0, roads: 59 };
let n = 3;
for (const nm of ['buildings', 'veg', 'clutter', 'roads']) {
  const red = RED[nm].thrash, grn = GRN[nm].thrash;
  const ok = red === EXPECT_RED[nm] && grn === EXPECT_GRN[nm];
  gate(
    n++,
    ok,
    `${nm.toUpperCase()} thrash over the 20-leg matrix — RED ${red} (frozen ${EXPECT_RED[nm]}) → ` +
      `GREEN ${grn} (frozen ${EXPECT_GRN[nm]})` +
      (red > 0 ? `, ${(100 * (1 - grn / red)).toFixed(0)}% removed` : ' — clean on both arms, the fix is insurance here')
  );
}

// ---- (7) ATTRIBUTION — which fix earns which win ---------------------------
const attrib = Object.fromEntries(
  Object.entries(RINGS).map(([nm, R]) => [
    nm,
    { rh: sweepRing(R, true, false).thrash, ls: sweepRing(R, false, true).thrash },
  ])
);
gate(
  7,
  attrib.veg.rh < RED.veg.thrash && attrib.veg.ls < RED.veg.thrash && GRN.veg.thrash < Math.min(attrib.veg.rh, attrib.veg.ls),
  'ATTRIBUTION — the two fixes are independent and they COMPOSE on the veg ring: ' +
    Object.entries(attrib)
      .map(([nm, a]) => `${nm} ${RED[nm].thrash}→RH ${a.rh}/LS ${a.ls}→both ${GRN[nm].thrash}`)
      .join(' · ') +
    '. LEAD_SAFE is a no-op on buildings/clutter/roads BY DESIGN (their caps equal their present maxima).'
);

// ---- (8) buildSec sensitivity ----------------------------------------------
const bSweep = [0, 0.8, 2.0].map((b) => ({
  b,
  red: sweepRing(B, false, false, { buildSec: b }).thrash,
  grn: sweepRing(B, true, true, { buildSec: b }).thrash,
}));
gate(
  8,
  bSweep.every((s) => s.grn < s.red),
  'buildSec SWEEP — the build-latency model parameter does not decide the verdict: ' +
    bSweep.map((s) => `b=${s.b}s ${s.red}→${s.grn}`).join(' · ')
);

// ---- (9) instrument sensitivity --------------------------------------------
const iSweep = [];
for (const winSec of [3, 6, 10])
  for (const nearMul of [1.0, 1.25, 1.5])
    iSweep.push({
      winSec, nearMul,
      red: sweepRing(B, false, false, { winSec, nearMul }).thrash,
      grn: sweepRing(B, true, true, { winSec, nearMul }).thrash,
    });
gate(
  9,
  iSweep.every((s) => s.grn <= s.red) && iSweep.some((s) => s.grn < s.red),
  `INSTRUMENT SWEEP — the direction never flips across ${iSweep.length} (winSec, nearMul) settings: ` +
    iSweep.map((s) => `${s.winSec}s/${s.nearMul} ${s.red}→${s.grn}`).join(' · ')
);

// ---- (10) HARD BOUNDS -------------------------------------------------------
const H = RING_HOLD.keepHysteresis;
const boundRows = Object.entries(RINGS).map(([nm, R]) => ({
  nm, cap: R.maxChunks, keep: GRN[nm].maxKept, res: GRN[nm].maxResident,
}));
gate(
  10,
  boundRows.every((b) => b.keep <= b.cap && b.res <= b.cap + H),
  'HARD BOUNDS — keep <= maxChunks at every refresh of every leg, resident <= maxChunks + keepHysteresis: ' +
    boundRows.map((b) => `${b.nm} keep ${b.keep}/${b.cap} resident ${b.res}/${b.cap + H}`).join(' · ') +
    `. An EMPTY tile issues no mesh, so "+${H} records" is an upper bound on draws and is reached only where the ` +
    'ring is dense; the fixed-pose building gate has 149 draws of headroom (226 <= 375).'
);

// ---- (11) FLAG-OFF IDENTITY -------------------------------------------------
const idm = Object.values(RED).reduce((a, r) => a + r.legacyMismatch, 0);
const idr = Object.values(RED).reduce((a, r) => a + r.refreshes, 0);
gate(
  11,
  idm === 0,
  `FLAG-OFF IDENTITY — with RING_HOLD and LEAD_SAFE off the kept set is the verbatim pre-R24 ` +
    `slice(0, maxChunks) at every one of ${idr} refreshes across all four rings (mismatches ${idm})`
);

/* ═══════════════ (12)(13) LEAD_SAFE — the coverage guarantee ══════════════ */

/** Exact: the nearest UNCOVERED point is the closest point of some non-kept cell. */
function guaranteed(px, pz, keep, z) {
  const span = WORLD_SIZE / 2 ** z;
  const half = WORLD_SIZE / 2;
  const ptx = Math.floor((px + half) / span);
  const pty = Math.floor((pz + half) / span);
  let best = Infinity;
  for (let ty = pty - 6; ty <= pty + 6; ty++)
    for (let tx = ptx - 6; tx <= ptx + 6; tx++) {
      if (keep.has(`${z}/${tx}/${ty}`)) continue;
      const minX = -half + tx * span;
      const minZ = -(half - ty * span);
      const dx = Math.max(minX - px, 0, px - (minX + span));
      const dz = Math.max(minZ - pz, 0, pz - (minZ + span));
      const d = Math.hypot(dx, dz);
      if (d < best) best = d;
    }
  return best;
}

function worstGuaranteed(z, r, maxChunks, lead, NP = 17, NB = 72) {
  const span = WORLD_SIZE / 2 ** z;
  const half = WORLD_SIZE / 2;
  const bx = -half + 1000 * span;
  const bz = -(half - 1000 * span);
  let worst = Infinity;
  for (let i = 0; i < NP; i++)
    for (let j = 0; j < NP; j++) {
      const px = bx + (i / (NP - 1)) * span * 0.9999;
      const pz = bz + (j / (NP - 1)) * span * 0.9999;
      for (let k = 0; k < NB; k++) {
        const a = (k / NB) * 2 * Math.PI;
        const keep = new Set(
          desiredSet(px + Math.cos(a) * lead, pz + Math.sin(a) * lead, z, r)
            .slice(0, maxChunks).map((e) => e.key)
        );
        const g = guaranteed(px, pz, keep, z);
        if (g < worst) worst = g;
      }
    }
  return worst;
}

function bisectSafeLead(z, r, maxChunks, need) {
  let lo = 0;
  let hi = STREAM_KEEPER.lookahead.maxLeadFrac * r;
  if (worstGuaranteed(z, r, maxChunks, hi) >= need) return hi;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (worstGuaranteed(z, r, maxChunks, mid) >= need) lo = mid;
    else hi = mid;
  }
  return lo;
}

const COV = [
  {
    name: 'satVeg', z: SAT_VEG.ring.z, r: SAT_VEG.ring.r, n: SAT_VEG.maxChunksByTier.high,
    need: SAT_VEG.distFade.endM, why: 'SAT_VEG.distFade.endM',
  },
  {
    name: 'satClutter', z: CLUTTER.ring.z, r: CLUTTER.ring.r, n: CLUTTER.maxChunks,
    need: Math.max(CLUTTER.cars.parked.rangeM, CLUTTER.cars.moving.rangeM, CLUTTER.poles.rangeM),
    why: 'max(CLUTTER cars/poles rangeM)',
  },
].map((R) => {
  const today = STREAM_KEEPER.lookahead.maxLeadFrac * R.r;
  return {
    ...R, today,
    g0: worstGuaranteed(R.z, R.r, R.n, 0),
    gUncapped: worstGuaranteed(R.z, R.r, R.n, today),
    gShipped: worstGuaranteed(R.z, R.r, R.n, leadCapM(R.name, R.r, true)),
    cap: LEAD_SAFE.capByEngine[R.name],
    safe: bisectSafeLead(R.z, R.r, R.n, R.need),
  };
});

gate(
  12,
  COV.every((c) => c.g0 >= c.need),
  'MODEL VALIDATION — the lead-free guarantee reproduces both shipped prose invariants: ' +
    COV.map((c) => `${c.name} G(0) ${Math.round(c.g0)} >= ${c.need} (${c.why})`).join(' · ')
);
gate(
  13,
  COV.every((c) => c.gUncapped < c.need && c.gShipped >= c.need && c.cap <= Math.floor(c.safe) + 1),
  'LEAD_SAFE — RED (uncapped lead) breaks the guarantee, GREEN (shipped cap) restores it, and the ' +
    'shipped cap does not exceed the bisected safe lead: ' +
    COV.map((c) =>
      `${c.name} lead ${Math.round(c.today)}→${c.cap}: G ${Math.round(c.gUncapped)} < ${c.need} → ` +
      `${Math.round(c.gShipped)} >= ${c.need} (safe ${Math.floor(c.safe)})`
    ).join(' · ')
);

// ---- (14) the long rings: the cap is a proven no-op -------------------------
const NOOP = [['satBuildings', SAT_COVERAGE.high.ringM], ['satRoads', SAT_ROADS.ring.r], ['satSkyline', 14000]];
gate(
  14,
  NOOP.every(([nm, r]) => leadCapM(nm, r, true) === leadCapM(nm, r, false)),
  'LEAD_SAFE NO-OP on the three rings with no per-instance consumer range: ' +
    NOOP.map(([nm, r]) => `${nm} ${leadCapM(nm, r, true)} === uncapped ${leadCapM(nm, r, false)}`).join(' · ')
);

if (ARGS.has('--derive') || ARGS.has('--verbose')) {
  console.log('\n--- LEAD_SAFE derivation (exact bisection, 17×17 positions × 72 bearings) ---');
  console.log('ring          lead@0.35r   G(0)   G(uncapped)   G(shipped)   need   safe   SHIPPED');
  for (const c of COV)
    console.log(
      `${c.name.padEnd(13)} ${String(Math.round(c.today)).padStart(6)}  ${String(Math.round(c.g0)).padStart(6)}  ` +
        `${String(Math.round(c.gUncapped)).padStart(11)}  ${String(Math.round(c.gShipped)).padStart(10)}  ` +
        `${String(c.need).padStart(5)}  ${String(Math.floor(c.safe)).padStart(5)}  ${String(c.cap).padStart(6)}`
    );
  console.log('\n--- per-ring attribution (thrash, 20 legs) ---');
  for (const nm of Object.keys(RINGS))
    console.log(
      `${nm.padEnd(11)} off ${String(RED[nm].thrash).padStart(4)} · RING_HOLD ${String(attrib[nm].rh).padStart(4)} ` +
        `· LEAD_SAFE ${String(attrib[nm].ls).padStart(4)} · both ${String(GRN[nm].thrash).padStart(4)} ` +
        `· candidates ${RED[nm].maxCand} for ${RINGS[nm].maxChunks} slots`
    );
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length ? 'VERIFY: FAIL' : 'VERIFY: PASS'} ${results.length - failed.length}/${results.length}`
);
console.log(
  'NOTE: a SELECTION SIM on a machine with no tile egress and no GPU. It certifies the arithmetic\n' +
    'and the bounds, and it is red-calibrated. It does NOT certify what a pilot sees — that needs\n' +
    'scripts/r24-b-probe-live.js on a machine that can stream a world.'
);
process.exit(failed.length ? 1 : 0);
