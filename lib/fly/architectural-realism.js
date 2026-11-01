/** TRUE EARTH — material identity before lighting, never a screen colour wash.
 * One shared shader for mapped near/far architecture. No new textures, geometry,
 * draws or random frame state. Every fragment edit carries cityDay, so Classic
 * and the existing full-night treatment retain their appearance.
 */
import { BUILDING_REALISM } from './fly-constants';
import { pinned } from './fly-pins';
import { facadeMinify } from './facade-filtering';

export const BUILDING_REALISM_ACTIVE = pinned(BUILDING_REALISM, '__flyBuildingRealismOverride');
export const BUILDING_REALISM_ON = BUILDING_REALISM_ACTIVE.enabled === true;
export const BUILDING_REALISM_KEY = '|architectural-realism-v1';

/** sRGB reflectance colours, decoded once by cityRegionPalette. Warm masonry is
 * a material among others; plaster, concrete and glass do not inherit its hue.
 * Keep regional construction differences without turning regions into filters.
 */
export const REALISTIC_CITY_PALETTE = {
  regions: {
    temperate: { masonry: ['#795f58', '#907a72', '#bebbb1', '#9b9d99'], render: ['#d0d1cb', '#b7b9b3', '#979fa0', '#c0c4c1'], pitched: ['#484d51', '#62524d'], concrete: ['#b5b9b7', '#909899'] },
    europe: { masonry: ['#8b665a', '#796259', '#c0baac', '#a6a69f'], render: ['#d6d4ca', '#c1c0b5', '#b3b8b4', '#d1ccc1'], pitched: ['#8c6253', '#4c535a'], concrete: ['#b9bbb6', '#969e9d'] },
    mediterranean: { masonry: ['#b1a18c', '#9d8978', '#c4b9a6', '#988a7b'], render: ['#dedcd2', '#d3c9b5', '#c7b9a5', '#c6c6ba'], pitched: ['#9c6d56', '#80695b'], concrete: ['#c0c0b6', '#9fa69f'] },
    'east-asia': { masonry: ['#c0c2bc', '#abb2ad', '#979d97', '#858c8a'], render: ['#d6d9d3', '#c6cdca', '#b4bcb8', '#acb6b5'], pitched: ['#4c5860', '#414a4e'], concrete: ['#c0c5c0', '#99a3a2'] },
    'tropical-asia': { masonry: ['#b5aa96', '#a49885', '#999e95', '#c3bbac'], render: ['#d7d8cc', '#c6c6b6', '#bbc9bf', '#c9bfb3'], pitched: ['#836256', '#635c54'], concrete: ['#b3bcb4', '#949f99'] },
    'south-asia': { masonry: ['#b39b87', '#968473', '#aaa697', '#8e8074'], render: ['#d3d0c3', '#c7bfaa', '#bcc1b9', '#cdbdab'], pitched: ['#8f7663', '#706d60'], concrete: ['#b5b8ac', '#979f93'] },
    arid: { masonry: ['#c5b8a0', '#b7a88e', '#ada28e', '#d1c6af'], render: ['#dddccf', '#d2cbb7', '#c7c1ad', '#bebeb0'], pitched: ['#a79f87', '#928b76'], concrete: ['#c4c6b7', '#a8afa1'] },
    latin: { masonry: ['#976f5e', '#82665a', '#b2a28e', '#aaa294'], render: ['#d4d4c8', '#c8c5ae', '#c1cac1', '#c7bbb0'], pitched: ['#91634e', '#746458'], concrete: ['#b3b9b0', '#929d98'] },
    oceania: { masonry: ['#936e5c', '#ab9581', '#bcb7a7', '#7c6e64'], render: ['#d4d7cf', '#c1c5b8', '#b4bebb', '#c6c8ba'], pitched: ['#4d585d', '#635650'], concrete: ['#b4bcb5', '#969f9b'] },
  },
  glass: ['#27353e', '#34454c', '#424a48', '#333d45', '#4c5860'],
  metal: ['#b8bfbd', '#a3adaa', '#87979c', '#c8ceca'],
  flatRoofs: ['#c6c8c3', '#9d9f96', '#70787b', '#3d454b', '#55645a'],
  flatRoofShares: [0.20, 0.23, 0.32, 0.22, 0.03],
  claddingCuts: { apartment: [0.34, 0.72, 0.96], masonry: [0.72, 0.84, 0.98], office: [0.13, 0.23, 0.61] },
  frame: { mullion: 0.024, spandrel: 0.075 },
  reflect: 1.85,
  skyBias: 0.18,
  panelTilt: 0.025,
  glassRoughness: [0.16, 0.29],
  glassF0: [0.055, 0.13],
  coatTint: 0.16,
  parapetShade: 0.90,
  roofJointKeep: 0.08,
  valueJitter: [0.94, 1.04],
};

export function realisticCityFacadeBlock(block) {
  return { ...block, ...REALISTIC_CITY_PALETTE };
}

/** Shared numerical policy also used when constructing GLSL. Fully unresolved
 * panes approach broad rough highlights, not subpixel mirror points. */
export const REALISTIC_GLAZING = Object.freeze({ nearRoughness: 0.20, variation: 0.10, farRoughness: 0.46, f0: 0.055 });
export function realisticGlazingRoughness(seed, footprint) {
  const minify = facadeMinify(footprint);
  const h = seed * 0.173 - Math.floor(seed * 0.173);
  return (REALISTIC_GLAZING.nearRoughness + h * REALISTIC_GLAZING.variation) * (1 - minify) + REALISTIC_GLAZING.farRoughness * minify;
}

const DETAILS = `
// BUILDING_REALISM: the facade has a structural rhythm at three scales. The
// room detail averages out, while the multi-storey bays remain legible longer.
float realResolved=1.-minify;
float realOpaque=isWall*(1.-cityCurtain);
float realResidential=float(family==0.||family==1.||family==6.);
float realOffice=float(family==3.||family==4.||family==7.);
float realMasonry=1.-step(.5,cityClass);
float realRender=step(.5,cityClass)*(1.-step(1.5,cityClass));
float realConcrete=step(1.5,cityClass)*(1.-step(2.5,cityClass));
float realBayCells=mix(3.,4.,step(.5,fract(seed*.217)));
float realBay=archStripe(cell.x/realBayCells+.5,.034);
float realCourse=archStripe(cell.y/3.+.5,.025);
float realFloor=archStripe(cell.y+.5,.032);
float realBayResolved=1.-smoothstep(.25,.85,max(width.x/realBayCells,width.y/3.));
// Narrow projecting piers and broad stone courses: depth, not black outlines.
float realPiers=realBay*mix(.025,.065,realOffice)*realBayResolved;
float realCourses=(realCourse*.045+realFloor*.025*realResidential)*realBayResolved;
diffuseColor.rgb*=1.-cityDay*realOpaque*(realPiers+realCourses)*(1.-paneMask);
// Window groups have stable room blinds and small differences in sky tint.
// Their mean replaces individual rooms when a pane becomes subpixel.
float realRoom=archHash(floor(cell)+vec2(seed,seed*.37));
float realSuite=archHash(vec2(floor(cell.x/2.),floor(cell.y))+vec2(seed*.31,seed));
float realBlind=step(.72,realRoom)*mix(.30,.64,realSuite);
realBlind=mix(realBlind,.132,minify);
vec3 realWindow=mix(vec3(.027,.039,.049),vec3(.069,.082,.089),fract(seed*.413));
realWindow=mix(realWindow,vec3(.23,.235,.22),realBlind);
float realPane=paneMask*(1.-cityCurtain)*cityDay;
diffuseColor.rgb=mix(diffuseColor.rgb,realWindow,realPane);
// Use coarse, low-amplitude stone variation only when its footprint resolves.
// No frame-time hash and no high-frequency grain on roofs or curtain glass.
float realStone=sin(vFacadeMetres.x*.29+seed)*sin(vFacadeMetres.y*.17+seed*.71);
float realStoneResolved=1.-smoothstep(.4,1.2,max(fwidth(vFacadeMetres.x*.29),fwidth(vFacadeMetres.y*.17)));
diffuseColor.rgb*=1.+realStone*.018*realStoneResolved*realOpaque*(1.-paneMask)*cityDay;
float realGlassMask=max(cityGlassMask,realPane);
`;

/** Every replacement is asserted. A three/material upgrade must fail loudly. */
function once(src, from, to) {
  const at = src.indexOf(from);
  if (at < 0 || src.indexOf(from, at + from.length) >= 0) throw new Error(`BUILDING_REALISM: ${at < 0 ? 'missing' : 'repeated'} shader anchor: ${from.slice(0, 70)}`);
  return src.slice(0, at) + to + src.slice(at + from.length);
}

export function applyArchitecturalRealism(shader) {
  let s = shader.fragmentShader;
  // The material's original family remains the geometry/night-light identity.
  // City cladding can choose glass for that family; use its actual material.
  s = once(s, 'float cityCurtainDay=cityCurtain*cityDay;', 'float cityCurtainDay=cityCurtain*cityDay;');
  s = once(s, 'float entrance = ', `${DETAILS}\nfloat entrance = `);
  // These come after the material palette. Removing the second pigment grade
  // is essential: grey stone cannot stay grey under an extra warm albedo tint.
  s = once(s, 'diffuseColor.rgb=mix(diffuseColor.rgb,pigment*tint,1.-uArchitectureNight);',
    'diffuseColor.rgb=mix(diffuseColor.rgb,pigment*tint,(1.-uArchitectureNight)*(1.-cityDay));');
  // Existing photographic surface detail contributes luminance, not its baked
  // colour. A brick texture must not yellow a concrete or pale-stone palette.
  s = once(s, 'diffuseColor.rgb *= mix(vec3(1.0),clamp(cmArchitectureTex.rgb*2.05,vec3(.58),vec3(1.35)),cmArchitectureAmount*.48);',
    `vec3 realTex=clamp(cmArchitectureTex.rgb*2.05,vec3(.58),vec3(1.35));
realTex=mix(realTex,vec3(dot(realTex,vec3(.2126,.7152,.0722))),cityDay);
diffuseColor.rgb *= mix(vec3(1.0),realTex,cmArchitectureAmount*mix(.48,.24,cityDay));`);
  // Retain the existing glazing at full night; day panes get a neutral dark
  // interior above, then a real sky reflection through the Standard material.
  s = once(s, 'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * glazing + 0.035, paneMask*(1.-cityCurtainDay));',
    'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * glazing + 0.035, paneMask*(1.-cityCurtainDay)*(1.-cityDay));');
  s = once(s, 'roughnessFactor=mix(roughnessFactor,max(.72,baseRough),(1.-isWall)*.65);',
    `roughnessFactor=mix(roughnessFactor,max(.72,baseRough),(1.-isWall)*.65);
float realRough=mix(${REALISTIC_GLAZING.nearRoughness.toFixed(3)}+fract(seed*.173)*${REALISTIC_GLAZING.variation.toFixed(3)},${REALISTIC_GLAZING.farRoughness.toFixed(3)},minify);
roughnessFactor=mix(roughnessFactor,mix(.88,.76,realConcrete),realOpaque*(1.-paneMask)*cityDay);
roughnessFactor=mix(roughnessFactor,realRough,realGlassMask);`);
  // The earlier CITY_FACADES patch follows the inserted roughness. Put the
  // distance floor after it so the far ring cannot reintroduce mirror sparkle.
  s = once(s, '#include <normal_fragment_maps>',
    'roughnessFactor=mix(roughnessFactor,max(roughnessFactor,mix(.16,.46,minify)),realGlassMask);\n#include <normal_fragment_maps>');
  s = once(s, 'if(uCinema>.5)metalnessFactor=mix(.015,.16,paneMask*isGlass);',
    'if(uCinema>.5)metalnessFactor=mix(.015,.16,paneMask*isGlass);\nmetalnessFactor=mix(metalnessFactor,0.,realGlassMask);');
  s = once(s, '#include <lights_fragment_begin>',
    `material.specularColorBlended=mix(material.specularColorBlended,vec3(${REALISTIC_GLAZING.f0.toFixed(3)}),realPane);
#include <lights_fragment_begin>`);
  // Curtain frames keep their filtered area average in the distant ring;
  // switching uArchitectureDetail off must not erase all vertical mullions.
  s = once(s, ')*uArchitectureDetail,archStripe(cell.y+.5,', ')*mix(uArchitectureDetail,1.,cityDay),archStripe(cell.y+.5,');
  shader.fragmentShader = s;
}
