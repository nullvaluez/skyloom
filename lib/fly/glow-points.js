// Glow points: bright point lights seen at a distance (runway and approach
// lights, aircraft landing lights, beacons and strobes). ONE instanced draw per
// set, drawn after the cloud composite (registerSkyOverlay) so a light against
// the sky survives the sky replacement, depth-tested against the real scene.
//
// Each light is a camera-facing quad built in VIEW space, so it stays square
// and correctly sized under the anisotropic TRUE_SCALE camera. Its on-screen
// footprint follows the physical size until it would fall under minPx; past
// that point the sprite holds minPx and its energy falls instead (energyPow),
// which reads as a point source receding rather than a dot that never dims.
//
// Positions are stored relative to the mesh (set mesh.position = origin -
// anchor each frame); the world bend is applied at the light (ground lights
// take the full drop, airborne lights the traffic air cap).
import {
  AdditiveBlending,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
} from 'three';
import { shareBendUniforms } from './toy-world/world-bend';
import { OVERLAY_GATE_GLSL, bindOverlayGate } from './overlay-gate';
import { registerSkyOverlay } from './sky-overlay-pass';

/** Flash patterns (aFlash.w). */
export const GLOW_MODE = Object.freeze({ STEADY: 0, STROBE: 1, DOUBLE: 2, BEACON: 3 });

const VERT = /* glsl */ `
#include <common>
attribute vec2 aCorner;
attribute vec3 aCenter;
attribute vec4 aColor;   // rgb radiance (buffer units), a = intensity
attribute vec4 aShape;   // x size metres, y min px, z max px, w airborne (0/1)
attribute vec4 aFlash;   // x hz, y phase, z duty, w mode
attribute vec4 aBeam;    // xyz scene direction, w cone sharpness (0 = omni)
uniform float uTime;
uniform float uPxScale;  // pixels per unit at view distance 1
uniform float uGain;
uniform float uEnergyPow;
uniform float uEnergyFloor;
uniform float uExtinction;
uniform float uPullM;
uniform vec2 uBendCenter; uniform float uBendK; uniform float uEyeY; uniform float uRefGroundY;
uniform vec2 uAirAgl; uniform float uAirCapFrac; uniform vec2 uAirLiftRange; uniform float uAirCapFar;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vOvW;
float glowFlash( vec4 f ) {
  if ( f.w < 0.5 ) return 1.0;
  float p = fract( uTime * f.x + f.y );
  if ( f.w < 1.5 ) return step( p, f.z );
  if ( f.w < 2.5 ) return max( step( p, f.z ), step( abs( p - f.z * 2.5 ), f.z * 0.5 ) );
  return 0.12 + 0.88 * pow( max( 0.0, cos( 6.2831853 * p ) ), 6.0 );
}
void main() {
  vec4 w = modelMatrix * vec4( aCenter, 1.0 );
  float bendD = distance( w.xz, uBendCenter );
  float dropRaw = bendD * bendD * uBendK;
  float drop = dropRaw;
  if ( aShape.w > 0.5 ) {
    float airborne = smoothstep( uAirAgl.x, uAirAgl.y, w.y - uRefGroundY );
    float capF = mix( uAirCapFrac, uAirCapFar, smoothstep( uAirLiftRange.x, uAirLiftRange.y, bendD ) );
    float capped = min( dropRaw, max( 0.0, w.y - uEyeY ) * capF );
    drop = mix( dropRaw, capped, airborne );
  }
  w.y -= drop;
  vOvW = w.xyz;
  vec4 mv = viewMatrix * w;
  float dist = max( 0.05, -mv.z );
  float natural = aShape.x / dist * uPxScale;
  float shown = clamp( natural, aShape.y, aShape.z );
  float energy = shown > 0.0 ? pow( clamp( natural / shown, 0.0, 1.0 ), uEnergyPow ) : 0.0;
  float beam = 1.0;
  if ( aBeam.w > 0.0 ) {
    vec3 d = normalize( ( viewMatrix * vec4( aBeam.xyz, 0.0 ) ).xyz );
    beam = mix( 0.035, 1.0, pow( max( dot( d, normalize( -mv.xyz ) ), 0.0 ), aBeam.w ) );
  }
  float air = exp( -dist * uExtinction );
  vColor = aColor.rgb * aColor.a * uGain * glowFlash( aFlash ) * max( energy, uEnergyFloor ) * beam * air;
  // Pull toward the eye (same screen point) so a light at ground level is not
  // half-buried in the depth of the surface it stands on.
  float pulled = max( 0.05, dist - min( uPullM + aShape.x, dist * 0.5 ) );
  mv.xyz *= pulled / dist;
  mv.xy += aCorner * ( 0.5 * shown ) * pulled / uPxScale;
  vUv = aCorner;
  gl_Position = projectionMatrix * mv;
  if ( dot( vColor, vec3( 1.0 ) ) < 1e-5 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vOvW;
uniform float uOvFloor;
uniform float uCore;
uniform float uHalo;
${OVERLAY_GATE_GLSL}
void main() {
  float r = length( vUv );
  if ( r >= 1.0 ) discard;
  float core = exp( -r * r * uCore );
  float halo = ( 1.0 - r ) * ( 1.0 - r ) * uHalo;
  float gate = max( ovCloudGate( vOvW ), uOvFloor );
  gl_FragColor = vec4( vColor * ( core + halo ) * gate, 1.0 );
}
`;

/**
 * A fixed-capacity set of glow points. Call set()/setCount() to author lights,
 * update(camera, size, time) once per frame, and dispose() when done.
 *
 * React (StrictMode-safe — effects run twice in dev):
 *   const glow = useMemo(() => new GlowPoints({...}), []);
 *   useEffect(() => glow.overlay(), [glow]);          // sky-overlay registration
 *   useEffect(() => () => glow.dispose(), [glow]);    // GPU resources only
 *   return <primitive object={glow.mesh} />;          // R3F owns the parenting
 */
export class GlowPoints {
  constructor({ capacity = 1024, name = 'glow-points', dynamic = false, energyPow = 1, energyFloor = 0.0, core = 9, halo = 0.55, cloudFloor = 0.2, pullM = 1.5 } = {}) {
    this.capacity = capacity;
    const g = new InstancedBufferGeometry();
    g.setAttribute('aCorner', new Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const attr = (n) => {
      const a = new InstancedBufferAttribute(new Float32Array(capacity * n), n);
      if (dynamic) a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.center = attr(3);
    this.color = attr(4);
    this.shape = attr(4);
    this.flash = attr(4);
    this.beam = attr(4);
    g.setAttribute('aCenter', this.center);
    g.setAttribute('aColor', this.color);
    g.setAttribute('aShape', this.shape);
    g.setAttribute('aFlash', this.flash);
    g.setAttribute('aBeam', this.beam);
    g.instanceCount = 0;
    this.uniforms = shareBendUniforms({
      uTime: { value: 0 },
      uPxScale: { value: 1000 },
      uGain: { value: 1 },
      uEnergyPow: { value: energyPow },
      uEnergyFloor: { value: energyFloor },
      uExtinction: { value: 0 },
      uPullM: { value: pullM },
      uCore: { value: core },
      uHalo: { value: halo },
      uOvFloor: { value: cloudFloor },
    });
    bindOverlayGate(this.uniforms);
    const material = new ShaderMaterial({
      name,
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    this.mesh = new Mesh(g, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.count = 0;
  }

  /** Draw after the cloud composite. Returns the unregister function. */
  overlay() {
    return registerSkyOverlay(this.mesh);
  }

  /**
   * Author light i. Position is relative to the mesh, in scene units.
   * opts: { size (m), minPx, maxPx, airborne, hz, phase, duty, mode, beam: [x,y,z], sharp }
   */
  set(i, x, y, z, r, g, b, intensity = 1, opts = {}) {
    if (i < 0 || i >= this.capacity) return;
    this.center.setXYZ(i, x, y, z);
    this.color.setXYZW(i, r, g, b, intensity);
    this.shape.setXYZW(i, opts.size ?? 0.6, opts.minPx ?? 2.2, opts.maxPx ?? 64, opts.airborne ? 1 : 0);
    this.flash.setXYZW(i, opts.hz ?? 0, opts.phase ?? 0, opts.duty ?? 0.08, opts.mode ?? GLOW_MODE.STEADY);
    const beam = opts.beam;
    this.beam.setXYZW(i, beam ? beam[0] : 0, beam ? beam[1] : 0, beam ? beam[2] : 0, beam ? opts.sharp ?? 8 : 0);
  }

  /** Move light i (dynamic sets): position only. */
  move(i, x, y, z) {
    this.center.setXYZ(i, x, y, z);
  }

  /** Re-aim light i's beam (dynamic sets). */
  aim(i, dx, dy, dz, sharp) {
    this.beam.setXYZW(i, dx, dy, dz, sharp);
  }

  /** Scale light i's intensity (e.g. 0 to switch it off without re-authoring). */
  dim(i, intensity) {
    this.color.setW(i, intensity);
  }

  setCount(n) {
    this.count = Math.max(0, Math.min(this.capacity, n));
    this.mesh.geometry.instanceCount = this.count;
    for (const a of [this.center, this.color, this.shape, this.flash, this.beam]) this._upload(a);
  }

  /** Mark attributes dirty after per-frame move()/aim()/dim() calls. */
  touch(moved = true, aimed = false, dimmed = false) {
    if (moved) this._upload(this.center);
    if (aimed) this._upload(this.beam);
    if (dimmed) this._upload(this.color);
  }

  /** Upload the drawn prefix only (instances past `count` are never drawn;
   *  a zero-length range would mean "to the end", so an empty set skips). */
  _upload(attribute) {
    if (this.count <= 0) return;
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, this.count * attribute.itemSize);
    attribute.needsUpdate = true;
  }

  /**
   * Per frame: pixel scale from the live projection (binoculars change the
   * lens), the flash clock, an overall gain and the air's extinction (1/m).
   */
  update(camera, heightPx, time, gain = 1, extinction = 0) {
    const u = this.uniforms;
    u.uPxScale.value = camera.projectionMatrix.elements[5] * heightPx * 0.5;
    u.uTime.value = time;
    u.uGain.value = gain;
    u.uExtinction.value = extinction;
    this.mesh.visible = this.count > 0 && gain > 0;
  }

  /** Free GPU resources (a later draw would re-upload; parenting is the owner's). */
  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
