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
  SRGBColorSpace,
  Vector3,
} from 'three';
import { SatVegEngine } from '@/lib/fly/toy-world/sat-veg-engine';
import {
  GLOBE,
  LAMBERT_ENV,
  PARCEL_HOMES,
  SAT_AMBIENT,
  SAT_GROUND_LIFE,
  SAT_SHADOWS,
  SAT_TINT,
  SAT_VEG,
  SUBURB_NIGHT,
  SURFACE_CALM,
} from '@/lib/fly/fly-constants';
import { applyBendAnchor, getRimColor } from '@/lib/fly/toy-world/world-bend';
import { useFlyStore } from '@/stores/fly-store';
import { SatAmbientLife } from './SatAmbientLife';
import { SatHouseLights } from './SatHouseLights';
import { SatParcelHomes } from './SatParcelHomes';
import { SatTintLayer } from './SatTintLayer';
// D W1 REPAIR (reported to Fable): C's 9783586 shipped this file with its
// whole import prologue collapsed onto two lines — react/r3f/three/app names
// merged into one list, so app CONSTANTS were imported FROM 'three' and the
// build failed with "The export STREAM_KEEPER was not found in module three".
// The prologue below is the pre-C one verbatim, plus exactly the names C's
// change needs. C's body edits are untouched.

const _dummy = new Object3D();
const _col = new Color();
// Round 19 (C): the live rim tone the canopy hazes toward, read back from the
// SAME uniform the tiles fade with (world-bend getRimColor). Reused across the
// cadence pass — a placement pass should not allocate a Color per tree.
const _rim = new Color();
const _rimRGB = { r: 0, g: 0, b: 0 };
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
 * Round 21 (C "SURFACE", S6) — RANGED upload of a pooled attribute.
 *
 * three uploads the ENTIRE typed array on `needsUpdate` unless the attribute
 * carries update ranges (WebGLAttributes.updateBuffer). Four pooled satellite
 * layers refill full buffers on ONE shared 2 s cadence, phase-locked from the
 * first frame — roughly 1.7 MB of bufferSubData landing in a single frame,
 * every two seconds, forever. Only `[0, max(n, prevN))` can possibly differ
 * from what the GPU already holds: `0..n` is this pass's placement and
 * `n..prevN` is the tail this pass just parked. Everything past that was
 * uploaded parked (or was never written at all) and is outside `count`, so it
 * cannot be drawn. Idiom and API names from TrafficTracers.jsx:460.
 */
function rangeUpload(attr, floats) {
  if (!attr) return;
  if (SURFACE_CALM.enabled && SURFACE_CALM.uploads.ranges) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, Math.min(floats, attr.array.length));
  }
  attr.needsUpdate = true;
}

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
  // Round 19 (C): the HIGH-TIER pool raise. A tile's residential/farmland
  // scatter is new content in the same buffer, so the R18 pool would have
  // decimated the park trees to make room for the suburb. Medium and low
  // resolve to the R18 value byte-identically (user decision 2 — phones get
  // the honesty, none of the spend), and SAT_GROUND_LIFE.enabled false
  // restores high too.
  const basePool = SAT_VEG.enabled ? (SAT_VEG.poolByTier[tier] ?? 0) : 0;
  const pool =
    SAT_GROUND_LIFE.enabled && tier === 'high' && basePool > 0
      ? SAT_GROUND_LIFE.poolHigh
      : basePool;
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

  // Round 21 (C) — publish the veg streamer on the runtime bus, narrowed to
  // the ONE thing a consumer needs: its streaming stats. SatParcelHomes' regK
  // is a RATIO of the building ring over the veg ring, and the R20 settle
  // gate only ever tested the building side — so a settled building ring over
  // a half-streamed veg ring read as a mapped town with no residential area
  // and carpeted it. Mirrors SatBuildingLayer's `runtime.satBuildings = engine`
  // (identity-guarded cleanup, mount-time is enough because the engine is
  // memoised on `runtime`), but hands out a read-only view rather than the
  // engine itself: nothing outside this file should be able to steer it.
  const bus = useMemo(
    () => ({
      get stats() {
        return engine.stats;
      },
    }),
    [engine]
  );
  useEffect(() => {
    // (`runtime` is the scene's mutable cross-component bus — FlyScene's
    // RUNTIME CONTRACTS (R18) block — exactly as SatBuildingLayer writes it.)
    runtime.satVeg = bus;
    return () => {
      if (runtime.satVeg === bus) runtime.satVeg = null;
    };
  }, [bus, runtime]);
  // byClass: round 19 — placed canopies per worker class id (index 0..6), the
  // value verify-groundlife's "Powell residential canopy" gate reads. It is
  // counted from the LIVE placement pass, not from the streamed rows, so it
  // proves what is on screen rather than what arrived.
  // classAt: DEV ONLY — the class of instance i, so verify-groundlife can ask
  // "is every RESIDENTIAL canopy clear of a building footprint?" against the
  // instance matrices it can already read. Never allocated in production.
  const placeRef = useRef({
    t: -Infinity,
    first: true, // round 21: the one-time cadence phase nudge (S6)
    sig: '', // …and the static-skip signature
    atX: Infinity,
    atZ: Infinity,
    placed: 0,
    altK: 0,
    byClass: new Uint32Array(8),
    classAt:
      process.env.NODE_ENV === 'development'
        ? new Uint8Array(Math.max(SAT_GROUND_LIFE.poolHigh, ...Object.values(SAT_VEG.poolByTier)))
        : null,
  });
  // Shared dev surface: this layer publishes window.__satVeg and SatAmbientLife
  // writes its mover telemetry into `.ambient` — one global, one contract.
  const dev = useMemo(() => ({}), []);

  // Squashed low-poly blob: a 7×4 sphere is 42 triangles. Even a full 3000-deep
  // pool is ~126k tris for the whole world's vegetation, in ONE draw.
  const geometry = useMemo(() => new SphereGeometry(1, 7, 4), []);
  const material = useMemo(() => {
    // R24 C (LAMBERT_ENV, recon WB-7): three r185 applies `scene.environment`
    // to Lambert (WebGLPrograms.js:60-63) and Lambert's defaults are
    // `combine = MultiplyOperation`, `reflectivity = 1` — a FULL-STRENGTH
    // mirror lookup of the HDRI on every surface. Roofs take the zenith
    // colour, facades take the horizon band, and the twilight HDRI's bright
    // azimuth band lights one facade direction after dark. Uniform-only: a
    // material PARAMETER, so the program and the cache key are unmoved.
    const m = new MeshLambertMaterial({ vertexColors: false });
    if (LAMBERT_ENV.enabled) m.reflectivity = LAMBERT_ENV.reflectivity;
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
      // Round 21 (C, S6): the one-time phase nudge. The first pass is still
      // immediate — this only moves where the STEADY cadence lands, so the
      // four pooled layers stop refilling their buffers on the same frame.
      const U = SURFACE_CALM.enabled ? SURFACE_CALM.uploads : null;
      st.t = st.first && U ? t + U.stagger[0] * SAT_VEG.placeCadenceSec : t;
      st.first = false;
      st.altK = 1 - smoothstep(SAT_VEG.altFade.onM, SAT_VEG.altFade.offM, eyeAgl);
      // …and the static skip. A parked or slow-moving aircraft over a settled
      // ring re-derives an IDENTICAL pool and re-uploads it every 2 s. The
      // signature is everything this pass reads: the ring's own streaming
      // state and the altitude fade. Cheap by construction (the stats getter
      // walks tens of chunks) and conservative — any difference runs the pass.
      const sg = engine.stats;
      const sig = U
        ? `${sg.chunks}|${sg.ready}|${sg.empty}|${sg.vegPts}|${sg.clsChunks}|${st.altK.toFixed(3)}`
        : '';
      const moved2 = (flight.pos.x - st.atX) ** 2 + (flight.pos.z - st.atZ) ** 2;
      if (!U || sig !== st.sig || moved2 >= U.staticSkipM ** 2) {
        st.sig = sig;
        st.atX = flight.pos.x;
        st.atZ = flight.pos.z;
        st.placed = placeCanopy(
          mesh,
          engine,
          flight,
          st.altK,
          pool,
          perChunkCap,
          st.byClass,
          st.classAt,
          st.prevN ?? 0
        );
        st.prevN = st.placed;
      }
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
      dev.byClass = Array.from(st.byClass); // round 19: placed canopies per class
      dev.classAt = st.classAt; // round 19: per-instance class (dev only)
      if (mesh) dev.mesh = mesh; // harness A/B flip — never cleared by a transient
      window.__flyStats.satVeg = {
        placed: st.placed,
        pool,
        altK: st.altK,
        ready: dev.stats.ready,
        vegPts: dev.stats.vegPts,
        byClass: dev.byClass,
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
            // Round 19 — the two SAT_SHADOWS mesh flags for THIS layer's mesh
            // (the plan's per-layer rule; A HOMESTEAD did SatBuildingLayer in
            // W1, C does the canopy here in W2, and B DEEPFIELD owns the light
            // rig + FlyScene's castShadow gate). Copied from A's pattern: the
            // flag, the tier, and the fleet pin from scripts/_boot.js — every
            // frozen satellite pixel gate keeps seeing the pre-R19 frame, and
            // verify-aerial is the one harness that un-pins it. Read at mount
            // like the tier gate above: a shadow flag flip re-compiles, so it
            // must not ride the frame loop.
            const shadowPin =
              typeof window !== 'undefined' && window.__flySatShadowOverride === 0;
            const shadowOn =
              SAT_SHADOWS.enabled && tier === SAT_SHADOWS.minTier && !shadowPin;
            m.castShadow = shadowOn;
            m.receiveShadow = shadowOn;
            placeRef.current.t = -Infinity; // place on the very next frame
          }}
          args={[geometry, material, pool]}
        />
      )}
      {SAT_AMBIENT.enabled && (
        <SatAmbientLife engine={engine} flight={flight} tier={tier} />
      )}
      {/* Round 19 (C "GROUNDTRUTH") — the other two consumers of THIS engine's
          chunks. Mounted here rather than from SatBuildingLayer because both
          need the veg engine itself: the tint drapes on its bilinear ground
          grids, and the house lights fall back to its residential scatter
          points (A HOMESTEAD's measured finding — see SatHouseLights' header).
          Doing it through a second runtime-bus field would have added a
          cross-component contract for data that is already right here. Each is
          its own +1 draw, each parks itself (visible=false / count=0) when its
          scene has nothing to show, and each is one flag from gone. */}
      {SAT_TINT.enabled && <SatTintLayer engine={engine} flight={flight} />}
      {SUBURB_NIGHT.enabled && (
        <SatHouseLights engine={engine} runtime={runtime} flight={flight} />
      )}
      {/* Round 20 (B "HOMES") — procedural suburbia off the worker's dedicated
          residential parcel anchors, which ride THIS engine's chunks for the
          same reason the porch lights and the tint do: it is the only streamer
          that has the residential sample AND a per-chunk bilinear DEM grid, so
          a house, the trees around it and the ground under it are drawn from
          one source and cannot disagree. Same contract as its three siblings —
          its own +1 draw, count = 0 when its scene has nothing to show, one
          flag from gone. Mounted here rather than in FlyScene deliberately:
          FlyScene gets a mount line from C ICONS this round and this one would
          collide with it for no benefit. */}
      {PARCEL_HOMES.enabled && (
        <SatParcelHomes engine={engine} runtime={runtime} flight={flight} tier={tier} />
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
function placeCanopy(mesh, engine, flight, altK, pool, perChunkCap, byClass, classAt, prevN) {
  const S = SAT_VEG;
  const px = flight.pos.x;
  const pz = flight.pos.z;
  // Round 19 (C) — VEG HAZE, and the reason it lives here rather than in a
  // shader: the canopy material is the SHARED anchor-bend variant
  // ('world-bend-anchor-r8'), which also reaches toy TownGlow and the
  // monuments and is UNTOUCHABLE this round (§2). But this pass already writes
  // an instance COLOUR every 2 s, so distance haze costs one lerp per tree and
  // moves no cache key at all. It mixes toward the LIVE rim — the exact triple
  // world-bend is fading the tiles toward this frame — so a tree and the
  // ground under it recede on one law instead of the tree reading as a
  // cut-out. max 0 ⇒ the lerp is skipped and the R18 colours are exact.
  const HZ = SAT_GROUND_LIFE.enabled ? SAT_GROUND_LIFE.haze : null;
  const hazeMax = HZ ? HZ.max : 0;
  if (hazeMax > 0) {
    getRimColor(_rimRGB);
    // The rim components are raw sRGB (the output-space convention every
    // world-bend colour setter uses); the instance colour is a Lambert diffuse
    // in WORKING space, so convert rather than lerping across two spaces.
    _rim.setRGB(_rimRGB.r, _rimRGB.g, _rimRGB.b, SRGBColorSpace);
  }
  byClass.fill(0);
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
        // …then recede it toward the horizon tone by distance (see the header
        // note). Applied AFTER the jitter/conifer tint so the haze is the last
        // word, exactly like the fragment mixes it is standing in for.
        if (hazeMax > 0) {
          _col.lerp(_rim, hazeMax * smoothstep(HZ.startM, HZ.endM, d));
        }
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
        // Round 19: which landcover this canopy came from. `cls` is absent on a
        // pre-R19 bundle (and when SAT_GROUND_LIFE is off), in which case every
        // tree counts as class 0 = unknown — the sat-roads sentinel idiom.
        const c = chunk.cls ? chunk.cls[i] : 0;
        byClass[c] += 1;
        if (classAt) classAt[n] = c;
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
  // Round 21 (C, S6): upload only what can have changed (see rangeUpload).
  const touched = Math.max(n, prevN | 0);
  rangeUpload(mesh.instanceMatrix, touched * 16);
  if (mesh.instanceColor) rangeUpload(mesh.instanceColor, touched * 3);
  mesh.boundingSphere.center.set(0, 0, 0);
  mesh.boundingSphere.radius = Math.sqrt(maxR2) + maxScale + maxD * maxD * MAX_BEND_K + 50;
  return n;
}
