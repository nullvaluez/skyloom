import { DataTexture, LinearFilter, NearestFilter, NoColorSpace, RedFormat, RGBAFormat, Vector2, Vector3, Vector4 } from 'three';
import { STYLIZED_EARTH } from './stylized-earth';
import { CINEMATIC_MATERIAL_UNIFORMS, CINEMATIC_MATERIAL_GLSL } from './cinematic-materials';

const empty = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat);
empty.needsUpdate = true;
export const EARTH_UNIFORMS = {
  uEarthOn: { value: 0 }, uEarthTime: { value: 0 },
  uEarthPattern: { value: new Vector3() },
  uEarthMaterialPhase: { value: new Vector2() },
  uEarthSun: { value: new Vector3(0, 1, 0) },
  uEarthLight: { value: new Vector4(1, 0, 0, 1) },
};
for (let i = 0; i < STYLIZED_EARTH.bands.length; i++) Object.assign(EARTH_UNIFORMS, {
  [`uEarthMap${i}`]: { value: empty }, [`uEarthBounds${i}`]: { value: new Vector4() },
  [`uEarthClass${i}`]: { value: empty },
  [`uEarthSlots${i}`]: { value: new Vector2() }, [`uEarthBorn${i}`]: { value: new Float32Array(16).fill(-100) },
});

export function makeEarthAtlas(size) {
  const t = new DataTexture(new Uint8Array(size * size * 4), size, size, RGBAFormat);
  t.minFilter = t.magFilter = LinearFilter;
  t.colorSpace = NoColorSpace; t.generateMipmaps = false; t.needsUpdate = true;
  t.name = 'stylized-earth-surface-atlas';
  return t;
}

export function makeEarthClassAtlas(size) {
  const texture=new DataTexture(new Uint8Array(size*size),size,size,RedFormat);
  texture.minFilter=texture.magFilter=NearestFilter;texture.generateMipmaps=false;
  texture.colorSpace=NoColorSpace;texture.needsUpdate=true;texture.name='cinematic-surface-identities';return texture;
}

export function clearEarthUniforms() {
  EARTH_UNIFORMS.uEarthOn.value = 0;
  for (let i = 0; i < 3; i++) { EARTH_UNIFORMS[`uEarthMap${i}`].value = empty; EARTH_UNIFORMS[`uEarthClass${i}`].value = empty; }
}

const declarations = STYLIZED_EARTH.bands.map((band, i) => `
uniform sampler2D uEarthMap${i};
uniform sampler2D uEarthClass${i};
uniform vec4 uEarthBounds${i};
uniform vec2 uEarthSlots${i};
uniform float uEarthBorn${i}[16];
vec4 earthBand${i}(vec2 p, out float amount, out float identity) {
  vec2 cell = (p-uEarthBounds${i}.xy)/max(1.0,uEarthBounds${i}.z);
  amount = 0.0;
  identity = 0.0;
  if (any(lessThan(cell,vec2(0.0))) || any(greaterThanEqual(cell,vec2(4.0)))) return vec4(0.0);
  vec2 slot = mod(floor(cell)+uEarthSlots${i},4.0);
  vec2 inset = clamp(fract(cell),vec2(${(0.5/band.size).toFixed(9)}),vec2(${(1-0.5/band.size).toFixed(9)}));
  vec4 value = texture2D(uEarthMap${i},(slot+inset)/4.0);
  identity = floor(texture2D(uEarthClass${i},(slot+inset)/4.0).r*255.0+0.5);
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
    Object.assign(shader.uniforms, CINEMATIC_MATERIAL_UNIFORMS);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vEarthWorld;\nvarying vec2 vEarthFlat;')
      .replace('float bendD = distance( wPos.xz, uBendCenter );', 'vEarthFlat = wPos.xz;\nfloat bendD = distance( wPos.xz, uBendCenter );')
      .replace('vec4 mvPosition = viewMatrix * wPos;', 'vEarthWorld = wPos.xyz;\nvec4 mvPosition = viewMatrix * wPos;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vEarthWorld;
varying vec2 vEarthFlat;
uniform float uEarthOn;
uniform float uEarthTime;
uniform vec3 uEarthPattern;
uniform vec2 uEarthMaterialPhase;
uniform vec3 uEarthSun;
uniform vec4 uEarthLight;
${declarations}
${CINEMATIC_MATERIAL_GLSL}
// A 4096 m period matches the transported origin phase. Unlike absolute
// Mercator noise, this field neither swims with latitude nor jumps on rebases.
float earthNoise(vec2 p) {
  vec2 cell=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  vec4 h=vec4(dot(mod(cell,128.0),vec2(127.1,311.7)),dot(mod(cell+vec2(1,0),128.0),vec2(127.1,311.7)),dot(mod(cell+vec2(0,1),128.0),vec2(127.1,311.7)),dot(mod(cell+vec2(1,1),128.0),vec2(127.1,311.7)));
  h=fract(sin(h)*43758.5453);
  return mix(mix(h.x,h.y,f.x),mix(h.z,h.w,f.x),f.y);
}
`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float earthWater = 0.0;
float earthWood = 0.0;
float earthCanopyHeight = 0.0;
float earthCanopyAmount = 0.0;
float earthMaterial = -1.0;
float earthMaterialWeight = 0.0;
vec4 earthTex = vec4(0.5,0.5,0.5,0.9);
vec4 earthRelief = vec4(0.5,0.5,0.5,1.0);
// Phase in physical metres is supplied separately: constant metre scale at every latitude.
vec2 earthUV = (vEarthFlat / max(1.0,uEarthPattern.z) + uEarthMaterialPhase) / ${STYLIZED_EARTH.materials.repeatM.toFixed(1)};
vec2 earthMetres = vEarthFlat + uEarthPattern.xy;
vec2 earthDomain = earthMetres * 0.00076699039394282;
if (uEarthOn > 0.5) {
  vec3 source = diffuseColor.rgb;
  float sourceLuma = dot(source,vec3(0.2126,0.7152,0.0722));
  // Keep unknown geography, but remove the old lifted photographic black level.
  // This changes material albedo before lighting, not exposure or the final image.
  float quietValue = mix(sourceLuma,pow(max(sourceLuma,0.002),1.08)*0.92,uEarthLight.x*0.65);
  vec3 authored = mix(vec3(sourceLuma),source,1.18)*quietValue/max(0.002,sourceLuma);
  vec3 earthFallback = authored;
  // A broad woodland polygon can include dry soil and exposed rock. Use the
  // imagery's local chroma to modulate its lushness, without changing geometry
  // or inferring new landcover. Bright arid ground must not become green carpet.
  float vegetationSupport = smoothstep(-0.02,0.16,(source.g-max(source.r,source.b))/max(0.02,sourceLuma));
  float coverage = 0.0;
  ${[0,1,2].map(i=>`{
    float amount, identity; vec4 surface = earthBand${i}(vEarthFlat,amount,identity);
    float water = smoothstep(0.68,0.99,surface.a);
    float classified = clamp((surface.a*255.0-64.0)/64.0,0.0,1.0);
    vec3 surfaceColor = surface.rgb/max(classified,1.0/64.0);
    // Category data establishes the material, not the crop's current color or
    // reflectance. Preserve photographic field/forest variation instead of
    // lifting every classified patch toward the same pale palette value.
    float paletteLuma=dot(surfaceColor,vec3(.2126,.7152,.0722));
    vec3 albedo=surfaceColor*clamp((sourceLuma+.006)/max(.025,paletteLuma),.10,2.0);
    float wood = float(identity==2.0);
    float grass = float(identity==1.0);
    float vegetation = max(wood,grass);
    float nearSurface = 1.0-smoothstep(900.0,2600.0,length(cameraPosition-vEarthWorld)/max(1.0,uEarthPattern.z));
    // At low flight the classified surface owns its albedo. Bounded photographic
    // variation preserves fields without treating baked shadows as material.
    float macroValue = clamp(sqrt(max(.01,sourceLuma)/max(.025,paletteLuma)),.65,1.25);
    albedo = surfaceColor*macroValue;
    float materialWeight = mix(.55,.94,nearSurface);
    // WorldCover's bare/sparse class does not distinguish sand, soil and rock.
    // Keep its photographic color; only the resolved mineral detail is shared.
    if(identity==14.0){ materialWeight=.55*nearSurface; albedo=mix(vec3(.19,.16,.12),source, .5)*macroValue; }
    if(identity==3.0){ materialWeight=mix(.15,.88,nearSurface); albedo=mix(surfaceColor,source,.25)*macroValue; }
    // Photographic field boundaries remain; baked shadows no longer dominate.
    authored = mix(authored,mix(earthFallback,mix(earthFallback,albedo,materialWeight),classified),amount);
    earthWater = mix(earthWater,water,amount);
    earthWood = mix(earthWood,wood*classified,amount);
    float nextLayer=cmLayer(identity);
    // A different material fades through the photographic base before its ID
    // switches. Switching two fully weighted IDs at the midpoint made a pop
    // whenever a finer classification arrived with a different surface family.
    float nextWeight=nextLayer<0.0?0.0:classified;
    if(nextLayer==earthMaterial) earthMaterialWeight=mix(earthMaterialWeight,nextWeight,amount);
    else if(amount<=0.5) earthMaterialWeight*=1.0-smoothstep(0.0,0.5,amount);
    else {earthMaterial=nextLayer;earthMaterialWeight=nextWeight*smoothstep(0.5,1.0,amount);}
    coverage = mix(coverage,classified,amount);
  }`).join('\n')}
  // Broad soil variation plus analytically filtered close detail. No noise textures.
  float pixelM = max(length(dFdx(earthMetres)),length(dFdy(earthMetres))) / max(1.0,uEarthPattern.z);
  float cameraM=length(cameraPosition-vEarthWorld)/max(1.0,uEarthPattern.z);
  earthMaterialWeight *= uCinematicMaterials*(1.0-smoothstep(${STYLIZED_EARTH.materials.fadeStartM.toFixed(1)},${STYLIZED_EARTH.materials.fadeEndM.toFixed(1)},cameraM))*(1.0-earthWater);
  if(earthMaterial>=0.0 && earthMaterialWeight>0.001){
    earthTex=cmColor(earthUV,earthMaterial);earthRelief=cmDetail(earthUV,earthMaterial);
    // Multiplicative material detail keeps local imagery markings and colour hierarchy.
    authored *= mix(vec3(1.0),clamp(earthTex.rgb*2.05,vec3(.50),vec3(1.45)),earthMaterialWeight*.62);
    // Known pavement gets its own albedo. Bright photographic markings remain
    // above it; centreline-only airports continue to retain their source imagery.
    if(earthMaterial<1.5){
      vec3 paving=earthMaterial<.5?vec3(.085,.090,.092):vec3(.30,.29,.265);
      float marking=smoothstep(.32,.67,sourceLuma);
      vec3 pavement=paving*clamp(earthTex.rgb*2.3,vec3(.55),vec3(1.45));
      pavement=mix(pavement,source*.80,marking*.86);
      authored=mix(authored,pavement,earthMaterialWeight*.82);
    }
  }
  // Apply the albedo range after classification as well: grading only the
  // source photograph left mapped developed land and grass just as washed out.
  // Snow retains its high reflectance. Night keeps the existing visibility floor.
  float daylightMaterial=uCinematicMaterials*uEarthLight.x;
  authored*=mix(1.0,earthMaterial==7.0?.93:${STYLIZED_EARTH.materials.groundValue.toFixed(2)},daylightMaterial);
  // Medium-scale soil/grass/rock variation stays visible between fine texels
  // and whole geographic fields. No invented roads, parcels or surface classes.
  float mediumAmount=coverage*(1.0-earthWater)*uCinematicMaterials*(1.0-smoothstep(12.0,40.0,pixelM));
  float groundStructure=earthNoise(earthUV*.125)-.5;
  authored*=1.0+groundStructure*.28*mediumAmount;
  // Distant woodland retains a broad canopy value; resolved forest texture
  // responds to the real sun without placing millions of individual trees.
  float canopyDetail = 1.0-smoothstep(4.0,18.0,pixelM);
  float canopy = earthNoise(earthUV*.25);
  // Differentiate only the continuous height field. Differentiating the
  // categorical mask drew false black "cliffs" around every forest pixel.
  earthCanopyHeight=canopy*6.0;
  earthCanopyAmount=earthWood*canopyDetail*uCinematicMaterials;
  authored *= 1.0-earthWood*.16+earthWood*canopyDetail*(canopy-.5)*.20;
  diffuseColor.rgb = max(authored,vec3(0.0));
}
`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if(earthMaterialWeight>0.001) normal=cmNormal(normal,-vViewPosition,earthUV,earthRelief.xy,earthMaterialWeight*.68);
// Broad forest crowns respond to the actual scene lights between individual
// trees. This replaces the old regular sine-grid shading, without new geometry.
vec3 earthDx=dFdx(-vViewPosition),earthDy=dFdy(-vViewPosition);
vec3 earthR1=cross(earthDy,normal),earthR2=cross(normal,earthDx);
float earthDet=dot(earthDx,earthR1);
if(abs(earthDet)>1e-8){
  vec3 earthGradient=sign(earthDet)*(dFdx(earthCanopyHeight)*earthR1+dFdy(earthCanopyHeight)*earthR2);
  normal=normalize(abs(earthDet)*normal-earthGradient*earthCanopyAmount);
}
`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor=mix(roughnessFactor,earthTex.a,earthMaterialWeight*.65);
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
  material.customProgramCacheKey = () => `${key}-earth-surface-v7-living`;
  material.needsUpdate = true;
}
