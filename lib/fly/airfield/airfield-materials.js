// AIRFIELD MATERIALS — grass, pavement, runway (with analytic markings) and
// taxiway paint for the observed airport.
//
// All four are MeshStandardMaterials patched through onBeforeCompile, so the
// scene's sun (CSM cascades — adopted automatically), environment and fog
// light them like everything else; the lights_pars_begin / lights_fragment_begin
// anchors are left untouched for the CSM wrapper. Each one:
//   - lifts its FLAT local-metre vertices onto the shared height field
//     (R32F texture, texelFetch, planar per facet — the CPU heightAt() is the
//     same maths) plus its layer's lift, then the world bend runs as usual;
//   - discards fragments whose height is not known yet;
//   - computes its appearance procedurally in local metres (stable: the
//     local frame never rebases) with analytic anti-aliasing: every pattern
//     is box-filtered by its own pixel footprint (fwidth), so markings, slab
//     joints and grass detail resolve to their average tone at grazing angles
//     instead of shimmering.
//
// Colours are LINEAR albedo (the composer renders linear HDR).
import { Color, MeshStandardMaterial, Vector2, Vector4 } from 'three';
import { MAX_RUNWAYS } from './airfield-model.js';
import { applyBend, groundOverlayOffset } from '../toy-world/world-bend';
import { applyDaylightSurface } from '../daylight-depth';
import { playPassOn } from '../play-pass';
import { APRON_KEY, apronGrass, apronPaint, apronPavement, apronRunway, apronUniforms } from './airfield-apron.js';

// Play Pass APRON (airfield-apron.js): the factories' default, so the live
// layers and the prewarm twins (measured-world-prewarm.js) compile the same
// programs. Off, every layer's text and key are exactly the previous ones.
const APRON_ON = playPassOn('APRON_DETAIL');

/** Final production chain, shared by live layers and retained shader twins. */
export function patchAirfieldMaterial(material, layer) {
  applyBend(material);
  applyDaylightSurface(material);
  // applyBend replaces the key. Restore the layer identity before CSM wraps it.
  const chained = material.customProgramCacheKey;
  const apron = material.userData.afApron ? `-${APRON_KEY}` : '';
  material.customProgramCacheKey = () => `${chained()}|airfield-${layer}-v2${apron}`;
  Object.assign(material, groundOverlayOffset(-1, -2) ?? {});
  return material;
}

/** Uniform cells shared by all four materials of one AirfieldGround. */
export function createAirfieldUniforms({ apron = APRON_ON } = {}) {
  const arr = (n) => Array.from({ length: n }, () => new Vector4());
  return {
    ...(apron ? apronUniforms(Vector4) : {}),
    uAfHeight: { value: null },
    uAfGrid: { value: new Vector4(0, 0, 1, 0) }, // x0, z0, 1/step, -
    uAfSize: { value: new Vector2(2, 2) },
    uAfTime: { value: 0 },
    uAfNight: { value: 0 },
    // Concrete slab grid: direction (x, z), slab size m, airport class.
    uAfSlab: { value: new Vector4(1, 0, 7.5, 0) },
    // Mowing stripes: direction (x, z), stripe width m, season dryness bias.
    uAfMow: { value: new Vector4(1, 0, 9, 0) },
    // Runways: A = (length, halfW, thrA, thrB), B = glyphs end A (d1, d2,
    // letter, style 0 FAA / 1 ICAO), C = glyphs end B (d1, d2, letter, surface
    // 0 asphalt / 1 concrete), D = (shoulder m, precision 0/1/2, imagery reference luminance,
    // lighted 0/1).
    uAfRwyA: { value: arr(MAX_RUNWAYS) },
    uAfRwyB: { value: arr(MAX_RUNWAYS) },
    uAfRwyC: { value: arr(MAX_RUNWAYS) },
    uAfRwyD: { value: arr(MAX_RUNWAYS) },
    uAfGlyphs: { value: null },
    // Low-frequency imagery colour (optional): texture + local bounds
    // (x0, z0, 1/width, 1/height); w of uAfPhotoOn = weight.
    uAfPhoto: { value: null },
    uAfPhotoBounds: { value: new Vector4(0, 0, 1, 1) },
    uAfPhotoOn: { value: 0 },
    // The imagery's median grass colour (linear rgb) and the weight it tints
    // the procedural palette with (0 until the photo is measured).
    uAfGrassTone: { value: new Vector4(0, 0, 0, 0) },
    // Pavement appearance per height-grid node (airfield-photo.js
    // buildPavementInfo): r concrete weight, g imagery level / 0.6, b paved.
    uAfPave: { value: null },
    uAfPaveOn: { value: 0 },
  };
}

// --- shared GLSL -------------------------------------------------------------

const VERT_DECL = /* glsl */ `
uniform sampler2D uAfHeight;
uniform vec4 uAfGrid;
uniform vec2 uAfSize;
uniform float uAfLift;
varying vec2 vAfLocal;
varying float vAfValid;
float afFetch( ivec2 c ) {
  return texelFetch( uAfHeight, clamp( c, ivec2( 0 ), ivec2( uAfSize ) - 1 ), 0 ).r;
}
// Height of the shared field at a local point (metres): PLANAR per facet,
// the cell split along its (0,0)-(1,1) diagonal — the facets clipToFacets cut
// every mesh along, so each triangle is exactly the field (airfield-height.js).
// valid = 0 while any of the four nodes is still the 'unknown' sentinel.
float afHeight( vec2 p, out float valid ) {
  vec2 g = clamp( ( p - uAfGrid.xy ) * uAfGrid.z, vec2( 0.0 ), uAfSize - 1.0 );
  vec2 c = min( floor( g ), max( uAfSize - 2.0, vec2( 0.0 ) ) );
  vec2 f = g - c;
  ivec2 i = ivec2( c );
  float h00 = afFetch( i ), h10 = afFetch( i + ivec2( 1, 0 ) ), h01 = afFetch( i + ivec2( 0, 1 ) ), h11 = afFetch( i + ivec2( 1, 1 ) );
  valid = step( -9.0e4, min( min( h00, h10 ), min( h01, h11 ) ) );
  return f.x >= f.y ? h00 + ( h10 - h00 ) * f.x + ( h11 - h10 ) * f.y
                    : h00 + ( h11 - h01 ) * f.x + ( h01 - h00 ) * f.y;
}
`;

const VERT_LIFT = /* glsl */ `
float afValid;
transformed.y = afHeight( position.xz, afValid ) + uAfLift;
vAfValid = afValid;
vAfLocal = position.xz;
`;

const FRAG_DECL = /* glsl */ `
varying vec2 vAfLocal;
varying float vAfValid;
uniform float uAfTime;
uniform float uAfNight;
uniform sampler2D uAfPhoto;
uniform vec4 uAfPhotoBounds;
uniform float uAfPhotoOn;
// Integer hash: stable for local coordinates far beyond float fract() range.
float afHash( vec2 p ) {
  uvec2 q = uvec2( ivec2( floor( p ) ) + 65536 );
  uint h = ( q.x * 1597334677u ) ^ ( q.y * 3812015801u );
  h = ( h ^ ( h >> 16 ) ) * 2246822519u;
  h ^= h >> 13;
  return float( h ) * ( 1.0 / 4294967296.0 );
}
float afNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( afHash( i ), afHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( afHash( i + vec2( 0.0, 1.0 ) ), afHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
// A noise octave of cell size 1/scale, faded to its mean once a pixel covers
// more than about half a cell (no sub-pixel glitter at grazing angles).
float afNoiseAA( vec2 p, float scale, float footprintM ) {
  return mix( afNoise( p * scale ), 0.5, smoothstep( 0.3, 0.9, footprintM * scale ) );
}
// Box-filtered coverage of the interval [lo, hi] at x for a footprint w.
float afBand( float x, float lo, float hi, float w ) {
  w = max( w, 1e-4 );
  return clamp( ( min( x + 0.5 * w, hi ) - max( x - 0.5 * w, lo ) ) / w, 0.0, 1.0 );
}
// Integral of a pulse train (pulse [0, duty) in every unit period) from 0 to x.
float afPulseInt( float x, float duty ) {
  return floor( x ) * duty + min( fract( x ), duty );
}
// Box-filtered pulse train: exact average over the footprint, any distance.
float afPulse( float x, float duty, float w ) {
  w = max( w, 1e-4 );
  return clamp( ( afPulseInt( x + 0.5 * w, duty ) - afPulseInt( x - 0.5 * w, duty ) ) / w, 0.0, 1.0 );
}
vec3 afPhotoColor( vec2 p, float bias ) {
  vec2 uv = ( p - uAfPhotoBounds.xy ) * uAfPhotoBounds.zw;
  return texture( uAfPhoto, uv, bias ).rgb;
}
`;

/** Compose the shared patch with a layer's own declarations and fragment body. */
function patch(material, layer, { uniforms, lift, vertDecl = '', vertBody = '', fragDecl = '', color = '', roughness = '', normal = '', emissive = '' }) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.uniforms.uAfLift = { value: lift };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}\n${vertDecl}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_LIFT}\n${vertBody}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}\n${fragDecl}`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif ( vAfValid < 0.999 ) discard;\nvec2 afP = vAfLocal;\nfloat afFoot = max( length( fwidth( afP ) ), 1e-4 );')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${color}`);
    if (roughness) shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${roughness}`);
    if (normal) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${normal}`);
    if (emissive) shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${emissive}`);
  };
  // The layer's own key; airfield-ground.js chains it again after applyBend,
  // which replaces the key of every material it patches.
  const apron = material.userData.afApron ? `-${APRON_KEY}` : '';
  material.customProgramCacheKey = () => `airfield-ground-${layer}-v2${apron}`;
  material.needsUpdate = true;
  return material;
}

// --- grass ----------------------------------------------------------------------

const GRASS_FRAG = /* glsl */ `
// Infield grass seen from the terminal, procedural at every scale: broad
// patches of three greens, mown swaths along the main runway, clumps, tufts
// and blades that fade with the pixel footprint, dryness from WorldCover and
// the season. The imagery only steers it — its median grass colour tints the
// whole palette (the real season and region) and its heavily blurred hue marks
// drier ground — so none of the photo's detail is smeared across the field.
float macro = afNoise( afP / 150.0 ) * 0.6 + afNoise( afP / 43.0 + 11.0 ) * 0.4;
float patchy = afNoise( afP / 13.0 + 5.0 );
float dry = vAfGrass.y * 0.6 + uAfMow.w;
if ( uAfPhotoOn > 0.0 && uAfGrassTone.w > 0.0 ) {
  vec3 ph = afPhotoColor( afP, 5.0 );
  float yl = ( ph.r - ph.b ) / max( ph.r + ph.g + ph.b, 1e-3 );
  float y0 = ( uAfGrassTone.r - uAfGrassTone.b ) / max( uAfGrassTone.r + uAfGrassTone.g + uAfGrassTone.b, 1e-3 );
  dry += clamp( ( yl - y0 ) * 2.5, -0.15, 0.4 );
}
dry = clamp( dry + ( macro - 0.5 ) * 0.45 + ( patchy - 0.5 ) * 0.2, 0.0, 1.0 );
vec3 grass = mix( vec3( 0.048, 0.088, 0.024 ), vec3( 0.070, 0.102, 0.031 ), smoothstep( 0.3, 0.7, afNoise( afP / 31.0 + 2.0 ) ) );
grass = mix( grass, vec3( 0.098, 0.102, 0.040 ), smoothstep( 0.25, 0.6, dry ) );
grass = mix( grass, vec3( 0.200, 0.172, 0.082 ), smoothstep( 0.55, 0.95, dry ) );
if ( uAfGrassTone.w > 0.0 ) {
  // Toward the imagery's median grass HUE (its chromaticity against the
  // palette's own mean): a dry summer, an autumn field, tropical green. Its
  // brightness only nudges — the photo's exposure is not this sun's.
  vec3 ref = vec3( 0.068, 0.096, 0.031 );
  vec3 lum = vec3( 0.2126, 0.7152, 0.0722 );
  float lt = max( dot( uAfGrassTone.rgb, lum ), 1e-4 ), lr = dot( ref, lum );
  vec3 hue = clamp( ( uAfGrassTone.rgb / lt ) / ( ref / lr ), vec3( 0.7 ), vec3( 1.45 ) );
  hue /= dot( hue * ref / lr, lum ); // keep the luminance
  float bright = clamp( pow( lt / lr, 0.25 ), 0.85, 1.2 );
  grass *= mix( vec3( 1.0 ), hue * bright, uAfGrassTone.w );
}
// Mown swaths: alternate passes lay the blades opposite ways.
float mowU = dot( afP, uAfMow.xy ) / uAfMow.z;
float stripe = afPulse( mowU, 0.5, fwidth( mowU ) );
float mowed = smoothstep( 0.3, 0.55, afNoise( afP / 260.0 + 5.0 ) );
grass *= 1.0 + ( stripe - 0.5 ) * 0.17 * mowed;
float clump = afNoiseAA( afP + 31.0, 1.0 / 2.6, afFoot );
float tuft = afNoiseAA( afP + 7.0, 1.0 / 0.7, afFoot );
float blade = afNoiseAA( afP + 3.0, 1.0 / 0.18, afFoot );
grass *= 0.8 + 0.4 * macro;
grass *= 0.84 + 0.32 * clump;
grass *= 0.88 + 0.24 * tuft;
grass *= 0.88 + 0.24 * blade;
diffuseColor.rgb = grass;
diffuseColor.a = vAfGrass.x;
`;

export function createGrassMaterial(uniforms, lift, { apron = APRON_ON } = {}) {
  const m = new MeshStandardMaterial({ color: new Color(1, 1, 1), roughness: 0.96, metalness: 0, transparent: true, depthWrite: true });
  m.name = 'airfield-grass';
  let text = {
    decl: 'varying vec2 vAfGrass;\nuniform vec4 uAfMow;\nuniform vec4 uAfGrassTone;',
    color: GRASS_FRAG,
    roughness: 'roughnessFactor = clamp( 0.9 + ( afNoiseAA( afP, 1.0 / 1.3, afFoot ) - 0.5 ) * 0.12, 0.0, 1.0 );',
  };
  if (apron) {
    text = apronGrass(text);
    m.userData.afApron = true;
  }
  return patch(m, 'grass', {
    uniforms,
    lift,
    vertDecl: 'attribute vec2 aGrass;\nvarying vec2 vAfGrass;',
    vertBody: 'vAfGrass = aGrass;',
    fragDecl: text.decl,
    color: text.color,
    roughness: text.roughness,
  });
}

// --- pavement ---------------------------------------------------------------------

const PAVE_DECL = /* glsl */ `
varying vec3 vAfSurf;
uniform vec4 uAfSlab;
uniform sampler2D uAfPave;
uniform float uAfPaveOn;
uniform vec4 uAfGrid;
uniform vec2 uAfSize;
// The pavement appearance field at a local point (texel centres on the nodes).
vec4 afPaveInfo( vec2 p ) {
  return texture( uAfPave, ( ( p - uAfGrid.xy ) * uAfGrid.z + 0.5 ) / uAfSize );
}
// Concrete slabs on the airport grid: per-slab tone and pour colour, sealed
// joints with their band of dirt and spalled edges (box-filtered: crisp
// nearby, a faint average far away), grime, oil stains and aggregate.
vec3 afConcrete( vec2 p, float foot, float stains ) {
  vec2 q = vec2( dot( p, uAfSlab.xy ), dot( p, vec2( -uAfSlab.y, uAfSlab.x ) ) ) / uAfSlab.z;
  vec2 slab = floor( q );
  float tone = afHash( slab + 17.0 );
  float pour = afHash( slab * 1.7 + 41.0 );
  float age = afHash( slab * 0.5 + 3.0 );
  vec2 fq = max( fwidth( q ), vec2( 1e-4 ) );
  float sw = 0.02 / uAfSlab.z, dw = 0.25 / uAfSlab.z;
  float seal = max( 1.0 - afPulse( q.x + 0.5 * sw, 1.0 - sw, fq.x ), 1.0 - afPulse( q.y + 0.5 * sw, 1.0 - sw, fq.y ) );
  float dirt = max( 1.0 - afPulse( q.x + 0.5 * dw, 1.0 - dw, fq.x ), 1.0 - afPulse( q.y + 0.5 * dw, 1.0 - dw, fq.y ) );
  // Slab to slab only a few percent (a strong checker reads as floor tiles);
  // the big variation is weathering across tens of metres.
  vec3 c = vec3( 0.36, 0.352, 0.33 ) * ( 0.92 + 0.16 * tone );
  c *= mix( vec3( 1.0 ), vec3( 1.025, 1.0, 0.96 ), pour );
  // A few replaced slabs read clean and pale; old ones darker.
  c *= mix( 1.0, 1.1, step( 0.94, age ) ) * mix( 1.0, 0.9, step( age, 0.1 ) );
  float grime = afNoise( p / 63.0 ) * 0.45 + afNoise( p / 19.0 ) * 0.35 + afNoise( p / 7.0 ) * 0.2;
  c *= 0.78 + 0.38 * grime;
  float st = afNoiseAA( p + 91.0, 1.0 / 2.8, foot ) * 0.7 + afNoise( p / 9.0 + 4.0 ) * 0.3;
  c *= 1.0 - 0.32 * smoothstep( 0.64, 0.86, st ) * ( 0.4 + 0.6 * afNoise( p / 27.0 ) ) * stains;
  c *= 0.92 + 0.16 * afNoiseAA( p, 1.0 / 0.12, foot );
  c *= 1.0 - 0.22 * dirt;
  return mix( c, vec3( 0.03 ), seal * 0.85 );
}
// Asphalt: dark binder, aggregate sparkle up close, patch repairs and wear.
vec3 afAsphalt( vec2 p, float foot, float base ) {
  float aggregate = afNoiseAA( p, 1.0 / 0.08, foot );
  float pebble = afNoiseAA( p + 5.0, 1.0 / 0.35, foot );
  float wear = afNoise( p / 29.0 ) * 0.6 + afNoise( p / 7.0 ) * 0.4;
  vec2 cell = floor( p / 14.0 );
  float patchy = step( 0.86, afHash( cell + 3.0 ) ) * afBand( fract( p.x / 14.0 ), 0.2, 0.8, fwidth( p.x / 14.0 ) ) * afBand( fract( p.y / 14.0 ), 0.25, 0.75, fwidth( p.y / 14.0 ) );
  vec3 c = vec3( base, base * 1.01, base * 1.03 );
  c *= 0.84 + 0.32 * wear;
  c *= 0.9 + 0.2 * aggregate;
  c *= 0.93 + 0.14 * pebble;
  c *= 1.0 - 0.2 * patchy;
  return c;
}
`;

const PAVE_FRAG = /* glsl */ `
// Concrete weight and level come from the appearance FIELD (position only),
// so overlapping pieces — ribbons, pads, fillets, polygons — shade
// identically; the vertex values (aSurf.yz) are the class guess used until
// the field exists.
float concreteW = clamp( vAfSurf.y, 0.0, 1.0 );
float level = 0.0;
if ( uAfPaveOn > 0.5 ) {
  vec4 info = afPaveInfo( afP );
  // Sharpened: a concrete apron meets an asphalt taxiway in metres, not 16.
  concreteW = smoothstep( 0.3, 0.7, info.r );
  level = info.g * 0.6;
}
vec3 pave = mix( afAsphalt( afP, afFoot, 0.085 ), afConcrete( afP, afFoot, 0.8 ), concreteW );
if ( level > 0.0 ) {
  // Match the imagery's level here (old or new concrete, dark or light
  // asphalt). Its local detail never shows — parked aircraft and shadows were
  // photographed on it — only its broad dark areas (stands, taxi paths) add grime.
  float mean = mix( 0.085, 0.315, concreteW );
  pave *= clamp( level / mean, 0.72, 1.35 );
  if ( uAfPhotoOn > 0.0 ) {
    float l = dot( afPhotoColor( afP, 3.0 ), vec3( 0.2126, 0.7152, 0.0722 ) );
    pave *= clamp( pow( max( l, 1e-3 ) / level, 0.35 ), 0.82, 1.0 );
  }
}
diffuseColor.rgb = pave;
`;

export function createPavementMaterial(uniforms, lift, { apron = APRON_ON } = {}) {
  const m = new MeshStandardMaterial({ color: new Color(1, 1, 1), roughness: 0.88, metalness: 0 });
  m.name = 'airfield-pavement';
  let text = {
    decl: PAVE_DECL,
    color: PAVE_FRAG,
    roughness: 'roughnessFactor = clamp( mix( 0.86, 0.8, vAfSurf.y ) + ( afNoiseAA( afP + 2.0, 1.0 / 0.5, afFoot ) - 0.5 ) * 0.14, 0.0, 1.0 );',
  };
  if (apron) {
    text = apronPavement(text);
    m.userData.afApron = true;
  }
  return patch(m, 'pavement', {
    uniforms,
    lift,
    vertDecl: 'attribute vec3 aSurf;\nvarying vec3 vAfSurf;',
    vertBody: 'vAfSurf = aSurf;',
    fragDecl: text.decl,
    color: text.color,
    roughness: text.roughness,
    emissive: text.emissive ?? '',
  });
}

// --- runways ------------------------------------------------------------------------

const RWY_DECL = /* glsl */ `
varying vec3 vAfRwy;
uniform vec4 uAfRwyA[ ${MAX_RUNWAYS} ];
uniform vec4 uAfRwyB[ ${MAX_RUNWAYS} ];
uniform vec4 uAfRwyC[ ${MAX_RUNWAYS} ];
uniform vec4 uAfRwyD[ ${MAX_RUNWAYS} ];
uniform vec4 uAfSlab;
uniform sampler2D uAfGlyphs;
// Rectangle coverage in runway coordinates (s along, c cross), box-filtered.
float rBox( vec2 p, vec2 lo, vec2 hi, vec2 w ) {
  return afBand( p.x, lo.x, hi.x, w.x ) * afBand( p.y, lo.y, hi.y, w.y );
}
// One designator glyph (atlas cell index g, 13 cells in an 8x2 grid).
// (u, v) in 0..1 over the glyph box, v = 0 at the box's threshold side.
float rGlyph( float g, vec2 uv ) {
  // No early return: the lookup runs for every fragment of the quad so its
  // implicit derivatives (mip and anisotropy) are defined; the box masks it.
  float inside = step( 0.0, g ) * step( 0.0, uv.x ) * step( uv.x, 1.0 ) * step( 0.0, uv.y ) * step( uv.y, 1.0 );
  float gi = max( g, 0.0 );
  vec2 cell = vec2( mod( gi, 8.0 ), floor( gi / 8.0 ) );
  // Glyph art fills the middle of each 128x256 cell (pads stop mip bleed).
  vec2 inner = vec2( 0.125 + 0.75 * clamp( uv.x, 0.0, 1.0 ), 0.0625 + 0.875 * clamp( uv.y, 0.0, 1.0 ) );
  return inside * texture( uAfGlyphs, ( cell + inner ) / vec2( 8.0, 2.0 ) ).r;
}
// Designator for one end: number digits d1 d2 and optional letter, reading
// upright for the pilot landing from that end. s0 = start of the block (m from
// the threshold), cross position c (positive = pilot's LEFT).
float rDesignator( vec2 p, vec4 g, float s0, float h, float w, float gap ) {
  float cov = 0.0;
  float numS = s0;
  if ( g.z >= 0.0 ) {
    // The letter sits nearest the threshold, the number beyond it.
    cov = max( cov, rGlyph( g.z, vec2( ( -p.y + 0.5 * w ) / w, ( p.x - s0 ) / h ) ) );
    numS = s0 + h + gap;
  }
  float pair = g.x >= 0.0 ? 2.0 : 1.0;
  float total = pair * w + ( pair - 1.0 ) * 0.5 * w;
  float left = -0.5 * total;
  // Pilot's right is -c: glyph u runs from the pilot's left (c = +total/2) to right.
  float u = -p.y - left;
  if ( g.x >= 0.0 ) {
    cov = max( cov, rGlyph( g.x, vec2( u / w, ( p.x - numS ) / h ) ) );
    cov = max( cov, rGlyph( g.y, vec2( ( u - 1.5 * w ) / w, ( p.x - numS ) / h ) ) );
  } else {
    cov = max( cov, rGlyph( g.y, vec2( u / w, ( p.x - numS ) / h ) ) );
  }
  return cov;
}
// Markings of one runway half seen from its landing end. p = (s from that
// end's pavement end, c with +c = pilot's left), thr = displaced threshold,
// L = length, hw = half width, glyphs g, style 0 FAA / 1 ICAO.
float rEndMarks( vec2 p, vec2 w, float thr, float L, float hw, vec4 g, float prec ) {
  float icao = g.w;
  float cov = 0.0;
  float s = p.x - thr;
  // Threshold bar across a displaced threshold (3 m), arrows before it.
  if ( thr > 1.0 ) {
    cov = max( cov, rBox( p, vec2( thr - 3.0, -hw + 1.0 ), vec2( thr, hw - 1.0 ), w ) );
    // Centreline arrows in the displaced area: shafts + heads pointing in.
    float arrowSp = 36.0;
    float k = floor( ( p.x - 10.0 ) / arrowSp );
    float a0 = 10.0 + k * arrowSp;
    if ( p.x > 6.0 && p.x < thr - 18.0 ) {
      float local = p.x - a0;
      float shaft = afBand( local, 0.0, 20.0, w.x ) * afBand( p.y, -0.45, 0.45, w.y );
      float head = afBand( local, 20.0, 30.0, w.x ) * afBand( abs( p.y ), 0.0, max( 0.0, 1.6 * ( 1.0 - ( local - 20.0 ) / 10.0 ) ), w.y );
      cov = max( cov, max( shaft, head ) );
    }
    // Arrowheads across the runway just before the bar.
    float lane = 7.0;
    float laneC = ( floor( p.y / lane ) + 0.5 ) * lane;
    float hs = thr - 18.0;
    float hl = p.x - hs;
    if ( abs( laneC ) < hw - 3.0 ) cov = max( cov, afBand( hl, 0.0, 12.0, w.x ) * afBand( abs( p.y - laneC ), 0.0, max( 0.0, 2.2 * ( 1.0 - hl / 12.0 ) ), w.y ) );
  }
  // Threshold stripes ("piano keys"): starting 6 m in, by runway width.
  float keyLen = icao > 0.5 ? 30.0 : 45.7;
  float stripes = hw * 2.0 >= 59.0 ? 16.0 : hw * 2.0 >= 44.0 ? 12.0 : hw * 2.0 >= 29.0 ? 8.0 : hw * 2.0 >= 22.0 ? 6.0 : 4.0;
  float keyW = 1.8;
  float keySp = 2.0 * hw / ( stripes + 3.0 ); // stripe pitch across, with a centre gap
  if ( s > 6.0 - 1.0 && s < 6.0 + keyLen + 1.0 ) {
    float perSide = stripes * 0.5;
    float ac = abs( p.y );
    // Stripes either side of a central gap of one pitch.
    float idx = floor( ( ac - 1.5 * keySp ) / keySp + 0.5 );
    float centre = ( 1.5 + clamp( idx, 0.0, perSide - 1.0 ) ) * keySp;
    cov = max( cov, afBand( s, 6.0, 6.0 + keyLen, w.x ) * afBand( ac, centre - 0.5 * keyW, centre + 0.5 * keyW, w.y ) );
  }
  // Designator.
  float desS = 6.0 + keyLen + 12.0;
  float gh = icao > 0.5 ? 9.0 : 18.3;
  float gw = icao > 0.5 ? 3.0 : 6.1;
  cov = max( cov, rDesignator( vec2( s, p.y ), g, desS, gh, gw, icao > 0.5 ? 3.0 : 6.1 ) );
  // Aiming point (instrument runways, precision >= 1) and touchdown-zone bars
  // (precision runways, precision >= 2), scaled down on narrow pavement.
  if ( prec > 0.5 ) {
    float aim0 = icao > 0.5 ? ( L >= 2400.0 ? 400.0 : 300.0 ) : 310.9;
    float aimL = icao > 0.5 ? 50.0 : 45.7;
    float aimIn = min( icao > 0.5 ? 9.0 : 11.0, hw * 0.42 );
    float aimW = min( icao > 0.5 ? 8.0 : 9.1, hw * 0.36 );
    cov = max( cov, afBand( s, aim0, aim0 + aimL, w.x ) * afBand( abs( p.y ), aimIn, aimIn + aimW, w.y ) );
  }
  if ( prec > 1.5 ) {
    float aim0 = icao > 0.5 ? ( L >= 2400.0 ? 400.0 : 300.0 ) : 310.9;
    float aimL = icao > 0.5 ? 50.0 : 45.7;
    float aimIn = min( icao > 0.5 ? 9.0 : 11.0, hw * 0.42 );
    // TDZ: bars 22.5 m long, 1.8 m wide, 1.5 m apart, every 150 m; 3,3,2,2,1,1.
    float tz = floor( s / 150.0 + 0.5 );
    float tzS = tz * 150.0;
    if ( tz >= 1.0 && tz <= 6.0 && abs( tzS - aim0 - 0.5 * aimL ) > 60.0 ) {
      float bars = tz <= 2.0 ? 3.0 : tz <= 4.0 ? 2.0 : 1.0;
      float ac = abs( p.y ) - aimIn;
      float bi = floor( ac / 3.3 );
      float inBar = step( 0.0, bi ) * step( bi, bars - 1.0 );
      cov = max( cov, afBand( s, tzS, tzS + 22.5, w.x ) * inBar * afBand( ac - bi * 3.3, 0.0, 1.8, w.y ) );
    }
  }
  return cov;
}
`;

const RWY_FRAG = /* glsl */ `
int ri = int( vAfRwy.z + 0.5 );
vec4 RA = uAfRwyA[ ri ];
vec4 RB = uAfRwyB[ ri ];
vec4 RC = uAfRwyC[ ri ];
vec4 RD = uAfRwyD[ ri ];
float L = RA.x, hw = RA.y, thrA = RA.z, thrB = RA.w;
float s = vAfRwy.x, c = vAfRwy.y;
vec2 w = max( fwidth( vAfRwy.xy ), vec2( 1e-4 ) );
float concrete = RC.w;
// --- surface
vec3 base;
if ( concrete > 0.5 ) {
  // Concrete runway: 7.6 m slabs along the runway frame.
  vec2 q = vec2( s, c ) / 7.6;
  float tone = afHash( floor( q ) + 5.0 );
  float jw = 0.05 / 7.6;
  vec2 fq = max( fwidth( q ), vec2( 1e-4 ) );
  float joint = max( 1.0 - afPulse( q.x + 0.5 * jw, 1.0 - jw, fq.x ), 1.0 - afPulse( q.y + 0.5 * jw, 1.0 - jw, fq.y ) );
  base = vec3( 0.30, 0.295, 0.28 ) * ( 0.92 + 0.16 * tone );
  base *= 0.9 + 0.2 * ( afNoise( afP / 31.0 ) * 0.6 + afNoise( afP / 8.0 ) * 0.4 );
  base *= 0.94 + 0.12 * afNoiseAA( afP, 1.0 / 0.12, afFoot );
  base = mix( base, vec3( 0.05 ), joint * 0.5 );
} else {
  base = afAsphaltRwy( afP, afFoot );
  // Paving lanes: faint longitudinal seams every 7.6 m.
  float seam = 1.0 - afPulse( c / 7.6 + 0.004, 0.992, w.y / 7.6 );
  base *= 1.0 - 0.25 * seam;
}
if ( uAfPhotoOn > 0.0 && RD.z > 0.0 ) {
  // Match the runway's measured imagery level and follow its local tone
  // (rubber, patches), mostly darkening: the photo's own blurred markings
  // must not haze the crisp ones drawn here.
  float l = dot( afPhotoColor( afP, 1.5 ), vec3( 0.2126, 0.7152, 0.0722 ) );
  float mean = concrete > 0.5 ? 0.29 : 0.075;
  base *= clamp( RD.z / mean, 0.75, 1.4 ) * clamp( pow( max( l, 1e-3 ) / RD.z, 0.5 ), 0.8, 1.02 );
}
// Shoulders: lighter, coarser, unmarked.
float shoulder = smoothstep( hw - 0.05, hw + 0.05, abs( c ) );
base = mix( base, base * 1.35 + 0.012, shoulder );
// --- rubber deposits in both touchdown zones (main gear tracks + centre)
float rubber = 0.0;
for ( int e = 0; e < 2; e++ ) {
  float se = e == 0 ? s - thrA : ( L - s ) - thrB;
  float along = smoothstep( 90.0, 330.0, se ) * ( 1.0 - smoothstep( 650.0, 1350.0, se ) );
  float ac = abs( c );
  float tracks = exp( -pow( ( ac - 5.2 ) / 2.6, 2.0 ) ) + 0.55 * exp( -pow( c / 1.6, 2.0 ) ) + 0.35 * exp( -pow( ( ac - 9.0 ) / 3.5, 2.0 ) );
  float streak = afNoiseAA( vec2( se / 26.0, c * 1.4 ), 1.0, w.y * 1.4 ) * 0.6 + afNoise( vec2( se / 90.0, c * 0.35 ) ) * 0.4;
  rubber = max( rubber, along * tracks * ( 0.45 + 0.75 * streak ) );
}
rubber = clamp( rubber, 0.0, 1.0 ) * ( 1.0 - shoulder );
base *= 1.0 - 0.62 * rubber * ( concrete > 0.5 ? 1.0 : 0.85 );
// --- markings
float paint = 0.0;
if ( abs( c ) < hw + 0.5 ) {
  // Side stripes along both edges.
  float sideW = 2.0 * hw >= 30.0 ? 0.9 : 0.45;
  paint = max( paint, afBand( abs( c ), hw - 0.3 - sideW, hw - 0.3, w.y ) * afBand( s, 0.0, L, w.x ) );
  // Centreline: 36.6 m dashes, 24.4 m gaps (FAA) / 30 + 20 (ICAO), between designators.
  float icao = RB.w;
  float dash = icao > 0.5 ? 30.0 : 36.6;
  float gap = icao > 0.5 ? 20.0 : 24.4;
  float clW = RD.y > 0.5 ? 0.9 : 0.45;
  float keyLen = icao > 0.5 ? 30.0 : 45.7;
  float desEnd = 6.0 + keyLen + 12.0 + ( icao > 0.5 ? 9.0 : 18.3 ) * 2.0 + ( icao > 0.5 ? 3.0 : 6.1 ) + 12.0;
  float cl0 = thrA + desEnd, cl1 = L - thrB - desEnd;
  float period = dash + gap;
  float onDash = afPulse( ( s - cl0 ) / period, dash / period, w.x / period );
  paint = max( paint, onDash * afBand( c, -0.5 * clW, 0.5 * clW, w.y ) * afBand( s, cl0, cl1, w.x ) );
  // Each end, in that end's own frame.
  paint = max( paint, rEndMarks( vec2( s, c ), w, thrA, L, hw, RB, RD.y ) );
  paint = max( paint, rEndMarks( vec2( L - s, -c ), w, thrB, L, hw, RC, RD.y ) );
}
// Paint is worn by rubber in the touchdown zones and slightly dirty everywhere.
vec3 paintCol = vec3( 0.70, 0.70, 0.67 ) * ( 0.88 + 0.12 * afNoise( afP / 5.0 ) );
paintCol = mix( paintCol, base, rubber * 0.7 );
diffuseColor.rgb = mix( base, paintCol, paint );
afPaintAmount = paint;
`;

const RWY_ASPHALT = /* glsl */ `
vec3 afAsphaltRwy( vec2 p, float foot ) {
  float aggregate = afNoiseAA( p, 1.0 / 0.08, foot );
  float pebble = afNoiseAA( p + 5.0, 1.0 / 0.35, foot );
  float wear = afNoise( p / 41.0 ) * 0.6 + afNoise( p / 9.0 ) * 0.4;
  vec3 c = vec3( 0.074, 0.076, 0.079 );
  c *= 0.86 + 0.28 * wear;
  c *= 0.9 + 0.2 * aggregate;
  c *= 0.93 + 0.14 * pebble;
  return c;
}
`;

export function createRunwayMaterial(uniforms, lift, { apron = APRON_ON } = {}) {
  const m = new MeshStandardMaterial({ color: new Color(1, 1, 1), roughness: 0.86, metalness: 0 });
  m.name = 'airfield-runway';
  let text = { decl: `${RWY_ASPHALT}\n${RWY_DECL}\nfloat afPaintAmount = 0.0;`, color: RWY_FRAG };
  if (apron) {
    text = apronRunway(text);
    m.userData.afApron = true;
  }
  return patch(m, 'runway', {
    uniforms,
    lift,
    vertDecl: 'attribute vec3 aRwy;\nvarying vec3 vAfRwy;',
    vertBody: 'vAfRwy = aRwy;',
    fragDecl: text.decl,
    color: text.color,
    // Paint is smoother (glass beads) than the surrounding surface.
    roughness: 'roughnessFactor = mix( 0.88 + ( afNoiseAA( afP + 2.0, 2.0, afFoot ) - 0.5 ) * 0.1, 0.62, afPaintAmount );',
  });
}

// --- paint --------------------------------------------------------------------------

const PAINT_FRAG = /* glsl */ `
float u = vAfPaint.x, v = vAfPaint.y, type = floor( vAfPaint.z + 0.5 );
float wu = max( fwidth( u ), 1e-4 ), wv = max( fwidth( v ), 1e-4 );
vec3 yellow = vec3( 0.62, 0.40, 0.035 ) * ( 0.88 + 0.12 * afNoise( afP / 4.0 ) );
float cov = 0.0;
vec3 col = yellow;
float alpha = 0.0;
if ( type < 0.5 ) {
  // Taxiway centreline (0.3 m) with the nose-gear rubber smeared along it.
  float line = afBand( u, -0.15, 0.15, wu );
  float rub = exp( -pow( u / 1.1, 2.0 ) ) * ( 0.35 + 0.65 * afNoiseAA( vec2( v / 9.0, u * 1.7 ), 1.0, wu * 1.7 ) );
  rub *= 0.38;
  col = mix( vec3( 0.025, 0.024, 0.024 ), yellow, line );
  alpha = max( line, rub );
} else if ( type < 1.5 ) {
  // Double edge line: two 0.15 m lines, 0.15 m apart, just inside the edge.
  float l1 = afBand( u, 0.15, 0.3, wu );
  float l2 = afBand( u, -0.15, 0.0, wu );
  alpha = max( l1, l2 );
} else {
  // Runway holding position: two solid then two dashed lines (0.3 m wide,
  // 0.3 m apart), the dashed side toward the runway.
  float across = afBand( abs( u ), 0.0, vAfPaint.w - 0.4, wu );
  float solid = max( afBand( v, 0.0, 0.3, wv ), afBand( v, 0.6, 0.9, wv ) );
  float dashes = afPulse( ( u + 0.45 ) / 1.8, 0.5, wu / 1.8 );
  float dashed = max( afBand( v, 1.2, 1.5, wv ), afBand( v, 1.8, 2.1, wv ) ) * dashes;
  alpha = max( solid, dashed ) * across;
}
if ( alpha < 0.004 ) discard;
diffuseColor.rgb = col;
diffuseColor.a = alpha;
`;

export function createPaintMaterial(uniforms, lift, { apron = APRON_ON } = {}) {
  const m = new MeshStandardMaterial({ color: new Color(1, 1, 1), roughness: 0.6, metalness: 0, transparent: true, depthWrite: false });
  m.name = 'airfield-paint';
  let text = { decl: 'varying vec4 vAfPaint;', color: PAINT_FRAG };
  if (apron) {
    text = apronPaint(text);
    m.userData.afApron = true;
  }
  return patch(m, 'paint', {
    uniforms,
    lift,
    vertDecl: 'attribute vec4 aPaint;\nvarying vec4 vAfPaint;',
    vertBody: 'vAfPaint = aPaint;',
    fragDecl: text.decl,
    color: text.color,
  });
}
