import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { AIRCRAFT_EFFECTS as FX, clamp01, smoothBand } from './aircraft-effects.js';

// Absolute double-precision history survives floating-origin rebases. One
// bounded ring per emitter; no per-frame objects, shift(), or growing arrays.
const STRIDE = 8; // xyz, birth, density, distance, wind x/z at emission
export class WakeHistory {
  constructor(capacity = FX.points, life = FX.lifeSec) {
    this.capacity = capacity; this.life = life;
    this.data = new Float64Array(capacity * STRIDE);
    this.clear();
  }
  clear() { this.head = 0; this.count = 0; this.distance = 0; this.emitting = false; }
  offset(i) { return ((this.head - this.count + i + this.capacity) % this.capacity) * STRIDE; }
  prune(now) {
    while (this.count && now - this.data[this.offset(0) + 3] > this.life) this.count--;
  }
  record(x, y, z, now, density, spacing = FX.spacingM, windX = 0, windZ = 0) {
    if (!Number.isFinite(x + y + z + now + density + windX + windZ)) return;
    this.prune(now);
    const last = this.count ? this.offset(this.count - 1) : -1;
    const step = last < 0 ? 0 : Math.hypot(x - this.data[last], y - this.data[last + 1], z - this.data[last + 2]);
    if (last >= 0 && (step > FX.jumpM || now < this.data[last + 3])) this.clear();
    const active = density > .003;
    if (!active && !this.emitting) return;
    if (active && this.emitting && step < spacing) return;
    // On re-entry, insert a zero-density station before the new plume. Both
    // ends of the gap are transparent, so turns through the cold band cannot
    // draw a kilometre-long bridge across an interval with no condensation.
    if (active && !this.emitting && this.count) this.append(x, y, z, now, 0, 0, windX, windZ);
    this.append(x, y, z, now, active ? clamp01(density) : 0, step, windX, windZ);
    this.emitting = active;
  }
  append(x, y, z, now, density, distance, windX, windZ) {
    const i = this.head * STRIDE, d = this.data;
    this.distance += distance;
    d[i] = x; d[i + 1] = y; d[i + 2] = z; d[i + 3] = now;
    d[i + 4] = density; d[i + 5] = this.distance; d[i + 6] = windX; d[i + 7] = windZ;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }
}

/** Feathered optical density. This wraps the air-bend material, retaining its
 * shader and using a distinct key. Normal alpha blending keeps night wakes
 * from behaving like emissive neon tubes. No texture download or extra pass. */
export function softenWakeMaterial(material, { bend = false } = {}) {
  const before = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before?.(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec3 aWake; varying vec3 vWake;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWake = aWake;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWake;')
      .replace('#include <color_fragment>', `#include <color_fragment>
float edge = exp(-3.8 * vWake.x * vWake.x) * (1.0 - smoothstep(.65, 1.0, abs(vWake.x)));
float billow = .78 + .13 * sin(vWake.y * .041 + vWake.x * 4.0) + .09 * sin(vWake.y * .097 - vWake.x * 7.0);
diffuseColor.a *= edge * billow * vWake.z;`);
    // Air-bend's shared patch darkens RGB at the horizon (correct for
    // additive tracers). Optical vapor must also fade alpha, not turn black.
    if (bend) shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>',
      '#include <fog_fragment>\ngl_FragColor.a *= 1.0 - smoothstep(uEdgeFade.x, uEdgeFade.y, vAirDist);');
  };
  material.customProgramCacheKey = () => `${key}|optical-wake-v1`;
}

/** The ONE construction path for plume materials (WakeBatch and prewarm), so
 * a warmed program can never differ from the drawn one. */
export function makeWakeMaterial(patchMaterial) {
  const mat = new MeshBasicMaterial({ color: '#dce8f5', transparent: true, opacity: FX.opacity, depthWrite: false, side: DoubleSide, fog: false });
  patchMaterial?.(mat); softenWakeMaterial(mat, { bend: !!patchMaterial });
  return mat;
}

const tangent = new Vector3(), view = new Vector3(), side = new Vector3(), forward = new Vector3();
const segment = new Vector3(), closest = new Vector3();
function segmentDistance(a, b, camera) {
  segment.subVectors(b, a);
  const t = clamp01(closest.subVectors(camera, a).dot(segment) / Math.max(1e-9, segment.lengthSq()));
  return closest.copy(a).addScaledVector(segment, t).distanceTo(camera);
}

/** All plumes in ONE draw, indexed quads in a preallocated buffer. The
 * finite-width centerline expands with age, advects in wind, then dissolves.
 * Existing samples retain their own density after descent/engine cutoff. */
export class WakeBatch {
  constructor(maxRibbons, points = FX.points, patchMaterial) {
    this.points = points; this.maxRibbons = maxRibbons; this.used = 0;
    const vertices = maxRibbons * points * 2;
    const geo = new BufferGeometry();
    this.pos = new BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(DynamicDrawUsage);
    this.wake = new BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(DynamicDrawUsage);
    geo.setAttribute('position', this.pos); geo.setAttribute('aWake', this.wake);
    const indices = new (vertices > 65535 ? Uint32Array : Uint16Array)(maxRibbons * (points - 1) * 6);
    for (let r = 0, k = 0; r < maxRibbons; r++) for (let p = 0; p < points - 1; p++) {
      const v = (r * points + p) * 2;
      indices.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], k); k += 6;
    }
    geo.setIndex(new BufferAttribute(indices, 1)); geo.setDrawRange(0, 0);
    const mat = makeWakeMaterial(patchMaterial);
    this.mesh = new Mesh(geo, mat); this.mesh.name = 'aircraft-condensation';
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    this.centers = Array.from({ length: points }, () => new Vector3());
    this.ages = new Float64Array(points);
    this.distances = new Float64Array(points);
  }
  begin(camera) { this.used = 0; this.camera = camera; camera.getWorldDirection(forward); }
  add(history, now, anchor, { width = FX.widthM, spread = FX.spreadMps, opacity = 1 } = {}) {
    history.prune(now);
    const n = Math.min(history.count, this.points);
    if (n < 2 || this.used >= this.maxRibbons) return;
    const d = history.data, c = this.centers, camera = this.camera;
    for (let j = 0; j < n; j++) {
      const i = history.offset(history.count - n + j), age = Math.max(0, now - d[i + 3]);
      this.ages[j] = age;
      // Slowly rolling wisps: world-distance phase stays stable through rebases.
      const curl = Math.sin(d[i + 5] * .013 + age * .28) * Math.min(4, age * .13);
      c[j].set(d[i] - anchor.x + d[i + 6] * age + curl,
        d[i + 1] - age * .14, d[i + 2] - anchor.z + d[i + 7] * age);
      this.distances[j] = c[j].distanceTo(camera.position);
    }
    // Fade segments that cross the camera even when both endpoints are far
    // away. Endpoint-only tests miss exactly that case at boost/frame hitches.
    for (let j = 0; j < n - 1; j++) {
      const dist = segmentDistance(c[j], c[j + 1], camera.position);
      this.distances[j] = Math.min(this.distances[j], dist);
      this.distances[j + 1] = Math.min(this.distances[j + 1], dist);
    }
    let v = this.used * this.points * 6;
    for (let j = 0; j < this.points; j++, v += 6) {
      const p = c[Math.min(j, n - 1)], age = this.ages[Math.min(j, n - 1)];
      let half = 0, density = 0, distance = 0;
      if (j < n) {
        const i = history.offset(history.count - n + j);
        tangent.subVectors(c[Math.min(n - 1, j + 1)], c[Math.max(0, j - 1)]);
        view.subVectors(p, camera.position); side.crossVectors(view, tangent);
        const sin = side.length() / Math.max(1e-9, view.length() * tangent.length());
        const near = smoothBand(FX.nearStartM, FX.nearEndM, this.distances[j]);
        const angle = smoothBand(.025, .18, sin);
        side.normalize();
        half = (width + spread * Math.sqrt(age) * 2.2) * .5 * near * angle * (view.dot(forward) > 0 ? 1 : 0);
        density = d[i + 4] * smoothBand(0, .7, age) * (1 - smoothBand(history.life * .4, history.life, age)) * opacity;
        // Retire the oldest end smoothly even when capacity, rather than time,
        // expires it during boost. The head condenses a short way aft.
        density *= smoothBand(0, 3, j);
        distance = d[i + 5];
      }
      this.pos.setXYZ(v / 3, p.x + side.x * half, p.y + side.y * half, p.z + side.z * half);
      this.pos.setXYZ(v / 3 + 1, p.x - side.x * half, p.y - side.y * half, p.z - side.z * half);
      this.wake.setXYZ(v / 3, -1, distance, density);
      this.wake.setXYZ(v / 3 + 1, 1, distance, density);
    }
    this.used++;
  }
  end(sunFrac = 1, toy = false) {
    const day = smoothBand(0, .3, sunFrac);
    this.mesh.material.color.setRGB(.17 + day * .73, .22 + day * .72, .31 + day * .66);
    this.mesh.material.opacity = FX.opacity * (toy ? .8 : 1);
    this.mesh.visible = this.used > 0;
    this.mesh.geometry.setDrawRange(0, this.used * (this.points - 1) * 6);
    for (const attr of [this.pos, this.wake]) {
      attr.clearUpdateRanges(); attr.addUpdateRange(0, this.used * this.points * 6); attr.needsUpdate = true;
    }
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
