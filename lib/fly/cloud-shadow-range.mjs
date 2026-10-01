// A shadow caster must belong to the same finite cloud field that is rendered.
// Coordinates are unbent physical metres, as returned by metric() in the pass.
export function cloudShadowVisibility(caster, eye, rangeM, fadeStartM = rangeM * .72, fadeEndM = rangeM) {
  const distance = Math.hypot(...caster.map((v, i) => v - eye[i]));
  const end = Math.min(rangeM, fadeEndM), start = Math.min(fadeStartM, end - 1);
  const t = Math.max(0, Math.min(1, (distance - start) / (end - start)));
  return 1 - t * t * (3 - 2 * t);
}
export const CLOUD_SHADOW_RANGE_GLSL = `
uniform vec2 shadowFadeM;
float cloudShadowVisibility(vec3 caster, vec3 eyeMetric, float rangeM) {
 float endM=min(rangeM,shadowFadeM.y);
 float startM=min(shadowFadeM.x,endM-1.);
 return 1.-smoothstep(startM,endM,length(caster-eyeMetric));
}
`;
