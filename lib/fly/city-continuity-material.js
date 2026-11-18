import { Vector4 } from 'three';
import { CITY_HEIGHT_LAYOUT as LAYOUT, CITY_HEIGHT_PAD, CITY_HEIGHT_SIZE } from './city-height-grid.mjs';

export const CITY_MASS_UNIFORMS = {
  uCityGrid: { value: new Vector4() }, // rebased west/north, Mercator span, true metres per scene unit
  uCityLayout: { value: new Vector4() }, // torus slot x/y, inner blend start/end (true metres)
  uCityReady: { value: new Float32Array(16) },
};
let activeAtlas;
export function bindCityMass(texture) {
  activeAtlas = texture;
  CITY_MASS_UNIFORMS.uCityGrid.value.z = 0;
  CITY_MASS_UNIFORMS.uCityReady.value.fill(0);
}
export function releaseCityMass(texture) {
  if (activeAtlas !== texture) return;
  activeAtlas = null;
  CITY_MASS_UNIFORMS.uCityGrid.value.z = 0;
  CITY_MASS_UNIFORMS.uCityReady.value.fill(0);
}

const appearanceDeclaration = 'uniform sampler2D uEarthAppearance;';
const field = `
uniform vec4 uCityGrid, uCityLayout;
uniform float uCityReady[16];
vec3 cityMass(vec2 p,float groundY) {
  if(uCityGrid.z<1.) return vec3(0.);
  vec2 eyeOffset=p-cameraPosition.xz;
  float metres=length(vec3(eyeOffset*uCityGrid.w,cameraPosition.y-groundY));
  // The centred resident square always contains this complete circle. The
  // far footprint follows the aircraft continuously when a row changes slots.
  float rim=1.-smoothstep(1.13,1.47,length(eyeOffset)/uCityGrid.z);
  vec2 cell=(p-uCityGrid.xy)/uCityGrid.z;
  float edge=min(min(cell.x,cell.y),min(4.-cell.x,4.-cell.y));
  if(edge<=0. || rim<=0. || metres<=uCityLayout.z) return vec3(0.);
  vec2 slot=mod(floor(cell)+uCityLayout.xy,4.);
  float index=slot.x+4.*slot.y;
  float ready=uCityReady[int(index)];
  if(ready<=0.) return vec3(0.);
  // The halo, calculated on one global grid, permits hardware bilinear
  // filtering across each geographic boundary independently of slot order.
  vec2 tileStart=vec2(mod(index,${LAYOUT.columns}.),floor(index/${LAYOUT.columns}.))*${CITY_HEIGHT_PAD}.+vec2(0.,${LAYOUT.top}.);
  vec2 uv=(tileStart+1.+${CITY_HEIGHT_SIZE}.*fract(cell))/vec2(${LAYOUT.width}.,${LAYOUT.height}.);
  vec3 sampleH=textureLod(uEarthAppearance,uv,0.).rgb;
  float height=pow(sampleH.r*255./16.,2.);
  float weight=ready*rim*smoothstep(uCityLayout.z,uCityLayout.w,metres);
  return vec3(height,(sampleH.gb*255.-128.)/64.)*weight;
}
`;

export function applyCityMass(shader) {
  Object.assign(shader.uniforms, CITY_MASS_UNIFORMS);
  const vertexAnchor = 'vEarthFlat = wPos.xz;vEarthHeight=wPos.y;';
  const diffuseAnchor = 'diffuseColor.rgb = max(authored,vec3(0.0));';
  if (!shader.vertexShader.includes(vertexAnchor) || !shader.fragmentShader.includes(diffuseAnchor) || !shader.fragmentShader.includes(appearanceDeclaration)) return;
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + appearanceDeclaration + '\n' + field)
    .replace(vertexAnchor, vertexAnchor + '\nwPos.y += cityMass(wPos.xz,wPos.y).x;');
  shader.fragmentShader = shader.fragmentShader.replace(appearanceDeclaration, appearanceDeclaration + '\n' + field)
    .replace(diffuseAnchor, `
    // Directional neighbourhood relief over the actual satellite albedo.
    // A high distant terrain LOD can span multiple observed cells per triangle,
    // so read the measured grade per pixel. Keep the world lighting and haze.
    vec3 city=cityMass(vEarthFlat,vEarthHeight);
    float cityPixel=max(length(dFdx(vEarthFlat)),length(dFdy(vEarthFlat)))*uCityGrid.w;
    float citySample=uCityGrid.z*uCityGrid.w/128.;
    float cityResolved=1.-smoothstep(citySample*.7,citySample*2.4+1.,cityPixel);
    float cityLight=clamp(-dot(city.yz,uEarthSun.xz)*1.8,-.32,.26);
    authored*=1.+cityLight*cityResolved*(1.-earthWater)*uEarthLight.x*(1.-.70*uEarthLight.z);
    ` + diffuseAnchor);
}
