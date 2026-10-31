import { LANDMARK_FIDELITY } from './fly-constants.js';
import { pinned } from './fly-pins.js';
import assets from './landmark-fidelity-assets.json' with { type: 'json' };

export const landmarkFidelityOn = () => pinned(LANDMARK_FIDELITY, '__flyLandmarkFidelityOverride').enabled === true;
const families = new Map();
for (const asset of assets) {
  if (!families.has(asset.poi)) families.set(asset.poi, {});
  families.get(asset.poi)[asset.level] = asset;
}

/** Runtime-only resolution: the worker's static exclusions and original assets stay immutable. */
export function resolveLandmarkEntry(entry) {
  if (!landmarkFidelityOn() || entry.fidelityVersion === 2) return entry;
  const family = families.get(entry.poi);
  if (!family) return entry;
  return {
    ...entry, ...family.far, build: undefined, fidelityVersion: 2,
    yawFixRad: entry.poi === 'Empire State Building' ? Math.PI / 2 : entry.yawFixRad,
    // Specific parts own their PBR/night masks; broad legacy height bands must
    // not repaint glass, clocks or spires from the previous model's proportions.
    accents: [], bakedArchitecture: true,
    detail: { medium: family.medium, high: family.high },
  };
}
