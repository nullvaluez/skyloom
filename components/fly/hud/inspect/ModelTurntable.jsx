'use client';

import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, useGLTF } from '@react-three/drei';
import { AdditiveBlending, DoubleSide } from 'three';
import { TRAFFIC_MODELS } from '@/lib/fly/assets';
import { computeModelCorrection } from '@/lib/fly/model-loader';
import { AIRCRAFT_SILHOUETTES, getBestSilhouette } from '@/lib/aircraft-silhouettes';
import { CARD_THEME } from './inspect-tokens';

/**
 * The inspect card's hero: a small dedicated <Canvas> showing the target's
 * archetype GLB on a slow isometric turntable — ink studio lighting, a
 * hero-colored rim light (materials are NEVER mutated: the drei useGLTF
 * scene is shared cache), grid pedestal, drag-to-spin with inertia.
 *
 * Why a second canvas: drei <View> can't work here (the card is opaque DOM
 * above the main canvas, and the EffectComposer repaints the whole
 * framebuffer each frame). A transient ~360×210 context at dpr ≤1.5 with
 * one low-poly model is noise next to the main scene; R3F force-loses the
 * context ~500ms after unmount (one benign "Context Lost." console line —
 * not a pageerror).
 *
 * Fallback chain (never blank): a hero-tinted SVG silhouette renders
 * BEHIND the transparent canvas from frame zero and cross-fades out when
 * the model reports ready. Covers: GLB loading, null archetype
 * (drone/unknown — silhouette is the permanent view), load failure (error
 * boundary), context failure.
 */

const TARGET_LEN = 2.2; // card units — fills the fov-28 viewport at dist 4.6
const BASE_SPIN = 0.35; // rad/s auto-rotate

/** Call on hover/lock so the card opens with the model already parsed. */
export function preloadTurntable(archetype) {
  const entry = TRAFFIC_MODELS[archetype];
  if (entry) useGLTF.preload(entry.url);
}

class GLBBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function easeOutBack(u) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const t = u - 1;
  return 1 + c3 * t * t * t + c1 * t * t;
}

function CameraRig() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    camera.lookAt(0, 0.05, 0);
  }, [camera]);
  return null;
}

function Model({ entry, spin, onReady }) {
  const { scene } = useGLTF(entry.url);
  const corr = useMemo(
    () => computeModelCorrection(scene, TARGET_LEN, entry.yawFixRad ?? null),
    [scene, entry]
  );
  const group = useRef();
  const born = useRef(null);

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(delta, 0.05);
    const s = spin.current;
    // Drag applies yaw directly; inertia decays back into the base spin
    g.rotation.y += s.dragging ? 0 : s.vel * dt;
    if (s.pendingYaw) {
      g.rotation.y += s.pendingYaw;
      s.pendingYaw = 0;
    }
    if (!s.dragging) {
      s.vel += (BASE_SPIN - s.vel) * (1 - Math.exp(-1.6 * dt));
    }
    // Entrance: springy scale-in (figurine placed on the pedestal)
    if (born.current == null) born.current = performance.now();
    const u = Math.min(1, (performance.now() - born.current) / 500);
    const k = 0.55 + 0.45 * easeOutBack(u);
    g.scale.setScalar(k);
  });

  return (
    <group ref={group}>
      <group rotation-y={corr.rotY} scale={corr.scale}>
        <primitive object={scene} dispose={null} />
      </group>
    </group>
  );
}

function SilhouetteBadge({ meta, heroColor, visible }) {
  const key = getBestSilhouette({ t: meta?.t }, meta?.iconType || 'airliner');
  const def = AIRCRAFT_SILHOUETTES[key] ?? AIRCRAFT_SILHOUETTES.unknown;
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-500"
      style={{ opacity: visible ? 1 : 0 }}
      aria-hidden="true"
    >
      <svg
        viewBox={def.viewBox}
        className="h-28 w-28"
        style={{ filter: `drop-shadow(0 0 16px color-mix(in srgb, ${heroColor} 35%, transparent))` }}
      >
        {def.paths.map((p, i) => (
          <path key={i} d={p.d} fill={heroColor} opacity={0.92} />
        ))}
      </svg>
    </div>
  );
}

export function ModelTurntable({ archetype, meta, heroColor, onDraggingChange }) {
  const entry = TRAFFIC_MODELS[archetype] ?? null;
  const [modelReady, setModelReady] = useState(false);
  const spin = useRef({ vel: BASE_SPIN, dragging: false, pendingYaw: 0, lastX: 0, lastT: 0 });

  // Manual drag-to-spin (no OrbitControls — it would fight the card tilt).
  const onPointerDown = (e) => {
    if (!modelReady) return;
    const s = spin.current;
    s.dragging = true;
    s.lastX = e.clientX;
    s.lastT = performance.now();
    onDraggingChange?.(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const s = spin.current;
    if (!s.dragging) return;
    const dx = e.clientX - s.lastX;
    const now = performance.now();
    s.pendingYaw += dx * 0.012;
    const dt = Math.max(1, now - s.lastT) / 1000;
    s.vel = Math.max(-6, Math.min(6, (dx * 0.012) / dt)); // release inertia
    s.lastX = e.clientX;
    s.lastT = now;
  };
  const endDrag = () => {
    if (!spin.current.dragging) return;
    spin.current.dragging = false;
    onDraggingChange?.(false);
  };

  return (
    <div
      className="relative h-full w-full cursor-grab active:cursor-grabbing"
      data-testid="inspect-turntable"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onPointerCancel={endDrag}
    >
      {/* Silhouette floor: visible until (unless) the GLB takes over */}
      <SilhouetteBadge meta={meta} heroColor={heroColor} visible={!modelReady} />

      {entry && (
        <GLBBoundary>
          <Canvas
            dpr={[1, 1.5]}
            gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
            frameloop="always"
            camera={{ fov: 28, position: [2.5, 2.16, 3.2], near: 0.1, far: 50 }}
            style={{ background: 'transparent' }}
          >
            <CameraRig />
            <Suspense fallback={null}>
              <Model entry={entry} spin={spin} onReady={() => setModelReady(true)} />
            </Suspense>

            {/* INK studio: ice key, dim ink fill, hero rim from behind */}
            <directionalLight position={[-3, 4, 2]} intensity={1.6} color="#eef5ff" />
            <hemisphereLight args={['#4a5d8f', '#141721', 0.55]} />
            <directionalLight position={[0.5, 1.2, -4]} intensity={2.4} color={heroColor} />

            {/* Pedestal: grid rings + hero tracer beam + soft contact shadow */}
            <group position={[0, -0.62, 0]}>
              <mesh rotation-x={-Math.PI / 2}>
                <ringGeometry args={[0.95, 0.985, 56]} />
                <meshBasicMaterial color={CARD_THEME.grid} transparent opacity={0.85} />
              </mesh>
              <mesh rotation-x={-Math.PI / 2}>
                <ringGeometry args={[1.3, 1.315, 56]} />
                <meshBasicMaterial color={CARD_THEME.grid} transparent opacity={0.38} />
              </mesh>
              <mesh position={[0, 0.21, 0]}>
                <planeGeometry args={[0.018, 0.42]} />
                <meshBasicMaterial
                  color={heroColor}
                  transparent
                  opacity={0.55}
                  blending={AdditiveBlending}
                  depthWrite={false}
                  side={DoubleSide}
                />
              </mesh>
            </group>
            <ContactShadows position={[0, -0.62, 0]} opacity={0.45} blur={2.6} scale={4} far={2.2} />
          </Canvas>
        </GLBBoundary>
      )}
    </div>
  );
}
