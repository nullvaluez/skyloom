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

export const STAND_IN_KEY = '|wp-reach-standin-v1';

/** The uniforms every stand-in material and fade twin shares (one object). */
export function createStandInUniforms() {
  return { uStandInView: { value: new Vector4(779, 2, 1.5, 1) } };
}

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

export function standInVertexGLSL(footprintK, sinkM = SAT_BUILDINGS.baseSinkM) {
  const decl = `
attribute float aStandInFace;
attribute float aStandInBase;
attribute vec4 aStandInDim;
attribute vec4 aStandInWall;
attribute vec4 aStandInRoof;
uniform vec4 uStandInView;
varying float vStandInFade;
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
  if (vStandInFade <= 0.0) { sXw = 0.0; sZw = 0.0; sY = 0.0; }
  standInPos = vec3(aBendAnchor.x + sCy * sXw - sSy * sZw, aStandInBase + sY, aBendAnchor.y + sSy * sXw + sCy * sZw);
  standInNormal = vec3(sCy * sN.x - sSy * sN.z, sN.y, sSy * sN.x + sCy * sN.z);
  float sWall = aStandInFace > 0.5 ? 1.0 : 0.0;
  standInStyle = vec3(floor(aStandInWall.a * 255.0 + 0.5), floor(aStandInRoof.a * 255.0 + 0.5), sWall);
  float sAlong = aStandInFace > 1.5 ? sXw : sZw;
  standInUV = sWall > 0.5 ? vec2(0.5 + sAlong / sK / ${f1(ARCHITECTURE_UV_PERIOD[0])}, sY / ${f1(ARCHITECTURE_UV_PERIOD[1])}) : vec2(0.25);
  vec3 sRgb = mix(aStandInRoof.rgb, aStandInWall.rgb, sWall);
  standInColor = mix(sRgb / 12.92, pow((sRgb + 0.055) / 1.055, vec3(2.4)), step(0.04045, sRgb));
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
  const glsl = standInVertexGLSL(footprintK);
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    shader.uniforms.uStandInView = uniforms.uStandInView;
    let v = shader.vertexShader;
    v = edit(v, '#include <common>', `#include <common>${glsl.decl}`, 'vertex');
    v = edit(v, 'void main() {', `void main() {${glsl.body}`, 'vertex');
    shader.vertexShader = v;
    let f = shader.fragmentShader;
    f = edit(f, '#include <common>', '#include <common>\nvarying float vStandInFade;', 'fragment');
    f = edit(f, 'float skyA = uSkyFade;', 'float skyA = uSkyFade * vStandInFade;', 'fragment');
    shader.fragmentShader = f;
  };
  material.customProgramCacheKey = () => `${key}${STAND_IN_KEY}-${footprintK}`;
  material.userData.standIn = true;
  material.needsUpdate = true;
  return material;
}
