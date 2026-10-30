/**
 * LIVING WORLD — HANGAR_STAGE (FLY_LIVING_WORLD.md, UI-FLIGHT): the pure parts
 * of the hangar stage. The camera framing (the same goal the classic bay cuts
 * to), the eased move between two framings, and the two additive materials
 * that make the door haze: camera-facing light shafts and drifting dust.
 *
 * Everything here is created only when HANGAR_STAGE is on (HangarScene.jsx
 * renders the classic Bay otherwise), so none of it can touch today's frame.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';

/** The classic bay's framing table, verbatim (HangarScene.jsx, Bay). */
export const VIEW_POSITIONS = { quarter: [0.65, 0.46, -1.35], front: [0, 0.25, -1.65], side: [1.65, 0.32, 0.08], rear: [-0.62, 0.36, 1.5] };

/**
 * Where the camera rests for a view, identical to the classic bay's cut:
 * position, look target and the view offset that keeps the aircraft clear of
 * the dispatch column.
 */
export function hangarCameraGoal(view, viewLength, hallHeight, widthPx, heightPx) {
  const portrait = widthPx < heightPx;
  const aspect = widthPx / Math.max(1, heightPx);
  const distanceScale = Math.max(portrait ? (viewLength > 25 ? 1.8 : 1.55) : 1, Math.min(2, 1.4 / aspect));
  const position = VIEW_POSITIONS[view || 'quarter'].map((v) => v * viewLength * distanceScale);
  position[1] = Math.min(position[1], hallHeight * 0.7);
  return {
    position,
    target: [0, viewLength * 0.07, 0],
    offset: [widthPx > 900 ? widthPx * 0.08 : 0, portrait ? heightPx * 0.17 : 0],
  };
}

export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const _a = new Vector3();
const _b = new Vector3();

/**
 * One eased camera move: from a pose to a goal, swinging round the look
 * target on an arc (spherical interpolation of the offset, shortest way
 * round) instead of cutting through the aircraft on a straight line.
 */
export class CameraGlide {
  constructor() {
    this.active = false;
    this.t = 0;
    this.duration = 1;
    this.from = { position: new Vector3(), target: new Vector3() };
    this.to = { position: new Vector3(), target: new Vector3() };
    this._fromS = { r: 0, theta: 0, phi: 0 };
    this._toS = { r: 0, theta: 0, phi: 0 };
  }

  static spherical(position, target, out) {
    _a.subVectors(position, target);
    out.r = Math.max(1e-3, _a.length());
    out.theta = Math.atan2(_a.x, _a.z);
    out.phi = Math.acos(Math.max(-1, Math.min(1, _a.y / out.r)));
    return out;
  }

  start(fromPosition, fromTarget, toPosition, toTarget, { minSec = 0.9, maxSec = 1.5 } = {}) {
    this.from.position.copy(fromPosition);
    this.from.target.copy(fromTarget);
    this.to.position.copy(toPosition);
    this.to.target.copy(toTarget);
    CameraGlide.spherical(this.from.position, this.from.target, this._fromS);
    CameraGlide.spherical(this.to.position, this.to.target, this._toS);
    let d = this._toS.theta - this._fromS.theta;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this._toS.theta = this._fromS.theta + d;
    const swing = Math.min(1, Math.abs(d) / Math.PI + Math.abs(Math.log(this._toS.r / this._fromS.r)) * 0.6);
    this.duration = minSec + (maxSec - minSec) * swing;
    this.t = 0;
    this.active = true;
  }

  stop() {
    this.active = false;
  }

  /** Advance and write the pose; returns true while the move runs. */
  step(dt, position, target) {
    if (!this.active) return false;
    this.t = Math.min(1, this.t + dt / this.duration);
    const k = easeInOutCubic(this.t);
    target.lerpVectors(this.from.target, this.to.target, k);
    const r = this._fromS.r + (this._toS.r - this._fromS.r) * k;
    const theta = this._fromS.theta + (this._toS.theta - this._fromS.theta) * k;
    const phi = this._fromS.phi + (this._toS.phi - this._fromS.phi) * k;
    _b.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta)).multiplyScalar(r);
    position.copy(target).add(_b);
    if (this.t >= 1) {
      position.copy(this.to.position);
      target.copy(this.to.target);
      this.active = false;
    }
    return true;
  }
}

/** Move the haze and the dust on by dt seconds. */
export function advanceHaze(haze, dt) {
  for (const m of haze.materials) m.uniforms.uTime.value += dt;
  haze.moteMaterial.uniforms.uTime.value += dt;
}

/** A unit quad standing on its base (x in [-0.5, 0.5], y in [0, 1]). */
export function shaftGeometry() {
  return new PlaneGeometry(1, 1, 1, 6).translate(0, 0.5, 0);
}

/**
 * A light shaft: a quad from `start` along `axis`, turned about that axis to
 * face the camera (so it reads as a volume from any orbit), soft across its
 * width, bright near the door and fading into the hall. Additive, unlit, no
 * depth write: it only ever adds light.
 */
export function createShaftMaterial({ start, axis, length, width, color, intensity, seed, curtain = false }) {
  return new ShaderMaterial({
    uniforms: {
      uStart: { value: new Vector3(...start) },
      uAxis: { value: new Vector3(...axis).normalize() },
      uLength: { value: length },
      uWidth: { value: width },
      uColor: { value: new Color(color) },
      uIntensity: { value: intensity },
      uTime: { value: 0 },
      uSeed: { value: seed },
      uCurtain: { value: curtain ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      uniform vec3 uStart;
      uniform vec3 uAxis;
      uniform float uLength;
      uniform float uWidth;
      varying vec2 vUv;
      varying float vFacing;
      void main() {
        vec3 mid = uStart + uAxis * (uLength * 0.5);
        vec3 toCam = normalize(cameraPosition - mid);
        vec3 side = normalize(cross(uAxis, toCam));
        float spread = mix(0.8, 1.45, position.y);
        vec3 p = uStart + uAxis * (position.y * uLength) + side * (position.x * uWidth * spread);
        vUv = vec2(position.x + 0.5, position.y);
        // Seen end-on a shaft collapses toward a line: soften it there.
        vFacing = 1.0 - abs(dot(uAxis, toCam));
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uTime;
      uniform float uSeed;
      uniform float uCurtain;
      varying vec2 vUv;
      varying float vFacing;
      void main() {
        float x = vUv.x * 2.0 - 1.0;
        // A shaft: a soft core. Gone well before its far end, so the quad
        // never meets the floor.
        float across = exp(-x * x * 3.2) - 0.04;
        float along = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.28, 0.78, vUv.y));
        // The doorway curtain: even across the opening, brightest at the
        // floor where the sunlit apron glows, gone by two thirds up.
        across = mix(across, 1.0 - smoothstep(0.7, 1.0, abs(x)), uCurtain);
        along = mix(along, 1.0 - smoothstep(0.0, 0.66, vUv.y), uCurtain);
        float grain = 0.72 + 0.28 * sin(vUv.x * 11.0 + uSeed * 6.0 + uTime * 0.21) * sin(vUv.y * 5.0 - uTime * 0.13 + uSeed);
        float a = max(across, 0.0) * along * grain * uIntensity * mix(0.45, 1.0, smoothstep(0.1, 0.5, vFacing));
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
}

/** Dust in the door light: points scattered through the shaft volumes, drifting slowly. */
export function moteGeometry(count, shafts, rand = mulberry(7)) {
  const pos = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const s = shafts[i % shafts.length];
    const t = 0.05 + rand() * 0.5;
    const across = (rand() - 0.5) * s.width * (0.8 + 0.65 * t) * 1.2;
    pos[i * 3] = s.start[0] + s.axis[0] * s.length * t + across;
    pos[i * 3 + 1] = s.start[1] + s.axis[1] * s.length * t + (rand() - 0.5) * 0.6;
    pos[i * 3 + 2] = s.start[2] + s.axis[2] * s.length * t + (rand() - 0.5) * s.width * 0.6;
    phase[i] = rand() * 6.2831853;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aPhase', new BufferAttribute(phase, 1));
  return g;
}

export function createMoteMaterial({ color, size, intensity }) {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new Color(color) }, uSize: { value: size }, uIntensity: { value: intensity } },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      uniform float uTime;
      uniform float uSize;
      varying float vTwinkle;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.11 + aPhase) * 0.35;
        p.y += sin(uTime * 0.07 + aPhase * 1.7) * 0.45;
        p.z += cos(uTime * 0.09 + aPhase * 0.6) * 0.35;
        vTwinkle = 0.55 + 0.45 * sin(uTime * 0.6 + aPhase * 3.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying float vTwinkle;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.2, 1.0, d)) * vTwinkle * uIntensity;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/*
 * SHIP PASS LIGHT — HANGAR_EXPOSURE (FLY_SHIP_PASS.md LT-7). The studio lights
 * were set for a mid-grey airframe, so a white livery's nose clipped. The key,
 * pool, rims and door sun now scale by the livery's albedo luminance; darker
 * liveries never get brighter than today. Pure helpers (node-gated).
 */
const luma = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/**
 * Area-weighted (by triangle count) linear albedo luminance of an airframe:
 * the painted preset's hull/trim/accent when a paint preset is on, else each
 * mesh's material colour times its mean vertex colour. 0.5 when unknown.
 */
export function liveryLuminance(root) {
  const paint = root?.userData?.fleetPaint?.uniforms;
  if (paint?.uFleetPaintOn?.value === 1 && paint.uFleetHull?.value) {
    return 0.75 * luma(paint.uFleetHull.value) + 0.15 * luma(paint.uFleetTrim.value) + 0.1 * luma(paint.uFleetAccent.value);
  }
  let sum = 0;
  let weight = 0;
  root?.traverse?.((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
    if (!(tris > 0)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const m = mats[0];
    if (!m?.color || m.transparent) return;
    let k = luma(m.color);
    const attr = m.vertexColors ? g.getAttribute?.('color') : null;
    if (attr) {
      let s = 0;
      let n = 0;
      const step = Math.max(1, Math.floor(attr.count / 256));
      for (let i = 0; i < attr.count; i += step) {
        s += 0.2126 * attr.getX(i) + 0.7152 * attr.getY(i) + 0.0722 * attr.getZ(i);
        n++;
      }
      if (n) k *= s / n;
    }
    sum += k * tris;
    weight += tris;
  });
  return weight > 0 ? sum / weight : 0.5;
}

/** Light scale for a livery luminance: targetLuma / luma, clamped [minScale, maxScale]. */
export function hangarExposureScale(liveryLuma, cfg = {}) {
  const target = cfg.targetLuma ?? 0.42;
  if (!(liveryLuma > 0)) return 1;
  return Math.min(cfg.maxScale ?? 1, Math.max(cfg.minScale ?? 0.55, target / liveryLuma));
}

/** The reflector render-target size: halved (reflectorScale) on Medium. */
export function hangarReflectorResolution(tier, cfg = null) {
  const base = tier === 'high' ? 1024 : 512;
  if (!cfg || tier !== 'medium') return base;
  return Math.max(128, Math.round(base * (cfg.reflectorScale ?? 0.5)));
}
