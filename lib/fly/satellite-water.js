import { BufferAttribute, MeshBasicMaterial, Vector2, Vector3, Vector4 } from 'three';
import { applyBendWaterSat } from './toy-world/world-bend.js';

export const SATELLITE_WATER_KEY = 'world-bend-water-cinematic-v1';
const TAU = Math.PI * 2;
const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const shared = {
  uWaterEnabled: { value: 0 },
  uWaterTime: { value: 0 },
  uWaterPhase: { value: new Vector2() },
  uWaterSun: { value: new Vector3(0, 1, 0) },
  uWaterMoon: { value: new Vector3(0, 0.565, -0.825) },
  uWaterLight: { value: new Vector4(1, 0, 0, 0) }, // day, night, twilight, overcast
};
const originMetres = new Vector2();

/** Stable spatial phase: frequencies below are integer cycles per 1024 m.
 * Wrap the origin BEFORE converting to float32, so a rebase does not shift
 * ripples and large Mercator coordinates never reach the GPU's sine input.
 */
export function waterPhaseCoordinate(value) {
  return Number.isFinite(value) ? ((value % 1024) + 1024) % 1024 : 0;
}

export function setSatelliteWaterFrame({
  enabled = false, timeSec = 0, originX = 0, originZ = 0,
  sunAz = 0, sunSinEl = 1, overcast = 0, moonDirection,
} = {}) {
  shared.uWaterEnabled.value = enabled ? 1 : 0;
  if (!enabled) return;
  originMetres.set(originX, originZ);
  // Whole 2π cycles keep all three wave phases continuous across rollover.
  shared.uWaterTime.value = Number.isFinite(timeSec) ? ((timeSec % (TAU * 100)) + TAU * 100) % (TAU * 100) : 0;
  shared.uWaterPhase.value.set(waterPhaseCoordinate(originX), waterPhaseCoordinate(originZ));
  const s = Math.min(1, Math.max(-1, Number.isFinite(sunSinEl) ? sunSinEl : 1));
  const az = Number.isFinite(sunAz) ? sunAz : 0;
  const c = Math.sqrt(Math.max(0, 1 - s * s));
  shared.uWaterSun.value.set(-Math.sin(az) * c, s, Math.cos(az) * c);
  if (moonDirection && moonDirection.length >= 3 && moonDirection.every(Number.isFinite)) {
    shared.uWaterMoon.value.fromArray(moonDirection).normalize();
  } else {
    shared.uWaterMoon.value.set(Math.sin(az) * Math.cos(0.6), Math.sin(0.6), -Math.cos(az) * Math.cos(0.6));
  }
  const elevation = Math.asin(s) * 180 / Math.PI;
  const smooth = (a, b) => { const t = clamp01((elevation - a) / (b - a)); return t * t * (3 - 2 * t); };
  shared.uWaterLight.value.set(smooth(-6, 18), 1 - smooth(-12, -1), smooth(-12, -2) * (1 - smooth(3, 18)), clamp01(overcast));
}

/** One shared material, one set of actual nearby urban clusters, updated once
 * before rendering. Coordinates are REBASED WORLD metres, matching mesh world
 * transforms. Missing/empty urban data emits no city reflection anywhere.
 */
export function setSatelliteWaterClusters(material, clusters = [], absolute = false) {
  const uniforms = material?.userData?.satelliteWaterUniforms;
  if (!uniforms) return;
  for (let i = 0; i < 4; i++) {
    const c = clusters[i];
    uniforms.uWaterCities.value[i].set(
      Number.isFinite(c?.x) ? c.x - (absolute ? originMetres.x : 0) : 0,
      Number.isFinite(c?.z) ? c.z - (absolute ? originMetres.y : 0) : 0,
      clamp01(c?.intensity ?? 0),
      clamp01(c?.warmth ?? 0.5),
    );
  }
}

export function createSatelliteWaterMaterial() {
  const material = new MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.90, depthWrite: false,
  });
  material.name = 'satellite-cinematic-water';
  // Geometry prepared by addSatelliteWaterShore; prewarm's triangle and ocean
  // fill may omit it, where the constant default means fully offshore water.
  material.defaultAttributeValues = { aWaterShore: [10000, 10000, 10000] };
  applyBendWaterSat(material);
  const uniforms = { ...shared, uWaterCities: { value: Array.from({ length: 4 }, () => new Vector4()) } };
  material.userData.satelliteWaterUniforms = uniforms;
  const bend = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    bend(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aWaterShore;\nvarying vec3 vWaterShore;\nvarying vec3 vWaterWorld;\nvarying vec2 vWaterPlane;')
      .replace('wPos.y -= bendD * bendD * uBendK;', 'vWaterPlane = wPos.xz;\nvWaterShore = aWaterShore;\nwPos.y -= bendD * bendD * uBendK;\nvWaterWorld = wPos.xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uWaterEnabled;
uniform float uWaterTime;
uniform vec2 uWaterPhase;
uniform vec3 uWaterSun;
uniform vec3 uWaterMoon;
uniform vec4 uWaterLight;
uniform vec4 uWaterCities[4];
varying vec3 vWaterShore;
varying vec3 vWaterWorld;
varying vec2 vWaterPlane;
`)
      .replace('#include <opaque_fragment>', `
// Authored bounded reflection approximation: no reflection target, depth
// sampling, geometry displacement, or dependence on a geographic tile UV.
vec2 wp = (vWaterPlane + uWaterPhase) * 0.006135923151542565;
float t = uWaterTime;
vec2 wave = vec2(
  sin(dot(wp, vec2(19.0, 11.0)) + t * 0.7) + 0.35 * sin(dot(wp, vec2(47.0, -23.0)) - t * 1.1),
  cos(dot(wp, vec2(-13.0, 29.0)) - t * 0.5));
vec3 wn = normalize(vec3(wave.x * 0.024, 1.0, wave.y * 0.018));
vec3 eye = normalize(cameraPosition - vWaterWorld + vec3(0.0, 0.0001, 0.0));
float grazing = pow(1.0 - clamp(dot(wn, eye), 0.0, 1.0), 4.0);
float day = uWaterLight.x;
float night = uWaterLight.y;
float oc = uWaterLight.w;
vec3 sky = mix(vec3(0.012, 0.024, 0.052), vec3(0.19, 0.32, 0.43), day);
sky = mix(sky, vec3(dot(sky, vec3(0.2126, 0.7152, 0.0722))), oc * 0.56);
vec3 water = mix(mix(vec3(0.006, 0.013, 0.021), vec3(0.024, 0.075, 0.092), day), sky, 0.14 + 0.72 * grazing);
vec3 reflected = reflect(-eye, wn);
float sunLobe = pow(max(dot(reflected, uWaterSun), 0.0), 110.0) * day * (1.0 - oc);
float moonLobe = pow(max(dot(reflected, uWaterMoon), 0.0), 150.0) * night * (1.0 - oc);
water += vec3(1.0, 0.82, 0.58) * sunLobe * 1.1;
water += vec3(0.34, 0.49, 0.75) * moonLobe * 0.72;
// Four real urban clusters; project a narrow broken streak toward the eye.
// A rural coast has zero intensity in every slot, so it cannot invent a city.
for (int i = 0; i < 4; i++) {
  vec4 city = uWaterCities[i];
  vec2 ce = cameraPosition.xz - city.xy;
  float eyeDist = max(length(ce), 1.0);
  vec2 axis = ce / eyeDist;
  vec2 offset = vWaterPlane - city.xy;
  float along = dot(offset, axis);
  float across = abs(offset.x * axis.y - offset.y * axis.x + wave.x * 4.0);
  float width = 18.0 + max(along, 0.0) * 0.065;
  float streak = exp(-across * across / max(1.0, width * width));
  streak *= smoothstep(0.0, 24.0, along) * (1.0 - smoothstep(min(900.0, eyeDist), min(900.0, eyeDist) + 250.0, along));
  streak *= 0.25 + 0.75 * pow(0.5 + 0.5 * sin(wp.x * 53.0 + wp.y * 67.0 + t * 0.7), 4.0);
  water += mix(vec3(0.36, 0.55, 0.83), vec3(0.90, 0.52, 0.20), city.w) * streak * city.z * night * 0.24;
}
float shoreM = min(vWaterShore.x, min(vWaterShore.y, vWaterShore.z));
float shoreline = 1.0 - smoothstep(1.5, 8.0, shoreM);
water = mix(water, vec3(0.10, 0.17, 0.17) * (0.06 + day * 0.65), shoreline * 0.25);
outgoingLight = water;
diffuseColor.a *= uWaterEnabled * smoothstep(0.0, 3.0, shoreM);
#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => SATELLITE_WATER_KEY;
  material.needsUpdate = true;
  return material;
}

/** Actual shoreline distance within each boundary triangle. Water polygons
 * often contain boundary vertices only: setting vertex distance=0 would make
 * their entire interior transparent. Three opposite-edge distance channels
 * interpolate the distance correctly inside a triangle. Internal edges use a
 * large sentinel and never produce diagonal seams. O(triangles), build-only.
 * `tileBounds` excludes OFM clipping edges; they are not physical shoreline.
 * Returns a new non-indexed geometry when needed. Caller disposes old geometry.
 */
export function addSatelliteWaterShore(geometry, { tileBounds } = {}) {
  const pos = geometry.getAttribute('position');
  if (!pos) return geometry;
  const idx = geometry.index;
  const count = idx ? idx.count : pos.count;
  const vertex = (i) => idx ? idx.getX(i) : i;
  const pointKey = (i) => `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
  const edgeKey = (a, b) => { const pa = pointKey(a), pb = pointKey(b); return pa < pb ? `${pa}|${pb}` : `${pb}|${pa}`; };
  const counts = new Map();
  for (let t = 0; t + 2 < count; t += 3) {
    for (let e = 0; e < 3; e++) {
      const key = edgeKey(vertex(t + e), vertex(t + (e + 1) % 3));
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const clipped = (a, b) => {
    if (!tileBounds) return false;
    const [x0, z0, x1, z1] = tileBounds;
    const close = (x, y) => Math.abs(x - y) < 0.05;
    return [x0, x1].some((x) => close(pos.getX(a), x) && close(pos.getX(b), x)) ||
      [z0, z1].some((z) => close(pos.getZ(a), z) && close(pos.getZ(b), z));
  };
  const edges = new Float32Array(count * 3).fill(10000);
  for (let t = 0; t + 2 < count; t += 3) {
    for (let e = 0; e < 3; e++) {
      const opposite = vertex(t + e), a = vertex(t + (e + 1) % 3), b = vertex(t + (e + 2) % 3);
      if (counts.get(edgeKey(a, b)) !== 1 || clipped(a, b)) continue;
      const dx = pos.getX(b) - pos.getX(a), dz = pos.getZ(b) - pos.getZ(a);
      const area2 = Math.abs(dx * (pos.getZ(opposite) - pos.getZ(a)) - dz * (pos.getX(opposite) - pos.getX(a)));
      const height = area2 / Math.max(1e-8, Math.hypot(dx, dz));
      for (let v = 0; v < 3; v++) edges[(t + v) * 3 + e] = v === e ? height : 0;
    }
  }
  const result = idx ? geometry.toNonIndexed() : geometry;
  result.setAttribute('aWaterShore', new BufferAttribute(edges, 3));
  return result;
}
