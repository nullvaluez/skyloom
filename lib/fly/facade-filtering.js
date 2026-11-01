/** Pixel coverage for a periodic facade, shared by the shader and its numerical
 * motion checks. A cell is a window plus its wall, in cycles per screen pixel.
 * Preserve resolved openings, then retire their contrast before Nyquist. The
 * replacement is the opening's area, so distant facades do not brighten/pop.
 */
export const FACADE_FILTER = Object.freeze({
  minifyStart: 0.20,
  minifyEnd: 0.50,
  // A .025-cell half-bevel is .05 cells wide. Keep it only while that
  // physical transition spans 2–4 pixels; window size is not bevel size.
  reliefStart: 0.0125,
  reliefEnd: 0.025,
  paneEdge: 0.025,
});

const clamp = (x, low = 0, high = 1) => Math.max(low, Math.min(high, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);

function pulseIntegral(x, duty) {
  return Math.floor(x) * duty + clamp(fract(x) - (1 - duty) * 0.5, 0, duty);
}

/** Exact interval coverage of a centred periodic opening, including pixel
 * intervals that straddle the cell boundary or span several complete cells. */
export function facadeCoverage(coordinate, duty, footprint) {
  const opening = clamp(duty), width = Math.max(Math.abs(footprint), 1e-5);
  // Work near zero: only phase matters, and subtracting huge integrals loses
  // precision on long walls. Keep the full footprint for multi-cell coverage.
  const phase = fract(coordinate);
  return clamp((pulseIntegral(phase + width * 0.5, opening)
    - pulseIntegral(phase - width * 0.5, opening)) / width);
}

export function facadeMinify(footprint) {
  return smooth(FACADE_FILTER.minifyStart, FACADE_FILTER.minifyEnd, Math.abs(footprint));
}

export function facadeReliefResolved(footprint) {
  return 1 - smooth(FACADE_FILTER.reliefStart, FACADE_FILTER.reliefEnd, Math.abs(footprint));
}

function paneAxis(coordinate, opening) {
  const local = fract(coordinate) - 0.5;
  const edge = Math.max(1e-4, Math.min(FACADE_FILTER.paneEdge, Math.min(opening, 1 - opening) * 0.25));
  const t = clamp((Math.abs(local) - opening * 0.5 + edge) / (2 * edge));
  return { value: 1 - t * t * (3 - 2 * t), slope: -Math.sign(local) * 6 * t * (1 - t) / (2 * edge) };
}

/** The fixed, smooth relief profile is intentionally independent of fwidth. */
export function facadePaneProfile(cell, opening) {
  return paneAxis(cell[0], opening[0]).value * paneAxis(cell[1], opening[1]).value;
}

/** Gradient of unit-height pane relief per facade metre. Multiply by physical
 * recess depth and facadeReliefResolved before converting to a screen slope. */
export function facadePaneSlope(cell, opening, pitch) {
  const x = paneAxis(cell[0], opening[0]), y = paneAxis(cell[1], opening[1]);
  return [x.slope * y.value / pitch[0], y.slope * x.value / pitch[1]];
}

/** Gradient per facade metre of the existing 3.5 cm broad glass bow. */
export function facadeGlassSlope(cell, pitch, seed) {
  const x = cell[0] * 1.31 + seed, y = cell[1] * 0.79 + seed * 0.37;
  return [Math.cos(x) * Math.sin(y) * 0.035 * 1.31 / pitch[0],
    Math.sin(x) * Math.cos(y) * 0.035 * 0.79 / pitch[1]];
}

const n = (x) => x.toFixed(5);
export const FACADE_FILTER_GLSL = `
float archPulseIntegral(float coordinate,float duty){
  return floor(coordinate)*duty+clamp(fract(coordinate)-(1.-duty)*.5,0.,duty);
}
float archCoverage(float coordinate,float duty,float footprint){
  float opening=clamp(duty,0.,1.),width=max(abs(footprint),.00001);
  float phase=fract(coordinate);
  return clamp((archPulseIntegral(phase+width*.5,opening)-archPulseIntegral(phase-width*.5,opening))/width,0.,1.);
}
float archMinify(float footprint){
  return smoothstep(${n(FACADE_FILTER.minifyStart)},${n(FACADE_FILTER.minifyEnd)},abs(footprint));
}
float archReliefResolved(float footprint){
  return 1.-smoothstep(${n(FACADE_FILTER.reliefStart)},${n(FACADE_FILTER.reliefEnd)},abs(footprint));
}
// x = profile height, y = its analytic derivative in cell coordinates.
vec2 archPaneAxis(float coordinate,float opening){
  float local=fract(coordinate)-.5;
  float edge=max(.0001,min(${n(FACADE_FILTER.paneEdge)},min(opening,1.-opening)*.25));
  float t=clamp((abs(local)-opening*.5+edge)/(2.*edge),0.,1.);
  return vec2(1.-t*t*(3.-2.*t),-sign(local)*6.*t*(1.-t)/(2.*edge));
}
vec2 archPaneSlope(vec2 cell,vec2 opening,vec2 pitch){
  vec2 x=archPaneAxis(cell.x,opening.x),y=archPaneAxis(cell.y,opening.y);
  return vec2(x.y*y.x,y.y*x.x)/pitch;
}
vec2 archGlassSlope(vec2 cell,vec2 pitch,float seed){
  vec2 phase=cell*vec2(1.31,.79)+vec2(seed,seed*.37);
  return vec2(cos(phase.x)*sin(phase.y)*1.31,sin(phase.x)*cos(phase.y)*.79)*.035/pitch;
}
`;
