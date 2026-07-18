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
import { applyBendAnchor, getEdgeFade } from '@/lib/fly/toy-world/world-bend';
import { useFlyStore } from '@/stores/fly-store';

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
    // Round 12: placement range follows the LIVE fade band (the domes'
    // anchor-bend material already dissolves on the same uEdgeFade band, so
    // extending placement extends their life for free). >1e8 = the uniform's
    // pre-boot "disabled" default — hold the round-7 static range.
    const feEnd = getEdgeFade().endM;
    const maxRange = Math.max(TOWN_GLOW.maxRangeM, feEnd < 1e8 ? feEnd : 0);
    const cap = Math.min(
      TOWN_GLOW.max,
      TOWN_GLOW.maxByTier[useFlyStore.getState().qualityTier] ?? TOWN_GLOW.max
    );
    // Collect → sort → place the NEAREST cap. (The round-7 loop took the
    // FIRST cap in POI-list order — indistinguishable at 30km where the
    // band rarely held >48 towns, arbitrary at a 90km cruise band.)
    const candidates = [];
    for (const c of cities) {
      const d = Math.hypot(c.wx - px, c.wz - pz);
      if (d < TOWN_GLOW.fadeInStartM || d > maxRange) continue;
      candidates.push({ c, d });
    }
    candidates.sort((a, b) => a.d - b.d);
    const fs = TOWN_GLOW.farScale;
    let n = 0;
    let maxPlacedD = 0;
    for (const { c, d } of candidates) {
      if (n >= cap) break;
      const fade = Math.min(
        1,
        (d - TOWN_GLOW.fadeInStartM) / (TOWN_GLOW.fadeInEndM - TOWN_GLOW.fadeInStartM)
      );
      // Coarse-or-null DEM at 80km+ parks a dome ±300m vertically — sub-pixel
      // at that range and additive; accepted (same stance as the letters).
      const s = engine?.getGroundAt?.(c.lon, c.lat);
      const groundY = s
        ? s.elev * TOY_WORLD.terrainExaggeration + TOY_WORLD.groundLift
        : 0;
      // Round 12: horizon towns read as glow POOLS, not sub-pixel dots —
      // inert below fs.startM (= the round-7 maxRangeM), so low-alt look
      // is identical.
      let ft = Math.min(1, Math.max(0, (d - fs.startM) / (fs.endM - fs.startM)));
      ft = ft * ft * (3 - 2 * ft); // smoothstep
      const r = TOWN_GLOW.radiusM * (1 + (fs.mul - 1) * ft);
      _dummy.position.set(c.wx - origin.anchor.x, groundY, c.wz - origin.anchor.z);
      _dummy.scale.set(r, r * TOWN_GLOW.heightFrac, r);
      _dummy.rotation.set(0, 0, 0);
      _dummy.updateMatrix();
      mesh.setMatrixAt(n, _dummy.matrix);
      mesh.setColorAt(n, _col.copy(base).multiplyScalar(fade));
      if (d > maxPlacedD) maxPlacedD = d;
      n += 1;
    }
    // park the unused pool at zero scale
    _dummy.scale.setScalar(0);
    _dummy.updateMatrix();
    for (let i = n; i < TOWN_GLOW.max; i++) mesh.setMatrixAt(i, _dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (process.env.NODE_ENV === 'development') {
      const stats = (window.__flyStats ??= {});
      stats.townGlowPlaced = n;
      stats.townGlowMaxD = maxPlacedD;
    }
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
