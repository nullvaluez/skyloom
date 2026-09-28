import { applyPainterlySurface, PAINTERLY_UNIFORMS } from './painterly-flight';

/** Player-only material treatment. Keep source colour/maps, vertices, scale,
 * gear and navigation lights. Marks follow the airframe, never the camera. */
export function applyPainterlyAircraft(material, isGlass, metresPerUnit=1) {
  const exposedMetal = !isGlass && material.metalness > .6;
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=(shader,renderer)=>{
    previous?.(shader,renderer);Object.assign(shader.uniforms,PAINTERLY_UNIFORMS);
    shader.uniforms.uPaintModelScale={value:metresPerUnit};
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vPaintHull;\nuniform float uPaintModelScale;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvPaintHull=position*uPaintModelScale;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vPaintHull;\nuniform float uPainterly;')
      .replace('#include <color_fragment>',`#include <color_fragment>
if(uPainterly>.5){
  float footprint=max(length(dFdx(vPaintHull)),length(dFdy(vPaintHull)));
  float brush=sin(vPaintHull.z*2.1+sin(vPaintHull.x*.8))*sin(vPaintHull.y*3.7+vPaintHull.x*.43);
  float resolved=1.0-smoothstep(.12,.8,footprint);
  diffuseColor.rgb*=1.0+brush*${isGlass?'0.0':'0.008'}*resolved;
}`)
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
if(uPainterly>.5)roughnessFactor=${isGlass?'clamp(roughnessFactor,.08,.18)':exposedMetal?'clamp(roughnessFactor,.24,.42)':'clamp(roughnessFactor,.27,.46)'};`)
      .replace('#include <metalnessmap_fragment>',`#include <metalnessmap_fragment>
if(uPainterly>.5)metalnessFactor=${isGlass?'min(metalnessFactor,.28)':exposedMetal?'max(metalnessFactor,.72)':'min(metalnessFactor,.28)'};`)
      .replace('rimF * uRimStrength','rimF * uRimStrength * (uPainterly>.5?0.45:1.0)');
  };
  material.customProgramCacheKey=()=>`${key}|cinematic-airframe-${isGlass?'glass':exposedMetal?'metal':'hull'}-v2`;
  return applyPainterlySurface(material,isGlass?'glass':'hull');
}
