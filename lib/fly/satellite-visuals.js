/** Coordinated satellite visuals. No renderer imports: safe in workers/tests.
 * Approved cinematic treatment is the default. Use ?graphics=legacy for rollback
 * (or the pre-boot __flyVisualsArm=0 test switch). Feature switches are boot-time only.
 */
export const SATELLITE_VISUALS = {
  enabled: true,
  revision: 1,
  features: {
    architecture: true, lighting: true, ground: true, atmosphere: true,
    water: true, models: true, presentation: true, scale: true, depth: true,
  },
  scale: { bendRadiusM: 1000000, chaseDistance: 1.5, chaseHeight: 0.85, fov: 68 },
  lighting: { roadGlow: 0.035, streetPoolGain: 12, streamGain: 0, trafficGain: 0.32 },
  presentation: { trafficLabels: 6, trailGain: 0.18, trailWidth: 0.25 },
  profiles: {
    high: { buildingChunks: 16, skylineChunks: 10, vegetation: 1, clutter: 1, normalMaps: true, shadows: true, ao: true, water: true },
    medium: { buildingChunks: 10, skylineChunks: 6, vegetation: 0.65, clutter: 0.5, normalMaps: false, shadows: false, ao: false, water: true },
    low: { buildingChunks: 5, skylineChunks: 3, vegetation: 0.25, clutter: 0, normalMaps: false, shadows: false, ao: false, water: false },
  },
};

export function resolveSatelliteVisuals({ arm, query, enabled = SATELLITE_VISUALS.enabled } = {}) {
  if (arm === 1 || arm === true) return true;
  if (arm === 0 || arm === false) return false;
  if (query === 'cinematic' || query === 'immersive') return true;
  if (query === 'legacy') return false;
  return enabled === true;
}

/** Caller must also gate on mapStyle === 'satellite'; worker requests carry this result. */
let lastSearch, graphicsQuery;
export function satelliteVisualsOn(feature) {
  const browser = typeof window !== 'undefined';
  if (browser && window.location.search !== lastSearch) {
    lastSearch = window.location.search;
    graphicsQuery = new URLSearchParams(lastSearch).get('graphics');
  }
  const on = resolveSatelliteVisuals({
    arm: browser ? window.__flyVisualsArm : undefined,
    query: browser ? graphicsQuery : undefined,
  });
  if (!on) return false;
  if (!feature) return true;
  const override = browser ? window.__flyVisualsFeatures?.[feature] : undefined;
  return typeof override === 'boolean' ? override : SATELLITE_VISUALS.features[feature] === true;
}

export function satelliteVisualProfile(tier = 'high') {
  return SATELLITE_VISUALS.profiles[tier] || SATELLITE_VISUALS.profiles.medium;
}

/** The DPR ladder sheds post effects/shadows before it reaches scenery tiers.
 * Keep this independent of world detail: a high scene at 0.875 DPR still owns
 * its complete building/road rings, but no longer pays for high-tier AO/shadows.
 * Callers gate this on satellite preview; Neon uses its original tier. */
export function satelliteEffectTier(sceneTier, dpr = 1) {
  if (sceneTier === 'low' || dpr < 0.8) return 'low';
  if (sceneTier === 'medium' || dpr < 0.9) return 'medium';
  return 'high';
}

/** Explicit local review surface. Adds telemetry/control handles, never graphics pins. */
let reviewSearch, reviewEnabled = false;
export function graphicsReviewOn() {
  if (typeof window === 'undefined') return false;
  if (window.location.search !== reviewSearch) {
    reviewSearch = window.location.search;
    reviewEnabled = new URLSearchParams(reviewSearch).get('graphicsReview') === '1';
  }
  return reviewEnabled;
}
