'use client';

import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
} from 'three';
import { GLOBE, NAV_LIGHTS, SKY, TOY, TRAFFIC, TRAFFIC_HORIZON, WORLD } from '@/lib/fly/fly-constants';
import { buildArchetypeGeometries } from '@/lib/fly/traffic-geometries';
import { loadTrafficGeometries } from '@/lib/fly/model-loader';
import { applyBendAirAnchor, applyNavLights, horizonFade, setNavTime } from '@/lib/fly/toy-world/world-bend';
import { useFlyStore } from '@/stores/fly-store';

const _dummy = new Object3D();
const _color = new Color();
const _fog = new Color(SKY.fogColor);
// Stale traffic fades toward the style's haze, not always daylight blue
const FOG_BY_STYLE = { satellite: SKY.fogColor, toy: TOY.fogColor };

/**
 * Round 13 Phase 2: procedural far-LOD billboard sprite — a soft radial glow
 * with a faint wing/fuselage cross, generated to a CanvasTexture at startup (no
 * asset, no network). Set as the billboard material MAP so far traffic reads as
 * a distant aircraft glint on the SAME instanced draw, not a colored square.
 */
function makeBillboardSprite() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  // Faint silhouette hint: wings + fuselage cross (additive over the glow)
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(8, 30, 48, 4); // wings
  ctx.fillRect(30, 12, 4, 40); // fuselage
  const tex = new CanvasTexture(c);
  tex.anisotropy = 2;
  return tex;
}

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
        // Round 8: glossier hull (0.35/0.5) — the moonlit night reads specular
        const material = new MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.35,
          metalness: 0.5,
          flatShading: true,
        });
        // Altitude-aware bend, evaluated at the INSTANCE anchor: grounded
        // traffic hugs the drawn terrain, airborne traffic caps its drop so
        // it never sinks below eye level — and the whole model translates
        // rigidly (per-vertex air-drop sheared rim objects vertically).
        applyBendAirAnchor(material, GLOBE.trafficBend);
        // Round 8: baked nav-light emissive (aEmissive from the GLB bake;
        // primitive boot geometries lack it → reads 0 → dark, safe)
        applyNavLights(material, NAV_LIGHTS);
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
      // Round 13 Phase 2: soft-glow sprite (white rgb / shaped alpha) — the
      // per-instance tint still colors it, the same instanced draw now reads
      // as a distant glint. map is disposed with the mesh below.
      map: TRAFFIC.billboardSprite ? makeBillboardSprite() : null,
    });
    // Far-LOD dots: anchor-evaluated air bend. These quads GROW with
    // distance — per-vertex drop stretched ones straddling the AGL blend
    // band into giant vertical bars at the rim ("vertical contrails").
    applyBendAirAnchor(material, GLOBE.trafficBend);
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
      // R9-1 boot gate (b): the fleet pass settled (per-model failures
      // degrade to primitives inside the loader — this still counts done).
      runtime.modelsReady = true;
    });
    return () => {
      cancelled = true;
    };
  }, [meshes, runtime]);

  useEffect(() => {
    return () => {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        mesh.material.dispose();
        mesh.dispose();
      }
      billboards.geometry.dispose();
      billboards.material.map?.dispose();
      billboards.material.dispose();
      billboards.dispose();
    };
  }, [meshes, billboards]);

  useFrame(() => {
    const traffic = runtime.traffic;
    if (!traffic) return;

    // Nav-light strobe/beacon clock — ONE uniform write for the whole fleet
    setNavTime(performance.now() / 1000);

    const items = traffic.update(performance.now() / 1000, flight.pos);
    const ax = origin.anchor.x;
    const az = origin.anchor.z;
    const mapStyleNow = useFlyStore.getState().mapStyle;
    _fog.set(FOG_BY_STYLE[mapStyleNow] ?? SKY.fogColor);
    // Round 13 Phase 2: hull PRESENCE floor over dark ground — over-drive the
    // per-instance tint so lit hulls × dim moonlight never read as black cutouts.
    // Toy is always dark; satellite ramps the lift in only as the sun sets, so
    // bright daylight imagery keeps gain 1 (byte-identical certified day look).
    const hp = TRAFFIC.hullPresence;
    let hullGain = 1;
    if (mapStyleNow === 'toy') {
      hullGain = hp.toy;
    } else if (mapStyleNow === 'satellite') {
      const nightT = Math.min(1, Math.max(0, 1 - (runtime.sun?.frac ?? 1) / hp.satDayFrac));
      hullGain = 1 + (hp.satelliteNight - 1) * nightT;
    }

    for (const mesh of meshes) mesh._used = 0;
    let billboardsUsed = 0;
    let horizonFaded = 0;

    for (const it of items) {
      const x = it.rx - ax;
      const y = it.ryd; // drawn-frame render Y (round 8.5 H1; = ry in satellite)
      const z = it.rz - az;

      // Round 11 horizon fade: computed ONCE here (priority -45, after
      // setBendEye at -50 wrote this frame's uEyeY/uBendK), stashed on the
      // shared track item so tracers (-44) and the LabelCanvas RAF read the
      // same value. Distance MUST be world-XZ hypot to match the GPU's bendD
      // and the sqrt(alt/k) horizon — it.distM is mercator-corrected true
      // meters (~35% off at NYC latitudes) and would shift the fade radius.
      const dW = Math.hypot(it.rx - flight.pos.x, it.rz - flight.pos.z);
      it.horizonFade = horizonFade(dW, y, TRAFFIC_HORIZON);
      if (it.horizonFade <= 0.02) {
        // Fully past the horizon: no instance at all (overdraw win). The
        // minimap intentionally still shows it — it's radar, not eyes.
        horizonFaded += 1;
        continue;
      }

      if (it.distM < TRAFFIC.modelLodDistanceM) {
        const mesh = meshes[it.archetype] ?? meshes[meshes.length - 1];
        if (mesh._used >= TRAFFIC.maxPerArchetype) continue;
        // GLB archetypes carry their own vertex colors (tint white);
        // primitives stay classification-colored
        _color.set(mesh._isModel ? '#ffffff' : it.meta?.color || '#9ca3af');
        // Round 13 Phase 2: lift the hull out of black over dark ground, BEFORE
        // the stale fog-lerp (so ghosting still dims relative to the lifted base)
        if (hullGain !== 1) _color.multiplyScalar(hullGain);
        const eff = it.opacity * it.horizonFade;
        if (eff < 1) _color.lerp(_fog, 1 - eff);
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
        const eff = it.opacity * it.horizonFade;
        if (eff < 1) _color.lerp(_fog, 1 - eff);
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

    if (process.env.NODE_ENV === 'development' && window.__flyStats) {
      window.__flyStats.horizonFaded = horizonFaded;
    }
  }, -45);

  return (
    <group>
      {meshes.map((mesh, i) => (
        <primitive key={i} object={mesh} />
      ))}
      <primitive object={billboards} />
    </group>
  );
}
