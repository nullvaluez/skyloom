/** Shared world contract. Geometry identity never depends on quality or load order. */
export const LIVING_EARTH = Object.freeze({
  revision: 1, readinessRadiusM: 1000, loadingHelpMs: 45000,
  architecture: { reliefPerTile: 160 },
  forest: { cellPixels: 8, radiusM: 4200, fadeStartM: 3400, commitBudgetMs: 1.2 },
  profiles: {
    high: { detailM: 900, aircraft: 48, shadowSize: 2048, targetFrameMs: 16.7 },
    medium: { detailM: 600, aircraft: 24, shadowSize: 1024, targetFrameMs: 25 },
    low: { detailM: 350, aircraft: 12, shadowSize: 1024, targetFrameMs: 33.3 },
  },
});
export const livingProfile = tier => LIVING_EARTH.profiles[tier] || LIVING_EARTH.profiles.medium;
export function worldHash(x, z, salt = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ salt;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
/** Source-derived keys remain stable when tiles are sorted, refined or rebased. */
export function worldFeatureId(sourceId, x, z) {
  return `${sourceId ?? 'inferred'}:${Math.round(x * 4)}:${Math.round(z * 4)}`;
}
export function worldPatchState(state) {
  return state === 'ready' ? 'ready' : state === 'empty' ? 'empty' : state === 'error' || state === 'no-data' ? 'unavailable' : 'pending';
}
