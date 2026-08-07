'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  DynamicDrawUsage,
  MeshBasicMaterial,
  Object3D,
  SphereGeometry,
} from 'three';
import { SAT_VEG, SETTLE_CALM, SUBURB_NIGHT, SURFACE_CALM } from '@/lib/fly/fly-constants';
import { applyBendAnchor } from '@/lib/fly/toy-world/world-bend';
import {
  applyInstanceEnv,
  arrivalEpoch,
  birthK,
  makeBirth,
  makeEnv,
  notePopin,
  resetEnv,
} from '@/lib/fly/settle';

const _dummy = new Object3D();
const POOL = SUBURB_NIGHT.houseLights.pool;

/** Deterministic hash — the CloudField/SatVegLayer recipe (stable per anchor). */
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Round 21 (C, S6) — ranged upload; see SatVegLayer's rangeUpload docstring. */
function rangeUpload(attr, elements) {
  if (!attr) return;
  if (SURFACE_CALM.enabled && SURFACE_CALM.uploads.ranges) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, Math.min(elements, attr.array.length));
  }
  attr.needsUpdate = true;
}

/**
 * Round 19 (C "GROUNDTRUTH") — SUBURBAN NIGHT: warm house lights.
 *
 * THE PROBLEM (field study P10): night over Powell OH is dead black. Downtown
 * has emissive window atlases and a bright road web; a suburb has neither —
 * OpenFreeMap generalises its houses away, so there is nothing to light up, and
 * its streets are the classes the road weight dims hardest (fixed separately,
 * in the SUBURB_NIGHT road envelope). The two together are what makes a
 * suburb read at night: a lattice of lit streets with warm dots between them.
 *
 * THE ANCHOR SPLIT — the one design decision worth reading:
 *   PRIMARY   A HOMESTEAD's `housePts`, the small-band building footprints,
 *             carried through SatBuildingEngine.houseAnchors() with a real
 *             per-building DEM ground. This is the honest source and it is
 *             what lights small-town cores and city blocks (Manhattan 387,
 *             Columbus 19).
 *   FALLBACK  residential-landcover scatter points (satVegCls === 4), the same
 *             deterministic samples the canopy stands on, with the worker's
 *             building avoidance already applied. MEASURED: Powell streams
 *             15 building footprints across 12 chunks and NOT ONE is under
 *             600 m², so housePts there is literally zero. Suburbia's lights
 *             cannot come from footprints, because in this dataset suburbia
 *             has no footprints.
 * They are used TOGETHER, primary first, into one pool — not either/or: a
 * town core and its subdivisions are usually in the same ring.
 *
 * Those fallback anchors are PARCEL points, not houses. Honest consequences:
 *   • each light steps `vegOffsetM` off its anchor on a hash-stable bearing,
 *     because an unoffset one sits inside its own canopy blob (opaque Lambert
 *     in front of an additive sprite = a light that flickers as you orbit);
 *   • the read is "a lit suburban parcel", which is exactly what a porch light
 *     is from 600 m. It never claims to be a specific house.
 *
 * BUDGET: ONE pooled InstancedMesh, +1 draw, and only ever at night —
 * `count = 0` parks the draw outright whenever the γ ramp is dark, which is
 * every daylight harness pose and the whole Owens Valley budget question.
 * Placement runs on the veg cadence (2 s), never per frame; the only per-frame
 * write is one material opacity.
 */
export function SatHouseLights({ engine, runtime, flight }) {
  const meshRef = useRef(null);
  const stateRef = useRef({
    t: -Infinity,
    first: true, // round 21: one-time cadence phase nudge (S6)
    sig: '',
    atX: Infinity,
    atZ: Infinity,
    prevN: 0,
    placed: 0,
    nightK: 0,
    fromHouse: 0,
    fromVeg: 0,
  });
  // R22 (B SETTLE) — instanced layers birth as SCALE ramps: zero shader change,
  // zero cache keys, and the ramp is applied to the matrices already in the
  // buffer (see applyInstanceEnv — a uniform scale composes, so a birth is one
  // ratio multiply of the 3×3 basis of each instance and never re-derives a
  // single light).
  const birthRef = useRef(makeBirth());
  const envRef = useRef(makeEnv());

  const geometry = useMemo(() => new SphereGeometry(1, 6, 4), []);
  const material = useMemo(() => {
    const m = new MeshBasicMaterial({
      color: SUBURB_NIGHT.houseLights.color,
      transparent: true,
      opacity: 0, // the night ramp owns this from the first frame
      blending: AdditiveBlending,
      depthWrite: false,
    });
    // Rigid instanced GROUND objects ride the ANCHOR bend, never the
    // per-vertex one (round-6 lesson 2) — the same variant TownGlow and the
    // airport beacons use, unmodified, so no new program cache key.
    applyBendAnchor(m);
    return m;
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material]
  );

  // Priority -43: after the canopy (-45) and the tint (-44) — the whole ground
  // stack settles in streaming order on one cadence.
  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const H = SUBURB_NIGHT.houseLights;
    const t = clock.elapsedTime;
    const st = stateRef.current;
    if (t - st.t >= SAT_VEG.placeCadenceSec) {
      // Round 21 (C, S6): one-time phase nudge; the first pass stays immediate.
      const U = SURFACE_CALM.enabled ? SURFACE_CALM.uploads : null;
      st.t = st.first && U ? t + U.stagger[2] * SAT_VEG.placeCadenceSec : t;
      st.first = false;
      // γ night ramp — the EXACT SAT_ROADS.night / SAT_CITY_GLOW shape, so the
      // porch lights, the streetlights and the window emissive all arrive
      // together at dusk instead of in three separate waves.
      const nt = Math.min(1, Math.max(0, 1 - (runtime.sun?.frac ?? 1) / H.dayFrac));
      st.nightK = nt ** H.gamma;
      // DAY PARKS THE DRAW. Unlike the beacons (which place on range and let
      // the envelope dim them), there is no reason to hold 600 matrices for an
      // invisible mesh — and `count = 0` is what keeps the daylight draw
      // ledger, including every pinned-noon satellite gate and Owens, at
      // exactly its pre-R19 number.
      if (st.nightK <= 0.001) {
        st.placed = 0;
        st.fromHouse = 0;
        st.fromVeg = 0;
        st.prevN = 0;
        st.sig = 'day';
        mesh.count = 0;
        mesh.visible = false;
      } else {
        // …and the static skip: a settled ring under a parked aircraft
        // re-derives an identical pool and re-uploads it every 2 s. Both
        // anchor sources are in the signature (the building ring's houseAnchors
        // and the veg ring's residential scatter), plus the night ramp itself.
        const vg = engine.stats;
        const bs = runtime.satBuildings?.stats;
        const sig = U
          ? `${vg.chunks}|${vg.ready}|${vg.clsChunks}|${vg.vegPts}|` +
            `${bs?.chunks ?? -1}|${bs?.ready ?? -1}|${bs?.columns ?? -1}|${st.nightK.toFixed(3)}`
          : '';
        const moved2 = (flight.pos.x - st.atX) ** 2 + (flight.pos.z - st.atZ) ** 2;
        if (!U || sig !== st.sig || moved2 >= U.staticSkipM ** 2) {
          st.sig = sig;
          st.atX = flight.pos.x;
          st.atZ = flight.pos.z;
          placeLights(mesh, engine, runtime, flight, st);
          // A placement pass wrote every matrix at FULL scale, so whatever the
          // birth had baked into the buffer is gone: the envelope restarts from
          // 1 and the next frame re-applies the ramp.
          resetEnv(envRef.current);
        }
      }
    }
    // R22 (B): the birth envelope. Re-armed on every arrival epoch, and driven
    // per frame (not per cadence) so a field placed between two cadence ticks
    // still grows in instead of appearing whole.
    const bk = birthK(
      birthRef.current,
      t,
      st.placed > 0,
      arrivalEpoch(),
      SETTLE_CALM.births.rampSec
    );
    if (applyInstanceEnv(mesh, envRef.current, bk, st.placed)) {
      rangeUpload(mesh.instanceMatrix, st.placed * 16); // only the live set
    }
    notePopin('satHouseLights', st.placed > 0 && mesh.visible, birthRef.current.running);
    // ONE material write per frame.
    mesh.material.opacity = st.nightK * H.opacity;

    if (process.env.NODE_ENV === 'development' && window.__flyStats) {
      window.__flyStats.houseLights = {
        placed: st.placed,
        nightK: st.nightK,
        fromHouse: st.fromHouse,
        fromVeg: st.fromVeg,
      };
      if (window.__satVeg) window.__satVeg.houseMesh = mesh; // harness A/B flip
    }
  }, -43);

  return (
    <instancedMesh
      ref={(m) => {
        meshRef.current = m;
        if (!m || m.userData.__houseInit) return;
        // ONCE per mesh — the SatVegLayer latch, for the same reason: an inline
        // ref callback re-attaches on every re-render of the parent, and a
        // reset here would wipe count/visible until the next 2 s cadence.
        m.userData.__houseInit = true;
        m.instanceMatrix.setUsage(DynamicDrawUsage);
        m.frustumCulled = false; // instances span the ring; the unit bound lies
        m.renderOrder = 4; // additive, after the road ribbons (3)
        m.count = 0; // parked until the first night placement
        m.visible = false;
        stateRef.current.t = -Infinity; // place on the very next frame
      }}
      args={[geometry, material, POOL]}
    />
  );
}

/**
 * ONE cadence pass. Primary anchors (building housePts) first, then the
 * residential-parcel fallback, both nearest-chunk-first, into one pool.
 */
function placeLights(mesh, engine, runtime, flight, st) {
  const H = SUBURB_NIGHT.houseLights;
  const px = flight.pos.x;
  const pz = flight.pos.z;
  const rangeSq = H.rangeM ** 2;
  let n = 0;
  let fromHouse = 0;

  // Pool origin rounded to 1 km (the canopy recipe): instanceMatrix is float32
  // and absolute mercator XZ near a city is ~8.2e6, where the ulp is 1.0 m.
  const ox = Math.round(px / 1000) * 1000;
  const oz = Math.round(pz / 1000) * 1000;
  mesh.position.set(ox, 0, oz);

  const fs = H.farScale;
  const put = (wx, gy, wz) => {
    // Distance up-scale, resolved HERE (the cadence pass), never per frame.
    let ft = Math.min(1, Math.max(0, (Math.hypot(wx - px, wz - pz) - fs.startM) / (fs.endM - fs.startM)));
    ft = ft * ft * (3 - 2 * ft); // smoothstep
    _dummy.position.set(wx - ox, gy + H.liftM, wz - oz);
    _dummy.scale.setScalar(H.sizeM * (1 + (fs.mul - 1) * ft));
    _dummy.rotation.set(0, 0, 0);
    _dummy.updateMatrix();
    mesh.setMatrixAt(n, _dummy.matrix);
    n += 1;
  };

  // --- PRIMARY: real small-band building footprints -------------------------
  // Optional-chained through the runtime bus (the R18 satBuildings contract):
  // off-satellite, at low tier, or before the building layer mounts this is
  // simply absent, and the fallback below carries the frame.
  const houseChunks = runtime.satBuildings?.houseAnchors?.(px, pz) ?? [];
  for (const hc of houseChunks) {
    if (n >= POOL) break;
    const pts = hc.pts;
    for (let i = 0; i < pts.length; i += 3) {
      if (n >= POOL) break;
      const wx = pts[i];
      const wz = pts[i + 2];
      if ((wx - px) ** 2 + (wz - pz) ** 2 > rangeSq) continue;
      // Hash-stable lit set: the SAME houses are lit every pass, every session
      // and after every re-stream — a light that blinks as the ring refreshes
      // reads as a bug, and the whole point of a hash is that it is not a
      // random draw taken again each cadence.
      if (hash(wx * 0.37 + wz * 0.71) > H.litFrac) continue;
      put(wx, pts[i + 1], wz);
      fromHouse += 1;
    }
  }

  // --- FALLBACK: residential-landcover parcel points -------------------------
  if (n < POOL) {
    for (const chunk of engine.nearest(px, pz)) {
      if (n >= POOL) break;
      const cls = chunk.cls;
      const veg = chunk.veg;
      if (!cls || !veg) continue; // pre-R19 bundle, or a tile with no classes
      const rows = veg.length / 4;
      for (let i = 0; i < rows; i++) {
        if (n >= POOL) break;
        if (cls[i] !== 4) continue; // 4 = landuse:residential (A's class ids)
        const lx = veg[i * 4];
        const lz = veg[i * 4 + 1];
        const wx = chunk.cx + lx;
        const wz = chunk.cz + lz;
        if ((wx - px) ** 2 + (wz - pz) ** 2 > rangeSq) continue;
        const h = hash(lx * 0.37 + lz * 0.71);
        if (h > H.litFrac) continue;
        const gy = engine.groundAtLocal(chunk, lx, lz);
        // A CLUSTER per lit parcel, on a hash-stable ring of bearings and
        // radii. Two jobs in one: it steps every light off the anchor (an
        // unoffset one sits inside the canopy blob standing on the same point,
        // opaque Lambert in front of an additive sprite), and it is the only
        // lever that can reach a suburban DENSITY from anchors the worker caps
        // — measured, one-per-anchor was 4 lights per km².
        for (let k = 0; k < H.perAnchor && n < POOL; k++) {
          const a = hash(lx * 5.13 - lz * 2.71 + k * 17.3) * Math.PI * 2;
          const r =
            H.vegOffsetM + hash(lz * 3.71 - lx * 1.19 + k * 41.7) * (H.spreadM - H.vegOffsetM);
          put(wx + Math.cos(a) * r, gy, wz + Math.sin(a) * r);
        }
      }
    }
  }

  mesh.count = n; // 0 = the draw is parked entirely (three skips primcount 0)
  mesh.visible = n > 0;
  // Round 21 (C, S6): upload only what can have changed (see rangeUpload).
  rangeUpload(mesh.instanceMatrix, Math.max(n, st.prevN | 0) * 16);
  st.prevN = n;
  st.placed = n;
  st.fromHouse = fromHouse;
  st.fromVeg = n - fromHouse;
}
