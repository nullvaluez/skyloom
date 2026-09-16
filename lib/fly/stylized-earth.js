/** Accepted Satellite art and resource budget. Neon is gated by the scene's map style. */
export const STYLIZED_EARTH = Object.freeze({
  revision: 4,
  // Surface payloads have their own revision inside worker protocol 22.
  surfaceRevision: 6,
  protocol: 22,
  grid: 4,
  bands: [{ z: 9, size: 128 }, { z: 12, size: 128 }, { z: 14, size: 256 }],
  maxRequests: 2,
  birthSec: 1.2,
  environmentWidth: 512,
  textureBudgetMiB: 300,
  // Includes terrain geometry; reserve remaining texture space for the
  // composer, clouds, lighting environments and the bounded surface atlases.
  // Living Earth 1080p fast-flight allocation audit: 120 MiB retention
  // reached 302.11 MiB total textures. Leave room for transient tile uploads.
  terrainResidentBytes: 80 * 1024 * 1024,
  camera: { distance: 1.03, height: 1.15, lookAhead: 0.24, fov: 58, lagMaxM: 7, targetWidth: 0.15 },
  materials: { assetVersion: 2, size: 256, layers: 8, additionalBudgetMiB: 16, repeatM: 4, fadeStartM: 160, fadeEndM: 1100,
    groundValue: 0.70, facadeReliefM: 0.19, roofValue: 0.68 },
  lighting: { sun: 3.1, fill: 0.14, environment: 0.20, nearHaze: 0.014 },
  profiles: {
    high: { cloudScale: 0.4, cloudSteps: 64, shadowSize: 2048 },
    medium: { cloudScale: 0.3, cloudSteps: 48, shadowSize: 1024 },
    low: { cloudScale: 0.25, cloudSteps: 32, shadowSize: 1024 },
  },
});

export function stylizedEarthOn() {
  // The playable sample was accepted on September 14. Old review URLs are
  // harmless bookmarks; there is only one Satellite treatment, including SSR.
  return true;
}

/** Review-only component comparison. Ordinary Satellite always uses the treatment. */
let cinematicSearch,cinematicReview=false,cinematicOff=new Set();
export function cinematicFlightOn(feature) {
  if (typeof window === 'undefined') return true;
  if(cinematicSearch!==window.location.search){
    cinematicSearch=window.location.search;const params=new URLSearchParams(cinematicSearch);
    cinematicReview=params.get('graphicsReview')==='1';cinematicOff=new Set((params.get('cinematicOff')||'').split(','));
  }
  return !cinematicReview || (!cinematicOff.has('all')&&!cinematicOff.has(feature)&&window.__flyCinematicFeatures?.all !== false && window.__flyCinematicFeatures?.[feature] !== false);
}

/** Every procedural spatial frequency is an integer number of cycles in this period. */
export function earthPatternPhase(value) { return ((value % 8192) + 8192) % 8192; }

export const EARTH_SURFACE = Object.freeze({ unknown: 0, grass: 1, wood: 2, farmland: 3,
  rock: 4, sand: 5, snow: 6, developed: 7, water: 8, scrub: 9, wetland: 10, tidal: 11, asphalt: 12, concrete: 13, bare: 14 });

// sRGB authored albedo, converted to linear once when filling an atlas slot.
export const EARTH_PALETTE = ['#8b9371', '#71934e', '#426c39', '#a3a465',
  '#92907e', '#c9b685', '#dce6e6', '#a69e8c', '#326f80', '#99936b', '#6e8063', '#a1977e', '#72716a', '#a6a397', '#aba18a'];

export function surfaceClass(layer, properties = {}) {
  const c = properties.class, sub = properties.subclass;
  if (layer === 'aeroway' && ['runway', 'taxiway', 'apron'].includes(c)) {
    // Only polygon callers paint this class. A centreline has no trustworthy width.
    return c === 'apron' || properties.surface === 'concrete' ? EARTH_SURFACE.concrete : EARTH_SURFACE.asphalt;
  }
  if (layer === 'water') return properties.intermittent === 1 ? 0 : EARTH_SURFACE.water;
  if (layer === 'landcover') {
    // OpenMapTiles groups leisure=park with grass. It is still an administrative
    // outline, not proof of vegetation (including desert national parks).
    // Schema: https://openmaptiles.org/schema/#landcover
    if (c === 'park' || sub === 'park' || sub === 'national_park' || sub === 'nature_reserve') return EARTH_SURFACE.unknown;
    if (c === 'wood') return EARTH_SURFACE.wood;
    if (c === 'grass' && ['fell', 'heath', 'scrub', 'shrubbery', 'tundra'].includes(sub)) return EARTH_SURFACE.scrub;
    if (c === 'wetland') return ['tidalflat', 'saltern'].includes(sub) ? EARTH_SURFACE.tidal : EARTH_SURFACE.wetland;
    if (c === 'grass') return EARTH_SURFACE.grass;
    if (c === 'farmland') return EARTH_SURFACE.farmland;
    if (c === 'ice' || c === 'snow' || sub === 'glacier') return EARTH_SURFACE.snow;
    if (c === 'sand') return EARTH_SURFACE.sand;
    if (c === 'rock' || c === 'bare_rock' || c === 'scree') return EARTH_SURFACE.rock;
  }
  if (layer === 'landuse') {
    if (['farmland', 'farm', 'orchard', 'vineyard'].includes(c)) return EARTH_SURFACE.farmland;
    if (['residential', 'commercial', 'industrial', 'railway', 'retail'].includes(c)) return EARTH_SURFACE.developed;
    if (c === 'quarry') return EARTH_SURFACE.rock;
    if (c === 'grass' || c === 'meadow') return EARTH_SURFACE.grass;
  }
  // park is administrative, not a statement about vegetation or climate.
  return EARTH_SURFACE.unknown;
}
