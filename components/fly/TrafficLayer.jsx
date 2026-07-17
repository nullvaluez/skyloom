'use client';

import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
} from 'three';
import { GLOBE, NIGHT, SKY, TOY, TRAFFIC, WORLD } from '@/lib/fly/fly-constants';
import { buildArchetypeGeometries } from '@/lib/fly/traffic-geometries';
import { loadTrafficGeometries } from '@/lib/fly/model-loader';
import { applyBendAir } from '@/lib/fly/toy-world/world-bend';
import { useFlyStore } from '@/stores/fly-store';

const _dummy = new Object3D();
const _color = new Color();
const _fog = new Color(SKY.fogColor);
// Stale traffic fades toward the style's haze, not always daylight blue
const FOG_BY_STYLE = { satellite: SKY.fogColor, night: NIGHT.fogColor, toy: TOY.fogColor };

/**
 * Live traffic rendering: one raw InstancedMesh per archetype (NOT drei
 * <Instances> — its per-frame declarative update overhead is documented) +
 * one shared camera-facing billboard pool beyond modelLodDistanceM. All
 * matrices are written in the REBASED frame (instanceMatrix is float32 on
 * the GPU — absolute mercator coords would jitter). Stale ladder shows up
 * as color dim toward the fog color and a shrink-out on removal.
 * useFrame priority -45: after flight (-50), before plane pose (-30).
 */
export function TrafficLayer({ runtime, flight, origin }) {
  const camera = useThree((s) => s.camera);

  const meshes = useMemo(
    () =>
      buildArchetypeGeometries().map((geometry) => {
        const material = new MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.55,
          metalness: 0.15,
          flatShading: true,
        });
        // Altitude-aware bend: grounded traffic hugs the drawn terrain,
        // airborne traffic caps its drop so it never sinks below eye level
        applyBendAir(material, GLOBE.trafficBend);
        const mesh = new InstancedMesh(geometry, material, TRAFFIC.maxPerArchetype);
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.count = 0;
        mesh.frustumCulled = false;
        return mesh;
      }),
    []
  );

  const billboards = useMemo(() => {
    const material = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    applyBendAir(material, GLOBE.trafficBend); // far-LOD dots: same aircraft bend
    const mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, TRAFFIC.maxBillboards);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    return mesh;
  }, []);

  // GLB asset pass: primitives render instantly; each archetype's merged
  // vertex-colored geometry swaps in when its model resolves (per-model
  // failure keeps the primitive). Vertex colors need a white instance tint
  // as the base — the frame loop checks mesh._isModel.
  useEffect(() => {
    let cancelled = false;
    loadTrafficGeometries().then((geos) => {
      if (cancelled) return;
      geos.forEach((geo, i) => {
        const mesh = meshes[i];
        if (!geo || !mesh) return;
        mesh.geometry.dispose();
        mesh.geometry = geo;
        mesh.material.vertexColors = true;
        mesh.material.needsUpdate = true;
        mesh._isModel = true;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [meshes]);

  useEffect(() => {
    return () => {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        mesh.material.dispose();
        mesh.dispose();
      }
      billboards.geometry.dispose();
      billboards.material.dispose();
      billboards.dispose();
    };
  }, [meshes, billboards]);

  useFrame(() => {
    const traffic = runtime.traffic;
    if (!traffic) return;

    const items = traffic.update(performance.now() / 1000, flight.pos);
    const ax = origin.anchor.x;
    const az = origin.anchor.z;
    _fog.set(FOG_BY_STYLE[useFlyStore.getState().mapStyle] ?? SKY.fogColor);

    for (const mesh of meshes) mesh._used = 0;
    let billboardsUsed = 0;

    for (const it of items) {
      const x = it.rx - ax;
      const y = it.ry;
      const z = it.rz - az;

      if (it.distM < TRAFFIC.modelLodDistanceM) {
        const mesh = meshes[it.archetype] ?? meshes[meshes.length - 1];
        if (mesh._used >= TRAFFIC.maxPerArchetype) continue;
        // GLB archetypes carry their own vertex colors (tint white);
        // primitives stay classification-colored
        _color.set(mesh._isModel ? '#ffffff' : it.meta?.color || '#9ca3af');
        if (it.opacity < 1) _color.lerp(_fog, 1 - it.opacity);
        const fix = it.fix1;
        const speed = Math.hypot(fix.vE, fix.vN);
        const pitch = speed > 20 ? Math.atan2(fix.vUp, speed) : 0;
        _dummy.position.set(x, y, z);
        _dummy.rotation.order = 'YXZ';
        _dummy.rotation.set(pitch, -it.yaw, -it.bank);
        const s = WORLD.trafficDisplayScale * it.scaleK;
        _dummy.scale.set(s, s, s);
        _dummy.updateMatrix();
        mesh.setMatrixAt(mesh._used, _dummy.matrix);
        mesh.setColorAt(mesh._used, _color);
        mesh._used += 1;
      } else {
        if (billboardsUsed >= TRAFFIC.maxBillboards) continue;
        _color.set(it.meta?.color || '#9ca3af'); // far dots stay class-colored
        if (it.opacity < 1) _color.lerp(_fog, 1 - it.opacity);
        _dummy.position.set(x, y, z);
        _dummy.quaternion.copy(camera.quaternion); // camera-facing
        // Grow with distance so far traffic stays a visible speck
        const s =
          TRAFFIC.billboardSizeM *
          WORLD.trafficDisplayScale *
          Math.max(1, it.distM / TRAFFIC.modelLodDistanceM) *
          it.scaleK;
        _dummy.scale.set(s, s, s);
        _dummy.updateMatrix();
        billboards.setMatrixAt(billboardsUsed, _dummy.matrix);
        billboards.setColorAt(billboardsUsed, _color);
        billboardsUsed += 1;
      }
    }

    for (const mesh of meshes) {
      mesh.count = mesh._used;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    billboards.count = billboardsUsed;
    billboards.instanceMatrix.needsUpdate = true;
    if (billboards.instanceColor) billboards.instanceColor.needsUpdate = true;
  }, -45);

  return (
    <group>
      {meshes.map((mesh, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <primitive key={i} object={mesh} />
      ))}
      <primitive object={billboards} />
    </group>
  );
}
