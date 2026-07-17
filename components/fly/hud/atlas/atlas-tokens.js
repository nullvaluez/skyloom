import { CARD_THEME } from '../inspect/inspect-tokens';

/**
 * Atlas UI palette. The atlas is a UI surface (INK CODEX family), so
 * per-kind accent colors are allowed here — the taste rule only bans them
 * on the in-world letters (FLY_ATLAS_REWORK §3.8). Keep accents on dots,
 * chips and badges; text stays on the ice ramp.
 */
export const ATLAS_KIND = {
  city: { label: 'CITY', color: '#eef5ff', dot: 2.1 },
  airport: { label: 'AIRPORT', color: '#67e8f9', dot: 1.5 },
  military: { label: 'BASE', color: '#f87171', dot: 2.6 },
  hotspot: { label: 'SPOT', color: '#fbbf24', dot: 2.3 },
  landmark: { label: 'SIGHT', color: '#8fa0bf', dot: 1.5 },
};

export const ATLAS_MAP = {
  ocean: '#060912', // a hair darker than the card glass — the map reads as depth
  graticule: 'rgba(61, 74, 117, 0.25)', // PALETTE.voidGrid family
  coast: 'rgba(207, 238, 248, 0.34)', // ice @ ~35% (spec)
  coastWidth: 1,
  player: '#f43f5e', // the red jet
  zoomMin: 1,
  zoomMax: 26,
  latClamp: 84,
};

export { CARD_THEME };
