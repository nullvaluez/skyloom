import { DISTANCE_SOFTEN } from './fly-constants';
import { pinned } from './fly-pins';

export const DISTANCE_SOFTEN_ON = pinned(DISTANCE_SOFTEN, '__flyDistanceSoftenOverride').enabled === true;
export const DISTANCE_SOFTEN_START = 1800;
export const DISTANCE_SOFTEN_END = 3600;
const profiles = {
  high: { maxChunks: 18, reachM: 20000, maxTriangles: 1024, maxBodies: 128 },
  medium: { maxChunks: 8, reachM: 14000, maxTriangles: 512, maxBodies: 64 },
  low: { maxChunks: 4, reachM: 10000, maxTriangles: 256, maxBodies: 32 },
};
export function softenHorizonProfile(profile, tier) {
  return DISTANCE_SOFTEN_ON ? { ...profile, ...(profiles[tier] ?? profiles.medium) } : profile;
}
