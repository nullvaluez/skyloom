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
  Vector2,
  Vector3,
} from 'three';
import { BEND_LEAD, GLOBE, SAT_TINT, SAT_VEG, SETTLE_CALM, SURFACE_CALM } from '@/lib/fly/fly-constants';
import { applyBendFade, offsetUnits } from '@/lib/fly/toy-world/world-bend';
import { arrivalEpoch, birthK, makeBirth, notePopin } from '@/lib/fly/settle';
import { satelliteVisualsOn } from '@/lib/fly/satellite-visuals';
import { immersiveOn } from '@/lib/fly/immersive';
// R25 A (GROUND_DETAIL_R25) — the low-AGL drape LIFT and, in one line of this
// layer's own lifecycle, the publish of the SatVegEngine that SatGroundDetail
// Layer's scrub stands on (the B/SatClutterLayer precedent: the layer that
// already HAS the data publishes it, rather than a second component contract).
import { publishGroundSource, tintAlphaFor } from '@/lib/fly/ground-detail';

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
    birthK: 1, // R22 (B): the α multiplier the current fill was written with
  });
  // R22 (B SETTLE) — THE ONE LAYER THAT CANNOT FADE ON THE GPU. Multiply
  // blending has no alpha channel of its own (`result = src × dst`), so the
  // α-lerp is baked into the vertex COLOUR on the CPU (mult = 1 + α(c − 1)) —
  // and dropping material.opacity would fade this drape to BLACK, not to
  // nothing, because three's premultiplied path multiplies rgb by alpha and a
  // multiply of 0 is a hole. The honest fade is therefore α itself, re-derived
  // by the existing fill; the birth just runs that fill on a short step for
  // 600 ms. Measured worst case is ~4.5 k verts, so four extra fills cost less
  // than one ordinary cadence pass of the canopy next door — and a 10 % wash
  // stepped in four increments is indistinguishable from a continuous ramp.
  const birthRef = useRef(makeBirth());

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
    if (immersiveOn('materials')) {
      const previous=m.onBeforeCompile,key=m.customProgramCacheKey();
      const phase={value:new Vector2()};m.userData.groundDetailPhase=phase;
      m.onBeforeCompile=(shader,renderer)=>{
        previous(shader,renderer);shader.uniforms.uGroundPhase=phase;
        shader.vertexShader=shader.vertexShader.replace('#include <common>', '#include <common>\nuniform vec2 uGroundPhase;\nvarying vec2 vGroundDetail;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundDetail=position.xz/8.+uGroundPhase;');
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vGroundDetail;')
          .replace('#include <color_fragment>', `#include <color_fragment>
vec2 grainPhase=vGroundDetail*6.2831853;
float grain=.5+.25*sin(grainPhase.x+sin(grainPhase.y))+.25*sin(grainPhase.y*2.+sin(grainPhase.x));
float resolved=1.-smoothstep(.12,.65,max(fwidth(vGroundDetail.x),fwidth(vGroundDetail.y)));
// Only existing landcover polygons participate; the birth fade remains an identity.
float landMask=clamp((1.-dot(diffuseColor.rgb,vec3(.333333)))*8.,0.,1.);
diffuseColor.rgb*=1.-grain*.065*resolved*landMask;`);
      };
      m.customProgramCacheKey=()=>`${key}|immersive-landcover-v1`;
    }
    return m;
  }, [gl]);

  const mesh = useMemo(() => {
    const m = new Mesh(geometry, material);
    m.frustumCulled = true;
    // r185 reverses explicit ordering with reverse-Z. Grade after imagery,
    // then water (-3) and street lighting (-4); retain the legacy comparison.
    m.renderOrder = satelliteVisualsOn('ground') ? -2 : 2;
    m.visible = false; // parked until the first fill
    m.name = 'sat-tint';
    return m;
  }, [geometry, material]);

  useEffect(() => {
    meshRef.current = mesh;
    // R25 A: one line of publish. This layer is the ONLY place in the tree that
    // holds the streamer carrying BOTH the landcover triangles and a per-chunk
    // bilinear DEM grid, which is exactly what the scrub layer needs to stand
    // on the same ground this drape is painted on. Cleared on unmount, so a
    // style flip leaves the scrub with `groundSource() === null` and it parks.
    publishGroundSource(engine);
    return () => {
      publishGroundSource(null);
      geometry.dispose();
      material.dispose();
    };
  }, [mesh, geometry, material, engine]);

  // Priority -44: after the canopy placement at -45, so a chunk that just
  // became ready is tinted on the same cadence tick its trees appear on.
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const st = stateRef.current;
    // R22 (B): while the birth is running the fill cadence shortens to
    // births.tintStepSec; settled, it is the R21 veg cadence exactly.
    const k = birthK(
      birthRef.current,
      t,
      engine.stats.tintVerts > 0,
      arrivalEpoch(),
      SETTLE_CALM.births.rampSec
    );
    const cadence = birthRef.current.running
      ? SETTLE_CALM.births.tintStepSec
      : SAT_VEG.placeCadenceSec;
    if (t - st.t < cadence) return;
    // Round 21 (C, S6): one-time phase nudge (first pass stays immediate) +
    // the static skip. See SatVegLayer for the reasoning on both.
    const U = SURFACE_CALM.enabled ? SURFACE_CALM.uploads : null;
    st.t = st.first && U ? t + U.stagger[1] * SAT_VEG.placeCadenceSec : t;
    st.first = false;
    const sg = engine.stats;
    // R25 A: …and k joins the signature, or the static skip would hold a
    // settled parcel at the alpha it was filled with while the aircraft
    // descends through the bubble. Appended ONLY when the sub-switch is armed,
    // so the flag-off signature string is character-for-character the R24 one.
    const gdA = tintAlphaFor(SAT_TINT.alpha);
    const sig = U
      ? `${sg.chunks}|${sg.ready}|${sg.empty}|${sg.tintChunks}|${sg.tintVerts}` +
        (gdA === SAT_TINT.alpha ? '' : `|${gdA.toFixed(3)}`)
      : '';
    const moved2 = (flight.pos.x - st.atX) ** 2 + (flight.pos.z - st.atZ) ** 2;
    // …and the static skip must not swallow a birth step: the signature is
    // unchanged by construction while a settled ring fades in.
    const birthMoved = Math.abs(k - st.birthK) > 0.01;
    if (!U || sig !== st.sig || moved2 >= U.staticSkipM ** 2 || birthMoved) {
      st.sig = sig;
      st.atX = flight.pos.x;
      st.atZ = flight.pos.z;
      st.birthK = k;
      fillTint(mesh, engine, flight, st);
    }
    notePopin('satTint', mesh.visible, birthRef.current.running);
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
  mesh.material.userData.groundDetailPhase?.value.set(((ox/8)%128+128)%128,((oz/8)%128+128)%128);

  // R22 (B): the birth envelope IS the α. At k 0 every multiplier is exactly
  // 1.0 — the identity of a multiply blend — so a newborn tint is not a faint
  // tint, it is no tint at all. `st.birthK` is 1 whenever the flag is off.
  // R25 A (GROUND_DETAIL_R25.tint): the drape LIFTS inside the ground bubble —
  // `mix(SAT_TINT.alpha, lowAglAlpha, k)`. It costs no shader text and no cache
  // key because this pass already re-derives every multiplier from the worker's
  // raw `col` on each cadence (the header's fourth budget decision, cashed in);
  // flag off, `tintAlphaFor` returns its input unchanged.
  const a = tintAlphaFor(S.alpha) * (st.birthK ?? 1);
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
  // R24 B (BEND_LEAD, recon WB-6) — `maxD` was measured at THIS placement pass,
  // but the pool is only refilled on the 2 s cadence, so by the next pass the
  // player can be BEND_LEAD.poolLeadM further from these instances (the fleet's
  // fastest airframe boosts at 750 m/s). The bend drop is quadratic in that
  // distance, so a stale maxD under-pads the sphere and the whole pooled layer
  // frustum-culls while the camera turns at speed — a forest, a suburb or a
  // landcover sheet vanishing as one object. Flag-off adds exactly 0.
  const leadD = maxD + (BEND_LEAD.enabled ? BEND_LEAD.poolLeadM : 0);
  geo.boundingSphere.radius = Math.sqrt(maxR2) + leadD * leadD * MAX_BEND_K + 50;
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
