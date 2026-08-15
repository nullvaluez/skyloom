'use client';

import { ARRIVAL_GATE, MOTION_R24, SETTLE_CALM, WARP } from '@/lib/fly/fly-constants';

/**
 * ROUND 22 (B SETTLE) — the shared arrival/birth machinery.
 *
 * One module, because every mechanism in this charter is the same three
 * questions asked by six different layers:
 *
 *   (1) WHEN did the world become visible?  (`markReveal` / `sinceRevealMs`)
 *       Boot reveal and every warp reveal are the same event as far as
 *       settling is concerned: the moment the player can see whatever is or
 *       is not there. Everything else is measured against it.
 *   (2) IS THIS LAYER BEING BORN?  (`birthK`) — a 0→1 envelope armed the
 *       first time a layer has content in the current arrival epoch, so a
 *       layer can fade in instead of appearing between two frames.
 *   (3) DID IT POP?  (`notePopin` / `noteFrame`) — the instruments E CERT
 *       reads: per-layer first appearance relative to reveal, and the
 *       long-frame counter over the first 10 s after it.
 *
 * THE FLAG AND THE PIN. Every mechanism here is inert unless
 * `SETTLE_CALM.enabled` (or, for the reveal gates, `ARRIVAL_GATE.enabled`)
 * AND the fleet pin `window.__flySettlePin` is absent. The pin is the R21
 * `__flyGovPin` idiom verbatim: scripts/_boot.js sets it fleet-wide so every
 * existing harness keeps seeing the pre-R22 timing, and only E's new gates
 * un-pin. `birthK`, `arrivalTerms` and `groundElevVisStep` all return their
 * legacy identity values when either is off, so a flag-off tree is
 * byte-identical by construction — no caller needs its own test.
 *
 * The instruments (`notePopin`, `noteFrame`) are the ONE exception: they run
 * regardless, because a measurement of the un-flagged tree is exactly what
 * the flagged one has to be compared against.
 */

// ---------------------------------------------------------------------------
// Flag / pin resolution
// ---------------------------------------------------------------------------

/**
 * The DEV A/B HANDLES. `window.__flySettleForce` / `__flyArrivalForce` = 1
 * arm a family regardless of its constant AND of the fleet pin; = 0 disarms
 * it the same way. They are how B's own measurement probes (and E's gates)
 * take a before/after inside one build without editing a constant, which is
 * the R19 `__flyAerialOverride` idiom. Absent ⇒ the constant + pin decide.
 */
function forced(name) {
  if (typeof window === 'undefined') return null;
  const v = window[name];
  return v === 1 ? true : v === 0 ? false : null;
}

/** The fleet determinism pin (scripts/_boot.js) — 1 ⇒ legacy behavior. */
export function settlePinned() {
  return typeof window !== 'undefined' && window.__flySettlePin === 1;
}

/** Birth fades, prewarm slicing, ladder fix, groundElev damping, arrival calm. */
export function settleOn() {
  const f = forced('__flySettleForce');
  if (f !== null) return f;
  return SETTLE_CALM.enabled && !settlePinned();
}

/** Content-aware boot/warp reveals. */
export function arrivalOn() {
  const f = forced('__flyArrivalForce');
  if (f !== null) return f;
  return ARRIVAL_GATE.enabled && !settlePinned();
}

// ---------------------------------------------------------------------------
// ROUND 24 (C "MOTION-STATE") — the motion family's flag resolution
// ---------------------------------------------------------------------------
/**
 * R24 "Motion Hold". The Wave-1 diagnosis found no ordering defect anywhere in
 * the frame loop — the camera pose is written at priority −50 before every
 * consumer, and `scene.updateMatrixWorld()` refreshes every matrix before the
 * frustum is built — so nothing reads a stale TRANSFORM. Everything the user
 * reported as "the state of render lags when moving fast" traces instead to a
 * THROTTLE, and every throttle that mattered turned out to be speed-blind:
 *
 *   aglTruth  the veg + clutter ground stack read the RAW `flight.groundElev`
 *             while their four sibling layers read the DAMPED `groundElevVis`
 *             — R22's S-ELEV fix re-pointed buildings/roads/skyline/parcel and
 *             missed these two. A raw DEM step (R22 measured ~384 m/frame) is
 *             64 % of veg's 600 m altFade band and LARGER than the whole band
 *             for CLUTTER poles (600→900 m). Ships ON; B owns the call sites.
 *   grades    the two satellite GROUND-PLANE grades — SAT_QUILT and
 *             HILLSHADE.micro — were never re-pointed either, and they are
 *             uniform writes, so a raw step repaints every ground pixel on one
 *             frame with no geometry and no draw-count change (which is why no
 *             draw gate, census or FROZEN-POSE pixel gate in the fleet can see
 *             it: a frozen aircraft has a settled groundElev). Ships ON.
 *   elevGate  `flight.groundElev` is sampled with NO tile-zoom quality gate
 *             (FlyScene's ground block) while the two traffic samplers 600
 *             lines above it both gate `tileZ < 11` with the comment "a coarse
 *             fallback DEM tile answers with plateau garbage". BUILT, OFF.
 *   elevSlew  the damper is a rate clamp in metres of ELEVATION per second
 *             with no term for how fast the aircraft is crossing terrain, and
 *             its `Math.min(0.05, dt)` clamp makes it slew SLOWER during the
 *             very stutter it exists to smooth. BUILT, OFF.
 *   paceBySpeed  the pooled ground layers re-evaluate their distance/altitude
 *             ramps on a 2 s wall clock. At the user's own recorded 350 kt that
 *             crosses 79 % of veg's 458 m distFade band in ONE frame; at boost
 *             it crosses 327 % — i.e. a tree goes 1 → 0 instantly. BUILT, OFF.
 *
 * The three OFF families are off on MY OWN Wave-1 risk ruling, upheld by the
 * round: each of them can only be judged by measurement, and this environment
 * cannot measure (SwiftShader ~1 fps, both tile hosts 403). Arming one against
 * an argument rather than a number is exactly what R22's §5 lessons forbid.
 *
 * `MOTION_R24.enabled: false` ⇒ every function below returns its legacy value
 * and every call site takes its verbatim pre-R24 expression.
 */

/**
 * DEV-ONLY live arm, the `__flyDepthArm` / `__flyTerraForce` idiom:
 *
 *   window.__flyMotion.set('paceBySpeed', true)   // arm one family
 *   window.__flyMotion.set('paceBySpeed', null)   // hand it back to the flag
 *   window.__flyMotion.get()                      // what is actually live
 *
 * Absent (and every value that is not exactly 0/1/false/true) ⇒ the constant
 * decides. Never read in a production build.
 */
function motionForced(name) {
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return null;
  const f = window.__flyMotionArm;
  if (!f || typeof f !== 'object') return null;
  const v = f[name];
  return v === 1 || v === true ? true : v === 0 || v === false ? false : null;
}

/** The R24 master arm. */
export function motionOn() {
  const f = motionForced('enabled');
  if (f !== null) return f;
  return !!MOTION_R24?.enabled;
}

/**
 * One sub-family. Folds the master, the constant and the dev arm in that
 * order — so a family can never be live with the master off, which is what
 * makes `MOTION_R24.enabled:false` a true one-line revert rather than four.
 */
export function motionSubOn(name) {
  if (!motionOn()) return false;
  const f = motionForced(name);
  if (f !== null) return f;
  return !!MOTION_R24?.[name]?.enabled;
}

// The handle itself. Module scope (settle.js has no mount point), idempotent
// against HMR re-evaluation and a StrictMode double-invoke, and compiled out
// of production by the NODE_ENV test.
if (
  process.env.NODE_ENV === 'development' &&
  typeof window !== 'undefined' &&
  !window.__flyMotion
) {
  window.__flyMotion = {
    set: (name, v) => {
      const f = (window.__flyMotionArm ??= {});
      if (v == null) delete f[name];
      else f[name] = v ? 1 : 0;
      return window.__flyMotion.get();
    },
    clear: () => {
      delete window.__flyMotionArm;
      return window.__flyMotion.get();
    },
    get: () => ({
      master: motionOn(),
      aglTruth: motionSubOn('aglTruth'),
      grades: motionSubOn('grades'),
      elevGate: motionSubOn('elevGate'),
      elevSlew: motionSubOn('elevSlew'),
      paceBySpeed: motionSubOn('paceBySpeed'),
      arm: window.__flyMotionArm ?? null,
      constants: MOTION_R24 ?? null,
    }),
  };
}

// ---------------------------------------------------------------------------
// The arrival epoch + the reveal clock
// ---------------------------------------------------------------------------

const _reveal = {
  at: -1, // performance.now() of the last reveal (boot or warp), -1 = none yet
  kind: null, // 'boot' | 'warp'
  epoch: 0, // bumps on every ARRIVAL (warp START or boot), not on reveal
};

/**
 * A new arrival BEGINS. Called on every warpEpoch bump (the layers already
 * subscribe to it) — this is what re-arms every birth envelope so a
 * destination fades in instead of inheriting the origin's settled state.
 */
export function arrivalEpoch() {
  return _reveal.epoch;
}

export function bumpArrival(epoch) {
  if (epoch === _reveal.epoch) return;
  _reveal.epoch = epoch;
  _popin.layers = {};
  _popin.longFrames = 0;
  _popin.worstMs = 0;
  _reveal.at = -1; // …and the reveal for THIS arrival has not happened yet
}

/** The world just became visible. Boot reveal and warp reveal both land here. */
export function markReveal(kind) {
  _reveal.at = typeof performance !== 'undefined' ? performance.now() : 0;
  _reveal.kind = kind;
  _popin.revealKind = kind;
  _popin.longFrames = 0;
  _popin.worstMs = 0;
}

/** ms since the last reveal, or -1 while the overlay is still up. */
export function sinceRevealMs() {
  if (_reveal.at < 0) return -1;
  return (typeof performance !== 'undefined' ? performance.now() : 0) - _reveal.at;
}

// ---------------------------------------------------------------------------
// Instruments — `runtime.popin` (published by PrewarmRig, read by E's gates)
// ---------------------------------------------------------------------------

const POPIN_WINDOW_MS = 10000; // long-frame census window after a reveal
const LONG_FRAME_MS = 40;

const _popin = {
  revealKind: null,
  layers: {}, // name -> { atMs, sinceRevealMs, birthed }
  longFrames: 0,
  worstMs: 0,
  frames: 0,
};

/** Live state OBJECT (mutated in place) — the prewarm-state idiom. */
export function popinState() {
  return _popin;
}

/**
 * A layer reports whether it currently has anything on screen. The FIRST
 * `true` in an arrival epoch is its birth timestamp; later calls are free.
 * `birthed` records whether a birth envelope was actually running at that
 * moment, which is what turns "appeared at reveal+3.1 s" from a failure into
 * a pass (the §7 criterion is *hard* pops, not late content).
 */
export function notePopin(name, present, birthed = false) {
  if (!present) return;
  const rec = _popin.layers[name];
  if (rec) {
    if (birthed && !rec.birthed) rec.birthed = true;
    return;
  }
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  _popin.layers[name] = {
    atMs: Math.round(now),
    sinceRevealMs: _reveal.at < 0 ? -1 : Math.round(now - _reveal.at),
    birthed: !!birthed,
  };
}

/** One frame's delta (seconds). Counts long frames in the post-reveal window. */
export function noteFrame(dtSec) {
  const since = sinceRevealMs();
  if (since < 0 || since > POPIN_WINDOW_MS) return;
  const ms = dtSec * 1000;
  _popin.frames += 1;
  if (ms > LONG_FRAME_MS) {
    _popin.longFrames += 1;
    if (ms > _popin.worstMs) _popin.worstMs = Math.round(ms);
  }
}

// ---------------------------------------------------------------------------
// Birth envelopes
// ---------------------------------------------------------------------------

const smooth01 = (u) => {
  const t = u < 0 ? 0 : u > 1 ? 1 : u;
  return t * t * (3 - 2 * t);
};

/** Per-layer birth state. Lives in the layer's own ref — never module state. */
export function makeBirth() {
  return { epoch: -1, t0: -1, k: 1, running: false };
}

/**
 * The birth envelope, 0 → 1 over `rampSec`, re-armed on every arrival epoch.
 *
 * Returns 1 whenever the feature is off, so a caller can multiply it into its
 * existing visibility term unconditionally and stay byte-identical flag-off.
 *
 * `hasContent` is the layer's own answer to "is there anything to show yet";
 * the ramp starts on the first frame it is true, so a layer that streams for
 * six seconds fades in over the 600 ms AFTER its first chunk lands, not over
 * the 600 ms after the reveal (which it would spend invisible).
 */
export function birthK(b, nowSec, hasContent, epoch, rampSec) {
  if (!settleOn()) {
    b.k = 1;
    b.running = false;
    return 1;
  }
  if (epoch !== b.epoch) {
    b.epoch = epoch;
    b.t0 = -1;
    b.k = 0;
    b.running = false;
  }
  if (b.t0 < 0) {
    if (!hasContent) return b.k; // nothing to show: stay at 0, do not start
    b.t0 = nowSec;
  }
  const u = (nowSec - b.t0) / Math.max(0.05, rampSec);
  b.k = smooth01(u);
  b.running = u < 1;
  return b.k;
}

/**
 * A GLOBAL uniform written by an engine every frame, multiplied by a birth
 * envelope by its layer AFTER the engine's own write.
 *
 * The read-back is not naive: multiplying `get()` would compound frame over
 * frame on any frame the engine did not write (an engine that early-returns,
 * or a block whose flag is off and therefore never writes at all). So the
 * helper remembers the value it wrote last frame — if what it reads back is
 * that exact value, nobody wrote a fresh base and the previous base stands.
 */
export function makeUniformBirth() {
  return { lastWritten: Number.NaN, base: 1 };
}

export function applyUniformBirth(u, current, k, write) {
  if (!(current === u.lastWritten)) u.base = current; // NaN-safe on the first call
  const v = u.base * k;
  write(v);
  u.lastWritten = v;
  return v;
}

/**
 * Apply a UNIFORM scale envelope to an InstancedMesh's already-written
 * matrices, in place, without re-deriving a single instance.
 *
 * The trick that makes a 2,000-instance birth free: a uniform scale is a
 * multiply of the 3×3 rotation/scale block of every instance matrix, and it
 * COMPOSES — so applying k2 after k1 is applying k2/k1 to what is already
 * there. The translation column is untouched, so nothing slides (which is
 * exactly why `mesh.scale` cannot do this job: it would scale the pool-local
 * positions too and suck every house toward the pool origin).
 *
 * `env.k` is the factor currently baked into the buffer. A placement pass
 * that rewrites matrices at full size must reset it to 1 (`resetEnv`).
 */
export function makeEnv() {
  return { k: 1 };
}

export function resetEnv(env) {
  env.k = 1;
}

const ENV_EPS = 0.002;

export function applyInstanceEnv(mesh, env, k, count) {
  if (!mesh || !mesh.instanceMatrix) return false;
  const target = k < 1e-4 ? 1e-4 : k > 1 ? 1 : k;
  if (Math.abs(target - env.k) < ENV_EPS) return false;
  const ratio = target / env.k;
  const arr = mesh.instanceMatrix.array;
  const n = Math.min(count ?? mesh.count, mesh.instanceMatrix.count);
  for (let i = 0; i < n; i++) {
    const o = i * 16;
    // Columns 0..2 (the rotation/scale basis). Column 3 = translation, kept.
    arr[o] *= ratio;
    arr[o + 1] *= ratio;
    arr[o + 2] *= ratio;
    arr[o + 4] *= ratio;
    arr[o + 5] *= ratio;
    arr[o + 6] *= ratio;
    arr[o + 8] *= ratio;
    arr[o + 9] *= ratio;
    arr[o + 10] *= ratio;
  }
  env.k = target;
  return n > 0;
}

// ---------------------------------------------------------------------------
// groundElevVis — the DAMPED visual ground elevation
// ---------------------------------------------------------------------------

const _gev = { v: null, epoch: -1 };

/**
 * Slew-limit the visual ground elevation. The raw `flight.groundElev` is a
 * DEM sample that refines under the aircraft — it is seeded 0 at spawn and at
 * every warp, so every AGL-keyed fade band in the satellite stack (the
 * building dissolve, the skyline hole, the parcel altitude fade, the road ring
 * arm) gets swept through its whole range in the first seconds of an arrival
 * as the DEM sharpens. Slewing it at `slewMps` turns a 400 m step into a 5 s
 * glide; a warp SNAPS (a new place is a new truth, not a change in this one).
 *
 * The flight model and the crash floor keep reading the RAW value — safety
 * never reads a damped signal.
 *
 * ── R24 (C MOTION-STATE), `MOTION_R24.elevSlew` — BUILT, SHIPS OFF ─────────
 * Two measured faults in the clamp above, neither of which the R22 gate could
 * see because verify-settle measures it at a FROZEN pose:
 *
 *  (1) IT IS SPEED-BLIND. `slewMps` is metres of ELEVATION per second. Flying a
 *      10 % slope at 180 m/s means terrain rises at 18 m/s and the clamp tracks
 *      it; crossing a canyon rim, a plateau edge or a coastline steps hundreds
 *      of metres at ANY speed and the clamp then needs 5 s to cover 400 m. For
 *      those 5 s every damped consumer computes an `eyeAgl` wrong by up to
 *      400 m — enough to push a solid city into SAT_BLDG_FADE's dither band
 *      (2400→3000) or past `evictAglM` 3200. `stepSnapM` is the fix: a jump
 *      that large is not a REFINEMENT of this place's ground, it is a different
 *      place, and the warp path already snaps for exactly that reason.
 *  (2) IT IS FRAME-RATE COUPLED, THE WRONG WAY. `Math.min(0.05, dtSec)` means a
 *      100 ms frame advances 4 m where the elapsed time earned 8 — so the
 *      damper falls FURTHER behind during the 33–91 ms stutter frames R22.1
 *      measured. `dtFloorSec` is the knob; at its shipped value of 0.05 the
 *      armed arithmetic is identical to today's, so arming this family at
 *      defaults changes exactly ONE thing (the snap) and nothing else.
 *
 * It ships OFF because `stepSnapM` re-introduces the very pop R22 removed if it
 * is set too low, and 120 m is an ESTIMATE — it must come from the P2 trace in
 * scripts/r24-c-agl.js, on a machine that can actually stream a world, before
 * anyone arms it. Because it ships off, verify-settle's frozen gate (10)
 * ("visual slew 1.67 m/frame against 384 m/frame raw") is UNMOVED this round —
 * the concern raised in the Wave-1 fix sketch is moot until the flag flips, and
 * the companion assertion it will then need is named in scripts/r24-c-agl.js.
 */
export function groundElevVisStep(raw, dtSec, epoch) {
  if (!settleOn() || !SETTLE_CALM.groundElevVis) {
    _gev.v = raw;
    _gev.epoch = epoch;
    return raw;
  }
  if (_gev.v == null || epoch !== _gev.epoch) {
    _gev.v = raw;
    _gev.epoch = epoch;
    return raw;
  }
  // `null` ⇒ every expression below is the verbatim pre-R24 one.
  const ES = motionSubOn('elevSlew') ? MOTION_R24.elevSlew : null;
  const d = raw - _gev.v;
  if (ES && ES.stepSnapM > 0 && Math.abs(d) > ES.stepSnapM) {
    // A discontinuity, not a refinement. Snap — and deliberately do NOT touch
    // `_gev.epoch`: it already equals `epoch` (the early return above is the
    // only writer) and a snap is not an arrival.
    _gev.v = raw;
    return raw;
  }
  const max =
    (ES ? ES.slewMps : SETTLE_CALM.groundElevVis.slewMps) *
    Math.max(0, Math.min(ES ? ES.dtFloorSec : 0.05, dtSec));
  _gev.v += Math.abs(d) <= max ? d : Math.sign(d) * max;
  return _gev.v;
}

/**
 * Visual ground elevation with a legacy fallback (pre-FlyScene-publish).
 *
 * R24 (C): this is the ONE accessor every visual AGL consumer must use, and
 * the R24 `aglTruth` work is nothing more than pointing the two layers R22
 * missed (veg, clutter) and the two ground grades (SAT_QUILT, HILLSHADE.micro)
 * at it. It degrades to the raw value by construction, so a caller needs no
 * flag test of its own and a flag-off tree is byte-identical at every site.
 */
export function groundElevVis(runtime, flight) {
  const v = runtime?.groundElevVis;
  return Number.isFinite(v) ? v : flight.groundElev;
}

// ---------------------------------------------------------------------------
// paceCadenceSec — the SPEED-AWARE placement cadence (R24 C, BUILT, SHIPS OFF)
// ---------------------------------------------------------------------------

/**
 * Scale a wall-clock placement cadence by ground speed.
 *
 * THE DEFECT IT CLOSES, as arithmetic rather than as a claim. The pooled ground
 * layers (canopy, clutter, house lights, parcel homes, landcover tint) fold
 * their distance AND altitude ramps into the instance matrix that ONLY the
 * cadence pass writes — SAT_VEG's own constant says so ("Scale is also free —
 * it folds into the matrix the cadence pass already writes"). So the ramp is
 * SAMPLED at `placeCadenceSec` (2 s), not per frame. World units are
 * `true metres x 1/cos(lat)`, so at Powell OH (40.17 deg, cos 0.764) SAT_VEG's
 * 600 wu distFade band is 458 true metres wide, and:
 *
 *   ground speed        travel per 2 s tick     fraction of the band crossed
 *                                               IN ONE FRAME
 *   180 m/s (350 kt)    360 m                   79 %
 *   750 m/s (boost)     1500 m                  327 %  <- 1 -> 0 instantly
 *
 * 350 kt is the user's OWN recorded pose (scripts/r22p1-b-stutter.md §1). The
 * engine's stride decimation already guarantees WHICH trees survive a pool cut;
 * it has nothing to say about WHEN the ramp is sampled, and that is the blink.
 *
 * `refMps` 120 is chosen so cruise-and-below is the IDENTITY — the cadence only
 * shortens above the speed at which the arithmetic above starts to bite — and
 * `minCadenceSec` floors it so a boost pass cannot turn a 2 s pool rebuild into
 * a per-frame one.
 *
 * WHY IT SHIPS OFF: this is the one R24 change that COSTS frame time. A place
 * pass is a full pool re-derivation plus a ranged upload; at boost this asks
 * for it ~5.7x more often. That is a gpuFrameMs/CPU question and this
 * environment cannot answer it (SwiftShader, ~1 fps, tile hosts 403). It is a
 * built-but-off feature in the DEPTH_PASS mould: measured first, armed second.
 *
 * Contract: identity (`baseSec` returned unchanged, same object-free path) when
 * the master flag or `paceBySpeed` is off, when `speedMps` is not finite, and
 * at every speed at or below `refMps`. Never returns 0 or NaN.
 */
export function paceCadenceSec(baseSec, speedMps) {
  if (!motionSubOn('paceBySpeed')) return baseSec;
  const P = MOTION_R24?.paceBySpeed;
  if (!P) return baseSec;
  const ref = P.refMps > 0 ? P.refMps : 0;
  if (!(ref > 0)) return baseSec;
  const v = Number.isFinite(speedMps) ? Math.abs(speedMps) : 0;
  const k = v > ref ? v / ref : 1; // <= refMps is the identity, by construction
  if (k === 1) return baseSec;
  const floor = Number.isFinite(P.minCadenceSec) ? P.minCadenceSec : 0;
  return Math.max(floor, baseSec / k);
}

// ---------------------------------------------------------------------------
// ARRIVAL_GATE — "hold until sharp"
// ---------------------------------------------------------------------------

const frac = (ready, total) => (total > 0 ? ready / total : 0);

/**
 * The content terms a reveal may wait on, resolved from whatever is actually
 * mounted. EVERY term degrades to `true` when its producer is absent, which is
 * what makes this safe to ship before A TERRA merges and safe in toy, at low
 * tier, and with every R22 flag off.
 *
 *   terra   `runtime.terraStats.sharp` — A's contract. `undefined` ⇒ the
 *           LEGACY `engine.downloading < WARP.far.readyDownloads` test, i.e.
 *           exactly what WarpFlash polls today.
 *   bldg    the satellite building ring's resolved fraction, consulted ONLY
 *           while the camera is inside the band where that ring mounts at all
 *           (`agl <= maxAglM` of the layer). Above it the ring is deliberately
 *           empty and waiting for it would be waiting for nothing.
 *   road    the same for the road ring (published on the runtime bus by
 *           SatRoadLayer, the R18 `runtime.satBuildings` idiom).
 *   parcel  the R21 trust gate has RESOLVED — the layer has either placed or
 *           decided not to. A held parcel pass is the one thing guaranteed to
 *           still be changing the picture after the reveal.
 */
export function arrivalTerms(runtime, aglM) {
  const out = { terra: true, bldg: true, road: true, parcel: true, legacy: false };
  if (!runtime) return out;

  const ts = runtime.terraStats;
  if (ts && typeof ts === 'object') {
    out.terra = ts.sharp === true;
    out.camTileZ = ts.camTileZ;
    out.targetZ = ts.targetZ;
  } else {
    out.legacy = true;
    out.terra = (runtime.engine?.downloading ?? 0) < WARP.far.readyDownloads;
  }

  const R = ARRIVAL_GATE.ringTerms;
  const bs = runtime.satBuildings?.stats;
  if (bs && bs.chunks > 0 && aglM <= (runtime.satBuildingsBandM ?? Infinity)) {
    out.bldgFrac = frac(bs.ready + bs.empty, bs.chunks);
    out.bldg = out.bldgFrac >= R.buildingReadyFrac;
  }
  const rs = runtime.satRoads?.stats;
  if (rs && rs.chunks > 0 && aglM <= (runtime.satRoadsBandM ?? Infinity)) {
    out.roadFrac = frac(rs.ready + rs.empty, rs.chunks);
    out.road = out.roadFrac >= R.roadReadyFrac;
  }
  const ps = runtime.parcelSettle;
  if (ps && ps.mounted) out.parcel = ps.resolved === true;

  out.ready = out.terra && out.bldg && out.road && out.parcel;
  return out;
}
