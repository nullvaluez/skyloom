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
  ConeGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PointsMaterial,
  Vector3,
} from 'three';
import { PLAYER_MODEL } from '@/lib/fly/assets';
import { NAV_LIGHTS, PLAYER } from '@/lib/fly/fly-constants';
import { computeModelCorrection } from '@/lib/fly/model-loader';
import { useFlyStore } from '@/stores/fly-store';

/**
 * The player's aircraft: CC-BY glTF jet (poly.pizza, see lib/fly/assets.js)
 * with the Phase-2 primitive plane as the Suspense fallback so the rig is
 * never empty. Rig mapping (rotation order YXZ): heading → -Y, pitch → +X,
 * bank → -Z. The GLB keeps its own geometry; orientation/scale correction
 * comes from computeModelCorrection (nose -Z, ~targetLenM long).
 *
 * Round 8: the hero mounts a per-mount CLONE — useGLTF's cached scene must
 * NEVER be mutated (the inspect turntable shares it). Round 13 Phase 2: every
 * hull material is regraded (clearcoat/lower-roughness MeshPhysical + a per-
 * style fresnel rim), the additive nav-light Points strobe double-flashes and
 * clears the per-style bloom threshold, and a throttle-driven afterburner cone
 * lights up on boost. All are load/clone-time or PLANE-LOCAL effects — the
 * player renders near the rebased origin (bend negligible) so none need a
 * world-bend patch.
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
        <PlayerModel flight={flight} />
      </Suspense>
    </group>
  );
}

const CANOPY_RE = /canopy|glass|cockpit/i;

// Round 13 Phase 2: per-style hull fresnel-rim uniforms, SHARED across every
// graded hull material (mirrors the world-bend uniform pattern) and updated on
// the discrete style switch only — a sun-white edge in satellite, a cold
// moonlit edge in toy that clears the bloom threshold at the silhouette.
const _hullRim = {
  uRimColor: { value: new Color(PLAYER.hull.byStyle.satellite.rim) },
  uRimStrength: { value: PLAYER.hull.byStyle.satellite.rimStrength },
  uRimPower: { value: PLAYER.hull.rimPower },
};

/**
 * Grade one source hull material into a clearcoat MeshPhysical + fresnel rim.
 * The rim is injected as emissive via OWN varyings (transformedNormal +
 * mvPosition captured after <project_vertex> — version-robust, no reliance on
 * three's internal vViewPosition/geometryNormal naming). PLANE-LOCAL: no bend.
 */
function gradeHullMaterial(src, isCanopy) {
  const c = PLAYER.hull;
  const m = new MeshPhysicalMaterial({
    color: src?.color?.clone() ?? new Color(isCanopy ? '#9fd8e8' : '#d7dde3'),
    map: src?.map ?? null,
    vertexColors: src?.vertexColors ?? false,
    roughness: isCanopy ? c.canopy.roughness : c.roughness,
    metalness: isCanopy ? c.canopy.metalness : c.metalness,
    clearcoat: isCanopy ? c.canopy.clearcoat : c.clearcoat,
    clearcoatRoughness: c.clearcoatRoughness,
    envMapIntensity: isCanopy ? c.canopy.envMapIntensity : c.envMapIntensity,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = _hullRim.uRimColor;
    shader.uniforms.uRimStrength = _hullRim.uRimStrength;
    shader.uniforms.uRimPower = _hullRim.uRimPower;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vRimNormal;\nvarying vec3 vRimView;'
      )
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvRimNormal = normalize( transformedNormal );\nvRimView = normalize( -mvPosition.xyz );'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vRimNormal;\nvarying vec3 vRimView;\nuniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform float uRimPower;'
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\nfloat rimF = pow( 1.0 - clamp( dot( normalize( vRimNormal ), normalize( vRimView ) ), 0.0, 1.0 ), uRimPower );\ntotalEmissiveRadiance += uRimColor * rimF * uRimStrength;'
      );
  };
  m.customProgramCacheKey = () => 'player-hull-rim';
  return m;
}

function PlayerModel({ flight }) {
  const { scene } = useGLTF(PLAYER_MODEL.url);
  const mapStyle = useFlyStore((s) => s.mapStyle); // discrete: rim swaps on style
  // Per-mount clone: the material regrade below must never reach the useGLTF
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
  // Round 13 Phase 2: regrade EVERY hull material (canopy gets the glassier
  // sub-grade) and arm the player to cast shadows — the toy ortho rig (whose
  // receiver plane already exists) then draws the hero's own shadow for free.
  const gradedMats = useMemo(() => {
    const made = [];
    cloned.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      o.castShadow = true;
      o.receiveShadow = false;
      const matName = o.material.name ?? '';
      const isCanopy =
        CANOPY_RE.test(o.name) ||
        CANOPY_RE.test(matName) ||
        (PLAYER_MODEL.canopyMaterial && matName === PLAYER_MODEL.canopyMaterial);
      const graded = gradeHullMaterial(o.material, isCanopy);
      o.material = graded; // replaces the reference on the CLONE only
      made.push(graded);
    });
    return made;
  }, [cloned]);
  // Style-driven fresnel rim (discrete write — never per frame)
  useEffect(() => {
    const cfg = PLAYER.hull.byStyle[mapStyle] ?? PLAYER.hull.byStyle.satellite;
    _hullRim.uRimColor.value.set(cfg.rim);
    _hullRim.uRimStrength.value = cfg.rimStrength;
  }, [mapStyle]);
  useEffect(
    () => () => {
      for (const m of gradedMats) m.dispose();
    },
    [gradedMats]
  );
  return (
    <group>
      <group rotation-y={correction.rotY} scale={correction.scale}>
        <primitive object={cloned} />
      </group>
      <PlayerLights model={cloned} correction={correction} />
      <Afterburner flight={flight} model={cloned} correction={correction} />
    </group>
  );
}

useGLTF.preload(PLAYER_MODEL.url);

// Precomputed nav colors (linear)
const _port = new Color(NAV_LIGHTS.port);
const _stbd = new Color(NAV_LIGHTS.starboard);
const _tail = new Color(NAV_LIGHTS.tail);
const _beacon = new Color(NAV_LIGHTS.beacon);

function setPointColor(arr, i, c, k) {
  arr[i * 3] = c.r * k;
  arr[i * 3 + 1] = c.g * k;
  arr[i * 3 + 2] = c.b * k;
}

// Corrected-frame bbox of the raw model (raw bbox pushed through rotY+scale).
function correctedBox(model, correction) {
  const box = new Box3().setFromObject(model);
  const m = new Matrix4()
    .makeRotationY(correction.rotY)
    .multiply(
      new Matrix4().makeScale(correction.scale, correction.scale, correction.scale)
    );
  box.applyMatrix4(m);
  return box;
}

/**
 * Running lights on the hero: ONE additive Points draw (+1) — steady port/
 * starboard, DOUBLE-FLASH white tail + wingtip strobes, blinking belly beacon.
 * Anchors are corrected-frame bbox corners; colors strobed per frame on the
 * tiny attribute (no React state). Per-style emit clears the bloom threshold so
 * the lights GLOW at night/toy (red/green luma is low without the ×emit lift).
 */
function PlayerLights({ model, correction }) {
  const points = useRef();
  const { geometry, material } = useMemo(() => {
    const box = correctedBox(model, correction);
    const c = box.getCenter(new Vector3());
    const len = box.max.z - box.min.z;
    const pts = [
      [box.min.x, c.y, c.z], // 0 port, steady red
      [box.max.x, c.y, c.z], // 1 starboard, steady green
      [0, box.max.y, box.max.z - len * 0.06], // 2 tail, double-flash white
      [0, box.min.y, c.z], // 3 belly beacon, blink
      [box.min.x, c.y, c.z + 0.6], // 4 port wingtip strobe
      [box.max.x, c.y, c.z + 0.6], // 5 starboard wingtip strobe
    ];
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pts.flat()), 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(pts.length * 3), 3));
    const mat = new PointsMaterial({
      size: PLAYER.navLights.sizeM,
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
    const nl = PLAYER.navLights;
    const style = useFlyStore.getState().mapStyle;
    const steady = nl.steadyEmit[style] ?? nl.steadyEmit.satellite;
    const strobeE = nl.strobeEmit[style] ?? nl.strobeEmit.satellite;
    const beaconE = nl.beaconEmit[style] ?? nl.beaconEmit.satellite;
    const t = performance.now() / 1000;
    const a = attr.array;
    setPointColor(a, 0, _port, steady);
    setPointColor(a, 1, _stbd, steady);
    // Double-flash: two quick pops (gap apart), then a long dark gap.
    const flash = (off) => {
      const ph = (t * nl.strobeHz + off) % 1;
      return ph < nl.strobeDuty || (ph >= nl.strobeGap && ph < nl.strobeGap + nl.strobeDuty)
        ? strobeE
        : 0;
    };
    setPointColor(a, 2, _tail, flash(0)); // tail double-flash
    setPointColor(a, 4, _tail, flash(0.5)); // wingtip strobes, half-cycle offset
    setPointColor(a, 5, _tail, flash(0.5));
    // Belly beacon: slow blink with a dim ember between flashes
    const bph = (t * nl.beaconHz) % 1;
    setPointColor(a, 3, _beacon, beaconE * (bph < 0.4 ? 1 : nl.beaconEmber));
    attr.needsUpdate = true;
  });

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />;
}

/**
 * Throttle-driven afterburner: a 2-tone toon flame (hot core + orange sheath)
 * behind the tail, +2 draws WHEN LIT (hidden → 0 draws at cruise). Throttle is
 * read from flight.speed (the HUD's own speed source — no per-frame store
 * subscription): OFF at cruise, ramping to a FULL bloom-clearing flame near the
 * boost preset. PLANE-LOCAL (corrected-frame, real meters) — no world-bend.
 */
function Afterburner({ flight, model, correction }) {
  const group = useRef();
  const { core, sheath, exhaustZ, centerY } = useMemo(() => {
    const ab = PLAYER.afterburner;
    const box = correctedBox(model, correction);
    const c = box.getCenter(new Vector3());
    // Cone axis onto +Z, base at the nozzle (local z=0), apex trailing (+Z).
    const build = (r, len, color, opacity) => {
      const geo = new ConeGeometry(r, len, 12, 1, true);
      geo.rotateX(Math.PI / 2); // +Y apex → +Z
      geo.translate(0, 0, len / 2); // base at local z=0
      const mat = new MeshBasicMaterial({
        color: new Color(color),
        transparent: true,
        opacity,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false, // additive flame drives bloom directly
      });
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false;
      return mesh;
    };
    return {
      core: build(ab.coreRadiusM, ab.lengthM, ab.coreColor, ab.coreOpacity),
      sheath: build(ab.sheathRadiusM, ab.lengthM * 1.12, ab.sheathColor, ab.sheathOpacity),
      exhaustZ: box.max.z - 0.4, // just inside the tail
      centerY: c.y,
    };
  }, [model, correction]);
  useEffect(
    () => () => {
      for (const m of [core, sheath]) {
        m.geometry.dispose();
        m.material.dispose();
      }
    },
    [core, sheath]
  );

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const ab = PLAYER.afterburner;
    // Throttle from actual speed (the HUD's source): 0 at cruise → 1 at boost.
    const thr = Math.min(
      1,
      Math.max(0, (flight.speed - ab.startMps) / (ab.fullMps - ab.startMps))
    );
    if (thr <= 0.02) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const t = performance.now() / 1000;
    const flicker = 1 + Math.sin(t * ab.flickerHz) * ab.flickerAmp * thr;
    const lenFrac = (ab.idleFrac + (1 - ab.idleFrac) * thr) * flicker;
    g.scale.set(0.7 + 0.3 * thr, 0.7 + 0.3 * thr, lenFrac);
    core.material.opacity = ab.coreOpacity * thr;
    sheath.material.opacity = ab.sheathOpacity * thr;
  });

  return (
    <group ref={group} position={[0, centerY, exhaustZ]} visible={false}>
      <primitive object={sheath} />
      <primitive object={core} />
    </group>
  );
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
