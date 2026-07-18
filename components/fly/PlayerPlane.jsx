'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix4,
  MeshPhysicalMaterial,
  PointsMaterial,
  Vector3,
} from 'three';
import { PLAYER_MODEL } from '@/lib/fly/assets';
import { NAV_LIGHTS } from '@/lib/fly/fly-constants';
import { computeModelCorrection } from '@/lib/fly/model-loader';

/**
 * The player's aircraft: CC-BY glTF jet (poly.pizza, see lib/fly/assets.js)
 * with the Phase-2 primitive plane as the Suspense fallback so the rig is
 * never empty. Rig mapping (rotation order YXZ): heading → -Y, pitch → +X,
 * bank → -Z. The GLB keeps its own materials; orientation/scale correction
 * comes from computeModelCorrection (nose -Z, ~targetLenM long).
 *
 * Round 8: the hero mounts a per-mount CLONE — the canopy gets a glossy
 * physical material and useGLTF's cached scene must NEVER be mutated (the
 * inspect turntable shares it) — plus PlayerLights, one additive Points
 * strobe at bbox-derived wingtip/tail/belly anchors (+1 draw).
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

const CANOPY_RE = /canopy|glass|cockpit/i;

function PlayerModel() {
  const { scene } = useGLTF(PLAYER_MODEL.url);
  // Per-mount clone: the material swap below must never reach the useGLTF
  // cache (ModelTurntable renders the same cached scenes elsewhere).
  const cloned = useMemo(() => scene.clone(true), [scene]);
  const correction = useMemo(
    () =>
      computeModelCorrection(
        cloned,
        PLAYER_MODEL.targetLenM,
        PLAYER_MODEL.yawFixRad ?? null,
        PLAYER_MODEL.extraYawRad ?? 0
      ),
    [cloned]
  );
  // Glossy canopy: name match, or the manifest's canopyMaterial (low-poly
  // packs name materials by hex color, defeating the generic regex).
  const canopyMats = useMemo(() => {
    const made = [];
    cloned.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const matName = o.material.name ?? '';
      const hit =
        CANOPY_RE.test(o.name) ||
        CANOPY_RE.test(matName) ||
        (PLAYER_MODEL.canopyMaterial && matName === PLAYER_MODEL.canopyMaterial);
      if (!hit) return;
      const glossy = new MeshPhysicalMaterial({
        color: o.material.color?.clone() ?? new Color('#9fd8e8'),
        roughness: 0.1,
        metalness: 0,
        envMapIntensity: 1.5,
      });
      o.material = glossy; // replaces the reference on the CLONE only
      made.push(glossy);
    });
    return made;
  }, [cloned]);
  useEffect(
    () => () => {
      for (const m of canopyMats) m.dispose();
    },
    [canopyMats]
  );
  return (
    <group>
      <group rotation-y={correction.rotY} scale={correction.scale}>
        <primitive object={cloned} />
      </group>
      <PlayerLights model={cloned} correction={correction} />
    </group>
  );
}

useGLTF.preload(PLAYER_MODEL.url);

// Precomputed nav colors (linear); strobes flash the tail white
const _port = new Color(NAV_LIGHTS.port);
const _stbd = new Color(NAV_LIGHTS.starboard);
const _tail = new Color(NAV_LIGHTS.tail);
const _beacon = new Color(NAV_LIGHTS.beacon);

function setPointColor(arr, i, c, k) {
  arr[i * 3] = c.r * k;
  arr[i * 3 + 1] = c.g * k;
  arr[i * 3 + 2] = c.b * k;
}

/**
 * Running lights on the hero: ONE additive Points draw — steady port/
 * starboard/tail, blinking belly beacon, twin wingtip strobes. Anchors are
 * bbox corners in the CORRECTED model frame (raw bbox pushed through the
 * rotY+scale correction), colors strobed per frame on the tiny attribute.
 */
function PlayerLights({ model, correction }) {
  const points = useRef();
  const { geometry, material } = useMemo(() => {
    const box = new Box3().setFromObject(model);
    const m = new Matrix4()
      .makeRotationY(correction.rotY)
      .multiply(
        new Matrix4().makeScale(correction.scale, correction.scale, correction.scale)
      );
    box.applyMatrix4(m);
    const c = box.getCenter(new Vector3());
    const len = box.max.z - box.min.z;
    const pts = [
      [box.min.x, c.y, c.z], // 0 port, steady red
      [box.max.x, c.y, c.z], // 1 starboard, steady green
      [0, box.max.y, box.max.z - len * 0.06], // 2 tail, steady white
      [0, box.min.y, c.z], // 3 belly beacon, blink
      [box.min.x, c.y, c.z + 0.6], // 4 port strobe
      [box.max.x, c.y, c.z + 0.6], // 5 starboard strobe
    ];
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pts.flat()), 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(pts.length * 3), 3));
    const mat = new PointsMaterial({
      size: 0.8,
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    return { geometry: geo, material: mat };
  }, [model, correction]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material]
  );

  useFrame(() => {
    const attr = points.current?.geometry.attributes.color;
    if (!attr) return;
    const t = performance.now() / 1000;
    const a = attr.array;
    setPointColor(a, 0, _port, 1);
    setPointColor(a, 1, _stbd, 1);
    setPointColor(a, 2, _tail, 1);
    // Beacon: slow blink with a 35% ember between flashes (matches traffic)
    const beaconOn = (t * NAV_LIGHTS.beaconHz) % 1 < 0.4 ? 1 : 0.35;
    setPointColor(a, 3, _beacon, beaconOn);
    // Wingtip strobes: short white pops, offset phases (additive: 0 = off)
    const s1 = (t * NAV_LIGHTS.strobeHz + 0.37) % 1 < NAV_LIGHTS.strobeDuty ? 1 : 0;
    const s2 = (t * NAV_LIGHTS.strobeHz + 0.71) % 1 < NAV_LIGHTS.strobeDuty ? 1 : 0;
    setPointColor(a, 4, _tail, s1);
    setPointColor(a, 5, _tail, s2);
    attr.needsUpdate = true;
  });

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />;
}

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
