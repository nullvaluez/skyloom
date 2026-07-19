'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  CanvasTexture,
  CircleGeometry,
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

/** Round 13 P5: soft radial-gradient alpha for the toy hero-halo ground pool
 *  (replaces the crude flat hemisphere "puddle" — a soft glow that tapers out). */
function makeHaloTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

const ARCH_COUNT = LANDMARK_ARCHETYPES.length;
const HALO_POOL = ARCH_COUNT * LANDMARKS_3D.poolPerArchetype;

/**
 * Round 8 (P5): procedural landmark monuments — the TownGlow recipe applied
 * to the landmark POI DB: one InstancedMesh per archetype (9 pools since the
 * round-8.5 'church'), plus ONE shared additive hero-halo dome under each
 * placed monument (medium/high tiers). Materials ride 'world-bend-anchor-r8'
 * via applyBendAnchor — rigid instanced ground objects must never ride the
 * per-vertex bend (round-6 lesson 2). Placement runs on a 2s cadence (never
 * per frame); a floating-origin rebase forces an immediate re-place.
 * +10 draws total (9 archetypes + halo).
 *
 * Round 11: mounts in SATELLITE too (was toy-only — the Day default had zero
 * landmarks). Style split, mirroring CloudField's isToy pattern:
 * - ground: toy stands on drawn ground (elev × exaggeration + lift);
 *   satellite stands on RAW DEM elevation
 * - material: toy keeps the neon vertex-colored toon ramp; satellite gets a
 *   sun-lit Lambert daylight tint (LANDMARKS_3D.satStyle) — the day sun/hemi
 *   light it, so monuments read as stone, not glow
 * - halo: satellite drops to satStyle.haloOpacity (0 skips the draw)
 * FlyScene keys this component by mapStyle, so a style switch is a clean
 * remount — materials never hot-swap mid-life.
 */
export function LandmarkMonuments({ flight, origin, engine, qualityTier, mapStyle }) {
  const isToy = mapStyle !== 'satellite';
  const haloOpacity = isToy
    ? LANDMARKS_3D.haloOpacity
    : LANDMARKS_3D.satStyle.haloOpacity;
  const halosOn = qualityTier !== 'low' && haloOpacity > 0;
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
  const haloGeometry = useMemo(() => {
    // Round 13 P5: toy hero-halo is a flat radial-gradient ground POOL (a disc
    // in the XZ plane, softened by the alphaMap) — replaces the crude flat
    // hemisphere "puddle". Satellite keeps the squashed hemisphere (P4).
    if (isToy) {
      const g = new CircleGeometry(1, 40);
      g.rotateX(-Math.PI / 2); // XZ plane, facing up
      return g;
    }
    return new SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  }, [isToy]);
  const material = useMemo(() => {
    if (!isToy) {
      // Round 13 (P4) satStyle v2: a two-tone STONE toon ramp (was a flat
      // Lambert tint that read as near-invisible clay). The day sun/hemi shade
      // it; the 3-step grey gradient bands sunlit vs shaded faces so the
      // monument's form reads as daylight stone — no neon (vertexColors off).
      const ramp = new DataTexture(
        new Uint8Array(LANDMARKS_3D.satStyle.ramp),
        LANDMARKS_3D.satStyle.ramp.length,
        1,
        RedFormat
      );
      ramp.minFilter = NearestFilter;
      ramp.magFilter = NearestFilter;
      ramp.needsUpdate = true;
      const m = new MeshToonMaterial({
        color: LANDMARKS_3D.satStyle.color,
        gradientMap: ramp,
      });
      m.userData.__ramp = ramp; // disposed with the material below
      applyBendAnchor(m); // rigid ground objects anchor-bend in EVERY style
      return m;
    }
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
  }, [isToy]);
  const haloMaterial = useMemo(() => {
    const m = new MeshBasicMaterial({
      // Round 13 (P4): satellite gets a warm daylight rim-glow (soft white/gold)
      // instead of the toy's blue monumentHalo — reads as sunlit presence, not
      // neon. isToy is stable per-mount (the component is keyed by mapStyle).
      color: isToy ? PALETTE.monumentHalo : LANDMARKS_3D.satStyle.haloColor,
      transparent: true,
      // Round 13 P5: toy disc uses its own opacity + a soft radial alpha pool.
      opacity: isToy ? LANDMARKS_3D.toyHalo.opacity : haloOpacity,
      alphaMap: isToy ? makeHaloTexture() : null,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    applyBendAnchor(m);
    return m;
    // haloOpacity is style-derived and the component is keyed by mapStyle —
    // this memo never sees it change mid-life.
  }, [haloOpacity, isToy]);
  useEffect(
    () => () => {
      for (const g of Object.values(geometries)) g.dispose();
      haloGeometry.dispose();
      material.userData.__ramp?.dispose();
      material.dispose();
      haloMaterial.alphaMap?.dispose();
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
        // Toy stands on the DRAWN ground (exaggeration + lift); satellite
        // stands on raw DEM — the same isToy split CloudField uses.
        const groundY = s
          ? isToy
            ? s.elev * TOY_WORLD.terrainExaggeration + TOY_WORLD.groundLift
            : s.elev
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
          if (isToy) {
            // Round 13 P5: flat radial ground pool (lifted a hair off the plane
            // so the additive disc doesn't z-fight the terrain — depthWrite off).
            const R = r * LANDMARKS_3D.toyHalo.radiusFrac;
            _dummy.position.y = groundY + 3;
            _dummy.scale.set(R, 1, R);
          } else {
            _dummy.scale.set(r, r * 0.22, r);
          }
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
