/**
 * World Pass C (REACH): the stand-in material. Stream C owns this file.
 *
 * One stand-in = one instance of a 12-vertex, 6-triangle box (roof + the two
 * walls that face the camera; lib/fly/toy-world/sat-stand-ins.js). The
 * material is the far mass's own: createSatelliteArchitectureMaterial({
 * distant: true }) is called as is (that file is stream D's and is not edited),
 * so the stand-ins wear exactly the shading, haze, night windows, outer horizon
 * dissolve, CHUNK_FADE twin uniform and 24-slot detail/mass coverage mask the
 * old horizon mass wore, and the far city cannot drift from the near city's
 * look when stream D changes it.
 *
 * What this file adds, at the very start of the vertex shader's main(): it
 * builds each vertex from the instance attributes and then ALIASES the
 * attribute names the factory's shader reads (`position`, `normal`, `color`,
 * `uv`, `aBuildingStyle`) to the values it built, with #define. `aBendAnchor`
 * is a real per-instance attribute (the box centre), so the bend, the
 * coverage test and the horizon band read the building's anchor unchanged.
 *
 *   per vertex   position (unit box: x, z in [-1, 1], y in {0, 1}), aStandInFace
 *                (0 roof, 1 the +x wall, 2 the +z wall)
 *   per instance aBendAnchor (centre, group-local world x, z), aStandInBase
 *                (draped ground y), aStandInDim (Uint16 normalised: half extents
 *                and height / 1000, yaw / 2pi), aStandInWall / aStandInRoof
 *                (Uint8 normalised sRGB + family / seed)
 *
 * The two walls face the camera: a wall whose outward side faces away is
 * turned 180 degrees about the box axis (x, z -> -x, -z), which keeps the
 * winding outward-facing, so DoubleSide lighting stays right.
 *
 * SCREEN SIZE. uStandInView = (K, minPx, fadePx, k): K is the camera's focal
 * length in CSS pixels, k the Mercator scale at the player. A stand-in whose
 * size key (max of height and footprintK x sqrt(true footprint area), the
 * worker's key) is under minPx on screen collapses to a point (no fragments);
 * across the next fadePx it dissolves in with the same ordered Bayer dither
 * every other ring fade uses (it multiplies the bend's skyA), so a building
 * that grows past two pixels never pops.
 */
import { Vector4 } from 'three';
import { createSatelliteArchitectureMaterial } from './satellite-architecture-material';
import { ARCHITECTURE_UV_PERIOD } from './building-profiles';
import { SAT_BUILDINGS } from './fly-constants';
import { FLIGHT_CLARITY_ON, FLIGHT_RELIEF_ON } from './world-clarity';

export const STAND_IN_KEY = '|wp-reach-standin-v4';

// Each mip rectangle needs its own half-texel inset so bilinear filtering
// stays inside it. Mix levels after the sRGB sampler decodes into linear light.
export const STAND_IN_PHOTO_FILTER = `
vec3 standInPhotoLevel(vec2 uv, float layer, float size, float lod) {
  float side = size * exp2(-lod);
  vec2 origin = lod < 0.5 ? vec2(0.0) : vec2(size - 2.0 * side, size);
  vec2 pixel = origin + clamp(uv * side, vec2(0.5), vec2(side - 0.5));
  return textureLod(uStandInPhotos, vec3(pixel / vec2(size, 1.5 * size), layer), 0.0).rgb;
}
vec3 standInPhotoFiltered(vec2 uv, float layer, float footprint) {
  float size = float(textureSize(uStandInPhotos, 0).x);
  float lod = clamp(log2(max(1.0, footprint * size)), 0.0, log2(size));
  float base = floor(lod);
  vec3 color = standInPhotoLevel(uv, layer, size, base);
  if (fract(lod) < 0.001) return color;
  return mix(color, standInPhotoLevel(uv, layer, size, base + 1.0), fract(lod));
}`;

/**
 * The uniforms every stand-in material and fade twin shares (one object).
 * Round 2: uStandInLook = (fromM, toM, roofPull, wallPull) and uStandInLook2 =
 * (desaturate, wallGain, detailFullM, detailZeroM), from WORLD_REACH.farLook
 * and .nearDetail (main thread, session constants).
 */
export function createStandInUniforms(cfg = {}) {
  const L = cfg.farLook ?? {};
  const N = cfg.nearDetail ?? {};
  return {
    uStandInView: { value: new Vector4(779, 2, 1.5, 1) },
    uStandInLook: { value: new Vector4(L.fromM ?? 2500, L.toM ?? 9000, L.roofPull ?? 0, L.wallPull ?? 0) },
    uStandInLook2: { value: new Vector4(L.desaturate ?? 0, L.wallGain ?? 1, N.fullM ?? 0, N.zeroM ?? 1) },
    uStandInLook3: { value: new Vector4(L.roofGain ?? 1, L.canyon ?? 1, L.canyonFrac ?? 0.5, 0) },
    // Round 2b (street pattern): the ground-photo atlas (sat-stand-in-photo.js createPhotoAtlas)
    // and (group span in world units, photoFullH, photoZeroH, photoFlat): a stand-in under
    // photoFullH takes the photo per fragment along the view ray, none over photoZeroH; with
    // distance (fromM to toM) such a stand-in is lit like the ground by up to photoFlat.
    uStandInPhotos: { value: null },
    uStandInPhotoInfo: { value: new Vector4(1, L.photoFullH ?? 45, L.photoZeroH ?? 90, L.photoFlat ?? 0) },
    // Per atlas slot, how far its photo has faded in (the engine ramps it when a photo lands).
    uStandInPhotoK: { value: new Float32Array(photoLayers(cfg)) },
  };
}

/** The atlas slot count (WORLD_REACH.photo.layers), which sizes uStandInPhotoK in the shader. */
export const photoLayers = (cfg = {}) => Math.max(1, Math.min(254, cfg.photo?.layers ?? 40));

let _warned = false;
function edit(text, anchor, replacement, where) {
  if (!text.includes(anchor)) {
    if (!_warned && typeof console !== 'undefined') {
      _warned = true;
      console.error(`[wp-reach] stand-in material: ${where} anchor not found: ${anchor}`);
    }
    return text;
  }
  return text.replace(anchor, replacement);
}

const f1 = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

export function standInVertexGLSL(footprintK, sinkM = SAT_BUILDINGS.baseSinkM, layers = 40) {
  const decl = `
attribute float aStandInFace;
attribute float aStandInBase;
attribute vec4 aStandInDim;
attribute vec4 aStandInWall;
attribute vec4 aStandInRoof;
attribute vec4 aStandInGround;
uniform vec4 uStandInView;
uniform vec4 uStandInLook;
uniform vec4 uStandInLook2;
uniform vec4 uStandInPhotoInfo;
uniform float uStandInPhotoK[${layers}];
varying float vStandInFade;
varying vec2 vStandInPhotoUV;
varying float vStandInPhotoL;
varying float vStandInPhotoW;
varying float vStandInFlat;
varying float vStandInH;
varying vec4 vStandInGround;
varying float vStandInDetail;
vec3 standInPos;
vec3 standInNormal;
vec3 standInStyle;
vec2 standInUV;
vec3 standInColor;`;
  const body = `
{
  vec4 sDim = aStandInDim * vec4(1000.0, 1000.0, 1000.0, 6.28318530718);
  float sH = max(sDim.z, 0.5);
  float sCy = cos(sDim.w), sSy = sin(sDim.w);
  vec3 sCentre = (modelMatrix * vec4(aBendAnchor.x, aStandInBase + 0.5 * sH, aBendAnchor.y, 1.0)).xyz;
  vec3 sToCam = cameraPosition - sCentre;
  float sLx = sCy * sToCam.x + sSy * sToCam.z;
  float sLz = -sSy * sToCam.x + sCy * sToCam.z;
  vec3 sP = position;
  vec3 sN = vec3(0.0, 1.0, 0.0);
  if (aStandInFace > 0.5 && aStandInFace < 1.5) {
    sN = vec3(1.0, 0.0, 0.0);
    if (sLx < 0.0) { sP.xz = -sP.xz; sN.x = -1.0; }
  } else if (aStandInFace > 1.5) {
    sN = vec3(0.0, 0.0, 1.0);
    if (sLz < 0.0) { sP.xz = -sP.xz; sN.z = -1.0; }
  }
  float sK = max(uStandInView.w, 1e-3);
  float sDist = length(vec3(sToCam.x / sK, sToCam.y, sToCam.z / sK));
  float sSize = max(sH, ${f1(footprintK)} * 2.0 * sqrt(max(sDim.x * sDim.y, 0.0)) / sK);
  float sPx = uStandInView.x * sSize / max(sDist, 1.0);
  vStandInFade = smoothstep(uStandInView.y, uStandInView.y + uStandInView.z, sPx);
  float sXw = sP.x * sDim.x;
  float sZw = sP.z * sDim.y;
  float sY = mix(-${f1(sinkM)}, sH, sP.y);
  ${FLIGHT_CLARITY_ON ? `// For a building just crossing the size threshold, ramp its projected
  // area as geometry. A screen-door mask at this size can throw away the
  // entire building every time its one covered pixel changes Bayer phase.
  float reachScale = sqrt(vStandInFade);
  sXw *= reachScale;
  sZw *= reachScale;
  sY = mix(-${f1(sinkM)}, sH * reachScale, sP.y);` : ''}
  if (vStandInFade <= 0.0) { sXw = 0.0; sZw = 0.0; sY = 0.0; }
  standInPos = vec3(aBendAnchor.x + sCy * sXw - sSy * sZw, aStandInBase + sY, aBendAnchor.y + sSy * sXw + sCy * sZw);
  standInNormal = vec3(sCy * sN.x - sSy * sN.z, sN.y, sSy * sN.x + sCy * sN.z);
  // Round 2b (street pattern): a = the atlas slot + 1 (0 or 255: none), and
  // how far that slot's photo has faded in. Far and low, a stand-in with its
  // photo is lit like the ground it stands on (up to photoFlat), so the per-box
  // wall shading stops drawing a uniform grain over the photo's streets;
  // towers keep their own walls.
  float sSlot = floor(aStandInGround.a * 255.0 + 0.5);
  vStandInPhotoL = sSlot > 0.5 && sSlot < ${layers}.5 ? sSlot - 1.0 : -1.0;
  vStandInPhotoW = vStandInPhotoL > -0.5 ? uStandInPhotoK[int(vStandInPhotoL)] : 0.0;
  vStandInFlat = vStandInPhotoW * uStandInPhotoInfo.w * smoothstep(uStandInLook.x, uStandInLook.y, sDist) * (1.0 - smoothstep(uStandInPhotoInfo.y, uStandInPhotoInfo.z, sH));
  ${FLIGHT_RELIEF_ON ? 'vStandInFlat *= 1. - .78 * smoothstep(4.,16.,sPx);' : ''}
  standInNormal = normalize(mix(standInNormal, vec3(0.0, 1.0, 0.0), vStandInFlat));
  float sWall = aStandInFace > 0.5 ? 1.0 : 0.0;
  // WORLD PASS D x C seam (round 3): the family byte carries the look's wall
  // material in its high bits (worker: family + 16 x material); the wall's
  // style z becomes 1 + material, the near ring's own code (2 glass, 3 opaque),
  // decoded by applyWorldLook. Material 0 (every stand-in with look.authority
  // off): the same family and z as before.
  float sFam = floor(aStandInWall.a * 255.0 + 0.5);
  float sMat = floor(sFam / 16.0);
  standInStyle = vec3(sFam - 16.0 * sMat, floor(aStandInRoof.a * 255.0 + 0.5), sWall * (1.0 + sMat));
  float sAlong = aStandInFace > 1.5 ? sXw : sZw;
  standInUV = sWall > 0.5 ? vec2(0.5 + sAlong / sK / ${f1(ARCHITECTURE_UV_PERIOD[0])}, sY / ${f1(ARCHITECTURE_UV_PERIOD[1])}) : vec2(0.25);
  vec3 sRgb = mix(aStandInRoof.rgb, aStandInWall.rgb, sWall);
  standInColor = mix(sRgb / 12.92, pow((sRgb + 0.055) / 1.055, vec3(2.4)), step(0.04045, sRgb));
  // Round 2: the ground photo's albedo under the stand-in (linear) and how far
  // the stand-in is pulled toward it (a = 0 at fromM, 1 at toM, true metres);
  // the near-edge detail ramp (1 inside detailFullM, 0 past detailZeroM).
  vec3 sG = aStandInGround.rgb;
  vStandInGround = vec4(mix(sG / 12.92, pow((sG + 0.055) / 1.055, vec3(2.4)), step(0.04045, sG)), smoothstep(uStandInLook.x, uStandInLook.y, sDist));
  vStandInDetail = 1.0 - smoothstep(uStandInLook2.z, uStandInLook2.w, sDist);
  // Round 2b (street pattern): where the view ray through this vertex meets
  // the building's ground plane, in the group's photo (group-local / span):
  // the fragment then shows the photo the flat ground would show there, lit as
  // a wall or a roof, so the streets and boulevards between the boxes read as
  // they do in the photograph.
  {
    vec3 sPw = (modelMatrix * vec4(standInPos, 1.0)).xyz;
    float sBaseW = (modelMatrix * vec4(0.0, aStandInBase, 0.0, 1.0)).y;
    float sDy = cameraPosition.y - sPw.y;
    vec3 sGp = sPw;
    if (sDy > 1.0 && cameraPosition.y > sBaseW + 1.0) sGp = cameraPosition + (sPw - cameraPosition) * ((cameraPosition.y - sBaseW) / sDy);
    vStandInPhotoUV = (standInPos.xz + (sGp.xz - sPw.xz)) / uStandInPhotoInfo.x + 0.5;
  }
  vStandInH = sH;
}
#define position standInPos
#define normal standInNormal
#define aBuildingStyle standInStyle
#define uv standInUV
#define color standInColor
`;
  return { decl, body };
}

/**
 * @param lighting     satelliteVisualsOn('lighting') (the far mass's own argument)
 * @param fadeUniform  a CHUNK_FADE twin's own uSkyFade, or undefined
 * @param uniforms     createStandInUniforms(), shared by the base and every twin
 * @param footprintK   the worker's size-key constant (WORLD_REACH.worker.footprintK)
 */
export function createStandInMaterial({ lighting = true, fadeUniform, uniforms, footprintK = 0.5 } = {}) {
  const material = createSatelliteArchitectureMaterial({ distant: true, lighting, fadeUniform });
  const layers = uniforms.uStandInPhotoK.value.length;
  const glsl = standInVertexGLSL(footprintK, SAT_BUILDINGS.baseSinkM, layers);
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    shader.uniforms.uStandInView = uniforms.uStandInView;
    shader.uniforms.uStandInLook = uniforms.uStandInLook;
    shader.uniforms.uStandInLook2 = uniforms.uStandInLook2;
    shader.uniforms.uStandInLook3 = uniforms.uStandInLook3;
    shader.uniforms.uStandInPhotos = uniforms.uStandInPhotos;
    shader.uniforms.uStandInPhotoInfo = uniforms.uStandInPhotoInfo;
    shader.uniforms.uStandInPhotoK = uniforms.uStandInPhotoK;
    let v = shader.vertexShader;
    v = edit(v, '#include <common>', `#include <common>${glsl.decl}`, 'vertex');
    v = edit(v, 'void main() {', `void main() {${glsl.body}`, 'vertex');
    shader.vertexShader = v;
    let f = shader.fragmentShader;
    f = edit(f, '#include <common>', '#include <common>\nuniform highp sampler2DArray uStandInPhotos;\nuniform vec4 uStandInPhotoInfo;\nvarying vec2 vStandInPhotoUV;\nvarying float vStandInPhotoL;\nvarying float vStandInPhotoW;\nvarying float vStandInFlat;\nvarying float vStandInFade;\nvarying vec4 vStandInGround;\nvarying float vStandInDetail;\nvarying float vStandInH;\nuniform vec4 uStandInLook;\nuniform vec4 uStandInLook2;\nuniform vec4 uStandInLook3;', 'fragment');
    if (FLIGHT_CLARITY_ON) {
      // Derivatives must be taken before any of the coverage/handoff discards.
      f = edit(f, 'void main() {', `${STAND_IN_PHOTO_FILTER}
void main() {
  float photoFootprint = max(length(dFdx(vStandInPhotoUV)), length(dFdy(vStandInPhotoUV)));`, 'fragment');
    } else {
      f = edit(f, 'float skyA = uSkyFade;', 'float skyA = uSkyFade * vStandInFade;', 'fragment');
    }
    // Round 2 (near edge): the far material's facade detail (windows, bands,
    // relief) is a uniform 0; a stand-in close to the camera (boost outruns the
    // detail ring) takes it back by distance, per vertex.
    f = edit(f, 'uniform float uArchitectureDetail;', 'uniform float uArchitectureDetail;\n#define uArchitectureDetail vStandInDetail', 'fragment');
    // Round 2 (far colour): after every albedo pass, before lighting. With
    // distance the stand-in desaturates and its albedo is pulled toward the
    // ground photo's (or its tile's mean roof), roofs harder than walls; never
    // at night (the lit windows are emissive and untouched).
    f = edit(f, '#include <roughnessmap_fragment>', `{
  float sfK = vStandInGround.a * (1.0 - uArchitectureNight);
  float sfL = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(sfL), uStandInLook2.x * sfK);
  // Round 2b: the photo along the view ray (per fragment) for a stand-in under
  // photoFullH; the building's own photo colour (per instance) over photoZeroH.
  vec3 sfG = vStandInGround.rgb;
  ${FLIGHT_CLARITY_ON ? `float photoWeight = vStandInPhotoW * (1.0 - smoothstep(uStandInPhotoInfo.y, uStandInPhotoInfo.z, vStandInH));
  if (vStandInPhotoL > -0.5 && sfK * photoWeight > 0.0)
    sfG = mix(sfG, standInPhotoFiltered(vStandInPhotoUV, vStandInPhotoL, photoFootprint), photoWeight);`
    : 'if (vStandInPhotoL > -0.5) sfG = mix(sfG, texture(uStandInPhotos, vec3(clamp(vStandInPhotoUV, 0.0, 1.0), vStandInPhotoL)).rgb, vStandInPhotoW * (1.0 - smoothstep(uStandInPhotoInfo.y, uStandInPhotoInfo.z, vStandInH)));'}
  float sfWall = isWall * (1.0 - vStandInFlat);
  ${FLIGHT_RELIEF_ON ? 'sfK *= 1. - .68 * sfWall * smoothstep(12.,65.,vStandInH);' : ''}
  diffuseColor.rgb = mix(diffuseColor.rgb, sfG * mix(uStandInLook3.x, uStandInLook2.y, sfWall), mix(uStandInLook.z, uStandInLook.w, sfWall) * sfK);
  // The street canyon: a stand-in casts and receives no shadow, so the lower
  // part of each wall is darkened (canyon x at the foot, 1 at canyonFrac of
  // the height): the gap between two boxes reads as a street again.
  diffuseColor.rgb *= mix(1.0, mix(uStandInLook3.y, 1.0, smoothstep(0.0, uStandInLook3.z * vStandInH, vFacadeMetres.y)), sfWall * (1.0 - uArchitectureNight));
}
#include <roughnessmap_fragment>`, 'fragment');
    shader.fragmentShader = f;
  };
  material.customProgramCacheKey = () => `${key}${STAND_IN_KEY}-${footprintK}-${layers}${FLIGHT_CLARITY_ON ? '|filtered-reach-v1' : ''}${FLIGHT_RELIEF_ON ? '|reach-relief' : ''}`;
  material.userData.standIn = true;
  material.needsUpdate = true;
  return material;
}
