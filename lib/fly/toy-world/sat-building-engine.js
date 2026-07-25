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
import { SAT_BLDG_FADE, SAT_BUILDINGS, SAT_WATER } from '../fly-constants';
import { applyBendAnchorSat, applyBendWaterSat, setSatBldgFade } from './world-bend';

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
const EXPECTED_WORKER_PROTOCOL = 13;
let _warnedProtocol = false;

const EARTH_R = 6378137;
const WORLD_SIZE = 2 * Math.PI * EARTH_R;
const RAD2DEG = 180 / Math.PI;

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

function hexTriplet(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
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
    this.material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
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
    this._ringOn = false; // altitude hysteresis (armed = buildings streaming)
    this._warpCoarseUntil = 0;
    this._disposed = false;
  }

  /**
   * Tier gate for DAYLIGHT facade windows (SatBuildingLayer flips it). Unlike
   * water, nothing re-streams: the uv attribute is always in the geometry, so
   * arming/disarming is a material swap the already-uploaded chunks pick up.
   */
  setFacadeEnabled(v) {
    if (v === this.facadeEnabled || this._disposed) return;
    this.facadeEnabled = v;
    if (v && !this._facadeTex) this._facadeTex = makeFacadeAtlas(false);
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
    if (v && !this._nightTex) this._nightTex = makeFacadeAtlas(true);
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
            return;
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
    // The fade uniform is module-shared: hand it back at 1 so a re-mount (style
    // flip / StrictMode) never starts a fresh engine mid-dissolve.
    setSatBldgFade(1);
    for (const [key, chunk] of [...this.chunks]) this._evict(key, chunk);
    this.queue.length = 0;
    this.pendingFinalize.length = 0;
    this.material.dispose();
    if (this._facadeTex) this._facadeTex.dispose();
    if (this._nightTex) this._nightTex.dispose();
    if (this.waterMaterial) this.waterMaterial.dispose();
    if (this._waterTex) this._waterTex.dispose();
  }
}
