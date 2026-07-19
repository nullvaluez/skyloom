import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshLambertMaterial,
} from 'three';
import { SAT_BUILDINGS } from '../fly-constants';
import { applyBendAnchorSat } from './world-bend';

// Must match vector-tile.worker.js WORKER_PROTOCOL (round 13 → 10). On mismatch
// (a stale HMR worker paired with new engine code) this engine dev-warns ONCE
// and renders nothing for buildings — a protocol-9 worker has no 'sat-buildings'
// branch, so it returns a tile with NO `satBuilding` key (safe: no draw, no
// crash). The warn tells the dev to hard-reload the worker.
const EXPECTED_WORKER_PROTOCOL = 10;
let _warnedProtocol = false;

const EARTH_R = 6378137;
const WORLD_SIZE = 2 * Math.PI * EARTH_R;
const RAD2DEG = 180 / Math.PI;

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
    this.material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    applyBendAnchorSat(this.material); // rigid per-building anchor bend

    this.chunks = new Map(); // key "z/x/y" -> chunk record
    this.queue = [];
    this.building = 0;
    this.pendingFinalize = [];
    this._lastRefreshPos = { x: Infinity, z: Infinity };
    this._lastRefreshT = 0;
    this._ringOn = false; // altitude hysteresis (armed = buildings streaming)
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
    this._warpCoarseUntil = nowSec + SAT_BUILDINGS.warpCoarseWindowSec;
  }

  /** Per-frame. playerX/Z absolute world; eyeAglM = eye altitude above ground. */
  update(nowSec, playerX, playerZ, eyeAglM) {
    if (this._disposed || !this.worker) return;
    const movedSq =
      (playerX - this._lastRefreshPos.x) ** 2 + (playerZ - this._lastRefreshPos.z) ** 2;
    if (
      movedSq > SAT_BUILDINGS.refreshMoveM ** 2 ||
      nowSec - this._lastRefreshT > SAT_BUILDINGS.refreshSec
    ) {
      this._lastRefreshPos = { x: playerX, z: playerZ };
      this._lastRefreshT = nowSec;
      this._refreshDesired(playerX, playerZ, eyeAglM);
    }
    this._pumpQueue();
    this._drapePending();
    this._finalizePending(nowSec);
  }

  // --- desired set: single z14-class ring, altitude-gated with hysteresis -----
  _refreshDesired(px, pz, eyeAglM) {
    const S = SAT_BUILDINGS;
    // Altitude hysteresis: buildings are a low-AGL detail (invisible from cruise).
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
        desired.push({ z, x: tx, y: ty, detail: 'sat-buildings', distSq: (cx - px) ** 2 + (cz - pz) ** 2 });
      }
    }
    desired.sort((a, b) => a.distSq - b.distSq);
    const kept = desired.slice(0, S.maxChunks);
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
    while (this.building < SAT_BUILDINGS.maxBuilds && this.queue.length > 0) {
      const e = this.queue.shift();
      const key = `${e.z}/${e.x}/${e.y}`;
      if (this.chunks.has(key)) continue;
      this.chunks.set(key, { state: 'building', mesh: null, tile: e });
      this.building += 1;
      this.worker
        .buildTile(e.z, e.x, e.y, 'sat-buildings')
        .then((result) => {
          this.building -= 1;
          const chunk = this.chunks.get(key);
          if (this._disposed || !chunk || chunk.state !== 'building') return;
          if (
            process.env.NODE_ENV === 'development' &&
            !_warnedProtocol &&
            result &&
            result.v !== EXPECTED_WORKER_PROTOCOL
          ) {
            _warnedProtocol = true;
            console.warn(
              `[sat-buildings] worker protocol ${result.v} != expected ${EXPECTED_WORKER_PROTOCOL} ` +
                '(stale worker after HMR/dev-server restart?) — buildings skipped; hard-reload to refresh.'
            );
          }
          if (!result || result.empty || !result.satBuilding) {
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
      const nV = p.result.satBuilding.anchor.length / 2;
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
      const coarseAccepted = badFrac > 0.05;
      this.pendingFinalize.splice(i, 1);
      i -= 1;
      done += 1;
      const chunk = this.chunks.get(p.key);
      if (!chunk || chunk.state !== 'draping') continue;
      chunk.coarse = coarseAccepted;
      chunk.tile = p.tile;

      const span = WORLD_SIZE / 2 ** p.tile.z;
      const cx = -WORLD_SIZE / 2 + p.tile.x * span + span / 2;
      const cz = -(WORLD_SIZE / 2 - p.tile.y * span) + span / 2;

      const data = p.result.satBuilding;
      const pos = data.pos; // mutate in place (transferred, owned here)
      for (let v = 0, vi = 0; v < pos.length; v += 3, vi += 1) {
        // each building sits level on its OWN exact ground; the -baseSink base
        // tucks under so slope/hill gaps hide.
        pos[v + 1] += p.groundY[vi];
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('color', new BufferAttribute(data.col, 3));
      geo.setAttribute('aBendAnchor', new BufferAttribute(data.anchor, 2));
      geo.setIndex(new BufferAttribute(data.idx, 1));
      geo.computeVertexNormals(); // walls are vertex-independent → crisp faces
      geo.computeBoundingSphere();
      const mesh = new Mesh(geo, this.material);
      mesh.position.set(cx, 0, cz);
      mesh.frustumCulled = true;
      this.object.add(mesh);
      chunk.mesh = mesh;
      chunk.state = 'ready';
    }
  }

  _evict(key, chunk) {
    if (chunk.mesh) {
      this.object.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      chunk.mesh = null;
    }
    this.chunks.delete(key);
  }

  /** Dev telemetry (window.__flyStats.satBuildings*). */
  get stats() {
    let ready = 0;
    let empty = 0;
    for (const c of this.chunks.values()) {
      if (c.state === 'ready') ready += 1;
      else if (c.state === 'empty') empty += 1;
    }
    return {
      chunks: this.chunks.size,
      ready, // = building draw calls (one merged mesh per non-empty chunk)
      empty,
      queued: this.queue.length,
      building: this.building,
      draping: this.pendingFinalize.length,
      ringOn: this._ringOn,
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
