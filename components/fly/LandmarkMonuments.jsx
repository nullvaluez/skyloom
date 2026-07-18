'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  DataTexture,
  DynamicDrawUsage,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  Object3D,
  RedFormat,
  SphereGeometry,
} from 'three';
import { buildPoiList } from '@/lib/fly/poi-data';
import { LANDMARKS_3D, TOY_WORLD } from '@/lib/fly/fly-constants';
import { PALETTE } from '@/lib/fly/toy-world/toy-palette';
import { applyBendAnchor } from '@/lib/fly/toy-world/world-bend';
import {
  LANDMARK_ARCHETYPES,
  buildLandmarkGeometries,
  monumentScale,
} from '@/lib/fly/landmarks-3d';

const _dummy = new Object3D();

const ARCH_COUNT = LANDMARK_ARCHETYPES.length;
const HALO_POOL = ARCH_COUNT * LANDMARKS_3D.poolPerArchetype;

/**
 * Round 8 (P5): procedural landmark monuments (toy only) — the TownGlow
 * recipe applied to the landmark POI DB: one InstancedMesh per archetype
 * (9 pools since the round-8.5 'church') of vertex-colored toon geometry,
 * plus ONE shared additive hero-halo dome under each placed monument
 * (medium/high tiers). Materials ride 'world-bend-anchor-r8' via
 * applyBendAnchor — rigid instanced ground objects must never ride the
 * per-vertex bend (round-6 lesson 2). Placement runs on a 2s cadence (never
 * per frame); a floating-origin rebase forces an immediate re-place.
 * +10 draws total (9 archetypes + halo).
 */
export function LandmarkMonuments({ flight, origin, engine, qualityTier }) {
  const halosOn = qualityTier !== 'low';
  const sites = useMemo(() => {
    const byArch = new Map(LANDMARK_ARCHETYPES.map((a) => [a, []]));
    for (const p of buildPoiList()) {
      if (p.kind === 'landmark' && p.lm && byArch.has(p.lm)) byArch.get(p.lm).push(p);
    }
    return byArch;
  }, []);
  const meshRefs = useRef({});
  const haloRef = useRef();
  const lastRef = useRef({ t: -Infinity, ax: NaN, az: NaN });

  const geometries = useMemo(() => buildLandmarkGeometries(), []);
  const haloGeometry = useMemo(
    // top hemisphere, squashed via instance scale (TownGlow's dome)
    () => new SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    []
  );
  const material = useMemo(() => {
    // Same 3-step toon ramp as toy-world-engine — the monuments must shade
    // like the city they stand in (the stepped bands ARE the toy look).
    const ramp = new DataTexture(new Uint8Array([110, 190, 255]), 3, 1, RedFormat);
    ramp.minFilter = NearestFilter;
    ramp.magFilter = NearestFilter;
    ramp.needsUpdate = true;
    const m = new MeshToonMaterial({ vertexColors: true, gradientMap: ramp });
    m.userData.__ramp = ramp; // disposed with the material below
    applyBendAnchor(m);
    return m;
  }, []);
  const haloMaterial = useMemo(() => {
    const m = new MeshBasicMaterial({
      color: PALETTE.monumentHalo,
      transparent: true,
      opacity: LANDMARKS_3D.haloOpacity,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    applyBendAnchor(m);
    return m;
  }, []);
  useEffect(
    () => () => {
      for (const g of Object.values(geometries)) g.dispose();
      haloGeometry.dispose();
      material.userData.__ramp.dispose();
      material.dispose();
      haloMaterial.dispose();
    },
    [geometries, haloGeometry, material, haloMaterial]
  );

  useFrame(({ clock }) => {
    if (!flight) return;
    const t = clock.elapsedTime;
    const last = lastRef.current;
    const rebased = origin.anchor.x !== last.ax || origin.anchor.z !== last.az;
    if (!rebased && t - last.t < LANDMARKS_3D.refreshSec) return;
    last.t = t;
    last.ax = origin.anchor.x;
    last.az = origin.anchor.z;

    const px = flight.pos.x;
    const pz = flight.pos.z;
    const halo = haloRef.current;
    let h = 0;
    for (const arch of LANDMARK_ARCHETYPES) {
      const mesh = meshRefs.current[arch];
      if (!mesh) continue;
      let n = 0;
      for (const poi of sites.get(arch)) {
        if (n >= LANDMARKS_3D.poolPerArchetype) break;
        const d = Math.hypot(poi.wx - px, poi.wz - pz);
        if (d > LANDMARKS_3D.maxRangeM) continue;
        const s = engine?.getGroundAt?.(poi.lon, poi.lat);
        const groundY = s
          ? s.elev * TOY_WORLD.terrainExaggeration + TOY_WORLD.groundLift
          : 0;
        const { sx, sy, sz, yaw } = monumentScale(poi);
        _dummy.position.set(poi.wx - origin.anchor.x, groundY, poi.wz - origin.anchor.z);
        _dummy.scale.set(sx, sy, sz);
        _dummy.rotation.set(0, yaw, 0);
        _dummy.updateMatrix();
        mesh.setMatrixAt(n, _dummy.matrix);
        n += 1;
        // hero halo under the monument (shared pool, medium/high only)
        if (halo && halosOn && h < HALO_POOL) {
          const r = sy * 0.55;
          _dummy.scale.set(r, r * 0.22, r);
          _dummy.rotation.set(0, 0, 0);
          _dummy.updateMatrix();
          halo.setMatrixAt(h, _dummy.matrix);
          h += 1;
        }
      }
      // park the unused pool at zero scale
      _dummy.scale.setScalar(0);
      _dummy.updateMatrix();
      for (let i = n; i < LANDMARKS_3D.poolPerArchetype; i++) mesh.setMatrixAt(i, _dummy.matrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (halo) {
      _dummy.scale.setScalar(0);
      _dummy.updateMatrix();
      for (let i = h; i < HALO_POOL; i++) halo.setMatrixAt(i, _dummy.matrix);
      halo.instanceMatrix.needsUpdate = true;
    }
  });

  const arm = (m) => {
    if (m) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.frustumCulled = false;
      // a freshly (re)mounted mesh holds identity matrices — force the next
      // frame's placement pass instead of waiting out the 2s cadence
      lastRef.current.t = -Infinity;
    }
  };

  return (
    <>
      {LANDMARK_ARCHETYPES.map((arch) => (
        <instancedMesh
          key={arch}
          name={`landmark-${arch}`}
          ref={(m) => {
            meshRefs.current[arch] = m;
            arm(m);
          }}
          args={[geometries[arch], material, LANDMARKS_3D.poolPerArchetype]}
        />
      ))}
      {halosOn && (
        <instancedMesh
          name="landmark-halo"
          ref={(m) => {
            haloRef.current = m;
            arm(m);
          }}
          args={[haloGeometry, haloMaterial, HALO_POOL]}
        />
      )}
    </>
  );
}
