import { DataTexture, LinearFilter, RGBAFormat, Vector4 } from 'three';

const blank = new DataTexture(new Uint8Array([0,128,128,0]), 1, 1, RGBAFormat);
blank.minFilter = blank.magFilter = LinearFilter;
blank.needsUpdate = true;
export const CITY_MASS_UNIFORMS = {
  uCityHeight: { value: blank },
  uCityGrid: { value: new Vector4() }, // rebased west/north, Mercator span, true metres per scene unit
  uCityLayout: { value: new Vector4() }, // torus slot x/y, inner blend start/end (true metres)
  uCityReady: { value: new Float32Array(16) },
};
export function releaseCityMass(texture) {
  if (CITY_MASS_UNIFORMS.uCityHeight.value !== texture) return;
  CITY_MASS_UNIFORMS.uCityHeight.value = blank;
  CITY_MASS_UNIFORMS.uCityGrid.value.z = 0;
  CITY_MASS_UNIFORMS.uCityReady.value.fill(0);
}

const field = `
uniform sampler2D uCityHeight;
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
  float ready=uCityReady[int(slot.x)+4*int(slot.y)];
  if(ready<=0.) return vec3(0.);
  // The halo, calculated on one global grid, permits hardware bilinear
  // filtering across each geographic boundary independently of slot order.
  vec2 uv=(130.*slot+1.+128.*fract(cell))/520.;
  vec3 sampleH=textureLod(uCityHeight,uv,0.).rgb;
  float height=pow(sampleH.r*255./16.,2.);
  float weight=ready*rim*smoothstep(uCityLayout.z,uCityLayout.w,metres);
  return vec3(height,(sampleH.gb*255.-128.)/64.)*weight;
}
`;

export function applyCityMass(shader) {
  Object.assign(shader.uniforms, CITY_MASS_UNIFORMS);
  const vertexAnchor = 'vEarthFlat = wPos.xz;vEarthHeight=wPos.y;';
  const diffuseAnchor = 'diffuseColor.rgb = max(authored,vec3(0.0));';
  if (!shader.vertexShader.includes(vertexAnchor) || !shader.fragmentShader.includes(diffuseAnchor)) return;
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + field)
    .replace(vertexAnchor, vertexAnchor + '\nwPos.y += cityMass(wPos.xz,wPos.y).x;');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + field)
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
