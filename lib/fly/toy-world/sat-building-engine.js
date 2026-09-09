import { markPhase } from '../frame-stats';
import { mayFinalize } from '../finalize-pace';
import {
  AdditiveBlending,
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
import { censusDegenerate, guardIndex } from './flash-guard';
// R24 B (CHUNK_FADE, recon WB-2/A6) — per-mesh birth / deferred-evict ramps.
import { TwinPool, chunkFadeOn, fadeRamp, rampT } from './chunk-fade';
import { nightCityOn } from '../night-city';
import { satelliteVisualsOn } from '../satellite-visuals';
import { createSatelliteArchitectureMaterial, setSatelliteArchitectureNight } from '../satellite-architecture-material';
import { createSatelliteWaterMaterial, setSatelliteWaterClusters, addSatelliteWaterShore } from '../satellite-water';

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
const EXPECTED_WORKER_PROTOCOL = 20; // integrated main + cinematic payload contract
let _warnedProtocol = false;

const EARTH_R = 6378137;
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
 * a re-drape that can hold for `drapeMaxTries × 1.5 s`.
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
        return { material, uniform };
      },
      (m) => this._syncTwin(m)
    );
    this._fadeFrame = 0; // R24 B (W3): the frame-count floor's clock
    this._births = []; // [{ mesh, tw, t0 }] fading IN, already counted as ready
    this._dying = []; // [{ mesh, tw, t0 }] out of this.chunks, still drawing
    this._altFade = 1; // the shared altitude fade this frame (SAT_BLDG_FADE)
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
    this._stat = { errorRetries: 0, evictions: 0, heals: 0, degenerateDropped: 0, healsInPlace: 0, healsNoop: 0, healsQueueFull: 0, healsAborted: 0, healsNoRecord: 0, healsCoalesced: 0, redrapeRuns: 0, fadeBudgetMiss: 0, contactHeals: 0, degenDropped: 0, degenScanned: 0, degenChunks: 0 };
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
    const lead = Math.min(sp * L.leadSec, leadCapM('satBuildings', ringR));
    return [px + (this._vx / sp) * lead, pz + (this._vz / sp) * lead];
  }

  /** R21 (P2) — re-admit an 'empty'/'error' record once its TTL/backoff is up. */
  _readmit(chunk, nowSec) {
    if (!STREAM_KEEPER.enabled || !STREAM_KEEPER.retry.enabled) return false;
    if (chunk.state === 'empty') return nowSec >= (chunk.retryAt ?? Infinity);
    if (chunk.state === 'error') return nowSec >= (chunk.nextTryAt ?? Infinity);
    return false;
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
        .buildTile(t.z, t.x, t.y, 'sat-buildings', { visuals: this.visuals })
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
    this._births.push({ mesh, tw, t0: nowSec, f0: this._fadeFrame, k0: 0 });
  }

  /** Try to defer an eviction behind a fade-out. Returns false when the caller
   *  must delete the mesh itself (flag off, budget spent, or a hard evict). */
  _startDeath(mesh, nowSec) {
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
    this._dying.push({ mesh, tw, t0: nowSec, f0: this._fadeFrame, k0 });
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
      if (r >= 1) {
        b.mesh.material = this.material; // back to the ONE shared material
        this._fadePool.release(b.tw);
        this._births.splice(i, 1);
      }
    }
    for (let i = this._dying.length - 1; i >= 0; i--) {
      const d = this._dying[i];
      const r = fadeRamp(rampT(d, nowSec, CHUNK_FADE.evictSec, this._fadeFrame));
      d.tw.material.emissiveIntensity = this.material.emissiveIntensity;
      d.tw.uniform.value = alt * d.k0 * (1 - r);
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

  setWorker(workerApi) {
    this.worker = workerApi;
    this._disposed = false;
    this._lastRefreshPos = { x: Infinity, z: Infinity };
    this._lastRefreshT = 0;
  }

  notifyWarp(nowSec) {
    this._flushFades(); // R24 B: a warp is a cut, never a crossfade
    this._warpCoarseUntil = nowSec + SAT_BUILDINGS.warpCoarseWindowSec;
    this._leadHoldUntil = nowSec + STREAM_KEEPER.lookahead.warpHoldSec; // R21 §3.4
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
    if (SAT_BLDG_FADE.enabled) {
      const F = SAT_BLDG_FADE;
      const t = Math.min(
        1,
        Math.max(0, (eyeAglM - F.fadeStartAglM) / Math.max(1, F.fadeEndAglM - F.fadeStartAglM))
      );
      setSatBldgFade(1 - t * t * (3 - 2 * t)); // smoothstep
    }
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
    this._pumpRedrape(); // R24 B (HEAL_IN_PLACE) — before the arrival drape:
    // a hole that already exists on screen outranks one that has not opened yet.
    this._drapePending();
    this._finalizePending(nowSec);
    if (this.visuals) this._repairContactDrape(nowSec, playerX, playerZ);
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
    const offAglM = SAT_BLDG_FADE.enabled ? SAT_BLDG_FADE.evictAglM : S.cullAglOffM;
    if (this._ringOn) {
      if (eyeAglM > offAglM) this._ringOn = false;
    } else if (eyeAglM < S.cullAglOnM) {
      this._ringOn = true;
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
    desired.sort((a, b) => a.distSq - b.distSq);
    // R24 (B) — RING_HOLD. `kept` is still at most `maxChunks` entries and
    // still rank-sorted, so the water sub-slice and the queue order below are
    // untouched; what the hysteresis changes is WHICH chunk holds a slot at the
    // rank boundary. A chunk with a mesh is what is worth protecting — one
    // still building has nothing on screen and must not spend a slot.
    const keyOf = (e) => `${e.z}/${e.x}/${e.y}`;
    const kept = ringHoldKeep(desired, maxChunks, this.chunks, keyOf, (c) => !!c.mesh);
    const keep = new Set(kept.map(keyOf));
    // …and the residency test is taken from the PLAYER (px0/pz0), not from the
    // lead centre: "genuinely far away" is a fact about where the pilot is, and
    // taking it from the lead point would withdraw the hold from precisely the
    // band behind the aircraft that LEAD_SAFE exists to keep covered.
    const held = residencyHeld(this.chunks, keep, nowSec, px0, pz0, r);

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
        if (held.has(key)) {
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
  }

  _pumpQueue() {
    while (this.building < SAT_BUILDINGS.maxBuilds && this.queue.length > 0) {
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
      this.worker
        .buildTile(e.z, e.x, e.y, 'sat-buildings', { visuals: this.visuals })
        .then((result) => {
          this.building -= 1;
          const chunk = this.chunks.get(key);
          if (this._disposed || !chunk || chunk.state !== 'building' || chunk.reqId !== reqId)
            return;
          // Sentinel: a stale worker's bundle is DROPPED (round 15 — its layout
          // predates the facade uv, and a missing attribute reads (0,0), i.e.
          // windows on every roof). Render nothing + one dev warn, never crash.
          if (result && result.v !== EXPECTED_WORKER_PROTOCOL) {
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
          this.pendingFinalize.push({ key, tile: e, result, grid: null, gi: 0 });
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
          p.lastGround = s?.elev ?? 0; // RAW DEM — no exaggeration, no lift
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
        if (performance.now() - t0 > SAT_BUILDINGS.drapeBudgetMs * budgetK()) return;
      }
    }
  }

  // At most eight DEM queries / 0.35ms and one bounded vertex upload per frame.
  // The nearest-first queue sort is additional O(resident buildings) work once
  // per completed sweep (at least 2s apart), outside the sampling time budget.
  // Finish each nearest-first sweep before restarting, so distant buildings
  // cannot starve. No worker builds, chunk eviction, material changes or fades.
  _repairContactDrape(nowSec, px, pz) {
    if (!this.visuals) return;
    if (!this._contactQueue || this._contactCursor >= this._contactQueue.length) {
      if (nowSec - (this._contactSweepAt ?? -Infinity) < 2) return;
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
    for (let sampled = 0; sampled < 8 && this._contactCursor < this._contactQueue.length; sampled++) {
      const { key, chunk, run } = this._contactQueue[this._contactCursor++];
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
    for (let i = 0; i < this.pendingFinalize.length && done < S.finalizePerFrame * budgetK(); i++) {
      // R24 A (FINALIZE_PACE, recon WB-3): the shared per-frame brake. A
      // SEPARATE guard, deliberately not folded into the loop bound, so it
      // composes with any other multiplier on that expression.
      if (!mayFinalize(done)) break;
      markPhase('finalize:sat-buildings'); // R24 A: E's FRAME_STATS attribution
      const p = this.pendingFinalize[i];
      const bld = p.result.satBuilding;
      const nV = bld ? bld.anchor.length / 2 : 0;
      if (bld) {
        if (!p.groundY || p.vi < nV) continue; // still sampling
        const badFrac = (p.nulls ?? 0) / nV;
        const maxTries =
          nowSec < (this._warpCoarseUntil ?? 0) ? S.warpCoarseTries : S.drapeMaxTries;
        if (badFrac > 0.05 && (p.tries ?? 0) < maxTries) {
          if (nowSec >= (p.retryAt ?? 0)) {
            p.tries = (p.tries ?? 0) + 1;
            p.retryAt = nowSec + 1.5;
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
      this.pendingFinalize.splice(i, 1);
      i -= 1;
      done += 1;
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

      if (bld) {
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
        if (drapeRuns) chunk.drapeRuns = drapeRuns;
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
        geo.setAttribute('color', new BufferAttribute(bld.col, 3));
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
        const fg = guardIndex(bld.idx, pos);
        this._stat.degenerateDropped += fg.dropped;
        geo.setIndex(new BufferAttribute(fg.idx, 1));
        this._stat.degenDropped += fg.dropped;
        this._stat.degenScanned += bld.idx.length / 3;
        if (fg.dropped) this._stat.degenChunks++;
        geo.computeVertexNormals(); // walls are vertex-independent → crisp faces
        geo.computeBoundingSphere();
        // R21 (P1) — THE BEND MARGIN. The anchor-bend shader drops each block
        // by d²·k; the sphere just computed is the UNBENT one, so a chunk at
        // the ring edge false-culls the moment the camera turns. Worst case for
        // this ring = its evict radius + the tile's half-diagonal.
        const bpad = this._bendPad(p.tile.z);
        if (geo.boundingSphere) geo.boundingSphere.radius += bpad;
        const mesh = new Mesh(geo, this.material);
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
        this._attachWater(chunk, water);
      }
      chunk.state = 'ready';
      // R24 (B) — RING_HOLD (2) reads this stamp. Set where the chunk becomes
      // DRAWABLE (not where it was requested), because a minimum residency on a
      // request would protect a hole rather than a building. `chunk.cx/cz` are
      // resolved a few lines above, so the record is judgeable from here on.
      chunk.readyAt = nowSec;
    }
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
      if (this._startDeath(chunk.mesh, this._now)) {
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
    const families = [0,0,0,0,0,0];
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
        contactOversize: [...this.chunks.values()].reduce((n, c) => n + (c.drapeRuns?.filter(r => r.end - r.start > 16384).length ?? 0), 0) } : {}),
      // R22.1 (C) — FLASH_GUARD telemetry. Additive, unflagged: all three stay
      // 0 for the whole session when the flag is off, which is what the gate's
      // RED calibration leg asserts.
      degenDropped: this._stat.degenDropped,
      degenScanned: this._stat.degenScanned,
      degenChunks: this._stat.degenChunks,
      waterBackfillArmed: this._backfillArmed, // S4: in-place water scan live
      waterBackfilling: this._waterBuilding,
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
