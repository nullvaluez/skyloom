/** The physical sun-disc transmittance can approach pure red at the horizon.
 * For World Look's opaque city surfaces, bound that chroma without adding
 * energy or changing the sky, scene light, albedo, or shadow visibility. */
export const WORLD_FACADE_KEY = Object.freeze({
  elevation: [-5, -2, 1, 10], // degrees; symmetric dawn/dusk, zero by daytime
  redRatio: [2, 5],           // ordinary warm daylight needs no correction
  alignment: [0.95, 0.995],  // only the sun-aligned key, never the moon
  neutralShare: 0.8,
});
const radians = value => value * Math.PI / 180;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const luma = rgb => rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;

/** Numerical policy for the focused light-response regression. */
export function worldFacadeKeyColor(rgb, sunSin, alignment = 1, wall = 1) {
  const c = WORLD_FACADE_KEY, e = c.elevation.map(value => Math.sin(radians(value)));
  const amount = c.neutralShare * smooth(e[0], e[1], sunSin) * (1 - smooth(e[2], e[3], sunSin))
    * smooth(...c.alignment, alignment) * smooth(...c.redRatio, rgb[0] / Math.max(rgb[1], 1e-6)) * wall;
  const y = luma(rgb);
  return rgb.map(value => value + (y - value) * amount);
}

const f = value => value.toFixed(7);
const e = WORLD_FACADE_KEY.elevation.map(value => Math.sin(radians(value)));
const c = WORLD_FACADE_KEY;
export const WORLD_FACADE_KEY_GLSL = `
#if NUM_DIR_LIGHTS > 0
// WORLD_LOOK: a local surface response, before regular/CSM shadow attenuation.
void wlDirectionalLightInfo(const in DirectionalLight source, out IncidentLight light){
  getDirectionalLightInfo(source,light);
  vec3 wlSunView=normalize((viewMatrix*vec4(uWorldFacadeSun,0.)).xyz);
  float wlHorizon=smoothstep(${f(e[0])},${f(e[1])},uWorldFacadeSun.y)*(1.-smoothstep(${f(e[2])},${f(e[3])},uWorldFacadeSun.y));
  float wlAligned=smoothstep(${f(c.alignment[0])},${f(c.alignment[1])},dot(light.direction,wlSunView));
  float wlChroma=smoothstep(${f(c.redRatio[0])},${f(c.redRatio[1])},light.color.r/max(light.color.g,.000001));
  float wlY=dot(light.color,vec3(.2126,.7152,.0722));
  light.color=mix(light.color,vec3(wlY),${f(c.neutralShare)}*wlHorizon*wlAligned*wlChroma*uCinema*step(.5,vBuildingStyle.z));
}
// The macro is installed AFTER the wrapper's call to the original function.
// It also reaches CinemaShadows' replacement lights_fragment_begin chunk.
#define getDirectionalLightInfo wlDirectionalLightInfo
#endif
`;

export function applyWorldFacadeLighting(shader, sunUniform) {
  shader.uniforms.uWorldFacadeSun = sunUniform;
  const anchor = '#include <lights_pars_begin>';
  if (shader.fragmentShader.split(anchor).length !== 2) throw Error('WORLD_LOOK: missing or repeated directional lighting anchor');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uWorldFacadeSun;')
    .replace(anchor, `${anchor}\n${WORLD_FACADE_KEY_GLSL}`);
}
