/**
 * HORIZON FILL (FLY_HORIZON_FILL.md) stream B: the carpet engine. It draws the
 * procedural far-field stand-ins the fill worker generates from the measured
 * GHS-BUILT-H built volume, under the two mapped rings.
 *
 * Collaborators come in by injection so a node gate can drive the engine with
 * fakes (scripts/verify-horizon-fill-carpet.mjs):
 *   api       the fill worker (comlink): buildChunk(req) -> FillChunk, prefetch(tiles)
 *   config    horizonFillConfig() (the `ring` and `budget` sections are read here)
 *   tier      'high' | 'ultra'
 *   groundAt  (lonDeg, latDeg) -> { elev, tileZ } | null (the drawn terrain)
 *   coverage  () -> FillCoverage | null (stream C's mapped-cell census)
 *
 * RING. The z11 tiles within ring.reachM[tier] (true metres) of the ring
 * centre, which leads the player along the measured ground track, nearest
 * first, capped at ring.maxTiles[tier]. A resident tile stays until ringHystM
 * past the reach and wins ties for the cap by as much.
 *
 * LEVELS. Per tile, by the true distance of its nearest point from the player:
 * level 1 inside districtsM, level 2 beyond. With `houses` on, each quarter of
 * the tile nearer than housesM is its own level 0 chunk, and the whole-tile
 * chunk is built with those quarters masked out. Band edges have levelHystM of
 * hysteresis.
 *
 * SWAPS. A tile whose wanted chunk set changes (a level, a quarter, the mapped
 * mask epoch) builds the new set in the worker. When every new chunk is
 * uploaded, the new meshes fade in over budget.swapFadeSec (a CHUNK_FADE style
 * twin material with its own fade uniform), the old meshes stay whole until
 * the births finish and then fade out. A chunk that is the same in both sets
 * stays as it is. There is never a frame with neither.
 *
 * DRAWS. One instanced mesh per non-empty chunk, at the chunk centre inside
 * this.object (the layer mounts it in worldRoot, like the skyline's object),
 * frustum-culled with the bend margin, invisible at count 0. The material is
 * the World Pass stand-in material with this engine's OWN uniforms: the
 * skyline stand-ins' shader plus ONE keyed term (createStandInMaterial's
 * nearHole option, key suffix STAND_IN_HOLE_KEY; buildCarpetPrewarm is what the
 * layer registers for prewarm): the near hole, per instance in the vertex shader
 * (nothing inside ring.nearM.start, full by nearM.end, ground distance from
 * the bend centre). The bend's own uSkyHole cannot carry it: the distant
 * architecture material replaces that fragment test with the coverage discard.
 * Also our own outer taper (uCityHorizonBand: edgeFadeM before the reach) and
 * altitude dissolve (uSkyFade over ring.aglFade). The detailed ring's coverage
 * mask and the night mix are copied from the skyline's material every frame.
 *
 * LEVEL OF DETAIL. Every lodHz (or after a change), per chunk: the distance of
 * its nearest point gives countAtLeast(size, n, minPx * f * d / K) as
 * instanceCount. Over budget.maxTriangles[tier] the factor f rises with the
 * skyline's hysteresis (sat-skyline-engine.js _updateStandInCounts). Every
 * mesh on the GPU, fading or not, counts. The carpet's meshes are never on the
 * coastal reflection's layer and never cast shadows; a reflection render that
 * reaches one anyway draws zero instances.
 *
 * Nothing per frame allocates: the frame path writes uniforms and counts into
 * preallocated arrays. Refreshes (every refreshSec or refreshMoveM) and
 * uploads (at most uploadsPerFrame) allocate what they build. A chunk whose
 * ground is not measured yet is tried again only after drapeRetrySec, at most
 * drapeTriesPerFrame drape attempts a frame (each one (drapeGridN + 1)^2
 * ground queries into reused scratch), and the worker is not fed while
 * maxReady built chunks wait.
 */
import { Group, Mesh, Vector2 } from 'three';
import { createStandInGeometry, countAtLeast, drapeStandIns, STAND_IN_TRIANGLES } from '../toy-world/sat-stand-ins.js';
import { createStandInMaterial, createStandInUniforms } from '../sat-stand-in-material.js';
import { setSatelliteArchitectureNight } from '../satellite-architecture-material.js';
import { fillSkylineGrid } from '../skyline-drape.js';
import { TwinPool, fadeRamp, rampT } from '../toy-world/chunk-fade.js';
import { GLOBE } from '../fly-constants.js';
import { S, mercK, tileIndex, tileMinX, tileMinZ, rectDist, rectFar, lonOf, latOf, quarterMask } from './carpet-grid.js';
// ONE REVEAL (FLY_HORIZON_FILL.md second round, stream L): the carpet hold.
import { ONE_REVEAL_ACTIVE, oneRevealOn } from '../one-reveal.js';
import { noteAfterReveal } from '../one-reveal-state.js';

const HOLD_CELLS = 128;
const HOLD_BLOCK = 16; // one z14 tile = 16 x 16 survey cells
/** Mark every held z14 block (sig 'lo:hi', bit b = (y14 & 7) * 8 + (x14 & 7)) as mapped in `mask` (a fresh copy, or a new one). */
export function holdMask(sig, mask = null) {
  const m = mask ?? new Uint8Array(HOLD_CELLS * HOLD_CELLS);
  if (!sig) return m;
  const [lo, hi] = sig.split(':').map(Number);
  for (let b = 0; b < 64; b++) {
    if (!((b < 32 ? lo >>> b : hi >>> (b - 32)) & 1)) continue;
    const ox = (b & 7) * HOLD_BLOCK, oy = (b >> 3) * HOLD_BLOCK;
    for (let j = oy; j < oy + HOLD_BLOCK; j++) m.fill(255, j * HOLD_CELLS + ox, j * HOLD_CELLS + ox + HOLD_BLOCK);
  }
  return m;
}

const MAX_BEND_K = 1 / (2 * GLOBE.bendRadiusM.satellite);
const REFLECTION_TARGET = 'coastal-city-reflection';

const smooth01 = (v) => {
  const t = v < 0 ? 0 : v > 1 ? 1 : v;
  return t * t * (3 - 2 * t);
};

const clockMs = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

export class CarpetEngine {
  constructor({ api = null, config, tier = 'high', groundAt, coverage = null, houses = true, preload = false, reachCfg = {}, lighting = true, admit = null, now = clockMs, hold, holdCfg } = {}) {
    this.api = api;
    this.cfg = config;
    this.ring = config.ring;
    this.budget = config.budget;
    this.tier = tier === 'ultra' ? 'ultra' : 'high';
    this.groundAt = groundAt ?? (() => null);
    this.coverage = typeof coverage === 'function' ? coverage : () => coverage;
    this.houses = houses !== false;
    this.preload = preload === true;
    this.admit = admit ?? (() => true); // (uploadsThisFrame) -> may this frame take one more upload?
    this.clock = now;
    this.reachM = this.ring.reachM[this.tier];
    this.maxTiles = this.ring.maxTiles[this.tier];
    this.maxTriangles = this.budget.maxTriangles[this.tier];
    this.footprintK = reachCfg.worker?.footprintK ?? 0.5;

    this.object = new Group();
    this.object.name = 'horizon-fill';

    // Own uniforms: the stand-in look terms come from the same World Pass reach
    // config as the skyline (equal program); the view and every fade are ours.
    this.uniforms = createStandInUniforms(reachCfg);
    this._hole = { value: new Vector2(0, 1) }; // uStandInHole (radius, feather), world units
    this._band = { value: { x: 0, y: 0, isVector2: true } }; // (start, end), world units
    this._fadeU = { value: 1 }; // the altitude dissolve (base material)
    this._lighting = lighting;
    this.material = this._makeMaterial(this._fadeU);
    this.material.name = 'horizon-fill-carpet';
    this._fadePool = new TwinPool(() => {
      const uniform = { value: 1 };
      const material = this._makeMaterial(uniform);
      Object.assign(material.userData.architecture.uniforms, this.material.userData.architecture.uniforms);
      return { material, uniform };
    });

    this.tiles = new Map(); // `${tx}/${ty}` -> tile
    this.queue = []; // build jobs waiting for a worker slot
    this.inFlight = 0;
    this._session = 0; // a revive starts a new one; answers from an older worker are dropped
    this.ready = []; // built chunks waiting for upload
    this._deferred = []; // tiles whose new set is uploaded and waits for fade twins
    this._births = [];
    this._dying = [];
    this._fadeFrame = 0;
    this._agl = 1; // altitude dissolve this frame
    this._f = 1; // budget factor on minPx
    this._lodT = -Infinity;
    this._lodDirty = true;
    this._lodChunks = []; // preallocated LOD scratch
    this._lodD = new Float64Array(64);
    this._lodN = 0;
    this._cand = []; // refresh scratch (pooled records)
    this._view = { K: 779, H: 900 };
    this._px = 0;
    this._pz = 0;
    this._eyeAgl = 0;
    this._refGround = 0;
    this._lastRefresh = { x: Infinity, z: Infinity, t: -Infinity };
    this._vel = { x: 0, z: 0, t: undefined, px: undefined, pz: undefined };
    this._cut = false;
    this._gen = 0;
    this._prefetchSig = '';
    this._disposed = false;
    this._liveGeometries = 0;
    this._drapeGrid = null; // drape scratch, reused by every attempt
    this._drapeZoom = null;
    this.drapeQueries = 0; // ground queries made by drape attempts (diagnostics and the gate)
    this.stats = {
      tiles: 0, chunks: 0, resident: 0, drawn: 0, triangles: 0, minPx: 0, pending: 0, missing: 0,
      uploads: 0, swaps: 0, uploadMsMax: 0, levels: [0, 0, 0],
      builds: 0, rebuilds: 0, evictions: 0, failed: 0, refined: 0, liveGeometries: 0, fadeCuts: 0,
    };
    // ONE REVEAL (carpetHold): inside the mapped reach, a z14 block is hidden
    // until its census reports or carpetWait.timeoutSec passes. Off: one false.
    this._hold = hold ?? oneRevealOn('carpetHold');
    if (this._hold) {
      this._holdCfg = holdCfg ?? ONE_REVEAL_ACTIVE.carpetWait ?? {};
      this._known = new Uint8Array(64);
      Object.assign(this.stats, { heldBlocks: 0, holdTimeouts: 0, holdReleases: 0 });
    }
  }

  /** One material: the stand-in program, our uniforms, our own hole / band / fade. */
  _makeMaterial(fadeUniform) {
    const material = createStandInMaterial({ lighting: this._lighting, fadeUniform, uniforms: this.uniforms, footprintK: this.footprintK, nearHole: this._hole });
    const previous = material.onBeforeCompile;
    const band = this._band;
    material.onBeforeCompile = (shader, renderer) => {
      previous?.(shader, renderer);
      // Same GLSL; only which uniform object feeds the outer taper differs.
      if (shader.uniforms.uCityHorizonBand) shader.uniforms.uCityHorizonBand = band;
    };
    material.userData.horizonFill = true;
    return material;
  }

  /** The fill worker (comlink), once its init resolved. Ignored after dispose. */
  setWorker(api) {
    if (!this._disposed) this.api = api ?? null;
  }

  /** Upload admission: (uploadsThisFrame) -> may this frame take one more upload? */
  setAdmit(fn) {
    this.admit = typeof fn === 'function' ? fn : () => true;
  }

  // --- inputs, every frame -----------------------------------------------------

  /** Focal length (CSS px) and the canvas height. */
  setView(K, heightPx) {
    if (Number.isFinite(K) && K > 0) this._view.K = K;
    if (Number.isFinite(heightPx) && heightPx > 0) this._view.H = heightPx;
  }

  /**
   * Copy the detailed ring's coverage mask and the night mix from the skyline's
   * material (the mapped rings and the carpet must agree on where the detailed
   * city stands). No skyline: no mask, the night from the sun.
   */
  syncSkyline(skyMaterial, sunFrac) {
    const mine = this.material.userData.architecture?.uniforms;
    if (!mine) return;
    const sky = skyMaterial?.userData?.architecture?.uniforms;
    if (sky?.uArchitectureTiles && mine.uArchitectureTiles) {
      const n = Math.min(sky.uArchitectureTileCount.value | 0, mine.uArchitectureTiles.value.length);
      for (let i = 0; i < n; i++) {
        mine.uArchitectureTiles.value[i].copy(sky.uArchitectureTiles.value[i]);
        mine.uArchitectureTileK.value[i] = sky.uArchitectureTileK.value[i];
      }
      mine.uArchitectureTileCount.value = n;
      mine.uArchitectureNearFade.value = sky.uArchitectureNearFade.value;
      mine.uArchitectureNight.value = sky.uArchitectureNight.value;
      return;
    }
    if (mine.uArchitectureTileCount) mine.uArchitectureTileCount.value = 0;
    if (Number.isFinite(sunFrac)) setSatelliteArchitectureNight(this.material, sunFrac);
  }

  /** A warp is a cut: land every fade, drop the lead, refresh at once. */
  notifyWarp() {
    this._flushFades();
    this._cut = true;
    this._vel.x = 0;
    this._vel.z = 0;
    this._vel.px = undefined;
    this._lastRefresh.x = Infinity;
    this._lastRefresh.t = -Infinity;
    this._prefetchSig = '';
  }

  /**
   * Per frame. px, pz absolute world units; eyeAglM the eye above ground;
   * refGroundY the player's ground (drape fallback where nothing measured).
   */
  update(nowSec, px, pz, eyeAglM, refGroundY = 0) {
    if (this._disposed) return;
    this._nowSec = nowSec;
    this._px = px;
    this._pz = pz;
    this._eyeAgl = Number.isFinite(eyeAglM) ? eyeAglM : 0;
    if (Number.isFinite(refGroundY)) this._refGround = refGroundY;
    this._trackVel(nowSec, px, pz);
    const R = this.ring;
    const k = mercK(pz);
    // Altitude dissolve, near hole and outer taper (world units at the player).
    const A = R.aglFade;
    this._agl = 1 - smooth01((this._eyeAgl - A.startM) / Math.max(1, A.endM - A.startM));
    this._fadeU.value = this._agl;
    this._hole.value.x = R.nearM.start * k;
    this._hole.value.y = Math.max(1, (R.nearM.end - R.nearM.start) * k);
    this._band.value.x = Math.max(0, this.reachM - R.edgeFadeM) * k;
    this._band.value.y = this.reachM * k;
    this.object.visible = this._agl > 0;
    this.uniforms.uStandInView.value.x = this._view.K;
    this._stepFades(nowSec);
    this._commitDeferred(nowSec);
    const L = this._lastRefresh;
    const moveW = R.refreshMoveM * k;
    if ((px - L.x) ** 2 + (pz - L.z) ** 2 > moveW * moveW || nowSec - L.t > R.refreshSec) {
      L.x = px;
      L.z = pz;
      L.t = nowSec;
      this._refresh(nowSec, px, pz);
    }
    this._pump();
    this._upload(nowSec);
    this._refine(nowSec);
    const lodEvery = 1 / Math.max(0.5, this.budget.lodHz ?? 10);
    if (this._lodDirty || nowSec - this._lodT >= lodEvery) this._lod(nowSec, px, pz);
  }

  // --- ring ----------------------------------------------------------------------

  _trackVel(nowSec, px, pz) {
    const v = this._vel;
    const dt = nowSec - (v.t ?? nowSec);
    v.t = nowSec;
    if (v.px === undefined) {
      v.px = px;
      v.pz = pz;
      return;
    }
    const dx = px - v.px;
    const dz = pz - v.pz;
    v.px = px;
    v.pz = pz;
    if (dx * dx + dz * dz > (this.ring.teleportM ?? 20000) ** 2) {
      v.x = 0;
      v.z = 0;
      return;
    }
    if (dt <= 1e-4 || dt > 0.5) return;
    const a = Math.min(1, dt / 1.0);
    v.x += (dx / dt - v.x) * a;
    v.z += (dz / dt - v.z) * a;
  }

  /** The ring centre: the player moved leadSec along the ground track (capped). */
  _leadCenter(px, pz, k) {
    const v = this._vel;
    const sp = Math.hypot(v.x, v.z);
    if (sp < 1) return [px, pz];
    const lead = Math.min(sp * (this.ring.leadSec ?? 0), this.reachM * (this.ring.leadMaxFrac ?? 0.25) * k);
    return [px + (v.x / sp) * lead, pz + (v.z / sp) * lead];
  }

  _refresh(nowSec, px, pz) {
    const R = this.ring;
    const k = mercK(pz);
    const [lx, lz] = this._leadCenter(px, pz, k);
    const hyst = R.ringHystM ?? 2500;
    const reachW = (this.reachM + hyst) * k;
    const t0 = tileIndex(lx - reachW), t1 = tileIndex(lx + reachW);
    const u0 = tileIndex(lz - reachW), u1 = tileIndex(lz + reachW);
    const cand = this._cand;
    let nc = 0;
    for (let ty = u0; ty <= u1; ty++) {
      for (let tx = t0; tx <= t1; tx++) {
        const d = rectDist(lx, lz, tileMinX(tx), tileMinZ(ty), S) / k;
        const tile = this.tiles.get(`${tx}/${ty}`);
        if (tile ? d > this.reachM + hyst : d > this.reachM) continue;
        const rec = cand[nc] ?? (cand[nc] = { tx: 0, ty: 0, score: 0, tile: null });
        rec.tx = tx;
        rec.ty = ty;
        rec.tile = tile ?? null;
        rec.score = tile ? d - hyst : d;
        nc++;
      }
    }
    const used = cand.slice(0, nc).sort((a, b) => a.score - b.score || a.ty - b.ty || a.tx - b.tx);
    const keep = Math.min(nc, this.maxTiles);
    const wanted = new Set();
    for (let i = 0; i < keep; i++) wanted.add(`${used[i].tx}/${used[i].ty}`);
    const cut = this._cut;
    this._cut = false;
    for (const [key, tile] of this.tiles) if (!wanted.has(key)) this._evictTile(key, tile, cut);
    for (let i = 0; i < keep; i++) {
      const r = used[i];
      if (!r.tile) this._addTile(r.tx, r.ty);
    }
    // Levels and the mapped mask, per resident tile.
    const cov = this.coverage();
    if (this._hold) this.stats.heldBlocks = 0;
    for (const tile of this.tiles.values()) this._planTile(tile, nowSec, px, pz, k, cov);
    this.queue.sort((a, b) => a.tile.d - b.tile.d);
    if (this.preload) this._prefetch(px, pz, k);
    this._lodDirty = true;
  }

  _addTile(tx, ty) {
    const tile = {
      key: `${tx}/${ty}`, tx, ty, minX: tileMinX(tx), minZ: tileMinZ(ty),
      d: Infinity, level: 0, qbits: 0, epoch: 0, maskAt: -Infinity,
      gen: 0, live: [], next: null, dead: false, retryAt: 0,
    };
    this.tiles.set(tile.key, tile);
    return tile;
  }

  /** Wanted chunk set for a tile; a change starts a build of the new set. */
  _planTile(tile, nowSec, px, pz, k, cov) {
    const R = this.ring;
    const h = R.levelHystM ?? 0;
    tile.d = rectDist(px, pz, tile.minX, tile.minZ, S) / k;
    const was = tile.level;
    let level = tile.d < R.districtsM ? 1 : 2;
    if (was === 1 && tile.d < R.districtsM + h) level = 1;
    if (was === 2 && tile.d > R.districtsM - h) level = 2;
    let qbits = 0;
    if (this.houses) {
      for (let q = 0; q < 4; q++) {
        const dq = rectDist(px, pz, tile.minX + (q & 1) * (S / 2), tile.minZ + (q >> 1) * (S / 2), S / 2) / k;
        const isHouse = tile.qbits & (1 << q);
        if (dq < (isHouse ? R.housesM + h : R.housesM - h)) qbits |= 1 << q;
      }
    }
    let epoch = tile.epoch;
    if (cov) {
      const e = cov.epochOf(tile.tx, tile.ty) ?? 0;
      // A tile under a streaming mapped ring reports many epochs; rebuild at
      // most once per maskMinSec. The first known mask is taken at once.
      if (!this._hold) {
        if (e !== tile.epoch && (tile.epoch === 0 || tile.gen === 0 || nowSec - tile.maskAt >= (this.budget.maskMinSec ?? 0))) epoch = e;
      } else epoch = this._holdEpoch(tile, e, nowSec);
    } else epoch = 0;
    // ONE REVEAL: the held blocks (a signature; undefined while the hold is off).
    let hold = tile.hold;
    if (this._hold) {
      const h = cov?.knownBlocks ? this._holdFor(tile, nowSec, px, pz, k, cov) : '';
      if (h !== (tile.hold ?? '') && (tile.gen === 0 || nowSec - tile.maskAt >= this._holdMinSec())) {
        hold = h;
        epoch = cov ? cov.epochOf(tile.tx, tile.ty) ?? 0 : 0; // the mask is read at send time: label it current
      }
    }
    if (tile.gen > 0 && level === tile.level && qbits === tile.qbits && epoch === tile.epoch && hold === tile.hold) return;
    const maskChange = tile.gen > 0 && (epoch !== tile.epoch || hold !== tile.hold) && level === tile.level && qbits === tile.qbits;
    tile.level = level;
    tile.qbits = qbits;
    if (epoch !== tile.epoch || hold !== tile.hold) tile.maskAt = nowSec;
    tile.epoch = epoch;
    if (this._hold) tile.hold = hold ?? '';
    tile.gen = ++this._gen;
    if (maskChange) this.stats.rebuilds += 1;
    // The wanted chunks: level 0 quarters, plus the whole tile minus them.
    const specs = [];
    for (let q = 0; q < 4; q++) if (qbits & (1 << q)) specs.push({ level: 0, qx: q & 1, qy: q >> 1, excl: 0 });
    if (qbits !== 15) specs.push({ level, qx: 0, qy: 0, excl: qbits });
    const next = { gen: tile.gen, chunks: [], waiting: 0 };
    // Drop the superseded build: its queued jobs go, its in-flight ones are ignored.
    if (tile.next) for (const c of tile.next.chunks) if (c.mesh && !tile.live.includes(c)) this._disposeChunk(c);
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].tile === tile) this.queue.splice(i, 1);
    for (const s of specs) {
      const same = tile.live.find((c) => c.level === s.level && c.qx === s.qx && c.qy === s.qy && c.excl === s.excl && c.epoch === epoch && (c.hold ?? '') === (tile.hold ?? ''));
      if (same) {
        next.chunks.push(same);
        continue;
      }
      next.waiting += 1;
      const job = { tile, gen: tile.gen, spec: s, epoch, attempts: 0, at: 0 };
      if (tile.hold) job.hold = tile.hold; // ONE REVEAL
      this.queue.push(job);
    }
    tile.next = next;
    if (next.waiting === 0) this._commit(tile, nowSec);
  }

  // --- ONE REVEAL: the carpet hold ---------------------------------------------

  _holdMinSec() {
    return Math.max(this.budget.maskMinSec ?? 0, this._holdCfg.minRebuildSec ?? 0);
  }

  /** The mask epoch to build with: the first census at once, later ones at most every _holdMinSec(). */
  _holdEpoch(tile, e, nowSec) {
    if (e !== tile.epoch && (tile.epoch === 0 || tile.gen === 0 || nowSec - tile.maskAt >= this._holdMinSec())) return e;
    return tile.epoch;
  }

  /**
   * The held z14 blocks of a tile, as 'lo:hi' ('' when none). Per block:
   * -1 not yet seen, >= 0 held since (s), -2 released for this residency
   * (reported, timed out, or first seen beyond the mapped reach). A released
   * block is never held again, so nothing drawn is ever hidden by the hold.
   */
  _holdFor(tile, nowSec, px, pz, k, cov) {
    const C = this._holdCfg;
    const reach = cov.reachM ?? C.reachM ?? 24000;
    const timeout = C.timeoutSec ?? 15;
    const known = this._known;
    cov.knownBlocks(tile.tx, tile.ty, known);
    const T = (tile.holdT ??= new Float64Array(64).fill(-1));
    const B = S / 8;
    let lo = 0, hi = 0, n = 0;
    for (let b = 0; b < 64; b++) {
      if (T[b] === -2) continue;
      if (known[b]) {
        if (T[b] >= 0) this.stats.holdReleases += 1;
        T[b] = -2;
        continue;
      }
      if (T[b] < 0) {
        const d = rectDist(px, pz, tile.minX + (b & 7) * B, tile.minZ + (b >> 3) * B, B) / k;
        if (d >= reach) {
          T[b] = -2;
          continue;
        }
        T[b] = nowSec;
      }
      if (nowSec - T[b] >= timeout) {
        T[b] = -2;
        this.stats.holdTimeouts += 1;
        continue;
      }
      n += 1;
      if (b < 32) lo |= 1 << b;
      else hi |= 1 << (b - 32);
    }
    this.stats.heldBlocks += n;
    return n ? `${lo >>> 0}:${hi >>> 0}` : '';
  }

  _prefetch(px, pz, k) {
    const want = [];
    for (const tile of [...this.tiles.values()].sort((a, b) => a.d - b.d)) {
      if (tile.next && tile.next.waiting > 0) want.push([tile.tx, tile.ty]);
    }
    // Ahead of the ring: tiles within reach of a point further along the track.
    const v = this._vel;
    const sp = Math.hypot(v.x, v.z);
    if (sp >= 1) {
      const ahead = Math.min(sp * (this.ring.leadSec ?? 0) * 3, this.reachM * k);
      const fx = px + (v.x / sp) * ahead;
      const fz = pz + (v.z / sp) * ahead;
      const reachW = this.reachM * k;
      const extra = [];
      for (let ty = tileIndex(fz - reachW); ty <= tileIndex(fz + reachW); ty++) {
        for (let tx = tileIndex(fx - reachW); tx <= tileIndex(fx + reachW); tx++) {
          if (this.tiles.has(`${tx}/${ty}`)) continue;
          const d = rectDist(fx, fz, tileMinX(tx), tileMinZ(ty), S);
          if (d < reachW) extra.push([tx, ty, d]);
        }
      }
      extra.sort((a, b) => a[2] - b[2]);
      const n = Math.min(extra.length, this.ring.prefetchTiles ?? 8);
      for (let i = 0; i < n; i++) want.push([extra[i][0], extra[i][1]]);
    }
    const sig = want.map((t) => `${t[0]}/${t[1]}`).join(',');
    if (!want.length || sig === this._prefetchSig || !this.api?.prefetch) return;
    this._prefetchSig = sig;
    try {
      const r = this.api.prefetch(want);
      r?.catch?.(() => {});
    } catch {
      /* the view never depends on a prefetch */
    }
  }

  // --- builds ----------------------------------------------------------------------

  _pump() {
    if (!this.api) return;
    const max = this.budget.maxInFlight ?? 2;
    // Back-pressure: built chunks waiting for ground (or an upload slot) hold the worker.
    if (this.ready.length >= (this.budget.maxReady ?? 12)) return;
    const now = this._nowSec ?? 0;
    for (let i = 0; i < this.queue.length && this.inFlight < max; ) {
      const job = this.queue[i];
      if (job.at > now) {
        i++;
        continue;
      }
      this.queue.splice(i, 1);
      this._send(job);
    }
  }

  _send(job) {
    const { tile, spec, epoch } = job;
    const cov = this.coverage();
    // The mapped cells (a fresh copy), plus the quarters a level 0 chunk owns.
    let mapped = cov && epoch ? cov.maskFor(tile.tx, tile.ty) ?? null : null;
    if (job.hold) mapped = holdMask(job.hold, mapped); // ONE REVEAL: held blocks emit nothing
    const mask = spec.excl ? quarterMask(spec.excl, mapped) : mapped;
    const req = { tx: tile.tx, ty: tile.ty, level: spec.level, qx: spec.qx, qy: spec.qy, mask, maskEpoch: epoch, maxInstances: 0 };
    this.inFlight += 1;
    this.stats.builds += 1;
    job.session = this._session;
    let p;
    try {
      p = Promise.resolve(this.api.buildChunk(req));
    } catch (err) {
      p = Promise.reject(err);
    }
    p.then(
      (chunk) => this._built(job, chunk),
      () => this._built(job, null)
    );
  }

  _built(job, chunk) {
    if (job.session !== this._session) return; // a terminated worker's answer
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (this._disposed) return;
    const { tile } = job;
    if (tile.dead || tile.gen !== job.gen || !tile.next) return; // superseded or evicted
    if (!chunk || chunk.status === 'missing') {
      if (!chunk) this.stats.failed += 1;
      job.attempts += 1;
      job.at = (this._nowSec ?? 0) + (this.budget.missingRetrySec ?? 3) * Math.min(8, job.attempts);
      if (chunk) job.missing = true;
      this.queue.push(job);
      return;
    }
    const rec = {
      tile, gen: job.gen, level: job.spec.level, qx: job.spec.qx, qy: job.spec.qy, excl: job.spec.excl, epoch: job.epoch,
      key: chunk.key, cx: chunk.cx, cz: chunk.cz, span: chunk.span, n: chunk.status === 'ok' ? chunk.n | 0 : 0,
      data: chunk.status === 'ok' ? chunk : null, size: null, mesh: null, count: 0, d: Infinity,
      gz: null, base: null, ri: 0, rAt: -Infinity, yLo: 0, yHi: 0, maxH: chunk.maxH ?? 0, waitSince: this._nowSec ?? 0, nextTry: -Infinity,
    };
    if (job.hold) rec.hold = job.hold; // ONE REVEAL
    if (rec.n === 0) {
      this._chunkReady(rec);
      return;
    }
    this.ready.push(rec);
  }

  /** At most uploadsPerFrame chunks and uploadBytesPerFrame bytes, when the frame admits it. */
  _upload(nowSec) {
    this._nowSec = nowSec;
    if (!this.ready.length) return;
    const B = this.budget;
    let uploads = 0;
    let bytes = 0;
    let tries = 0;
    const maxUploads = B.uploadsPerFrame ?? 1;
    // A drape attempt is the work, whether or not it finds ground: bound those too.
    const maxTries = Math.max(maxUploads, B.drapeTriesPerFrame ?? 1);
    // Nearest first.
    this.ready.sort((a, b) => a.tile.d - b.tile.d);
    for (let i = 0; i < this.ready.length && uploads < maxUploads && tries < maxTries; ) {
      const rec = this.ready[i];
      if (rec.tile.dead || rec.tile.gen !== rec.gen) {
        this.ready.splice(i, 1);
        continue;
      }
      if (rec.nextTry > nowSec) {
        i++;
        continue;
      }
      const cost = rec.n * 36;
      if (uploads > 0 && bytes + cost > (B.uploadBytesPerFrame ?? Infinity)) break;
      if (!this.admit(uploads)) break;
      const t0 = this.clock();
      tries += 1;
      const ok = this._makeMesh(rec, nowSec);
      if (!ok) {
        // No measured ground yet: wait before asking again (drapeWaitSec still ends the wait).
        rec.nextTry = nowSec + (B.drapeRetrySec ?? 0.4);
        i++;
        continue;
      }
      this.ready.splice(i, 1);
      uploads += 1;
      bytes += cost;
      this.stats.uploads += 1;
      const ms = this.clock() - t0;
      if (ms > this.stats.uploadMsMax) this.stats.uploadMsMax = ms;
      this._chunkReady(rec);
    }
  }

  /** Coarse drape on a lattice, then the instanced mesh. False: no measured ground yet. */
  _makeMesh(rec, nowSec) {
    const m = rec.data;
    const N = Math.max(2, this.budget.drapeGridN ?? 16);
    const w = N + 1;
    if (!this._drapeGrid || this._drapeGrid.length !== w * w) {
      this._drapeGrid = new Float32Array(w * w);
      this._drapeZoom = new Uint8Array(w * w);
    }
    const grid = this._drapeGrid.fill(0);
    const zoom = this._drapeZoom.fill(0);
    this.drapeQueries += w * w;
    const minX = rec.cx - rec.span / 2;
    const minZ = rec.cz - rec.span / 2;
    const step = rec.span / N;
    for (let j = 0; j < w; j++) {
      for (let i = 0; i < w; i++) {
        const s = this.groundAt(lonOf(minX + i * step), latOf(minZ + j * step));
        if (s && Number.isFinite(s.elev)) {
          grid[j * w + i] = s.elev;
          zoom[j * w + i] = Math.max(1, s.tileZ | 0);
        }
      }
    }
    if (!fillSkylineGrid(grid, zoom, N)) {
      if (nowSec - rec.waitSince < (this.budget.drapeWaitSec ?? 6)) return false;
      grid.fill(this._refGround);
    }
    const baseY = drapeStandIns(m, grid, N, rec.span, new Float32Array(m.n));
    const geo = createStandInGeometry(m, baseY, rec.span);
    // The bend drops a far anchor by d^2 k: pad the sphere so a chunk on screen is never culled.
    const k = mercK(rec.cz);
    const reach = (this.reachM + (this.ring.ringHystM ?? 0)) * k * (1 + (this.ring.leadMaxFrac ?? 0)) + (rec.span * Math.SQRT2) / 2;
    const pad = reach * reach * MAX_BEND_K;
    geo.boundingSphere.radius += pad;
    this._liveGeometries += 1;
    geo.addEventListener('dispose', () => {
      this._liveGeometries -= 1;
    });
    const mesh = new Mesh(geo, this.material);
    mesh.name = 'horizon-fill-chunk';
    mesh.position.set(rec.cx, 0, rec.cz);
    mesh.frustumCulled = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;
    mesh.userData.bendMarginM = pad;
    mesh.userData.carpetChunk = rec; // diagnostics and the gate
    mesh.onBeforeRender = (renderer) => {
      const rt = renderer?.getRenderTarget?.();
      geo.instanceCount = rt && rt.texture?.name === REFLECTION_TARGET ? 0 : rec.count;
    };
    rec.mesh = mesh;
    rec.size = m.size;
    rec.base = geo.attributes.aStandInBase;
    rec.gz = new Uint8Array(m.n);
    rec.ax = m.ax;
    rec.az = m.az;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < m.n; i++) {
      if (baseY[i] < lo) lo = baseY[i];
      if (baseY[i] > hi) hi = baseY[i];
    }
    rec.yLo = Number.isFinite(lo) ? lo : 0;
    rec.yHi = Number.isFinite(hi) ? hi : 0;
    rec.baseRadius = geo.boundingSphere.radius;
    rec.data = null; // the arrays now belong to the geometry
    return true;
  }

  _chunkReady(rec) {
    const tile = rec.tile;
    const next = tile.next;
    if (!next || next.gen !== rec.gen) {
      this._disposeChunk(rec);
      return;
    }
    next.chunks.push(rec);
    next.waiting -= 1;
    if (next.waiting <= 0) this._commit(tile, this._nowSec ?? 0);
  }

  /** Commits that waited for free fade twins, nearest tile first. */
  _commitDeferred(nowSec) {
    if (!this._deferred.length) return;
    this._deferred.sort((a, b) => a.d - b.d);
    for (let i = 0; i < this._deferred.length; ) {
      const tile = this._deferred[i];
      if (tile.dead || !tile.next || tile.next.waiting > 0) {
        this._deferred.splice(i, 1);
        continue;
      }
      if (!this._commit(tile, nowSec, true)) break;
      this._deferred.splice(i, 1);
      break; // one deferred swap a frame: its meshes reach the GPU on their first draw
    }
  }

  /**
   * Every chunk of the tile's new set is on the GPU: swap. With no fade twin
   * free the swap waits (the old set stays whole) and false is returned; a set
   * too large for the pool, or a dissolved layer, is a same-frame cut.
   */
  _commit(tile, nowSec, retry = false) {
    const next = tile.next;
    const incoming = next.chunks;
    const outgoing = tile.live.filter((c) => !incoming.includes(c));
    const born = incoming.filter((c) => !tile.live.includes(c));
    const fadeSec = this.budget.swapFadeSec ?? 0;
    const maxFades = this.budget.maxFades ?? 24;
    const fadesFree = maxFades - this._births.length - this._dying.length;
    const bornMeshes = born.filter((c) => c.mesh);
    const outMeshes = outgoing.filter((c) => c.mesh);
    const need = bornMeshes.length + outMeshes.length;
    const fading = fadeSec > 0 && this._agl > 0;
    if (fading && need > fadesFree && need <= maxFades) {
      if (!retry && !this._deferred.includes(tile)) this._deferred.push(tile);
      return false;
    }
    tile.next = null;
    tile.live = incoming;
    for (const c of bornMeshes) this.object.add(c.mesh);
    if (outgoing.length) {
      this.stats.swaps += 1;
      noteAfterReveal('carpetRebuilds', tile.minX + S / 2, tile.minZ + S / 2, S / 2); // ONE REVEAL instrument (both arms)
    }
    if (!fading || need > fadesFree) {
      // A same-frame cut: new in, old out, never a frame with neither.
      if (fading) this.stats.fadeCuts += 1;
      for (const c of outgoing) this._disposeChunk(c);
      this._lodDirty = true;
      return true;
    }
    const hold = { births: 0 };
    for (const c of bornMeshes) {
      const tw = this._fadePool.acquire();
      tw.uniform.value = 0;
      c.mesh.material = tw.material;
      hold.births += 1;
      this._births.push({ chunk: c, tw, t0: nowSec, f0: this._fadeFrame, hold });
    }
    // A kept chunk still fading in from an earlier set joins this set's hold,
    // and older meshes of the tile still waiting whole wait for this set too:
    // a set superseded mid-birth never uncovers them.
    for (const b of this._births) {
      if (b.chunk.tile !== tile || b.hold === hold) continue;
      b.hold.births -= 1;
      b.hold = hold;
      hold.births += 1;
    }
    if (hold.births) for (const d of this._dying) if (d.chunk.tile === tile && Number.isNaN(d.t0)) d.hold = hold;
    for (const c of outMeshes) this._startDeath(c, hold.births ? hold : null);
    for (const c of outgoing) if (!c.mesh) this._disposeChunk(c);
    this._lodDirty = true;
    return true;
  }

  _evictTile(key, tile, cut) {
    tile.dead = true;
    this.tiles.delete(key);
    this.stats.evictions += 1;
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].tile === tile) this.queue.splice(i, 1);
    if (tile.next) for (const c of tile.next.chunks) if (!tile.live.includes(c)) this._disposeChunk(c);
    tile.next = null;
    const fadeSec = this.budget.swapFadeSec ?? 0;
    for (const c of tile.live) {
      if (!c.mesh) continue;
      const free = (this.budget.maxFades ?? 24) - this._births.length - this._dying.length;
      const bi = this._births.findIndex((b) => b.chunk === c);
      if (cut || fadeSec <= 0 || this._agl <= 0 || (bi < 0 && free <= 0)) {
        this._disposeChunk(c);
        continue;
      }
      this._startDeath(c, null);
    }
    tile.live = [];
    this._lodDirty = true;
  }

  /**
   * Fade a mesh out: whole while `hold` has births running, then over
   * swapFadeSec. A mesh still fading in keeps its twin and fades out from
   * where it stands.
   */
  _startDeath(c, hold) {
    const bi = this._births.findIndex((b) => b.chunk === c);
    let tw;
    let k0 = 1;
    if (bi >= 0) {
      tw = this._dropBirth(bi).tw;
      k0 = this._agl > 0 ? Math.min(1, tw.uniform.value / this._agl) : 0;
    } else {
      tw = this._fadePool.acquire();
      tw.uniform.value = this._agl;
      c.mesh.material = tw.material;
    }
    this._dying.push({ chunk: c, tw, t0: NaN, f0: 0, hold, k0 });
  }

  /** Take a birth record out; its tile's held deaths stop waiting for it. */
  _dropBirth(i) {
    const b = this._births.splice(i, 1)[0];
    b.hold.births -= 1;
    return b;
  }

  _disposeChunk(c) {
    if (c.mesh) {
      const bi = this._births.findIndex((b) => b.chunk === c);
      if (bi >= 0) this._fadePool.release(this._dropBirth(bi).tw);
      const di = this._dying.findIndex((d) => d.chunk === c);
      if (di >= 0) this._fadePool.release(this._dying.splice(di, 1)[0].tw);
      this.object.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.mesh = null;
    }
    c.data = null;
    c.count = 0;
  }

  // --- fades -------------------------------------------------------------------------

  _stepFades(nowSec) {
    this._fadeFrame += 1;
    const sec = this.budget.swapFadeSec ?? 0;
    const alt = this._agl;
    for (let i = this._births.length - 1; i >= 0; i--) {
      const b = this._births[i];
      const r = fadeRamp(rampT(b, nowSec, sec, this._fadeFrame));
      b.tw.uniform.value = alt * r;
      if (r >= 1) {
        b.chunk.mesh.material = this.material;
        this._fadePool.release(b.tw);
        this._dropBirth(i);
      }
    }
    for (let i = this._dying.length - 1; i >= 0; i--) {
      const d = this._dying[i];
      if (d.hold && d.hold.births > 0) {
        d.tw.uniform.value = alt * d.k0; // as it stands until the new set is in
        continue;
      }
      if (Number.isNaN(d.t0)) {
        d.t0 = nowSec;
        d.f0 = this._fadeFrame;
      }
      const r = fadeRamp(rampT(d, nowSec, sec, this._fadeFrame));
      d.tw.uniform.value = alt * d.k0 * (1 - r);
      if (r >= 1) {
        this._dying.splice(i, 1);
        this._fadePool.release(d.tw);
        this.object.remove(d.chunk.mesh);
        d.chunk.mesh.geometry.dispose();
        d.chunk.mesh = null;
        this._lodDirty = true;
      }
    }
  }

  _flushFades() {
    for (const b of this._births) {
      b.chunk.mesh.material = this.material;
      this._fadePool.release(b.tw);
      b.hold.births = 0;
    }
    this._births.length = 0;
    for (const d of this._dying) {
      this._fadePool.release(d.tw);
      this.object.remove(d.chunk.mesh);
      d.chunk.mesh.geometry.dispose();
      d.chunk.mesh = null;
    }
    this._dying.length = 0;
    this._lodDirty = true;
  }

  // --- level of detail -------------------------------------------------------------

  _lodPush(c) {
    const i = this._lodN++;
    if (i >= this._lodD.length) {
      const grown = new Float64Array(this._lodD.length * 2);
      grown.set(this._lodD);
      this._lodD = grown;
    }
    this._lodChunks[i] = c;
  }

  _sum(f) {
    const K = this._view.K;
    const minPx = this.budget.minPx;
    let t = 0;
    for (let i = 0; i < this._lodN; i++) {
      const c = this._lodChunks[i];
      t += countAtLeast(c.size, c.n, (minPx * f * this._lodD[i]) / K);
    }
    return t;
  }

  _fitFor(limit) {
    if (this._sum(1) <= limit) return 1;
    let lo = 1;
    let hi = 2;
    for (let it = 0; it < 48 && this._sum(hi) > limit; it++) hi *= 2;
    for (let it = 0; it < 14; it++) {
      const mid = (lo + hi) / 2;
      if (this._sum(mid) > limit) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  _lod(nowSec, px, pz) {
    const dt = Math.max(0, Math.min(0.25, nowSec - (Number.isFinite(this._lodT) ? this._lodT : nowSec)));
    this._lodT = nowSec;
    this._lodDirty = false;
    const B = this.budget;
    const R = this.ring;
    const k = mercK(pz);
    const agl = this._eyeAgl;
    this._lodN = 0;
    let resident = 0;
    let chunks = 0;
    const levels = this.stats.levels;
    levels[0] = levels[1] = levels[2] = 0;
    // Every mesh on the GPU: live, fading in, fading out.
    for (const tile of this.tiles.values()) {
      for (const c of tile.live) {
        chunks += 1;
        levels[c.level] += 1;
        if (c.mesh) this._lodPush(c);
      }
      if (tile.next) for (const c of tile.next.chunks) if (c.mesh && !tile.live.includes(c)) c.count = 0;
    }
    for (const d of this._dying) if (d.chunk.mesh) this._lodPush(d.chunk);
    const nearStart = R.nearM.start;
    for (let i = 0; i < this._lodN; i++) {
      const c = this._lodChunks[i];
      resident += c.n;
      const minX = c.cx - c.span / 2;
      const minZ = c.cz - c.span / 2;
      const near = rectDist(px, pz, minX, minZ, c.span) / k;
      const far = rectFar(px, pz, minX, minZ, c.span) / k;
      // Nothing draws inside the near hole or past the reach: 0 there. 300 m of
      // slack for the chase camera behind the player (the skyline's rule).
      if (far < nearStart || near > this.reachM) this._lodD[i] = Infinity;
      else this._lodD[i] = Math.max(50, Math.hypot(near, agl) - 300, nearStart);
    }
    const maxI = Math.floor(this.maxTriangles / STAND_IN_TRIANGLES);
    const H = B.hysteresis ?? {};
    let f = this._f;
    if (this._sum(f) > maxI) {
      const target = this._fitFor(Math.floor(maxI * (H.headroom ?? 0.9)));
      f += (target - f) * Math.min(1, dt / (H.riseSec ?? 0.2));
      if (this._sum(f) > maxI) f = this._fitFor(maxI); // never over the cap
    } else if (f > 1 && this._sum(f / (H.fallStep ?? 1.25)) <= maxI * (H.fallFill ?? 0.75)) {
      const target = Math.max(1, this._fitFor(Math.floor(maxI * (H.headroom ?? 0.9))));
      if (target < f) f += (target - f) * Math.min(1, dt / (H.fallSec ?? 4));
      if (this._sum(f) > maxI) f = this._fitFor(maxI);
    }
    if (!(f >= 1)) f = 1;
    this._f = f;
    const K = this._view.K;
    const minPx = B.minPx * f;
    let drawn = 0;
    for (let i = 0; i < this._lodN; i++) {
      const c = this._lodChunks[i];
      const n = this._agl > 0 ? countAtLeast(c.size, c.n, (minPx * this._lodD[i]) / K) : 0;
      c.count = n;
      c.d = this._lodD[i];
      c.mesh.geometry.instanceCount = n;
      c.mesh.visible = n > 0;
      drawn += n;
    }
    for (let i = 0; i < this._lodN; i++) this._lodChunks[i] = null;
    this.uniforms.uStandInView.value.set(K, minPx, B.fadePx, k);
    const s = this.stats;
    s.tiles = this.tiles.size;
    s.chunks = chunks;
    s.resident = resident;
    s.drawn = drawn;
    s.triangles = drawn * STAND_IN_TRIANGLES;
    s.minPx = Math.round(minPx * 100) / 100;
    const pending = this.queue.length + this.inFlight + this.ready.length;
    let missing = 0;
    for (const j of this.queue) if (j.missing) missing += 1;
    s.pending = pending;
    s.missing = missing;
    s.liveGeometries = this._liveGeometries;
  }

  // --- drape refinement -------------------------------------------------------------

  /**
   * Re-seat each instance on the drawn terrain at its own anchor, nearest chunk
   * first, the drawn prefix first, within budget.refineMs a frame. A finer
   * terrain tile under a building re-seats it; every resweepSec a chunk is swept again.
   */
  _refine(nowSec) {
    const budgetMs = this.budget.refineMs ?? 1;
    if (!(budgetMs > 0)) return;
    const t0 = this.clock();
    let pick = null;
    let pickD = Infinity;
    let stale = null;
    for (const tile of this.tiles.values()) {
      for (const c of tile.live) {
        if (!c.mesh || !c.gz) continue;
        const limit = Math.min(c.n, Math.ceil(c.count * 1.25) + 64);
        c.rLimit = limit;
        if (c.ri < limit) {
          if (c.d < pickD) {
            pickD = c.d;
            pick = c;
          }
        } else if (nowSec - c.rAt > (this.budget.resweepSec ?? 6) && (!stale || c.rAt < stale.rAt)) stale = c;
      }
    }
    if (!pick && stale) {
      stale.ri = 0;
      pick = stale;
    }
    if (!pick) return;
    const arr = pick.base.array;
    const ox = pick.cx;
    const oz = pick.cz;
    let lo = Infinity;
    let hi = -1;
    let yLo = pick.yLo;
    let yHi = pick.yHi;
    let n = 0;
    while (pick.ri < pick.rLimit) {
      const i = pick.ri++;
      const s = this.groundAt(lonOf(ox + pick.ax[i]), latOf(oz + pick.az[i]));
      n += 1;
      if (s && Number.isFinite(s.elev) && (s.tileZ | 0) >= pick.gz[i]) {
        pick.gz[i] = Math.max(1, s.tileZ | 0);
        if (Math.abs(s.elev - arr[i]) >= 0.02) {
          arr[i] = s.elev;
          if (i < lo) lo = i;
          if (i > hi) hi = i;
          if (s.elev < yLo) yLo = s.elev;
          if (s.elev > yHi) yHi = s.elev;
        }
      }
      if ((n & 15) === 0 && this.clock() - t0 > budgetMs) break;
    }
    if (pick.ri >= pick.rLimit) pick.rAt = nowSec;
    if (hi >= lo) {
      pick.base.addUpdateRange(lo, hi - lo + 1);
      pick.base.needsUpdate = true;
      const bs = pick.mesh.geometry.boundingSphere;
      const cy = (yLo + yHi + pick.maxH) / 2;
      bs.radius = Math.max(bs.radius, pick.baseRadius + Math.abs(cy - bs.center.y), (yHi + pick.maxH - yLo) / 2 + 50);
      bs.center.y = cy;
      pick.yLo = yLo;
      pick.yHi = yHi;
      this.stats.refined += 1;
    }
  }

  // --- teardown ---------------------------------------------------------------------

  /** Meshes the engine holds (live, incoming, fading). Diagnostics and gates. */
  meshCount() {
    return this.object.children.length;
  }

  get liveGeometries() {
    return this._liveGeometries;
  }

  /**
   * Undo dispose() for a re-run effect (React StrictMode runs an effect, its
   * cleanup, then the effect again on the same memoized engine). The material
   * and the twins rebuild their GPU state on the next draw.
   */
  revive() {
    if (!this._disposed) return;
    this._disposed = false;
    this._session += 1;
    this.inFlight = 0;
    this._lastRefresh.x = Infinity;
    this._lastRefresh.t = -Infinity;
    this._vel.px = undefined;
    this._prefetchSig = '';
    this._lodDirty = true;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._flushFades();
    for (const [key, tile] of [...this.tiles]) this._evictTile(key, tile, true);
    for (const rec of this.ready) this._disposeChunk(rec);
    this.ready.length = 0;
    this.queue.length = 0;
    this._deferred.length = 0;
    for (const child of [...this.object.children]) {
      this.object.remove(child);
      child.geometry?.dispose();
    }
    this._fadePool.dispose();
    this.material.dispose();
    this.api = null;
    this.stats.liveGeometries = this._liveGeometries;
  }
}

/**
 * The carpet's one program variant (the stand-in program + the near hole), for
 * the prewarm registry: a single-instance mesh whose material carries exactly
 * the key a live carpet chunk uses. The caller compiles and disposes it.
 */
export function buildCarpetPrewarm({ reachCfg = {}, lighting = true } = {}) {
  const footprintK = reachCfg.worker?.footprintK ?? 0.5;
  const data = {
    n: 1, ax: new Float32Array(1), az: new Float32Array(1),
    dim: new Uint16Array([655, 655, 2100, 0]), wall: new Uint8Array([180, 160, 140, 3]),
    roof: new Uint8Array([110, 110, 110, 17]), gnd: new Uint8Array([100, 100, 100, 0]),
    size: new Float32Array([32]), bottom: new Uint16Array(1), maxH: 32,
  };
  const geometry = createStandInGeometry(data, new Float32Array(1), 100).clone();
  geometry.instanceCount = 1;
  const material = createStandInMaterial({ lighting, uniforms: createStandInUniforms(reachCfg), footprintK, nearHole: { value: new Vector2(0, 1) } });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'horizon-fill-prewarm';
  return mesh;
}
