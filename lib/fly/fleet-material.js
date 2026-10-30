// The live-traffic airframe material: one MeshPhysicalMaterial program shared
// by every family (fleet-types.js) and LOD, with per-family uniform values.
//
// Vertex side (no extra draws, no per-aircraft geometry):
//  - moving parts: each vertex's part id indexes the family part table
//    (pivot, axis, angle, travel) from live-aircraft-geometry.js; per-instance
//    gear / flaps / spoiler state drives it (gear legs swing into their bays,
//    Fowler flaps roll aft and down, spoilers rise on the rollout, props and
//    rotors spin);
//  - variant masks: winglet / engine options of a family are all in the mesh;
//    an instance's variant bits collapse the options it does not have;
//  - fuselage plugs: forward / aft sections slide by the instance's plug
//    lengths, so one A320-family mesh draws an A318 through an A321 (windows
//    are painted per metre, so they stay evenly pitched);
//  - wing bend under aerodynamic load.
//
// Fragment side: zone-based neutral paint, or callsign-matched operator paint
// behind OPERATOR_LIVERIES, procedural cabin windows, doors and
// cockpit glazing, the real registration on the aft fuselage of hero
// instances (factual data), polished leading edges and inlet lips, light
// weathering, warm cabin light and the tail logo flood at night.
//
// Rendering rules (FLY_OBSERVATION_LOUNGE.md): chained onBeforeCompile /
// customProgramCacheKey (world-bend air-anchor first, CSM after), no new
// lights, the lights_* anchors untouched.
import { CanvasTexture, DataTexture, FrontSide, LinearFilter, MeshDepthMaterial, MeshPhysicalMaterial, NearestFilter, RGBADepthPacking, RGBAFormat, SRGBColorSpace, UnsignedByteType, Vector4 } from 'three';
import { applyBendAirAnchor } from './toy-world/world-bend';
import { GLOBE } from './fly-constants';
import { PART_SLOTS, ZONE } from './live-aircraft-geometry';
import { airframeLayout, doorFrame } from './fleet-layout';
import { retainOperatorResources, operatorLiveriesOn, OPERATOR_VERT_DECL, OPERATOR_VERT_POS, OPERATOR_FRAG_DECL, OPERATOR_ROW, OPERATOR_BODY, OPERATOR_FIN } from './operator-livery-render.js';

export const PALETTE_ROWS = 256;
export const PALETTE = Object.freeze({ civil: [0, 192], ga: [192, 224], heli: [224, 240], military: [240, 256] });
export const REG_SLOTS = 8;

// --- Neutral palettes ----------------------------------------------------------

const srgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
function pick(rng, table) {
  let total = 0;
  for (const [, w] of table) total += w;
  let r = rng() * total;
  for (const [v, w] of table) if ((r -= w) <= 0) return v;
  return table[0][0];
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Whites dominate: most of the world's fleet is a white tube. Tail and
// accent tones are muted and solid (no marks, no logos, no stripes that copy
// a scheme).
const BODY = [['#f3f4f1', 6], ['#f1eee7', 3], ['#edf1f4', 3], ['#e6e9eb', 2], ['#d9dde0', 1], ['#c8d0d7', 0.5], ['#d6d0c3', 0.4]];
const BELLY = [['body', 5], ['#a3abb2', 2.5], ['#8d969d', 1.2], ['#b9bfc4', 1.5], ['#5a636c', 0.6]];
const FIN = [['body', 3.5], ['#c9ced2', 1], ['#4b5a6a', 1.6], ['#26344b', 1.6], ['#2b2e33', 1.4], ['#2f5e63', 1], ['#1f3b6b', 1.3], ['#5e2a2f', 0.9], ['#304b3c', 0.8], ['#7a7268', 0.8], ['#46617f', 1], ['#a8612f', 0.4], ['#8a3434', 0.4]];
const NACELLE = [['body', 4], ['fin', 2.2], ['#b7bdc2', 2], ['#a5aaaf', 1.4]];
const WING = [['#c4c9cd', 3], ['#b0b6bb', 3], ['#a3a9ae', 2]];
const RADOME = [['body', 7], ['#8a9197', 2], ['#3a3f45', 1]];
const MIL = [['#7e878d', 3], ['#6b747a', 2], ['#5c6469', 1.5], ['#8f989d', 1.5], ['#565d52', 0.6]];
const GA_ACCENT = [['#1f3561', 2], ['#7a1f24', 1.6], ['#1d4f7a', 1.6], ['#2e5a3a', 1], ['#5d4a2a', 0.8], ['#2a2d33', 1.2], ['#9a6a1f', 0.6]];
const HELI_BODY = [['#f2f2ef', 3], ['#1b2b4a', 1.2], ['#24262a', 1.2], ['#7a1d1d', 0.8], ['#d9dbdc', 1.2], ['#2d4a3a', 0.6], ['#c8a33a', 0.4]];

/** Build the 8 x 256 palette: [body, belly, fin, nacelle, wing, accent, radome, flags]. */
export function buildPaletteData(seed = 0x5ca1ab1e) {
  const data = new Uint8Array(8 * PALETTE_ROWS * 4);
  const put = (row, slot, rgb, a = 255) => data.set([rgb[0], rgb[1], rgb[2], a], (row * 8 + slot) * 4);
  for (let row = 0; row < PALETTE_ROWS; row++) {
    const rng = mulberry(seed + row * 7919);
    let body, belly, fin, nac, wing, accent, radome, bellyStyle = 0, cheat = 0;
    if (row >= PALETTE.military[0]) {
      body = srgb(pick(rng, MIL));
      belly = body; fin = body; nac = body; wing = body;
      accent = body; radome = srgb('#3e4448');
    } else if (row >= PALETTE.heli[0]) {
      body = srgb(pick(rng, HELI_BODY));
      belly = rng() < 0.5 ? body : srgb('#2a2d31');
      fin = body; nac = body; wing = srgb('#4a4f55');
      accent = srgb(pick(rng, GA_ACCENT)); radome = body;
      cheat = rng() < 0.5 ? 1 : 0;
    } else if (row >= PALETTE.ga[0]) {
      body = srgb(pick(rng, [['#f4f4f1', 6], ['#eceae3', 2], ['#e3e7ea', 1]]));
      belly = body; wing = body; nac = body; radome = body;
      accent = srgb(pick(rng, GA_ACCENT));
      fin = rng() < 0.35 ? accent : body;
      cheat = rng() < 0.85 ? 1 : 0;
    } else {
      const b = pick(rng, BODY);
      body = srgb(b);
      const be = pick(rng, BELLY);
      belly = be === 'body' ? body : srgb(be);
      bellyStyle = be === 'body' ? 0 : 1 + Math.floor(rng() * 2); // 1 low belly, 2 high belly line
      const fi = pick(rng, FIN);
      fin = fi === 'body' ? body : srgb(fi);
      const na = pick(rng, NACELLE);
      nac = na === 'body' ? body : na === 'fin' ? fin : srgb(na);
      wing = srgb(pick(rng, WING));
      accent = rng() < 0.5 ? fin : srgb(pick(rng, FIN.filter(([v]) => v !== 'body')));
      const ra = pick(rng, RADOME);
      radome = ra === 'body' ? body : srgb(ra);
      cheat = fi !== 'body' && rng() < 0.22 ? 1 : 0;
    }
    put(row, 0, body); put(row, 1, belly); put(row, 2, fin); put(row, 3, nac);
    put(row, 4, wing); put(row, 5, accent); put(row, 6, radome);
    // Flags ride the sRGB texture too: 0 / 128 / 255 decode to 0 / ~0.22 / 1.
    put(row, 7, [bellyStyle === 0 ? 0 : bellyStyle === 1 ? 128 : 255, cheat * 255, Math.floor(rng() * 255)], Math.floor(rng() * 255));
  }
  return data;
}

/** Palette row for an airframe: per operator (consistent fleets) within its class. */
export function paletteRow(paletteClass, seed) {
  const [a, b] = PALETTE[paletteClass] ?? PALETTE.civil;
  return a + (seed % (b - a));
}

let sharedPalette = null;
export function fleetPaletteTexture() {
  if (sharedPalette) return sharedPalette;
  const tex = new DataTexture(buildPaletteData(), 8, PALETTE_ROWS, RGBAFormat, UnsignedByteType);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  sharedPalette = tex;
  return tex;
}

// --- Registration atlas -------------------------------------------------------

/**
 * A small canvas of REG_SLOTS rows; each hero instance that shows its real
 * registration (meta.r) borrows a row. Text is the published registration only.
 */
export class RegistrationAtlas {
  constructor() {
    this.slots = new Array(REG_SLOTS).fill(null); // { reg, owner, used }
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (this.canvas) {
      this.canvas.width = 1024;
      this.canvas.height = REG_SLOTS * 64;
      this.ctx = this.canvas.getContext('2d');
      this.texture = new CanvasTexture(this.canvas);
      this.texture.minFilter = LinearFilter;
      this.texture.generateMipmaps = false;
    } else this.texture = null;
    this.frame = 0;
  }
  begin() {
    this.frame++;
  }
  /** Slot for a registration (stable while it stays in use). -1 if none. */
  slot(reg) {
    if (!reg || !this.ctx) return -1;
    let free = -1, oldest = -1, oldestFrame = Infinity;
    for (let i = 0; i < REG_SLOTS; i++) {
      const s = this.slots[i];
      if (s?.reg === reg) { s.used = this.frame; return i; }
      if (!s) { if (free < 0) free = i; }
      else if (s.used < this.frame - 1 && s.used < oldestFrame) { oldest = i; oldestFrame = s.used; }
    }
    const i = free >= 0 ? free : oldest;
    if (i < 0) return -1;
    this.slots[i] = { reg, used: this.frame };
    this.draw(i, reg);
    return i;
  }
  draw(i, reg) {
    const c = this.ctx, y = i * 64;
    c.clearRect(0, y, 1024, 64);
    c.fillStyle = '#fff';
    c.textBaseline = 'middle';
    c.textAlign = 'center';
    c.font = '700 54px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    const text = String(reg).toUpperCase().slice(0, 10);
    // Letter-spaced like painted markings.
    const spacing = 6, widths = [...text].map((ch) => c.measureText(ch).width + spacing);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = 512 - total / 2;
    for (let k = 0; k < text.length; k++) { c.fillText(text[k], x + widths[k] / 2, y + 33); x += widths[k]; }
    this.texture.needsUpdate = true;
    this.chars = text.length;
  }
  dispose() {
    this.texture?.dispose();
  }
}

// --- Shader -------------------------------------------------------------------

const VERT_DECL = /* glsl */ `
attribute vec4 aFleetPart;
attribute float aFleetFlex;
attribute vec2 aFleetUv;
attribute vec4 aFleetA; // instanced: gear, flaps, spoiler, aerodynamic load
attribute vec4 aFleetB; // instanced: palette + 256 * variant + 65536 * (reg slot + 1), seed, plug fwd, plug aft
uniform vec4 uFleetPartA[ ${PART_SLOTS} ];
uniform vec4 uFleetPartB[ ${PART_SLOTS} ];
uniform vec4 uFleetPartC[ ${PART_SLOTS} ];
uniform float uFleetTime;
uniform vec4 uFleetBody; // half length, half height, plug fwd station, plug aft station
varying vec3 vFleetLocal;
varying vec3 vFleetNormal;
varying vec2 vFleetUv;
varying float vFleetStation;
flat varying float vFleetZone;
flat varying vec4 vFleetInst;
mat3 fleetAxisAngle( vec3 k, float a ) {
  float c = cos( a ), s = sin( a ), t = 1.0 - c;
  return mat3( t * k.x * k.x + c, t * k.x * k.y + s * k.z, t * k.x * k.z - s * k.y,
               t * k.x * k.y - s * k.z, t * k.y * k.y + c, t * k.y * k.z + s * k.x,
               t * k.x * k.z + s * k.y, t * k.y * k.z - s * k.x, t * k.z * k.z + c );
}
`;

// Runs right after <beginnormal_vertex>: evaluates the moving part once and
// rotates the normal; <begin_vertex> below moves the position.
const VERT_PART = /* glsl */ `
mat3 fleetRot = mat3( 1.0 );
vec3 fleetPivot = vec3( 0.0 ), fleetMove = vec3( 0.0 );
float fleetHide = 0.0;
{
  int pid = int( aFleetPart.y + 0.5 );
  if ( pid > 0 ) {
    vec4 A = uFleetPartA[ pid ], B = uFleetPartB[ pid ], C = uFleetPartC[ pid ];
    int drv = int( A.w + 0.5 );
    float k = 0.0, ang = 0.0;
    if ( drv == 1 ) { k = 1.0 - aFleetA.x; ang = k * B.w; fleetHide = step( 0.985, k ); }
    else if ( drv == 2 || drv == 5 ) { k = aFleetA.y; ang = k * B.w; }
    else if ( drv == 3 ) { k = aFleetA.z; ang = k * B.w; fleetHide = step( k, 0.015 ); }
    else if ( drv == 4 ) { ang = 6.2831853 * fract( uFleetTime * C.w + aFleetB.y * 0.000917 ); }
    fleetRot = fleetAxisAngle( B.xyz, ang );
    fleetPivot = A.xyz;
    fleetMove = drv == 4 ? vec3( 0.0 ) : C.xyz * k;
  }
}
objectNormal = fleetRot * objectNormal;
`;

const VERT_POS = /* glsl */ `
transformed = fleetRot * ( transformed - fleetPivot ) + fleetPivot + fleetMove;
{
  int vmask = int( aFleetPart.z + 0.5 );
  int ibits = int( mod( floor( aFleetB.x / 256.0 ), 256.0 ) );
  if ( vmask != 0 && ( vmask & ibits ) == 0 ) fleetHide = 1.0;
}
transformed.y += aFleetFlex * aFleetA.w;
transformed.z += aFleetPart.w < -0.5 ? -aFleetB.z : ( aFleetPart.w > 0.5 ? aFleetB.w : 0.0 );
if ( fleetHide > 0.5 ) transformed = vec3( 0.0 );
vFleetLocal = transformed;
vFleetNormal = objectNormal;
vFleetUv = aFleetUv;
vFleetStation = transformed.z + uFleetBody.x + aFleetB.z;
vFleetZone = aFleetPart.x;
vFleetInst = aFleetB;
`;

const FRAG_DECL = /* glsl */ `
uniform sampler2D uFleetPalette;
uniform sampler2D uFleetReg;
uniform vec4 uFleetBody;      // half length, half height, plug fwd station, plug aft station
uniform vec4 uFleetWin;       // pitch, width, height, centre y
uniform vec4 uFleetWinRange;  // from, to (base stations), row-2 from, row-2 to
uniform vec4 uFleetWin2;      // row-2 centre y, oval (0/1), windows on (0/1), side half-width
uniform vec4 uFleetDoors[ 6 ];// station, width, kind (0 door, 1 exit, -1 none), sill y
uniform vec4 uFleetCockpit;   // s0, s1, bottom y, top y (metres)
uniform vec4 uFleetCockpit2;  // rear top y, post 1, post 2, nose length
uniform vec4 uFleetRegBox;    // s0, s1 (base, aft section), centre y, letter height
uniform vec4 uFleetNight;     // cabin light, logo flood, lens glow, 0
uniform vec4 uFleetFlood;     // apron floodlight radiance on this material's airframes (rgb), 0
varying vec3 vFleetLocal;
varying vec3 vFleetNormal;
varying vec2 vFleetUv;
varying float vFleetStation;
flat varying float vFleetZone;
flat varying vec4 vFleetInst;
vec3 fleetPal( int slot, int row ) { return texelFetch( uFleetPalette, ivec2( slot, row ), 0 ).rgb; }
float fleetHash( vec2 p ) { vec3 q = fract( vec3( p.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
float fleetNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( fleetHash( i ), fleetHash( i + vec2( 1, 0 ) ), f.x ), mix( fleetHash( i + vec2( 0, 1 ) ), fleetHash( i + vec2( 1, 1 ) ), f.x ), f.y ); }
float fleetBox( vec2 p, vec2 b, float r ) { vec2 q = abs( p ) - b + r; return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - r; }
// Anti-aliased "inside" for a signed distance in metres.
float fleetIn( float d ) { float w = max( fwidth( d ), 1e-4 ); return 1.0 - smoothstep( -w, w, d ); }
// Final station of a base station (plugs move the sections).
float fleetShift( float s ) { return s + ( s > uFleetBody.z ? vFleetInst.z : 0.0 ) + ( s > uFleetBody.w ? vFleetInst.w : 0.0 ); }
`;

// Evaluated at <color_fragment>: the surface's colour, BRDF inputs and glow.
const FRAG_SURFACE = /* glsl */ `
vec3 fleetCol = vec3( 0.8 );
float fleetRough = 0.42, fleetMetal = 0.05, fleetCC = 0.0, fleetCCR = 0.2;
vec3 fleetEmit = vec3( 0.0 );
{
  int zone = int( vFleetZone + 0.5 );
  float packed = vFleetInst.x;
  int row = int( mod( packed, 256.0 ) );
  int vbits = int( mod( floor( packed / 256.0 ), 256.0 ) );
  float regSlot = floor( packed / 65536.0 ) - 1.0;
  vec3 cBody = fleetPal( 0, row ), cBelly = fleetPal( 1, row ), cFin = fleetPal( 2, row );
  vec3 cNac = fleetPal( 3, row ), cWing = fleetPal( 4, row ), cAccent = fleetPal( 5, row ), cRadome = fleetPal( 6, row );
  vec4 flags = texelFetch( uFleetPalette, ivec2( 7, row ), 0 );
  vec3 P = vFleetLocal, N = normalize( vFleetNormal );
  float s = vFleetStation, hh = uFleetBody.y;
  float grime = fleetNoise( vec2( s * 0.35, P.y * 1.3 ) ) * 0.6 + fleetNoise( vec2( s * 1.7, P.y * 4.0 ) ) * 0.4;
  if ( zone == ${ZONE.BODY} ) {
    fleetCol = cBody; fleetRough = 0.32; fleetMetal = 0.04; fleetCC = 0.75; fleetCCR = 0.1;
    // Two-tone belly (flags.r: 0 none, ~0.22 low line, 1 high line).
    if ( flags.r > 0.1 ) {
      float line = ( flags.r > 0.6 ? -0.18 : -0.5 ) * hh;
      fleetCol = mix( fleetCol, cBelly, fleetIn( P.y - line ) );
    }
    // Radome and nose cap.
    fleetCol = mix( fleetCol, cRadome, fleetIn( s - uFleetCockpit2.w * 0.24 ) );
    float side = smoothstep( 0.3, 0.55, abs( N.x ) );
    // Cheat line under the windows.
    if ( flags.g > 0.5 && uFleetWin2.z > 0.5 ) {
      float yb = uFleetWin.w - uFleetWin.z * 0.5 - 0.09;
      float band = fleetIn( abs( P.y - yb ) - 0.05 ) * step( uFleetCockpit2.w * 0.6, s ) * step( s, fleetShift( uFleetWinRange.y ) + 2.0 );
      fleetCol = mix( fleetCol, cAccent, band * side );
    }
    // Cabin windows and doors.
    float win = 0.0, frame = 0.0;
    float sFrom = uFleetWinRange.x, sTo = fleetShift( uFleetWinRange.y );
    bool freighter = ( vbits & ${128} ) != 0;
    if ( uFleetWin2.z > 0.5 && side > 0.0 ) {
      float pitch = uFleetWin.x;
      vec2 half_ = vec2( uFleetWin.y, uFleetWin.z ) * 0.5;
      float rad = uFleetWin2.y > 0.5 ? min( half_.x, half_.y ) * 0.95 : min( half_.x, half_.y ) * 0.55;
      float doorGap = 0.0;
      for ( int i = 0; i < 6; i++ ) {
        vec4 d = uFleetDoors[ i ];
        if ( d.z < -0.5 ) continue;
        float ds = fleetShift( d.x );
        float dh = d.z > 0.5 ? 1.0 : clamp( uFleetBody.y * 1.3, 1.45, 1.88 );
        vec2 dp = vec2( s - ds, P.y - ( d.w + dh * 0.5 ) );
        float db = fleetBox( dp, vec2( d.y * 0.5, dh * 0.5 ), 0.14 );
        frame = max( frame, fleetIn( abs( db ) - 0.013 ) );
        doorGap = max( doorGap, fleetIn( abs( s - ds ) - d.y * 0.5 - pitch * 0.45 ) );
        // The door's own small window.
        if ( !freighter ) win = max( win, fleetIn( fleetBox( vec2( s - ds, P.y - uFleetWin.w ), half_ * 0.9, rad ) ) );
      }
      if ( !freighter ) {
        float idx = floor( ( s - sFrom ) / pitch );
        vec2 wp = vec2( ( s - sFrom ) - ( idx + 0.5 ) * pitch, P.y - uFleetWin.w );
        float inRow = step( sFrom, s ) * step( s, sTo ) * ( 1.0 - doorGap );
        win = max( win, fleetIn( fleetBox( wp, half_, rad ) ) * inRow );
        // Second deck (747 upper deck, A380).
        if ( uFleetWinRange.w > uFleetWinRange.z ) {
          float s2From = uFleetWinRange.z, s2To = fleetShift( uFleetWinRange.w );
          float idx2 = floor( ( s - s2From ) / pitch );
          vec2 wp2 = vec2( ( s - s2From ) - ( idx2 + 0.5 ) * pitch, P.y - uFleetWin2.x );
          win = max( win, fleetIn( fleetBox( wp2, half_, rad ) ) * step( s2From, s ) * step( s, s2To ) );
        }
      }
      win *= side;
      frame *= side;
      // Night cabin: warm light, a few dark windows.
      float lit = step( 0.22, fleetHash( vec2( floor( ( s - sFrom ) / pitch ), P.y > uFleetWin.w + 0.8 ? 7.0 : 3.0 ) + vFleetInst.y ) );
      fleetEmit += vec3( 1.0, 0.74, 0.46 ) * uFleetNight.x * win * lit * ( freighter ? 0.0 : 1.0 );
    }
    fleetCol = mix( fleetCol, fleetCol * 0.42, frame );
    // Cockpit glazing (side-view outline; posts between panes).
    if ( uFleetCockpit.y > uFleetCockpit.x ) {
      float u = clamp( ( s - uFleetCockpit.x ) / ( uFleetCockpit.y - uFleetCockpit.x ), 0.0, 1.0 );
      float yt = mix( uFleetCockpit.w, uFleetCockpit2.x, u );
      // The rear edge leans forward toward the roof, like real side windows.
      float rear = uFleetCockpit.y - ( P.y - uFleetCockpit.z ) * 0.35;
      float inS = fleetIn( uFleetCockpit.x - s ) * fleetIn( s - rear );
      float inY = fleetIn( uFleetCockpit.z - P.y ) * fleetIn( P.y - yt );
      float posts = fleetIn( abs( s - uFleetCockpit2.y ) - 0.035 ) + fleetIn( abs( s - uFleetCockpit2.z ) - 0.035 ) + fleetIn( abs( P.x ) - 0.04 ) * step( 0.6, -N.z );
      float glass = inS * inY * ( 1.0 - clamp( posts, 0.0, 1.0 ) );
      win = max( win, glass );
    }
    fleetCol = mix( fleetCol, vec3( 0.018, 0.022, 0.028 ), win );
    fleetRough = mix( fleetRough, 0.06, win );
    fleetCC = mix( fleetCC, 1.0, win );
    fleetCCR = mix( fleetCCR, 0.03, win );
    // Real registration on the aft fuselage (hero instances only).
    if ( regSlot >= 0.0 && side > 0.0 ) {
      float s0 = fleetShift( uFleetRegBox.x ), s1 = fleetShift( uFleetRegBox.y );
      float uu = ( s - s0 ) / ( s1 - s0 );
      if ( P.x > 0.0 ) uu = 1.0 - uu;
      float vv = ( P.y - ( uFleetRegBox.z - uFleetRegBox.w * 0.5 ) ) / uFleetRegBox.w;
      if ( uu > 0.0 && uu < 1.0 && vv > 0.0 && vv < 1.0 ) {
        float ink = texture2D( uFleetReg, vec2( uu, ( ${REG_SLOTS}.0 - 1.0 - regSlot + vv ) / ${REG_SLOTS}.0 ) ).a * side;
        float lum = dot( fleetCol, vec3( 0.2126, 0.7152, 0.0722 ) );
        fleetCol = mix( fleetCol, lum > 0.25 ? vec3( 0.045, 0.05, 0.06 ) : vec3( 0.86 ), ink );
      }
    }
    // Weathering: grime toward the belly and aft, APU soot at the tail cone.
    float low = smoothstep( 0.1 * hh, -0.9 * hh, P.y );
    fleetCol *= 1.0 - ( 0.045 + 0.06 * smoothstep( 0.6, 1.0, s / ( 2.0 * uFleetBody.x ) ) ) * low * grime;
    float apu = smoothstep( 2.0 * uFleetBody.x + vFleetInst.z + vFleetInst.w - 2.2, 2.0 * uFleetBody.x + vFleetInst.z + vFleetInst.w, s );
    fleetCol = mix( fleetCol, vec3( 0.05, 0.045, 0.04 ), apu * 0.55 );
  } else if ( zone == ${ZONE.WING} || zone == ${ZONE.STAB} ) {
    fleetCol = zone == ${ZONE.STAB} ? mix( cWing, cBody, 0.5 ) : cWing;
    fleetRough = 0.5; fleetMetal = 0.12; fleetCC = 0.25; fleetCCR = 0.25;
    // Polished leading-edge strip (bare de-icing metal).
    float le = fleetIn( vFleetUv.x - 0.035 );
    fleetCol = mix( fleetCol, vec3( 0.62, 0.64, 0.66 ), le );
    fleetMetal = mix( fleetMetal, 0.85, le );
    fleetRough = mix( fleetRough, 0.24, le );
    fleetCol *= 1.0 - 0.06 * grime * smoothstep( 0.55, 1.0, vFleetUv.x );
  } else if ( zone == ${ZONE.FIN} ) {
    fleetCol = cFin; fleetRough = 0.32; fleetMetal = 0.04; fleetCC = 0.75; fleetCCR = 0.1;
    // Logo flood lamps light the fin from the stabiliser roots at night.
    float flood = uFleetNight.y * mix( 1.0, 0.25, clamp( vFleetUv.y, 0.0, 1.0 ) ) * smoothstep( 0.05, 0.25, abs( N.x ) );
    fleetEmit += fleetCol * vec3( 1.0, 0.94, 0.86 ) * flood * 0.9;
  } else if ( zone == ${ZONE.NACELLE} ) {
    fleetCol = cNac; fleetRough = 0.34; fleetMetal = 0.05; fleetCC = 0.6; fleetCCR = 0.12;
    fleetCol *= 1.0 - 0.35 * smoothstep( 0.8, 1.0, vFleetUv.x ) * grime;
  } else if ( zone == ${ZONE.METAL} ) {
    fleetCol = vec3( 0.6, 0.62, 0.64 ); fleetRough = 0.22; fleetMetal = 0.9;
  } else if ( zone == ${ZONE.DARK} ) {
    fleetCol = vec3( 0.024, 0.026, 0.03 ); fleetRough = 0.6; fleetMetal = 0.2;
  } else if ( zone == ${ZONE.GLASS} ) {
    fleetCol = vec3( 0.02, 0.025, 0.03 ); fleetRough = 0.05; fleetCC = 1.0; fleetCCR = 0.03;
  } else if ( zone == ${ZONE.GEAR} ) {
    fleetCol = vec3( 0.72, 0.73, 0.74 ); fleetRough = 0.45; fleetMetal = 0.3;
  } else if ( zone == ${ZONE.TIRE} ) {
    fleetCol = vec3( 0.028 ); fleetRough = 0.9;
  } else if ( zone == ${ZONE.HUB} ) {
    fleetCol = vec3( 0.46, 0.47, 0.48 ); fleetRough = 0.38; fleetMetal = 0.65;
  } else if ( zone == ${ZONE.PROP} ) {
    fleetCol = vec3( 0.07, 0.072, 0.075 ); fleetRough = 0.5; fleetMetal = 0.2;
  } else if ( zone == ${ZONE.ACCENT} ) {
    fleetCol = cAccent; fleetRough = 0.32; fleetCC = 0.7; fleetCCR = 0.1;
  } else if ( zone == ${ZONE.FAIRING} ) {
    fleetCol = flags.r > 0.1 ? cBelly : mix( cBody, cWing, 0.35 ); fleetRough = 0.36; fleetCC = 0.6; fleetCCR = 0.12;
    fleetCol *= 1.0 - 0.07 * grime;
  } else {
    // Light lenses: red / green / white. A faint self-glow reads up close.
    vec3 lens = zone == ${ZONE.LENS_R} ? vec3( 0.75, 0.04, 0.03 ) : zone == ${ZONE.LENS_G} ? vec3( 0.04, 0.6, 0.18 ) : vec3( 0.9 );
    fleetCol = lens * 0.5; fleetRough = 0.1; fleetCC = 1.0; fleetCCR = 0.05;
    fleetEmit += lens * uFleetNight.z;
  }
}
// Apron floodlights (parked scenery at night): mostly from above.
fleetEmit += fleetCol * uFleetFlood.rgb * ( 0.3 + 0.7 * clamp( normalize( vFleetNormal ).y * 0.5 + 0.5, 0.0, 1.0 ) );
#if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )
  diffuseColor.rgb = fleetCol * vColor.rgb;
  fleetEmit *= vColor.rgb;
#else
  diffuseColor.rgb = fleetCol;
#endif
`;

function patch(src, pairs) {
  let out = src;
  for (const [needle, add, mode] of pairs) {
    if (!out.includes(needle)) throw Error(`fleet material: shader anchor missing: ${needle}`);
    out = out.replace(needle, mode === 'before' ? `${add}\n${needle}` : `${needle}\n${add}`);
  }
  return out;
}

const KEY = 'fleet-airframe-v2';

/**
 * Per-family values for the shared program (window rows, doors, cockpit,
 * registration box, plug stations) from the family's layout.
 */
export function familyUniforms(f, { far = false } = {}) {
  const L = airframeLayout(f);
  const win = f.win;
  // station, width, kind, sill (fuselage-axis relative): fleet-layout.doorFrame.
  const doors = new Array(6).fill(null).map((_, i) => {
    const d = doorFrame(f, i);
    return d ? [d.station, d.width, d.kind, d.sill] : [0, 0, -1, 0];
  });
  const cp = L.cockpit;
  const regLen = Math.min(4.6, f.length * 0.11);
  const regEnd = (L.tailStart ?? f.length * 0.8) - (f.fus?.tail ?? 4) * 0.05;
  return {
    body: [f.length / 2, L.hh, f.plug?.fwd ?? 1e6, f.plug?.aft ?? 1e6],
    win: win ? [win.pitch, win.w, win.h, win.y * L.hh] : [1, 0, 0, 0],
    winRange: win ? [win.from, win.to, win.row2?.from ?? 0, win.row2?.to ?? 0] : [0, 0, 0, 0],
    win2: [win?.row2 ? win.row2.y * L.hh : 0, win?.oval ? 1 : 0, win && !far ? 1 : 0, L.hw],
    doors,
    cockpit: f.helicopter || far ? [0, 0, 0, 0] : [cp.s0 * L.noseEnd, cp.s1 * L.noseEnd, cp.yb * L.hh, cp.yt * L.hh],
    cockpit2: f.helicopter ? [0, 0, 0, 1] : [cp.ytr * L.hh, cp.posts[0] * L.noseEnd, cp.posts[1] * L.noseEnd, L.noseEnd || 1],
    reg: [regEnd - regLen, regEnd, (win ? win.y * L.hh + win.h * 0.5 + 0.42 : L.hh * 0.45), Math.max(0.3, Math.min(0.62, L.hh * 0.18))],
  };
}

/**
 * The airframe material for one family (or a far-class silhouette). All
 * instances share one program; this material carries the family's uniform
 * values and part table.
 */
export function createFleetMaterial(f, parts, shared, { far = false } = {}) {
  const operators = !!shared.uFleetOperatorMarks;
  const m = new MeshPhysicalMaterial({
    roughness: 0.4,
    metalness: 0.05,
    clearcoat: 0.6,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1,
    side: FrontSide,
  });
  m.name = far ? `fleet-far:${f.id}` : `fleet:${f.id}`;
  applyBendAirAnchor(m, GLOBE.trafficBend);
  const v = familyUniforms(f, { far });
  const vec4 = (a) => new Vector4(a[0], a[1], a[2], a[3]);
  // Uniform ARRAYS go to three as flat Float32Arrays (its flatten() calls
  // toArray() on anything else).
  const uniforms = {
    uFleetPartA: { value: Float32Array.from(parts.A) },
    uFleetPartB: { value: Float32Array.from(parts.B) },
    uFleetPartC: { value: Float32Array.from(parts.C) },
    uFleetBody: { value: vec4(v.body) },
    uFleetWin: { value: vec4(v.win) },
    uFleetWinRange: { value: vec4(v.winRange) },
    uFleetWin2: { value: vec4(v.win2) },
    uFleetDoors: { value: Float32Array.from(v.doors.flat()) },
    uFleetCockpit: { value: vec4(v.cockpit) },
    uFleetCockpit2: { value: vec4(v.cockpit2) },
    uFleetRegBox: { value: vec4(v.reg) },
    uFleetFlood: { value: new Vector4(0, 0, 0, 0) },
  };
  if (operators) {
    const start = Math.max(f.fus.nose + 0.4, f.length * 0.16);
    uniforms.uFleetTitleBox = { value: new Vector4(start, Math.max(start + 1, f.length * 0.53), v.body[1] * 0.40, v.body[1] * 0.44) };
    const fin = airframeLayout(f).fin;
    const h = fin ? Math.min(fin.h * .72, (fin.root + fin.tip) * .28) : 1;
    uniforms.uFleetFinBox = { value: fin ? new Vector4(fin.le + fin.h * .5 * fin.sweep + (fin.root + fin.tip) * .25, fin.rootY + fin.h * .5, h * 124 / 76, h) : new Vector4(0, 0, 1, 1) };
    m.defaultAttributeValues = { ...m.defaultAttributeValues, aFleetLivery: [0] };
  }
  m.userData.fleet = uniforms;
  m.userData.fleetShared = shared;
  const before = m.onBeforeCompile, key = m.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer) => {
    before?.(shader, renderer);
    Object.assign(shader.uniforms, uniforms, shared);
    shader.vertexShader = patch(shader.vertexShader, [
      ['#include <common>', VERT_DECL + (operators ? OPERATOR_VERT_DECL : '')],
      ['#include <beginnormal_vertex>', VERT_PART],
      ['#include <begin_vertex>', VERT_POS + (operators ? OPERATOR_VERT_POS : '')],
    ]);
    const surface = operators ? patch(FRAG_SURFACE, [
      ['int vbits =', OPERATOR_ROW, 'before'],
      ['// Cabin windows and doors.', OPERATOR_BODY, 'before'],
      ['// Logo flood lamps', OPERATOR_FIN, 'before'],
    ]) : FRAG_SURFACE;
    shader.fragmentShader = patch(shader.fragmentShader, [
      ['#include <common>', FRAG_DECL + (operators ? OPERATOR_FRAG_DECL : '')],
      ['#include <color_fragment>', surface],
      ['#include <roughnessmap_fragment>', 'roughnessFactor = fleetRough;'],
      ['#include <metalnessmap_fragment>', 'metalnessFactor = fleetMetal;'],
      ['#include <lights_physical_fragment>', '#ifdef USE_CLEARCOAT\n  material.clearcoat = fleetCC;\n  material.clearcoatRoughness = min( max( fleetCCR, 0.0525 ) + geometryRoughness, 1.0 );\n#endif'],
      ['#include <emissivemap_fragment>', 'totalEmissiveRadiance += fleetEmit;'],
    ]);
  };
  m.customProgramCacheKey = () => `${key}|${KEY}${operators ? '|operator-v1' : ''}`;
  return m;
}

/**
 * Shadow-caster depth material for a fleet material's meshes: the same moving
 * parts, fuselage plugs and variant masks, so an A321 casts an A321's shadow
 * and only the selected wingtips/engines cast at all. (No air bend: casters
 * are parked or taxiing aircraft next to the observer, where it is nil.)
 */
export function createFleetDepthMaterial(material) {
  const uniforms = material.userData.fleet, shared = material.userData.fleetShared;
  const m = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  m.name = `${material.name}:depth`;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, shared);
    shader.vertexShader = patch(shader.vertexShader, [
      ['#include <common>', VERT_DECL],
      ['#include <begin_vertex>', `vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );
${VERT_PART}
${VERT_POS}`, 'after'],
    ]);
  };
  m.customProgramCacheKey = () => `${KEY}|depth`;
  return m;
}

/** Uniforms every fleet material shares by reference (clock, palette, atlas, night). */
export function createFleetShared(atlas) {
  const shared = {
    uFleetTime: { value: 0 },
    uFleetPalette: { value: fleetPaletteTexture() },
    uFleetReg: { value: atlas?.texture ?? null },
    uFleetNight: { value: new Vector4() },
  };
  // Static scenery has no callsign and keeps its existing neutral material.
  if (atlas && operatorLiveriesOn()) {
    const resources = retainOperatorResources(buildPaletteData());
    shared.uFleetPalette.value = resources.palette;
    shared.uFleetOperatorMarks = { value: resources.markings };
    Object.defineProperty(shared, 'disposeOperators', { value: () => resources.dispose() });
  }
  return shared;
}
