import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DataTexture,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshToonMaterial,
  NearestFilter,
  Object3D,
  RedFormat,
} from 'three';
import { BEACONS, FOAM, ROAD_PULSE, TOY_WORLD } from '../fly-constants';
import { PALETTE, hexToRGB } from './toy-palette';
import { applyBeaconBlink, applyBendFade, applyFoamLayer, applyRoadPulse } from './world-bend';

const _dummy = new Object3D();

const EARTH_R = 6378137;
const WORLD_SIZE = 2 * Math.PI * EARTH_R;
const RAD2DEG = 180 / Math.PI;

/**
 * Toy World chunk manager (FLY_TOYWORLD_REWORK §4.2): a 3-level quadtree of
 * vector-tile chunks around the player. The worker tessellates each tile
 * into vertex-colored buffers (local to the tile center); this class drapes
 * them on the DEM (bilinear over a coarse per-chunk elevation grid sampled
 * from the existing TerrainEngine), owns the GPU objects, and streams
 * build/evict as the player moves.
 *
 * Frame cost discipline: desired-set recompute is movement/time gated;
 * DEM sampling is budgeted per frame; at most `finalizePerFrame` chunks
 * upload per frame; eviction disposes geometry immediately (Phase 0's leak
 * lesson: nothing may accumulate per frame).
 *
 * Coordinates: chunk group sits INSIDE worldRoot at the tile-center
 * ABSOLUTE mercator position (float64 matrix composition cancels the large
 * translation, same as the TileMap). All distances here are world units.
 */
export class ToyWorldEngine {
  constructor({ groundAt }) {
    this.object = new Group();
    this.object.name = 'toy-world';
    this.groundAt = groundAt; // (lonDeg, latDeg) => {elev, tileZ} | null
    this.worker = null;

    // 3-step toon ramp shared by every toy material — the stepped light
    // bands (with the violet hemisphere fill) ARE the bruno shading look.
    const ramp = new DataTexture(new Uint8Array([110, 190, 255]), 3, 1, RedFormat);
    ramp.minFilter = NearestFilter;
    ramp.magFilter = NearestFilter;
    ramp.needsUpdate = true;
    this.rampTex = ramp;

    // ONE material per group, shared by every chunk (vertex colors carry
    // all variation). Buildings are DoubleSide: wall quads come from rings
    // of either winding, and three flips backface normals for lighting.
    this.materials = {
      land: new MeshToonMaterial({ vertexColors: true, gradientMap: ramp }),
      water: new MeshToonMaterial({ vertexColors: true, gradientMap: ramp }),
      building: new MeshToonMaterial({ vertexColors: true, side: DoubleSide, gradientMap: ramp }),
      tree: new MeshToonMaterial({ color: 0xffffff, gradientMap: ramp }),
      grass: new MeshToonMaterial({ color: 0xffffff, gradientMap: ramp }),
    };
    // mini-planet bend + rim fade (chunks are GROUND — they melt into the void)
    for (const m of Object.values(this.materials)) applyBendFade(m);
    // water alone also scrolls the shoreline foam dash (own program variant)
    applyFoamLayer(this.materials.water, FOAM.lenM);
    // land scrolls road-traffic pulses on aArc; buildings blink rooftop
    // beacons on aBeacon (Atlas round §4.3a/b — each re-keys its program)
    applyRoadPulse(this.materials.land, ROAD_PULSE);
    applyBeaconBlink(this.materials.building, BEACONS);
    // Shared instance geometries: chunky tree blob + spiky grass cone
    this.treeGeo = new IcosahedronGeometry(1, 1);
    this.grassGeo = new ConeGeometry(1, 2.4, 6);
    const toColors = (arr) =>
      arr.map((hex) => {
        const [r, g, b] = hexToRGB(hex);
        return new Color(r, g, b);
      });
    this.treeColors = toColors(PALETTE.treeFoliage);
    this.grassColors = toColors(PALETTE.grassCones);

    this.chunks = new Map(); // key "z/x/y" -> chunk record
    this.queue = []; // keys awaiting worker build, nearest first
    this.building = 0;
    this.pendingFinalize = []; // built results awaiting drape+upload
    this._lastRefreshPos = { x: Infinity, z: Infinity };
    this._lastRefreshT = 0;
    this._disposed = false;
  }

  setWorker(workerApi) {
    this.worker = workerApi;
    // Re-arm after dispose: StrictMode double-mounts reuse the memoized
    // engine (dispose only frees chunks/GPU handles; three re-uploads on
    // demand). A fresh worker + empty chunk set is a valid cold start.
    this._disposed = false;
    this._lastRefreshPos = { x: Infinity, z: Infinity };
    this._lastRefreshT = 0;
  }

  /** Per-frame update. playerX/Z are ABSOLUTE world; geo is lon/lat/alt. */
  update(nowSec, playerX, playerZ) {
    if (this._disposed || !this.worker) return;

    const movedSq =
      (playerX - this._lastRefreshPos.x) ** 2 + (playerZ - this._lastRefreshPos.z) ** 2;
    if (
      movedSq > TOY_WORLD.refreshMoveM ** 2 ||
      nowSec - this._lastRefreshT > TOY_WORLD.refreshSec
    ) {
      this._lastRefreshPos = { x: playerX, z: playerZ };
      this._lastRefreshT = nowSec;
      this._refreshDesired(playerX, playerZ);
    }

    this._pumpQueue();
    this._drapePending();
    this._finalizePending(nowSec);
  }

  // --- desired set: 3-level quadtree descent, gap- and overlap-free -------

  _refreshDesired(px, pz) {
    const rings = TOY_WORLD.rings;
    const desired = new Map(); // key -> {z,x,y,detail,distSq}
    const coarsest = rings[rings.length - 1];

    // A tile square [minX,maxX]×[minZ,maxZ] vs circle(px,pz,r)
    const intersects = (minX, minZ, span, r) => {
      const dx = Math.max(minX - px, 0, px - (minX + span));
      const dz = Math.max(minZ - pz, 0, pz - (minZ + span));
      return dx * dx + dz * dz <= r * r;
    };

    const visit = (z, tx, ty, ringIdx) => {
      const span = WORLD_SIZE / 2 ** z;
      const minX = -WORLD_SIZE / 2 + tx * span;
      // worldZ = -mercY: tile row ty's top edge mercY = half - ty*span
      const minZ = -(WORLD_SIZE / 2 - ty * span);
      if (!intersects(minX, minZ, span, TOY_WORLD.rings[ringIdx].r)) return;
      // Descend while a finer ring wants this area
      if (ringIdx > 0 && intersects(minX, minZ, span, rings[ringIdx - 1].r)) {
        for (let cy = 0; cy < 2; cy++)
          for (let cxk = 0; cxk < 2; cxk++) visitChild(z + 1, tx * 2 + cxk, ty * 2 + cy, ringIdx - 1);
        return;
      }
      const cx = minX + span / 2;
      const cz = minZ + span / 2;
      desired.set(`${z}/${tx}/${ty}`, {
        z,
        x: tx,
        y: ty,
        detail: rings[ringIdx].detail,
        distSq: (cx - px) ** 2 + (cz - pz) ** 2,
      });
    };
    // A child may sit outside its own ring radius but inside the coarse
    // circle it replaced — clamp only to the outermost bubble.
    const visitChild = (z, tx, ty, ringIdx) => {
      const span = WORLD_SIZE / 2 ** z;
      const minX = -WORLD_SIZE / 2 + tx * span;
      const minZ = -(WORLD_SIZE / 2 - ty * span);
      if (!intersects(minX, minZ, span, coarsest.r)) return;
      if (ringIdx > 0 && intersects(minX, minZ, span, rings[ringIdx - 1].r)) {
        for (let cy = 0; cy < 2; cy++)
          for (let cxk = 0; cxk < 2; cxk++) visitChild(z + 1, tx * 2 + cxk, ty * 2 + cy, ringIdx - 1);
        return;
      }
      const cx = minX + span / 2;
      const cz = minZ + span / 2;
      desired.set(`${z}/${tx}/${ty}`, {
        z,
        x: tx,
        y: ty,
        detail: rings[ringIdx].detail,
        distSq: (cx - px) ** 2 + (cz - pz) ** 2,
      });
    };

    // Seed: coarsest-zoom tiles covering the outer bubble
    const zc = coarsest.z;
    const span = WORLD_SIZE / 2 ** zc;
    const half = WORLD_SIZE / 2;
    const txMin = Math.floor((px - coarsest.r + half) / span);
    const txMax = Math.floor((px + coarsest.r + half) / span);
    // worldZ→row: minZ = -(half - ty*span) → ty = (minZ + half)/span
    const tyMin = Math.floor((pz - coarsest.r + half) / span);
    const tyMax = Math.floor((pz + coarsest.r + half) / span);
    const nTiles = 2 ** zc;
    for (let ty = Math.max(0, tyMin); ty <= Math.min(nTiles - 1, tyMax); ty++)
      for (let tx = Math.max(0, txMin); tx <= Math.min(nTiles - 1, txMax); tx++)
        visit(zc, tx, ty, rings.length - 1);

    // Cap: keep nearest
    let entries = [...desired.values()].sort((a, b) => a.distSq - b.distSq);
    if (entries.length > TOY_WORLD.maxChunks) entries = entries.slice(0, TOY_WORLD.maxChunks);
    const keep = new Set(entries.map((e) => `${e.z}/${e.x}/${e.y}`));

    // Evict chunks that fell out of the desired set
    for (const [key, chunk] of this.chunks) {
      if (!keep.has(key)) this._evict(key, chunk);
    }
    // Heal coarse-accepted chunks: once real DEM answers at their center,
    // evict them — the next line requeues a fresh (browser-cached) build.
    let healed = 0;
    for (const [key, chunk] of this.chunks) {
      if (healed >= 3 || !chunk.coarse || chunk.state !== 'ready' || !chunk.tile) continue;
      const span = WORLD_SIZE / 2 ** chunk.tile.z;
      const wx = -WORLD_SIZE / 2 + chunk.tile.x * span + span / 2;
      const wz = -(WORLD_SIZE / 2 - chunk.tile.y * span) + span / 2;
      const s = this.groundAt(
        (wx / EARTH_R) * RAD2DEG,
        (2 * Math.atan(Math.exp(-wz / EARTH_R)) - Math.PI / 2) * RAD2DEG
      );
      if (s && s.tileZ >= (TOY_WORLD.demZByDetail[chunk.tile.detail] ?? 10)) {
        this._evict(key, chunk);
        healed += 1;
      }
    }
    // Queue missing ones (nearest first)
    this.queue = entries
      .filter((e) => !this.chunks.has(`${e.z}/${e.x}/${e.y}`))
      .map((e) => e);
    // Drop stale pending work
    this.pendingFinalize = this.pendingFinalize.filter((p) => keep.has(p.key));
  }

  _pumpQueue() {
    while (this.building < TOY_WORLD.maxBuilds && this.queue.length > 0) {
      const e = this.queue.shift();
      const key = `${e.z}/${e.x}/${e.y}`;
      if (this.chunks.has(key)) continue;
      this.chunks.set(key, { state: 'building', meshes: [] });
      this.building += 1;
      this.worker
        .buildTile(e.z, e.x, e.y, e.detail)
        .then((result) => {
          this.building -= 1;
          const chunk = this.chunks.get(key);
          if (this._disposed || !chunk || chunk.state !== 'building') return;
          if (!result || result.empty) {
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
            console.warn(`[toy-world] build ${key} failed:`, err?.message ?? err);
        });
    }
  }

  // --- drape: budgeted DEM sampling across frames --------------------------

  _drapePending() {
    if (this.pendingFinalize.length === 0) return;
    const t0 = performance.now();
    const G = TOY_WORLD.gridSegments;
    const N = (G + 1) * (G + 1);
    for (const p of this.pendingFinalize) {
      if (!p.grid) p.grid = new Float32Array(N);
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
        // A low-zoom fallback tile "answers" with plateau garbage — count it
        // like a miss so the finalize gate holds until real DEM streams in.
        const required = TOY_WORLD.demZByDetail[p.tile.detail] ?? 10;
        if (!s || s.tileZ < required) p.nulls = (p.nulls ?? 0) + 1;
        p.grid[p.gi] = s?.elev ?? 0;
        p.gi += 1;
        if (performance.now() - t0 > TOY_WORLD.drapeBudgetMs) return;
      }
    }
  }

  // --- finalize: apply drape + upload to GPU --------------------------------

  _finalizePending(nowSec = 0) {
    const G = TOY_WORLD.gridSegments;
    let done = 0;
    for (let i = 0; i < this.pendingFinalize.length && done < TOY_WORLD.finalizePerFrame; i++) {
      const p = this.pendingFinalize[i];
      if (p.gi < (G + 1) * (G + 1)) continue; // still sampling
      // DEM not streamed in (or only a coarse fallback answered) → the drape
      // would be a wrong-height slab that never heals. Hold the chunk and
      // resample; after the retry budget, accept and tag for later healing.
      const badFrac = (p.nulls ?? 0) / ((G + 1) * (G + 1));
      if (badFrac > 0.05 && (p.tries ?? 0) < TOY_WORLD.drapeMaxTries) {
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
      const EX = TOY_WORLD.terrainExaggeration;
      const height = (lx, lz) => {
        // bilinear over the chunk grid; local coords are tile-center origin
        const fx = Math.min(Math.max(((lx + span / 2) / span) * G, 0), G - 1e-6);
        const fz = Math.min(Math.max(((lz + span / 2) / span) * G, 0), G - 1e-6);
        const x0 = fx | 0;
        const z0 = fz | 0;
        const tx = fx - x0;
        const tz = fz - z0;
        const g = p.grid;
        const w = G + 1;
        const h00 = g[z0 * w + x0];
        const h10 = g[z0 * w + x0 + 1];
        const h01 = g[(z0 + 1) * w + x0];
        const h11 = g[(z0 + 1) * w + x0 + 1];
        return (
          (h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz) *
          EX
        );
      };

      const addMesh = (geo, material) => {
        geo.computeBoundingSphere();
        const mesh = new Mesh(geo, material);
        mesh.position.set(cx, 0, cz);
        this.object.add(mesh);
        chunk.meshes.push(mesh);
        return mesh;
      };

      // --- ground plane: the chunk's own draped grid, slope-shaded --------
      // Overlays drape on the SAME bilinear surface (+lift), so they can
      // never z-fight it; the tan tile mesh below is just backfill.
      const w = G + 1;
      const groundPos = new Float32Array(w * w * 3);
      const groundNrm = new Float32Array(w * w * 3);
      const groundCol = new Float32Array(w * w * 3);
      const [gr, gg, gb] = hexToRGB(PALETTE.groundBase);
      const cell = span / G;
      for (let gz = 0; gz < w; gz++) {
        for (let gx = 0; gx < w; gx++) {
          const i = gz * w + gx;
          const lx = -span / 2 + gx * cell;
          const lz = -span / 2 + gz * cell;
          const h = p.grid[i] * EX;
          groundPos[i * 3] = lx;
          groundPos[i * 3 + 1] = h + TOY_WORLD.groundLift;
          groundPos[i * 3 + 2] = lz;
          // central-difference slope → soft relief shading
          const hx1 = p.grid[gz * w + Math.min(gx + 1, G)] * EX;
          const hx0 = p.grid[gz * w + Math.max(gx - 1, 0)] * EX;
          const hz1 = p.grid[Math.min(gz + 1, G) * w + gx] * EX;
          const hz0 = p.grid[Math.max(gz - 1, 0) * w + gx] * EX;
          const nx = (hx0 - hx1) / (2 * cell);
          const nz = (hz0 - hz1) / (2 * cell);
          const inv = 1 / Math.hypot(nx, 1, nz);
          groundNrm[i * 3] = nx * inv;
          groundNrm[i * 3 + 1] = inv;
          groundNrm[i * 3 + 2] = nz * inv;
          groundCol[i * 3] = gr;
          groundCol[i * 3 + 1] = gg;
          groundCol[i * 3 + 2] = gb;
        }
      }
      const groundIdx = [];
      for (let gz = 0; gz < G; gz++) {
        for (let gx = 0; gx < G; gx++) {
          const i00 = gz * w + gx;
          const i10 = i00 + 1;
          const i01 = i00 + w;
          const i11 = i01 + 1;
          groundIdx.push(i00, i11, i10, i00, i01, i11);
        }
      }

      // Merge ground + worker land overlays into ONE draw
      {
        const data = p.result.land;
        const overlayVtx = data ? data.pos.length / 3 : 0;
        const total = w * w + overlayVtx;
        const pos = new Float32Array(total * 3);
        const nrm = new Float32Array(total * 3);
        const col = new Float32Array(total * 3);
        pos.set(groundPos);
        nrm.set(groundNrm);
        col.set(groundCol);
        if (data) {
          const o = w * w * 3;
          for (let v = 0; v < data.pos.length; v += 3) {
            pos[o + v] = data.pos[v];
            pos[o + v + 1] = data.pos[v + 1] + height(data.pos[v], data.pos[v + 2]) + TOY_WORLD.groundLift;
            pos[o + v + 2] = data.pos[v + 2];
            nrm[o + v + 1] = 1; // overlays stay flat-lit (hand-painted sheet)
          }
          col.set(data.col, o);
        }
        const idx = data
          ? [...groundIdx, ...Array.from(data.idx, (v) => v + w * w)]
          : groundIdx;
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(pos, 3));
        geo.setAttribute('normal', new BufferAttribute(nrm, 3));
        geo.setAttribute('color', new BufferAttribute(col, 3));
        // Road-pulse arcs: -1 sentinel on the ground grid, worker arcs on
        // the overlay verts. EVERY land geometry must carry aArc — the
        // shared material's program reads it (a missing attribute is 0,
        // which would pulse the whole surface).
        const arc = new Float32Array(total).fill(-1);
        if (data?.arc) arc.set(data.arc, w * w);
        geo.setAttribute('aArc', new BufferAttribute(arc, 1));
        geo.setIndex(idx);
        addMesh(geo, this.materials.land).receiveShadow = true;
      }

      // Water: separate draw — the foam-dash shader animates on aFoam
      if (p.result.water) {
        const data = p.result.water;
        const pos = data.pos;
        const nrm = new Float32Array(pos.length);
        for (let v = 0; v < pos.length; v += 3) {
          pos[v + 1] += height(pos[v], pos[v + 2]) + TOY_WORLD.groundLift;
          nrm[v + 1] = 1;
        }
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(pos, 3));
        geo.setAttribute('normal', new BufferAttribute(nrm, 3));
        geo.setAttribute('color', new BufferAttribute(data.col, 3));
        // arc-length along foam ribbons, -1 on plain water (worker-baked)
        if (data.foam) geo.setAttribute('aFoam', new BufferAttribute(data.foam, 1));
        geo.setIndex(new BufferAttribute(data.idx, 1));
        addMesh(geo, this.materials.water);
      }

      // Buildings: level each on its footprint-anchor height
      if (p.result.building) {
        const data = p.result.building;
        const pos = data.pos;
        for (let v = 0, vi = 0; v < pos.length; v += 3, vi += 2) {
          pos[v + 1] +=
            height(data.anchor[vi], data.anchor[vi + 1]) +
            TOY_WORLD.groundLift -
            TOY_WORLD.buildings.baseSinkM;
        }
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(pos, 3));
        geo.setAttribute('color', new BufferAttribute(data.col, 3));
        // Beacon blink phases (worker-baked; -1 on non-beacon verts). Must
        // exist on every building geometry — see the aArc note above.
        geo.setAttribute(
          'aBeacon',
          new BufferAttribute(data.beacon ?? new Float32Array(pos.length / 3).fill(-1), 1)
        );
        geo.setIndex(new BufferAttribute(data.idx, 1));
        geo.computeVertexNormals(); // faces are vertex-independent → crisp
        const bMesh = addMesh(geo, this.materials.building);
        bMesh.castShadow = true;
        bMesh.receiveShadow = true;
      }

      // Instanced set dressing: tree blobs + grass cones from worker scatter
      const addInstances = (pts, geoShared, material, colors, opts) => {
        const count = pts.length / 4;
        const inst = new InstancedMesh(geoShared, material, count);
        for (let i = 0; i < count; i++) {
          const lx = pts[i * 4];
          const lz = pts[i * 4 + 1];
          const r = pts[i * 4 + 2];
          _dummy.position.set(lx, height(lx, lz) + TOY_WORLD.groundLift + r * opts.yLift, lz);
          _dummy.scale.set(r, r * opts.yScale, r);
          _dummy.rotation.y = (i * 2.399963) % (Math.PI * 2); // golden-angle variety
          _dummy.updateMatrix();
          inst.setMatrixAt(i, _dummy.matrix);
          inst.setColorAt(i, colors[pts[i * 4 + 3] % colors.length]);
        }
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        inst.position.set(cx, 0, cz);
        inst.frustumCulled = false; // instance bounds vs chunk origin mismatch
        inst.castShadow = opts.castShadow;
        this.object.add(inst);
        chunk.meshes.push(inst);
      };
      if (p.result.trees) {
        addInstances(p.result.trees, this.treeGeo, this.materials.tree, this.treeColors, {
          yLift: 1.05,
          yScale: 1.35,
          castShadow: true,
        });
      }
      if (p.result.grass) {
        addInstances(p.result.grass, this.grassGeo, this.materials.grass, this.grassColors, {
          yLift: 1.1, // cone origin is its center — half of 2.4 × scale
          yScale: 1.0,
          castShadow: false,
        });
      }
      chunk.state = 'ready';
    }
  }

  _evict(key, chunk) {
    for (const mesh of chunk.meshes) {
      this.object.remove(mesh);
      if (mesh.isInstancedMesh) {
        mesh.dispose(); // instance buffers only — geometry is shared
      } else {
        mesh.geometry.dispose();
      }
    }
    chunk.meshes.length = 0;
    this.chunks.delete(key);
  }

  /** Dev telemetry. */
  get stats() {
    let ready = 0;
    for (const c of this.chunks.values()) if (c.state === 'ready') ready += 1;
    return {
      chunks: this.chunks.size,
      ready,
      queued: this.queue.length,
      building: this.building,
      draping: this.pendingFinalize.length,
    };
  }

  dispose() {
    this._disposed = true;
    for (const [key, chunk] of [...this.chunks]) this._evict(key, chunk);
    this.queue.length = 0;
    this.pendingFinalize.length = 0;
    this.treeGeo.dispose();
    this.grassGeo.dispose();
    this.rampTex.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
  }
}
