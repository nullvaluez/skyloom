'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Clouds, Cloud } from '@react-three/drei';
import {
  CanvasTexture,
  CircleGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
} from 'three';
import { CLOUDS, TOY_WORLD } from '@/lib/fly/fly-constants';
import { expApproach } from '@/lib/fly/coords';
import { applyBend, bendDrop, getBend } from '@/lib/fly/toy-world/world-bend';
import { useFlyStore } from '@/stores/fly-store';

/** Soft radial falloff for the shadow discs — procedural, no asset. */
function makeShadowTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.65, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/** Deterministic hash so the puff layout is stable across renders/tiers. */
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Wrap v into [-half, half) (toroidal cell). */
function wrap(v, half, cell) {
  return ((((v + half) % cell) + cell) % cell) - half;
}

const _geo = { x: 0, y: 0, z: 0 };

/**
 * An endless cumulus field: puffs live at fixed ABSOLUTE positions inside a
 * toroidal cell that re-tiles around the player, so the field never runs out
 * on long flights and is immune to floating-origin rebases (positions are
 * computed absolute, rendered rebased, every frame). Puff count is a
 * quality-tier knob; hidden puffs stay mounted (drei re-buckets instanced
 * segments on unmount, cheap to just toggle visibility).
 *
 * Style-aware (CLOUDS.byStyle): Day keeps bright white cumulus; the dark
 * styles get fewer, higher, ink-tinted wisps that sit far below the bloom
 * threshold. Terrain-aware: each puff samples the DRAWN ground under its
 * current toroidal copy (immediately on wrap + slow round-robin healing)
 * and clamps its base CLOUDS.clearanceM above it — hills can't punch
 * through cloud bases anymore (the toy ground is drawn at elev × 1.7 +
 * lift, which used to clear the old fixed 900m band easily).
 */
export function CloudField({ runtime, flight, origin }) {
  const qualityTier = useFlyStore((s) => s.qualityTier);
  const mapStyle = useFlyStore((s) => s.mapStyle);
  const style = CLOUDS.byStyle[mapStyle] ?? CLOUDS.byStyle.satellite;
  const count = Math.round(
    (CLOUDS.puffsByTier[qualityTier] ?? CLOUDS.puffsByTier.high) * (style.countScale ?? 1)
  );

  const puffs = useMemo(
    () =>
      Array.from({ length: CLOUDS.puffsByTier.high }, (_, i) => ({
        x: (hash(i * 3 + 1) - 0.5) * CLOUDS.cellSize,
        z: (hash(i * 3 + 2) - 0.5) * CLOUDS.cellSize,
        u: hash(i * 3 + 3), // altitude fraction within the style band
        size: 900 + hash(i * 5 + 4) * 1900,
        seed: i,
      })),
    []
  );

  // Per-puff ground state (parallel to puffs): last sampled drawn-ground Y,
  // smoothed so a DEM tile streaming in can't pop a puff upward.
  const ground = useMemo(
    () => puffs.map(() => ({ y: 0, lastOx: null, lastOz: null })),
    [puffs]
  );
  const rr = useRef(0);

  const groupRefs = useRef([]);

  // Day-only cloud shadows (§4.3c): ONE instanced pool of soft dark discs
  // on the ground under the puffs — +1 draw. The disc material rides the
  // bend-only vertex patch, so shadows curve with the mini-planet instead
  // of floating off the rim (no fade: they must not tint toward sky color).
  const shadows = useMemo(() => {
    const geo = new CircleGeometry(1, 24);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshBasicMaterial({
      color: '#0b1420',
      transparent: true,
      opacity: CLOUDS.shadow.opacity,
      alphaMap: makeShadowTexture(),
      depthWrite: false,
    });
    applyBend(mat);
    const mesh = new InstancedMesh(geo, mat, CLOUDS.puffsByTier.high);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1; // under the puffs in the transparent pass
    return { mesh, dummy: new Object3D() };
  }, []);
  useEffect(() => {
    return () => {
      shadows.mesh.geometry.dispose();
      shadows.mesh.material.alphaMap?.dispose();
      shadows.mesh.material.dispose();
      shadows.mesh.dispose();
    };
  }, [shadows]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.05);
    const cell = CLOUDS.cellSize;
    const half = cell / 2;
    const px = flight.pos.x; // absolute frame
    const pz = flight.pos.z;
    const ax = origin.anchor.x;
    const az = origin.anchor.z;
    const { k } = getBend(); // clouds ride the mini-planet like the terrain
    const engine = runtime.engine;
    const isToy = mapStyle === 'toy';
    const wantShadows = style.shadows === true;
    let minAgl = Infinity;
    const hideShadow = (i) => {
      if (!wantShadows) return;
      shadows.dummy.position.set(0, -1e6, 0);
      shadows.dummy.scale.setScalar(0.0001);
      shadows.dummy.updateMatrix();
      shadows.mesh.setMatrixAt(i, shadows.dummy.matrix);
    };

    // Round-robin healing budget: a couple of sub-ms DEM raycasts per frame
    // cycle the whole field in ~half a second.
    const healFrom = rr.current;
    rr.current = (rr.current + CLOUDS.resamplePerFrame) % Math.max(1, count);

    for (let i = 0; i < puffs.length; i++) {
      const g = groupRefs.current[i];
      if (!g) {
        hideShadow(i);
        continue;
      }
      if (i >= count) {
        g.visible = false;
        hideShadow(i);
        continue;
      }
      const p = puffs[i];
      const gs = ground[i];
      // Nearest toroidal copy of the puff relative to the player (absolute),
      // then rebased for rendering. Drift is a slow wind along +X.
      const ox = wrap(p.x + CLOUDS.driftMps * t - px, half, cell);
      const oz = wrap(p.z - pz, half, cell);
      const dist = Math.hypot(ox, oz);
      // Distance dissolve: shrink puffs away BEFORE the bent terrain rim
      // can depth-slice them (drei re-reads our matrixWorld scale per frame)
      const s =
        1 - Math.min(1, Math.max(0, (dist - CLOUDS.fadeStartM) / (CLOUDS.fadeEndM - CLOUDS.fadeStartM)));
      if (s <= 0.02) {
        g.visible = false;
        hideShadow(i);
        continue;
      }

      // --- Terrain-aware base: sample the DRAWN ground under this copy ---
      const wrapped =
        gs.lastOx == null || Math.abs(ox - gs.lastOx) > half || Math.abs(oz - gs.lastOz) > half;
      const heal =
        (i - healFrom + count) % count < CLOUDS.resamplePerFrame; // round-robin slot
      if ((wrapped || heal) && engine) {
        const geo = engine.worldToGeo(((_geo.x = ox + px), (_geo.y = 0), (_geo.z = oz + pz), _geo));
        const e = engine.getElevationAt(geo.x, geo.y);
        if (e != null) {
          const drawn = isToy ? e * TOY_WORLD.terrainExaggeration + TOY_WORLD.groundLift : e;
          // Teleported copies snap; healing glides (no pops on DEM stream-in).
          // A puff is healed once per round-robin cycle — that cycle length
          // is the effective dt for the smoothing rate.
          const healDt = (Math.max(1, count) / CLOUDS.resamplePerFrame) * dt;
          gs.y = wrapped ? drawn : expApproach(gs.y, drawn, CLOUDS.groundLerpLambda, healDt);
        } else if (wrapped) {
          gs.y = 0; // unknown ground on a fresh copy — heal will fix it
        }
      }
      gs.lastOx = ox;
      gs.lastOz = oz;

      const y = Math.max(
        style.altMin + p.u * (style.altMax - style.altMin),
        gs.y + CLOUDS.clearanceM + p.u * CLOUDS.clearanceJitterM
      );
      if (y - gs.y < minAgl) minAgl = y - gs.y;

      g.visible = true;
      g.scale.setScalar(s);
      // Cloud billboards can't ride the vertex bend patch — drop them
      // CPU-side so nearby puffs still track the mini-planet curvature.
      const drop = bendDrop(dist, k);
      g.position.set(ox + px - ax, y - drop, oz + pz - az);
      // drei Clouds decomposes each puff's matrixWorld this same frame —
      // refresh it here or rebase frames would render a one-frame 10km pop.
      g.updateMatrixWorld(true);

      // Shadow disc on the sampled ground under this copy (the disc's
      // material rides the bend vertex patch — no CPU drop here)
      if (wantShadows) {
        shadows.dummy.position.set(ox + px - ax, gs.y + CLOUDS.shadow.liftM, oz + pz - az);
        shadows.dummy.scale.setScalar(p.size * CLOUDS.shadow.scale * s);
        shadows.dummy.updateMatrix();
        shadows.mesh.setMatrixAt(i, shadows.dummy.matrix);
      }
    }
    shadows.mesh.visible = wantShadows;
    if (wantShadows) shadows.mesh.instanceMatrix.needsUpdate = true;

    if (process.env.NODE_ENV === 'development' && window.__flyStats) {
      window.__flyStats.cloudMinAgl = minAgl === Infinity ? null : Math.round(minAgl);
    }
  });

  // MeshBasicMaterial: unlit — zero lighting cost, color is fully authored
  // per style (bright white in Day; ink wisps in the dark styles that stay
  // far under the bloom threshold so they never compete with the tracers).
  // key={mapStyle}: drei Cloud config is prop-reactive, but a clean remount
  // on the (discrete) style switch removes any doubt about stale segments.
  return (
    <>
      <primitive object={shadows.mesh} />
      <Clouds
      key={mapStyle}
      texture={CLOUDS.texture}
      material={MeshBasicMaterial}
      limit={CLOUDS.limit}
      frustumCulled={false}
    >
      {puffs.map((p, i) => (
        <group
          key={p.seed}
          ref={(el) => {
            groupRefs.current[i] = el;
          }}
        >
          <Cloud
            seed={p.seed}
            segments={CLOUDS.segments}
            bounds={[p.size, p.size * 0.28, p.size]}
            volume={p.size * 1.15}
            opacity={style.opacity}
            fade={CLOUDS.fade}
            speed={0.06}
            color={style.color}
          />
        </group>
      ))}
      </Clouds>
    </>
  );
}
