import { markPhase } from '../frame-stats';
import { sceneryFlightPath } from '../scenery-flight-path';
import { trueAreasRequest } from '../true-areas';
import { premiumWorldRequest } from '../premium-earth';
import { BUILDING_APPROACH_ON, CITY_CONTINUITY_ON, CITY_GEOMETRY_LOD_ON } from '../world-clarity';
import { worldPassRequest, worldPassMatch, worldPassDiag, worldPassCounters, skylineStandInConfig, worldPassTierAllowed } from '../world-pass';
// WORLD PASS C (REACH): the far city as one lean stand-in per building.
import { createStandInMaterial, createStandInUniforms } from '../sat-stand-in-material';
import { drapeStandIns, createStandInGeometry, countAtLeast, STAND_IN_TRIANGLES } from './sat-stand-ins';
import { createStandInPreparation, advanceStandInPreparation } from './sat-stand-in-prep';
import { createStandInPhotos, createPhotoAtlas } from './sat-stand-in-photo'; // WORLD PASS C (round 2b): the ground photo, main thread
import { sumStageRecords } from './world-pass-stages'; // WORLD PASS W0 diag counters
import { beginGroundBatch, endGroundBatch } from '../terrain-ground-query'; // WORLD PASS C (round 2): stream B's batch
import { mayFinalize } from '../finalize-pace';
import { satelliteVisualsOn } from '../satellite-visuals';
import { fillSkylineGrid, applySkylineDrape } from '../skyline-drape';
import { createSatelliteArchitectureMaterial, setSatelliteArchitectureNight } from '../satellite-architecture-material';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Box3,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
} from 'three';
import {
  BEND_LEAD,
  CHUNK_FADE,
  LAMBERT_ENV,
  GLOBE,
  LEAD_SAFE,
  RING_HOLD,
  SAT_BLDG_FADE,
  SAT_BUILDINGS,
  SAT_SKYLINE,
  STREAM_KEEPER,
} from '../fly-constants';
import { applyBendAnchorSatSkyline, setSatSkyline } from './world-bend';
// SHIP PASS CITY (CT-1, CT-2): the detail ring's band and the skyline request options.
import { cityRangeRequest, makeBandMemo } from '../city-range';
import { cityHorizonFor, cityHorizonRequest, horizonMercatorK, horizonFadeBand } from '../city-horizon';
import { setCityHorizonFade } from './world-bend';
// R24 (E CERT): harness-only per-frame budget scaler — exactly 1 in production.
import { budgetK } from '../harness-budget';
// R24 B (FLASH_GUARD, recon WB-1/A1b) — zero-area triangle filter at finalize.
import { censusDegenerate, guardIndex } from './flash-guard';
// R24 B (CHUNK_FADE, recon WB-2/A6) — per-mesh birth / deferred-evict ramps.
import { TwinPool, chunkFadeOn, fadeRamp, rampT } from './chunk-fade';
import { wpWholeFinalize } from './wp-frame-slice'; // WORLD PASS B x C seam (one finalize allowance a frame)

// REACH retains its exclusive-frame fairness lane, but consumes only this
// bounded slice in it. ARRIVAL keeps the existing wp-frame-slice admission.
const STAND_IN_SLICE_MS = 2.5;

// --- Round 24 (B STREAM) — LEAD_SAFE + RING_HOLD ----------------------------
// File-local copies; the CANONICAL commentary lives once in the block of the
// same name in sat-building-engine.js. Flag off ⇒ verbatim pre-R24.
//
// Like the road ring, the skyline has NO per-instance consumer range — its
// near-field hole and its AGL fade are both shader terms on the whole mesh — so
// LEAD_SAFE's entry for it is set to exactly its present effective maximum,
// 0.35 × 14000 = 4900. That makes the cap a PROVEN NO-OP here, which is the
// honest value: the coverage bisection that produced the veg and clutter caps
// does not model this ring (its chunks are groupN×groupN BLOCKS, not tiles), so
// deriving a tighter number for it would be a guess dressed as a measurement.
// RING_HOLD applies normally, and this ring is heavily over-subscribed: 41
// candidate groups compete for 10 slots at high tier.

/**
 * R24 (B) — the DEV A/B ARMS, the `__flyDepthArm` / `__flyFlashPin` idiom.
 * `window.__flyRingHold` / `window.__flyLeadSafe`: 1 forces the family ON, 0
 * forces it OFF, absent ⇒ the constant decides. They exist so scripts/
 * r24-b-probe-live.js can take a RED and a GREEN arm in ONE session on the
 * user's machine without editing a constant and rebuilding — which is the only
 * way this round's central claim (re-entries collapse under motion) can be
 * measured where a real world streams. NEVER set by the app or by
 * scripts/_boot.js, and compiled out of production by the NODE_ENV test.
 */
function ringHoldOn() {
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    const v = window.__flyRingHold;
    if (v === 1) return true;
    if (v === 0) return false;
  }
  return RING_HOLD.enabled;
}

function leadSafeOn() {
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    const v = window.__flyLeadSafe;
    if (v === 1) return true;
    if (v === 0) return false;
  }
  return LEAD_SAFE.enabled;
}

function leadCapM(name, ringR) {
  const base = STREAM_KEEPER.lookahead.maxLeadFrac * ringR;
  if (!leadSafeOn()) return base;
  const cap = LEAD_SAFE.capByEngine?.[name];
  return typeof cap === 'number' ? Math.min(base, cap) : base;
}

function ringHoldKeep(desired, maxChunks, chunks, keyOf, isLive) {
  const kept = desired.slice(0, maxChunks);
  if (!ringHoldOn()) return kept;
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

function residencyHeld(chunks, keep, nowSec, cx, cz, ringR) {
  const out = new Set();
  if (!ringHoldOn()) return out;
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

// Must match vector-tile.worker.js WORKER_PROTOCOL. A1 froze the 'sat-skyline'
// branch at protocol 14; a v13 worker (a stale HMR/dev-restart pairing) has no
// such branch at all and would answer `{empty:true}` forever, so the drop is
// belt-and-braces — but it is the SAME drop-and-warn contract the other three
// satellite engines take, and it is the honest read of "stale worker": render
// nothing, never wrong pixels, one dev warn telling the dev to hard-reload.
// Round 19 → 15: scaffolding lockstep (six pin sites, one diff). A HOMESTEAD
// re-arms the area hatch this round; a v14 worker predates it.
// Round 21 → 17: scaffolding lockstep (six pin sites, one diff). D PIPELINE
// re-orders skyline selection (hash shuffle + hatch ramp) this round — a v16
// bundle's members were picked by the R20 rule and must not mix.
const EXPECTED_WORKER_PROTOCOL = 27; // World Pass wave 2 (FLY_WORLD_PASS.md)
let _warnedProtocol = false;

const EARTH_R = 6378137;
const WORLD_SIZE = 2 * Math.PI * EARTH_R;
const RAD2DEG = 180 / Math.PI;

const smoothstep01 = (v) => {
  const t = v < 0 ? 0 : v > 1 ? 1 : v;
  return t * t * (3 - 2 * t);
};

// --- Round 21 (B STREAMKEEPER) ---------------------------------------------
// P1: this engine is the ONLY one that already padded its bounding sphere for
// the shader-side bend (SK.cullMarginM 1200, with the comment right below).
// That constant is not derived from anything: the real worst case is
// (ring evict radius + group half-diagonal)² · k, which for the shipped z14 ×
// groupN 2 ring is ~1.5 km — i.e. 1200 is an UNDERSHOOT and far groups can
// still false-cull at the screen edge. Under the flag the computed value takes
// over; with it off the frozen 1200 rules exactly as before.
const MAX_BEND_K = 1 / (2 * GLOBE.bendRadiusM.satellite);

function bendMarginM(ringAliveR, chunkHalfDiagM) {
  const B = STREAM_KEEPER.bendMargin;
  if (!STREAM_KEEPER.enabled || !B.enabled) return SAT_SKYLINE.cullMarginM;
  // R24 B (BEND_LEAD, recon WB-6) — the residual R21 left. The desired set is
  // centred on the LOOKAHEAD point, so a chunk stays alive out to
  // (1 + maxLeadFrac)·ringR from the player, while this pad was computed from
  // plain ringR. The shader's drop is quadratic in that distance, so a 35%
  // radius excess is ~82% more drop than the sphere was padded for — an
  // on-screen chunk frustum-culled while turning AT SPEED. R21's census ran on
  // the ORBIT phase (speed 0 ⇒ lead 0) and could not see it. Flag-off the
  // multiplier is exactly 1 and this line is the R21 body verbatim.
  const leadMul = BEND_LEAD.enabled ? 1 + (STREAM_KEEPER.lookahead?.maxLeadFrac ?? 0) : 1;
  const d = ringAliveR * leadMul + chunkHalfDiagM;
  return Math.max(SAT_SKYLINE.cullMarginM, d * d * MAX_BEND_K * B.pad);
}

function jitter1() {
  const j = STREAM_KEEPER.retry.jitter;
  return 1 + (Math.random() * 2 - 1) * j;
}

/**
 * P2 — a group whose children failed earns a capped, jittered rebuild. Every
 * typed throw from D PIPELINE lands here and is retryable in this one class:
 * `http-<code>` (5xx/429) and `http-timeout` (D's 12 s AbortController — a
 * stalled connection previously held an in-flight slot for minutes, leaving a
 * quarter of a merged city block missing with no error to retry against).
 */
function groupRetryAt(nowSec, attempts) {
  const R = STREAM_KEEPER.retry;
  const secs = Math.min(R.errorCapSec, R.errorBaseSec * 2 ** Math.max(0, attempts - 1));
  return nowSec + secs * jitter1();
}

function emptyByReason(chunks) {
  const out = { noData: 0, zero: 0, legacy: 0 };
  for (const c of chunks.values()) {
    if (c.state !== 'empty') continue;
    if (c.reason === 'no-data') out.noData += 1;
    else if (c.reason === 'zero') out.zero += 1;
    else out.legacy += 1;
  }
  return out;
}

/**
 * Round 18 (A2 "SKYLINE") — the DISTANT BLOCK-MASS streamer.
 *
 * WHY IT EXISTS. The satellite city ended at the detail ring's 3.6 km-unit
 * bubble and then vanished outright above ~2.4 km AGL (SAT_BLDG_FADE dithers
 * SatBuildingEngine's chunks away and evicts them). Both reads are "the world
 * is a small disc I am standing on". This engine draws the SAME city as
 * untextured block mass, far out and high up, and hands the near field back to
 * the detail ring through a dither hole that CLOSES exactly as the detail ring
 * fades — so climbing out of a city turns it into a skyline instead of deleting
 * it.
 *
 * WHAT IT IS. SatBuildingEngine's skeleton minus everything near-field: no
 * water, no facade atlas, no night windows, no collision columns, no per-
 * building DEM sampling. Two structural differences:
 *
 *  1. A CHUNK IS A GROUP OF TILES. One z14 tile is 2446 world units across, so
 *     a 10-draw ring of single tiles would reach 4.4 km — barely past the
 *     detail bubble it is supposed to rescue. A chunk here is a
 *     groupN×groupN block of z14 tiles MERGED into one geometry: same draw
 *     budget, groupN× the reach (SAT_SKYLINE.groupN documents the arithmetic).
 *     The z14 source is not a choice — A1 measured z13's `building` layer as a
 *     single pre-merged blob per tile that the mega-block guard discards.
 *  2. THE DRAPE IS A PER-GROUP BILINEAR DEM GRID, not one getGroundAt per
 *     building. 40 tiles × up to 300 blocks is 12,000 exact samples for
 *     geometry whose nearest pixel is 4 km away; a (drapeGridN+1)² grid over
 *     the group is ~169 samples for the same visual answer (its worst error is
 *     the relief inside one ~400 m cell, sub-pixel at this range). The near
 *     ring's exact-centroid drape stays exact — it is the one that has to sit
 *     level on an SF hill you can see out the window.
 *
 * INVARIANTS (both pinned by scripts/verify-skyline.js):
 *  • An EMPTY group ISSUES NO MESH. Owens Valley must stay flat at its measured
 *    draw count — no zero-triangle meshes, no zero-count instancing.
 *  • Off-satellite / low tier / SAT_SKYLINE.enabled false, this class is never
 *    constructed (the FlyScene mount gate) — the flag is a true byte-noop.
 */
export class SatSkylineEngine {
  constructor({ groundAt }) {
    this.visuals = satelliteVisualsOn('architecture');
    // SHIP PASS CITY (CT-2): cityRangeFor(tier) from SatSkylineLayer (null = off).
    this._cityRange = null;
    this._horizon = this.visuals ? cityHorizonFor('high') : null;
    // WORLD PASS C (REACH): latched once per page load (lib/fly/world-pass.js,
    // desktop High / Ultra only), never per frame. Off: every line that reads
    // _reach is skipped and this engine is the shipped horizon mass.
    this._reachCfg = skylineStandInConfig(this._horizon);
    this._reach = !!this._reachCfg;
    this._compact = this._reach && !worldPassTierAllowed();
    // At z8 the drawn DEM already samples more finely than the 4-tile
    // group's support lattice. Use its measured relief for the proxy and
    // let each later terrain refinement raise the stored source zoom.
    this._skylineDemZ = this._reach && BUILDING_APPROACH_ON ? 8 : SAT_SKYLINE.demZ;
    this._standInU = this._reach ? createStandInUniforms(this._reachCfg) : null;
    if (this._standInU) this._standInU.uStandInPhotoInfo.value.x = (WORLD_SIZE / 2 ** SAT_SKYLINE.ring.z) * (this._horizon?.groupN ?? 4); // round 2b: a group's span
    this._standInView = { K: 779, H: 900, ox: 0, oz: 0, reflH: 0 };
    this._cityView = this._reach && CITY_GEOMETRY_LOD_ON
      ? { frustum: new Frustum(), matrix: new Matrix4(), bounds: new Box3(), active: false }
      : null;
    this._pool = null; // WORLD PASS C (round 2): [{ api, n }] skyline workers while _reach
    // WORLD PASS C (round 2b): the ground photo per group (sat-stand-in-photo.js), never awaited by a build.
    this._photoArrived = [];
    this._photoPatch = null;
    // The constructor runs inside React useMemo, whose discarded StrictMode
    // invocation has no cleanup. Own external resources in setWorker instead:
    // it runs in the layer's effect and is paired with dispose (including replay).
    this._photos = null;
    // Round 2b (street pattern): the photos on the GPU, sampled per fragment by the stand-in shader.
    this._atlas = null;
    this._photoK = this._standInU?.uStandInPhotoK.value ?? null; // per atlas slot: how far its photo has faded in
    this._photoRamps = new Map(); // slot -> fade start (s)
    this._photoWantT = -Infinity;
    this._photoPollT = -Infinity;
    this._refineEye = { x: 0, z: 0 }; // WORLD PASS C (round 2): the player, for the corner query
    this._standInK = 1; // damped budget factor on minPx
    this._standInT = undefined;
    this._standInStat = { resident: 0, drawn: 0, groups: 0, coverM: 0, minPx: 0, wanted: 0 };
    this._horizonRadius = SAT_SKYLINE.ring.r;
    this._horizonBand = null;
    this._tileQueue = [];
    this._bandMemo = makeBandMemo(); // the detail ring's band, no allocation per frame
    this.object = new Group();
    this.object.name = 'sat-skyline';
    this.groundAt = groundAt; // (lonDeg, latDeg) => {elev, tileZ} | null
    this.worker = null;

    // ONE material for every group. Vertex colours carry the worker's pre-hazed
    // tone (aerial perspective baked at build time — no per-fragment fog term
    // needed), DoubleSide covers the source data's inconsistent ring winding,
    // and the scene's day sun/hemi/env shade it exactly like the near ring so
    // the two cities agree across the crossfade.
    //
    // NO `map`, EVER: the 'sat-skyline' bundle carries no uv array, and a
    // missing attribute reads (0,0) on the GPU — the R15 window-on-every-roof
    // trap. The facade atlas is a near-field read anyway; at 8 km a window grid
    // is aliasing noise.
    this.material = this._reach
      ? createStandInMaterial({ lighting: satelliteVisualsOn('lighting'), uniforms: this._standInU, footprintK: this._reachCfg.worker?.footprintK ?? 0.5 }) // WORLD PASS C
      : this.visuals ? createSatelliteArchitectureMaterial({ distant: true, lighting: satelliteVisualsOn('lighting') }) : new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    if (!this.visuals) applyBendAnchorSatSkyline(this.material);
    if (!this.visuals && LAMBERT_ENV.enabled) this.material.reflectivity = LAMBERT_ENV.reflectivity;

    // --- R24 B (CHUNK_FADE) — see chunk-fade.js. A ramping group wears a
    // POOLED TWIN of the material above with its OWN uSkyFade; uSkyHole stays
    // module-shared (the hole is one geometric law for every group). Same
    // parameters, no `map` on either, same cache key ⇒ same program, refcounted.
    this._fadePool = new TwinPool(() => {
      const uniform = { value: 1 };
      const material = this._reach
        ? createStandInMaterial({ lighting: satelliteVisualsOn('lighting'), fadeUniform: uniform, uniforms: this._standInU, footprintK: this._reachCfg.worker?.footprintK ?? 0.5 }) // WORLD PASS C
        : this.visuals
        ? createSatelliteArchitectureMaterial({ distant: true, lighting: satelliteVisualsOn('lighting'), fadeUniform: uniform })
        : new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
      if (this.visuals) {
        Object.assign(material.userData.architecture.uniforms, this.material.userData.architecture.uniforms);
      } else {
        applyBendAnchorSatSkyline(material, uniform);
        material.reflectivity = this.material.reflectivity;
      }
      return { material, uniform };
    });
    this._fadeFrame = 0; // R24 B (W3): the frame-count floor's clock
    this._births = [];
    this._dying = [];
    this._skyFade = 1; // the ring's own altitude cull this frame
    this._hardEvict = false;

    this.chunks = new Map(); // key "z/gx/gy" -> group record
    this.queue = [];
    this.building = 0; // in-flight TILE builds (a group issues groupN² of them)
    this._gen = 0; // monotonic chunk id — see the evict-then-requeue race below
    this.pendingFinalize = [];
    this.maxChunks = 0; // tier-driven (SatSkylineLayer sets it before the first update)
    this._lastRefreshPos = { x: Infinity, z: Infinity };
    this._lastRefreshT = 0;
    this._ringOn = false;
    this._warpCoarseUntil = 0;
    this._disposed = false;
    // --- Round 21 (B STREAMKEEPER) ------------------------------------------
    this._now = 0;
    this._gRetry = new Map(); // P2: per-group rebuild attempts (survives evict)
    // R24 B: degenerateDropped is additive telemetry (0 with FLASH_GUARD off).
    this._stat = { errorRetries: 0, evictions: 0, heals: 0, degenerateDropped: 0, fadeBudgetMiss: 0 };
    // WORLD PASS W0 — arrival counters (diagnostic only; see sat-building-engine.js _wpStats).
    this._wp = { armAt: NaN, desiredAt: NaN, firstTileSec: null, fullRingSec: null, nonFiniteRestarts: 0, finalizeMsMax: 0, finalizeMsLast: 0, finalizeSliceMsMax: 0, finalizeSliceMsLast: 0 };
    this._wpKeep = null;
    this._wpCount = false; // WORLD PASS W0: publish the counters on stats? (setWorker, worldPassCounters)
    // P10: `mesh.visible` used to be recomputed EVERY frame from a live
    // AGL-driven hole radius, so pitch noise around the crossfade blinked
    // 4.9 km blocks on and off. These damp the re-evaluation.
    this._visHole = -1;
    this._visT = -1;
    this._vx = 0;
    this._vz = 0;
    this._velT = undefined;
    this._velPx = undefined;
    this._velPz = undefined;
    this._leadHoldUntil = 0;
  }

  /** R21 (§3.4) — per-frame velocity EMA; a teleport resets it, never feeds it. */
  _trackVel(nowSec, px, pz) {
    const L = STREAM_KEEPER.lookahead;
    const dt = nowSec - (this._velT ?? nowSec);
    this._velT = nowSec;
    if (this._velPx === undefined) {
      this._velPx = px;
      this._velPz = pz;
      return;
    }
    const dx = px - this._velPx;
    const dz = pz - this._velPz;
    this._velPx = px;
    this._velPz = pz;
    if (dx * dx + dz * dz > L.teleportM * L.teleportM) {
      this._vx = 0;
      this._vz = 0;
      this._leadHoldUntil = nowSec + L.warpHoldSec;
      return;
    }
    if (dt <= 1e-4 || dt > 0.5) return;
    const a = Math.min(1, dt / L.tauSec);
    this._vx += (dx / dt - this._vx) * a;
    this._vz += (dz / dt - this._vz) * a;
  }

  /** R21 (§3.4) — ring centre pushed ahead of the player; 0 speed ⇒ unchanged. */
  _leadCenter(nowSec, px, pz, ringR) {
    const L = STREAM_KEEPER.lookahead;
    if (!STREAM_KEEPER.enabled || nowSec < this._leadHoldUntil) return [px, pz];
    const sp = Math.hypot(this._vx, this._vz);
    if (sp < 1) return [px, pz];
    // R24 (B) — LEAD_SAFE. A proven no-op for this ring; see the header block.
    const lead = Math.min(sp * L.leadSec, leadCapM('satSkyline', ringR));
    return [px + (this._vx / sp) * lead, pz + (this._vz / sp) * lead];
  }

  /** Tier gate (SatSkylineLayer): SAT_SKYLINE.maxChunksByTier → group cap. */
  /**
   * SHIP PASS CITY (CT-2): cityRangeFor(tier). A change re-plans the ring, so
   * groups streamed from now on carry the dense-core request; groups already
   * resident keep their build until they re-stream (no refetch storm on a tier
   * step).
   */
  setCityRange(range) {
    if ((this._cityRange?.block ?? null) === (range?.block ?? null) && (this._cityRange?.detailed ?? null) === (range?.detailed ?? null)) return;
    this._cityRange = range ?? null;
    this._lastRefreshPos = { x: Infinity, z: Infinity };
  }

  setMaxChunks(n) {
    if (n === this.maxChunks || this._disposed) return;
    this.maxChunks = n;
    if (n <= 0) {
      for (const [key, chunk] of [...this.chunks]) this._evict(key, chunk);
      this.queue.length = 0;
      this.pendingFinalize.length = 0;
    }
    this._lastRefreshPos = { x: Infinity, z: Infinity }; // re-evaluate next update
  }

  setHorizonTier(tier) {
    const next = this.visuals ? cityHorizonFor(tier) : null;
    if (next === this._horizon && this._horizonTargetChunks === next?.maxChunks) {
      // The layer writes its legacy cap first on every tier effect.
      if (next) this.setMaxChunks(this._horizonAppliedCap);
      return;
    }
    const previousCap = this._horizonAppliedCap ?? this.maxChunks;
    this._horizon = next;
    if (next) {
      this._horizonTargetChunks = next.maxChunks;
      if (next.maxChunks < previousCap && Number.isFinite(this._horizonLiveEnd) && this.chunks.size) {
        // Contract the radial mask BEFORE removing its supporting groups.
        // The ordinary four-twin / .3s death budget cannot hide a 24→5 drop.
        // Hold the existing capped cohort for .8s; requests immediately obey
        // the lower tier's concurrency/geometry budget. No extra group cap.
        this._horizonContraction = { from: this._horizonLiveEnd, start: this._now, radius: this._horizonRadius };
        this.setMaxChunks(previousCap);
      } else {
        this._horizonContraction = null;
        this._horizonAppliedCap = next.maxChunks;
        this.setMaxChunks(next.maxChunks);
      }
    }
    this._lastRefreshPos = { x: Infinity, z: Infinity };
  }

  setNightMix(frac) { if (this.visuals) setSatelliteArchitectureNight(this.material, frac); }

  /** false reserves bandwidth for boot/warp; 'busy' allows background loading. */
  setPhotoGate(fn) {
    this._photoGate = typeof fn === 'function' ? fn : null;
  }

  /** WORLD PASS C: is the far city drawn as stand-ins this page load (latched)? */
  get standInsOn() {
    return this._reach;
  }

  get workerCount() {
    return this._reachCfg?.workers ?? 1;
  }

  setWorker(workerApi, extraWorkers = null) {
    this.worker = workerApi;
    this._hardEvict = false;
    if (workerApi && this._reach && this._reachCfg.photo?.enabled !== false && !this._photos) {
      this._photos = createStandInPhotos(this._reachCfg.photo ?? {}, (key) => this._photoArrived.push(key));
      if (this._reachCfg.photo?.atlas !== false) {
        this._atlas = createPhotoAtlas(this._photos.size, this._reachCfg.photo?.layers ?? 40);
        this._standInU.uStandInPhotos.value = this._atlas.texture;
      }
    }
    // WORLD PASS C (round 2): with the stand-ins, SatSkylineLayer gives this
    // engine a small pool of skyline workers; each tile goes to the least
    // loaded one. Without the stream, extraWorkers is never passed.
    this._pool = this._reach && extraWorkers?.length ? [workerApi, ...extraWorkers].map((api) => ({ api, n: 0 })) : null;
    this._disposed = false;
    // WORLD PASS W0: the opt-in stage counters (worker/stages.js). The worker's
    // R21 diag switch; off by default, and then nothing below changes.
    this._wpDiag = worldPassDiag();
    // WORLD PASS W0: the arrival counters on stats. Off with every stream off and
    // nobody asking: stats is read every frame, so it must stay the c2bf5c06 object.
    this._wpCount = worldPassCounters();
    if (this._wpDiag) {
      try {
        for (const w of this._pool ?? []) if (w.api !== workerApi) Promise.resolve(w.api.setDiag?.(true)).catch(() => {}); // WORLD PASS C
        Promise.resolve(workerApi.setDiag?.(true)).catch(() => {});
      } catch {
        /* a worker without setDiag simply sends no counters */
      }
    }
    this._lastRefreshPos = { x: Infinity, z: Infinity };
    this._lastRefreshT = 0;
  }

  notifyWarp(nowSec) {
    this._photos?.cancel();
    this._photoArrived.length = 0;
    this._photoWantT = -Infinity;
    this._photoPollT = -Infinity;
    this._flushFades(); // R24 B: a warp is a cut, never a crossfade
    this._warpCoarseUntil = nowSec + SAT_SKYLINE.warpCoarseWindowSec;
    this._lastRefreshPos = { x: Infinity, z: Infinity }; // stream the destination now
    this._leadHoldUntil = nowSec + STREAM_KEEPER.lookahead.warpHoldSec; // R21 §3.4
    this._wpArm(nowSec); // WORLD PASS W0 counters
    this._visHole = -1; // …and re-evaluate visibility at the destination at once
    this._horizonLiveEnd = undefined;
    this._horizonContraction = null;
    if (this._horizon) {
      this._horizonAppliedCap = this._horizon.maxChunks;
      this.setMaxChunks(this._horizon.maxChunks);
    }
  }

  /**
   * Per-frame, from SatSkylineLayer's useFrame. playerX/Z absolute world;
   * eyeAglM = eye altitude above ground; refGroundY = the player's ground
   * elevation, used as the fallback when a far DEM sample has not streamed yet
   * (0 would sink Denver's skyline 1.6 km underground).
   */
  update(nowSec, playerX, playerZ, eyeAglM, refGroundY = 0) {
    if (this._disposed) return;
    this._now = nowSec;
    if (this._horizon) this._horizonRadius = Math.max(this._horizon.reachM * horizonMercatorK(playerZ), this._horizonContraction?.radius ?? 0);
    const { holeRadiusM, fade } = this._writeChoreography(eyeAglM);
    this._updateVisibility(playerX, playerZ, this._horizon ? 0 : holeRadiusM, fade, nowSec);
    this._stepFades(nowSec); // R24 B (CHUNK_FADE) — before the worker guard so
    // a ramp always completes even if the worker handle is gone.
    if (!this.worker) return;
    this._trackVel(nowSec, playerX, playerZ);
    const movedSq =
      (playerX - this._lastRefreshPos.x) ** 2 + (playerZ - this._lastRefreshPos.z) ** 2;
    if (
      movedSq > SAT_SKYLINE.refreshMoveM ** 2 ||
      nowSec - this._lastRefreshT > SAT_SKYLINE.refreshSec
    ) {
      this._lastRefreshPos = { x: playerX, z: playerZ };
      this._lastRefreshT = nowSec;
      this._refreshDesired(playerX, playerZ, eyeAglM, nowSec);
    }
    this._pumpQueue();
    if (this._horizonBand) {
      const dt = Math.max(0, Math.min(0.25, nowSec - (this._horizonT ?? nowSec)));
      this._horizonT = nowSec;
      if (this._horizonContraction) {
        const t = Math.max(0, Math.min(1, (nowSec - this._horizonContraction.start) / 0.8));
        this._horizonLiveEnd = this._horizonContraction.from + (this._horizonBand.end - this._horizonContraction.from) * smoothstep01(t);
        if (t >= 1) {
          this._horizonContraction = null;
          this._horizonAppliedCap = this._horizonTargetChunks;
          this.setMaxChunks(this._horizonTargetChunks);
          this._refreshDesired(playerX, playerZ, eyeAglM, nowSec);
        }
      } else {
        this._horizonLiveEnd = this._horizonLiveEnd == null ? this._horizonBand.end : this._horizonLiveEnd + (this._horizonBand.end - this._horizonLiveEnd) * (1 - Math.exp(-dt / 0.8));
      }
      setCityHorizonFade(this._horizonLiveEnd * 0.76, this._horizonLiveEnd);
    }
    if (this._reach) {
      // WORLD PASS C (round 2): the lattice drape, its heal and the per-building
      // drape only QUERY the terrain, synchronously: one ground-query batch
      // (stream B's exact memo while its fastQuery is armed; a no-op otherwise).
      beginGroundBatch();
      try {
        this._drapePending(refGroundY);
      } finally {
        endGroundBatch();
      }
      this._finalizePending(nowSec);
      if (this._photos) {
        this._pumpPhotos(nowSec);
        if (this._photoArrived.length || this._photoPatch) this._patchPhotos(nowSec);
        if (this._photoRamps.size) this._stepPhotoRamps(nowSec);
      }
      if (this._wpCount) this._wpTrackRing(nowSec);
      beginGroundBatch();
      try {
        this._repairDrape(nowSec);
        this._refineStandIns(nowSec);
      } finally {
        endGroundBatch();
      }
      this._updateStandInCounts(nowSec, playerX, playerZ, eyeAglM);
      return;
    }
    this._drapePending(refGroundY);
    this._finalizePending(nowSec);
    if (this._wpCount) this._wpTrackRing(nowSec); // WORLD PASS W0 counters
    this._repairDrape(nowSec);
  }

  /**
   * WORLD PASS C (REACH): the camera's focal length in CSS pixels and the
   * scene origin (the detail ring's coverage bounds are origin-relative).
   * SatSkylineLayer calls it every frame before update().
   */
  setStandInView(K, origin, heightPx, reflection, camera) {
    if (!this._reach) return;
    if (Number.isFinite(heightPx) && heightPx > 0) this._standInView.H = heightPx;
    if (Number.isFinite(K) && K > 0) this._standInView.K = K;
    this._standInView.ox = origin?.x || 0;
    this._standInView.oz = origin?.z || 0;
    // Round 2: the coastal reflection's target height while it renders (it
    // draws the stand-ins a second time; the tier budget counts both passes).
    this._standInView.reflH = reflection?.active && reflection.height > 0 ? reflection.height : 0;
    if (this._cityView && camera) {
      camera.updateMatrixWorld();
      const view = this._cityView;
      view.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      view.frustum.setFromProjectionMatrix(view.matrix, camera.coordinateSystem, camera.reversedDepth);
      view.active = true;
    }
  }

  // The budget is shared with the water pass. Enclose both the city and its
  // sea-level mirror, with the same curvature allowance as the mesh culler.
  // A camera turn can use any resident group immediately, without restreaming.
  _cityGroupInView(c, mesh, span) {
    const view = this._cityView;
    if (!view?.active) return true;
    const x = c.cx - this._standInView.ox, z = c.cz - this._standInView.oz;
    const half = span / 2 + 950; // overhanging footprints and a guard outside the frame
    const low = c.standIns.yLo - mesh.userData.bendMarginM - 50;
    const high = c.standIns.yHi + c.standIns.maxH + 50;
    const mirror = this._standInView.reflH > 0;
    view.bounds.min.set(x - half, mirror ? Math.min(low, -high) : low, z - half);
    view.bounds.max.set(x + half, mirror ? Math.max(high, -low) : high, z + half);
    return view.frustum.intersectsBox(view.bounds);
  }

  /**
   * WORLD PASS C: the radius (world units) around the player that resident,
   * settled detail tiles cover completely, so a stand-in inside it is never
   * seen (the coverage mask discards it). 0 while the detail ring dissolves
   * with altitude. Ray-marched in 16 directions.
   */
  _coveredRadius(px, pz) {
    const u = this.material.userData.architecture?.uniforms;
    if (!u?.uArchitectureTiles || !(u.uArchitectureNearFade.value >= 0.999)) return 0;
    const n = u.uArchitectureTileCount.value;
    const tiles = [];
    for (let i = 0; i < n; i++) if (u.uArchitectureTileK.value[i] >= 0.999) tiles.push(u.uArchitectureTiles.value[i]);
    if (!tiles.length) return 0;
    const x0 = px - this._standInView.ox;
    const z0 = pz - this._standInView.oz;
    const inside = (x, z) => tiles.some((t) => x >= t.x && z >= t.y && x < t.z && z < t.w);
    if (!inside(x0, z0)) return 0;
    const step = this._reachCfg.coverStepM ?? 250;
    let best = Infinity;
    for (let a = 0; a < 16; a++) {
      const dx = Math.cos((a * Math.PI) / 8);
      const dz = Math.sin((a * Math.PI) / 8);
      let r = 0;
      while (r < best && r < 20000 && inside(x0 + dx * (r + step), z0 + dz * (r + step))) r += step;
      if (r < best) best = r;
    }
    return Number.isFinite(best) ? best : 0;
  }

  /**
   * WORLD PASS C: how many of each group's size-sorted stand-ins can still be
   * minPx tall from here (a prefix per group, measured from the group's
   * nearest point or the covered radius, whichever is farther), then the
   * tier's triangle budget: over it, minPx rises (damped) until it fits. The
   * shader does the exact per-building test and the dissolve.
   */
  _updateStandInCounts(nowSec, px, pz, eyeAglM) {
    const C = this._reachCfg;
    this._refineEye.x = px;
    this._refineEye.z = pz;
    const dt = Math.max(0, Math.min(0.25, nowSec - (this._standInT ?? nowSec)));
    this._standInT = nowSec;
    const k = horizonMercatorK(pz);
    const K = this._standInView.K;
    if (!(nowSec - (this._coverT ?? -Infinity) < 0.25)) {
      this._coverT = nowSec;
      this._coverM = this._coveredRadius(px, pz) / k;
    }
    const g = this._horizon?.groupN ?? 4;
    const half = WORLD_SIZE / 2;
    const live = [];
    const liveMeshes = [];
    let resident = 0;
    const consider = (c, mesh) => {
      if (!mesh || !c?.standIns) return;
      const gspan = (WORLD_SIZE / 2 ** c.group.z) * g;
      resident += c.standIns.n;
      if (this._cityView && !this._cityGroupInView(c, mesh, gspan)) {
        c.standInCount = mesh.geometry.instanceCount = 0;
        mesh.visible = false;
        return;
      }
      const minX = -half + c.group.gx * gspan;
      const minZ = -(half - c.group.gy * gspan);
      const dx = Math.max(minX - px, 0, px - (minX + gspan));
      const dz = Math.max(minZ - pz, 0, pz - (minZ + gspan));
      // 300 m of slack for the chase camera standing behind the player.
      const d = Math.max(50, Math.hypot(Math.hypot(dx, dz) / k, eyeAglM) - 300, this._coverM ?? 0);
      live.push(c, d);
      liveMeshes.push(mesh);
    };
    for (const c of this.chunks.values()) consider(c, c.mesh);
    // Outgoing meshes can still draw in both passes until their fade ends.
    if (CITY_GEOMETRY_LOD_ON) for (const tail of this._dying) consider(tail.chunk, tail.mesh);
    const minPx = C.minPx;
    // Round 2: every pass counts against the tier budget. While the coastal
    // reflection renders, it draws each group again with its own focal length
    // (Kr) and reflectionPxK x minPx (_standInPass), so its count is added.
    const reflH = this._standInView.reflH;
    const Kr = reflH > 0 ? (K * reflH) / Math.max(1, this._standInView.H) : 0;
    const rk = C.reflectionPxK ?? 2;
    const sum = (f) => {
      let t = 0;
      for (let i = 0; i < live.length; i += 2) {
        const S = live[i].standIns;
        t += countAtLeast(S.size, S.n, (minPx * f * live[i + 1]) / K);
        if (Kr > 0) t += countAtLeast(S.size, S.n, (minPx * f * rk * live[i + 1]) / Kr);
      }
      return t;
    };
    const tier = worldPassRequest().tier === 'ultra' ? 'ultra' : 'high';
    const triangleBudget = this._compact
      ? this._horizon.maxTriangles * this._horizon.groupN ** 2 * this._horizon.maxChunks
      : C.maxTriangles?.[tier] ?? 800000;
    const maxI = Math.floor(triangleBudget / STAND_IN_TRIANGLES);
    // The smallest f >= 1 whose total fits `limit` instances.
    const fitFor = (limit) => {
      if (sum(1) <= limit) return 1;
      let lo = 1;
      let hi = 2;
      while (sum(hi) > limit) hi *= 2;
      for (let it = 0; it < 14; it++) {
        const mid = (lo + hi) / 2;
        if (sum(mid) > limit) lo = mid;
        else hi = mid;
      }
      return hi;
    };
    // Round 2 (stability): hysteresis on the budget factor. It RISES the
    // moment the total passes the cap (to a fit with `headroom` to spare, so a
    // small growth does not trip it again), and FALLS only when the total at a
    // `fallStep` lower factor would still sit under `fallFill` of the cap, then
    // slowly. Between the two it holds, so in level flight minPx stands still
    // and the faint far layer does not thin and thicken (the round-1 NYC cruise
    // breathed 0.80 to 1.48).
    const H = C.hysteresis ?? {};
    const wanted = sum(1);
    let f = this._standInK;
    const now = sum(f);
    if (now > maxI) {
      const target = fitFor(Math.floor(maxI * (H.headroom ?? 0.9)));
      f += (target - f) * Math.min(1, dt / (H.riseSec ?? 0.2));
      if (sum(f) > maxI) f = fitFor(maxI); // never over the cap for a frame
    } else if (f > 1 && sum(f / (H.fallStep ?? 1.25)) <= maxI * (H.fallFill ?? 0.75)) {
      const target = Math.max(1, fitFor(Math.floor(maxI * (H.headroom ?? 0.9))));
      if (target < f) f += (target - f) * Math.min(1, dt / (H.fallSec ?? 4));
    }
    if (!(f >= 1)) f = 1;
    this._standInK = f;
    let drawn = 0;
    for (let i = 0; i < live.length; i += 2) {
      const c = live[i];
      const n = countAtLeast(c.standIns.size, c.standIns.n, (minPx * f * live[i + 1]) / K);
      const mesh = liveMeshes[i / 2];
      mesh.geometry.instanceCount = n;
      c.standInCount = n;
      c.standInD = live[i + 1];
      if (CITY_GEOMETRY_LOD_ON) mesh.visible = n > 0 && this._skyFade > 0;
      else if (n === 0) mesh.visible = false;
      drawn += mesh.visible ? n : 0;
    }
    this._standInU.uStandInView.value.set(K, minPx * f, C.fadePx, k);
    this._standInMinPx = minPx * f;
    const S = this._standInStat;
    S.resident = resident;
    S.drawn = drawn;
    S.groups = live.length / 2;
    S.coverM = Math.round(this._coverM ?? 0);
    S.minPx = Math.round(minPx * f * 100) / 100;
    S.wanted = wanted;
  }

  /** WORLD PASS C: build the group's instanced stand-in mesh (the finalize tail is the shipped one). */
  _finalizeStandIns(p, chunk, { cx, cz, gspan, N, minX, minZ, step, nowSec, wpT }) {
    const prepared = p.standInPrep.result;
    const { m, baseY } = prepared;
    // Round 2b: the ground photo if it is already here (a group coming back);
    // never fetched for or waited for by a build. Else the palette mean the
    // worker sent, and the photo fades in later (_patchPhotos).
    const alb = p.standInPhoto;
    const slot = p.standInSlot;
    if (slot >= 0) this._photoK[slot] = 1; // born with it: the birth fade is its fade
    this._stat[alb ? 'photoAtFinalize' : 'photoMissAtFinalize'] = (this._stat[alb ? 'photoAtFinalize' : 'photoMissAtFinalize'] ?? 0) + 1;
    const geo = createStandInGeometry(m, baseY, gspan, prepared);
    const spad = bendMarginM(this._horizonRadius, (gspan * Math.SQRT2) / 2);
    geo.boundingSphere.radius += spad;
    const mesh = new Mesh(geo, this.material);
    mesh.name = 'sat-stand-ins';
    mesh.userData.bendMarginM = spad;
    mesh.position.set(cx, 0, cz);
    mesh.frustumCulled = true;
    const repaired = this._retireForRepair(chunk);
    this.object.add(mesh);
    chunk.mesh = mesh;
    chunk.standIns = { n: m.n, size: m.size, ax: m.ax, az: m.az, base: geo.attributes.aStandInBase, maxH: m.maxH, baseRadius: geo.boundingSphere.radius, lo: geo.boundingSphere.center.y };
    // Round 2: per-building drape state. gz[i] = the drawn-mesh tile zoom the
    // building's own ground query answered from (0 = still on the lattice).
    chunk.standIns.photo = !!alb;
    chunk.standIns.parent = m.parent;
    chunk.standIns.slot = slot;
    chunk.standIns.gspan = gspan;
    chunk.standIns.gnd = geo.attributes.aStandInGround;
    chunk.standIns.gz = prepared.gz;
    chunk.standIns.hx = prepared.hx; // the box's half diagonal (world units) for the corner query
    chunk.standIns.ri = 0;
    chunk.standIns.rAt = -Infinity;
    chunk.standIns.yLo = prepared.lo;
    chunk.standIns.yHi = prepared.hi;
    chunk.drape = { grid: p.grid, zoom: p.gridZoom, n: N, minX, minZ, step, cursor: 0, changed: false, gspan };
    // The coastal reflection (lib/fly/coastal-reflection.js) renders this mesh a second time into a
    // small target; there the focal length in pixels is smaller, so far fewer stand-ins reach
    // minPx. Same rule, per pass; the main pass gets its own count back.
    mesh.onBeforeRender = (renderer) => this._standInPass(renderer, chunk, geo);
    if (!repaired) this._startBirth(mesh, nowSec);
    this._visHole = -1;
    chunk.tris = m.n * STAND_IN_TRIANGLES;
    chunk.verts = m.n;
    chunk.parts = null;
    chunk.state = 'ready';
    chunk.cx = cx;
    chunk.cz = cz;
    chunk.readyAt = nowSec;
    // Publication transfers the prepared arrays to the mesh; no cancelled job
    // may later free this resident atlas slot or retain the source bundles.
    chunk._pendingStandIns = null;
    p.standInPrep = null;
    p.standInPhoto = null;
    const W = this._wp;
    this._noteStandInSlice(p, wpT, true);
    if (W.firstTileSec == null && chunk.mesh && W.desiredAt >= W.armAt && this._wpKeep?.has(p.key)) W.firstTileSec = nowSec - W.armAt;
  }

  _noteStandInSlice(p, start, complete = false) {
    const W = this._wp, ms = performance.now() - start;
    p.standInCpuMs = (p.standInCpuMs ?? 0) + ms;
    W.finalizeSliceMsLast = ms;
    W.finalizeSliceMsMax = Math.max(W.finalizeSliceMsMax, ms);
    if (complete) {
      // Keep the existing group-CPU counter comparable with the atomic path;
      // the new slice counters answer how much work landed in one frame.
      W.finalizeMsLast = p.standInCpuMs;
      W.finalizeMsMax = Math.max(W.finalizeMsMax, W.finalizeMsLast);
    }
  }

  /** After the boot/warp hold, stream nearest resident photos at low priority.
   * A moving ring gets one admission every two seconds even if its vector
   * queue never empties. Atlas attachment uses the separate frame-sliced lane.
   */
  _pumpPhotos(nowSec) {
    if (nowSec - this._photoPollT < 0.5) return;
    this._photoPollT = nowSec;
    const gate = this._photoGate ? this._photoGate() : true;
    if (!gate) {
      this._photos.cancel();
      this._photoWantT = nowSec;
      return;
    }
    const busy = gate === 'busy' || this.building > 0 || this._tileQueue.length > 0 ||
      this.queue.length > 0 || this.pendingFinalize.length > 0;
    if (busy && nowSec - this._photoWantT < 2) return;
    this._photoWantT = nowSec;
    if (this._atlas && !this._atlas.available()) return;
    const gl = Math.round(Math.log2(this._horizon?.groupN ?? 4));
    const want = [];
    for (const [key, c] of this.chunks) {
      if (!c.standIns || c.standIns.slot >= 0 || this._photoPatch?.key === key) continue;
      want.push({ key, d: c.standInD ?? Infinity, pz: c.group.z - gl, px: c.group.gx, py: c.group.gy });
    }
    want.sort((a, b) => a.d - b.d);
    // A decoded photo may have lost its first allocation race, or arrived
    // during a previous residency. Reoffer it when quarantine releases a slot.
    for (const e of want) {
      if (this._atlas && this._photos.get(e.key) && !this._photoArrived.includes(e.key)) {
        this._photoArrived.push(e.key);
        break;
      }
    }
    this._photos.want(want, busy ? 1 : undefined);
  }

  _patchPhotos(nowSec) {
    // Use the same exclusive frame lane as geometry preparation. A burst of
    // completed photos cannot stack copies behind an ARRIVAL or REACH slice.
    if (!wpWholeFinalize()) return;
    const t0 = performance.now(), deadline = t0 + STAND_IN_SLICE_MS * budgetK();
    while (performance.now() < deadline) {
      let p = this._photoPatch;
      if (!p) {
        if (!this._photoArrived.length) break;
        const key = this._photoArrived.shift(), chunk = this.chunks.get(key), S = chunk?.standIns;
        if (!S || S.slot >= 0) continue;
        const alb = this._photos.get(key);
        const slot = alb && this._atlas ? this._atlas.alloc(alb) : -1;
        if (slot < 0) continue;
        this._photoK[slot] = 0;
        p = this._photoPatch = { key, chunk, S, slot, data: S.gnd.array.slice(), cursor: 0 };
      }
      if (this.chunks.get(p.key) !== p.chunk || p.chunk.standIns !== p.S) {
        this._atlas?.free(p.slot); this._photoPatch = null; continue;
      }
      const end = Math.min(p.S.n, p.cursor + 1024);
      for (; p.cursor < end; p.cursor++) p.data[p.cursor * 4 + 3] = p.slot + 1;
      if (p.cursor < p.S.n) continue;
      // Swap one finished attribute atomically. Until now the renderer has
      // only seen the original bytes and slot; the old fade starts here.
      p.S.gnd.array = p.data;
      p.S.gnd.needsUpdate = true;
      p.S.slot = p.slot;
      this._photoRamps.set(p.slot, nowSec);
      this._stat.photoPatched = (this._stat.photoPatched ?? 0) + 1;
      this._photoPatch = null;
    }
    this._stat.photoPatchMsMax = Math.max(this._stat.photoPatchMsMax ?? 0, performance.now() - t0);
  }

  _stepPhotoRamps(nowSec) {
    const T = Math.max(0.05, this._reachCfg.photo?.fadeSec ?? 2.5);
    for (const [slot, t0] of this._photoRamps) {
      const k = Math.min(1, (nowSec - t0) / T);
      this._photoK[slot] = k * k * (3 - 2 * k);
      if (k >= 1) this._photoRamps.delete(slot);
    }
  }

  /** WORLD PASS C: the per-pass focal length and count (main view or coastal reflection target). */
  _standInPass(renderer, chunk, geo) {
    const rt = renderer.getRenderTarget();
    const U = this._standInU.uStandInView.value;
    const K = this._standInView.K;
    if (rt && rt.texture?.name === 'coastal-city-reflection' && chunk.standInD > 0) {
      const Kr = (K * rt.height) / Math.max(1, this._standInView.H);
      const px = (this._standInMinPx ?? this._reachCfg.minPx) * (this._reachCfg.reflectionPxK ?? 2);
      U.x = Kr;
      U.y = px;
      geo.instanceCount = countAtLeast(chunk.standIns.size, chunk.standIns.n, (px * chunk.standInD) / Kr);
    } else {
      U.x = K;
      U.y = this._standInMinPx ?? this._reachCfg.minPx;
      geo.instanceCount = chunk.standInCount ?? 0;
    }
  }

  /** WORLD PASS C: re-drape a group's stand-ins on the refined lattice (heal in place). */
  _redrapeStandIns(chunk) {
    const S = chunk.standIns;
    const d = chunk.drape;
    const arr = S.base.array;
    const next = drapeStandIns(S, d.grid, d.n, d.gspan, new Float32Array(S.n));
    let changed = false;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < S.n; i++) {
      if (S.gz && S.gz[i] > 0) {
        // round 2: the building's own query outranks the lattice
        if (arr[i] < lo) lo = arr[i];
        if (arr[i] > hi) hi = arr[i];
        continue;
      }
      if (Math.abs(next[i] - arr[i]) >= 0.02) {
        arr[i] = next[i];
        changed = true;
      }
      if (arr[i] < lo) lo = arr[i];
      if (arr[i] > hi) hi = arr[i];
    }
    if (changed) {
      S.base.clearUpdateRanges?.(); // round 2: a whole re-drape uploads the whole attribute
      S.base.needsUpdate = true;
      const bs = chunk.mesh.geometry.boundingSphere;
      const cy = (lo + hi + S.maxH) / 2;
      bs.radius = Math.max(bs.radius, S.baseRadius + Math.abs(cy - S.lo));
      bs.center.y = cy;
    }
    return changed;
  }

  /**
   * WORLD PASS C (round 2): drape each stand-in on the drawn terrain mesh at
   * its own footprint, not on the group lattice (about 300 m apart: tens of
   * metres off on hills). Budgeted per frame, nearest group first and, within
   * a group, the size-sorted drawn prefix first (what the eye sees first). A
   * group is swept again every `resweepSec` so a refined terrain tile re-seats
   * its buildings (the heal sweep's job for the lattice). Within `cornerM` of
   * the camera the box's corners are queried too and the lowest wins (no
   * daylight under the downhill wall); farther out a few metres of slope are
   * sub-pixel. Runs inside the update's ground-query batch.
   */
  _refineStandIns(nowSec) {
    const D = this._reachCfg.drape ?? {};
    const budget = (D.refineMs ?? 1.5) * budgetK();
    if (!(budget > 0)) return;
    const t0 = performance.now();
    const resweep = D.resweepSec ?? 4;
    // Nearest group with work left; else the stalest finished one.
    let pick = null;
    let pickD = Infinity;
    let stale = null;
    for (const c of this.chunks.values()) {
      const S = c.standIns;
      if (!c.mesh || !S?.gz) continue;
      const limit = Math.min(S.n, Math.ceil((c.standInCount ?? 0) * 1.25) + 64);
      S.rLimit = limit;
      if (S.ri < limit) {
        const d = c.standInD ?? Infinity;
        if (d < pickD) {
          pickD = d;
          pick = c;
        }
      } else if (nowSec - S.rAt > resweep && (!stale || S.rAt < stale.standIns.rAt)) stale = c;
    }
    if (!pick && stale) {
      stale.standIns.ri = 0;
      pick = stale;
    }
    if (!pick) return;
    const S = pick.standIns;
    const arr = S.base.array;
    const ox = pick.mesh.position.x;
    const oz = pick.mesh.position.z;
    const k = horizonMercatorK(oz);
    const cornerW = (D.cornerM ?? 0) * k; // world units
    const px = this._refineEye?.x ?? 0;
    const pz = this._refineEye?.z ?? 0;
    const q = (wx, wz) => this.groundAt((wx / EARTH_R) * RAD2DEG, (2 * Math.atan(Math.exp(-wz / EARTH_R)) - Math.PI / 2) * RAD2DEG);
    let lo = Infinity;
    let hi = -1;
    let yLo = S.yLo;
    let yHi = S.yHi;
    let n = 0;
    while (S.ri < S.rLimit) {
      const i = S.ri++;
      const root = S.parent?.get(i) ?? i;
      const wx = ox + S.ax[root];
      const wz = oz + S.az[root];
      const s = q(wx, wz);
      n += 1;
      if (s && Number.isFinite(s.elev) && s.tileZ >= S.gz[i]) {
        let y = s.elev;
        if (cornerW > 0 && (wx - px) ** 2 + (wz - pz) ** 2 < cornerW * cornerW) {
          const r = S.hx[root] * 0.7071;
          for (const [dx, dz] of [[r, r], [r, -r], [-r, r], [-r, -r]]) {
            const c = q(wx + dx, wz + dz);
            if (c && Number.isFinite(c.elev) && c.elev < y) y = c.elev;
          }
        }
        S.gz[i] = Math.max(1, s.tileZ | 0);
        if (Math.abs(y - arr[i]) >= 0.02) {
          arr[i] = y;
          if (i < lo) lo = i;
          if (i > hi) hi = i;
          if (y < yLo) yLo = y;
          if (y > yHi) yHi = y;
        }
      }
      if ((n & 15) === 0 && performance.now() - t0 > budget) break;
    }
    if (S.ri >= S.rLimit) S.rAt = nowSec;
    if (hi >= lo) {
      S.base.addUpdateRange(lo, hi - lo + 1);
      S.base.needsUpdate = true;
      const bs = pick.mesh.geometry.boundingSphere;
      const cy = (yLo + yHi + S.maxH) / 2;
      bs.radius = Math.max(bs.radius, S.baseRadius + Math.abs(cy - S.lo), (yHi + S.maxH - yLo) / 2 + 50);
      bs.center.y = cy;
      S.yLo = yLo;
      S.yHi = yHi;
      this._stat.standInRefined = (this._stat.standInRefined ?? 0) + 1;
    }
  }

  // --- the crossfade choreography (two uniform writes) ------------------------
  // HOLE: full radius while the detail ring is solid, easing to EXACTLY 0 across
  // the detail ring's OWN dissolve band — read live from SAT_BLDG_FADE so the
  // two can never drift apart (with that block disabled the detail ring hard-
  // evicts across SAT_BUILDINGS.cullAgl*, so the hole follows that band
  // instead). At 0 the shader's hole branch is skipped entirely.
  // FADE: this ring's own altitude cull, 1 → 0 across SAT_SKYLINE.fade.
  _writeChoreography(eyeAglM) {
    const SK = SAT_SKYLINE;
    // SHIP PASS CITY (CT-1, CT-2): the detail ring's band as IT resolves it
    // (pins > CITY_RANGE > shipped); with neither this is SAT_BLDG_FADE's band
    // (or the hard cull band when that block is off), exactly as before.
    const band = this._bandMemo(this._cityRange);
    const lo = band.fadeStartM ?? SAT_BUILDINGS.cullAglOnM;
    const hi = band.fadeEndM ?? SAT_BUILDINGS.cullAglOffM;
    const open = smoothstep01((eyeAglM - lo) / Math.max(1, hi - lo));
    const fade = 1 - smoothstep01((eyeAglM - SK.fade.startM) / Math.max(1, SK.fade.endM - SK.fade.startM));
    const holeRadiusM = this.visuals ? 0 : SK.hole.radiusM * (1 - open);
    setSatSkyline(holeRadiusM, SK.hole.featherM, fade);
    this._skyFade = fade; // R24 B: per-mesh ramps MULTIPLY this, never replace it
    return { holeRadiusM, fade };
  }

  /**
   * A group whose FARTHEST corner still sits inside the hole has every one of
   * its anchors discarded — it is a draw call, a vertex shader pass and a full
   * fragment-kill for zero pixels. Park it. Same for the whole ring once the
   * far cull has dithered it away but before the eviction hysteresis fires.
   * One hypot per streamed group per frame, and `visible` is the cheapest
   * possible lever (three skips the mesh entirely). Conservative by
   * construction: at exactly holeRadiusM the shader's smoothstep is already 0.
   */
  _updateVisibility(px, pz, holeRadiusM, fade, nowSec = 0) {
    const g = this._horizon?.groupN ?? Math.max(1, SAT_SKYLINE.groupN);
    // ROUND 21 (P10) — DAMP THE RE-EVALUATION. `holeRadiusM` is derived from
    // the LIVE eye-AGL, so inside the crossfade band it moves with every pitch
    // wobble and every metre of terrain under the aircraft — and a group whose
    // farthest corner sits within a few metres of the hole edge therefore
    // toggled `visible` at frame rate. A 4.9 km block of city blinking on and
    // off is the single most literal reading of the user's "everything will
    // flash, reappear, disappear". Re-evaluate only when the hole has actually
    // MOVED (visReevalM) or after visReevalSec — the crossfade band sweeps the
    // radius 4000 → 0, so it still re-evaluates ~27 times across the climb.
    // The two terminal states (fade 0 / hole closed) are exact and always
    // applied, so nothing can be left visible after the ring is culled.
    const H = STREAM_KEEPER.skylineHysteresis;
    if (
      STREAM_KEEPER.enabled &&
      fade > 0 &&
      holeRadiusM > 0 &&
      this._visHole >= 0 &&
      Math.abs(holeRadiusM - this._visHole) < H.visReevalM &&
      nowSec - this._visT < H.visReevalSec
    )
      return;
    this._visHole = holeRadiusM;
    this._visT = nowSec;
    for (const chunk of this.chunks.values()) {
      const mesh = chunk.mesh;
      if (!mesh) continue;
      if (fade <= 0) {
        mesh.visible = false;
        continue;
      }
      if (holeRadiusM <= 0) {
        mesh.visible = true;
        continue;
      }
      const gspan = (WORLD_SIZE / 2 ** chunk.group.z) * g;
      const dx = Math.max(Math.abs(px - (mesh.position.x - gspan / 2)), Math.abs(px - (mesh.position.x + gspan / 2)));
      const dz = Math.max(Math.abs(pz - (mesh.position.z - gspan / 2)), Math.abs(pz - (mesh.position.z + gspan / 2)));
      mesh.visible = Math.hypot(dx, dz) > holeRadiusM;
    }
  }

  // --- desired set: groups of z14 tiles, nearest-win, altitude hysteresis -----
  _refreshDesired(px0, pz0, eyeAglM, nowSec = 0) {
    const SK = SAT_SKYLINE;
    // ROUND 21 (P10) — WIDER EVICT/REARM HYSTERESIS, as a read-through override
    // (SAT_SKYLINE.fade is untouched and rules with the flag off). 9500/9200 is
    // a 300 m band at cruise: a shallow phugoid straddling ~9.35 km evicted and
    // re-streamed the ENTIRE ring — up to 40 tile fetches per crossing —
    // repeatedly. Both ends stay ABOVE fade.endM (9000), so all of that
    // streaming still happens while the ring is fully faded out and nothing
    // pops. NOTE: evictM is 10000, not the charter's 10500, because
    // verify-skyline pins the AGL cull with a FROZEN probe at 10,200 m
    // ("skyline evicts past its own AGL cull": ready === 0 && ringOn === false)
    // — 10500 would have moved a frozen assertion, which this round does not do.
    // 9200 → 10000 is still a 3.3× wider band.
    const evictM = STREAM_KEEPER.enabled ? STREAM_KEEPER.skylineHysteresis.evictM : SK.fade.evictM;
    const rearmM = STREAM_KEEPER.enabled ? STREAM_KEEPER.skylineHysteresis.rearmM : SK.fade.rearmM;
    if (this._ringOn) {
      if (eyeAglM > evictM) this._ringOn = false;
    } else if (eyeAglM < rearmM) {
      this._ringOn = true;
      this._wpArm(nowSec); // WORLD PASS W0 counters
    }
    if (!this._ringOn || this.maxChunks <= 0) {
      for (const [key, chunk] of this.chunks) this._evict(key, chunk);
      this.queue.length = 0;
      this.pendingFinalize.length = 0;
      return;
    }

    const z = SK.ring.z;
    const r = this._horizon ? this._horizonRadius : SK.ring.r;
    // R21 (§3.4): ring centred slightly ahead at speed; identical at rest.
    const [px, pz] = this._horizon ? [px0, pz0] : this._leadCenter(nowSec, px0, pz0, r);
    const g = this._horizon?.groupN ?? Math.max(1, SK.groupN);
    const span = WORLD_SIZE / 2 ** z;
    const gspan = span * g;
    const half = WORLD_SIZE / 2;
    const nGroups = Math.ceil(2 ** z / g);
    const gxMin = Math.floor((px - r + half) / gspan);
    const gxMax = Math.floor((px + r + half) / gspan);
    const gyMin = Math.floor((pz - r + half) / gspan);
    const gyMax = Math.floor((pz + r + half) / gspan);
    const desired = [];
    for (let gy = Math.max(0, gyMin); gy <= Math.min(nGroups - 1, gyMax); gy++) {
      for (let gx = Math.max(0, gxMin); gx <= Math.min(nGroups - 1, gxMax); gx++) {
        const minX = -half + gx * gspan;
        const minZ = -(half - gy * gspan);
        // group square [minX,maxX]×[minZ,maxZ] vs circle(px,pz,r). The SORT key
        // is that same closest-point distance, not the center distance: a
        // 4.9 km group whose near edge touches the player must stream before a
        // diagonal neighbour whose center happens to be nearer.
        const dx = Math.max(minX - px, 0, px - (minX + gspan));
        const dz = Math.max(minZ - pz, 0, pz - (minZ + gspan));
        const distSq = dx * dx + dz * dz;
        if (distSq > r * r) continue;
        desired.push({ z, gx, gy, distSq });
      }
    }
    desired.sort((a, b) => a.distSq - b.distSq);
    // R24 (B) — RING_HOLD. Still `this.maxChunks` at most (this ring's cap IS
    // its draw budget: one merged mesh per group) and still rank-sorted, so the
    // retry sweep and the queue build order below are unchanged.
    const keyOf = (e) => `${e.z}/${e.gx}/${e.gy}`;
    const kept = this._horizon ? desired.slice(0, this.maxChunks) : ringHoldKeep(desired, this.maxChunks, this.chunks, keyOf, (c) => !!c.mesh);
    if (this._horizon) {
      this._horizonBand = horizonFadeBand(desired, this._horizonTargetChunks ?? this.maxChunks, r, 1600 * horizonMercatorK(pz0));
    }
    const keep = new Set(kept.map(keyOf));
    this._wpKeep = keep; // WORLD PASS W0 counters (read only by _wpTrackRing)
    if (!(this._wp.desiredAt >= this._wp.armAt)) this._wp.desiredAt = nowSec;
    const held = this._horizon ? new Set() : residencyHeld(this.chunks, keep, nowSec, px0, pz0, r);

    for (const [key, chunk] of this.chunks) {
      if (!keep.has(key)) {
        if (held.has(key)) continue; // R24 (B) — RING_HOLD (2), min residency
        this._evict(key, chunk);
        this._gRetry.delete(key); // R21: the attempt counter dies with the ring
      }
    }
    // ROUND 21 (P2) — A GROUP'S HOLE IS NO LONGER PERMANENT. `_childDone` used
    // to treat a failed child as "one fewer pending" and nothing else: the
    // group merged whatever arrived and the missing tile's quarter of the city
    // was gone until the player flew out of the ring and back. One stale child
    // was worse still — it killed the whole 2×2 group forever. Both now carry a
    // `retryAt`, and this is where it is honoured: evict the record so the
    // ordinary queue filter below rebuilds the WHOLE group (the parts are
    // merged into one buffer, so there is no partial repair to make). The
    // attempt count survives the eviction in `_gRetry`, which is what keeps the
    // backoff monotone across rebuilds.
    if (STREAM_KEEPER.enabled && STREAM_KEEPER.retry.enabled) {
      for (const e of kept) {
        const key = `${e.z}/${e.gx}/${e.gy}`;
        const c = this.chunks.get(key);
        if (!c || c.state === 'building' || c.state === 'draping') continue;
        if (nowSec < (c.retryAt ?? Infinity)) continue;
        this._gRetry.set(key, (this._gRetry.get(key) ?? 0) + 1);
        this._stat.errorRetries += 1;
        if (CITY_GEOMETRY_LOD_ON && this._horizon && c.mesh) {
          c.repairQueued = true;
          c.retryAt = Infinity;
        } else {
          this._evict(key, c);
        }
      }
    }
    this.queue = kept.filter((e) => {
      const chunk = this.chunks.get(keyOf(e));
      return !chunk || chunk.repairQueued;
    });
    // The radial set owns the fade distance and draw cap. Prioritize the
    // groups along the ground track for their 16 source requests.
    const path = this._horizon && STREAM_KEEPER.enabled && nowSec >= this._leadHoldUntil
      ? sceneryFlightPath(px0, pz0, this._vx, this._vz, gspan) : null;
    if (path) this.queue.sort((a, b) => path.rank(a.gx, a.gy) - path.rank(b.gx, b.gy));
    this.pendingFinalize = this.pendingFinalize.filter((p) => keep.has(p.key));
  }

  // --- build: one group = groupN² worker tiles, collected then merged --------
  _pumpQueue() {
    if (this._horizon) { this._pumpHorizonQueue(); return; }
    const SK = SAT_SKYLINE;
    const g = Math.max(1, SK.groupN);
    while (this.building < SK.maxBuilds && this.queue.length > 0) {
      const e = this.queue.shift();
      const key = `${e.z}/${e.gx}/${e.gy}`;
      if (this.chunks.has(key)) continue;
      // `gen` closes the evict-then-requeue race: fly out of a group and back
      // inside one build's latency and the SAME key gets a NEW chunk record
      // while the old tiles are still in flight. Without the stamp those late
      // results decrement the new chunk's `pending` to zero early and it
      // finalizes with a fraction of its tiles — a quarter of a city block
      // missing, permanently, and only when the player doubles back.
      this._gen += 1;
      const gen = this._gen;
      const chunk = {
        state: 'building',
        mesh: null,
        group: e,
        pending: g * g,
        parts: [],
        stale: false,
        gen,
        // R21 (P2): per-group failure bookkeeping — see _childDone.
        failed: 0,
        sawNoData: false,
        retryAt: Infinity,
      };
      this.chunks.set(key, chunk);
      this.building += g * g;
      const span = WORLD_SIZE / 2 ** e.z;
      const nTiles = 2 ** e.z;
      for (let j = 0; j < g; j++) {
        for (let i = 0; i < g; i++) {
          const tx = e.gx * g + i;
          const ty = e.gy * g + j;
          // Tile-local geometry lands at the tile center; the merged mesh sits
          // at the GROUP center, so every part carries that constant offset.
          const dx = (i - (g - 1) / 2) * span;
          const dz = (j - (g - 1) / 2) * span;
          if (tx >= nTiles || ty >= nTiles) {
            this._childDone(key, gen, null, 0, 0, false); // off the world, not a failure
            continue;
          }
          this.worker
            // SHIP PASS CITY (CT-1, CT-2): cityRangeRequest returns this very
            // object unless CITY_RANGE or the premix pin adds an option.
            .buildTile(e.z, tx, ty, 'sat-skyline', cityRangeRequest({ visuals: this.visuals, ...trueAreasRequest(), ...premiumWorldRequest(), worldPass: worldPassRequest() }, this._cityRange))
            .then((result) => this._childDone(key, gen, result, dx, dz, false))
            .catch((err) => {
              this._childDone(key, gen, null, dx, dz, true); // R21: a REAL failure
              if (process.env.NODE_ENV === 'development')
                console.warn(`[sat-skyline] build ${e.z}/${tx}/${ty} failed:`, err?.message ?? err);
            });
        }
      }
    }
  }

  /** A group owns sixteen sources, but only the tier's individual tile
   * requests may be in flight. A cancelled/warped group never starts its
   * waiting children, and late completions retain the existing gen guard. */
  _pumpHorizonQueue() {
    const P = this._horizon, g = P.groupN;
    this._tileQueue = this._tileQueue.filter((t) => this.chunks.get(t.key)?.gen === t.gen);
    // Expand only enough groups to fill free slots. The others can still be
    // reprioritized when the aircraft turns or crosses a boundary.
    while (this._tileQueue.length < P.concurrent - this.building && this.queue.length) {
      const e = this.queue.shift(), key = `${e.z}/${e.gx}/${e.gy}`;
      const resident = this.chunks.get(key);
      if (resident && !resident.repairQueued) continue;
      const gen = ++this._gen;
      const chunk = resident ?? { mesh: null, group: e };
      Object.assign(chunk, { state: 'building', pending: g * g, parts: [], stale: false, gen, failed: 0, sawNoData: false, retryAt: Infinity, repairQueued: false });
      this.chunks.set(key, chunk);
      const span = WORLD_SIZE / 2 ** e.z, n = 2 ** e.z;
      const options = cityHorizonRequest(cityRangeRequest({ visuals: this.visuals, ...trueAreasRequest(), ...premiumWorldRequest(), worldPass: worldPassRequest() }, this._cityRange), P);
      if (this._compact) {
        options.cityHorizon.compact = true;
        if (BUILDING_APPROACH_ON) {
          options.cityHorizon.cityContinuity = CITY_CONTINUITY_ON;
          options.cityHorizon.footprintK = this._reachCfg.worker.footprintK;
          options.cityHorizon.maxNeighborhoodPerTile = this._reachCfg.worker.maxNeighborhoodPerTile;
        }
      }
      for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) {
        const tx = e.gx * g + i, ty = e.gy * g + j;
        this._tileQueue.push({ key, gen, z: e.z, tx, ty, dx: (i - (g - 1) / 2) * span, dz: (j - (g - 1) / 2) * span, outside: tx >= n || ty >= n, options });
      }
    }
    // WORLD PASS C (round 2b): the pool spreads the CPU, never the network. The
    // in-flight cap stays the shipped P.concurrent, so the far ring takes the
    // same share of OpenFreeMap as the old mass and the near ring is not starved
    // (round 2's 3 x cap made the near ring 1.6 to 11.2 s later with REACH alone).
    const cap = P.concurrent;
    while (this.building < cap && this._tileQueue.length) {
      const t = this._tileQueue.shift();
      this.building += 1;
      if (t.outside) { this._childDone(t.key, t.gen, null, 0, 0, false); continue; }
      if (this._pool) {
        // WORLD PASS C (round 2): the least loaded skyline worker.
        let w = this._pool[0];
        for (const c of this._pool) if (c.n < w.n) w = c;
        w.n += 1;
        w.api.buildTile(t.z, t.tx, t.ty, 'sat-skyline', t.options)
          .then((r) => { w.n -= 1; this._childDone(t.key, t.gen, r, t.dx, t.dz, false); })
          .catch(() => { w.n -= 1; this._childDone(t.key, t.gen, null, t.dx, t.dz, true); });
        continue;
      }
      this.worker.buildTile(t.z, t.tx, t.ty, 'sat-skyline', t.options)
        .then((r) => this._childDone(t.key, t.gen, r, t.dx, t.dz, false))
        .catch(() => this._childDone(t.key, t.gen, null, t.dx, t.dz, true));
    }
  }

  /** One tile of a group came back (or failed). Merge-time starts at pending 0. */
  _childDone(key, gen, result, dx, dz, failed = false) {
    this.building -= 1;
    const chunk = this.chunks.get(key);
    if (this._disposed || !chunk || chunk.gen !== gen || chunk.state !== 'building') return;
    if (failed) chunk.failed += 1; // R21 (P2)
    // R21 (P2): remember whether any child's emptiness was a recoverable
    // upstream 404/204 (D PIPELINE's 'no-data') rather than a real absence.
    if (result?.empty && result.reason === 'no-data') chunk.sawNoData = true;
    // WORLD PASS W0: a bundle stamped for another flag arm is stale too.
    if (result && ((result.v !== undefined && result.v !== EXPECTED_WORKER_PROTOCOL) || !worldPassMatch(result))) {
      chunk.stale = true;
      if (process.env.NODE_ENV === 'development' && !_warnedProtocol) {
        _warnedProtocol = true;
        console.warn(
          `[sat-skyline] worker protocol ${result.v} != expected ${EXPECTED_WORKER_PROTOCOL} ` +
            '(stale worker after HMR/dev-server restart?) — skyline skipped; hard-reload to refresh.'
        );
      }
    } else if (result && !result.empty && result.satSkyline) {
      chunk.parts.push({ sk: result.satSkyline, dx, dz });
    } else if (this._reach && result && !result.empty && result.satStandIns) {
      chunk.parts.push({ si: result.satStandIns, dx, dz }); // WORLD PASS C
    }
    // WORLD PASS W0 diag counters (diag only): one record per group, the sum
    // of its child tiles.
    if (result?.wpStages) chunk.wpStages = sumStageRecords([chunk.wpStages, result.wpStages]);
    chunk.pending -= 1;
    if (chunk.pending > 0) return;
    // R21 (P2) — WHEN MAY THIS GROUP BE ASKED AGAIN? Flag off, every branch
    // resolves to Infinity and the behaviour below is R18's exactly.
    const SKON = STREAM_KEEPER.enabled && STREAM_KEEPER.retry.enabled;
    const attempts = (this._gRetry.get(key) ?? 0) + 1;
    if (SKON) {
      if (chunk.stale) {
        // A stale worker is a dev/HMR pairing, not a data fact — and ONE stale
        // child used to kill the whole 2×2 group for the rest of the session.
        // Treat it as 'zero' with a SHORT ttl so a hard reload heals it.
        chunk.retryAt = this._now + 60 * jitter1();
      } else if (chunk.failed > 0) {
        chunk.retryAt = groupRetryAt(this._now, attempts); // capped backoff
      } else if ((chunk.parts.length === 0 || (CITY_GEOMETRY_LOD_ON && this._horizon)) && chunk.sawNoData) {
        chunk.retryAt = this._now + STREAM_KEEPER.retry.noDataTtlSec * jitter1();
      } else {
        chunk.retryAt = Infinity; // deterministic 'zero' — THE OWENS CASE
      }
    }
    if (CITY_GEOMETRY_LOD_ON && this._horizon) {
      // A resolved no-data child can return beside fifteen good ones. Retain
      // those streets during retries, including when a different child fails.
      const span = WORLD_SIZE / 2 ** chunk.group.z;
      const g = this._horizon.groupN;
      let mask = 0;
      for (const part of chunk.parts) {
        const i = Math.round(part.dx / span + (g - 1) / 2);
        const j = Math.round(part.dz / span + (g - 1) / 2);
        mask |= 1 << (j * g + i);
      }
      const old = chunk.sourceMask ?? 0;
      if (chunk.mesh && (chunk.stale || !mask ||
          ((chunk.failed || chunk.sawNoData) && ((mask & old) !== old || mask === old)))) {
        chunk.state = 'ready';
        chunk.parts = null;
        return;
      }
      chunk.sourceMask = mask;
    }
    // THE OWENS INVARIANT: a group with nothing in it becomes 'empty' and never
    // gets a mesh — not an empty one, not a zero-triangle one. Desert tiles
    // therefore cost exactly zero draws. (R21 changes only WHEN it may be asked
    // again, never whether an empty group issues geometry.)
    if (chunk.stale || chunk.parts.length === 0) {
      chunk.state = 'empty';
      chunk.reason = chunk.stale ? 'zero' : chunk.sawNoData ? 'no-data' : 'zero';
      chunk.parts.length = 0;
      return;
    }
    chunk.state = 'draping';
    this.pendingFinalize.push({ key, gen, group: chunk.group, parts: chunk.parts, grid: null, gi: 0, wpT0: this._now }); // wpT0: WORLD PASS W0 stuck counter
  }

  // --- drape: budgeted (drapeGridN+1)² DEM grid per group --------------------
  _drapePending(refGroundY) {
    if (this.pendingFinalize.length === 0) return;
    const SK = SAT_SKYLINE;
    const t0 = performance.now();
    const g = this._horizon?.groupN ?? Math.max(1, SK.groupN);
    const N = this._horizon ? SK.drapeGridN * 2 : SK.drapeGridN;
    const total = (N + 1) * (N + 1);
    for (const p of this.pendingFinalize) {
      if (p.grid && p.gi >= total) continue; // this group's grid is complete
      const span = WORLD_SIZE / 2 ** p.group.z;
      const gspan = span * g;
      const half = WORLD_SIZE / 2;
      const minX = -half + p.group.gx * gspan;
      const minZ = -(half - p.group.gy * gspan);
      if (!p.grid) {
        p.grid = new Float32Array(total);
        if(this.visuals)p.gridZoom=new Uint8Array(total);
        p.gi = 0;
        p.bad = 0;
      }
      const step = gspan / N;
      while (p.gi < total) {
        const ix = p.gi % (N + 1);
        const iy = (p.gi / (N + 1)) | 0;
        const wx = minX + ix * step;
        const wz = minZ + iy * step;
        const s = this.groundAt(
          (wx / EARTH_R) * RAD2DEG,
          (2 * Math.atan(Math.exp(-wz / EARTH_R)) - Math.PI / 2) * RAD2DEG
        );
        if (!s || s.tileZ < this._skylineDemZ || !Number.isFinite(s.elev)) {
          // WORLD PASS C (round 2): keep a finite coarse answer aside; see _finalizePending.
          if (this._reach && s && Number.isFinite(s.elev)) (p.coarse ??= new Float32Array(total).fill(NaN))[p.gi] = s.elev;
          p.bad += 1;
          p.grid[p.gi] = this.visuals ? NaN : refGroundY;
          if(p.gridZoom)p.gridZoom[p.gi]=0;
        } else {
          p.grid[p.gi] = s.elev; // RAW DEM — no toy exaggeration (the R11 rule)
          if(p.gridZoom)p.gridZoom[p.gi]=s.tileZ;
        }
        p.gi += 1;
        if (performance.now() - t0 > SK.drapeBudgetMs * budgetK()) return;
      }
    }
  }

  // --- finalize: merge the group's tiles, apply the drape, upload one mesh ----
  _finalizePending(nowSec = 0) {
    const SK = SAT_SKYLINE;
    const g = this._horizon?.groupN ?? Math.max(1, SK.groupN);
    const N = this._horizon ? SK.drapeGridN * 2 : SK.drapeGridN;
    const total = (N + 1) * (N + 1);
    if (this.pendingFinalize.length) markPhase('finalize:sat-skyline'); // R24 B
    let done = 0;
    for (let i = 0; i < this.pendingFinalize.length && done < SK.finalizePerFrame * budgetK(); i++) {
      // R24 A (FINALIZE_PACE, recon WB-3): the shared per-frame brake. A
      // SEPARATE guard, deliberately not folded into the loop bound, so it
      // composes with any other multiplier on that expression.
      markPhase('finalize:sat-skyline'); // R24 A: E's FRAME_STATS attribution
      const p = this.pendingFinalize[i];
      if (!p.grid || p.gi < total) continue; // still sampling
      // Once preparation starts, its lattice is already validated and fixed.
      if (!this._reach || !p.standInPrep) {
        // A mostly-unstreamed DEM means the whole group would sit at the player's
        // elevation — hold and re-sample rather than commit a floating city. The
        // warp window accepts a coarse answer fast so a destination pops in.
        const badFrac = p.bad / total;
        const maxTries =
          nowSec < (this._warpCoarseUntil ?? 0) ? SK.warpCoarseTries : SK.drapeMaxTries;
        const coarseDue = this._reach && this.visuals && p.coarse &&
          nowSec - (p.wpT0 ?? nowSec) >= (this._reachCfg.drape?.coarseAfterSec ?? 6) &&
          p.bad === total;
        if (!coarseDue && badFrac > 0.5 && (p.tries ?? 0) < maxTries) {
          if (nowSec >= (p.retryAt ?? 0)) {
            p.tries = (p.tries ?? 0) + 1;
            p.retryAt = nowSec + 1.5;
            p.gi = 0;
            p.bad = 0;
          }
          continue;
        }
        // WORLD PASS C (round 2): a group whose every lattice sample answers only
        // from a terrain tile coarser than demZ never finalized (tokyo-bay: flat
        // bay and reclaimed land never refine, ~310 restarts, both arms). That
        // coarse mesh IS what the terrain draws there (rule 4), so after
        // coarseAfterSec it is accepted at zoom 1: the heal sweep and the
        // per-building drape re-seat every building when a finer tile arrives.
        if (coarseDue) {
          let used = 0;
          for (let j = 0; j < total; j++) if (Number.isFinite(p.coarse[j])) { p.grid[j] = p.coarse[j]; p.gridZoom[j] = 1; used += 1; }
          if (used) this._stat.coarseDrapes = (this._stat.coarseDrapes ?? 0) + 1;
        }
        if(this.visuals&&!fillSkylineGrid(p.grid,p.gridZoom,N)){
          // No measured local ground: keep the fetched geometry pending and
          // retry the grid. A previous region's height would create a flying city.
          if(nowSec>=(p.retryAt??0)){p.retryAt=nowSec+1.5;p.gi=0;p.bad=0;this._wp.nonFiniteRestarts+=1;}
          continue;
        }
      }
      if (this._reach) {
        const chunk = this.chunks.get(p.key);
        if (!chunk || chunk.gen !== p.gen || chunk.state !== 'draping') {
          this.pendingFinalize.splice(i--, 1);
          continue;
        }
        // Preserve the shared lane's fairness while replacing the unbounded
        // whole-group task with a deadline. Only publication consumes the R24
        // upload slot; partially prepared arrays never enter the scene.
        if (!wpWholeFinalize()) break;
        const wpT = performance.now(), deadline = wpT + STAND_IN_SLICE_MS * budgetK();
        const span = WORLD_SIZE / 2 ** p.group.z, gspan = span * g;
        const minX = -WORLD_SIZE / 2 + p.group.gx * gspan;
        const minZ = -(WORLD_SIZE / 2 - p.group.gy * gspan);
        if (!p.standInPrep) {
          p.standInPhoto = this._photos?.get(p.key) ?? null;
          p.standInSlot = p.standInPhoto && this._atlas ? this._atlas.alloc(p.standInPhoto) : -1;
          if (p.standInSlot >= 0) this._photoK[p.standInSlot] = 0;
          p.standInPrep = createStandInPreparation(p.parts, p.grid, N, gspan,
            p.standInPhoto, p.standInSlot, this._reachCfg.photo?.radiusPx ?? 1);
          chunk._pendingStandIns = p;
        }
        const complete = advanceStandInPreparation(p.standInPrep, deadline);
        if (!complete || !mayFinalize(done, 'sat-skyline')) {
          this._noteStandInSlice(p, wpT);
          break;
        }
        this.pendingFinalize.splice(i, 1);
        this._finalizeStandIns(p, chunk, { cx: minX + gspan / 2, cz: minZ + gspan / 2,
          gspan, N, minX, minZ, step: gspan / N, nowSec, wpT });
        break;
      }
      if (!mayFinalize(done, 'sat-skyline')) break;
      this.pendingFinalize.splice(i, 1);
      i -= 1;
      done += 1;
      const wpT = performance.now(); // WORLD PASS W0: per-group finalize ms
      const chunk = this.chunks.get(p.key);
      if (!chunk || chunk.gen !== p.gen || chunk.state !== 'draping') continue;

      const span = WORLD_SIZE / 2 ** p.group.z;
      const gspan = span * g;
      const half = WORLD_SIZE / 2;
      const minX = -half + p.group.gx * gspan;
      const minZ = -(half - p.group.gy * gspan);
      const cx = minX + gspan / 2;
      const cz = minZ + gspan / 2;
      const step = gspan / N;

      let totalV = 0;
      let totalI = 0;
      for (const part of p.parts) {
        totalV += part.sk.pos.length / 3;
        totalI += part.sk.idx.length;
      }
      const pos = new Float32Array(totalV * 3);
      const col = new Float32Array(totalV * 3);
      const anchor = new Float32Array(totalV * 2);
      const style = this.visuals ? new Uint8Array(totalV * 3) : null;
      const uv = this.visuals ? new Float32Array(totalV * 2) : null;
      const normals = p.parts.every(part => part.sk.normal?.length === part.sk.pos.length) ? new Float32Array(totalV * 3) : null;
      const idx = totalV > 65535 ? new Uint32Array(totalI) : new Uint16Array(totalI);
      let vOff = 0;
      let iOff = 0;
      const drapeRuns=this.visuals?[]:null;
      for (const part of p.parts) {
        const sk = part.sk;
        const n = sk.pos.length / 3;
        if (normals) normals.set(sk.normal, vOff * 3);
        if (style && sk.style) style.set(sk.style, vOff * 3);
        if (uv && sk.uv) uv.set(sk.uv, vOff * 2);
        // Tile → group frame, then drape. Every vertex of a building shares its
        // footprint-centroid anchor, so one bilinear lookup per ANCHOR RUN puts
        // the whole block on one level ground height (a per-vertex lookup would
        // tilt it — the bend shader assumes rigid blocks).
        let runAx = NaN;
        let runAz = NaN;
        let runY = 0;
        for (let v = 0; v < n; v++) {
          const ax = sk.anchor[v * 2] + part.dx;
          const az = sk.anchor[v * 2 + 1] + part.dz;
          if (ax !== runAx || az !== runAz) {
            if(drapeRuns&&Number.isFinite(runAx))drapeRuns.at(-1).end=vOff+v;
            runAx = ax;
            runAz = az;
            // bilinear over the group grid (clamped at the edges)
            const fx = Math.min(N, Math.max(0, (ax + gspan / 2) / step));
            const fy = Math.min(N, Math.max(0, (az + gspan / 2) / step));
            const x0 = Math.min(N - 1, fx | 0);
            const y0 = Math.min(N - 1, fy | 0);
            const tx = fx - x0;
            const ty = fy - y0;
            const g00 = p.grid[y0 * (N + 1) + x0];
            const g10 = p.grid[y0 * (N + 1) + x0 + 1];
            const g01 = p.grid[(y0 + 1) * (N + 1) + x0];
            const g11 = p.grid[(y0 + 1) * (N + 1) + x0 + 1];
            runY = (g00 * (1 - tx) + g10 * tx) * (1 - ty) + (g01 * (1 - tx) + g11 * tx) * ty;
            if(drapeRuns)drapeRuns.push({start:vOff+v,end:vOff+n,x:fx,z:fy,ground:runY,initialGround:runY});
          }
          const o = (vOff + v) * 3;
          pos[o] = sk.pos[v * 3] + part.dx;
          pos[o + 1] = sk.pos[v * 3 + 1] + runY;
          pos[o + 2] = sk.pos[v * 3 + 2] + part.dz;
          col[o] = sk.col[v * 3];
          col[o + 1] = sk.col[v * 3 + 1];
          col[o + 2] = sk.col[v * 3 + 2];
          anchor[(vOff + v) * 2] = ax;
          anchor[(vOff + v) * 2 + 1] = az;
        }
        for (let k = 0; k < sk.idx.length; k++) idx[iOff + k] = sk.idx[k] + vOff;
        vOff += n;
        iOff += sk.idx.length;
      }

      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('color', new BufferAttribute(col, 3));
      if (style) geo.setAttribute('aBuildingStyle', new BufferAttribute(style, 3));
      if (uv) geo.setAttribute('uv', new BufferAttribute(uv, 2));
      geo.setAttribute('aBendAnchor', new BufferAttribute(anchor, 2));
      // R24 B (FLASH_GUARD) — the skyline's walls are fed by simplifyRing, which
      // already discards the closing clone (recon A1b), so the population here
      // is the roof-earcut COLLINEAR kind (~2 per chunk), not the coincident
      // wall kind. Filter anyway: same helper, before normals, byte-identical
      // when the flag is off.
      const fg = guardIndex(idx, pos);
      this._stat.degenerateDropped += fg.dropped;
      geo.setIndex(new BufferAttribute(fg.idx, 1));
      if (normals) geo.setAttribute('normal', new BufferAttribute(normals, 3));
      else geo.computeVertexNormals();
      geo.computeBoundingSphere();
      // The bend drops geometry in the SHADER, so the computed sphere is the
      // unbent one — inflate it or a far group false-culls at the screen edge.
      // R21 (P1): the flat 1200 is an undershoot for this ring — the worst-case
      // drop is (SK.ring.r + group half-diagonal)² · k ≈ 1.5 km. bendMarginM
      // returns max(1200, computed), so the flag can only ever widen it.
      const spad = bendMarginM(this._horizon ? this._horizonRadius : SK.ring.r, (gspan * Math.SQRT2) / 2);
      if (geo.boundingSphere) geo.boundingSphere.radius += spad;
      const mesh = new Mesh(geo, this.material);
      mesh.userData.bendMarginM = spad; // R21 SANCTIONED INSTRUMENT (E CERT)
      mesh.position.set(cx, 0, cz);
      mesh.frustumCulled = true;
      const repaired = this._retireForRepair(chunk);
      this.object.add(mesh);
      chunk.mesh = mesh;
      if(drapeRuns)chunk.drape={grid:p.grid,zoom:p.gridZoom,runs:drapeRuns,n:N,minX,minZ,step,cursor:0,changed:false,baseRadius:geo.boundingSphere?.radius??0};
      if (!repaired) this._startBirth(mesh, nowSec);
      // R21 (P10): a brand-new group must have its hole visibility resolved on
      // the very next frame, even if the damping would otherwise skip it.
      this._visHole = -1;
      chunk.tris = fg.idx.length / 3; // R24 B: honest post-filter count (=== totalI/3 flag-off)
      chunk.verts = totalV;
      chunk.parts = null; // the transferred buffers are merged — let them go
      chunk.state = 'ready';
      // R24 (B) — RING_HOLD (2) reads these. A group's centre lived only on its
      // mesh; `residencyHeld` refuses to judge a record it cannot locate.
      chunk.cx = cx;
      chunk.cz = cz;
      chunk.readyAt = nowSec;
      // WORLD PASS W0 counters: finalize cost and the first group drawn since the last arm or warp.
      const W = this._wp;
      W.finalizeMsLast = performance.now() - wpT;
      if (W.finalizeMsLast > W.finalizeMsMax) W.finalizeMsMax = W.finalizeMsLast;
      if (W.firstTileSec == null && chunk.mesh && W.desiredAt >= W.armAt && this._wpKeep?.has(p.key)) W.firstTileSec = nowSec - W.armAt;
    }
  }

  /** WORLD PASS W0 — restart the arrival clock (ring arm or warp). Diagnostic only. */
  _wpArm(nowSec) {
    const W = this._wp;
    W.armAt = nowSec;
    W.desiredAt = NaN;
    W.firstTileSec = null;
    W.fullRingSec = null;
    W.finalizeMsMax = 0; // per arrival: the max since this arm or warp
    W.finalizeSliceMsMax = 0;
    W.finalizeSliceMsLast = 0;
    this._wpKeep = null;
  }

  /** WORLD PASS W0 — stamp the full-ring time once every desired group resolved. */
  _wpTrackRing(nowSec) {
    const W = this._wp;
    if (W.fullRingSec != null || !this._ringOn || !this._wpKeep || !(W.desiredAt >= W.armAt)) return;
    for (const k of this._wpKeep) {
      const c = this.chunks.get(k);
      if (!c || (c.state !== 'ready' && c.state !== 'empty')) return;
    }
    W.fullRingSec = nowSec - W.armAt;
  }

  /** WORLD PASS W0 — arrival counters, plain numbers (-1 = not yet). */
  _wpStats() {
    const W = this._wp;
    let stuck = 0;
    for (const p of this.pendingFinalize) if (this._now - (p.wpT0 ?? this._now) > 20) stuck += 1;
    let bytes = 0;
    const add = (geo) => {
      if (!geo) return;
      for (const a of Object.values(geo.attributes)) bytes += a.array?.byteLength ?? 0;
      if (geo.index) bytes += geo.index.array.byteLength;
    };
    for (const c of this.chunks.values()) if (c.mesh) add(c.mesh.geometry);
    for (const d of this._dying) add(d.mesh?.geometry);
    const r1 = (v) => Math.round(v * 10) / 10;
    return {
      firstTileSec: W.firstTileSec == null ? -1 : r1(W.firstTileSec),
      fullRingSec: W.fullRingSec == null ? -1 : r1(W.fullRingSec),
      drapeStuck: stuck,
      drapeNonFiniteRestarts: W.nonFiniteRestarts,
      finalizeMsMax: r1(W.finalizeMsMax),
      finalizeMsLast: r1(W.finalizeMsLast),
      ...(this._reach ? { finalizeSliceMsMax: r1(W.finalizeSliceMsMax), finalizeSliceMsLast: r1(W.finalizeSliceMsLast) } : null),
      geomBytes: bytes,
      // Diag only (worldPassDiag): the worker's stage counters summed over the
      // resident groups, lib/fly/toy-world/world-pass-stages.js.
      ...(this._wpDiag ? { wpStages: sumStageRecords([...this.chunks.values()].map((c) => c.wpStages)) } : {}),
    };
  }

  // --- R24 B (CHUNK_FADE) — per-mesh birth / deferred eviction ---------------

  _repairDrape(nowSec){
    if(!this.visuals)return;
    if(!this._drapeRepair||this.chunks.get(this._drapeRepair.key)!==this._drapeRepair.chunk){
      this._drapeRepair=null;
      if(nowSec<(this._drapeRepairAt??0))return;
      const entries=[...this.chunks].filter(([,c])=>c.mesh&&c.drape);
      if(!entries.length)return;
      const [key,chunk]=entries[(this._drapeRepairCursor??0)%entries.length];
      this._drapeRepairCursor=(this._drapeRepairCursor??0)+1;this._drapeRepair={key,chunk};
    }
    const {chunk}=this._drapeRepair,d=chunk.drape,start=performance.now();
    // Eight terrain queries / 0.35ms, one group upload after a complete sweep.
    // The cursor completes each group and never restarts on camera movement.
    for(let count=0;count<8&&d.cursor<d.grid.length;count++){
      const i=d.cursor++,wx=d.minX+i%(d.n+1)*d.step,wz=d.minZ+Math.floor(i/(d.n+1))*d.step;
      const s=this.groundAt(wx/EARTH_R*RAD2DEG,(2*Math.atan(Math.exp(-wz/EARTH_R))-Math.PI/2)*RAD2DEG);
      if(s&&Number.isFinite(s.elev)&&s.tileZ>=this._skylineDemZ&&s.tileZ>d.zoom[i]){
        d.changed||=Math.abs(s.elev-d.grid[i])>.02;d.grid[i]=s.elev;d.zoom[i]=s.tileZ;
      }
      if(performance.now()-start>=.35)break;
    }
    if(d.cursor===d.grid.length){
      if(d.changed){fillSkylineGrid(d.grid,d.zoom,d.n);if(chunk.standIns?this._redrapeStandIns(chunk):applySkylineDrape(chunk))this._stat.heals++;}
      d.cursor=0;d.changed=false;this._drapeRepair=null;this._drapeRepairAt=nowSec+.05;
    }
  }

  _startBirth(mesh, nowSec) {
    if (!chunkFadeOn() || CHUNK_FADE.birthSec <= 0) return;
    // Budget spent ⇒ degrade to today's behaviour (an instant arrival) rather
    // than starve. Counted, because a pop that survives the feature must be
    // ATTRIBUTABLE: the engine proof asserts pops <= fadeBudgetMiss.
    if (this._births.length >= CHUNK_FADE.maxConcurrent) {
      this._stat.fadeBudgetMiss += 1;
      return;
    }
    const tw = this._fadePool.acquire();
    tw.uniform.value = 0;
    mesh.material = tw.material;
    this._births.push({ mesh, tw, t0: nowSec, f0: this._fadeFrame, k0: 0 });
  }

  _startDeath(mesh, nowSec, chunk) {
    if (this._hardEvict || !chunkFadeOn() || CHUNK_FADE.evictSec <= 0) return false;
    if (this._dying.length >= CHUNK_FADE.maxDying) {
      this._stat.fadeBudgetMiss += 1;
      return false;
    }
    const bi = this._births.findIndex((b) => b.mesh === mesh);
    let tw;
    let k0 = 1;
    if (bi >= 0) {
      const b = this._births[bi];
      k0 = b.k0 + (1 - b.k0) * fadeRamp(rampT(b, nowSec, CHUNK_FADE.birthSec, this._fadeFrame));
      tw = b.tw;
      this._births.splice(bi, 1);
    } else {
      tw = this._fadePool.acquire();
      tw.uniform.value = this._skyFade;
      mesh.material = tw.material;
    }
    this._dying.push({ mesh, tw, t0: nowSec, f0: this._fadeFrame, k0, chunk });
    return true;
  }

  _stepFades(nowSec) {
    this._fadeFrame += 1; // R24 B (W3): the frame-count floor's clock
    if (this._births.length || this._dying.length) markPhase('fade:sat-skyline'); // R24 B
    const alt = this._skyFade;
    for (let i = this._births.length - 1; i >= 0; i--) {
      const b = this._births[i];
      const r = fadeRamp(rampT(b, nowSec, CHUNK_FADE.birthSec, this._fadeFrame));
      b.tw.uniform.value = alt * (b.k0 + (1 - b.k0) * r);
      if (r >= 1) {
        b.mesh.material = this.material;
        this._fadePool.release(b.tw);
        this._births.splice(i, 1);
      }
    }
    for (let i = this._dying.length - 1; i >= 0; i--) {
      const d = this._dying[i];
      const r = fadeRamp(rampT(d, nowSec, CHUNK_FADE.evictSec, this._fadeFrame));
      d.tw.uniform.value = alt * d.k0 * (1 - r);
      if (r >= 1) {
        this.object.remove(d.mesh);
        d.mesh.geometry.dispose();
        this._fadePool.release(d.tw);
        this._dying.splice(i, 1);
      }
    }
  }

  /** Land every ramp NOW (warp, style flip, dispose): a cut is not a crossfade. */
  _flushFades() {
    for (const b of this._births) {
      b.mesh.material = this.material;
      this._fadePool.release(b.tw);
    }
    this._births.length = 0;
    for (const d of this._dying) {
      this.object.remove(d.mesh);
      d.mesh.geometry.dispose();
      this._fadePool.release(d.tw);
    }
    this._dying.length = 0;
  }

  _releasePhoto(chunk) {
    if (this._photoPatch?.chunk === chunk) {
      this._atlas?.free(this._photoPatch.slot);
      this._photoPatch = null;
    }
    if (chunk.standIns?.slot >= 0) {
      // WORLD PASS C (round 2b): quarantined, so a group still fading out keeps its layer.
      this._atlas?.free(chunk.standIns.slot);
      this._photoRamps.delete(chunk.standIns.slot);
    }
  }

  _retireForRepair(chunk) {
    if (!chunk.mesh) return false;
    this._releasePhoto(chunk);
    const i = this._births.findIndex((b) => b.mesh === chunk.mesh);
    if (i >= 0) this._fadePool.release(this._births.splice(i, 1)[0].tw);
    this.object.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    chunk.mesh = null;
    return true;
  }

  _evict(key, chunk) {
    const pending = chunk._pendingStandIns;
    if (pending) {
      this._atlas?.free(pending.standInSlot);
      pending.standInPrep?.iterator.return();
      pending.standInPrep = null;
      pending.standInPhoto = null;
      pending.parts = null;
      chunk._pendingStandIns = null;
    }
    this._releasePhoto(chunk);
    if (chunk.mesh) {
      // R24 B (CHUNK_FADE): leave `this.chunks` NOW (every count unchanged),
      // keep drawing while it dims. Bounded by maxDying; Owens has no group to
      // fade ⇒ exactly 0 extra draws.
      if (this._startDeath(chunk.mesh, this._now ?? 0, CITY_GEOMETRY_LOD_ON ? chunk : null)) {
        chunk.mesh = null;
      } else {
        this.object.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
        chunk.mesh = null;
      }
    }
    chunk.parts = null;
    this._stat.evictions += 1; // R21: E CERT reads this off engine.stats
    this.chunks.delete(key);
  }

  /** Dev telemetry (window.__satSkyline.stats / __flyStats.satSkyline). */
  /** R24 B (FLASH_GUARD) — E CERT census hook over resident, draped meshes. */
  censusDegenerate() {
    const meshes = [];
    for (const c of this.chunks.values()) if (c.mesh) meshes.push(c.mesh);
    return censusDegenerate(meshes);
  }

  get stats() {
    let ready = 0; // merged meshes held (one per non-empty group)
    let drawn = 0; // …of which actually issued (the rest sit inside the hole)
    let empty = 0;
    let tris = 0;
    let verts = 0;
    for (const c of this.chunks.values()) {
      if (c.mesh) {
        ready += 1;
        if (c.mesh.visible) drawn += 1;
        tris += c.tris ?? 0;
        verts += c.verts ?? 0;
      }
      if (c.state === 'empty') empty += 1;
    }
    return {
      chunks: this.chunks.size,
      ready,
      drawn,
      empty,
      tris,
      verts,
      queued: this.queue.length,
      building: this.building,
      draping: this.pendingFinalize.length,
      ringOn: this._ringOn,
      maxChunks: this.maxChunks,
      ...(this._horizon ? { horizon: { ...this._horizon, band: this._horizonBand, liveEnd: this._horizonLiveEnd, targetChunks: this._horizonTargetChunks, contracting: !!this._horizonContraction, waitingTiles: this._tileQueue.length } } : {}),
      // Round 21 (B) — streaming telemetry for E CERT. Additive, unflagged.
      emptyByReason: emptyByReason(this.chunks),
      errorRetries: this._stat.errorRetries,
      evictions: this._stat.evictions,
      heals: this._stat.heals,
      degenerateDropped: this._stat.degenerateDropped, // R24 B (FLASH_GUARD)
      // R24 B (CHUNK_FADE) — additive; 0 with the flag off. Only `dying` draws.
      births: this._births.length,
      dying: this._dying.length,
      fadeTwins: this._fadePool.size,
      fadeBudgetMiss: this._stat.fadeBudgetMiss,
      ...(this._wpCount ? this._wpStats() : null), // WORLD PASS W0: nothing, and no allocation, with the counters off
      // WORLD PASS C (REACH): flat numbers so the budget tool records them.
      ...(this._reach ? { standInsResident: this._standInStat.resident, standInsDrawn: this._standInStat.drawn, standInTris: this._standInStat.drawn * STAND_IN_TRIANGLES, standInGroups: this._standInStat.groups, standInCoverM: this._standInStat.coverM, standInMinPx: this._standInStat.minPx, standInsWanted: this._standInStat.wanted, standInPhotos: this._photos?.stat.fetched ?? 0, standInPhotoFails: this._photos?.stat.failed ?? 0, standInPhotoPatched: this._stat.photoPatched ?? 0, standInPhotoAtFinalize: this._stat.photoAtFinalize ?? 0, standInPhotoMissAtFinalize: this._stat.photoMissAtFinalize ?? 0, standInPhotoAllocMs: Math.round((this._atlas?.stat.allocMsMax ?? 0) * 10) / 10 } : null),
      ...(this._reach ? {
        standInPrepBytes: this.pendingFinalize.reduce((bytes, p) => bytes + (p.standInPrep?.bytes ?? 0), 0),
        standInPhotoPatchBytes: this._photoPatch?.data.byteLength ?? 0,
        standInPhotoPatchMsMax: this._stat.photoPatchMsMax ?? 0,
      } : null),
      // WORLD PASS C diag (?flags=WORLD_PASS_DIAG): the worker's stand-in stage counters summed
      // over the resident groups, flattened to numbers (wpReach_<counter>) for the capture tools.
      ...(this._reach && this._wpDiag ? Object.fromEntries(Object.entries(sumStageRecords([...this.chunks.values()].map((c) => c.wpStages)).reach ?? {}).map(([k, v]) => [`wpReach_${k}`, v])) : null),
    };
  }

  dispose() {
    this._disposed = true;
    // R24 B: BEFORE the evict loop below — a teardown must not defer anything.
    this._hardEvict = true;
    this._flushFades();
    // The choreography uniforms are module-shared: hand them back at identity
    // so a re-mount (style flip / StrictMode) never starts inside a dissolve.
    setSatSkyline(0, SAT_SKYLINE.hole.featherM, 1);
    if (this._horizon) setCityHorizonFade(0, 0);
    for (const [key, chunk] of [...this.chunks]) this._evict(key, chunk);
    this.queue.length = 0;
    this._tileQueue.length = 0;
    this.pendingFinalize.length = 0;
    this._gRetry.clear(); // R21
    this._fadePool.dispose();
    this._photos?.dispose(); // WORLD PASS C (round 2b)
    this._atlas?.dispose();
    this._photos = null;
    this._atlas = null;
    if (this._standInU) this._standInU.uStandInPhotos.value = null;
    this._photoArrived.length = 0;
    this._photoPatch = null;
    this._photoRamps.clear();
    this._photoK?.fill(0);
    this._photoWantT = -Infinity;
    this._photoPollT = -Infinity;
    this.worker = null;
    this._pool = null;
    this.material.dispose();
  }
}
