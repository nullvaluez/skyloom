import { LOOK_LAYERS } from './fly-constants';
import { pinned } from './fly-pins';

/** LOOK PASS D (LAYERS): cloud strata, far-field silhouettes and the horizon: the stacked planes of the view.
 * The owner block with any `?flags=` or console pin applied; FLY_LOOK_PASS.md. */
export const LOOK_LAYERS_CFG = pinned(LOOK_LAYERS, '__flyLookLayersOverride');
export const LOOK_LAYERS_ON = LOOK_LAYERS_CFG.enabled === true;

const dial = (k) => (LOOK_LAYERS_ON ? Math.max(0, Number(LOOK_LAYERS_CFG[k] ?? 1)) : 0);
/** Master dials, 0 when the flag is off. A dial at 0 removes that layer's shader text too. */
export const LOOK_LAYERS_DIALS = { volume: dial('volume'), bank: dial('bank'), high: dial('high') };
// Defaults equal the tuned LOOK_LAYERS block (fly-constants.js), so a partial pin
// that replaces a sub-block falls back to the shipped look, not an older one.
export const LOOK_VOL = { occK: 0.4, baseDark: 0.5, rim: 0.9, scatterB: 0.4, baseTop: 0.6, ...(LOOK_LAYERS_CFG.vol || {}) };
export const LOOK_FORM = { erosion: 0.16, fine: 0.22, edge: 0.35, ...(LOOK_LAYERS_CFG.form || {}) };
export const LOOK_BANK = { startM: 38000, endM: 170000, towerH: 3.6, cover: 0.42, scaleM: 7000, opacity: 0.92, airMix: 0.6, ...(LOOK_LAYERS_CFG.bankCfg || {}) };
export const LOOK_HIGH = { coverFloor: 0.2, coverCap: 0.3, opacity: 0.45, fibre: 0.5, slantCap: 2, fadeM: [30000, 120000], lowSun: 1.6, lowSunCover: 0.5, ...(LOOK_LAYERS_CFG.highCfg || {}) };
/** True sun elevations (deg) for the low-sun weight (1 at goldenDeg[1], 0 at goldenDeg[0]) and the night weight (0 at nightDeg[0], 1 at nightDeg[1]). */
export const LOOK_LAYERS_SUN = { goldenDeg: [22, 4], nightDeg: [-1, -12], ...(LOOK_LAYERS_CFG.sun || {}) };

/** The look applies on desktop High and Ultra cinema profiles only; Medium, phone and Low keep today's pixels. */
export function lookLayersProfile(name) {
  return typeof name === 'string' && (name.startsWith('ultra') || name.startsWith('high'));
}
