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
import { TOWN_GLOW, TOY_WORLD } from '@/lib/fly/fly-constants';
import { PALETTE } from '@/lib/fly/toy-world/toy-palette';
import { applyBendAnchor } from '@/lib/fly/toy-world/world-bend';

const _dummy = new Object3D();
const _col = new Color();

/**
 * Round 7 "Electric Night City": distant town glow-domes (toy only) — ONE
 * additive instanced hemisphere at every POI city inside the visible band.
 * They fade in past the detailed chunk rings and dissolve at the rim via
 * the anchored bend variant ('world-bend-anchor-r8' — rigid instanced ground
 * objects must not ride the per-vertex bend, round-6 lesson 2). Instance
 * placement runs on a 2s cadence (never per frame); a floating-origin
 * rebase forces an immediate re-place. +1 draw total.
 */
export function TownGlow({ flight, origin, engine }) {
  const cities = useMemo(
    () => buildPoiList().filter((p) => p.kind === 'city'),
    []
  );
  const meshRef = useRef();
  const lastRef = useRef({ t: -Infinity, ax: NaN, az: NaN });

  const geometry = useMemo(
    // top hemisphere; squashed via instance scale
    () => new SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    []
  );
  const material = useMemo(() => {
    const m = new MeshBasicMaterial({
      color: '#ffffff', // per-instance color carries palette × fade
      transparent: true,
      opacity: TOWN_GLOW.opacity,
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
    },
    [geometry, material]
  );

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh || !flight) return;
    const t = clock.elapsedTime;
    const last = lastRef.current;
    const rebased = origin.anchor.x !== last.ax || origin.anchor.z !== last.az;
    if (!rebased && t - last.t < TOWN_GLOW.refreshSec) return;
    last.t = t;
    last.ax = origin.anchor.x;
    last.az = origin.anchor.z;

    const base = _col.set(PALETTE.townGlow);
    const px = flight.pos.x;
    const pz = flight.pos.z;
    let n = 0;
    for (const c of cities) {
      if (n >= TOWN_GLOW.max) break;
      const d = Math.hypot(c.wx - px, c.wz - pz);
      if (d < TOWN_GLOW.fadeInStartM || d > TOWN_GLOW.maxRangeM) continue;
      const fade = Math.min(
        1,
        (d - TOWN_GLOW.fadeInStartM) / (TOWN_GLOW.fadeInEndM - TOWN_GLOW.fadeInStartM)
      );
      const s = engine?.getGroundAt?.(c.lon, c.lat);
      const groundY = s
        ? s.elev * TOY_WORLD.terrainExaggeration + TOY_WORLD.groundLift
        : 0;
      _dummy.position.set(c.wx - origin.anchor.x, groundY, c.wz - origin.anchor.z);
      _dummy.scale.set(
        TOWN_GLOW.radiusM,
        TOWN_GLOW.radiusM * TOWN_GLOW.heightFrac,
        TOWN_GLOW.radiusM
      );
      _dummy.rotation.set(0, 0, 0);
      _dummy.updateMatrix();
      mesh.setMatrixAt(n, _dummy.matrix);
      mesh.setColorAt(n, _col.copy(base).multiplyScalar(fade));
      n += 1;
    }
    // park the unused pool at zero scale
    _dummy.scale.setScalar(0);
    _dummy.updateMatrix();
    for (let i = n; i < TOWN_GLOW.max; i++) mesh.setMatrixAt(i, _dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={(m) => {
        meshRef.current = m;
        if (m) {
          m.instanceMatrix.setUsage(DynamicDrawUsage);
          m.frustumCulled = false;
        }
      }}
      args={[geometry, material, TOWN_GLOW.max]}
    />
  );
}
