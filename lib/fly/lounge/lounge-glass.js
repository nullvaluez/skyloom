// Observation lounge — the glazing, drawn as a SKY OVERLAY.
//
// The cloud composite replaces every pixel that has no depth with the sky
// (lib/fly/sky-overlay-pass.js), so anything transparent in front of the sky
// must draw after it. The glass is one unlit ShaderMaterial over four quads
// (front, roof, two sides), depth-tested against the room and the world,
// premultiplied-alpha blended:
//
//   out = reflection + scatter + rain   (premultiplied radiance)
//   a   = fresnel + rain coverage       (dims what is behind it)
//
// What the inside of a window actually shows:
//   - the ROOM reflected in it (strong at night, invisible against a bright
//     day): a box-projected interior probe captured from the seated eye
//     (lounge-probe.js), sampled along the reflected ray;
//   - dust and faint smudges catching the sun when you look toward it
//     (forward scattering, a soft halo with the grime's own texture);
//   - rain beading on the outside, running down the canted wall, sitting on
//     the roof glass.
// In daylight the glass must not tint or noticeably darken the view: fresnel
// at the seat's incidence is ~3 % (an AR-coated inner face) and only grazing
// angles reflect more.
//
// All radiance is multiplied by the R25 pre-curve exposure (overlays skip the
// aerial pass that exposes everything else).
import {
  BufferGeometry,
  CustomBlending,
  Float32BufferAttribute,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Vector3,
  Vector4,
} from 'three';
import { CANT, SILL_Y, HEAD_Y, HALF_X, HEAD_Z, ROOF_Z1, SIDE_Z1, BACK_Z, frontZ } from './room-plan.js';

const OUT = 0.003; // the glass sits just outside the fins' outer face

function glassGeometry() {
  const pos = [], nrm = [], kind = [];
  const quad = (a, b, c, d, n, k) => {
    // two triangles a-b-c, a-c-d
    for (const p of [a, b, c, a, c, d]) { pos.push(...p); nrm.push(...n); kind.push(k); }
  };
  const l = Math.hypot(1, CANT);
  const nf = [0, CANT / l, 1 / l]; // inward (toward the room), tilted up
  const zf = (y) => frontZ(y) - OUT;
  quad([-HALF_X, SILL_Y, zf(SILL_Y)], [HALF_X, SILL_Y, zf(SILL_Y)], [HALF_X, HEAD_Y, zf(HEAD_Y)], [-HALF_X, HEAD_Y, zf(HEAD_Y)], nf, 0);
  // Wound to face the seated eye (front faces only).
  quad([-HALF_X, HEAD_Y + OUT, HEAD_Z], [HALF_X, HEAD_Y + OUT, HEAD_Z], [HALF_X, HEAD_Y + OUT, ROOF_Z1], [-HALF_X, HEAD_Y + OUT, ROOF_Z1], [0, -1, 0], 1);
  for (const s of [-1, 1]) {
    const x = s * (HALF_X + OUT);
    const a = [x, SILL_Y, frontZ(SILL_Y)], b = [x, SILL_Y, SIDE_Z1], c = [x, HEAD_Y, SIDE_Z1], d = [x, HEAD_Y, HEAD_Z];
    if (s < 0) quad(a, d, c, b, [1, 0, 0], 2); else quad(a, b, c, d, [-1, 0, 0], 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  g.setAttribute('aKind', new Float32BufferAttribute(kind, 1));
  g.computeBoundingSphere();
  return g;
}

const VERT = /* glsl */ `
attribute float aKind;
varying vec3 vPos;
varying vec3 vNrm;
varying float vKind;
void main() {
  vPos = position;
  vNrm = normal;
  vKind = aKind;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const FRAG = /* glsl */ `
uniform vec3 uEye;          // room-local camera position
uniform vec3 uSun;          // room-local direction toward the sun (key)
uniform vec3 uSunColor;     // key radiance colour * intensity * visibility
uniform vec3 uSky;          // a sky radiance for the drops' highlights
uniform vec4 uState;        // x exposure, y rain, z night, w lens (1 = naked eye; 0 = binoculars up: the pane is out of focus and gone)
uniform float uTime;
uniform samplerCube uProbe;
uniform vec4 uProbeState;   // x on, y gain, z mip level (softness)
uniform vec3 uProbePos;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uRoomRad;
varying vec3 vPos;
varying vec3 vNrm;
varying float vKind;

float h12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
vec2 h22( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.xx + p3.yz ) * p3.zy ); }
float vn( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( h12( i ), h12( i + vec2( 1, 0 ) ), u.x ), mix( h12( i + vec2( 0, 1 ) ), h12( i + vec2( 1, 1 ) ), u.x ), u.y );
}
float fbm( vec2 p ) { float s = 0.0, a = 0.5; for ( int i = 0; i < 5; i ++ ) { s += a * vn( p ); p = p * 2.03 + 7.1; a *= 0.5; } return s; }

// Grime: broad faint film, heavier along the sill, a few hand smears at
// leaning height on the front glass, water spots on the roof.
float grime( vec2 q, float kind ) {
  float film = smoothstep( 0.35, 0.85, fbm( q * 1.3 ) ) * 0.5 + fbm( q * 9.0 ) * 0.18;
  if ( kind < 0.5 ) {
    film += exp( -max( q.y, 0.0 ) * 5.0 ) * 0.55; // dust settles at the sill
    vec2 c = vec2( floor( q.x / 2.24 ) * 2.24 + 1.12 + ( h12( vec2( floor( q.x / 2.24 ), 3.0 ) ) - 0.5 ) * 1.2, 0.95 );
    vec2 d = ( q - c ) / vec2( 0.16, 0.24 );
    float smear = exp( -dot( d, d ) * 1.6 ) * step( 0.45, h12( vec2( floor( q.x / 2.24 ), 7.0 ) ) );
    float swirl = 0.5 + 0.5 * sin( length( d ) * 18.0 + fbm( q * 30.0 ) * 6.0 );
    film += smear * ( 0.6 + 0.6 * swirl );
  } else if ( kind < 1.5 ) {
    vec2 w = q * 7.0;
    vec2 i = floor( w ), f = fract( w );
    float spots = 0.0;
    for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
      vec2 g = vec2( float( x ), float( y ) );
      vec2 o = h22( i + g );
      float r = 0.08 + 0.18 * o.x;
      float d = length( g + o - f );
      spots += smoothstep( r, r * 0.6, d ) * ( 0.4 + 0.6 * smoothstep( r * 0.5, r * 0.95, d ) ) * step( 0.55, o.y );
    }
    film += 0.25 + spots * 0.6;
  }
  return film;
}

// Rain beads (static) and drops running down, in metres on the pane.
vec4 rain( vec2 q, float kind, float amount, float px ) {
  if ( amount <= 0.001 ) return vec4( 0.0 );
  float cov = 0.0, hi = 0.0, dark = 0.0;
  // static beads
  for ( int layer = 0; layer < 2; layer ++ ) {
    float scale = layer == 0 ? 38.0 : 19.0; // cells per metre: drops of ~4-9 mm
    vec2 w = q * scale + float( layer ) * 13.7;
    vec2 i = floor( w ), f = fract( w );
    vec2 o = h22( i );
    float present = step( 1.0 - amount * ( layer == 0 ? 0.7 : 0.4 ), h12( i + 4.2 ) );
    float r = ( 0.13 + 0.2 * o.x ) * present;
    vec2 d = f - ( 0.25 + 0.5 * o );
    float l = length( d );
    float aa = px * scale * 1.5 + 1e-4; // pixel footprint in cell units (no derivatives inside the loop)
    float disc = 1.0 - smoothstep( r - aa, r + aa, l );
    cov = max( cov, disc );
    hi += disc * smoothstep( 0.1, -0.6, ( d.y / max( r, 1e-3 ) ) ) * smoothstep( 0.9, 0.2, l / max( r, 1e-3 ) );
    dark += disc * smoothstep( -0.2, 0.8, d.y / max( r, 1e-3 ) );
  }
  // running drops on the walls (not the roof): columns, each a drop sliding
  // down with a trail of beads above it
  if ( kind != 1.0 ) {
    float colW = 0.045;
    float cx = floor( q.x / colW );
    float seed = h12( vec2( cx, 1.7 ) );
    if ( seed < amount * 0.85 ) {
      float speed = 0.06 + 0.12 * h12( vec2( cx, 9.1 ) );
      float period = 3.5 + 4.0 * h12( vec2( cx, 2.3 ) );
      float headY = 4.6 - mod( uTime * speed + seed * 17.0, period ) * 1.3;
      float x0 = ( cx + 0.5 ) * colW + sin( q.y * 9.0 + seed * 6.0 ) * 0.004;
      vec2 d = vec2( ( q.x - x0 ) / 0.0045, ( q.y - headY ) / 0.0065 );
      float drop = 1.0 - smoothstep( 0.7, 1.05, length( d ) );
      float trail = ( 1.0 - smoothstep( 0.25, 0.6, abs( q.x - x0 ) / 0.0045 ) ) * step( headY, q.y ) * exp( -( q.y - headY ) * 3.0 );
      float beads = trail * step( 0.6, fract( q.y * 70.0 + seed * 3.0 ) );
      cov = max( cov, max( drop, beads * 0.8 ) );
      hi += drop * smoothstep( 0.2, -0.8, d.y ) + beads * 0.3;
      dark += drop * smoothstep( -0.2, 0.9, d.y );
    }
  }
  return vec4( cov, min( hi, 1.5 ), min( dark, 1.0 ), 0.0 ) * amount;
}

void main() {
  vec3 V = normalize( vPos - uEye );         // eye -> glass
  vec3 N = normalize( vNrm );                 // toward the room
  float cosI = clamp( dot( -V, N ), 0.0, 1.0 );
  // Observation glazing with an anti-reflective inner face: ~3% at normal
  // incidence, rising toward grazing angles (Schlick).
  float F = 0.03 + 0.97 * pow( 1.0 - cosI, 5.0 );
  F = min( F, 0.6 );
  // pane coordinates in metres
  vec2 q = vKind < 0.5 ? vec2( vPos.x, ( vPos.y - ${SILL_Y.toFixed(3)} ) * ${Math.hypot(1, CANT).toFixed(5)} )
         : vKind < 1.5 ? vec2( vPos.x, vPos.z )
         : vec2( vPos.z * sign( vPos.x ), vPos.y );
  float exposure = uState.x;

  // --- the room reflected (box-projected probe) ---
  vec3 R = reflect( V, N );
  vec3 reflection = uRoomRad;
  if ( uProbeState.x > 0.5 ) {
    vec3 inv = 1.0 / R;
    vec3 t1 = ( uBoxMax - vPos ) * inv, t2 = ( uBoxMin - vPos ) * inv;
    vec3 tf = max( t1, t2 );
    float t = min( min( tf.x, tf.y ), tf.z );
    vec3 hit = vPos + R * max( t, 0.0 );
    reflection = textureLod( uProbe, normalize( hit - uProbePos ), uProbeState.z ).rgb * uProbeState.y;
    // Small bright fixtures (lamps, downlights, the doors) stand inside the
    // box the projection assumes, so they land smeared and misplaced: their
    // peaks are compressed to soft glints while the room's broad glow passes.
    reflection /= 1.0 + dot( reflection, vec3( 0.2126, 0.7152, 0.0722 ) ) / 0.8;
  }
  vec3 color = reflection * F;

  // --- grime catching the sun (forward scattering toward the eye) ---
  float g = grime( q, vKind ) * uState.w;
  float mu = dot( V, uSun );
  float phase = pow( max( mu, 0.0 ), 6.0 ) * 0.45 + pow( max( mu, 0.0 ), 48.0 ) * 1.6 + 0.02;
  vec3 scatter = uSunColor * phase * g * 0.012;
  // the room's own light catches the film too (night)
  scatter += uRoomRad * g * 0.06 * uState.z;
  color += scatter;

  // --- rain ---
  float amount = uState.y * uState.w;
  vec4 r = rain( q, vKind, amount, length( fwidth( q ) ) );
  // Each bead catches the sky in its upper rim and darkens below (it lenses
  // the darker ground), and a thin wet film veils the pane while it rains.
  vec3 drops = uSky * 0.9 * r.y + uRoomRad * 0.3 * r.x;
  color += drops * 0.7 + uSky * amount * 0.025;
  float alpha = F + r.x * 0.28 + r.z * 0.2 + amount * 0.035 + min( g * 0.006, 0.01 );

  gl_FragColor = vec4( color * exposure, clamp( alpha, 0.0, 0.85 ) ) * uState.w;
}`;

/**
 * The lounge glazing. update() per frame with room-local eye/sun and the
 * probe (InteriorProbe) when it exists.
 */
export function createLoungeGlass() {
  const material = new ShaderMaterial({
    name: 'lounge-glass',
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uEye: { value: new Vector3(0, 1.18, 0) },
      uSun: { value: new Vector3(0, 1, 0) },
      uSunColor: { value: new Vector3() },
      uSky: { value: new Vector3(0.4, 0.5, 0.7) },
      uState: { value: new Vector4(1, 0, 0, 1) },
      uTime: { value: 0 },
      uProbe: { value: null },
      uProbeState: { value: new Vector4(0, 1, 1.6, 0) },
      uProbePos: { value: new Vector3(0, 1.18, 0) },
      uBoxMin: { value: new Vector3(-HALF_X, 0, HEAD_Z - 0.05) },
      uBoxMax: { value: new Vector3(HALF_X, HEAD_Y, BACK_Z) },
      uRoomRad: { value: new Vector3() },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
    toneMapped: false,
  });
  const mesh = new Mesh(glassGeometry(), material);
  mesh.name = 'lounge:glass';
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  return {
    mesh,
    /** state: { eye, sun, sunColor:[r,g,b], sky:[r,g,b], exposure, rain, night, lens, time, roomRad:Vector3, probe, probeLod } */
    update(state) {
      const u = material.uniforms;
      u.uEye.value.copy(state.eye);
      u.uSun.value.copy(state.sun);
      u.uSunColor.value.set(state.sunColor[0], state.sunColor[1], state.sunColor[2]);
      u.uSky.value.set(state.sky[0], state.sky[1], state.sky[2]);
      u.uState.value.set(state.exposure, state.rain, state.night, state.lens);
      u.uTime.value = state.time;
      u.uRoomRad.value.copy(state.roomRad);
      const probe = state.probe;
      if (probe?.texture) {
        u.uProbe.value = probe.texture;
        u.uProbeState.value.set(1, 1, state.probeLod ?? 1.6, 0);
      } else {
        u.uProbe.value = null;
        u.uProbeState.value.set(0, 1, 0, 0);
      }
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
