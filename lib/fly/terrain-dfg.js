import { ShaderChunk } from 'three';
import { getDFGLUT } from 'three/src/renderers/shaders/DFGLUTData.js';

// Three r185 adds a DFG sampler to Standard materials. With terrain shadows
// and Ultra's three cascades, that makes 17 fragment textures on a 16-unit
// GPU. Keep the exact upstream 16x16 RG16F table in 64 uvec4 uniforms instead:
// each uint contains one texel's two half floats. No extra texture, approximation
// of the BRDF, or change to the shared Three shader chunks/materials.
const { data, width, height } = getDFGLUT().image;
if (width !== 16 || height !== 16 || !(data instanceof Uint16Array) || data.length !== 512) {
  throw new Error('Terrain DFG: unsupported Three lookup-table layout');
}
const packed = new Uint32Array(256);
for (let i = 0; i < packed.length; i++) packed[i] = data[2 * i] | (data[2 * i + 1] << 16);
export const TERRAIN_DFG_UNIFORMS = { uEarthDfg: { value: packed } };
export const TERRAIN_DFG_GLSL = `
uniform highp uvec4 uEarthDfg[64];
vec2 earthDfgTexel(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(15));
  int index = p.y * 16 + p.x;
  return unpackHalf2x16(uEarthDfg[index / 4][index % 4]);
}
vec4 earthDfgSample(vec2 uv) {
  // Match the original LinearFilter / ClampToEdgeWrapping half-texel mapping.
  vec2 p = clamp(uv, vec2(0.), vec2(1.)) * 16. - .5;
  ivec2 base = ivec2(floor(p));
  vec2 f = fract(p);
  return vec4(mix(mix(earthDfgTexel(base), earthDfgTexel(base + ivec2(1, 0)), f.x),
                  mix(earthDfgTexel(base + ivec2(0, 1)), earthDfgTexel(base + ivec2(1)), f.x), f.y), 0., 1.);
}
`;

export function applyTerrainDfg(shader) {
  const anchor = '#include <lights_physical_pars_fragment>';
  const declaration = 'uniform sampler2D dfgLUT;';
  const lookup = 'texture2D( dfgLUT, ';
  const source = ShaderChunk.lights_physical_pars_fragment;
  // Fail loudly on an upstream contract change instead of silently shipping
  // the seventeenth sampler again. Every direct/indirect lighting lookup moves.
  if (shader.fragmentShader.split(anchor).length !== 2 ||
      source.split(declaration).length !== 2 || source.split(lookup).length !== 5) {
    throw new Error('Terrain DFG: Three shader anchors changed');
  }
  const chunk = source.replace(declaration, TERRAIN_DFG_GLSL).replaceAll(lookup, 'earthDfgSample( ');
  if (/\bdfgLUT\b/.test(chunk)) throw new Error('Terrain DFG: an unconverted lookup remains');
  shader.fragmentShader = shader.fragmentShader.replace(anchor, chunk);
  Object.assign(shader.uniforms, TERRAIN_DFG_UNIFORMS);
}
