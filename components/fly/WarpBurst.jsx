'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '@/lib/fly/toy-world/toy-palette';
import { useFlyStore } from '@/stores/fly-store';

const COUNT = 130;
const LIFE_SEC = 1.15;
const NEON = [PALETTE.accentPink, PALETTE.accentYellow, PALETTE.waterFoam, PALETTE.propWhite, '#4ade80'];

const _dummy = new Object3D();
const _fwd = new Vector3();

/**
 * One-shot neon confetti burst on every warp — spawns around the player the
 * frame after the teleport lands, travels WITH the plane (particles inherit
 * flight velocity) and dies in ~1s. One additive InstancedMesh, zero cost
 * while idle (count = 0). Palette accent colors, all styles.
 */
export function WarpBurst({ flight, origin }) {
  const warpEpoch = useFlyStore((s) => s.warpEpoch);

  const { mesh, state } = useMemo(() => {
    const mesh = new InstancedMesh(
      new PlaneGeometry(2.6, 2.6),
      new MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
      COUNT
    );
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    const c = new Color();
    for (let i = 0; i < COUNT; i++) {
      mesh.setColorAt(i, c.set(NEON[i % NEON.length]));
    }
    mesh.instanceColor.needsUpdate = true;
    const state = {
      active: false,
      t0: 0,
      pos0: new Vector3(), // ABSOLUTE world at burst time (rebase-immune)
      vel: new Float32Array(COUNT * 3),
      spin: new Float32Array(COUNT * 3),
    };
    return { mesh, state };
  }, []);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    };
  }, [mesh]);

  // Seed a burst on every warp (epoch 0 = no warp yet)
  useEffect(() => {
    if (warpEpoch === 0 || !flight) return;
    state.active = true;
    state.t0 = performance.now() / 1000;
    state.pos0.copy(flight.pos);
    flight.forward(_fwd);
    for (let i = 0; i < COUNT; i++) {
      // inherit the plane's velocity + a spherical spread → the confetti
      // erupts AROUND the plane instead of vanishing behind it
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = 30 + Math.random() * 90;
      state.vel[i * 3] = _fwd.x * flight.speed + Math.sin(ph) * Math.cos(th) * sp;
      state.vel[i * 3 + 1] = _fwd.y * flight.speed + Math.cos(ph) * sp + 18;
      state.vel[i * 3 + 2] = _fwd.z * flight.speed + Math.sin(ph) * Math.sin(th) * sp;
      state.spin[i * 3] = (Math.random() - 0.5) * 14;
      state.spin[i * 3 + 1] = (Math.random() - 0.5) * 14;
      state.spin[i * 3 + 2] = (Math.random() - 0.5) * 14;
    }
  }, [warpEpoch, flight, state]);

  useFrame(() => {
    if (!state.active) return;
    const t = performance.now() / 1000 - state.t0;
    const u = t / LIFE_SEC;
    if (u >= 1) {
      state.active = false;
      mesh.count = 0;
      return;
    }
    const scale = 1 - u * u; // ease-out shrink
    const ax = origin.anchor.x;
    const az = origin.anchor.z;
    for (let i = 0; i < COUNT; i++) {
      _dummy.position.set(
        state.pos0.x + state.vel[i * 3] * t - ax,
        state.pos0.y + state.vel[i * 3 + 1] * t - 28 * t * t, // soft gravity
        state.pos0.z + state.vel[i * 3 + 2] * t - az
      );
      _dummy.rotation.set(state.spin[i * 3] * t, state.spin[i * 3 + 1] * t, state.spin[i * 3 + 2] * t);
      _dummy.scale.setScalar(scale);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
    }
    mesh.count = COUNT;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <primitive object={mesh} dispose={null} />;
}
