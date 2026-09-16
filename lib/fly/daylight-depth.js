import { groundSmooth, clampGround, nearGroundOn } from './near-ground';
import { STYLIZED_EARTH, cinematicFlightOn } from './stylized-earth';

// Surface response only. The sun, environment, sky and cloud light stay intact.
export const DAYLIGHT_DEPTH = Object.freeze({
  indirect: { terrain: 0.50, building: 0.52, canopy: 0.60, clutter: 0.56 },
  nearHazeMix: 0.025,
});
export const DAYLIGHT_DEPTH_UNIFORMS = { uDaylightDepth: { value: 0 } };
export function daylightDepthWeight(sinEl, overcast = 0) {
  return groundSmooth(-0.08, 0.25, Number.isFinite(sinEl) ? sinEl : -1)
    * (1 - 0.65 * clampGround(overcast));
}
export function daylightNearHazeMix(legacy, amount = DAYLIGHT_DEPTH_UNIFORMS.uDaylightDepth.value) {
  const near=cinematicFlightOn('lighting')?STYLIZED_EARTH.lighting.nearHaze:DAYLIGHT_DEPTH.nearHazeMix;
  return legacy + (Math.min(legacy, near) - legacy) * clampGround(amount);
}
export function updateDaylightDepth(runtime, satellite) {
  const amount = satellite && nearGroundOn('daylight')
    ? daylightDepthWeight(runtime.sun?.sinEl, runtime.weather?.wx?.overcastT) : 0;
  DAYLIGHT_DEPTH_UNIFORMS.uDaylightDepth.value = amount;
  return amount;
}

/** Keep unshadowed fill from flattening surface normals and cast shadows.
 * No albedo, direct sunlight, emissive, exposure or final-screen adjustment.
 * This is independent of microscopic detail's short camera-distance fade. */
export function applyDaylightSurface(material, surface = 'terrain') {
  if (!material || material.isMeshDepthMaterial || material.userData.__daylightSurface
    || !(material.isMeshStandardMaterial || material.isMeshLambertMaterial)) return material;
  material.userData.__daylightSurface = surface;
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  const indirect = DAYLIGHT_DEPTH.indirect[surface] ?? DAYLIGHT_DEPTH.indirect.terrain;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    Object.assign(shader.uniforms, DAYLIGHT_DEPTH_UNIFORMS);
    if (material.userData.__worldBend) {
      // The bend changes project_vertex's wPos, whereas Three's later
      // worldpos_vertex still describes the flat world. Sample shadows at the
      // displayed position, then restore coordinates for environment lighting.
      shader.vertexShader = shader.vertexShader.replace('#include <shadowmap_vertex>', `
#ifdef USE_SHADOWMAP
vec4 daylightFlatWorldPosition = worldPosition;
worldPosition = wPos;
#endif
#include <shadowmap_vertex>
#ifdef USE_SHADOWMAP
worldPosition = daylightFlatWorldPosition;
#endif`);
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDaylightDepth;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
reflectedLight.indirectDiffuse *= mix(vec3(1.0), vec3(.88,.96,1.07) * ${indirect.toFixed(3)}, uDaylightDepth);`);
  };
  material.customProgramCacheKey = () => `${key}-daylight-${surface}-v2`;
  material.needsUpdate = true;
  return material;
}
