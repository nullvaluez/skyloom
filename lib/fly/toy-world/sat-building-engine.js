import { markPhase } from '../frame-stats';
import { trueAreasRequest } from '../true-areas';
import { premiumWorldRequest } from '../premium-earth';
import { worldPassRequest, worldPassMatch, worldPassDiag, worldPassCounters, worldPassOn, worldPassConfig } from '../world-pass'; // WORLD PASS W0
// WORLD PASS B (ARRIVAL): the exact fast ground query and its batch scope.
import { armFastGroundQuery, beginGroundBatch, endGroundBatch } from '../terrain-ground-query';
import { WpQuantAttribute, WPQ_POS_K, WPQ_UV_K, patchQuantMaterial, quantDepthMaterial, dequantPositions } from './wp-quant'; // WORLD PASS B r2 (quantize)
import { sumStageRecords } from './world-pass-stages'; // WORLD PASS W0 diag counters
import { requestLookRoofPatch } from '../look-roof-patch'; // WORLD PASS D x B seam (late roof photo)
import { wpSliceMayRun, wpSliceSpend, wpFrameSliceStats } from './wp-frame-slice'; // WORLD PASS B r2b
import { mayFinalize } from '../finalize-pace';
import {
  AdditiveBlending,
  Sphere,
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  MeshPhongMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
} from 'three';
import {
  BEND_LEAD,
  CHUNK_FADE,
  FLASH_GUARD,
  GLOBE,
  HEAL_IN_PLACE,
  LAMBERT_ENV,
  LEAD_SAFE,
  NIGHT_CITY_R23,
  RING_HOLD,
  SAT_BLDG_FADE,
  SAT_BUILDINGS,
  SAT_WATER,
  STREAM_KEEPER,
  SUBURB_NIGHT,
} from '../fly-constants';
// R24 (E CERT): harness-only per-frame budget scaler — exactly 1 in production.
import { budgetK } from '../harness-budget';
import { applyBendAnchorSat, applyBendWaterSat, getSatBldgFade, groundOverlayOffset, setSatBldgFade, setNightCityWindows } from './world-bend';
// R24 B (FLASH_GUARD, recon WB-1/A1) — zero-area triangle filter at finalize.
import { censusDegenerate, guardSliceBegin, guardSliceStep } from './flash-guard';
// R24 B (CHUNK_FADE, recon WB-2/A6) — per-mesh birth / deferred-evict ramps.
import { TwinPool, chunkFadeOn, fadeRamp, rampT } from './chunk-fade';
import { nightCityOn } from '../night-city';
import { satelliteVisualsOn } from '../satellite-visuals';
import { createSatelliteArchitectureMaterial, setSatelliteArchitectureDetail, setSatelliteArchitectureNight } from '../satellite-architecture-material';
import { guardArchitectureIndex, partitionArchitectureIndex, installArchitectureShadowRange, padArchitectureRegionHeights, refreshArchitectureRegionHeights } from '../architecture-draw-range';
import { createSatelliteWaterMaterial, setSatelliteWaterClusters, addSatelliteWaterShore } from '../satellite-water';
// SHIP PASS CITY (CT-1, CT-2): the ring's altitude band (diagnosis pins, CITY_RANGE, shipped).
import { bandFade, buildingBand, makeBandMemo, noteCityDiagApplied } from '../city-range';
import { setArchitectureLite, setArchitectureMergeColor } from '../architecture-draw-range';

// Must match vector-tile.worker.js WORKER_PROTOCOL (round 16 → 13). On mismatch
// (a stale HMR worker paired with new engine code) this engine dev-warns ONCE
// and RENDERS NOTHING for that tile. Round 15 made the skip explicit: a
// protocol-11 worker still returns a satBuilding bundle, but WITHOUT the `uv`
// array — and a missing attribute reads (0,0) on the GPU, which in the window
// atlas is the middle of a pane, so every roof would sprout a window. Dropping
// the tile is the safe read of "stale worker" (no crash, no wrong pixels); the
// warn tells the dev to hard-reload.
// Round 16 → 13: the worker gained the 'sat-roads' detail + out.satRoads. THIS
// path's buffer layout is unchanged, so the bump only keeps the two protocol
// constants in lockstep — but a v12 worker is still genuinely stale here and
// the drop-and-warn behaviour above is unchanged.
// Round 18 → 14: this path's OWN output grew (out.waterCoverage +
// out.satBuilding.meta) and the detail vocabulary gained 'sat-skyline'/
// 'sat-veg'. A v13 bundle has neither new key: waterCoverage would read
// undefined (ocean fill silently never fires — safe) and meta undefined (no
// telemetry — safe), but the drop-and-warn contract above is stricter and
// stays: a stale worker renders NOTHING here. New keys additionally fail safe
// on their own, so the two guards are belt and braces.
// Round 19 → 15: scaffolding-commit lockstep bump (all six pin sites in one
// diff). This path's output grows again in-round (housePts / satTint /
// per-class veg rows — A HOMESTEAD); a v14 bundle predates them all.
// Round 21 → 17: scaffolding lockstep (six pin sites, one diff). D PIPELINE
// adds empty-reason codes + changes skyline selection this round.
const EXPECTED_WORKER_PROTOCOL = 27; // World Pass wave 2 (FLY_WORLD_PASS.md)
let _warnedProtocol = false;

const EARTH_R = 6378137;
// WORLD PASS B (ARRIVAL): the switch set while the stream is off (or not yet
// latched): every arrival branch reads false and the shipped path runs.
const ARRIVAL_OFF = Object.freeze({ on: false, fastQuery: false, drapeCap: false, workerPrep: false, uploads: false, footings: false, readiness: false, cfg: null });
const WORLD_SIZE = 2 * Math.PI * EARTH_R;
const RAD2DEG = 180 / Math.PI;

// --- Round 21 (B STREAMKEEPER) ---------------------------------------------
// P1: world-bend's vertex shader drops every vertex by d²·k (world-bend.js
// :298-309) while the CPU bounding sphere is computed on the UNBENT buffer, so
// three's frustum test discards chunks that are still on screen — measured ~6%
// of a sphere radius on this z14 ring (the smallest of the four, because the
// ring is the tightest) and up to 89% on the toy z10 ring. k here is the
// MAXIMUM (GLOBE.altFlatten only flattens it with altitude), so the margin can
// only keep geometry, never drop it. Precedent: SatParcelHomes.jsx:29/683.
// Every helper below is inert while STREAM_KEEPER.enabled is false.
const MAX_BEND_K = 1 / (2 * GLOBE.bendRadiusM.satellite);

function bendMarginM(ringAliveR, chunkHalfDiagM) {
  const B = STREAM_KEEPER.bendMargin;
  if (!STREAM_KEEPER.enabled || !B.enabled) return 0;
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
  return d * d * MAX_BEND_K * B.pad;
}

/**
 * Round 22.1 (C "FLASH") — strip zero-area triangles from a chunk's index
 * buffer. See the FLASH_GUARD block in fly-constants.js for the full
 * derivation; the short version is that ONE zero-area triangle was measured
 * painting a near-full-screen pale field for one frame, and every large chunk
 * carries thousands of them.
 *
 * Two independent producers, which is why this is an AREA test at the end of
 * the pipeline rather than a dedupe at either source:
 *   - WALLS (~99.9%). `@mapbox/vector-tile`'s loadGeometry() closes every ring
 *     by appending a clone of ring[0], so the wall loop's wrap-around edge
 *     (j = ring.length-1, e = 0) is ALWAYS zero-length and always emits a
 *     degenerate quad. Structural, once per ring, plus once per hole.
 *   - ROOFS (~2 per chunk). earcut over a cap ring with collinear points emits
 *     zero-area triangles whose vertices are DISTINCT. This is the kind that
 *     was actually caught painting, and a point dedupe would not touch it.
 *
 * Runs on the DRAPED positions, so it also catches anything the drape flattens
 * into a degenerate. Compacts in place — the buffer was transferred from the
 * worker and is owned here — and returns the input array untouched when
 * nothing is dropped, so a clean chunk allocates nothing and is bit-identical.
 *
 * @param {Uint16Array|Uint32Array} idx draw indices, mutated in place
 * @param {Float32Array} pos draped vertex positions, xyz interleaved
 * @returns {{ idx: Uint16Array|Uint32Array, dropped: number, tris: number }}
 */
function dropDegenerateTris(idx, pos) {
  const G = FLASH_GUARD;
  const tris = idx ? (idx.length / 3) | 0 : 0;
  if (!G.enabled || !G.dropDegenerateTris || !idx || !pos) return { idx, dropped: 0, tris };
  // RED-calibration pin, the R22.1 (A) `__flyStepSafePin` idiom: lets
  // verify-flash-guard measure the DEFECTIVE tree in the same session, on the
  // same machine, without a rebuild. Never set by the app or by scripts/_boot.
  if (typeof window !== 'undefined' && window.__flyFlashPin === 'off') {
    return { idx, dropped: 0, tris };
  }
  // Compare the SQUARED cross-product magnitude against the squared bound —
  // one multiply instead of a sqrt on every triangle of every streamed chunk.
  const lim = G.minArea2 * G.minArea2;
  const n = idx.length - 2;
  let w = 0;
  let dropped = 0;
  for (let i = 0; i < n; i += 3) {
    const ia = idx[i] * 3;
    const ib = idx[i + 1] * 3;
    const ic = idx[i + 2] * 3;
    const ax = pos[ia];
    const ay = pos[ia + 1];
    const az = pos[ia + 2];
    const ux = pos[ib] - ax;
    const uy = pos[ib + 1] - ay;
    const uz = pos[ib + 2] - az;
    const vx = pos[ic] - ax;
    const vy = pos[ic + 1] - ay;
    const vz = pos[ic + 2] - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz <= lim) {
      dropped += 1;
      continue;
    }
    if (w !== i) {
      idx[w] = idx[i];
      idx[w + 1] = idx[i + 1];
      idx[w + 2] = idx[i + 2];
    }
    w += 3;
  }
  return { idx: dropped ? idx.subarray(0, w) : idx, dropped, tris };
}

function jitter1() {
  const j = STREAM_KEEPER.retry.jitter;
  return 1 + (Math.random() * 2 - 1) * j;
}

// --- Round 24 (B STREAM) — LEAD_SAFE + RING_HOLD ----------------------------
//
// THE THREE HELPERS BELOW ARE CARRIED VERBATIM IN ALL FIVE STREAMING ENGINES
// (buildings / veg / clutter / roads / skyline). That is deliberate and it is
// this module's own idiom: `bendMarginM`, `_trackVel` and `_leadCenter` are
// already five file-local copies apiece. A shared module would be a sixth file
// nobody owns, and R24 B's charter is these five files.
//
// Every one of them returns the EXACT pre-R24 expression when its flag is off,
// so `LEAD_SAFE.enabled:false` / `RING_HOLD.enabled:false` are true one-line
// reverts. None of them touches a material, a shader, a uniform or a cache key.

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

/**
 * LEAD_SAFE — an ABSOLUTE metre cap on R21's velocity lookahead.
 *
 * `STREAM_KEEPER.lookahead` pushes each ring's centre `min(speed × leadSec,
 * maxLeadFrac × ringR)` ahead of the player. For the long rings that is a tuned
 * trade. For the SHORT rings it silently broke an invariant that two earlier
 * rounds wrote down as prose and sized their fade constants against:
 *
 *   fly-constants.js:3155  "endM is inside the guaranteed-coverage radius
 *                           above, so canopies always die of THIS and never of
 *                           a missing chunk."     (SAT_VEG.distFade.endM 2400)
 *   fly-constants.js:5037  "worst-case guaranteed coverage 2446 m >= every
 *                           rangeM"               (CLUTTER, max rangeM 2200)
 *
 * Both were computed with NO lead, because both predate (veg) or post-date
 * without re-deriving (clutter, R22) R21's lookahead. The engine centres the
 * desired set on the LEAD point; the consuming layer fades its instances on
 * distance from the PLAYER. Measured by exact bisection over 17×17 player
 * positions × 72 lead bearings (scripts/r24-b-ringhold.mjs, `guaranteed()`):
 *
 *   ring                       G(lead 0)   G(lead 0.35·r)   must cover
 *   SAT_VEG   z14 r3600 /9        2417          1164           2400   BROKEN
 *   CLUTTER   z13 r3600 /6        2885          1646           2200   BROKEN
 *
 * so behind a fast aircraft, canopies and moving cars were cut by a MISSING
 * CHUNK at full scale — a hard pop with no fade, and one that only exists at
 * speed, which is why no gate in the fleet has ever seen it (every harness
 * pose is frozen or slow, and R21's own merge note records "speed 0 =
 * bit-identical centre").
 *
 * The shipped caps are that bisection's answers, not estimates. See the
 * LEAD_SAFE block in fly-constants.js for the derivation table.
 */
function leadCapM(name, ringR) {
  const base = STREAM_KEEPER.lookahead.maxLeadFrac * ringR;
  if (!leadSafeOn()) return base;
  const cap = LEAD_SAFE.capByEngine?.[name];
  return typeof cap === 'number' ? Math.min(base, cap) : base;
}

/**
 * RING_HOLD (1) — RANK HYSTERESIS, AND IT PRESERVES THE HARD DRAW BOUND.
 *
 * `desired` arrives sorted nearest-first and every ring then takes
 * `slice(0, maxChunks)`, evicting everything else THE SAME FRAME. There are
 * always more candidates than slots (measured: 21 for the 16-slot building
 * ring, 15 for the 9-slot veg ring, 8 for the 6-slot clutter ring, 32 for the
 * 16-slot road ring), so the chunks at the boundary oscillate — and an eviction
 * is a `geometry.dispose()`, with the way back costing a worker round-trip plus
 * a re-drape that can hold for `drapeMaxTries × drapeRetrySec` (~30 s).
 *
 * A resident chunk in the slack band [maxChunks, maxChunks + keepHysteresis)
 * therefore displaces the WORST-RANKED NEWCOMER rather than being dropped.
 * ONE IN, ONE OUT: `kept.length <= maxChunks` still holds by construction, so
 * the per-ring draw ceiling every frozen gate rests on cannot move. What
 * changes is WHICH chunks are resident, never HOW MANY.
 *
 * `isLive` is the caller's answer to "does this record have something on
 * screen worth protecting" — a record still building has nothing to protect and
 * must not spend a slot on itself.
 *
 * The result is re-sorted by `distSq` before returning (every caller's
 * candidate objects carry that field) so the water sub-slice, the build queue
 * order and anything else that reads `kept` positionally still sees rank order.
 */
function ringHoldKeep(desired, maxChunks, chunks, keyOf, isLive) {
  const kept = desired.slice(0, maxChunks);
  if (!ringHoldOn()) return kept;
  const H = RING_HOLD.keepHysteresis;
  if (!(H > 0) || desired.length <= maxChunks) return kept;
  let w = kept.length - 1; // scan the tail for a NEWCOMER to displace
  const end = Math.min(desired.length, maxChunks + H);
  let swapped = false;
  for (let i = maxChunks; i < end; i++) {
    const e = desired[i];
    const c = chunks.get(keyOf(e));
    if (!c || !isLive(c)) continue;
    while (w >= 0 && chunks.has(keyOf(kept[w]))) w -= 1;
    if (w < 0) break; // every slot is already an incumbent — the bound wins
    kept[w] = e;
    w -= 1;
    swapped = true;
  }
  if (swapped) kept.sort((a, b) => a.distSq - b.distSq);
  return kept;
}

/**
 * RING_HOLD (2) — MINIMUM RESIDENCY.
 *
 * A chunk that has only just become drawable must not be thrown away because
 * the ring centre wobbled across a bisector one refresh later. Returns the set
 * of resident keys that are NOT in `keep` but are held anyway.
 *
 * This is the one hold that can keep a record past the rank bound, so it is
 * bounded twice over and both bounds are stated rather than hoped for:
 *
 *   - AT MOST `keepHysteresis` records, chosen NEAREST-FIRST. Worst-case
 *     resident count is therefore `maxChunks + keepHysteresis` (= +2 records
 *     for every ring this round), and it is transient by construction — the
 *     hold expires on a wall clock, it cannot accumulate.
 *   - Never a record beyond `ringR × 1.25`, so a warp or a hard climb (which
 *     leaves everything far away at once) evicts immediately, exactly as today.
 *
 * `+2 records` is NOT `+2 draws` in the common case: an empty tile issues no
 * mesh at all (`_finalizePending` only builds one `if (bld)`), which is why the
 * Owens Valley draw ceiling — the tightest in the fleet — is insensitive to
 * this. Where it IS +2 draws (a dense downtown) the fixed-pose gate that
 * measures there has 149 draws of headroom (verify-sat-buildings 226 ≤ 375).
 *
 * A record with no resolved centre is never held: it cannot be judged, and
 * guessing "distance 0" would hold everything.
 */
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

// P2 — D PIPELINE's reason contract: 'no-data' (upstream 404/204) may be asked
// again after a TTL; 'zero' (parsed, admitted nothing — caps, locks, no
// matching layers) is deterministic and never is; undefined is a LEGACY worker
// ⇒ sticky-forever, exactly as today.
function emptyRetryAt(nowSec, reason) {
  const R = STREAM_KEEPER.retry;
  if (!STREAM_KEEPER.enabled || !R.enabled || reason !== 'no-data') return Infinity;
  return nowSec + R.noDataTtlSec * jitter1();
}

/**
 * P2 — capped, jittered exponential backoff for a FAILED build (was: none).
 * D PIPELINE's typed throws all land here and are ALL retryable in this one
 * class: `http-<code>` (5xx/429 upstream) and `http-timeout` (D's 12 s
 * AbortController — a stalled connection used to hold an in-flight slot for
 * minutes, i.e. a permanent hole with no error to retry against). An empty
 * TILE never throws: it comes back as { empty:true, reason } and is handled by
 * emptyRetryAt, where 'zero' — the ORDINARY open-ocean answer (OFM serves
 * empty ground as 200 + ~57 bytes, not 404) — is never re-asked, which is what
 * keeps oceans free. 'no-data' is the rare genuine-404 path.
 */
function errorNextTryAt(nowSec, attempts) {
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

/** Deterministic per-atlas RNG (same seed ⇒ same city, every session). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Round 15 — the ONE procedural facade atlas, in two paintings of the SAME
 * cell grid (so `map` and `emissiveMap` share the worker's single uv set):
 *
 *   night=false → DAYLIGHT `map`. Background is pure WHITE = the pier/spandrel,
 *     which multiplies the wall's vertex tone by exactly 1 (the masonry keeps
 *     the palette colour); only the panes darken it. Glazing tone is randomised
 *     per cell with a sky-reflection gradient + mullion cross.
 *   night=true → EMISSIVE map. Background is the near-black ambientFloor (roofs
 *     and piers stop at "not quite black" instead of dead black at midnight);
 *     panes are lit in whole FLOORS × per-cell runs, a few of them cool.
 *
 * Panes are INSET inside their cell, so the cell crossing at neutralUV (the uv
 * the worker gives every roof/detail vert) is solid background in both — with
 * paneInset × cell px of clearance on every side. A constant uv over a triangle
 * has zero screen-space derivative ⇒ mip 0 ⇒ roofs sample that exact texel at
 * any distance: white (roof colour untouched) by day, floor-gray by night.
 */
function makeFacadeAtlas(night) {
  const F = SAT_BUILDINGS.facade;
  const N = SAT_BUILDINGS.night;
  const n = F.texSize;
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  const ctx = c.getContext('2d');
  const cw = n / F.cols;
  const ch = n / F.rows;
  const inset = Math.max(2, Math.round(Math.min(cw, ch) * F.paneInset));
  const rnd = mulberry32(night ? N.seed : F.seed);
  if (night) {
    const f = Math.round(N.ambientFloor * 255);
    ctx.fillStyle = `rgb(${f},${Math.round(f * 0.9)},${Math.round(f * 0.78)})`;
  } else {
    ctx.fillStyle = '#ffffff'; // pier/spandrel = wall tone untouched
  }
  ctx.fillRect(0, 0, n, n);
  const dark = hexTriplet(F.paneDark);
  const light = hexTriplet(F.paneLight);
  for (let r = 0; r < F.rows; r++) {
    // whole lit/dark FLOORS (R8 lesson: a per-window coin flip reads as noise)
    const floorLit = night && rnd() < N.litFloorFrac;
    for (let col = 0; col < F.cols; col++) {
      const x = col * cw + inset;
      const y = r * ch + inset;
      const w = cw - inset * 2;
      const h = ch - inset * 2;
      if (night) {
        const lit = floorLit && rnd() < N.litCellFrac;
        if (!lit) continue; // unlit pane = the background floor
        const b = 0.55 + rnd() * 0.45;
        const cool = rnd() < N.coolFrac;
        const rr = Math.round(255 * b * (cool ? 0.78 : 1));
        const gg = Math.round(255 * b * (cool ? 0.9 : 0.97));
        const bb = Math.round(255 * b * (cool ? 1 : 0.86));
        ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
        ctx.fillRect(x, y, w, h);
      } else {
        const t = rnd();
        const g = ctx.createLinearGradient(x, y, x, y + h);
        const mix = (i, lift) =>
          Math.round(Math.min(255, (dark[i] + (light[i] - dark[i]) * t) * (1 + lift)));
        g.addColorStop(0, `rgb(${mix(0, F.skyGrad)},${mix(1, F.skyGrad)},${mix(2, F.skyGrad)})`);
        g.addColorStop(1, `rgb(${mix(0, 0)},${mix(1, 0)},${mix(2, 0)})`);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        // mullion cross: the frame that makes a pane read as a WINDOW, not a smudge
        ctx.fillStyle = F.mullion;
        const t1 = Math.max(1, Math.round(n / 256)); // ~2px at 512 — survives mip 1
        ctx.fillRect(x + w / 2 - t1 / 2, y, t1, h);
        ctx.fillRect(x, y + h / 2 - t1 / 2, w, t1);
      }
    }
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = RepeatWrapping; // u tiles across the facade run…
  tex.wrapT = RepeatWrapping; // …v up the floors
  tex.colorSpace = SRGBColorSpace; // authored in sRGB (both are colour maps)
  tex.anisotropy = F.anisotropy;
  return tex;
}

// Round 21 (W0 scaffolding, behavior-preserving): module-scope memo over
// makeFacadeAtlas so (a) the atlases survive engine dispose/re-mount instead
// of being re-rastered + re-uploaded on every style flip / tier cycle, and
// (b) A GOVERNOR's boot pre-warm (lib/fly/prewarm.js) can build them during
// boot idle — the engine path below is unchanged (same lazy call, same
// deterministic seeded output; mulberry32(seed) makes day/night each a pure
// function). Never disposed: two 512² canvas textures are the retention cost
// that turns the mid-flight facade/night program flips into re-links.
let _facadeAtlasDay = null;
let _facadeAtlasNight = null;
export function getFacadeAtlas(night) {
  if (night) {
    if (!_facadeAtlasNight) _facadeAtlasNight = makeFacadeAtlas(true);
    return _facadeAtlasNight;
  }
  if (!_facadeAtlasDay) _facadeAtlasDay = makeFacadeAtlas(false);
  return _facadeAtlasDay;
}

function hexTriplet(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Bucket index clamp (shared by every axis of the column query). */
function clampIdx(i, n) {
  return i < 0 ? 0 : i > n - 1 ? n - 1 : i;
}

/** Column-grid resolution per chunk (8×8 over one z14 tile ≈ 300 m cells). */
const COLUMN_GRID_N = 8;

/**
 * Round 18 — pack a chunk's per-building bounding cylinders into a flat
 * Float32Array [x, z, topY, r] plus an 8×8 bucket index over the tile square,
 * so queryColumns is a couple of array lookups instead of a scan over ~500
 * buildings per chunk. A column is registered in EVERY bucket its footprint
 * circle touches (not just the one holding its center) — otherwise a tower
 * straddling a cell boundary would be invisible to a query on the far side.
 */
function buildColumnGrid(cx, cz, z, xs, zs, tops, rs) {
  const span = WORLD_SIZE / 2 ** z;
  const N = COLUMN_GRID_N;
  const cell = span / N;
  const minX = cx - span / 2;
  const minZ = cz - span / 2;
  const count = xs.length;
  const data = new Float32Array(count * 4);
  const buckets = new Array(N * N).fill(null);
  for (let i = 0; i < count; i++) {
    const x = xs[i];
    const zz = zs[i];
    const r = rs[i];
    data[i * 4] = x;
    data[i * 4 + 1] = zz;
    data[i * 4 + 2] = tops[i];
    data[i * 4 + 3] = r;
    const bx0 = clampIdx(Math.floor((x - r - minX) / cell), N);
    const bx1 = clampIdx(Math.floor((x + r - minX) / cell), N);
    const bz0 = clampIdx(Math.floor((zz - r - minZ) / cell), N);
    const bz1 = clampIdx(Math.floor((zz + r - minZ) / cell), N);
    for (let bz = bz0; bz <= bz1; bz++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = bz * N + bx;
        if (!buckets[b]) buckets[b] = [];
        buckets[b].push(i);
      }
    }
  }
  return { minX, minZ, maxX: minX + span, maxZ: minZ + span, cell, n: N, count, data, buckets };
}

/**
 * WORLD PASS B r2b: buildColumnGrid as a resumable step (the same loop, the
 * same output), so a dense tile's collision columns can be built in slices.
 */
function columnGridBegin(cx, cz, z, count) {
  const span = WORLD_SIZE / 2 ** z;
  const N = COLUMN_GRID_N;
  const minX = cx - span / 2, minZ = cz - span / 2;
  return { i: 0, count, span, N, cell: span / N, minX, minZ, data: new Float32Array(count * 4), buckets: new Array(N * N).fill(null), grid: null };
}

function columnGridStep(G, xs, zs, tops, rs, deadline) {
  if (G.grid) return true;
  const { N, cell, minX, minZ, data, buckets, count } = G;
  const i0 = G.i;
  let i = i0;
  for (; i < count; i++) {
    if (i > i0 && (i & 127) === 0 && performance.now() > deadline) { G.i = i; return false; } // at least one column a call
    const x = xs[i];
    const zz = zs[i];
    const r = rs[i];
    data[i * 4] = x;
    data[i * 4 + 1] = zz;
    data[i * 4 + 2] = tops[i];
    data[i * 4 + 3] = r;
    const bx0 = clampIdx(Math.floor((x - r - minX) / cell), N);
    const bx1 = clampIdx(Math.floor((x + r - minX) / cell), N);
    const bz0 = clampIdx(Math.floor((zz - r - minZ) / cell), N);
    const bz1 = clampIdx(Math.floor((zz + r - minZ) / cell), N);
    for (let bz = bz0; bz <= bz1; bz++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = bz * N + bx;
        if (!buckets[b]) buckets[b] = [];
        buckets[b].push(i);
      }
    }
  }
  G.i = i;
  G.grid = { minX, minZ, maxX: minX + G.span, maxZ: minZ + G.span, cell, n: N, count, data, buckets };
  return true;
}

// Whole-building translation preserves supplied min_height, roof geometry and
// normals. Only a finer valid sample (or recovery from a missing sample) wins;
// temporarily coarse terrain cannot pull a resolved building down again.
function repairCinematicBuildingDrape(chunk, run, sample) {
  if (!sample || !Number.isFinite(sample.elev) || sample.tileZ < SAT_BUILDINGS.demZ ||
      (run.valid && sample.tileZ <= run.zoom) || run.end - run.start > 16384) return false;
  const delta = sample.elev - run.ground;
  run.initialGround ??= run.ground;
  run.zoom = sample.tileZ;
  run.valid = true;
  if (Math.abs(delta) < 0.02) return false;
  const geometry = chunk.mesh.geometry, position = geometry.attributes.position;
  for (let i = run.start; i < run.end; i++) position.array[i * 3 + 1] += delta;
  position.addUpdateRange(run.start * 3, (run.end - run.start) * 3);
  position.needsUpdate = true;
  chunk.columns.data[run.column * 4 + 2] += delta;
  if (chunk.house && run.house >= 0) chunk.house[run.house * 3 + 1] += delta;
  // Retain conservative bounds without a whole-chunk vertex walk. Use the
  // maximum displacement from ORIGINAL ground, never sum hundreds of repairs.
  chunk.contactBounds ??= { radius: geometry.boundingSphere?.radius,
    minY: geometry.boundingBox?.min.y, maxY: geometry.boundingBox?.max.y, down: 0, up: 0 };
  const bounds = chunk.contactBounds, displacement = sample.elev - run.initialGround;
  bounds.down = Math.min(bounds.down, displacement);
  bounds.up = Math.max(bounds.up, displacement);
  if (geometry.boundingSphere) geometry.boundingSphere.radius = bounds.radius + Math.max(-bounds.down, bounds.up);
  if (geometry.boundingBox) {
    geometry.boundingBox.min.y = bounds.minY + bounds.down;
    geometry.boundingBox.max.y = bounds.maxY + bounds.up;
  }
  padArchitectureRegionHeights(geometry,bounds.down,bounds.up);
  run.ground = sample.elev;
  return true;
}

// --- WORLD PASS B (ARRIVAL) helpers -------------------------------------------

/** Add a run's ground to its vertices' Y (one small hot loop, so the JIT optimizes it). */
function keepBoundingBox() {}
function addRunY(pos, v0, v1, g) {
  for (let i = v0 * 3 + 1, e = v1 * 3; i < e; i += 3) pos[i] += g;
}
/** r2 (quantize): the same on the Int16 lattice (stride 4). */
function addRunYQ(pos, v0, v1, g) {
  for (let i = v0 * 4 + 1, e = v1 * 4; i < e; i += 4) pos[i] += g;
}

/**
 * r2 (quantize): a run's ground as integer lattice steps above the mesh origin
 * (`q.oy`, metres), clamped so the run's local extent stays inside Int16.
 * A clamp (ground more than ~1 km from the tile's median) is counted.
 */
function quantGround(elev, q, run) {
  let g = Math.round((elev - q.oy) * WPQ_POS_K);
  const lo = -32767 - run.qMin, hi = 32767 - run.qMax;
  if (g < lo || g > hi) { g = Math.max(lo, Math.min(hi, g)); q.clamped = (q.clamped ?? 0) + 1; }
  return g;
}

/** Bytes a building bundle uploads on its first render (attributes + index). */
function bundleBytes(bld) {
  let b = 0;
  for (const k of ['pos', 'col', 'anchor', 'uv', 'idx', 'normal', 'style']) b += bld[k]?.byteLength ?? 0;
  return b;
}

/**
 * A tile's buildings as RUNS: one per building, the consecutive vertex span
 * that carries one footprint-centroid anchor (the worker's emission contract).
 * From the worker's prep when present (workerPrep), else one pass over the
 * anchor array. start has a trailing sentinel: run r owns [start[r], start[r+1]).
 */
function buildingRuns(bld) {
  const prep = bld.prep;
  if (prep?.runStart && prep.runAnchor) {
    const n = prep.runStart.length - 1, ax = new Float32Array(n), az = new Float32Array(n);
    for (let r = 0; r < n; r++) { ax[r] = prep.runAnchor[r * 2]; az[r] = prep.runAnchor[r * 2 + 1]; }
    return { count: n, start: prep.runStart, ax, az };
  }
  const anchor = bld.anchor, nV = anchor.length / 2, starts = [], axs = [], azs = [];
  let lx = NaN, lz = NaN;
  for (let v = 0; v < nV; v++) {
    const x = anchor[v * 2], z = anchor[v * 2 + 1];
    if (x !== lx || z !== lz) { starts.push(v); axs.push(x); azs.push(z); lx = x; lz = z; }
  }
  starts.push(nV);
  return { count: axs.length, start: Uint32Array.from(starts), ax: Float32Array.from(axs), az: Float32Array.from(azs) };
}

/**
 * WORLD PASS B (drapeCap): re-seat one building run in place on a finer (or,
 * for a provisional run, any honest) sample of the DRAWN terrain. The shipped
 * repairCinematicBuildingDrape accepts only finer zooms and counts z12 as
 * settled; here a run committed provisionally (no sample of its own, or a
 * mesh coarser than `honestZ`) keeps re-seating until it stands on an honest
 * mesh. Same buffer patch, column, porch light and bounds bookkeeping.
 */
function repairArrivalRun(chunk, run, sample, honestZ) {
  if (!sample || !Number.isFinite(sample.elev) || sample.tileZ < 10 || run.end - run.start > 16384) return false;
  if (!(sample.tileZ > run.zoom || (run.fb && sample.tileZ >= run.zoom))) return false;
  const wasSettled = run.valid;
  run.zoom = sample.tileZ;
  run.valid = sample.tileZ >= honestZ;
  run.fb = false;
  if (!wasSettled && run.valid) chunk.unsettled = Math.max(0, (chunk.unsettled ?? 1) - 1);
  const delta = sample.elev - run.ground;
  run.initialGround ??= run.ground;
  if (Math.abs(delta) < 0.02) return false;
  const geometry = chunk.mesh.geometry, position = geometry.attributes.position, arr = position.array;
  const foot = run.footDelta ?? 0; // M4 footings: bottom vertices sit footDelta below the run's ground
  if (chunk.q) {
    // r2 (quantize): integer lattice steps. The run's drawn ground is gq / 16 m
    // above the mesh origin (the tile's median ground), recomputed from the
    // sample each time, so repeated repairs never accumulate rounding.
    const gq = quantGround(sample.elev, chunk.q, run);
    const d = gq - run.gq;
    for (let i = run.start * 4 + 1, e = run.end * 4; i < e; i += 4) arr[i] += d;
    run.gq = gq;
    position.addUpdateRange(run.start * 4, (run.end - run.start) * 4);
  } else {
    for (let i = run.start; i < run.end; i++) arr[i * 3 + 1] += delta;
    position.addUpdateRange(run.start * 3, (run.end - run.start) * 3);
  }
  position.needsUpdate = true;
  chunk.columns.data[run.column * 4 + 2] += delta;
  if (chunk.house && run.house >= 0) chunk.house[run.house * 3 + 1] += delta;
  chunk.contactBounds ??= { radius: geometry.boundingSphere?.radius,
    minY: geometry.boundingBox?.min.y, maxY: geometry.boundingBox?.max.y, down: 0, up: 0 };
  const bounds = chunk.contactBounds, displacement = sample.elev - run.initialGround;
  bounds.down = Math.min(bounds.down, displacement - foot);
  bounds.up = Math.max(bounds.up, displacement);
  if (geometry.boundingSphere) geometry.boundingSphere.radius = bounds.radius + Math.max(-bounds.down, bounds.up);
  if (geometry.boundingBox) {
    geometry.boundingBox.min.y = bounds.minY + bounds.down;
    geometry.boundingBox.max.y = bounds.maxY + bounds.up;
  }
  padArchitectureRegionHeights(geometry, bounds.down, bounds.up);
  run.ground = sample.elev;
  return true;
}

/**
 * Round 13 Phase 3 — the SATELLITE 3D-building chunk manager. A lean, single-
 * ring (z14-class) streamer around the player, PURPOSE-BUILT (NOT ToyWorldEngine
 * — that class is what ToyWorldLayer exposes as window.__toyWorld, which
 * verify-round11 gate A asserts stays undefined in satellite). This class never
 * touches that global; SatBuildingLayer exposes it as window.__satBuildings.
 *
 * Each streamed z14 tile → one worker 'sat-buildings' build → one MERGED mesh
 * (one draw), draped on RAW DEM (no toy ×1.7 exaggeration — the LandmarkMonuments
 * R11 pattern). Buildings extrude from -baseSinkM (tucked under ground so slope/
 * hill gaps hide) to their real height; the whole box drops rigidly via the
 * anchor-bend variant (world-bend applyBendAnchorSat). Streaming is altitude-
 * gated with hysteresis: below cullAglOnM the ring is live, above cullAglOffM
 * every chunk evicts (buildings are invisible from cruise). maxChunks hard-bounds
 * the building draw count regardless of city density.
 */
export class SatBuildingEngine {
  constructor({ groundAt }) {
    this.visuals = satelliteVisualsOn('architecture');
    this.object = new Group();
    this.object.name = 'sat-buildings';
    this.groundAt = groundAt; // (lonDeg, latDeg) => {elev, tileZ} | null
    this.worker = null;

    // ONE material shared by every chunk (vertex colors carry the neutral tone
    // variation). DoubleSide so three flips back-face normals via gl_FrontFacing
    // — every wall shades correctly despite the worker's inconsistent ring
    // winding. Lit by the scene day sun + hemi + env (the monument-satellite
    // model: daylight stone, not glow) — a single directional, no double-sun.
    this.material = this.visuals ? createSatelliteArchitectureMaterial({ lighting: satelliteVisualsOn('lighting') }) : new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    if (!this.visuals && LAMBERT_ENV.enabled) this.material.reflectivity = LAMBERT_ENV.reflectivity;
    // Round 23 (B CITY-LIGHT): the second argument is NIGHT_CITY_R23.windows,
    // and ONLY when the block is armed (the SUBURB_NIGHT-passed-in precedent —
    // world-bend imports nothing). null = the shipped state ⇒ the R19 program
    // verbatim under the R19 key. Resolved once: it selects the shader source.
    if (!this.visuals) applyBendAnchorSat(
      this.material,
      nightCityOn('windows') ? NIGHT_CITY_R23.windows : null
    ); // rigid per-building anchor bend (+ R23 per-building window variance)
    // The atlas cell grid the de-repeat phase quantises to. It MUST be the
    // painting's own (cols, rows) or the whole-cell offset stops landing on a
    // cell boundary and roofs start sampling lit panes (the R15 invariant).
    if (nightCityOn('windows')) {
      setNightCityWindows(NIGHT_CITY_R23.windows, {
        cols: SAT_BUILDINGS.facade.cols,
        rows: SAT_BUILDINGS.facade.rows,
        neutralUV: SAT_BUILDINGS.facade.neutralUV,
      });
    }

    // --- R24 B (CHUNK_FADE) -------------------------------------------------
    // A chunk that is being born or evicted wears a TWIN of the material above
    // carrying its OWN uSatBldgFade uniform, because three only re-uploads a
    // material's uniforms when the MATERIAL changes between draws — a shared
    // uniform cannot express a per-mesh ramp. Same constructor parameters,
    // same map/emissiveMap state, same customProgramCacheKey ⇒ three's program
    // cache hands back the SAME program and just refcounts it. Twins are
    // POOLED and returned the frame a ramp completes, so steady state is ONE
    // shared material per engine exactly as today.
    this._fadePool = new TwinPool(
      () => {
        const uniform = { value: 1 };
        const material = this.visuals
          ? createSatelliteArchitectureMaterial({ lighting: satelliteVisualsOn('lighting'), fadeUniform: uniform })
          : new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
        if (!this.visuals) applyBendAnchorSat(material, nightCityOn('windows') ? NIGHT_CITY_R23.windows : null, uniform);
        if (this._q) patchQuantMaterial(material); // WORLD PASS B r2 (quantize)
        return { material, uniform };
      },
      (m) => this._syncTwin(m)
    );
    this._fadeFrame = 0; // R24 B (W3): the frame-count floor's clock
    this._births = []; // [{ mesh, tw, t0 }] fading IN, already counted as ready
    this._dying = []; // [{ mesh, tw, t0 }] out of this.chunks, still drawing
    this._altFade = 1; // the shared altitude fade this frame (SAT_BLDG_FADE)
    // SHIP PASS CITY (CT-1, CT-2): the band this ring obeys. `_cityRange` is
    // cityRangeFor(tier), pushed by SatBuildingLayer on tier changes (null =
    // flag off or refused); the band itself is resolved every frame so a
    // diagnosis pin set mid-session takes effect at once. With no pin and no
    // range it is exactly SAT_BLDG_FADE / SAT_BUILDINGS (city-range.js).
    this._cityRange = null;
    this._band = buildingBand(null);
    this._bandMemo = makeBandMemo(); // no allocation per frame
    this._lite = false; // CT-2 lite LOD armed (body range only, detail eased out)
    this._detailBase = null; // the tier's uArchitectureDetail (setArchitectureDetail)
    this.onBand = null; // (evictM) => void: SatBuildingLayer mirrors it to runtime.satBuildingsBandM
    this._bandPublished = NaN;
    this._hardEvict = false; // dispose()/warp: no deferred fade-outs
    // R24 B (HEAL_IN_PLACE) — in-flight re-drapes: [{key, chunk, gen, i, gy,
    // minZ, moved}]. Sampling is budgeted exactly like the first drape; the
    // buffer patch + ranged upload happens once, at the end.
    this._redrape = [];

    // Round 15 facade windows: the SAME material gains `map` (daylight glazing,
    // tier ≥ medium) and `emissiveMap` (lit windows, tier high) — one merged
    // mesh, one material, one draw per chunk, unchanged. Both are lazy: no
    // canvas, no upload, no shader permutation while their tier gate is off.
    // Flipping either one is a single program compile (the USE_MAP /
    // USE_EMISSIVEMAP defines), which is why they are armed on tier changes
    // (rare) and never per frame.
    this._facadeTex = null;
    this._nightTex = null;
    this.facadeEnabled = false;
    this.nightEnabled = false;

    // Round 13 (P4) water glint: lazily created (only when high tier arms it —
    // no texture load / GPU program while off). One shared additive MeshPhong
    // material for every water chunk; the scene day sun drives the specular
    // glint, the animated normal map ripples it. Per-vertex bend (flat water
    // follows the curved ground like the tiles). See SAT_WATER.
    this.waterMaterial = null;
    this._waterTex = null;
    this.waterEnabled = false;

    this.chunks = new Map(); // key "z/x/y" -> chunk record
    this.queue = [];
    this.building = 0;
    this.pendingFinalize = [];
    this._lastRefreshPos = { x: Infinity, z: Infinity };
    this._lastRefreshT = 0;
    this._lastOceanT = 0; // round 18: neighbour-gated ocean-fill cadence
    this._ringOn = false; // altitude hysteresis (armed = buildings streaming)
    this._warpCoarseUntil = 0;
    this._disposed = false;
    // Round 19 (A HOMESTEAD): {ringM, maxChunks} pushed by SatBuildingLayer
    // from SAT_COVERAGE at high tier; null = the R18 SAT_BUILDINGS values.
    this._coverage = null;
    // Round 19: chunk keys allowed to carry a water-glint mesh — the NEAREST
    // SAT_WATER.maxWaterChunks of the desired set. Empty until the first
    // refresh; the ring never finalizes a chunk before then.
    this._waterKeys = new Set();
    // Round 19: per-tile-key count of DEM-refinement re-drapes, kept OUTSIDE
    // the chunk record because a heal evicts the record itself. Pruned when a
    // key leaves the ring.
    this._reheals = new Map();
    // Round 19: SAT_SHADOWS mesh flags. B DEEPFIELD owns the light rig — this
    // side only marks the chunk meshes as casters/receivers. With no shadow-
    // casting light in the scene the flags are inert, so ordering between the
    // two merges is safe in both directions.
    this._shadows = false;
    // --- Round 21 (B STREAMKEEPER) ------------------------------------------
    this._now = 0; // frame clock, readable from async build callbacks
    this._reqId = 0; // build generation (kills the evict-then-requeue race)
    // P6: per-key heal bookkeeping {attempts, lastBadFrac, perm}. Kept OUTSIDE
    // the chunk record for the same reason `_reheals` is — a heal evicts the
    // record it is trying to improve. Supersedes `_reheals` while the flag is
    // on (that map still drives the R19 path with the flag off).
    this._heal = new Map();
    // R24 B: degenerateDropped is additive telemetry (0 with FLASH_GUARD off).
    this._stat = { errorRetries: 0, evictions: 0, heals: 0, degenerateDropped: 0, healsInPlace: 0, healsNoop: 0, healsQueueFull: 0, healsAborted: 0, healsNoRecord: 0, healsCoalesced: 0, redrapeRuns: 0, fadeBudgetMiss: 0, contactHeals: 0, degenDropped: 0, degenScanned: 0, degenChunks: 0, arrivalRetries: 0, arrivalProvisional: 0, arrivalReseats: 0, footings: 0, footGaps: 0, footMaxDelta: 0, buildTimeouts: 0, workerChecks: 0, workersReplaced: 0 };
    // WORLD PASS W0 — arrival counters (diagnostic only; nothing reads them
    // back). armAt: the last ring arm or warp (engine clock, s); desiredAt:
    // the first desired set computed after it; _wpKeep: that set's keys.
    this._wp = { armAt: NaN, desiredAt: NaN, firstTileSec: null, fullRingSec: null, nonFiniteRestarts: 0, finalizeMsMax: 0, finalizeMsLast: 0 };
    this._wpKeep = null;
    this._wpCount = false; // WORLD PASS W0: publish the counters on stats? (setWorker, worldPassCounters)
    this._arr = ARRIVAL_OFF; // WORLD PASS B: latched in setWorker
    this._viewX = 0; // WORLD PASS B (readiness): the camera's forward, world XZ
    this._viewZ = -1;
    this._pool = null; // WORLD PASS B: [{ api, n }] building workers (one without the flag)
    this._rank = null; // WORLD PASS B: tile key -> rank in the desired set
    this._backfillArmed = false; // S4: in-place water backfill scan is live
    this._waterBuilding = 0;
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
    if (dt <= 1e-4 || dt > 0.5) return;
    if (dx * dx + dz * dz > L.teleportM * L.teleportM) {
      this._vx = 0;
      this._vz = 0;
      this._leadHoldUntil = nowSec + L.warpHoldSec;
      return;
    }
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
    // R24 (B): …capped in ABSOLUTE metres by LEAD_SAFE. Flag off, `leadCapM`
    // returns `L.maxLeadFrac * ringR` and this line is the R21 one verbatim.
    // WORLD PASS B (readiness): lead by where the aircraft will be when a tile
    // requested now can be on screen (build + drape + finalize), bounded inside
    // the ring so the tiles under the aircraft stay in it. Off: R21/R24 verbatim.
    const A = this._arr;
    const lead = A.readiness
      ? Math.min(sp * A.cfg.leadSec, A.cfg.leadFrac * ringR)
      : Math.min(sp * L.leadSec, leadCapM('satBuildings', ringR));
    return [px + (this._vx / sp) * lead, pz + (this._vz / sp) * lead];
  }

  /** R21 (P2) — re-admit an 'empty'/'error' record once its TTL/backoff is up. */
  _readmit(chunk, nowSec) {
    if (!STREAM_KEEPER.enabled || !STREAM_KEEPER.retry.enabled) return false;
    if (chunk.state === 'empty') return nowSec >= (chunk.retryAt ?? Infinity);
    if (chunk.state === 'error') return nowSec >= (chunk.nextTryAt ?? Infinity);
    return false;
  }

  /** WORLD PASS B (readiness): the camera heading (flight.heading convention). */
  setView(headingRad) {
    if (!Number.isFinite(headingRad)) return;
    this._viewX = Math.sin(headingRad);
    this._viewZ = -Math.cos(headingRad);
  }

  /**
   * Round 19 — tier-resolved ring coverage (SatBuildingLayer decides; the
   * engine only applies). Passing null restores the R18 constants. Forces the
   * next update to re-run the desired-set computation so a tier change takes
   * effect immediately rather than at the next refreshMoveM/refreshSec.
   */
  setCoverage(c) {
    const a = this._coverage;
    if ((a?.ringM ?? 0) === (c?.ringM ?? 0) && (a?.maxChunks ?? 0) === (c?.maxChunks ?? 0)) return;
    this._coverage = c ?? null;
    this._lastRefreshT = 0;
    this._lastRefreshPos = { x: Infinity, z: Infinity };
  }

  /**
   * SHIP PASS CITY (CT-2): cityRangeFor(tier) from SatBuildingLayer (null =
   * CITY_RANGE off, or the policy refuses this device / tier). The next frame
   * resolves the band from it; a band change re-plans the ring at once.
   */
  setCityRange(range) {
    const a = this._cityRange;
    if ((a?.detailed ?? null) === (range?.detailed ?? null) && a?.block === range?.block) return;
    this._cityRange = range ?? null;
    this._lastRefreshT = 0;
    // CT-3: one colour draw per visible chunk where CITY_RANGE runs without
    // the long detailed band (Medium, touch); off everywhere else.
    setArchitectureMergeColor(!!range && !range.detailed);
  }

  /**
   * SHIP PASS CITY (CT-2): the tier's surface-detail term (SatBuildingLayer
   * passes the profile's normalMaps, exactly what it handed
   * setSatelliteArchitectureDetail before). The lite LOD eases it out at
   * altitude; with the lite LOD never armed this is that call, unchanged.
   */
  setArchitectureDetail(enabled) {
    this._detailBase = !!enabled;
    setSatelliteArchitectureDetail(this.material, this._lite ? false : this._detailBase);
  }

  /** CT-1 / CT-2: SatBuildingLayer's runtime.satBuildingsBandM mirror (null detaches). */
  setBandListener(fn) {
    this.onBand = fn ?? null;
    this._bandPublished = NaN; // republish to the new listener on the next frame
  }

  /** CT-1 / CT-2: re-resolve the band; publish eviction height changes. */
  _resolveBand() {
    const band = this._bandMemo(this._cityRange);
    const prev = this._band;
    this._band = band;
    if (band.source === 'diag') noteCityDiagApplied();
    if (band.evictM !== prev.evictM || band.armOnM !== prev.armOnM) this._lastRefreshT = 0; // re-plan now
    // Published on the first frame too: a pin set before boot is already in
    // the constructor's band, and the layer's mount wrote the shipped height.
    if (band.evictM !== this._bandPublished && this.onBand) {
      this._bandPublished = band.evictM;
      this.onBand(band.evictM);
    }
  }

  /**
   * CT-2 lite LOD: past band.liteStartM (CITY_RANGE on a desktop High/Ultra
   * band only; Infinity otherwise, so this never arms with the flag off) the
   * ring draws its BODY range only (architecture-draw-range.js: walls and
   * roof caps, the worker's ledge / plant tail retired) and the tier's
   * surface-detail term is switched out. 100 m of hysteresis below the start
   * so a hover at the boundary cannot chatter. Same programs, same draws.
   */
  _applyLite(eyeAglM) {
    const start = this._band.liteStartM;
    const on = start < Infinity && (this._lite ? eyeAglM > start - 100 : eyeAglM > start);
    if (on === this._lite) return;
    this._lite = on;
    setArchitectureLite(on);
    if (this.visuals && this._detailBase !== null) setSatelliteArchitectureDetail(this.material, on ? false : this._detailBase);
  }

  /**
   * Round 19 — the two SAT_SHADOWS mesh flags for this layer's own meshes
   * (the plan's per-layer rule). Applied to chunks already uploaded AND
   * remembered for chunks finalized later.
   */
  setShadows(v) {
    if (v === this._shadows || this._disposed) return;
    this._shadows = v;
    for (const c of this.chunks.values()) {
      if (!c.mesh) continue;
      c.mesh.castShadow = v;
      c.mesh.receiveShadow = v;
    }
  }

  /**
   * Tier gate for DAYLIGHT facade windows (SatBuildingLayer flips it). Unlike
   * water, nothing re-streams: the uv attribute is always in the geometry, so
   * arming/disarming is a material swap the already-uploaded chunks pick up.
   */
  setFacadeEnabled(v) {
    if (this.visuals) { this.facadeEnabled = true; return; }
    if (v === this.facadeEnabled || this._disposed) return;
    this.facadeEnabled = v;
    if (v && !this._facadeTex) this._facadeTex = getFacadeAtlas(false);
    this._flushFades(); // R24 B: a twin's program key follows USE_MAP
    this.material.map = v ? this._facadeTex : null;
    this.material.needsUpdate = true; // USE_MAP flips → one program compile
  }

  /**
   * Strict high-tier gate for NIGHT windows. Arms the emissiveMap + tint once;
   * the per-frame sun ramp then lives entirely in emissiveIntensity (a uniform
   * write — no recompile, and 0 by day so noon is visually untouched).
   */
  setNightWindowsEnabled(v) {
    if (this.visuals) { this.nightEnabled = true; return; }
    if (v === this.nightEnabled || this._disposed) return;
    this.nightEnabled = v;
    if (v && !this._nightTex) this._nightTex = getFacadeAtlas(true);
    this._flushFades(); // R24 B: a twin's program key follows USE_EMISSIVEMAP
    this.material.emissive = new Color(v ? SAT_BUILDINGS.night.color : 0x000000);
    this.material.emissiveIntensity = 0;
    this.material.emissiveMap = v ? this._nightTex : null;
    this.material.needsUpdate = true; // USE_EMISSIVEMAP flips → one program compile
  }

  /**
   * Per-frame (cheap): satellite's R13 day cycle publishes runtime.sun.frac
   * (1 = noon, 0 = night) on a 60s cadence — windows come up as it falls past
   * night.dayFrac. gamma > 1 holds them dark through late afternoon so the
   * city lights arrive at dusk, not at 4pm.
   */
  setNightMix(sunFrac) {
    this._updateWaterSurfaces();
    if (this.visuals) {
      setSatelliteArchitectureNight(this.material, sunFrac);
      if (this.waterMaterial) {
        if (performance.now() >= (this._cityRefreshAt ?? 0)) {
          this._cityRefreshAt = performance.now() + 500;
          const cities = [];
          for (const c of this.chunks.values()) for (const p of c.meta?.cityClusters ?? []) {
            cities.push({ ...p, x: p.x + c.cx, z: p.z + c.cz });
          }
          cities.sort((a,b) => b.intensity-a.intensity);
          this._waterCities = cities.slice(0,4);
        }
        setSatelliteWaterClusters(this.waterMaterial, this._waterCities, true);
      }
      return;
    }
    if (!this.nightEnabled || this._disposed) return;
    const N = SAT_BUILDINGS.night;
    const t = Math.min(1, Math.max(0, 1 - (sunFrac ?? 1) / N.dayFrac));
    const e = N.intensity * t ** N.gamma;
    if (Math.abs(e - this.material.emissiveIntensity) > 1e-4) this.material.emissiveIntensity = e;
  }

  /** Lazily build the shared additive water-glint material (+ normal texture). */
  _ensureWaterMaterial() {
    if (this.waterMaterial) return this.waterMaterial;
    if (satelliteVisualsOn('water')) return (this.waterMaterial = createSatelliteWaterMaterial());
    const tex = new TextureLoader().load(SAT_WATER.normalMap);
    tex.wrapS = tex.wrapT = RepeatWrapping;
    const m = new MeshPhongMaterial({
      color: 0x000000, // additive: near-black diffuse adds nothing → specular-only
      specular: new Color(SAT_WATER.specular),
      shininess: SAT_WATER.shininess,
      normalMap: tex,
      normalScale: new Vector2(SAT_WATER.normalScale, SAT_WATER.normalScale),
      transparent: true,
      opacity: SAT_WATER.opacity,
      blending: AdditiveBlending,
      depthWrite: false,
      // R24 C (SHADOW_CALM / recon T11): same reason as the road ribbons — a
      // draped additive with no depth offset loses the test against a refined
      // tile mesh on any slope. Null (spread of nothing) with the flag off.
      ...(groundOverlayOffset(-1, -1) ?? {}),
    });
    applyBendWaterSat(m);
    // R24 B (W3) — NO FADE CHANNEL, DECLARED (see the road engine's note). The
    // water glint is one shared additive material across every chunk, so a
    // per-mesh ramp needs a per-mesh material, and this sheet was never in
    // CHUNK_FADE's scope. Declared so a presence probe attributes it instead of
    // scoring an unexplained hard birth. NOTE for a probe: opacity is 0.9, so
    // E's transparent+opacity fallback already reads water as PARTIAL forever —
    // it is the ROADS (transparent with opacity 1) that read as hard.
    m.userData.__noFade = 'sat-water: one shared additive material; not in CHUNK_FADE scope';
    this.waterMaterial = m;
    this._waterTex = tex;
    return m;
  }

  /**
   * Strict high-tier gate for water glint (SatBuildingLayer flips it). Turning
   * OFF evicts every water mesh immediately; turning ON re-streams the ring so
   * already-ready chunks pick up water (tier changes are rare — a brief hitch).
   */
  setWaterEnabled(v) {
    if (v === this.waterEnabled || this._disposed) return;
    this.waterEnabled = v;
    if (!v) {
      for (const chunk of this.chunks.values()) {
        this._evictWater(chunk);
        chunk.waterAsked = false;
      }
      this._backfillArmed = false;
      return;
    }
    // ROUND 21 (S4) — WATER ARRIVES IN PLACE. The R13 path below re-streams the
    // WHOLE CITY to add a flourish: every chunk evicted, every merged building
    // mesh disposed, the queue cleared, ~12 tiles refetched, re-draped and
    // re-uploaded. A tier step (which is what flips this) therefore deleted and
    // rebuilt the world the player was looking at — a headline contributor to
    // the "everything flashes" report, and it fires again on every step back up.
    // The buildings do not change when water arrives, so nothing about them
    // needs to move: re-request the tile, take ONLY its satWater, and attach it
    // to the chunk that is already standing there. Turning water OFF stays the
    // cheap water-mesh-only evict it always was.
    if (STREAM_KEEPER.enabled && STREAM_KEEPER.waterInPlace) {
      this._backfillArmed = true;
      return;
    }
    for (const [key, chunk] of [...this.chunks]) this._evict(key, chunk);
    this.queue.length = 0;
    this.pendingFinalize.length = 0;
    this._lastRefreshPos = { x: Infinity, z: Infinity };
  }

  /**
   * R21 (S4) — pump the in-place water backfill. Bounded by its own small
   * concurrency budget so it can never starve the ordinary chunk queue, and
   * every attachment re-checks that the chunk is still the READY one it was
   * queued for (a tile can evict while its water request is in flight).
   */
  _pumpWaterBackfill() {
    if (!this._backfillArmed || !this.waterEnabled) return;
    const cap = STREAM_KEEPER.waterBackfillBuilds;
    // Scanned from the LIVE water set rather than drained from a snapshot taken
    // at flip time: `_waterKeys` is the nearest-N bound and it moves with the
    // player, so a one-shot list would strand any chunk that entered the set
    // afterwards. `waterAsked` is what makes the scan terminate — each chunk is
    // asked exactly once (a tile with no water legitimately answers nothing).
    for (const key of this._waterKeys) {
      if (this._waterBuilding >= cap) return;
      const chunk = this.chunks.get(key);
      // Only READY chunks that do not have water yet. A chunk still building
      // picks water up in its own finalize (waterEnabled is already true).
      if (!chunk || chunk.state !== 'ready' || chunk.water || chunk.waterAsked) continue;
      const t = chunk.tile;
      if (!t) continue;
      chunk.waterAsked = true;
      this._waterBuilding += 1;
      this.worker
        .buildTile(t.z, t.x, t.y, 'sat-buildings', { visuals: this.visuals, ...trueAreasRequest(), ...premiumWorldRequest(), worldPass: worldPassRequest() })
        .then((result) => {
          this._waterBuilding -= 1;
          const live = this.chunks.get(key);
          if (
            this._disposed ||
            !live ||
            live !== chunk ||
            live.state !== 'ready' ||
            live.water ||
            !this.waterEnabled ||
            !this._waterKeys.has(key) ||
            !result ||
            result.v !== EXPECTED_WORKER_PROTOCOL ||
            !worldPassMatch(result) ||
            !result.satWater
          )
            return;
          this._attachWater(live, result.satWater);
        })
        .catch((err) => {
          this._waterBuilding -= 1;
          if (process.env.NODE_ENV === 'development')
            console.warn(`[sat-buildings] water backfill ${key} failed:`, err?.message ?? err);
        });
    }
  }

  /**
   * R21 (S4) — build + attach ONE water-glint mesh onto an existing chunk.
   * Byte-for-byte the geometry the finalize path builds (same drape sample,
   * same lift, same renderOrder), extracted so both callers stay in step.
   */
  _attachWater(chunk, water) {
    const cx = chunk.cx;
    const cz = chunk.cz;
    const lon = (cx / EARTH_R) * RAD2DEG;
    const lat = (2 * Math.atan(Math.exp(-cz / EARTH_R)) - Math.PI / 2) * RAD2DEG;
    const g = this.groundAt(lon, lat);
    const waterY = (g?.elev ?? 0) + SAT_WATER.liftM;
    let wgeo = new BufferGeometry();
    wgeo.setAttribute('position', new BufferAttribute(water.pos, 3));
    wgeo.setAttribute('uv', new BufferAttribute(water.uv, 2));
    const waterIndices = satelliteVisualsOn('water') ? dropDegenerateTris(water.idx, water.pos).idx : water.idx;
    wgeo.setIndex(new BufferAttribute(waterIndices, 1));
    if (satelliteVisualsOn('water')) {
      const span = WORLD_SIZE / 2 ** chunk.tile.z;
      const old = wgeo;
      wgeo = addSatelliteWaterShore(wgeo, { tileBounds: [-span/2,-span/2,span/2,span/2] });
      if (old !== wgeo) old.dispose();
    }
    wgeo.computeVertexNormals();
    wgeo.computeBoundingSphere();
    // R21 SANCTIONED INSTRUMENT (E CERT) — the margin this mesh actually got,
    // stamped on the mesh. verify-stability's false-cull census asserts
    // `dropAtCentre <= bendMarginM` per culled mesh; without the per-mesh value
    // it can only count disagreements, which cannot reach zero by construction
    // (it models the bend as a translation while the fix grows the radius).
    // userData only — no behaviour, no draw, no bundle change.
    const wpad = this._bendPad(chunk.tile?.z);
    if (wgeo.boundingSphere) wgeo.boundingSphere.radius += wpad;
    const wmesh = new Mesh(wgeo, this._ensureWaterMaterial());
    wmesh.userData.bendMarginM = wpad;
    wmesh.position.set(cx, waterY, cz);
    wmesh.frustumCulled = true;
    // Three r185 reverses the entire sorted list under reverse-Z, including
    // renderOrder. +3 renders BEFORE transparent terrain(order 0), which then
    // overwrites depthWrite=false water. Negative order puts cinematic water
    // after the photographic surface. Keep the legacy path unchanged.
    wmesh.renderOrder = satelliteVisualsOn('water') ? -3 : 3;
    this.object.add(wmesh);
    chunk.water = wmesh;
    chunk.waterY = waterY;
    if (satelliteVisualsOn('water')) this._prepareWaterSurface(chunk);
  }

  _prepareWaterSurface(chunk) {
    const geo = chunk.water.geometry, p = geo.getAttribute('position'), idx = geo.index;
    const count = idx ? idx.count : p.count, largest = [];
    const v = i => idx ? idx.getX(i) : i;
    // Eight bounded interior samples avoid the tile centre, which can be land.
    for (let i=0;i+2<count;i+=3) {
      const a=v(i),b=v(i+1),c=v(i+2);
      const area=Math.abs((p.getX(b)-p.getX(a))*(p.getZ(c)-p.getZ(a))-(p.getZ(b)-p.getZ(a))*(p.getX(c)-p.getX(a)));
      if (area<=1e-6 || (largest.length===8 && area<=largest[7].area)) continue;
      largest.push({area,x:(p.getX(a)+p.getX(b)+p.getX(c))/3,z:(p.getZ(a)+p.getZ(b)+p.getZ(c))/3});
      largest.sort((a,b)=>b.area-a.area);largest.length=Math.min(8,largest.length);
    }
    chunk.waterSamples=largest;
    chunk.waterResolved=false;chunk.water.visible=false;
    this._waterSurfaceAt=0;
  }

  _updateWaterSurfaces() {
    if (!satelliteVisualsOn('water') || performance.now() < (this._waterSurfaceAt ?? 0)) return;
    this._waterSurfaceAt=performance.now()+500;
    for (const chunk of this.chunks.values()) {
      if (!chunk.water || !chunk.waterSamples?.length) continue;
      const levels=[];
      for (const p of chunk.waterSamples) {
        const lon=(chunk.cx+p.x)/EARTH_R*RAD2DEG;
        const lat=(2*Math.atan(Math.exp(-(chunk.cz+p.z)/EARTH_R))-Math.PI/2)*RAD2DEG;
        const g=this.groundAt(lon,lat);
        if (g && g.tileZ>=SAT_BUILDINGS.demZ && Number.isFinite(g.elev)) levels.push(g.elev);
      }
      // Retain resolved water through temporary coarse DEM reads, like buildings.
      if (levels.length<Math.ceil(chunk.waterSamples.length/2)) continue;
      levels.sort((a,b)=>a-b);
      const target=levels[Math.floor(levels.length/2)]+Math.max(0.5,SAT_WATER.liftM);
      chunk.waterY=chunk.waterResolved ? chunk.waterY+(target-chunk.waterY)*0.35 : target;
      chunk.water.position.y=chunk.waterY;
      chunk.waterResolved=true;chunk.water.visible=true;
    }
  }

  // --- R24 B (HEAL_IN_PLACE) — re-drape the resident buffer, never refetch ---

  /** Start an in-place re-drape. Returns false when the caller must fall back
   *  to the R21 evict+refetch (flag off, no drape record, no mesh, already
   *  queued, or the queue is full). */
  _queueRedrape(key, chunk) {
    if (!HEAL_IN_PLACE.enabled) return false;
    if (!chunk.redrape || !chunk.mesh) {
      // No drape record (a water-only chunk, or one finalized with the flag
      // off) ⇒ there is nothing to patch. Counted so the outcome ledger below
      // stays exhaustive.
      this._stat.healsNoRecord += 1;
      return false;
    }
    if (this._redrape.length >= HEAL_IN_PLACE.maxConcurrent) {
      // Budget spent ⇒ this heal degrades to the R21 evict+refetch. COUNTED,
      // for the same reason fadeBudgetMiss is: a hole that survives the feature
      // must be ATTRIBUTABLE, and "heals - inPlace - noop <= queueFull" is the
      // assertion that says so.
      this._stat.healsQueueFull += 1;
      return false;
    }
    if (this._redrape.some((j) => j.key === key)) {
      // A re-drape for this key is already in flight: the second request is a
      // no-op, and the job already queued will do the work. Counted, because
      // otherwise N requests for one key produce ONE healsInPlace and the
      // outcome ledger stops balancing.
      this._stat.healsCoalesced += 1;
      return true;
    }
    const n = chunk.redrape.gy.length;
    this._redrape.push({
      key,
      chunk,
      i: 0,
      gy: new Float32Array(n), // the NEW ground, filled across frames
      minZ: 99,
      nulls: 0,
    });
    return true;
  }

  /** Budgeted DEM re-sampling, one getGroundAt per BUILDING — the same shape and
   *  the same budget as the first drape, so a heal can never cost more than the
   *  arrival it replaces. */
  _pumpRedrape() {
    if (this._redrape.length === 0) return;
    markPhase('heal:sat-building'); // R24 B (E CERT stall attribution)
    const t0 = performance.now();
    let done = 0; // R24 B (W3): anchor runs sampled this frame, for the floor
    const span0 = WORLD_SIZE / 2;
    for (let k = this._redrape.length - 1; k >= 0; k--) {
      const j = this._redrape[k];
      const chunk = j.chunk;
      // The chunk may have been evicted / re-streamed under us. RECORD IDENTITY
      // is the test, not a generation counter: an evict deletes the record and a
      // re-stream creates a NEW one for the same key, so `chunks.get(key)` no
      // longer being this object is exactly the condition that invalidates the
      // job (and it also catches state changes that null the mesh).
      if (this.chunks.get(j.key) !== chunk || !chunk.mesh || !chunk.redrape) {
        // The chunk was evicted or re-streamed under the job. The heal is MOOT,
        // not failed — there is no hole because there is no chunk. Counted.
        this._stat.healsAborted += 1;
        this._redrape.splice(k, 1);
        continue;
      }
      const R = chunk.redrape;
      const span = WORLD_SIZE / 2 ** chunk.tile.z;
      const cx = -span0 + chunk.tile.x * span + span / 2;
      const cz = -(span0 - chunk.tile.y * span) + span / 2;
      while (j.i < R.gy.length) {
        const wx = cx + R.ax[j.i];
        const wz = cz + R.az[j.i];
        const s = this.groundAt(
          (wx / EARTH_R) * RAD2DEG,
          (2 * Math.atan(Math.exp(-wz / EARTH_R)) - Math.PI / 2) * RAD2DEG
        );
        if (!s || s.tileZ < SAT_BUILDINGS.demZ) {
          j.gy[j.i] = R.gy[j.i]; // keep the old ground — never drop a building to 0
          j.nulls += 1;
        } else {
          j.gy[j.i] = s.elev;
          const sz = s.tileZ ?? 0;
          if (sz < j.minZ) j.minZ = sz;
        }
        j.i += 1;
        done += 1;
        this._stat.redrapeRuns += 1; // forward-progress instrument (E CERT)
        // R24 B (W3) — the FORWARD-PROGRESS floor, the heal twin of
        // CHUNK_FADE.minFrames: a per-frame TIME budget is a frame-rate-
        // dependent throughput, so on a slow frame it can sample almost nothing
        // and the job never finishes before its chunk is evicted under it.
        // At 60 Hz the ms budget is hit first and governs alone.
        if (done >= (HEAL_IN_PLACE.minRunsPerFrame | 0) && performance.now() - t0 > HEAL_IN_PLACE.budgetMs)
          return;
      }
      this._applyRedrape(j);
      this._redrape.splice(k, 1);
    }
  }

  /** Apply the sampled deltas to the resident position buffer + the collision
   *  columns + the house anchors, with a RANGED upload over the touched span. */
  _applyRedrape(j) {
    const chunk = j.chunk;
    const R = chunk.redrape;
    const posAttr = chunk.mesh.geometry.getAttribute('position');
    const arr = posAttr.array;
    const cols = chunk.columns?.data ?? null;
    let lo = Infinity;
    let hi = -1;
    let moved = 0;
    for (let r = 0; r < R.gy.length; r++) {
      const d = j.gy[r] - R.gy[r];
      if (Math.abs(d) < HEAL_IN_PLACE.minDeltaM) continue;
      const v0 = R.start[r];
      const v1 = R.start[r + 1];
      for (let v = v0; v < v1; v++) arr[v * 3 + 1] += d;
      if (cols && r * 4 + 2 < cols.length) cols[r * 4 + 2] += d; // column top Y
      R.gy[r] = j.gy[r];
      if (v0 < lo) lo = v0;
      if (v1 > hi) hi = v1;
      moved += 1;
    }
    if (moved === 0) {
      // A heal that moves nothing is evidence, not a transient: stop asking.
      chunk.drapeZ = Math.min(chunk.drapeZ ?? 99, j.minZ);
      this._stat.healsNoop += 1;
      return;
    }
    // Porch lights ride their own building (houseRun[i] is that house's run).
    if (chunk.house && chunk.houseRun) {
      for (let i = 0; i < chunk.houseRun.length; i++) {
        const r = chunk.houseRun[i];
        if (r >= 0) chunk.house[i * 3 + 1] = R.gy[r];
      }
    }
    // R21 (C, S6) ranged upload: only the touched vertex span reaches the GPU.
    posAttr.addUpdateRange?.(lo * 3, (hi - lo) * 3);
    posAttr.needsUpdate = true;
    chunk.mesh.geometry.computeBoundingSphere();
    if (chunk.mesh.geometry.boundingBox) chunk.mesh.geometry.computeBoundingBox();
    refreshArchitectureRegionHeights(chunk.mesh.geometry);
    const bpad = this._bendPad(chunk.tile.z);
    if (chunk.mesh.geometry.boundingSphere) chunk.mesh.geometry.boundingSphere.radius += bpad;
    chunk.drapeZ = j.minZ;
    chunk.badFrac = j.nulls / Math.max(1, R.gy.length);
    this._stat.healsInPlace += 1;
  }

  // --- R24 B (CHUNK_FADE) — per-mesh birth / deferred eviction ---------------

  /** Mirror the shared material's mutable state onto a twin. Program identity
   *  depends on map/emissiveMap PRESENCE (USE_MAP / USE_EMISSIVEMAP), so a twin
   *  that skipped this would compile a second program — the one thing this
   *  feature must never do. */
  _syncTwin(m) {
    m.map = this.material.map;
    m.emissive.copy(this.material.emissive);
    m.emissiveMap = this.material.emissiveMap;
    m.emissiveIntensity = this.material.emissiveIntensity;
    if (this.visuals) {
      m.roughness = this.material.roughness;
      m.metalness = this.material.metalness;
      m.envMapIntensity = this.material.envMapIntensity;
      // Both callbacks close over their own state dictionary. Share its values
      // before compilation so night/detail updates reach every pooled twin;
      // the bend fade remains private to each material.
      Object.assign(m.userData.architecture.uniforms, this.material.userData.architecture.uniforms);
    } else m.reflectivity = this.material.reflectivity;
    m.needsUpdate = true;
  }

  /** Begin a birth ramp on a freshly finalized chunk mesh. A birth changes NO
   *  count: the chunk is `ready` from this frame exactly as before. */
  _startBirth(mesh, nowSec) {
    if (!chunkFadeOn() || CHUNK_FADE.birthSec <= 0) return;
    // Budget spent ⇒ degrade to today's behaviour (an instant arrival) rather
    // than starve. Counted, because a pop that survives the feature must be
    // ATTRIBUTABLE: the engine proof asserts pops <= fadeBudgetMiss.
    if (this._births.length >= CHUNK_FADE.maxConcurrent) {
      this._stat.fadeBudgetMiss += 1;
      return;
    } // degrade to today
    const tw = this._fadePool.acquire();
    tw.uniform.value = 0;
    mesh.material = tw.material;
    mesh.userData.chunkBirthK = 0; // the skyline hand-off follows this ramp
    this._births.push({ mesh, tw, t0: nowSec, f0: this._fadeFrame, k0: 0 });
  }

  /** Try to defer an eviction behind a fade-out. Returns false when the caller
   *  must delete the mesh itself (flag off, budget spent, or a hard evict). */
  _startDeath(mesh, nowSec, tile) {
    if (this._hardEvict || !chunkFadeOn() || CHUNK_FADE.evictSec <= 0) return false;
    if (this._dying.length >= CHUNK_FADE.maxDying) {
      this._stat.fadeBudgetMiss += 1;
      return false;
    }
    // A mesh still fading IN is cancelled first — it already holds a twin.
    const bi = this._births.findIndex((b) => b.mesh === mesh);
    let tw;
    let k0 = 1;
    if (bi >= 0) {
      // Carry the ramp value across so a chunk evicted mid-birth dims from
      // where it actually is instead of jumping to solid for one frame.
      const b = this._births[bi];
      k0 = b.k0 + (1 - b.k0) * fadeRamp(rampT(b, nowSec, CHUNK_FADE.birthSec, this._fadeFrame));
      tw = b.tw;
      this._births.splice(bi, 1);
    } else {
      tw = this._fadePool.acquire();
      tw.uniform.value = this._altFade;
      mesh.material = tw.material;
    }
    tw.uniform.value = this._altFade * k0;
    this._dying.push({ mesh, tile, tw, t0: nowSec, f0: this._fadeFrame, k0, k: k0 });
    return true;
  }

  /** One frame of every live ramp. Cost: a handful of uniform writes. */
  _stepFades(nowSec) {
    this._fadeFrame += 1; // R24 B (W3): the frame-count floor's clock
    if (this._births.length || this._dying.length) markPhase('fade:sat-building'); // R24 B
    const alt = this._altFade;
    for (let i = this._births.length - 1; i >= 0; i--) {
      const b = this._births[i];
      const r = fadeRamp(rampT(b, nowSec, CHUNK_FADE.birthSec, this._fadeFrame));
      const k = b.k0 + (1 - b.k0) * r;
      b.tw.material.emissiveIntensity = this.material.emissiveIntensity;
      b.tw.uniform.value = alt * k;
      b.mesh.userData.chunkBirthK = k;
      if (r >= 1) {
        delete b.mesh.userData.chunkBirthK;
        b.mesh.material = this.material; // back to the ONE shared material
        this._fadePool.release(b.tw);
        this._births.splice(i, 1);
      }
    }
    for (let i = this._dying.length - 1; i >= 0; i--) {
      const d = this._dying[i];
      const r = fadeRamp(rampT(d, nowSec, CHUNK_FADE.evictSec, this._fadeFrame));
      d.tw.material.emissiveIntensity = this.material.emissiveIntensity;
      d.k = d.k0 * (1 - r);
      d.tw.uniform.value = alt * d.k;
      if (r >= 1) {
        this.object.remove(d.mesh);
        d.mesh.geometry.dispose();
        this._fadePool.release(d.tw);
        this._dying.splice(i, 1);
      }
    }
  }

  /** Land every ramp NOW: warp, tier arm (the twin's program key depends on
   *  map/emissiveMap), style flip, dispose. Births snap to the shared material;
   *  dying meshes are deleted immediately, which is the pre-R24 behaviour. */
  _flushFades() {
    for (const b of this._births) {
      b.mesh.material = this.material;
      delete b.mesh.userData.chunkBirthK;
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

  /** R21 (P1) — this ring's bend margin for a z-level's tile. */
  _bendPad(z) {
    if (z === undefined) return 0;
    const span = WORLD_SIZE / 2 ** z;
    const r = this._coverage?.ringM ?? SAT_BUILDINGS.ring.r;
    return bendMarginM(r, (span * Math.SQRT2) / 2);
  }

  setWorker(workerApi, extraWorkers = null) {
    this.worker = workerApi;
    // WORLD PASS B: a small pool of building workers (SatBuildingLayer makes the
    // extras only with WORLD_ARRIVAL on). Dense tiles take 0.6 to 2.4 s each on
    // one worker, built one after another; two halve the ring's build time.
    this._pool = [workerApi, ...(extraWorkers ?? [])].map((api) => ({ api, n: 0 }));
    this._disposed = false;
    // WORLD PASS W0: the opt-in stage counters (worker/stages.js). The worker's
    // R21 diag switch; off by default, and then nothing below changes.
    this._wpDiag = worldPassDiag();
    // WORLD PASS W0: the arrival counters on stats. Off with every stream off and
    // nobody asking: stats is read every frame, so it must stay the c2bf5c06 object.
    this._wpCount = worldPassCounters();
    // WORLD PASS B (ARRIVAL): the stream's switches, read ONCE here (after the
    // canvas mounted, so the latch sees the boot preset) and never per frame.
    // All false with the flag off, and then every branch below is the shipped
    // code. fastQuery arms the exact fast ground query page-wide (same answers,
    // lib/fly/terrain-ground-query.js) and batches this engine's query loops.
    this._arr = worldPassOn('arrival')
      ? { on: true, fastQuery: worldPassOn('arrival', 'fastQuery'), drapeCap: worldPassOn('arrival', 'drapeCap'), workerPrep: worldPassOn('arrival', 'workerPrep'),
          uploads: worldPassOn('arrival', 'uploads'), footings: worldPassOn('arrival', 'footings'), readiness: worldPassOn('arrival', 'readiness'), cfg: worldPassConfig('arrival') }
      : ARRIVAL_OFF;
    if (this._arr.fastQuery) armFastGroundQuery(true);
    // r2 (quantize): the worker packs building position / anchor / uv as
    // normalized Int16 (wp-quant.js) when its request says so; the shared
    // material and every twin decode them. Only on the arrival finalize path.
    this._q = !!(this._arr.workerPrep && this._arr.drapeCap && this.visuals && this._arr.cfg?.worker?.quantize);
    if (this._q) patchQuantMaterial(this.material);
    if (this._wpDiag) {
      try {
        for (const w of this._pool) Promise.resolve(w.api.setDiag?.(true)).catch(() => {});
      } catch {
        /* a worker without setDiag simply sends no counters */
      }
    }
    this._lastRefreshPos = { x: Infinity, z: Infinity };
    this._lastRefreshT = 0;
  }

  notifyWarp(nowSec) {
    this._flushFades(); // R24 B: a warp is a cut, never a crossfade
    this._warpCoarseUntil = nowSec + SAT_BUILDINGS.warpCoarseWindowSec;
    this._leadHoldUntil = nowSec + STREAM_KEEPER.lookahead.warpHoldSec; // R21 §3.4
    this._wpArm(nowSec); // WORLD PASS W0 counters
  }

  /** WORLD PASS W0 — restart the arrival clock (ring arm or warp). Diagnostic only. */
  _wpArm(nowSec) {
    const W = this._wp;
    W.armAt = nowSec;
    W.desiredAt = NaN;
    W.firstTileSec = null;
    W.fullRingSec = null;
    W.finalizeMsMax = 0; // per arrival: the max since this arm or warp
    W.finPh = null; // WORLD PASS B: per-phase finalize max (arrival only)
    W.finSum = null;
    W.frameMsMax = 0;
    W.groundSec = null; // WORLD PASS B r2
    W.frameWorst = null;
    this._wpKeep = null;
  }

  /**
   * WORLD PASS B r2 — the terrain's own arrival: seconds from the arm or warp
   * until the ground under the aircraft answers from a drawn mesh at least
   * honestZ (14) fine, so the first detailed tile can be read relative to it
   * (`firstTileAfterGroundSec`). One ground query a frame until it lands,
   * counters on and the flag on only.
   */
  _wpTrackGround(nowSec, px, pz) {
    const W = this._wp;
    if (W.groundSec != null || !(W.armAt >= 0)) return;
    const s = this.groundAt((px / EARTH_R) * RAD2DEG, (2 * Math.atan(Math.exp(-pz / EARTH_R)) - Math.PI / 2) * RAD2DEG);
    if (s && s.tileZ >= this._arr.cfg.honestZ) W.groundSec = nowSec - W.armAt;
  }

  /** WORLD PASS W0 — stamp the full-ring time once every desired tile resolved. */
  _wpTrackRing(nowSec) {
    const W = this._wp;
    if (W.fullRingSec != null || !this._ringOn || !this._wpKeep || !(W.desiredAt >= W.armAt)) return;
    for (const k of this._wpKeep) {
      const c = this.chunks.get(k);
      if (!c || (c.state !== 'ready' && c.state !== 'empty')) return;
    }
    W.fullRingSec = nowSec - W.armAt;
  }

  /** Per-frame. playerX/Z absolute world; eyeAglM = eye altitude above ground. */
  update(nowSec, playerX, playerZ, eyeAglM) {
    if (this._disposed || !this.worker) return;
    this._now = nowSec;
    this._trackVel(nowSec, playerX, playerZ);
    // Round 16 (A2) cull fade — ONE uniform write per frame, no draw-count
    // change, no material churn: the shared anchor-bend fragment thins the city
    // out with an ordered Bayer-4 discard across [fadeStart, fadeEnd] so a climb
    // no longer deletes a downtown in a single frame (FLY_ROUND13 CP#2). When
    // SAT_BLDG_FADE.enabled is false NOTHING is ever written and the uniform
    // stays at its default 1 → R15 behaviour byte-for-byte.
    // SHIP PASS CITY (CT-1, CT-2): the band (pins > CITY_RANGE > shipped).
    // bandFade() is the expression that stood here, verbatim, over the
    // resolved numbers, so the shipped band writes the shipped value.
    this._resolveBand();
    if (SAT_BLDG_FADE.enabled) {
      setSatBldgFade(bandFade(this._band, eyeAglM)); // smoothstep
    }
    this._applyLite(eyeAglM);
    // R24 B (CHUNK_FADE): the same altitude term the shared uniform just took,
    // read back so a per-mesh ramp multiplies it rather than replacing it — a
    // chunk born at 2.8 km AGL must arrive already thinned, not solid.
    this._altFade = getSatBldgFade();
    this._stepFades(nowSec);
    const movedSq =
      (playerX - this._lastRefreshPos.x) ** 2 + (playerZ - this._lastRefreshPos.z) ** 2;
    if (
      movedSq > SAT_BUILDINGS.refreshMoveM ** 2 ||
      nowSec - this._lastRefreshT > SAT_BUILDINGS.refreshSec
    ) {
      this._lastRefreshPos = { x: playerX, z: playerZ };
      this._lastRefreshT = nowSec;
      this._refreshDesired(playerX, playerZ, eyeAglM, nowSec);
    }
    this._pumpQueue();
    this._pumpWaterBackfill(); // R21 (S4)
    // WORLD PASS B (fastQuery): the heal and the drape only QUERY the terrain,
    // synchronously, so they run inside one ground-query batch (exact memo).
    const batch = this._arr.fastQuery;
    if (batch) beginGroundBatch();
    try {
      this._pumpRedrape(); // R24 B (HEAL_IN_PLACE) — before the arrival drape:
      // a hole that already exists on screen outranks one that has not opened yet.
      this._drapePending();
    } finally {
      if (batch) endGroundBatch();
    }
    this._finalizePending(nowSec);
    if (this._wpCount) this._wpTrackRing(nowSec); // WORLD PASS W0 counters
    if (this._wpCount && this._arr.on) this._wpTrackGround(nowSec, playerX, playerZ); // WORLD PASS B r2
    if (this.visuals) {
      if (batch) beginGroundBatch(); // WORLD PASS B (fastQuery)
      try {
        this._repairContactDrape(nowSec, playerX, playerZ);
      } finally {
        if (batch) endGroundBatch();
      }
    }
    // Round 18: the sawtooth fix runs on the same slow cadence as the desired
    // set — it only ever acts on chunks that have already RESOLVED, and it
    // needs their neighbours resolved too, so there is nothing to gain from
    // checking per frame.
    if (nowSec - this._lastOceanT > SAT_BUILDINGS.refreshSec) {
      this._lastOceanT = nowSec;
      this._oceanFill();
    }
    // Gentle normal-map scroll → the sun glints shimmer (one shared texture).
    if (this._waterTex) {
      this._waterTex.offset.x = (nowSec * SAT_WATER.scrollMps) % 1;
      this._waterTex.offset.y = (nowSec * SAT_WATER.scrollMps * 0.6) % 1;
    }
  }

  // --- desired set: single z14-class ring, altitude-gated with hysteresis -----
  _refreshDesired(px0, pz0, eyeAglM, nowSec = 0) {
    const S = SAT_BUILDINGS;
    // Altitude hysteresis: buildings are a low-AGL detail (invisible from cruise).
    // Round 16 (A2): with the cull fade armed the ring stays LIVE up to
    // SAT_BLDG_FADE.evictAglM — past fadeEndAglM the chunks are already fully
    // dithered away, so eviction happens on invisible geometry and there is
    // nothing left to pop. Re-arm on descent is unchanged (S.cullAglOnM), which
    // keeps the hysteresis band wider, not narrower. enabled:false → the R13
    // hard evict at S.cullAglOffM, exactly as before.
    // SHIP PASS CITY (CT-1, CT-2): evict / re-arm heights come from the band;
    // with no pin and no CITY_RANGE they are SAT_BLDG_FADE.evictAglM (or
    // S.cullAglOffM when that block is off) and S.cullAglOnM, as before.
    const offAglM = this._band.evictM;
    if (this._ringOn) {
      if (eyeAglM > offAglM) this._ringOn = false;
    } else if (eyeAglM < this._band.armOnM) {
      this._ringOn = true;
      this._wpArm(nowSec); // WORLD PASS W0 counters
    }
    if (!this._ringOn) {
      for (const [key, chunk] of this.chunks) this._evict(key, chunk);
      this.queue.length = 0;
      this.pendingFinalize.length = 0;
      return;
    }

    const z = S.ring.z;
    // Round 19 (A HOMESTEAD, P2 "coverage ~zero outside downtowns"): the ring
    // radius and chunk cap come from the layer's tier-resolved coverage when
    // one is set, and fall back to the R18 constants otherwise. `_coverage` is
    // null at medium/low and whenever SAT_COVERAGE.enabled is false, so those
    // paths are byte-identical to R18 (user decision 2).
    const r = this._coverage?.ringM ?? S.ring.r;
    const maxChunks = this._coverage?.maxChunks ?? S.maxChunks;
    // R21 (§3.4): ring centred slightly ahead at speed; identical at rest.
    const [px, pz] = this._leadCenter(nowSec, px0, pz0, r);
    const span = WORLD_SIZE / 2 ** z;
    const half = WORLD_SIZE / 2;
    const nTiles = 2 ** z;
    const txMin = Math.floor((px - r + half) / span);
    const txMax = Math.floor((px + r + half) / span);
    const tyMin = Math.floor((pz - r + half) / span);
    const tyMax = Math.floor((pz + r + half) / span);
    const desired = [];
    for (let ty = Math.max(0, tyMin); ty <= Math.min(nTiles - 1, tyMax); ty++) {
      for (let tx = Math.max(0, txMin); tx <= Math.min(nTiles - 1, txMax); tx++) {
        const minX = -half + tx * span;
        const minZ = -(half - ty * span);
        // tile square [minX,maxX]×[minZ,maxZ] vs circle(px,pz,r)
        const dx = Math.max(minX - px, 0, px - (minX + span));
        const dz = Math.max(minZ - pz, 0, pz - (minZ + span));
        if (dx * dx + dz * dz > r * r) continue;
        const cx = minX + span / 2;
        const cz = minZ + span / 2;
        desired.push({ z, x: tx, y: ty, detail: 'sat-buildings', distSq: (cx - px) ** 2 + (cz - pz) ** 2 });
      }
    }
    // WORLD PASS B (readiness): rank by distance from the lead point, with a
    // tile BEHIND the camera counted (1 + behindK) times farther, so what is in
    // front of the camera is requested, draped and kept first. The rank lives
    // in distSq because every later reader (RING_HOLD's re-sort, the queue)
    // orders by it.
    if (this._arr.readiness) {
      const K = this._arr.cfg.behindK;
      for (const e of desired) {
        const ex = -half + e.x * span + span / 2 - px0, ez = -(half - e.y * span) + span / 2 - pz0;
        const d = Math.hypot(ex, ez);
        const back = d > span * 0.75 ? Math.max(0, -(ex * this._viewX + ez * this._viewZ) / d) : 0;
        e.distSq *= 1 + K * back;
      }
    }
    desired.sort((a, b) => a.distSq - b.distSq);
    // R24 (B) — RING_HOLD. `kept` is still at most `maxChunks` entries and
    // still rank-sorted, so the water sub-slice and the queue order below are
    // untouched; what the hysteresis changes is WHICH chunk holds a slot at the
    // rank boundary. A chunk with a mesh is what is worth protecting — one
    // still building has nothing on screen and must not spend a slot.
    const keyOf = (e) => `${e.z}/${e.x}/${e.y}`;
    const kept = ringHoldKeep(desired, maxChunks, this.chunks, keyOf, (c) => !!c.mesh);
    const keep = new Set(kept.map(keyOf));
    if (this._arr.readiness) this._rank = new Map(kept.map((e, i) => [keyOf(e), i])); // WORLD PASS B
    this._wpKeep = keep; // WORLD PASS W0 counters (read only by _wpTrackRing)
    if (!(this._wp.desiredAt >= this._wp.armAt)) this._wp.desiredAt = nowSec;
    // …and the residency test is taken from the PLAYER (px0/pz0), not from the
    // lead centre: "genuinely far away" is a fact about where the pilot is, and
    // taking it from the lead point would withdraw the hold from precisely the
    // band behind the aircraft that LEAD_SAFE exists to keep covered.
    const held = residencyHeld(this.chunks, keep, nowSec, px0, pz0, r);
    // WORLD PASS B r2 (readiness): the lead point moves the ring ahead of the
    // aircraft (up to 0.8 x r), which used to evict drawn tiles 2 to 3 km
    // BEHIND it at boost, where the orbit camera can still look. The tiles
    // the aircraft's own ring would hold (no lead) stay; the byte budget is
    // spent on what lies beyond them (the lead's far front, older tiles),
    // nearest the aircraft first (r2b: the budget no longer goes to the lead
    // ring first, which at Paris left nothing for the city behind).
    const behind = this._arr.readiness ? this._budgetRing(kept, keep, held, px0, pz0, r, span, half, z, maxChunks, Math.hypot(px - px0, pz - pz0) > span / 4) : null;

    // --- Round 19 (A HOMESTEAD) — WATER KEEPS ITS OWN, NARROWER BOUND -------
    // SAT_WATER.maxWaterChunks (12) held only IMPLICITLY before this round: it
    // "mirrors SAT_BUILDINGS.maxChunks", and one water mesh per streamed chunk
    // could therefore never exceed it. Widening the building ring to 16 broke
    // that silently — verify-roof-variety caught it at waterReady 14 — and it
    // would have spent 4 draws the §5 ledger never budgeted.
    //
    // The extra reach is for BUILDINGS. The glint is a flourish, and at the
    // ring edge it is also the most oblique and least legible, so water stays
    // on the nearest maxWaterChunks tiles: nearest-first, the same philosophy
    // the ring itself uses. Enforced in BOTH directions (creation below is
    // gated on this set, and a chunk that drifts out of it drops its mesh), so
    // the bound holds as the player moves rather than only at stream-in.
    this._waterKeys = new Set(
      kept.slice(0, SAT_WATER.maxWaterChunks).map((e) => `${e.z}/${e.x}/${e.y}`)
    );
    for (const [key, chunk] of this.chunks) {
      if (!keep.has(key)) {
        if (held.has(key) || behind?.has(key)) {
          // R24 (B) — RING_HOLD (2), min residency: the BUILDINGS stay. Water
          // does not. R19 made SAT_WATER.maxWaterChunks an explicit bound
          // enforced in BOTH directions ("a chunk that drifts out of the set
          // drops its mesh") precisely because the implicit version broke
          // silently when the building ring widened — verify-roof-variety
          // caught it at waterReady 14. A held key is by construction outside
          // `_waterKeys`, which is a subset of `kept` and `held ∩ keep = ∅`, so
          // it always sheds: no test here would be able to fail. Without this
          // line a residency hold could carry up to `keepHysteresis` extra
          // glint meshes past a bound that costs draws.
          //
          // …AND IT HAS TO BE ABLE TO COME BACK, which is why this is not just
          // an `_evictWater`. The R19 eviction path could shed water freely
          // because the chunk was DESTROYED and got its water again from the
          // rebuild's finalize. A held chunk is not rebuilt: it is already
          // 'ready', so `_pumpQueue` skips it on re-admission and the glint
          // would be gone for the life of the record. R21's S4 backfill is
          // exactly the machinery for this — it re-asks any ready chunk that is
          // in `_waterKeys` and has no water — and `waterAsked` is what
          // terminates its scan, so clearing it is the difference between "shed
          // for now" and "shed forever". Same three lines `setWaterEnabled`
          // uses, for the same reason.
          if (chunk.water) {
            this._evictWater(chunk);
            chunk.waterAsked = false;
            this._backfillArmed = true;
          }
          continue;
        }
        this._evict(key, chunk);
        this._reheals.delete(key); // round 19: don't leak the re-drape counter
        this._heal.delete(key); // round 21: …nor the heal-state record
      } else if (chunk.water && !this._waterKeys.has(key)) this._evictWater(chunk);
    }
    // Heal chunks whose drape no longer matches the best DEM available.
    //
    // R13-R18 healed only chunks flagged `coarse` — meaning >5% of their drape
    // samples found NO dem at all. But a sample at z12 is ACCEPTED (demZ 12 is
    // the floor, not the target), so a chunk draped while the terrain engine
    // was still serving z12 keeps that elevation FOREVER, even after z16
    // streams in underneath it. On flat ground the two agree; on a hill they
    // do not. Measured at SF Nob Hill: a building baked at 48 m standing on
    // ground the engine now reports at 106 m — a 58 m sink, permanent.
    //
    // ROUND 19 FOUND THIS, IT DID NOT CREATE IT — but the coverage widen makes
    // it bite harder (16 chunks compete for the same DEM/imagery bandwidth, so
    // more of them commit their drape before the fine tiles land) and it is
    // what verify-sat-buildings' hilly-city gate caught. Healing on REFINEMENT
    // rather than only on absence makes the drape converge to the truth
    // regardless of streaming order, which also removes the gate's hidden
    // dependence on how many tiles happened to arrive first.
    //
    // Churn is bounded three ways: the existing budget of 2 heals per refresh,
    // a hard cap of 2 refinement re-drapes per tile key (`_reheals`), and the
    // fact that DEM zoom only ever increases for a stationary player — so a
    // chunk converges and then stops asking. Measured at SF Nob Hill after the
    // change: all 16 chunks report base + baseSinkM == the live DEM exactly.
    //
    // ROUND 21 (P6) — THE RE-HEAL CAP NOW COVERS COARSE CHUNKS TOO. R19's cap
    // reads `if (!chunk.coarse && reheals >= 2) continue;` — it bounds the
    // REFINEMENT half and leaves the `coarse` half unbounded. And `coarse` is
    // measured over PER-BUILDING samples (badFrac > 0.05, :709) while the test
    // right here samples the TILE CENTRE, so a tile straddling a DEM-coverage
    // boundary satisfies the centre test, gets evicted, rebuilds, re-measures
    // >5% bad and evicts again — two per refresh, every 2 s, for as long as the
    // player stays there. That is an area that visibly keeps swapping, and
    // because a rebuild takes the chunk's collision columns and house/parcel
    // anchors with it, it is also the thing replaying Agent C's parcel-home
    // placement race. Three changes, all behind the flag:
    //   1. ONE counter for every heal (coarse included), capped at healCap.
    //   2. A coarse chunk re-heals only when a STRICTLY FINER DEM tile than the
    //      one that produced its badFrac is available — an equal-zoom answer
    //      cannot improve the drape, so asking again is pure churn.
    //   3. If a re-drape does not IMPROVE badFrac, the chunk is marked
    //      permanently coarse and never asked again. Some tiles simply straddle
    //      the edge of DEM coverage; that is data, not a transient.
    const SKON = STREAM_KEEPER.enabled;
    let healed = 0;
    for (const [key, chunk] of this.chunks) {
      if (healed >= 2 || chunk.state !== 'ready' || !chunk.tile) continue;
      // Cinematic chunks repair their actual anchors in place. The old center
      // gate misses refined houses when the off-axis tile center stays coarse.
      if (this.visuals && chunk.drapeRuns) continue;
      const reheals = this._reheals.get(key) ?? 0;
      const H = this._heal.get(key);
      if (SKON) {
        if (H?.perm) continue; // proven un-improvable
        if ((H?.attempts ?? 0) >= STREAM_KEEPER.healCap) continue;
      } else if (!chunk.coarse && reheals >= 2) continue;
      const t = chunk.tile;
      const wx = -half + t.x * span + span / 2;
      const wz = -(half - t.y * span) + span / 2;
      const s = this.groundAt(
        (wx / EARTH_R) * RAD2DEG,
        (2 * Math.atan(Math.exp(-wz / EARTH_R)) - Math.PI / 2) * RAD2DEG
      );
      if (!s || s.tileZ < S.demZ) continue;
      const refined = s.tileZ > (chunk.drapeZ ?? 99);
      if (SKON) {
        // Both halves now demand REFINEMENT: absence alone is what the coarse
        // flag already recorded, and re-asking the same DEM zoom re-answers it
        // identically.
        if (!refined) continue;
      } else if (!chunk.coarse && !refined) continue;
      if (SKON) {
        this._heal.set(key, {
          attempts: (H?.attempts ?? 0) + 1,
          lastBadFrac: chunk.badFrac ?? 0,
          perm: false,
        });
      } else if (!chunk.coarse) this._reheals.set(key, reheals + 1);
      // Counted in BOTH modes: stats are the unflagged instrument E CERT reads,
      // and a counter that only ticks with the flag on cannot measure the flag.
      this._stat.heals += 1;
      // R24 B (HEAL_IN_PLACE, recon WB-8/T8) — THE BLINK. R21 bounded how MANY
      // times a chunk heals; it never stopped a heal from being a hole. Each
      // one deletes the mesh and refetches the bundle, so the tile is GONE for
      // the whole worker roundtrip + drape + finalize latency — up to healCap
      // (3) blink-out/blink-in cycles per key on hilly terrain, and each one
      // also takes the chunk's collision columns and house anchors with it,
      // which is what replays the R21 parcel-home placement race. With the
      // drape record retained we re-sample the DEM per building and patch the
      // RESIDENT position buffer instead: no refetch, no hole, no re-place.
      if (this._queueRedrape(key, chunk)) {
        healed += 1;
        continue;
      }
      this._evict(key, chunk);
      healed += 1;
    }
    // R21 (P2): an 'empty'/'error' record is re-admitted once its TTL/backoff
    // expires. Flag off, `_readmit` is always false ⇒ the unchanged filter.
    this.queue = kept.filter((e) => {
      const chunk = this.chunks.get(`${e.z}/${e.x}/${e.y}`);
      if (!chunk) return true;
      if (!this._readmit(chunk, nowSec)) {
        chunk._readmit = false; // never leave a stale re-admission flag behind
        return false;
      }
      chunk._readmit = true;
      return true;
    });
    this.pendingFinalize = this.pendingFinalize.filter((p) => keep.has(p.key));
    this._sortPending(); // WORLD PASS B (readiness): drape and finalize in rank order
  }

  /**
   * WORLD PASS B r2 (pool): a build that has not answered in buildTimeoutSec
   * rejects, so the ordinary error path re-queues the tile (capped jittered
   * backoff), and the worker that owned it is pinged; a worker that does not
   * answer the ping (dead: a failed script load, a terminate, a hang) is
   * replaced, and every build still waiting on it rejects at once. The late
   * answer of a timed-out build is ignored (the race has settled).
   */
  _guardBuild(req, slot, key) {
    const ms = (this._arr.cfg.buildTimeoutSec ?? 20) * 1000;
    return new Promise((resolve, reject) => {
      let done = false, timer = 0;
      const finish = (f, v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        slot.pending?.delete(kill);
        f(v);
      };
      const kill = (why) => finish(reject, new Error(`${key}: ${why}`));
      timer = setTimeout(() => {
        this._stat.buildTimeouts += 1;
        kill(`no answer in ${ms / 1000} s`);
        this._checkWorker(slot);
      }, ms);
      (slot.pending ??= new Set()).add(kill);
      req.then((v) => finish(resolve, v), (err) => finish(reject, err));
    });
  }

  /** WORLD PASS B r2 (pool): ping a worker (a no-op message); replace it when it does not answer. */
  async _checkWorker(slot) {
    if (slot.checking || this._disposed) return;
    slot.checking = true;
    this._stat.workerChecks += 1;
    try {
      const ping = Promise.resolve(slot.api.setDiag?.(this._wpDiag)).then(() => true, () => false);
      const alive = await Promise.race([ping, new Promise((r) => setTimeout(() => r(false), (this._arr.cfg.pingTimeoutSec ?? 5) * 1000))]);
      if (!alive && !this._disposed) this._replaceWorker(slot);
    } finally {
      slot.checking = false;
    }
  }

  _replaceWorker(slot) {
    if (!this._spawn) return false;
    const old = slot.dispose;
    const fresh = this._spawn();
    if (this.worker === slot.api) this.worker = fresh.api;
    slot.api = fresh.api;
    slot.dispose = fresh.dispose;
    try { old?.(); } catch { /* already gone */ }
    if (this._wpDiag) Promise.resolve(fresh.api.setDiag?.(true)).catch(() => {});
    for (const kill of [...(slot.pending ?? [])]) kill('worker replaced');
    this._stat.workersReplaced += 1;
    return true;
  }

  /**
   * WORLD PASS B r2 (quantize): the decoded program is new to the page. Until
   * it is compiled (renderer.compileAsync, off the main thread where the
   * driver allows) the quantized meshes stay hidden, so the first one never
   * stalls a frame on a synchronous shader link (measured 1.3 s cold).
   */
  _quantCompile(mesh) {
    if (this._qReady || !this._compile) return;
    (this._qHidden ??= []).push(mesh);
    mesh.visible = false;
    if (this._qCompiling) return;
    this._qCompiling = true;
    const t0 = performance.now();
    Promise.resolve()
      .then(() => this._compile(mesh))
      .catch(() => {})
      .then(() => {
        this._qReady = true;
        this._stat.quantCompileMs = Math.round(performance.now() - t0);
        for (const m of this._qHidden) m.visible = true;
        this._qHidden = null;
      });
  }

  /** WORLD PASS B r2 (quantize): (object) => Promise, the renderer's compileAsync bound to the scene. */
  setCompiler(fn) {
    this._compile = fn;
  }

  /**
   * WORLD PASS B r2 (pool): how to make a fresh building worker ({ api, dispose })
   * and each pool slot's own dispose, from SatBuildingLayer. With the flag off
   * it is never called.
   */
  setWorkerSpawner(spawn, disposers = []) {
    this._spawn = spawn;
    (this._pool ?? []).forEach((s, i) => { s.dispose = disposers[i] ?? null; });
  }

  /** A worker's `error` event (a script that failed to load, or an uncaught error): ping it. */
  onWorkerError(api) {
    const slot = this._pool?.find((s) => s.api === api);
    if (slot) this._checkWorker(slot);
  }

  /**
   * WORLD PASS B r2b (readiness): the resident set under the byte budget.
   * CORE (always kept, never counted against the budget's choice): the
   * residency holds, and the aircraft's own ring, the maxChunks tiles nearest
   * the AIRCRAFT (every one within r of it): while the lead is moving the
   * ring, all of its drawn tiles and the desired tiles among it; at rest (the
   * lead point is the aircraft) the desired tiles within r, with the own
   * ring's drawn tiles only filling free slots up to maxChunks, so at rest
   * the core is the ring and nothing changes.
   * EXTRA (admitted while the resident building bytes stay under
   * `buildingBudgetMB`, tiles with work already done first, then nearest the
   * aircraft): every other desired tile (the lead's front) and any other
   * drawn tile within r. A lead tile that does not fit is not requested (it is
   * dropped from `kept` / `keep`, so it is neither built nor drawn yet); a
   * drawn one that does not fit is evicted. Bytes of a tile not built yet are
   * estimated as the mean of the drawn ones. Returns the drawn tiles kept
   * outside `keep`.
   */
  _budgetRing(kept, keep, held, px, pz, r, span, half, z, maxChunks, leading) {
    let cap = (this._arr.cfg.buildingBudgetMB ?? 0) * 1048576;
    const r2 = r * r, nT = 2 ** z;
    const near2 = (tx, ty) => {
      const minX = -half + tx * span, minZ = -(half - ty * span);
      const dx = Math.max(minX - px, 0, px - (minX + span)), dz = Math.max(minZ - pz, 0, pz - (minZ + span));
      return dx * dx + dz * dz;
    };
    // The aircraft's own ring (no lead): its maxChunks tiles nearest it.
    const rest = [];
    const t0x = Math.max(0, Math.floor((px - r + half) / span)), t1x = Math.min(nT - 1, Math.floor((px + r + half) / span));
    const t0y = Math.max(0, Math.floor((pz - r + half) / span)), t1y = Math.min(nT - 1, Math.floor((pz + r + half) / span));
    for (let ty = t0y; ty <= t1y; ty++) for (let tx = t0x; tx <= t1x; tx++) {
      if (near2(tx, ty) > r2) continue;
      const cx = -half + tx * span + span / 2 - px, cz = -(half - ty * span) + span / 2 - pz;
      rest.push([cx * cx + cz * cz, `${z}/${tx}/${ty}`]);
    }
    rest.sort((a, b) => a[0] - b[0]);
    const own = new Set();
    for (let i = 0; i < rest.length && i < maxChunks; i++) own.add(rest[i][1]);
    let nB = 0, sB = 0;
    for (const c of this.chunks.values()) if (c.mesh && c.bytes) { nB += 1; sB += c.bytes; }
    const est = nB ? sB / nB : 0;
    let bytes = 0, coreN = held.size;
    const extra = [];
    for (const e of kept) {
      const key = `${e.z}/${e.x}/${e.y}`, c = this.chunks.get(key);
      const b = c?.mesh ? (c.bytes ?? 0) : est, d2 = near2(e.x, e.y);
      if (leading ? own.has(key) : d2 <= r2) { bytes += b; coreN += 1; }
      else extra.push([c && c.state !== 'error' && c.state !== 'empty' ? 0 : 1, d2, key, b, true]);
    }
    for (const key of held) bytes += this.chunks.get(key)?.bytes ?? 0;
    // While the lead is moving the ring (more than a quarter tile), the core
    // is exactly the aircraft's own ring (its maxChunks tiles nearest it):
    // the lead must not cost the ring around the aircraft, and everything the
    // lead adds is paid from the budget. At rest (no lead) the desired tiles
    // within r are the core, and the aircraft's own ring only fills free
    // slots up to maxChunks, as before.
    const out = new Set();
    for (const [, key] of rest) {
      if (leading ? !own.has(key) : coreN >= maxChunks) break;
      if (keep.has(key) || held.has(key)) continue;
      const c = this.chunks.get(key);
      if (!c?.mesh || c.state !== 'ready') continue;
      bytes += c.bytes ?? 0;
      coreN += 1;
      out.add(key);
    }
    for (const [key, c] of this.chunks) {
      if (keep.has(key) || held.has(key) || out.has(key)) continue;
      if (!c.mesh || c.state !== 'ready' || !c.tile) continue;
      const d2 = near2(c.tile.x, c.tile.y);
      if (d2 <= r2) extra.push([0, d2, key, c.bytes ?? 0, false]);
    }
    let behindKept = 0, deferred = 0;
    if (extra.length) {
      // r2b: when the geometry row is set, the cap is what the row leaves
      // after every other system's geometry (measured, not assumed: the other
      // geometry differs by flag arm and place, about 50 to 105 MiB at Paris).
      const rowMB = this._arr.cfg.geometryRowMB;
      if (rowMB) cap = rowMB * 1048576 - this._otherGeometryBytes();
      extra.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let drop = null;
      for (const [, , key, b, lead] of extra) {
        if (bytes + b <= cap) { bytes += b; if (!lead) { out.add(key); behindKept += 1; } continue; }
        if (lead) { (drop ??= new Set()).add(key); deferred += 1; } else this._stat.behindDropped = (this._stat.behindDropped ?? 0) + 1;
      }
      if (drop) {
        for (let i = kept.length - 1; i >= 0; i--) if (drop.has(`${kept[i].z}/${kept[i].x}/${kept[i].y}`)) kept.splice(i, 1);
        for (const key of drop) { keep.delete(key); this._rank?.delete(key); }
      }
    }
    this._stat.behindKept = out.size;
    this._stat.behindExtra = behindKept;
    this._stat.leadDeferred = deferred;
    this._stat.leadDeferredTotal = (this._stat.leadDeferredTotal ?? 0) + deferred;
    return out.size ? out : null;
  }

  /**
   * WORLD PASS B r2b: the scene's geometry bytes that are not this engine's,
   * counted as world-pass-budget counts them (each unique geometry's
   * attribute arrays and index, plus instance matrices and colours; CPU
   * arrays). Walked at most every 2 s, and only when the budget has a choice
   * to make (_budgetRing with extras), never per frame.
   */
  _otherGeometryBytes() {
    const now = performance.now();
    if (this._otherGeo && now - this._otherGeo.at < 2000) return this._otherGeo.bytes;
    const t0 = now;
    let scene = this.object;
    while (scene.parent) scene = scene.parent;
    const seen = new Set();
    let bytes = 0;
    const mine = this.object;
    const walk = (n) => {
      if (n === mine) return;
      if (n.isMesh || n.isPoints || n.isLine) {
        if (n.isInstancedMesh) bytes += n.instanceMatrix.array.byteLength + (n.instanceColor?.array.byteLength ?? 0);
        const g = n.geometry;
        if (g && !seen.has(g)) {
          seen.add(g);
          for (const k in g.attributes) { const a = g.attributes[k]; bytes += a.array?.byteLength ?? a.data?.array?.byteLength ?? 0; }
          if (g.index) bytes += g.index.array.byteLength;
        }
      }
      for (const c of n.children) walk(c);
    };
    walk(scene);
    this._otherGeo = { at: now, bytes };
    this._stat.otherGeoMiB = Math.round(bytes / 104857.6) / 10;
    this._stat.otherGeoWalkMs = Math.round((performance.now() - t0) * 100) / 100;
    return bytes;
  }

  /** WORLD PASS B (readiness): pending tiles in desired-set rank, not completion order. */
  _sortPending() {
    const rank = this._rank;
    if (!rank || this.pendingFinalize.length < 2) return;
    this.pendingFinalize.sort((a, b) => (rank.get(a.key) ?? 1e9) - (rank.get(b.key) ?? 1e9));
  }

  _pumpQueue() {
    const A = this._arr;
    const maxBuilds = A.on ? A.cfg.maxBuilds : SAT_BUILDINGS.maxBuilds; // WORLD PASS B
    while (this.building < maxBuilds && this.queue.length > 0) {
      const e = this.queue.shift();
      const key = `${e.z}/${e.x}/${e.y}`;
      const prev = this.chunks.get(key);
      // R21 (P2): flag off, `_readmit` never fires ⇒ the unchanged `has` guard.
      if (prev && !prev._readmit) continue;
      this._reqId += 1;
      const reqId = this._reqId;
      if (prev?.state === 'error') this._stat.errorRetries += 1;
      this.chunks.set(key, {
        state: 'building',
        mesh: null,
        tile: e,
        attempts: prev?.attempts ?? 0,
        reqId,
      });
      this.building += 1;
      // WORLD PASS B: the least-busy worker of the pool (the one worker without the flag).
      let slot = null;
      if (A.on && this._pool?.length > 1) for (const w of this._pool) if (!slot || w.n < slot.n) slot = w;
      if (slot) slot.n += 1;
      let req = (slot ? slot.api : this.worker)
        .buildTile(e.z, e.x, e.y, 'sat-buildings', { visuals: this.visuals, ...trueAreasRequest(), ...premiumWorldRequest(), worldPass: worldPassRequest() });
      if (slot) req = this._guardBuild(req, slot, key); // WORLD PASS B r2: no build waits forever
      (slot ? req.finally(() => { slot.n -= 1; }) : req)
        .then((result) => {
          this.building -= 1;
          const chunk = this.chunks.get(key);
          if (this._disposed || !chunk || chunk.state !== 'building' || chunk.reqId !== reqId)
            return;
          // Sentinel: a stale worker's bundle is DROPPED (round 15 — its layout
          // predates the facade uv, and a missing attribute reads (0,0), i.e.
          // windows on every roof). Render nothing + one dev warn, never crash.
          // WORLD PASS W0: a bundle stamped for another flag arm is stale too.
          if (result && (result.v !== EXPECTED_WORKER_PROTOCOL || !worldPassMatch(result))) {
            if (process.env.NODE_ENV === 'development' && !_warnedProtocol) {
              _warnedProtocol = true;
              console.warn(
                `[sat-buildings] worker protocol ${result.v} != expected ${EXPECTED_WORKER_PROTOCOL} ` +
                  '(stale worker after HMR/dev-server restart?) — buildings skipped; hard-reload to refresh.'
              );
            }
            chunk.state = 'empty';
            // R21 (P2): a protocol-stale worker cannot un-stale itself, so this
            // is deterministic for the session ⇒ 'zero', never re-asked.
            chunk.reason = 'zero';
            chunk.retryAt = Infinity;
            return;
          }
          chunk.wpStages = result?.wpStages ?? null; // WORLD PASS W0 diag counters (diag only)
          // Round 13 (P4): a tile is worth finalizing if it has buildings OR
          // (water-glint armed) water — open-harbor tiles often have no
          // buildings but ARE the water we want (e.g. NYC harbor).
          const hasWater = this.waterEnabled && !!result.satWater;
          // Round 18: remember what fraction of the tile was water (protocol
          // 14; a stale bundle never reaches here). This is the evidence the
          // ocean fill votes on.
          chunk.waterCoverage = result?.waterCoverage ?? 0;
          if (!result || result.empty || (!result.satBuilding && !hasWater)) {
            chunk.state = 'empty';
            // …and whether it was truly EMPTY (no buildings, no water polys at
            // all). OpenFreeMap 404s tiles that are nothing but open water, so
            // over a harbour the glint used to stop dead at a tile boundary and
            // resume at the next: a hard sawtooth across the water. Such a tile
            // is an OCEAN CANDIDATE — _oceanFill decides, from its neighbours'
            // real water coverage, whether to bridge it.
            chunk.oceanCandidate = !result?.satBuilding && !result?.satWater;
            // R21 (P2): keep the record and stamp WHY it is empty. A tile that
            // 404'd during an upstream wobble is 'no-data' and earns a TTL
            // re-ask — before this it was a permanent hole in the city for the
            // rest of the session, which is precisely the "adjacent areas
            // don't load" half of the user's report. A tile the worker parsed
            // and admitted nothing from ('zero') is deterministic, so it stays
            // sticky, as does anything from a legacy (pre-D) worker.
            chunk.reason = result?.reason;
            chunk.emptyAt = this._now;
            chunk.retryAt = emptyRetryAt(this._now, chunk.reason);
            return;
          }
          chunk.state = 'draping';
          this.pendingFinalize.push({ key, tile: e, result, grid: null, gi: 0, wpT0: this._now }); // wpT0: WORLD PASS W0 stuck counter
          this._sortPending(); // WORLD PASS B (readiness)
          if (result.lookPatch) requestLookRoofPatch(this, slot ? slot.api : this.worker, key, result); // WORLD PASS D x B seam (look.roofPhoto only)
        })
        .catch((err) => {
          this.building -= 1;
          const chunk = this.chunks.get(key);
          if (chunk && chunk.state === 'building' && chunk.reqId === reqId) {
            if (!STREAM_KEEPER.enabled || !STREAM_KEEPER.retry.enabled) {
              this.chunks.delete(key); // legacy: re-requested every refresh
            } else {
              // R21 (P2): capped jittered backoff. Deleting the record meant a
              // 429ing upstream was re-asked every 2 s by every engine at once
              // — the client turning a wobble into an outage.
              const R = STREAM_KEEPER.retry;
              const n = (chunk.attempts ?? 0) + 1;
              chunk.attempts = n;
              if (n >= R.maxAttempts) {
                chunk.state = 'empty';
                chunk.reason = 'no-data';
                chunk.emptyAt = this._now;
                chunk.retryAt = this._now + R.noDataTtlSec * jitter1();
              } else {
                chunk.state = 'error';
                chunk.nextTryAt = errorNextTryAt(this._now, n);
              }
            }
          }
          if (process.env.NODE_ENV === 'development')
            console.warn(`[sat-buildings] build ${key} failed:`, err?.message ?? err);
        });
    }
  }

  // --- drape: budgeted per-BUILDING exact RAW-DEM sampling across frames ------
  // A per-chunk bilinear grid (the toy approach) smooths steep-city relief (SF
  // hills → buildings 20-30m off, reading like toy exaggeration). Buildings must
  // be LEVEL and stand on their OWN ground, so each building is draped at the
  // EXACT DEM under its footprint centroid (one getGroundAt per building; verts
  // of a building are consecutive in the worker output → the sample is reused
  // across its run). groundY is accumulated separately so a retry (coarse DEM)
  // re-samples without double-applying.
  _drapePending() {
    if (this.pendingFinalize.length === 0) return;
    if (this._arr.drapeCap && this.visuals) return this._drapeArrival(); // WORLD PASS B
    markPhase('drape:sat-building'); // R24 B (E CERT stall attribution)
    const t0 = performance.now();
    const span0 = WORLD_SIZE / 2;
    for (const p of this.pendingFinalize) {
      if (!p.result.satBuilding) continue; // water-only tile → no per-building drape
      const anchor = p.result.satBuilding.anchor;
      const nV = anchor.length / 2;
      if (!p.groundY) {
        p.groundY = new Float32Array(nV);
        p.vi = 0;
        p.nulls = 0;
        p.lastAx = NaN;
        p.lastAz = NaN;
        p.lastGround = 0;
        p.lastMiss = false;
      }
      const span = WORLD_SIZE / 2 ** p.tile.z;
      const cx = -span0 + p.tile.x * span + span / 2;
      const cz = -(span0 - p.tile.y * span) + span / 2;
      while (p.vi < nV) {
        const ax = anchor[p.vi * 2];
        const az = anchor[p.vi * 2 + 1];
        if (ax !== p.lastAx || az !== p.lastAz) {
          // new building: sample the DEM at its exact centroid (absolute world)
          const wx = cx + ax;
          const wz = cz + az;
          const lon = (wx / EARTH_R) * RAD2DEG;
          const lat = (2 * Math.atan(Math.exp(-wz / EARTH_R)) - Math.PI / 2) * RAD2DEG;
          const s = this.groundAt(lon, lat);
          p.lastAx = ax;
          p.lastAz = az;
          p.lastMiss = !s || s.tileZ < SAT_BUILDINGS.demZ;
          // A continental fallback can be hundreds of metres above the new
          // locality. It is not a valid coarse placement for a visible city.
          p.lastGround = this.visuals && (!s || s.tileZ < 10 || !Number.isFinite(s.elev)) ? NaN : s?.elev ?? 0;
          if (this.visuals) {
            p.drapeState ??= new Map();
            p.drapeState.set(`${ax},${az}`, { zoom: s?.tileZ ?? 0, valid: !p.lastMiss });
          }
          // Round 19: remember the COARSEST DEM zoom this drape actually used,
          // so _refresh can re-drape the chunk once a finer tile answers (see
          // the heal loop). Tracked over accepted samples only — a miss already
          // forces a retry through `nulls`.
          if (!p.lastMiss) {
            const sz = s.tileZ ?? 0;
            if (sz < (p.minDemZ ?? 99)) p.minDemZ = sz;
          }
        }
        if (p.lastMiss) p.nulls += 1;
        p.groundY[p.vi] = p.lastGround;
        p.vi += 1;
        // The clock is read once per sampled building (and every 256 copied
        // vertices of a large one), not per vertex: with the bucketed ground
        // query the per-vertex timer had become most of the drape's cost.
        if ((p.vi === nV || anchor[p.vi * 2] !== ax || anchor[p.vi * 2 + 1] !== az || (p.vi & 255) === 0) &&
            performance.now() - t0 > SAT_BUILDINGS.drapeBudgetMs * budgetK()) return;
      }
    }
  }

  /**
   * WORLD PASS B (drapeCap): the drape by RUN, one ground sample per building
   * on the drawn mesh (no per-vertex walk, no string keys). A run with no
   * usable sample (none, non-finite, or a fallback mesh under z10) is retried
   * on its own, never by restarting the tile; _arrivalReady caps the wait.
   */
  _drapeArrival() {
    markPhase('drape:sat-building');
    const t0 = performance.now();
    const W = this._wp;
    let sampled = 0;
    try {
    const budget = this._arr.cfg.drapeBudgetMs * budgetK();
    const span0 = WORLD_SIZE / 2;
    for (const p of this.pendingFinalize) {
      const bld = p.result.satBuilding;
      if (!bld) continue;
      if (!p.runs) {
        p.runs = buildingRuns(bld);
        const n = p.runs.count;
        p.g = new Float64Array(n);
        p.gz = new Uint8Array(n);
        p.ok = new Uint8Array(n);
        p.ri = 0;
        p.todo = null;
        p.passDone = false;
        p.firstAt = this._now;
      }
      if (p.passDone) continue;
      const R = p.runs;
      const span = WORLD_SIZE / 2 ** p.tile.z;
      const cx = -span0 + p.tile.x * span + span / 2;
      const cz = -(span0 - p.tile.y * span) + span / 2;
      const list = p.todo;
      const n = list ? list.length : R.count;
      while (p.ri < n) {
        const r = list ? list[p.ri] : p.ri;
        const wx = cx + R.ax[r], wz = cz + R.az[r];
        const s = this.groundAt((wx / EARTH_R) * RAD2DEG, (2 * Math.atan(Math.exp(-wz / EARTH_R)) - Math.PI / 2) * RAD2DEG);
        if (s && Number.isFinite(s.elev) && s.tileZ >= 10) {
          p.g[r] = s.elev;
          p.gz[r] = s.tileZ;
          p.ok[r] = 1;
        } else p.ok[r] = 0;
        p.ri += 1;
        sampled += 1;
        if ((p.ri & 31) === 0 && performance.now() - t0 > budget) return;
      }
      p.passDone = true;
      if (performance.now() - t0 > budget) return;
    }
    } finally {
      // The drape's real per-building cost (ground query + bookkeeping), for the ledger.
      if (sampled) { W.drapeRuns = (W.drapeRuns ?? 0) + sampled; W.drapeMs = (W.drapeMs ?? 0) + performance.now() - t0; }
    }
  }

  /**
   * WORLD PASS B (drapeCap): may this tile commit? Every run must have a
   * sample of the drawn mesh. Missing runs are re-sampled on their own every
   * drapeRetrySec; after drapeCapSec they commit PROVISIONALLY on the tile's
   * median ground and the contact repair re-seats them in place as soon as the
   * mesh answers under them. A tile with no sample at all (no terrain yet)
   * keeps waiting: there is nothing honest to stand it on.
   */
  _arrivalReady(p, nowSec) {
    if (!p.runs || !p.passDone) return false;
    const R = p.runs, n = R.count, ok = p.ok;
    let bad = 0, minZ = 99;
    for (let r = 0; r < n; r++) {
      if (!ok[r]) bad += 1;
      else if (p.gz[r] < minZ) minZ = p.gz[r];
    }
    if (bad) {
      const capped = nowSec - p.firstAt >= this._arr.cfg.drapeCapSec;
      if (!capped || bad === n) {
        if (nowSec >= (p.retryAt ?? 0)) {
          const todo = new Uint32Array(bad);
          for (let r = 0, k = 0; r < n; r++) if (!ok[r]) todo[k++] = r;
          p.todo = todo;
          p.ri = 0;
          p.passDone = false;
          p.retryAt = nowSec + SAT_BUILDINGS.drapeRetrySec;
          this._wp.nonFiniteRestarts += 1;
          this._stat.arrivalRetries += 1;
        }
        return false;
      }
      const vals = [];
      for (let r = 0; r < n; r++) if (ok[r]) vals.push(p.g[r]);
      vals.sort((a, b) => a - b);
      const median = vals[vals.length >> 1];
      p.fb = new Uint8Array(n);
      for (let r = 0; r < n; r++) if (!ok[r]) { p.g[r] = median; p.gz[r] = minZ; p.fb[r] = 1; }
      this._stat.arrivalProvisional += bad;
    }
    p.minDemZ = minZ;
    p.badFrac = bad / Math.max(1, n);
    p.coarse = p.badFrac > 0.05;
    return true;
  }

  /**
   * WORLD PASS B (drapeCap): the contact repair for the arrival drape. Every
   * resident run is re-sampled nearest-first, runs not yet on an honest mesh
   * first, inside a time budget and a count cap, and re-seated in place
   * (repairArrivalRun) when the drawn mesh under it refined. Same ranged
   * uploads as the shipped repair; no eviction, no rebuild.
   */
  _repairContactArrival(nowSec, px, pz) {
    const cfg = this._arr.cfg;
    if ((!this._contactQueue || this._contactCursor >= this._contactQueue.length) && nowSec - (this._contactSweepAt ?? -Infinity) >= 1) {
      this._contactSweepAt = nowSec;
      this._contactCursor = 0;
      const q = [];
      for (const [key, chunk] of this.chunks) {
        if (chunk.state !== 'ready' || !chunk.mesh || !chunk.drapeRuns) continue;
        for (const run of chunk.drapeRuns) {
          if (run.end - run.start > 16384 || (run.zoom >= 18 && !(run.footing && run.footZoom < run.zoom))) continue;
          const d = (chunk.cx + run.ax - px) ** 2 + (chunk.cz + run.az - pz) ** 2;
          q.push({ key, chunk, run, d: run.valid ? d : d * 0.0625 });
        }
      }
      q.sort((a, b) => a.d - b.d);
      this._contactQueue = q;
    }
    const queue = this._contactQueue;
    if (!queue) return;
    const start = performance.now();
    let n = 0;
    while (this._contactCursor < queue.length && n < cfg.repairMaxPerFrame) {
      const { key, chunk, run } = queue[this._contactCursor++];
      if (this.chunks.get(key) !== chunk || chunk.state !== 'ready' || !chunk.mesh) continue;
      const wx = chunk.cx + run.ax, wz = chunk.cz + run.az;
      const sample = this.groundAt((wx / EARTH_R) * RAD2DEG, (2 * Math.atan(Math.exp(-wz / EARTH_R)) - Math.PI / 2) * RAD2DEG);
      n += 1;
      if (repairArrivalRun(chunk, run, sample, cfg.honestZ)) {
        this._stat.contactHeals += 1;
        this._stat.arrivalReseats += 1;
      }
      if (run.footing && chunk.foot && sample && Number.isFinite(sample.elev) && sample.tileZ >= 10 && sample.tileZ > run.footZoom) {
        this._footing(chunk, run, sample.tileZ);
        n += 4;
      }
      if (chunk.coarse && !chunk.unsettled) { chunk.coarse = false; chunk.badFrac = 0; }
      if ((n & 15) === 0 && performance.now() - start >= cfg.repairBudgetMs) break;
    }
  }

  /**
   * WORLD PASS B (footings): seat one building on the LOWEST drawn ground under
   * its footprint (four diagonal extremes and the centroid) and carry its
   * walls down to it, so nothing floats or shows a gap on a slope. Only the
   * wall-bottom vertices move; the roof keeps its height over the centroid
   * ground, and the facade v moves with them so the window rows keep their
   * spacing (the windows continue below the old base instead of stretching).
   * FableFlight seats on the lowest outline ground the same way
   * (src/buildings.rs:1543-1560 `site`, 1626-1642 `base = gmin - 2`).
   */
  _footing(chunk, run, tileZ) {
    const F = chunk.foot, o = run.column * 8;
    let low = run.ground;
    for (let k = 0; k < 8; k += 2) {
      const wx = chunk.cx + F.xz[o + k], wz = chunk.cz + F.xz[o + k + 1];
      const s = this.groundAt((wx / EARTH_R) * RAD2DEG, (2 * Math.atan(Math.exp(-wz / EARTH_R)) - Math.PI / 2) * RAD2DEG);
      if (s && Number.isFinite(s.elev) && s.tileZ >= 10 && s.elev < low) low = s.elev;
    }
    run.footZoom = tileZ;
    const footDelta = Math.min(this._arr.cfg.footMaxM, Math.max(0, run.ground - low));
    const d = footDelta - run.footDelta;
    if (Math.abs(d) < 0.05) return false;
    const geometry = chunk.mesh.geometry, position = geometry.attributes.position, arr = position.array;
    const uvAttr = geometry.attributes.uv, uv = uvAttr?.array;
    const neutral = SAT_BUILDINGS.facade.neutralUV, vPeriod = SAT_BUILDINGS.facade.rows * SAT_BUILDINGS.facade.floorHM;
    let lo = Infinity, hi = -1;
    // r2 (quantize): the wall bottoms move by whole lattice steps (footQ is the
    // total, so the rounding never accumulates) and the facade v by the
    // metres actually moved, on its own lattice.
    const Q = chunk.q, stride = Q ? 4 : 3;
    const footQ = Q ? Math.round(footDelta * WPQ_POS_K) : 0, dq = Q ? footQ - (run.footQ ?? 0) : 0;
    const neutralQ = Math.round(neutral * WPQ_UV_K), dv = Q ? Math.round((dq / WPQ_POS_K / vPeriod) * WPQ_UV_K) : 0;
    for (let j = F.bs[run.column]; j < F.bs[run.column + 1]; j++) {
      const v = F.bottom[j];
      if (Q) {
        arr[v * 4 + 1] -= dq;
        if (uv && uv[v * 2 + 1] !== neutralQ) uv[v * 2 + 1] -= dv;
      } else {
        arr[v * 3 + 1] -= d;
        if (uv && uv[v * 2 + 1] !== neutral) uv[v * 2 + 1] -= d / vPeriod;
      }
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi < 0) return false;
    if (Q) { run.footQ = footQ; run.qMin = run.qMin0 - footQ; }
    position.addUpdateRange(lo * stride, (hi - lo + 1) * stride);
    position.needsUpdate = true;
    if (uv) { uvAttr.addUpdateRange(lo * 2, (hi - lo + 1) * 2); uvAttr.needsUpdate = true; }
    // A footing deeper than the shipped sink closed a gap that showed (the wall
    // bottom used to stop baseSinkM below the centroid ground).
    if (footDelta > SAT_BUILDINGS.baseSinkM && !(run.footDelta > SAT_BUILDINGS.baseSinkM)) this._stat.footGaps += 1;
    if (footDelta > this._stat.footMaxDelta) {
      this._stat.footMaxDelta = footDelta;
      // r2: where the deepest footing is (absolute world x, z and its ground), so a frame can look at it
      this._stat.footMaxAt = [chunk.cx + run.ax, chunk.cz + run.az, run.ground, low];
    }
    run.footDelta = footDelta;
    run.footDown = Math.max(run.footDown ?? 0, footDelta);
    run.initialGround ??= run.ground;
    chunk.contactBounds ??= { radius: geometry.boundingSphere?.radius,
      minY: geometry.boundingBox?.min.y, maxY: geometry.boundingBox?.max.y, down: 0, up: 0 };
    const bounds = chunk.contactBounds;
    bounds.down = Math.min(bounds.down, run.ground - run.initialGround - footDelta);
    if (geometry.boundingSphere) geometry.boundingSphere.radius = bounds.radius + Math.max(-bounds.down, bounds.up);
    if (geometry.boundingBox) geometry.boundingBox.min.y = bounds.minY + bounds.down;
    padArchitectureRegionHeights(geometry, bounds.down, bounds.up);
    this._stat.footings += 1;
    return true;
  }

  // At most eight DEM queries / 0.35ms and one bounded vertex upload per frame.
  // The nearest-first queue sort is additional O(resident buildings) work once
  // per completed sweep (at least 2s apart), outside the sampling time budget.
  // Finish each nearest-first sweep before restarting, so distant buildings
  // cannot starve. No worker builds, chunk eviction, material changes or fades.
  _repairContactDrape(nowSec, px, pz) {
    if (!this.visuals) return;
    if (this._arr.drapeCap) return this._repairContactArrival(nowSec, px, pz); // WORLD PASS B
    if ((!this._contactQueue || this._contactCursor >= this._contactQueue.length) &&
        nowSec - (this._contactSweepAt ?? -Infinity) >= 2) {
      this._contactSweepAt = nowSec;
      this._contactCursor = 0;
      this._contactQueue = [];
      for (const [key, chunk] of this.chunks) {
        if (chunk.state !== 'ready' || !chunk.mesh) continue;
        for (const run of chunk.drapeRuns ?? []) {
          if (run.end - run.start > 16384) continue;
          this._contactQueue.push({ key, chunk, run, d: (chunk.cx + run.ax - px) ** 2 + (chunk.cz + run.az - pz) ** 2 });
        }
      }
      this._contactQueue.sort((a, b) => a.d - b.d);
    }
    const start = performance.now();
    // A nearby anchor sampled just before DEM refinement must not wait behind
    // thousands of distant repairs. Build a small foreground lane incrementally;
    // the fair queue and its cursor continue unchanged. New ready chunks and
    // movement enter the next scan instead of restarting that whole sweep.
    if (!this._contactNearScan && (nowSec - (this._contactNearAt ?? -Infinity) >= 1 ||
        (px - this._contactNearX) ** 2 + (pz - this._contactNearZ) ** 2 > 250 ** 2)) {
      this._contactNearScan = { chunks: [...this.chunks], ci: 0, ri: 0, nearest: [], px, pz };
    }
    const scan = this._contactNearScan;
    if (scan) {
      for (let walked = 0; walked < 256 && scan.ci < scan.chunks.length; walked++) {
        if (performance.now() - start >= 0.08) break;
        const [key, chunk] = scan.chunks[scan.ci];
        const runs = chunk.drapeRuns;
        if (this.chunks.get(key) !== chunk || chunk.state !== 'ready' || !chunk.mesh ||
            !runs || scan.ri >= runs.length) {
          scan.ci++; scan.ri = 0;
          continue;
        }
        const run = runs[scan.ri++];
        if (run.end - run.start > 16384) continue;
        const d = (chunk.cx + run.ax - scan.px) ** 2 + (chunk.cz + run.az - scan.pz) ** 2;
        const near = scan.nearest;
        if (d > 1500 ** 2 || (near.length === 32 && d >= near[31].d)) continue;
        const at = near.findIndex(entry => entry.d > d);
        near.splice(at < 0 ? near.length : at, 0, { key, chunk, run, d });
        if (near.length > 32) near.pop();
      }
      if (scan.ci >= scan.chunks.length) {
        this._contactNear = scan.nearest;
        this._contactNearAt = nowSec;
        this._contactNearX = scan.px;
        this._contactNearZ = scan.pz;
        this._contactNearScan = null;
      }
    }
    const near = this._contactNear ?? [];
    this._contactNearFrame = (this._contactNearFrame ?? 0) + 1;
    const nearFirst = this._contactNearFrame % 2 === 0;
    let usedNear = false;
    for (let sampled = 0; sampled < 8; sampled++) {
      const fairLeft = this._contactCursor < this._contactQueue.length;
      let entry;
      if (!usedNear && near.length && (nearFirst || sampled > 0 || !fairLeft)) {
        this._contactNearCursor = this._contactNearCursor ?? 0;
        entry = near[this._contactNearCursor++ % near.length];
        usedNear = true;
      } else if (fairLeft) entry = this._contactQueue[this._contactCursor++];
      else break;
      const { key, chunk, run } = entry;
      if (this.chunks.get(key) !== chunk || chunk.state !== 'ready' || !chunk.mesh) continue;
      const wx = chunk.cx + run.ax, wz = chunk.cz + run.az;
      const sample = this.groundAt((wx / EARTH_R) * RAD2DEG,
        (2 * Math.atan(Math.exp(-wz / EARTH_R)) - Math.PI / 2) * RAD2DEG);
      const repaired = repairCinematicBuildingDrape(chunk, run, sample);
      if (chunk.coarse && run.valid && chunk.drapeRuns.every(r => r.valid)) {
        chunk.coarse = false;
        chunk.badFrac = 0;
      }
      if (repaired) {
        this._stat.contactHeals++;
        break;
      }
      if (performance.now() - start >= 0.35) break;
    }
  }

  // --- finalize: apply drape + upload one merged building mesh ----------------
  _finalizePending(nowSec = 0) {
    const S = SAT_BUILDINGS;
    if (this.pendingFinalize.length) markPhase('finalize:sat-building'); // R24 B
    let done = 0;
    // WORLD PASS B (uploads): with the finalize prep in the worker a tile costs
    // a few ms here, so the per-frame bound becomes BYTES of new geometry (the
    // GPU upload on the tile's first render), FableFlight's upload budget
    // (src/world.rs:83-89, 24 MiB a frame), with at least one tile a frame.
    const A = this._arr;
    const upBudget = A.uploads ? A.cfg.uploadBudgetMB * 1048576 : 0;
    const perFrame = A.uploads ? A.cfg.finalizePerFrame : S.finalizePerFrame;
    let upBytes = 0;
    const frameT0 = A.on ? performance.now() : 0;
    const FR = A.on ? { ready: 0, pre: 0, fin: 0, tiles: 0 } : null; // r2 (counters only)
    // r2b: one allowance a frame for every World Pass finalize
    // (wp-frame-slice.js): a frame granted whole to a finalize that cannot be
    // sliced (REACH's skyline group) gets no ARRIVAL slice work.
    const wpYield = A.uploads && this.pendingFinalize.length > 0 && !wpSliceMayRun();
    const sliceDeadline = wpYield ? -Infinity : frameT0 + (A.uploads ? A.cfg.finalizeSliceMs * budgetK() : Infinity);
    if (A.uploads) this._sliceFresh = !wpYield; // r2b: no slice work yet this frame (_prepArrival's step admission, _commitFits)
    try {
    for (let i = 0; i < this.pendingFinalize.length && done < perFrame * budgetK(); i++) {
      // R24 A (FINALIZE_PACE, recon WB-3): the shared per-frame brake. A
      // SEPARATE guard, deliberately not folded into the loop bound, so it
      // composes with any other multiplier on that expression.
      markPhase('finalize:sat-buildings'); // R24 A: E's FRAME_STATS attribution
      const p = this.pendingFinalize[i];
      const bld = p.result.satBuilding;
      const nV = bld ? bld.anchor.length / 2 : 0;
      const arrival = !!bld && this._arr.drapeCap && this.visuals; // WORLD PASS B
      if (arrival) {
        if (!p.ready) {
          const tr = performance.now();
          p.ready = this._arrivalReady(p, nowSec);
          FR.ready += performance.now() - tr; // r2: where a finalize frame's time goes
          if (!p.ready) continue;
        }
        if (A.uploads) {
          const span = WORLD_SIZE / 2 ** p.tile.z;
          const tp = performance.now();
          const sliced = this._prefinalizeArrival(p, bld, -WORLD_SIZE / 2 + p.tile.x * span + span / 2, -(WORLD_SIZE / 2 - p.tile.y * span) + span / 2, sliceDeadline);
          FR.pre += performance.now() - tp;
          if (!sliced) break;
        }
      } else if (bld) {
        if (!p.groundY || p.vi < nV) continue; // still sampling
        if(this.visuals&&p.groundY.some(v=>!Number.isFinite(v))){
          if(nowSec>=(p.retryAt??0)){p.retryAt=nowSec+S.drapeRetrySec;p.vi=0;p.nulls=0;p.lastAx=NaN;p.lastAz=NaN;this._wp.nonFiniteRestarts+=1;}
          continue;
        }
        const badFrac = (p.nulls ?? 0) / nV;
        const maxTries =
          nowSec < (this._warpCoarseUntil ?? 0) ? S.warpCoarseTries : S.drapeMaxTries;
        if (badFrac > 0.05 && (p.tries ?? 0) < maxTries) {
          if (nowSec >= (p.retryAt ?? 0)) {
            p.tries = (p.tries ?? 0) + 1;
            p.retryAt = nowSec + S.drapeRetrySec;
            p.vi = 0;
            p.nulls = 0;
            p.lastAx = NaN;
            p.lastAz = NaN;
          }
          continue;
        }
        p.coarse = badFrac > 0.05;
        p.badFrac = badFrac; // R21 (P6): the evidence the heal cap judges on
      }
      if (upBudget && done > 0 && bld) {
        const bytes = bundleBytes(bld);
        if (upBytes + bytes > upBudget) break;
        upBytes += bytes;
      } else if (upBudget && bld) upBytes += bundleBytes(bld);
      // r2b: the commit (a mesh and a few assignments) too waits for time in
      // this frame's slice; a tile whose steps all ran commits first thing next frame.
      if (arrival && A.uploads && !this._commitFits(sliceDeadline)) break;
      if (!mayFinalize(done, 'sat-building')) break;
      this.pendingFinalize.splice(i, 1);
      i -= 1;
      done += 1;
      const wpT = performance.now(); // WORLD PASS W0: per-tile finalize ms
      const chunk = this.chunks.get(p.key);
      if (!chunk || chunk.state !== 'draping') continue;
      chunk.coarse = bld ? p.coarse : false;
      chunk.drapeZ = bld ? (p.minDemZ ?? 0) : 99; // round 19: see the heal loop
      chunk.badFrac = bld ? (p.badFrac ?? 0) : 0; // round 21: …and the heal cap
      chunk.tile = p.tile;
      // R21 (P6): did the re-drape this chunk just came back from actually
      // IMPROVE anything? If not, healing it again cannot either — some tiles
      // straddle the edge of DEM coverage and are permanently coarse. Marking
      // that is what turns an endless evict/rebuild cycle into one extra try.
      if (STREAM_KEEPER.enabled) {
        const H = this._heal.get(p.key);
        if (H && H.attempts > 0 && chunk.badFrac >= H.lastBadFrac - 1e-6)
          this._heal.set(p.key, { ...H, perm: true });
      }

      const span = WORLD_SIZE / 2 ** p.tile.z;
      const cx = -WORLD_SIZE / 2 + p.tile.x * span + span / 2;
      const cz = -(WORLD_SIZE / 2 - p.tile.y * span) + span / 2;
      // Round 19 (C): the tile centre, kept on the record — houseAnchors()
      // sorts by it and the mesh (which carried it implicitly) may not exist.
      chunk.cx = cx;
      chunk.cz = cz;

      if (arrival) {
        const tf = performance.now();
        this._finalizeArrival(p, chunk, bld, cx, cz, nowSec); // WORLD PASS B
        FR.fin += performance.now() - tf;
        FR.tiles += 1;
      } else if (bld) {
        const pos = bld.pos; // mutate in place (transferred, owned here)
        // Round 18 (the A5 GRAVITY contract): build this chunk's COLLISION
        // COLUMNS in the SAME pass that applies the drape. The worker emits a
        // building's vertices consecutively and stamps every one of them with
        // that building's footprint-centroid anchor, so a change of anchor is
        // exactly a change of building — one linear walk gives us, per
        // building, its top Y (post-drape, i.e. real world altitude) and the
        // radius of a bounding cylinder around its anchor. Costs one extra
        // compare per vertex on a pass that already exists; never per frame.
        const anchor = bld.anchor;
        const colX = [];
        const colZ = [];
        const colTop = [];
        const colR = [];
        // Round 19 (C GROUNDTRUTH): the per-building GROUND, collected on the
        // same run boundaries. House lights need a ground height and this pass
        // is the only place that has one per building — p.groundY is
        // per-VERTEX (parallel to `anchor`), and it is discarded below.
        // Collected unconditionally (one push per building on a walk that
        // already exists); only the resolve loop after it is flag-gated.
        const colGY = [];
        // R24 B (HEAL_IN_PLACE, recon WB-8/T8): the per-run VERTEX SPAN and the
        // run's local anchor, so a later DEM refinement can re-drape this exact
        // buffer instead of deleting the chunk and refetching it. One entry per
        // BUILDING (<= a few thousand floats), not per vertex.
        const runStart = [];
        const runAX = [];
        const runAZ = [];
        const drapeRuns = this.visuals ? [] : null;
        const drapeByAnchor = this.visuals ? new Map() : null;
        let contactRunStart = 0;
        let runAx = NaN;
        let runAz = NaN;
        let runTop = -Infinity;
        let runR2 = 0;
        let runGY = 0;
        const flushRun = (end) => {
          if (!Number.isFinite(runAx)) return;
          if (drapeRuns) {
            const sampled = p.drapeState?.get(`${runAx},${runAz}`);
            const run = { start: contactRunStart, end, ax: runAx, az: runAz, ground: runGY,
              zoom: sampled?.zoom ?? 0, valid: sampled?.valid ?? false, column: colX.length, house: -1 };
            drapeRuns.push(run);
            drapeByAnchor.set(`${runAx},${runAz}`, run);
          }
          colX.push(cx + runAx); // → absolute world (mesh.position = tile center)
          colZ.push(cz + runAz);
          colTop.push(runTop);
          colR.push(Math.sqrt(runR2));
          colGY.push(runGY);
          runAX.push(runAx);
          runAZ.push(runAz);
        };
        for (let v = 0, vi = 0; v < pos.length; v += 3, vi += 1) {
          // each building sits level on its OWN exact ground; the -baseSink base
          // tucks under so slope/hill gaps hide.
          pos[v + 1] += p.groundY[vi];
          const ax = anchor[vi * 2];
          const az = anchor[vi * 2 + 1];
          if (ax !== runAx || az !== runAz) {
            flushRun(vi);
            runStart.push(vi);
            contactRunStart = vi;
            runAx = ax;
            runAz = az;
            runTop = -Infinity;
            runR2 = 0;
            runGY = p.groundY[vi];
          }
          if (pos[v + 1] > runTop) runTop = pos[v + 1];
          const dx = pos[v] - ax;
          const dz = pos[v + 2] - az;
          const d2 = dx * dx + dz * dz;
          if (d2 > runR2) runR2 = d2;
        }
        flushRun(pos.length / 3);
        // R24 B (HEAL_IN_PLACE): the re-drape record. `start` carries a trailing
        // sentinel so run r owns vertices [start[r], start[r+1]). Column index r
        // IS run index r (buildColumnGrid preserves the order), so a re-drape
        // patches columns[r].topY by the same delta.
        chunk.redrape = HEAL_IN_PLACE.enabled
          ? {
              ax: Float32Array.from(runAX),
              az: Float32Array.from(runAZ),
              start: Uint32Array.from([...runStart, nV]),
              gy: Float32Array.from(colGY),
            }
          : null;
        if (drapeRuns) {
          chunk.drapeRuns = drapeRuns;
          // Run lengths are immutable. Re-filtering tens of thousands of
          // buildings for the 2 Hz HUD's stats getter dominated CPU profiles.
          chunk.contactOversizeCount = drapeRuns.reduce((n,r)=>n+(r.end-r.start>16384),0);
        }
        chunk.columns = buildColumnGrid(cx, cz, p.tile.z, colX, colZ, colTop, colR);
        chunk.meta = bld.meta ?? null; // round 18 roof/selection telemetry
        // --- Round 19 (C GROUNDTRUTH) — HOUSE-LIGHT ANCHORS -------------------
        // bld.housePts (A HOMESTEAD, frozen v15) is the TILE-LOCAL [x,z] list
        // of small-band houses — the same anchors the loop above just walked,
        // so each one resolves to a real per-building DEM ground by exact
        // Float32 equality (both sides are the SAME worker value quantised the
        // same way). Result: [wx, groundY, wz] triples in ABSOLUTE world, which
        // is what SatHouseLights places into its pool.
        //
        // Built ONCE per chunk, never per frame, and only when the feature is
        // on — SUBURB_NIGHT.enabled false leaves chunk.house null and this
        // whole block unentered (the one-flag rollback).
        chunk.house = null;
        const hp = SUBURB_NIGHT.enabled ? bld.housePts : null;
        if (hp && hp.length >= 2) {
          const gy = new Map();
          for (let c = 0; c < colX.length; c++) {
            gy.set(`${colX[c] - cx},${colZ[c] - cz}`, colGY[c]);
          }
          const nH = hp.length / 2;
          const outH = new Float32Array(nH * 3);
          // R24 B (HEAL_IN_PLACE): which RUN each surviving house resolved to,
          // so an in-place re-drape moves its porch light with its building.
          const houseRun = chunk.redrape ? new Int32Array(nH) : null;
          const runOf = new Map();
          if (houseRun) for (let c = 0; c < colX.length; c++) runOf.set(`${colX[c] - cx},${colZ[c] - cz}`, c);
          let m = 0;
          for (let i = 0; i < nH; i++) {
            const hx = hp[i * 2];
            const hz = hp[i * 2 + 1];
            const g = gy.get(`${hx},${hz}`);
            // A house whose anchor did not survive selection has no ground and
            // is DROPPED, never floated at y=0 (the sea-level-forest failure
            // mode the veg engine holds against, same reasoning).
            if (g === undefined) continue;
            const drapeRun = drapeByAnchor?.get(`${hx},${hz}`);
            if (drapeRun) drapeRun.house = m;
            outH[m * 3] = cx + hx;
            outH[m * 3 + 1] = g;
            outH[m * 3 + 2] = cz + hz;
            if (houseRun) houseRun[m] = runOf.get(`${hx},${hz}`) ?? -1;
            m += 1;
          }
          if (m > 0) chunk.house = m === nH ? outH : outH.subarray(0, m * 3);
          if (m > 0 && houseRun) chunk.houseRun = m === nH ? houseRun : houseRun.subarray(0, m);
        }
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(pos, 3));
        // WORLD PASS B (workerPrep): packed colours / normals decode as normalized
        // (bld.prep is absent with the flag off: the shipped constructor args).
        geo.setAttribute('color', new BufferAttribute(bld.col, 3, !!bld.prep?.colNormalized));
        if (bld.style) geo.setAttribute('aBuildingStyle', new BufferAttribute(bld.style, 3));
        geo.setAttribute('aBendAnchor', new BufferAttribute(bld.anchor, 2));
        // Facade uv (round 15). Always uploaded — the tier gate swaps the
        // MATERIAL, so a tier change must never require re-streaming a chunk.
        // Belt-and-braces for a bundle that somehow arrives without it: fall back
        // to the neutral (roof) uv everywhere = no windows, never a wrong sample.
        geo.setAttribute(
          'uv',
          new BufferAttribute(
            bld.uv && bld.uv.length === nV * 2
              ? bld.uv
              : new Float32Array(nV * 2).fill(SAT_BUILDINGS.facade.neutralUV),
            2
          )
        );
        // R24 B (FLASH_GUARD) — drop the ring-closure zero-area wall triangles
        // BEFORE the index is uploaded and BEFORE normals are computed. A
        // degenerate's face normal is (0,0,0), so removing it cannot change any
        // vertex normal: this is shading-neutral by construction. Flag-off (or
        // __flyFlashPin='off') returns bld.idx by reference — byte-identical.
        const fg = guardArchitectureIndex(bld.idx, pos, bld.meta?.auxiliaryIndexCount);
        this._stat.degenerateDropped += fg.dropped;
        const partition = partitionArchitectureIndex(fg.idx, pos, fg.auxiliaryCount, bld.anchor);
        geo.setIndex(new BufferAttribute(partition.index, 1));
        if (partition.regions.length) geo.userData.architectureRegions = partition.regions;
        if (fg.auxiliaryCount !== null) geo.userData.auxiliaryIndexCount = fg.auxiliaryCount;
        this._stat.degenDropped += fg.dropped;
        this._stat.degenScanned += bld.idx.length / 3;
        if (fg.dropped) this._stat.degenChunks++;
        if (bld.normal?.length === pos.length) geo.setAttribute('normal', new BufferAttribute(bld.normal, 3, !!bld.prep?.normalPacked));
        else geo.computeVertexNormals(); // older/Classic bundles retain the fallback
        geo.computeBoundingSphere();
        // R21 (P1) — THE BEND MARGIN. The anchor-bend shader drops each block
        // by d²·k; the sphere just computed is the UNBENT one, so a chunk at
        // the ring edge false-culls the moment the camera turns. Worst case for
        // this ring = its evict radius + the tile's half-diagonal.
        const bpad = this._bendPad(p.tile.z);
        if (geo.boundingSphere) geo.boundingSphere.radius += bpad;
        const mesh = new Mesh(geo, this.material);
        installArchitectureShadowRange(mesh);
        mesh.userData.bendMarginM = bpad; // R21 SANCTIONED INSTRUMENT (E CERT)
        mesh.position.set(cx, 0, cz);
        mesh.frustumCulled = true;
        // Round 19 — SAT_SHADOWS: the two mesh flags this layer owns. Inert
        // until B DEEPFIELD's directional actually casts (and pinned neutral
        // fleet-wide by __flySatShadowOverride), so this is a byte-noop today.
        mesh.castShadow = this._shadows;
        mesh.receiveShadow = this._shadows;
        this.object.add(mesh);
        chunk.mesh = mesh;
        this._startBirth(mesh, nowSec);
      }

      // Round 13 (P4): water-glint mesh (one merged additive plane, draped to the
      // chunk-center ground — harbors/lakes read flat at their local water level).
      const water = p.result.satWater;
      // R21: the mesh build moved verbatim into _attachWater so the in-place
      // water backfill (S4) and this path can never drift apart. It sets
      // chunk.water + chunk.waterY exactly as the inline block did, and applies
      // the P1 bend margin to the flat plane (which the water bend shader drops
      // the same way).
      if (water && this.waterEnabled && this._waterKeys.has(p.key)) {
        const tw = arrival ? performance.now() : 0;
        this._attachWater(chunk, water);
        if (arrival) { const d = performance.now() - tw, T = this._wp.finPh; if (T && d > T.water) T.water = d; }
      }
      chunk.state = 'ready';
      // R24 (B) — RING_HOLD (2) reads this stamp. Set where the chunk becomes
      // DRAWABLE (not where it was requested), because a minimum residency on a
      // request would protect a hole rather than a building. `chunk.cx/cz` are
      // resolved a few lines above, so the record is judgeable from here on.
      chunk.readyAt = nowSec;
      // WORLD PASS W0 counters: finalize cost, and the first detailed tile
      // drawn since the last arm or warp (a tile of the current desired set).
      const W = this._wp;
      W.finalizeMsLast = performance.now() - wpT;
      if (arrival && A.uploads) this._commitTook(W.finalizeMsLast); // r2b: the commit's cost, for _commitFits
      if (W.finalizeMsLast > W.finalizeMsMax) W.finalizeMsMax = W.finalizeMsLast;
      if (W.firstTileSec == null && chunk.mesh && W.desiredAt >= W.armAt && this._wpKeep?.has(p.key)) W.firstTileSec = nowSec - W.armAt;
    }
    } finally {
      // WORLD PASS B: this frame's finalize work, slices included (the hitch measure).
      if (A.on) {
        const ms = performance.now() - frameT0;
        if (A.uploads && !wpYield) wpSliceSpend(FR.pre + FR.fin); // r2b: the frame's World Pass allowance (slices and commits, not the readiness scan)
        if (ms > (this._wp.frameMsMax ?? 0)) {
          this._wp.frameMsMax = ms;
          // r2: the worst frame's split (ms): readiness checks, the sliced run walk
          // and guard, the finalize proper, and whatever is left (a GC pause, water).
          this._wp.frameWorst = { ms, ready: FR.ready, pre: FR.pre, fin: FR.fin, tiles: FR.tiles, rest: ms - FR.ready - FR.pre - FR.fin };
        }
      }
    }
  }

  /**
   * WORLD PASS B (drapeCap): finalize by run. The shipped finalize, with the
   * per-vertex ground array, the string-keyed drape map and the per-vertex
   * anchor compare replaced by the runs the drape already holds. Produces the
   * same records (collision columns, heal-in-place record, contact runs, porch
   * lights) and the same mesh.
   */
  _finalizeArrival(p, chunk, bld, cx, cz, nowSec) {
    const T = this._wp.finPh ??= { drape: 0, records: 0, guard: 0, partition: 0, attrs: 0, bounds: 0, mesh: 0, birth: 0, water: 0 };
    const TS = this._wp.finSum ??= { n: 0, total: 0 };
    const t00 = performance.now();
    // r2b: every step before the commit (run walk, guard, records, partition,
    // geometry) is resumable and, on the uploads path, already ran in slices
    // over earlier frames (_prefinalizeArrival). Whatever has not run yet runs
    // here in one go (the uploads sub-switch off, or a non-prep bundle).
    this._prepArrival(p, bld, cx, cz, Infinity);
    let tp = performance.now();
    const lap = (k) => { const t = performance.now(); if (t - tp > T[k]) T[k] = t - tp; TS[k] = (TS[k] ?? 0) + (t - tp); tp = t; };
    const S = p.pf, rec = S.rec, geo = S.geo, fg = S.fg;
    chunk.unsettled = S.unsettled;
    // Two ground records exist per building: HEAL_IN_PLACE's `redrape.gy` (the
    // shipped re-drape, which writes metres into a Float32 position buffer)
    // and the contact repair's `run.ground` (repairArrivalRun / _footing).
    // They never both act on one chunk ONLY because the heal loop in
    // _refreshDesired skips every chunk with `drapeRuns` in Enhanced, and an
    // arrival chunk always has them; neither updates the other's record. A
    // quantized chunk (r2) carries no redrape record at all, so a future
    // caller of _queueRedrape degrades to evict-and-rebuild instead of writing
    // metres into Int16 lattice steps.
    chunk.q = S.q; // r2 (quantize): { oy, clamped } or null
    chunk.redrape = rec.redrape;
    chunk.drapeRuns = S.drapeRuns;
    chunk.contactOversizeCount = S.oversize;
    chunk.columns = rec.columns;
    chunk.meta = bld.meta ?? null;
    chunk.house = rec.house;
    if (rec.houseRun) chunk.houseRun = rec.houseRun;
    if (rec.foot) chunk.foot = rec.foot;
    this._stat.degenerateDropped += fg.dropped;
    this._stat.degenDropped += fg.dropped;
    this._stat.degenScanned += bld.idx.length / 3;
    if (fg.dropped) this._stat.degenChunks++;
    lap('records');
    const mesh = new Mesh(geo, this.material);
    // installArchitectureShadowRange recomputes the box with a vertex walk; the
    // run box already bounds every vertex, so that one call keeps it.
    if (S.runBounds) geo.computeBoundingBox = keepBoundingBox;
    installArchitectureShadowRange(mesh);
    if (S.runBounds) delete geo.computeBoundingBox;
    mesh.userData.bendMarginM = S.bpad;
    mesh.position.set(cx, S.q ? S.q.oy : 0, cz); // r2 (quantize): the lattice origin sits at the tile's median ground
    if (S.q) mesh.customDepthMaterial = quantDepthMaterial(); // the shadow pass decodes the lattice too
    mesh.frustumCulled = true;
    mesh.castShadow = this._shadows;
    mesh.receiveShadow = this._shadows;
    this.object.add(mesh);
    chunk.mesh = mesh;
    if (S.q) this._quantCompile(mesh);
    if (S.q?.clamped) this._stat.quantClamped = (this._stat.quantClamped ?? 0) + S.q.clamped;
    chunk.bytes = bundleBytes(bld); // r2: the byte budget of the ring kept behind
    lap('mesh');
    this._startBirth(mesh, nowSec);
    lap('birth');
    TS.n += 1;
    TS.total += performance.now() - t00;
  }

  /**
   * WORLD PASS B r2b: everything a tile's finalize computes before its mesh
   * exists, as resumable steps under `deadline` (performance.now ms): the run
   * walk, the FLASH_GUARD scan, the records (collision columns, porch lights,
   * heal record), the body partition, the geometry (attributes, bounds). A
   * step is begun only while time is left, and the long ones check the clock
   * inside. True when all are done; the commit (_finalizeArrival) is then a
   * mesh and a few assignments. The results are the shipped finalize's,
   * computed in the same order on the same data.
   */
  _prepArrival(p, bld, cx, cz, deadline, sliced = false) {
    const T = this._wp.finPh ??= { drape: 0, records: 0, guard: 0, partition: 0, attrs: 0, bounds: 0, mesh: 0, birth: 0, water: 0 };
    const late = () => !(sliced && this._sliceFresh) && performance.now() > deadline; // a fresh slice always begins one step
    const step = (k, t) => { const d = performance.now() - t; if (d > T[k]) T[k] = d; };
    // r2b: a step that cannot be sliced is begun only when its expected cost
    // (a decaying maximum of what it has cost) fits what is left of the slice,
    // or when no slice work has run yet this frame (so it always progresses:
    // at worst it opens a fresh frame's slice instead of ending a used one).
    const E = (this._stepEst ??= {});
    const fits = (k) => !sliced || this._sliceFresh || performance.now() + (E[k] ?? 0) <= deadline;
    const took = (k, t) => { const d = performance.now() - t; E[k] = Math.max(d, (E[k] ?? 0) * 0.85); this._sliceFresh = false; };
    const prep = bld.prep?.runMaxY ? bld.prep : null;
    if (sliced && late()) return !!p.pf?.geo; // no step resumes once this frame's slice is spent
    if (!p.pf) { if (!fits('begin')) return false; const t = performance.now(); p.pf = this._runWalkBegin(p, bld, cx, cz); took('begin', t); }
    const S = p.pf;
    if (!S.walked) { const t = performance.now(); const ok = this._runWalkStep(S, p, bld, deadline); step('drape', t); this._sliceFresh = false; if (!ok) return false; }
    if (!S.fg) {
      const t = performance.now();
      if (prep && (sliced || S.q)) {
        if (!S.guard) {
          if (late() || !fits('guardBegin')) return false;
          const tb = performance.now();
          S.guard = guardSliceBegin(bld.idx, bld.meta?.auxiliaryIndexCount);
          if (S.q) S.guard.stride = 4; // r2 (quantize): Int16 lattice, 4 per vertex (exact integer test)
          S.guard.every = 2048; // r2b: the clock every 2,048 triangles (one 8,192 batch read 8 ms once, cold)
          // r2: the worker's body regions, so a dropped triangle shortens its region instead of forcing a main-thread re-partition
          const R = bld.prep?.regions, nReg = R ? R.length / 12 : 0;
          if (nReg) { const b = new Float64Array(nReg + 1); for (let k = 0; k < nReg; k++) b[k] = R[k * 12]; b[nReg] = R[(nReg - 1) * 12] + R[(nReg - 1) * 12 + 1]; S.guard.bounds = b; }
          took('guardBegin', tb);
        }
        const ok = guardSliceStep(S.guard, bld.pos, deadline);
        step('guard', t);
        this._sliceFresh = false;
        if (!ok) return false;
        S.fg = S.guard.result;
      } else {
        if (late() || !fits('guardWhole')) return false;
        // FLASH_GUARD stays the guard (the worker's prep already removed the
        // closed-ring quads; what is left here should be nothing).
        S.fg = guardArchitectureIndex(bld.idx, bld.pos, bld.meta?.auxiliaryIndexCount);
        step('guard', t);
        took('guardWhole', t);
      }
    }
    if (!S.rec?.done) {
      if (!S.rec) { if (late()) return false; S.rec = { col: null, done: false, houses: false }; }
      const t = performance.now();
      const ok = this._recordsStep(S, p, bld, cx, cz, deadline, fits, took);
      step('records', t);
      this._sliceFresh = false;
      if (!ok) return false;
    }
    if (!S.partition) {
      if (late() || !fits('partition')) return false;
      const t = performance.now();
      S.partition = this._partition(S.fg, bld.pos, bld, p.runs, p.g, S.drapeRuns, S.q);
      step('partition', t);
      took('partition', t);
    }
    if (!S.geo) {
      if (late() || !fits('geometry')) return false;
      const t = performance.now();
      this._geometryStep(S, p, bld);
      step('attrs', t);
      took('geometry', t);
    }
    // the commit (mesh, scene add, birth, water) is the caller's; it asks commitFits()
    return true;
  }

  /** r2b: whether the commit of a prepared tile fits what is left of this frame's slice (same rule as a step). */
  _commitFits(deadline) {
    return this._sliceFresh || performance.now() + (this._stepEst?.commit ?? 0) <= deadline;
  }

  /** r2b: record what a commit cost (the decaying maximum _commitFits reads). */
  _commitTook(ms) {
    const E = (this._stepEst ??= {});
    E.commit = Math.max(ms, (E.commit ?? 0) * 0.85);
    this._sliceFresh = false;
  }

  /** r2b: the records step (collision columns in slices, then porch lights and the heal record). */
  _recordsStep(S, p, bld, cx, cz, deadline, fits = () => true, took = () => {}) {
    const rec = S.rec, R = p.runs, nR = R.count, g = p.g;
    const prep = bld.prep?.runMaxY ? bld.prep : null;
    if (!rec.col) rec.col = columnGridBegin(cx, cz, p.tile.z, nR);
    if (!columnGridStep(rec.col, S.colX, S.colZ, S.colTop, S.colR, deadline)) return false;
    if (!rec.houses) {
      if (!rec.H) {
        if (performance.now() > deadline || !fits('houses')) return false;
        const th = performance.now();
        rec.columns = rec.col.grid;
        rec.redrape = HEAL_IN_PLACE.enabled && !S.q ? { ax: R.ax, az: R.az, start: R.start, gy: Float32Array.from(g) } : null;
        // M4 footings: the worker's per-run wall-bottom vertices and footprint
        // extremes (workerPrep); the contact repair carries those walls down to the
        // lowest drawn ground under the extremes.
        rec.foot = this._arr.footings && prep?.footStart ? { bottom: prep.footBottom, bs: prep.footStart, xz: prep.footXZ } : null;
        rec.house = null;
        rec.houseRun = null;
        const hp = SUBURB_NIGHT.enabled ? bld.housePts : null;
        rec.H = hp && hp.length >= 2
          ? { hp, nH: hp.length / 2, i: 0, m: 0, cursor: 0, runOf: null, outH: new Float32Array(hp.length * 1.5), houseRun: rec.redrape ? new Int32Array(hp.length / 2) : null }
          : { nH: 0, i: 0 };
        took('houses', th);
      }
      // Porch lights (SUBURB_NIGHT): each house anchor resolves to its run by
      // exact anchor equality (both sides are the worker's Float32 values).
      // House anchors are emitted in building order, as the runs are: walk both
      // in step (no string keys); an anchor out of order falls back to a map.
      // r2b: resumable, the clock read every 256 houses.
      const H = rec.H;
      const findRun = (hx, hz) => {
        for (let r = H.cursor; r < nR; r++) if (R.ax[r] === hx && R.az[r] === hz) { H.cursor = r + 1; return r; }
        if (!H.runOf) { H.runOf = new Map(); for (let r = 0; r < nR; r++) H.runOf.set(`${R.ax[r]},${R.az[r]}`, r); }
        return H.runOf.get(`${hx},${hz}`);
      };
      const i0 = H.i;
      for (; H.i < H.nH; H.i++) {
        if (H.i > i0 && (H.i & 255) === 0 && performance.now() > deadline) return false;
        const i = H.i, hx = H.hp[i * 2], hz = H.hp[i * 2 + 1], r = findRun(hx, hz);
        if (r === undefined) continue;
        S.drapeRuns[r].house = H.m;
        H.outH[H.m * 3] = cx + hx;
        H.outH[H.m * 3 + 1] = g[r];
        H.outH[H.m * 3 + 2] = cz + hz;
        if (H.houseRun) H.houseRun[H.m] = r;
        H.m += 1;
      }
      if (H.m > 0) rec.house = H.m === H.nH ? H.outH : H.outH.subarray(0, H.m * 3);
      if (H.m > 0 && H.houseRun) rec.houseRun = H.m === H.nH ? H.houseRun : H.houseRun.subarray(0, H.m);
      rec.H = null;
      rec.houses = true;
    }
    rec.done = true;
    return true;
  }

  /** r2b: the geometry step (attributes, index, normals, bounds); the mesh is made in the commit. */
  _geometryStep(S, p, bld) {
    const pos = bld.pos, nV = bld.anchor.length / 2, nR = p.runs.count;
    const prep = bld.prep?.runMaxY ? bld.prep : null;
    const geo = new BufferGeometry();
    if (S.q) {
      // r2 (quantize): normalized Int16 on the lattice; the accessors read
      // metres (uv units), the patched materials decode the same on the GPU.
      if (!this.material.userData.wpQuant) patchQuantMaterial(this.material);
      geo.setAttribute('position', new WpQuantAttribute(pos, 4, 1 / WPQ_POS_K));
      geo.setAttribute('color', new BufferAttribute(bld.col, 3, !!bld.prep?.colNormalized));
      if (bld.style) geo.setAttribute('aBuildingStyle', new BufferAttribute(bld.style, 3));
      geo.setAttribute('aBendAnchor', new WpQuantAttribute(bld.anchor, 2, 1 / WPQ_POS_K));
      geo.setAttribute('uv', new WpQuantAttribute(bld.uv, 2, 1 / WPQ_UV_K));
    } else {
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('color', new BufferAttribute(bld.col, 3, !!bld.prep?.colNormalized));
      if (bld.style) geo.setAttribute('aBuildingStyle', new BufferAttribute(bld.style, 3));
      geo.setAttribute('aBendAnchor', new BufferAttribute(bld.anchor, 2));
      geo.setAttribute('uv', new BufferAttribute(bld.uv && bld.uv.length === nV * 2 ? bld.uv : new Float32Array(nV * 2).fill(SAT_BUILDINGS.facade.neutralUV), 2));
    }
    const partition = S.partition, fg = S.fg;
    geo.setIndex(new BufferAttribute(partition.index, 1));
    if (partition.regions.length) geo.userData.architectureRegions = partition.regions;
    if (fg.auxiliaryCount !== null) geo.userData.auxiliaryIndexCount = fg.auxiliaryCount;
    if (bld.normal?.length === nV * 3) geo.setAttribute('normal', new BufferAttribute(bld.normal, 3, !!bld.prep?.normalPacked));
    else geo.computeVertexNormals();
    const runBounds = !!prep && nR > 0 && S.by1 >= S.by0;
    if (runBounds) {
      geo.boundingBox = new Box3();
      geo.boundingBox.min.set(S.bx0, S.by0, S.bz0);
      geo.boundingBox.max.set(S.bx1, S.by1, S.bz1);
      geo.boundingSphere = geo.boundingBox.getBoundingSphere(new Sphere());
    } else geo.computeBoundingSphere();
    const bpad = this._bendPad(p.tile.z);
    if (geo.boundingSphere) geo.boundingSphere.radius += bpad;
    S.runBounds = runBounds;
    S.bpad = bpad;
    S.geo = geo;
  }

  /**
   * WORLD PASS B: the finalize's run walk as a resumable step. Adds each run's
   * ground to its vertices and builds the collision columns, the contact runs
   * and the run box. `_runWalkStep` stops at `deadline` and resumes on the
   * next call; nothing else reads the bundle until the walk is done.
   */
  _runWalkBegin(p, bld, cx, cz) {
    const nR = p.runs.count;
    // r2 (quantize): the mesh origin's height, the tile's median ground in
    // whole metres, so every run's local Y fits the Int16 lattice.
    let q = null;
    if (bld.prep?.posQ) {
      const gs = Float64Array.from(p.g).sort();
      q = { oy: nR ? Math.round(gs[nR >> 1]) : 0, clamped: 0 };
    }
    return {
      r: 0, walked: false, cx, cz, q,
      colX: new Float64Array(nR), colZ: new Float64Array(nR), colTop: new Float64Array(nR), colR: new Float64Array(nR),
      drapeRuns: new Array(nR), unsettled: 0, oversize: 0,
      bx0: Infinity, bx1: -Infinity, by0: Infinity, by1: -Infinity, bz0: Infinity, bz1: -Infinity,
      guard: null,
    };
  }

  _runWalkStep(S, p, bld, deadline) {
    const pos = bld.pos, R = p.runs, nR = R.count, g = p.g, fb = p.fb ?? null;
    const honestZ = this._arr.cfg.honestZ;
    const prep = bld.prep?.runMaxY ? bld.prep : null;
    const foot = this._arr.footings && prep?.footStart ? prep.footStart : null;
    const { colX, colZ, colTop, colR, drapeRuns, cx, cz } = S;
    let r = S.r;
    // r2b: the clock is read every 64 runs or every 4,096 vertices, whichever
    // comes first (a run of a few hundred tall towers overshot a 64-run check),
    // and at least one run is walked a call.
    const r0 = r;
    let work = 0;
    for (; r < nR; r++) {
      if (r > r0 && ((r & 63) === 0 || work >= 4096)) { work = 0; if (performance.now() > deadline) break; }
      const gr = g[r], ax = R.ax[r], az = R.az[r], v0 = R.start[r], v1 = R.start[r + 1];
      work += v1 - v0;
      let run = null;
      if (S.q) {
        // r2 (quantize): add the run's ground in lattice steps; bounds are
        // mesh-local (relative to the origin height S.q.oy), as drawn.
        run = { qMin0: Math.round(prep.runMinY[r] * WPQ_POS_K), qMax: Math.round(prep.runMaxY[r] * WPQ_POS_K), gq: 0 };
        run.qMin = run.qMin0;
        const gq = quantGround(gr, S.q, run);
        run.gq = gq;
        addRunYQ(pos, v0, v1, gq);
        colTop[r] = prep.runMaxY[r] + gr;
        colR[r] = prep.runR[r];
        const rr = colR[r], lo = (run.qMin0 + gq) / WPQ_POS_K, hi = (run.qMax + gq) / WPQ_POS_K;
        if (ax - rr < S.bx0) S.bx0 = ax - rr;
        if (ax + rr > S.bx1) S.bx1 = ax + rr;
        if (az - rr < S.bz0) S.bz0 = az - rr;
        if (az + rr > S.bz1) S.bz1 = az + rr;
        if (lo < S.by0) S.by0 = lo;
        if (hi > S.by1) S.by1 = hi;
      } else if (prep) {
        addRunY(pos, v0, v1, gr);
        colTop[r] = prep.runMaxY[r] + gr;
        colR[r] = prep.runR[r];
        const rr = colR[r], lo = prep.runMinY[r] + gr;
        if (ax - rr < S.bx0) S.bx0 = ax - rr;
        if (ax + rr > S.bx1) S.bx1 = ax + rr;
        if (az - rr < S.bz0) S.bz0 = az - rr;
        if (az + rr > S.bz1) S.bz1 = az + rr;
        if (lo < S.by0) S.by0 = lo;
        if (colTop[r] > S.by1) S.by1 = colTop[r];
      } else {
        let top = -Infinity, r2 = 0;
        for (let v = v0 * 3, e = v1 * 3; v < e; v += 3) {
          pos[v + 1] += gr;
          const y = pos[v + 1];
          if (y > top) top = y;
          const dx = pos[v] - ax, dz = pos[v + 2] - az, d2 = dx * dx + dz * dz;
          if (d2 > r2) r2 = d2;
        }
        colTop[r] = top;
        colR[r] = Math.sqrt(r2);
      }
      colX[r] = cx + ax;
      colZ[r] = cz + az;
      const isFb = !!(fb && fb[r]);
      const valid = !isFb && p.gz[r] >= honestZ;
      if (!valid) S.unsettled += 1;
      if (v1 - v0 > 16384) S.oversize += 1;
      const rec = { start: v0, end: v1, ax, az, ground: gr, zoom: p.gz[r], valid, fb: isFb, column: r, house: -1 };
      if (run) Object.assign(rec, run); // r2 (quantize): qMin0, qMin, qMax, gq
      if (foot && foot[r + 1] > foot[r]) { rec.footDelta = 0; rec.footZoom = 0; rec.footing = true; }
      drapeRuns[r] = rec;
    }
    S.r = r;
    S.walked = r >= nR;
    return S.walked;
  }

  /**
   * WORLD PASS B (uploads): a dense tile's finalize in slices under a
   * per-frame time budget, so no frame carries a whole Manhattan tile. r2b:
   * every step but the commit (see _prepArrival), not only the run walk and
   * the guard. True when the tile is ready for the commit.
   */
  _prefinalizeArrival(p, bld, cx, cz, deadline) {
    return this._prepArrival(p, bld, cx, cz, deadline, true);
  }

  /**
   * The body partition: from the worker's prep (workerPrep: the same buckets,
   * already ordered) or computed here as before. Region heights are bounded
   * from the runs each region touches (local extent + the run's ground), a
   * superset of the vertex walk's bounds. If FLASH_GUARD dropped anything the
   * worker's ranges no longer line up and the partition is recomputed here.
   */
  _partition(fg, pos, bld, R, g, runs = null, q = null) {
    const P = bld.prep;
    // r2 (quantize): the shipped partition reads Float32 metres, stride 3; on the
    // rare fallback it gets a dequantized copy (local to the lattice origin).
    const kept = fg.dropped && fg.regionKept && P?.regions && fg.regionKept.length === P.regions.length / 12 ? fg.regionKept : null;
    if (!P?.regions || (fg.dropped && !kept) || fg.auxiliaryCount === null) {
      if (P) {
        // r2: a worker partition that could not be used, and why (the main-thread partition costs tens of ms on a dense tile)
        this._stat.partitionFallbacks = (this._stat.partitionFallbacks ?? 0) + 1;
        this._stat.partitionFallbackWhy = `${!P.regions ? 'no-regions ' : ''}${fg.dropped ? `dropped-${fg.dropped} ` : ''}${fg.auxiliaryCount === null ? 'no-aux' : ''}${q ? ' q' : ''}`;
      }
      if (!q) return partitionArchitectureIndex(fg.idx, pos, fg.auxiliaryCount, bld.anchor);
      const k = 1 / WPQ_POS_K, a = new Float32Array(bld.anchor.length);
      for (let i = 0; i < a.length; i++) a[i] = bld.anchor[i] * k;
      return partitionArchitectureIndex(fg.idx, dequantPositions(pos), fg.auxiliaryCount, a);
    }
    const regions = [], n = P.regions.length / 12;
    let at = 0; // r2: with drops, each region keeps its triangles, shortened, in the same order
    if (kept) this._stat.guardDropsKeptPartition = (this._stat.guardDropsKeptPartition ?? 0) + 1;
    for (let k = 0; k < n; k++) {
      const o = k * 12, Q = P.regions;
      const start = kept ? at : Q[o], count = kept ? kept[k] : Q[o + 1];
      at += count;
      if (!count) continue;
      let minY = Infinity, maxY = -Infinity;
      for (let j = P.regionRunStart[k]; j < P.regionRunStart[k + 1]; j++) {
        const r = P.regionRuns[j];
        const lo = q ? (runs[r].qMin0 + runs[r].gq) / WPQ_POS_K : P.runMinY[r] + g[r], hi = q ? (runs[r].qMax + runs[r].gq) / WPQ_POS_K : P.runMaxY[r] + g[r];
        if (lo < minY) minY = lo;
        if (hi > maxY) maxY = hi;
      }
      const bounds = new Box3();
      bounds.min.set(Q[o + 2], minY, Q[o + 4]);
      bounds.max.set(Q[o + 5], maxY, Q[o + 7]);
      const anchors = new Box3();
      anchors.min.set(Q[o + 8], 0, Q[o + 9]);
      anchors.max.set(Q[o + 10], 0, Q[o + 11]);
      regions.push({ start, count, bounds, anchors, minY, maxY });
    }
    return { index: fg.idx, regions };
  }

  // --- round 18: neighbour-gated OCEAN FILL (the satWater sawtooth fix) -------
  // OpenFreeMap has no tile at all for pure open water, so the R13 glint ended
  // in a straight line at a tile boundary and picked up again at the next one —
  // over the Hudson/NY Bight that reads as a sawtooth of shimmer and dead
  // concrete. Rather than inventing water wherever a fetch fails, this asks the
  // NEIGHBOURS: a candidate is bridged only if at least `neighborMin` of its
  // four ring-neighbours reported real `waterCoverage ≥ coverageMin` from the
  // worker. So a 404 in the middle of a harbour fills; a 404 over empty desert
  // (dry neighbours) never does. The synthesized quad is 2 triangles on the
  // SAME shared glint material, sits at the neighbours' average water Y, and is
  // counted inside SAT_WATER.maxWaterChunks — it can never push the draw count
  // past the bound that already existed. High tier only (it rides waterEnabled).
  _oceanFill() {
    const O = SAT_WATER.oceanFill;
    if (this._disposed || !this.waterEnabled || !O || !O.enabled) return;
    let waterCount = 0;
    for (const c of this.chunks.values()) if (c.water) waterCount += 1;
    if (waterCount >= SAT_WATER.maxWaterChunks) return;
    const NB = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [key, chunk] of this.chunks) {
      if (waterCount >= SAT_WATER.maxWaterChunks) break;
      if (!chunk.oceanCandidate || chunk.water || !chunk.tile) continue;
      if (!this._waterKeys.has(key)) continue; // round 19: the nearest-N water bound
      const t = chunk.tile;
      let wet = 0;
      let ySum = 0;
      let yN = 0;
      for (const [dx, dy] of NB) {
        const n = this.chunks.get(`${t.z}/${t.x + dx}/${t.y + dy}`);
        if (!n || (n.waterCoverage ?? 0) < O.coverageMin) continue;
        wet += 1;
        if (Number.isFinite(n.waterY)) {
          ySum += n.waterY;
          yN += 1;
        }
      }
      if (wet < O.neighborMin) continue;

      const span = WORLD_SIZE / 2 ** t.z;
      const cx = -WORLD_SIZE / 2 + t.x * span + span / 2;
      const cz = -(WORLD_SIZE / 2 - t.y * span) + span / 2;
      let waterY;
      if (yN > 0) {
        waterY = ySum / yN;
      } else {
        const g = this.groundAt(
          (cx / EARTH_R) * RAD2DEG,
          (2 * Math.atan(Math.exp(-cz / EARTH_R)) - Math.PI / 2) * RAD2DEG
        );
        waterY = (g?.elev ?? 0) + SAT_WATER.liftM;
      }
      const h = span / 2;
      const inv = 1 / SAT_WATER.rippleM;
      // uv = tile-LOCAL xz / rippleM, exactly like the worker's water polys, so
      // the swell scale matches the real chunks either side of the seam.
      const pos = new Float32Array([-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h]);
      const uv = new Float32Array([
        -h * inv, -h * inv,
        h * inv, -h * inv,
        h * inv, h * inv,
        -h * inv, h * inv,
      ]);
      // Winding chosen so the face normal is +Y — the glint material is
      // FrontSide (three's default), so a flipped quad would be invisible.
      const idx = new Uint16Array([0, 2, 1, 0, 3, 2]);
      const wgeo = new BufferGeometry();
      wgeo.setAttribute('position', new BufferAttribute(pos, 3));
      wgeo.setAttribute('uv', new BufferAttribute(uv, 2));
      wgeo.setIndex(new BufferAttribute(idx, 1));
      wgeo.computeVertexNormals();
      wgeo.computeBoundingSphere();
      const opad = this._bendPad(t.z); // R21 (P1)
      if (wgeo.boundingSphere) wgeo.boundingSphere.radius += opad;
      const wmesh = new Mesh(wgeo, this._ensureWaterMaterial());
      wmesh.userData.bendMarginM = opad; // R21 SANCTIONED INSTRUMENT (E CERT)
      wmesh.position.set(cx, waterY, cz);
      wmesh.frustumCulled = true;
      // Match _attachWater: reverse-Z reverses renderOrder as well as depth.
      wmesh.renderOrder = satelliteVisualsOn('water') ? -3 : 3;
      this.object.add(wmesh);
      chunk.water = wmesh;
      chunk.waterY = waterY;
      chunk.waterSynth = true;
      if (satelliteVisualsOn('water')) this._prepareWaterSurface(chunk);
      waterCount += 1;
    }
  }

  /**
   * Round 18 — A5 GRAVITY's building-collision source. Returns the bounding
   * cylinders {x, z, topY, r} (absolute world) whose bucket overlaps the query
   * box, from every streamed chunk. Bucket lookup only: no per-column distance
   * math, no allocation beyond the result. Production path — this is NOT
   * dev-gated, and it answers with an empty array when nothing has streamed
   * (toy style, low tier, cruise altitude) so the caller needs no style test.
   */
  queryColumns(px, pz, r = 0) {
    const out = [];
    if (this._disposed) return out;
    for (const chunk of this.chunks.values()) {
      const C = chunk.columns;
      if (!C || C.count === 0) continue;
      if (px + r < C.minX || px - r > C.maxX || pz + r < C.minZ || pz - r > C.maxZ) continue;
      const N = C.n;
      const bx0 = clampIdx(Math.floor((px - r - C.minX) / C.cell), N);
      const bx1 = clampIdx(Math.floor((px + r - C.minX) / C.cell), N);
      const bz0 = clampIdx(Math.floor((pz - r - C.minZ) / C.cell), N);
      const bz1 = clampIdx(Math.floor((pz + r - C.minZ) / C.cell), N);
      for (let bz = bz0; bz <= bz1; bz++) {
        for (let bx = bx0; bx <= bx1; bx++) {
          const list = C.buckets[bz * N + bx];
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const o = list[i] * 4;
            out.push({ x: C.data[o], z: C.data[o + 1], topY: C.data[o + 2], r: C.data[o + 3] });
          }
        }
      }
    }
    return out;
  }

  _evict(key, chunk) {
    if (chunk.mesh) {
      // R24 B (CHUNK_FADE): hand the mesh to the dying set instead of deleting
      // it this frame. It leaves `this.chunks` NOW, so every `ready`/`columns`
      // count is unchanged; only its pixels linger. Bounded by maxDying so the
      // transient draws can never grow a scene's ceiling, and an empty scene
      // (Owens) has nothing to fade ⇒ exactly 0 extra draws by construction.
      if (this._startDeath(chunk.mesh, this._now, chunk.tile)) {
        chunk.mesh = null;
      } else {
        this.object.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
        chunk.mesh = null;
      }
    }
    chunk.columns = null;
    chunk.meta = null;
    chunk.house = null; // round 19 (C): house-light anchors
    chunk.houseRun = null; // R24 B (HEAL_IN_PLACE)
    chunk.redrape = null;
    this._evictWater(chunk);
    this._stat.evictions += 1; // R21: E CERT reads this off engine.stats
    this.chunks.delete(key);
  }

  /** Every detailed tile still drawing, including the 0.3 s eviction tail.
   * Skyline masking must follow rendered pixels, not streaming residency. */
  forEachArchitectureCoverage(visit) {
    for (const chunk of this.chunks.values()) {
      if (chunk.state === 'ready' && chunk.mesh?.visible) {
        visit(chunk.tile, chunk.mesh, chunk.mesh.userData.chunkBirthK ?? 1);
      }
    }
    for (const dying of this._dying) {
      if (dying.mesh.visible) visit(dying.tile, dying.mesh, dying.k);
    }
  }

  /**
   * Round 19 (C GROUNDTRUTH) — house-light anchors from every READY chunk,
   * NEAREST-FIRST: [{ d, pts }] where pts is a Float32Array of [wx, gy, wz]
   * triples in ABSOLUTE world coordinates. Empty array when nothing has
   * streamed, when SUBURB_NIGHT is off, or (the ordinary suburban case) when
   * OpenFreeMap generalised the houses away — SatHouseLights falls back to the
   * residential-landcover scatter for exactly that reason, so an empty answer
   * here is DATA, never an error. Production path, like queryColumns: the
   * caller needs no style test.
   */
  houseAnchors(px, pz) {
    const out = [];
    if (this._disposed) return out;
    for (const chunk of this.chunks.values()) {
      if (chunk.state !== 'ready' || !chunk.house) continue;
      out.push({ d: Math.hypot(chunk.cx - px, chunk.cz - pz), pts: chunk.house });
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  /** Remove just a chunk's water mesh (shared material — geometry only). */
  _evictWater(chunk) {
    if (chunk.water) {
      this.object.remove(chunk.water);
      chunk.water.geometry.dispose();
      chunk.water = null;
      chunk.waterSynth = false;
    }
  }

  /**
   * Round 18 — aggregated roof/selection telemetry across every READY chunk
   * (each chunk carries the worker's per-tile `meta`). verify-roof-variety
   * reads this to gate the suburb small-footprint share, the number of
   * distinct roof forms, and the flat-only share. Cheap enough to call from a
   * probe; nothing reads it per frame.
   */
  get meta() {
    const agg = {
      chunks: 0,
      total: 0,
      kept: 0,
      smallKept: 0,
      forms: {},
      // Round 19 (A HOMESTEAD) typology telemetry — verify-suburbia's gate
      // values. `suburbanInferMaxH` is a MAX over suburban-context chunks
      // only, because the contract it proves ("no untagged building over 14 m
      // in a suburban-context chunk") says nothing about downtown chunks,
      // where the legacy curve legitimately still invents mid-rises.
      suburbanChunks: 0,
      typo: 0,
      typoForms: {},
      houses: 0,
      suburbanInferMaxH: 0,
      inferMaxH: 0,
    };
    for (const c of this.chunks.values()) {
      if (!c.meta) continue;
      agg.chunks += 1;
      agg.total += c.meta.total ?? 0;
      agg.kept += c.meta.kept ?? 0;
      agg.smallKept += c.meta.smallKept ?? 0;
      const f = c.meta.forms ?? {};
      for (const k of Object.keys(f)) agg.forms[k] = (agg.forms[k] ?? 0) + f[k];
      agg.typo += c.meta.typo ?? 0;
      agg.houses += c.meta.houses ?? 0;
      const tf = c.meta.typoForms ?? {};
      for (const k of Object.keys(tf)) agg.typoForms[k] = (agg.typoForms[k] ?? 0) + tf[k];
      const mh = c.meta.inferMaxH ?? 0;
      if (mh > agg.inferMaxH) agg.inferMaxH = mh;
      if (c.meta.suburban) {
        agg.suburbanChunks += 1;
        if (mh > agg.suburbanInferMaxH) agg.suburbanInferMaxH = mh;
      }
    }
    return agg;
  }

  /** Dev telemetry (window.__flyStats.satBuildings*). */
  /**
   * R24 B (FLASH_GUARD) — E CERT's census hook. Walks every RESIDENT chunk
   * mesh (draped positions, the buffers actually on the GPU) and counts
   * exactly-degenerate triangles. RED leg (guard off): 6–9% on dense chunks.
   * GREEN leg (guard on): 0 by construction.
   */
  censusDegenerate() {
    const meshes = [];
    for (const c of this.chunks.values()) if (c.mesh) meshes.push(c.mesh);
    return censusDegenerate(meshes);
  }

  get stats() {
    const families = [0,0,0,0,0,0,0,0];
    let ready = 0; // = BUILDING draw calls (one merged building mesh per chunk)
    let waterReady = 0; // = water-glint draw calls (round 13 P4)
    let waterSynth = 0; // …of which round-18 ocean-fill bridges
    let columns = 0; // round 18: collision cylinders indexed (A5 GRAVITY)
    let empty = 0;
    for (const c of this.chunks.values()) {
      if (c.mesh) ready += 1;
      if (c.water?.visible) waterReady += 1;
      if (c.waterSynth) waterSynth += 1;
      if (c.columns) columns += c.columns.count;
      if (c.state === 'empty') empty += 1;
      c.meta?.families?.forEach((n,i) => { families[i] += n; });
    }
    return {
      chunks: this.chunks.size,
      ...(this.visuals ? { families } : {}),
      ready,
      waterReady,
      waterSynth,
      columns,
      empty,
      queued: this.queue.length,
      building: this.building,
      draping: this.pendingFinalize.length,
      ringOn: this._ringOn,
      // SHIP PASS CITY (CT-1/CT-2): only when a pin or CITY_RANGE moved the band,
      // so the shipped stats keep their key set.
      ...(this._band.source !== 'shipped' && this._band.source !== 'legacy'
        ? { cityBand: { source: this._band.source, fadeStartM: this._band.fadeStartM, fadeEndM: this._band.fadeEndM, evictM: this._band.evictM, lite: this._lite } }
        : {}),
      // Round 21 (B) — streaming telemetry for E CERT. Additive, unflagged.
      emptyByReason: emptyByReason(this.chunks),
      errorRetries: this._stat.errorRetries,
      evictions: this._stat.evictions,
      heals: this._stat.heals,
      degenerateDropped: this._stat.degenerateDropped, // R24 B (FLASH_GUARD)
      // R24 B (CHUNK_FADE) — additive telemetry, both 0 with the flag off.
      // `dying` is the only one that adds draws; `births` never change `ready`.
      births: this._births.length,
      dying: this._dying.length,
      fadeTwins: this._fadePool.size,
      fadeBudgetMiss: this._stat.fadeBudgetMiss,
      // R24 B (HEAL_IN_PLACE) — heals that patched the resident buffer instead
      // of deleting it. healsInPlace + (heals - healsInPlace - healsNoop)
      // evictions is the whole heal budget: with the flag on the second term
      // must be 0 for every chunk that carries a drape record.
      healsInPlace: this._stat.healsInPlace,
      healsNoop: this._stat.healsNoop,
      // R24 B — THE HEAL OUTCOME LEDGER. Exhaustive by construction: every heal
      // lands in exactly one of these, so a harness asserts EQUALITY, not an
      // inequality, and any hole that survives the feature is attributable.
      healsQueueFull: this._stat.healsQueueFull, // budget spent ⇒ evict+refetch
      healsAborted: this._stat.healsAborted, // chunk went away under the job
      healsNoRecord: this._stat.healsNoRecord, // nothing to patch (water-only)
      healsCoalesced: this._stat.healsCoalesced, // a re-drape was already in flight

      redraping: this._redrape.length,
      // R24 B (W3): anchor runs actually re-sampled. This is the FORWARD
      // PROGRESS the minRunsPerFrame floor guarantees, and it is the honest
      // instrument for it — `healsInPlace` can be vetoed by an eviction that
      // has nothing to do with pacing.
      redrapeRuns: this._stat.redrapeRuns,
      ...(this.visuals ? { contactHeals: this._stat.contactHeals,
        contactPending: Math.max(0, (this._contactQueue?.length ?? 0) - (this._contactCursor ?? 0)),
        contactOversize: [...this.chunks.values()].reduce((n, c) => n + (c.contactOversizeCount ?? 0), 0) } : {}),
      // R22.1 (C) — FLASH_GUARD telemetry. Additive, unflagged: all three stay
      // 0 for the whole session when the flag is off, which is what the gate's
      // RED calibration leg asserts.
      degenDropped: this._stat.degenDropped,
      degenScanned: this._stat.degenScanned,
      degenChunks: this._stat.degenChunks,
      waterBackfillArmed: this._backfillArmed, // S4: in-place water scan live
      waterBackfilling: this._waterBuilding,
      ...(this._wpCount ? this._wpStats() : null), // WORLD PASS W0: nothing, and no allocation, with the counters off
    };
  }

  /**
   * WORLD PASS W0 — arrival counters, plain numbers so capture telemetry picks
   * them up. Seconds are on the engine clock from the last ring arm or warp
   * (-1 = not yet). `draping` above is the tiles currently draping.
   */
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
      // WORLD PASS B (ARRIVAL): run retries, runs committed provisionally,
      // runs re-seated in place, and runs not yet on an honest mesh.
      ...(this._arr.on ? { arrivalRetries: this._stat.arrivalRetries, arrivalProvisional: this._stat.arrivalProvisional, arrivalReseats: this._stat.arrivalReseats, footings: this._stat.footings, footGaps: this._stat.footGaps, footMaxDelta: r1(this._stat.footMaxDelta), finalizeFrameMsMax: r1(W.frameMsMax ?? 0), drapeUsPerRun: W.drapeRuns ? Math.round((W.drapeMs / W.drapeRuns) * 1e5) / 100 : -1, // microseconds
        arrivalUnsettled: [...this.chunks.values()].reduce((n, c) => n + (c.unsettled ?? 0), 0), workers: this._pool?.length ?? 1,
        // r2: honest ground under the aircraft (s from the arm / warp), the first tile after it, pool health, quantize, ring kept behind
        groundSec: W.groundSec == null ? -1 : r1(W.groundSec), firstTileAfterGroundSec: W.groundSec == null || W.firstTileSec == null ? -1 : r1(W.firstTileSec - W.groundSec),
        buildTimeouts: this._stat.buildTimeouts, workerChecks: this._stat.workerChecks, workersReplaced: this._stat.workersReplaced, quantClamped: this._stat.quantClamped ?? 0,
        quantCompileMs: this._stat.quantCompileMs ?? -1, guardDropsKeptPartition: this._stat.guardDropsKeptPartition ?? 0, degenDroppedMain: this._stat.degenDropped, partitionFallbacks: this._stat.partitionFallbacks ?? 0, partitionFallbackWhy: this._stat.partitionFallbackWhy ?? '',
        ...(this._wp.frameWorst ? Object.fromEntries(Object.entries(this._wp.frameWorst).map(([k, v]) => ['finWorst_' + k, r1(v)])) : {}),
        quantChunks: this._q ? [...this.chunks.values()].reduce((n, c) => n + (c.q ? 1 : 0), 0) : 0, behindKept: this._stat.behindKept ?? 0, behindDropped: this._stat.behindDropped ?? 0, leadDeferred: this._stat.leadDeferred ?? 0, leadDeferredTotal: this._stat.leadDeferredTotal ?? 0, otherGeoMiB: this._stat.otherGeoMiB ?? null, otherGeoWalkMs: this._stat.otherGeoWalkMs ?? null, ...(this._arr.uploads ? wpFrameSliceStats() : {}),
        ...(this._wp.finPh ? Object.fromEntries(Object.entries(this._wp.finPh).map(([k, v]) => ['finMs_' + k, r1(v)])) : {}),
        ...(this._wp.finSum?.n ? Object.fromEntries(Object.entries(this._wp.finSum).filter(([k]) => k !== 'n').map(([k, v]) => ['finAvg_' + k, Math.round((v / this._wp.finSum.n) * 100) / 100])) : {}) } : {}),
      finalizeMsMax: r1(W.finalizeMsMax),
      finalizeMsLast: r1(W.finalizeMsLast),
      geomBytes: bytes,
      // Diag only (worldPassDiag): the worker's stage counters summed over the
      // resident tiles (ready and empty), lib/fly/toy-world/world-pass-stages.js.
      ...(this._wpDiag ? { wpStages: sumStageRecords([...this.chunks.values()].map((c) => c.wpStages)) } : {}),
    };
  }

  dispose() {
    this._disposed = true;
    // R24 B: BEFORE the evict loop below — a teardown must not defer anything.
    this._hardEvict = true;
    this._flushFades();
    // The fade uniform is module-shared: hand it back at 1 so a re-mount (style
    // flip / StrictMode) never starts a fresh engine mid-dissolve.
    setSatBldgFade(1);
    if (this._lite) setArchitectureLite(false); // SHIP PASS CITY: hand the lite LOD back too
    if (this._cityRange) setArchitectureMergeColor(false);
    for (const [key, chunk] of [...this.chunks]) this._evict(key, chunk);
    this.queue.length = 0;
    this.pendingFinalize.length = 0;
    this._backfillArmed = false; // R21 (S4)
    this._heal.clear(); // R21 (P6)
    this._fadePool.dispose();
    this.material.dispose();
    // R21: _facadeTex/_nightTex now point at the module-scope getFacadeAtlas
    // memo — deliberately NOT disposed (shared across engine lifetimes; the
    // pre-warm retention contract).
    if (this.waterMaterial) this.waterMaterial.dispose();
    if (this._waterTex) this._waterTex.dispose();
  }
}
