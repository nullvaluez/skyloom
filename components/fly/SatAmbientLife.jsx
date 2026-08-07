'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SAT_AMBIENT, SAT_VEG } from '@/lib/fly/fly-constants';
import { applyBendAnchor } from '@/lib/fly/toy-world/world-bend';

const TIERS = ['low', 'medium', 'high']; // mirrors FlyCanvas's quality ladder
const atLeastTier = (tier, min) => TIERS.indexOf(tier) >= TIERS.indexOf(min);

const _dummy = new Object3D();
const _col = new Color();
const _cam = new Vector3();
const BOAT_COLORS = SAT_AMBIENT.boats.colors.map((c) => new Color(c));
const PLUME_COLOR = new Color(SAT_AMBIENT.plumes.color);
const _disperse = new Color(SAT_AMBIENT.plumes.disperseColor);

/** Deterministic hash — the CloudField recipe. */
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Soft radial falloff for the steam puffs — procedural, no asset. */
function makePuffTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  // A DEFINED core with a soft edge. The first cut fell to half alpha by 45% of
  // the radius, which over a 50 m quad is almost all halo — twelve of those
  // read as ground fog over the port rather than as twelve stacks.
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.32, 'rgba(255,255,255,0.92)');
  g.addColorStop(0.66, 'rgba(255,255,255,0.34)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/** Hull + cabin as ONE indexed geometry — 24 triangles, one instanced draw. */
function makeHullGeometry() {
  const [beam, len] = SAT_AMBIENT.boats.hullM;
  const hull = new BoxGeometry(beam, beam * 0.28, len);
  const cabin = new BoxGeometry(beam * 0.55, beam * 0.3, len * 0.26);
  cabin.translate(0, beam * 0.26, -len * 0.1);
  return mergeGeometries([hull, cabin]);
}

/**
 * Round 18 (A3 "GROUNDSKEEPER") — the two SATELLITE ambient movers, both
 * anchored to REAL worker-emitted data and both a STRICT high-tier flourish
 * (static gate at mount; phones resolve medium pre-mount and never see them).
 *
 *   BOATS — one instanced hull pool on satPts.water. The worker samples every
 *     anchor STRICTLY inside a water polygon with a 60-unit clearance box, and
 *     each boat traces a CLOSED path of radius wanderM (< 60) around its own
 *     anchor at speedMps. That leash IS the on-water proof: a free-heading
 *     integrator would leave the clearance inside a minute and beach itself,
 *     and no amount of steering logic makes that provable.
 *   PLUMES — one instanced pool of soft alpha billboards on satPts.ind
 *     (landuse=industrial), quadsPerStack per stack on staggered phases,
 *     rising, billowing and dispersing. Yaw-only billboarding: a steam column
 *     is upright, and a full camera-facing quad would tip over as you fly past.
 *
 * DRAW LEDGER: +1 each, and only while something is placed — a pool with zero
 * anchors sets `visible = false` AND `count = 0`, so a scene with no harbour
 * and no industry (Owens Valley) pays literally nothing. Both meshes ride the
 * shared anchor bend (applyBendAnchor, UNMODIFIED) and use the SatVegLayer pool
 * origin trick so their float32 instance matrices never carry absolute
 * mercator coordinates.
 */
export function SatAmbientLife({ engine, flight, tier }) {
  const boatsOn = atLeastTier(tier, SAT_AMBIENT.boats.minTier);
  const plumesOn = atLeastTier(tier, SAT_AMBIENT.plumes.minTier);
  const BOAT_POOL = SAT_AMBIENT.boats.max;
  const PLUME_POOL = SAT_AMBIENT.plumes.max * SAT_AMBIENT.plumes.quadsPerStack;

  const boatRef = useRef(null);
  const plumeRef = useRef(null);
  // Anchors resolve on the placement cadence; the motion reads them per frame.
  const stateRef = useRef({ t: -Infinity, ox: 0, oz: 0, boats: [], stacks: [] });

  const boatGeometry = useMemo(() => (boatsOn ? makeHullGeometry() : null), [boatsOn]);
  const boatMaterial = useMemo(() => {
    if (!boatsOn) return null;
    // Lit, not emissive: a hull in daylight takes the scene sun exactly like the
    // buildings do. Per-instance colour carries the white/grey variation.
    const m = new MeshLambertMaterial({ vertexColors: false });
    applyBendAnchor(m);
    return m;
  }, [boatsOn]);

  const plumeGeometry = useMemo(() => (plumesOn ? new PlaneGeometry(1, 1) : null), [plumesOn]);
  const plumeMaterial = useMemo(() => {
    if (!plumesOn) return null;
    // NORMAL blending, not additive. MEASURED: additive white steam reads
    // beautifully over the dark tarmac and water that a port sits on, and is
    // literally invisible over the near-white warehouse roofs right next to it
    // (adding to a clipped channel adds nothing). Steam SCATTERS light, so an
    // alpha-composited white puff is both the more physical and the more
    // legible choice; depthWrite stays off so the three quads of a stack blend
    // into one column instead of z-fighting.
    const m = new MeshBasicMaterial({
      color: '#ffffff', // per-instance colour carries the dispersal tint
      map: makePuffTexture(),
      transparent: true,
      opacity: SAT_AMBIENT.plumes.opacity,
      depthWrite: false,
      depthTest: true, // a ridge in front still occludes the stack behind it
    });
    applyBendAnchor(m);
    return m;
  }, [plumesOn]);

  useEffect(
    () => () => {
      boatGeometry?.dispose();
      boatMaterial?.dispose();
      plumeGeometry?.dispose();
      plumeMaterial?.map?.dispose();
      plumeMaterial?.dispose();
    },
    [boatGeometry, boatMaterial, plumeGeometry, plumeMaterial]
  );

  // Priority -44: after the veg streamer at -45, whose chunk data this reads.
  useFrame(({ clock, camera }) => {
    const t = clock.elapsedTime;
    const st = stateRef.current;
    const boats = boatRef.current;
    const plumes = plumeRef.current;
    if (!boats && !plumes) return;

    if (t - st.t >= SAT_VEG.placeCadenceSec) {
      st.t = t;
      collectAnchors(st, engine, flight, boatsOn, plumesOn);
    }

    // --- boats: closed-path creep inside the worker's clearance --------------
    if (boats) {
      const B = SAT_AMBIENT.boats;
      // Shared pool origin (SatVegLayer's float32 fix): instance matrices carry
      // small offsets, the mesh's float64 position carries the mercator half.
      boats.position.set(st.ox, 0, st.oz);
      let n = 0;
      for (const b of st.boats) {
        if (n >= BOAT_POOL) break;
        // Angular rate from the linear speed: ω = v / r, so speedMps stays the
        // knob that means what it says however wide the leash is.
        const ang = b.phase + b.dir * (B.speedMps / b.radius) * t;
        const x = b.x + Math.cos(ang) * b.radius;
        const z = b.z + Math.sin(ang) * b.radius;
        // Nose along the path tangent (the +Z axis of the hull geometry).
        const vx = -Math.sin(ang) * b.dir;
        const vz = Math.cos(ang) * b.dir;
        _dummy.position.set(x - st.ox, b.y, z - st.oz);
        _dummy.rotation.set(0, Math.atan2(vx, vz), 0);
        _dummy.scale.setScalar(b.size);
        _dummy.updateMatrix();
        boats.setMatrixAt(n, _dummy.matrix);
        boats.setColorAt(n, BOAT_COLORS[b.ci]);
        n += 1;
      }
      boats.count = n;
      boats.visible = n > 0; // zero anchors ⇒ zero draws (the Owens invariant)
      boats.instanceMatrix.needsUpdate = true;
      if (boats.instanceColor) boats.instanceColor.needsUpdate = true;
    }

    // --- plumes: rise, billow, fade, repeat ---------------------------------
    if (plumes) {
      const P = SAT_AMBIENT.plumes;
      let n = 0;
      plumes.position.set(st.ox, 0, st.oz);
      if (st.stacks.length > 0) {
        // Camera in the mesh's own frame — three does the inverse in float64, so
        // this stays exact however far the pool origin is from the anchor. The
        // matrix refresh is needed because the position write above lands AFTER
        // this frame's scene-graph update (useFrame -44 precedes the render).
        plumes.updateMatrixWorld();
        camera.getWorldPosition(_cam);
        plumes.worldToLocal(_cam);
      }
      for (const s of st.stacks) {
        for (let q = 0; q < P.quadsPerStack; q++) {
          if (n >= PLUME_POOL) break;
          // Staggered phases: one stack reads as a continuous column instead of
          // three synchronised blobs.
          const ph = (t / P.riseSec + s.phase + q / P.quadsPerStack) % 1;
          // The envelope lives in SCALE, not in alpha. An InstancedMesh has a
          // per-instance COLOUR and no per-instance alpha, and this material is
          // normal-blended, so fading a puff by darkening it would paint a grey
          // disc instead of removing one (exactly the mistake the opaque canopy
          // fade avoids). Growing out of nothing and collapsing back into it
          // costs the same matrix write that was happening anyway.
          const ends = Math.min(1, P.edgeK * ph) * Math.min(1, P.edgeK * (1 - ph));
          const r = (P.baseRM + (P.topRM - P.baseRM) * ph) * ends;
          const x = s.x - st.ox;
          const z = s.z - st.oz;
          _dummy.position.set(x, s.y + P.riseM * ph, z);
          // Yaw-only billboard: upright column, always broadside to the camera.
          _dummy.rotation.set(0, Math.atan2(_cam.x - x, _cam.z - z), 0);
          _dummy.scale.set(r * 2, r * 2, 1);
          _dummy.updateMatrix();
          plumes.setMatrixAt(n, _dummy.matrix);
          // …and the COLOUR carries dispersal: bright at the stack mouth,
          // cooling toward the haze tint as it climbs. Real steam greys out.
          _col.copy(PLUME_COLOR).lerp(_disperse, ph);
          plumes.setColorAt(n, _col);
          n += 1;
        }
      }
      plumes.count = n;
      plumes.visible = n > 0;
      plumes.instanceMatrix.needsUpdate = true;
      if (plumes.instanceColor) plumes.instanceColor.needsUpdate = true;
    }

    // Dev telemetry goes onto the ONE global SatVegLayer publishes (guarded, so
    // a StrictMode unmount that deletes it first can never throw here). Writing
    // window rather than a passed-in object also keeps this off the
    // react-hooks/immutability prop-mutation path.
    if (process.env.NODE_ENV === 'development' && window.__satVeg) {
      window.__satVeg.ambient = {
        tier,
        boatsOn,
        plumesOn,
        boats: st.boats.length,
        stacks: st.stacks.length,
        // The harness proves "boats are on water" against these: every hull is
        // within wanderM of an anchor the WORKER placed strictly inside a water
        // polygon, so the anchors are the water evidence.
        boatAnchors: st.boats.map((b) => [b.x, b.z]),
        indAnchors: st.stacks.map((s) => [s.x, s.z]),
        boatMesh: boats ?? null,
        plumeMesh: plumes ?? null,
      };
    }
  }, -44);

  return (
    <>
      {boatsOn && (
        <instancedMesh
          ref={(m) => {
            boatRef.current = m;
            // R21 SANCTIONED BUGFIX (C, P7 — unflagged, R20 D-CERT precedent).
            // The SatVegLayer `__satVegInit` latch: an inline ref callback
            // re-attaches on every parent re-render, and this reset undid the
            // live placement each time. The boats are re-placed every frame so
            // the blank is short — but "short" is exactly the flicker class
            // this round is closing, and a latch cannot change settled-state
            // output.
            if (m && !m.userData.__satBoatInit) {
              m.userData.__satBoatInit = true;
              m.instanceMatrix.setUsage(DynamicDrawUsage);
              m.frustumCulled = false; // ≤48 moving instances; the unit bound lies
              m.count = 0;
              m.visible = false;
            }
          }}
          args={[boatGeometry, boatMaterial, BOAT_POOL]}
        />
      )}
      {plumesOn && (
        <instancedMesh
          ref={(m) => {
            plumeRef.current = m;
            // R21 SANCTIONED BUGFIX (C, P7 — unflagged, R20 D-CERT precedent).
            // Same latch, same reason as the boats above.
            if (m && !m.userData.__satPlumeInit) {
              m.userData.__satPlumeInit = true;
              m.instanceMatrix.setUsage(DynamicDrawUsage);
              m.frustumCulled = false;
              m.renderOrder = 4; // additive, after the opaque ground layers
              m.count = 0;
              m.visible = false;
            }
          }}
          args={[plumeGeometry, plumeMaterial, PLUME_POOL]}
        />
      )}
    </>
  );
}

/**
 * ONE cadence pass: rebuild both anchor lists from the ready chunks,
 * nearest-first, with their ground/water Y sampled from the chunk grid. Also
 * re-anchors the shared pool origin. Everything here is deterministic in the
 * anchor's own coordinates, so a boat keeps its size, hue and orbit across
 * re-streams and warps.
 */
function collectAnchors(st, engine, flight, boatsOn, plumesOn) {
  const B = SAT_AMBIENT.boats;
  const P = SAT_AMBIENT.plumes;
  const px = flight.pos.x;
  const pz = flight.pos.z;
  st.ox = Math.round(px / 1000) * 1000;
  st.oz = Math.round(pz / 1000) * 1000;
  st.boats.length = 0;
  st.stacks.length = 0;
  for (const chunk of engine.nearest(px, pz)) {
    if (boatsOn && chunk.water && st.boats.length < B.max) {
      for (let i = 0; i < chunk.water.length; i += 2) {
        if (st.boats.length >= B.max) break;
        const lx = chunk.water[i];
        const lz = chunk.water[i + 1];
        const x = chunk.cx + lx;
        const z = chunk.cz + lz;
        if (Math.hypot(x - px, z - pz) > B.rangeM) continue;
        const h = hash(lx * 1.731 + lz * 9.117);
        const h2 = hash(lx * 5.913 - lz * 2.447);
        st.boats.push({
          x,
          z,
          // Water surface = the draped DEM there (open water reads sea level;
          // a lake reads its own shore height, which is what we want).
          y: engine.groundAtLocal(chunk, lx, lz) + B.liftM,
          phase: h * Math.PI * 2,
          // Leash radius is deliberately bounded WELL under the worker's 60-unit
          // clearance box (its inscribed circle is exactly 60).
          radius: B.wanderM * (0.45 + 0.55 * h2),
          dir: h2 > 0.5 ? 1 : -1,
          size: 1 + (h - 0.5) * 2 * B.sizeJitter,
          ci: (h2 * BOAT_COLORS.length) | 0,
        });
      }
    }
    if (plumesOn && chunk.ind && st.stacks.length < P.max) {
      for (let i = 0; i < chunk.ind.length; i += 2) {
        if (st.stacks.length >= P.max) break;
        const lx = chunk.ind[i];
        const lz = chunk.ind[i + 1];
        const x = chunk.cx + lx;
        const z = chunk.cz + lz;
        if (Math.hypot(x - px, z - pz) > P.rangeM) continue;
        st.stacks.push({
          x,
          z,
          y: engine.groundAtLocal(chunk, lx, lz) + P.liftM,
          phase: hash(lx * 4.117 - lz * 6.731),
        });
      }
    }
  }
}
