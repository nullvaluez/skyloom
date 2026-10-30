/**
 * SHIP PASS LIGHT — TRAFFIC_SHADOWS (FLY_SHIP_PASS.md LT-3): live aircraft
 * land on their shadows.
 *
 * Driven from lib/fly/detailed-traffic.js (this stream's file; TrafficLayer.jsx
 * is frozen), and only constructed when the flag is on, so with the flag off
 * the fleet's meshes, materials and draws are exactly today's.
 *
 * Two paths, chosen by deviceFeature('TRAFFIC_SHADOWS') at the live tier:
 *  - 'caster' (desktop High/Ultra): the nearest hero/mid instanced meshes with
 *    a contact inside casterRangeM cast into the cinema cascades through the
 *    fleet depth material (fleet-material.js createFleetDepthMaterial, the
 *    parked fleet's own caster), at most maxCasterMeshes of them. Each draws
 *    only its in-range prefix of instances, only into cascades its bounding
 *    sphere touches, and the (mesh, cascade) pairs per frame are capped by the
 *    policy's draw budget — decided once per frame, so a second shadow render
 *    in the same frame (a reflection pass) draws exactly the same casters.
 *  - 'blob' (Medium, touch): an analytic contact blob — one instanced quad
 *    draw — on the drawn ground under aircraft below blobBelowAglM, offset
 *    away from the key light and fading out with height.
 */
import {
  DynamicDrawUsage,
  Frustum,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three';
import { createFleetDepthMaterial } from './fleet-material';
import { applyBend, groundOverlayOffset } from './toy-world/world-bend';
import { projectModelMatrix } from './render-scale';
import { lightBlock, lightFeature, shipPassOn } from './ship-light';
import { CINEMA_UNIFORMS } from './cinema-frame';
import { useFlyStore } from '../../stores/fly-store';

/** 'caster' | 'blob' | null for a tier (flag, policy, Enhanced). */
export function trafficShadowPath({ tier, preset, cls, enhanced = true } = {}) {
  if (!shipPassOn('TRAFFIC_SHADOWS') || !enhanced) return null;
  const f = lightFeature('TRAFFIC_SHADOWS', { tier, preset, cls });
  if (!f.allowed) return null;
  return f.budget?.path === 'caster' ? 'caster' : 'blob';
}

/**
 * Blob placement for one aircraft (pure; node-gated). Returns null above the
 * blob ceiling, else { x, y, z, sx, sz, yaw, alpha } in the instance frame
 * (metres before the mercator projection). sun: unit direction TOWARD the
 * key light (y up).
 */
export function blobPose({ x, y, z, yaw, groundY, span, length, scale = 1, eff = 1 }, sun, maxAglM, cfg) {
  if (!Number.isFinite(groundY) || !(maxAglM > 0)) return null;
  const agl = Math.max(0, y - groundY);
  if (agl >= maxAglM) return null;
  const fade = 1 - agl / maxAglM;
  const alpha = (cfg.opacity ?? 0.5) * fade * fade * Math.max(0, Math.min(1, eff));
  if (alpha < 0.003) return null;
  // The shadow falls away from the light, agl / tan(elevation) along the
  // ground, never further than sunStretchMax body lengths.
  const lxz = Math.hypot(sun.x, sun.z);
  let ox = 0, oz = 0;
  if (lxz > 1e-4 && sun.y > 0) {
    const reach = Math.min((agl * lxz) / sun.y, (cfg.sunStretchMax ?? 2.5) * length * scale);
    ox = (-sun.x / lxz) * reach;
    oz = (-sun.z / lxz) * reach;
  }
  return {
    x: x + ox,
    y: groundY + (cfg.liftM ?? 0.3),
    z: z + oz,
    sx: span * scale * (cfg.spanPad ?? 1.05),
    sz: length * scale * (cfg.lengthPad ?? 1.1),
    yaw,
    alpha,
  };
}

const BLOB_VERT = `#include <common>
attribute float aBlob;
varying float vBlob;
varying vec2 vBlobXY;
void main() {
vBlob = aBlob;
vBlobXY = position.xz * 2.;
#include <begin_vertex>
#include <project_vertex>
}`;
const BLOB_FRAG = `uniform vec3 uBlobColor;
varying float vBlob;
varying vec2 vBlobXY;
void main() {
float r = length(vBlobXY);
float a = vBlob * (1. - smoothstep(.3, 1., r));
if (a < .003) discard;
gl_FragColor = vec4(uBlobColor, a);
}`;

export function createBlobMaterial() {
  const m = new ShaderMaterial({
    name: 'traffic-contact-blob',
    uniforms: { uBlobColor: { value: new Vector3(0.012, 0.016, 0.022) } },
    vertexShader: BLOB_VERT,
    fragmentShader: BLOB_FRAG,
    transparent: true,
    depthWrite: false,
    ...(groundOverlayOffset() ?? {}),
  });
  // On the drawn ground: the ground's bend (world-bend's shared variant).
  applyBend(m);
  const key = m.customProgramCacheKey();
  m.customProgramCacheKey = () => `${key}|traffic-blob-v1`;
  return m;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);
const _frustum = new Frustum();
const _proj = new Matrix4();
const _sphere = new Sphere();

export class TrafficShadows {
  constructor(group) {
    this.group = group;
    const cfg = lightBlock('TRAFFIC_SHADOWS');
    this.cfg = cfg;
    const max = cfg.blob?.maxBlobs ?? 48;
    const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.alpha = new InstancedBufferAttribute(new Float32Array(max), 1).setUsage(DynamicDrawUsage);
    geometry.setAttribute('aBlob', this.alpha);
    this.blobs = new InstancedMesh(geometry, createBlobMaterial(), max);
    this.blobs.name = 'live-contact-blobs';
    this.blobs.instanceMatrix.setUsage(DynamicDrawUsage);
    this.blobs.frustumCulled = false;
    this.blobs.renderOrder = -1;
    this.blobs.count = 0;
    this.blobs.castShadow = false;
    this.blobs.receiveShadow = false;
    group.add(this.blobs);
    this.path = null;
    this.frame = 0;
    this.casting = new Set();
    this.track = new Map(); // mesh -> { cast, minD, sphere }
    this.pairs = new Map(); // `${cam.id}:${mesh.id}` -> allowed (this frame)
    this.pairBudget = 2;
    this.pairCount = 0;
    this.stats = { path: null, casters: 0, castInstances: 0, shadowDraws: 0, blobs: 0 };
  }

  /** Start a frame: the path for this tier, and the frame's caster book. */
  begin({ tier }) {
    this.frame++;
    const st = useFlyStore.getState();
    const preset = st.qualityPreset;
    this.path = trafficShadowPath({ tier, preset, enhanced: st.visuals === 'enhanced' && CINEMA_UNIFORMS.uCinema.value > 0.5 });
    this.sun = CINEMA_UNIFORMS.uCinemaKey.value;
    const policy = this.path ? lightFeature('TRAFFIC_SHADOWS', { tier, preset }) : null;
    this.maxAglM = policy?.budget?.blobBelowAglM ?? 60;
    this.pairBudget = policy?.budget?.draws ?? 2;
    this.pairs.clear();
    this.pairCount = 0;
    for (const t of this.track.values()) {
      t.cast = 0;
      t.minD = Infinity;
      t.sphere.makeEmpty();
    }
    this.blobCount = 0;
    this.stats.shadowDraws = this.stats.pendingDraws ?? 0;
    this.stats.pendingDraws = 0;
  }

  /**
   * One placed instance. mesh: the instanced mesh it went into (slot =
   * its index); lod 'hero' | 'mid' | 'far'; distM from the camera; pose:
   * the instance matrix (scene); radius: its bounding radius (scene units).
   */
  note(mesh, slot, lod, distM, matrix, radius) {
    if (this.path !== 'caster' || lod === 'far' || !(distM < (this.cfg.casterRangeM ?? 4000))) return;
    let t = this.track.get(mesh);
    if (!t) {
      t = { cast: 0, minD: Infinity, sphere: new Sphere().makeEmpty() };
      this.track.set(mesh, t);
    }
    t.cast = Math.max(t.cast, slot + 1);
    t.minD = Math.min(t.minD, distM);
    _sphere.center.setFromMatrixPosition(matrix);
    _sphere.radius = radius;
    if (t.sphere.isEmpty()) t.sphere.copy(_sphere);
    else t.sphere.union(_sphere);
  }

  /** One blob candidate (blob path only); see blobPose. */
  blob(input, mercator) {
    if (this.path !== 'blob' || this.blobCount >= this.blobs.instanceMatrix.count) return;
    const b = blobPose(input, this.sun, this.maxAglM, this.cfg.blob ?? {});
    if (!b) return;
    _q.setFromAxisAngle(_up, -b.yaw);
    _m.compose(_p.set(b.x, b.y, b.z), _q, _s.set(b.sx, 1, b.sz));
    projectModelMatrix(_m, mercator);
    const i = this.blobCount++;
    this.blobs.setMatrixAt(i, _m);
    this.alpha.setX(i, b.alpha);
  }

  /** Close the frame: pick the casting meshes, flush the blobs. */
  end() {
    // Casters: the nearest maxCasterMeshes meshes with an in-range contact.
    const want = new Set();
    if (this.path === 'caster') {
      const ranked = [...this.track.entries()].filter(([mesh, t]) => t.cast > 0 && mesh.count > 0).sort((a, b) => a[1].minD - b[1].minD);
      for (const [mesh] of ranked.slice(0, this.cfg.maxCasterMeshes ?? 2)) want.add(mesh);
    }
    for (const mesh of this.casting) if (!want.has(mesh)) mesh.castShadow = false;
    let instances = 0;
    for (const mesh of want) {
      this._arm(mesh);
      mesh.castShadow = true;
      instances += this.track.get(mesh).cast;
    }
    this.casting = want;
    const n = this.blobCount;
    this.blobs.count = n;
    if (n) {
      this.blobs.instanceMatrix.clearUpdateRanges();
      this.blobs.instanceMatrix.addUpdateRange(0, n * 16);
      this.blobs.instanceMatrix.needsUpdate = true;
      this.alpha.clearUpdateRanges();
      this.alpha.addUpdateRange(0, n);
      this.alpha.needsUpdate = true;
    }
    Object.assign(this.stats, { path: this.path, casters: want.size, castInstances: instances, blobs: n });
  }

  /** The caster hooks, once per mesh: depth material and per-cascade cull. */
  _arm(mesh) {
    if (mesh.userData.shipShadowArmed) return;
    mesh.userData.shipShadowArmed = true;
    // One depth material per family material (hero and mid share it).
    mesh.customDepthMaterial ??= mesh.material.userData.shipShadowDepth ??= createFleetDepthMaterial(mesh.material);
    mesh.onBeforeShadow = (renderer, object, camera, shadowCamera) => {
      const t = this.track.get(object);
      const key = `${shadowCamera.id}:${object.id}`;
      let allowed = this.pairs.get(key);
      if (allowed === undefined) {
        allowed = false;
        if (t?.cast > 0 && this.casting.has(object) && this.pairCount < this.pairBudget) {
          _proj.multiplyMatrices(shadowCamera.projectionMatrix, shadowCamera.matrixWorldInverse);
          _frustum.setFromProjectionMatrix(_proj, shadowCamera.coordinateSystem, shadowCamera.reversedDepth);
          _sphere.copy(t.sphere).applyMatrix4(object.matrixWorld);
          if (_frustum.intersectsSphere(_sphere)) {
            allowed = true;
            this.pairCount++;
            this.stats.pendingDraws = this.pairCount;
          }
        }
        this.pairs.set(key, allowed);
      }
      object.userData.shipShadowCount = object.count;
      object.count = allowed ? Math.min(object.count, t.cast) : 0;
    };
    mesh.onAfterShadow = (renderer, object) => {
      if (object.userData.shipShadowCount !== undefined) object.count = object.userData.shipShadowCount;
      object.userData.shipShadowCount = undefined;
    };
  }

  dispose() {
    for (const mesh of this.track.keys()) {
      mesh.castShadow = false;
      mesh.material?.userData?.shipShadowDepth?.dispose();
    }
    this.track.clear();
    this.casting.clear();
    this.blobs.removeFromParent();
    this.blobs.geometry.dispose();
    this.blobs.material.dispose();
    this.blobs.dispose();
  }
}
