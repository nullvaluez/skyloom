import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshLambertMaterial,
} from 'three';
import { SAT_BLDG_FADE, SAT_BUILDINGS, SAT_SKYLINE } from '../fly-constants';
import { applyBendAnchorSatSkyline, setSatSkyline } from './world-bend';

// Must match vector-tile.worker.js WORKER_PROTOCOL. A1 froze the 'sat-skyline'
// branch at protocol 14; a v13 worker (a stale HMR/dev-restart pairing) has no
// such branch at all and would answer `{empty:true}` forever, so the drop is
// belt-and-braces — but it is the SAME drop-and-warn contract the other three
// satellite engines take, and it is the honest read of "stale worker": render
// nothing, never wrong pixels, one dev warn telling the dev to hard-reload.
const EXPECTED_WORKER_PROTOCOL = 14;
let _warnedProtocol = false;

const EARTH_R = 6378137;
const WORLD_SIZE = 2 * Math.PI * EARTH_R;
const RAD2DEG = 180 / Math.PI;

const smoothstep01 = (v) => {
  const t = v < 0 ? 0 : v > 1 ? 1 : v;
  return t * t * (3 - 2 * t);
};

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
    this.material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    applyBendAnchorSatSkyline(this.material);

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
  }

  /** Tier gate (SatSkylineLayer): SAT_SKYLINE.maxChunksByTier → group cap. */
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

  setWorker(workerApi) {
    this.worker = workerApi;
    this._disposed = false;
    this._lastRefreshPos = { x: Infinity, z: Infinity };
    this._lastRefreshT = 0;
  }

  notifyWarp(nowSec) {
    this._warpCoarseUntil = nowSec + SAT_SKYLINE.warpCoarseWindowSec;
    this._lastRefreshPos = { x: Infinity, z: Infinity }; // stream the destination now
  }

  /**
   * Per-frame, from SatSkylineLayer's useFrame. playerX/Z absolute world;
   * eyeAglM = eye altitude above ground; refGroundY = the player's ground
   * elevation, used as the fallback when a far DEM sample has not streamed yet
   * (0 would sink Denver's skyline 1.6 km underground).
   */
  update(nowSec, playerX, playerZ, eyeAglM, refGroundY = 0) {
    if (this._disposed) return;
    const { holeRadiusM, fade } = this._writeChoreography(eyeAglM);
    this._updateVisibility(playerX, playerZ, holeRadiusM, fade);
    if (!this.worker) return;
    const movedSq =
      (playerX - this._lastRefreshPos.x) ** 2 + (playerZ - this._lastRefreshPos.z) ** 2;
    if (
      movedSq > SAT_SKYLINE.refreshMoveM ** 2 ||
      nowSec - this._lastRefreshT > SAT_SKYLINE.refreshSec
    ) {
      this._lastRefreshPos = { x: playerX, z: playerZ };
      this._lastRefreshT = nowSec;
      this._refreshDesired(playerX, playerZ, eyeAglM);
    }
    this._pumpQueue();
    this._drapePending(refGroundY);
    this._finalizePending(nowSec);
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
    const F = SAT_BLDG_FADE;
    const lo = F.enabled ? F.fadeStartAglM : SAT_BUILDINGS.cullAglOnM;
    const hi = F.enabled ? F.fadeEndAglM : SAT_BUILDINGS.cullAglOffM;
    const open = smoothstep01((eyeAglM - lo) / Math.max(1, hi - lo));
    const fade = 1 - smoothstep01((eyeAglM - SK.fade.startM) / Math.max(1, SK.fade.endM - SK.fade.startM));
    const holeRadiusM = SK.hole.radiusM * (1 - open);
    setSatSkyline(holeRadiusM, SK.hole.featherM, fade);
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
  _updateVisibility(px, pz, holeRadiusM, fade) {
    const g = Math.max(1, SAT_SKYLINE.groupN);
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
  _refreshDesired(px, pz, eyeAglM) {
    const SK = SAT_SKYLINE;
    if (this._ringOn) {
      if (eyeAglM > SK.fade.evictM) this._ringOn = false;
    } else if (eyeAglM < SK.fade.rearmM) {
      this._ringOn = true;
    }
    if (!this._ringOn || this.maxChunks <= 0) {
      for (const [key, chunk] of this.chunks) this._evict(key, chunk);
      this.queue.length = 0;
      this.pendingFinalize.length = 0;
      return;
    }

    const z = SK.ring.z;
    const r = SK.ring.r;
    const g = Math.max(1, SK.groupN);
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
    const kept = desired.slice(0, this.maxChunks);
    const keep = new Set(kept.map((e) => `${e.z}/${e.gx}/${e.gy}`));

    for (const [key, chunk] of this.chunks) {
      if (!keep.has(key)) this._evict(key, chunk);
    }
    this.queue = kept.filter((e) => !this.chunks.has(`${e.z}/${e.gx}/${e.gy}`));
    this.pendingFinalize = this.pendingFinalize.filter((p) => keep.has(p.key));
  }

  // --- build: one group = groupN² worker tiles, collected then merged --------
  _pumpQueue() {
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
      const chunk = { state: 'building', mesh: null, group: e, pending: g * g, parts: [], stale: false, gen };
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
            this._childDone(key, gen, null, 0, 0);
            continue;
          }
          this.worker
            .buildTile(e.z, tx, ty, 'sat-skyline')
            .then((result) => this._childDone(key, gen, result, dx, dz))
            .catch((err) => {
              this._childDone(key, gen, null, dx, dz);
              if (process.env.NODE_ENV === 'development')
                console.warn(`[sat-skyline] build ${e.z}/${tx}/${ty} failed:`, err?.message ?? err);
            });
        }
      }
    }
  }

  /** One tile of a group came back (or failed). Merge-time starts at pending 0. */
  _childDone(key, gen, result, dx, dz) {
    this.building -= 1;
    const chunk = this.chunks.get(key);
    if (this._disposed || !chunk || chunk.gen !== gen || chunk.state !== 'building') return;
    if (result && result.v !== undefined && result.v !== EXPECTED_WORKER_PROTOCOL) {
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
    }
    chunk.pending -= 1;
    if (chunk.pending > 0) return;
    // THE OWENS INVARIANT: a group with nothing in it becomes 'empty' and never
    // gets a mesh — not an empty one, not a zero-triangle one. Desert tiles
    // therefore cost exactly zero draws.
    if (chunk.stale || chunk.parts.length === 0) {
      chunk.state = 'empty';
      chunk.parts.length = 0;
      return;
    }
    chunk.state = 'draping';
    this.pendingFinalize.push({ key, gen, group: chunk.group, parts: chunk.parts, grid: null, gi: 0 });
  }

  // --- drape: budgeted (drapeGridN+1)² DEM grid per group --------------------
  _drapePending(refGroundY) {
    if (this.pendingFinalize.length === 0) return;
    const SK = SAT_SKYLINE;
    const t0 = performance.now();
    const g = Math.max(1, SK.groupN);
    const N = SK.drapeGridN;
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
        if (!s || s.tileZ < SK.demZ) {
          p.bad += 1;
          p.grid[p.gi] = refGroundY; // the player's own ground, never sea level
        } else {
          p.grid[p.gi] = s.elev; // RAW DEM — no toy exaggeration (the R11 rule)
        }
        p.gi += 1;
        if (performance.now() - t0 > SK.drapeBudgetMs) return;
      }
    }
  }

  // --- finalize: merge the group's tiles, apply the drape, upload one mesh ----
  _finalizePending(nowSec = 0) {
    const SK = SAT_SKYLINE;
    const g = Math.max(1, SK.groupN);
    const N = SK.drapeGridN;
    const total = (N + 1) * (N + 1);
    let done = 0;
    for (let i = 0; i < this.pendingFinalize.length && done < SK.finalizePerFrame; i++) {
      const p = this.pendingFinalize[i];
      if (!p.grid || p.gi < total) continue; // still sampling
      // A mostly-unstreamed DEM means the whole group would sit at the player's
      // elevation — hold and re-sample rather than commit a floating city. The
      // warp window accepts a coarse answer fast so a destination pops in.
      const badFrac = p.bad / total;
      const maxTries =
        nowSec < (this._warpCoarseUntil ?? 0) ? SK.warpCoarseTries : SK.drapeMaxTries;
      if (badFrac > 0.5 && (p.tries ?? 0) < maxTries) {
        if (nowSec >= (p.retryAt ?? 0)) {
          p.tries = (p.tries ?? 0) + 1;
          p.retryAt = nowSec + 1.5;
          p.gi = 0;
          p.bad = 0;
        }
        continue;
      }
      this.pendingFinalize.splice(i, 1);
      i -= 1;
      done += 1;
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
      const idx = totalV > 65535 ? new Uint32Array(totalI) : new Uint16Array(totalI);
      let vOff = 0;
      let iOff = 0;
      for (const part of p.parts) {
        const sk = part.sk;
        const n = sk.pos.length / 3;
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
      geo.setAttribute('aBendAnchor', new BufferAttribute(anchor, 2));
      geo.setIndex(new BufferAttribute(idx, 1));
      geo.computeVertexNormals(); // walls are vertex-independent → crisp faces
      geo.computeBoundingSphere();
      // The bend drops geometry in the SHADER, so the computed sphere is the
      // unbent one — inflate it or a far group false-culls at the screen edge.
      if (geo.boundingSphere) geo.boundingSphere.radius += SK.cullMarginM;
      const mesh = new Mesh(geo, this.material);
      mesh.position.set(cx, 0, cz);
      mesh.frustumCulled = true;
      this.object.add(mesh);
      chunk.mesh = mesh;
      chunk.tris = totalI / 3;
      chunk.verts = totalV;
      chunk.parts = null; // the transferred buffers are merged — let them go
      chunk.state = 'ready';
    }
  }

  _evict(key, chunk) {
    if (chunk.mesh) {
      this.object.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      chunk.mesh = null;
    }
    chunk.parts = null;
    this.chunks.delete(key);
  }

  /** Dev telemetry (window.__satSkyline.stats / __flyStats.satSkyline). */
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
    };
  }

  dispose() {
    this._disposed = true;
    // The choreography uniforms are module-shared: hand them back at identity
    // so a re-mount (style flip / StrictMode) never starts inside a dissolve.
    setSatSkyline(0, SAT_SKYLINE.hole.featherM, 1);
    for (const [key, chunk] of [...this.chunks]) this._evict(key, chunk);
    this.queue.length = 0;
    this.pendingFinalize.length = 0;
    this.material.dispose();
  }
}
