/** Shared source/emission decisions. No scene state or renderer dependencies. */
export const GROUND_LIGHTING = {
  profiles: {
    high: { size: 1024, spanM: 2048, sources: 4096 },
    medium: { size: 512, spanM: 1024, sources: 2048 },
    low: { size: 256, spanM: 512, sources: 768 },
  },
  minUpdateSec: 0.35,
  blendSec: 0.3,
  refreshSec: 2,
  moveM: 24,
  heightRangeM: 256,
  receiverGain: 1.4,
  road: { glow: 0.055, lampGain: 3.2, lampSharp: 125, streamGain: 0.018, trafficGain: 0.24 },
};
const fract = (v) => v - Math.floor(v);
const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
export function nightWeight(frac = 1) { return clamp01(1 - frac / 0.36) ** 2; }
/** Keep a quarter-strength city read aloft; the near-deck treatment follows
 * the shared visual AGL signal independently of the device's quality tier. */
export function groundLightingStrength(k = 0) { return 0.25 + 0.75 * clamp01(k); }
export function buildingEmission(seed, warmth = 0.5, occupancy = 0.5) {
  const id = Math.round(seed);
  const lit = fract(id * 0.173) >= 0.13;
  const warmthK = clamp01(warmth + (fract(id * 0.071) - 0.5) * 0.18);
  const gain = 0.30 + fract(id * 0.113) * 0.44;
  // Linear colours, shared verbatim with the facade shader. Warm cream versus
  // cool interior white, rather than the previous saturated copper endpoint.
  const color = [0.66, 0.78, 0.94].map((c, i) => c + ([1, 0.75, 0.43][i] - c) * warmthK);
  return { lit, gain, color, occupancy: clamp01(occupancy) };
}
export const BUILDING_EMISSION_GLSL = `
float darkBuilding = step(0.13, fract(seed * 0.173));
vec3 lamp = mix(vec3(0.66,0.78,0.94), vec3(1.0,0.75,0.43), clamp(warmth+(fract(seed*0.071)-0.5)*0.18,0.0,1.0));
float buildingGlow = 0.30 + fract(seed*0.113)*0.44;
`;
export function snapLightCenter(x, z, span, size) {
  const step = span / size;
  return [Math.round(x / step) * step, Math.round(z / step) * step];
}
export function sourceHeightWeight(receiverY, sourceY, heightM = 5) {
  const t = clamp01((Math.abs(receiverY - sourceY) - 1.5) / Math.max(1, heightM));
  return 1 - t * t * (3 - 2 * t);
}
export function groundLightProfile(tier) { return GROUND_LIGHTING.profiles[tier] ?? GROUND_LIGHTING.profiles.medium; }

/** A resident building/vegetation grid can heal without changing any counts.
 * Include completed building repairs, plus vegetation's queued/completed grid
 * transition, so the visible porch instances follow their real support again.
 * The caller still checks this signature only on its existing placement cadence.
 */
export function houseLightPlacementSignature(veg, buildings, nightK) {
  return `${veg.chunks}|${veg.ready}|${veg.clsChunks}|${veg.vegPts}|` +
    `${buildings?.chunks ?? -1}|${buildings?.ready ?? -1}|${buildings?.columns ?? -1}|${nightK.toFixed(3)}|` +
    `${buildings?.contactHeals ?? 0}|${buildings?.healsInPlace ?? 0}|${buildings?.heals ?? 0}|${veg.heals ?? 0}|${veg.sampling ?? 0}`;
}
export function houseLightPlacementDue(now, last, cadenceSec) { return now - last >= cadenceSec; }
