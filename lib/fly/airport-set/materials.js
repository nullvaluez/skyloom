// Materials for the airport set. Three programs in all:
//
//   createSetMaterial()   MeshStandardMaterial for every solid (terminal,
//                         fixtures, bridges, vehicles). Per-vertex surface
//                         class (aSurf) picks the analytic detail: concrete
//                         staining, curtain-wall mullions with a parallax lit
//                         concourse behind the glass, panel joints, louvres,
//                         corrugation, hazard bands, sign legends from the
//                         atlas, lamp lenses. Works for Mesh and BatchedMesh.
//   createDecalMaterial() transparent MeshStandardMaterial for the apron
//                         markings: dashes, hatches, glyphs, paint wear.
//
// Draw order: three r185 REVERSES the sorted render lists under reverse-Z,
// renderOrder included, and the satellite terrain is itself transparent at
// renderOrder 0. A ground overlay must therefore carry a NEGATIVE renderOrder
// to draw after the imagery (see sat-road-engine / SatTintLayer); index.js
// sets the decals and pools below the street-light ribbons (-4).
//   createPoolMaterial()  floodlight pools on the apron at night ('light'
//                         multiplies the ground, 'fill' adds a faint floor).
//
// Contracts (FLY_OBSERVATION_LOUNGE.md): no new lights (the mast floodlight
// is a material term over the set's own uniforms), the CSM patch is chained
// automatically (lights_pars_begin / lights_fragment_begin stay untouched),
// the world bend comes from the shared uniforms, and every key is explicit.
import { AddEquation, AdditiveBlending, Color, CustomBlending, DstColorFactor, MeshBasicMaterial, MeshStandardMaterial, OneFactor, Vector2, Vector3, Vector4 } from 'three';
import { shareBendUniforms, offsetUnits } from '../toy-world/world-bend.js';
import { applyDaylightSurface } from '../daylight-depth.js';

export const MAX_FLOODS = 24;

/** One uniform block shared by every set material (one write per frame). */
export function createSetUniforms() {
  return {
    uSetNight: { value: 0 },
    uSetTime: { value: 0 },
    uSetAtlas: { value: null },
    uSetFlood: { value: Array.from({ length: MAX_FLOODS }, () => new Vector4()) },
    uSetFloodCount: { value: 0 },
    uSetFloodColor: { value: new Color(1.0, 0.88, 0.72) },
    uSetCam: { value: new Vector3() }, // camera position in room-local metres
    uSetConcourse: { value: new Vector2(5.35, 17.4) }, // terminal gate floor / ceiling
    // x interior, y signs, z floodlight, w pool multiplier
    uSetGains: { value: new Vector4(1.15, 1.6, 1.0, 6.0) },
    uSetPoolFill: { value: 0.05 },
  };
}

const COMMON_GLSL = /* glsl */ `
float setHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float setNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( setHash( i ), setHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( setHash( i + vec2( 0.0, 1.0 ) ), setHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
// Anti-aliased periodic line (half width hw, metres). Lines narrower than a
// pixel resolve to their area average instead of shimmering.
float setLine( float c, float period, float hw ) {
  float d = abs( fract( c / period + 0.5 ) - 0.5 ) * period;
  float fw = max( fwidth( c ), 1e-4 );
  float m = 1.0 - smoothstep( hw - fw, hw + fw, d );
  return mix( m, min( 1.0, 2.0 * hw / period ), smoothstep( 0.25 * period, 0.8 * period, fw ) );
}
`;

const FLOOD_GLSL = /* glsl */ `
// Mast floodlight as a material term: Lambert from each lamp head, an inverse-
// square falloff softened at 30 m, a range cut, and a beam toward the apron
// (sign of w: +1 aims -Z, -1 aims +Z). Night only; returns irradiance.
vec3 setFlood( vec3 p, vec3 n ) {
  vec3 e = vec3( 0.0 );
  for ( int i = 0; i < ${MAX_FLOODS}; i ++ ) {
    if ( i >= uSetFloodCount ) break;
    vec4 f = uSetFlood[ i ];
    vec3 L = f.xyz - p;
    float d2 = max( dot( L, L ), 1.0 );
    float d = sqrt( d2 );
    vec3 l = L / d;
    float ndl = max( dot( n, l ), 0.0 );
    vec3 beam = normalize( vec3( 0.0, -0.75, -sign( f.w ) ) );
    float b = smoothstep( -0.15, 0.55, dot( -l, beam ) );
    float fall = abs( f.w ) / ( 1.0 + d2 / 900.0 ) * ( 1.0 - smoothstep( 90.0, 150.0, d ) );
    e += vec3( ndl * fall * ( 0.12 + 0.88 * b ) );
  }
  return e * uSetFloodColor;
}
`;

// project_vertex replacement: batching/instancing, the room-local position
// for patterns and floodlight, then the shared world bend.
const PROJECT_GLSL = /* glsl */ `
vec4 wPos = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  wPos = batchingMatrix * wPos;
#endif
#ifdef USE_INSTANCING
  wPos = instanceMatrix * wPos;
#endif
vSetLocal = wPos.xyz;
wPos = modelMatrix * wPos;
float setBendD = distance( wPos.xz, uBendCenter );
wPos.y -= setBendD * setBendD * uBendK;
vec4 mvPosition = viewMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
`;

// Shadows are sampled at the displayed (bent) position, like daylight-depth.js.
const SHADOW_FIX_GLSL = /* glsl */ `
#ifdef USE_SHADOWMAP
worldPosition = wPos;
#endif
#include <shadowmap_vertex>
`;

function must(text, anchor, name) {
  if (!text.includes(anchor)) throw new Error(`airport-set ${name}: shader anchor missing: ${anchor}`);
}

// --- the solid set material -------------------------------------------------------

const SET_FRAG_DECL = /* glsl */ `
flat varying vec4 vSurf;
varying vec2 vSetUv;
varying vec3 vSetLocal;
varying vec3 vSetN;
uniform float uSetNight;
uniform float uSetTime;
uniform sampler2D uSetAtlas;
uniform vec4 uSetFlood[ ${MAX_FLOODS} ];
uniform int uSetFloodCount;
uniform vec3 uSetFloodColor;
uniform vec3 uSetCam;
uniform vec2 uSetConcourse;
uniform vec4 uSetGains;
${COMMON_GLSL}
${FLOOD_GLSL}
// Parallax concourse behind curtain-wall glass (interior mapping): the eye ray
// continues into a box (floor, ceiling with light rows, a back wall of gates
// and shops) whose hit point is shaded analytically. Returns radiance.
vec3 setInterior( vec3 p, vec3 n, vec2 uv, float warm ) {
  vec3 rd = normalize( p - uSetCam );
  vec3 tu = abs( n.z ) >= abs( n.x ) ? vec3( -sign( n.z ), 0.0, 0.0 ) : vec3( 0.0, 0.0, sign( n.x ) );
  float ru = dot( rd, tu ), rv = rd.y, rw = -dot( rd, n );
  if ( rw < 0.02 ) return vec3( 0.0 );
  bool hall = uv.y >= uSetConcourse.x - 0.2 && uv.y <= uSetConcourse.y + 0.2;
  float base = hall ? uSetConcourse.x : floor( uv.y / 4.0 ) * 4.0;
  float ceil_ = hall ? uSetConcourse.y - 0.6 : base + 3.4;
  float depth = hall ? 14.0 : 7.0;
  float tB = depth / rw;
  float tC = rv > 1e-4 ? ( ceil_ - uv.y ) / rv : 1e9;
  float tF = rv < -1e-4 ? ( base - uv.y ) / rv : 1e9;
  float t = min( tB, min( max( tC, 0.0 ), max( tF, 0.0 ) ) );
  float hu = uv.x + ru * t, hv = uv.y + rv * t, hw = rw * t;
  vec3 lamp = mix( vec3( 0.80, 0.90, 1.0 ), vec3( 1.0, 0.82, 0.60 ), warm );
  vec3 c;
  if ( t == tC ) {
    // Ceiling: rows of linear lights parallel to the glass, every 3.2 m.
    float rows = setLine( hw + 1.0, 3.2, 0.22 );
    float coffer = setLine( hu, 6.0, 0.08 );
    c = lamp * ( 0.10 + 2.6 * rows ) * ( 1.0 - 0.4 * coffer );
  } else if ( t == tF ) {
    // Polished floor reflecting the light rows.
    float refl = setLine( hw + 1.0, 3.2, 0.5 );
    c = lamp * ( 0.06 + 0.32 * refl ) * vec3( 1.0, 0.95, 0.9 );
  } else {
    // Back wall: gate/shop fronts in 6 m bays with lit header bands.
    float bay = floor( hu / 6.0 );
    float h = setHash( vec2( bay, floor( base ) ) );
    float header = smoothstep( 0.0, 0.08, hv - base - 3.0 ) * ( 1.0 - smoothstep( 0.0, 0.08, hv - base - 3.9 ) );
    vec3 shop = mix( lamp, mix( vec3( 0.95, 0.55, 0.25 ), vec3( 0.45, 0.65, 1.0 ), step( 0.5, h ) ), 0.55 );
    float front = 1.0 - smoothstep( 0.0, 0.1, hv - base - 2.8 );
    c = mix( lamp * 0.10, shop * ( 0.35 + 0.6 * h ), front * step( 0.25, h ) ) + shop * header * 1.8;
    c *= 1.0 - 0.6 * setLine( hu, 6.0, 0.15 );
  }
  // Closed / quiet sections of the concourse are dimmer.
  float zone = setHash( vec2( floor( hu / 42.0 ), 7.0 ) );
  c *= mix( 0.45, 1.0, step( 0.22, zone ) );
  c *= exp( -t * 0.012 );
  // The glass reflects more at grazing angles (the PBR reflection is the
  // other half of this split).
  float f = 0.04 + 0.96 * pow( 1.0 - clamp( rw, 0.0, 1.0 ), 5.0 );
  return c * ( 1.0 - f );
}
`;

const SET_COLOR_GLSL = /* glsl */ `
#include <color_fragment>
int setCls = int( vSurf.x + 0.5 );
int setGlow = int( vSurf.w + 0.5 );
float setRough = vSurf.y / 255.0;
float setMetal = vSurf.z / 255.0;
float setBumpH = 0.0;
float setGlass = 0.0;
vec3 setEmit = vec3( 0.0 );
vec2 sm = vSetUv; // metres on the face
vec3 setN = normalize( vSetN );
// Broad, low-frequency tonal variation everywhere: nothing reads as a flat
// CG fill even before class detail.
float setTone = setNoise( vSetLocal.xz * 0.045 + vSetLocal.y * 0.02 );
diffuseColor.rgb *= 0.94 + 0.12 * setTone;
if ( setCls == 1 ) {
  // CONCRETE: stains, rain streaks, form-tie joints.
  float stain = setNoise( sm * 0.32 ) * 0.6 + setNoise( sm * 1.3 ) * 0.4;
  float streak = setNoise( vec2( sm.x * 2.6, sm.y * 0.14 ) );
  float joint = max( setLine( sm.x, 2.4, 0.012 ), setLine( sm.y, 1.2, 0.01 ) );
  diffuseColor.rgb *= ( 0.84 + 0.24 * stain ) * ( 1.0 - 0.12 * smoothstep( 0.55, 0.9, streak ) * step( 0.3, abs( setN.y ) < 0.5 ? 1.0 : 0.0 ) );
  diffuseColor.rgb *= 1.0 - 0.22 * joint;
  setBumpH = -0.004 * joint;
} else if ( setCls == 2 ) {
  // CURTAIN WALL: aluminium mullions every 1.6 m, transoms every 3.3 m, a
  // coated, slightly bluish reflective pane between them.
  float mv = setLine( sm.x, 1.6, 0.045 );
  float mh = setLine( sm.y, 3.3, 0.055 );
  float mull = max( mv, mh );
  setGlass = 1.0 - mull;
  float pane = setHash( floor( vec2( sm.x / 1.6, sm.y / 3.3 ) ) );
  // Coated glass in the metallic workflow: a light base at high metalness
  // gives F0 ~ 0.2 (a real reflective coating) with almost no diffuse. Each
  // pane is a slightly different flatness, so reflections break up.
  vec3 glass = mix( vec3( 0.22, 0.27, 0.30 ), diffuseColor.rgb * 6.0, 0.25 ) * ( 0.9 + 0.2 * pane );
  diffuseColor.rgb = mix( glass, vec3( 0.36, 0.38, 0.40 ), mull );
  setRough = mix( 0.03 + 0.04 * pane, 0.38, mull );
  setMetal = mix( 0.8, 0.85, mull );
  setBumpH = 0.05 * mull;
} else if ( setCls == 3 ) {
  // CLADDING: metal panels, 1.2 x 3.0 m, slight per-panel tone.
  vec2 cell = abs( setN.y ) > 0.7 ? vSetLocal.xz / vec2( 1.5, 6.0 ) : sm / vec2( 1.2, 3.0 );
  float panel = setHash( floor( cell ) );
  float joint = max( setLine( cell.x, 1.0, 0.012 ), setLine( cell.y, 1.0, 0.006 ) );
  diffuseColor.rgb *= ( 0.95 + 0.08 * panel ) * ( 1.0 - 0.28 * joint );
  setRough = clamp( setRough + ( panel - 0.5 ) * 0.08, 0.05, 1.0 );
  setBumpH = -0.006 * joint;
} else if ( setCls == 4 ) {
  // MEMBRANE: overlapping sheets, patch repairs, drainage dirt.
  float seam = setLine( vSetLocal.z, 2.0, 0.025 );
  float patchy = smoothstep( 0.62, 0.8, setNoise( vSetLocal.xz * 0.11 ) );
  float dirt = setNoise( vSetLocal.xz * 0.6 );
  diffuseColor.rgb *= ( 1.0 - 0.10 * seam ) * ( 1.0 - 0.10 * patchy ) * ( 0.9 + 0.12 * dirt );
  setBumpH = 0.004 * seam;
} else if ( setCls == 5 ) {
  // GLASS: tinted coated glass (see CURTAIN), faint smudge variation.
  setGlass = 1.0;
  diffuseColor.rgb = mix( vec3( 0.2, 0.24, 0.27 ), diffuseColor.rgb * 5.0, 0.3 );
  setRough = 0.04 + 0.05 * setNoise( sm * 3.0 );
  setMetal = 0.75;
} else if ( setCls == 6 ) {
  // SIGN: board + legend from the atlas mask.
  float legend = smoothstep( 0.25, 0.7, texture2D( uSetAtlas, sm ).r );
  vec3 board = diffuseColor.rgb, ink = vec3( 0.02 );
  if ( setGlow == 3 ) ink = vec3( 0.95, 0.95, 0.92 );
  else if ( setGlow == 4 ) ink = vec3( 0.98, 0.74, 0.08 );
  else if ( setGlow == 5 ) ink = vec3( 0.015 );
  else if ( setGlow == 7 ) ink = vec3( 1.0, 0.55, 0.06 );
  diffuseColor.rgb = mix( board, ink, legend );
  float lit = setGlow == 7 ? 2.4 : mix( 0.12, 1.0, uSetNight ) * uSetGains.y;
  setEmit += ( setGlow == 7 ? ink * legend : diffuseColor.rgb ) * lit;
} else if ( setCls == 7 ) {
  diffuseColor.rgb *= 0.9 + 0.1 * setNoise( sm * 5.0 );
} else if ( setCls == 8 ) {
  // LOUVRE: horizontal blades with dark gaps.
  float blade = setLine( sm.y, 0.14, 0.035 );
  diffuseColor.rgb *= mix( 0.35, 1.0, 1.0 - blade );
  setBumpH = 0.01 * ( 1.0 - blade );
} else if ( setCls == 9 ) {
  // RIBBED: trapezoidal corrugation every 0.25 m.
  float rib = abs( fract( sm.x / 0.25 ) - 0.5 ) * 2.0;
  diffuseColor.rgb *= 0.9 + 0.1 * rib;
  setBumpH = 0.02 * smoothstep( 0.2, 0.8, rib );
} else if ( setCls == 10 ) {
  // HAZARD: diagonal yellow / black bands.
  float band = step( 0.5, fract( ( sm.x + sm.y ) / 0.5 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.02 ), band );
} else if ( setCls == 11 ) {
  // GALVANISED: spangle.
  diffuseColor.rgb *= 0.85 + 0.25 * setNoise( sm * 9.0 + vSetLocal.xz );
} else if ( setCls == 13 ) {
  // SOLAR: dark cells, light grid lines, frame.
  float grid = max( setLine( sm.x, 0.33, 0.012 ), setLine( sm.y, 0.33, 0.012 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.45, 0.48, 0.52 ), grid * 0.6 );
}
// Ground grime on anything standing on the apron (not glass, not lenses).
if ( setCls != 2 && setCls != 5 && setCls != 6 && setCls != 12 ) {
  float grime = 1.0 - smoothstep( 0.0, 0.7, vSetLocal.y );
  diffuseColor.rgb *= 1.0 - 0.22 * grime;
}
`;

const SET_EMIT_GLSL = /* glsl */ `
#include <emissivemap_fragment>
{
  float night = uSetNight;
  // Interiors behind glass.
  if ( setGlass > 0.0 && ( setGlow == 1 || setGlow == 2 ) ) {
    if ( setCls == 2 ) setEmit += setInterior( vSetLocal, setN, vSetUv, setGlow == 1 ? 1.0 : 0.0 ) * setGlass * uSetGains.x * mix( 0.1, 1.0, night );
    else {
      vec3 tint = setGlow == 1 ? vec3( 1.0, 0.84, 0.62 ) : vec3( 0.74, 0.86, 1.0 );
      float occ = 0.55 + 0.45 * setNoise( vSetLocal.xz * 0.3 + vSetLocal.y );
      setEmit += tint * occ * 0.8 * setGlass * uSetGains.x * mix( 0.06, 1.0, night );
    }
  }
  if ( setGlow == 13 && setGlass > 0.0 ) setEmit += vec3( 1.0, 0.83, 0.62 ) * 0.9 * setGlass * night * uSetGains.x;
  if ( setGlow == 14 ) setEmit += vec3( 1.0, 0.92, 0.80 ) * ( 0.25 + 0.9 * setNoise( vSetLocal.xy * 0.5 ) ) * night;
  if ( setCls == 12 ) {
    vec3 lc = vec3( 0.0 );
    if ( setGlow == 8 ) lc = vec3( 1.0, 0.92, 0.80 ) * 9.0 * night;
    else if ( setGlow == 9 ) lc = vec3( 1.0, 0.06, 0.03 ) * 6.0 * night;
    else if ( setGlow == 10 ) lc = vec3( 1.0, 0.55, 0.08 ) * ( 0.4 + 5.0 * pow( max( 0.0, cos( 6.2831853 * ( uSetTime * 1.3 + vSetLocal.x * 0.37 ) ) ), 6.0 ) );
    else if ( setGlow == 11 ) lc = vec3( 1.0, 0.96, 0.9 ) * mix( 0.4, 6.0, night );
    else if ( setGlow == 12 ) lc = vec3( 1.0, 0.07, 0.04 ) * mix( 0.25, 2.6, night );
    else if ( setGlow == 7 ) lc = vec3( 1.0, 0.55, 0.06 ) * 1.8;
    setEmit += lc;
  } else if ( setGlow == 8 ) {
    // Downlights in a soffit (cladding lit from recessed fittings).
    vec2 cell = fract( vSetLocal.xz / vec2( 4.0, 3.0 ) ) - 0.5;
    float spot = 1.0 - smoothstep( 0.04, 0.12, length( cell * vec2( 4.0, 3.0 ) ) / 3.0 );
    setEmit += vec3( 1.0, 0.88, 0.7 ) * ( spot * 7.0 + 0.08 ) * night;
  }
  totalEmissiveRadiance += setEmit;
  if ( night > 0.01 ) totalEmissiveRadiance += diffuseColor.rgb * setFlood( vSetLocal, setN ) * night * uSetGains.z;
}
`;

/**
 * The solid material. `extraKey` distinguishes prewarm twins if ever needed.
 */
export function createSetMaterial(uniforms) {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 1 });
  material.name = 'airport-set';
  const bend = shareBendUniforms({});
  material.userData.__worldBend = 'set';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, bend);
    let v = shader.vertexShader;
    for (const a of ['#include <common>', '#include <begin_vertex>', '#include <defaultnormal_vertex>', '#include <project_vertex>', '#include <shadowmap_vertex>']) must(v, a, 'set vertex');
    v = v.replace('#include <common>', `#include <common>
attribute vec4 aSurf;
flat varying vec4 vSurf;
varying vec2 vSetUv;
varying vec3 vSetLocal;
varying vec3 vSetN;
uniform vec2 uBendCenter;
uniform float uBendK;`)
      .replace('#include <defaultnormal_vertex>', `vSetN = objectNormal;
#ifdef USE_BATCHING
vSetN = mat3( batchingMatrix ) * objectNormal;
#endif
#include <defaultnormal_vertex>`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = aSurf;\nvSetUv = uv;')
      .replace('#include <project_vertex>', PROJECT_GLSL)
      .replace('#include <shadowmap_vertex>', SHADOW_FIX_GLSL);
    shader.vertexShader = v;
    let f = shader.fragmentShader;
    for (const a of ['#include <common>', '#include <color_fragment>', '#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>', '#include <normal_fragment_maps>', '#include <emissivemap_fragment>', '#include <lights_pars_begin>', '#include <lights_fragment_begin>']) must(f, a, 'set fragment');
    f = f.replace('#include <common>', `#include <common>\n${SET_FRAG_DECL}`)
      .replace('#include <color_fragment>', SET_COLOR_GLSL)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = setRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = setMetal;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if ( setBumpH != 0.0 ) {
  // Analytic relief (mullions, joints, ribs): perturb by the height's screen
  // derivatives, three's perturbNormalArb construction.
  vec3 dpx = dFdx( - vViewPosition ), dpy = dFdy( - vViewPosition );
  float hx = dFdx( setBumpH ), hy = dFdy( setBumpH );
  vec3 r1 = cross( dpy, normal ), r2 = cross( normal, dpx );
  float det = dot( dpx, r1 );
  if ( abs( det ) > 1e-8 ) normal = normalize( abs( det ) * normal - sign( det ) * ( hx * r1 + hy * r2 ) );
}`)
      .replace('#include <emissivemap_fragment>', SET_EMIT_GLSL);
    shader.fragmentShader = f;
  };
  material.customProgramCacheKey = () => 'airport-set-solid-v1';
  applyDaylightSurface(material, 'building');
  return material;
}

// --- decals --------------------------------------------------------------------------

const DECAL_COLOR_GLSL = /* glsl */ `
#include <color_fragment>
{
  int pat = int( vDecal.x + 0.5 );
  float a = 1.0;
  if ( pat == 1 ) {
    float fw = max( fwidth( vSetUv.x / vDecal.y ), 1e-4 );
    float t = fract( vSetUv.x / vDecal.y );
    a = smoothstep( 0.0, fw, t ) * ( 1.0 - smoothstep( vDecal.z - fw, vDecal.z, t ) );
  } else if ( pat == 2 ) {
    float s = ( vSetUv.x + vSetUv.y ) / vDecal.y;
    float fw = max( fwidth( s ), 1e-4 );
    float t = fract( s );
    a = smoothstep( 0.0, fw, t ) * ( 1.0 - smoothstep( vDecal.z - fw, vDecal.z, t ) );
    a = mix( a, vDecal.z, smoothstep( 0.3, 0.8, fw ) );
  } else if ( pat == 3 ) {
    a = smoothstep( 0.3, 0.65, texture2D( uSetAtlas, vSetUv ).r );
  } else if ( pat == 4 ) {
    float fw = max( fwidth( vSetUv.y / vDecal.y ), 1e-4 );
    float t = fract( vSetUv.y / vDecal.y );
    a = smoothstep( 0.0, fw, t ) * ( 1.0 - smoothstep( vDecal.z - fw, vDecal.z, t ) );
  }
  // Paint wear: tyre-polished and faded patches, never a clean vector line.
  float wear = setNoise( vSetLocal.xz * 0.9 ) * 0.65 + setNoise( vSetLocal.xz * 4.0 ) * 0.35;
  a *= 1.0 - 0.6 * smoothstep( 0.6, 0.95, wear );
  diffuseColor.rgb *= ( 0.86 + 0.14 * setNoise( vSetLocal.xz * 2.3 ) ) * ( 1.0 - 0.18 * smoothstep( 0.4, 0.9, wear ) );
  diffuseColor.a *= a * 0.94;
  if ( diffuseColor.a < 0.01 ) discard;
}
`;

export function createDecalMaterial(uniforms) {
  const material = new MeshStandardMaterial({
    vertexColors: true, roughness: 0.62, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: offsetUnits(null, -8),
  });
  material.name = 'airport-set-decals';
  const bend = shareBendUniforms({});
  material.userData.__worldBend = 'set';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, bend);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aDecal;
varying vec4 vDecal;
varying vec2 vSetUv;
varying vec3 vSetLocal;
uniform vec2 uBendCenter;
uniform float uBendK;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDecal = aDecal;\nvSetUv = uv;')
      .replace('#include <project_vertex>', PROJECT_GLSL)
      .replace('#include <shadowmap_vertex>', SHADOW_FIX_GLSL);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vDecal;
varying vec2 vSetUv;
varying vec3 vSetLocal;
uniform sampler2D uSetAtlas;
${COMMON_GLSL}`)
      // Floodlight on the paint comes from the pools drawn over it (index.js),
      // the same light the surrounding ground gets.
      .replace('#include <color_fragment>', DECAL_COLOR_GLSL);
  };
  material.customProgramCacheKey = () => 'airport-set-decal-v4';
  return material;
}

// --- floodlight pools ------------------------------------------------------------------

/**
 * Floodlight on the apron at night, for surfaces the set does not own (the
 * imagery, the ground workstream's apron, the markings). Two passes over the
 * same quads: 'light' MULTIPLIES what is already there by (1 + gain * pool),
 * so concrete brightens with its own texture and paint and grass keep their
 * contrast; 'fill' adds a faint warm floor so black patches are not left
 * black under a lamp.
 */
export function createPoolMaterial(uniforms, mode = 'light') {
  const light = mode === 'light';
  const material = new MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, toneMapped: false,
    blending: light ? CustomBlending : AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: offsetUnits(null, -10),
  });
  if (light) {
    material.blendEquation = AddEquation;
    material.blendSrc = DstColorFactor;
    material.blendDst = OneFactor;
  }
  material.name = light ? 'airport-set-pools' : 'airport-set-pool-fill';
  const bend = shareBendUniforms({});
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, bend);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec2 vSetUv;
varying vec3 vSetLocal;
uniform vec2 uBendCenter;
uniform float uBendK;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSetUv = uv;')
      .replace('#include <project_vertex>', PROJECT_GLSL);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vSetUv;
varying vec3 vSetLocal;
uniform float uSetNight;
uniform vec4 uSetGains;
uniform float uSetPoolFill;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float r = length( vSetUv );
// Smooth lamp falloff; neighbouring pools overlap into an even field.
float pool = smoothstep( 1.0, 0.0, r ) * ( 0.9 + 0.1 * sin( vSetLocal.x * 0.21 + 1.3 ) * sin( vSetLocal.z * 0.17 ) );
diffuseColor.rgb *= pool * uSetNight * ${light ? 'uSetGains.w' : 'uSetPoolFill'};`);
  };
  material.customProgramCacheKey = () => (light ? 'airport-set-pool-light-v2' : 'airport-set-pool-fill-v2');
  return material;
}
