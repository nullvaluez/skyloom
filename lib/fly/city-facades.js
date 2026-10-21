/**
 * PLAY PASS CITY (CITY_FACADES; FLY_PLAY_PASS.md F6) — cities that read as
 * cities by day.
 *
 * The Enhanced satellite buildings wore one shared look: every facade mixed
 * toward the same four tones, roofs a shade of the walls, towers the same
 * matte as walk-ups, so Manhattan from 3,000 ft read as sandcastles. This is
 * a daytime ALBEDO and GLAZING pass on the existing material
 * (lib/fly/satellite-architecture-material.js), applied by anchored edits only
 * when the flag is on: no new draws, no textures, no new data.
 *
 * - Walls: regional masonry / render, concrete, metal cladding, or a curtain
 *   wall: dark tinted glass with frames on the existing facade cell grid, made
 *   bright by the sky it reflects (the environment the scene already bakes,
 *   lifted toward the horizon) and tinted by its coating. Guessed cladding is
 *   chosen per city-block cell, so the separately mapped parts of one tower
 *   agree; houses and sheds choose per building.
 * - Roofs: flat roofs in membrane / gravel / grey / tar / planted, pitched
 *   roofs in the region's tile or shingle, upright roof geometry (parapets,
 *   penthouses, plant) in the facade a shade down, and most of the shipped
 *   seam striping retired on flat roofs.
 * - Everything is weighted by uCinema × (1 − night): full night, Classic,
 *   Neon and the toy world render exactly as before.
 *
 * The region is the worker's own Natural Earth style of the chunks around the
 * player (chunk.meta.provenance.region), eased on change.
 */
import { Vector3 } from 'three';
import { playPassOn, playPassBlock } from './play-pass';
import { architecturalColor } from './building-profiles';
import { trueScaleOn } from './true-scale';

export const CITY_FACADES_ON = playPassOn('CITY_FACADES');
const BLOCK = playPassBlock('CITY_FACADES');

/** The 12 linear colours a region contributes: masonry ×4, render ×4, pitched ×2, concrete ×2. */
export function cityRegionPalette(style, block = BLOCK) {
  const r = block.regions[style] ?? block.regions.temperate;
  return [...r.masonry, ...r.render, ...r.pitched, ...r.concrete].map(architecturalColor);
}

/** The region style that owns most buildings among the ready chunks (null when none says). */
export function dominantCityRegion(chunks) {
  const votes = new Map();
  for (const c of chunks) {
    const style = c?.meta?.provenance?.region?.style;
    if (!style || c.state !== 'ready') continue;
    const n = (c.meta.families ?? []).reduce((a, b) => a + b, 0) || 1;
    votes.set(style, (votes.get(style) ?? 0) + n);
  }
  let best = null, most = 0;
  for (const [style, n] of votes) if (n > most) { best = style; most = n; }
  return best;
}

const lin = (hex) => architecturalColor(hex);
const vec = (c) => `vec3(${c.map((x) => x.toFixed(4)).join(',')})`;
const f = (x) => Number(x).toFixed(4);
/** A seed-hash choice from a constant list: h<cut0 ? c0 : h<cut1 ? c1 : … : c(n−1). */
function choose(colors, h, cuts = colors.map((_, i) => (i + 1) / colors.length)) {
  let s = vec(lin(colors[colors.length - 1]));
  for (let i = colors.length - 2; i >= 0; i--) s = `(${h}<${f(cuts[i])}?${vec(lin(colors[i]))}:${s})`;
  return s;
}

/** The GLSL pieces, pure (the node gate builds them from any block). */
export function cityFacadeGLSL(block = BLOCK) {
  const shares = block.flatRoofShares;
  const cuts = shares.map((_, i) => shares.slice(0, i + 1).reduce((a, b) => a + b, 0));
  const [j0, j1] = block.valueJitter;
  const [r0, r1] = block.glassRoughness;
  const { apartment: ca, masonry: cm, office: co } = block.claddingCuts;
  const cutVec = (c) => `vec3(${c.map(f).join(',')})`;
  const period = block.cell.units * block.cell.periodCells;
  return {
    vertexDecl: `varying float vCityUp;
varying float vCityCell;
uniform vec3 uCityPhase;`,
    vertexBody: 'vCityUp = normal.y;',
    // The building's anchor in ABSOLUTE scene units, wrapped into one period by
    // a phase JS keeps in float64, hashed per cell: stable across rebases,
    // re-streams and the near/far handover.
    vertexAnchor: `vec2 cityCellId=floor(mod(wAnchor.xz+uCityPhase.xy,uCityPhase.z)/${f(block.cell.units)});
vec2 cityHash=fract(cityCellId*vec2(.1031,.1030));cityHash+=dot(cityHash,cityHash.yx+33.33);
vCityCell=floor(fract((cityHash.x+cityHash.y)*cityHash.x)*256.);`,
    period,
    fragmentDecl: `varying float vCityUp;
varying float vCityCell;
uniform vec3 uCityPalette[12];
uniform float uCityReflect;
uniform float uCitySky;`,
    // Before the cinematic texture pass, so grit, glazing, reveals, floor
    // bands, plinth and the art grade all land on the new albedo.
    albedo: `// PLAY PASS CITY (CITY_FACADES): one building, one material read by day.
float cityDay=uCinema*(1.-uArchitectureNight);
float cityA=fract(seed*.0731+.13),cityB=fract(seed*.3819+.41),cityC=fract(seed*.5813+.07),cityD=fract(seed*.7639+.29),cityR=fract(seed*.9127+.37);
// Cladding is guessed for apartments, masonry, offices and glass, and the
// parts of one tower are separate footprints: they share the city-block
// cell's choice on one ordered scale (masonry, render, concrete, curtain
// wall) so a tower reads as one building. Houses and sheds keep their own.
float cityCell=floor(vCityCell+.5)/256.;
float cityShared=float(family>.5&&family<4.5);
vec3 cityCuts=family==1.?${cutVec(ca)}:family==2.?${cutVec(cm)}:family==3.?${cutVec(co)}:vec3(0.);
float cityU=mix(cityC,cityCell,cityShared),cityK=mix(cityA,fract(cityCell*7.31+.17),cityShared);
float cityClass=family==0.||family==6.?step(.62,cityC):family==5.?4.:family==7.?(cityD<${f(1 - block.airportCurtainShare)}?4.:3.):(cityU<cityCuts.x?0.:cityU<cityCuts.y?1.:cityU<cityCuts.z?2.:3.);
vec3 cityMasonry=uCityPalette[int(cityK*3.999)];
vec3 cityRender=uCityPalette[4+int(cityK*3.999)];
vec3 cityConcrete=mix(uCityPalette[10],uCityPalette[11],cityK*cityK);
vec3 cityMetal=${choose(block.metal, 'cityA')};
vec3 cityWall=cityClass<.5?(family==0.||family==6.?cityRender:cityMasonry):cityClass<1.5?(family==0.||family==6.?cityMasonry:cityRender):cityClass<3.5?cityConcrete:cityMetal;
cityWall*=mix(${f(j0)},${f(j1)},cityB);
// Curtain walls: dark tinted glass between frames on the facade's own cell
// grid (so they never beat against the window rhythm), filtered like every
// facade stripe and averaged once a floor is smaller than a pixel.
float cityCurtain=step(2.5,cityClass)*step(cityClass,3.5);
float cityTintH=mix(fract(seed*.2113+.53),fract(cityCell*13.7+.53),cityShared);
vec3 cityTint=${choose(block.glass, 'cityTintH')};
float cityFrame=max(archStripe(cell.x+.5,${f(block.frame.mullion)})*uArchitectureDetail,archStripe(cell.y+.5,${f(block.frame.spandrel)}))*isWall;
vec3 cityShell=mix(cityWall*${f(block.parapetShade)},cityTint,cityCurtain);
cityWall=mix(cityWall,mix(cityTint,mix(cityTint*2.4+.025,cityConcrete*.7,.4),cityFrame),cityCurtain);
// Roofs: flat membrane/gravel/grey/tar/planted, pitched in the region's tile.
// Upright roof geometry (parapets, penthouses, plant, gable ends, setback and
// part seams) is built of the facade, a shade down: the rim that frames a pale
// roof. On a curtain-wall tower it is glass like the wall, so the seams
// between a tower's mapped parts do not draw dark lines across its mirror.
float cityUp=abs(vCityUp);
float cityFlat=smoothstep(.95,.99,cityUp),citySide=1.-smoothstep(.3,.55,cityUp);
float cityGlassMask=cityCurtain*max(isWall,citySide)*(1.-cityFrame)*cityDay;
vec3 cityRoof=mix(mix(uCityPalette[8],uCityPalette[9],step(.5,cityR)),${choose(block.flatRoofs, 'cityR', cuts)},cityFlat)*mix(.9,1.08,cityC);
cityRoof=mix(cityRoof,cityShell,citySide);
diffuseColor.rgb=mix(diffuseColor.rgb,mix(cityRoof,cityWall,isWall),cityDay);
float cityCurtainDay=cityCurtain*cityDay;
`,
    // No masonry grit or texture relief on glass: its seams would read as
    // lines in a mirror finish.
    afterAlbedo: 'cmArchitectureAmount*=1.-cityCurtainDay;',
    roofJoint: `${f(block.roofJointKeep)}`,
    roughness: `roughnessFactor=mix(roughnessFactor,mix(${f(r0)},${f(r1)},fract(seed*.4421+.11)),cityGlassMask);`,
    // Coated curtain-wall glass reflects more than bare glass, and its coating
    // tints the reflection (bronze reads warm, blue-grey cool); per building.
    specular: `vec3 cityCoat=mix(vec3(1.),clamp(cityTint/max(.004,dot(cityTint,vec3(.2126,.7152,.0722))),0.,2.),${f(block.coatTint)});
material.specularColorBlended=mix(material.specularColorBlended,cityCoat*mix(${f(block.glassF0[0])},${f(block.glassF0[1])},fract(seed*.6151+.23)),cityGlassMask);`,
    // Seen from the air a tower's glass mirrors the hazy horizon above the
    // ground it actually faces: one more sample of the scene's own sky
    // environment along a reflection lifted by skyBias (high tier, both rings).
    // Each panel sits a hair off plane, so neighbours catch slightly different
    // sky; retired before a panel is a few pixels tall (no sparkle in motion).
    radiance: `#if defined(RE_IndirectSpecular)&&defined(USE_ENVMAP)&&defined(ENVMAP_TYPE_CUBE_UV)
if(cityGlassMask>.001&&uCitySky>.5){
 float cityPanelTilt=(archHash(floor(cell)+vec2(seed,seed*.37))-.5)*${f(block.panelTilt)}*(1.-smoothstep(.15,.5,max(width.x,width.y)));
 vec3 citySkyDir=normalize(${trueScaleOn() ? 'tsTrueNormalByInverseViewMatrix' : 'transformDirectionByInverseViewMatrix'}(reflect(-geometryViewDir,geometryNormal),viewMatrix)+vec3(0.,${f(block.skyBias)}+cityPanelTilt,0.));
 radiance=mix(radiance,textureCubeUV(envMap,envMapRotation*citySkyDir,material.roughness).rgb*envMapIntensity,cityGlassMask);
}
#endif
`,
    reflection: 'reflectedLight.indirectSpecular*=1.+(uCityReflect-1.)*cityGlassMask;',
  };
}

/** Replace exactly one occurrence of `from`; a miss or a repeat throws. */
function once(src, from, to, where) {
  const at = src.indexOf(from);
  if (at < 0 || src.indexOf(from, at + from.length) >= 0) throw new Error(`CITY_FACADES: anchor ${at < 0 ? 'missing' : 'repeated'} in ${where}: ${from.slice(0, 60)}`);
  return src.slice(0, at) + to + src.slice(at + from.length);
}

export const CITY_FACADE_UNIFORMS = {
  uCityPalette: { value: cityRegionPalette('temperate').map((c) => new Vector3(...c)) },
  uCityReflect: { value: BLOCK.reflect },
  uCitySky: { value: 1 }, // the extra sky sample on glass: high tier only, near and far rings alike
  // (origin.x mod P, origin.z mod P, P): the floating-origin anchor wrapped in float64.
  uCityPhase: { value: new Vector3(0, 0, BLOCK.cell.units * BLOCK.cell.periodCells) },
};

/** The cell phase for a floating-origin anchor (float64 here, so the shader's sum stays exact). */
export function cityCellPhase(anchor, out = [0, 0, 0], block = BLOCK) {
  const P = block.cell.units * block.cell.periodCells;
  out[0] = (((anchor?.x ?? 0) % P) + P) % P;
  out[1] = (((anchor?.z ?? 0) % P) + P) % P;
  out[2] = P;
  return out;
}
const phase = [0, 0, 0];

/** Flag-on only: called at the end of the architecture material's onBeforeCompile. */
export function applyCityFacades(shader, glsl = cityFacadeGLSL()) {
  Object.assign(shader.uniforms, CITY_FACADE_UNIFORMS);
  let v = shader.vertexShader, s = shader.fragmentShader;
  v = once(v, 'varying vec3 vBuildingStyle;', `varying vec3 vBuildingStyle;\n${glsl.vertexDecl}`, 'vertex');
  v = once(v, 'vBuildingStyle = aBuildingStyle;', `vBuildingStyle = aBuildingStyle;\n${glsl.vertexBody}`, 'vertex');
  v = once(v, 'float bendD = distance( wAnchor.xz, uBendCenter );', `float bendD = distance( wAnchor.xz, uBendCenter );\n${glsl.vertexAnchor}`, 'vertex');
  s = once(s, 'uniform float uArchitectureDetail;', `uniform float uArchitectureDetail;\n${glsl.fragmentDecl}`, 'fragment');
  s = once(s, 'cmArchitectureAmount *= (1.0-isGlass*.88)*(1.0-minify);', `${glsl.albedo}cmArchitectureAmount *= (1.0-isGlass*.88)*(1.0-minify);\n${glsl.afterAlbedo}`, 'fragment');
  // Punched-window glazing, reveals and mid-floor bands stay on masonry; a
  // curtain wall is already glass, framed at its cell edges.
  s = once(s, 'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * glazing + 0.035, paneMask);',
    'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * glazing + 0.035, paneMask*(1.-cityCurtainDay));', 'fragment');
  s = once(s, 'float revealDetail=cmArchitectureDay*isWall*(1.0-minify);', 'float revealDetail=cmArchitectureDay*isWall*(1.0-minify)*(1.-cityCurtainDay);', 'fragment');
  s = once(s, ' float spandrel=archStripe(cell.y,.095)*isGlass;', ' float spandrel=archStripe(cell.y,.095)*isGlass*(1.-cityCurtainDay);', 'fragment');
  s = once(s, 'diffuseColor.rgb*=1.-panel*isWall*float(family==3.||family==4.)*.16*(1.-uArchitectureNight);',
    'diffuseColor.rgb*=1.-panel*isWall*float(family==3.||family==4.)*.16*(1.-uArchitectureNight)*(1.-cityCurtainDay);', 'fragment');
  // Flat membrane and gravel roofs are not corrugated; industrial ribs stay.
  s = once(s, 'diffuseColor.rgb*=1.-(1.-isWall)*(roofJoint*.15+roofRib*industrial*.17)*uArchitectureDetail;',
    `diffuseColor.rgb*=1.-(1.-isWall)*(roofJoint*.15*mix(1.,${glsl.roofJoint},cityDay*cityFlat*(1.-industrial))+roofRib*industrial*.17)*uArchitectureDetail;`, 'fragment');
  s = once(s, 'roughnessFactor=mix(roughnessFactor,max(.72,baseRough),(1.-isWall)*.65);',
    `roughnessFactor=mix(roughnessFactor,max(.72,baseRough),(1.-isWall)*.65);\n${glsl.roughness}`, 'fragment');
  s = once(s, 'material.specularColorBlended=mix(material.specularColorBlended,vec3(.065),paneMask);',
    `material.specularColorBlended=mix(material.specularColorBlended,vec3(.065),paneMask);\n${glsl.specular}`, 'fragment');
  // A curtain wall is flush glass: no recessed-pane relief or panel bowing,
  // whose pane-edge derivatives a mirror finish would turn into sparkle.
  s = once(s, '* paneMask - 0.006 * isMasonry * mortar) * (1.0-minify);', '* paneMask*(1.-cityCurtainDay) - 0.006 * isMasonry * mortar) * (1.0-minify);', 'fragment');
  s = once(s, 'float glassRelief=sin(cell.x*1.31+seed)*sin(cell.y*.79+seed*.37)*.035*paneMask*(1.-minify);',
    'float glassRelief=sin(cell.x*1.31+seed)*sin(cell.y*.79+seed*.37)*.035*paneMask*(1.-minify)*(1.-cityCurtainDay);', 'fragment');
  s = once(s, '#include <lights_fragment_end>', `${glsl.radiance}#include <lights_fragment_end>\n${glsl.reflection}`, 'fragment');
  shader.vertexShader = v;
  shader.fragmentShader = s;
}

/** High tier pays for the extra sky sample on curtain glass (SatBuildingLayer, on tier changes). */
export function setCityFacadesSky(enabled) {
  CITY_FACADE_UNIFORMS.uCitySky.value = enabled ? 1 : 0;
}

/** Appended to the architecture program key only when the flag is on. */
export const CITY_FACADES_KEY = '|city-facades-v1';

const live = { style: null, target: null, at: -1, last: -1 };
/** Per frame from SatBuildingLayer (flag on): pick the region once a second, ease the palette. */
export function updateCityFacades(engine, nowSec, anchor) {
  CITY_FACADE_UNIFORMS.uCityPhase.value.fromArray(cityCellPhase(anchor, phase));
  const dt = live.last < 0 ? 0 : Math.min(0.1, Math.max(0, nowSec - live.last));
  live.last = nowSec;
  // A clock that went backwards (a remounted canvas restarts at 0) votes at once.
  if ((nowSec - live.at >= 1 || nowSec < live.at) && engine?.chunks) {
    live.at = nowSec;
    const style = dominantCityRegion(engine.chunks.values());
    if (style && style !== live.style) {
      const first = live.style === null;
      live.style = style;
      live.target = cityRegionPalette(style);
      if (first) CITY_FACADE_UNIFORMS.uCityPalette.value.forEach((v, i) => v.fromArray(live.target[i])); // a fresh flight starts on its own region
    }
  }
  if (!live.target) return;
  const k = 1 - Math.exp(-dt / Math.max(0.05, BLOCK.regionEaseSec / 3));
  let moving = false;
  CITY_FACADE_UNIFORMS.uCityPalette.value.forEach((v, i) => {
    const t = live.target[i];
    v.x += (t[0] - v.x) * k; v.y += (t[1] - v.y) * k; v.z += (t[2] - v.z) * k;
    moving ||= Math.abs(t[0] - v.x) + Math.abs(t[1] - v.y) + Math.abs(t[2] - v.z) > 1e-4;
  });
  if (!moving) live.target = null;
}

/** Diagnostics (harnesses read it through window.__flyCityFacades in dev). */
export function cityFacadesState() {
  return { on: CITY_FACADES_ON, style: live.style, easing: live.target !== null };
}
