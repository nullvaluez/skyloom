import { Vector2 } from 'three';
import { nearGroundOn } from './near-ground';

export const NEAR_GROUND_UNIFORMS = {
  uNearGroundK: { value: 0 }, uNearGroundOrigin: { value: new Vector2() },
  uNearGroundMercator: { value: 1 },
};
const period = 4096;
const phase = (v) => ((v % period) + period) % period;
export function updateNearGroundUniforms(runtime, flight, signal, tier) {
  NEAR_GROUND_UNIFORMS.uNearGroundK.value = nearGroundOn('materials')
    ? (signal?.k ?? 0) * (tier === 'high' ? 1 : tier === 'medium' ? 0.8 : 0.55) : 0;
  NEAR_GROUND_UNIFORMS.uNearGroundOrigin.value.set(
    phase(runtime.origin?.anchor?.x ?? 0), phase(runtime.origin?.anchor?.z ?? 0));
  NEAR_GROUND_UNIFORMS.uNearGroundMercator.value = 1 / Math.max(0.1, Math.cos((flight.latDeg ?? 0) * Math.PI / 180));
}

/** Compose AFTER bend/hillshade. Stable cache key, live uniform A/B, no texture or pass. */
export function applyNearGroundMaterial(material, { surface = 'terrain' } = {}) {
  if (!material || material.userData.__nearGroundMaterial || material.isMeshDepthMaterial) return material;
  material.userData.__nearGroundMaterial = surface;
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  const standard = !!material.isMeshStandardMaterial;
  const lit = standard || material.isMeshPhongMaterial || material.isMeshLambertMaterial;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    Object.assign(shader.uniforms, NEAR_GROUND_UNIFORMS);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
uniform vec2 uNearGroundOrigin;
varying vec2 vNearGroundXZ;
varying float vNearGroundDistance;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec4 ngWorld = vec4(position, 1.0);
#ifdef USE_INSTANCING
ngWorld = instanceMatrix * ngWorld;
#endif
ngWorld = modelMatrix * ngWorld;
vNearGroundXZ = ngWorld.xz + uNearGroundOrigin;
vNearGroundDistance = length((viewMatrix * ngWorld).xyz);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform float uNearGroundK;
uniform float uNearGroundMercator;
varying vec2 vNearGroundXZ;
varying float vNearGroundDistance;
float ngGrain(vec2 p) {
  // Integer harmonics of a 4096-world-unit period survive every rebase.
  vec2 q = p * (6.28318530718 / 4096.0) * 1024.0;
  vec2 footprint = fwidth(q);
  float resolved = 1.0 - smoothstep(0.55, 2.5, max(footprint.x, footprint.y));
  return sin(q.x) * cos(q.y) * resolved;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float ngAmount = uNearGroundK * (1.0 - smoothstep(80.0, 260.0, vNearGroundDistance / uNearGroundMercator));
float ngSurface = ngGrain(vNearGroundXZ);
diffuseColor.rgb *= 1.0 + ngSurface * ngAmount * ${lit ? '0.012' : '0.025'};`);
    if (standard) shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + ngSurface * ngAmount * 0.055, 0.05, 1.0);`);
    if (lit) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
vec3 ngDx = dFdx(-vViewPosition), ngDy = dFdy(-vViewPosition);
vec3 ngR1 = cross(ngDy, normal), ngR2 = cross(normal, ngDx);
float ngDet = dot(ngDx, ngR1);
float ngHeight = ngSurface * ngAmount * 0.035;
vec3 ngGradient = sign(ngDet) * (dFdx(ngHeight) * ngR1 + dFdy(ngHeight) * ngR2);
normal = normalize(max(abs(ngDet), 0.00001) * normal - ngGradient);`);
  };
  material.customProgramCacheKey = () => `${key}-near-ground-${surface}-v1`;
  material.needsUpdate = true;
  return material;
}
