import { TileSource } from 'three-tile';
import { ArcGisSource, ArcGisDemSource } from 'three-tile/plugin';
import { TILES } from './fly-constants';
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
export function createImagerySource(style = 'satellite') {
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
    maxLevel: TILES.satMaxZoom,
  });
}

export function createTerrainSources(style = 'satellite') {
  return {
    imgSource: createImagerySource(style),
    demSource: new ArcGisDemSource({
      maxLevel: TILES.demMaxZoom,
    }),
    maxThreads: TILES.maxThreads,
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
