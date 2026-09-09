import { BufferAttribute, Color, DoubleSide, MeshStandardMaterial } from 'three';
import { MODEL_SURFACE_ROLES } from './assets.js';

export { MODEL_SURFACE_ROLES };
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/** Authored look development, not a claim about a monument's live lighting schedule.
 * Masks use existing unit-height/radial accents; floodlight is a cheap surface approximation.
 */
export const MONUMENT_LIGHTING_PROFILES = {
  'Empire State Building': { role: 'stone', flood: '#ffe3bc', intensity: 0.16, accent: 1.7 },
  'Statue of Liberty': { role: 'copper', flood: '#e2eee2', intensity: 0.32, accent: 1.55 },
  'Eiffel Tower': { role: 'iron', flood: '#ffd29a', intensity: 0.48, accent: 1.6 },
  'Taj Mahal': { role: 'stone', flood: '#ffefd9', intensity: 0.15, accent: 0.7 },
  'Sydney Opera House': { role: 'ceramic', flood: '#ede9dc', intensity: 0.25, accent: 0.7 },
  'Big Ben': { role: 'stone', flood: '#ffe1b1', intensity: 0.26, accent: 1.45 },
  'Space Needle': { role: 'steel', flood: '#e5eced', intensity: 0.2, accent: 1.25 },
  'Gateway Arch': { role: 'steel', flood: '#dce8ef', intensity: 0.27, accent: 0.6 },
  'Colosseum': { role: 'stone', flood: '#ffd4a0', intensity: 0.34, accent: 0.6 },
  'Willis Tower': { role: 'glass', flood: '#d9e6ef', intensity: 0.08, accent: 1.4 },
};
const DEFAULT_PROFILE = { role: 'stone', flood: '#ffe5c4', intensity: 0.18, accent: 1 };

export function modelNightWeight(dayFrac = 1) {
  return clamp(1 - dayFrac / 0.22) ** 1.6;
}

export function modelAccentAt(bands, y, radius) {
  return bands?.find((b) => y >= b.yMin && y <= b.yMax &&
    (b.rMin == null || radius >= b.rMin) && (b.rMax == null || radius <= b.rMax)) ?? null;
}

/** Add surface/mask buffers BEFORE transform/merge. Geometry positions and albedo are untouched. */
export function attachCinematicModelAttributes(geometry, entry = {}) {
  const p = MONUMENT_LIGHTING_PROFILES[entry.poi] ?? DEFAULT_PROFILE;
  const role = MODEL_SURFACE_ROLES[p.role];
  const pos = geometry.getAttribute('position'), n = pos.count;
  geometry.computeBoundingBox();
  const b = geometry.boundingBox;
  const height = Math.max(1e-6, b.max.y - b.min.y);
  const hx = Math.max(1e-6, Math.abs(b.min.x), Math.abs(b.max.x));
  const hz = Math.max(1e-6, Math.abs(b.min.z), Math.abs(b.max.z));
  const surface = new Float32Array(n * 2), light = new Float32Array(n * 3);
  const flood = new Color(p.flood), accent = new Color();
  for (let i = 0; i < n; i++) {
    const y = clamp((pos.getY(i) - b.min.y) / height);
    const radial = Math.max(Math.abs(pos.getX(i)) / hx, Math.abs(pos.getZ(i)) / hz);
    const band = modelAccentAt(entry.accents, y, radial);
    // Ground-mounted wash diminishes up the facade; curated accent bands stay independent.
    const wash = p.intensity * (0.28 + 0.72 * (1 - y) ** 0.7);
    surface[i * 2] = role.roughness;
    surface[i * 2 + 1] = role.metalness;
    if (band) accent.set(band.color).multiplyScalar(p.accent);
    else accent.setRGB(0, 0, 0);
    light[i * 3] = flood.r * wash + accent.r;
    light[i * 3 + 1] = flood.g * wash + accent.g;
    light[i * 3 + 2] = flood.b * wash + accent.b;
  }
  geometry.setAttribute('aModelSurface', new BufferAttribute(surface, 2));
  geometry.setAttribute('aModelLight', new BufferAttribute(light, 3));
  geometry.userData.materialRole = p.role;
  geometry.userData.lightingMask = 'first-party-unit-height-radial-v1';
  return geometry;
}

export function createCinematicModelMaterial(bend, { color = 0xffffff, merged = false } = {}) {
  const m = new MeshStandardMaterial({ color, vertexColors: true, roughness: 0.8, metalness: 0,
    envMapIntensity: 0.65, side: DoubleSide });
  const night = { value: 0 };
  m.userData.cinematicNight = night;
  bend(m);
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.uniforms.uModelNight = night;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec2 aModelSurface;
attribute vec3 aModelLight;
varying vec2 vModelSurface;
varying vec3 vModelLight;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvModelSurface = aModelSurface;\nvModelLight = aModelLight;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform float uModelNight;
varying vec2 vModelSurface;
varying vec3 vModelLight;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(vModelSurface.x, 0.12, 1.0);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = clamp(vModelSurface.y, 0.0, 0.9);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vModelLight * uModelNight;');
  };
  m.customProgramCacheKey = () => `${key}-cinematic-model-v1${merged ? '-merged' : ''}`;
  return m;
}

export function updateCinematicModelNight(material, dayFrac) {
  if (material.userData.cinematicNight) material.userData.cinematicNight.value = modelNightWeight(dayFrac);
}

/** Reuse source PBR maps without copying ownership; the GLTF cache retains their lifetime. */
export function cinematicAircraftParameters(src, isCanopy = false) {
  const role = MODEL_SURFACE_ROLES[isCanopy ? 'canopy' : 'paintedAircraft'];
  return {
    ...role, normalMap: src?.normalMap ?? null, roughnessMap: src?.roughnessMap ?? null,
    metalnessMap: src?.metalnessMap ?? null, aoMap: src?.aoMap ?? null,
    emissiveMap: src?.emissiveMap ?? null,
    emissive: src?.emissive?.clone?.() ?? new Color(0),
    emissiveIntensity: src?.emissiveIntensity ?? 1,
    side: src?.side, alphaTest: src?.alphaTest ?? 0,
  };
}
