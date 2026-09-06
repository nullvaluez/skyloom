import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  LAMBERT_ENV,
  Mesh,
  MeshLambertMaterial,
  MeshPhongMaterial,
  RepeatWrapping,
  SAT_BLDG_FADE,
  SAT_BUILDINGS,
  SAT_WATER,
  SRGBColorSpace,
  STREAM_KEEPER,
  SUBURB_NIGHT,
  TextureLoader,
  Vector2,
  } from 'three'; import {   GLOBE,
} from '../fly-constants';
import {
  applyBendAnchorSat,
  applyBendWaterSat,
  groundOverlayOffset,
  setSatBldgFade,
} from './world-bend';

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
const EXPECTED_WORKER_PROTOCOL = 18;
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
  const d = ringAliveR + chunkHalfDiagM;
  return d * d * MAX_BEND_K * B.pad;
}

function jitter1() {
  const j = STREAM_KEEPER.retry.jitter;
  return 1 + (Math.random() * 2 - 1) * j;
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
    this.object = new Group();
    this.object.name = 'sat-buildings';
    this.groundAt = groundAt; // (lonDeg, latDeg) => {elev, tileZ} | null
    this.worker = null;

    // ONE material shared by every chunk (vertex colors carry the neutral tone
    // variation). DoubleSide so three flips back-face normals via gl_FrontFacing
    // — every wall shades correctly despite the worker's inconsistent ring
    // winding. Lit by the scene day sun + hemi + env (the monument-satellite
    // model: daylight stone, not glow) — a single directional, no double-sun.
    // R24 C (LAMBERT_ENV, recon WB-7): three r185 applies `scene.environment`
    // to Lambert (WebGLPrograms.js:60-63) and Lambert's defaults are
    // `combine = MultiplyOperation`, `reflectivity = 1` — a FULL-STRENGTH
    // mirror lookup of the HDRI on every surface. Roofs take the zenith
    // colour, facades take the horizon band, and the twilight HDRI's bright
    // azimuth band lights one facade direction after dark. Uniform-only: a
    // material PARAMETER, so the program and the cache key are unmoved.
    this.material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    if (LAMBERT_ENV.enabled) this.material.reflectivity = LAMBERT_ENV.reflectivity;
    applyBendAnchorSat(this.material); // rigid per-building anchor bend

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
    this._stat = { errorRetries: 0, evictions: 0, heals: 0 };
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
    const lead = Math.min(sp * L.leadSec, L.maxLeadFrac * ringR);
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
    if (v === this.facadeEnabled || this._disposed) return;
    this.facadeEnabled = v;
    if (v && !this._facadeTex) this._facadeTex = getFacadeAtlas(false);
    this.material.map = v ? this._facadeTex : null;
    this.material.needsUpdate = true; // USE_MAP flips → one program compile
  }

  /**
   * Strict high-tier gate for NIGHT windows. Arms the emissiveMap + tint once;
   * the per-frame sun ramp then lives entirely in emissiveIntensity (a uniform
   * write — no recompile, and 0 by day so noon is visually untouched).
   */
  setNightWindowsEnabled(v) {
    if (v === this.nightEnabled || this._disposed) return;
    this.nightEnabled = v;
    if (v && !this._nightTex) this._nightTex = getFacadeAtlas(true);
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
    if (!this.nightEnabled || this._disposed) return;
    const N = SAT_BUILDINGS.night;
    const t = Math.min(1, Math.max(0, 1 - (sunFrac ?? 1) / N.dayFrac));
    const e = N.intensity * t ** N.gamma;
    if (Math.abs(e - this.material.emissiveIntensity) > 1e-4) this.material.emissiveIntensity = e;
  }

  /** Lazily build the shared additive water-glint material (+ normal texture). */
  _ensureWaterMaterial() {
    if (this.waterMaterial) return this.waterMaterial;
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
        .buildTile(t.z, t.x, t.y, 'sat-buildings')
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
    const wgeo = new BufferGeometry();
    wgeo.setAttribute('position', new BufferAttribute(water.pos, 3));
    wgeo.setAttribute('uv', new BufferAttribute(water.uv, 2));
    wgeo.setIndex(new BufferAttribute(water.idx, 1));
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
    wmesh.renderOrder = 3;
    this.object.add(wmesh);
    chunk.water = wmesh;
    chunk.waterY = waterY;
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
    this._drapePending();
    this._finalizePending(nowSec);
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
    const kept = desired.slice(0, maxChunks);
    const keep = new Set(kept.map((e) => `${e.z}/${e.x}/${e.y}`));

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
        .buildTile(e.z, e.x, e.y, 'sat-buildings')
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
        if (performance.now() - t0 > SAT_BUILDINGS.drapeBudgetMs) return;
      }
    }
  }

  // --- finalize: apply drape + upload one merged building mesh ----------------
  _finalizePending(nowSec = 0) {
    const S = SAT_BUILDINGS;
    let done = 0;
    for (let i = 0; i < this.pendingFinalize.length && done < S.finalizePerFrame; i++) {
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
        let runAx = NaN;
        let runAz = NaN;
        let runTop = -Infinity;
        let runR2 = 0;
        let runGY = 0;
        const flushRun = () => {
          if (!Number.isFinite(runAx)) return;
          colX.push(cx + runAx); // → absolute world (mesh.position = tile center)
          colZ.push(cz + runAz);
          colTop.push(runTop);
          colR.push(Math.sqrt(runR2));
          colGY.push(runGY);
        };
        for (let v = 0, vi = 0; v < pos.length; v += 3, vi += 1) {
          // each building sits level on its OWN exact ground; the -baseSink base
          // tucks under so slope/hill gaps hide.
          pos[v + 1] += p.groundY[vi];
          const ax = anchor[vi * 2];
          const az = anchor[vi * 2 + 1];
          if (ax !== runAx || az !== runAz) {
            flushRun();
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
        flushRun();
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
          let m = 0;
          for (let i = 0; i < nH; i++) {
            const hx = hp[i * 2];
            const hz = hp[i * 2 + 1];
            const g = gy.get(`${hx},${hz}`);
            // A house whose anchor did not survive selection has no ground and
            // is DROPPED, never floated at y=0 (the sea-level-forest failure
            // mode the veg engine holds against, same reasoning).
            if (g === undefined) continue;
            outH[m * 3] = cx + hx;
            outH[m * 3 + 1] = g;
            outH[m * 3 + 2] = cz + hz;
            m += 1;
          }
          if (m > 0) chunk.house = m === nH ? outH : outH.subarray(0, m * 3);
        }
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(pos, 3));
        geo.setAttribute('color', new BufferAttribute(bld.col, 3));
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
        geo.setIndex(new BufferAttribute(bld.idx, 1));
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
      wmesh.renderOrder = 3;
      this.object.add(wmesh);
      chunk.water = wmesh;
      chunk.waterY = waterY;
      chunk.waterSynth = true;
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
      this.object.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      chunk.mesh = null;
    }
    chunk.columns = null;
    chunk.meta = null;
    chunk.house = null; // round 19 (C): house-light anchors
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
  get stats() {
    let ready = 0; // = BUILDING draw calls (one merged building mesh per chunk)
    let waterReady = 0; // = water-glint draw calls (round 13 P4)
    let waterSynth = 0; // …of which round-18 ocean-fill bridges
    let columns = 0; // round 18: collision cylinders indexed (A5 GRAVITY)
    let empty = 0;
    for (const c of this.chunks.values()) {
      if (c.mesh) ready += 1;
      if (c.water) waterReady += 1;
      if (c.waterSynth) waterSynth += 1;
      if (c.columns) columns += c.columns.count;
      if (c.state === 'empty') empty += 1;
    }
    return {
      chunks: this.chunks.size,
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
      waterBackfillArmed: this._backfillArmed, // S4: in-place water scan live
      waterBackfilling: this._waterBuilding,
    };
  }

  dispose() {
    this._disposed = true;
    // The fade uniform is module-shared: hand it back at 1 so a re-mount (style
    // flip / StrictMode) never starts a fresh engine mid-dissolve.
    setSatBldgFade(1);
    for (const [key, chunk] of [...this.chunks]) this._evict(key, chunk);
    this.queue.length = 0;
    this.pendingFinalize.length = 0;
    this._backfillArmed = false; // R21 (S4)
    this._heal.clear(); // R21 (P6)
    this.material.dispose();
    // R21: _facadeTex/_nightTex now point at the module-scope getFacadeAtlas
    // memo — deliberately NOT disposed (shared across engine lifetimes; the
    // pre-warm retention contract).
    if (this.waterMaterial) this.waterMaterial.dispose();
    if (this._waterTex) this._waterTex.dispose();
  }
}
