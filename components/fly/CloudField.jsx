'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Clouds, Cloud } from '@react-three/drei';
import {
  CanvasTexture,
  CircleGeometry,
  Color,
  InstancedMesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
} from 'three';
import { CLOUDS, TOY_WORLD, WORLD_EDGE } from '@/lib/fly/fly-constants';
import { expApproach } from '@/lib/fly/coords';
import { applyBend, bendDrop, getBend, getEdgeFade } from '@/lib/fly/toy-world/world-bend';
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

  // Round 11: clustered placement — N hashed cluster centers in the cell,
  // puffs on discs around them round-robin (i % count), so the tier count
  // cut thins every cluster instead of deleting whole ones. Uniform scatter
  // read as a fog of specks on bright satellite imagery; grouped puffs read
  // as weather. Same deterministic hash() — layouts stay harness-stable.
  const puffs = useMemo(() => {
    const cl = CLOUDS.clusters;
    const centers = cl.enabled
      ? Array.from({ length: cl.count }, (_, c) => ({
          x: (hash(c * 7 + 101) - 0.5) * CLOUDS.cellSize,
          z: (hash(c * 7 + 202) - 0.5) * CLOUDS.cellSize,
        }))
      : null;
    // Round 12: stored as CENTER + intra-cluster OFFSET so the altitude
    // spread factor can scale cluster centers (and the wrap cell) without
    // breaking clusters apart: x(f) = cx·f + dx. Same hash inputs as round
    // 11 (hash is pure) — at f = 1 the positions are numerically identical.
    return Array.from({ length: CLOUDS.puffsByTier.high }, (_, i) => {
      let cx = (hash(i * 3 + 1) - 0.5) * CLOUDS.cellSize;
      let cz = (hash(i * 3 + 2) - 0.5) * CLOUDS.cellSize;
      let dx = 0;
      let dz = 0;
      if (centers) {
        const c = centers[i % cl.count];
        const r = cl.radiusM * Math.sqrt(hash(i * 3 + 1)); // sqrt = even disc
        const a = hash(i * 3 + 2) * Math.PI * 2;
        cx = c.x;
        cz = c.z;
        dx = Math.cos(a) * r;
        dz = Math.sin(a) * r;
      }
      return {
        cx,
        cz,
        dx,
        dz,
        u: hash(i * 3 + 3), // altitude fraction within the style band
        size: 900 + hash(i * 5 + 4) * 1900,
        seed: i,
      };
    });
  }, []);

  // Round 11 / Round 13: sun-driven tint (satellite only). Round 13 made the
  // satellite deck LIT (MeshLambertMaterial below), so sun/hemi/env now carry
  // day/night LUMINANCE — this tint is only a SUBTLE chromatic bias (cool at
  // night → warm at golden hour → neutral by day) multiplied onto the lit
  // result (CLOUDS.dayTint reworked subtler, warmBand 0.25). FlyScene publishes
  // runtime.sun on its 60s cadence; sampled every ~10s. React state at 0.1Hz —
  // drei Cloud color prop is reactive, cost negligible.
  const [sunTint, setSunTint] = useState(null);
  useEffect(() => {
    if (mapStyle !== 'satellite') {
      setSunTint(null);
      return;
    }
    const cfg = CLOUDS.dayTint;
    const bright = new Color(cfg.bright);
    const warm = new Color(cfg.warm);
    const dim = new Color(cfg.dim);
    const c = new Color();
    const apply = () => {
      const frac = runtime.sun?.frac ?? 1;
      if (frac >= cfg.warmBand) {
        c.lerpColors(warm, bright, (frac - cfg.warmBand) / (1 - cfg.warmBand));
      } else {
        c.lerpColors(dim, warm, frac / cfg.warmBand);
      }
      const next = '#' + c.getHexString();
      if (process.env.NODE_ENV === 'development' && window.__flyStats) {
        window.__flyStats.cloudTint = next; // harness probe (verify-round11)
      }
      // functional set + bail: identical tint (steady noon) re-renders nothing
      setSunTint((prev) => (prev?.color === next ? prev : { color: next, frac }));
    };
    apply();
    const id = setInterval(apply, 10000);
    return () => clearInterval(id);
  }, [mapStyle, runtime]);

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
    const px = flight.pos.x; // absolute frame
    const pz = flight.pos.z;
    const ax = origin.anchor.x;
    const az = origin.anchor.z;
    const { k } = getBend(); // clouds ride the mini-planet like the terrain
    const engine = runtime.engine;
    const isToy = mapStyle === 'toy';
    // Round 12 (toy): spread the deck with the altitude-extended fade band —
    // f scales the CLUSTER CENTERS, the wrap cell AND the distance dissolve
    // together (same puff count; fading farther without scaling the cell is
    // meaningless — wrap keeps every puff within ±cell/2). At cruise the
    // deck below stays visible instead of dissolving inside a 13.5km bubble
    // the extended terrain has long outgrown. f = 1 at low altitude and in
    // every other style; >1e8 = the uniform's pre-boot "disabled" default.
    const asp = CLOUDS.altSpread;
    let f = 1;
    if (isToy && asp?.enabled) {
      const feEnd = getEdgeFade().endM;
      if (feEnd < 1e8) {
        f = Math.min(asp.maxF, Math.max(1, feEnd / WORLD_EDGE.fade.toy.endM));
      }
    } else if (!isToy && mapStyle === 'satellite' && asp?.satEnabled) {
      // Round 13 Phase 1: satellite band is static, so key the spread to eye
      // altitude directly — at cruise the deck spreads and reads as weather
      // below you (belowEye rises for free). f = 1 at/below satStartAglM keeps
      // the round-11 low-AGL deck byte-identical (verify-round11 clouds @1800m).
      f = Math.min(
        asp.maxF,
        Math.max(1, 1 + (flight.pos.y - asp.satStartAglM) / asp.satPerAglM)
      );
    }
    const fScale = f === 1 ? 1 : Math.pow(f, asp.sizeExp);
    const cell = CLOUDS.cellSize * f;
    const half = cell / 2;
    const fadeStartM = CLOUDS.fadeStartM * f;
    const fadeEndM = CLOUDS.fadeEndM * f;
    // Round 11: shadows are a high-tier luxury — the discs are cheap but the
    // pool + transparent overdraw is exactly what a degraded tier is shedding.
    const wantShadows =
      style.shadows === true && qualityTier === CLOUDS.shadow.minTier;
    let minAgl = Infinity;
    let belowEye = 0; // round 12: visible puffs under the player's eye
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
      // then rebased for rendering. Drift is a slow wind along +X. Cluster
      // centers ride the spread factor; intra-cluster offsets don't (the
      // clusters spread apart but stay internally tight).
      const ox = wrap(p.cx * f + p.dx + CLOUDS.driftMps * t - px, half, cell);
      const oz = wrap(p.cz * f + p.dz - pz, half, cell);
      const dist = Math.hypot(ox, oz);
      // Distance dissolve: shrink puffs away BEFORE the bent terrain rim
      // can depth-slice them (drei re-reads our matrixWorld scale per frame)
      const s =
        1 - Math.min(1, Math.max(0, (dist - fadeStartM) / (fadeEndM - fadeStartM)));
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
      if (y < flight.pos.y) belowEye += 1;

      g.visible = true;
      // fScale: spread puffs grow with f^sizeExp so the deck reads from
      // altitude instead of shrinking to specks over the wider cell.
      g.scale.setScalar(s * fScale);
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
      window.__flyStats.cloudSpreadF = f; // round 12 (verify-neon-alt)
      window.__flyStats.cloudsBelowEye = belowEye;
    }
  });

  // Round 13 Phase 1: satellite uses MeshLambertMaterial (sun/hemi/env shape
  // the deck for real) + the softer cumulus sprite (CLOUDS.textureSat) + a
  // flatter base (style.boundsYFrac). Toy/night stay unlit MeshBasicMaterial on
  // cloud.png — zero lighting cost, colors authored under the bloom threshold
  // so they never compete with the tracers (pixel-stable). key={mapStyle}: drei
  // Cloud config is prop-reactive, but a clean remount on the (discrete) style
  // switch removes any doubt about stale segments — and the material CLASS.
  const cloudTexture = mapStyle === 'satellite' ? CLOUDS.textureSat : CLOUDS.texture;
  const CloudMat = style.lit ? MeshLambertMaterial : MeshBasicMaterial;
  const boundsYFrac = style.boundsYFrac ?? 0.28;
  return (
    <>
      <primitive object={shadows.mesh} />
      <Clouds
      key={mapStyle}
      texture={cloudTexture}
      material={CloudMat}
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
            bounds={[p.size, p.size * boundsYFrac, p.size]}
            volume={p.size * 1.15}
            opacity={style.opacity}
            fade={CLOUDS.fade}
            speed={0.06}
            color={sunTint?.color ?? style.color}
          />
        </group>
      ))}
      </Clouds>
    </>
  );
}
