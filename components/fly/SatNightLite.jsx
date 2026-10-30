'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DynamicDrawUsage, Object3D } from 'three';
import { buildPoiList } from '@/lib/fly/poi-data';
import { SAT_ROADS } from '@/lib/fly/fly-constants';
import { getEdgeFade } from '@/lib/fly/toy-world/world-bend';
import { useFlyStore } from '@/stores/fly-store';
import {
  createNightLiteGeometry,
  createNightLiteMaterial,
  mercK,
  nightLiteBlock,
  nightLitePolicy,
  nightRamp,
  placeNightLite,
} from '@/lib/fly/night-lite';

const _dummy = new Object3D();
const _col = new Color();

/**
 * SHIP PASS CITY (FLY_SHIP_PASS.md CT-4) — NIGHT_LITE's mount: flat city light
 * pools from altitude on the devices whose Enhanced aerial pass draws no VIIRS
 * city lights (phones, Low). Mounted from FlyScene's `SHIP PASS CITY mounts`
 * block only while NIGHT_LITE is on and the map is satellite in Enhanced
 * lighting (where FlyScene's own SatCityGlow mount is off, so the two never
 * double up). OUTSIDE worldRoot like SatCityGlow: it writes anchor-relative
 * instance matrices itself.
 *
 * ONE instanced draw, issued only at night and only when a pool is placed
 * (mesh.visible): zero draws by day. Placement runs on NIGHT_LITE.refreshSec
 * (and at once on a floating-origin rebase), never per frame; nothing moves
 * between placements, so a still camera sees a still image (no crawl).
 */
export function SatNightLite({ runtime, flight, origin, engine }) {
  const block = nightLiteBlock();
  const qualityTier = useFlyStore((s) => s.qualityTier);
  const policy = useMemo(() => nightLitePolicy(qualityTier), [qualityTier]);
  const cities = useMemo(() => buildPoiList().filter((p) => p.kind === 'city'), []);
  const geometry = useMemo(() => createNightLiteGeometry(block), [block]);
  const material = useMemo(() => createNightLiteMaterial(), []);
  const meshRef = useRef();
  const lastRef = useRef({ t: -Infinity, ax: NaN, az: NaN });
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
    if (!policy.allowed) {
      mesh.visible = false;
      return;
    }
    const t = clock.elapsedTime;
    const last = lastRef.current;
    const rebased = origin.anchor.x !== last.ax || origin.anchor.z !== last.az;
    if (!rebased && t - last.t < block.refreshSec) return;
    last.t = t;
    last.ax = origin.anchor.x;
    last.az = origin.anchor.z;

    const nightK = nightRamp(runtime.sun?.frac, block);
    if (nightK <= 0) {
      mesh.visible = false;
      return;
    }
    const px = flight.pos.x;
    const pz = flight.pos.z;
    const k = mercK(pz);
    const edge = getEdgeFade().endM; // scene units from the bend centre
    const placed = placeNightLite(cities, px, pz, {
      roadRingM: SAT_ROADS.ring.r / k,
      reachM: policy.budget?.reachM ?? 60000,
      edgeEndM: Number.isFinite(edge) && edge > 0 ? edge / k : Infinity,
      cap: block.pool,
      block,
    });
    let n = 0;
    let maxD = 0;
    for (const o of placed) {
      if (o.fade <= 0.001) continue;
      // RAW DEM, as SatCityGlow: a coarse or null sample far out is accepted
      // (a pool is a ground light; a few metres either way is invisible).
      const s = engine?.getGroundAt?.(o.c.lon, o.c.lat);
      const groundY = (s ? s.elev : 0) + block.liftM;
      const r = o.r * k; // true metres -> scene (mercator) units
      _dummy.position.set(o.c.wx - origin.anchor.x, groundY, o.c.wz - origin.anchor.z);
      _dummy.scale.set(r, 1, r);
      _dummy.rotation.set(0, 0, 0);
      _dummy.updateMatrix();
      mesh.setMatrixAt(n, _dummy.matrix);
      mesh.setColorAt(n, _col.setScalar(block.gain * o.fade * nightK));
      if (o.d > maxD) maxD = o.d;
      n += 1;
    }
    mesh.count = n;
    mesh.visible = n > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (process.env.NODE_ENV === 'development') {
      const stats = (window.__flyStats ??= {});
      stats.nightLite = { placed: n, maxDkm: Math.round(maxD / 100) / 10, nightK: Math.round(nightK * 1000) / 1000, reachM: policy.budget?.reachM ?? null };
    }
  });

  return (
    <instancedMesh
      ref={(m) => {
        meshRef.current = m;
        if (m) {
          m.instanceMatrix.setUsage(DynamicDrawUsage);
          m.frustumCulled = false;
          m.visible = false;
          // The instance colour exists from the first frame, so the program
          // (USE_INSTANCING_COLOR) is the one the prewarm registry compiled,
          // never a new one at the first night placement.
          if (!m.instanceColor) m.setColorAt(0, _col.setScalar(0));
          m.count = 0;
          m.renderOrder = 1; // after the opaque ground it lies on
        }
      }}
      args={[geometry, material, block.pool]}
    />
  );
}
