import { TileSource } from './vendor/three-tile/index.js'; // R22 W0: vendored (see vendor/three-tile/VENDOR.md)
import { ArcGisSource, ArcGisDemSource } from './vendor/three-tile/plugin.js';
import { HILLSHADE, TILES, TERRA_SHARP } from './fly-constants';
import { PALETTE } from './toy-world/toy-palette';
import { terraSharpOn, terraCacheOn, terraForce } from './terrain-engine';
import {
  registerRasterCacheLoaders,
  CACHED_IMAGE_TYPE,
  CACHED_LERC_TYPE,
} from './raster-cache';

/**
 * Round 22 (A TERRA, TERRA_CACHE). The ONLY difference between these and their
 * upstream parents is `dataType`, which is what LoaderFactory keys the loader
 * off — every URL, bound, projection and attribution stays the parent's. The
 * cached dataTypes are registered lazily (idempotent) and only ever selected
 * while the flag is armed, so with TERRA_CACHE off the stock 'image'/'lerc'
 * loaders serve every tile exactly as they did in R21.
 */
class CachedArcGisSource extends ArcGisSource {
  constructor(opts) {
    super(opts);
    this.dataType = CACHED_IMAGE_TYPE;
  }
}
class CachedArcGisDemSource extends ArcGisDemSource {
  constructor(opts) {
    super(opts);
    this.dataType = CACHED_LERC_TYPE;
  }
}

// Toy style: the raster layer is a single solid palette-tan texture (a data
// URI — zero network). The DEM still shapes it, so it doubles as the toy
// world's base ground; every visible feature on top comes from the vector
// chunk pipeline (lib/fly/toy-world/). Client-only (fly mode is ssr:false).
let _solidTileUrl = null;
function solidTileUrl() {
  if (!_solidTileUrl && typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    const ctx = c.getContext('2d');
    ctx.fillStyle = PALETTE.groundBase;
    ctx.fillRect(0, 0, 4, 4);
    _solidTileUrl = c.toDataURL('image/png');
  }
  return _solidTileUrl;
}

/**
 * The ONLY place tile providers are defined. Everything is keyless:
 *  - imagery 'satellite': Esri World Imagery public tiles
 *  - imagery 'toy': solid palette tile (data URI, zero network)
 *  - elevation: Esri World Elevation (Terrain3D) LERC tiles, decoded by
 *    three-tile's vendored LERC worker — no extra dependency
 * (round 7: the 'night' CARTO dark_all branch was retired with the style)
 * Swapping providers (e.g. AWS Terrarium via registerDEMLoader) must only
 * ever touch this file.
 */
/**
 * Round 19 (B, decision 2): the imagery zoom ceiling is per quality tier —
 * z17 on high, the R11 z16 everywhere else. Resolved here rather than at the
 * call sites so there is exactly ONE place that decides how deep imagery goes.
 * An unknown/missing tier falls back to the un-tiered TILES.satMaxZoom, which
 * still holds the R11 value, so nothing can accidentally get z17 by omission.
 */
export function satMaxZoomFor(tier) {
  // Round 22 (A TERRA, plan §5.5 — PROBE-BACKED): z18 on the high tier only,
  // behind TERRA_SHARP. Esri World_Imagery was probed at all six R22 poses
  // before this was wired (scripts/r22-a-esri-probe.json): z18 returns real
  // 10–27 KB JPEGs everywhere, so the level is genuine detail and not a
  // stretched z17. Off/pinned ⇒ the frozen R19 by-tier map, unchanged.
  if (terraSharpOn() && tier === 'high' && TERRA_SHARP.maxZoomHigh) {
    const f = terraForce();
    return Number.isFinite(f?.maxZoomHigh) ? f.maxZoomHigh : TERRA_SHARP.maxZoomHigh;
  }
  return TILES.satMaxZoomByTier?.[tier] ?? TILES.satMaxZoom;
}

/**
 * Round 22 (A TERRA, plan §5.5). The DEM ceiling, high tier only, behind
 * TERRA_SHARP. PROBED FIRST (scripts/r22-a-esri-probe.json): Esri Terrain3D
 * serves real LERC at z16 at every R22 pose (20–68 KB blobs) and a degenerate
 * 67-byte constant-surface header at z17 — so 16 is the true data ceiling and
 * asking for 17 would only spend requests on flat tiles. The R21 value (15)
 * stays the fallback for every other tier and for flag-off.
 */
export function demMaxZoomFor(tier) {
  if (terraSharpOn() && tier === 'high' && TERRA_SHARP.demMaxZoom) {
    const f = terraForce();
    return Number.isFinite(f?.demMaxZoom) ? f.demMaxZoom : TERRA_SHARP.demMaxZoom;
  }
  return TILES.demMaxZoom;
}

/**
 * Round 19 (B): the z17 draw clamp is a SATELLITE concern and is gated on the
 * style, not just the tier. Toy's imagery is a single flat tan tile capped at
 * level 10 — it has no texel detail to win from a deeper descent, and it draws
 * its world from the vector chunk pipeline instead. Applying the clamp there
 * only coarsens the toy DEM: MEASURED at 30.1% of subpixels changed and 44
 * fewer draws in a frozen Midtown A/B, which would have silently broken the
 * toy pixel-identity the tile key bump promises. Toy therefore keeps
 * three-tile's default 1 in every tier.
 */
export function lodThresholdFor(style, tier) {
  if (style !== 'satellite') return 1;
  return TILES.lodThresholdByTier?.[tier] ?? 1;
}

export function createImagerySource(style = 'satellite', tier = null) {
  if (style === 'toy') {
    const toy = new TileSource({
      url: solidTileUrl(),
      // Coarse cap: every tile is the same flat tan — deep imagery levels
      // would only multiply draw calls under the vector chunks.
      maxLevel: 10,
      attribution: '© OpenStreetMap contributors',
    });
    // R22: the style/tier stamp (read by TerrainEngine.setImagery). The toy
    // source is a data URI — it is never cached and never zoom-raised.
    toy.flyStyle = 'toy';
    toy.flyTier = tier;
    return toy;
  }
  const cached = terraCacheOn() && registerRasterCacheLoaders();
  const Src = cached ? CachedArcGisSource : ArcGisSource;
  const src = new Src({
    style: 'World_Imagery',
    maxLevel: satMaxZoomFor(tier),
  });
  // R22: carry the resolving style/tier ON the source so a mid-session style
  // hot-swap can re-point the engine's altitude LOD curve (satellite+high
  // only) without FlyScene having to pass them a second time.
  src.flyStyle = 'satellite';
  src.flyTier = tier;
  return src;
}

export function createTerrainSources(style = 'satellite', tier = null) {
  const cached = terraCacheOn() && registerRasterCacheLoaders();
  const DemSrc = cached ? CachedArcGisDemSource : ArcGisDemSource;
  return {
    imgSource: createImagerySource(style, tier),
    demSource: new DemSrc({
      maxLevel: demMaxZoomFor(tier),
    }),
    maxThreads: TILES.maxThreads,
    // R22 (A TERRA): the engine keeps the style/tier that resolved these so the
    // altitude LOD curve stays satellite + high tier only.
    style,
    tier,
    // Round 19 (B): the anisotropy default must be installed BEFORE TileMap
    // creates its first texture, so it travels with the sources rather than
    // being a module-load-time constant (see terrain-engine.js).
    anisotropy: HILLSHADE.anisotropyByTier?.[tier] ?? HILLSHADE.anisotropy,
    // Round 19 (B): the z17 draw clamp — style-gated, see lodThresholdFor.
    lodThreshold: lodThresholdFor(style, tier),
  };
}

const COMMON_ATTRIBUTIONS = [
  {
    label: 'Terrain © Esri',
    href: 'https://www.esri.com/en-us/legal/terms/data-attributions',
  },
  {
    label: 'Flight data © adsb.lol',
    href: 'https://adsb.lol',
  },
];

/** Per-style imagery credit + the always-on lines (Esri terms / ODbL). */
export const ATTRIBUTIONS_BY_STYLE = {
  satellite: [
    {
      label: '© Esri, Maxar, Earthstar Geographics',
      href: 'https://www.esri.com/en-us/legal/terms/data-attributions',
    },
    ...COMMON_ATTRIBUTIONS,
  ],
  toy: [
    { label: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
    { label: 'Tiles © OpenFreeMap', href: 'https://openfreemap.org' },
    ...COMMON_ATTRIBUTIONS,
  ],
};

/** Back-compat: default (satellite) attribution set, used by CreditsPanel. */
export const TERRAIN_ATTRIBUTIONS = ATTRIBUTIONS_BY_STYLE.satellite;
