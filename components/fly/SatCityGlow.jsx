'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  MeshBasicMaterial,
  Object3D,
  SphereGeometry,
} from 'three';
import { buildPoiList } from '@/lib/fly/poi-data';
import { SAT_CITY_GLOW } from '@/lib/fly/fly-constants';
import { applyBendAnchor } from '@/lib/fly/toy-world/world-bend';
import { useFlyStore } from '@/stores/fly-store';

const _dummy = new Object3D();
const _col = new Color();
const _coreCol = new Color();
// Instance pool is fixed at mount (an InstancedMesh cannot grow) = the tier
// ceiling; the per-tier cap below just limits how many get placed.
const POOL = Math.max(...Object.values(SAT_CITY_GLOW.maxByTier));

/**
 * Round 16 (A4 "GND-C") — SATELLITE distant city glow. TownGlow's night-city
 * sibling for the realistic style: ONE additive sodium hemisphere plus ONE
 * warm core at every POI city inside the band. Two instanced draws TOTAL, and
 * BOTH ARE ALWAYS ISSUED — the sun only scales per-instance COLOR (black on an
 * additive material is invisible), so the draw count is bit-stable across the
 * day/night cycle (verify-sat-night gate B measures exactly that).
 *
 * Three deliberate differences from TownGlow (they are the whole point):
 *   1. Ground is the RAW DEM elevation — NO TOY_WORLD.terrainExaggeration and
 *      no groundLift. Satellite ground is raw (the R11 monuments lesson); the
 *      toy transform would float every dome over a mountain town.
 *   2. A SODIUM palette (SAT_CITY_GLOW.color/coreColor = the same warm street
 *      hue SAT_ROADS bakes into cls 4-6), not the toy's cool PALETTE.townGlow.
 *   3. NIGHT-GATED: instance colors are multiplied by the γ ramp
 *      `clamp(1 - frac/dayFrac)^gamma`, recomputed on the same 2s placement
 *      cadence from runtime.sun.frac — the EXACT ramp the road network and the
 *      building windows use, so the whole night city arrives together at dusk.
 *
 * Rides the shared anchor bend (applyBendAnchor, UNMODIFIED — rigid instanced
 * ground objects must not take the per-vertex bend, round-6 lesson 2) and
 * therefore also the shared rim dissolve, which melts the far domes into the
 * satellite fade band for free. Placement runs on a 2s cadence; a floating-
 * origin rebase forces an immediate re-place.
 */
export function SatCityGlow({ runtime, flight, origin, engine }) {
  const cities = useMemo(() => buildPoiList().filter((p) => p.kind === 'city'), []);
  const meshRef = useRef();
  const coreRef = useRef();
  const lastRef = useRef({ t: -Infinity, ax: NaN, az: NaN });

  const geometry = useMemo(
    // top hemisphere; squashed via instance scale
    () => new SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    []
  );
  const material = useMemo(() => {
    const m = new MeshBasicMaterial({
      color: '#ffffff', // per-instance color carries palette × fade × night
      transparent: true,
      opacity: SAT_CITY_GLOW.opacity,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    applyBendAnchor(m);
    return m;
  }, []);
  const coreMaterial = useMemo(() => {
    const m = new MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: SAT_CITY_GLOW.coreOpacity,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    applyBendAnchor(m);
    return m;
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      coreMaterial.dispose();
    },
    [geometry, material, coreMaterial]
  );

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    const core = coreRef.current;
    if (!mesh || !core || !flight) return;
    const t = clock.elapsedTime;
    const last = lastRef.current;
    const rebased = origin.anchor.x !== last.ax || origin.anchor.z !== last.az;
    if (!rebased && t - last.t < SAT_CITY_GLOW.refreshSec) return;
    last.t = t;
    last.ax = origin.anchor.x;
    last.az = origin.anchor.z;

    const G = SAT_CITY_GLOW;
    // γ night ramp, recomputed on the placement cadence (never per frame).
    // Day → 0 → every instance color is BLACK → invisible under additive
    // blending, while the two draws keep being submitted.
    const nt = Math.min(1, Math.max(0, 1 - (runtime.sun?.frac ?? 1) / G.dayFrac));
    const nightK = nt ** G.gamma;
    const base = _col.set(G.color);
    const coreBase = _coreCol.set(G.coreColor);
    const px = flight.pos.x;
    const pz = flight.pos.z;
    const cap = Math.min(POOL, G.maxByTier[useFlyStore.getState().qualityTier] ?? POOL);

    // Collect → sort → place the NEAREST cap (the R12 TownGlow fix: taking the
    // first N in POI-list order is arbitrary once the band holds >cap towns).
    const candidates = [];
    for (const c of cities) {
      const d = Math.hypot(c.wx - px, c.wz - pz);
      if (d < G.fadeInStartM || d > G.maxRangeM) continue;
      candidates.push({ c, d });
    }
    candidates.sort((a, b) => a.d - b.d);
    const fs = G.farScale;
    let n = 0;
    let maxPlacedD = 0;
    for (const { c, d } of candidates) {
      if (n >= cap) break;
      const fade = Math.min(1, (d - G.fadeInStartM) / (G.fadeInEndM - G.fadeInStartM));
      // RAW DEM — satellite ground carries no toy exaggeration/lift. A coarse-
      // or-null sample at 80km+ parks a dome ±300m vertically: sub-pixel at that
      // range and additive, so it is accepted (the same stance as the letters).
      const s = engine?.getGroundAt?.(c.lon, c.lat);
      const groundY = s ? s.elev : 0;
      // Horizon cities read as glow POOLS, not sub-pixel dots. Inert below
      // fs.startM, so the near-field look never changes with the knob.
      let ft = Math.min(1, Math.max(0, (d - fs.startM) / (fs.endM - fs.startM)));
      ft = ft * ft * (3 - 2 * ft); // smoothstep
      const r = G.radiusM * (1 + (fs.mul - 1) * ft);
      // Anchor-RELATIVE placement: this layer sits OUTSIDE worldRoot (like
      // TownGlow), so it subtracts the floating-origin anchor itself.
      _dummy.position.set(c.wx - origin.anchor.x, groundY, c.wz - origin.anchor.z);
      _dummy.scale.set(r, r * G.heightFrac, r);
      _dummy.rotation.set(0, 0, 0);
      _dummy.updateMatrix();
      mesh.setMatrixAt(n, _dummy.matrix);
      mesh.setColorAt(n, _col.copy(base).multiplyScalar(fade * nightK));
      const cr = r * G.coreRadiusFrac;
      _dummy.scale.set(cr, cr * G.coreHeightFrac, cr);
      _dummy.updateMatrix();
      core.setMatrixAt(n, _dummy.matrix);
      core.setColorAt(n, _coreCol.copy(coreBase).multiplyScalar(fade * nightK));
      if (d > maxPlacedD) maxPlacedD = d;
      n += 1;
    }
    // Park the unused pool at zero scale (NOT `count` — both meshes must keep
    // issuing their draw so the satellite draw budget is clock-independent).
    _dummy.scale.setScalar(0);
    _dummy.updateMatrix();
    for (let i = n; i < POOL; i++) {
      mesh.setMatrixAt(i, _dummy.matrix);
      core.setMatrixAt(i, _dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    core.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (core.instanceColor) core.instanceColor.needsUpdate = true;
    if (process.env.NODE_ENV === 'development') {
      const stats = (window.__flyStats ??= {});
      stats.satCityGlowPlaced = n;
      stats.satCityGlowMaxD = maxPlacedD;
      stats.satCityGlowNightK = nightK;
      window.__satCityGlow = { dome: mesh, core }; // harness A/B visibility toggle
    }
  });

  useEffect(
    () => () => {
      if (process.env.NODE_ENV === 'development') delete window.__satCityGlow;
    },
    []
  );

  return (
    <>
      <instancedMesh
        ref={(m) => {
          meshRef.current = m;
          if (m) {
            m.instanceMatrix.setUsage(DynamicDrawUsage);
            m.frustumCulled = false;
          }
        }}
        args={[geometry, material, POOL]}
      />
      <instancedMesh
        ref={(m) => {
          coreRef.current = m;
          if (m) {
            m.instanceMatrix.setUsage(DynamicDrawUsage);
            m.frustumCulled = false;
          }
        }}
        args={[geometry, coreMaterial, POOL]}
      />
    </>
  );
}
