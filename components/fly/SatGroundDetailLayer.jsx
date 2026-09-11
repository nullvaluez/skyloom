'use client';
/* eslint-disable react-hooks/immutability -- runtime is the established imperative scene bus. */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DynamicDrawUsage, Object3D, Sphere, Vector3 } from 'three';
import { useFlyStore } from '@/stores/fly-store';
import { mercatorScale } from '@/lib/fly/coords';
import { NEAR_GROUND, nearGroundOn } from '@/lib/fly/near-ground';
import { buildGroundDetail, buildGroundScrubGeometry, createGroundScrubMaterial, DETAIL_UNIFORMS } from '@/lib/fly/near-ground-detail';
import { applyBendAnchor } from '@/lib/fly/toy-world/world-bend';
import { NEAR_SUPPORT, updateNearContactMatrices } from '@/lib/fly/near-ground-support';

const dummy = new Object3D(), color = new Color();
const tones = { 2: '#414c32', 3: '#637044', 5: '#817848' };
export function SatGroundDetailLayer({ runtime, flight }) {
  const meshRef = useRef(null);
  const stateRef = useRef({ scan: null, at: -Infinity, rows: [], epoch: null, born: new Map(), ms: 0,
    contacts: { indices: new Uint16Array(NEAR_SUPPORT.capacity - NEAR_SUPPORT.canopyPoints),
      x: new Float64Array(NEAR_SUPPORT.capacity - NEAR_SUPPORT.canopyPoints),
      z: new Float64Array(NEAR_SUPPORT.capacity - NEAR_SUPPORT.canopyPoints),
      ground: new Float32Array(NEAR_SUPPORT.capacity - NEAR_SUPPORT.canopyPoints),
      count: 0, cursor: 0, maxOffset: 0, baseRadius: 0, offset: -0.05 } });
  const support = useMemo(() => ({ active: true,
    heightAt: (x, z, y) => runtime.satVeg?.groundAtNear?.(x, z, y) ?? y }), [runtime]);
  const geometry = useMemo(() => buildGroundScrubGeometry(), []);
  const material = useMemo(() => createGroundScrubMaterial(applyBendAnchor), []);
  const depth = useMemo(() => createGroundScrubMaterial(applyBendAnchor, true), []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); depth.dispose(); }, [geometry, material, depth]);
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const now = performance.now() / 1000, store = useFlyStore.getState(), st = stateRef.current;
    const mercK = mercatorScale(flight.latDeg ?? 0), signal = runtime.groundImmersion;
    const visible = store.mapStyle === 'satellite' && nearGroundOn('detail') && (signal?.k ?? 0) > 0.001;
    DETAIL_UNIFORMS.uGroundDetailK.value = visible ? signal.k : 0;
    DETAIL_UNIFORMS.uGroundDetailScale.value = mercK;
    DETAIL_UNIFORMS.uGroundDetailCenter.value.set(flight.pos.x - (runtime.origin?.anchor?.x ?? 0), flight.pos.z - (runtime.origin?.anchor?.z ?? 0));
    mesh.castShadow = visible && store.qualityTier === 'high' && nearGroundOn('shading');
    mesh.receiveShadow = nearGroundOn('shading');
    if (st.epoch !== store.warpEpoch) {
      st.epoch = store.warpEpoch; st.scan = null; st.rows = []; st.kinds = null; st.born.clear(); st.at = -Infinity;
      st.contacts.count = 0;
      mesh.count = 0; mesh.visible = false;
    }
    if (!visible) { mesh.visible = false; st.scan = null; return; }
    if (!st.scan && now - st.at > 0.8) {
      st.scan = buildGroundDetail({ veg: runtime.satVeg, buildings: runtime.satBuildings, roads: runtime.satRoads,
        x: flight.pos.x, z: flight.pos.z, mercatorK: mercK, tier: store.qualityTier });
    }
    if (st.scan) {
      const started = performance.now();
      // Both wall time and generator batches bound main-thread work. No new
      // worker, fetch, protocol, or all-ring synchronous geometry pass.
      for (let batch = 0; batch < 4; batch++) {
        const step = st.scan.next();
        if (step.done) {
          st.rows = step.value ?? []; st.scan = null; st.at = now;
          st.kinds = { grass: 0, scrub: 0, hedges: 0 };
          for (const row of st.rows) st.kinds[row.kind === 'hedge' ? 'hedges' : row.kind]++;
          const kept = new Map();
          for (const row of st.rows) kept.set(row.id, st.born.get(row.id) ?? now);
          st.born = kept;
          break;
        }
        if (performance.now() - started >= 0.55) break;
      }
      st.ms = performance.now() - started;
    }
    // Scale only during the 0.7s arrival fade; stable scenes do not upload every
    // frame. Distance/AGL fades happen in the color AND depth vertex shaders.
    const fading = st.rows.some((row) => now - st.born.get(row.id) < 0.7);
    if (st.uploadAt !== st.at || fading || st.wasFading || Math.abs((st.mercK ?? 0) - mercK) > 0.0005) {
      const ox = Math.round(flight.pos.x / 1024) * 1024, oz = Math.round(flight.pos.z / 1024) * 1024;
      mesh.position.set(ox, 0, oz);
      let extent = 0;
      const contacts = st.contacts;
      contacts.count = contacts.cursor = contacts.maxOffset = 0;
      for (let i = 0; i < st.rows.length; i++) {
        const row = st.rows[i], birth = Math.min(1, (now - st.born.get(row.id)) / 0.7);
        let supportY = row.y + 0.05;
        if (contacts.count < contacts.indices.length) {
          const at = contacts.count++;
          contacts.indices[at] = i; contacts.x[at] = row.x; contacts.z[at] = row.z; contacts.ground[at] = supportY;
          supportY = support.heightAt(row.x, row.z, supportY);
        }
        dummy.position.set(row.x - ox, supportY - 0.05, row.z - oz);
        dummy.rotation.set(0, row.yaw, 0);
        dummy.scale.set(row.widthM * mercK * birth, row.height * birth, row.depthM * mercK * birth);
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
        color.set(tones[row.cls]).multiplyScalar(0.86 + row.seed * 0.28); mesh.setColorAt(i, color);
        extent = Math.max(extent, dummy.position.length());
      }
      mesh.count = st.rows.length;
      mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16); mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) { mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, mesh.count * 3); mesh.instanceColor.needsUpdate = true; }
      // Real instance bound plus conservative bend/height padding.
      mesh.boundingSphere = new Sphere(new Vector3(), extent + 24);
      contacts.baseRadius = mesh.boundingSphere.radius;
      st.uploadAt = st.at; st.mercK = mercK;
    }
    updateNearContactMatrices(mesh, st.contacts, support);
    st.wasFading = fading;
    mesh.visible = visible && mesh.count > 0;
    runtime.groundDetail = { count: mesh.count, ...(st.kinds ?? { grass: 0, scrub: 0, hedges: 0 }),
      triangles: mesh.count * 18, scanning: !!st.scan,
      scanMs: st.ms, k: signal.k, draws: mesh.visible ? 1 : 0, castShadow: mesh.castShadow };
  }, -40);
  return <instancedMesh name="sat-ground-detail" ref={(mesh) => {
    meshRef.current = mesh;
    if (!mesh || mesh.userData.groundDetailInitialized) return;
    mesh.userData.groundDetailInitialized = true;
    mesh.count = 0; mesh.visible = false; mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.boundingSphere = new Sphere(new Vector3(), 1);
  }} args={[geometry, material, NEAR_GROUND.detail.pool]} customDepthMaterial={depth} />;
}
