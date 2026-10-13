// Persistent contrails seen from the ground (the observation lounge).
//
// Flight-mode plumes (aircraft-wake.js) are short CPU ribbons that follow the
// camera through the trail. From a terminal the job is different: dozens of
// trails at 9-12 km, minutes long, spreading from tens of metres to hundreds,
// drifting with the wind and catching the low sun. So these ribbons expand
// on the GPU:
//   - each trail is a ring of points (position, tangent, birth, density,
//     along-track distance, wind, persistence) written ONCE when the point
//     is appended;
//   - the vertex shader ages every point from its birth time: wind drift,
//     subsidence, the vortex-phase growth and the slow spreading after it, a
//     pixel-width floor that conserves energy (thin far trails never alias
//     out, they fade instead), the air bend;
//   - a small "head" (three point pairs per trail: the newest ring point, the
//     condensation point a few tens of metres behind the engines, the engines
//     themselves) is rewritten every frame so each trail stays attached to
//     its aircraft;
//   - the index buffer of a trail is rewritten on append (ring order).
// One draw for every trail, drawn as a sky overlay (after the cloud
// composite, depth-tested; the overlay cloud gate occludes it behind cloud
// with a floor).
//
// Shape: the engine plumes are two (or four) distinct lines for the first
// seconds, roll into the wingtip vortex pair, then merge into one plume that
// widens and thins (the same ice spread over more sky), and an old trail
// breaks into wisps. Persistence follows the flight-level band (humid layers
// keep trails for minutes, drier ones lose them sooner).
//
// Light: the sun seen FROM THE TRAIL. At 10 km the horizon dips ~3 degrees,
// so trails stay sunlit after ground sunset, reddened by the long path
// (white at noon, gold low, pink/orange after sunset), then fall into the
// Earth's shadow and keep only sky light; at night the moon key lights them
// faintly grey. Overlays get no exposure: the radiance carries it.
import { DynamicDrawUsage, InterleavedBuffer, InterleavedBufferAttribute, BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector3, Vector4, CustomBlending, OneFactor, OneMinusSrcAlphaFactor } from 'three';
import { shareBendUniforms } from './toy-world/world-bend';
import { OVERLAY_GATE_GLSL, bindOverlayGate } from './overlay-gate';
import { SKY_VIEW } from './observation-config';

// Interleaved vertex: aP (3) | aT (3) | aInfo (4: side, birth, density, distance)
// | aDrift (4: wind x, wind z, life s + seed fraction, engine half-span m)
const STRIDE = 14;
const HEAD_PAIRS = 3;
// A source that lands farther than this (scene units) from its predicted
// position is a discontinuity, not motion.
const JUMP = 250;
// ... and when it comes within this many seconds of the last feed, it is the
// feed's clock or position base moving (a re-poll, a stall frame), never the
// aircraft: dead reckoning drifts ~60 m in 3 s even in a hard turn. The trail
// moves with it. A longer silence is a real pause, bridged by a straight run.
const JUMP_SHIFT_SEC = 3;
// Corrections bend this much recent trail, once they add up to WARP_MIN.
const WARP_SEC = 6;
const WARP_MIN = 0.75;
// A turn seen at admission is assumed to have begun at most this long ago.
const TURN_BACK_SEC = 25;

const VERT = /* glsl */ `
#include <common>
attribute vec3 aP;
attribute vec3 aT;
attribute vec4 aInfo;
attribute vec4 aDrift;
uniform float uTime;
uniform vec4 uTrail;   // fresh width beyond the engine span (m), spread m/s, vortex-phase growth (m), min px
uniform vec4 uShape;   // sink m/s, px per unit at distance 1, condensation fade-in s, vortex-phase time constant s
uniform vec2 uBendCenter; uniform float uBendK; uniform float uEyeY; uniform float uRefGroundY;
uniform vec2 uAirAgl; uniform float uAirCapFrac; uniform vec2 uAirLiftRange; uniform float uAirCapFar;
varying vec3 vWake;    // across (-1..1), along distance, density
varying float vAge;
varying vec4 vLobe;    // lobe centre (u), lobe radius (u), merged 0..1, resolved 0..1
varying vec3 vOvW;
varying vec3 vView;
void main() {
  float side = sign( aInfo.x );
  float age = max( 0.0, uTime - aInfo.y );
  float life = floor( aDrift.z );
  float engine = aDrift.w;
  vec3 c = aP + vec3( aDrift.x, -uShape.x, aDrift.y ) * age;
  vec4 w = modelMatrix * vec4( c, 1.0 );
  // Air bend (the airProject formula): trails sit with their aircraft.
  float bendD = distance( w.xz, uBendCenter );
  float dropRaw = bendD * bendD * uBendK;
  float airborne = smoothstep( uAirAgl.x, uAirAgl.y, w.y - uRefGroundY );
  float capF = mix( uAirCapFrac, uAirCapFar, smoothstep( uAirLiftRange.x, uAirLiftRange.y, bendD ) );
  float capped = min( dropRaw, max( 0.0, w.y - uEyeY ) * capF );
  w.y -= mix( dropRaw, capped, airborne );
  // Width in TRUE space (TRUE_SCALE: y scaled by k0; k0 = 1 when the flag is off).
  float k0 = length( viewMatrix[ 1 ].xyz );
  vec3 view = w.xyz - cameraPosition;
  vec3 viewT = vec3( view.x, view.y * k0, view.z );
  vec3 tng = normalize( vec3( aT.x, aT.y * k0, aT.z ) + 1e-6 );
  vec3 sideT = cross( viewT, tng );
  float sl = length( sideT );
  sideT = sl > 1e-6 ? sideT / sl : vec3( 1.0, 0.0, 0.0 );
  float dist = length( viewT );
  // Engine span + plume, the vortex phase (first minute or so), then the
  // slow turbulent spreading of a persistent trail.
  float width = 2.0 * engine + uTrail.x + uTrail.z * ( 1.0 - exp( -age / uShape.w ) ) + uTrail.y * age + 0.015 * age * sqrt( age );
  // Never thinner than uTrail.w pixels: widen, and thin the density to keep
  // the same energy (a far trail fades, it does not alias away).
  float floorW = uTrail.w * dist / max( uShape.y, 1.0 );
  float shown = max( width * k0, floorW );
  float energy = clamp( width * k0 / shown, 0.0, 1.0 );
  vec3 off = sideT * side * shown * 0.5;
  w.xyz += vec3( off.x, off.y / k0, off.z );
  vOvW = w.xyz;
  vView = w.xyz - cameraPosition;
  float fadeIn = smoothstep( 0.0, uShape.z, age );
  float fadeOut = 1.0 - smoothstep( life * 0.55, life, age );
  // The same ice spread over more sky: optical depth falls as it widens.
  float thin = clamp( pow( ( 2.0 * engine + uTrail.x + 25.0 ) / width, 0.6 ), 0.2, 1.0 );
  // A trail first seen in flight starts softly (no hard cut at its far end).
  float taper = smoothstep( 0.0, 4000.0, aInfo.w );
  vWake = vec3( side, aInfo.w, aInfo.z * fadeIn * fadeOut * thin * taper * ( 0.35 + 0.65 * energy ) );
  vAge = age;
  // Engine plumes: distinct lines that roll outward into the vortex pair,
  // then merge. Resolved only when the ribbon spans enough pixels.
  float halfW = max( width * 0.5, 1.0 );
  float lobeM = mix( engine, engine * 1.25 + 4.0, smoothstep( 1.5, 14.0, age ) );
  float radius = 2.5 + 0.55 * age;
  float shownPx = shown * uShape.y / max( dist, 1.0 );
  vLobe = vec4( lobeM / halfW, radius / halfW, smoothstep( 16.0, 55.0, age ), smoothstep( 7.0, 16.0, shownPx ) * step( 0.5, engine ) );
  gl_Position = projectionMatrix * viewMatrix * w;
  if ( vWake.z <= 0.0005 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
}
`;

const FRAG = /* glsl */ `
#include <common>
uniform vec3 uSunDir;      // TRUE direction toward the sun
uniform vec4 uSun;         // sin(sun elevation at the ground), sun radiance, moon/key radiance, exposure
uniform vec3 uSunColor;    // the sun's colour above the atmosphere (white-ish)
uniform vec3 uKeyDir;      // the frame key (moon at night)
uniform vec3 uKeyColor;
uniform vec3 uSkyFill;     // sky light (exposed scene units)
uniform float uOvFloor;
varying vec3 vWake; varying float vAge; varying vec4 vLobe; varying vec3 vOvW; varying vec3 vView;
${OVERLAY_GATE_GLSL}
float th( vec2 p ) { vec3 q = fract( vec3( p.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
float tn( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( th( i ), th( i + vec2( 1, 0 ) ), f.x ), mix( th( i + vec2( 0, 1 ) ), th( i + vec2( 1, 1 ) ), f.x ), f.y ); }
void main() {
  float u = vWake.x;
  // Cross profile: separate engine lines early, one soft plume later.
  float one = exp( -3.2 * u * u );
  float du = abs( u ) - vLobe.x;
  float twin = exp( -0.5 * du * du / max( vLobe.y * vLobe.y, 1e-4 ) );
  float profile = mix( one, mix( twin, one, vLobe.z ), vLobe.w ) * ( 1.0 - smoothstep( 0.8, 1.0, abs( u ) ) );
  // Billows along the trail; an old trail breaks into wisps (phase on the
  // recorded distance, so camera motion and rebases cannot swim it). The
  // wisps fade to their mean where they would alias (far trails).
  float old = smoothstep( 20.0, 140.0, vAge );
  vec2 p = vec2( vWake.y * 0.0042, u * 1.7 );
  float wisps = tn( p + vec2( tn( p * 0.37 ) * 1.6, 0.0 ) ) * 0.65 + tn( p * 2.9 ) * 0.35;
  float resolved = 1.0 - smoothstep( 0.1, 0.35, fwidth( p.x ) * 2.9 );
  float billow = mix( 0.9 + 0.1 * wisps, smoothstep( 0.18, 0.85, wisps ), old * 0.85 );
  billow = mix( mix( 0.95, 0.6, old * 0.85 ), billow, resolved );
  float a = vWake.z * profile * billow;
  a = 1.0 - exp( -a * 1.6 );
  // Sun as seen from the trail's own altitude.
  float h = max( 0.0, vOvW.y );
  float dip = sqrt( 2.0 * h / 6371000.0 );
  float el = asin( clamp( uSun.x, -1.0, 1.0 ) ) + dip;
  float lit = smoothstep( -0.012, 0.01, el );
  float m = exp( -h / 8500.0 ) / ( sin( max( el, 0.0 ) ) + 0.028 );
  vec3 transmit = exp( -vec3( 0.032, 0.072, 0.16 ) * m );
  vec3 ray = normalize( vec3( vView.x, vView.y * length( viewMatrix[ 1 ].xyz ), vView.z ) );
  float cosS = dot( ray, uSunDir );
  // Ice crystals scatter strongly forward: trails near the sun glow silver.
  float phase = 0.42 + 0.9 * pow( max( 0.0, cosS ), 8.0 ) + 0.12 * pow( max( 0.0, -cosS ), 2.0 );
  vec3 sun = uSunColor * transmit * uSun.y * lit * phase;
  // After the sun leaves the trail, the key (moon) and sky light remain.
  float cosK = dot( ray, uKeyDir );
  vec3 moon = uKeyColor * uSun.z * ( 0.5 + 0.3 * pow( max( 0.0, cosK ), 4.0 ) ) * ( 1.0 - lit );
  vec3 radiance = ( sun + moon ) * uSun.w + uSkyFill;
  a *= max( ovCloudGate( vOvW ), uOvFloor );
  gl_FragColor = vec4( radiance * a, a );
}
`;

const hash = (n) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};

/**
 * Trail persistence (seconds) for a flight level: each ~2,000 ft band gets
 * its own humidity for the hour, so trails in one layer hang for minutes
 * while a jet a few thousand feet above leaves a shorter one. Deterministic
 * per band and hour (no flicker as aircraft are re-admitted).
 */
export function trailPersistence(altM, hourKey = 0) {
  const [lo, hi] = SKY_VIEW.lifeSec;
  const band = Math.floor(Math.max(0, altM) / 610);
  const u = hash(band * 7919 + hourKey * 104729);
  return Math.round(lo + (hi - lo) * Math.pow(u, 0.7));
}

export class SkyTrails {
  constructor({ maxTrails = SKY_VIEW.maxTrails.high, points = SKY_VIEW.points } = {}) {
    this.R = maxTrails;
    this.P = points;
    const ringVerts = this.R * this.P * 2, headVerts = this.R * HEAD_PAIRS * 2;
    this.headBase = ringVerts;
    const verts = ringVerts + headVerts;
    this.data = new Float32Array(verts * STRIDE);
    this.buffer = new InterleavedBuffer(this.data, STRIDE).setUsage(DynamicDrawUsage);
    const g = new BufferGeometry();
    g.setAttribute('aP', new InterleavedBufferAttribute(this.buffer, 3, 0));
    g.setAttribute('aT', new InterleavedBufferAttribute(this.buffer, 3, 3));
    g.setAttribute('aInfo', new InterleavedBufferAttribute(this.buffer, 4, 6));
    g.setAttribute('aDrift', new InterleavedBufferAttribute(this.buffer, 4, 10));
    // Per trail: (P - 1) ring segments + 2 head segments, 6 indices each.
    this.segs = this.P - 1 + (HEAD_PAIRS - 1);
    this.index = new BufferAttribute(new Uint32Array(this.R * this.segs * 6), 1).setUsage(DynamicDrawUsage);
    g.setIndex(this.index);
    g.setDrawRange(0, this.R * this.segs * 6);
    this.uniforms = shareBendUniforms({
      uTime: { value: 0 },
      uTrail: { value: new Vector4(SKY_VIEW.freshM, SKY_VIEW.spreadMps, SKY_VIEW.vortexM, SKY_VIEW.minPx) },
      uShape: { value: new Vector4(SKY_VIEW.sinkMps, 1000, SKY_VIEW.formSec, SKY_VIEW.vortexSec) },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uSun: { value: new Vector4(1, 3, 0.3, 1) },
      uSunColor: { value: new Vector3(1, 0.98, 0.95) },
      uKeyDir: { value: new Vector3(0, 1, 0) },
      uKeyColor: { value: new Vector3(0.6, 0.7, 1) },
      uSkyFill: { value: new Vector3(0.1, 0.12, 0.16) },
      uOvFloor: { value: SKY_VIEW.cloudFloor },
    });
    bindOverlayGate(this.uniforms);
    const material = new ShaderMaterial({
      name: 'sky-trails',
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // Premultiplied "over": radiance * a + dst * (1 - a).
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      toneMapped: false,
    });
    this.mesh = new Mesh(g, material);
    this.mesh.name = 'sky-trails';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 8;
    // Trail slots: { hex, head, count, last, distance, alive, detached,
    // lastBirth, seed, engine, life, f (smoothed source) }
    this.slots = Array.from({ length: this.R }, () => null);
    this.byHex = new Map();
    this.origin = { x: 0, z: 0, set: false };
    this.epoch = 0;
    this.dirtyIndex = new Set();
    this.dirtyRing = [];
    this.dirtySlots = new Set();
    this.stats = { trails: 0, cap: this.R, shifts: 0 };
  }

  /** Seconds on the trail clock (kept small for float32 in the shader). */
  clock(now) {
    if (!this.epoch) this.epoch = now;
    return now - this.epoch;
  }

  _vertex(v, x, y, z, tx, ty, tz, side, birth, density, dist, wind, slot) {
    const o = v * STRIDE, d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = tx; d[o + 4] = ty; d[o + 5] = tz;
    d[o + 6] = side; d[o + 7] = birth; d[o + 8] = density; d[o + 9] = dist;
    d[o + 10] = wind.x; d[o + 11] = wind.z; d[o + 12] = slot.life + slot.seed; d[o + 13] = slot.engine;
  }

  _slotFor(hex) {
    let s = this.byHex.get(hex);
    if (s != null) return s;
    s = this.slots.findIndex((x) => x === null);
    if (s < 0) {
      // Steal the detached trail that died first.
      let best = -1, bestT = Infinity;
      for (let i = 0; i < this.R; i++) { const x = this.slots[i]; if (x.detached && x.lastBirth < bestT) { best = i; bestT = x.lastBirth; } }
      if (best < 0) return -1;
      this.byHex.delete(this.slots[best].hex);
      s = best;
    }
    this.slots[s] = { hex, head: 0, count: 0, last: null, distance: 0, detached: false, alive: false, lastBirth: 0, seed: Math.random() * 0.99, engine: 6, life: SKY_VIEW.lifeSec[1], f: null };
    this.byHex.set(hex, s);
    this.dirtyIndex.add(s);
    return s;
  }

  /** Write ring point k of slot s. */
  _ring(s, k, p, t, birth, density, wind, slot) {
    const base = (s * this.P + k) * 2;
    for (const side of [-1, 1]) this._vertex(base + (side > 0 ? 1 : 0), p.x - this.origin.x, p.y, p.z - this.origin.z, t.x, t.y, t.z, side, birth, density, slot.distance, wind, slot);
    this.dirtyRing.push(base);
  }

  /**
   * Feed one aircraft this frame. p: absolute scene position of the trail
   * source; v: scene velocity (units/s); density 0..1; wind scene units/s;
   * spacing seconds; engine: engine half-span (m) for the early twin plume;
   * life: persistence (s, fixed when the trail is first admitted).
   */
  feed(hex, p, v, density, now, wind, { spacing = SKY_VIEW.pointSec, engine = 6, life = SKY_VIEW.lifeSec[1], backfillSec = 0, turn = 0 } = {}) {
    if (!this.origin.set) { this.origin.x = p.x; this.origin.z = p.z; this.origin.set = true; }
    const s = this._slotFor(hex);
    if (s < 0) return false;
    const slot = this.slots[s];
    if (slot.detached) this.dirtyIndex.add(s); // the head segments come back
    slot.detached = false;
    slot.alive = true;
    slot.engine = engine;
    const t = this.clock(now);
    // The source is dead-reckoned between ADS-B fixes and corrected when a
    // fix lands (the traffic engine blends the correction in). The trail
    // follows: whatever the source does beyond its own velocity bends the
    // last WARP_SEC of trail toward the corrected path (fading to nothing at
    // the far end), so a correction never leaves a kink behind the aircraft.
    let f = slot.f;
    if (!f) f = slot.f = { x: p.x, y: p.y, z: p.z, t };
    else {
      const dt = Math.max(0, t - f.t);
      f.x += v.x * dt; f.y += v.y * dt; f.z += v.z * dt; f.t = t;
      const jx = p.x - f.x, jy = p.y - f.y, jz = p.z - f.z, j2 = jx * jx + jy * jy + jz * jz;
      if (j2 > JUMP * JUMP) {
        // A jump soon after the last feed (a frame, or a stall frame of a
        // second or two) is the feed's clock or position base moving: carry
        // the whole trail with it rather than draw a step across the sky.
        // After a real pause in the feed, the straight connection to where
        // the aircraft is now stands in for the gap.
        if (dt < JUMP_SHIFT_SEC && slot.last) this._shift(s, slot, jx, jy, jz);
        f.x = p.x; f.y = p.y; f.z = p.z;
      } else if (j2 > WARP_MIN * WARP_MIN && slot.last) {
        this._warp(s, slot, jx, jy, jz, t);
        f.x = p.x; f.y = p.y; f.z = p.z;
      }
    }
    if (!slot.last) {
      slot.life = life;
      // A newly admitted cruising jet has been flying already: lay a
      // velocity-estimated trail behind it (visual only, never shown as data),
      // continuing a turn in progress for up to TURN_BACK_SEC, then straight.
      const back = Math.min(backfillSec, life * 0.7, (this.P - 2) * spacing);
      const sp = Math.hypot(v.x, v.z), h0 = Math.atan2(v.x, -v.z);
      const pts = [];
      let qx = f.x, qy = f.y, qz = f.z;
      for (let a = spacing; a <= back + 1e-6; a += spacing) {
        const h = h0 - turn * Math.min(a - spacing / 2, TURN_BACK_SEC);
        qx -= Math.sin(h) * sp * spacing; qz += Math.cos(h) * sp * spacing; qy -= v.y * spacing;
        pts.push({ x: qx, y: qy, z: qz, a });
      }
      for (let i = pts.length - 1; i >= 0; i--) this._append(s, pts[i], v, t - pts[i].a, density, wind);
      this._append(s, f, v, t, density, wind);
    } else if (t - slot.last.t >= spacing) {
      this._append(s, f, v, t, density, wind);
    }
    // Head: the newest ring point, the condensation point (the trail forms a
    // few tens of metres behind the engines) and the engines themselves.
    const hb = this.headBase + s * HEAD_PAIRS * 2, L = slot.last;
    const len = Math.hypot(v.x, v.y, v.z) || 1;
    const gap = Math.min(SKY_VIEW.formSec, Math.max(0, t - L.t));
    for (const side of [-1, 1]) {
      const r = side > 0 ? 1 : 0;
      this._vertex(hb + r, L.x - this.origin.x, L.y, L.z - this.origin.z, L.tx, L.ty, L.tz, side, L.t, L.density, L.distance, wind, slot);
      this._vertex(hb + 2 + r, p.x - v.x * gap - this.origin.x, p.y - v.y * gap, p.z - v.z * gap - this.origin.z, v.x, v.y, v.z, side, t - gap, density, L.distance + len * Math.max(0, t - L.t - gap), wind, slot);
      this._vertex(hb + 4 + r, p.x - this.origin.x, p.y, p.z - this.origin.z, v.x, v.y, v.z, side, t, density, L.distance + len * (t - L.t), wind, slot);
    }
    return true;
  }

  /** Bend the recent trail of slot s by (dx, dy, dz): full at now, nothing WARP_SEC back. */
  _warp(s, slot, dx, dy, dz, t) {
    const d = this.data, P = this.P;
    for (let j = 0; j < slot.count; j++) {
      const k = (slot.head - 1 - j + P) % P, v0 = (s * P + k) * 2;
      const birth = d[v0 * STRIDE + 7], w = 1 - (t - birth) / WARP_SEC;
      if (w <= 0) break;
      for (let v = v0; v < v0 + 2; v++) {
        const o = v * STRIDE;
        d[o] += dx * w; d[o + 1] += dy * w; d[o + 2] += dz * w;
      }
      this.dirtyRing.push(v0);
    }
    const L = slot.last, w = Math.max(0, 1 - (t - L.t) / WARP_SEC);
    L.x += dx * w; L.y += dy * w; L.z += dz * w;
  }

  /** Translate every recorded point of slot s (a discontinuity in the feed). */
  _shift(s, slot, dx, dy, dz) {
    const d = this.data, first = s * this.P * 2;
    for (let i = first; i < first + this.P * 2; i++) {
      const o = i * STRIDE;
      d[o] += dx; d[o + 1] += dy; d[o + 2] += dz;
    }
    slot.last.x += dx; slot.last.y += dy; slot.last.z += dz;
    this.dirtySlots.add(s);
  }

  _append(s, p, v, t, density, wind) {
    const slot = this.slots[s];
    const k = slot.head;
    if (slot.last) slot.distance += Math.hypot(p.x - slot.last.x, p.y - slot.last.y, p.z - slot.last.z);
    const tan = slot.last ? new Vector3(p.x - slot.last.x, p.y - slot.last.y, p.z - slot.last.z) : new Vector3(v.x, v.y, v.z);
    if (tan.lengthSq() < 1e-6) tan.set(v.x, v.y, v.z);
    this._ring(s, k, p, tan, t, density, wind, slot);
    slot.last = { x: p.x, y: p.y, z: p.z, t, tx: tan.x, ty: tan.y, tz: tan.z, density, distance: slot.distance };
    slot.lastBirth = t;
    slot.head = (k + 1) % this.P;
    slot.count = Math.min(this.P, slot.count + 1);
    this.dirtyIndex.add(s);
  }

  /** Mark a trail as no longer fed; it lives on until its youngest point expires. */
  detach(hex) {
    const s = this.byHex.get(hex);
    if (s == null) return;
    this.slots[s].detached = true;
    this.dirtyIndex.add(s);
  }

  _writeIndex(s) {
    const slot = this.slots[s], P = this.P, idx = this.index.array;
    let o = s * this.segs * 6;
    const end = o + this.segs * 6;
    if (slot) {
      const tail = (slot.head - slot.count + P) % P;
      for (let j = 0; j < slot.count - 1; j++) {
        const a = (s * P + ((tail + j) % P)) * 2, b = (s * P + ((tail + j + 1) % P)) * 2;
        idx[o++] = a; idx[o++] = a + 1; idx[o++] = b;
        idx[o++] = a + 1; idx[o++] = b + 1; idx[o++] = b;
      }
      if (!slot.detached && slot.count > 0) {
        const h = this.headBase + s * HEAD_PAIRS * 2;
        for (let k = 0; k < HEAD_PAIRS - 1; k++) {
          const a = h + k * 2, b = a + 2;
          idx[o++] = a; idx[o++] = a + 1; idx[o++] = b;
          idx[o++] = a + 1; idx[o++] = b + 1; idx[o++] = b;
        }
      }
    }
    while (o < end) idx[o++] = 0;
    this.index.addUpdateRange(s * this.segs * 6, this.segs * 6);
  }

  /** Per frame, after all feed() calls. */
  end(now, { px = 1000, sunDir, sun, sunColor, keyDir, keyColor, skyFill, tier = 'high' } = {}) {
    const t = this.clock(now);
    let trails = 0;
    const cap = SKY_VIEW.maxTrails[tier] ?? this.R;
    for (let s = 0; s < this.R; s++) {
      const slot = this.slots[s];
      if (!slot) continue;
      if (!slot.alive && !slot.detached) { slot.detached = true; this.dirtyIndex.add(s); }
      if (slot.detached && t - slot.lastBirth > slot.life) {
        this.byHex.delete(slot.hex);
        this.slots[s] = null;
        this.dirtyIndex.add(s);
        continue;
      }
      slot.alive = false;
      trails++;
    }
    this.index.clearUpdateRanges();
    for (const s of this.dirtyIndex) this._writeIndex(s);
    if (this.dirtyIndex.size) this.index.needsUpdate = true;
    this.dirtyIndex.clear();
    this.buffer.clearUpdateRanges();
    for (const base of this.dirtyRing) this.buffer.addUpdateRange(base * STRIDE, 2 * STRIDE);
    for (const s of this.dirtySlots) { this.buffer.addUpdateRange(s * this.P * 2 * STRIDE, this.P * 2 * STRIDE); this.stats.shifts++; }
    this.dirtySlots.clear();
    this.buffer.addUpdateRange(this.headBase * STRIDE, this.R * HEAD_PAIRS * 2 * STRIDE);
    this.buffer.needsUpdate = true;
    this.dirtyRing.length = 0;
    const u = this.uniforms;
    u.uTime.value = t;
    u.uShape.value.y = px;
    if (sunDir) u.uSunDir.value.fromArray(sunDir);
    if (sun) u.uSun.value.set(sun[0], sun[1], sun[2], sun[3]);
    if (sunColor) u.uSunColor.value.fromArray(sunColor);
    if (keyDir) u.uKeyDir.value.fromArray(keyDir);
    if (keyColor) u.uKeyColor.value.fromArray(keyColor);
    if (skyFill) u.uSkyFill.value.fromArray(skyFill);
    this.mesh.visible = trails > 0;
    this.stats.trails = trails;
    this.stats.cap = cap;
    return trails;
  }

  /** Re-anchor positions near the observer (call every frame with the floating origin). */
  rebase(anchor) {
    this.mesh.position.set(this.origin.x - anchor.x, 0, this.origin.z - anchor.z);
  }

  clear() {
    this.slots.fill(null);
    this.byHex.clear();
    this.origin.set = false;
    this.index.array.fill(0);
    this.index.clearUpdateRanges();
    this.index.needsUpdate = true;
    this.mesh.visible = false;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
