import { DataTexture, LinearMipmapLinearFilter, RGBAFormat } from 'three';
import { LEAF_OFF_DENSITY } from './ground-canopy-photo.js';

const LAMP_K = 0.3;

/** Same leaf ellipses as the shared foliage atlas. R keeps whole leaves for
 * leaf-off crowns; G is the original full-leaf mask, byte for byte. Thinning
 * in texture space lets mip filtering resolve the leaves instead of punching
 * unrelated screen pixels through leaves AND trunks every frame. */
export function buildCanopySeasonAtlas() {
  const size = 128, data = new Uint8Array(size * size * 4);
  let seed = 7321;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let n = 0; n < 380; n++) {
    const a = random() * Math.PI * 2, r = Math.sqrt(random());
    const cx = 32 + Math.cos(a) * r * 26, cy = 64 + Math.sin(a) * r * 58;
    const rx = 1.2 + random() * 2.4, ry = 2 + random() * 4;
    // A second, independent sequence must not change the authored ellipses.
    const keep = ((Math.imul(n + 1, 2654435761) >>> 0) / 4294967296) < LEAF_OFF_DENSITY;
    for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(size, cy + ry); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(64, cx + rx); x++) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) continue;
        const i = (y * size + x) * 4;
        if (keep) data[i] = 255;
        data[i + 1] = data[i + 2] = data[i + 3] = 255;
      }
    }
  }
  let sparse = 0, full = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    if (x < 64) { sparse += data[i]; full += data[i + 1]; }
    else data.fill(255, i, i + 4); // Every season keeps the solid trunk cell.
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  // Preserve the normalized cutout at coarse mips. Without this, a leaf-off
  // mip can average below alphaTest and erase a whole distant canopy patch.
  return { texture, coverageRatio: sparse / full };
}

let atlas = null, users = 0;
function seasonAtlas(material) {
  atlas ??= buildCanopySeasonAtlas();
  const current = atlas;
  users++;
  material.alphaMap = current.texture;
  const dispose = () => {
    material.removeEventListener('dispose', dispose);
    if (--users === 0) { current.texture.dispose(); atlas = null; }
  };
  material.addEventListener('dispose', dispose);
  return current.coverageRatio;
}

/** WORLD_GROUND only. The existing shared tree material and legacy paths are
 * untouched. aWpDens is [seasonal leaf density, conifer form, reach fade]. */
export function patchCanopyMaterial(m, depth) {
  const coverageRatio = m.alphaMap && m.userData.immersiveFoliage ? seasonAtlas(m) : 1;
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aWpDens;\nvarying vec2 vWpDens;\nvarying float vWpSeed;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float wpB = mix(1.0, 1.3, smoothstep(0.55, 0.75, position.y));
  float wpC = clamp(1.16 - 0.92 * position.y, 0.16, 1.0);
  transformed.xz *= mix(wpB, wpC, aWpDens.y);
}
vWpDens = aWpDens.xz;
vWpSeed = 0.0;
#ifdef USE_INSTANCING
vWpSeed = fract(instanceMatrix[3].x * 0.1371 + instanceMatrix[3].z * 0.3113);
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWpDens;\nvarying float vWpSeed;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
// Only the existing outer reach fade uses screen-door coverage.
if (vWpDens.y < 0.995) {
  float wpN = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + vWpSeed);
  if (wpN >= vWpDens.y) discard;
}`);
    if (coverageRatio !== 1) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <alphamap_fragment>', `
#ifdef USE_ALPHAMAP
  vec4 wpLeaf = texture2D(alphaMap, vAlphaMapUv);
  float wpSeason = vWpDens.x >= 0.995 ? 1.0 : clamp((vWpDens.x - ${LEAF_OFF_DENSITY.toFixed(2)}) / ${(1 - LEAF_OFF_DENSITY).toFixed(2)}, 0.0, 1.0);
  diffuseColor.a *= mix(wpLeaf.r, wpLeaf.g, wpSeason);
#endif`)
        .replace('#include <alphatest_fragment>', `
#if defined(USE_ALPHATEST) && defined(USE_ALPHAMAP)
  float wpLeafCell = 1.0 - step(0.51, vAlphaMapUv.x);
  float wpCoverage = mix(${coverageRatio.toFixed(8)}, 1.0, wpSeason);
  float wpCutoff = alphaTest * mix(1.0, wpCoverage, wpLeafCell);
  #ifdef ALPHA_TO_COVERAGE
    diffuseColor.a = smoothstep(wpCutoff, wpCutoff + fwidth(diffuseColor.a), diffuseColor.a);
    if (diffuseColor.a == 0.0) discard;
  #else
    if (diffuseColor.a < wpCutoff) discard;
  #endif
#else
  #include <alphatest_fragment>
#endif`);
    }
    if (!depth) shader.fragmentShader = shader.fragmentShader.replace('reflectedLight.indirectDiffuse += (ngLight + ', `reflectedLight.indirectDiffuse += (ngLight * ${LAMP_K.toFixed(2)} + `);
  };
  m.customProgramCacheKey = () => `${key}-wp-canopy-v3-leaf-coverage`;
  return m;
}
