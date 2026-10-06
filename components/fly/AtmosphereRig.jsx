'use client';
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AtmosphereLuts } from '@/lib/fly/atmosphere/gpu';
import { atmosphereParams } from '@/lib/fly/atmosphere/model';
import { PHYS_SKY_ACTIVE, PSKY_UNIFORMS } from '@/lib/fly/atmosphere/runtime';
import { CINEMA_UNIFORMS } from '@/lib/fly/cinema-frame';
import { isMobileGraphicsClass } from '@/lib/fly/device-class';
import { registerCinemaResources } from '@/lib/fly/cinema-resources';
import { useFlyStore } from '@/stores/fly-store';

/**
 * TRUE EARTH Phase 2 (PHYS_SKY): the atmosphere tables, rendered between the
 * frame's cinema update (priority −50, which places the sun) and the IBL bake
 * (−0.8), so the sky, the haze and the bake of this frame all read tables made
 * for this frame's eye and sun. Mounted only when the physical sky text is in
 * use (FlyScene), so a flag-off session allocates nothing.
 */
export function AtmosphereRig({ runtime }) {
  const gl = useThree((s) => s.gl);
  const ref = useRef(null);
  useEffect(() => {
    const luts = new AtmosphereLuts(atmosphereParams(PHYS_SKY_ACTIVE.grade));
    ref.current = luts;
    PSKY_UNIFORMS.uPskyView.value = luts.sky.texture;
    PSKY_UNIFORMS.uPskyApScatter.value = luts.aerial.textures[0];
    PSKY_UNIFORMS.uPskyApTrans.value = luts.aerial.textures[1];
    const release = registerCinemaResources('atmosphere', () => ({ trans: luts.trans, ms: luts.ms, sky: luts.sky, aerial: luts.aerial }));
    // Render targets lose their contents with the context; draw them again.
    const restored = () => luts.invalidate();
    gl.domElement.addEventListener('webglcontextrestored', restored);
    return () => {
      release();
      gl.domElement.removeEventListener('webglcontextrestored', restored);
      PSKY_UNIFORMS.uPskyView.value = null;
      PSKY_UNIFORMS.uPskyApScatter.value = null;
      PSKY_UNIFORMS.uPskyApTrans.value = null;
      luts.dispose();
      ref.current = null;
      delete runtime.physSky;
    };
  }, [gl, runtime]);

  useFrame(({ camera, clock }) => {
    const luts = ref.current;
    if (!luts || !runtime.cinemaEnvironment) return;
    const tiers = PHYS_SKY_ACTIVE.tiers;
    const qt = useFlyStore.getState().qualityTier;
    const tier = isMobileGraphicsClass() || qt === 'low' ? tiers.phone : qt === 'medium' ? tiers.medium : tiers.high;
    const sun = CINEMA_UNIFORMS.uCinemaSun.value;
    // Scene y is metres above sea level (origin rebasing moves x/z only).
    const h = Math.min(80, Math.max(0.001, camera.position.y / 1000));
    luts.update(gl, { h, muS: sun.y, maxKm: tier.aerialKm, nowSec: clock.elapsedTime, aerialHz: tier.aerialHz });
    // Consumers look up with what each table holds, not with this frame's eye.
    const hl = Math.hypot(sun.x, sun.z);
    PSKY_UNIFORMS.uPskyEye.value.set(luts.skyState.h, luts.skyState.muS, hl > 1e-6 ? sun.x / hl : 1, hl > 1e-6 ? sun.z / hl : 0);
    PSKY_UNIFORMS.uPskyAp.value.set(luts.aerialState.maxKm, luts.aerialState.h, 0, 0);
    // eslint-disable-next-line react-hooks/immutability -- runtime is the imperative simulation/telemetry handle, not React state.
    runtime.physSky = { ...luts.stats, eyeKm: h, aerialKm: tier.aerialKm };
  }, -20);
  return null;
}
