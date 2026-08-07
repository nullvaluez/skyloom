'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  LinearFilter,
  MeshLambertMaterial,
  Object3D,
  RepeatWrapping,
  Sphere,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { mercatorScale } from '@/lib/fly/coords';
import {
  GLOBE,
  PARCEL_HOMES,
  SETTLE_CALM,
  SUBURB_NIGHT,
  SURFACE_CALM,
} from '@/lib/fly/fly-constants';
import { applyBendAnchor } from '@/lib/fly/toy-world/world-bend';
import {
  applyInstanceEnv,
  arrivalEpoch,
  birthK,
  groundElevVis,
  makeBirth,
  makeEnv,
  notePopin,
  resetEnv,
  settleOn,
} from '@/lib/fly/settle';
import { useFlyStore } from '@/stores/fly-store';

const _dummy = new Object3D();
const _col = new Color();
const PALETTE = PARCEL_HOMES.palette.map((c) => new Color(c));
// Worst-case bend drop pad for the CPU bounding sphere (SatVegLayer's value and
// its reasoning: the GPU pushes far geometry DOWN by d²k and the CPU bound
// cannot see it; k is largest at the low altitudes this layer lives at).
const MAX_BEND_K = 1 / (2 * GLOBE.bendRadiusM.satellite);

/** Deterministic hash — the CloudField/SatHouseLights recipe. */
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / Math.max(1e-6, b - a)));
  return t * t * (3 - 2 * t);
};

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
 * Round 21 (C "SURFACE", P5) — HAS A STREAMING RING RESOLVED?
 *
 * Both rings publish `ready`/`empty` counts, but neither is a complete
 * partition of `chunks`: a sat-building chunk that carries WATER and no
 * buildings reaches state 'ready' with `mesh === null`, and the stats getter
 * counts `ready` off the MESH — so over a harbour `ready + empty` plateaus
 * below `chunks` forever, and a settle test written only that way would hold
 * this layer off Sydney for the whole session. The in-flight counters are the
 * other side of the same question and they ARE complete, so the resolved count
 * is the better of the two readings.
 */
function resolvedFrac(s, inFlight) {
  if (!s || !(s.chunks > 0)) return 0;
  // R21 B STREAMKEEPER keeps a failed chunk RESIDENT as an error record with a
  // backoff instead of deleting it, so `chunks` can carry rows that will never
  // become ready or empty until a retry lands. Those are not evidence in
  // flight, so they leave the denominator if the engine names them. The
  // load-bearing bound is NOT this subtraction — it is the maxHoldSec timeout
  // below, which is why this can afford to be optional about a field name it
  // has not seen.
  const errored = s.errorChunks ?? s.errors ?? s.error ?? 0;
  const denom = Math.max(1, s.chunks - errored);
  return Math.max(s.ready + s.empty, s.chunks - inFlight - errored) / denom;
}

/**
 * Round 20 (B "HOMES") — SATELLITE procedural suburbia: houses where
 * OpenFreeMap ships none.
 *
 * WHAT CHANGED UNDER THIS LAYER'S FEET, AND WHY IT IS STILL NEEDED.
 * A SPRAWL's per-polygon fix landed first and it is a big one: Powell OH went
 * from 15 streamed footprints to 1,863, because one OpenFreeMap feature carries
 * a whole 171-house subdivision and the old reader tested the SUM of its
 * polygons. So "suburbs have no buildings" is no longer true in the American
 * Midwest. Measured (live 3x3 z14, real footprints that actually extrude, per
 * km² of landuse=residential — scripts/r20-b-parcels.js):
 *
 *     Powell OH 533 · Campinas BR 611 · Jaipur 412 · Lone Pine 376 ·
 *     Dublin OH 261 · Blagnac FR 222 · Piaseczno PL 220 · Hamilton NZ 208 ·
 *     Plain City OH 195 · Toluca MX 164 · Craigieburn AU 53 · Melton AU 37
 *
 * against the ~600 dwellings/km² American suburbia actually runs. Powell is
 * DONE — A finished it. Melbourne's outer suburbs are at 6% of their real
 * housing. That spread, not a global absence, is what this layer answers, and
 * it is why the density is a per-anchor DEFICIT off the local real count
 * rather than a constant: the layer must disappear where A succeeded.
 *
 * WHAT IT WILL NOT DO. It places ONLY inside `landuse=residential` polygons.
 * Deep-rural Union County OH and small-town Ashley OH measure 0.00 km² of
 * residential landuse — those places have farms and a main street, and their 9
 * and 68 real footprints ARE the houses. Inventing homes there would be
 * fabricating settlement that is not in the data, so the honest answer is the
 * empty one, and Owens Valley holds by the same rule plus the deficit scalar
 * (Lone Pine measures 376 real/km², i.e. a real town that is already built).
 *
 * BUDGET: ONE pooled InstancedMesh — +1 draw for the whole world when anything
 * places, and 0 draws (count = 0, visible = false) when nothing does, which is
 * every Owens/desert/ocean pose and every low-tier boot. 32 triangles per
 * house. Placement runs on the veg cadence (2 s), never per frame; the only
 * per-frame write is one emissive intensity.
 *
 * ANCHORS come from the worker's dedicated `satParcel` sample (see the pass in
 * vector-tile.worker.js for why the cls-4 canopy scatter could not be the
 * source), building-avoided at source by the same occupancy grid the R19
 * residential canopy uses, and DEM-draped here on SatVegEngine's per-chunk
 * bilinear grid — the same grid the canopy stands on and the tint drapes over,
 * so a house, its trees and its ground can never disagree.
 */
export function SatParcelHomes({ engine, runtime, flight, tier }) {
  const meshRef = useRef(null);
  const pool = PARCEL_HOMES.poolByTier[tier] ?? 0;
  const stateRef = useRef({
    t: -Infinity,
    placed: 0,
    anchors: 0,
    suppressed: 0,
    nightK: 0,
    altK: 0,
    realCols: 0,
    meanScalar: 0,
    meanDens: 0,
    maxDens: 0,
    regionalDens: 0,
    regK: 0,
    atX: Infinity, // player position at the LAST PASS (warp + static-skip test)
    atZ: Infinity,
    // --- round 21 (C) — the two-ring settle machine ---------------------------
    first: true, // the one-time cadence phase nudge (S6)
    sig: '', // static-skip signature
    prevN: 0, // instances uploaded last pass (the ranged-upload tail)
    floorA: null, // rolling-min buckets: the current relocateM of travel…
    floorB: null, // …and the previous one (so evidence expires by DISTANCE)
    bucketX: Infinity, // where the current bucket started
    bucketZ: Infinity,
    regKUsed: null, // the DEADBANDED value the placement actually ran on
    regKRaw: 0, // this pass's raw measurement (telemetry only)
    confirmed: false, // a SETTLED pass has placed here since the last warp
    zeroPasses: 0, // consecutive settled passes voting to delete the field
    warped: false, // a warp epoch bump is pending (dropped by the next pass)
    probeRegK: null, // previous pass's raw regK, for the first-placement agreement
    trustSince: -1, // when the collision-index trust hold started (its OWN timer)
    indexStale: false, // the collision index is not yet built over this disc
    holdSince: -1, // when the current unsettled hold started (-1 = not holding)
    held: false, // …and whether this pass held (telemetry)
    stale: false, // the ring timed out unresolved: treat it as resolved as it gets
    provisional: false, // placed past maxHoldSec on an unresolved ring
    settled: false,
    // --- round 22 (B SETTLE) — TRANSITIONS ONLY. The R21 placement machine
    // above (two-ring settle + collision-index trust gate + rolling-MIN regK)
    // is FROZEN; every field here decides how a decision it already made is
    // ANIMATED, never what the decision is.
    growEaseFrom: -1, // clock at which the provisional→confirmed ease started
    growWas: 1, // …and the grow factor it started from
    deleteFrom: -1, // clock at which a CONFIRMED delete began fading out
    pendingDelete: false,
  });
  // The instanced birth (see SatHouseLights for the mechanism) plus the two
  // parcel-specific envelopes it composes with.
  const birthRef = useRef(makeBirth());
  const envRef = useRef(makeEnv());

  const geometry = useMemo(() => buildHouseGeometry(), []);
  const material = useMemo(() => {
    const m = new MeshLambertMaterial({
      vertexColors: true,
      emissive: new Color(PARCEL_HOMES.night.color),
      emissiveIntensity: 0, // the γ ramp owns this; 0 = the day frame exactly
      emissiveMap: buildWindowTexture(),
    });
    // Rigid instanced GROUND objects ride the ANCHOR bend, never the per-vertex
    // one (round-6 lesson 2) — the SAME existing variant the canopy, the porch
    // lights, TownGlow and the airport beacons share, unmodified, so this layer
    // adds no program cache key.
    applyBendAnchor(m);
    return m;
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.emissiveMap?.dispose();
      material.dispose();
    },
    [geometry, material]
  );

  // Round 21 (C, P5) — a WARP is a discontinuity, and the warp epoch says so
  // exactly (the SatBuildingLayer/SatRoadLayer idiom, same store, same shape).
  // A distance threshold cannot: a boost run covers ~1.9 km between passes and
  // the Owens→Lone Pine hop covers 4.2 km, so no single number separates
  // "flying fast" from "somewhere else entirely". Everything the machine knows
  // about the place it was over — the accumulated anti-duplication evidence,
  // the standing field, the confirmed flag — belongs to that place and is
  // dropped here, which is what makes the destination start from the hold
  // instead of from the origin's suburb.
  useEffect(() => {
    if (!SURFACE_CALM.enabled) return undefined;
    let prev = useFlyStore.getState().warpEpoch;
    return useFlyStore.subscribe((s) => {
      if (s.warpEpoch === prev) return;
      prev = s.warpEpoch;
      stateRef.current.warped = true; // consumed by the next placement pass
      // …and park the field NOW rather than up to one cadence later. The
      // standing instances are relative to the ORIGIN town's pool origin, so
      // they are off-screen either way, but "the destination inherits the
      // origin's house count for two seconds" is a lie in the telemetry every
      // stability probe reads, and parking is this component's own business.
      const m = meshRef.current;
      if (m) {
        m.count = 0;
        m.visible = false;
      }
      stateRef.current.placed = 0;
      stateRef.current.prevN = 0;
    });
  }, []);

  // Priority -42: after the canopy (-45), the tint (-44) and the porch lights
  // (-43) — the whole ground stack settles in streaming order on one cadence.
  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = clock.elapsedTime;
    const st = stateRef.current;
    if (t - st.t >= 2) {
      // Round 21 (C, S6): one-time phase nudge; the first pass stays immediate.
      const U = SURFACE_CALM.enabled ? SURFACE_CALM.uploads : null;
      st.t = st.first && U ? t + U.stagger[3] * 2 : t;
      st.first = false;
      const H = SUBURB_NIGHT.houseLights;
      // The EXACT SatHouseLights γ ramp — the windows and the porch lights are
      // the same dusk, so they must be the same curve.
      const nt = Math.min(1, Math.max(0, 1 - (runtime.sun?.frac ?? 1) / H.dayFrac));
      st.nightK = nt ** H.gamma;
      // R22 (B): a pass that reached the tail rewrote every live matrix at FULL
      // scale, so whatever the envelope had baked into the buffer is gone and
      // it restarts from 1. A pass that held or was skipped left the buffer
      // alone, and so must the envelope.
      if (placeHomes(mesh, engine, runtime, flight, st, pool, t)) resetEnv(envRef.current);
      // eslint-disable-next-line react-hooks/immutability -- runtime is the scene's mutable bus (FlyScene RUNTIME CONTRACTS (R18))
      runtime.parcelSettle = { mounted: true, resolved: !st.held, placed: st.placed };
    }
    // --- R22 (B SETTLE): the three composed scale envelopes -----------------
    // Every one of them is a TRANSITION. The R21 placement machine decided
    // what stands where and whether it stands at all; these decide only how a
    // decision that has already been taken reaches the screen.
    const C = SURFACE_CALM.enabled ? SURFACE_CALM.parcel : null;
    const S = SETTLE_CALM.parcel;
    let envK = birthK(birthRef.current, t, st.placed > 0, arrivalEpoch(), SETTLE_CALM.births.rampSec);
    if (settleOn() && C) {
      // (a) THE GROW EASE. R21 placed a provisional field at growScale 0.55 and
      // jumped it to 1.0 on the next settled pass — a discrete 45% step on up
      // to 2,000 houses, between two frames, two seconds apart. Same two
      // endpoints, same trigger, continuous in between.
      if (st.provisional) {
        st.growWas = C.growScale;
        st.growEaseFrom = -1;
        envK *= C.growScale;
      } else if (st.growWas < 1) {
        if (st.growEaseFrom < 0) st.growEaseFrom = t;
        const u = Math.min(1, (t - st.growEaseFrom) / Math.max(0.05, S.growEaseSec));
        const e = u * u * (3 - 2 * u);
        envK *= st.growWas + (1 - st.growWas) * e;
        if (u >= 1) {
          st.growWas = 1;
          st.growEaseFrom = -1;
        }
      }
      // (b) THE DELETE FADE. A confirmed zero verdict is the LOUD direction of
      // this layer's error (the R21 header), so when it does land it should
      // land as a field shrinking away, not as one that was there and is not.
      // The verdict itself — two consecutive SETTLED zero passes — is
      // untouched; this only spends deleteFadeSec spending it.
      if (st.pendingDelete) {
        const u = Math.min(1, (t - st.deleteFrom) / Math.max(0.05, S.deleteFadeSec));
        envK *= 1 - u * u * (3 - 2 * u);
        if (u >= 1) {
          st.pendingDelete = false;
          st.deleteFrom = -1;
          st.placed = 0;
          st.prevN = 0;
          mesh.count = 0;
          mesh.visible = false;
          resetEnv(envRef.current);
        }
      }
    }
    if (applyInstanceEnv(mesh, envRef.current, envK, st.placed)) {
      rangeUpload(mesh.instanceMatrix, st.placed * 16);
    }
    notePopin(
      'parcelHomes',
      st.placed > 0 && mesh.visible,
      birthRef.current.running || st.growWas < 1
    );
    // ONE material write per frame.
    mesh.material.emissiveIntensity = st.nightK * PARCEL_HOMES.night.intensity;

    if (process.env.NODE_ENV === 'development' && window.__flyStats) {
      window.__flyStats.parcelHomes = {
        placed: st.placed,
        anchors: st.anchors,
        suppressed: st.suppressed,
        pool,
        altK: st.altK,
        nightK: st.nightK,
        realCols: st.realCols,
        meanScalar: st.meanScalar,
        meanDens: st.meanDens,
        maxDens: st.maxDens,
        regionalDens: st.regionalDens,
        regK: st.regK,
        // Round 21 (C, P5) — the settle machine, for the probe and E's gates.
        regKRaw: st.regKRaw,
        settled: st.settled,
        held: st.held,
        provisional: st.provisional,
        zeroPasses: st.zeroPasses,
        tris: st.placed * (geometry.index.count / 3),
      };
      if (window.__satVeg) window.__satVeg.homeMesh = mesh; // harness A/B flip
    }
  }, -42);

  if (pool <= 0) return null;
  return (
    <instancedMesh
      ref={(m) => {
        meshRef.current = m;
        // ONCE per mesh — the SatVegLayer/SatHouseLights latch, for the same
        // reason: an inline ref callback re-attaches on every re-render of the
        // parent, and a reset here would wipe count/visible until the next
        // 2 s cadence.
        if (!m || m.userData.__parcelInit) return;
        m.userData.__parcelInit = true;
        m.instanceMatrix.setUsage(DynamicDrawUsage);
        // The unit-box GEOMETRY bound lies for a ring-spanning instance pool,
        // so placeHomes() writes a real one (padded for the bend drop) every
        // cadence — culling stays enabled AND honest. That, plus the rangeM
        // placement radius, IS this layer's distance gate: there are no
        // per-chunk meshes here to toggle (the _gateScatter idiom applies to
        // the toy engine's per-chunk scatter meshes, not to a global pool).
        m.frustumCulled = true;
        m.boundingSphere = new Sphere(new Vector3(), 1);
        m.renderOrder = 0;
        // three ships count = the constructor capacity, which would draw `pool`
        // identity-matrix houses stacked on the pool origin for one cadence.
        m.count = 0;
        m.visible = false;
        // NO castShadow/receiveShadow: SAT_SHADOWS is a frozen R19 rig whose
        // pins every satellite pixel gate depends on, and adding a caster is a
        // change to that rig, not to this layer.
        // NO _isModel/_painted: those enrol a mesh in the harness
        // foreground-hide, and this layer is scenery a probe must SEE.
        stateRef.current.t = -Infinity; // place on the very next frame
      }}
      args={[geometry, material, pool]}
    />
  );
}

// --- the house ---------------------------------------------------------------

/**
 * ONE unit house: footprint 1×1 in XZ centred on the origin, base at y = 0,
 * ridge at y = 1. 32 triangles.
 *
 *   body     4 wall quads                              8 tris
 *   fascia   4 quads, wall top → roof base (the eave)  8 tris
 *   roof     2 sloped trapezoids + 2 hip triangles     6 tris
 *   wing     4 wall quads + a flat top                10 tris
 *
 * Colour is baked to COLOR_0 as the wall/roof/trim STRUCTURE plus a base-of-wall
 * AO darkening; the per-house tone arrives as instanceColor and multiplies it.
 * UVs put every WALL face on the left half of the emissive texture (the window
 * grid) and every roof/fascia/top face on the black right half, which is what
 * makes the night read windows instead of a glowing box.
 */
function buildHouseGeometry() {
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];

  // COLOUR_0 IS A MULTIPLIER, NOT A TONE. instanceColor carries the house's
  // absolute colour — picked from a ROOF palette, because the roof is nearly
  // all of what an airborne player sees — and these bake the wall/roof/trim
  // RELATIONSHIP on top of it (three multiplies vColor by instanceColor).
  // Baking absolute tones here instead was measured and wrong: roof 0.40 x a
  // 0.28-luma palette entry rendered a field of near-black slabs over Melton,
  // which is the R13 "dark reads as a cut-out" lesson in a new costume.
  // The wall multiplier is >1 and CHANNEL-TILTED (more blue than red): it both
  // lifts the wall off the roof tone and pulls it toward neutral, so a
  // terracotta roof gets warm render/stucco walls and a grey roof gets grey
  // ones — the one place the single-instanceColor budget shows, and the place
  // it costs least.
  const WALL = [1.42, 1.58, 1.76];
  const WALL_AO = 0.8; // multiplier at the ground line (grime/contact AO)
  const ROOF = [1, 1, 1];
  const ROOF_RIDGE = 1.14; // ridge line catches more light
  const TRIM = [1.72, 1.86, 2.02]; // eave fascia: the bright line under the roof

  const push = (x, y, z, c, u, v) => {
    pos.push(x, y, z);
    col.push(c[0], c[1], c[2]);
    uv.push(u, v);
    return pos.length / 3 - 1;
  };
  const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);

  // --- body: 4 wall quads, CCW seen from outside ----------------------------
  const wallTop = 0.58;
  const bx = 0.5;
  const bz = 0.5;
  const corners = [
    [-bx, -bz],
    [bx, -bz],
    [bx, bz],
    [-bx, bz],
  ];
  const wallLo = WALL.map((c) => c * WALL_AO);
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = corners[i];
    const [x1, z1] = corners[(i + 1) % 4];
    // u spans the window grid; v 0 at the ground, 1 at the eave.
    const a = push(x0, 0, z0, wallLo, 0.02, 0.02);
    const b = push(x1, 0, z1, wallLo, 0.48, 0.02);
    const c = push(x1, wallTop, z1, WALL, 0.48, 0.98);
    const d = push(x0, wallTop, z0, WALL, 0.02, 0.98);
    quad(a, b, c, d);
  }

  // --- fascia: wall top → roof base, the eave overhang ----------------------
  const ov = 1.08; // roof base overhang factor
  const roofY = 0.63;
  const rx = bx * ov;
  const rz = bz * ov;
  const rc = [
    [-rx, -rz],
    [rx, -rz],
    [rx, rz],
    [-rx, rz],
  ];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = rc[i];
    const [x1, z1] = rc[(i + 1) % 4];
    const a = push(x0, wallTop, z0, TRIM, 0.52, 0.02);
    const b = push(x1, wallTop, z1, TRIM, 0.98, 0.02);
    const c = push(x1, roofY, z1, TRIM, 0.98, 0.2);
    const d = push(x0, roofY, z0, TRIM, 0.52, 0.2);
    quad(a, b, c, d);
  }

  // --- roof: hipped, ridge along X, inset in Z ------------------------------
  const ridgeHalf = 0.26; // ridge runs from -0.26 to +0.26 in X: a hip
  const ridgeC = ROOF.map((c) => c * ROOF_RIDGE);
  const r0 = push(-rx, roofY, -rz, ROOF, 0.52, 0.02);
  const r1 = push(rx, roofY, -rz, ROOF, 0.98, 0.02);
  const r2 = push(rx, roofY, rz, ROOF, 0.98, 0.02);
  const r3 = push(-rx, roofY, rz, ROOF, 0.52, 0.02);
  const g0 = push(-ridgeHalf, 1, 0, ridgeC, 0.6, 0.5);
  const g1 = push(ridgeHalf, 1, 0, ridgeC, 0.9, 0.5);
  quad(r0, r1, g1, g0); // -Z slope
  quad(r2, r3, g0, g1); // +Z slope
  idx.push(r1, r2, g1); // +X hip
  idx.push(r3, r0, g0); // -X hip

  // --- wing / garage: a lower box attached on +X ----------------------------
  const wx0 = bx * 0.7;
  const wx1 = bx * 1.34;
  const wz0 = -bz * 0.44;
  const wz1 = bz * 0.4;
  const wTop = 0.38;
  const wc = [
    [wx0, wz0],
    [wx1, wz0],
    [wx1, wz1],
    [wx0, wz1],
  ];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = wc[i];
    const [x1, z1] = wc[(i + 1) % 4];
    const a = push(x0, 0, z0, wallLo, 0.02, 0.02);
    const b = push(x1, 0, z1, wallLo, 0.48, 0.02);
    const c = push(x1, wTop, z1, WALL, 0.48, 0.72);
    const d = push(x0, wTop, z0, WALL, 0.02, 0.72);
    quad(a, b, c, d);
  }
  const t0 = push(wx0, wTop, wz0, ROOF, 0.52, 0.02);
  const t1 = push(wx1, wTop, wz0, ROOF, 0.98, 0.02);
  const t2 = push(wx1, wTop, wz1, ROOF, 0.98, 0.2);
  const t3 = push(wx0, wTop, wz1, ROOF, 0.52, 0.2);
  quad(t0, t3, t2, t1);

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(new BufferAttribute(new Uint16Array(idx), 1));
  g.computeVertexNormals();
  return g;
}

/**
 * The night window atlas: a 64×32 canvas whose LEFT half is a grid of warm
 * window rectangles on black and whose RIGHT half is pure black. Wall UVs land
 * left, roof/fascia UVs land right, so `emissiveIntensity` lights windows and
 * never a roof. Deterministic (a fixed pattern, no RNG) so two sessions bake
 * the same texture.
 */
function buildWindowTexture() {
  const W = 64;
  const H = 32;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  // Two storeys of windows across the left half, with a deterministic
  // "some rooms are dark" pattern so a wall is not a lit stripe.
  const lit = [1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 0];
  ctx.fillStyle = '#fff';
  let k = 0;
  for (let row = 0; row < 2; row++) {
    for (let cx = 0; cx < 6; cx++) {
      if (lit[k++ % lit.length]) {
        ctx.fillRect(2 + cx * 5, 6 + row * 13, 3, 6);
      }
    }
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

// --- placement ---------------------------------------------------------------

// Anti-duplication scratch, allocated once at module scope: a coarse DENSITY
// grid (real buildings per cell) and a fine OCCUPANCY grid (cells a real
// footprint's own radius covers). Both are rebuilt from one queryColumns call
// per cadence and indexed off a rounded origin, so neither allocates per pass.
const DENS_CELL = 150; // m
const OCC_CELL = 20; // m
const DENS_N = Math.ceil((2 * PARCEL_HOMES.rangeM) / DENS_CELL) + 2;
const OCC_N = Math.ceil((2 * PARCEL_HOMES.rangeM) / OCC_CELL) + 2;
const _dens = new Uint16Array(DENS_N * DENS_N);
const _occ = new Uint8Array(OCC_N * OCC_N);
const _grid = { ox: 0, oz: 0, cols: 0 };

/**
 * Rasterise every streamed REAL building into the two grids. `queryColumns` is
 * the R18 collision index — one bounding cylinder {x, z, topY, r} per extruded
 * building, bucket-hashed, a production API — so this is the same population
 * the player can crash into, which is exactly the population "is this block
 * already built?" is asking about.
 */
function buildRealGrids(runtime, px, pz) {
  _dens.fill(0);
  _occ.fill(0);
  _grid.ox = px - PARCEL_HOMES.rangeM;
  _grid.oz = pz - PARCEL_HOMES.rangeM;
  _grid.cols = 0;
  const cols = runtime.satBuildings?.queryColumns?.(px, pz, PARCEL_HOMES.rangeM);
  if (!cols || cols.length === 0) return;
  _grid.cols = cols.length;
  const avoid = PARCEL_HOMES.avoidM;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    const gx = ((c.x - _grid.ox) / DENS_CELL) | 0;
    const gz = ((c.z - _grid.oz) / DENS_CELL) | 0;
    if (gx >= 0 && gz >= 0 && gx < DENS_N && gz < DENS_N) _dens[gz * DENS_N + gx] += 1;
    // Occupancy. The mark radius is CLAMPED: a downtown column can be 300 m
    // across (A SPRAWL's per-building measurement) and marking that honestly
    // would be ~700 cells per tower over a Manhattan ring. Homes never place
    // near one anyway — the density scalar has already gone to zero there.
    const r = Math.min(c.r + avoid, 90);
    const ox0 = ((c.x - r - _grid.ox) / OCC_CELL) | 0;
    const ox1 = ((c.x + r - _grid.ox) / OCC_CELL) | 0;
    const oz0 = ((c.z - r - _grid.oz) / OCC_CELL) | 0;
    const oz1 = ((c.z + r - _grid.oz) / OCC_CELL) | 0;
    for (let z = Math.max(0, oz0); z <= Math.min(OCC_N - 1, oz1); z++) {
      for (let x = Math.max(0, ox0); x <= Math.min(OCC_N - 1, ox1); x++) {
        _occ[z * OCC_N + x] = 1;
      }
    }
  }
}

/**
 * Real buildings per TRUE km² in a windowM box around (wx, wz).
 *
 * The km² is the load-bearing word. Every horizontal quantity in this scene is
 * in WEB-MERCATOR world units, which at latitude φ are 1/cos φ true metres —
 * 1.31x at Powell, 1.60x in area. A density expressed per mercator-km² would
 * therefore mean something different in Ohio than in Melbourne than in Nairobi,
 * and this number is compared against a real-world figure (dwellings per km²),
 * so it is converted here, once, at the one place the comparison happens.
 */
function realDensityAt(wx, wz, mercK) {
  const w = PARCEL_HOMES.antiDup.windowM * mercK;
  const x0 = Math.max(0, ((wx - w - _grid.ox) / DENS_CELL) | 0);
  const x1 = Math.min(DENS_N - 1, ((wx + w - _grid.ox) / DENS_CELL) | 0);
  const z0 = Math.max(0, ((wz - w - _grid.oz) / DENS_CELL) | 0);
  const z1 = Math.min(DENS_N - 1, ((wz + w - _grid.oz) / DENS_CELL) | 0);
  let n = 0;
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) n += _dens[z * DENS_N + x];
  const cells = (x1 - x0 + 1) * (z1 - z0 + 1);
  const areaKm2 = (cells * DENS_CELL * DENS_CELL) / (mercK * mercK * 1e6);
  return areaKm2 > 0 ? n / areaKm2 : 0;
}

function occupiedAt(wx, wz) {
  const x = ((wx - _grid.ox) / OCC_CELL) | 0;
  const z = ((wz - _grid.oz) / OCC_CELL) | 0;
  if (x < 0 || z < 0 || x >= OCC_N || z >= OCC_N) return false;
  return _occ[z * OCC_N + x] === 1;
}

/** Everything this pass MEASURES (as opposed to remembers), zeroed. */
function clearMeasurements(st) {
  st.anchors = 0;
  st.suppressed = 0;
  st.realCols = 0;
  st.meanScalar = 0;
  st.meanDens = 0;
  st.maxDens = 0;
  st.regionalDens = 0;
  st.regK = 0;
}

/**
 * ONE cadence pass: the streamed parcel anchors nearest-first, each thinned by
 * the local REAL footprint density, each laid out as a hash-rotated block of
 * houses on the chunk's own DEM grid. Returns nothing; writes stats into `st`.
 */
function placeHomes(mesh, engine, runtime, flight, st, pool, now) {
  const P = PARCEL_HOMES;
  const C = SURFACE_CALM.enabled ? SURFACE_CALM.parcel : null;
  const px = flight.pos.x;
  const pz = flight.pos.z;
  // R22 (B): altK is a VISUAL fade band, so it reads the slew-limited ground
  // elevation. At boot and after a warp the raw sample is seeded 0 and then
  // refines, which swept this band (and every other) through its whole range
  // in the first seconds of an arrival.
  const eyeAgl = Math.max(0, flight.pos.y - groundElevVis(runtime, flight));
  st.altK = 1 - smoothstep(P.altFade.onM, P.altFade.offM, eyeAgl);
  // Round 21 (C): the measurement fields are cleared where the measurement
  // STARTS, not at the top. A pass that holds or is statically skipped made no
  // measurement, and zeroing its predecessor's would report "no anchors here"
  // for a field that is standing on screen — an instrument reporting the
  // instrument's own state instead of the world's (the R19 §7 lesson). With
  // the flag off this is the R20 line-for-line.
  if (!C) clearMeasurements(st);

  let n = 0;
  let maxR2 = 0;
  let maxScale = 1;
  let maxD = 0;

  // TRUE metres → WORLD units. Every horizontal length in this layer (lot
  // pitch, footprint, cluster geometry) is authored in true metres and drawn in
  // mercator world units, exactly like a real streamed footprint: the worker
  // maps tile geometry to mercator, so a real 12 m house is 12·mercK units
  // wide. Authoring in raw world units instead would make procedural houses
  // 31% too small beside real ones in Ohio and 3% too small at the equator.
  // Heights are NOT scaled — Y is true metres for real buildings too.
  const mercK = mercatorScale(flight.latDeg);

  // DEV-ONLY park handle. A/B evidence and the Δ-draw gate need to switch this
  // layer off inside one settled scene, and a bare `mesh.visible = false` from
  // a probe would be overwritten by the very next cadence — R19's lesson that
  // object visibility cannot park an actor whose owner rewrites it every pass.
  // So the OWNER reads the flag, which is what makes the park authoritative.
  // Compiled out of production by the NODE_ENV guard.
  if (process.env.NODE_ENV === 'development' && globalThis.__flyParcelHomesOff) {
    st.altK = 0;
  }

  // THE SETTLE HOLD, and the escape that keeps it from becoming a freeze.
  //
  // Both anti-duplication terms read STREAMED buildings, and buildings only
  // ever arrive, so a half-streamed ring always reads "unmapped": placing
  // through a warp's stream-in would carpet a mapped town and then delete the
  // carpet — a pop, on exactly the scenes this layer is supposed to leave
  // alone. So the pass HOLDS (returns without touching a matrix; the previous
  // placement, which is count = 0 on a fresh arrival, simply stays).
  //
  // ROUND 21 (C, P5) — THE R20 HOLD HAD THREE HOLES, and the user saw all
  // three at once as a carpet of houses over a fully-mapped town that vanished
  // two seconds after boot (measured at Powell OH: 0 → 633 → 0, and Melton
  // over-placed 3,356 before settling to its true 2,068):
  //   1. `bs.chunks === 0` COUNTED AS SETTLED. At boot and on the first frame
  //      after a warp the building map is literally empty, which is the one
  //      moment the ratio is guaranteed to be wrong — and it was the moment
  //      the hold waved through. `chunks > 0` is now REQUIRED.
  //   2. `movedSq >= 900²` bypassed the hold unconditionally. 900 m is four
  //      seconds of cruise, so for the whole of any real flight the hold did
  //      not exist. The bypass is gone; a bounded TIME hold (maxHoldSec) with
  //      a PROVISIONAL, grown-in placement replaces it, so a long flight can
  //      still never freeze the layer.
  //   3. THE DENOMINATOR HAD NO TEST AT ALL. regK is building-ring columns
  //      over veg-ring residential area, and only the numerator's ring was
  //      ever asked whether it had arrived. A settled building ring over a
  //      half-streamed veg ring reads as "lots of buildings, little
  //      residential land" — a mapped town — and suppresses a real suburb.
  // `!bs` (no building engine at all: this layer only exists inside
  // SatBuildingLayer, so it is unreachable in practice) keeps the R20 escape.
  const bs = runtime.satBuildings?.stats;
  const vs = runtime.satVeg?.stats;
  let settled;
  if (C) {
    settled =
      !bs ||
      (bs.chunks > 0 &&
        resolvedFrac(bs, bs.queued + bs.building + bs.draping) >= C.minSettledFrac &&
        !!vs &&
        vs.chunks > 0 &&
        resolvedFrac(vs, vs.queued + vs.building + vs.sampling) >= C.vegSettledFrac);
  } else {
    settled =
      !bs ||
      bs.chunks === 0 ||
      bs.queued + bs.building + bs.draping === 0 ||
      bs.ready + bs.empty >= bs.chunks * 0.75;
  }
  st.settled = settled;
  const movedSq = (px - st.atX) ** 2 + (pz - st.atZ) ** 2;
  if (!C) {
    if (st.altK > 0.001 && !settled && movedSq < 900 * 900) return;
  } else {
    if (st.warped) {
      st.warped = false;
      st.floorA = null;
      st.floorB = null;
      st.bucketX = px;
      st.bucketZ = pz;
      st.regKUsed = null;
      st.probeRegK = null; // the agreement test restarts at the destination
      st.trustSince = -1;
      st.confirmed = false;
      st.zeroPasses = 0;
      st.holdSince = -1;
      st.placed = 0;
      st.prevN = 0;
      mesh.count = 0;
      mesh.visible = false;
    }
    st.atX = px;
    st.atZ = pz;
    st.held = false;
    st.provisional = false;
    st.stale = false;
    if (st.altK > 0.001 && !settled) {
      if (st.holdSince < 0) st.holdSince = now;
      // Held while the evidence is still arriving — but only until maxHoldSec,
      // and only until a settled pass has once placed HERE. After a confirmed
      // placement the ring being partly in flight is ordinary cruise, not
      // ignorance, and the filtered regK below is grounded in settled readings.
      if (!st.confirmed && now - st.holdSince < C.maxHoldSec) {
        st.held = true;
        return;
      }
      // PAST THE TIMEOUT the ring is declared as resolved as it is going to
      // get, and this pass counts as evidence (below) — otherwise a ring that
      // can never settle (B's resident error records under a sustained
      // upstream outage inflate the denominator without ever resolving) would
      // leave the layer grown-in at growScale forever, waiting for a settled
      // pass that is not coming. So the grow-in lasts exactly one pass: this
      // one places small, sets `confirmed`, and the next places at full size.
      st.stale = !st.confirmed;
      st.provisional = st.stale;
    } else {
      st.holdSince = -1;
    }
    // The static skip. A parked aircraft over a settled ring re-derives an
    // IDENTICAL field and re-uploads it every 2 s; the signature is everything
    // this pass reads. Gated on `settled` so a stalled hold still times out.
    const U = SURFACE_CALM.uploads;
    const sig =
      `${bs?.chunks ?? -1}|${bs?.ready ?? -1}|${bs?.empty ?? -1}|${bs?.columns ?? -1}|` +
      `${vs?.chunks ?? -1}|${vs?.ready ?? -1}|${vs?.parcelPts ?? -1}|${st.altK.toFixed(3)}`;
    // …but NEVER while the first measurement at this locality is still
    // pending. The skip's premise is "nothing changed, so there is nothing to
    // do"; a pending trust hold is work that is owed regardless, and at a
    // pinned pose the signature stabilises immediately — which deadlocked the
    // hold into a permanent one the first time this was written.
    const undecided = st.floorA == null && st.floorB == null;
    if (!undecided && settled && sig === st.sig && movedSq < U.staticSkipM ** 2) return;
    st.sig = sig;
    // Past every early return: this pass really does measure, so its
    // predecessor's numbers go now.
    clearMeasurements(st);
  }

  if (st.altK > 0.001 && pool > 0) {
    if (!C) {
      st.atX = px;
      st.atZ = pz;
    }
    buildRealGrids(runtime, px, pz);
    st.realCols = _grid.cols;
    // Pool origin rounded to 1 km (the canopy recipe): instanceMatrix is
    // float32 and absolute mercator XZ near a city is ~8.2e6, where the ulp is
    // 1.0 m — every house would snap to a metre lattice.
    const ox = Math.round(px / 1000) * 1000;
    const oz = Math.round(pz / 1000) * 1000;
    // Remembered so a delete that is not yet confirmed can put the previous
    // field back exactly where it was standing: the matrices are RELATIVE to
    // this origin, so leaving a moved origin behind would slide the whole
    // suburb sideways for a pass.
    const keepOx = mesh.position.x;
    const keepOz = mesh.position.z;
    mesh.position.set(ox, 0, oz);

    const rangeSq = P.rangeM ** 2;
    const target = P.antiDup.targetPerKm2;
    const rows = Math.ceil(P.perAnchor / P.cols);
    let scalarSum = 0;
    let densSum = 0;

    // --- ANTI-DUPLICATION TERM 1: REGIONAL -----------------------------------
    // "Is this town already mapped?" Counting pass first, because the answer
    // has to be known before the first house is placed. Residential area is
    // recovered from the anchor count (the worker emits one per
    // anchors.areaPerM2 of residential polygon), so no second worker channel is
    // needed and the two numbers cannot drift apart.
    let inRange = 0;
    for (const chunk of engine.nearest(px, pz)) {
      const par = chunk.parcel;
      if (!par) continue;
      for (let i = 0; i < par.length; i += 2) {
        const wx = chunk.cx + par[i];
        const wz = chunk.cz + par[i + 1];
        if ((wx - px) ** 2 + (wz - pz) ** 2 <= rangeSq) inRange += 1;
      }
    }
    const resKm2 = (inRange * P.anchors.areaPerM2) / (mercK * mercK * 1e6);
    st.regionalDens = resKm2 > 0 ? _grid.cols / resKm2 : 0;
    const regKRaw = Math.min(
      1,
      Math.max(0, 1 - st.regionalDens / P.antiDup.regionalPerKm2Res)
    );
    st.regKRaw = regKRaw;
    let regK = regKRaw;

    // === THE COLLISION-INDEX TRUST GATE (R21 C, P5 second cut) ================
    //
    // WHAT THE FIRST CUT MISSED, and how it was caught: E CERT's
    // verify-stability boots satellite AT Powell as the fourth page of a loaded
    // run and samples this layer at 100 ms from reveal. It measured 290 homes
    // over a town R20 froze at exactly zero — reproduced here on this branch,
    // three times. The settle gate above was asking the BUILDING RING whether
    // it had resolved; but regK does not divide by the ring's state, it divides
    // by `queryColumns`, and at boot the ring passes "resolved" while it is
    // still SMALL — a handful of chunks, all of them legitimately done, is
    // (ready + empty) / chunks === 1. An index holding ~0 columns over a mapped
    // town is indistinguishable from an unmapped one, so regK computes as if
    // this were Melton and the town gets carpeted.
    //
    // THE ASYMMETRY THAT MAKES THIS FIXABLE: regK ≈ 1 ("nothing is built here")
    // is the verdict that places thousands of houses, and regK ≈ 0 is the safe
    // one. A dangerous verdict must be CORROBORATED; a safe one needs nothing.
    // Two corroborations, both applied ONLY to the first measurement at a
    // locality (`floorA`/`floorB` both empty) — in steady state this whole
    // block is skipped, because the rolling minimum already ignores a stale
    // index: a stale index reads HIGH, and a high reading is never taken.
    //
    //   (1) INDEX vs LANDUSE. The veg ring says how much residential land is
    //       under us (one anchor per anchors.areaPerM2). Measured across every
    //       scene this layer is certified on, real columns per anchor are:
    //         Powell 14.8 · Lone Pine 14.3 · Blagnac 14.2 · Plain City 5.1 ·
    //         MELTON 2.6  ← the least-mapped suburb on earth, and still 1,170
    //       columns inside the disc. `cols ≈ 0` while anchors > 0 is therefore
    //       not a place, it is an unbuilt index. minColsPerAnchor sits 5x below
    //       the worst real scene, so Melton can never trip it.
    //   (2) AGREEMENT. A HALF-built index is not caught by (1), so the first
    //       measurement must also be repeated: two consecutive trustworthy
    //       passes agreeing within regKDeadband. A partial index reads high
    //       then lower, which disagrees, and the pass waits one more cadence.
    //
    // Both are HOLDS, not suppressions, and both are bounded by the same
    // maxHoldSec as every other hold: in a hypothetical genuinely-zero-column
    // suburb the layer places 8 s late instead of never. The R21 §7 lesson is
    // in one line: a settle gate must test the quantity the arithmetic
    // actually divides by, not a ring-state proxy for it.
    if (C && !st.stale && st.floorA == null && st.floorB == null) {
      const indexFresh = inRange === 0 || _grid.cols >= inRange * C.minColsPerAnchor;
      const agrees =
        st.probeRegK != null && Math.abs(regKRaw - st.probeRegK) < C.regKDeadband;
      st.probeRegK = regKRaw;
      if (!indexFresh || !agrees) {
        // Its OWN timer: `holdSince` belongs to the ring-readiness hold and is
        // cleared by the preamble on every pass where the ring is settled —
        // which is every pass here, so sharing it meant this timeout could
        // never accumulate and the hold was unbounded (caught in the first
        // run of this cut: Melton held forever at placed 0).
        if (st.trustSince < 0) st.trustSince = now;
        if (now - st.trustSince < C.maxHoldSec) {
          st.held = true;
          st.indexStale = !indexFresh;
          // A held pass reports the world rather than its own idleness (R19
          // §7). Set HERE, on the return path only: the placement loop below
          // accumulates st.anchors itself, and doing both double-counted every
          // anchor — which reads as a harness failure ("suppressed 75 / 150")
          // in a pass that was actually correct.
          st.anchors = inRange;
          mesh.position.set(keepOx, 0, keepOz);
          return;
        }
        st.stale = true; // the 8 s bound is absolute; place on what we have
      }
      st.trustSince = -1;
      st.indexStale = false;
    }

    if (C) {
      // THE ROLLING MINIMUM, then a DEADBAND — two different jobs.
      //
      // Only SETTLED measurements are evidence: an unsettled ring reads biased
      // high by construction (buildings only ever arrive), so an unsettled
      // pass contributes nothing and simply re-uses what is already known.
      // The only pass that ever runs on a raw reading is the provisional first
      // placement of an unconfirmed arrival — which is exactly why that one is
      // grown in at growScale instead of shown at full size.
      //
      // THIS IS A MINIMUM, NOT AN AVERAGE, AND IT MUST NOT BE "SIMPLIFIED"
      // BACK. Measured at Lone Pine, pinned, 15 s: the building ring
      // heal-evicts and `queryColumns` cycles 987 → 693 → 357 → 696 → 987
      // columns, so the RAW regK flaps 0 ↔ 0.482 indefinitely. An EMA of that
      // converges to its mean (0.20) and places 55 procedural homes over a
      // town that is already fully mapped — verify-parcel-homes gate (F) red,
      // reproduced. The minimum is the honest estimator because the underlying
      // quantity is monotone: real buildings only ever ARRIVE, so a lower regK
      // is always the better-informed reading and a higher one is only ever
      // lost evidence. (R21 B's heal cap reduces the flapping at its source;
      // this filter deliberately does not depend on that — defence in depth,
      // not coupling.)
      //
      // Evidence is kept in two buckets that roll over every relocateM of
      // TRAVEL, so what a place taught us expires by distance rather than by
      // time: parked over one town it never expires at all (which is what
      // makes a suppressed town STAY suppressed through that cycling), and
      // flying into unmapped land it clears within one to two buckets.
      const travelSq = (px - st.bucketX) ** 2 + (pz - st.bucketZ) ** 2;
      if (travelSq > C.relocateM ** 2) {
        st.floorB = st.floorA;
        st.floorA = null;
        st.bucketX = px;
        st.bucketZ = pz;
      }
      if (settled || st.stale) {
        st.floorA = st.floorA == null ? regKRaw : Math.min(st.floorA, regKRaw);
      }
      const a = st.floorA;
      const b = st.floorB;
      const filtered = a == null ? (b == null ? regKRaw : b) : b == null ? a : Math.min(a, b);
      // The deadband is what stops the FLICKER. `want` is a rounded count of
      // houses per anchor, so an 0.01 wobble in regK flips a scatter of
      // anchors by ±1 house every 2 s — a field that shimmers at the edges
      // forever. Density therefore moves in steps of at least regKDeadband,
      // while POSITION keeps updating every pass (the aircraft is moving even
      // when the density answer has not changed).
      if (st.regKUsed == null || Math.abs(filtered - st.regKUsed) >= C.regKDeadband) {
        st.regKUsed = filtered;
      }
      // …with one exception: the SUPPRESSION verdict (a town that is already
      // fully mapped) has to be reachable EXACTLY, and a deadband alone would
      // park it a fraction above zero — a residual 0.07 is still one
      // procedural house per anchor standing over a town A SPRAWL already
      // finished, which is precisely what the regional term exists to
      // prevent. At or below the pass's own suppression epsilon it snaps.
      if (st.regKUsed > 0 && filtered <= 0.02) st.regKUsed = 0;
      regK = st.regKUsed;
    }
    st.regK = regK;

    for (const chunk of engine.nearest(px, pz)) {
      if (n >= pool) break;
      const par = chunk.parcel;
      if (!par) continue;
      for (let i = 0; i < par.length; i += 2) {
        if (n >= pool) break;
        const lx = par[i];
        const lz = par[i + 1];
        const wx = chunk.cx + lx;
        const wz = chunk.cz + lz;
        const d2 = (wx - px) ** 2 + (wz - pz) ** 2;
        if (d2 > rangeSq) continue;
        const d = Math.sqrt(d2);
        st.anchors += 1;
        // --- TERM 2: LOCAL — "is this BLOCK already built?" ------------------
        // Multiplied by the regional term, so a mapped town suppresses
        // everywhere and an unmapped town still respects its mapped blocks.
        const dens = realDensityAt(wx, wz, mercK);
        const deficit = (1 - dens / target) * regK;
        densSum += dens;
        if (dens > st.maxDens) st.maxDens = dens;
        scalarSum += Math.max(0, deficit);
        if (deficit <= 0.02) {
          st.suppressed += 1;
          continue;
        }
        // …times the distance thinning, so the pool is never cut as a hard
        // circle that pops when the player moves.
        const keep =
          1 - (1 - P.thin.farKeep) * smoothstep(P.thin.nearM, P.thin.farM, d);
        const want = Math.min(P.perAnchor, Math.round(P.perAnchor * deficit * keep));
        if (want <= 0) {
          st.suppressed += 1;
          continue;
        }
        // Distance up-scale, resolved HERE, never per frame — a 2 km house is
        // a few pixels and needs to stay legible as the field thins — times
        // the ALTITUDE fade, which is scale rather than colour because the
        // material is opaque (darkening an instance paints a black house
        // instead of removing one — the SatVegLayer rule).
        const ft = smoothstep(P.farScale.startM, P.farScale.endM, d);
        // Round 21 (C, P5): a PROVISIONAL field — one placed past maxHoldSec
        // on a ring that has not resolved — is grown in at growScale and
        // confirmed to full size by the next settled pass. It is a hedge on
        // evidence that is still arriving, so it should not arrive at full
        // size and then be deleted; a small field growing is a world loading,
        // a full field vanishing is a bug. (Scale is uniform, so the height
        // band verify-suburbia (G) freezes only ever gets SMALLER.)
        // R22 (B): with the settle flag on, the grow factor moves OUT of the
        // baked matrix and into the per-frame envelope, which is the only way
        // a 0.55 → 1.0 step can become a continuous ease without re-deriving
        // 2,000 houses every frame. Same two endpoints, same trigger; flag off
        // this is the R21 expression character for character.
        const growK = C && st.provisional && !settleOn() ? C.growScale : 1;
        const fscale = (1 + (P.farScale.mul - 1) * ft) * st.altK * growK;
        // One yaw for the whole cluster: every house on a street shares it.
        const yaw = hash(lx * 0.731 - lz * 1.117) * Math.PI * 2;
        const cs = Math.cos(yaw);
        const sn = Math.sin(yaw);
        for (let k = 0; k < want && n < pool; k++) {
          const cx = k % P.cols;
          const cz = (k / P.cols) | 0;
          const jx = (hash(lx * 5.13 - lz * 2.71 + k * 17.3) - 0.5) * 2 * P.jitter;
          const jz = (hash(lz * 3.71 - lx * 1.19 + k * 41.7) - 0.5) * 2 * P.jitter;
          const bx = (cx - (P.cols - 1) / 2 + jx) * P.lotM * mercK;
          const bz = (cz - (rows - 1) / 2 + jz) * P.rowM * mercK;
          const offX = bx * cs - bz * sn;
          const offZ = bx * sn + bz * cs;
          const hx = wx + offX;
          const hz = wz + offZ;
          // Never inside a real streamed footprint. The worker's occupancy
          // grid already kept the ANCHOR clear of the tile's building layer;
          // this keeps each individual HOUSE clear of what actually streamed,
          // which is the set the player can see and collide with.
          if (occupiedAt(hx, hz)) continue;
          const hh = hash(lx * 9.17 + lz * 4.31 + k * 7.77);
          const hf = hash(lz * 6.13 - lx * 8.91 + k * 3.19);
          const ht = P.hM[0] + hh * (P.hM[1] - P.hM[0]);
          const fl =
            (P.footprintM[0] + hf * (P.footprintM[1] - P.footprintM[0])) * mercK;
          const fs = fl * (0.62 + hh * 0.24);
          const gy = engine.groundAtLocal(chunk, lx + offX, lz + offZ);
          _dummy.position.set(hx - ox, gy, hz - oz);
          _dummy.scale.set(fl * fscale, ht * fscale, fs * fscale);
          // Face the street: the cluster yaw plus a quarter turn for the odd
          // house, so a block is aligned without being a stamped row.
          _dummy.rotation.set(0, yaw + (hf > 0.86 ? Math.PI / 2 : 0), 0);
          _dummy.updateMatrix();
          mesh.setMatrixAt(n, _dummy.matrix);
          const jit = 1 + (hash(lx * 11.31 - lz * 5.17 + k * 2.13) - 0.5) * 2 * P.lumaJitter;
          _col.copy(PALETTE[(hh * PALETTE.length) | 0]).multiplyScalar(jit);
          mesh.setColorAt(n, _col);
          const r2 = _dummy.position.lengthSq();
          if (r2 > maxR2) maxR2 = r2;
          if (ht * fscale > maxScale) maxScale = ht * fscale;
          if (d > maxD) maxD = d;
          n += 1;
        }
      }
    }
    st.meanScalar = st.anchors > 0 ? scalarSum / st.anchors : 0;
    st.meanDens = st.anchors > 0 ? densSum / st.anchors : 0;

    // THE DELETE CONFIRM. Deleting a placed field is the loud direction of
    // this layer's error — a suburb that is there and then is not is the
    // symptom the user reported — so a zero verdict has to be voted for twice
    // by SETTLED passes before it lands. An unsettled pass never gets a vote
    // at all. Nothing was written to the buffer this pass (n === 0 means the
    // placement loop wrote no matrix), so keeping the previous field is
    // literally leaving it alone; only the pool ORIGIN has to be put back.
    if (C && n === 0 && st.placed > 0) {
      st.zeroPasses = settled || st.stale ? st.zeroPasses + 1 : st.zeroPasses;
      if (st.zeroPasses < C.confirmPasses) {
        mesh.position.set(keepOx, 0, keepOz);
        return false;
      }
      // R22 (B): the verdict has landed. Spend deleteFadeSec on it instead of
      // one frame — the field stays exactly as it is, the frame loop's
      // envelope shrinks it, and the pass that finds the envelope at 0 parks
      // the draw. The DECISION above is untouched.
      if (settleOn() && !st.pendingDelete) {
        st.pendingDelete = true;
        st.deleteFrom = now;
        mesh.position.set(keepOx, 0, keepOz);
        return false;
      }
    } else if (C) {
      st.zeroPasses = 0;
      // A field that came back cancels a fade in progress (the envelope's next
      // step finds pendingDelete false and the buffer freshly written).
      if (st.pendingDelete && n > 0) {
        st.pendingDelete = false;
        st.deleteFrom = -1;
      }
    }
    if (C && (settled || st.stale)) st.confirmed = true;
  }

  // Park the tail at zero scale AND clamp count (the SatVegLayer belt+braces).
  _dummy.position.set(0, 0, 0);
  _dummy.rotation.set(0, 0, 0);
  _dummy.scale.setScalar(0);
  _dummy.updateMatrix();
  for (let i = n; i < mesh.instanceMatrix.count; i++) mesh.setMatrixAt(i, _dummy.matrix);
  mesh.count = n;
  // THE OWENS INVARIANT: nothing placed = no draw.
  mesh.visible = n > 0;
  // Round 21 (C, S6): upload only what can have changed (see rangeUpload).
  const touched = Math.max(n, st.prevN | 0);
  rangeUpload(mesh.instanceMatrix, touched * 16);
  if (mesh.instanceColor) rangeUpload(mesh.instanceColor, touched * 3);
  st.prevN = n;
  mesh.boundingSphere.center.set(0, 0, 0);
  mesh.boundingSphere.radius = Math.sqrt(maxR2) + maxScale + maxD * maxD * MAX_BEND_K + 50;
  st.placed = n;
  // R22 (B): TRUE ⇒ this pass rewrote the live matrices at full scale, so the
  // caller's scale envelope must restart from 1. Every early return above is
  // falsy, which is exactly the "the buffer was left alone" case.
  return true;
}
