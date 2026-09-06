import { TileSource } from 'three-tile';
import { ArcGisSource, ArcGisDemSource } from 'three-tile/plugin';
import { HILLSHADE, TILES } from './fly-constants';
import { PALETTE } from './toy-world/toy-palette';

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
  return TILES.satMaxZoomByTier?.[tier] ?? TILES.satMaxZoom;
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
    return new TileSource({
      url: solidTileUrl(),
      // Coarse cap: every tile is the same flat tan — deep imagery levels
      // would only multiply draw calls under the vector chunks.
      maxLevel: 10,
      attribution: '© OpenStreetMap contributors',
    });
  }
  return new ArcGisSource({
    style: 'World_Imagery',
    maxLevel: satMaxZoomFor(tier),
  });
}

export function createTerrainSources(style = 'satellite', tier = null) {
  // Round 24 (E CERT) — THE HARNESS-ONLY DEM SEAM. This container 403-blocks
  // elevation3d.arcgis.com (recon HARN-ENV-2, measured), so the offline world
  // fixture serves Mapbox terrain-rgb PNGs instead — three-tile registers that
  // decoder by default, so the swap is a source object, not a code path.
  // Same idiom as the live-weather override (lib/fly/weather-model.js:113):
  // production is BYTE-IDENTICAL when the global is absent, and the global is
  // only ever set from scripts/_boot.js under FLY_TILE_FIXTURE.
  const fx = (typeof window !== 'undefined' && window.__flyTileFixture) || null;
  return {
    imgSource: createImagerySource(style, tier),
    demSource: fx?.dem
      ? new TileSource({ maxLevel: TILES.demMaxZoom, ...fx.dem, dataType: 'terrain-rgb' })
      : new ArcGisDemSource({
          maxLevel: TILES.demMaxZoom,
        }),
    maxThreads: TILES.maxThreads,
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
