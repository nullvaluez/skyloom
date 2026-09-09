import { DoubleSide, MeshStandardMaterial, Vector4 } from 'three';
import { BUILDING_PROFILES, ARCHITECTURE_UV_PERIOD } from './building-profiles';
import { applyBendAnchorSat, applyBendAnchorSatSkyline } from './toy-world/world-bend';

const profileGLSL = BUILDING_PROFILES.map((p, i) => `${i ? 'else ' : ''}if (family < ${(i + 0.5).toFixed(1)}) {
  pitch = vec2(${p.pitch.toFixed(2)}, ${p.floor.toFixed(2)});
  opening = vec2(${p.window.map((x) => x.toFixed(2)).join(', ')});
  baseRough = ${p.roughness.toFixed(2)}; occupancy = ${p.occupancy.toFixed(2)}; warmth = ${p.warmth.toFixed(2)};
}`).join('\n');

/** Same factory used at runtime and shader prewarm. Exactly one material per ring.
 * Procedural facade masks are an analytic atlas: no per-building textures/draws.
 */
export function createSatelliteArchitectureMaterial({ distant = false, lighting = true, fadeUniform } = {}) {
  const material = new MeshStandardMaterial({ vertexColors: true, side: DoubleSide, roughness: 0.82, metalness: 0.02, envMapIntensity: 0.5 });
  if (distant) applyBendAnchorSatSkyline(material, fadeUniform);
  else applyBendAnchorSat(material, null, fadeUniform);
  const bendKey = material.customProgramCacheKey();
  const state = { uArchitectureNight: { value: 0 }, uArchitectureLighting: { value: lighting ? 1 : 0 }, uArchitectureDetail: { value: distant ? 0 : 1 } };
  if (distant) Object.assign(state, {
    uArchitectureTiles: { value: Array.from({ length: 24 }, () => new Vector4()) },
    uArchitectureTileCount: { value: 0 }, uArchitectureNearFade: { value: 0 },
  });
  material.userData.architecture = { distant, uniforms: state };
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    Object.assign(shader.uniforms, state);
    if (distant) {
      // Mask only resident detailed tiles; a fixed circular hole outlives a quality reduction.
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
uniform vec4 uArchitectureTiles[24];
uniform float uArchitectureTileCount;
varying float vArchitectureCovered;`).replace('vSkyDist = bendD;', `vSkyDist = bendD;
vArchitectureCovered = 0.0;
for (int i = 0; i < 24; i++) {
  if (float(i) >= uArchitectureTileCount) break;
  vec4 tile = uArchitectureTiles[i];
  if (all(greaterThanEqual(wAnchor.xz, tile.xy)) && all(lessThan(wAnchor.xz, tile.zw))) vArchitectureCovered = 1.0;
}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vArchitectureCovered;\nuniform float uArchitectureNearFade;')
        .replace('if ( uSkyHole.x > 0.0 ) skyA *= smoothstep( uSkyHole.x, uSkyHole.x + uSkyHole.y, vSkyDist );',
          'if (vArchitectureCovered > 0.5 && wbBayer4(gl_FragCoord.xy) < uArchitectureNearFade) discard;');
    }
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec3 aBuildingStyle;
varying vec3 vBuildingStyle;
varying vec2 vFacadeMetres;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vBuildingStyle = aBuildingStyle;
vFacadeMetres = (uv - vec2(0.5, 0.0)) * vec2(${ARCHITECTURE_UV_PERIOD.join(', ')});`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vBuildingStyle;
varying vec2 vFacadeMetres;
uniform float uArchitectureNight;
uniform float uArchitectureLighting;
uniform float uArchitectureDetail;
float archHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
`).replace('#include <color_fragment>', `#include <color_fragment>
// Style bytes are discrete even though WebGL interpolates the varying. Tiny
// perspective interpolation errors in a constant seed become visible static
// after the occupancy sine hash amplifies them. Recover exact integers first.
vec3 style = floor(vBuildingStyle + 0.5);
float family = style.x;
float seed = style.y;
float isWall = style.z;
vec2 pitch = vec2(3.0,3.4), opening = vec2(0.45,0.6);
float baseRough = 0.85, occupancy = 0.5, warmth = 0.5;
${profileGLSL}
pitch.x *= 0.94 + 0.12 * fract(seed * 0.137);
vec2 cell = vFacadeMetres / pitch;
vec2 width = max(fwidth(cell), vec2(0.001));
vec2 pane = 1.0 - smoothstep(opening * 0.5 - width, opening * 0.5 + width, abs(fract(cell) - 0.5));
float paneMask = pane.x * pane.y * isWall * step(0.5, vFacadeMetres.y);
// Fade subpixel windows to their area average instead of sparkling during motion.
float minify = smoothstep(0.3, 1.4, max(width.x,width.y));
paneMask = mix(paneMask, opening.x * opening.y * isWall, minify);
float isGlass = step(3.5,family) * (1.0-step(4.5,family));
// The vertex albedo already identifies the stable facade palette variant.
// Keep neutral/bronze/charcoal glazing coordinated with it instead of applying
// a cyan filter to every material; only a blue source variant reads blue.
vec3 glazing = mix(vec3(0.28), mix(vec3(0.32), diffuseColor.rgb, 0.35), isGlass);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * glazing + 0.035, paneMask);
// Narrow masonry courses and concrete floor bands are restricted to resolved facades.
float mortar = (1.0-smoothstep(0.025,0.085,abs(fract(vFacadeMetres.y / 0.24)-0.5))) * (1.0-minify);
float isMasonry = step(1.5,family) * (1.0-step(2.5,family));
diffuseColor.rgb *= 1.0 - isMasonry * isWall * mortar * ${distant ? '0.0' : '0.10'};
float entrance = (1.0-smoothstep(0.85,1.05,abs(vFacadeMetres.x))) * step(0.0,vFacadeMetres.y) * (1.0-step(2.5,vFacadeMetres.y)) * isWall;
diffuseColor.rgb *= 1.0 - entrance * ${distant ? '0.0' : '0.38'};
`).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(baseRough, mix(0.38,0.19,isGlass), paneMask);
`).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
// Analytic facade relief in the same metre-based atlas. Uniformly disabled on
// medium/low and distant geometry; no normal textures or extra draw calls.
if (uArchitectureDetail > 0.5 && isWall > 0.5) {
  float relief = (-0.035 * paneMask - 0.006 * isMasonry * mortar) * (1.0-minify);
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
  vec3 rx = cross(dy, normal), ry = cross(normal, dx);
  float determinant = dot(dx, rx);
  if (abs(determinant) > 0.00000001) normal = normalize(abs(determinant)*normal - sign(determinant)*(dFdx(relief)*rx + dFdy(relief)*ry));
}
`).replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(0.02, 0.22, paneMask * isGlass);
`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
// Floor and suite occupancy remain stable through time, re-streams and LOD changes.
float darkBuilding = step(0.09, fract(seed * 0.173));
float floorOccupied = step(0.20, archHash(vec2(floor(cell.y), seed)));
float suiteOccupied = step(1.0-occupancy*0.75, archHash(vec2(floor(cell.x / 2.0)+seed, floor(cell.y))));
float occupied = mix(floorOccupied*suiteOccupied, occupancy*0.6, minify);
vec3 lamp = mix(vec3(0.60,0.72,0.86),vec3(1.0,0.51,0.20),clamp(warmth+(fract(seed*0.071)-0.5)*0.18,0.0,1.0));
float glow = paneMask * occupied * darkBuilding * (0.14 + fract(seed*0.113)*0.24);
glow += entrance * ${distant ? '0.0' : '0.19'} * darkBuilding;
totalEmissiveRadiance += lamp * glow * uArchitectureNight * uArchitectureLighting;
`);
  };
  material.customProgramCacheKey = () => `${bendKey}|cinematic-architecture-v3-${distant ? 'far-coverage' : 'near'}`;
  return material;
}

export function setSatelliteArchitectureNight(material, sunFrac = 1) {
  const state = material?.userData.architecture;
  if (!state) return;
  const t = Math.max(0, Math.min(1, 1 - sunFrac / 0.36));
  state.uniforms.uArchitectureNight.value = t * t;
}

export function setSatelliteArchitectureDetail(material, enabled) {
  const u = material?.userData.architecture?.uniforms;
  if (u) u.uArchitectureDetail.value = enabled ? 1 : 0;
}

/** Update after the detailed ring, before skyline rendering. Bounds are rebased every frame. */
export function setSatelliteArchitectureCoverage(material, buildings, origin, fade = 1) {
  const u = material?.userData.architecture?.uniforms;
  if (!u?.uArchitectureTiles) return;
  let count = 0;
  if (buildings?.object.visible) for (const c of buildings.chunks.values()) {
    if (count === 24) break;
    if (c.state !== 'ready' || !c.mesh?.visible) continue;
    const half = Math.PI * 6378137 / (2 ** c.tile.z);
    const x = c.mesh.position.x - (origin?.x || 0), z = c.mesh.position.z - (origin?.z || 0);
    u.uArchitectureTiles.value[count++].set(x - half, z - half, x + half, z + half);
  }
  u.uArchitectureTileCount.value = count;
  u.uArchitectureNearFade.value = Math.max(0, Math.min(1, fade));
}
