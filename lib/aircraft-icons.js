/**
 * Distinctive Aircraft Icon Definitions
 * Each aircraft type has a unique, visually distinguishable icon shape
 * Now integrated with type-specific silhouettes from aircraft-silhouettes.js
 */

import { AIRCRAFT_SILHOUETTES, getSilhouetteByType, getBestSilhouette } from './aircraft-silhouettes';

export const AIRCRAFT_ICON_DEFINITIONS = {
  // Commercial Airliner - Wide body, distinctive wings
  airliner: {
    viewBox: '0 0 32 32',
    paths: [
      { d: 'M16 2c-1.1 0-2 .9-2 2v7L3 16v3l11-3v8l-4 2.5v2.5l6-2 6 2v-2.5L18 24v-8l11 3v-3L18 11V4c0-1.1-.9-2-2-2z', fill: true }
    ],
    anchor: [16, 16],
  },

  // Business Jet - Sleeker, swept wings
  jet: {
    viewBox: '0 0 32 32',
    paths: [
      { d: 'M16 3c-.8 0-1.5.7-1.5 1.5V10L4 14.5v2l10.5-2V21l-3.5 2v2l5-1.5 5 1.5v-2l-3.5-2v-6.5l10.5 2v-2L17.5 10V4.5c0-.8-.7-1.5-1.5-1.5z', fill: true }
    ],
    anchor: [16, 16],
  },

  // Military Fighter - Aggressive delta/swept shape
  military: {
    viewBox: '0 0 32 32',
    paths: [
      // Main body
      { d: 'M16 1l-2 3v6L3 15v2l11-2v7l-4 3v2l6-2 6 2v-2l-4-3v-7l11 2v-2L18 10V4l-2-3z', fill: true },
      // Tail fins detail
      { d: 'M14 22l-2 1v1l2-.5v-1.5zM18 22l2 1v1l-2-.5v-1.5z', fill: true, opacity: 0.7 }
    ],
    anchor: [16, 16],
  },

  // Cargo Freighter - Bulky body with visible cargo section
  cargo: {
    viewBox: '0 0 32 32',
    paths: [
      // Main aircraft
      { d: 'M16 2c-1.1 0-2 .9-2 2v7L3 16v3l11-3v8l-4 2.5v2.5l6-2 6 2v-2.5L18 24v-8l11 3v-3L18 11V4c0-1.1-.9-2-2-2z', fill: true },
      // Cargo belly bulge
      { d: 'M11 12h10v5H11z', fill: true, opacity: 0.6 },
    ],
    anchor: [16, 16],
  },

  // Helicopter - Rotor blade and distinctive body
  helicopter: {
    viewBox: '0 0 32 32',
    paths: [
      // Main rotor
      { d: 'M4 7h24v2H4z', fill: true, className: 'heli-rotor' },
      // Rotor mast
      { d: 'M15 9h2v4h-2z', fill: true },
      // Body
      { d: 'M10 13h12c2 0 3 1.5 3 3v4c0 1.5-1 3-3 3H10c-2 0-3-1.5-3-3v-4c0-1.5 1-3 3-3z', fill: true },
      // Tail boom
      { d: 'M22 17h6v2h-6z', fill: true },
      // Tail rotor
      { d: 'M27 14v8', stroke: true, fill: false, strokeWidth: 2 },
      // Skids
      { d: 'M8 23v3M24 23v3M6 26h8M18 26h8', stroke: true, fill: false, strokeWidth: 1.5 }
    ],
    anchor: [16, 16],
    animate: 'rotor',
  },

  // Prop/Turboprop - High wing, visible propeller
  prop: {
    viewBox: '0 0 32 32',
    paths: [
      // Propeller
      { d: 'M16 2l2-1h-4l2 1z', fill: true, className: 'prop-blade' },
      { d: 'M14 3l-1-2v4l1-2zM18 3l1-2v4l-1-2z', fill: true, className: 'prop-blade' },
      // Main body
      { d: 'M16 4c-.6 0-1 .4-1 1v6L5 14v2l10-2v7l-3 2v2l4-1 4 1v-2l-3-2v-7l10 2v-2L17 11V5c0-.6-.4-1-1-1z', fill: true }
    ],
    anchor: [16, 16],
  },

  // Glider - Long thin wings, no engine
  glider: {
    viewBox: '0 0 32 32',
    paths: [
      { d: 'M16 5c-.3 0-.5.2-.5.5v6L2 14v1.5l13.5-2v6l-3 2v1.5l3.5-1 3.5 1V20.5l-3-2v-6L30 15.5V14L16.5 11.5V5.5c0-.3-.2-.5-.5-.5z', fill: true }
    ],
    anchor: [16, 16],
    style: 'thin',
  },

  // Drone/UAV - Quadcopter configuration
  drone: {
    viewBox: '0 0 32 32',
    paths: [
      // Propeller circles
      { d: 'M8 8m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', fill: true, opacity: 0.5 },
      { d: 'M24 8m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', fill: true, opacity: 0.5 },
      { d: 'M8 24m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', fill: true, opacity: 0.5 },
      { d: 'M24 24m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', fill: true, opacity: 0.5 },
      // Body
      { d: 'M13 13h6v6h-6z', fill: true },
      // Arms
      { d: 'M8 8L13 13M24 8L19 13M8 24L13 19M24 24L19 19', stroke: true, fill: false, strokeWidth: 2 }
    ],
    anchor: [16, 16],
  },

  // Government/VIP - Executive aircraft with shield marker
  government: {
    viewBox: '0 0 32 32',
    paths: [
      // Main aircraft
      { d: 'M16 3c-.8 0-1.5.7-1.5 1.5V10L4 14.5v2l10.5-2V21l-3.5 2v2l5-1.5 5 1.5v-2l-3.5-2v-6.5l10.5 2v-2L17.5 10V4.5c0-.8-.7-1.5-1.5-1.5z', fill: true },
      // Shield marker
      { d: 'M16 0l3 1.5v2.5c0 2-3 3.5-3 3.5s-3-1.5-3-3.5V1.5L16 0z', fill: true, opacity: 0.6 }
    ],
    anchor: [16, 16],
  },

  // Unknown - Radar blip style
  unknown: {
    viewBox: '0 0 32 32',
    paths: [
      // Outer ring
      { d: 'M16 4a12 12 0 1 0 0 24 12 12 0 0 0 0-24z', fill: false, stroke: true, strokeWidth: 2, opacity: 0.5 },
      // Inner triangle/direction
      { d: 'M16 8l5 10H11l5-10z', fill: true, opacity: 0.8 }
    ],
    anchor: [16, 16],
    style: 'pulsing',
  },
};

// Color palette for aircraft types (classification-based)
// Optimized for visibility on dark map tiles
export const ICON_COLORS = {
  commercial: '#4ade80',   // Brighter green for better visibility
  cargo: '#fbbf24',        // Brighter amber
  military: '#f87171',     // Lighter red for contrast
  private: '#a78bfa',      // Lighter purple
  helicopter: '#22d3ee',   // Brighter cyan
  government: '#f472b6',   // Brighter pink
  special: '#fb923c',      // Brighter orange
  unknown: '#9ca3af',      // Lighter gray for visibility
  selected: '#60a5fa',     // Bright blue
  emergency: '#ff0000',    // Bright Red
};

/**
 * Get icon definition by type
 * @param {string} type - Aircraft icon type
 * @returns {Object} Icon definition
 */
export function getIconDefinition(type) {
  return AIRCRAFT_ICON_DEFINITIONS[type] || AIRCRAFT_ICON_DEFINITIONS.unknown;
}

/**
 * Get color for aircraft classification
 * @param {string} classification - Aircraft classification type
 * @param {boolean} isSelected - Whether aircraft is selected
 * @param {boolean} isEmergency - Whether aircraft is in emergency
 * @returns {string} Hex color code
 */
export function getIconColor(classification, isSelected = false, isEmergency = false) {
  if (isSelected) return ICON_COLORS.selected;
  if (isEmergency) return ICON_COLORS.emergency;
  return ICON_COLORS[classification] || ICON_COLORS.unknown;
}

/**
 * Get icon definition for an aircraft, prioritizing type-specific silhouettes
 * @param {Object} aircraft - Aircraft object with t (type) field
 * @param {string} iconType - Fallback icon type from classification
 * @returns {Object} Icon definition with viewBox and paths
 */
export function getAircraftIconDefinition(aircraft, iconType = 'airliner') {
  // Try to get type-specific silhouette first
  if (aircraft?.t) {
    const typeSilhouette = getSilhouetteByType(aircraft.t);
    if (typeSilhouette) {
      return typeSilhouette;
    }
  }

  // Check if we have a matching detailed silhouette for the icon type
  const bestSilhouette = getBestSilhouette(aircraft, iconType);
  if (AIRCRAFT_SILHOUETTES[bestSilhouette]) {
    return AIRCRAFT_SILHOUETTES[bestSilhouette];
  }

  // Fall back to generic icon definitions
  return AIRCRAFT_ICON_DEFINITIONS[iconType] || AIRCRAFT_ICON_DEFINITIONS.unknown;
}

/**
 * Merge detailed silhouettes into icon definitions
 * This allows the icon system to use both generic and type-specific silhouettes
 */
Object.keys(AIRCRAFT_SILHOUETTES).forEach(key => {
  if (!AIRCRAFT_ICON_DEFINITIONS[key]) {
    AIRCRAFT_ICON_DEFINITIONS[key] = AIRCRAFT_SILHOUETTES[key];
  }
});
