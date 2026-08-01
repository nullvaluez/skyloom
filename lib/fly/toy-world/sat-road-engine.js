import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { SAT_ROADS, SUBURB_NIGHT } from '../fly-constants';
import {
  applyBendRoadSat,
  getSatRoadNight,
  setSatRoadClock,
  setSatRoadMix,
} from './world-bend';

// Must match vector-tile.worker.js WORKER_PROTOCOL (round 16 → 13). Round 16
// ADDED the 'sat-roads' detail; a stale protocol-12 worker has no such branch,
// so the string falls through its dispatch to the FULL TOY pipeline and it
// answers with a land/water/building toy bundle that has no `satRoads` key at
// all. Reading a toy bundle as roads is meaningless, so ANY v-mismatch is
// DROPPED here (dev-warn once, render nothing) — the R15 sat-building sentinel
// contract, for the same reason: no crash, no wrong pixels, and the warn tells
// the dev to hard-reload.
// Round 18 → 14: the worker gained 'sat-skyline'/'sat-veg' + new sat-buildings
// output keys. Roads are byte-unchanged; this pin moves in lockstep so a v13
// worker (which cannot answer the new details at all) is still correctly read
// as stale here.
// Round 19 → 15: scaffolding lockstep (six pin sites, one diff). Roads are
// byte-unchanged at bump time; C GROUNDTRUTH adds day terms later in-round.
const EXPECTED_WORKER_PROTOCOL = 15;
let _warnedProtocol = false;

const EARTH_R = 6378137;
const WORLD_SIZE = 2 * Math.PI * EARTH_R;
const RAD2DEG = 180 / Math.PI;

// Chunk GPU uploads per frame (spike guard — the SAT_BUILDINGS.finalizePerFrame
// discipline; a road chunk is one merged geometry, so one per frame is plenty).
const FINALIZE_PER_FRAME = 1;

/**
 * Round 16 (A2 "GND-W") — the SATELLITE ground-light network chunk manager.
 *
 * Structurally a SatBuildingEngine: a lean single-ring streamer around the
 * player that is PURPOSE-BUILT (never ToyWorldEngine — that class is what
 * ToyWorldLayer publishes as window.__toyWorld, which verify-round11 gate A
 * asserts stays undefined in satellite). SatRoadLayer publishes this one as
 * window.__satRoads.
 *
 * Each streamed z13 tile → one worker 'sat-roads' build → ONE merged additive
 * mesh (one draw) carrying the whole local road web AND its airports' runway
 * edge lights. The worker emits flat ribbons at y=0; this class drapes them on
 * a per-chunk bilinear RAW-DEM grid (the toy drape pattern — a road network
 * spans kilometres and must follow the relief; the per-building exact-centroid
 * sampling the building engine uses has no meaning for a polyline) plus a small
 * `liftM` so the ribbons sit over the imagery instead of z-fighting it.
 *
 * Everything that MOVES on those ribbons — the steady night glow, streetlight
 * dots, headlight dash trains, the day glint, runway lights — is a fragment
 * term on the ONE shared material (world-bend `applyBendRoadSat`), driven by
 * uniforms this class writes each frame. The sun therefore never changes the
 * draw count: the same geometry is submitted at noon and at midnight.
 *
 * Differences from the building ring that are deliberate:
 *   • z13 / r12000 (≈9.6 km at Owens Valley) — no tile-URL overlap with the
 *     z14 building ring, and one z13 tile holds a whole town's grid.
 *   • cullAglOnM 4200 / cullAglOffM 5200 — the light NETWORK stays legible far
 *     above the altitude at which individual buildings stop reading.
 *   • depthWrite off / depthTest ON + renderOrder 3: additive glow that still
 *     hides behind terrain it is genuinely behind.
 *
 * PUBLIC CONTRACT (frozen — SatRoadLayer, Wave 2, consumes exactly this):
 *   new SatRoadEngine({ groundAt })
 *   setWorker(api) · notifyWarp(nowSec) ·
 *   update(nowSec, playerX, playerZ, eyeAglM, sunFrac) ·
 *   get stats · .object · dispose()
 */
export class SatRoadEngine {
  constructor({ groundAt }) {
    this.object = new Group();
    this.object.name = 'sat-roads';
    this.groundAt = groundAt; // (lonDeg, latDeg) => {elev, tileZ} | null
    this.worker = null;

    // ONE material shared by every chunk. MeshBasic: the network is EMISSIVE
    // (street lighting), not lit — a scene light on it would make the glow
    // swing with the sun twice. Additive + depthWrite:false so overlapping
    // ribbons at a junction brighten instead of z-fighting, depthTest:true so a
    // ridge still occludes the town behind it. Vertex colors carry the baked
    // class hue; the fragment terms multiply it.
    this.material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    // Round 19 (C GROUNDTRUTH): SUBURB_NIGHT rides in as the third argument —
    // the cls 5-6 streetlight envelope and the daylight seam. Passing the
    // block (rather than reading it inside world-bend) keeps world-bend
    // constants-free, the horizonFade/roadNightRamp precedent. Disabled ⇒
    // world-bend leaves both uniforms at their additive identity.
    applyBendRoadSat(this.material, SAT_ROADS, SUBURB_NIGHT);

    this.chunks = new Map(); // key "z/x/y" -> chunk record
    this.queue = [];
    this.building = 0;
    this.pendingFinalize = [];
    this._lastRefreshPos = { x: Infinity, z: Infinity };
    this._lastRefreshT = 0;
    this._ringOn = false; // altitude hysteresis (armed = roads streaming)
    this._warpCoarseUntil = 0;
    this._disposed = false;
  }

  setWorker(workerApi) {
    this.worker = workerApi;
    this._disposed = false;
    this._lastRefreshPos = { x: Infinity, z: Infinity };
    this._lastRefreshT = 0;
  }

  notifyWarp(nowSec) {
    this._warpCoarseUntil = nowSec + SAT_ROADS.warpCoarseWindowSec;
  }

  /**
   * Per-frame. playerX/Z absolute world; eyeAglM = eye altitude above ground;
   * sunFrac = runtime.sun.frac (1 = noon, 0 = night). The two uniform writes are
   * unconditional (they are two scalar assignments — cheaper than the branch
   * that would skip them) and happen even while the ring is culled, so the very
   * first chunk that streams in is already at the right time of day.
   */
  update(nowSec, playerX, playerZ, eyeAglM, sunFrac) {
    if (this._disposed) return;
    setSatRoadClock(nowSec);
    setSatRoadMix(sunFrac);
    if (!this.worker) return;
    const movedSq =
      (playerX - this._lastRefreshPos.x) ** 2 + (playerZ - this._lastRefreshPos.z) ** 2;
    if (
      movedSq > SAT_ROADS.refreshMoveM ** 2 ||
      nowSec - this._lastRefreshT > SAT_ROADS.refreshSec
    ) {
      this._lastRefreshPos = { x: playerX, z: playerZ };
      this._lastRefreshT = nowSec;
      this._refreshDesired(playerX, playerZ, eyeAglM);
    }
    this._pumpQueue();
    this._drapePending();
    this._finalizePending(nowSec);
  }

  // --- desired set: single z13 ring, altitude-gated with hysteresis -----------
  _refreshDesired(px, pz, eyeAglM) {
    const S = SAT_ROADS;
    if (this._ringOn) {
      if (eyeAglM > S.cullAglOffM) this._ringOn = false;
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
    const r = S.ring.r;
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
        desired.push({
          z,
          x: tx,
          y: ty,
          detail: 'sat-roads',
          distSq: (cx - px) ** 2 + (cz - pz) ** 2,
        });
      }
    }
    desired.sort((a, b) => a.distSq - b.distSq);
    const kept = desired.slice(0, S.maxChunks); // nearest win — hard draw bound
    const keep = new Set(kept.map((e) => `${e.z}/${e.x}/${e.y}`));

    for (const [key, chunk] of this.chunks) {
      if (!keep.has(key)) this._evict(key, chunk);
    }
    // Heal coarse-accepted chunks once real DEM answers at their center.
    let healed = 0;
    for (const [key, chunk] of this.chunks) {
      if (healed >= 2 || !chunk.coarse || chunk.state !== 'ready' || !chunk.tile) continue;
      const t = chunk.tile;
      const wx = -half + t.x * span + span / 2;
      const wz = -(half - t.y * span) + span / 2;
      const s = this.groundAt(
        (wx / EARTH_R) * RAD2DEG,
        (2 * Math.atan(Math.exp(-wz / EARTH_R)) - Math.PI / 2) * RAD2DEG
      );
      if (s && s.tileZ >= S.demZ) {
        this._evict(key, chunk);
        healed += 1;
      }
    }
    this.queue = kept.filter((e) => !this.chunks.has(`${e.z}/${e.x}/${e.y}`));
    this.pendingFinalize = this.pendingFinalize.filter((p) => keep.has(p.key));
  }

  _pumpQueue() {
    while (this.building < SAT_ROADS.maxBuilds && this.queue.length > 0) {
      const e = this.queue.shift();
      const key = `${e.z}/${e.x}/${e.y}`;
      if (this.chunks.has(key)) continue;
      this.chunks.set(key, { state: 'building', mesh: null, tile: e });
      this.building += 1;
      this.worker
        .buildTile(e.z, e.x, e.y, 'sat-roads')
        .then((result) => {
          this.building -= 1;
          const chunk = this.chunks.get(key);
          if (this._disposed || !chunk || chunk.state !== 'building') return;
          // Sentinel: a stale worker predates the 'sat-roads' detail entirely
          // and answers with a TOY bundle (land/water/building keys, no
          // satRoads) — DROP it, never try to read those arrays as roads.
          if (result && result.v !== EXPECTED_WORKER_PROTOCOL) {
            if (process.env.NODE_ENV === 'development' && !_warnedProtocol) {
              _warnedProtocol = true;
              console.warn(
                `[sat-roads] worker protocol ${result.v} != expected ${EXPECTED_WORKER_PROTOCOL} ` +
                  '(stale worker after HMR/dev-server restart?) — roads skipped; hard-reload to refresh.'
              );
            }
            chunk.state = 'empty';
            return;
          }
          // No satRoads key = open ocean, an all-tunnel tile, or the worker's
          // minFeatures floor shedding a sparse rural tile. All three mean the
          // same thing here: this chunk costs zero draws.
          if (!result || result.empty || !result.satRoads) {
            chunk.state = 'empty';
            return;
          }
          chunk.state = 'draping';
          this.pendingFinalize.push({ key, tile: e, result, grid: null, gi: 0 });
        })
        .catch((err) => {
          this.building -= 1;
          const chunk = this.chunks.get(key);
          if (chunk && chunk.state === 'building') this.chunks.delete(key);
          if (process.env.NODE_ENV === 'development')
            console.warn(`[sat-roads] build ${key} failed:`, err?.message ?? err);
        });
    }
  }

  // --- drape: budgeted per-CHUNK bilinear RAW-DEM grid ------------------------
  // A road is a long polyline, not a footprint: it must FOLLOW the relief, so
  // this samples the toy-style (G+1)² grid over the tile and interpolates per
  // vertex at finalize (the worker already subdivided any run longer than
  // maxSegM so the interpolation has vertices to act on). RAW DEM — no toy
  // ×1.7 exaggeration (the R11 monuments lesson: satellite ground is raw).
  _drapePending() {
    if (this.pendingFinalize.length === 0) return;
    const t0 = performance.now();
    const G = SAT_ROADS.gridSegments;
    const N = (G + 1) * (G + 1);
    for (const p of this.pendingFinalize) {
      if (!p.grid) {
        p.grid = new Float32Array(N);
        p.gi = 0;
        p.nulls = 0;
      }
      const span = WORLD_SIZE / 2 ** p.tile.z;
      const minX = -WORLD_SIZE / 2 + p.tile.x * span;
      const minZ = -(WORLD_SIZE / 2 - p.tile.y * span);
      while (p.gi < N) {
        const gx = p.gi % (G + 1);
        const gz = (p.gi / (G + 1)) | 0;
        const wx = minX + (gx / G) * span;
        const wz = minZ + (gz / G) * span;
        const lon = (wx / EARTH_R) * RAD2DEG;
        const lat = (2 * Math.atan(Math.exp(-wz / EARTH_R)) - Math.PI / 2) * RAD2DEG;
        const s = this.groundAt(lon, lat);
        // A low-zoom fallback tile "answers" with plateau garbage — count it as
        // a miss so the finalize gate holds until real DEM streams in.
        if (!s || s.tileZ < SAT_ROADS.demZ) p.nulls += 1;
        p.grid[p.gi] = s?.elev ?? 0;
        p.gi += 1;
        if (performance.now() - t0 > SAT_ROADS.drapeBudgetMs) return;
      }
    }
  }

  // --- finalize: apply drape + upload one merged additive mesh ----------------
  _finalizePending(nowSec = 0) {
    const S = SAT_ROADS;
    const G = S.gridSegments;
    const N = (G + 1) * (G + 1);
    let done = 0;
    for (let i = 0; i < this.pendingFinalize.length && done < FINALIZE_PER_FRAME; i++) {
      const p = this.pendingFinalize[i];
      if (!p.grid || p.gi < N) continue; // still sampling
      const badFrac = (p.nulls ?? 0) / N;
      const maxTries = nowSec < (this._warpCoarseUntil ?? 0) ? S.warpCoarseTries : S.drapeMaxTries;
      if (badFrac > 0.05 && (p.tries ?? 0) < maxTries) {
        if (nowSec >= (p.retryAt ?? 0)) {
          p.tries = (p.tries ?? 0) + 1;
          p.retryAt = nowSec + 1.5;
          p.gi = 0;
          p.nulls = 0;
        }
        continue;
      }
      const coarseAccepted = badFrac > 0.05;
      this.pendingFinalize.splice(i, 1);
      i -= 1;
      done += 1;
      const chunk = this.chunks.get(p.key);
      if (!chunk || chunk.state !== 'draping') continue;
      chunk.coarse = coarseAccepted; // healed later when real DEM arrives
      chunk.tile = p.tile;

      const span = WORLD_SIZE / 2 ** p.tile.z;
      const cx = -WORLD_SIZE / 2 + p.tile.x * span + span / 2;
      const cz = -(WORLD_SIZE / 2 - p.tile.y * span) + span / 2;
      const grid = p.grid;
      const w = G + 1;
      const height = (lx, lz) => {
        // bilinear over the chunk grid; local coords are tile-center origin
        const fx = Math.min(Math.max(((lx + span / 2) / span) * G, 0), G - 1e-6);
        const fz = Math.min(Math.max(((lz + span / 2) / span) * G, 0), G - 1e-6);
        const x0 = fx | 0;
        const z0 = fz | 0;
        const tx = fx - x0;
        const tz = fz - z0;
        const h00 = grid[z0 * w + x0];
        const h10 = grid[z0 * w + x0 + 1];
        const h01 = grid[(z0 + 1) * w + x0];
        const h11 = grid[(z0 + 1) * w + x0 + 1];
        return (
          h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz
        );
      };

      const rd = p.result.satRoads;
      const pos = rd.pos; // mutate in place (transferred, owned here)
      for (let v = 0; v < pos.length; v += 3) {
        // the worker wrote y = 0 exactly; this ASSIGNS the draped ground + lift
        pos[v + 1] = height(pos[v], pos[v + 2]) + S.liftM;
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('color', new BufferAttribute(rd.col, 3));
      // FAIL DARK — what each attribute reads as if it ever went missing:
      //   aRoadCls absent → 0 → the shader's 8-entry class LUT index 0, which is
      //     RESERVED at weight 0 → every light term multiplies to black, and
      //     black on an ADDITIVE material is invisible. This is the guard that
      //     matters: no wrong pixels, no flat-lit slab over the imagery.
      //   aRoadArc absent → 0 → every dash/lamp phase pins at 0 (a static
      //     pattern), but it can never be seen because the cls gate above is
      //     what turns a fragment on at all.
      //   `color` absent → three's default white → would only matter if cls also
      //     survived, i.e. never.
      // A bundle without these arrays cannot reach here anyway: a protocol
      // mismatch is dropped in _pumpQueue, and a v13 bundle always carries all
      // five arrays or no satRoads key at all.
      geo.setAttribute('aRoadArc', new BufferAttribute(rd.arc, 1));
      geo.setAttribute('aRoadCls', new BufferAttribute(rd.cls, 1));
      geo.setIndex(new BufferAttribute(rd.idx, 1));
      geo.computeBoundingSphere();
      const mesh = new Mesh(geo, this.material);
      mesh.position.set(cx, 0, cz);
      mesh.frustumCulled = true;
      mesh.renderOrder = 3; // additive, after the opaque tiles/buildings
      this.object.add(mesh);
      chunk.mesh = mesh;
      chunk.state = 'ready';
    }
  }

  _evict(key, chunk) {
    if (chunk.mesh) {
      this.object.remove(chunk.mesh);
      chunk.mesh.geometry.dispose(); // shared material — geometry only
      chunk.mesh = null;
    }
    this.chunks.delete(key);
  }

  /** Dev telemetry (window.__satRoads.stats / __flyStats.satRoads). */
  get stats() {
    let ready = 0; // = ROAD draw calls (one merged mesh per non-empty chunk)
    let empty = 0;
    for (const c of this.chunks.values()) {
      if (c.mesh) ready += 1;
      if (c.state === 'empty') empty += 1;
    }
    return {
      chunks: this.chunks.size,
      ready,
      empty,
      queued: this.queue.length,
      building: this.building,
      draping: this.pendingFinalize.length,
      ringOn: this._ringOn,
      // Round 19 (C): the live SUBURB_NIGHT road uniforms + the FINAL program
      // cache key, surfaced for verify-groundlife. Read back off the material
      // the GPU is using, not off the constants — that is what makes it a
      // wiring gate rather than a restatement of the config file.
      night: getSatRoadNight(),
      cacheKey: this.material.customProgramCacheKey?.() ?? null,
    };
  }

  dispose() {
    this._disposed = true;
    for (const [key, chunk] of [...this.chunks]) this._evict(key, chunk);
    this.queue.length = 0;
    this.pendingFinalize.length = 0;
    this.material.dispose();
  }
}
