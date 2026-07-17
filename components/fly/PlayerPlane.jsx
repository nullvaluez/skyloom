'use client';

import { Suspense, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { PLAYER_MODEL } from '@/lib/fly/assets';
import { computeModelCorrection } from '@/lib/fly/model-loader';

/**
 * The player's aircraft: CC-BY glTF jet (poly.pizza, see lib/fly/assets.js)
 * with the Phase-2 primitive plane as the Suspense fallback so the rig is
 * never empty. Rig mapping (rotation order YXZ): heading → -Y, pitch → +X,
 * bank → -Z. The GLB keeps its own materials; orientation/scale correction
 * comes from computeModelCorrection (nose -Z, ~targetLenM long).
 */
export function PlayerPlane({ flight }) {
  const group = useRef();

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    g.position.copy(flight.pos);
    g.rotation.order = 'YXZ';
    g.rotation.set(flight.pitch, -flight.heading, -flight.bank);
    // Idle hover wobble: a two-tone bob + faint roll sway (game feel). The
    // camera doesn't share it, so the plane reads alive against the world.
    const t = performance.now() / 1000;
    g.position.y += Math.sin(t * 1.9) * 0.35 + Math.sin(t * 3.1) * 0.12;
    g.rotation.z += Math.sin(t * 1.3) * 0.01;
  }, -30);

  return (
    <group ref={group}>
      <Suspense fallback={<PrimitivePlane />}>
        <PlayerModel />
      </Suspense>
    </group>
  );
}

function PlayerModel() {
  const { scene } = useGLTF(PLAYER_MODEL.url);
  const correction = useMemo(
    () =>
      computeModelCorrection(
        scene,
        PLAYER_MODEL.targetLenM,
        PLAYER_MODEL.yawFixRad ?? null,
        PLAYER_MODEL.extraYawRad ?? 0
      ),
    [scene]
  );
  return (
    <group rotation-y={correction.rotY} scale={correction.scale}>
      <primitive object={scene} />
    </group>
  );
}

useGLTF.preload(PLAYER_MODEL.url);

/** Phase-2 primitive plane — loading fallback only. */
function PrimitivePlane() {
  const prop = useRef();
  useFrame((_, delta) => {
    if (prop.current) prop.current.rotation.z += delta * 45;
  });

  return (
    <group scale={2.2}>
      {/* fuselage */}
      <mesh rotation-x={Math.PI / 2}>
        <capsuleGeometry args={[1.1, 7, 6, 12]} />
        <meshStandardMaterial color="#e63946" roughness={0.45} />
      </mesh>
      <mesh position={[0, 0, -4.6]} rotation-x={-Math.PI / 2}>
        <coneGeometry args={[1.08, 1.6, 12]} />
        <meshStandardMaterial color="#2b2d42" roughness={0.35} />
      </mesh>
      <group ref={prop} position={[0, 0, -5.5]}>
        <mesh>
          <boxGeometry args={[7.5, 0.55, 0.12]} />
          <meshStandardMaterial color="#1d1d27" roughness={0.6} />
        </mesh>
        <mesh rotation-z={Math.PI / 2}>
          <boxGeometry args={[7.5, 0.55, 0.12]} />
          <meshStandardMaterial color="#1d1d27" roughness={0.6} />
        </mesh>
      </group>
      <mesh position={[0, 0.35, -0.6]}>
        <boxGeometry args={[13, 0.28, 2.6]} />
        <meshStandardMaterial color="#f1faee" roughness={0.5} />
      </mesh>
      <mesh position={[-6.6, 0.55, -0.6]}>
        <boxGeometry args={[0.35, 0.7, 2.6]} />
        <meshStandardMaterial color="#e63946" roughness={0.5} />
      </mesh>
      <mesh position={[6.6, 0.55, -0.6]}>
        <boxGeometry args={[0.35, 0.7, 2.6]} />
        <meshStandardMaterial color="#e63946" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.15, 4.1]}>
        <boxGeometry args={[5, 0.22, 1.5]} />
        <meshStandardMaterial color="#f1faee" roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.15, 4.3]}>
        <boxGeometry args={[0.22, 2.2, 1.6]} />
        <meshStandardMaterial color="#e63946" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.95, -1.6]}>
        <sphereGeometry args={[0.85, 12, 10]} />
        <meshStandardMaterial color="#74c0e3" roughness={0.15} metalness={0.2} />
      </mesh>
    </group>
  );
}
