// Observation lounge — steam over the coffee cups, a SKY OVERLAY.
//
// Seen against the window, steam is exactly the kind of wispy transparent
// mark the cloud composite would erase, so it draws after it (registered by
// AirportLounge.jsx). A short stack of camera-facing cards built in VIEW space
// (square and correctly sized under the TRUE_SCALE camera), each a slice of
// one advected noise field, so the wisps rise, curl and thin out as one
// plume. Lit like steam: a soft ambient, and a strong forward-scattered key
// when the sun is behind it.
//
// One draw for every steaming cup the room built (room.steamSources: the
// hero cup, plus the pier's coffee station and reading nook): seven cards per
// cup, 14 triangles. In the pier each cup's plume runs on its own phase, so
// two cups side by side never steam in step; the classic room keeps its
// single plume and its certified shader text.
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

const CARDS = 7;

/** The cards for each source's `at`; `seeds` adds a per-cup phase attribute (pier). */
function steamGeometry(points, seeds = false) {
  const pos = [], corner = [], card = [], seed = [];
  points.forEach((at, s) => {
    for (let i = 0; i < CARDS; i++) {
      for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) {
        pos.push(at[0], at[1], at[2]);
        corner.push(cx, cy);
        card.push(i);
        seed.push(s * 0.618034 % 1); // golden-ratio phases: well spread for any count
      }
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new Float32BufferAttribute(corner, 2));
  g.setAttribute('aCard', new Float32BufferAttribute(card, 1));
  if (seeds) g.setAttribute('aSeed', new Float32BufferAttribute(seed, 1));
  g.computeBoundingSphere();
  g.boundingSphere.radius += 0.4;
  return g;
}

const VERT = /* glsl */ `
attribute vec2 aCorner;
attribute float aCard;
uniform float uTime;
uniform float uRadius;
varying vec2 vUv;
varying float vCard;
varying vec3 vView;
void main() {
  // Cards stack up the plume: each higher, wider, drifting with the air.
  float k = aCard / ${CARDS - 1}.0;
  float rise = 0.012 + k * 0.17;
  float sway = sin( uTime * 0.7 + k * 3.1 ) * 0.012 * k;
  vec4 mv = modelViewMatrix * vec4( position + vec3( sway, rise, sway * 0.6 ), 1.0 );
  // view units are k0 x metres under TRUE_SCALE (modelView Y column = k0)
  float size = uRadius * ( 0.9 + k * 1.9 ) * length( modelViewMatrix[ 1 ].xyz );
  mv.xy += aCorner * vec2( size, size * 1.25 );
  vUv = aCorner * 0.5 + 0.5;
  vCard = aCard;
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec4 uState;      // x exposure, y strength, z key on, w lens (0 hides)
uniform vec3 uSunView;    // key direction in view space
uniform vec3 uKeyColor;   // key radiance
uniform vec3 uAmbient;    // the room's light on the steam
varying vec2 vUv;
varying float vCard;
varying vec3 vView;
float h12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float vn( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( h12( i ), h12( i + vec2( 1, 0 ) ), u.x ), mix( h12( i + vec2( 0, 1 ) ), h12( i + vec2( 1, 1 ) ), u.x ), u.y );
}
float fbm( vec2 p ) { float s = 0.0, a = 0.5; for ( int i = 0; i < 4; i ++ ) { s += a * vn( p ); p = p * 2.07 + 3.3; a *= 0.5; } return s; }
void main() {
  float k = vCard / ${CARDS - 1}.0;
  vec2 p = vUv - 0.5;
  // advected, curled field: the plume rises and twists
  float t = uTime * 0.55;
  vec2 q = vec2( p.x * 3.2, p.y * 2.4 + k * 2.6 - t );
  q.x += sin( q.y * 2.3 + t * 0.8 ) * 0.35 * k;
  float n = fbm( q * 2.2 + vec2( k * 5.3, 0.0 ) );
  float n2 = fbm( q * 5.0 - vec2( 0.0, t * 0.7 ) );
  float wisp = smoothstep( 0.42, 0.78, n * 0.75 + n2 * 0.35 );
  // narrow at the cup, spreading and thinning as it rises
  float width = mix( 0.22, 0.48, k );
  float body = exp( -pow( p.x / width, 2.0 ) * 2.4 ) * smoothstep( 0.5, 0.1, abs( p.y ) );
  float density = wisp * body * ( 1.0 - k * 0.75 ) * uState.y * uState.w;
  if ( density < 0.002 ) discard;
  vec3 V = normalize( -vView );
  float mu = dot( -V, uSunView );
  float forward = pow( max( mu, 0.0 ), 5.0 ) * 1.4 + 0.12;
  vec3 light = uAmbient + uKeyColor * forward * 0.12 * uState.z;
  float a = density * 0.42;
  gl_FragColor = vec4( light * a * uState.x, a * 0.3 );
}`;

// The pier's plumes: a per-cup phase (aSeed) in the sway and the advected
// field, and the width falloff squared instead of pow() of a negative base
// (undefined in GLSL).
const VERT_PIER = VERT.replace('attribute float aCard;', 'attribute float aCard;\nattribute float aSeed;\nvarying float vSeed;')
  .replace('float sway = sin( uTime * 0.7 + k * 3.1 ) * 0.012 * k;', 'float sway = sin( uTime * 0.7 + k * 3.1 + aSeed * 6.2831853 ) * 0.012 * k;\n  vSeed = aSeed;');
const FRAG_PIER = FRAG.replace('varying vec3 vView;', 'varying vec3 vView;\nvarying float vSeed;')
  .replace('float t = uTime * 0.55;', 'float t = uTime * 0.55 + vSeed * 17.0;')
  .replace('float body = exp( -pow( p.x / width, 2.0 ) * 2.4 )', 'float px = p.x / width;\n  float body = exp( -px * px * 2.4 )');
for (const [src, base, marks] of [[VERT_PIER, VERT, ['attribute float aSeed;', 'aSeed * 6.2831853', 'vSeed = aSeed;']], [FRAG_PIER, FRAG, ['varying float vSeed;', 'vSeed * 17.0', 'exp( -px * px * 2.4 )']]]) {
  if (src === base || marks.some((m) => !src.includes(m))) throw new Error('lounge steam: pier shader anchors missing');
}

/**
 * Steam rising from each cup in `sources` (room-local { at, r }, as
 * room.steamSources lists them; a single source object is accepted too).
 * The plume radius is the first cup's (every cup in the room is STEAM_R).
 * `variant` 'pier' gives each cup its own phase.
 */
export function createLoungeSteam(sources, { variant = 'classic' } = {}) {
  const list = Array.isArray(sources) ? sources : sources ? [sources] : [];
  const pier = variant === 'pier';
  const material = new ShaderMaterial({
    name: 'lounge-steam',
    vertexShader: pier ? VERT_PIER : VERT,
    fragmentShader: pier ? FRAG_PIER : FRAG,
    uniforms: {
      uTime: { value: 0 },
      uRadius: { value: list[0]?.r ?? 0.035 },
      uState: { value: new Vector4(1, 1, 0, 1) },
      uSunView: { value: new Vector3(0, 1, 0) },
      uKeyColor: { value: new Vector3() },
      uAmbient: { value: new Vector3() },
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
  const mesh = new Mesh(steamGeometry(list.length ? list.map((s) => s.at) : [[0, 0.6, -0.7]], pier), material);
  mesh.name = 'lounge:steam';
  mesh.frustumCulled = false;
  mesh.renderOrder = 21;
  return {
    mesh,
    /** state: { time, exposure, strength, keyOn, lens, sunView: Vector3, keyColor: [r,g,b], ambient: Vector3 } */
    update(state) {
      const u = material.uniforms;
      u.uTime.value = state.time;
      u.uState.value.set(state.exposure, state.strength, state.keyOn, state.lens);
      u.uSunView.value.copy(state.sunView);
      u.uKeyColor.value.set(state.keyColor[0], state.keyColor[1], state.keyColor[2]);
      u.uAmbient.value.copy(state.ambient);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
