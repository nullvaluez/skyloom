// Observation lounge — the interior lighting model.
//
// The room is lit by the WORLD's lights (no THREE.Light is ever added: a
// light-count change recompiles every lit program in the session). Every room
// material is a MeshStandard/MeshPhysicalMaterial that the cinema shadow rig
// patches for its cascades like any other; this module chains one more
// onBeforeCompile (keeping three's lights_pars_begin / lights_fragment_begin
// anchors intact for the cascades) and, right after
// `#include <lights_fragment_end>` — where reflectedLight.direct* holds the key
// light only and the hemisphere + IBL sit in indirect* — re-lights the
// fragment as an interior:
//
//   KEY       the sun (or moon) reaches a fragment only through the glazing:
//             an analytic exit test against the room's planes, the fins and
//             roof beams (1-D sweeps with a sun-disc penumbra), the head
//             transom and fascia, then soft shadows from oriented furniture
//             boxes. Crisp, stable mullion shadows with no shadow map.
//   SKY       hemisphere + IBL are scaled by the cosine-weighted solid angle of
//             the glazing seen from the fragment (polygon form factors), so
//             the room darkens away from the glass and under the ceiling.
//   BOUNCE    an interior inter-reflection estimate (CPU, per frame).
//   REFLECT   the IBL reflection is kept only where the reflected ray leaves
//             through glass (soft with roughness); elsewhere the fragment
//             reflects the room's own average radiance. A honed floor shows
//             the windows, bars and all; it does not mirror the sky through
//             the ceiling.
//   PRACTICAL interior fixtures (pendants, downlights, slots, cove, bar
//             backlight, board spill, entrance) evaluated in-shader, on a
//             day/night dimming curve.
//   AO        baked per-vertex AO, the baked floor map, analytic shell
//             corners and baffle cavities.
//
// TRUE_SCALE: everything here is evaluated in ROOM-LOCAL metres (position from
// the vertex attribute, the shading normal mapped back from view space with a
// per-frame matrix). Light directions arrive already in room-local space, so
// no transpose(viewMatrix) and no scene-space directions appear anywhere.
import {
  Color,
  DoubleSide,
  Matrix3,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector3,
  Vector4,
} from 'three';
import { SURF, GLOW } from './room-build.js';
import {
  CANT, SILL_Y, HEAD_Y, HALF_X, HEAD_Z, ROOF_Z1, SIDE_Z1, BACK_Z, PITCH, MULLION_HALF, MULLION_DEPTH,
  SIDE_MULLION_Z, APERTURE, HEAD_DEPTH, FASCIA_DEPTH, FASCIA_DROP, DECK_Y, BAFFLE, ART_RECT, frontZ,
} from './room-plan.js';
import { FLOOR_RECT } from './room-ao.js';

export const MAX_LIGHTS = 32;
export const MAX_SHADOWS = 48;

const f = (v) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

// ---------------------------------------------------------------------------
// GLSL: constants + the analytic pieces
// ---------------------------------------------------------------------------
const C0 = LOUNGE_C0();
function LOUNGE_C0() {
  // The front glass plane: z + y * CANT = C0 (inside the room: greater).
  return frontZ(SILL_Y) + SILL_Y * CANT;
}
const Y0 = APERTURE.front.y0, Y1 = APERTURE.front.y1;

const GLSL_CONST = /* glsl */ `
#define LG_CANT ${f(CANT)}
#define LG_C0 ${f(C0)}
#define LG_SEC ${f(Math.sqrt(1 + CANT * CANT))}
#define LG_HEAD_Y ${f(HEAD_Y)}
#define LG_HALF_X ${f(HALF_X)}
#define LG_BACK_Z ${f(BACK_Z)}
#define LG_Y0 ${f(Y0)}
#define LG_Y1 ${f(Y1)}
#define LG_RZ0 ${f(APERTURE.roof.z0)}
#define LG_RZ1 ${f(APERTURE.roof.z1)}
#define LG_SZ1 ${f(APERTURE.side.z1)}
#define LG_PITCH ${f(PITCH)}
#define LG_FIN ${f(MULLION_HALF)}
#define LG_FIN_DEPTH ${f(MULLION_DEPTH)}
#define LG_SIDE_FIN_Z ${f(SIDE_MULLION_Z[0])}
#define LG_HEAD_Z ${f(HEAD_Z)}
#define LG_HEAD_DEPTH ${f(HEAD_DEPTH)}
#define LG_ROOF_Z1 ${f(ROOF_Z1)}
#define LG_FASCIA_DEPTH ${f(FASCIA_DEPTH)}
#define LG_FASCIA_DROP ${f(FASCIA_DROP)}
#define LG_DECK_Y ${f(DECK_Y)}
#define LG_BAFFLE_DEPTH ${f(BAFFLE.depth)}
#define LG_SIDE_Z1 ${f(SIDE_Z1)}
#define LG_LIGHTS ${MAX_LIGHTS}
#define LG_SHADOWS ${MAX_SHADOWS}
#define SURF_TILES ${SURF.TILES}
#define SURF_FLUTED ${SURF.FLUTED}
#define SURF_PLANKS ${SURF.PLANKS}
#define SURF_GRILLE ${SURF.GRILLE}
#define SURF_LEAF ${SURF.LEAF}
#define SURF_PAPER ${SURF.PAPER}
#define SURF_LENS ${SURF.LENS}
#define SURF_BACKLIT ${SURF.BACKLIT}
#define SURF_DECK ${SURF.DECK}
#define SURF_FLUTED_FINE ${SURF.FLUTED_FINE}
#define SURF_CERAMIC ${SURF.CERAMIC}
#define SURF_RUG ${SURF.RUG}
#define SURF_BAFFLE ${SURF.BAFFLE}
#define SURF_LONG ${SURF.LONG}
#define SURF_ART ${SURF.ART}
#define SURF_OPAL ${SURF.OPAL}
#define GLOW_TABLE ${GLOW.TABLE}
`;

// Shared uniforms (declared in both stages where needed).
const GLSL_UNIFORMS = /* glsl */ `
uniform mat3 uLoungeViewToRoom;
uniform vec3 uLoungeEye;
uniform vec3 uLoungeKey;        // room-local, toward the key light
uniform vec4 uLoungeLight;      // x glass transmittance, y sky gain, z key gain (0 = no key), w practical master
uniform vec3 uLoungeBounce;     // interior inter-reflection irradiance
uniform vec3 uLoungeRoomRad;    // the room's mean radiance (what a reflection sees indoors)
uniform vec4 uLoungeLA[ LG_LIGHTS ]; // xyz position / segment start, w range
uniform vec4 uLoungeLB[ LG_LIGHTS ]; // rgb colour * power, w glow channel
uniform vec4 uLoungeLC[ LG_LIGHTS ]; // xyz spot axis / line normal, w type (0 point, 1 spot, 2 line, -1 off)
uniform vec4 uLoungeLD[ LG_LIGHTS ]; // spot: x cos outer, y cos inner, z occluding disc height, w its radius; line: xyz segment end
uniform float uLoungeGlow[ 8 ];
uniform vec4 uLoungeSA[ LG_SHADOWS ]; // centre xyz, w yaw
uniform vec4 uLoungeSB[ LG_SHADOWS ]; // half extents xyz, w opacity (0 = unused)
uniform sampler2D uLoungeFloorAO;
uniform vec4 uLoungeFloorRect;  // x0, z0, 1/w, 1/d
uniform float uLoungeTime;
uniform float uLoungeFade;      // binocular defocus: 0 = the room, 1 = gone
uniform float uLoungeKeySoft;   // sun-disc penumbra per metre (widens as cloud diffuses the sun)
`;

const GLSL_FUNCS = /* glsl */ `
float lgBand( float v, float lo, float hi, float s ) {
  return smoothstep( lo - s, lo + s, v ) * ( 1.0 - smoothstep( hi - s, hi + s, v ) );
}
// Fins on the pitch (centred bays: x = pitch/2 + k*pitch), seen by a ray that
// sweeps the x interval [a, b] while crossing the fin depth.
float lgFins( float a, float b, float s ) {
  float lo = min( a, b ), hi = max( a, b );
  float k = floor( ( 0.5 * ( lo + hi ) - 0.5 * LG_PITCH ) / LG_PITCH + 0.5 );
  float vis = 1.0;
  for ( int j = -1; j <= 1; j ++ ) {
    float xm = 0.5 * LG_PITCH + ( k + float( j ) ) * LG_PITCH;
    if ( abs( xm ) > LG_HALF_X - 0.3 ) continue;
    float gap = max( 0.0, max( lo - xm, xm - hi ) );
    vis *= smoothstep( LG_FIN - s, LG_FIN + s, gap );
  }
  return vis;
}
// A ray (origin p, direction d, up to tMax) against a box: 1 = clear.
float lgBoxClear( vec3 p, vec3 d, vec3 lo, vec3 hi, float tMax, float s ) {
  vec3 inv = 1.0 / d;
  vec3 t0 = ( lo - s - p ) * inv, t1 = ( hi + s - p ) * inv;
  vec3 tn3 = min( t0, t1 ), tf3 = max( t0, t1 );
  float tn = max( max( tn3.x, tn3.y ), max( tn3.z, 0.0 ) ), tf = min( min( tf3.x, tf3.y ), min( tf3.z, tMax ) );
  if ( tf <= tn ) return 1.0;
  vec3 q = p + d * ( 0.5 * ( tn + tf ) ) - 0.5 * ( lo + hi );
  vec3 e = abs( q ) - 0.5 * ( hi - lo );
  float sd = length( max( e, 0.0 ) ) + min( max( e.x, max( e.y, e.z ) ), 0.0 );
  return smoothstep( -s, s, sd );
}
// How much of a ray from p along unit d leaves the room through glass (0..1).
// soft = penumbra half-width (metres) per metre travelled.
float lgAperture( vec3 p, vec3 d, float softK, float softMin ) {
  const float BIG = 1e5;
  float fs = d.z + d.y * LG_CANT;
  float pf = p.z + p.y * LG_CANT - LG_C0;
  float tF = fs < -1e-5 ? pf / -fs : BIG;
  float tR = d.y > 1e-5 ? ( LG_HEAD_Y - p.y ) / d.y : BIG;
  float tS = abs( d.x ) > 1e-5 ? ( sign( d.x ) * LG_HALF_X - p.x ) / d.x : BIG;
  float tB = d.z > 1e-5 ? ( LG_BACK_Z - p.z ) / d.z : BIG;
  float tD = d.y < -1e-5 ? -p.y / d.y : BIG;
  float t = min( min( tF, tR ), min( min( tS, tB ), tD ) );
  if ( t >= BIG * 0.5 ) return 0.0;
  float s = softMin + t * softK;
  vec3 q = p + d * t;
  float vis = 0.0;
  if ( t == tF ) {
    vis = lgBand( q.y, LG_Y0, LG_Y1, s ) * lgBand( q.x, -LG_HALF_X + 0.07, LG_HALF_X - 0.07, s );
    float tIn = max( ( pf - LG_FIN_DEPTH * LG_SEC ) / -fs, 0.0 );
    vis *= lgFins( p.x + d.x * tIn, q.x, s );
  } else if ( t == tR ) {
    vis = lgBand( q.z, LG_RZ0, LG_RZ1, s ) * lgBand( q.x, -LG_HALF_X + 0.09, LG_HALF_X - 0.09, s );
    float tIn = max( ( LG_HEAD_Y - LG_FIN_DEPTH - p.y ) / d.y, 0.0 );
    vis *= lgFins( p.x + d.x * tIn, q.x, s );
  } else if ( t == tS ) {
    vis = lgBand( q.y, LG_Y0, LG_Y1, s ) * ( 1.0 - smoothstep( LG_SZ1 - s, LG_SZ1 + s, q.z ) );
    float tIn = max( ( sign( d.x ) * ( LG_HALF_X - LG_FIN_DEPTH ) - p.x ) / d.x, 0.0 );
    float za = p.z + d.z * tIn;
    float gap = max( 0.0, max( min( za, q.z ) - LG_SIDE_FIN_Z, LG_SIDE_FIN_Z - max( za, q.z ) ) );
    vis *= smoothstep( LG_FIN - s, LG_FIN + s, gap );
  }
  if ( vis > 0.0 ) {
    // The head transom and the fascia beam hang inside the room.
    vis *= lgBoxClear( p, d, vec3( -LG_HALF_X, LG_HEAD_Y - 0.17, LG_HEAD_Z ), vec3( LG_HALF_X, LG_HEAD_Y + 0.01, LG_HEAD_Z + LG_HEAD_DEPTH ), t, s );
    vis *= lgBoxClear( p, d, vec3( -LG_HALF_X, LG_HEAD_Y - LG_FASCIA_DROP, LG_ROOF_Z1 ), vec3( LG_HALF_X, LG_HEAD_Y + 0.01, LG_ROOF_Z1 + LG_FASCIA_DEPTH ), t, s );
  }
  return vis;
}
// Soft shadows from oriented furniture boxes along the key direction.
float lgFurniture( vec3 p, vec3 L, float softMin ) {
  float vis = 1.0;
  for ( int i = 0; i < LG_SHADOWS; i ++ ) {
    vec4 B = uLoungeSB[ i ];
    if ( B.w <= 0.0 ) break;
    vec4 A = uLoungeSA[ i ];
    float c = cos( A.w ), sn = sin( A.w );
    vec3 o = p - A.xyz;
    o = vec3( c * o.x - sn * o.z, o.y, sn * o.x + c * o.z );
    vec3 d = vec3( c * L.x - sn * L.z, L.y, sn * L.x + c * L.z );
    // A receiver on (or in) a box does not shadow itself.
    if ( all( lessThan( abs( o ), B.xyz + 0.03 ) ) ) continue;
    float m = 0.08;
    vec3 inv = 1.0 / d;
    vec3 t0 = ( -B.xyz - m - o ) * inv, t1 = ( B.xyz + m - o ) * inv;
    vec3 tn3 = min( t0, t1 ), tf3 = max( t0, t1 );
    float tn = max( max( tn3.x, tn3.y ), max( tn3.z, 0.0 ) ), tf = min( min( tf3.x, tf3.y ), tf3.z );
    if ( tf <= tn ) continue;
    float tm = 0.5 * ( tn + tf );
    vec3 e = abs( o + d * tm ) - B.xyz;
    float sd = length( max( e, 0.0 ) ) + min( max( e.x, max( e.y, e.z ) ), 0.0 );
    float pw = softMin + 0.012 + tm * ( 0.02 + uLoungeKeySoft );
    vis *= 1.0 - ( 1.0 - smoothstep( -pw, pw, sd ) ) * B.w;
    if ( vis < 0.01 ) break;
  }
  return vis;
}
// Cosine-weighted form factor of a quad (vertices wound clockwise as seen
// from p), horizon-clipped: three's own LTC edge integral.
float lgQuadFF( vec3 p, vec3 n, vec3 a, vec3 b, vec3 c, vec3 d ) {
  vec3 v0 = normalize( a - p ), v1 = normalize( b - p ), v2 = normalize( c - p ), v3 = normalize( d - p );
  vec3 fv = LTC_EdgeVectorFormFactor( v0, v1 ) + LTC_EdgeVectorFormFactor( v1, v2 ) + LTC_EdgeVectorFormFactor( v2, v3 ) + LTC_EdgeVectorFormFactor( v3, v0 );
  float l = length( fv );
  return max( ( l * l + dot( fv, n ) ) / ( l + 1.0 ), 0.0 );
}
float lgZF( float y ) { return LG_C0 - y * LG_CANT; }
float lgSky( vec3 p, vec3 n ) {
  vec3 tl = vec3( -LG_HALF_X, LG_Y1, lgZF( LG_Y1 ) ), tr = vec3( LG_HALF_X, LG_Y1, lgZF( LG_Y1 ) );
  vec3 bl = vec3( -LG_HALF_X, LG_Y0, lgZF( LG_Y0 ) ), br = vec3( LG_HALF_X, LG_Y0, lgZF( LG_Y0 ) );
  float ff = lgQuadFF( p, n, tl, tr, br, bl );
  ff += lgQuadFF( p, n, vec3( -LG_HALF_X, LG_HEAD_Y, LG_RZ1 ), vec3( LG_HALF_X, LG_HEAD_Y, LG_RZ1 ), vec3( LG_HALF_X, LG_HEAD_Y, LG_RZ0 ), vec3( -LG_HALF_X, LG_HEAD_Y, LG_RZ0 ) );
  ff += lgQuadFF( p, n, bl, vec3( -LG_HALF_X, LG_Y0, LG_SZ1 ), vec3( -LG_HALF_X, LG_Y1, LG_SZ1 ), tl );
  ff += lgQuadFF( p, n, tr, vec3( LG_HALF_X, LG_Y1, LG_SZ1 ), vec3( LG_HALF_X, LG_Y0, LG_SZ1 ), br );
  // the fins and beams take ~6% of the glazed area
  return min( ff, 1.0 ) * 0.94;
}
// Analytic occlusion of the shell: wall/floor/ceiling junctions and corners,
// and the cavities between ceiling baffles.
float lgShellAO( vec3 p, vec3 n, int flag ) {
  if ( p.y < 0.03 ) return 1.0; // the floor has its baked map
  float vy = 1.0 - abs( n.y ), vx = 1.0 - abs( n.x ), vz = 1.0 - abs( n.z );
  float ao = 1.0;
  ao *= 1.0 - 0.38 * exp( -max( p.y, 0.0 ) / 0.28 ) * vy;
  ao *= 1.0 - 0.32 * exp( -max( LG_HEAD_Y - p.y, 0.0 ) / 0.45 ) * vy;
  ao *= 1.0 - 0.3 * exp( -max( LG_HALF_X - abs( p.x ), 0.0 ) / 0.35 ) * vx;
  ao *= 1.0 - 0.3 * exp( -max( LG_BACK_Z - p.z, 0.0 ) / 0.35 ) * vz;
  if ( flag == SURF_BAFFLE ) {
    // Sides see the neighbouring baffle; the deeper, the darker.
    float depth = clamp( ( p.y - ( LG_DECK_Y - 0.02 - LG_BAFFLE_DEPTH ) ) / LG_BAFFLE_DEPTH, 0.0, 1.0 );
    ao *= mix( 1.0, mix( 0.82, 0.42, depth ), smoothstep( 0.3, 0.9, 1.0 - abs( n.y ) ) );
  }
  if ( flag == SURF_DECK ) ao *= 0.38;
  return ao;
}
float lgFloorAO( vec3 p ) {
  vec2 uv = ( p.xz - uLoungeFloorRect.xy ) * uLoungeFloorRect.zw;
  float near = ( 1.0 - smoothstep( 0.02, 0.07, p.y ) ) * step( 0.0, uv.x ) * step( uv.x, 1.0 ) * step( 0.0, uv.y ) * step( uv.y, 1.0 );
  return mix( 1.0, texture2D( uLoungeFloorAO, uv ).r, near );
}
float lgWindow( float d, float r ) {
  float x = clamp( 1.0 - pow( d / r, 4.0 ), 0.0, 1.0 );
  return x * x;
}
// Perturb the shading normal by a height h (metres) in view space (three's
// derivative bump, local copy so it works without a bump map).
vec3 lgBump( vec3 surfPos, vec3 surfNorm, float h, float faceDir ) {
  vec2 dh = vec2( dFdx( h ), dFdy( h ) );
  vec3 sx = dFdx( surfPos ), sy = dFdy( surfPos );
  vec3 r1 = cross( sy, surfNorm ), r2 = cross( surfNorm, sx );
  float det = dot( sx, r1 ) * faceDir;
  vec3 grad = sign( det ) * ( dh.x * r1 + dh.y * r2 );
  return normalize( abs( det ) * surfNorm - grad );
}
float lgHash( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float lgNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( lgHash( i ), lgHash( i + vec2( 1, 0 ) ), u.x ), mix( lgHash( i + vec2( 0, 1 ) ), lgHash( i + vec2( 1, 1 ) ), u.x ), u.y );
}
`;

// The binoculars focus at infinity: as the twin-lens mask rises the room
// dissolves (a per-frame re-seeded interleaved-gradient dither, read as grain,
// never as a pattern), then the component hides it outright. A uniform branch:
// nothing is discarded while the binoculars are down.
const GLSL_DEFOCUS = /* glsl */ `
  if ( uLoungeFade > 0.0 ) {
    vec2 lgFc = gl_FragCoord.xy + fract( uLoungeTime * vec2( 7.13, 3.71 ) ) * vec2( 61.0, 37.0 );
    if ( fract( 52.9829189 * fract( dot( lgFc, vec2( 0.06711056, 0.00583715 ) ) ) ) < uLoungeFade ) discard;
  }`;

// ---------------------------------------------------------------------------
// The shader patch
// ---------------------------------------------------------------------------

/** Per-material options: which procedural details compile in. */
function patchSource(shader, opts) {
  const vs = shader.vertexShader, fs = shader.fragmentShader;
  const need = (src, anchor) => {
    if (!src.includes(anchor)) throw new Error(`lounge shading: anchor missing: ${anchor}`);
  };
  for (const a of ['#include <common>', '#include <begin_vertex>']) need(vs, a);
  for (const a of ['#include <common>', '#include <clipping_planes_fragment>', '#include <lights_physical_pars_fragment>', '#include <map_fragment>', '#include <color_fragment>', '#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>', '#include <normal_fragment_maps>', '#include <emissivemap_fragment>', '#include <lights_fragment_end>']) need(fs, a);

  shader.vertexShader = vs
    .replace('#include <common>', `#include <common>
attribute vec4 aSurf;
varying vec4 vLoungeSurf;
varying vec3 vLoungePos;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
vLoungeSurf = aSurf;
vLoungePos = transformed;`);

  const tiles = opts.tiles ? /* glsl */ `
  if ( lgFlag == SURF_TILES ) {
    // Honed travertine, 1.2 x 0.6 m, running bond. Each tile samples its own
    // patch of stone, so 25 m of floor never shows the texture repeat.
    vec2 tp = vLoungePos.xz / vec2( 1.2, 0.6 );
    float row = floor( tp.y );
    tp.x += mod( row, 2.0 ) * 0.5;
    vec2 cell = floor( tp );
    lgTile = cell;
    vec2 local = fract( tp ) * vec2( 1.2, 0.6 );
    float h = lgHash( cell );
    lgUv = ( local + vec2( h * 7.3, lgHash( cell + 3.1 ) * 5.9 ) ) / 1.2;
    if ( h > 0.5 ) { lgUv = lgUv.yx; lgDx = lgDx.yx; lgDy = lgDy.yx; } // a quarter turn for half the tiles
  }` : '';

  shader.fragmentShader = fs
    .replace('#include <common>', `#include <common>
${GLSL_CONST}
${GLSL_UNIFORMS}
varying vec4 vLoungeSurf;
varying vec3 vLoungePos;`)
    // Global scope, after three's LTC/BRDF helpers it calls.
    .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
${GLSL_FUNCS}`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
${GLSL_DEFOCUS}`)
    .replace('#include <map_fragment>', /* glsl */ `
  int lgFlag = int( vLoungeSurf.w + 0.5 );
  vec2 lgTile = vec2( -1.0 );
  float lgHeight = 0.5;
  float lgRough = 1.0;
#ifdef USE_MAP
  vec2 lgUv = vMapUv;
  vec2 lgDx = dFdx( vMapUv ), lgDy = dFdy( vMapUv );
  ${tiles}
  vec4 lgTex = textureGrad( map, lgUv, lgDx, lgDy );
  diffuseColor.rgb *= lgTex.rgb;
  ${opts.alpha ? `// foliage: alpha is the leaf mask; counter the mip thinning of alpha-tested leaves
  float lgLod = max( 0.0, log2( max( length( lgDx ), length( lgDy ) ) * 512.0 ) );
  diffuseColor.a *= min( 1.0, lgTex.a * ( 1.0 + lgLod * 0.3 ) );` : 'lgHeight = lgTex.a;'}
#endif`)
    .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
  // --- procedural surface detail (flag-driven) ---
  float lgBumpH = 0.0;
  {
    vec3 rp = vLoungePos;
    if ( lgFlag == SURF_TILES ) {
      vec2 tp = rp.xz / vec2( 1.2, 0.6 );
      float row = floor( tp.y );
      tp.x += mod( row, 2.0 ) * 0.5;
      vec2 g = abs( fract( tp ) - 0.5 ) * vec2( 1.2, 0.6 ); // distance from tile centre (m)
      vec2 edge = vec2( 0.6, 0.3 ) - g;                     // distance to the joint (m)
      float px = length( fwidth( rp.xz ) );
      float joint = 1.0 - smoothstep( 0.0011, 0.0011 + px * 1.2, min( edge.x, edge.y ) );
      float tone = lgHash( lgTile ) - 0.5;
      diffuseColor.rgb *= ( 1.0 + tone * 0.06 ) * mix( 1.0, 0.72, joint );
      lgRough = mix( 1.0 + tone * 0.15, 2.2, joint );
      lgBumpH -= joint * 0.0012;
    } else if ( lgFlag == SURF_FLUTED || lgFlag == SURF_FLUTED_FINE ) {
      float pitch = lgFlag == SURF_FLUTED ? 0.045 : 0.032;
      #ifdef USE_MAP
      // reeds run along the grain: the profile varies across it (v)
      float u = vMapUv.y * ${f(opts.texScale ?? 1)};
      #else
      float u = rp.x + rp.z;
      #endif
      float w = fwidth( u / pitch );
      float k = 1.0 - smoothstep( 0.25, 0.6, w );
      float ph = fract( u / pitch );
      float profile = sqrt( max( 0.0, 1.0 - pow( ph * 2.0 - 1.0, 2.0 ) ) ); // half-round reeds
      lgBumpH += profile * 0.006 * k;
      diffuseColor.rgb *= mix( 1.0, mix( 0.7, 1.05, profile ), k );
    } else if ( lgFlag == SURF_GRILLE ) {
      float s = rp.x / 0.022;
      float w = fwidth( s );
      float slot = 1.0 - smoothstep( 0.28 - w, 0.28 + w, abs( fract( s ) - 0.5 ) );
      diffuseColor.rgb *= mix( 1.0, 0.04, slot * ( 1.0 - smoothstep( 0.3, 0.8, w ) ) );
    } else if ( lgFlag == SURF_PAPER ) {
      // Page edges: fine layered lines on the block's sides.
      float s = rp.y / 0.00042;
      float w = fwidth( s );
      float line = smoothstep( 0.35, 0.5, abs( fract( s ) - 0.5 ) ) * ( 1.0 - smoothstep( 0.3, 0.8, w ) );
      diffuseColor.rgb *= 1.0 - line * 0.25;
    } else if ( lgFlag == SURF_RUG ) {
      lgRough = 1.0;
    } else if ( lgFlag == SURF_ART ) {
      // The canvas: an abstract aerial landscape in layered colour fields
      // with brushed, feathered edges and a thin gilded horizon.
      vec2 a = vec2( ( rp.z - ${f(ART_RECT.z0)} ) / ${f(ART_RECT.w)}, ( rp.y - ${f(ART_RECT.y0)} ) / ${f(ART_RECT.h)} );
      float n1 = lgNoise( a * vec2( 3.0, 9.0 ) ), n2 = lgNoise( a * vec2( 11.0, 30.0 ) + 4.1 );
      float y = a.y + ( n1 - 0.5 ) * 0.06 + ( n2 - 0.5 ) * 0.015;
      vec3 c = vec3( 0.2, 0.23, 0.25 );
      c = mix( c, vec3( 0.62, 0.42, 0.22 ), smoothstep( 0.24, 0.29, y ) );
      c = mix( c, vec3( 0.78, 0.66, 0.46 ), smoothstep( 0.42, 0.47, y + ( n1 - 0.5 ) * 0.04 ) );
      c = mix( c, vec3( 0.46, 0.54, 0.6 ), smoothstep( 0.6, 0.66, y ) );
      c = mix( c, vec3( 0.68, 0.72, 0.74 ), smoothstep( 0.8, 0.95, y ) );
      c *= 0.9 + 0.2 * n2;
      float gild = 1.0 - smoothstep( 0.0, 0.004 + fwidth( y ) * 1.5, abs( y - 0.455 ) );
      c = mix( c, vec3( 1.0, 0.76, 0.4 ), gild * 0.85 );
      diffuseColor.rgb *= c * 1.15;
      lgRough = mix( 1.0, 0.45, gild );
    }
  }`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = clamp( vLoungeSurf.x * lgRough, 0.04, 1.0 );`)
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
  metalnessFactor = clamp( vLoungeSurf.y, 0.0, 1.0 );`)
    .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
  {
    // Texture height (alpha) + procedural relief, as a derivative bump.
    float h = ( lgHeight - 0.5 ) * ${f(opts.bump ?? 0)} + lgBumpH;
    if ( abs( ${f(opts.bump ?? 0)} ) > 0.0 || lgBumpH != 0.0 ) normal = lgBump( -vViewPosition, normal, h, faceDirection );
    // Geometric specular anti-aliasing: thin bright edges (fins, rails,
    // bevels) get the roughness their normal variation implies.
    vec3 dnx = dFdx( normal ), dny = dFdy( normal );
    float variance = 0.25 * ( dot( dnx, dnx ) + dot( dny, dny ) );
    roughnessFactor = sqrt( clamp( roughnessFactor * roughnessFactor + min( 2.0 * variance, 0.18 ), 0.0, 1.0 ) );
  }`)
    .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
  if ( lgFlag == SURF_BACKLIT ) {
    // Bottles and glass shelves glow with the bar's backlight behind them.
    totalEmissiveRadiance += diffuseColor.rgb * uLoungeGlow[ ${GLOW.BAR} ] * 0.55;
  } else if ( lgFlag == SURF_OPAL ) {
    // An opal lamp dome glows through: brightest near its rim, where the
    // diffuser is thinnest relative to the lamp inside.
    vec3 lgNo = normalize( uLoungeViewToRoom * normal );
    float rim = 0.75 + 0.25 * saturate( 1.0 - lgNo.y * lgNo.y );
    totalEmissiveRadiance += vec3( 1.0, 0.8, 0.58 ) * uLoungeGlow[ GLOW_TABLE ] * uLoungeLight.w * 0.62 * rim;
  } else if ( lgFlag == SURF_LENS ) {
    // A hint of anti-reflection coating on the binocular glass.
    float fr = pow( 1.0 - saturate( dot( normalize( vViewPosition ), normal ) ), 3.0 );
    totalEmissiveRadiance += vec3( 0.05, 0.02, 0.09 ) * fr * ( 0.3 + uLoungeLight.z );
  }`)
    .replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
  {
    // ====================== THE INTERIOR =======================
    vec3 lgN = normalize( uLoungeViewToRoom * normal );
    vec3 lgP = vLoungePos;
    vec3 lgV = normalize( uLoungeEye - lgP );
    float lgPx = length( fwidth( lgP ) );
    // ambient occlusion: baked vertex AO, the baked floor map, the shell
    float lgAO = vLoungeSurf.z * lgFloorAO( lgP ) * lgShellAO( lgP, lgN, lgFlag );
    lgAO = lgAO * lgAO * ( 3.0 - 2.0 * lgAO ); // a firmer contact curve
    // KEY through the glazing (+ furniture shadows)
    float lgKey = 0.0;
    if ( uLoungeLight.z > 0.0 && dot( lgN, uLoungeKey ) > -0.2 ) {
      vec3 o = lgP + lgN * 0.006;
      lgKey = lgAperture( o, uLoungeKey, uLoungeKeySoft, lgPx * 0.7 );
      if ( lgKey > 0.0 ) lgKey *= lgFurniture( o, uLoungeKey, lgPx * 0.7 );
    }
    // z: the key's indoor gain (1 by day, a trace after dark: updateRoomShading)
    lgKey *= uLoungeLight.x * uLoungeLight.z;
    reflectedLight.directDiffuse *= lgKey;
    reflectedLight.directSpecular *= lgKey;
    ${opts.leaves ? /* glsl */ `
    if ( lgFlag == SURF_LEAF ) {
      // thin leaves transmit the key when it is behind them
      float back = saturate( -dot( lgN, uLoungeKey ) );
      float keyT = lgAperture( lgP, uLoungeKey, uLoungeKeySoft, lgPx );
      reflectedLight.directDiffuse += diffuseColor.rgb * vec3( 0.9, 1.0, 0.45 ) * back * keyT * uLoungeLight.z * uLoungeLight.x * 0.6;
    }` : ''}
    // SKY through the glazing + the room's bounce
    float lgS = lgSky( lgP, lgN );
    vec3 lgB = uLoungeBounce * ( 0.78 - 0.38 * lgN.y ) * mix( 1.25, 0.7, smoothstep( -1.0, 12.0, lgP.z ) );
    reflectedLight.indirectDiffuse = ( reflectedLight.indirectDiffuse * lgS * uLoungeLight.x * uLoungeLight.y + lgB * BRDF_Lambert( material.diffuseColor ) ) * lgAO;
    // REFLECTIONS: the sky only where the reflected ray leaves through glass
    vec3 lgR = reflect( -lgV, lgN );
    float lgOut = lgAperture( lgP + lgN * 0.006, lgR, 0.0047 + material.roughness * material.roughness * 0.6, lgPx );
    vec3 lgRoomSpec = uLoungeRoomRad * EnvironmentBRDF( lgN, lgV, material.specularColor, material.specularF90, material.roughness );
    reflectedLight.indirectSpecular = ( reflectedLight.indirectSpecular * lgOut * uLoungeLight.x + lgRoomSpec * ( 1.0 - lgOut ) ) * mix( 1.0, lgAO, 0.8 );
    // PRACTICALS: the interior fixtures
    if ( uLoungeLight.w > 0.0005 ) {
      float occ = mix( 1.0, lgAO, 0.55 );
      for ( int i = 0; i < LG_LIGHTS; i ++ ) {
        vec4 C = uLoungeLC[ i ];
        if ( C.w < -0.5 ) break;
        vec4 A = uLoungeLA[ i ], B = uLoungeLB[ i ], D = uLoungeLD[ i ];
        float gain = uLoungeGlow[ int( B.w + 0.5 ) ];
        if ( gain <= 0.0 ) continue;
        // out of range (a line light's range is about its nearest point)
        if ( C.w < 1.5 ) { vec3 dd = A.xyz - lgP; if ( dot( dd, dd ) > A.w * A.w ) continue; }
        vec3 L;
        float E;
        if ( C.w > 1.5 ) {
          // line light (Picott/Karis tube irradiance), one-sided
          vec3 L0 = A.xyz - lgP, L1 = D.xyz - lgP;
          float l0 = length( L0 ), l1 = length( L1 );
          float nl = saturate( 0.5 * ( dot( lgN, L0 ) / l0 + dot( lgN, L1 ) / l1 ) );
          E = 2.0 * nl / ( l0 * l1 + dot( L0, L1 ) + 0.02 );
          vec3 seg = D.xyz - A.xyz;
          float tq = clamp( dot( lgP - A.xyz, seg ) / dot( seg, seg ), 0.0, 1.0 );
          vec3 q = A.xyz + seg * tq;
          L = q - lgP;
          float dist = length( L );
          L /= dist;
          E *= lgWindow( dist, A.w ) * saturate( dot( -L, C.xyz ) * 1.4 + 0.25 );
        } else {
          L = A.xyz - lgP;
          float dist = length( L );
          L /= dist;
          E = lgWindow( dist, A.w ) / max( dist * dist, 0.04 ) * saturate( dot( lgN, L ) );
          if ( C.w > 0.5 ) {
            E *= smoothstep( D.x, D.y, dot( -L, C.xyz ) );
            // a table top under a table lamp keeps the floor beneath it dark
            if ( D.w > 0.0 && lgP.y < D.z - 0.004 ) {
              float t = ( D.z - lgP.y ) / max( A.y - lgP.y, 1e-3 );
              float r = length( lgP.xz + ( A.xz - lgP.xz ) * t - A.xz );
              E *= smoothstep( D.w - 0.02, D.w + 0.06, r );
            }
          }
        }
        if ( E <= 0.0 ) continue;
        vec3 irr = B.rgb * gain * E * uLoungeLight.w * occ;
        reflectedLight.directDiffuse += irr * BRDF_Lambert( material.diffuseColor );
        reflectedLight.directSpecular += irr * BRDF_GGX( L, lgV, lgN, material );
      }
    }
  }`);
}

/** Chain the lounge patch onto a material (CSM-safe). */
function patchRoomMaterial(material, uniforms, opts) {
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    patchSource(shader, opts);
  };
  const tag = `lounge-room-v1-${opts.tiles ? 't' : ''}${opts.leaves ? 'l' : ''}${opts.alpha ? 'a' : ''}${opts.bump ? 'b' : ''}-${opts.texScale ?? 1}`;
  material.customProgramCacheKey = () => `${key.call(material)}|${tag}`;
  material.userData.loungeRoom = true;
  return material;
}

// ---------------------------------------------------------------------------
// Materials and the shared uniforms
// ---------------------------------------------------------------------------

/** The uniforms every room material shares (one object, updated per frame). */
export function createRoomUniforms() {
  const arr = (n) => Array.from({ length: n }, () => new Vector4(0, 0, 0, 0));
  return {
    uLoungeViewToRoom: { value: new Matrix3() },
    uLoungeEye: { value: new Vector3(0, 1.18, 0) },
    uLoungeKey: { value: new Vector3(0, 1, 0) },
    uLoungeLight: { value: new Vector4(0.88, 1, 1, 0) },
    uLoungeBounce: { value: new Vector3() },
    uLoungeRoomRad: { value: new Vector3() },
    uLoungeLA: { value: arr(MAX_LIGHTS) },
    uLoungeLB: { value: arr(MAX_LIGHTS) },
    uLoungeLC: { value: arr(MAX_LIGHTS).map((v) => v.set(0, 0, 0, -1)) },
    uLoungeLD: { value: arr(MAX_LIGHTS) },
    uLoungeGlow: { value: new Float32Array(8) },
    uLoungeSA: { value: arr(MAX_SHADOWS) },
    uLoungeSB: { value: arr(MAX_SHADOWS) },
    uLoungeFloorAO: { value: null },
    uLoungeFloorRect: { value: new Vector4(FLOOR_RECT.x0, FLOOR_RECT.z0, 1 / (FLOOR_RECT.x1 - FLOOR_RECT.x0), 1 / (FLOOR_RECT.z1 - FLOOR_RECT.z0)) },
    uLoungeTime: { value: 0 },
    uLoungeFade: { value: 0 },
    uLoungeKeySoft: { value: 0.0047 },
  };
}

/** Write the static fixture lists (practicals, shadow boxes) into the uniforms. */
export function writeRoomFixtures(uniforms, room) {
  const { practicals, shadows } = room;
  const LA = uniforms.uLoungeLA.value, LB = uniforms.uLoungeLB.value, LC = uniforms.uLoungeLC.value, LD = uniforms.uLoungeLD.value;
  const lights = practicals.slice(0, MAX_LIGHTS);
  lights.forEach((l, i) => {
    const type = l.type === 'line' ? 2 : l.type === 'spot' ? 1 : 0;
    const p = l.type === 'line' ? l.a : l.p;
    LA[i].set(p[0], p[1], p[2], l.range ?? 6);
    LB[i].set(l.color[0] * l.power, l.color[1] * l.power, l.color[2] * l.power, l.group ?? 0);
    const axis = l.type === 'line' ? l.n : l.d ?? [0, -1, 0];
    const al = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    LC[i].set(axis[0] / al, axis[1] / al, axis[2] / al, type);
    if (l.type === 'line') LD[i].set(l.b[0], l.b[1], l.b[2], 0);
    else LD[i].set(l.cone?.[0] ?? -1, l.cone?.[1] ?? 1, l.disc?.[0] ?? 0, l.disc?.[1] ?? 0);
  });
  for (let i = lights.length; i < MAX_LIGHTS; i++) LC[i].set(0, 0, 0, -1);
  const SA = uniforms.uLoungeSA.value, SB = uniforms.uLoungeSB.value;
  shadows.slice(0, MAX_SHADOWS).forEach((s, i) => {
    SA[i].set(s.c[0], s.c[1], s.c[2], s.rot ?? 0);
    SB[i].set(s.h[0], s.h[1], s.h[2], s.k ?? 1);
  });
  for (let i = shadows.length; i < MAX_SHADOWS; i++) SB[i].set(0, 0, 0, 0);
  return { lights: lights.length, shadows: Math.min(MAX_SHADOWS, shadows.length) };
}

/**
 * The room's materials. `maps` (optional) are the baked surface textures
 * (room-textures.js); without them the room still renders (node gate, or a
 * renderer that failed the bake).
 */
export function createRoomMaterials(uniforms, maps = {}) {
  const std = (params, opts) => patchRoomMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, fog: false, ...params }), uniforms, opts);
  const materials = {
    stone: std({ map: maps.stone ?? null, name: 'lounge-stone' }, { tiles: true, bump: maps.stone ? 0.0016 : 0, texScale: 1.2 }),
    wood: std({ map: maps.wood ?? null, name: 'lounge-wood' }, { bump: maps.wood ? 0.0009 : 0, texScale: 1.4 }),
    metal: std({ name: 'lounge-metal', envMapIntensity: 1 }, {}),
    leather: std({ map: maps.leather ?? null, name: 'lounge-leather' }, { bump: maps.leather ? 0.0011 : 0 }),
    fabric: patchRoomMaterial(new MeshPhysicalMaterial({ vertexColors: true, roughness: 1, metalness: 0, fog: false, map: maps.fabric ?? null, sheen: 1, sheenRoughness: 0.55, sheenColor: new Color(0.42, 0.4, 0.38), name: 'lounge-fabric' }), uniforms, { bump: maps.fabric ? 0.0014 : 0 }),
    plaster: std({ map: maps.plaster ?? null, name: 'lounge-plaster' }, { bump: maps.plaster ? 0.0007 : 0 }),
    small: std({ side: DoubleSide, name: 'lounge-small' }, { leaves: true }),
    // Alpha-tested foliage cards (olive canopies): one draw for thousands of leaves.
    foliage: std({ map: maps.foliage ?? null, side: DoubleSide, alphaTest: 0.5, name: 'lounge-foliage' }, { leaves: true, alpha: true }),
  };
  materials.emissive = createEmissiveMaterial(uniforms);
  return materials;
}

/** Light sources themselves: unlit, vertex colour x channel dimmer. */
function createEmissiveMaterial(uniforms) {
  const m = new MeshBasicMaterial({ vertexColors: true, fog: false, name: 'lounge-emissive' });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLoungeGlow = uniforms.uLoungeGlow;
    shader.uniforms.uLoungeLight = uniforms.uLoungeLight;
    shader.uniforms.uLoungeFade = uniforms.uLoungeFade;
    shader.uniforms.uLoungeTime = uniforms.uLoungeTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSurf;\nvarying vec4 vLoungeSurf;\nvarying vec3 vLoungePos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoungeSurf = aSurf;\nvLoungePos = transformed;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLoungeGlow[ 8 ];\nuniform vec4 uLoungeLight;\nuniform float uLoungeFade;\nuniform float uLoungeTime;\nvarying vec4 vLoungeSurf;\nvarying vec3 vLoungePos;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
${GLSL_DEFOCUS}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
  {
    float g = uLoungeGlow[ int( vLoungeSurf.x + 0.5 ) ] * uLoungeLight.w;
    int flag = int( vLoungeSurf.w + 0.5 );
    if ( flag == 1 ) {
      // backlit onyx: soft veining, brighter toward the centre
      vec2 q = vLoungePos.xy * vec2( 1.6, 2.3 );
      float v = sin( q.x * 2.1 + sin( q.y * 1.7 + q.x * 0.6 ) * 2.4 ) * 0.5 + 0.5;
      float vign = 1.0 - 0.35 * smoothstep( 0.6, 2.4, abs( vLoungePos.x ) ) - 0.25 * smoothstep( 0.6, 1.3, abs( vLoungePos.y - 2.36 ) );
      diffuseColor.rgb *= ( 0.75 + 0.45 * v ) * vign;
    } else if ( flag == 2 ) {
      // frosted doors to the concourse: brighter at eye level
      diffuseColor.rgb *= 0.65 + 0.45 * exp( -pow( ( vLoungePos.y - 1.5 ) / 1.1, 2.0 ) );
    }
    diffuseColor.rgb *= g;
  }`);
  };
  m.customProgramCacheKey = () => 'lounge-emissive-v2';
  return m;
}

// ---------------------------------------------------------------------------
// Per frame
// ---------------------------------------------------------------------------
const _m4 = new Matrix4();
const _m3 = new Matrix3();
const _v = new Vector3();
const _inv = new Matrix4();
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Practical dimming per glow channel: daytime level -> night level. */
// Night levels above 1 are the evening scene: pools of warm light at the
// seating and tables, a dim window line, the bar the brightest thing in the room.
const CHANNEL = [
  [1, 1], // ALWAYS: the boards' own light, day and night
  [0.0, 1.2], // COVE
  [0.35, 1.0], // SLOT
  [0.55, 1.5], // PENDANT
  [1.4, 1], // BAR (a backlit bar stays lit by day: 1.4 x the day master)
  [0.8, 1], // ENTRANCE
  [0.2, 1.4], // LAMP (downlights, sconces, the picture light)
  [0.3, 1.0], // TABLE (the window line's table lamps)
];

/**
 * Update the shared uniforms. state: { group, camera, env (cinemaEnvironment
 * or null), sun (runtime.sun), keyScene (scene-space key dir, Vector3),
 * time, dt }. Returns the derived lighting state (also used for the exposure
 * bias and the glass).
 */
export function updateRoomShading(uniforms, state, out = {}) {
  const { group, camera, env } = state;
  group.updateMatrixWorld();
  // room-local -> view, and its inverse for directions
  _m4.multiplyMatrices(camera.matrixWorldInverse, group.matrixWorld);
  _m3.setFromMatrix4(_m4).invert();
  uniforms.uLoungeViewToRoom.value.copy(_m3);
  _inv.copy(group.matrixWorld).invert();
  uniforms.uLoungeEye.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_inv);
  // key light direction (scene) -> room-local
  if (state.keyScene) {
    _m3.setFromMatrix4(group.matrixWorld).invert();
    _v.copy(state.keyScene).applyMatrix3(_m3).normalize();
    uniforms.uLoungeKey.value.copy(_v);
  }
  const day = env ? env.day : smooth(-0.1, 0.25, state.sun?.sinEl ?? 1);
  const night = env ? env.night : 1 - day;
  const golden = env ? env.golden : 0;
  const keyI = env ? env.sun : 6.2 * day + 0.3 * (1 - day);
  const overcast = env ? env.overcast : 0;
  // Practicals: on at a daytime level, full after dusk, and partway up on a
  // dark overcast day (the room is lit for the light outside, not the clock).
  const dayLight = day * (1 - 0.35 * overcast);
  const practical = 0.32 + 0.68 * smooth(0.15, 0.95, 1 - dayLight);
  const glow = uniforms.uLoungeGlow.value;
  const dayW = smooth(0.25, 0.9, dayLight);
  for (let i = 0; i < CHANNEL.length; i++) glow[i] = CHANNEL[i][0] * dayW + CHANNEL[i][1] * (1 - dayW);
  glow[0] = 1 / Math.max(0.05, practical); // the boards hold their brightness
  const L = uniforms.uLoungeLight.value;
  // After dark the world's moon key and night sky are authored bright enough
  // to read the ground from the air; inside a lit room they are nothing next
  // to the fixtures (real moonlight is ~1/1000 of a lounge's lighting), so
  // they fade to a cool trace at the glass instead of drawing mullion shadows
  // across a warm floor.
  // Cloud takes the sun first: under a full overcast the direct key is a
  // trace and its shadows go soft (the sky term, which the world's fill
  // already raises under cloud, lights the room instead). sunVisibility is
  // the cinema environment's own (1 - overcast)^2 (1 - fog).
  const sunVis = env && Number.isFinite(env.sunVisibility) ? env.sunVisibility : 1;
  const keyGain = (1 - 0.8 * night) * (0.12 + 0.88 * sunVis);
  L.set(0.88, 1.15 * (1 - 0.45 * night), keyI > 0.001 ? keyGain : 0, practical);
  // The sun's disc subtends ~0.53 deg (0.0047 rad); a veiled sun reads as a
  // much larger soft source.
  uniforms.uLoungeKeySoft.value = 0.0047 + 0.07 * (1 - sunVis);
  // Bounce: the sun patch and the skylight, re-reflected by a warm room.
  const key = uniforms.uLoungeKey.value;
  const sunIn = keyI * (Math.max(0, key.y) * 0.55 + Math.max(0, -key.z) * 0.45) * (1 - overcast * 0.6);
  const skyIn = (env ? env.environment : 0.6) * (0.55 + 0.45 * day) + (env ? env.fill : 0.16);
  const b = (sunIn * 0.028 + skyIn * 0.11) * (0.25 + 0.75 * day);
  const warm = env ? env.keyColor : [1, 0.95, 0.85];
  // Night: the practicals' own flux bounced around the room.
  const nb = practical * (1 - day) * 0.075;
  uniforms.uLoungeBounce.value.set(b * (0.6 + 0.4 * warm[0]) + nb, b * (0.6 + 0.4 * warm[1]) + nb * 0.72, b * (0.62 + 0.38 * warm[2]) + nb * 0.46);
  const rr = uniforms.uLoungeBounce.value;
  uniforms.uLoungeRoomRad.value.set(rr.x * 0.16, rr.y * 0.16, rr.z * 0.16);
  uniforms.uLoungeTime.value = state.time ?? 0;
  out.day = day; out.night = night; out.golden = golden; out.practical = practical; out.keyI = keyI;
  return out;
}

export { GLSL_CONST as LOUNGE_GLSL_CONST, GLSL_FUNCS as LOUNGE_GLSL_FUNCS };
