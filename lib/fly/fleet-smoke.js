// Touchdown tyre smoke: when a live contact goes from airborne to grounded at
// landing speed, the main wheels spin up and puff blue-white smoke that hangs
// behind the rollout, grows, drifts with the wind and fades in a few seconds.
//
// One instanced draw (sky-overlay pass: drawn after the cloud composite, depth
// tested against the real scene), billboards built in VIEW space so they stay
// round under the anisotropic TRUE_SCALE camera. Puffs keep ABSOLUTE scene
// positions (float64 on the CPU) and are rebased every frame, so floating
// origin rebases cannot move them.
import { DynamicDrawUsage, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NormalBlending, ShaderMaterial, Vector3 } from 'three';
import { shareBendUniforms } from './toy-world/world-bend';
import { OVERLAY_GATE_GLSL, bindOverlayGate } from './overlay-gate';
import { FLEET_VIEW } from './observation-config';

const VERT = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 aPuff;   // xyz rebased centre, w radius (m)
attribute vec4 aLook;   // x opacity, y seed, z age fraction, w unused
uniform vec2 uBendCenter; uniform float uBendK;
varying vec2 vUv; varying vec4 vLook; varying vec3 vOvW;
void main() {
  vec4 w = modelMatrix * vec4( aPuff.xyz, 1.0 );
  float d = distance( w.xz, uBendCenter );
  w.y -= d * d * uBendK;
  vOvW = w.xyz;
  vec4 mv = viewMatrix * w;
  // View space is TRUE space scaled by k0 (TRUE_SCALE): the view matrix's
  // Y column has length k0, 1 when the flag is off.
  float r = aPuff.w * length( viewMatrix[ 1 ].xyz );
  mv.xy += aCorner * r;
  vUv = aCorner; vLook = aLook;
  gl_Position = projectionMatrix * mv;
  if ( aLook.x <= 0.0 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
}
`;

const FRAG = /* glsl */ `
uniform vec3 uLit; uniform vec3 uShade; uniform float uOvFloor;
varying vec2 vUv; varying vec4 vLook; varying vec3 vOvW;
${OVERLAY_GATE_GLSL}
float h( vec2 p ) { vec3 q = fract( vec3( p.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
float n( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( h( i ), h( i + vec2( 1, 0 ) ), f.x ), mix( h( i + vec2( 0, 1 ) ), h( i + vec2( 1, 1 ) ), f.x ), f.y ); }
void main() {
  float r = length( vUv );
  if ( r >= 1.0 ) discard;
  vec2 p = vUv * 2.6 + vLook.y * 17.0;
  float billow = 0.62 + 0.38 * ( n( p ) * 0.65 + n( p * 2.3 ) * 0.35 );
  float a = pow( 1.0 - r * r, 1.6 ) * billow * vLook.x;
  // Lit from above, shaded underneath.
  vec3 c = mix( uShade, uLit, clamp( 0.55 + vUv.y * 0.5, 0.0, 1.0 ) );
  a *= max( ovCloudGate( vOvW ), uOvFloor );
  gl_FragColor = vec4( c * a, a );
}
`;

export class TouchdownSmoke {
  constructor({ capacity = FLEET_VIEW.smoke.capacity } = {}) {
    this.capacity = capacity;
    const g = new InstancedBufferGeometry();
    g.setAttribute('aCorner', new Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.puffAttr = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
    this.lookAttr = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
    g.setAttribute('aPuff', this.puffAttr);
    g.setAttribute('aLook', this.lookAttr);
    g.instanceCount = 0;
    this.uniforms = shareBendUniforms({ uLit: { value: new Vector3(0.9, 0.9, 0.92) }, uShade: { value: new Vector3(0.45, 0.47, 0.52) }, uOvFloor: { value: 0.2 } });
    bindOverlayGate(this.uniforms);
    const material = new ShaderMaterial({
      name: 'touchdown-smoke',
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: NormalBlending,
      premultipliedAlpha: true,
      toneMapped: false,
    });
    this.mesh = new Mesh(g, material);
    this.mesh.name = 'touchdown-smoke';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.visible = false;
    // Puff pool: absolute position (f64), velocity, birth, radius, seed.
    this.puffs = [];
    this.emitters = new Map(); // hex -> { until, last }
  }

  /** A contact just touched down: emit from its main wheels for a moment. */
  touchdown(track, spec, family, now) {
    this.emitters.set(track.hex, { until: now + 0.7, next: now, seed: Math.random() });
  }

  /** Called with the contact's instance matrix while it is emitting. */
  emitFrom(track, matrix, layout, origin, now, wind) {
    const e = this.emitters.get(track.hex);
    if (!e) return;
    if (now > e.until) { this.emitters.delete(track.hex); return; }
    if (now < e.next) return;
    e.next = now + 0.07;
    const fix = track.fix1;
    for (const c of layout.mainContacts) {
      const p = new Vector3(c.x, c.y + 0.3, c.z).applyMatrix4(matrix);
      if (this.puffs.length >= this.capacity) this.puffs.shift();
      // Smoke leaves the tyre at a fraction of the ground speed, then hangs.
      this.puffs.push({
        x: p.x + origin.anchor.x, y: p.y, z: p.z + origin.anchor.z,
        vx: (fix?.vE ?? 0) * 0.12 + (wind?.x ?? 0), vy: 0.6, vz: -(fix?.vN ?? 0) * 0.12 + (wind?.z ?? 0),
        born: now, r0: 1.2 + Math.random() * 0.6, seed: Math.random(), life: FLEET_VIEW.smoke.lifeSec * (0.75 + Math.random() * 0.5),
      });
    }
  }

  isEmitting(hex) {
    return this.emitters.has(hex);
  }

  /** Advance, rebase and upload. sun: { lit [r,g,b], shade [r,g,b] } radiance (already exposed). */
  update(origin, now, dt, lit, shade) {
    const out = this.puffAttr.array, look = this.lookAttr.array;
    let n = 0;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i], age = now - p.born;
      if (age > p.life || age < 0) { this.puffs.splice(i, 1); continue; }
      const drag = Math.exp(-age * 0.9);
      p.x += p.vx * drag * dt; p.y += p.vy * dt * 0.4; p.z += p.vz * drag * dt;
      const t = age / p.life;
      out[n * 4] = p.x - origin.anchor.x; out[n * 4 + 1] = p.y; out[n * 4 + 2] = p.z - origin.anchor.z;
      out[n * 4 + 3] = p.r0 + 9 * Math.sqrt(t) + age * 0.6;
      look[n * 4] = 0.55 * Math.min(1, age * 6) * Math.pow(1 - t, 1.4);
      look[n * 4 + 1] = p.seed;
      look[n * 4 + 2] = t;
      n++;
    }
    this.mesh.geometry.instanceCount = n;
    this.puffAttr.needsUpdate = this.lookAttr.needsUpdate = true;
    this.mesh.visible = n > 0;
    if (lit) this.uniforms.uLit.value.fromArray(lit);
    if (shade) this.uniforms.uShade.value.fromArray(shade);
    return n;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
