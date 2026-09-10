/** Coordinated satellite visuals. No renderer imports: safe in workers/tests.
 * Always supplies the base renderer for immersive visuals. Old query parameters
 * and preview switches cannot fall back to the legacy renderer.
 */
export const SATELLITE_VISUALS = {
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

/** Caller must also gate on mapStyle === 'satellite'; worker requests carry this result. */
export function satelliteVisualsOn(feature) {
  return !feature || SATELLITE_VISUALS.features[feature] === true;
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
