// Shared operator paint for the instanced live fleet. A single small atlas,
// one palette and one float per instance; never one material per airline.
import { CanvasTexture, DataTexture, LinearFilter, NearestFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import { OPERATOR_LIVERIES as SCHEMES, liveryForAircraft } from './operator-liveries.mjs';
import { OPERATOR_LIVERIES } from './fly-constants.js';
import { pinned } from './fly-pins.js';

export const operatorLiveriesOn = () => pinned(OPERATOR_LIVERIES, '__flyOperatorLiveriesOverride').enabled === true;
export const OPERATOR_PALETTE_START = 256;
const COLS = 8, CELL_W = 256, CELL_H = 128;
export const MARK_ROWS = Math.ceil(SCHEMES.length / COLS);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const EMPTY_META = Object.freeze({});

/** Keep every neutral row byte-for-byte; operator rows have two extra inks. */
export function buildOperatorPaletteData(neutral) {
  const data = new Uint8Array((OPERATOR_PALETTE_START + SCHEMES.length) * 10 * 4);
  for (let i = 0; i < OPERATOR_PALETTE_START; i++) data.set(neutral.subarray(i * 32, i * 32 + 32), i * 40);
  for (const scheme of SCHEMES) {
    const row = OPERATOR_PALETTE_START + scheme.index;
    for (const [slot, key] of ['body', 'belly', 'fin', 'nacelle', 'wing', 'accent', 'radome', null, 'ink', 'tailInk'].entries()) {
      if (key) data.set([...rgb(scheme.colors[key]), 255], (row * 10 + slot) * 4);
    }
    data.set([scheme.bellyStyle === 2 ? 255 : scheme.bellyStyle === 1 ? 128 : 0, scheme.cheat ? 255 : 0, ['southwest', 'stripes'].includes(scheme.tail) ? 255 : 0, 128], (row * 10 + 7) * 4);
  }
  return data;
}

/** Cache values, including same-object feed updates; no work on quiet frames. */
export function resolveTrackLivery(track, paletteClass) {
  const m = track.meta ?? EMPTY_META;
  const prior = track.operatorLivery;
  if (prior && prior.meta === m && prior.flight === m.flight && prior.callsign === m.callsign && prior.r === m.r && prior.t === m.t && prior.iconType === m.iconType && prior.dbFlags === m.dbFlags && prior.military === m.military && prior.paletteClass === paletteClass) return prior.scheme;
  const scheme = liveryForAircraft(m, paletteClass);
  track.operatorLivery = { meta: m, flight: m.flight, callsign: m.callsign, r: m.r, t: m.t, iconType: m.iconType, dbFlags: m.dbFlags, military: m.military, paletteClass, scheme };
  return scheme;
}

function polygon(c, color, points) {
  c.fillStyle = color; c.beginPath();
  points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.closePath(); c.fill();
}

// First-party vector interpretations, not downloaded logos. These are
// representative schemes; a callsign cannot identify special/leased paint.
function tailMark(c, s) {
  const { accent, tailInk, body } = s.colors;
  c.save(); c.translate(64, 0);
  if (s.tail === 'delta') {
    polygon(c, '#e51937', [[65, 7], [22, 68], [65, 51]]);
    polygon(c, '#b4112b', [[65, 7], [65, 51], [108, 68]]);
  } else if (s.tail === 'southwest') {
    polygon(c, '#efc529', [[-64, 50], [192, -10], [192, 22], [-64, 82]]);
    polygon(c, '#e32135', [[-64, 72], [192, 12], [192, 43], [-64, 103]]);
  } else if (s.tail === 'united') {
    c.strokeStyle = tailInk; c.lineWidth = 2.5;
    c.beginPath(); c.ellipse(65, 39, 35, 32, -0.18, 0, Math.PI * 2); c.stroke();
    for (const w of [12, 24]) { c.beginPath(); c.ellipse(65, 39, w, 32, -0.18, 0, Math.PI * 2); c.stroke(); }
    for (const y of [20, 39, 58]) { c.beginPath(); c.ellipse(65, y, y === 39 ? 35 : 28, 6, -0.18, 0, Math.PI * 2); c.stroke(); }
  } else if (s.tail === 'roundel') {
    for (const [r, col] of [[29, '#183a69'], [20, '#f2f3f1'], [11, '#be343b']]) { c.fillStyle = col; c.beginPath(); c.arc(65, 39, r, 0, Math.PI * 2); c.fill(); }
  } else if (s.tail === 'stripes') {
    polygon(c, accent, [[-64, 49], [192, -15], [192, 6], [-64, 70]]);
    polygon(c, tailInk, [[-64, 72], [192, 8], [192, 19], [-64, 83]]);
    c.fillStyle = body; c.font = 'bold 28px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(s.code, 68, 48, 100);
  } else if (s.code) {
    c.fillStyle = tailInk; c.font = 'bold 39px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(s.code, 65, 38, 116);
    c.fillStyle = accent; c.fillRect(19, 63, 92, 4);
  }
  c.restore();
}

export function createOperatorMarkings() {
  if (typeof document === 'undefined') return new DataTexture(new Uint8Array(4), 1, 1);
  const canvas = document.createElement('canvas');
  canvas.width = COLS * CELL_W; canvas.height = MARK_ROWS * CELL_H;
  const c = canvas.getContext('2d');
  if (!c) return new DataTexture(new Uint8Array(4), 1, 1);
  for (const s of SCHEMES) {
    c.save(); c.translate((s.index % COLS) * CELL_W, Math.floor(s.index / COLS) * CELL_H);
    c.beginPath(); c.rect(0, 0, CELL_W, CELL_H); c.clip();
    c.fillStyle = s.colors.ink; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `${s.id === 'southwest' ? 'bold' : '600'} 28px Arial, sans-serif`;
    c.fillText(s.marking, 128, 21, 240);
    c.translate(0, 48); tailMark(c, s); c.restore();
  }
  const texture = new CanvasTexture(canvas);
  texture.name = 'fleet-operator-markings';
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

export function createOperatorResources(neutral) {
  const palette = new DataTexture(buildOperatorPaletteData(neutral), 10, OPERATOR_PALETTE_START + SCHEMES.length, RGBAFormat, UnsignedByteType);
  palette.name = 'fleet-operator-palette'; palette.colorSpace = SRGBColorSpace;
  palette.minFilter = palette.magFilter = NearestFilter;
  palette.generateMipmaps = false; palette.needsUpdate = true;
  const markings = createOperatorMarkings(); markings.needsUpdate = true;
  return { palette, markings, dispose() { palette.dispose(); markings.dispose(); } };
}

let resources = null, owners = 0;
/** Live procedural and legacy GLB pools share the same atlas, including remounts. */
export function retainOperatorResources(neutral) {
  if (!resources) resources = createOperatorResources(neutral);
  owners++;
  let released = false;
  return { palette: resources.palette, markings: resources.markings, dispose() {
    if (released) return;
    released = true;
    if (--owners === 0) { resources.dispose(); resources = null; }
  } };
}

export const OPERATOR_VERT_DECL = 'attribute float aFleetLivery; flat varying float vFleetLivery;';
export const OPERATOR_VERT_POS = 'vFleetLivery = aFleetLivery;';
export const OPERATOR_FRAG_DECL = /* glsl */ `
flat varying float vFleetLivery;
uniform sampler2D uFleetOperatorMarks;
uniform vec4 uFleetTitleBox;
uniform vec4 uFleetFinBox;
vec4 fleetOperatorMark(vec2 uv, bool tail) {
  if (vFleetLivery < .5 || any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) return vec4(0.);
  float idx = vFleetLivery - 1.;
  // Canvas top-left to texture bottom-left, with a two-pixel row gutter.
  vec2 cell = vec2(mod(idx, ${COLS}.), floor(idx / ${COLS}.));
  vec2 px = vec2(tail ? 66. + uv.x * 124. : 2. + uv.x * 252., tail ? 50. + (1. - uv.y) * 76. : 2. + (1. - uv.y) * 38.);
  vec2 at = (cell * vec2(${CELL_W}., ${CELL_H}.) + px) / vec2(${COLS * CELL_W}., ${MARK_ROWS * CELL_H}.);
  return texture2D(uFleetOperatorMarks, vec2(at.x, 1. - at.y));
}
`;
export const OPERATOR_ROW = `if (vFleetLivery > .5) row = ${OPERATOR_PALETTE_START} + int(vFleetLivery - .5);`;
// Before windows: doors and glazing retain their physical surface over paint.
export const OPERATOR_BODY = /* glsl */ `
if (vFleetLivery > .5 && side > 0.) {
  float titleStart = fleetShift(uFleetTitleBox.x), titleEnd = fleetShift(uFleetTitleBox.y);
  vec2 uv = vec2((s - titleStart) / (titleEnd - titleStart), (P.y - uFleetTitleBox.z) / uFleetTitleBox.w);
  if (P.x > 0.) uv.x = 1. - uv.x;
  vec4 mark = fleetOperatorMark(uv, false);
  fleetCol = mix(fleetCol, mark.rgb, mark.a * side);
}
`;
export const OPERATOR_FIN = /* glsl */ `
if (vFleetLivery > .5) {
  // Flat projection keeps circles and lettering rigid on a tapered fin.
  float finZ = uFleetFinBox.x + vFleetInst.w;
  vec2 uv = flags.b > .5 ? vFleetUv : vec2((P.z - finZ) / uFleetFinBox.z + .5, (P.y - uFleetFinBox.y) / uFleetFinBox.w + .5);
  if (P.x > 0.) uv.x = 1. - uv.x;
  vec4 mark = fleetOperatorMark(uv, true);
  fleetCol = mix(fleetCol, mark.rgb, mark.a * smoothstep(.3, .55, abs(N.x)));
}
`;
