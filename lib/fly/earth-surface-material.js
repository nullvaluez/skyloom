import { DataTexture, LinearFilter, NoColorSpace, RGBAFormat, Vector2, Vector3, Vector4 } from 'three';
import { STYLIZED_EARTH } from './stylized-earth';

const empty = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat);
empty.needsUpdate = true;
export const EARTH_UNIFORMS = {
  uEarthOn: { value: 0 }, uEarthTime: { value: 0 },
  uEarthPattern: { value: new Vector3() },
  uEarthSun: { value: new Vector3(0, 1, 0) },
  uEarthLight: { value: new Vector4(1, 0, 0, 1) },
};
for (let i = 0; i < STYLIZED_EARTH.bands.length; i++) Object.assign(EARTH_UNIFORMS, {
  [`uEarthMap${i}`]: { value: empty }, [`uEarthBounds${i}`]: { value: new Vector4() },
  [`uEarthSlots${i}`]: { value: new Vector2() }, [`uEarthBorn${i}`]: { value: new Float32Array(16).fill(-100) },
});

export function makeEarthAtlas(size) {
  const t = new DataTexture(new Uint8Array(size * size * 4), size, size, RGBAFormat);
  t.minFilter = t.magFilter = LinearFilter;
  t.colorSpace = NoColorSpace; t.generateMipmaps = false; t.needsUpdate = true;
  t.name = 'stylized-earth-surface-atlas';
  return t;
}

export function clearEarthUniforms() {
  EARTH_UNIFORMS.uEarthOn.value = 0;
  for (let i = 0; i < 3; i++) EARTH_UNIFORMS[`uEarthMap${i}`].value = empty;
}

const declarations = STYLIZED_EARTH.bands.map((band, i) => `
uniform sampler2D uEarthMap${i};
uniform vec4 uEarthBounds${i};
uniform vec2 uEarthSlots${i};
uniform float uEarthBorn${i}[16];
vec4 earthBand${i}(vec2 p, out float amount) {
  vec2 cell = (p-uEarthBounds${i}.xy)/max(1.0,uEarthBounds${i}.z);
  amount = 0.0;
  if (any(lessThan(cell,vec2(0.0))) || any(greaterThanEqual(cell,vec2(4.0)))) return vec4(0.0);
  vec2 slot = mod(floor(cell)+uEarthSlots${i},4.0);
  vec2 inset = clamp(fract(cell),vec2(${(0.5/band.size).toFixed(9)}),vec2(${(1-0.5/band.size).toFixed(9)}));
  vec4 value = texture2D(uEarthMap${i},(slot+inset)/4.0);
  float edge = min(min(cell.x,cell.y),min(4.0-cell.x,4.0-cell.y));
  int index = int(slot.x)+int(slot.y)*4;
  amount = smoothstep(0.0,0.65,edge)*smoothstep(0.0,${STYLIZED_EARTH.birthSec.toFixed(1)},uEarthTime-uEarthBorn${i}[index])*smoothstep(0.0,0.24,value.a);
  return value;
}`).join('\n');

/** One shader on the existing terrain. Water cannot intersect a second flat sheet. */
export function applyEarthSurface(material) {
  if (!material || material.userData.earthSurface || material.isMeshDepthMaterial) return;
  material.userData.earthSurface = true;
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    Object.assign(shader.uniforms, EARTH_UNIFORMS);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vEarthWorld;\nvarying vec2 vEarthFlat;')
      .replace('float bendD = distance( wPos.xz, uBendCenter );', 'vEarthFlat = wPos.xz;\nfloat bendD = distance( wPos.xz, uBendCenter );')
      .replace('vec4 mvPosition = viewMatrix * wPos;', 'vEarthWorld = wPos.xyz;\nvec4 mvPosition = viewMatrix * wPos;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vEarthWorld;
varying vec2 vEarthFlat;
uniform float uEarthOn;
uniform float uEarthTime;
uniform vec3 uEarthPattern;
uniform vec3 uEarthSun;
uniform vec4 uEarthLight;
${declarations}
`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float earthWater = 0.0;
float earthWood = 0.0;
vec2 earthMetres = vEarthFlat + uEarthPattern.xy;
vec2 earthDomain = earthMetres * 0.00076699039394282;
if (uEarthOn > 0.5) {
  vec3 source = diffuseColor.rgb;
  float sourceLuma = dot(source,vec3(0.2126,0.7152,0.0722));
  // Unknown land retains its photographic geography with a quiet, unified grade.
  float quietValue = mix(sourceLuma,pow(max(sourceLuma,0.002),0.82)*0.88,0.65);
  vec3 authored = mix(vec3(sourceLuma),source,1.18)*quietValue/max(0.002,sourceLuma);
  vec3 earthFallback = authored;
  float coverage = 0.0;
  ${[0,1,2].map(i=>`{
    float amount; vec4 surface = earthBand${i}(vEarthFlat,amount);
    float water = smoothstep(0.68,0.99,surface.a);
    vec3 albedo = surface.rgb * (0.80 + 0.34 * clamp(sourceLuma / 0.24,0.0,1.5));
    // Photographic field boundaries remain; baked shadows no longer dominate.
    float classified = smoothstep(0.28,0.46,surface.a);
    authored = mix(authored,mix(earthFallback,mix(source,albedo,0.78),classified),amount);
    earthWater = mix(earthWater,water,amount);
    float wood = 1.0-smoothstep(0.025,0.10,distance(surface.rgb,vec3(0.055,0.15,0.041)));
    earthWood = mix(earthWood,wood,amount);
    coverage = mix(coverage,classified,amount);
  }`).join('\n')}
  // Broad soil variation plus analytically filtered close detail. No noise textures.
  float pixelM = max(length(dFdx(earthMetres)),length(dFdy(earthMetres))) / max(1.0,uEarthPattern.z);
  float grain = sin(earthDomain.x*2239.0)*sin(earthDomain.y*1717.0);
  float detail = (1.0-smoothstep(0.25,1.5,pixelM))*0.035;
  authored *= 1.0 + grain*detail*coverage*(1.0-earthWater);
  // Distant woodland retains a broad canopy value; resolved forest texture
  // responds to the real sun without placing millions of individual trees.
  vec2 forest = earthDomain*93.0;
  float canopy = sin(forest.x)*cos(forest.y);
  float canopyDetail = 1.0-smoothstep(4.0,18.0,pixelM);
  float canopyLight = (uEarthSun.x*cos(forest.x)*cos(forest.y)-uEarthSun.z*sin(forest.x)*sin(forest.y))*.14*uEarthLight.x;
  authored *= 1.0-earthWood*.09+earthWood*canopyDetail*(canopy*.035+canopyLight);
  diffuseColor.rgb = max(authored,vec3(0.0));
}
`)
      .replace('#include <opaque_fragment>', `
if (uEarthOn > 0.5 && earthWater > 0.001) {
  float day = uEarthLight.x, night = uEarthLight.y, overcast = uEarthLight.z;
  float t = mod(uEarthTime,628.31853);
  vec2 wp = earthDomain*419.0;
  float footprint = max(length(dFdx(wp)),length(dFdy(wp)));
  float ripple = 1.0-smoothstep(0.4,2.0,footprint);
  vec3 wn = normalize(vec3(sin(dot(earthDomain,vec2(419.0,317.0))+t*.4)*0.014*ripple,1.0,cos(dot(earthDomain,vec2(-157.0,463.0))-t*.3)*0.012*ripple));
  vec3 view = normalize(cameraPosition-vEarthWorld);
  float fresnel = pow(1.0-clamp(dot(wn,view),0.0,1.0),4.0);
  vec3 sky = mix(vec3(0.014,0.025,0.047),vec3(0.24,0.40,0.54),day);
  sky = mix(sky,vec3(dot(sky,vec3(.2126,.7152,.0722))),overcast*.52);
  vec3 water = mix(mix(vec3(.006,.017,.025),vec3(.035,.15,.19),day),sky,.12+fresnel*.76);
  float glint = pow(max(dot(reflect(-view,wn),uEarthSun),0.0),90.0)*day*(1.0-overcast);
  water += vec3(1.0,.84,.62)*glint*.7;
  water += vec3(.008,.014,.025)*night;
  outgoingLight = mix(outgoingLight,water,earthWater);
}
#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `${key}-earth-surface-v1`;
  material.needsUpdate = true;
}
