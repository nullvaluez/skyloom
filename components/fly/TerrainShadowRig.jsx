'use client';
/* eslint-disable react-hooks/immutability -- R3F frame callbacks update owned Three objects, shared uniforms and runtime telemetry, not React state. */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { useFlyStore } from '@/stores/fly-store';
import { toSceneDir } from '@/lib/fly/true-scale';
import { lightBlock } from '@/lib/fly/ship-light';
import {
  HorizonShadowMap,
  TERRAIN_SHADOW_UNIFORMS,
  TerrainShadowMap,
  clearTerrainShadowUniforms,
  terrainShadowMode,
  terrainShadowRuntime,
} from '@/lib/fly/terrain-shadow';

const _L = new Vector3();
const _anchor = { x: 0, z: 0 };

/**
 * SHIP PASS LIGHT — TERRAIN_SHADOW (FLY_SHIP_PASS.md LT-2): drives the terrain
 * shadow the earth surface material samples (lib/fly/terrain-shadow.js).
 * Mounted from FlyScene's LIGHT block only when the flag is on, so with the
 * flag off it does not exist. Runs after FlyScene's -50 simulation block (the
 * anchor, the cinema environment and the bend are this frame's) and before
 * the cascades (-0.9) and the composer (1).
 *
 * The map is (re)built for the compile-time path the materials were patched
 * with (terrainShadowMode) at the live tier's budget; when the policy refuses
 * the live tier (Low), the key light is down, or the world is loading after a
 * warp, the strength eases to 0 and the receivers are a no-op.
 */
export function TerrainShadowRig({ runtime, engine }) {
  const gl = useThree((s) => s.gl);
  const st = useRef({ map: null, key: null, strength: 0, epoch: null });
  useEffect(
    () => () => {
      st.current.map?.dispose();
      st.current.map = null;
      st.current.key = null;
      clearTerrainShadowUniforms();
      delete runtime.terrainShadow;
    },
    [runtime]
  );
  useFrame((state3, delta) => {
    const s = st.current;
    const fly = useFlyStore.getState();
    const mode = terrainShadowMode();
    const e = runtime.cinemaEnvironment, flight = runtime.flight, anchor = runtime.origin?.anchor;
    const live = !!mode && fly.mapStyle === 'satellite' && !!e && !!flight?.pos && !!anchor && !!engine?.map;
    const policy = live ? terrainShadowRuntime({ tier: fly.qualityTier, preset: fly.qualityPreset }) : { allowed: false, budget: {} };
    const block = lightBlock('TERRAIN_SHADOW');
    const size = mode === 'map' ? policy.budget.mapSize ?? 2048 : policy.budget.gridN ?? 64;
    const key = policy.allowed ? `${mode}:${size}` : null;
    if (key !== s.key) {
      s.map?.dispose();
      s.map = key ? (mode === 'map' ? new TerrainShadowMap(size) : new HorizonShadowMap(size)) : null;
      s.key = key;
    }
    if (fly.warpEpoch !== s.epoch) {
      s.epoch = fly.warpEpoch;
      s.strength = 0;
    }
    let target = 0;
    if (s.map) {
      // The key light (the sun by day, the moon by night) in scene units:
      // TRUE_SCALE's S⁻¹·keyDir, as CinemaShadowRig fits the cascades.
      toSceneDir(_L.fromArray(e.keyDir), _L);
      const up = _L.y > 0.02;
      _anchor.x = anchor.x;
      _anchor.z = anchor.z;
      const k = runtime.cinemaGeography?.worldUnitsPerMetre ?? 1;
      const rangeM = mode === 'map' ? policy.budget.rangeM ?? 40000 : block.horizonRangeM ?? 8000;
      const hz = policy.budget.hz ?? (mode === 'map' ? 2 : 1);
      if (up && runtime.worldLoading !== true) {
        try {
          s.map.update({
            renderer: gl,
            map: engine.map,
            engine,
            worldRoot: engine.object?.parent,
            player: flight.pos,
            anchor: _anchor,
            L: _L,
            k,
            rangeM,
            hz,
            now: state3.clock.elapsedTime,
            epoch: fly.warpEpoch,
            block,
          });
        } catch (error) {
          // A failed refresh must never take the frame down: the receivers
          // keep the last good map (or none) and the error is published.
          s.error = String(error?.message ?? error);
        }
        if (s.map.valid) target = block.strength ?? 1;
      }
    }
    const fade = Math.max(0.05, block.fadeSec ?? 0.6);
    const dt = Math.min(0.1, Math.max(0, delta));
    s.strength += (target - s.strength) * Math.min(1, dt / fade);
    if (target === 0 && s.strength < 0.002) s.strength = 0;
    if (s.map && s.strength > 0) s.map.bind(TERRAIN_SHADOW_UNIFORMS, _anchor, s.strength, block);
    else TERRAIN_SHADOW_UNIFORMS.uTsParams.value.x = 0;
    runtime.terrainShadow = {
      mode,
      key: s.key,
      strength: s.strength,
      valid: !!s.map?.valid,
      error: s.error ?? null,
      ...(s.map?.stats ?? {}),
    };
  }, -10);
  return null;
}
