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
  DataTexture,
  DoubleSide,
  FloatType,
  Matrix3,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NearestFilter,
  RGBAFormat,
  Vector3,
  Vector4,
} from 'three';
import { SURF, GLOW } from './room-build.js';
import {
  CANT, SILL_Y, HEAD_Y, HALF_X, HEAD_Z, ROOF_Z1, SIDE_Z1, BACK_Z, PITCH, MULLION_HALF, MULLION_DEPTH,
  SIDE_MULLION_Z, APERTURE, HEAD_DEPTH, FASCIA_DEPTH, FASCIA_DROP, DECK_Y, BAFFLE, ART_RECT, frontZ, roomVariant,
} from './room-plan.js';
import { FLOOR_RECT, UPPER_FLOOR_RECT } from './room-ao.js';
import { CHART_PANELS } from './upper-dressing.mjs';

export const MAX_LIGHTS = 32;
export const MAX_SHADOWS = 48;
/**
 * The fixture table: one small float texture read with texelFetch instead of
 * 224 vec4 uniforms (WebGL2 only guarantees 224 fragment uniform vectors, and
 * three's own lighting needs its share). Row i: light i in columns 0-3
 * (A position/range, B colour*power/channel, C axis/type, D cone|segment end),
 * shadow box i in columns 4-5 (A centre/yaw, B half extents/opacity).
 */
export const FIXTURE_TABLE = Object.freeze({ width: 6, height: Math.max(MAX_LIGHTS, MAX_SHADOWS) });

const f = (v) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/**
 * Replace one exact piece of shader text, or throw. Every pier-only rewrite
 * goes through this: an un-asserted String.replace that misses its anchor
 * silently ships the old shader (FLY_ROUND24.md, the three-import incident).
 */
function swap(src, from, to) {
  if (!src.includes(from)) throw new Error(`lounge shading: pier rewrite anchor missing: ${from.slice(0, 60)}`);
  return src.replace(from, () => to);
}

/**
 * Second-level pass (FLY_LOUNGE_SECOND_LEVEL.md, W0 contract): what each new
 * pier-only surface code renders as. An unimplemented code matches no branch,
 * so it shades exactly as PLAIN: the vertex colour, the bucket's map, the
 * interior light model; an entry starting 'IMPLEMENTED' has a pier branch.
 * The defines are emitted into the PIER program only (PIER_SURF_DEFINES), so
 * the classic program's source is untouched.
 */
export const SURF_FALLBACK = Object.freeze({
  [SURF.UPPER_FLOOR]: 'IMPLEMENTED (pier): 0.18 m oak boards in random lengths, staggered joints, each board its own patch of the oak map; joints drawn at pixel coverage and faded to their mean before they alias',
  [SURF.CHART]: 'IMPLEMENTED (pier): the nearest CHART_PANELS print, a muted sectional or an approach plate by its kind and seed; every line filtered',
  [SURF.SPINES]: 'IMPLEMENTED (pier): each book its cover (vertex) colour with a filtered cloth grain; no bands or titles (book extents are not in the contract)',
  [SURF.EXTERIOR]: 'IMPLEMENTED (pier): outdoors under the world key (shadowed by the upper room and the stairwell enclosure), the open sky and the IBL; no glass, practicals or bounce. Anything above the deck beyond the upper glazing shades the same way whatever its flag.',
});
const PIER_SURF_DEFINES = `#define SURF_UPPER_FLOOR ${SURF.UPPER_FLOOR}
#define SURF_CHART ${SURF.CHART}
#define SURF_SPINES ${SURF.SPINES}
#define SURF_EXTERIOR ${SURF.EXTERIOR}
`;

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
// Fixture table (FIXTURE_TABLE). Light row i, columns:
//   0: xyz position / segment start, w range
//   1: rgb colour * power, w glow channel
//   2: xyz spot axis / line normal, w type (0 point, 1 spot, 2 line, -1 end of list)
//   3: spot: x cos outer, y cos inner, z occluding disc height, w its radius; line: xyz segment end
// Shadow box row i, columns 4: centre xyz, w yaw; 5: half extents xyz, w opacity (0 = end).
uniform highp sampler2D uLoungeFix;
uniform float uLoungeGlow[ 8 ];
uniform sampler2D uLoungeFloorAO;
uniform vec4 uLoungeFloorRect;  // x0, z0, 1/w, 1/d
uniform float uLoungeTime;
uniform float uLoungeFade;      // binocular defocus: 0 = the room, 1 = gone
uniform float uLoungeKeySoft;   // sun-disc penumbra per metre (widens as cloud diffuses the sun)
`;

// The pier program's glow table carries the upper room's own channels
// (GLOW.READING, GLOW.DISPLAY); the classic program keeps its eight.
export const GLOW_CHANNELS = Object.freeze({ classic: 8, pier: 10 });
// The pier bar's centre along the right wall (its onyx panel's own origin).
const PIER_BAR_ZC = (roomVariant('pier').bar.z0 + roomVariant('pier').bar.z1) / 2;
const GLSL_UNIFORMS_PIER = swap(GLSL_UNIFORMS, 'uniform float uLoungeGlow[ 8 ];', `uniform float uLoungeGlow[ ${GLOW_CHANNELS.pier} ];`);

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
#ifdef LG_UPPER_ROOM
// Nearest real shell boundary, shared with the two-level room contract. A
// single convex-room exit test cannot represent a stairwell and a mezzanine:
// the intermediate deck must occlude both light and environment reflections.
void lgHit( inout float nearest, inout float vis, float t, float value ) {
  if ( t > 0.006 && t < nearest ) { nearest = t; vis = value; }
}
bool lgInside( float a, float lo, float hi ) { return a >= lo - 0.001 && a <= hi + 0.001; }
float lgPierAperture( vec3 p, vec3 d, float softK, float softMin ) {
  float nearest = 1e5, vis = 0.0, t, s, v;
  vec3 q;
  // Lower canted curtain wall.
  float denom = d.z + d.y * LG_CANT;
  if ( abs( denom ) > 1e-6 ) {
    t = ( LG_C0 - p.z - p.y * LG_CANT ) / denom; q = p + d * t; s = softMin + max( t, 0.0 ) * softK;
    if ( lgInside( q.x, -LG_HALF_X, LG_HALF_X ) && lgInside( q.y, 0.0, LG_HEAD_Y ) ) {
      v = lgBand( q.y, LG_Y0, LG_Y1, s ) * lgBand( q.x, -LG_HALF_X + 0.07, LG_HALF_X - 0.07, s );
      v *= lgFins( q.x - d.x * LG_FIN_DEPTH, q.x, s ); lgHit( nearest, vis, t, v );
    }
  }
  if ( abs( d.y ) > 1e-6 ) {
    t = ( LG_HEAD_Y - p.y ) / d.y; q = p + d * t; s = softMin + max( t, 0.0 ) * softK;
    bool hole = q.x < LG_WELL_X1 && lgInside( q.z, LG_WELL_Z0, LG_STAIR_Z1 );
    if ( !hole && lgInside( q.x, -LG_HALF_X, LG_HALF_X ) && lgInside( q.z, LG_HEAD_Z, LG_BACK_Z ) ) {
      v = lgBand( q.z, LG_RZ0, LG_RZ1, s ) * lgBand( q.x, -LG_HALF_X + 0.09, LG_HALF_X - 0.09, s );
      v *= lgFins( q.x - d.x * LG_FIN_DEPTH, q.x, s ); lgHit( nearest, vis, t, v );
    }
    t = -p.y / d.y; q = p + d * t;
    if ( lgInside( q.x, -LG_HALF_X, LG_HALF_X ) && lgInside( q.z, LG_C0, LG_BACK_Z ) ) lgHit( nearest, vis, t, 0.0 );
    t = ( LG_UPPER_ROOF - p.y ) / d.y; q = p + d * t;
    bool top = lgInside( q.x, -LG_HALF_X, LG_HALF_X ) && lgInside( q.z, LG_UPPER_FRONT, LG_BACK_Z );
    bool well = lgInside( q.x, -LG_HALF_X, LG_WELL_X1 ) && lgInside( q.z, LG_WELL_Z0, LG_UPPER_FRONT );
    if ( top || well ) lgHit( nearest, vis, t, 0.0 );
  }
  if ( abs( d.x ) > 1e-6 ) {
    for ( int side = -1; side <= 1; side += 2 ) {
      t = ( float( side ) * LG_HALF_X - p.x ) / d.x; q = p + d * t; s = softMin + max( t, 0.0 ) * softK;
      if ( lgInside( q.y, 0.0, LG_HEAD_Y ) && lgInside( q.z, LG_C0 - q.y * LG_CANT, LG_BACK_Z ) ) {
        v = lgBand( q.y, LG_Y0, LG_Y1, s ) * ( 1.0 - smoothstep( LG_SZ1 - s, LG_SZ1 + s, q.z ) );
        v *= smoothstep( LG_FIN - s, LG_FIN + s, abs( q.z - LG_SIDE_FIN_Z ) ); lgHit( nearest, vis, t, v );
      }
      if ( lgInside( q.y, LG_UPPER_FLOOR, LG_UPPER_ROOF ) && lgInside( q.z, side < 0 ? LG_WELL_Z0 : LG_UPPER_FRONT, LG_BACK_Z ) ) {
        v = side < 0 ? 0.0 : lgBand( q.y, LG_UPPER_Y0, LG_UPPER_Y1, s ) * lgBand( q.z, LG_UPPER_FRONT + 0.1, LG_BACK_Z - 0.1, s );
        lgHit( nearest, vis, t, v );
      }
    }
    t = ( LG_WELL_X1 - p.x ) / d.x; q = p + d * t;
    if ( lgInside( q.z, LG_WELL_Z0, LG_UPPER_FRONT ) && lgInside( q.y, LG_UPPER_FLOOR, LG_UPPER_ROOF ) ) lgHit( nearest, vis, t, 0.0 );
  }
  if ( abs( d.z ) > 1e-6 ) {
    t = ( LG_BACK_Z - p.z ) / d.z; q = p + d * t; s = softMin + max( t, 0.0 ) * softK;
    if ( lgInside( q.x, -LG_HALF_X, LG_HALF_X ) && lgInside( q.y, 0.0, LG_UPPER_ROOF ) ) {
      if ( q.y < LG_UPPER_FLOOR ) v = lgBand( q.x, -LG_BACK_HALF, LG_BACK_HALF, s ) * lgBand( q.y, LG_BACK_Y0, LG_BACK_Y1, s );
      else v = lgBand( q.x, -LG_HALF_X + 0.1, LG_HALF_X - 0.1, s ) * lgBand( q.y, LG_UPPER_Y0, LG_UPPER_Y1, s );
      v *= lgFins( q.x - d.x * LG_FIN_DEPTH, q.x, s ); lgHit( nearest, vis, t, v );
    }
    t = ( LG_UPPER_FRONT - p.z ) / d.z; q = p + d * t; s = softMin + max( t, 0.0 ) * softK;
    if ( lgInside( q.x, LG_WELL_X1, LG_HALF_X ) && lgInside( q.y, LG_UPPER_FLOOR, LG_UPPER_ROOF ) ) {
      v = lgBand( q.x, LG_WELL_X1 + 0.1, LG_HALF_X - 0.1, s ) * lgBand( q.y, LG_UPPER_Y0, LG_UPPER_Y1, s );
      v *= lgFins( q.x - d.x * LG_FIN_DEPTH, q.x, s ); lgHit( nearest, vis, t, v );
    }
    t = ( LG_WELL_Z0 - p.z ) / d.z; q = p + d * t;
    if ( lgInside( q.x, -LG_HALF_X, LG_WELL_X1 ) && lgInside( q.y, LG_UPPER_FLOOR, LG_UPPER_ROOF ) ) lgHit( nearest, vis, t, 0.0 );
  }
  // The closed stair plinth is a solid wedge, never a translucent staircase.
  float slope = LG_UPPER_FLOOR / ( LG_STAIR_Z1 - LG_STAIR_Z0 );
  float dd = d.y - slope * d.z;
  if ( abs( dd ) > 1e-6 ) {
    t = ( slope * ( p.z - LG_STAIR_Z0 ) - p.y ) / dd; q = p + d * t;
    if ( lgInside( q.x, LG_STAIR_X0, LG_STAIR_X1 ) && lgInside( q.z, LG_STAIR_Z0, LG_STAIR_Z1 ) ) lgHit( nearest, vis, t, 0.0 );
  }
  if ( abs( d.x ) > 1e-6 ) for ( int side = 0; side < 2; side++ ) {
    t = ( ( side == 0 ? LG_STAIR_X0 : LG_STAIR_X1 ) - p.x ) / d.x; q = p + d * t;
    if ( lgInside( q.z, LG_STAIR_Z0, LG_STAIR_Z1 ) && lgInside( q.y, 0.0, slope * ( q.z - LG_STAIR_Z0 ) ) ) lgHit( nearest, vis, t, 0.0 );
  }
  return vis;
}
#endif
// How much of a ray from p along unit d leaves the room through glass (0..1).
// soft = penumbra half-width (metres) per metre travelled.
float lgAperture( vec3 p, vec3 d, float softK, float softMin ) {
  #ifdef LG_UPPER_ROOM
  return lgPierAperture( p, d, softK, softMin );
  #else
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
  #ifdef LG_BACK_GLAZED
  if ( t == tB ) {
    vis = lgBand( q.x, -LG_BACK_HALF, LG_BACK_HALF, s ) * lgBand( q.y, LG_BACK_Y0, LG_BACK_Y1, s );
    float tIn = max( ( LG_BACK_Z - LG_FIN_DEPTH - p.z ) / d.z, 0.0 );
    vis *= lgFins( p.x + d.x * tIn, q.x, s );
  }
  #endif
  if ( vis > 0.0 ) {
    // The head transom and the fascia beam hang inside the room.
    vis *= lgBoxClear( p, d, vec3( -LG_HALF_X, LG_HEAD_Y - 0.17, LG_HEAD_Z ), vec3( LG_HALF_X, LG_HEAD_Y + 0.01, LG_HEAD_Z + LG_HEAD_DEPTH ), t, s );
    vis *= lgBoxClear( p, d, vec3( -LG_HALF_X, LG_HEAD_Y - LG_FASCIA_DROP, LG_ROOF_Z1 ), vec3( LG_HALF_X, LG_HEAD_Y + 0.01, LG_ROOF_Z1 + LG_FASCIA_DEPTH ), t, s );
  }
  return vis;
  #endif
}
// Soft shadows from oriented furniture boxes along the key direction.
float lgFurniture( vec3 p, vec3 L, float softMin ) {
  float vis = 1.0;
  for ( int i = 0; i < LG_SHADOWS; i ++ ) {
    vec4 B = texelFetch( uLoungeFix, ivec2( 5, i ), 0 );
    if ( B.w <= 0.0 ) break;
    vec4 A = texelFetch( uLoungeFix, ivec2( 4, i ), 0 );
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
  #ifdef LG_UPPER_ROOM
  if ( p.y >= LG_UPPER_FLOOR - 0.01 ) {
    float upperFF = lgQuadFF( p, n, vec3( LG_WELL_X1, LG_UPPER_Y1, LG_UPPER_FRONT ), vec3( LG_HALF_X, LG_UPPER_Y1, LG_UPPER_FRONT ), vec3( LG_HALF_X, LG_UPPER_Y0, LG_UPPER_FRONT ), vec3( LG_WELL_X1, LG_UPPER_Y0, LG_UPPER_FRONT ) );
    upperFF += lgQuadFF( p, n, vec3( LG_HALF_X, LG_UPPER_Y1, LG_BACK_Z ), vec3( -LG_HALF_X, LG_UPPER_Y1, LG_BACK_Z ), vec3( -LG_HALF_X, LG_UPPER_Y0, LG_BACK_Z ), vec3( LG_HALF_X, LG_UPPER_Y0, LG_BACK_Z ) );
    upperFF += lgQuadFF( p, n, vec3( LG_HALF_X, LG_UPPER_Y1, LG_UPPER_FRONT ), vec3( LG_HALF_X, LG_UPPER_Y1, LG_BACK_Z ), vec3( LG_HALF_X, LG_UPPER_Y0, LG_BACK_Z ), vec3( LG_HALF_X, LG_UPPER_Y0, LG_UPPER_FRONT ) );
    return min( upperFF, 1.0 ) * 0.94;
  }
  #endif
  vec3 tl = vec3( -LG_HALF_X, LG_Y1, lgZF( LG_Y1 ) ), tr = vec3( LG_HALF_X, LG_Y1, lgZF( LG_Y1 ) );
  vec3 bl = vec3( -LG_HALF_X, LG_Y0, lgZF( LG_Y0 ) ), br = vec3( LG_HALF_X, LG_Y0, lgZF( LG_Y0 ) );
  float ff = lgQuadFF( p, n, tl, tr, br, bl );
  ff += lgQuadFF( p, n, vec3( -LG_HALF_X, LG_HEAD_Y, LG_RZ1 ), vec3( LG_HALF_X, LG_HEAD_Y, LG_RZ1 ), vec3( LG_HALF_X, LG_HEAD_Y, LG_RZ0 ), vec3( -LG_HALF_X, LG_HEAD_Y, LG_RZ0 ) );
  ff += lgQuadFF( p, n, bl, vec3( -LG_HALF_X, LG_Y0, LG_SZ1 ), vec3( -LG_HALF_X, LG_Y1, LG_SZ1 ), tl );
  ff += lgQuadFF( p, n, tr, vec3( LG_HALF_X, LG_Y1, LG_SZ1 ), vec3( LG_HALF_X, LG_Y0, LG_SZ1 ), br );
  #ifdef LG_BACK_GLAZED
  ff += lgQuadFF( p, n, vec3( LG_BACK_HALF, LG_BACK_Y1, LG_BACK_Z ), vec3( -LG_BACK_HALF, LG_BACK_Y1, LG_BACK_Z ), vec3( -LG_BACK_HALF, LG_BACK_Y0, LG_BACK_Z ), vec3( LG_BACK_HALF, LG_BACK_Y0, LG_BACK_Z ) );
  #endif
  // the fins and beams take ~6% of the glazed area
  return min( ff, 1.0 ) * 0.94;
}
// Analytic occlusion of the shell: wall/floor/ceiling junctions and corners,
// and the cavities between ceiling baffles.
float lgShellAO( vec3 p, vec3 n, int flag ) {
  float base = 0.0, ceilingY = LG_HEAD_Y;
  #ifdef LG_UPPER_ROOM
  if ( p.y >= LG_UPPER_FLOOR - 0.01 ) { base = LG_UPPER_FLOOR; ceilingY = LG_UPPER_ROOF; }
  #endif
  if ( p.y - base < 0.03 ) return 1.0; // the floor has its baked map
  float vy = 1.0 - abs( n.y ), vx = 1.0 - abs( n.x ), vz = 1.0 - abs( n.z );
  float ao = 1.0;
  ao *= 1.0 - 0.38 * exp( -max( p.y - base, 0.0 ) / 0.28 ) * vy;
  ao *= 1.0 - 0.32 * exp( -max( ceilingY - p.y, 0.0 ) / 0.45 ) * vy;
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
  float y = p.y;
  #ifdef LG_UPPER_ROOM
  bool upper = p.y >= LG_UPPER_FLOOR - 0.01;
  if ( upper ) { uv = ( p.xz - vec2( -LG_HALF_X, LG_UPPER_FRONT ) ) / vec2( LG_HALF_X * 2.0, LG_BACK_Z - LG_UPPER_FRONT ); y -= LG_UPPER_FLOOR; }
  #endif
  float near = ( 1.0 - smoothstep( 0.02, 0.07, abs( y ) ) ) * step( 0.0, uv.x ) * step( uv.x, 1.0 ) * step( 0.0, uv.y ) * step( uv.y, 1.0 );
  #ifdef LG_UPPER_ROOM
  uv.y = upper ? ${f(UPPER_FLOOR_RECT.h / (FLOOR_RECT.h + UPPER_FLOOR_RECT.h))} * uv.y + ${f(FLOOR_RECT.h / (FLOOR_RECT.h + UPPER_FLOOR_RECT.h))} : ${f(FLOOR_RECT.h / (FLOOR_RECT.h + UPPER_FLOOR_RECT.h))} * uv.y;
  #endif
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

// ---- Pier surface detail: boards, chart prints, book spines -------------
// Every line here is drawn at its true pixel coverage (lgLine) and every
// pattern fades to its own mean tone before its spacing nears a pixel, so
// nothing turns to moire at grazing angles or from across the room: the
// owner reported exactly that from the rug and the stair wall.
const chartRow = (c) => `vec4( ${f(c.zc)}, ${f(c.yc)}, ${c.kind === 'approach' ? '1.0' : '0.0'}, ${f(c.seed)} )`;
const PIER_DETAIL = /* glsl */ `
// A line w metres wide at distance d (m), seen with a pixel footprint px (m):
// crisp while it is wider than a pixel; once thinner, one pixel wide at its
// true coverage.
float lgLine( float d, float w, float px ) {
  px = max( px, 1e-5 );
  float W = max( w, px );
  return ( 1.0 - smoothstep( 0.5 * ( W - px ), 0.5 * ( W + px ), d ) ) * min( 1.0, w / px );
}
// A line pattern of spacing S: the line while S spans several pixels, its
// mean coverage w / S once it would not.
float lgLines( float d, float w, float S, float px ) {
  return mix( w / S, lgLine( d, w, px ), 1.0 - smoothstep( 0.12 * S, 0.3 * S, px ) );
}
bool lgJoint( float row, float j, float p ) {
  return mod( j, 4.0 ) < 0.5 || lgHash( vec2( row * 1.37 + 0.5, j * 0.71 + 3.1 ) ) < p;
}
// Boards: x runs along the grain, rows 'width' wide across y; end joints fall
// on 'module' steps with probability p (always every fourth step) and each
// row is shifted by a hashed offset, so lengths vary and joints stagger.
// Returns the board's id (row, its left joint); dist = metres to the
// nearest end joint (x) and long joint (y).
vec2 lgBoards( vec2 q, float width, float module, float p, out vec2 dist ) {
  float row = floor( q.y / width ), fy = fract( q.y / width );
  dist.y = min( fy, 1.0 - fy ) * width;
  float x = q.x / module + lgHash( vec2( row, 11.3 ) ) * 4.0;
  float k = floor( x ), left = k;
  for ( int i = 0; i < 4; i ++ ) { left = k - float( i ); if ( lgJoint( row, left, p ) ) break; }
  float dr = lgJoint( row, k + 1.0, p ) ? ( k + 1.0 - x ) * module : 1e3;
  dist.x = min( ( x - left ) * module, dr );
  return vec2( row, left );
}
// Rows of printed text inside [lo, hi] (m): dashes for words close up, a grey
// rule per line from further away.
float lgText( vec2 c, vec2 lo, vec2 hi, float pitch, float seed, float px ) {
  if ( any( lessThan( c, lo ) ) || any( greaterThan( c, hi ) ) ) return 0.0;
  vec2 q = c - lo;
  float row = floor( q.y / pitch );
  float rowLen = ( hi.x - lo.x ) * ( 0.45 + 0.55 * lgHash( vec2( row, seed ) ) );
  if ( q.x > rowLen ) return 0.0;
  float cw = pitch * 0.55;
  float cell = floor( q.x / cw );
  float word = step( 0.16, lgHash( vec2( floor( cell / 5.0 + lgHash( vec2( row, seed + 2.0 ) ) ), row + seed ) ) );
  float glyph = step( 0.12, lgHash( vec2( cell, row + seed * 3.1 ) ) ) * word;
  float gx = abs( fract( q.x / cw ) - 0.5 ) * cw;
  float dash = mix( 0.5, glyph * lgLine( gx, cw * 0.7, px ), 1.0 - smoothstep( cw * 0.3, cw * 0.7, px ) );
  return lgLine( abs( fract( q.y / pitch ) - 0.5 ) * pitch, pitch * 0.42, px ) * dash;
}
float lgBoxLine( vec2 c, vec2 lo, vec2 hi, float w, float px ) {
  vec2 h = 0.5 * ( hi - lo ), d = abs( c - 0.5 * ( lo + hi ) ) - h;
  return lgLine( abs( length( max( d, 0.0 ) ) + min( max( d.x, d.y ), 0.0 ) ), w, px );
}
float lgSeg( vec2 c, vec2 a, vec2 b, float w, float px ) {
  vec2 ab = b - a;
  float t = clamp( dot( c - a, ab ) / dot( ab, ab ), 0.0, 1.0 );
  return lgLine( length( c - a - ab * t ), w, px );
}
// The four stair-wall prints (upper-dressing.mjs CHART_PANELS): zc, yc, kind
// (0 sectional, 1 approach plate), seed.
const vec4 LG_CHARTS[ ${CHART_PANELS.length} ] = vec4[ ${CHART_PANELS.length} ]( ${CHART_PANELS.map(chartRow).join(', ')} );
#define LG_CHART_W ${f(CHART_PANELS[0].w)}
#define LG_CHART_H ${f(CHART_PANELS[0].h)}
// A muted VFR sectional: tinted relief with contours, water, two airways, an
// aerodrome and a compass rose. c = metres from the print's lower-left as
// seen (x to the viewer's right).
vec3 lgSectional( vec2 c, float seed, float px, vec3 paper ) {
  vec2 s = c * 6.5 + seed * 7.31;
  float e = lgNoise( s ) * 0.52 + lgNoise( s * 2.3 + 5.1 ) * 0.3 + lgNoise( s * 5.3 + 1.7 ) * 0.12 + lgNoise( s * 11.0 + 9.2 ) * 0.06;
  float de = max( fwidth( e ), 1e-5 ), toM = px / de; // elevation units -> metres on the print
  vec3 col = paper * vec3( 0.84, 0.91, 0.79 );
  col = mix( col, paper * vec3( 0.97, 0.92, 0.79 ), smoothstep( 0.5 - de, 0.5 + de, e ) );
  col = mix( col, paper * vec3( 0.9, 0.81, 0.69 ), smoothstep( 0.63 - de, 0.63 + de, e ) );
  col = mix( col, paper * vec3( 0.72, 0.85, 0.94 ), 1.0 - smoothstep( 0.31 - de, 0.31 + de, e ) );
  vec3 brown = vec3( 0.55, 0.42, 0.3 ), blue = vec3( 0.25, 0.42, 0.62 ), magenta = vec3( 0.58, 0.3, 0.5 );
  float contour = max( max( lgLine( abs( e - 0.5 ) * toM, 0.0006, px ), lgLine( abs( e - 0.63 ) * toM, 0.0006, px ) ), lgLine( abs( e - 0.565 ) * toM, 0.0004, px ) * 0.6 );
  col = mix( col, brown, contour * 0.6 );
  col = mix( col, blue, lgLine( abs( e - 0.31 ) * toM, 0.0007, px ) * 0.7 );
  // two airways through an aerodrome
  vec2 ap = vec2( 0.18 + 0.44 * lgHash( vec2( seed, 1.0 ) ), 0.16 + 0.24 * lgHash( vec2( seed, 2.0 ) ) );
  for ( int i = 0; i < 2; i ++ ) {
    float ang = 6.2831853 * lgHash( vec2( seed, 3.0 + float( i ) ) );
    vec2 dir = vec2( cos( ang ), sin( ang ) );
    col = mix( col, blue, lgLine( abs( dot( c - ap, vec2( -dir.y, dir.x ) ) ), 0.0012, px ) * 0.65 );
  }
  float r = length( c - ap );
  float field = max( lgLine( abs( r - 0.011 ), 0.0012, px ), lgSeg( c, ap - vec2( 0.0, 0.007 ), ap + vec2( 0.0, 0.007 ), 0.0016, px ) );
  col = mix( col, magenta, field * 0.85 );
  // compass rose: ring, ticks every 10 degrees (longer every 30), north up
  vec2 cr = vec2( 0.6 - 0.36 * step( 0.5, lgHash( vec2( seed, 9.0 ) ) ), 0.3 ) + ( vec2( lgHash( vec2( seed, 5.0 ) ), lgHash( vec2( seed, 6.0 ) ) ) - 0.5 ) * 0.08;
  vec2 v = c - cr;
  float rr = length( v ), R = 0.085;
  float rose = lgLine( abs( rr - R ), 0.0011, px ) + lgLine( abs( rr - R * 0.62 ), 0.0008, px ) * 0.7;
  float a = atan( v.x, v.y ) / 6.2831853 * 36.0;
  float tick = min( fract( a ), 1.0 - fract( a ) ) * 6.2831853 * rr / 36.0;
  float major = step( mod( floor( a + 0.5 ), 3.0 ), 0.5 );
  rose += lgLines( tick, 0.0008, 6.2831853 * max( rr, 1e-3 ) / 36.0, px ) * step( R - mix( 0.007, 0.013, major ), rr ) * step( rr, R );
  rose += lgSeg( c, cr - vec2( 0.0, R ), cr + vec2( 0.0, R * 1.18 ), 0.0011, px ) + lgSeg( c, cr - vec2( R, 0.0 ), cr + vec2( R, 0.0 ), 0.0008, px ) * 0.7;
  col = mix( col, vec3( 0.2, 0.33, 0.52 ), min( rose, 1.0 ) * 0.8 );
  // neatline and the legend strip
  col = mix( col, vec3( 0.2 ), lgBoxLine( c, vec2( 0.012 ), vec2( LG_CHART_W, LG_CHART_H ) - 0.012, 0.0008, px ) * 0.7 );
  col = mix( col, vec3( 0.22, 0.24, 0.28 ), lgText( c, vec2( 0.03, 0.02 ), vec2( 0.42, 0.036 ), 0.0055, seed, px ) * 0.75 );
  return col;
}
// An instrument approach plate: header, plan view with the final course, a
// racetrack hold and the 10 NM ring, the descent profile and minimums.
vec3 lgApproachPlate( vec2 c, float seed, float px, vec3 paper ) {
  float ink = 0.0;
  vec2 m = vec2( 0.016 );
  float fadeDash = 1.0 - smoothstep( 0.001, 0.003, px );
  ink = max( ink, lgBoxLine( c, m, vec2( LG_CHART_W, LG_CHART_H ) - m, 0.0012, px ) );
  ink = max( ink, lgSeg( c, vec2( 0.016, 0.49 ), vec2( 0.784, 0.49 ), 0.0009, px ) );
  ink = max( ink, lgSeg( c, vec2( 0.505, 0.016 ), vec2( 0.505, 0.49 ), 0.0009, px ) );
  ink = max( ink, lgSeg( c, vec2( 0.505, 0.2 ), vec2( 0.784, 0.2 ), 0.0009, px ) );
  ink = max( ink, lgText( c, vec2( 0.03, 0.502 ), vec2( 0.4, 0.536 ), 0.0062, seed, px ) * 0.9 );
  ink = max( ink, lgText( c, vec2( 0.55, 0.502 ), vec2( 0.77, 0.536 ), 0.0062, seed + 4.0, px ) * 0.9 );
  // plan view
  vec2 ctr = vec2( 0.26, 0.25 );
  float ang = 6.2831853 * lgHash( vec2( seed, 11.0 ) );
  vec2 dir = vec2( cos( ang ), sin( ang ) ), nrm = vec2( -dir.y, dir.x );
  ink = max( ink, lgLine( abs( length( c - ctr ) - 0.19 ), 0.0007, px ) * 0.8 );
  ink = max( ink, lgSeg( c, ctr - dir * 0.017, ctr + dir * 0.017, 0.0045, px ) );
  ink = max( ink, lgSeg( c, ctr - dir * 0.017, ctr - dir * 0.2, 0.0011, px ) );
  for ( int i = 0; i < 2; i ++ ) {
    vec2 fx = ctr - dir * ( 0.07 + 0.065 * float( i ) );
    vec2 q = c - fx;
    float tri = max( abs( dot( q, nrm ) ) * 1.15 + dot( q, dir ) * 0.5, -dot( q, dir ) ) - 0.004;
    ink = max( ink, lgLine( abs( tri ), 0.0007, px ) );
    ink = max( ink, lgText( c, fx + nrm * 0.012, fx + nrm * 0.012 + vec2( 0.05, 0.008 ), 0.0042, seed + float( i ) * 5.0, px ) * 0.85 );
  }
  // the hold at the outer fix, on the left of the course
  vec2 h0 = ctr - dir * 0.135 + nrm * 0.016, h1 = h0 - dir * 0.05;
  ink = max( ink, lgSeg( c, h0 + nrm * 0.016, h1 + nrm * 0.016, 0.0008, px ) );
  ink = max( ink, lgSeg( c, h0 - nrm * 0.016, h1 - nrm * 0.016, 0.0008, px ) );
  ink = max( ink, lgLine( abs( length( c - h0 ) - 0.016 ), 0.0008, px ) * step( 0.0, dot( c - h0, dir ) ) );
  ink = max( ink, lgLine( abs( length( c - h1 ) - 0.016 ), 0.0008, px ) * step( 0.0, -dot( c - h1, dir ) ) );
  // profile: ground, the descent with two step-downs, the missed approach
  ink = max( ink, lgSeg( c, vec2( 0.52, 0.24 ), vec2( 0.77, 0.24 ), 0.0011, px ) );
  ink = max( ink, lgSeg( c, vec2( 0.53, 0.44 ), vec2( 0.62, 0.44 ), 0.0011, px ) );
  ink = max( ink, lgSeg( c, vec2( 0.62, 0.44 ), vec2( 0.68, 0.38 ), 0.0011, px ) );
  ink = max( ink, lgSeg( c, vec2( 0.68, 0.38 ), vec2( 0.75, 0.26 ), 0.0011, px ) );
  float dash = step( 0.5, fract( c.y / 0.008 ) );
  ink = max( ink, lgSeg( c, vec2( 0.62, 0.24 ), vec2( 0.62, 0.44 ), 0.0006, px ) * mix( 0.5, dash, fadeDash ) );
  ink = max( ink, lgSeg( c, vec2( 0.68, 0.24 ), vec2( 0.68, 0.38 ), 0.0006, px ) * mix( 0.5, dash, fadeDash ) );
  ink = max( ink, lgSeg( c, vec2( 0.75, 0.26 ), vec2( 0.77, 0.4 ), 0.0008, px ) * mix( 0.5, step( 0.5, fract( ( c.x + c.y ) / 0.01 ) ), fadeDash ) );
  ink = max( ink, lgText( c, vec2( 0.53, 0.45 ), vec2( 0.66, 0.475 ), 0.0048, seed + 9.0, px ) * 0.85 );
  // minimums table
  for ( int i = 1; i < 4; i ++ ) ink = max( ink, lgSeg( c, vec2( 0.505, 0.016 + 0.046 * float( i ) ), vec2( 0.784, 0.016 + 0.046 * float( i ) ), 0.0006, px ) );
  ink = max( ink, lgText( c, vec2( 0.52, 0.03 ), vec2( 0.77, 0.19 ), 0.0115, seed + 13.0, px ) * 0.8 );
  return mix( paper * vec3( 1.0, 1.0, 0.985 ), vec3( 0.12, 0.12, 0.14 ), min( ink, 1.0 ) * 0.9 );
}
// Book spines: one cover colour per book (the vertex colour), a slight
// per-book tone hashed from it and a cloth grain that fades out before it
// goes sub-pixel. (Book extents are not in the contract: no bands or titles.)
vec3 lgSpine( vec3 p, vec3 cover, float px ) {
  float id = lgHash( cover.rg * 97.0 + cover.b * 13.0 );
  float grain = lgNoise( vec2( p.z, p.y ) * 260.0 ) * ( 1.0 - smoothstep( 0.0006, 0.002, px ) );
  return cover * ( 0.94 + 0.12 * grain ) * ( 1.0 - 0.04 * id );
}
`;

// The pier program's copy of the helpers (the classic program keeps the text
// above byte for byte). The derivative bump can be handed an exactly zero
// vector (det = 0 and no gradient: SwiftShader produced it on wood and stone
// quads), and normalize(0) is NaN — which the interior probe then captured
// into every night reflection. A degenerate bump keeps the surface normal.
const GLSL_FUNCS_PIER = swap(GLSL_FUNCS, '  return normalize( abs( det ) * surfNorm - grad );', `  vec3 lgBn = abs( det ) * surfNorm - grad;
  float lgBl = dot( lgBn, lgBn );
  return lgBl > 1e-30 && lgBl < 1e30 ? lgBn * inversesqrt( lgBl ) : surfNorm;`) + /* glsl */ `
// ---- EXTERIOR (pier): the lower roof and the stairwell's outer skin, seen
// from upstairs through the glass, stand under the open sky. ----
// A ray against an axis-aligned box: x = entry t, y = exit t (no hit: x > y).
vec2 lgSlab( vec3 p, vec3 d, vec3 lo, vec3 hi ) {
  vec3 dd = mix( d, vec3( 1e-6 ), lessThan( abs( d ), vec3( 1e-6 ) ) );
  vec3 t0 = ( lo - p ) / dd, t1 = ( hi - p ) / dd;
  vec3 tn = min( t0, t1 ), tf = max( t0, t1 );
  return vec2( max( max( tn.x, tn.y ), max( tn.z, 0.0 ) ), min( min( tf.x, tf.y ), tf.z ) );
}
// The key outdoors: the stairwell enclosure is solid; the upper room is a
// glass box (front, back and east glazed between its sill and head, two panes
// and the fins pass ~70 %), its floor slab, roof and the solid west end are not.
float lgExtKey( vec3 p, vec3 L ) {
  float k = lgBoxClear( p, L, vec3( -LG_HALF_X - 0.1, LG_UPPER_FLOOR, LG_WELL_Z0 - 0.06 ), vec3( LG_WELL_X1 + 0.05, LG_UPPER_ROOF + 0.13, LG_UPPER_FRONT ), 80.0, 0.02 );
  vec2 t = lgSlab( p, L, vec3( -LG_HALF_X - 0.1, LG_UPPER_FLOOR - 0.16, LG_UPPER_FRONT - 0.08 ), vec3( LG_HALF_X + 0.1, LG_UPPER_ROOF + 0.13, LG_BACK_Z + 0.1 ) );
  if ( t.x < t.y ) {
    vec3 a = p + L * t.x, b = p + L * t.y;
    float s = 0.02 + 0.004 * t.y;
    float glass = lgBand( a.y, LG_UPPER_Y0, LG_UPPER_Y1, s ) * lgBand( b.y, LG_UPPER_Y0, LG_UPPER_Y1, s ) * smoothstep( LG_WELL_X1 - s, LG_WELL_X1 + s, min( a.x, b.x ) );
    k *= 0.7 * glass;
  }
  return k;
}
// How much of the sky the upper room and the stairwell enclosure leave a
// fragment in front of them: each read as a wall of its height (the
// cosine-weighted share an infinite wall hides is (1 - cos) / 2 of the view).
float lgExtSky( vec3 p, vec3 n ) {
  float h = max( LG_UPPER_ROOF + 0.13 - p.y, 0.0 );
  float dz = max( LG_UPPER_FRONT - p.z, 0.0 ), dx = max( p.x - LG_WELL_X1, 0.0 );
  float room = 0.5 * ( 1.0 - dz * inversesqrt( dz * dz + h * h + 1e-6 ) ) * saturate( 0.5 + 0.5 * n.z + 0.25 * n.y );
  float well = p.z > LG_WELL_Z0 ? 0.5 * ( 1.0 - dx * inversesqrt( dx * dx + h * h + 1e-6 ) ) * saturate( 0.5 - 0.5 * n.x + 0.25 * n.y ) : 0.0;
  return clamp( 1.0 - room - well, 0.25, 1.0 );
}
` + PIER_DETAIL;

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
${opts.backGlazed ? GLSL_UNIFORMS_PIER : GLSL_UNIFORMS}
${opts.weave ? 'uniform float uLoungeFabricFilter;' : ''}
varying vec4 vLoungeSurf;
varying vec3 vLoungePos;`)
    // Global scope, after three's LTC/BRDF helpers it calls.
    .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
${opts.backGlazed ? GLSL_FUNCS_PIER : GLSL_FUNCS}`)
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
  ${opts.weave ? `// The baked weave has 96 threads per UV unit. Height-derived
  // normals need to fade before that detail becomes subpixel; ordinary
  // colour mipmaps alone do not band-limit the resulting lighting.
  float lgWeaveRate = max( length( lgDx ), length( lgDy ) ) * 96.0;
  float lgWeaveRelief = 1.0 - smoothstep( 0.25, 0.5, lgWeaveRate );
  float lgWeaveFilter = clamp( uLoungeFabricFilter, 0.0, 1.0 );
  lgDx *= mix( 1.0, 1.5, lgWeaveFilter );
  lgDy *= mix( 1.0, 1.5, lgWeaveFilter );` : ''}
  ${tiles}${opts.backGlazed ? `
  if ( lgFlag == SURF_UPPER_FLOOR || ( lgFlag == SURF_PLANKS && vLoungePos.y > LG_UPPER_ROOF - 0.1 ) ) {
    // Each board samples its own patch of the oak map, so the grain breaks
    // at every joint (the gradients stay continuous: no mip seam).
    vec2 lgBd;
    vec2 lgId = lgFlag == SURF_UPPER_FLOOR ? lgBoards( vLoungePos.xz, 0.18, 0.6, 0.36, lgBd ) : lgBoards( vLoungePos.xz, 0.12, 0.8, 0.3, lgBd );
    lgUv += vec2( lgHash( lgId ) * 7.1, lgHash( lgId + 2.3 ) * 0.37 );
  }` : ''}
  vec4 lgTex = textureGrad( map, lgUv, lgDx, lgDy );
  diffuseColor.rgb *= lgTex.rgb;
  ${opts.alpha ? `// foliage: alpha is the leaf mask; counter the mip thinning of alpha-tested leaves
  float lgLod = max( 0.0, log2( max( length( lgDx ), length( lgDy ) ) * 512.0 ) );
  diffuseColor.a *= min( 1.0, lgTex.a * ( 1.0 + lgLod * 0.3 ) );` : 'lgHeight = lgTex.a;'}
  ${opts.weave ? 'lgHeight = mix( 0.5, lgHeight, mix( 1.0, lgWeaveRelief, lgWeaveFilter ) );' : ''}
#endif`)
    .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
  // --- procedural surface detail (flag-driven) ---
  float lgBumpH = 0.0;${opts.backGlazed ? `
  float lgRoughAdd = 0.0; // squared roughness taken over from relief faded below the pixel` : ''}
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
      ${opts.backGlazed ? `// (pier: the relief is gone before a reed is 8 px wide; at 4 px a
      // derivative bump already resolves into 2x2-quad checkers under a low
      // sun, measured on the stairwell's sunlit outer skin)
      float k = 1.0 - smoothstep( 0.12, 0.3, w );` : 'float k = 1.0 - smoothstep( 0.25, 0.6, w );'}
      float ph = fract( u / pitch );
      ${opts.backGlazed ? `float phc = ph * 2.0 - 1.0; // pow() of a negative base is undefined in GLSL
      float profile = sqrt( max( 0.0, 1.0 - phc * phc ) ); // half-round reeds` : 'float profile = sqrt( max( 0.0, 1.0 - pow( ph * 2.0 - 1.0, 2.0 ) ) ); // half-round reeds'}
      // A half-circle height has an infinite slope at each reed seam. Its
      // screen derivatives created bright normal spikes on the stair wall.
      // Keep the original colour profile; use a smooth periodic relief with
      // bounded seam slopes and the pixel-box integral of its cosine.
      ${opts.backGlazed ? `float fw = max( w, 0.0001 );
      float reliefFilter = sin( 3.14159265 * fw ) / ( 3.14159265 * fw );
      float relief = 0.5 - 0.5 * cos( ph * 6.2831853 ) * reliefFilter;` : 'float relief = profile;'}
      lgBumpH += relief * 0.006 * k;${opts.backGlazed ? `
      // Relief faded out below the pixel is not lost: its slope variance
      // (a 3 mm sinusoid: 0.5 (2 pi a / pitch)^2) moves into the roughness,
      // so the reeds go satin at a distance instead of sparkling.
      lgRoughAdd = ( 1.0 - k ) * 0.5 * pow2( 6.2831853 * 0.003 / pitch );` : ''}
      diffuseColor.rgb *= mix( 1.0, mix( 0.7, 1.05, profile ), ${opts.backGlazed ? '1.0 - smoothstep( 0.25, 0.6, w ) ); // the colour reeds outlive their relief' : 'k );'}
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
      lgRough = 1.0;${opts.backGlazed ? `
    } else if ( lgFlag == SURF_EXTERIOR || ( lgFlag == SURF_DECK && rp.y > LG_UPPER_FLOOR + 0.045 && rp.z < LG_UPPER_FRONT ) ) {
      // Outdoors: the lower roof's top reads as a pale grey ballast membrane
      // (the dark interior deck colour would stay black in full sun), with a
      // broad weathering mottle; anything finer would be sub-pixel from the
      // upper seats, so the mid octave fades out with the pixel footprint.
      if ( lgFlag == SURF_DECK ) diffuseColor.rgb = vec3( 0.17, 0.165, 0.152 );
      float wf = length( fwidth( rp.xz ) );
      float mott = lgNoise( rp.xz * 0.8 ) * 0.6 + lgNoise( rp.xz * 4.0 + 7.3 ) * 0.4 * ( 1.0 - smoothstep( 0.04, 0.12, wf ) );
      diffuseColor.rgb *= 0.88 + 0.22 * mott;
    } else if ( lgFlag == SURF_UPPER_FLOOR ) {
      // Oak boards 0.18 m wide in random lengths, joints staggered row to row;
      // a 1.5 mm joint, faded to its mean before the rows near a pixel.
      vec2 bd;
      vec2 id = lgBoards( rp.xz, 0.18, 0.6, 0.36, bd );
      vec2 fw = fwidth( rp.xz );
      float joint = max( lgLines( bd.y, 0.0015, 0.18, fw.y ), lgLines( bd.x, 0.0015, 1.6, fw.x ) ) * step( LG_UPPER_FLOOR - 0.003, rp.y );
      float tone = lgHash( id + 0.37 ) - 0.5;
      diffuseColor.rgb *= ( 1.0 + tone * 0.16 ) * vec3( 1.0, 1.0 - tone * 0.03, 1.0 - tone * 0.07 ) * mix( 1.0, 0.45, joint );
      lgRough = mix( 1.0 + tone * 0.2, 1.5, joint );
    } else if ( lgFlag == SURF_PLANKS && rp.y > LG_UPPER_ROOF - 0.1 ) {
      // The upper room's oak-lined ceiling: 0.12 m planks with 6 mm shadow gaps.
      vec2 bd;
      vec2 id = lgBoards( rp.xz, 0.12, 0.8, 0.3, bd );
      vec2 fw = fwidth( rp.xz );
      float gap = lgLines( bd.y, 0.006, 0.12, fw.y ), butt = lgLines( bd.x, 0.002, 2.0, fw.x );
      float tone = lgHash( id + 0.73 ) - 0.5;
      diffuseColor.rgb *= ( 1.0 + tone * 0.12 ) * mix( 1.0, 0.22, gap ) * mix( 1.0, 0.6, butt );
    } else if ( lgFlag == SURF_CHART ) {
      // The stair-wall prints (CHART_PANELS): the nearest panel's own chart.
      vec4 pc = LG_CHARTS[ 0 ];
      for ( int i = 1; i < ${CHART_PANELS.length}; i ++ ) if ( abs( rp.z - LG_CHARTS[ i ].x ) < abs( rp.z - pc.x ) ) pc = LG_CHARTS[ i ];
      vec2 c = vec2( pc.x + 0.5 * LG_CHART_W - rp.z, rp.y - ( pc.y - 0.5 * LG_CHART_H ) );
      float px = length( fwidth( rp.yz ) ) * 0.7;
      if ( all( greaterThanEqual( c, vec2( 0.0 ) ) ) && all( lessThanEqual( c, vec2( LG_CHART_W, LG_CHART_H ) ) ) )
        diffuseColor.rgb = pc.z > 0.5 ? lgApproachPlate( c, pc.w, px, diffuseColor.rgb ) : lgSectional( c, pc.w, px, diffuseColor.rgb );
      lgRough = 1.0;
    } else if ( lgFlag == SURF_SPINES ) {
      diffuseColor.rgb = lgSpine( rp, diffuseColor.rgb, length( fwidth( rp.yz ) ) * 0.7 );` : ''}
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
    .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>${opts.backGlazed ? `
  {
    // A smoothed vertex normal can interpolate through zero across a thin
    // folded part (the metal bucket's rims and lathe lips), and three's
    // normalize( vNormal ) is then NaN for that pixel — and, through every
    // derivative of it, for its 2x2 quad. Take the face's own normal there.
    vec3 lgGeo = cross( dFdx( vViewPosition ), dFdy( vViewPosition ) );
    float lgGl = dot( lgGeo, lgGeo );
    vec3 lgFace = lgGl > 1e-30 && lgGl < 1e30 ? lgGeo * inversesqrt( lgGl ) : vec3( 0.0, 0.0, 1.0 );
    float lgNl = dot( normal, normal );
    if ( !( lgNl > 0.25 && lgNl < 4.0 ) ) normal = lgFace;
    if ( !( dot( nonPerturbedNormal, nonPerturbedNormal ) > 0.25 ) ) nonPerturbedNormal = normal;
  }` : ''}
  {
    // Texture height (alpha) + procedural relief, as a derivative bump.
    float h = ( lgHeight - 0.5 ) * ${f(opts.bump ?? 0)} + lgBumpH;
    if ( abs( ${f(opts.bump ?? 0)} ) > 0.0 || lgBumpH != 0.0 ) normal = lgBump( -vViewPosition, normal, h, faceDirection );
    // Geometric specular anti-aliasing: thin bright edges (fins, rails,
    // bevels) get the roughness their normal variation implies.
    vec3 dnx = dFdx( normal ), dny = dFdy( normal );
    float variance = 0.25 * ( dot( dnx, dnx ) + dot( dny, dny ) );
    roughnessFactor = sqrt( clamp( roughnessFactor * roughnessFactor + min( 2.0 * variance, 0.18 )${opts.backGlazed ? ' + lgRoughAdd' : ''}, 0.0, 1.0 ) );
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
    ${opts.backGlazed ? `// Upstairs (pier) every lamp is on the READING channel: the shade glows
    // on the same curve as the light under it.
    float lgOpalGlow = vLoungePos.y > LG_UPPER_FLOOR - 0.01 ? uLoungeGlow[ ${GLOW.READING} ] : uLoungeGlow[ GLOW_TABLE ];
    totalEmissiveRadiance += vec3( 1.0, 0.8, 0.58 ) * lgOpalGlow * uLoungeLight.w * 0.62 * rim;` : 'totalEmissiveRadiance += vec3( 1.0, 0.8, 0.58 ) * uLoungeGlow[ GLOW_TABLE ] * uLoungeLight.w * 0.62 * rim;'}
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
    float lgPx = length( fwidth( lgP ) );${opts.backGlazed ? `
    // EXTERIOR: anything beyond the upper glazing above the lower room's deck
    // (the lower roof, its finish and planting, the stairwell's outer skin) or
    // flagged SURF_EXTERIOR is outdoors: the world's own key (shadowed only by
    // the upper room and the stairwell enclosure), the open sky and the IBL.
    // No glass, no practicals, no interior bounce.
    bool lgExt = lgFlag == SURF_EXTERIOR || ( lgP.y > LG_UPPER_FLOOR + 0.02 && lgP.z < LG_UPPER_FRONT - 0.003 && !( lgP.x < LG_WELL_X1 && lgP.z > LG_WELL_Z0 ) );
    if ( lgExt ) {
      float lgExtAO = clamp( vLoungeSurf.z, 0.0, 1.0 );
      float lgK = dot( lgN, uLoungeKey ) > -0.2 ? lgExtKey( lgP + lgN * 0.02, uLoungeKey ) : 0.0;
      reflectedLight.directDiffuse *= lgK;
      reflectedLight.directSpecular *= lgK;
      float lgVis = lgExtSky( lgP, lgN );
      reflectedLight.indirectDiffuse *= lgVis * lgExtAO;
      reflectedLight.indirectSpecular *= mix( 1.0, lgVis, 0.5 ) * lgExtAO;
    } else {` : ''}
    // ambient occlusion: baked vertex AO, the baked floor map, the shell
    float lgAO = vLoungeSurf.z * lgFloorAO( lgP ) * lgShellAO( lgP, lgN, lgFlag );${opts.backGlazed ? `
    // Sliver triangles (rims, lathe lips) extrapolate their varyings far
    // outside [0, 1] where the rasterizer's barycentrics lose precision; the
    // contact curve below turns an AO of 60 into -400,000 (measured: the
    // metal bucket on the stair-side view, -9.4e5, a NaN once stored as half).
    lgAO = clamp( lgAO, 0.0, 1.0 );` : ''}
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
    ${opts.backGlazed ? `// The bounce follows the glazing: downstairs it falls off from the runway
    // glass toward the back; the upper room is glazed on three sides, so by
    // day it is evenly bright (a little less by the solid stairwell wall),
    // and after dark its general fill steps back so the lamps read as pools.
    float lgBz = mix( 1.25, 0.7, smoothstep( -1.0, 12.0, lgP.z ) );
    if ( lgP.y > LG_UPPER_FLOOR - 0.01 ) lgBz = mix( 1.2, 0.6, smoothstep( 0.45, 0.95, uLoungeLight.w ) ) * mix( 0.85, 1.0, smoothstep( -10.8, -6.5, lgP.x ) );
    vec3 lgB = uLoungeBounce * ( 0.78 - 0.38 * lgN.y ) * lgBz;` : 'vec3 lgB = uLoungeBounce * ( 0.78 - 0.38 * lgN.y ) * mix( 1.25, 0.7, smoothstep( -1.0, 12.0, lgP.z ) );'}
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
        vec4 C = texelFetch( uLoungeFix, ivec2( 2, i ), 0 );
        if ( C.w < -0.5 ) break;
        vec4 A = texelFetch( uLoungeFix, ivec2( 0, i ), 0 ), B = texelFetch( uLoungeFix, ivec2( 1, i ), 0 ), D = texelFetch( uLoungeFix, ivec2( 3, i ), 0 );
        #ifdef LG_UPPER_ROOM
        vec3 fixture = C.w > 1.5 ? ( A.xyz + D.xyz ) * 0.5 : A.xyz;
        // A light segment ending on the finished deck does not cross it.
        // Float32 interpolation around y=4.6 otherwise alternates the entire
        // practical-light contribution between adjacent raster rows.
        if ( ( fixture.y - LG_UPPER_FLOOR ) * ( lgP.y - LG_UPPER_FLOOR ) < 0.0 && abs( fixture.y - LG_UPPER_FLOOR ) > 0.001 && abs( lgP.y - LG_UPPER_FLOOR ) > 0.001 ) {
          float splitT = ( LG_UPPER_FLOOR - lgP.y ) / ( fixture.y - lgP.y );
          vec3 splitP = mix( lgP, fixture, splitT );
          if ( !( splitP.x < LG_WELL_X1 && splitP.z > LG_WELL_Z0 && splitP.z < LG_STAIR_Z1 ) ) continue;
        }
        #endif
        float gain = uLoungeGlow[ int( B.w + 0.5 ) ];
        if ( gain <= 0.0 ) continue;
        // out of range (a line light's range is about its nearest point)
        if ( C.w < 1.5 ) { vec3 dd = A.xyz - lgP; if ( dot( dd, dd ) > A.w * A.w ) continue; }
        vec3 L;
        float E;${opts.backGlazed ? `
        float lgSpecK = 1.0; // the specular's own cosine weight (line lights)
        float lgDist = 1.0; // metres to the light's representative point` : ''}
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
          E *= lgWindow( dist, A.w ) * saturate( dot( -L, C.xyz ) * 1.4 + 0.25 );${opts.backGlazed ? `
          // E carries the cosine averaged over the whole segment, but the
          // specular below is evaluated at one representative point, where
          // the (bumped) normal can face away: BRDF_GGX expects to be
          // weighted by its own N.L, and without it its visibility term is
          // 0.5 / EPSILON. Measured: 56x over-bright glints in a lattice
          // over the reeded credenza under the cross-room line (2,900x BRDF).
          lgSpecK = saturate( dot( lgN, L ) ) / max( nl, 1e-3 );
          lgDist = dist;` : ''}
        } else {
          L = A.xyz - lgP;
          float dist = length( L );
          L /= dist;
          E = lgWindow( dist, A.w ) / max( dist * dist, 0.04 ) * saturate( dot( lgN, L ) );${opts.backGlazed ? `
          lgDist = dist;` : ''}
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
        ${opts.backGlazed ? `// A fixture is not a point: its diffuser (~3 cm) subtends a wider cone
        // the closer the surface, so the lobe widens by that angle (Karis's
        // sphere-light roughness, alpha + r / 2d). Rims and corners a few
        // centimetres from a strip no longer catch it as one-pixel glints.
        PhysicalMaterial lgSm = material;
        lgSm.roughness = sqrt( min( 1.0, material.roughness * material.roughness + 0.015 / max( lgDist, 0.01 ) ) );
        reflectedLight.directSpecular += irr * lgSpecK * BRDF_GGX( L, lgV, lgN, lgSm );` : 'reflectedLight.directSpecular += irr * BRDF_GGX( L, lgV, lgN, material );'}
      }
    }${opts.backGlazed ? `
    } // interior` : ''}
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
    if (opts.backGlazed) {
      const plan = roomVariant('pier'), g = plan.aperture.back, u = plan.upper;
      const upperDefines = u ? `#define LG_UPPER_ROOM
#define LG_UPPER_FLOOR ${f(u.floorY)}
#define LG_UPPER_ROOF ${f(u.roofY)}
#define LG_UPPER_FRONT ${f(u.plate.z0)}
#define LG_UPPER_Y0 ${f(u.glazing.y0)}
#define LG_UPPER_Y1 ${f(u.glazing.y1)}
#define LG_WELL_X1 ${f(u.well.x1)}
#define LG_WELL_Z0 ${f(u.well.z0)}
#define LG_STAIR_X0 ${f(u.stair.x0)}
#define LG_STAIR_X1 ${f(u.stair.x1)}
#define LG_STAIR_Z0 ${f(u.stair.z0)}
#define LG_STAIR_Z1 ${f(u.stair.z1)}
` : '';
      shader.fragmentShader = `#define LG_BACK_GLAZED
#define LG_BACK_HALF ${f(g.x1)}
#define LG_BACK_Y0 ${f(g.y0)}
#define LG_BACK_Y1 ${f(g.y1)}
` + upperDefines + PIER_SURF_DEFINES + shader.fragmentShader;
    }
  };
  const tag = `lounge-room-v2-${opts.tiles ? 't' : ''}${opts.leaves ? 'l' : ''}${opts.alpha ? 'a' : ''}${opts.bump ? 'b' : ''}-${opts.texScale ?? 1}${opts.backGlazed ? '-pier-upper-v1-reed-relief-v1-floor-split-v1-light-v1-int-v1' : ''}${opts.weave ? '-weave-filter-v1' : ''}`;
  material.customProgramCacheKey = () => `${key.call(material)}|${tag}`;
  material.userData.loungeRoom = true;
  return material;
}

// ---------------------------------------------------------------------------
// Materials and the shared uniforms
// ---------------------------------------------------------------------------

/**
 * The uniforms every room material shares (one object, updated per frame).
 * `variant` sizes the glow table (GLOW_CHANNELS); a pier program fed a
 * classic-sized table simply reads 0 for the upper room's channels.
 */
export function createRoomUniforms(variant = 'classic') {
  const fix = new DataTexture(new Float32Array(FIXTURE_TABLE.width * FIXTURE_TABLE.height * 4), FIXTURE_TABLE.width, FIXTURE_TABLE.height, RGBAFormat, FloatType);
  fix.minFilter = NearestFilter; // read with texelFetch: no filtering, no mips
  fix.magFilter = NearestFilter;
  fix.generateMipmaps = false;
  fix.name = 'lounge-fixtures';
  fix.needsUpdate = true;
  return {
    // Pier fabric retains close weave detail while filtering subpixel relief.
    uLoungeFabricFilter: { value: 1 },
    uLoungeViewToRoom: { value: new Matrix3() },
    uLoungeEye: { value: new Vector3(0, 1.18, 0) },
    uLoungeKey: { value: new Vector3(0, 1, 0) },
    uLoungeLight: { value: new Vector4(0.88, 1, 1, 0) },
    uLoungeBounce: { value: new Vector3() },
    uLoungeRoomRad: { value: new Vector3() },
    uLoungeFix: { value: fix },
    uLoungeGlow: { value: new Float32Array(variant === 'pier' ? GLOW_CHANNELS.pier : GLOW_CHANNELS.classic) },
    uLoungeFloorAO: { value: null },
    uLoungeFloorRect: { value: new Vector4(FLOOR_RECT.x0, FLOOR_RECT.z0, 1 / (FLOOR_RECT.x1 - FLOOR_RECT.x0), 1 / (FLOOR_RECT.z1 - FLOOR_RECT.z0)) },
    uLoungeTime: { value: 0 },
    uLoungeFade: { value: 0 },
    uLoungeKeySoft: { value: 0.0047 },
  };
}

/** Write the static fixture lists (practicals, shadow boxes) into the fixture table. */
export function writeRoomFixtures(uniforms, room) {
  const { practicals, shadows } = room;
  const tex = uniforms.uLoungeFix.value, d = tex.image.data, W = FIXTURE_TABLE.width;
  const put = (col, row, x, y, z, w) => { const o = (row * W + col) * 4; d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = w; };
  d.fill(0);
  const lights = practicals.slice(0, MAX_LIGHTS);
  lights.forEach((l, i) => {
    const type = l.type === 'line' ? 2 : l.type === 'spot' ? 1 : 0;
    const p = l.type === 'line' ? l.a : l.p;
    put(0, i, p[0], p[1], p[2], l.range ?? 6);
    put(1, i, l.color[0] * l.power, l.color[1] * l.power, l.color[2] * l.power, l.group ?? 0);
    const axis = l.type === 'line' ? l.n : l.d ?? [0, -1, 0];
    const al = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    put(2, i, axis[0] / al, axis[1] / al, axis[2] / al, type);
    if (l.type === 'line') put(3, i, l.b[0], l.b[1], l.b[2], 0);
    else put(3, i, l.cone?.[0] ?? -1, l.cone?.[1] ?? 1, l.disc?.[0] ?? 0, l.disc?.[1] ?? 0);
  });
  for (let i = lights.length; i < FIXTURE_TABLE.height; i++) put(2, i, 0, 0, 0, -1); // end of the light list
  shadows.slice(0, MAX_SHADOWS).forEach((s, i) => {
    put(4, i, s.c[0], s.c[1], s.c[2], s.rot ?? 0);
    put(5, i, s.h[0], s.h[1], s.h[2], s.k ?? 1);
  });
  tex.needsUpdate = true;
  return { lights: lights.length, shadows: Math.min(MAX_SHADOWS, shadows.length) };
}

/**
 * The room's materials. `maps` (optional) are the baked surface textures
 * (room-textures.js); without them the room still renders (node gate, or a
 * renderer that failed the bake).
 */
export function createRoomMaterials(uniforms, maps = {}, variant = 'classic') {
  const backGlazed = variant === 'pier';
  const std = (params, opts) => patchRoomMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, fog: false, ...params }), uniforms, { ...opts, backGlazed });
  const materials = {
    stone: std({ map: maps.stone ?? null, name: 'lounge-stone' }, { tiles: true, bump: maps.stone ? 0.0016 : 0, texScale: 1.2 }),
    wood: std({ map: maps.wood ?? null, name: 'lounge-wood' }, { bump: maps.wood ? 0.0009 : 0, texScale: 1.4 }),
    metal: std({ name: 'lounge-metal', envMapIntensity: 1 }, {}),
    leather: std({ map: maps.leather ?? null, name: 'lounge-leather' }, { bump: maps.leather ? 0.0011 : 0 }),
    fabric: patchRoomMaterial(new MeshPhysicalMaterial({ vertexColors: true, roughness: 1, metalness: 0, fog: false, map: maps.fabric ?? null, sheen: 1, sheenRoughness: 0.55, sheenColor: new Color(0.42, 0.4, 0.38), name: 'lounge-fabric' }), uniforms, { bump: maps.fabric ? 0.0014 : 0, weave: backGlazed && !!maps.fabric, backGlazed }),
    plaster: std({ map: maps.plaster ?? null, name: 'lounge-plaster' }, { bump: maps.plaster ? 0.0007 : 0 }),
    small: std({ side: DoubleSide, name: 'lounge-small' }, { leaves: true }),
    // Alpha-tested foliage cards (olive canopies): one draw for thousands of leaves.
    foliage: std({ map: maps.foliage ?? null, side: DoubleSide, alphaTest: 0.5, name: 'lounge-foliage' }, { leaves: true, alpha: true }),
  };
  materials.emissive = createEmissiveMaterial(uniforms, backGlazed);
  return materials;
}

/** Light sources themselves: unlit, vertex colour x channel dimmer. */
function createEmissiveMaterial(uniforms, pier = false) {
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
      .replace('#include <common>', `#include <common>\nuniform float uLoungeGlow[ ${pier ? GLOW_CHANNELS.pier : 8} ];\nuniform vec4 uLoungeLight;\nuniform float uLoungeFade;\nuniform float uLoungeTime;\nvarying vec4 vLoungeSurf;\nvarying vec3 vLoungePos;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
${GLSL_DEFOCUS}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
  {
    ${pier ? `// (clamped: a sliver triangle can extrapolate its channel out of range)
    float g = uLoungeGlow[ int( clamp( vLoungeSurf.x, 0.0, ${GLOW_CHANNELS.pier - 1}.0 ) + 0.5 ) ] * uLoungeLight.w;` : 'float g = uLoungeGlow[ int( vLoungeSurf.x + 0.5 ) ] * uLoungeLight.w;'}
    int flag = int( vLoungeSurf.w + 0.5 );
    if ( flag == 1 ) {
      // backlit onyx: soft veining, brighter toward the centre
      ${pier ? `// The pier turns the bar a quarter turn onto the right wall (room-build.js
      // pierBar), so its panel runs along z about the bar's centre: read the
      // veining and the vignette in the panel's own (across, up) coordinates.
      // In the room's x the whole panel sat at x = 11.18, the veins ran flat
      // and the vignette held at its edge value (x0.65).
      vec2 lgOnyx = vec2( ${f(PIER_BAR_ZC)} - vLoungePos.z, vLoungePos.y );
      vec2 q = lgOnyx * vec2( 1.6, 2.3 );
      float v = sin( q.x * 2.1 + sin( q.y * 1.7 + q.x * 0.6 ) * 2.4 ) * 0.5 + 0.5;
      float vign = 1.0 - 0.35 * smoothstep( 0.6, 2.4, abs( lgOnyx.x ) ) - 0.25 * smoothstep( 0.6, 1.3, abs( lgOnyx.y - 2.36 ) );` : `vec2 q = vLoungePos.xy * vec2( 1.6, 2.3 );
      float v = sin( q.x * 2.1 + sin( q.y * 1.7 + q.x * 0.6 ) * 2.4 ) * 0.5 + 0.5;
      float vign = 1.0 - 0.35 * smoothstep( 0.6, 2.4, abs( vLoungePos.x ) ) - 0.25 * smoothstep( 0.6, 1.3, abs( vLoungePos.y - 2.36 ) );`}
      diffuseColor.rgb *= ( 0.75 + 0.45 * v ) * vign;
    } else if ( flag == 2 ) {
      // frosted doors to the concourse: brighter at eye level
      ${pier ? `float eye = ( vLoungePos.y - 1.5 ) / 1.1; // squared, not pow(): a negative base is undefined in GLSL
      diffuseColor.rgb *= 0.65 + 0.45 * exp( -eye * eye );` : 'diffuseColor.rgb *= 0.65 + 0.45 * exp( -pow( ( vLoungePos.y - 1.5 ) / 1.1, 2.0 ) );'}
    }
    diffuseColor.rgb *= g;
  }`);
  };
  m.customProgramCacheKey = () => (pier ? 'lounge-emissive-v2-pier-v2' : 'lounge-emissive-v2');
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
  // Pier only (GLOW_CHANNELS.pier):
  [0.15, 1.5], // READING (upstairs reading and table lamps: barely on by day, warm pools after dark)
  [0.55, 1.15], // DISPLAY (display and picture lights: on all day, a little brighter at night)
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
  const channels = Math.min(CHANNEL.length, glow.length); // a classic table stops at TABLE
  for (let i = 0; i < channels; i++) glow[i] = CHANNEL[i][0] * dayW + CHANNEL[i][1] * (1 - dayW);
  const nightWatch = Math.max(0, Math.min(1, state.nightWatch ?? 0));
  // Decorative fixtures dim together. Entrance and downlights retain a safe
  // circulation floor; no light count or shader program changes at runtime.
  // The pier (its glow table is the larger one: createRoomUniforms) runs its
  // upper circulation line at a lower level so the lamps read as pools, so
  // Night Watch takes less from its circulation channel there.
  const pier = glow.length >= GLOW_CHANNELS.pier;
  const entranceDim = pier ? 0.2 : 0.35;
  for (let i = 1; i < channels; i++) glow[i] *= 1 - nightWatch * (i === GLOW.ENTRANCE ? entranceDim : i === GLOW.LAMP ? 0.55 : 0.88);
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
  const nb = practical * (1 - day) * 0.075 * (1 - nightWatch * 0.78);
  uniforms.uLoungeBounce.value.set(b * (0.6 + 0.4 * warm[0]) + nb, b * (0.6 + 0.4 * warm[1]) + nb * 0.72, b * (0.62 + 0.38 * warm[2]) + nb * 0.46);
  const rr = uniforms.uLoungeBounce.value;
  uniforms.uLoungeRoomRad.value.set(rr.x * 0.16, rr.y * 0.16, rr.z * 0.16);
  uniforms.uLoungeTime.value = state.time ?? 0;
  out.day = day; out.night = night; out.golden = golden; out.practical = practical; out.keyI = keyI; out.nightWatch = nightWatch;
  return out;
}

export { GLSL_CONST as LOUNGE_GLSL_CONST, GLSL_FUNCS as LOUNGE_GLSL_FUNCS };
