import { LOOK_LAYERS } from './fly-constants';
import { pinned } from './fly-pins';

/** LOOK PASS D (LAYERS): cloud strata, far-field silhouettes and the horizon: the stacked planes of the view.
 * The owner block with any `?flags=` or console pin applied; FLY_LOOK_PASS.md. */
export const LOOK_LAYERS_CFG = pinned(LOOK_LAYERS, '__flyLookLayersOverride');
export const LOOK_LAYERS_ON = LOOK_LAYERS_CFG.enabled === true;

const dial = (k) => (LOOK_LAYERS_ON ? Math.max(0, Number(LOOK_LAYERS_CFG[k] ?? 1)) : 0);
/** Master dials, 0 when the flag is off. A dial at 0 removes that layer's shader text too. */
export const LOOK_LAYERS_DIALS = { volume: dial('volume'), bank: dial('bank'), high: dial('high') };
export const LOOK_VOL = { occK: 0.4, baseDark: 0.5, rim: 0.9, scatterB: 0.4, baseTop: 0.6, ...(LOOK_LAYERS_CFG.vol || {}) };
export const LOOK_FORM = { erosion: 0.16, fine: 0.22, edge: 0.35, ...(LOOK_LAYERS_CFG.form || {}) };
export const LOOK_BANK = { startM: 38000, endM: 170000, towerH: 4.5, cover: 0.3, scaleM: 26000, opacity: 0.55, airMix: 0.75, ...(LOOK_LAYERS_CFG.bankCfg || {}) };
export const LOOK_HIGH = { coverFloor: 0.22, coverCap: 0.36, opacity: 0.45, fibre: 0.5, slantCap: 3, fadeM: [45000, 160000], ...(LOOK_LAYERS_CFG.highCfg || {}) };

/** The look applies on desktop High and Ultra cinema profiles only; Medium, phone and Low keep today's pixels. */
export function lookLayersProfile(name) {
  return typeof name === 'string' && (name.startsWith('ultra') || name.startsWith('high'));
}
