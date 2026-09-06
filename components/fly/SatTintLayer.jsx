'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
  MultiplyBlending,
  Sphere,
  Vector3,
} from 'three';
import { GLOBE, SAT_TINT, SAT_VEG, SURFACE_CALM } from '@/lib/fly/fly-constants';
import { applyBendFade, offsetUnits } from '@/lib/fly/toy-world/world-bend';

// Worst-case bend drop pad for the CPU bounding sphere (the SatVegLayer
// recipe): the GPU pushes far geometry DOWN by d²k and the CPU bound cannot
// see it. k is LARGEST at low altitude, which is the only altitude tint exists
// at.
const MAX_BEND_K = 1 / (2 * GLOBE.bendRadiusM.satellite);

/**
 * Round 21 (C "SURFACE", P8) — THE POLYGON OFFSET SIGN UNDER REVERSED DEPTH.
 *
 * FlyCanvas runs the renderer with `reversedDepthBuffer: true` (near = 1, far
 * = 0), and three r185's WebGLState.setPolygonOffset negates ONLY THE FACTOR
 * when the reversed buffer is active — the units term is passed through
 * verbatim. So this material's authored (-2, -2) reaches GL as (+2, -2): the
 * slope-scaled term pulls the drape toward the eye while the constant term
 * pushes it away. The two disagree by a slope-dependent amount, which is
 * exactly the shape of the defect — the landcover tint drops out on ground
 * that is tilted away from the camera and holds on flat ground.
 *
 * The fix authors the units with the opposite sign when the reversed buffer is
 * really active, so BOTH terms reach GL positive and both mean "toward the
 * eye". Detected off the live renderer (the extension can be missing, in which
 * case three silently runs a normal depth buffer and the R20 signs are right).
 */
// R24 C (recon T11): the implementation moved to world-bend.js so there is one
// polygonOffset sign rule in the tree; behaviour here is unchanged (the same
// test on the same live capability, with the same SURFACE_CALM gate).

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
 * Round 19 (C "GROUNDTRUTH") — SATELLITE landcover albedo tint.
 *
 * THE PROBLEM (field study P7): rural and suburban ground is one undifferentiated
 * Esri wash. A corn field, a wood lot, a golf course and a mown park all arrive
 * as the same mid-green-brown mush at 600 m, and the capture-date quilt makes
 * neighbouring parcels of the SAME class read as different ones. The imagery is
 * the truth and must stay the truth — so this does not paint the ground, it
 * GRADES it: a 10% multiply toward the class's own tone, which pushes farmland
 * warm-ochre, woodland deep-green and grass toward the yellow-green a mown
 * field actually is, while every road, roof, pond and driveway underneath keeps
 * its own value.
 *
 * FOUR budget decisions, in the order they matter:
 *   1. ONE pooled merged mesh for the whole world = +1 draw, exactly like the
 *      canopy instancer next door. Chunks do NOT get their own meshes.
 *   2. `visible = false` below SAT_TINT.minPolys ⇒ Owens Valley and every
 *      other sparse scene pay ZERO (the shed lever the §5 Owens arithmetic
 *      names). three skips a 0-length draw range anyway; `visible` states it
 *      as something a harness can read back.
 *   3. The geometry is allocated ONCE at mount (a BufferGeometry cannot grow)
 *      and refilled in place on the veg placement cadence — no per-frame work,
 *      no per-cadence allocation.
 *   4. It reuses the EXISTING 'world-bend-fade-r8' base variant verbatim: no
 *      GLSL change, no cache-key move. The polys are flat y=0 tile-local rings
 *      (the satWater layout), so a per-VERTEX bend is exactly right — they
 *      must follow the curved ground the way the tiles do, not ride rigid on
 *      an anchor.
 *
 * WHY MULTIPLY, AND WHY THE ALPHA IS ON THE CPU: three's MultiplyBlending is
 * `result = src × dst` with no alpha channel of its own, so the α-lerp is baked
 * into the vertex colour here — mult = 1 + α(c − 1). Consequence worth having:
 * SAT_TINT.alpha is live-tunable without a re-stream, because every multiplier
 * is re-derived from the worker's raw `col` on each cadence pass.
 *
 * DEPTH: the drape sits SAT_TINT.liftM over the tile with depthWrite off and a
 * negative polygonOffset — it must lose the depth test to anything standing on
 * the ground (a tree, a building, the player) and win it against the tile it is
 * grading. renderOrder 2 puts it first in the transparent pass, so the additive
 * road ribbons (3) and beacons (4) still add on top of tinted ground.
 */
export function SatTintLayer({ engine, flight }) {
  const gl = useThree((s) => s.gl);
  const meshRef = useRef(null);
  const stateRef = useRef({
    t: -Infinity,
    first: true, // round 21: one-time cadence phase nudge (S6)
    sig: '',
    atX: Infinity,
    atZ: Infinity,
    prevV: 0,
    prevI: 0,
    polys: 0,
    verts: 0,
    indices: 0,
    chunks: 0,
  });

  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const pos = new BufferAttribute(new Float32Array(SAT_TINT.maxVerts * 3), 3);
    const col = new BufferAttribute(new Float32Array(SAT_TINT.maxVerts * 3), 3);
    pos.setUsage(DynamicDrawUsage);
    col.setUsage(DynamicDrawUsage);
    g.setAttribute('position', pos);
    g.setAttribute('color', col);
    const idx = new BufferAttribute(new Uint32Array(SAT_TINT.maxIndex), 1);
    idx.setUsage(DynamicDrawUsage);
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    // The pool spans the ring, so three's computed bound would be a lie the
    // moment the fill changes; the cadence pass writes a real one (padded for
    // the bend drop) and culling stays enabled AND honest.
    g.boundingSphere = new Sphere(new Vector3(), 1);
    return g;
  }, []);

  const material = useMemo(() => {
    const m = new MeshBasicMaterial({
      vertexColors: true,
      blending: MultiplyBlending,
      transparent: true, // multiply must render in the transparent pass
      // three r185 implements MultiplyBlending ONLY for premultiplied alpha —
      // `blendFuncSeparate(ZERO, SRC_COLOR, ZERO, SRC_ALPHA)` — and without
      // this flag it logs an error and leaves whatever blend func the PREVIOUS
      // material set, which is both nondeterministic and (measured) a tint that
      // barely registers in an A/B. Our fragment is a pure multiplier at
      // alpha 1, which is already premultiplied by definition.
      premultipliedAlpha: true,
      opacity: 1,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      // Round 21 (C, P8): authored -2, sign-flipped to +2 when the renderer is
      // really running a reversed depth buffer (three flips only the factor).
      polygonOffsetUnits: offsetUnits(gl, -2),
    });
    applyBendFade(m); // EXISTING variant, unmodified — no new cache key
    return m;
  }, [gl]);

  const mesh = useMemo(() => {
    const m = new Mesh(geometry, material);
    m.frustumCulled = true;
    m.renderOrder = 2;
    m.visible = false; // parked until the first fill
    m.name = 'sat-tint';
    return m;
  }, [geometry, material]);

  useEffect(() => {
    meshRef.current = mesh;
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [mesh, geometry, material]);

  // Priority -44: after the canopy placement at -45, so a chunk that just
  // became ready is tinted on the same cadence tick its trees appear on.
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const st = stateRef.current;
    if (t - st.t < SAT_VEG.placeCadenceSec) return;
    // Round 21 (C, S6): one-time phase nudge (first pass stays immediate) +
    // the static skip. See SatVegLayer for the reasoning on both.
    const U = SURFACE_CALM.enabled ? SURFACE_CALM.uploads : null;
    st.t = st.first && U ? t + U.stagger[1] * SAT_VEG.placeCadenceSec : t;
    st.first = false;
    const sg = engine.stats;
    const sig = U ? `${sg.chunks}|${sg.ready}|${sg.empty}|${sg.tintChunks}|${sg.tintVerts}` : '';
    const moved2 = (flight.pos.x - st.atX) ** 2 + (flight.pos.z - st.atZ) ** 2;
    if (!U || sig !== st.sig || moved2 >= U.staticSkipM ** 2) {
      st.sig = sig;
      st.atX = flight.pos.x;
      st.atZ = flight.pos.z;
      fillTint(mesh, engine, flight, st);
    }
    if (process.env.NODE_ENV === 'development' && window.__flyStats) {
      window.__flyStats.satTint = {
        polys: st.polys,
        verts: st.verts,
        chunks: st.chunks,
        visible: mesh.visible,
      };
      if (window.__satVeg) window.__satVeg.tintMesh = mesh; // harness A/B flip
    }
  }, -44);

  return <primitive object={mesh} />;
}

/**
 * ONE cadence pass: walk the ready chunks nearest-first, drape each tint poly
 * on that chunk's bilinear grid, write it into the pooled buffers. Everything
 * the look depends on — the α-lerp, the lift, the draw range, the bound —
 * resolves HERE, so nothing runs per frame.
 */
function fillTint(mesh, engine, flight, st) {
  const S = SAT_TINT;
  const px = flight.pos.x;
  const pz = flight.pos.z;
  const geo = mesh.geometry;
  const posA = geo.attributes.position.array;
  const colA = geo.attributes.color.array;
  const idxA = geo.index.array;
  let nV = 0;
  let nI = 0;
  let nChunk = 0;
  let maxR2 = 0;
  let maxD = 0;

  // Pool origin rounded to 1 km, exactly like the canopy pool: instance/vertex
  // positions are float32 and absolute mercator XZ near a city is ~8.2e6, where
  // the float32 ulp is 1.0 m — every parcel edge would snap to a metre lattice.
  const ox = Math.round(px / 1000) * 1000;
  const oz = Math.round(pz / 1000) * 1000;
  mesh.position.set(ox, 0, oz);

  const a = S.alpha;
  for (const chunk of engine.nearest(px, pz)) {
    const tint = chunk.tint;
    if (!tint) continue;
    const vN = tint.pos.length / 3;
    const iN = tint.idx.length;
    // A partial parcel is a torn parcel, so a chunk lands whole or not at all;
    // chunks arrive nearest-first, so the ones that drop are the far ones.
    if (nV + vN > S.maxVerts || nI + iN > S.maxIndex) break;
    const base = nV;
    for (let i = 0; i < vN; i++) {
      const lx = tint.pos[i * 3];
      const lz = tint.pos[i * 3 + 2];
      const wx = chunk.cx + lx;
      const wz = chunk.cz + lz;
      const o = (base + i) * 3;
      posA[o] = wx - ox;
      posA[o + 1] = engine.groundAtLocal(chunk, lx, lz) + S.liftM;
      posA[o + 2] = wz - oz;
      // mult = 1 + α(c − 1): a MULTIPLIER, so the α lives on the CPU and the
      // GPU just does `src × dst`. c is the worker's raw sRGB triple, used as
      // a ratio (see the header) — deliberately not linearised: at α 0.1 the
      // difference is under half a percent and the tint is a wash, not a paint.
      colA[o] = 1 + a * (tint.col[i * 3] - 1);
      colA[o + 1] = 1 + a * (tint.col[i * 3 + 1] - 1);
      colA[o + 2] = 1 + a * (tint.col[i * 3 + 2] - 1);
      const r2 = (wx - ox) ** 2 + (wz - oz) ** 2;
      if (r2 > maxR2) maxR2 = r2;
    }
    for (let i = 0; i < iN; i++) idxA[nI + i] = base + tint.idx[i];
    nV += vN;
    nI += iN;
    nChunk += 1;
    const d = Math.hypot(chunk.cx - px, chunk.cz - pz);
    if (d > maxD) maxD = d;
  }

  geo.setDrawRange(0, nI);
  // Round 21 (C, S6): upload only what can have changed — this pass's fill
  // plus the tail the previous one left behind (which the draw range already
  // excludes, but which a later longer fill would otherwise read stale).
  const tV = Math.max(nV, st.prevV | 0);
  const tI = Math.max(nI, st.prevI | 0);
  rangeUpload(geo.attributes.position, tV * 3);
  rangeUpload(geo.attributes.color, tV * 3);
  rangeUpload(geo.index, tI);
  st.prevV = nV;
  st.prevI = nI;
  geo.boundingSphere.center.set(0, 0, 0);
  geo.boundingSphere.radius = Math.sqrt(maxR2) + maxD * maxD * MAX_BEND_K + 50;
  // THE OWENS LEVER: below minPolys the pooled mesh is invisible, so a sparse
  // scene pays nothing at all. Counted in TRIANGLES, which is what the poly
  // budget actually buys (the worker's per-tile cap is in polygons, but a
  // consumer can only see their triangles).
  const tris = nI / 3;
  mesh.visible = tris >= S.minPolys;
  st.verts = nV;
  st.indices = nI;
  st.polys = tris;
  st.chunks = nChunk;
}
