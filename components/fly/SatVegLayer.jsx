'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { wrap } from 'comlink';
import {
  Color,
  DynamicDrawUsage,
  MeshLambertMaterial,
  Object3D,
  Sphere,
  SphereGeometry,
  Vector3,
} from 'three';
import { SatVegEngine } from '@/lib/fly/toy-world/sat-veg-engine';
import { GLOBE, SAT_AMBIENT, SAT_VEG } from '@/lib/fly/fly-constants';
import { applyBendAnchor } from '@/lib/fly/toy-world/world-bend';
import { useFlyStore } from '@/stores/fly-store';
import { SatAmbientLife } from './SatAmbientLife';

const _dummy = new Object3D();
const _col = new Color();
// Palette resolved once at module load — SAT_VEG.palette is a constant, and a
// cadence pass should not be allocating four Colors every two seconds.
const PALETTE = SAT_VEG.palette.map((c) => new Color(c));
// Worst-case bend drop pad for the CPU bounding sphere: the GPU pushes far
// geometry DOWN by d²k and the CPU bound cannot see it. k is at its LARGEST
// (least flattened) at low altitude, which is the only altitude veg exists at.
const MAX_BEND_K = 1 / (2 * GLOBE.bendRadiusM.satellite);

/** Deterministic hash — the CloudField recipe (stable across renders/tiers). */
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / Math.max(1e-6, b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Round 18 (A3 "GROUNDSKEEPER") — SATELLITE vegetation, and the mount point for
 * the ambient movers.
 *
 * THE INVARIANT THIS COMPONENT EXISTS TO HOLD: however much vegetation a place
 * has, the canopy costs at most ONE draw. Every streamed chunk feeds the same
 * global pooled InstancedMesh, so Owens Valley (which DOES have landcover —
 * trees in a rural valley are the immersion, not a bug) and Central Park cost
 * the same +1. When nothing is placed the mesh is `visible = false` AND
 * `count = 0`, so an empty scene stays flat at +0.
 *
 * Taste rules, all learned the expensive way:
 *   • DESATURATED palette, MeshLambert, never additive. A toy-green tint on
 *     real Esri imagery reads as a rendering bug, not as a park.
 *   • Rigid instanced ground objects ride the ANCHOR bend (applyBendAnchor,
 *     UNMODIFIED — no new program cache key), never the per-vertex one: a
 *     per-vertex bend SHEARS a rigid object (round-6 lesson 2).
 *   • The altitude fade is SCALE, not colour. The material is opaque, so
 *     darkening an instance paints a black tree instead of removing one.
 *
 * Instance matrices are written relative to a rounded POOL ORIGIN carried on
 * the mesh's own `position`, not in absolute world coordinates. instanceMatrix
 * is a float32 attribute and absolute mercator XZ near a city is ~8.2e6, where
 * the float32 ulp is 1.0 m — every canopy would snap to a metre lattice. The
 * pool origin is a float64 Vector3 that three folds into modelMatrix against
 * worldRoot's -anchor before the upload, so both sides of the subtraction that
 * reaches the GPU are small.
 *
 * Owns the shared 'sat-veg' streamer (its own worker instance, the SatRoadLayer
 * idiom) and mounts SatAmbientLife off the same chunk data — the worker emits
 * canopies and the mover anchor points in ONE bundle, so a second streamer
 * would refetch the same tile. Either flag alone keeps the streamer alive; with
 * both off this component never mounts (SatBuildingLayer's gate).
 */
export function SatVegLayer({ runtime, flight }) {
  // STATIC tier gate, read ONCE at mount. NOT a store subscription: an
  // InstancedMesh pool cannot grow, and PerformanceMonitor's onIncline reverts
  // downward tier pins within seconds (the R16 §7/§10 lesson), so a live tier
  // read would flap the pool and rebuild the mesh mid-flight.
  const tier = useMemo(() => useFlyStore.getState().qualityTier ?? 'medium', []);
  const pool = SAT_VEG.enabled ? (SAT_VEG.poolByTier[tier] ?? 0) : 0;
  const maxChunks = SAT_VEG.maxChunksByTier[tier] ?? 0;
  // maxChunks × perChunkCap ≤ pool BY CONSTRUCTION: the pool can therefore
  // never bind, which makes a pool cut (a hard radius that pops as the player
  // moves) impossible rather than merely unlikely.
  const perChunkCap = maxChunks > 0 ? Math.floor(pool / maxChunks) : 0;

  const engine = useMemo(
    () =>
      new SatVegEngine({
        groundAt: (lon, lat) => runtime.engine?.getGroundAt(lon, lat),
        maxChunks,
      }),
    [runtime, maxChunks]
  );

  const meshRef = useRef(null);
  const statsAtRef = useRef(0);
  const placeRef = useRef({ t: -Infinity, placed: 0, altK: 0 });
  // Shared dev surface: this layer publishes window.__satVeg and SatAmbientLife
  // writes its mover telemetry into `.ambient` — one global, one contract.
  const dev = useMemo(() => ({}), []);

  // Squashed low-poly blob: a 7×4 sphere is 42 triangles. Even a full 3000-deep
  // pool is ~126k tris for the whole world's vegetation, in ONE draw.
  const geometry = useMemo(() => new SphereGeometry(1, 7, 4), []);
  const material = useMemo(() => {
    const m = new MeshLambertMaterial({ vertexColors: false });
    applyBendAnchor(m); // existing variant, unmodified — no new cache key
    return m;
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material]
  );

  useEffect(() => {
    const worker = new Worker(
      new URL('../../lib/fly/toy-world/vector-tile.worker.js', import.meta.url),
      { type: 'module' }
    );
    const api = wrap(worker);
    api.init().catch((err) => {
      if (process.env.NODE_ENV === 'development')
        console.warn('[sat-veg] TileJSON init failed:', err?.message ?? err);
    });
    engine.setWorker(api);
    if (process.env.NODE_ENV === 'development') {
      dev.engine = engine;
      window.__satVeg = dev; // harness introspection (NEVER __toyWorld)
    }
    return () => {
      engine.dispose();
      worker.terminate();
      if (process.env.NODE_ENV === 'development') delete window.__satVeg;
    };
  }, [engine, dev]);

  // NOTE: no warpEpoch subscription. The building/road layers need one to open
  // an accept-coarse-fast window, because they HOLD a finished chunk until the
  // DEM is good enough. SatVegEngine holds only on genuinely ABSENT DEM and
  // heals its grids in place, so a warp needs no special case — the jump itself
  // trips refreshMoveM on the next frame.

  // Priority -45: after the flight/bend at -50, the buildings at -47 and the
  // road network at -46 — the ground layers run in streaming order.
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const eyeAgl = Math.max(0, flight.pos.y - flight.groundElev);
    engine.update(t, flight.pos.x, flight.pos.z, eyeAgl);

    const mesh = meshRef.current;
    const st = placeRef.current;
    if (mesh && t - st.t >= SAT_VEG.placeCadenceSec) {
      st.t = t;
      st.altK = 1 - smoothstep(SAT_VEG.altFade.onM, SAT_VEG.altFade.offM, eyeAgl);
      st.placed = placeCanopy(mesh, engine, flight, st.altK, pool, perChunkCap);
    }

    if (
      process.env.NODE_ENV === 'development' &&
      window.__flyStats &&
      t - statsAtRef.current > 0.25
    ) {
      statsAtRef.current = t;
      dev.stats = engine.stats;
      dev.placed = st.placed;
      dev.altK = st.altK;
      dev.pool = pool;
      dev.perChunkCap = perChunkCap;
      dev.tier = tier;
      if (mesh) dev.mesh = mesh; // harness A/B flip — never cleared by a transient
      window.__flyStats.satVeg = {
        placed: st.placed,
        pool,
        altK: st.altK,
        ready: dev.stats.ready,
        vegPts: dev.stats.vegPts,
      };
    }
  }, -45);

  return (
    <>
      {pool > 0 && (
        <instancedMesh
          ref={(m) => {
            meshRef.current = m;
            // ONCE per mesh, and this guard is load-bearing. An inline ref
            // callback re-attaches on EVERY re-render of this component, and
            // FlyScene re-renders for all sorts of ordinary reasons (hovering a
            // plane, a contract tick, a panel opening). Without the latch the
            // reset below wiped `count`/`visible` on each of those and the whole
            // forest vanished until the next 2 s cadence pass — caught by
            // verify-veg, whose pre-read mouse.move is exactly such a trigger.
            // r3f reuses the same InstancedMesh across re-renders (args are
            // stable), so userData is a reliable latch.
            if (!m || m.userData.__satVegInit) return;
            m.userData.__satVegInit = true;
            m.instanceMatrix.setUsage(DynamicDrawUsage);
            // The unit-sphere GEOMETRY bound lies for a ring-spanning instance
            // pool, so placeCanopy() writes a real one (padded for the bend
            // drop) every cadence — culling stays enabled AND honest.
            m.frustumCulled = true;
            m.boundingSphere = new Sphere(new Vector3(), 1);
            // three's InstancedMesh ships with count = the constructor capacity,
            // which would draw `pool` identity-matrix blobs stacked on the pool
            // origin for one cadence. Start parked; placeCanopy owns it after.
            m.count = 0;
            m.visible = false;
            placeRef.current.t = -Infinity; // place on the very next frame
          }}
          args={[geometry, material, pool]}
        />
      )}
      {SAT_AMBIENT.enabled && (
        <SatAmbientLife engine={engine} flight={flight} tier={tier} />
      )}
    </>
  );
}

/**
 * ONE cadence pass: walk the ready chunks nearest-first, place each chunk's
 * (stably decimated) canopies, park the tail, publish a real bounding sphere.
 * Returns the placed count. Everything the look depends on — palette, jitter,
 * conifer shape, both fades — resolves HERE, so nothing runs per frame.
 */
function placeCanopy(mesh, engine, flight, altK, pool, perChunkCap) {
  const S = SAT_VEG;
  const px = flight.pos.x;
  const pz = flight.pos.z;
  let n = 0;
  let maxR2 = 0; // furthest placed instance from the pool origin (local frame)
  let maxScale = 1;
  let maxD = 0; // …and from the PLAYER, which is what the bend drop keys on
  // Above altFade.offM there is nothing to place at all, which is also what
  // keeps the ring eviction (cullAglOffM, higher still) invisible.
  if (altK > 0.001 && perChunkCap > 0) {
    // Pool origin rounded to 1 km so it only moves in discrete steps (the whole
    // pool is rewritten on this pass regardless — a stable origin just keeps
    // the dev numbers and any future delta logic readable).
    const ox = Math.round(px / 1000) * 1000;
    const oz = Math.round(pz / 1000) * 1000;
    mesh.position.set(ox, 0, oz);
    const cf = S.conifer;
    for (const chunk of engine.nearest(px, pz)) {
      if (n >= pool) break;
      if (!chunk.veg) continue;
      const rows = chunk.veg.length / 4;
      const cap = Math.min(perChunkCap, rows);
      // STABLE index stride: keep row i iff it opens a new bucket of `cap`,
      // which selects exactly `cap` rows spread evenly across the chunk's
      // emission order. Independent of the player, so a canopy never blinks
      // because the camera moved — the one failure mode a distance sort would
      // guarantee. (cap === rows ⇒ every row opens its own bucket.)
      const bucket = (j) => ((j * cap) / rows) | 0;
      for (let i = 0; i < rows; i++) {
        if (n >= pool) break;
        if (i > 0 && bucket(i) === bucket(i - 1)) continue;
        const lx = chunk.veg[i * 4];
        const lz = chunk.veg[i * 4 + 1];
        const r0 = chunk.veg[i * 4 + 2] * S.radiusMul;
        const conifer = chunk.veg[i * 4 + 3] > 0.5;
        const wx = chunk.cx + lx;
        const wz = chunk.cz + lz;
        const d = Math.hypot(wx - px, wz - pz);
        if (d >= S.distFade.endM) continue;
        const k = altK * (1 - smoothstep(S.distFade.startM, S.distFade.endM, d));
        if (k <= 0.001) continue;
        const r = r0 * k;
        const gy = engine.groundAtLocal(chunk, lx, lz);
        const h = hash(lx * 3.117 + lz * 7.731);
        // Luma jitter around a hash-picked swatch — a park of one exact green
        // reads as a decal. Conifers additionally sit darker.
        const jit = 1 + (hash(lx * 11.31 - lz * 5.17) - 0.5) * 2 * S.lumaJitter;
        _col.copy(PALETTE[(h * PALETTE.length) | 0]).multiplyScalar(jit * (conifer ? cf.tint : 1));
        const sy = conifer ? r * cf.heightFrac : r * S.crownFrac;
        const sxz = conifer ? r * cf.widthFrac : r;
        const y = gy + (conifer ? r * cf.liftFrac : r * S.crownLiftFrac);
        _dummy.position.set(wx - ox, y, wz - oz);
        _dummy.scale.set(sxz, sy, sxz);
        // A hashed yaw breaks up the lat/long seams of a low-poly sphere so a
        // stand of trees does not read as one repeated stamp. Free — the matrix
        // is being composed either way.
        _dummy.rotation.set(0, h * Math.PI * 2, 0);
        _dummy.updateMatrix();
        mesh.setMatrixAt(n, _dummy.matrix);
        mesh.setColorAt(n, _col);
        const r2 = _dummy.position.lengthSq();
        if (r2 > maxR2) maxR2 = r2;
        if (sy > maxScale) maxScale = sy;
        if (d > maxD) maxD = d;
        n += 1;
      }
    }
  }
  // Park the tail at zero scale AND clamp count: `count` is what keeps the GPU
  // off unused instances, the zero scale is the belt to its braces.
  _dummy.position.set(0, 0, 0);
  _dummy.rotation.set(0, 0, 0);
  _dummy.scale.setScalar(0);
  _dummy.updateMatrix();
  for (let i = n; i < mesh.instanceMatrix.count; i++) mesh.setMatrixAt(i, _dummy.matrix);
  mesh.count = n;
  // THE OWENS INVARIANT: nothing placed = no draw. three already skips
  // primcount 0; `visible` states it as a contract a harness can read back.
  mesh.visible = n > 0;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.boundingSphere.center.set(0, 0, 0);
  mesh.boundingSphere.radius = Math.sqrt(maxR2) + maxScale + maxD * maxD * MAX_BEND_K + 50;
  return n;
}
