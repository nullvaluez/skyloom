import { useFlyStore } from '../../stores/fly-store.js';

/** Shared art direction. Scene-linear colors; never feed these through Color.set().
 * Ultra is an effects ceiling above the existing high/medium/low scene ladder. */
export const CINEMATIC_EARTH = Object.freeze({
  revision: 1,
  nightHorizon: [.020, .034, .065],
  nightZenith: [.0025, .006, .019],
  camera: { fov: 54, targetWidth: .23, lookAhead: .30, liftM: 1.8, bankShare: .62 },
  profiles: {
    ultra: { cloudScale: .5, cloudSteps: 96, shadowSize: 2048, maxCloudPixels: 2073600 },
    high: { cloudScale: .4, cloudSteps: 72, shadowSize: 2048, maxCloudPixels: 1105920 },
    medium: { cloudScale: .3, cloudSteps: 48, shadowSize: 1024, maxCloudPixels: 360000 },
    low: { cloudScale: .25, cloudSteps: 32, shadowSize: 512, maxCloudPixels: 160000 },
  },
});

export function cinematicEarthOn(state = useFlyStore.getState()) {
  return state.mapStyle === 'satellite' && state.visuals === 'enhanced';
}
export function cinematicQuality(tier, state = useFlyStore.getState()) {
  return CINEMATIC_EARTH.profiles[tier === 'high' && state.qualityPreset === 'ultra' ? 'ultra' : tier]
    || CINEMATIC_EARTH.profiles.medium;
}
export function cloudTargetSize(width, height, profile) {
  const scale = Math.min(profile.cloudScale, Math.sqrt((profile.maxCloudPixels || Infinity) / Math.max(1, width * height)));
  return [Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale))];
}

// Presentation metadata never changes the flight envelope or collision dimensions.
export const VECTOR_PRESENTATION = Object.freeze({
  url: '/models/player-vector-hero-v2.glb',
  mobileUrl: '/models/player-vector-mobile-v2.glb',
  yawFixRad: 0,
  canopyMaterial: 'Canopy glass',
  engines: [[-1.65, -.35, 8.28], [1.65, -.35, 8.28]],
  license: 'MIT', author: 'Skyloom',
});

export function aircraftPresentation(aircraft, phone, state = useFlyStore.getState()) {
  return aircraft.id === 'fighter' && cinematicEarthOn(state) ? {
    ...aircraft.entry, ...VECTOR_PRESENTATION,
    url: phone ? VECTOR_PRESENTATION.mobileUrl : VECTOR_PRESENTATION.url,
  } : aircraft.entry;
}
