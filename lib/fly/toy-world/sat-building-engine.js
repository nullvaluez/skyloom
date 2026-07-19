import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  MeshPhongMaterial,
  RepeatWrapping,
  TextureLoader,
  Vector2,
} from 'three';
import { SAT_BUILDINGS, SAT_WATER } from '../fly-constants';
import { applyBendAnchorSat, applyBendWaterSat } from './world-bend';

// Must match vector-tile.worker.js WORKER_PROTOCOL (round 13 → 11). On mismatch
// (a stale HMR worker paired with new engine code) this engine dev-warns ONCE
// and renders nothing for buildings — a protocol-10 worker returns a tile with
// no `satWater` key (and an older one no `satBuilding` key) so the affected
// layer just does not draw (safe: no crash). The warn tells the dev to
// hard-reload the worker.
const EXPECTED_WORKER_PROTOCOL = 11;
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
    this._ringOn = false; // altitude hysteresis (armed = buildings streaming)
    this._warpCoarseUntil = 0;
    this._disposed = false;
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
      for (const chunk of this.chunks.values()) this._evictWater(chunk);
    } else {
      for (const [key, chunk] of [...this.chunks]) this._evict(key, chunk);
      this.queue.length = 0;
      this.pendingFinalize.length = 0;
      this._lastRefreshPos = { x: Infinity, z: Infinity };
    }
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
    // Gentle normal-map scroll → the sun glints shimmer (one shared texture).
    if (this._waterTex) {
      this._waterTex.offset.x = (nowSec * SAT_WATER.scrollMps) % 1;
      this._waterTex.offset.y = (nowSec * SAT_WATER.scrollMps * 0.6) % 1;
    }
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
          // Round 13 (P4): a tile is worth finalizing if it has buildings OR
          // (water-glint armed) water — open-harbor tiles often have no
          // buildings but ARE the water we want (e.g. NYC harbor).
          const hasWater = this.waterEnabled && !!result.satWater;
          if (!result || result.empty || (!result.satBuilding && !hasWater)) {
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
      }
      this.pendingFinalize.splice(i, 1);
      i -= 1;
      done += 1;
      const chunk = this.chunks.get(p.key);
      if (!chunk || chunk.state !== 'draping') continue;
      chunk.coarse = bld ? p.coarse : false;
      chunk.tile = p.tile;

      const span = WORLD_SIZE / 2 ** p.tile.z;
      const cx = -WORLD_SIZE / 2 + p.tile.x * span + span / 2;
      const cz = -(WORLD_SIZE / 2 - p.tile.y * span) + span / 2;

      if (bld) {
        const pos = bld.pos; // mutate in place (transferred, owned here)
        for (let v = 0, vi = 0; v < pos.length; v += 3, vi += 1) {
          // each building sits level on its OWN exact ground; the -baseSink base
          // tucks under so slope/hill gaps hide.
          pos[v + 1] += p.groundY[vi];
        }
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(pos, 3));
        geo.setAttribute('color', new BufferAttribute(bld.col, 3));
        geo.setAttribute('aBendAnchor', new BufferAttribute(bld.anchor, 2));
        geo.setIndex(new BufferAttribute(bld.idx, 1));
        geo.computeVertexNormals(); // walls are vertex-independent → crisp faces
        geo.computeBoundingSphere();
        const mesh = new Mesh(geo, this.material);
        mesh.position.set(cx, 0, cz);
        mesh.frustumCulled = true;
        this.object.add(mesh);
        chunk.mesh = mesh;
      }

      // Round 13 (P4): water-glint mesh (one merged additive plane, draped to the
      // chunk-center ground — harbors/lakes read flat at their local water level).
      const water = p.result.satWater;
      if (water && this.waterEnabled) {
        const lon = (cx / EARTH_R) * RAD2DEG;
        const lat = (2 * Math.atan(Math.exp(-cz / EARTH_R)) - Math.PI / 2) * RAD2DEG;
        const g = this.groundAt(lon, lat);
        const waterY = (g?.elev ?? 0) + SAT_WATER.liftM;
        const wgeo = new BufferGeometry();
        wgeo.setAttribute('position', new BufferAttribute(water.pos, 3));
        wgeo.setAttribute('uv', new BufferAttribute(water.uv, 2));
        wgeo.setIndex(new BufferAttribute(water.idx, 1));
        wgeo.computeVertexNormals(); // flat plane → up normals; normal map ripples them
        wgeo.computeBoundingSphere();
        const wmesh = new Mesh(wgeo, this._ensureWaterMaterial());
        wmesh.position.set(cx, waterY, cz);
        wmesh.frustumCulled = true;
        wmesh.renderOrder = 3; // additive, after opaque tiles/buildings
        this.object.add(wmesh);
        chunk.water = wmesh;
      }
      chunk.state = 'ready';
    }
  }

  _evict(key, chunk) {
    if (chunk.mesh) {
      this.object.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      chunk.mesh = null;
    }
    this._evictWater(chunk);
    this.chunks.delete(key);
  }

  /** Remove just a chunk's water mesh (shared material — geometry only). */
  _evictWater(chunk) {
    if (chunk.water) {
      this.object.remove(chunk.water);
      chunk.water.geometry.dispose();
      chunk.water = null;
    }
  }

  /** Dev telemetry (window.__flyStats.satBuildings*). */
  get stats() {
    let ready = 0; // = BUILDING draw calls (one merged building mesh per chunk)
    let waterReady = 0; // = water-glint draw calls (round 13 P4)
    let empty = 0;
    for (const c of this.chunks.values()) {
      if (c.mesh) ready += 1;
      if (c.water) waterReady += 1;
      if (c.state === 'empty') empty += 1;
    }
    return {
      chunks: this.chunks.size,
      ready,
      waterReady,
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
    if (this.waterMaterial) this.waterMaterial.dispose();
    if (this._waterTex) this._waterTex.dispose();
  }
}
